/* ============================================================
   Lemon soft · Google Drive 개인 백업 엔진 (lemon-gdrive.js)
   ------------------------------------------------------------
   이용자 본인의 Google Drive(15GB)에 작업물을 직접 백업·복원한다.
   서버를 거치지 않는다 — 정적 웹 + Google Drive REST API v3 (비용 0원).

   · OAuth : Google Identity Services(accounts.google.com/gsi/client) 팝업
             + 스코프 https://www.googleapis.com/auth/drive.file
             → 이 앱이 만든 파일·폴더만 다룰 수 있는 최소 권한.
   · 저장 구조
       Soft Hub Backup/                     (전용 폴더)
         soft-hub-snapshot.json             lemon_* / flux_* 설정·작업물 한 덩어리
         Flux Drive/<nodeId>_<이름>          Flux Drive 파일 내용 (1MB 초과 포함)
   · 백업 제외 : 비밀번호 금고(lemon_pass_vault) · AI API 키(flux_notebook_gemini_key)
                 · 이 엔진의 연결 토큰(lemon_gdrive_*)
   · 복원은 덮어쓰지 않는다 — 이 기기에 없는 항목만 채운다.
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonGDrive && window.LemonGDrive.__v) return;

  var doc = document;

  /* ---- Google Cloud 프로젝트 'Soft Hub Auth' 의 웹 OAuth 클라이언트 ---- */
  var CLIENT_ID = '947168599852-3bqihsumbjai0m1mn2gif0t16eamn17v.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var API = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  var FOLDER_NAME = 'Soft Hub Backup';
  var DRIVE_FOLDER_NAME = 'Flux Drive';
  var SNAP_NAME = 'soft-hub-snapshot.json';
  var SCHEMA = 1;

  /* ---- 이 기기에만 두는 상태 키 ---- */
  var K_TOKEN = 'lemon_gdrive_token_v1';    /* {access_token, expires_at} */
  var K_LINK = 'lemon_gdrive_link_v1';      /* {folderId, driveFolderId, ts} */
  var K_LAST = 'lemon_gdrive_last_v1';      /* 마지막 백업 결과 */
  var K_LAST_RESTORE = 'lemon_gdrive_restore_v1';

  /* ---- 백업에서 빼는 내부·민감 키 ---- */
  var SKIP = {
    lemon_cloud_cfg: 1, lemon_cloud_session: 1, lemon_cloud_last_sync: 1,
    lemon_cloud_usage_v1: 1, lemon_cloud_pulled_v1: 1, lemon_cloud_sync_off: 1,
    lemon_admin_auth: 1, lemon_site_config_v1: 1, lemon_site_ads_v1: 1,
    lemon_site_remote_cfg_v1: 1, lemon_site_remote_ads_v1: 1,
    lemon_notice_ack_v1: 1, lemon_home_ack_v1: 1, lemon_cp_recent: 1,
    lemon_shares_v1: 1, cream_theme: 1, lemon_anim_mode: 1,
    lemon_gdrive_token_v1: 1, lemon_gdrive_link_v1: 1,
    lemon_gdrive_last_v1: 1, lemon_gdrive_restore_v1: 1,
    /* 민감 정보 — Drive 로도 올리지 않는다 (이 기기에만) */
    lemon_pass_vault: 1, flux_notebook_gemini_key: 1
  };
  var PREFIX = /^(lemon_|flux_)/i;
  var KEY_MAX = 4 * 1024 * 1024;            /* 항목 하나 4MB 까지 (그 이상은 건너뛴다) */

  /* ---- Flux Drive (IndexedDB flux_drive_v1 — lemon-cloud.js 와 같은 스키마) ---- */
  var DRIVE_DB = 'flux_drive_v1';
  var DRIVE_VER = 1;

  var busy = false;

  /* ---------------- 작은 도구 ---------------- */
  function readJSON(key, fb) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fb;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fb : v;
    } catch (e) { return fb; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) { } }
  function utf8Bytes(str) {
    str = String(str === null || str === undefined ? '' : str);
    try { if (window.TextEncoder) return new TextEncoder().encode(str).length; } catch (e) { }
    try { return unescape(encodeURIComponent(str)).length; } catch (e) { }
    return str.length;
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent('lemongdrive:' + name, { detail: detail || {} })); } catch (e) { }
  }
  function gerr(code, detail) {
    var e = new Error(String(code || 'error'));
    e.code = String(code || 'error');
    if (detail !== undefined) e.detail = detail;
    return e;
  }

  /* ---------------- 연결 토큰 (이 기기에만) ---------------- */
  function tokenExpiry() {
    var t = readJSON(K_TOKEN, null);
    return t && t.expires_at ? Number(t.expires_at) : 0;
  }
  function token() {
    var t = readJSON(K_TOKEN, null);
    if (!t || !t.access_token) return '';
    if (t.expires_at && Date.now() > (Number(t.expires_at) - 60000)) return '';
    return String(t.access_token);
  }
  function saveToken(access, expiresIn) {
    var sec = Number(expiresIn) || 3600;
    writeJSON(K_TOKEN, { access_token: String(access), expires_at: Date.now() + sec * 1000 });
    var link = readJSON(K_LINK, {}) || {};
    link.ts = Date.now();
    link.folder = FOLDER_NAME;
    writeJSON(K_LINK, link);
  }
  function dropToken() { drop(K_TOKEN); }
  function linkRec() { return readJSON(K_LINK, null); }
  function saveLink(patch) {
    var cur = readJSON(K_LINK, {}) || {};
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    writeJSON(K_LINK, cur);
  }

  /* ---------------- Google Identity Services ---------------- */
  var gisP = null;
  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function loadGis() {
    if (gisReady()) return Promise.resolve();
    if (gisP) return gisP;
    gisP = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () { gisReady() ? resolve() : reject(gerr('gis-load-failed')); };
      s.onerror = function () { gisP = null; reject(gerr('gis-load-failed')); };
      (doc.head || doc.documentElement).appendChild(s);
      setTimeout(function () {
        if (gisReady()) resolve();
        else { gisP = null; reject(gerr('gis-load-failed')); }
      }, 12000);
    });
    return gisP;
  }

  /* 사용자 동의 → access_token. opts.silent = 이미 허용한 적이 있으면 화면 없이 갱신 시도 */
  function startFlow(opts) {
    opts = opts || {};
    if (!CLIENT_ID) return Promise.resolve({ ok: false, error: 'not-configured' });
    return new Promise(function (resolve) {
      var settled = false;
      function end(res) { if (settled) return; settled = true; resolve(res); }
      var client;
      try {
        client = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          include_granted_scopes: true,
          callback: function (resp) {
            if (!resp) return end({ ok: false, error: 'no-response' });
            if (resp.error) {
              return end({ ok: false, error: String(resp.error), detail: String(resp.error_description || '') });
            }
            if (!resp.access_token) return end({ ok: false, error: 'no-token' });
            saveToken(resp.access_token, resp.expires_in);
            emit('change', { connected: true, expires_at: tokenExpiry() });
            end({ ok: true, expires_at: tokenExpiry(), scope: String(resp.scope || '') });
          },
          error_callback: function (err) {
            end({ ok: false, error: String((err && err.type) || 'popup-error'), detail: String((err && err.message) || '') });
          }
        });
      } catch (e) {
        return end({ ok: false, error: 'client-init-failed', detail: String((e && e.message) || e) });
      }
      try {
        client.requestAccessToken({ prompt: opts.silent ? '' : 'consent' });
      } catch (e) {
        return end({ ok: false, error: 'popup-blocked' });
      }
      setTimeout(function () { end({ ok: false, error: 'timeout' }); }, 150000);
    });
  }

  /* 팝업은 클릭 순간에 열려야 차단되지 않는다.
     GIS 가 이미 준비되어 있으면 그 자리에서 바로 띄우고, 아니면 먼저 불러온 뒤 띄운다. */
  function connect(opts) {
    if (gisReady()) return startFlow(opts);
    return loadGis().then(function () {
      return startFlow(opts);
    }, function () {
      return { ok: false, error: 'gis-load-failed' };
    });
  }

  /* 화면이 열릴 때 GIS 를 미리 받아 둔다 (팝업 차단 예방). */
  function prewarm() {
    if (gisReady()) return Promise.resolve();
    return loadGis().then(function () { return true; }, function () { return false; });
  }

  /* 연결 해제 — 토큰과 이 기기의 연결 정보만 지운다. Drive 에 올린 파일은 남긴다. */
  function disconnect() {
    var t = token();
    var p = Promise.resolve();
    if (t && gisReady() && google.accounts.oauth2.revoke) {
      p = new Promise(function (resolve) {
        var done = false;
        function fin() { if (done) return; done = true; resolve(); }
        try { google.accounts.oauth2.revoke(t, fin); } catch (e) { fin(); }
        setTimeout(fin, 4000);
      });
    }
    return p.then(function () {
      dropToken();
      drop(K_LINK);
      emit('change', { connected: false });
      return { ok: true };
    });
  }

  /* ---------------- Drive REST ---------------- */
  function gfetch(url, opts) {
    var t = token();
    if (!t) return Promise.reject(gerr('not-linked'));
    opts = opts || {};
    var headers = {};
    Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
    headers.Authorization = 'Bearer ' + t;
    var init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.body !== undefined) init.body = opts.body;
    return fetch(url, init).then(function (r) {
      if (r.status === 401) {
        dropToken();
        emit('change', { connected: false, reason: 'token-expired' });
        throw gerr('not-linked');
      }
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!r.ok) {
          var msg = (data && (data.error && (data.error.message || data.error.status)) ) || ('HTTP ' + r.status);
          var code = 'api-error';
          if (r.status === 404) code = 'not-found';
          else if (r.status === 403) code = /quota|storage/i.test(String(msg)) ? 'quota' : 'forbidden';
          else if (r.status === 429) code = 'rate-limit';
          else if (r.status >= 500) code = 'server-error';
          var err = gerr(code, String(msg));
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }, function (e) {
      throw gerr('network', String((e && e.message) || e));
    });
  }

  function listFiles(q, extra) {
    var u = API + '?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('files(id,name,size,modifiedTime,mimeType)') +
      '&pageSize=100&spaces=drive' + (extra || '');
    return gfetch(u).then(function (d) { return (d && d.files) || []; });
  }

  function findFile(name, parentId) {
    var q = "name='" + String(name).replace(/'/g, "\\'") + "' and trashed=false" +
      (parentId ? " and '" + parentId + "' in parents" : '');
    return listFiles(q).then(function (files) { return files[0] || null; });
  }

  function findFolder(name, parentId) {
    var q = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" +
      String(name).replace(/'/g, "\\'") + "'" + (parentId ? " and '" + parentId + "' in parents" : '');
    return listFiles(q).then(function (files) {
      var f = null;
      (files || []).forEach(function (x) { if (!f && x && x.id) f = x; });
      return f;
    });
  }

  function createFolder(name, parentId) {
    var meta = { name: name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) meta.parents = [parentId];
    return gfetch(API + '?fields=' + encodeURIComponent('id,name'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(meta)
    }).then(function (d) { return d && d.id ? d.id : ''; });
  }

  /* 폴더가 있으면 그대로, 없으면 만든다. */
  function ensureFolder(name, parentId) {
    return findFolder(name, parentId).then(function (f) {
      if (f && f.id) return f.id;
      return createFolder(name, parentId);
    }).then(function (id) {
      if (!id) throw gerr('folder-create-failed');
      return id;
    });
  }

  /* 루트(Soft Hub Backup)와 Flux Drive 하위 폴더를 확인한다. 캐시된 id 가 죽었으면 다시 만든다. */
  function ensureRoots() {
    var link = linkRec() || {};
    var rootP = link.folderId ? gfetch(API + '/' + link.folderId + '?fields=id,trashed')
      .then(function (d) { return (d && d.id && !d.trashed) ? d.id : ''; }, function () { return ''; })
      : Promise.resolve('');
    return rootP.then(function (rootId) {
      if (rootId) return rootId;
      return ensureFolder(FOLDER_NAME, null);
    }).then(function (rootId) {
      saveLink({ folderId: rootId });
      var subP = link.driveFolderId ? gfetch(API + '/' + link.driveFolderId + '?fields=id,trashed')
        .then(function (d) { return (d && d.id && !d.trashed) ? d.id : ''; }, function () { return ''; })
        : Promise.resolve('');
      return subP.then(function (subId) {
        if (subId) return subId;
        return findFolder(DRIVE_FOLDER_NAME, rootId).then(function (f) {
          return (f && f.id) ? f.id : createFolder(DRIVE_FOLDER_NAME, rootId);
        });
      }).then(function (subId) {
        if (subId) saveLink({ driveFolderId: subId });
        return { root: rootId, drive: subId || '' };
      });
    });
  }

  /* 파일 하나 올리기 — 새로 만들기(메타데이터+내용) 또는 내용만 교체 */
  function createFile(meta, blob) {
    var boundary = '----lemons' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var head = '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: ' + (meta.mimeType || 'application/octet-stream') + '\r\n\r\n';
    var tail = '\r\n--' + boundary + '--';
    var body = new Blob([head, blob, tail]);
    return gfetch(UPLOAD + '?uploadType=multipart&fields=' + encodeURIComponent('id,name,size'), {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body
    }).then(function (d) { return d || {}; });
  }

  function updateFileContent(fileId, blob, mime) {
    return gfetch(UPLOAD + '/' + fileId + '?uploadType=media&fields=' + encodeURIComponent('id,name,size'), {
      method: 'PATCH',
      headers: { 'Content-Type': mime || 'application/octet-stream' },
      body: blob
    }).then(function (d) { return d || {}; });
  }

  function uploadContent(opts) {
    /* opts: {fileId, name, parentId, blob, mime} — fileId 가 있으면 내용 교체, 없으면 새 파일 */
    if (opts.fileId) {
      return updateFileContent(opts.fileId, opts.blob, opts.mime).then(function (d) {
        return { id: d.id || opts.fileId, created: false };
      }, function (e) {
        if (e && (e.code === 'not-found' || e.code === 'forbidden')) {
          return createFile({ name: opts.name, parents: opts.parentId ? [opts.parentId] : undefined, mimeType: opts.mime }, opts.blob)
            .then(function (d) { return { id: d.id, created: true }; });
        }
        throw e;
      });
    }
    return createFile({ name: opts.name, parents: opts.parentId ? [opts.parentId] : undefined, mimeType: opts.mime }, opts.blob)
      .then(function (d) { return { id: d.id, created: true }; });
  }

  function downloadBlob(fileId) {
    var t = token();
    if (!t) return Promise.reject(gerr('not-linked'));
    return fetch(API + '/' + fileId + '?alt=media', {
      headers: { Authorization: 'Bearer ' + t }, cache: 'no-store'
    }).then(function (r) {
      if (r.status === 401) { dropToken(); emit('change', { connected: false }); throw gerr('not-linked'); }
      if (!r.ok) throw gerr(r.status === 404 ? 'not-found' : 'download-failed', 'HTTP ' + r.status);
      return r.blob();
    }, function (e) { throw gerr('network', String((e && e.message) || e)); });
  }

  /* ---------------- Flux Drive (IndexedDB) ---------------- */
  var dbP = null;
  function openDB() {
    if (dbP) return dbP;
    dbP = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(gerr('idb-unavailable')); return; }
      var rq;
      try { rq = indexedDB.open(DRIVE_DB, DRIVE_VER); } catch (e) { reject(e); return; }
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('nodes')) {
          var st = db.createObjectStore('nodes', { keyPath: 'id' });
          st.createIndex('parentId', 'parentId', { unique: false });
          st.createIndex('trashed', 'trashed', { unique: false });
          st.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      rq.onsuccess = function () {
        var db = rq.result;
        db.onversionchange = function () { try { db.close(); } catch (e) { } dbP = null; };
        resolve(db);
      };
      rq.onerror = function () { reject(rq.error || gerr('idb-open-failed')); };
      rq.onblocked = function () { reject(gerr('idb-blocked')); };
    });
    dbP = dbP.then(function (db) { return db; }, function (e) { dbP = null; throw e; });
    return dbP;
  }
  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbAll(store) {
    return openDB().then(function (db) { return idbReq(db.transaction(store).objectStore(store).getAll()); });
  }
  function idbGet(store, key) {
    return openDB().then(function (db) { return idbReq(db.transaction(store).objectStore(store).get(key)); });
  }
  function idbPut(store, val) {
    return openDB().then(function (db) { return idbReq(db.transaction(store, 'readwrite').objectStore(store).put(val)); });
  }
  function driveNodes() {
    return idbAll('nodes').then(function (l) { return l || []; }, function () { return []; });
  }
  function driveBlob(id) {
    return idbGet('blobs', id).then(function (rec) { return rec ? rec.blob : null; }, function () { return null; });
  }

  /* ---------------- 이 기기의 백업 대상 ---------------- */
  function keyList() {
    /* 백업 대상: lemon_* · flux_* (내부·민감 키 제외) */
    var out = [], seen = {};
    function add(k) {
      k = String(k === null || k === undefined ? '' : k);
      if (!k || seen['#' + k] || SKIP[k] || !PREFIX.test(k)) return;
      seen['#' + k] = 1;
      out.push(k);
    }
    try {
      if (window.Lemon && Lemon.store && typeof Lemon.store.keys === 'function') {
        Lemon.store.keys().forEach(add);
      } else {
        for (var i = 0; i < localStorage.length; i++) add(localStorage.key(i));
      }
    } catch (e) { }
    return out;
  }

  function collectKeys() {
    var out = {}, skipped = [], bytes = 0;
    keyList().forEach(function (k) {
      var raw = null;
      try { raw = localStorage.getItem(k); } catch (e) { return; }
      if (raw === null) return;
      var size = utf8Bytes(raw);
      if (size > KEY_MAX) { skipped.push({ key: k, bytes: size }); return; }
      var val;
      try { val = JSON.parse(raw); } catch (e) { val = raw; }
      out[k] = val;
      bytes += size;
    });
    return { keys: out, skipped: skipped, bytes: bytes };
  }

  function safeName(name) {
    var s = String(name === null || name === undefined ? 'file' : name)
      .replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
    if (!s) s = 'file';
    if (s.length > 90) {
      var dot = s.lastIndexOf('.');
      var ext = (dot > 0 && s.length - dot <= 10) ? s.slice(dot) : '';
      s = s.slice(0, 90 - ext.length) + ext;
    }
    return s;
  }
  function driveFileName(node) { return safeName(node.id + '_' + (node.name || 'file')); }

  /* ---------------- 백업 ---------------- */
  function readRemoteSnapshot(rootId) {
    return findFile(SNAP_NAME, rootId).then(function (f) {
      if (!f || !f.id) return { snap: null, fileId: '' };
      return downloadBlob(f.id).then(function (b) {
        return b.text().then(function (txt) {
          var snap = null;
          try { snap = JSON.parse(txt); } catch (e) { snap = null; }
          return { snap: snap, fileId: f.id, size: b.size };
        });
      }, function () { return { snap: null, fileId: f.id }; });
    }, function () { return { snap: null, fileId: '' }; });
  }

  /* opts.onProgress(phase, done, total, label) */
  function backup(opts) {
    opts = opts || {};
    var progress = function (phase, done, total, label) {
      if (opts.onProgress) { try { opts.onProgress({ phase: phase, done: done, total: total, label: label || '' }); } catch (e) { } }
    };
    if (!token()) return Promise.resolve({ ok: false, error: 'not-linked' });
    if (busy) return Promise.resolve({ ok: false, error: 'busy' });
    busy = true;
    progress('start', 0, 0, '폴더를 확인하는 중');

    var result = { ok: false, keys: 0, nodes: 0, files: 0, uploaded: 0, bytes: 0, skippedKeys: [] };
    var rootId = '', driveId = '';

    return ensureRoots().then(function (ids) {
      rootId = ids.root;
      driveId = ids.drive;
      progress('snapshot', 0, 0, '이전 백업을 확인하는 중');
      return readRemoteSnapshot(rootId);
    }).then(function (prev) {
      var prevSnap = prev.snap || null;
      var prevMap = {};
      if (prevSnap && prevSnap.drive && Array.isArray(prevSnap.drive.files)) {
        prevSnap.drive.files.forEach(function (f) { if (f && f.nodeId) prevMap[f.nodeId] = f; });
      }
      var keys = collectKeys();
      return driveNodes().then(function (nodes) {
        var list = (nodes || []).filter(function (n) {
          return n && n.id && n.kind === 'file' && !n.trashed && Number(n.size) > 0;
        });
        var fileRecs = [];
        var idx = 0, uploaded = 0, bytes = 0;
        function step() {
          if (idx >= list.length) {
            return Promise.resolve({ files: fileRecs, uploaded: uploaded, bytes: bytes });
          }
          var node = list[idx++];
          var prevRec = prevMap[node.id] || null;
          var name = driveFileName(node);
          progress('files', idx - 1, list.length, node.name || '파일');
          return driveBlob(node.id).then(function (blob) {
            if (!blob) return null;
            var size = Number(blob.size || node.size || 0);
            var mime = node.mime || blob.type || 'application/octet-stream';
            if (prevRec && prevRec.fileId && prevRec.size === size &&
              prevRec.nodeUpdatedAt === node.updatedAt && prevRec.name === name) {
              fileRecs.push(prevRec);
              return null;
            }
            return uploadContent({
              fileId: prevRec && prevRec.fileId ? prevRec.fileId : '',
              name: name,
              parentId: driveId,
              blob: blob,
              mime: mime
            }).then(function (up) {
              uploaded++;
              bytes += size;
              fileRecs.push({
                nodeId: node.id, fileId: up.id, name: name, size: size,
                mime: mime, nodeUpdatedAt: node.updatedAt
              });
            }, function (e) {
              /* 파일 하나가 실패해도 나머지는 계속 올린다. */
              fileRecs.push({
                nodeId: node.id, fileId: (prevRec && prevRec.fileId) || '', name: name,
                size: size, mime: mime, nodeUpdatedAt: node.updatedAt, error: (e && e.code) || 'upload-failed'
              });
            });
          }, function () { return null; }).then(function () {
            progress('files', idx, list.length, node.name || '파일');
            return step();
          });
        }
        return step().then(function (out) {
          var snap = {
            app: 'soft-hub',
            schema: SCHEMA,
            createdAt: (prevSnap && prevSnap.createdAt) || Date.now(),
            updatedAt: Date.now(),
            origin: location.origin,
            folder: FOLDER_NAME,
            driveFolderId: driveId,
            keys: keys.keys,
            drive: {
              nodes: (nodes || []).map(function (n) {
                return {
                  id: n.id, name: n.name || '', kind: n.kind || 'file', parentId: n.parentId || null,
                  mime: n.mime || '', size: Number(n.size || 0), updatedAt: Number(n.updatedAt || 0),
                  trashed: !!n.trashed
                };
              }),
              files: out.files
            },
            counts: {
              keys: Object.keys(keys.keys).length,
              nodes: (nodes || []).length,
              files: out.files.length
            }
          };
          var json = JSON.stringify(snap);
          var blob = new Blob([json], { type: 'application/json' });
          result.keys = Object.keys(keys.keys).length;
          result.nodes = (nodes || []).length;
          result.files = out.files.length;
          result.uploaded = out.uploaded;
          result.bytes = out.bytes + blob.size;
          result.skippedKeys = keys.skipped;
          progress('snapshot', 0, 1, '설정 스냅샷을 올리는 중');
          return uploadContent({
            fileId: prev.fileId || '',
            name: SNAP_NAME,
            parentId: rootId,
            blob: blob,
            mime: 'application/json'
          }).then(function () {
            progress('snapshot', 1, 1, '완료');
            return { snapBytes: blob.size };
          });
        });
      });
    }).then(function (r) {
      busy = false;
      var rec = {
        ts: Date.now(), keys: result.keys, nodes: result.nodes, files: result.files,
        uploaded: result.uploaded, bytes: result.bytes, snapBytes: r.snapBytes,
        skippedKeys: result.skippedKeys
      };
      writeJSON(K_LAST, rec);
      result.ok = true;
      result.ts = rec.ts;
      result.record = rec;
      emit('backup', rec);
      progress('done', 1, 1, '완료');
      return result;
    }, function (e) {
      busy = false;
      var code = (e && e.code) || 'backup-failed';
      emit('backup-error', { error: code });
      return { ok: false, error: code, detail: String((e && (e.detail || e.message)) || '') };
    });
  }

  /* ---------------- 복원 ---------------- */
  function restore(opts) {
    opts = opts || {};
    var progress = function (phase, done, total, label) {
      if (opts.onProgress) { try { opts.onProgress({ phase: phase, done: done, total: total, label: label || '' }); } catch (e) { } }
    };
    if (!token()) return Promise.resolve({ ok: false, error: 'not-linked' });
    if (busy) return Promise.resolve({ ok: false, error: 'busy' });
    busy = true;
    progress('find', 0, 0, '백업을 찾는 중');
    var out = { ok: false, keys: 0, kept: 0, nodes: 0, files: 0, missing: 0, total: 0 };

    return findFolder(FOLDER_NAME, null).then(function (f) {
      if (!f || !f.id) throw gerr('no-backup');
      saveLink({ folderId: f.id });
      return readRemoteSnapshot(f.id);
    }).then(function (prev) {
      var snap = prev.snap;
      if (!snap || typeof snap !== 'object' || !snap.keys) throw gerr('no-backup');
      progress('keys', 0, 0, '설정을 복원하는 중');
      Object.keys(snap.keys || {}).forEach(function (k) {
        if (SKIP[k]) return;
        var has = false;
        try { has = localStorage.getItem(k) !== null; } catch (e) { }
        if (has) { out.kept++; return; }
        try {
          var v = snap.keys[k];
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          out.keys++;
        } catch (e) { }
      });
      var snapNodes = (snap.drive && Array.isArray(snap.drive.nodes)) ? snap.drive.nodes : [];
      var snapFiles = (snap.drive && Array.isArray(snap.drive.files)) ? snap.drive.files : [];
      out.total = snapNodes.length;
      return driveNodes().then(function (local) {
        var have = {};
        (local || []).forEach(function (n) { if (n && n.id) have[n.id] = 1; });
        var chain = Promise.resolve();
        snapNodes.forEach(function (n, i) {
          chain = chain.then(function () {
            if (!n || !n.id || have[n.id]) return null;
            var node = {};
            Object.keys(n).forEach(function (k) { node[k] = n[k]; });
            node.id = n.id;
            if (!node.kind) node.kind = 'file';
            return idbPut('nodes', node).then(function () {
              have[n.id] = 1; out.nodes++;
            }, function () { });
          }).then(function () { progress('nodes', i + 1, snapNodes.length, n && n.name ? n.name : ''); });
        });
        return chain.then(function () {
          var chain2 = Promise.resolve();
          snapFiles.forEach(function (rec, i) {
            chain2 = chain2.then(function () {
              if (!rec || !rec.nodeId || !rec.fileId || !have[rec.nodeId]) return null;
              return driveBlob(rec.nodeId).then(function (cur) {
                if (cur) return null;
                return downloadBlob(rec.fileId).then(function (blob) {
                  if (!blob) { out.missing++; return null; }
                  return idbPut('blobs', { id: rec.nodeId, blob: blob }).then(function () {
                    out.files++;
                  }, function () { out.missing++; });
                }, function () { out.missing++; });
              }, function () { out.missing++; });
            }).then(function () { progress('files', i + 1, snapFiles.length, rec && rec.name ? rec.name : ''); });
          });
          return chain2;
        });
      });
    }).then(function () {
      busy = false;
      var rec = {
        ts: Date.now(), keys: out.keys, kept: out.kept, nodes: out.nodes,
        files: out.files, missing: out.missing, total: out.total
      };
      writeJSON(K_LAST_RESTORE, rec);
      out.ok = true;
      out.ts = rec.ts;
      emit('restored', rec);
      progress('done', 1, 1, '완료');
      return out;
    }, function (e) {
      busy = false;
      var code = (e && e.code) || 'restore-failed';
      emit('restore-error', { error: code });
      return { ok: false, error: code, detail: String((e && (e.detail || e.message)) || '') };
    });
  }

  /* ---------------- 사람에게 보여줄 문구 ---------------- */
  function message(code) {
    var c = String(code || '');
    if (c === 'not-linked') return 'Google Drive 연결이 필요합니다. [Google Drive 연결]을 눌러 주세요.';
    if (c === 'timeout') return 'Google 창에서 응답이 없어 연결을 마치지 못했습니다. 다시 시도해 주세요.';
    if (c === 'popup_closed' || c === 'popup_closed_by_user') return '연결 창이 닫혔습니다. 다시 시도해 주세요.';
    if (c === 'popup-blocked' || c === 'popup_failed_to_open') return '브라우저가 연결 창을 막았습니다. 팝업을 허용한 뒤 다시 시도해 주세요.';
    if (c === 'access_denied') return 'Google Drive 연결을 취소했습니다.';
    if (c === 'origin_mismatch' || c === 'idpiframe_initialization_failed') {
      return '이 사이트 주소가 Google OAuth 클라이언트의 승인된 JavaScript 원본에 등록되어 있지 않습니다. 관리자 설정(Google Cloud Console)에서 주소를 추가해야 합니다.';
    }
    if (c === 'gis-load-failed') return 'Google 로그인 모듈을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
    if (c === 'quota') return 'Google Drive 저장 공간이 부족합니다. 드라이브에서 공간을 비운 뒤 다시 시도해 주세요.';
    if (c === 'not-found' || c === 'no-backup') return 'Google Drive에 백업이 아직 없습니다. 먼저 백업해 주세요.';
    if (c === 'rate-limit') return 'Google 요청이 잠시 제한되었습니다. 잠시 뒤 다시 시도해 주세요.';
    if (c === 'network') return '네트워크 오류로 Google Drive에 연결하지 못했습니다.';
    if (c === 'idb-unavailable' || c === 'idb-open-failed' || c === 'idb-blocked') return '이 브라우저에서는 드라이브 저장소를 열 수 없습니다(시크릿 모드 등).';
    if (c === 'busy') return '다른 백업·복원 작업이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.';
    if (c === 'forbidden') return 'Google Drive 접근이 거부되었습니다. 연결을 해제한 뒤 다시 연결해 주세요.';
    if (c === 'server-error') return 'Google 서버가 잠시 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.';
    return '작업을 마치지 못했습니다' + (c ? ' (' + c + ')' : '') + '.';
  }

  function status() {
    var link = linkRec() || {};
    return {
      configured: !!CLIENT_ID,
      connected: !!token(),
      expires_at: tokenExpiry(),
      wasLinked: !!link.ts,
      folder: FOLDER_NAME,
      folderId: link.folderId || '',
      last: readJSON(K_LAST, null),
      lastRestore: readJSON(K_LAST_RESTORE, null),
      busy: busy
    };
  }

  window.LemonGDrive = {
    __v: 1,
    clientId: function () { return CLIENT_ID; },
    scope: function () { return SCOPE; },
    folderName: function () { return FOLDER_NAME; },
    status: status,
    connected: function () { return !!token(); },
    connect: connect,
    prewarm: prewarm,
    disconnect: disconnect,
    backup: backup,
    restore: restore,
    message: message,
    fmtBytes: fmtBytes,
    lastBackup: function () { return readJSON(K_LAST, null); },
    lastRestore: function () { return readJSON(K_LAST_RESTORE, null); }
  };
})();
