/* ============================================================
   Soft Hub SDK (soft-hub-sdk.js)
   ------------------------------------------------------------
   외부 도구가 Soft Hub의 5가지 API를 한 줄로 쓰는 클라이언트.

     SoftHub.configure({ clientId: 'lkc_...' });

     SoftHub.login.start()          LK 로그인 (oauth.html 로 이동)
     SoftHub.drive.put/get/list/remove   drive:app  (앱 전용 폴더만)
     SoftHub.share.create(...)      share:create (go.html?id=...)
     SoftHub.push.send(...)         push:send
     SoftHub.theme.get/apply/onChange     theme:read

   설계 원칙
   · Google Drive 토큰은 이 SDK 로 넘어오지 않는다. 같은 출처의
     drive-bridge.html 이 iframe 안에서 대신 읽고 쓰며, 폴더는
     SoftHub_Apps/{client_id} 로 고정된다.
   · 테마도 같은 방식(theme-bridge.html)으로 읽는다.
   · share:create · push:send 는 Supabase RPC 를 직접 부른다.
     앱 검증·한도·권한 확인은 모두 서버 함수가 한다.
   · 이 파일은 의존성이 없다. <script src> 한 줄로 쓴다.
   ============================================================ */
(function (global) {
  'use strict';

  if (global.SoftHub && global.SoftHub.__v) return;

  var DEFAULT_SUPABASE = 'https://dgqagaiaykmrmmyxqtol.supabase.co';
  var DEFAULT_ANON = 'sb_publishable_RJ0U_IQwByuK-3Sqa9j0uQ_l_7AmZEY';

  var cfg = {
    clientId: '',
    redirectUri: '',
    supabaseUrl: DEFAULT_SUPABASE,
    anonKey: DEFAULT_ANON,
    authBase: '',
    bridgeBase: '',
    themeCache: null
  };

  function scriptBase() {
    try {
      var cs = document.currentScript;
      if (!cs || !cs.src) {
        var list = document.querySelectorAll('script[src$="soft-hub-sdk.js"]');
        cs = list[list.length - 1];
      }
      return String((cs && cs.src) || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    } catch (e) { return ''; }
  }

  function configure(opts) {
    opts = opts || {};
    Object.keys(opts).forEach(function (k) {
      if (opts[k] !== undefined && opts[k] !== null) cfg[k] = opts[k];
    });
    if (!cfg.bridgeBase) cfg.bridgeBase = scriptBase();
    if (!cfg.authBase) cfg.authBase = cfg.bridgeBase;
    if (!cfg.redirectUri) {
      try { cfg.redirectUri = location.origin + location.pathname; } catch (e) { }
    }
    return cfg;
  }

  function err(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  /* ---------------- iframe 브리지 공통 ----------------
     부모(외부 도구) → 브리지(이 출처) postMessage 요청/응답.
     브리지는 부모 origin 이 앱의 Redirect URL 과 같은 출처일 때만 응답한다. */
  function createBridge(file, timeoutMs) {
    var state = { frame: null, ready: null, seq: 0, waiting: {} };

    function ensure() {
      if (state.ready) return state.ready;
      state.ready = new Promise(function (resolve, reject) {
        var f = document.createElement('iframe');
        f.setAttribute('aria-hidden', 'true');
        f.setAttribute('tabindex', '-1');
        f.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-9999px;top:0;';
        f.src = cfg.bridgeBase + file +
          '?client_id=' + encodeURIComponent(cfg.clientId) +
          '&parent_origin=' + encodeURIComponent(location.origin);
        f.onload = function () { /* 준비 메시지를 기다린다 */ };
        document.body.appendChild(f);
        state.frame = f;

        var timer = setTimeout(function () { reject(err('bridge-timeout', 'Soft Hub 브리지에 연결하지 못했습니다.')); }, timeoutMs || 12000);
        var onReady = function (e) {
          var d = e.data || {};
          if (d.source !== 'soft-hub-bridge' || d.type !== 'ready') return;
          if (e.source !== f.contentWindow) return;
          clearTimeout(timer);
          window.removeEventListener('message', onReady);
          resolve(true);
        };
        window.addEventListener('message', onReady);
      });
      return state.ready;
    }

    window.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.source !== 'soft-hub-bridge' || d.type !== 'reply') return;
      if (!state.frame || e.source !== state.frame.contentWindow) return;
      var w = state.waiting[d.id];
      if (!w) return;
      delete state.waiting[d.id];
      clearTimeout(w.timer);
      if (d.ok) w.resolve(d.data);
      else w.reject(err(d.error || 'bridge-error', d.message || ''));
    });

    return function call(op, payload, timeout) {
      return ensure().then(function () {
        return new Promise(function (resolve, reject) {
          var id = 'r' + (++state.seq) + '-' + Math.random().toString(36).slice(2, 7);
          state.waiting[id] = {
            resolve: resolve,
            reject: reject,
            timer: setTimeout(function () {
              delete state.waiting[id];
              reject(err('bridge-timeout', '요청 시간이 초과되었습니다.'));
            }, timeout || 12000)
          };
          state.frame.contentWindow.postMessage({
            source: 'soft-hub-app',
            type: 'request',
            id: id,
            op: op,
            payload: payload || {}
          }, '*');
        });
      });
    };
  }

  /* ---------------- LK 로그인 ---------------- */
  function randomState() {
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = '', arr = new Uint8Array(20);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < arr.length; j++) out += abc[arr[j] % abc.length];
    return out;
  }

  var login = {
    start: function (opts) {
      opts = opts || {};
      var state = randomState();
      try { sessionStorage.setItem('sh_state', state); } catch (e) { }
      var scope = opts.scope || 'profile:basic';
      var url = (cfg.bridgeBase || '') + 'oauth.html' +
        '?client_id=' + encodeURIComponent(cfg.clientId) +
        '&redirect_uri=' + encodeURIComponent(opts.redirectUri || cfg.redirectUri) +
        '&response_type=code&scope=' + encodeURIComponent(scope) +
        '&state=' + encodeURIComponent(state);
      location.href = url;
      return url;
    },
    checkState: function (state) {
      var ok = false;
      try { ok = !!state && sessionStorage.getItem('sh_state') === state; } catch (e) { ok = false; }
      try { if (ok) sessionStorage.removeItem('sh_state'); } catch (e) { }
      return ok;
    },
    exchange: function (code, redirectUri) {
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/oauth_exchange_code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.anonKey,
          Authorization: 'Bearer ' + cfg.anonKey
        },
        body: JSON.stringify({
          p_code: code,
          p_client_id: cfg.clientId,
          p_redirect_uri: redirectUri || cfg.redirectUri
        })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw err('exchange-failed', t); });
        return r.json();
      }).then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    user: function () {
      try { return JSON.parse(sessionStorage.getItem('sh_user') || 'null'); } catch (e) { return null; }
    },
    save: function (me) {
      try { sessionStorage.setItem('sh_user', JSON.stringify(me)); } catch (e) { }
      return me;
    },
    logout: function () {
      try { sessionStorage.removeItem('sh_user'); } catch (e) { }
    }
  };

  /* ---------------- Drive (drive:app) ---------------- */
  var driveCall = null;
  var drive = {
    put: function (key, value) { driveCall = driveCall || createBridge('drive-bridge.html', 15000); return driveCall('put', { key: key, value: value }, 20000); },
    get: function (key) { driveCall = driveCall || createBridge('drive-bridge.html', 15000); return driveCall('get', { key: key }); },
    list: function () { driveCall = driveCall || createBridge('drive-bridge.html', 15000); return driveCall('list', {}); },
    remove: function (key) { driveCall = driveCall || createBridge('drive-bridge.html', 15000); return driveCall('delete', { key: key }); },
    status: function () { driveCall = driveCall || createBridge('drive-bridge.html', 15000); return driveCall('status', {}); }
  };

  /* ---------------- Share (share:create) ---------------- */
  var share = {
    create: function (opts) {
      opts = opts || {};
      var payload = (opts.payload && typeof opts.payload === 'object') ? opts.payload : {};
      if (opts.html) payload.html = String(opts.html).slice(0, 150000);
      if (opts.url) payload.url = String(opts.url).slice(0, 800);
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/oauth_create_share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.anonKey,
          Authorization: 'Bearer ' + cfg.anonKey
        },
        body: JSON.stringify({
          p_client_id: cfg.clientId,
          p_title: String(opts.title || '공유').slice(0, 120),
          p_payload: payload,
          p_kind: String(opts.kind || 'app').slice(0, 20)
        })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw err('share-failed', t); });
        return r.json();
      }).then(function (id) {
        var base = (cfg.bridgeBase || '');
        return { id: id, url: base + 'go.html?id=' + encodeURIComponent(id) };
      });
    }
  };

  /* ---------------- Push (push:send) ---------------- */
  var push = {
    send: function (opts) {
      opts = opts || {};
      var me = login.user();
      var sub = opts.sub || (me && me.sub) || '';
      if (!sub) return Promise.reject(err('no-user', '먼저 LK 로그인을 하고 sub 를 받아 두세요.'));
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/oauth_send_push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.anonKey,
          Authorization: 'Bearer ' + cfg.anonKey
        },
        body: JSON.stringify({
          p_client_id: cfg.clientId,
          p_sub: sub,
          p_title: String(opts.title || '').slice(0, 80),
          p_body: String(opts.body || '').slice(0, 240),
          p_url: String(opts.url || '').slice(0, 400)
        })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw err('push-failed', t); });
        return r.json();
      });
    }
  };

  /* ---------------- Theme (theme:read) ---------------- */
  var themeCall = null;
  var themeListeners = [];
  var theme = {
    get: function () {
      if (cfg.themeCache) return Promise.resolve(cfg.themeCache);
      themeCall = themeCall || createBridge('theme-bridge.html', 8000);
      return themeCall('theme', {}, 8000).then(function (t) {
        cfg.themeCache = t || { theme: 'dynamic', brand: '#2563eb', dark: false };
        return cfg.themeCache;
      }, function () {
        var dark = false;
        try { dark = !!(global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { }
        cfg.themeCache = { theme: 'dynamic', brand: '#2563eb', dark: dark, fallback: true };
        return cfg.themeCache;
      });
    },
    apply: function (root) {
      return theme.get().then(function (t) {
        var el = root || document.documentElement;
        el.setAttribute('data-sh-theme', t.theme || 'dynamic');
        el.style.setProperty('--sh-brand', t.brand || '#2563eb');
        el.style.setProperty('--sh-bg', t.dark ? '#070708' : '#f6f7f9');
        el.style.setProperty('--sh-fg', t.dark ? '#fafafa' : '#0a0a0a');
        el.style.setProperty('--sh-line', t.dark ? '#232327' : '#e6e6ea');
        try {
          if (t.dark) el.classList.add('sh-dark'); else el.classList.remove('sh-dark');
        } catch (e) { }
        return t;
      });
    },
    onChange: function (fn) {
      if (typeof fn !== 'function') return;
      themeListeners.push(fn);
      try {
        window.addEventListener('storage', function (e) {
          if (e && e.key && e.key !== 'cream_theme') return;
          cfg.themeCache = null;
          theme.get().then(function (t) { themeListeners.forEach(function (f) { try { f(t); } catch (err) { } }); });
        });
      } catch (e) { }
    }
  };

  global.SoftHub = {
    __v: 1,
    configure: configure,
    config: function () { return cfg; },
    login: login,
    drive: drive,
    share: share,
    push: push,
    theme: theme,
    version: '1.0'
  };
})(window);
