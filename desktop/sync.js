/* ============================================================
   Creamy Browser for Windows — LK 계정 · Google Drive 동기화 (sync.js)
   ------------------------------------------------------------
   · 인증 브리지 : 127.0.0.1 의 1회성 HTTP 서버(랜덤 포트 · 1회성 state · 5분 제한)를
                   열고 시스템 브라우저로 desktop-auth.html 을 띄운다. 그 페이지가
                   LK 세션과 Google Drive 토큰을 POST 하면 저장하고 브리지를 닫는다.
   · Drive       : REST v3 + drive.file 범위. Soft Hub Backup 폴더 안의
                     creamy-browser-sync.json  — 북마크 · 방문기록 병합본
                     soft-hub-snapshot.json    — Lemon Pass 금고(암호문)만 갱신,
                                                 다른 키는 그대로 보존
   · 저장 위치   : userData/creamy-sync.json (mode 0600). 토큰·금고 암호문만 담고
                   마스터 비밀번호·평문은 어디에도 남기지 않는다.
   ============================================================ */
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var crypto = require('crypto');
var merge = require('./sync-merge');

var FOLDER_NAME = 'Soft Hub Backup';
var SYNC_NAME = 'creamy-browser-sync.json';
var SNAP_NAME = 'soft-hub-snapshot.json';
var PASS_KEY = 'lemon_pass_vault';
var SYNC_SCHEMA = 1;

var DEFAULT_AUTH_URL = 'https://helpaboutflux-cpu.github.io/cream-ai-hub-android/desktop-auth.html';
var DEFAULT_API_BASE = 'https://www.googleapis.com';
var AUTH_TIMEOUT = 5 * 60 * 1000;
var BODY_LIMIT = 512 * 1024;

function gerr(code, detail) {
  var e = new Error(detail || code);
  e.code = code;
  return e;
}

function request(method, url, headers, body) {
  return new Promise(function (resolve, reject) {
    var target;
    try { target = new URL(url); } catch (e) { reject(gerr('bad-url', String(url))); return; }
    var lib = target.protocol === 'http:' ? http : https;
    var req = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      method: method,
      headers: headers || {}
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode || 0, headers: res.headers || {}, body: buf, text: buf.toString('utf8') });
      });
    });
    req.on('error', function (e) { reject(gerr('network', (e && e.message) || 'network')); });
    req.setTimeout(45000, function () { req.destroy(gerr('network', 'timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function driveError(res) {
  var code = 'server-error';
  if (res.status === 401) code = 'drive-expired';
  else if (res.status === 403) code = 'forbidden';
  else if (res.status === 404) code = 'not-found';
  else if (res.status === 429) code = 'rate-limit';
  else if (res.status >= 400 && res.status < 500) code = 'drive-error';
  return gerr(code, 'HTTP ' + res.status);
}

function createSync(opts) {
  opts = opts || {};

  var userDataPath = typeof opts.userDataPath === 'function'
    ? opts.userDataPath
    : function () { return opts.userDataPathDir || ''; };
  var openExternal = opts.openExternal || function () { };
  var focusWindow = opts.focusWindow || function () { };
  var onUpdate = opts.onUpdate || function () { };
  var authUrl = opts.authUrl || DEFAULT_AUTH_URL;
  var apiBase = String(opts.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  var authTimeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : AUTH_TIMEOUT;

  var busy = false;
  var authServer = null;
  var authPromise = null;
  var authState = '';

  var store = {
    lkUser: null,
    lkSession: null,
    gdriveToken: null,
    gdriveEmail: '',
    lastSyncAt: 0,
    lastSync: null,
    passSyncEnabled: false,
    passVault: '',
    lastError: ''
  };

  function filePath() {
    return path.join(userDataPath(), 'creamy-sync.json');
  }

  function load() {
    try {
      var raw = fs.readFileSync(filePath(), 'utf8');
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        store.lkUser = parsed.lkUser && typeof parsed.lkUser === 'object' ? parsed.lkUser : null;
        store.lkSession = parsed.lkSession && typeof parsed.lkSession === 'object' ? parsed.lkSession : null;
        store.gdriveToken = parsed.gdriveToken && typeof parsed.gdriveToken === 'object' ? parsed.gdriveToken : null;
        store.gdriveEmail = typeof parsed.gdriveEmail === 'string' ? parsed.gdriveEmail : '';
        store.lastSyncAt = Number(parsed.lastSyncAt) || 0;
        store.lastSync = parsed.lastSync && typeof parsed.lastSync === 'object' ? parsed.lastSync : null;
        store.passSyncEnabled = parsed.passSyncEnabled === true;
        store.passVault = typeof parsed.passVault === 'string' ? parsed.passVault : '';
        store.lastError = typeof parsed.lastError === 'string' ? parsed.lastError : '';
      }
    } catch (e) { /* first run */ }
    return store;
  }

  function save() {
    try {
      fs.writeFileSync(filePath(), JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 384 });
      return true;
    } catch (e) {
      return false;
    }
  }

  function tokenValue() {
    return (store.gdriveToken && store.gdriveToken.access_token) || '';
  }

  function tokenExpired() {
    if (!tokenValue()) return true;
    var exp = Number(store.gdriveToken && store.gdriveToken.expires_at) || 0;
    if (!exp) return false;
    return Date.now() > (exp - 60000);
  }

  function stateSnapshot() {
    return {
      linked: !!(store.lkUser && store.lkSession && (store.lkSession.access_token || store.lkUser.email)),
      lkUser: store.lkUser ? {
        id: String(store.lkUser.id || ''),
        email: String(store.lkUser.email || ''),
        name: String(store.lkUser.name || '')
      } : null,
      drive: {
        connected: !!tokenValue() && !tokenExpired(),
        wasConnected: !!tokenValue(),
        expired: !!tokenValue() && tokenExpired(),
        email: store.gdriveEmail || '',
        expiresAt: Number(store.gdriveToken && store.gdriveToken.expires_at) || 0
      },
      passSyncEnabled: store.passSyncEnabled === true,
      passVaultCount: merge.vaultCount(store.passVault),
      lastSyncAt: store.lastSyncAt || 0,
      lastSync: store.lastSync || null,
      lastError: store.lastError || '',
      busy: busy,
      pendingAuth: !!authServer
    };
  }

  function emit() {
    try { onUpdate(stateSnapshot()); } catch (e) { }
  }

  /* ---------------- 인증 브리지 ---------------- */

  function closeAuthServer() {
    if (!authServer) return;
    try { authServer.close(); } catch (e) { }
    authServer = null;
    authState = '';
  }

  function corsHeaders(origin) {
    var allowed = /^https:\/\/helpaboutflux-cpu\.github\.io$/.test(origin || '') ? origin : 'https://helpaboutflux-cpu.github.io';
    return {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      'Vary': 'Origin'
    };
  }

  function startAuth() {
    if (authServer) return Promise.reject(gerr('busy', '이미 연결 창이 열려 있습니다.'));
    var seq = crypto.randomBytes(16).toString('hex');
    authState = seq;

    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        closeAuthServer();
        emit();
        resolve(result);
      }

      var server = http.createServer(function (req, res) {
        var origin = req.headers.origin || '';
        var headers = corsHeaders(origin);

        if (req.method === 'OPTIONS') {
          res.writeHead(204, headers);
          res.end();
          return;
        }

        var url;
        try { url = new URL(req.url, 'http://127.0.0.1'); } catch (e) { url = null; }
        var p = url ? url.pathname : '';

        if (req.method === 'GET' && p === '/') {
          res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
          res.end('Creamy Browser 연결 브리지가 실행 중입니다.');
          return;
        }

        if (req.method !== 'POST' || p !== '/callback') {
          res.writeHead(404, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
          res.end(JSON.stringify({ ok: false, error: 'not-found' }));
          return;
        }

        var chunks = [];
        var size = 0;
        var aborted = false;
        req.on('data', function (chunk) {
          if (aborted) return;
          size = size + chunk.length;
          if (size > BODY_LIMIT) {
            aborted = true;
            res.writeHead(413, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
            res.end(JSON.stringify({ ok: false, error: 'too-large' }));
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', function () {
          if (aborted) return;
          var body = null;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
          if (!body || typeof body !== 'object') {
            res.writeHead(400, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
            res.end(JSON.stringify({ ok: false, error: 'bad-body' }));
            return;
          }
          if (String(body.state || '') !== seq) {
            res.writeHead(403, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
            res.end(JSON.stringify({ ok: false, error: 'bad-state' }));
            return;
          }
          acceptAuthPayload(body);
          res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
          res.end(JSON.stringify({ ok: true }));
          try { focusWindow(); } catch (e) { }
          finish({ ok: true, state: stateSnapshot() });
        });
      });

      server.on('error', function (e) {
        closeAuthServer();
        finish({ ok: false, error: 'server-error', detail: String((e && e.message) || e) });
      });

      server.listen(0, '127.0.0.1', function () {
        var addr = server.address();
        var port = addr && addr.port ? addr.port : 0;
        if (!port) {
          closeAuthServer();
          finish({ ok: false, error: 'server-error' });
          return;
        }
        var sep = authUrl.indexOf('?') >= 0 ? '&' : '?';
        var target = authUrl + sep + 'port=' + port + '&state=' + seq;
        try {
          openExternal(target);
        } catch (e) {
          closeAuthServer();
          finish({ ok: false, error: 'open-failed', detail: String((e && e.message) || e) });
          return;
        }
        emit();
      });

      timer = setTimeout(function () {
        finish({ ok: false, error: 'timeout' });
      }, authTimeout);
      if (timer && typeof timer.unref === 'function') timer.unref();

      authServer = server;
    });
  }

  function acceptAuthPayload(body) {
    var user = body.lkUser && typeof body.lkUser === 'object' ? body.lkUser : null;
    var sess = body.lkSession && typeof body.lkSession === 'object' ? body.lkSession : null;
    var tok = body.gdriveToken && typeof body.gdriveToken === 'object' ? body.gdriveToken : null;

    store.lkUser = user ? {
      id: String(user.id || ''),
      email: String(user.email || ''),
      name: String(user.name || '')
    } : null;

    store.lkSession = sess ? {
      access_token: String(sess.access_token || ''),
      refresh_token: String(sess.refresh_token || ''),
      expires_at: Number(sess.expires_at) || 0,
      user_id: String(sess.user_id || '')
    } : null;

    store.gdriveToken = tok && tok.access_token ? {
      access_token: String(tok.access_token),
      expires_at: Number(tok.expires_at) || 0
    } : null;

    store.gdriveEmail = String(body.gdriveEmail || (user && user.email) || '');
    store.lastError = '';
    save();
    emit();
  }

  /* ---------------- Drive ---------------- */

  function authHeaders(extra) {
    return Object.assign({
      Authorization: 'Bearer ' + tokenValue()
    }, extra || {});
  }

  function apiGet(pathAndQuery) {
    return request('GET', apiBase + pathAndQuery, authHeaders()).then(function (res) {
      if (res.status !== 200) throw driveError(res);
      try { return JSON.parse(res.text || '{}'); } catch (e) { throw gerr('bad-response'); }
    });
  }

  function apiSend(method, pathAndQuery, body, optHeaders) {
    var payload = Buffer.from(JSON.stringify(body || {}), 'utf8');
    var headers = authHeaders(Object.assign({
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Length': payload.length
    }, optHeaders || {}));
    return request(method, apiBase + pathAndQuery, headers, payload).then(function (res) {
      if (res.status !== 200 && res.status !== 201) throw driveError(res);
      try { return JSON.parse(res.text || '{}'); } catch (e) { return {}; }
    });
  }

  function findFolder() {
    var q = "name = '" + FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    var url = '/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('files(id,name,trashed)') + '&pageSize=5';
    return apiGet(url).then(function (d) {
      var files = (d && d.files) || [];
      return files.length ? files[0].id : '';
    });
  }

  function ensureFolder() {
    return findFolder().then(function (id) {
      if (id) return id;
      return apiSend('POST', '/drive/v3/files?fields=id', {
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      }).then(function (d) { return d && d.id ? d.id : ''; });
    });
  }

  function findFile(folderId, name) {
    var q = "name = '" + name + "' and '" + folderId + "' in parents and trashed = false";
    var url = '/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('files(id,name,size,modifiedTime)') + '&pageSize=5';
    return apiGet(url).then(function (d) {
      var files = (d && d.files) || [];
      return files.length ? files[0] : null;
    });
  }

  function downloadText(fileId) {
    return request('GET', apiBase + '/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', authHeaders()).then(function (res) {
      if (res.status !== 200) throw driveError(res);
      return res.text;
    });
  }

  function multipartBody(metadata, content, mime) {
    var boundary = 'creamy' + crypto.randomBytes(12).toString('hex');
    var head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n';
    var tail = '\r\n--' + boundary + '--\r\n';
    return {
      boundary: boundary,
      body: Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(content, 'utf8'), Buffer.from(tail, 'utf8')])
    };
  }

  function createJsonFile(folderId, name, text) {
    var mp = multipartBody({ name: name, parents: [folderId] }, text, 'application/json');
    var headers = authHeaders({
      'Content-Type': 'multipart/related; boundary=' + mp.boundary,
      'Content-Length': mp.body.length
    });
    return request('POST', apiBase + '/upload/drive/v3/files?uploadType=multipart&fields=' +
      encodeURIComponent('id,name,modifiedTime'), headers, mp.body).then(function (res) {
      if (res.status !== 200 && res.status !== 201) throw driveError(res);
      try { return JSON.parse(res.text || '{}'); } catch (e) { return {}; }
    });
  }

  function updateJsonFile(fileId, text) {
    var payload = Buffer.from(text, 'utf8');
    var headers = authHeaders({
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Length': payload.length
    });
    return request('PATCH', apiBase + '/upload/drive/v3/files/' + encodeURIComponent(fileId) +
      '?uploadType=media&fields=' + encodeURIComponent('id,name,modifiedTime'), headers, payload)
      .then(function (res) {
        if (res.status !== 200) throw driveError(res);
        try { return JSON.parse(res.text || '{}'); } catch (e) { return {}; }
      });
  }

  function writeJsonFile(folderId, name, existing, value) {
    var text = JSON.stringify(value);
    if (existing && existing.id) return updateJsonFile(existing.id, text).then(function (d) { return d && d.id ? d : { id: existing.id }; });
    return createJsonFile(folderId, name, text);
  }

  function readJsonFile(folderId, name) {
    return findFile(folderId, name).then(function (f) {
      if (!f || !f.id) return { file: null, data: null };
      return downloadText(f.id).then(function (txt) {
        var data = null;
        try { data = JSON.parse(txt); } catch (e) { data = null; }
        return { file: f, data: data };
      });
    });
  }

  /* ---------------- 동기화 실행 ---------------- */

  function emptySnapshot() {
    var now = Date.now();
    return {
      app: 'soft-hub',
      schema: 2,
      createdAt: now,
      updatedAt: now,
      origin: 'creamy-browser-pc',
      folder: FOLDER_NAME,
      writer: 'creamy-browser-pc',
      keys: {},
      drive: { nodes: [], files: [] },
      idb: { dbs: [] },
      media: [],
      counts: { keys: 0, nodes: 0, files: 0, dbs: 0, records: 0, media: 0 }
    };
  }

  function run(input) {
    input = input || {};
    if (busy) return Promise.resolve({ ok: false, error: 'busy' });
    if (!store.lkUser && !store.lkSession) return Promise.resolve({ ok: false, error: 'not-linked' });
    if (!tokenValue()) return Promise.resolve({ ok: false, error: 'drive-missing' });
    if (tokenExpired()) return Promise.resolve({ ok: false, error: 'drive-expired' });

    busy = true;
    emit();
    var out = {
      ok: false,
      bookmarks: Array.isArray(input.bookmarks) ? input.bookmarks : [],
      history: Array.isArray(input.history) ? input.history : [],
      passVault: store.passVault || '',
      passAction: 'off',
      bookmarksPulled: 0,
      historyPulled: 0,
      pushed: false,
      passPushed: false
    };

    return Promise.resolve().then(function () {
      return ensureFolder();
    }).then(function (folderId) {
      if (!folderId) throw gerr('folder-create-failed');

      var chain = Promise.resolve();
      if (!input.passOnly) {
        chain = readJsonFile(folderId, SYNC_NAME).then(function (remote) {
          var remoteData = (remote.data && typeof remote.data === 'object') ? remote.data : {};
          var bm = merge.mergeBookmarks(out.bookmarks, remoteData.bookmarks);
          var hs = merge.mergeHistory(out.history, remoteData.history);
          out.bookmarks = bm.list;
          out.history = hs.list;
          out.bookmarksPulled = bm.pulled;
          out.historyPulled = hs.pulled;
          var payload = {
            app: 'creamy-browser',
            schema: SYNC_SCHEMA,
            origin: 'creamy-browser-pc',
            updatedAt: Date.now(),
            bookmarks: out.bookmarks,
            history: out.history
          };
          return writeJsonFile(folderId, SYNC_NAME, remote.file, payload).then(function () {
            out.pushed = true;
          });
        });
      }

      return chain.then(function () {
        if (!store.passSyncEnabled) { out.passAction = 'off'; return null; }
        return readJsonFile(folderId, SNAP_NAME).then(function (remote) {
          var snap = (remote.data && typeof remote.data === 'object') ? remote.data : emptySnapshot();
          var remoteVault = snap.keys ? snap.keys[PASS_KEY] : null;
          var decision = merge.decideVault(store.passVault, remoteVault);
          out.passAction = decision.action;
          if (decision.action === 'push') {
            var next = merge.withVault(snap, decision.vault);
            return writeJsonFile(folderId, SNAP_NAME, remote.file, next).then(function () {
              out.passPushed = true;
            });
          }
          if (decision.action === 'pull') {
            store.passVault = JSON.stringify(decision.vault);
            out.passVault = store.passVault;
            save();
          }
          return null;
        });
      });
    }).then(function () {
      busy = false;
      out.ok = true;
      store.lastSyncAt = Date.now();
      store.lastSync = {
        ts: store.lastSyncAt,
        bookmarks: out.bookmarks.length,
        history: out.history.length,
        bookmarksPulled: out.bookmarksPulled,
        historyPulled: out.historyPulled,
        passAction: out.passAction
      };
      store.lastError = '';
      save();
      emit();
      return out;
    }, function (e) {
      busy = false;
      var code = (e && e.code) || 'sync-failed';
      store.lastError = code;
      save();
      emit();
      out.ok = false;
      out.error = code;
      out.detail = String((e && e.message) || '');
      return out;
    });
  }

  function logout() {
    store.lkUser = null;
    store.lkSession = null;
    store.gdriveToken = null;
    store.gdriveEmail = '';
    store.passSyncEnabled = false;
    store.lastError = '';
    save();
    emit();
    return { ok: true, state: stateSnapshot() };
  }

  function setPassSync(enabled) {
    store.passSyncEnabled = enabled === true;
    save();
    emit();
    return { ok: true, state: stateSnapshot() };
  }

  function getVault() {
    return {
      ok: true,
      vault: store.passVault || '',
      passSyncEnabled: store.passSyncEnabled === true,
      count: merge.vaultCount(store.passVault),
      updatedAt: merge.vaultUpdatedAt(store.passVault)
    };
  }

  function saveVault(raw) {
    var text = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? JSON.stringify(raw) : '');
    if (text.length > 4 * 1024 * 1024) return { ok: false, error: 'too-large' };
    var parsed = merge.parseVault(text);
    if (!parsed) return { ok: false, error: 'invalid-vault' };
    store.passVault = text;
    save();
    emit();
    return {
      ok: true,
      count: merge.vaultCount(text),
      updatedAt: merge.vaultUpdatedAt(text),
      passSyncEnabled: store.passSyncEnabled === true
    };
  }

  function clearVault() {
    store.passVault = '';
    save();
    emit();
    return { ok: true };
  }

  return {
    load: load,
    state: stateSnapshot,
    startAuth: startAuth,
    cancelAuth: function () { closeAuthServer(); emit(); return { ok: true }; },
    run: run,
    logout: logout,
    setPassSync: setPassSync,
    getVault: getVault,
    saveVault: saveVault,
    clearVault: clearVault
  };
}

module.exports = {
  createSync: createSync,
  FOLDER_NAME: FOLDER_NAME,
  SYNC_NAME: SYNC_NAME,
  SNAP_NAME: SNAP_NAME,
  PASS_KEY: PASS_KEY
};
