/* ============================================================
   Lemon soft · Cloud engine  (lemon-cloud.js)
   ------------------------------------------------------------
   Supabase 를 쓰기 위한 의존성 없는 경량 REST/Auth 래퍼.

   · 설정(Project URL · anon key)이 없으면 아무 오류 없이 로컬 모드로 동작한다.
       - 로컬 모드: 로그인 UI 는 "클라우드 미연결" 안내, 공유 링크는 이 기기의
         localStorage 로, 동기화는 사용 안 함.
   · 설정이 있으면
       1) 공용 로그인/회원가입/로그아웃 (이메일·비밀번호 + Google OAuth)
       2) 클라우드 동기화 — 로그인 사용자의 lemon_* / flux_* 데이터와
          Flux Drive(IndexedDB 'flux_drive_v1') 폴더·파일을 user_sync_data 에
          백업하고 복원한다. 1인당 5MB 한도 · 변경이 없으면 전송 생략 ·
          비밀번호 금고(lemon_pass_vault)와 AI 키(flux_notebook_gemini_key)는 제외.
       3) 짧은 공유 링크 — shared_pages 테이블 + view.html?id=짧은코드
       4) 원격 설정/광고 — site_config / site_ads 를 읽어 전 방문자에게 반영

   설정 우선순위
     window.LEMON_CLOUD_CONFIG  (lemon-cloud-config.js 로 배포)
     > localStorage['lemon_cloud_cfg']  (관리자 콘솔에서 저장)
   스키마는 supabase_schema.sql 한 번 실행으로 끝난다.
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonCloud && window.LemonCloud.__v) return;

  var doc = document;

  var K_CFG = 'lemon_cloud_cfg';
  var K_SESSION = 'lemon_cloud_session';
  var K_LOCAL_SHARES = 'lemon_shares_v1';
  var K_LAST_SYNC = 'lemon_cloud_last_sync';
  var K_USAGE = 'lemon_cloud_usage_v1';   /* 소스별 마지막 업로드 해시·용량(이 기기 기준 장부) */
  var K_PULLED = 'lemon_cloud_pulled_v1'; /* 새 기기에서 클라우드 데이터를 한 번 받아왔는지 */
  var K_SYNC_OFF = 'lemon_cloud_sync_off'; /* '1' 이면 클라우드 저장을 끈 상태 */

  /* 동기화에서 제외하는 내부 키 */
  var SYNC_SKIP = {
    lemon_cloud_cfg: 1, lemon_cloud_session: 1, lemon_cloud_last_sync: 1,
    lemon_cloud_usage_v1: 1, lemon_cloud_pulled_v1: 1, lemon_cloud_sync_off: 1,
    lemon_admin_auth: 1, lemon_site_config_v1: 1, lemon_site_ads_v1: 1,
    lemon_site_remote_cfg_v1: 1, lemon_site_remote_ads_v1: 1,
    lemon_notice_ack_v1: 1, lemon_home_ack_v1: 1, lemon_cp_recent: 1,
    lemon_shares_v1: 1, cream_theme: 1, lemon_anim_mode: 1,
    /* 민감 정보 — 절대 클라우드로 올리지 않는다 (이 기기에만) */
    lemon_pass_vault: 1, flux_notebook_gemini_key: 1
  };
  var SYNC_PREFIX = /^(lemon_|flux_)/i;
  var SYNC_MAX_KEY = 240 * 1024;

  /* ---- 1인당 클라우드 저장 한도 ---- */
  var QUOTA_MB = 5;                       /* 기본 5MB (설정의 quotaMB 로 바꿀 수 있다) */
  var DRIVE_PREFIX = 'drv:';              /* 드라이브 백업 행 접두사 */

  /* ---- Flux Drive (IndexedDB) ---- */
  var DRIVE_DB = 'flux_drive_v1';
  var DRIVE_VER = 1;
  var DRIVE_FILE_MAX = 1024 * 1024;       /* 파일 하나의 내용은 1MB 까지만 올린다 */

  /* ---- 자동 백업 주기 ---- */
  var DEBOUNCE_MS = 10 * 1000;            /* 데이터가 바뀌면 10초 뒤 백업 */
  var PUSH_INTERVAL = 60 * 1000;          /* 60초마다 변경 점검(바뀐 것이 없으면 전송 생략) */
  var PULL_INTERVAL = 10 * 60 * 1000;     /* 10분마다 다른 기기의 변경 확인(키 목록만 먼저 조회) */

  /* ---------------- 상태 ---------------- */
  var cfg = null;
  var session = null;
  var initP = null;
  var remoteReady = false;

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

  /* ---------------- 바이트 · 해시 · 용량 ---------------- */
  function utf8Bytes(str) {
    str = String(str === null || str === undefined ? '' : str);
    try { if (window.TextEncoder) return new TextEncoder().encode(str).length; } catch (e) { }
    try { return unescape(encodeURIComponent(str)).length; } catch (e) { }
    return str.length;
  }
  function jsonBytes(v) {
    var s = '';
    try { s = JSON.stringify(v); } catch (e) { s = ''; }
    return utf8Bytes(s);
  }
  /* 내용이 같은지 싸게 비교하기 위한 64bit 풍 해시(문자열 전용) */
  function hashStr(str) {
    var a = 0x811c9dc5, b = 0x1505c3b1, i, c;
    str = String(str || '');
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619) >>> 0;
      b = Math.imul(b + c, 2654435761) >>> 0;
    }
    return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
  }
  function quotaMB() {
    var mb = 0;
    try { if (cfg && cfg.quotaMB) mb = Number(cfg.quotaMB); } catch (e) { }
    if (!(mb > 0)) mb = QUOTA_MB;
    return mb;
  }
  function quotaBytes() { return Math.round(quotaMB() * 1024 * 1024); }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function mbText(n) { return (Number(n) / (1024 * 1024)).toFixed(1) + ' MB'; }

  /* 이 기기에서 올린 소스별 용량 장부. 다음 업로드의 한도 계산에 쓴다. */
  function usageBook() {
    var b = readJSON(K_USAGE, null);
    return b && typeof b === 'object' ? b : {};
  }
  function setUsage(source, rec) {
    var b = usageBook();
    b[source] = rec;
    writeJSON(K_USAGE, b);
  }
  function bookBytes(except) {
    var b = usageBook(), t = 0;
    Object.keys(b).forEach(function (k) {
      if (k === except) return;
      t += Number((b[k] && b[k].bytes) || 0);
    });
    return t;
  }

  function normUrl(u) {
    var s = String(u || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }
  function isConfigured(c) { return !!(c && normUrl(c.url) && String(c.anonKey || '').trim()); }
  /* init() 전에 동기화 함수가 먼저 불려도 설정을 스스로 읽는다. */
  function cfgReady() { if (!cfg) cfg = loadConfig(); return isConfigured(cfg); }

  function loadConfig() {
    /* 이 브라우저에서 직접 저장한 설정이 있으면 그것을 먼저 쓰고,
       없으면 배포된 공용 설정(lemon-cloud-config.js)을 쓴다. */
    var local = readJSON(K_CFG, null);
    if (isConfigured(local)) return { url: normUrl(local.url), anonKey: String(local.anonKey).trim(), quotaMB: local.quotaMB };
    var c = window.LEMON_CLOUD_CONFIG;
    if (isConfigured(c)) return { url: normUrl(c.url), anonKey: String(c.anonKey).trim(), quotaMB: c.quotaMB };
    return { url: '', anonKey: '' };
  }

  function ensureConfigFile() {
    /* 배포된 공용 설정 파일(lemon-cloud-config.js)을 한 번 읽어본다.
       파일이 없거나 비어 있으면 조용히 넘어간다. */
    if (window.LEMON_CLOUD_CONFIG) return Promise.resolve();
    return new Promise(function (resolve) {
      var base = scriptBase();
      var s = doc.createElement('script');
      s.src = base + 'lemon-cloud-config.js';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { resolve(); };
      (doc.head || doc.documentElement).appendChild(s);
      setTimeout(resolve, 1800);
    });
  }

  function scriptBase() {
    try {
      var cs = doc.currentScript;
      if (!cs || !cs.src) {
        var list = doc.querySelectorAll('script[src$="lemon-cloud.js"]');
        cs = list[list.length - 1];
      }
      return String(cs && cs.src || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    } catch (e) { return ''; }
  }

  /* ---------------- 세션 ---------------- */
  function saveSession(s) { session = s; writeJSON(K_SESSION, s); }
  function loadSession() {
    var s = readJSON(K_SESSION, null);
    session = s && s.access_token ? s : null;
    return session;
  }
  function clearSession() { session = null; drop(K_SESSION); emit('signed-out'); }

  /* 다른 탭(auth.html 등)에서 로그인/로그아웃하면 이 탭의 메모리 세션은 낡는다.
     저장된 세션과 메모리 세션이 다르면 다시 읽어 맞춘다. */
  function loadSessionIfChanged() {
    var cur = session && session.access_token;
    var raw = readJSON(K_SESSION, null);
    var tok = raw && raw.access_token;
    if (tok && tok !== cur) { session = raw; }
    return session;
  }
  function reloadSession() {
    var prev = session && session.access_token;
    loadSession();
    var now = session && session.access_token;
    if (prev === now) return session;
    if (now) {
      emit('signed-in', sessionUser());
      if (syncEnabled()) {
        enableAutoSync();
        setTimeout(function () { autoSync(); }, 300);
      }
    } else {
      stopAutoSync();
      emit('signed-out');
    }
    return session;
  }
  function watchSession() {
    try {
      window.addEventListener('storage', function (e) {
        if (!e || e.key === K_SESSION || e.key === null) reloadSession();
      });
    } catch (e) { }
    try {
      window.addEventListener('focus', function () { reloadSession(); });
      doc.addEventListener('visibilitychange', function () {
        if (!hidden()) reloadSession();
      });
    } catch (e) { }
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent('lemoncloud:' + name, { detail: detail || {} })); } catch (e) { }
  }

  /* ---------------- 클라우드 저장 켜기/끄기 ---------------- */
  function syncEnabled() {
    try { return localStorage.getItem(K_SYNC_OFF) !== '1'; } catch (e) { return true; }
  }
  function setSyncEnabled(on) {
    on = !!on;
    try {
      if (on) localStorage.removeItem(K_SYNC_OFF);
      else localStorage.setItem(K_SYNC_OFF, '1');
    } catch (e) { }
    emit('syncmode', { enabled: on });
    if (!on) {
      stopAutoSync();
    } else if (session) {
      enableAutoSync();
      autoSync();
    }
    return on;
  }
  function syncOffResult(source) {
    return Promise.resolve({ ok: false, error: 'sync-off', source: source || 'local' });
  }

  function sessionUser() {
    if (!session) return null;
    return session.user || null;
  }

  function tokenExpired() {
    if (!session) return true;
    if (!session.expires_at) return false;
    return Date.now() > (session.expires_at - 60000);
  }

  /* ---------------- HTTP ---------------- */
  function headers(extra) {
    var h = { apikey: cfg.anonKey, 'Content-Type': 'application/json' };
    var tok = session && session.access_token;
    h.Authorization = 'Bearer ' + (tok || cfg.anonKey);
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function request(path, opts) {
    opts = opts || {};
    if (!cfgReady()) {
      return Promise.reject(new Error('cloud-not-configured'));
    }
    var url = cfg.url + path;
    var init = {
      method: opts.method || 'GET',
      headers: headers(opts.headers || {}),
      cache: 'no-store'
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(url, init).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!r.ok) {
          var err = new Error((data && (data.message || data.error_description || data.msg || data.hint)) || ('HTTP ' + r.status));
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function refreshToken() {
    if (!session || !session.refresh_token) return Promise.reject(new Error('no-refresh-token'));
    return request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: session.refresh_token }
    }).then(function (d) {
      var u = session.user;
      saveSession({
        access_token: d.access_token,
        refresh_token: d.refresh_token || session.refresh_token,
        expires_at: d.expires_in ? Date.now() + d.expires_in * 1000 : 0,
        user: d.user || u
      });
      return session;
    });
  }

  function ensureToken() {
    if (!session) return Promise.resolve(null);
    if (!tokenExpired()) return Promise.resolve(session);
    return refreshToken().catch(function () { clearSession(); return null; });
  }

  function rest(path, opts) {
    loadSessionIfChanged();
    return ensureToken().then(function () { return request(path, opts); });
  }

  /* ---------------- 인증 ---------------- */
  function storeAuth(d) {
    var u = d.user || null;
    saveSession({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_in ? Date.now() + d.expires_in * 1000 : 0,
      user: u
    });
    emit('signed-in', u);
    if (syncEnabled()) {
      enableAutoSync();
      setTimeout(function () { autoSync(); }, 600);
    }
    return u;
  }

  function consumeRedirect() {
    try {
      var h = location.hash && location.hash.charAt(0) === '#' ? location.hash.slice(1) : '';
      if (!h || h.indexOf('access_token=') < 0) return null;
      var p = new URLSearchParams(h);
      var at = p.get('access_token');
      if (!at) return null;
      var d = {
        access_token: at,
        refresh_token: p.get('refresh_token') || '',
        expires_in: parseInt(p.get('expires_in'), 10) || 3600,
        user: null
      };
      if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      return d;
    } catch (e) { return null; }
  }

  function signUp(email, password) {
    return request('/auth/v1/signup', { method: 'POST', body: { email: email, password: password } })
      .then(function (d) {
        if (d && d.access_token) { storeAuth(d); return { ok: true, user: d.user }; }
        return { ok: true, pending: true, user: d && d.user };
      });
  }

  function signIn(email, password) {
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: email, password: password }
    }).then(function (d) {
      var u = storeAuth(d);
      return { ok: true, user: u };
    });
  }

  function signOut() {
    var p = session ? request('/auth/v1/logout', { method: 'POST' }).catch(function () { }) : Promise.resolve();
    return p.then(function () { clearSession(); return { ok: true }; });
  }

  function recover(email) {
    return request('/auth/v1/recover', { method: 'POST', body: { email: email } });
  }

  function signInWithGoogle() {
    if (!isConfigured(cfg)) return false;
    var back = location.origin + location.pathname;
    location.href = cfg.url + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(back);
    return true;
  }

  function getUser() {
    if (!session) return Promise.resolve(null);
    return rest('/auth/v1/user').then(function (u) {
      if (u) { session.user = u; saveSession(session); }
      return u;
    });
  }

  /* ---------------- 원격 설정 / 광고 ---------------- */
  function fetchSiteData() {
    if (!cfgReady()) return Promise.resolve(null);
    return rest('/rest/v1/site_config?select=id,value')
      .then(function (rows) {
        var config = {};
        (rows || []).forEach(function (r) {
          if (!r || !r.id) return;
          if (r.id === 'notice' || r.id === 'home') config[r.id] = r.value;
          if (r.id === 'ads') config.ads = r.value;
        });
        return rest('/rest/v1/site_ads?select=id,data,enabled&order=sort_order.asc').then(function (adRows) {
          var ads = (adRows || []).map(function (r) {
            var d = r.data && typeof r.data === 'object' ? r.data : {};
            d.id = d.id || r.id;
            if (r.enabled === false) d.enabled = false;
            return d;
          });
          return { config: config, ads: ads };
        });
      });
  }

  function upsert(table, rows, conflict) {
    return rest('/rest/v1/' + table + (conflict ? '?on_conflict=' + conflict : ''), {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows
    });
  }

  function getConfigRow(id) {
    if (!isConfigured(cfg)) return Promise.resolve(null);
    return rest('/rest/v1/site_config?select=value&id=eq.' + encodeURIComponent(id))
      .then(function (rows) { return rows && rows[0] ? rows[0].value : null; }, function () { return null; });
  }

  function saveConfigRow(id, value) {
    if (!isConfigured(cfg) || !session) return Promise.resolve(null);
    return upsert('site_config', [{ id: id, value: value, updated_at: new Date().toISOString() }], 'id')
      .catch(function () { return null; });
  }

  function saveSiteData(config, ads) {
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    loadSessionIfChanged();
    if (!session) return Promise.reject(new Error('admin-login-required'));
    var rows = [];
    ['notice', 'home'].forEach(function (k) {
      if (config && config[k]) rows.push({ id: k, value: config[k], updated_at: new Date().toISOString() });
    });
    if (config && config.ads) rows.push({ id: 'ads', value: config.ads, updated_at: new Date().toISOString() });
    var p = rows.length ? upsert('site_config', rows, 'id') : Promise.resolve();

    return p.then(function () {
      if (!Array.isArray(ads)) return null;
      var payload = ads.map(function (a, i) {
        return {
          id: String(a.id || ('ad-' + i)),
          data: a,
          enabled: a.enabled !== false,
          position: a.position || 'feed',
          sort_order: a.order || i + 1,
          updated_at: new Date().toISOString()
        };
      });
      return upsert('site_ads', payload, 'id').then(function () {
        /* 원격에서 지워진 광고 정리 */
        return rest('/rest/v1/site_ads?select=id').then(function (cur) {
          var keep = {};
          payload.forEach(function (r) { keep[r.id] = 1; });
          var gone = (cur || []).filter(function (r) { return !keep[r.id]; });
          if (!gone.length) return null;
          return Promise.all(gone.map(function (r) {
            return rest('/rest/v1/site_ads?id=eq.' + encodeURIComponent(r.id), { method: 'DELETE' });
          }));
        });
      });
    });
  }

  function testConnection(url, key) {
    var u = normUrl(url), k = String(key || '').trim();
    if (!u || !k) return Promise.resolve({ ok: false, error: 'URL 과 anon key 를 모두 입력하세요.' });
    return fetch(u + '/rest/v1/site_config?select=id&limit=1', {
      headers: { apikey: k, Authorization: 'Bearer ' + k }, cache: 'no-store'
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) return { ok: false, error: 'anon key 가 올바르지 않습니다 (HTTP ' + r.status + ').' };
      if (r.status === 404) {
        return { ok: true, schema: false, note: '연결은 되었지만 site_config 테이블이 없습니다. supabase_schema.sql 을 실행하세요.' };
      }
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
      return { ok: true, schema: true, note: '연결되었습니다.' };
    }).catch(function (e) {
      return { ok: false, error: '연결 실패: ' + (e && e.message ? e.message : '네트워크 오류') };
    });
  }

  /* ---------------- 짧은 공유 링크 ---------------- */
  function shortId(n) {
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var arr = new Uint8Array(n || 8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < arr.length; j++) out += abc[arr[j] % abc.length];
    return out;
  }

  function localShares() { return readJSON(K_LOCAL_SHARES, {}) || {}; }
  function saveLocalShare(rec) {
    var all = localShares();
    all[rec.id] = rec;
    /* 60개까지만 유지 */
    var ids = Object.keys(all);
    if (ids.length > 60) {
      ids.sort(function (a, b) { return (all[a].ts || 0) - (all[b].ts || 0); });
      while (ids.length > 60) delete all[ids.shift()];
    }
    writeJSON(K_LOCAL_SHARES, all);
  }

  function hitShare(id) {
    if (!isConfigured(cfg) || !id) return Promise.resolve(null);
    return request('/rest/v1/rpc/share_view_hit', { method: 'POST', body: { p_id: id } })
      .catch(function () { return null; });
  }

  function createShare(share) {
    share = share || {};
    var payload = share.payload === undefined ? {} : share.payload;
    var json = '';
    try { json = JSON.stringify(payload); } catch (e) { return Promise.resolve({ ok: false, error: '공유할 데이터를 직렬화하지 못했습니다.' }); }
    if (json.length > 180000) return Promise.resolve({ ok: false, error: '공유할 내용이 너무 큽니다(180KB 초과).' });

    var rec = {
      id: shortId(8),
      kind: String(share.kind || 'page').slice(0, 40),
      title: String(share.title || 'Shared page').slice(0, 120),
      payload: payload,
      ts: Date.now()
    };

    if (isConfigured(cfg)) {
      return rest('/rest/v1/shared_pages', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: [{
          id: rec.id, kind: rec.kind, title: rec.title, payload: rec.payload,
          created_at: new Date().toISOString(),
          expires_at: share.ttlMinutes ? new Date(Date.now() + share.ttlMinutes * 60000).toISOString() : null
        }]
      }).then(function () {
        return { ok: true, id: rec.id, url: 'view.html?id=' + rec.id, local: false };
      }).catch(function (e) {
        saveLocalShare(rec);
        return { ok: true, id: rec.id, url: 'view.html?id=' + rec.id, local: true, warning: (e && e.message) || 'remote-failed' };
      });
    }
    saveLocalShare(rec);
    return Promise.resolve({ ok: true, id: rec.id, url: 'view.html?id=' + rec.id, local: true });
  }

  function getShare(id) {
    id = String(id || '').trim();
    if (!/^[a-z0-9]{4,24}$/i.test(id)) return Promise.resolve({ ok: false, error: 'invalid-id' });
    var localAll = localShares();
    var localRec = localAll[id] || null;
    if (isConfigured(cfg)) {
      return rest('/rest/v1/shared_pages?select=id,kind,title,payload,created_at&id=eq.' + encodeURIComponent(id))
        .then(function (rows) {
          if (rows && rows[0]) return { ok: true, share: rows[0], source: 'cloud' };
          if (localRec) return { ok: true, share: localRec, source: 'local' };
          return { ok: false, error: 'not-found' };
        })
        .catch(function () {
          if (localRec) return { ok: true, share: localRec, source: 'local', warning: 'offline' };
          return { ok: false, error: 'network' };
        });
    }
    if (localRec) return Promise.resolve({ ok: true, share: localRec, source: 'local' });
    return Promise.resolve({ ok: false, error: 'not-found' });
  }

  /* ---------------- 클라우드 동기화 ---------------- */
  function syncKeyList() {
    var out = [], seen = {};
    function add(k) {
      k = String(k === null || k === undefined ? '' : k);
      if (!k || seen['#' + k] || SYNC_SKIP[k] || !SYNC_PREFIX.test(k)) return;
      seen['#' + k] = 1;
      out.push(k);
    }
    try {
      /* localStorage 가 꽉 차서 IndexedDB 로 넘어간 항목까지 함께 잡는다. */
      if (window.Lemon && Lemon.store && typeof Lemon.store.keys === 'function') {
        Lemon.store.keys().forEach(add);
      } else {
        for (var i = 0; i < localStorage.length; i++) add(localStorage.key(i));
      }
    } catch (e) { }
    return out;
  }

  function syncRows() {
    var rows = [], oversize = [], rawTotal = 0;
    var user = sessionUser();
    var stamp = new Date().toISOString();
    syncKeyList().forEach(function (k) {
      var raw = null;
      try { raw = localStorage.getItem(k); } catch (e) { return; }
      if (raw === null) return;
      var size = utf8Bytes(raw);
      if (size > SYNC_MAX_KEY) { oversize.push({ key: k, bytes: size }); return; }
      var val;
      try { val = JSON.parse(raw); } catch (e) { val = raw; }
      rows.push({ user_id: user && user.id, key: k, value: val, updated_at: stamp });
      rawTotal += size;
    });
    return { rows: rows, oversize: oversize, rawBytes: rawTotal, payloadBytes: utf8Bytes(JSON.stringify(rows)) };
  }

  /* 행 묶음을 한도 검사 · 해시 비교 후 올린다. (로컬 저장소 · 드라이브가 함께 쓴다) */
  function uploadRows(rows, opts) {
    opts = opts || {};
    var source = String(opts.source || 'extra');
    if (!syncEnabled()) return syncOffResult(source);
    if (!cfgReady()) return Promise.resolve({ ok: false, error: 'cloud-not-configured', source: source });
    if (!session) return Promise.resolve({ ok: false, error: 'login-required', source: source });
    if (!rows || !rows.length) {
      var ts0 = Date.now();
      if (opts.force) writeJSON(K_LAST_SYNC, { ts: ts0, dir: 'push', count: 0, bytes: 0, source: source, manual: true });
      return Promise.resolve({ ok: true, count: 0, bytes: 0, skipped: true, empty: true, ts: ts0, source: source });
    }
    var json = '';
    var plain = '';
    try {
      json = JSON.stringify(rows);
      /* updated_at 은 매번 달라지므로 비교용 지문에서는 뺀다. */
      plain = JSON.stringify(rows.map(function (r) { return [r.key, r.value]; }));
    } catch (e) { return Promise.resolve({ ok: false, error: 'serialize-failed', source: source }); }
    var bytes = utf8Bytes(json);
    var limit = quotaBytes();
    var used = bookBytes(source);
    if (used + bytes > limit) {
      emit('backup', { phase: 'quota', source: source, bytes: bytes, used: used, limit: limit, quotaMB: quotaMB() });
      return Promise.resolve({
        ok: false, error: 'quota-exceeded', source: source,
        bytes: bytes, used: used, limit: limit, quotaMB: quotaMB()
      });
    }
    var hash = hashStr(plain);
    var prev = usageBook()[source] || {};
    if (!opts.force && prev.hash === hash) {
      emit('backup', { phase: 'skip', source: source, bytes: bytes, count: rows.length, ts: Date.now() });
      return Promise.resolve({ ok: true, skipped: true, count: rows.length, bytes: bytes, ts: Date.now(), source: source });
    }
    emit('backup', { phase: 'start', source: source, bytes: bytes, count: rows.length, limit: limit });
    return upsert('user_sync_data', rows, 'user_id,key').then(function () {
      var ts = Date.now();
      var rec = { hash: hash, bytes: bytes, count: rows.length, ts: ts };
      if (opts.extra) Object.keys(opts.extra).forEach(function (k) { rec[k] = opts.extra[k]; });
      setUsage(source, rec);
      writeJSON(K_LAST_SYNC, { ts: ts, dir: 'push', count: rows.length, bytes: bytes, source: source, manual: !!opts.force });
      emit('backup', { phase: 'done', source: source, bytes: bytes, count: rows.length, ts: ts, manual: !!opts.force });
      return { ok: true, count: rows.length, bytes: bytes, ts: ts, source: source, forced: !!opts.force };
    }, function (err) {
      var m = String((err && err.message) || '');
      var over = err && (err.status === 413 || /quota|한도/.test(m));
      var res = {
        ok: false, source: source,
        error: over ? 'quota-exceeded' : (m || 'push-failed'),
        status: err && err.status, bytes: bytes, limit: limit
      };
      emit('backup', { phase: 'error', source: source, error: res.error, message: m });
      return res;
    });
  }

  /* 로그인 사용자의 lemon_* / flux_* 데이터(+ Flux Drive)를 클라우드에 올린다.
     opts.force = true (수동 버튼) → 내용이 같아도 무조건 다시 올린다. */
  function syncPush(opts) {
    opts = opts || {};
    if (!syncEnabled()) return syncOffResult('local');
    if (!cfgReady()) return Promise.resolve({ ok: false, error: 'cloud-not-configured' });
    if (!session) return Promise.resolve({ ok: false, error: 'login-required' });
    var built = syncRows();
    return uploadRows(built.rows, { force: !!opts.force, source: 'local' }).then(function (r) {
      r.oversize = built.oversize.length;
      r.oversizeKeys = built.oversize.map(function (x) { return x.key; });
      if (opts.drive === false) return r;
      return syncDrive({ force: !!opts.force, onProgress: opts.onProgress }).then(function (d) {
        r.drive = d;
        return r;
      }, function () { return r; });
    });
  }

  function backupNow(opts) {
    return syncPush({ force: true, onProgress: opts && opts.onProgress });
  }

  /* ---------------- Flux Drive (IndexedDB flux_drive_v1) ---------------- */
  function openDriveDB() {
    if (driveDbP) return driveDbP;
    driveDbP = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('idb-unavailable')); return; }
      var rq;
      try { rq = indexedDB.open(DRIVE_DB, DRIVE_VER); } catch (e) { rej(e); return; }
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
        db.onversionchange = function () { try { db.close(); } catch (e) { } driveDbP = null; };
        res(db);
      };
      rq.onerror = function () { rej(rq.error || new Error('idb-open-failed')); };
      rq.onblocked = function () { rej(new Error('idb-blocked')); };
    });
    driveDbP = driveDbP.then(function (db) { return db; }, function (e) { driveDbP = null; throw e; });
    return driveDbP;
  }
  function idbReq(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function driveNodes() {
    return openDriveDB().then(function (db) {
      return idbReq(db.transaction('nodes').objectStore('nodes').getAll());
    });
  }
  function driveBlob(id) {
    return openDriveDB().then(function (db) {
      return idbReq(db.transaction('blobs').objectStore('blobs').get(id));
    }).then(function (rec) { return rec ? rec.blob : null; });
  }
  function putDriveNode(node) {
    return openDriveDB().then(function (db) {
      return idbReq(db.transaction('nodes', 'readwrite').objectStore('nodes').put(node));
    });
  }
  function putDriveBlob(id, blob) {
    return openDriveDB().then(function (db) {
      return idbReq(db.transaction('blobs', 'readwrite').objectStore('blobs').put({ id: id, blob: blob }));
    });
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : '');
      };
      fr.onerror = function () { rej(fr.error || new Error('read-failed')); };
      fr.readAsDataURL(blob);
    });
  }
  function b64ToBlob(b64, mime) {
    var bin = atob(String(b64 || ''));
    var len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  }
  /* 드라이브가 바뀌었는지 싸게 알아보는 지문 (파일 내용은 읽지 않는다) */
  function driveSig(nodes) {
    var size = 0, upd = 0, tr = 0, files = 0;
    (nodes || []).forEach(function (n) {
      if (!n) return;
      size += Number(n.size || 0);
      upd = Math.max(upd, Number(n.updatedAt || 0));
      if (n.trashed) tr++;
      if (n.kind === 'file' && !n.trashed) files++;
    });
    return [(nodes || []).length, files, size, upd, tr].join('-');
  }

  function driveRows(nodes, onProgress) {
    var user = sessionUser();
    var stamp = new Date().toISOString();
    var rows = [];
    var targets = [], skippedBig = [];
    (nodes || []).forEach(function (n) {
      if (!n || !n.id) return;
      rows.push({ user_id: user && user.id, key: DRIVE_PREFIX + 'n:' + n.id, value: n, updated_at: stamp });
      if (n.kind !== 'file' || n.trashed || !(Number(n.size) > 0)) return;
      if (Number(n.size) > DRIVE_FILE_MAX) skippedBig.push(n);
      else targets.push(n);
    });
    var i = 0, failed = 0, lastErr = '';
    function step() {
      if (i >= targets.length) {
        return Promise.resolve({ rows: rows, files: targets.length - failed, failed: failed, skippedBig: skippedBig, error: lastErr });
      }
      var n = targets[i++];
      return driveBlob(n.id).then(function (blob) {
        if (!blob) { failed++; lastErr = lastErr || 'blob-missing'; return null; }
        return blobToB64(blob).then(function (b64) {
          if (!b64) { failed++; lastErr = lastErr || 'empty-base64'; return null; }
          rows.push({
            user_id: user && user.id, key: DRIVE_PREFIX + 'd:' + n.id,
            value: { mime: n.mime || blob.type || '', b64: b64 }, updated_at: stamp
          });
        });
      }).catch(function (err) { failed++; lastErr = lastErr || String((err && err.message) || err); return null; }).then(function () {
        if (onProgress) onProgress(i, targets.length);
        return step();
      });
    }
    if (onProgress) onProgress(0, targets.length);
    return step();
  }

  /* 드라이브 폴더·파일을 클라우드로 올린다. 바뀐 것이 없으면 건너뛴다. */
  function syncDrive(opts) {
    opts = opts || {};
    if (!syncEnabled()) return syncOffResult('drive');
    if (!cfgReady()) return Promise.resolve({ ok: false, error: 'cloud-not-configured', source: 'drive' });
    if (!session) return Promise.resolve({ ok: false, error: 'login-required', source: 'drive' });
    return driveNodes().then(function (nodes) {
      var sig = driveSig(nodes);
      var prev = usageBook().drive || {};
      if (!nodes.length) {
        return { ok: true, skipped: true, source: 'drive', count: 0, nodes: 0, files: 0, ts: Date.now(), empty: true };
      }
      if (!opts.force && prev.sig === sig) {
        emit('backup', { phase: 'skip', source: 'drive', count: nodes.length, ts: Date.now() });
        return { ok: true, skipped: true, source: 'drive', count: nodes.length, nodes: nodes.length, files: 0, ts: Date.now() };
      }
      return driveRows(nodes, opts.onProgress).then(function (built) {
        return uploadRows(built.rows, {
          force: !!opts.force, source: 'drive',
          extra: { sig: sig, files: built.files, nodes: nodes.length }
        }).then(function (r) {
          r.nodes = nodes.length;
          r.files = built.files;
          r.skippedBig = built.skippedBig;
          if (built.error) r.detail = built.error;
          return r;
        });
      });
    }, function () {
      return { ok: false, error: 'idb-unavailable', source: 'drive' };
    });
  }

  /* 클라우드에 있는 드라이브 항목 중 이 기기에 없는 것만 되살린다. */
  function applyDriveRows(rows, onProgress) {
    if (!rows || !rows.length) return Promise.resolve({ nodes: 0, files: 0 });
    return driveNodes().then(function (local) {
      var have = {};
      (local || []).forEach(function (n) { if (n && n.id) have[n.id] = 1; });
      var nodes = [], blobs = [];
      rows.forEach(function (row) {
        var k = String((row && row.key) || '');
        if (k.indexOf(DRIVE_PREFIX + 'n:') === 0) nodes.push(row);
        else if (k.indexOf(DRIVE_PREFIX + 'd:') === 0) blobs.push(row);
      });
      var addedN = 0, addedF = 0, total = nodes.length + blobs.length, done = 0;
      function tick() { done++; if (onProgress) onProgress(done, total); }
      var chain = Promise.resolve();
      nodes.forEach(function (row) {
        var id = row.key.slice((DRIVE_PREFIX + 'n:').length);
        chain = chain.then(function () {
          if (have[id]) { tick(); return null; }
          var n = row.value;
          if (!n || typeof n !== 'object') { tick(); return null; }
          var node = {};
          Object.keys(n).forEach(function (key) { node[key] = n[key]; });
          node.id = id;
          if (!node.kind) node.kind = 'file';
          return putDriveNode(node).then(function () {
            have[id] = 1; addedN++; tick();
          }, function () { tick(); });
        });
      });
      blobs.forEach(function (row) {
        var id = row.key.slice((DRIVE_PREFIX + 'd:').length);
        chain = chain.then(function () {
          if (!have[id]) { tick(); return null; }
          return driveBlob(id).then(function (cur) {
            if (cur) { tick(); return null; }
            var v = row.value || {};
            if (!v.b64) { tick(); return null; }
            return putDriveBlob(id, b64ToBlob(v.b64, v.mime)).then(function () {
              addedF++; tick();
            }, function () { tick(); });
          }, function () { tick(); });
        });
      });
      return chain.then(function () { return { nodes: addedN, files: addedF }; });
    });
  }

  function restoreDrive(opts) {
    opts = opts || {};
    if (!syncEnabled()) return syncOffResult('drive');
    if (!cfgReady()) return Promise.resolve({ ok: false, error: 'cloud-not-configured' });
    if (!session) return Promise.resolve({ ok: false, error: 'login-required' });
    return downloadRows(DRIVE_PREFIX).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'download-failed' };
      if (!res.rows.length) return { ok: true, nodes: 0, files: 0, total: 0 };
      return applyDriveRows(res.rows, opts.onProgress).then(function (c) {
        return { ok: true, nodes: c.nodes, files: c.files, total: res.rows.length };
      });
    }, function (err) {
      return { ok: false, error: (err && err.message) || 'idb-unavailable' };
    });
  }

  /* 여러 키의 값을 한 번에 받아온다. (PostgREST in.(...)) */
  function fetchRowsByKeys(keys) {
    if (!keys || !keys.length) return Promise.resolve([]);
    var batches = [], i;
    for (i = 0; i < keys.length; i += 25) batches.push(keys.slice(i, i + 25));
    var out = [];
    var chain = Promise.resolve();
    batches.forEach(function (batch) {
      chain = chain.then(function () {
        var inner = batch.map(function (k) { return '"' + String(k).replace(/["\\]/g, '') + '"'; }).join(',');
        var path = '/rest/v1/user_sync_data?select=key,value,updated_at&key=in.(' +
          encodeURIComponent(inner).replace(/%2C/g, ',') + ')';
        return rest(path).then(function (rows) {
          (rows || []).forEach(function (r) { if (r && r.key) out.push(r); });
        }, function () { });
      });
    });
    return chain.then(function () { return out; });
  }

  /* 다른 기기가 올린 데이터 중 이 기기에 없는 것만 채운다. (덮어쓰지 않는다)
     먼저 키 목록만 받아 비교하고, 정말 없는 항목의 값만 내려받는다. */
  function syncPull(opts) {
    opts = opts || {};
    if (!syncEnabled()) return syncOffResult('pull');
    if (!cfgReady()) return Promise.resolve({ ok: false, error: 'cloud-not-configured' });
    if (!session) return Promise.resolve({ ok: false, error: 'login-required' });
    return rest('/rest/v1/user_sync_data?select=key,updated_at')
      .then(function (list) {
        var localKeys = [], driveKeys = [];
        (list || []).forEach(function (r) {
          var k = String((r && r.key) || '');
          if (!k) return;
          if (k.indexOf(DRIVE_PREFIX) === 0) driveKeys.push(k); else localKeys.push(k);
        });
        var needLocal = [], skipped = 0;
        localKeys.forEach(function (k) {
          var exists = false;
          try { exists = localStorage.getItem(k) !== null; } catch (e) { }
          if (exists && !opts.overwrite) { skipped++; return; }
          needLocal.push(k);
        });

        var driveP = (opts.drive === false || !driveKeys.length)
          ? Promise.resolve({ nodes: 0, files: 0 })
          : driveNodes().then(function (local) {
            var have = {};
            (local || []).forEach(function (n) { if (n && n.id) have[n.id] = 1; });
            var preN = DRIVE_PREFIX + 'n:', preD = DRIVE_PREFIX + 'd:';
            var dNeed = driveKeys.filter(function (k) {
              if (k.indexOf(preN) === 0) return !have[k.slice(preN.length)];
              if (k.indexOf(preD) === 0) return !have[k.slice(preD.length)];
              return false;
            });
            if (!dNeed.length) return { nodes: 0, files: 0 };
            return fetchRowsByKeys(dNeed).then(function (rows) {
              return applyDriveRows(rows, opts.onProgress);
            });
          }).catch(function () { return { nodes: 0, files: 0 }; });

        return fetchRowsByKeys(needLocal).then(function (rows) {
          var restored = 0;
          (rows || []).forEach(function (r) {
            if (!r || !r.key || String(r.key).indexOf(DRIVE_PREFIX) === 0) return;
            try {
              localStorage.setItem(r.key, typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
              restored++;
            } catch (e) { }
          });
          return driveP.then(function (d) {
            writeJSON(K_LAST_SYNC, { ts: Date.now(), dir: 'pull', count: restored });
            var res = { ok: true, count: restored, skipped: skipped, drive: d };
            if (restored || (d && (d.nodes || d.files))) emit('pulled', res);
            return res;
          });
        });
      });
  }

  /* 접두사로 클라우드 행을 그대로 내려받는다. */
  function downloadRows(prefix) {
    if (!syncEnabled()) return syncOffResult('drive');
    if (!cfgReady()) return Promise.resolve({ ok: false, error: 'cloud-not-configured' });
    if (!session) return Promise.resolve({ ok: false, error: 'login-required' });
    var p = String(prefix || '');
    var path = '/rest/v1/user_sync_data?select=key,value,updated_at';
    if (p) path += '&key=like.' + encodeURIComponent(p + '*');
    return rest(path).then(function (rows) {
      return { ok: true, rows: rows || [] };
    }, function (err) {
      return { ok: false, error: (err && err.message) || 'download-failed', status: err && err.status };
    });
  }

  /* 현재 클라우드 사용량 / 한도.
     서버에 size_bytes 컬럼이 있으면 서버 실측값을, 없으면 이 기기 장부로 계산한다. */
  function cloudUsage() {
    var limit = quotaBytes(), mb = quotaMB();
    var built = syncRows();
    var book = usageBook();
    var driveBytes = Number((book.drive && book.drive.bytes) || 0);
    var out = {
      ok: true, configured: cfgReady(), signedIn: !!session, enabled: syncEnabled(),
      limit: limit, quotaMB: mb, source: 'local',
      bytes: built.payloadBytes + driveBytes,
      sources: { local: built.payloadBytes, drive: driveBytes }
    };
    if (!session || !out.configured || !out.enabled) return Promise.resolve(out);

    /* size_bytes 컬럼이 아직 없으면(스키마 미적용) 6시간 동안은 다시 묻지 않는다.
       또 사용량이 한도의 60% 미만이면 서버에 물어보지 않고 이 기기 장부로 충분하다. */
    var probe = book.sizeProbe;
    if (probe && probe.ok === false && (Date.now() - (probe.ts || 0)) < 6 * 3600 * 1000) {
      return Promise.resolve(out);
    }
    if (!(probe && probe.ok === true) && out.bytes < limit * 0.6) {
      return Promise.resolve(out);
    }

    return rest('/rest/v1/user_sync_data?select=key,size_bytes').then(function (rows) {
      var total = 0, local = 0, drive = 0, n = 0;
      (rows || []).forEach(function (r) {
        if (!r || !r.key) return;
        var b = Number(r.size_bytes || 0);
        total += b; n++;
        if (String(r.key).indexOf(DRIVE_PREFIX) === 0) drive += b; else local += b;
      });
      var b2 = usageBook();
      if (b2.local) b2.local.bytes = local;
      if (b2.drive) b2.drive.bytes = drive;
      b2.sizeProbe = { ok: true, ts: Date.now() };
      writeJSON(K_USAGE, b2);
      return {
        ok: true, configured: true, signedIn: true, limit: limit, quotaMB: mb,
        bytes: total, rows: n, source: 'remote',
        sources: { local: local, drive: drive }
      };
    }, function () {
      var b3 = usageBook();
      b3.sizeProbe = { ok: false, ts: Date.now() };
      writeJSON(K_USAGE, b3);
      return out;
    });
  }

  /* 페이지를 열 때 한 번, 이 기기에 없는 항목만 클라우드에서 채운다.
     (키 목록만 먼저 받아보므로 실제로 받을 것이 없으면 전송량이 거의 없다) */
  function pullOnInit() {
    if (!session || !cfg) return;
    var u = sessionUser();
    var uid = u && u.id;
    if (!uid) return;
    var mark = readJSON(K_PULLED, null);
    if (mark && mark.user === uid && (Date.now() - (mark.ts || 0)) < 60000) return;
    syncPull({ overwrite: false }).then(function () {
      writeJSON(K_PULLED, { user: uid, ts: Date.now() });
    }, function () { });
  }

  function lastBackup() {
    var ls = readJSON(K_LAST_SYNC, null);
    return ls && ls.dir === 'push' ? ls : null;
  }

  /* ---------------- 자동 백업 스케줄러 ---------------- */
  var autoSyncOn = false, pushTimer = 0, pullTimer = 0, debounceTimer = 0, watcherOn = false;
  var driveDbP = null;

  function hidden() {
    try { return doc.visibilityState === 'hidden'; } catch (e) { return false; }
  }
  function isSyncKey(k) {
    k = String(k === null || k === undefined ? '' : k);
    return !!k && !SYNC_SKIP[k] && SYNC_PREFIX.test(k);
  }
  function schedulePush(delay) {
    if (!autoSyncOn || !session || !isConfigured(cfg)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    var wait = Number(delay);
    if (!(wait > 0)) wait = DEBOUNCE_MS;
    debounceTimer = setTimeout(function () {
      debounceTimer = 0;
      if (!session || !isConfigured(cfg) || hidden()) return;
      syncPush().catch(function () { });
    }, Math.max(1000, wait));
  }
  /* 같은 탭의 저장은 storage 이벤트가 오지 않는다. setItem 을 감싸 변경을 잡는다. */
  function watchChanges() {
    if (watcherOn) return;
    watcherOn = true;
    try {
      var proto = window.Storage && window.Storage.prototype;
      if (proto && !proto.__lemonCloudTouch) {
        var oSet = proto.setItem, oRem = proto.removeItem;
        proto.setItem = function (k, v) {
          var res = oSet.apply(this, arguments);
          try { if (this === window.localStorage && isSyncKey(k)) schedulePush(); } catch (e) { }
          return res;
        };
        proto.removeItem = function (k) {
          var res = oRem.apply(this, arguments);
          try { if (this === window.localStorage && isSyncKey(k)) schedulePush(); } catch (e) { }
          return res;
        };
        proto.__lemonCloudTouch = 1;
      }
    } catch (e) { }
    try { window.addEventListener('storage', function (e) { if (e && isSyncKey(e.key)) schedulePush(); }); } catch (e) { }
    try {
      doc.addEventListener('visibilitychange', function () {
        if (!autoSyncOn || hidden() || !session || !isConfigured(cfg)) return;
        syncPush().catch(function () { });
      });
    } catch (e) { }
  }

  function autoSync() {
    if (!session || !isConfigured(cfg)) return Promise.resolve(null);
    return syncPull({ overwrite: false })
      .then(function (r) { return syncPush().then(function (p) { return { pull: r, push: p }; }); })
      .catch(function () { return null; });
  }
  function enableAutoSync() {
    autoSyncOn = true;
    watchChanges();
    if (pushTimer) clearInterval(pushTimer);
    pushTimer = setInterval(function () {
      if (!session || !isConfigured(cfg) || hidden()) return;
      syncPush().catch(function () { });
    }, PUSH_INTERVAL);
    if (pullTimer) clearInterval(pullTimer);
    pullTimer = setInterval(function () {
      if (!session || !isConfigured(cfg) || hidden()) return;
      syncPull({ overwrite: false }).catch(function () { });
    }, PULL_INTERVAL);
  }
  function stopAutoSync() {
    autoSyncOn = false;
    if (pushTimer) clearInterval(pushTimer);
    if (pullTimer) clearInterval(pullTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    pushTimer = pullTimer = debounceTimer = 0;
  }

  function lastSync() { return readJSON(K_LAST_SYNC, null); }

  /* ---------------- init ---------------- */
  function init() {
    if (initP) return initP;
    watchSession();
    initP = Promise.resolve()
      .then(function () { return ensureConfigFile(); })
      .then(function () {
        cfg = loadConfig();
        remoteReady = isConfigured(cfg);
        var redir = consumeRedirect();
        if (redir) {
          loadSession();
          storeAuth(redir);
          return getUser().catch(function () { });
        }
        loadSession();
        if (session && cfg.url) {
          if (syncEnabled()) {
            enableAutoSync();
            pullOnInit();
          }
          getUser().catch(function () { });
        }
        return null;
      })
      .then(function () { return cfg; });
    return initP;
  }

  window.LemonCloud = {
    __v: 1,
    init: init,
    configured: function () { return cfgReady(); },
    config: function () { return cfg ? { url: cfg.url, anonKey: cfg.anonKey, quotaMB: cfg.quotaMB } : { url: '', anonKey: '' }; },
    setConfig: function (url, key, quota) {
      var c = { url: normUrl(url), anonKey: String(key || '').trim() };
      if (quota) c.quotaMB = quota;
      writeJSON(K_CFG, c);
      cfg = c;
      remoteReady = isConfigured(c);
      return c;
    },
    clearConfig: function () { drop(K_CFG); cfg = loadConfig(); },
    testConnection: testConnection,

    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    recover: recover,
    signInWithGoogle: signInWithGoogle,
    getUser: getUser,
    sessionUser: sessionUser,
    hasSession: function () { return !!session; },

    fetchSiteData: fetchSiteData,
    saveSiteData: saveSiteData,
    getConfigRow: getConfigRow,
    saveConfigRow: saveConfigRow,

    createShare: createShare,
    getShare: getShare,
    hitShare: hitShare,

    syncPush: syncPush,
    syncPull: syncPull,
    autoSync: autoSync,
    lastSync: lastSync,

    /* 수동 백업 · 용량 · 드라이브 백업이 함께 쓰는 도구 */
    backupNow: backupNow,
    lastBackup: lastBackup,
    usage: cloudUsage,
    uploadRows: uploadRows,
    downloadRows: downloadRows,
    syncDrive: syncDrive,
    restoreDrive: restoreDrive,
    syncEnabled: syncEnabled,
    setSyncEnabled: setSyncEnabled,
    driveFileMax: DRIVE_FILE_MAX,
    syncRows: syncRows,
    quota: function () { return { mb: quotaMB(), bytes: quotaBytes() }; },
    fmtBytes: fmtBytes,
    mbText: mbText,
    enableAutoSync: enableAutoSync,
    stopAutoSync: stopAutoSync,
    timings: { debounce: DEBOUNCE_MS, push: PUSH_INTERVAL, pull: PULL_INTERVAL },
    drivePrefix: DRIVE_PREFIX,

    escape: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  };
})();
