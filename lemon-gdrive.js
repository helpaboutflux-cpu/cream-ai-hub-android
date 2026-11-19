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
         soft-hub-snapshot.json             설정·작업물·서비스 데이터 한 덩어리
         Flux Drive/<nodeId>_<이름>          Flux Drive 파일 내용 (크기 제한 없음)
         Service Media/<dbName>/<파일>       서비스 IndexedDB 안의 큰 이미지·음원·영상
   · 백업 대상
       localStorage  lemon_* · flux_*  +  프로젝트 키 6종(EXPLICIT_KEYS)
       IndexedDB     Flux Drive(flux_drive_v1) · 서비스 저장소 28종 · 같은 출처의 나머지 DB
   · 백업 제외 : 비밀번호 금고(lemon_pass_vault) · AI API 키(flux_notebook_gemini_key)
                 · 이 엔진의 연결 토큰(lemon_gdrive_*)
   · 복원은 덮어쓰지 않는다 — 이 기기에 없는 항목만 채운다.

   자동 동기화 (2026-11)
   · 접속 시  : 연결된 기기라면 페이지를 열 때 Drive 의 스냅샷 메타(modifiedTime)만
                가볍게 확인하고, 로컬보다 새 것일 때만 복원한다. (20초 쿨다운 · 탭 간 잠금)
                토큰이 만료됐으면 silent(prompt:'') 갱신을 20분에 1회만 조용히 시도한다.
   · 변경 시  : 백업 대상 localStorage·IndexedDB 에 쓰기가 생기면 5초 디바운스 뒤
                backup() 을 자동 실행한다. (복원 중 쓰기는 isRestoring 으로 막는다)
   · 설정     : lemon_gdrive_sync_v1 { pull, push, ... } — 기본 둘 다 켜짐.
   · 용량     : quota() — about.get(전체 드라이브) + Soft Hub Backup 폴더 합산.

   계정 변경 (2026-11)
   · switchAccount() — 기존 토큰을 비우고 GIS requestAccessToken({ prompt: 'select_account' }) 로
     다른 Google 계정을 고르게 한다. 취소하면 이전 계정 연결을 조용히 되살린다.
   · 연결 계정은 about.get(storageQuota,user) 의 user.emailAddress·displayName 을
     lemon_gdrive_link_v1 에 남기고 status() 의 accountEmail·accountName 으로 노출한다.
     drive.file 범위상 about 이 403 이면 폴더 소유자로 한 번 더 시도하고, 그래도 모르면 조용히 비운다.
   · 계정이 실제로 바뀌면 이전 계정의 폴더 id·원격 기준(last_remote_at)·용량 캐시를 버리고
     새 계정의 백업과 처음부터 동기화한다(이전 계정의 Drive 백업 파일은 지우지 않는다).
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonGDrive && window.LemonGDrive.__v >= 2) return;

  var doc = document;

  /* ---- Google Cloud 프로젝트 'Soft Hub Auth' 의 웹 OAuth 클라이언트 ---- */
  var CLIENT_ID = '947168599852-3bqihsumbjai0m1mn2gif0t16eamn17v.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var API = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  var FOLDER_NAME = 'Soft Hub Backup';
  var DRIVE_FOLDER_NAME = 'Flux Drive';
  var MEDIA_FOLDER_NAME = 'Service Media';
  var SNAP_NAME = 'soft-hub-snapshot.json';
  var SCHEMA = 2;

  /* ---- 이 기기에만 두는 상태 키 ---- */
  var K_TOKEN = 'lemon_gdrive_token_v1';    /* {access_token, expires_at} */
  var K_LINK = 'lemon_gdrive_link_v1';      /* {folderId, driveFolderId, ts} */
  var K_LAST = 'lemon_gdrive_last_v1';      /* 마지막 백업 결과 */
  var K_LAST_RESTORE = 'lemon_gdrive_restore_v1';
  var K_SYNC = 'lemon_gdrive_sync_v1';      /* 자동 동기화 설정·상태 */
  var K_LOCK = 'lemon_gdrive_synclock_v1';  /* 탭 간 동시 실행 방지 잠금 */

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
    lemon_gdrive_sync_v1: 1, lemon_gdrive_synclock_v1: 1,
    /* 민감 정보 — Drive 로도 올리지 않는다 (이 기기에만) */
    lemon_pass_vault: 1, flux_notebook_gemini_key: 1
  };
  var PREFIX = /^(lemon_|flux_)/i;
  var KEY_MAX = 4 * 1024 * 1024;            /* 항목 하나 4MB 까지 (그 이상은 건너뛴다) */

  /* lemon_/flux_ 접두사가 없지만 함께 백업해야 하는 프로젝트 키 */
  var EXPLICIT_KEYS = {
    web_launcher_sites: 1,          /* Developer Hub — 웹런처 사이트 */
    cream_apk_projects: 1,          /* Developer Hub — APK 프로젝트 */
    cream_short_links: 1,           /* Developer Hub — 짧은 링크 */
    lemon3d_archive__active: 1,     /* Lemon 3D — 보관함 */
    lemonlogo_archive__active: 1,   /* Lemon Logo — 보관함 */
    fluxgroups_nick: 1              /* Flux Groups — 닉네임 */
  };

  /* 서비스 IndexedDB — 서비스 코드가 여는 이름 그대로 (DB 버전은 백업 시 실측값을 쓴다) */
  var IDB_NAMES = [
    'lemon_bio_v2', 'lemon_builder_v1', 'flux_calendar_v1', 'lemon_clip_v1',
    'flux_contacts_v1', 'lemon_dday_v1', 'lemon_grade_v1', 'flux_groups_plus_v1',
    'flux_groups_v1', 'flux_mail_v1', 'flux_memo_v1', 'lemon_minutes_v1',
    'flux_notebook_v1', 'flux_notes_v1', 'lemon_planner_v1', 'lemon_player_v1',
    'lemon_prompt_v1', 'lemon_quiz_v1', 'lemon_shelf_media_v1', 'lemon_sketch_v1',
    'lemon_studio_v1', 'flux_tasks_v1', 'flux_tempmail_v1', 'lemon_typing_v1',
    'lemon_wallet_v1', 'lemon_weather_v1', 'lemon_zip_v1', 'lemon_kv_idb_v1'
  ];
  var IDB_MEDIA_MAX = 128 * 1024;           /* 이보다 큰 Blob·ArrayBuffer 는 Drive 파일로 따로 올린다 */

  /* ---- Flux Drive (IndexedDB flux_drive_v1 — lemon-cloud.js 와 같은 스키마) ---- */
  var DRIVE_DB = 'flux_drive_v1';
  var DRIVE_VER = 1;

  var busy = false;
  var isRestoring = false;                  /* 복원 중 쓰기는 자동 백업에서 제외한다 */

  /* ---- 자동 동기화 ---- */
  var SYNC_COOLDOWN = 20 * 1000;            /* 연속 페이지 이동 시 메타 확인 간격 */
  var REMOTE_TOL = 2000;                    /* 서버 시계 오차 허용 */
  var AUTO_DEBOUNCE = 5000;                 /* 변경 → 백업 지연 */
  var AUTO_MIN_GAP = 25 * 1000;             /* 자동 백업 최소 간격 (그 사이 변경은 모아서 한 번) */
  var SILENT_GAP = 20 * 60 * 1000;          /* silent 토큰 갱신 최소 간격 */
  var LOCK_TTL = 40 * 1000;
  var autoTimer = null, autoPending = false, autoRunning = false;
  var pullP = null, silentFlowP = null;
  var autoBackups = 0, autoRestores = 0;

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
    /* 두 이름을 함께 알린다 — lemongdrive:* (기존) · lemon-gdrive:* (문서 표기) */
    try { window.dispatchEvent(new CustomEvent('lemongdrive:' + name, { detail: detail || {} })); } catch (e) { }
    try { window.dispatchEvent(new CustomEvent('lemon-gdrive:' + name, { detail: detail || {} })); } catch (e) { }
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
    quotaCache = null;
    var link = readJSON(K_LINK, {}) || {};
    link.ts = Date.now();
    link.folder = FOLDER_NAME;
    writeJSON(K_LINK, link);
  }
  function dropToken() { drop(K_TOKEN); }
  function linkRec() { return readJSON(K_LINK, null); }
  /* 연결한 적이 있는 기기인가 — 토큰 갱신 시각(ts) 또는 백업 폴더 id 가 있으면 그렇다. */
  function isLinked() {
    var l = linkRec();
    return !!(l && (l.ts || l.folderId));
  }
  function saveLink(patch) {
    var cur = readJSON(K_LINK, {}) || {};
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    writeJSON(K_LINK, cur);
  }

  /* ---------------- 연결된 Google 계정 (이 기기에만) ----------------
     drive.file 범위라도 about.get 이 user 를 돌려주면 이메일을 남긴다.
     범위 밖(403)이면 조용히 알 수 없는 상태로 둔다 — 백업은 그대로 동작한다. */
  function accountRec() {
    var l = linkRec() || {};
    return {
      email: String(l.accountEmail || ''),
      name: String(l.accountName || ''),
      at: Number(l.accountAt) || 0
    };
  }
  function account() {
    var a = accountRec();
    return { email: a.email, name: a.name, known: !!a.email, at: a.at };
  }

  /* 이전 계정의 폴더·원격 기준으로 새 계정을 다루지 않도록 기준을 버린다. */
  function resetRemoteBase() {
    saveLink({ folderId: '', driveFolderId: '' });
    quotaCache = null;
    acctTryAt = 0;
    patchSync({
      last_remote_at: 0, last_synced_at: 0, last_check_at: 0, last_quota_at: 0,
      error: '', state: token() ? 'idle' : 'need-reconnect'
    });
  }

  /* 확인된 계정을 저장한다. 실제로 다른 이메일이면 원격 기준을 초기화한다. */
  function saveAccount(email, name) {
    email = String(email || '').trim();
    if (!email) return account();
    var prev = accountRec();
    var patch = { accountEmail: email, accountAt: Date.now() };
    if (name) patch.accountName = String(name || '').trim();
    saveLink(patch);
    var changed = !!prev.email && prev.email.toLowerCase() !== email.toLowerCase();
    if (changed) {
      resetRemoteBase();
      emit('account', { email: email, name: String(name || ''), previous: prev.email, changed: true });
    }
    return account();
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
            var acc0 = accountRec();
            emit('change', { connected: true, expires_at: tokenExpiry(), accountEmail: acc0.email, accountName: acc0.name });
            end({ ok: true, expires_at: tokenExpiry(), scope: String(resp.scope || '') });
          },
          error_callback: function (err) {
            end({ ok: false, error: String((err && err.type) || 'popup-error'), detail: String((err && err.message) || '') });
          }
        });
      } catch (e) {
        return end({ ok: false, error: 'client-init-failed', detail: String((e && e.message) || e) });
      }
      /* prompt: ''(조용한 갱신) · 'consent'(첫 연결) · 'select_account'(계정 변경) */
      var prompt = (opts.prompt !== undefined)
        ? String(opts.prompt)
        : (opts.silent || opts.switchAccount ? '' : 'consent');
      try {
        client.requestAccessToken({ prompt: prompt });
      } catch (e) {
        return end({ ok: false, error: 'popup-blocked' });
      }
      setTimeout(function () { end({ ok: false, error: 'timeout' }); }, 150000);
    });
  }

  /* 팝업은 클릭 순간에 열려야 차단되지 않는다.
     GIS 가 이미 준비되어 있으면 그 자리에서 바로 띄우고, 아니면 먼저 불러온 뒤 띄운다. */
  function connect(opts) {
    opts = opts || {};
    var flow = (opts.switchAccount && opts.prompt === undefined) ? { prompt: 'select_account', silent: false } : opts;
    if (gisReady()) return startFlow(flow);
    return loadGis().then(function () {
      return startFlow(flow);
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
      quotaCache = null;
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
    return gfetch(UPLOAD + '?uploadType=multipart&fields=' + encodeURIComponent('id,name,size,modifiedTime'), {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body
    }).then(function (d) { return d || {}; });
  }

  function updateFileContent(fileId, blob, mime) {
    return gfetch(UPLOAD + '/' + fileId + '?uploadType=media&fields=' + encodeURIComponent('id,name,size,modifiedTime'), {
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

  /* ---------------- 값 직렬화 (Blob · Date · Map · TypedArray 보존) ---------------- */
  function isBlob(v) { return typeof Blob !== 'undefined' && v instanceof Blob; }
  function isFileType(v) { return typeof File !== 'undefined' && v instanceof File; }
  function isBuffer(v) { return typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer; }
  function isView(v) {
    return typeof ArrayBuffer !== 'undefined' && !!ArrayBuffer.isView && ArrayBuffer.isView(v) && !isBuffer(v);
  }
  function ctorName(v) {
    try { return Object.prototype.toString.call(v).slice(8, -1); } catch (e) { return ''; }
  }
  function bytesB64(buf) {
    var bytes = new Uint8Array(buf || new ArrayBuffer(0)), out = '', chunk = 0x8000, i;
    for (i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }
  function b64Bytes(b64) {
    var bin = atob(String(b64 || '')), len = bin.length, arr = new Uint8Array(len), i;
    for (i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : '');
      };
      fr.onerror = function () { reject(gerr('read-failed')); };
      fr.readAsDataURL(blob);
    });
  }
  function smallHash(str) {
    var h = 5381, i;
    str = String(str || '');
    for (i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function extFor(mime, name) {
    var n = String(name || '');
    var dot = n.lastIndexOf('.');
    if (dot > 0 && n.length - dot <= 6) return n.slice(dot).toLowerCase();
    var m = String(mime || '').toLowerCase();
    if (m.indexOf('image/png') === 0) return '.png';
    if (m.indexOf('image/jpeg') === 0) return '.jpg';
    if (m.indexOf('image/webp') === 0) return '.webp';
    if (m.indexOf('image/gif') === 0) return '.gif';
    if (m.indexOf('image/svg') === 0) return '.svg';
    if (m.indexOf('audio/mpeg') === 0) return '.mp3';
    if (m.indexOf('audio/') === 0) return '.audio';
    if (m.indexOf('video/mp4') === 0) return '.mp4';
    if (m.indexOf('video/') === 0) return '.video';
    if (m.indexOf('application/pdf') === 0) return '.pdf';
    if (m.indexOf('application/json') === 0) return '.json';
    if (m.indexOf('text/') === 0) return '.txt';
    return '.bin';
  }
  function keySig(k) {
    if (k === null || k === undefined) return 'null';
    var t = typeof k;
    if (t === 'number') return 'n' + k;
    if (t === 'string') return 's' + k;
    if (t === 'boolean') return 'b' + k;
    if (t === 'object' && k instanceof Date) return 'd' + k.getTime();
    if (Array.isArray(k)) return 'a[' + k.map(keySig).join(',') + ']';
    try { return 'o' + JSON.stringify(k); } catch (e) { return 'o' + String(k); }
  }
  function childCtx(ctx, part) {
    return { db: ctx.db, store: ctx.store, key: ctx.key, path: ctx.path.concat([String(part)]), media: ctx.media };
  }
  function mediaId(ctx, size) {
    return ctx.db + '|' + ctx.store + '|' + keySig(ctx.key) + '|' + ctx.path.join('/') + '|' + size;
  }

  /* 값 하나를 JSON 안전한 형태로. 큰 바이너리는 ctx.media 에 쌓아 두고 참조만 남긴다. */
  function encVal(v, ctx) {
    var t = typeof v;
    if (v === undefined) return Promise.resolve({ __t: 'u' });
    if (v === null) return Promise.resolve(null);
    if (t === 'string' || t === 'boolean') return Promise.resolve(v);
    if (t === 'number') return Promise.resolve(isFinite(v) ? v : { __t: 'num', v: String(v) });
    if (t === 'bigint') return Promise.resolve({ __t: 'big', v: String(v) });
    if (t !== 'object') return Promise.resolve({ __t: 'u' });

    if (isBlob(v)) {
      var bsize = Number(v.size || 0);
      var bmime = String(v.type || '');
      var bfile = isFileType(v);
      var bname = bfile ? String(v.name || '') : '';
      var blm = bfile ? Number(v.lastModified || 0) : 0;
      var bid = mediaId(ctx, bsize);
      if (bsize > IDB_MEDIA_MAX) {
        ctx.media.push({ id: bid, blob: v, mime: bmime, name: bname, size: bsize });
        return Promise.resolve({ __t: 'm', id: bid, size: bsize, mime: bmime, name: bname, file: bfile ? 1 : 0, lm: blm });
      }
      return blobToB64(v).then(function (b64) {
        return { __t: 'b', b64: b64, mime: bmime, name: bname, file: bfile ? 1 : 0, lm: blm };
      });
    }
    if (isBuffer(v)) {
      var abId = mediaId(ctx, v.byteLength);
      if (v.byteLength > IDB_MEDIA_MAX) {
        ctx.media.push({ id: abId, blob: new Blob([v]), mime: 'application/octet-stream', name: '', size: v.byteLength });
        return Promise.resolve({ __t: 'm', id: abId, size: v.byteLength, mime: 'application/octet-stream', name: '' });
      }
      return Promise.resolve({ __t: 'ab', b64: bytesB64(v) });
    }
    if (isView(v)) {
      var exact = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
      var taId = mediaId(ctx, exact.length);
      var taName = ctorName(v) || 'Uint8Array';
      if (exact.length > IDB_MEDIA_MAX) {
        ctx.media.push({ id: taId, blob: new Blob([exact]), mime: 'application/octet-stream', name: '', size: exact.length });
        return Promise.resolve({ __t: 'm', id: taId, size: exact.length, mime: 'application/octet-stream', name: '', ta: taName });
      }
      return Promise.resolve({ __t: 'ta', c: taName, b64: bytesB64(exact.buffer) });
    }
    if (v instanceof Date) return Promise.resolve({ __t: 'd', v: v.getTime() });
    if (typeof RegExp !== 'undefined' && v instanceof RegExp) {
      return Promise.resolve({ __t: 're', v: String(v.source), f: String(v.flags || '') });
    }
    if (typeof Map !== 'undefined' && v instanceof Map) {
      var ments = [], mp = Promise.resolve();
      v.forEach(function (val, key) {
        mp = mp.then(function () {
          return Promise.all([encVal(key, childCtx(ctx, 'k')), encVal(val, childCtx(ctx, 'v'))])
            .then(function (pair) { ments.push(pair); });
        });
      });
      return mp.then(function () { return { __t: 'map', v: ments }; });
    }
    if (typeof Set !== 'undefined' && v instanceof Set) {
      var sents = [], sp = Promise.resolve();
      v.forEach(function (val) {
        sp = sp.then(function () { return encVal(val, childCtx(ctx, 'v')).then(function (e) { sents.push(e); }); });
      });
      return sp.then(function () { return { __t: 'set', v: sents }; });
    }
    if (typeof Error !== 'undefined' && v instanceof Error) {
      return Promise.resolve({ __t: 'err', name: String(v.name || ''), message: String(v.message || '') });
    }
    if (Array.isArray(v)) {
      var arr = [], ap = Promise.resolve();
      v.forEach(function (x, i) {
        ap = ap.then(function () { return encVal(x, childCtx(ctx, i)).then(function (e) { arr.push(e); }); });
      });
      return ap.then(function () { return arr; });
    }
    var keys = Object.keys(v), obj = {}, op = Promise.resolve();
    keys.forEach(function (k) {
      op = op.then(function () { return encVal(v[k], childCtx(ctx, k)).then(function (e) { obj[k] = e; }); });
    });
    return op.then(function () { return obj; });
  }

  function decVal(e, media, out) {
    if (e === null || e === undefined) return Promise.resolve(null);
    var t = typeof e;
    if (t === 'string' || t === 'number' || t === 'boolean') return Promise.resolve(e);
    if (t !== 'object') return Promise.resolve(null);
    var tag = e.__t;
    if (!tag) {
      if (Array.isArray(e)) {
        var arr = [], ap = Promise.resolve();
        e.forEach(function (x) { ap = ap.then(function () { return decVal(x, media, out).then(function (v) { arr.push(v); }); }); });
        return ap.then(function () { return arr; });
      }
      var keys = Object.keys(e), obj = {}, op = Promise.resolve();
      keys.forEach(function (k) {
        op = op.then(function () { return decVal(e[k], media, out).then(function (v) { obj[k] = v; }); });
      });
      return op.then(function () { return obj; });
    }
    if (tag === 'u') return Promise.resolve(undefined);
    if (tag === 'd') return Promise.resolve(new Date(Number(e.v) || 0));
    if (tag === 'num') return Promise.resolve(Number(e.v));
    if (tag === 'big') { try { return Promise.resolve(BigInt(e.v)); } catch (x) { return Promise.resolve(null); } }
    if (tag === 're') { try { return Promise.resolve(new RegExp(e.v, e.f || '')); } catch (x) { return Promise.resolve(null); } }
    if (tag === 'err') {
      var er = new Error(String(e.message || ''));
      er.name = String(e.name || 'Error');
      return Promise.resolve(er);
    }
    if (tag === 'b') {
      try {
        var blob = new Blob([b64Bytes(e.b64)], { type: e.mime || '' });
        if (e.file && typeof File === 'function') {
          return Promise.resolve(new File([blob], e.name || 'file', { type: e.mime || '', lastModified: Number(e.lm) || Date.now() }));
        }
        return Promise.resolve(blob);
      } catch (x) { return Promise.resolve(null); }
    }
    if (tag === 'ab') {
      try { return Promise.resolve(b64Bytes(e.b64).buffer); } catch (x) { return Promise.resolve(null); }
    }
    if (tag === 'ta') {
      try {
        var bytes = b64Bytes(e.b64 || '');
        var C = window[e.c];
        if (!C || !C.BYTES_PER_ELEMENT) return Promise.resolve(bytes);
        if (bytes.byteLength % C.BYTES_PER_ELEMENT) return Promise.resolve(bytes);
        return Promise.resolve(new C(bytes.buffer));
      } catch (x) { return Promise.resolve(null); }
    }
    if (tag === 'map') {
      var pairs = [], mp = Promise.resolve();
      (e.v || []).forEach(function (pair) {
        mp = mp.then(function () {
          return Promise.all([decVal(pair && pair[0], media, out), decVal(pair && pair[1], media, out)]);
        }).then(function (p) { pairs.push(p); });
      });
      return mp.then(function () { try { return new Map(pairs); } catch (x) { return null; } });
    }
    if (tag === 'set') {
      var items = [], sp = Promise.resolve();
      (e.v || []).forEach(function (x) {
        sp = sp.then(function () { return decVal(x, media, out).then(function (v) { items.push(v); }); });
      });
      return sp.then(function () { try { return new Set(items); } catch (x) { return null; } });
    }
    if (tag === 'm') {
      var rec = media && media[e.id];
      if (!rec || !rec.fileId) {
        if (out) out.missingMedia = (out.missingMedia || 0) + 1;
        return Promise.reject(gerr('media-missing'));
      }
      return downloadBlob(rec.fileId).then(function (blob) {
        var mime = rec.mime || e.mime || '';
        var b2 = new Blob([blob], { type: mime });
        var nm = rec.name || e.name || 'file';
        if (e.file && typeof File === 'function') {
          return new File([b2], nm, { type: mime, lastModified: Number(e.lm) || Date.now() });
        }
        return b2;
      }, function () {
        if (out) out.missingMedia = (out.missingMedia || 0) + 1;
        throw gerr('media-missing');
      });
    }
    return Promise.resolve(null);
  }

  function encKey(k) {
    if (k === null || k === undefined) return Promise.resolve({ t: 'null' });
    var t = typeof k;
    if (t === 'number') return Promise.resolve({ t: 'n', v: k });
    if (t === 'string') return Promise.resolve({ t: 's', v: k });
    if (t === 'boolean') return Promise.resolve({ t: 'b', v: k });
    if (t === 'object' && k instanceof Date) return Promise.resolve({ t: 'd', v: k.getTime() });
    if (Array.isArray(k)) {
      var arr = [], p = Promise.resolve();
      k.forEach(function (x) { p = p.then(function () { return encKey(x).then(function (e) { arr.push(e); }); }); });
      return p.then(function () { return { t: 'a', v: arr }; });
    }
    return Promise.resolve({ t: 'null' });
  }
  function decKey(e) {
    if (!e || typeof e !== 'object') return { ok: false, v: null };
    if (e.t === 'n') return { ok: true, v: Number(e.v) };
    if (e.t === 's') return { ok: true, v: String(e.v) };
    if (e.t === 'b') return { ok: true, v: !!e.v };
    if (e.t === 'd') return { ok: true, v: new Date(Number(e.v) || 0) };
    if (e.t === 'a') {
      var arr = [];
      (e.v || []).forEach(function (x) { var d = decKey(x); arr.push(d.ok ? d.v : null); });
      return { ok: true, v: arr };
    }
    return { ok: false, v: null };
  }

  /* ---------------- 서비스 IndexedDB 읽기 · 쓰기 ---------------- */
  /* 열기가 영영 끝나지 않는 경우(다른 탭의 삭제 요청이 대기 중인 등)에
     복원 전체가 멈추지 않도록 시간 제한을 둔다. */
  function within(p, ms, code) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (done) return; done = true; reject(gerr(code || 'idb-blocked')); }, ms || 8000);
      p.then(function (v) { if (done) return; done = true; clearTimeout(t); resolve(v); },
        function (e) { if (done) return; done = true; clearTimeout(t); reject(e); });
    });
  }

  function openRaw(name, version, upgradeFn) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(gerr('idb-unavailable')); return; }
      var rq;
      try { rq = version ? indexedDB.open(name, version) : indexedDB.open(name); } catch (e) { reject(gerr('idb-open-failed')); return; }
      var created = false;
      rq.onupgradeneeded = function () {
        created = true;
        if (upgradeFn) {
          try { upgradeFn(rq.result, rq.transaction); }
          catch (e) { try { rq.transaction.abort(); } catch (x) { } }
        }
      };
      rq.onsuccess = function () { resolve({ db: rq.result, created: created }); };
      rq.onerror = function () { reject(gerr('idb-open-failed')); };
      rq.onblocked = function () { reject(gerr('idb-blocked')); };
    });
  }

  /* 빈 DB 를 만들지 않고 존재 여부만 본다. */
  function probeExists(name) {
    return new Promise(function (resolve) {
      var rq, created = false, done = false;
      function fin(v) {
        if (done) return;
        done = true;
        resolve(v);
      }
      function cleanup() { try { indexedDB.deleteDatabase(name); } catch (e) { } }
      try { rq = indexedDB.open(name); } catch (e) { return fin(false); }
      rq.onupgradeneeded = function () {
        created = true;
        try { rq.transaction.abort(); } catch (e) { }
      };
      rq.onsuccess = function () {
        try { rq.result.close(); } catch (e) { }
        if (created) cleanup();
        fin(!created);
      };
      rq.onerror = function () {
        if (created) cleanup();
        fin(false);
      };
      setTimeout(function () { if (!done) { if (created) cleanup(); fin(false); } }, 4000);
    });
  }
  function dbExists(name) {
    if (!window.indexedDB) return Promise.resolve(false);
    if (indexedDB.databases) {
      return indexedDB.databases().then(function (list) {
        var hit = false;
        (list || []).forEach(function (d) { if (d && d.name === name) hit = true; });
        return hit;
      }, function () { return probeExists(name); });
    }
    return probeExists(name);
  }

  /* 백업할 DB 목록 — 고정 28종 + 같은 출처의 나머지(databases() 지원 시).
     없는 DB 는 열지 않는다(빈 DB 오염 방지). Flux Drive 는 따로 다룬다. */
  function listBackupDbs() {
    if (!window.indexedDB) return Promise.resolve([]);
    if (indexedDB.databases) {
      return indexedDB.databases().then(function (list) {
        var exist = {};
        (list || []).forEach(function (d) { if (d && d.name) exist[d.name] = 1; });
        var out = [];
        IDB_NAMES.forEach(function (n) {
          if (exist[n]) { out.push(n); delete exist[n]; }
        });
        Object.keys(exist).forEach(function (n) {
          if (n && n !== DRIVE_DB && out.indexOf(n) < 0) out.push(n);
        });
        return out;
      }, function () { return probeAllDbs(); });
    }
    return probeAllDbs();
  }
  function probeAllDbs() {
    var out = [], i = 0;
    function step() {
      if (i >= IDB_NAMES.length) return Promise.resolve(out);
      var n = IDB_NAMES[i++];
      return dbExists(n).then(function (yes) {
        if (yes) out.push(n);
        return step();
      });
    }
    return step();
  }

  function readSchema(db) {
    var names = [].slice.call(db.objectStoreNames);
    if (!names.length) return [];
    var tx, out = [];
    try { tx = db.transaction(names, 'readonly'); } catch (e) { return []; }
    names.forEach(function (n) {
      var st = tx.objectStore(n);
      var idx = [].slice.call(st.indexNames).map(function (i) {
        var x = st.index(i);
        return { name: i, keyPath: x.keyPath, unique: !!x.unique, multiEntry: !!x.multiEntry };
      });
      out.push({
        name: n,
        keyPath: st.keyPath === undefined ? null : st.keyPath,
        autoIncrement: !!st.autoIncrement,
        indexes: idx
      });
    });
    return out;
  }

  function readStore(db, storeName) {
    return new Promise(function (resolve, reject) {
      var rows = [], tx;
      try { tx = db.transaction(storeName, 'readonly'); } catch (e) { return reject(gerr('idb-read-failed')); }
      var rq = tx.objectStore(storeName).openCursor();
      rq.onsuccess = function () {
        var c = rq.result;
        if (!c) return;
        rows.push({ k: c.primaryKey, v: c.value });
        c.continue();
      };
      tx.oncomplete = function () { resolve(rows); };
      tx.onerror = function () { reject(gerr('idb-read-failed')); };
      tx.onabort = function () { reject(gerr('idb-read-failed')); };
    });
  }

  /* DB 하나를 읽어 스냅샷 조각으로 만든다. 값은 encVal 로 타입을 보존한다. */
  function readDbSnapshot(name) {
    return openRaw(name, 0, null).then(function (o) {
      var db = o.db;
      if (o.created) {
        /* 없는 DB 를 열어 버렸다 — 비어 있는 DB 를 남기지 않는다 */
        try { db.close(); } catch (e) { }
        try { indexedDB.deleteDatabase(name); } catch (e) { }
        return null;
      }
      var stores = readSchema(db);
      var rec = { name: name, version: Number(db.version) || 1, stores: stores, records: [], pending: [], count: 0, skipped: 0 };
      var chain = Promise.resolve();
      stores.forEach(function (st) {
        chain = chain.then(function () {
          return readStore(db, st.name).then(function (rows) {
            var s = Promise.resolve();
            rows.forEach(function (row) {
              s = s.then(function () {
                var ctx = { db: name, store: st.name, key: row.k, path: [], media: [] };
                return encVal(row.v, ctx).then(function (enc) {
                  return encKey(row.k).then(function (ek) {
                    rec.records.push({ s: st.name, k: ek, v: enc });
                    rec.pending = rec.pending.concat(ctx.media);
                    rec.count++;
                  });
                }, function () { rec.skipped++; });
              });
            });
            return s;
          }, function () { rec.skipped++; });
        });
      });
      return chain.then(function () {
        try { db.close(); } catch (e) { }
        return rec;
      }, function () {
        try { db.close(); } catch (e) { }
        return null;
      });
    }, function () { return null; });
  }

  /* 바이너리 하나를 Service Media/<dbName>/ 아래 Drive 파일로 올린다. */
  function uploadMedia(rootId, dbName, item, prevMedia, folderCache) {
    var prev = prevMedia[item.id];
    if (prev && prev.fileId && Number(prev.size) === Number(item.size)) {
      return Promise.resolve({ rec: prev, uploaded: false, bytes: 0 });
    }
    var fp = folderCache[dbName];
    if (!fp) {
      fp = ensureFolder(MEDIA_FOLDER_NAME, rootId).then(function (mediaRoot) {
        return ensureFolder(safeName(dbName), mediaRoot);
      });
      folderCache[dbName] = fp;
    }
    return fp.then(function (folderId) {
      var nm = safeName('media_' + smallHash(item.id) + extFor(item.mime, item.name));
      return createFile({
        name: nm,
        parents: [folderId],
        mimeType: item.mime || 'application/octet-stream'
      }, item.blob).then(function (d) {
        var rec = { id: item.id, fileId: (d && d.id) || '', name: nm, size: Number(item.size) || 0, mime: item.mime || '' };
        return { rec: rec, uploaded: true, bytes: rec.size };
      });
    });
  }

  /* 서비스 DB 전부를 백업한다. */
  function backupIdb(rootId, prevSnap, progress) {
    var out = { dbs: [], records: 0, skipped: 0, media: [], bytes: 0, uploaded: 0 };
    var prevMedia = {};
    ((prevSnap && Array.isArray(prevSnap.media)) ? prevSnap.media : []).forEach(function (m) {
      if (m && m.id) prevMedia[m.id] = m;
    });
    var folderCache = {}, names = [], i = 0;

    function uploadPending(dbName, pending) {
      var j = 0;
      function step() {
        if (j >= pending.length) return Promise.resolve(true);
        var item = pending[j++];
        progress('media', j - 1, pending.length, dbName);
        return uploadMedia(rootId, dbName, item, prevMedia, folderCache).then(function (r) {
          if (r && r.rec) {
            out.media.push(r.rec);
            if (r.uploaded) { out.uploaded++; out.bytes += r.bytes; }
          }
        }, function () { /* 파일 하나가 실패해도 나머지는 계속 */ }).then(function () {
          progress('media', j, pending.length, dbName);
          return step();
        });
      }
      return step();
    }

    function step() {
      if (i >= names.length) return Promise.resolve(true);
      var name = names[i];
      progress('idb', i, names.length, name);
      return readDbSnapshot(name).then(function (rec) {
        if (!rec || !rec.stores.length) return Promise.resolve(true);
        return uploadPending(name, rec.pending).then(function () {
          out.dbs.push({ name: rec.name, version: rec.version, stores: rec.stores, records: rec.records });
          out.records += rec.count;
          out.skipped += rec.skipped;
        });
      }, function () { }).then(function () {
        i++;
        progress('idb', i, names.length, name);
        return step();
      });
    }

    return listBackupDbs().then(function (list) {
      names = list || [];
      return step();
    }).then(function () {
      return out;
    });
  }

  function createStores(db, stores) {
    (stores || []).forEach(function (st) {
      if (!st || !st.name || db.objectStoreNames.contains(st.name)) return;
      var opt = { autoIncrement: !!st.autoIncrement };
      if (st.keyPath !== null && st.keyPath !== undefined) opt.keyPath = st.keyPath;
      var os;
      try { os = db.createObjectStore(st.name, opt); } catch (e) { return; }
      (st.indexes || []).forEach(function (ix) {
        if (!ix || !ix.name || ix.keyPath === null || ix.keyPath === undefined) return;
        try { os.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry }); } catch (e) { }
      });
    });
  }

  function readKeys(db, storeName) {
    return new Promise(function (resolve) {
      var tx, rq;
      try {
        tx = db.transaction(storeName, 'readonly');
        rq = tx.objectStore(storeName).getAllKeys();
      } catch (e) { return resolve([]); }
      rq.onsuccess = function () { resolve(rq.result || []); };
      rq.onerror = function () { resolve([]); };
    });
  }

  function putRows(db, st, vals, out) {
    return new Promise(function (resolve) {
      var tx;
      try { tx = db.transaction(st.name, 'readwrite'); } catch (e) { out.skippedRecords += vals.length; return resolve(); }
      var os = tx.objectStore(st.name);
      vals.forEach(function (x) {
        try {
          if (st.keyPath === null || st.keyPath === undefined) {
            if (x.row.__k && x.row.__k.ok) os.put(x.val, x.row.__k.v);
            else os.put(x.val);
          } else {
            os.put(x.val);
          }
          out.records++;
        } catch (e) { out.skippedRecords++; }
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
      tx.onabort = function () { resolve(); };
    });
  }

  function writeStoreRecords(db, st, rows, media, out) {
    return readKeys(db, st.name).then(function (have) {
      var haveMap = {};
      (have || []).forEach(function (k) { haveMap[keySig(k)] = 1; });
      var todo = [];
      rows.forEach(function (row) {
        if (!row || !row.s) return;
        var dk = decKey(row.k);
        row.__k = dk;
        if (dk.ok && haveMap[keySig(dk.v)]) {
          out.keptRecords = (out.keptRecords || 0) + 1;
          return;
        }
        todo.push(row);
      });
      if (!todo.length) return null;
      var chain = Promise.resolve(), vals = [];
      todo.forEach(function (row) {
        chain = chain.then(function () {
          return decVal(row.v, media, out).then(function (val) {
            vals.push({ row: row, val: val });
          }, function () { out.skippedRecords++; });
        });
      });
      return chain.then(function () { return within(putRows(db, st, vals, out), 8000, 'idb-blocked'); });
    });
  }

  /* DB 하나를 되살린다. 이 기기에 이미 있는 DB·스토어·키는 건드리지 않는다. */
  function restoreDb(rec, media, out) {
    return dbExists(rec.name).then(function (exists) {
      var ver = Math.max(1, Number(rec.version) || 1);
      if (exists && ver < Number(rec.version || 0)) {
        /* 이 기기의 DB 버전이 백업보다 높으면 그대로 쓴다 */
      }
      var opener = exists
        ? openRaw(rec.name, 0, null)
        : openRaw(rec.name, ver, function (db) { createStores(db, rec.stores); });
      return within(opener, 8000, 'idb-blocked').then(function (o) {
        var db = o.db;
        var names = [].slice.call(db.objectStoreNames);
        var chain = Promise.resolve();
        (rec.stores || []).forEach(function (st) {
          chain = chain.then(function () {
            if (!st || !st.name) return null;
            var rows = (rec.records || []).filter(function (r) { return r && r.s === st.name; });
            if (!rows.length) return null;
            if (names.indexOf(st.name) < 0) {
              /* 이 기기의 같은 DB 에 없는 스토어 — 버전을 올리지 않고는 만들 수 없다 */
              out.skippedRecords += rows.length;
              return null;
            }
            return writeStoreRecords(db, st, rows, media, out);
          });
        });
        return chain.then(function () {
          try { db.close(); } catch (e) { }
          if (!exists) out.dbs = (out.dbs || 0) + 1;
        }, function () {
          try { db.close(); } catch (e) { }
        });
      });
    });
  }

  function restoreIdb(snap, out, progress) {
    var dbs = (snap && snap.idb && Array.isArray(snap.idb.dbs)) ? snap.idb.dbs : [];
    var media = {};
    (Array.isArray(snap && snap.media) ? snap.media : []).forEach(function (m) {
      if (m && m.id) media[m.id] = m;
    });
    out.dbs = 0;
    out.records = 0;
    out.keptRecords = 0;
    out.skippedRecords = 0;
    out.missingMedia = 0;
    var i = 0;
    function step() {
      if (i >= dbs.length) return Promise.resolve(true);
      var rec = dbs[i++];
      if (!rec || !rec.name || !Array.isArray(rec.stores)) return step();
      progress('idb', i, dbs.length, rec.name);
      return restoreDb(rec, media, out).then(function () { return step(); }, function () { return step(); });
    }
    return step();
  }

  /* ---------------- 이 기기의 백업 대상 ---------------- */
  function keyList() {
    /* 백업 대상: lemon_* · flux_* + 프로젝트 키 6종 (내부·민감 키 제외) */
    var out = [], seen = {};
    function add(k) {
      k = String(k === null || k === undefined ? '' : k);
      if (!k || seen['#' + k] || SKIP[k]) return;
      if (!PREFIX.test(k) && !EXPLICIT_KEYS[k]) return;
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

    var result = {
      ok: false, keys: 0, nodes: 0, files: 0, uploaded: 0, bytes: 0, skippedKeys: [],
      dbs: 0, records: 0, media: 0, skippedRecords: 0
    };
    var rootId = '', driveId = '';
    var prevSnap = null, prev = null, keys = null, nodes = null, fdrive = null;

    return ensureRoots().then(function (ids) {
      rootId = ids.root;
      driveId = ids.drive;
      progress('snapshot', 0, 0, '이전 백업을 확인하는 중');
      return readRemoteSnapshot(rootId);
    }).then(function (pr) {
      prev = pr || {};
      prevSnap = (prev && prev.snap) || null;
      keys = collectKeys();
      progress('keys', 1, 1, Object.keys(keys.keys).length + '개 설정');
      return driveNodes();
    }).then(function (list) {
      nodes = list || [];
      return backupDriveFiles(driveId, prevSnap, nodes, progress);
    }).then(function (fd) {
      fdrive = fd || { files: [], uploaded: 0, bytes: 0 };
      progress('idb', 0, 0, '서비스 저장소를 확인하는 중');
      return backupIdb(rootId, prevSnap, progress);
    }).then(function (idb) {
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
          files: fdrive.files
        },
        idb: { dbs: (idb && idb.dbs) || [] },
        media: (idb && idb.media) || [],
        counts: {
          keys: Object.keys(keys.keys).length,
          nodes: (nodes || []).length,
          files: fdrive.files.length,
          dbs: ((idb && idb.dbs) || []).length,
          records: (idb && idb.records) || 0,
          media: ((idb && idb.media) || []).length
        }
      };
      var json = JSON.stringify(snap);
      var blob = new Blob([json], { type: 'application/json' });
      result.keys = Object.keys(keys.keys).length;
      result.nodes = (nodes || []).length;
      result.files = fdrive.files.length;
      result.uploaded = fdrive.uploaded;
      result.dbs = ((idb && idb.dbs) || []).length;
      result.records = (idb && idb.records) || 0;
      result.media = ((idb && idb.media) || []).length;
      result.skippedRecords = (idb && idb.skipped) || 0;
      result.bytes = fdrive.bytes + ((idb && idb.bytes) || 0) + blob.size;
      result.skippedKeys = keys.skipped;
      progress('snapshot', 0, 1, '설정 스냅샷을 올리는 중');
      return uploadContent({
        fileId: (prev && prev.fileId) || '',
        name: SNAP_NAME,
        parentId: rootId,
        blob: blob,
        mime: 'application/json'
      }).then(function (up) {
        progress('snapshot', 1, 1, '완료');
        return { snapBytes: blob.size, remoteAt: Date.parse((up && up.modifiedTime) || '') || 0 };
      });
    }).then(function (r) {
      busy = false;
      var rec = {
        ts: Date.now(), keys: result.keys, nodes: result.nodes, files: result.files,
        uploaded: result.uploaded, bytes: result.bytes, snapBytes: r.snapBytes,
        dbs: result.dbs, records: result.records, media: result.media,
        skippedKeys: result.skippedKeys
      };
      writeJSON(K_LAST, rec);
      /* 백업을 마쳤으면 이 시점의 원격과 같다고 기록한다 — 다음 접속 때 헛되이 복원하지 않는다. */
      var syncedAt = Date.now();
      quotaCache = null;                       /* 방금 올린 내용이 용량 카드에 바로 반영되게 */
      patchSync({
        last_backup_at: rec.ts, last_synced_at: syncedAt,
        last_remote_at: (r && r.remoteAt) || syncedAt, error: ''
      });
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

  /* Flux Drive 파일 내용을 모두 올린다. 바뀐 파일은 내용만 교체한다. */
  function backupDriveFiles(driveId, prevSnap, nodes, progress) {
    var prevMap = {};
    if (prevSnap && prevSnap.drive && Array.isArray(prevSnap.drive.files)) {
      prevSnap.drive.files.forEach(function (f) { if (f && f.nodeId) prevMap[f.nodeId] = f; });
    }
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
    return step();
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
    isRestoring = true;                 /* 복원 중 쓰기로 자동 백업이 돌지 않게 */
    progress('find', 0, 0, '백업을 찾는 중');
    var out = {
      ok: false, keys: 0, kept: 0, nodes: 0, files: 0, missing: 0, total: 0,
      dbs: 0, records: 0, keptRecords: 0, skippedRecords: 0, missingMedia: 0
    };

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
      }).then(function () {
        /* 서비스 IndexedDB 28종 — 이 기기에 없는 DB·스토어·키만 채운다 */
        progress('idb', 0, 0, '서비스 데이터를 복원하는 중');
        return restoreIdb(snap, out, progress);
      });
    }).then(function () {
      busy = false;
      isRestoring = false;
      var changed = (Number(out.keys) || 0) + (Number(out.nodes) || 0) +
        (Number(out.files) || 0) + (Number(out.records) || 0);
      var rec = {
        ts: Date.now(), keys: out.keys, kept: out.kept, nodes: out.nodes,
        files: out.files, missing: out.missing, total: out.total,
        dbs: out.dbs, records: out.records, keptRecords: out.keptRecords,
        skippedRecords: out.skippedRecords, missingMedia: out.missingMedia,
        changed: changed
      };
      writeJSON(K_LAST_RESTORE, rec);
      /* 복원을 마쳤으면 이 시점의 원격을 확인한 것으로 기록한다(다음 접속에 다시 받지 않는다) */
      quotaCache = null;
      patchSync({ last_restore_at: rec.ts, last_synced_at: Date.now(), last_remote_at: 0, error: '' });
      out.ok = true;
      out.ts = rec.ts;
      out.changed = changed;
      /* 실제로 이 기기의 데이터가 바뀌었을 때만 알린다 */
      if (changed > 0) emit('restored', rec);
      progress('done', 1, 1, '완료');
      return out;
    }, function (e) {
      busy = false;
      isRestoring = false;
      var code = (e && e.code) || 'restore-failed';
      emit('restore-error', { error: code });
      return { ok: false, error: code, detail: String((e && (e.detail || e.message)) || '') };
    });
  }

  /* ============================================================
     자동 동기화 — 설정·상태
     ============================================================ */
  var SYNC_DEF = {
    pull: true, push: true,
    last_check_at: 0,        /* 마지막으로 Drive 메타를 확인한 시각 */
    last_synced_at: 0,       /* 로컬과 Drive 가 같다고 본 시각 */
    last_remote_at: 0,       /* 그때 Drive 스냅샷의 modifiedTime */
    last_backup_at: 0, last_auto_at: 0, last_restore_at: 0,
    silent_at: 0,            /* 마지막 silent 토큰 갱신 시도 */
    state: 'idle', state_at: 0, error: ''
  };

  function syncRec() {
    var r = readJSON(K_SYNC, null), out = {};
    Object.keys(SYNC_DEF).forEach(function (k) {
      out[k] = (r && r[k] !== undefined && r[k] !== null) ? r[k] : SYNC_DEF[k];
    });
    return out;
  }
  function patchSync(patch) {
    var cur = syncRec();
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    if (patch && patch.state !== undefined) cur.state_at = Date.now();
    writeJSON(K_SYNC, cur);
    emit('sync', autoState());
    return cur;
  }

  /* 화면(lemon-site.js·auth.html)이 읽는 자동 동기화 상태 */
  function autoState() {
    var s = syncRec();
    var linked = isLinked();
    var connected = !!token();
    var enabled = !!(s.pull || s.push);
    var state = String(s.state || 'idle');
    if (!enabled) state = 'off';
    else if (!linked) state = 'off';
    else if (!connected && state !== 'syncing' && state !== 'restoring') state = 'need-reconnect';
    return {
      pull: !!s.pull, push: !!s.push, enabled: enabled,
      connected: connected, wasLinked: linked,
      state: state, error: s.error || '',
      lastCheckAt: Number(s.last_check_at) || 0,
      lastSyncedAt: Number(s.last_synced_at) || 0,
      lastRemoteAt: Number(s.last_remote_at) || 0,
      lastBackupAt: Number(s.last_backup_at) || 0,
      lastAutoAt: Number(s.last_auto_at) || 0,
      lastRestoreAt: Number(s.last_restore_at) || 0,
      stateAt: Number(s.state_at) || 0,
      autoBackups: autoBackups, autoRestores: autoRestores,
      busy: busy || isRestoring
    };
  }

  /* 사용자가 켜고 끄는 자동 동기화 (기본 ON)
     opts: { pull: 접속 시 자동 불러오기, push: 변경 시 자동 백업 } */
  function setAuto(opts) {
    opts = opts || {};
    var cur = syncRec();
    var pull = opts.pull === undefined ? !!cur.pull : !!opts.pull;
    var push = opts.push === undefined ? !!cur.push : !!opts.push;
    var linked = isLinked();
    var state = (!pull && !push) ? 'off' : (!linked ? 'off' : (token() ? 'idle' : 'need-reconnect'));
    patchSync({ pull: pull, push: push, state: state, error: '' });
    if (!push) { autoPending = false; }
    if (pull && token() && linked) setTimeout(function () { autoPull({ reason: 'enabled' }); }, 400);
    return autoState();
  }

  /* ---- 탭 간 동시 실행 방지 ---- */
  function lockHeld() {
    var cur = readJSON(K_LOCK, null);
    return !!(cur && cur.ts && (Date.now() - Number(cur.ts)) < LOCK_TTL);
  }
  function lockAcquire() {
    if (lockHeld()) return false;
    writeJSON(K_LOCK, { ts: Date.now(), id: Math.random().toString(36).slice(2, 10) });
    return true;
  }
  function lockRelease() { drop(K_LOCK); }
  try {
    window.addEventListener('pagehide', lockRelease);
    window.addEventListener('beforeunload', lockRelease);
  } catch (e) { }

  /* ---- 토큰: 있으면 그대로, 만료됐고 연동한 적이 있으면 silent 갱신 1회 ---- */
  function ensureToken(opts) {
    opts = opts || {};
    var t = token();
    if (t) return Promise.resolve({ ok: true, token: t });
    if (!isLinked()) return Promise.resolve({ ok: false, error: 'not-linked', state: 'off' });
    var s = syncRec();
    var now = Date.now();
    if (!opts.force && s.silent_at && now - Number(s.silent_at) < SILENT_GAP) {
      return Promise.resolve({ ok: false, error: 'need-reconnect', state: 'need-reconnect' });
    }
    patchSync({ silent_at: now });
    if (silentFlowP) return silentFlowP;
    silentFlowP = (gisReady() ? Promise.resolve() : loadGis()).then(function () {
      return startFlow({ silent: true });
    }, function () {
      return { ok: false, error: 'gis-load-failed' };
    }).then(function (r) {
      silentFlowP = null;
      if (r && r.ok && token()) return { ok: true, token: token() };
      patchSync({ state: 'need-reconnect', error: String((r && r.error) || 'silent-failed') });
      return { ok: false, error: (r && r.error) || 'silent-failed', state: 'need-reconnect' };
    }, function (e) {
      silentFlowP = null;
      patchSync({ state: 'need-reconnect', error: String((e && e.code) || 'silent-failed') });
      return { ok: false, error: (e && e.code) || 'silent-failed', state: 'need-reconnect' };
    });
    return silentFlowP;
  }

  /* ---- Drive 쪽 스냅샷 메타만 확인 (파일은 받지 않는다) ---- */
  function remoteHead() {
    var link = linkRec() || {};
    function headIn(rootId) {
      return findFile(SNAP_NAME, rootId).then(function (f) {
        if (!f || !f.id) return null;
        return {
          folderId: rootId, fileId: f.id,
          modifiedAt: Date.parse(f.modifiedTime || '') || 0,
          size: Number(f.size || 0)
        };
      }, function () { return null; });
    }
    if (link.folderId) {
      return gfetch(API + '/' + link.folderId + '?fields=' + encodeURIComponent('id,trashed'))
        .then(function (d) {
          if (d && d.id && !d.trashed) return headIn(link.folderId);
          return Promise.resolve('retry');
        }, function () { return 'retry'; })
        .then(function (r) {
          if (r !== 'retry') return r;
          return findFolder(FOLDER_NAME, null).then(function (f) {
            if (!f || !f.id) return null;
            saveLink({ folderId: f.id });
            return headIn(f.id);
          }, function () { return null; });
        });
    }
    return findFolder(FOLDER_NAME, null).then(function (f) {
      if (!f || !f.id) return null;
      saveLink({ folderId: f.id });
      return headIn(f.id);
    }, function () { return null; });
  }

  /* 이 기기에 백업 대상 데이터가 하나라도 있는가 */
  function hasLocalData() {
    if (keyList().length) return Promise.resolve(true);
    if (!window.indexedDB || !indexedDB.databases) return Promise.resolve(false);
    return indexedDB.databases().then(function (list) {
      return (list || []).some(function (d) {
        if (!d || !d.name) return false;
        return d.name === DRIVE_DB || IDB_NAMES.indexOf(d.name) >= 0;
      });
    }, function () { return false; });
  }

  /* 접속 시 자동 복원 — 최신이면 아무것도 받지 않는다. */
  function autoPull(opts) {
    opts = opts || {};
    var s = syncRec();
    var link = linkRec() || {};
    if (!isLinked()) return Promise.resolve({ ok: false, error: 'not-linked', state: 'off' });
    if (!s.pull && !opts.force) return Promise.resolve({ ok: false, error: 'auto-off', state: 'off' });
    if (isRestoring || busy) return Promise.resolve({ ok: false, error: 'busy' });
    if (pullP && !opts.force) return pullP;
    var now = Date.now();
    if (!opts.force && s.last_check_at && (now - Number(s.last_check_at)) < SYNC_COOLDOWN) {
      return Promise.resolve({ ok: true, skipped: 'cooldown', restored: false });
    }
    if (!lockAcquire()) return Promise.resolve({ ok: true, skipped: 'locked', restored: false });

    function done(res) { pullP = null; lockRelease(); return res; }

    pullP = ensureToken(opts).then(function (tok) {
      if (!tok.ok) {
        patchSync({ last_check_at: now, state: tok.state || 'need-reconnect', error: tok.error || '' });
        return { ok: false, error: tok.error || 'not-linked', state: tok.state || 'need-reconnect' };
      }
      patchSync({ last_check_at: now, state: 'syncing', error: '' });
      return remoteHead().then(function (head) {
        if (!head) {
          patchSync({ state: 'synced', last_check_at: now });
          return { ok: true, restored: false, reason: 'no-backup' };
        }
        return hasLocalData().then(function (local) {
          var remoteAt = Number(head.modifiedAt) || 0;
          var base = Number(s.last_remote_at) || Number(s.last_synced_at) || 0;   /* 마지막으로 본 원격 시각 */
          var newer = !base || (remoteAt && remoteAt > base + REMOTE_TOL);
          if (local && !newer) {
            patchSync({ state: 'synced', last_check_at: now, last_remote_at: remoteAt });
            return { ok: true, restored: false, reason: 'up-to-date', remoteAt: remoteAt };
          }
          return autoRestore(head);
        });
      });
    }).then(done, function (e) {
      var code = (e && e.code) || 'sync-failed';
      patchSync({ state: code === 'not-linked' ? 'need-reconnect' : 'error', error: code });
      return done({ ok: false, error: code });
    });
    return pullP;
  }

  function autoRestore(head) {
    var remoteAt = Number(head && head.modifiedAt) || 0;
    patchSync({ state: 'restoring' });
    autoRestores++;
    return restore({ auto: true }).then(function (r) {
      if (r && r.ok) {
        patchSync({
          state: 'synced', error: '', last_synced_at: Date.now(),
          last_remote_at: remoteAt || Date.now(), last_restore_at: Date.now()
        });
        return { ok: true, restored: !!r.changed, result: r };
      }
      var code = (r && r.error) || 'restore-failed';
      patchSync({ state: code === 'not-linked' ? 'need-reconnect' : (code === 'no-backup' ? 'synced' : 'error'), error: code });
      return { ok: false, error: code };
    });
  }

  /* ---- 변경 감지 → 자동 백업 ---- */
  function isBackupKey(k) {
    k = String(k === null || k === undefined ? '' : k);
    if (!k) return false;
    if (/^lemon_gdrive_/i.test(k)) return false;      /* 이 엔진의 상태·토큰 */
    if (/^lemon_ui_/i.test(k)) return false;          /* 화면 임시 상태 */
    if (SKIP[k]) return false;                         /* 테마·세션·민감 키 */
    return PREFIX.test(k) || EXPLICIT_KEYS[k] || /^cream_/i.test(k);
  }
  function isBackupDb(store) {
    try {
      var tx = store && store.transaction;
      var db = tx && tx.db;
      var name = db && db.name;
      if (!name) return false;
      return name === DRIVE_DB || IDB_NAMES.indexOf(name) >= 0;
    } catch (e) { return false; }
  }

  function scheduleAutoBackup(reason) {
    if (isRestoring) return;
    var s = syncRec();
    var link = linkRec() || {};
    if (!s.push) return;
    if (!isLinked()) return;                           /* 연결한 적이 없으면 조용히 넘어간다 */
    if (!token()) {
      if (String(s.state) !== 'need-reconnect') patchSync({ state: 'need-reconnect' });
      return;
    }
    if (autoRunning) { autoPending = true; return; }
    if (autoTimer) return;
    var wait = AUTO_DEBOUNCE;
    var since = Date.now() - (Number(s.last_auto_at) || 0);
    if (since < AUTO_MIN_GAP) wait = Math.max(wait, AUTO_MIN_GAP - since);
    autoTimer = setTimeout(function () {
      autoTimer = null;
      runAutoBackup(reason);
    }, wait);
  }

  function runAutoBackup(reason) {
    if (isRestoring) return Promise.resolve({ ok: false, error: 'restoring' });
    var s = syncRec();
    if (!s.push) return Promise.resolve({ ok: false, error: 'auto-off' });
    if (!token()) return Promise.resolve({ ok: false, error: 'not-linked' });
    if (busy) {                                          /* 수동 작업이 끝나면 한 번 더 */
      autoPending = true;
      if (!autoTimer) autoTimer = setTimeout(function () { autoTimer = null; runAutoBackup(reason); }, 3000);
      return Promise.resolve({ ok: false, error: 'busy' });
    }
    if (autoRunning) { autoPending = true; return Promise.resolve({ ok: false, error: 'busy' }); }
    autoRunning = true;
    patchSync({ state: 'syncing' });
    return backup({ auto: true }).then(function (r) {
      autoRunning = false;
      if (r && r.ok) {
        autoBackups++;
        var now = Date.now();
        patchSync({ state: 'synced', error: '', last_synced_at: now, last_remote_at: now, last_auto_at: now });
        emit('auto-backup', { ts: r.ts, bytes: r.bytes, reason: reason || '' });
      } else {
        var code = (r && r.error) || 'backup-failed';
        patchSync({ state: code === 'not-linked' ? 'need-reconnect' : (code === 'busy' ? 'idle' : 'error'), error: code });
      }
      if (autoPending) { autoPending = false; scheduleAutoBackup('queued'); }
      return r || { ok: false };
    }, function (e) {
      autoRunning = false;
      patchSync({ state: 'error', error: (e && e.code) || 'backup-failed' });
      if (autoPending) { autoPending = false; scheduleAutoBackup('queued'); }
      return { ok: false, error: (e && e.code) || 'backup-failed' };
    });
  }

  function notifyChange(reason) {
    if (isRestoring) return;                            /* 복원이 만든 쓰기는 무시 */
    if (busy) { autoPending = true; return; }
    scheduleAutoBackup(reason);
  }

  /* localStorage 후킹 — 이 엔진이 백업하지 않는 키는 건드리지 않는다. */
  function hookStorage() {
    try {
      var sp = window.Storage && Storage.prototype;
      if (!sp || sp.__lemonGdHooked) return;
      sp.__lemonGdHooked = true;
      var set0 = sp.setItem, rem0 = sp.removeItem, clr0 = sp.clear;
      sp.setItem = function (k, v) {
        var r = set0.apply(this, arguments);
        try { if (isBackupKey(k)) notifyChange('ls:set'); } catch (e) { }
        return r;
      };
      sp.removeItem = function (k) {
        var r = rem0.apply(this, arguments);
        try { if (isBackupKey(k)) notifyChange('ls:remove'); } catch (e) { }
        return r;
      };
      sp.clear = function () {
        var r = clr0.apply(this, arguments);
        try { notifyChange('ls:clear'); } catch (e) { }
        return r;
      };
    } catch (e) { }
  }

  /* IndexedDB 후킹 — Flux Drive 와 서비스 저장소에 쓰기가 생기면 알린다. */
  function hookIdb() {
    try {
      if (!window.IDBObjectStore || !IDBObjectStore.prototype) return;
      var proto = IDBObjectStore.prototype;
      if (proto.__lemonGdHooked) return;
      proto.__lemonGdHooked = true;
      ['put', 'add', 'delete', 'clear'].forEach(function (m) {
        var orig = proto[m];
        if (typeof orig !== 'function') return;
        proto[m] = function () {
          var r = orig.apply(this, arguments);
          try { if (isBackupDb(this)) notifyChange('idb:' + m); } catch (e) { }
          return r;
        };
      });
    } catch (e) { }
  }

  /* ============================================================
     Drive 저장 용량 — 전체 드라이브 + Soft Hub 백업 사용량
     ============================================================ */
  var quotaCache = null;

  function aboutStorage() {
    var url = 'https://www.googleapis.com/drive/v3/about?fields=' + encodeURIComponent('storageQuota,user');
    return gfetch(url).then(function (d) {
      /* about 이 user 를 돌려주면 그 자리에서 연결 계정을 확인해 둔다. */
      var u = (d && d.user) || null;
      var acc = account();
      if (u && u.emailAddress) acc = saveAccount(u.emailAddress, u.displayName);
      var user = u && u.emailAddress
        ? { email: String(u.emailAddress), name: String(u.displayName || '') }
        : null;
      var q = (d && d.storageQuota) || null;
      if (!q) return { ok: false, error: 'no-quota', user: user, account: acc };
      return {
        ok: true,
        limit: Number(q.limit || 0),
        usage: Number(q.usage || 0),
        usageInDrive: Number(q.usageInDrive || 0),
        usageInDriveTrash: Number(q.usageInDriveTrash || 0),
        user: user,
        account: acc
      };
    }, function (e) {
      /* drive.file 범위 정책상 about.get 이 403 이어도 화면은 그대로 쓴다 */
      return { ok: false, error: (e && e.code) || 'about-failed', status: Number((e && e.status) || 0), user: null };
    });
  }

  /* about 이 막혔을 때의 보조 확인 — 앱이 만든 폴더의 소유자 정보.
     이 길도 막혀 있으면 조용히 알 수 없는 상태로 남긴다. */
  var acctTryAt = 0;
  function ownerAccount() {
    if (!token()) return Promise.resolve(account());
    var now = Date.now();
    if (now - acctTryAt < 60000) return Promise.resolve(account());
    acctTryAt = now;
    var link = linkRec() || {};
    var idP = link.folderId
      ? Promise.resolve(link.folderId)
      : findFolder(FOLDER_NAME, null).then(function (f) { return (f && f.id) || ''; }, function () { return ''; });
    return idP.then(function (fid) {
      if (!fid) return account();
      return gfetch(API + '/' + fid + '?fields=' + encodeURIComponent('owners(emailAddress,displayName)'))
        .then(function (d) {
          var o = (d && d.owners && d.owners[0]) || null;
          if (o && o.emailAddress) return saveAccount(o.emailAddress, o.displayName);
          return account();
        }, function () { return account(); });
    });
  }

  /* 연결 계정을 확인한다 — 이미 알고 있으면 그대로 돌려준다(60초에 한 번만 확인). */
  var accountProbeP = null, probeAt = 0;
  function probeAccount(opts) {
    opts = opts || {};
    if (!token()) return Promise.resolve(account());
    var cur = account();
    if (cur.email && !opts.force && (Date.now() - cur.at) < 60000) return Promise.resolve(cur);
    if (!opts.force && probeAt && (Date.now() - probeAt) < 20000) return Promise.resolve(cur);
    if (accountProbeP) return accountProbeP;
    probeAt = Date.now();
    accountProbeP = aboutStorage().then(function (a) {
      if (a && a.user && a.user.email) return account();
      return ownerAccount();
    }, function () { return account(); }).then(function (acc) {
      accountProbeP = null;
      return acc;
    }, function () { accountProbeP = null; return account(); });
    return accountProbeP;
  }

  /* 계정 변경 — 기존 토큰을 비우고 Google 계정 선택 창을 띄운다.
     취소하면 이전 계정으로 조용히 되살린다. */
  var switchP = null;
  function switchAccount() {
    if (switchP) return switchP;
    if (busy || isRestoring) return Promise.resolve({ ok: false, error: 'busy' });
    var prev = account();
    var hadToken = !!token();
    dropToken();
    quotaCache = null;
    patchSync({ state: 'need-reconnect', error: '' });
    emit('change', { connected: false, reason: 'switch-account', accountEmail: prev.email });

    switchP = connect({ switchAccount: true }).then(function (r) {
      if (!r || !r.ok) {
        return reconnectPrevious(hadToken, prev).then(function (back) {
          switchP = null;
          var now = account();
          if (back && now.email) emit('change', { connected: !!token(), accountEmail: now.email, accountName: now.name });
          return {
            ok: false, error: String((r && r.error) || 'switch-failed'),
            restored: !!back, accountKnown: !!now.known,
            accountEmail: now.email, previousEmail: prev.email
          };
        });
      }
      return probeAccount({ force: true }).then(function () {
        var acc = account();
        /* 방금 확인된 계정만 믿는다 — 확인이 안 됐다면 이전 계정 정보가 남아 있다. */
        var confirmed = !!(acc.email && acc.at && (Date.now() - acc.at) < 30000);
        var same = !!(confirmed && prev.email && prev.email.toLowerCase() === acc.email.toLowerCase());
        if (!same) {
          if (!confirmed) {
            saveLink({ accountEmail: '', accountName: '', accountAt: Date.now() });
            acc = account();
          }
          /* 이전 계정(또는 확인할 수 없는 계정)의 폴더·동기화 기준을 버리고 새로 시작한다. */
          resetRemoteBase();
        }
        var changed = !!(confirmed && prev.email && prev.email.toLowerCase() !== acc.email.toLowerCase());
        quotaCache = null;
        switchP = null;
        patchSync({ state: token() ? 'idle' : 'need-reconnect', error: '' });
        emit('change', {
          connected: !!token(), switched: true, accountChanged: changed,
          accountEmail: acc.email, accountName: acc.name
        });
        return {
          ok: true, accountChanged: changed, accountKnown: !!acc.email,
          accountEmail: acc.email, accountName: acc.name, previousEmail: prev.email
        };
      });
    }, function (e) {
      return reconnectPrevious(hadToken, prev).then(function (back) {
        switchP = null;
        return { ok: false, error: String((e && (e.code || e.message)) || 'switch-failed'), restored: !!back };
      });
    });
    return switchP;
  }

  /* 계정 선택을 그만둬도 이전 계정의 연결을 잃지 않게 조용히 되살린다. */
  function reconnectPrevious(hadToken, prev) {
    if (token()) return Promise.resolve(true);
    var flow = (gisReady() ? Promise.resolve() : loadGis()).then(function () {
      return startFlow({ silent: true });
    }, function () {
      return { ok: false, error: 'gis-load-failed' };
    });
    return flow.then(function (r) {
      var ok = !!(r && r.ok && token());
      if (ok) {
        if (prev && prev.email) saveLink({ accountEmail: prev.email, accountName: prev.name || '', accountAt: prev.at || Date.now() });
        patchSync({ state: 'idle', error: '' });
      } else if (!hadToken) {
        patchSync({ state: isLinked() ? 'need-reconnect' : 'off', error: 'need-reconnect' });
      } else {
        patchSync({ state: 'need-reconnect', error: 'need-reconnect' });
      }
      return ok;
    }, function () { return false; });
  }

  function listChildrenAll(parentId, pageToken) {
    var q = "'" + String(parentId) + "' in parents and trashed=false";
    var u = API + '?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('nextPageToken,files(id,name,size,mimeType,modifiedTime)') +
      '&pageSize=1000&spaces=drive' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    return gfetch(u).then(function (d) {
      var files = (d && d.files) || [];
      var next = d && d.nextPageToken;
      if (!next) return files;
      return listChildrenAll(parentId, next).then(function (more) { return files.concat(more); });
    });
  }

  function folderUsage(folderId, depth, acc) {
    if (!folderId || depth > 5 || acc.folders > 400) return Promise.resolve(acc);
    return listChildrenAll(folderId).then(function (files) {
      var chain = Promise.resolve();
      (files || []).forEach(function (f) {
        if (!f) return;
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          acc.folders++;
          chain = chain.then(function () { return folderUsage(f.id, depth + 1, acc); });
        } else {
          acc.files++;
          acc.bytes += Number(f.size || 0);
        }
      });
      return chain;
    }, function () { acc.errors = (acc.errors || 0) + 1; }).then(function () { return acc; });
  }

  /* opts.force = true 면 캐시를 버리고 다시 센다 */
  function quota(opts) {
    opts = opts || {};
    if (!token()) return Promise.resolve({ ok: false, error: 'not-linked', account: account() });
    var now = Date.now();
    if (!opts.force && quotaCache && (now - quotaCache.at) < 60000) return Promise.resolve(quotaCache);
    var rootUsed = '';
    return aboutStorage().then(function (about) {
      var link = linkRec() || {};
      var rootP = link.folderId
        ? gfetch(API + '/' + link.folderId + '?fields=' + encodeURIComponent('id,trashed'))
          .then(function (d) { return (d && d.id && !d.trashed) ? link.folderId : ''; }, function () { return ''; })
        : Promise.resolve('');
      return rootP.then(function (rootId) {
        if (rootId) return rootId;
        return findFolder(FOLDER_NAME, null).then(function (f) { return (f && f.id) || ''; }, function () { return ''; });
      }).then(function (rootId) {
        rootUsed = rootId || '';
        if (rootId && !(linkRec() || {}).folderId) saveLink({ folderId: rootId });
        var acc = { bytes: 0, files: 0, folders: 0, errors: 0 };
        if (!rootId) return acc;
        return folderUsage(rootId, 0, acc);
      }).then(function (acc) {
        var out = {
          ok: true, at: Date.now(),
          account: account(),
          drive: about && about.ok ? {
            available: true,
            limit: about.limit, usage: about.usage,
            usageInDrive: about.usageInDrive, usageInDriveTrash: about.usageInDriveTrash,
            percent: about.limit ? Math.min(100, (about.usage / about.limit) * 100) : 0
          } : { available: false, error: (about && about.error) || 'about-failed' },
          backup: {
            bytes: acc.bytes, files: acc.files, folders: acc.folders,
            errors: acc.errors || 0, folderId: rootUsed
          }
        };
        quotaCache = out;
        patchSync({ last_quota_at: out.at });
        emit('quota', out);
        if (!out.account.email) {
          /* about.get 이 권한 범위 밖이면 폴더 소유자로 한 번 더 확인한다 (60초 1회) */
          ownerAccount().then(function (acc2) {
            if (acc2 && acc2.email && quotaCache) {
              quotaCache.account = acc2;
              emit('quota', quotaCache);
            }
          }, function () { });
        }
        return out;
      });
    });
  }

  /* ---------------- 사람에게 보여줄 문구 ---------------- */
  function message(code) {
    var c = String(code || '');
    if (c === 'not-linked') return 'Google Drive 연결이 필요합니다. [Google Drive 연결]을 눌러 주세요.';
    if (c === 'timeout') return 'Google 창에서 응답이 없어 연결을 마치지 못했습니다. 다시 시도해 주세요.';
    if (c === 'popup_closed' || c === 'popup_closed_by_user') {
      return '연결 창이 닫혔습니다. 다시 시도해 주세요. (Google 창에 "승인되지 않은 원본" 안내가 보이면 관리자 설정 — 승인된 JavaScript 원본 — 에 사이트 주소를 등록해야 합니다.)';
    }
    if (c === 'popup-blocked' || c === 'popup_failed_to_open') return '브라우저가 연결 창을 막았습니다. 팝업을 허용한 뒤 다시 시도해 주세요.';
    if (c === 'access_denied') return 'Google Drive 연결을 취소했습니다.';
    if (c === 'need-reconnect') return 'Google Drive 연결이 만료되었습니다. [Google Drive 연결]을 눌러 다시 연결해 주세요.';
    if (c === 'switch-failed') return '계정을 바꾸지 못했습니다. 다시 시도해 주세요.';
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
    if (c === 'media-missing') return '큰 파일 일부를 내려받지 못했습니다. 백업을 다시 올린 뒤 복원해 주세요.';
    if (c === 'folder-create-failed') return 'Google Drive에 백업 폴더를 만들지 못했습니다. 다시 시도해 주세요.';
    if (c === 'read-failed') return '기기에 있는 파일을 읽지 못해 백업을 마치지 못했습니다.';
    return '작업을 마치지 못했습니다' + (c ? ' (' + c + ')' : '') + '.';
  }

  function status() {
    var link = linkRec() || {};
    var acc = account();
    return {
      configured: !!CLIENT_ID,
      connected: !!token(),
      expires_at: tokenExpiry(),
      wasLinked: isLinked(),
      folder: FOLDER_NAME,
      folderId: link.folderId || '',
      accountEmail: acc.email,
      accountName: acc.name,
      accountKnown: acc.known,
      accountAt: acc.at,
      account: acc,
      last: readJSON(K_LAST, null),
      lastRestore: readJSON(K_LAST_RESTORE, null),
      keyCount: Object.keys(EXPLICIT_KEYS).length,
      idbCount: IDB_NAMES.length,
      schema: SCHEMA,
      busy: busy,
      restoring: isRestoring,
      auto: autoState()
    };
  }

  window.LemonGDrive = {
    __v: 2,
    clientId: function () { return CLIENT_ID; },
    scope: function () { return SCOPE; },
    folderName: function () { return FOLDER_NAME; },
    explicitKeys: function () { return Object.keys(EXPLICIT_KEYS); },
    idbNames: function () { return IDB_NAMES.slice(); },
    dbList: function () { return listBackupDbs(); },
    status: status,
    connected: function () { return !!token(); },
    connect: connect,
    switchAccount: switchAccount,
    account: account,
    refreshAccount: function (o) { return probeAccount(o); },
    prewarm: prewarm,
    disconnect: disconnect,
    backup: backup,
    restore: restore,
    quota: quota,
    getQuota: quota,
    autoState: autoState,
    setAuto: setAuto,
    autoPull: function (o) { return autoPull(o); },
    syncNow: function () { return autoPull({ force: true, reason: 'manual' }); },
    autoBackup: function () { return runAutoBackup('manual'); },
    message: message,
    fmtBytes: fmtBytes,
    lastBackup: function () { return readJSON(K_LAST, null); },
    lastRestore: function () { return readJSON(K_LAST_RESTORE, null); },
    syncRecord: function () { return syncRec(); }
  };

  /* ============================================================
     자동 동기화 시작 — 화면을 그린 뒤 조용히
     ============================================================ */
  function bootAuto() {
    hookStorage();
    hookIdb();
    try {
      window.addEventListener('online', function () { autoPull({ reason: 'online' }); });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) autoPull({ reason: 'visible' });
      });
    } catch (e) { }
    if (!isLinked()) return;
    setTimeout(function () { autoPull({ reason: 'boot' }); }, 700);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bootAuto);
  else bootAuto();
})();
