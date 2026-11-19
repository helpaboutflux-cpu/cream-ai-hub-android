/* ============================================================
   Lemon soft · Cloud engine  (lemon-cloud.js)
   ------------------------------------------------------------
   Supabase 를 쓰기 위한 의존성 없는 경량 REST/Auth 래퍼.

   · 설정(Project URL · anon key)이 없으면 아무 오류 없이 로컬 모드로 동작한다.
       - 로컬 모드: 로그인 UI 는 "클라우드 미연결" 안내, 공유 링크는 이 기기의
         localStorage 에만 남는다.
   · 설정이 있으면
       1) 공용 로그인/회원가입/로그아웃 (이메일·비밀번호 + Google OAuth)
          — 짧은 공유 링크의 작성자 확인과 관리자 콘솔 로그인에만 쓴다.
       2) 짧은 공유 링크 — shared_pages 테이블 + view.html?id=짧은코드
       3) 원격 설정/광고 — site_config / site_ads 를 읽어 전 방문자에게 반영

   · 개인 작업물의 백업·복원은 이 파일이 하지 않는다.
     이용자 본인의 Google Drive 로 옮긴다(lemon-gdrive.js).

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

  function normUrl(u) {
    var s = String(u || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }
  function isConfigured(c) { return !!(c && normUrl(c.url) && String(c.anonKey || '').trim()); }
  /* init() 전에 다른 함수가 먼저 불려도 설정을 스스로 읽는다. */
  function cfgReady() { if (!cfg) cfg = loadConfig(); return isConfigured(cfg); }

  function loadConfig() {
    /* 이 브라우저에서 직접 저장한 설정이 있으면 그것을 먼저 쓰고,
       없으면 배포된 공용 설정(lemon-cloud-config.js)을 쓴다. */
    var local = readJSON(K_CFG, null);
    if (isConfigured(local)) return { url: normUrl(local.url), anonKey: String(local.anonKey).trim() };
    var c = window.LEMON_CLOUD_CONFIG;
    if (isConfigured(c)) return { url: normUrl(c.url), anonKey: String(c.anonKey).trim() };
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
    if (now) emit('signed-in', sessionUser());
    else emit('signed-out');
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
        if (doc.visibilityState !== 'hidden') reloadSession();
      });
    } catch (e) { }
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent('lemoncloud:' + name, { detail: detail || {} })); } catch (e) { }
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

  /* 계정 정보 갱신 — 표시 이름(user_metadata) · 비밀번호.
     Supabase Auth 의 PUT /auth/v1/user 를 그대로 쓴다. */
  function updateUser(patch) {
    if (!session) return Promise.reject(new Error('login-required'));
    return rest('/auth/v1/user', { method: 'PUT', body: patch || {} }).then(function (u) {
      if (u && u.id) {
        session.user = u;
        saveSession(session);
        emit('user-updated', u);
      }
      return u;
    });
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
          if (r.id === 'cloudinary') config.cloudinary = r.value;
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

  /* ---------------- 관리자 전용: LK ID 계정 목록 ---------------- */
  /* auth.users 는 브라우저에서 직접 읽을 수 없다.
     supabase_schema.sql 의 admin_list_lk_accounts() 가
     관리자 이메일(public.admin_users)로 로그인한 세션에만 목록을 돌려준다. */
  function listAccounts() {
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    loadSessionIfChanged();
    if (!session) {
      var err = new Error('admin-login-required');
      err.status = 401;
      return Promise.reject(err);
    }
    return rest('/rest/v1/rpc/admin_list_lk_accounts', { method: 'POST', body: {} });
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
    if (utf8Bytes(json) > 180000) return Promise.resolve({ ok: false, error: '공유할 내용이 너무 큽니다(180KB 초과).' });

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

  /* ---------------- 커뮤니티 앱(portal.html · index.html · admin.html) ----------------
     community_apps 테이블 — 개발자 포털에서 등록(pending) → 관리자 승인(approved).
     로그인하지 않은 방문자도 승인된 앱 목록은 읽을 수 있다. */
  var COMMUNITY_COLS = 'id,owner_id,author_name,name,description,url,category,icon_id,color,screenshot_url,status,reject_reason,created_at,updated_at';

  function loginRequired() {
    var e = new Error('login-required');
    e.status = 401;
    return e;
  }

  function currentUid() {
    loadSessionIfChanged();
    return (session && session.user && session.user.id) ? String(session.user.id) : '';
  }

  /* 서버로 보내는 값은 여기서 정한다. 화면 검증을 건너뛴 값도 안전한 형태로 줄인다. */
  function communityPayload(p) {
    p = p || {};
    function s(v, n) {
      return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    }
    var color = s(p.color, 7);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = '#3b82f6';
    var cat = s(p.category, 20);
    if (['utility', 'productivity', 'media', 'game', 'dev', 'etc'].indexOf(cat) < 0) cat = 'utility';
    return {
      name: s(p.name, 60),
      description: s(p.description, 400),
      url: s(p.url, 400),
      category: cat,
      icon_id: s(p.icon_id, 40) || 'globe',
      color: color,
      screenshot_url: s(p.screenshot_url, 600),
      author_name: s(p.author_name, 60)
    };
  }

  /* 승인된 앱 — 누구나(비로그인 포함) */
  function listApprovedCommunityApps(limit) {
    var n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    return rest('/rest/v1/community_apps?select=' + COMMUNITY_COLS +
      '&status=eq.approved&order=created_at.desc&limit=' + n);
  }

  /* 내가 등록한 앱 — 로그인 필수 */
  function listMyCommunityApps() {
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    loadSessionIfChanged();
    if (!session) return Promise.reject(loginRequired());
    var uid = currentUid();
    if (!uid) return Promise.reject(loginRequired());
    return rest('/rest/v1/community_apps?select=' + COMMUNITY_COLS +
      '&owner_id=eq.' + encodeURIComponent(uid) + '&order=created_at.desc');
  }

  /* 등록 — 항상 pending 으로만 올라간다(RLS 도 같은 규칙을 건다). */
  function submitCommunityAdminRow(uid, authorName, payload) {
    var row = communityPayload(payload);
    row.owner_id = uid;
    row.status = 'pending';
    row.reject_reason = '';
    if (authorName) row.author_name = String(authorName).trim().slice(0, 60);
    return rest('/rest/v1/community_apps', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [row]
    }).then(function (rows) { return rows && rows[0] ? rows[0] : row; });
  }

  function submitCommunityApp(payload) {
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    loadSessionIfChanged();
    if (!session) return Promise.reject(loginRequired());
    var uid = currentUid();
    if (!uid) return Promise.reject(loginRequired());
    var u = session.user || {};
    var meta = (u.user_metadata && typeof u.user_metadata === 'object') ? u.user_metadata : {};
    var author = meta.full_name || meta.name || meta.display_name || meta.nickname || (u.email ? String(u.email).split('@')[0] : '');
    return submitCommunityAdminRow(uid, author, payload);
  }

  /* 수정 — 본인 앱만, 수정하면 다시 승인 대기(pending)로 돌아간다. */
  function updateMyCommunityApp(id, payload) {
    id = String(id || '').trim();
    if (!id) return Promise.reject(new Error('invalid-id'));
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    if (!currentUid()) return Promise.reject(loginRequired());
    var row = communityPayload(payload);
    row.status = 'pending';
    row.reject_reason = '';
    return rest('/rest/v1/community_apps?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: row
    }).then(function (rows) { return rows && rows[0] ? rows[0] : row; });
  }

  /* 삭제 — 본인 또는 관리자(RLS 가 판단) */
  function deleteCommunityApp(id) {
    id = String(id || '').trim();
    if (!id) return Promise.reject(new Error('invalid-id'));
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    if (!currentUid()) return Promise.reject(loginRequired());
    return rest('/rest/v1/community_apps?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' }
    });
  }

  /* 관리자 — 상태별 전체 목록 */
  function adminListCommunityApps(statusFilter) {
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    if (!session) return Promise.reject(loginRequired());
    var q = '/rest/v1/community_apps?select=' + COMMUNITY_COLS + '&order=created_at.desc';
    var st = String(statusFilter || '').trim();
    if (st && st !== 'all') q += '&status=eq.' + encodeURIComponent(st);
    return rest(q);
  }

  /* 관리자 — 승인 / 반려 */
  function adminReviewCommunityApp(id, status, rejectReason) {
    id = String(id || '').trim();
    if (!id) return Promise.reject(new Error('invalid-id'));
    var st = String(status || '').trim();
    if (st !== 'approved' && st !== 'rejected' && st !== 'pending') return Promise.reject(new Error('invalid-status'));
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    if (!session) return Promise.reject(loginRequired());
    return rest('/rest/v1/community_apps?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: st, reject_reason: st === 'rejected' ? String(rejectReason || '').trim().slice(0, 200) : '' }
    }).then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  }

  /* 원격 설정 한 줄 저장 — 실패를 그대로 돌려준다(관리자 콘솔 저장 확인용). */
  function saveRemoteConfigRow(id, value) {
    if (!cfgReady()) return Promise.reject(new Error('cloud-not-configured'));
    loadSessionIfChanged();
    if (!session) return Promise.reject(new Error('admin-login-required'));
    return upsert('site_config', [{ id: id, value: value, updated_at: new Date().toISOString() }], 'id');
  }

  /* ---------------- init ---------------- */
  function init() {
    if (initP) return initP;
    loadSession();
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
        if (session && cfg.url) return getUser().catch(function () { });
        return null;
      })
      .then(function () { return cfg; });
    return initP;
  }

  window.LemonCloud = {
    __v: 2,
    init: init,
    configured: function () { return cfgReady(); },
    config: function () { return cfg ? { url: cfg.url, anonKey: cfg.anonKey } : { url: '', anonKey: '' }; },
    setConfig: function (url, key) {
      var c = { url: normUrl(url), anonKey: String(key || '').trim() };
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
    updateUser: updateUser,
    signInWithGoogle: signInWithGoogle,
    getUser: getUser,
    sessionUser: sessionUser,
    hasSession: function () { return !!session; },

    fetchSiteData: fetchSiteData,
    saveSiteData: saveSiteData,
    getConfigRow: getConfigRow,
    saveConfigRow: saveConfigRow,
    listAccounts: listAccounts,

    listApprovedCommunityApps: listApprovedCommunityApps,
    listMyCommunityApps: listMyCommunityApps,
    submitCommunityApp: submitCommunityApp,
    updateMyCommunityApp: updateMyCommunityApp,
    deleteCommunityApp: deleteCommunityApp,
    adminListCommunityApps: adminListCommunityApps,
    adminReviewCommunityApp: adminReviewCommunityApp,
    saveRemoteConfigRow: saveRemoteConfigRow,

    createShare: createShare,
    getShare: getShare,
    hitShare: hitShare,

    fmtBytes: fmtBytes,

    escape: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  };
})();
