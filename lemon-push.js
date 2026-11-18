/* ============================================================
   Lemon Push · 브라우저 푸시 알림 클라이언트
   - Service Worker + Notification API
   - Supabase Realtime Broadcast ('soft_hub_push') 구독/발송
   ============================================================ */
(function () {
  'use strict';

  var SB_URL = 'https://dgqagaiaykmrmmyxqtol.supabase.co';
  var SB_KEY = 'sb_publishable_RJ0U_IQwByuK-3Sqa9j0uQ_l_7AmZEY';
  var CHANNEL = 'soft_hub_push';
  var LS_KEY = 'lemon_push_enabled';

  var st = {
    app: 'Soft Hub',
    enabled: false,
    swReg: null,
    sb: null,
    ch: null,
    ready: false,
    count: 0,
    onPush: null,
    onToast: null,
    onSubscribers: null,
    uid: ''
  };

  function uid() {
    if (st.uid) return st.uid;
    try {
      st.uid = localStorage.getItem('lemon_push_uid') || '';
      if (!st.uid) {
        st.uid = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        localStorage.setItem('lemon_push_uid', st.uid);
      }
    } catch (e) { st.uid = 'p' + Math.random().toString(36).slice(2, 10); }
    return st.uid;
  }
  function supported() { return typeof window.Notification !== 'undefined'; }
  function permission() { return supported() ? Notification.permission : 'denied'; }
  function loadFlag() {
    try { st.enabled = localStorage.getItem(LS_KEY) === '1' && permission() === 'granted'; } catch (e) { st.enabled = false; }
  }
  function saveFlag() {
    try { localStorage.setItem(LS_KEY, st.enabled ? '1' : '0'); } catch (e) { }
  }

  function registerSW() {
    if (st.swReg) return Promise.resolve(st.swReg);
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    var base = location.pathname.replace(/[^/]*$/, '');
    return navigator.serviceWorker.register(base + 'sw.js', { scope: base })
      .then(function (reg) { st.swReg = reg; return reg; })
      .catch(function () { return null; });
  }

  function sbClient() {
    if (st.sb) return st.sb;
    if (window.__lemonSBClient) { st.sb = window.__lemonSBClient; return st.sb; }
    if (!window.supabase) return null;
    try { st.sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }); } catch (e) { st.sb = null; }
    if (st.sb) window.__lemonSBClient = st.sb;
    return st.sb;
  }

  function connect() {
    if (st.ch) return st.ch;
    var sb = sbClient();
    if (!sb) return null;
    try {
      var ch = sb.channel(CHANNEL, { config: { broadcast: { self: false }, presence: { key: uid() } } });
      ch.on('broadcast', { event: 'push' }, function (p) {
        var payload = (p && p.payload) || {};
        if (!payload.title && !payload.body) return;
        try { if (typeof st.onPush === 'function') st.onPush(payload); } catch (e) { }
        dispatch(payload);
      });
      ch.on('presence', { event: 'sync' }, function () {
        try {
          var flat = ch.presenceState();
          var n = 0;
          Object.keys(flat).forEach(function (k) { n += (flat[k] || []).length; });
          st.count = n;
          if (st.onSubscribers) st.onSubscribers(n);
        } catch (e) { }
      });
      ch.subscribe(function (status) {
        st.ready = (status === 'SUBSCRIBED');
        if (st.ready) { try { ch.track({ uid: uid(), ts: Date.now() }); } catch (e) { } }
      });
      st.ch = ch;
      return ch;
    } catch (e) { return null; }
  }

  function dispatch(payload) {
    var visible = !document.hidden && document.hasFocus();
    if (visible && typeof st.onToast === 'function') {
      try { st.onToast(payload); return; } catch (e) { }
    }
    show(payload);
  }

  function show(payload) {
    var title = payload.title || st.app;
    var opts = {
      body: payload.body || '',
      tag: payload.tag || ('lemon-' + Date.now()),
      icon: payload.icon || undefined,
      badge: payload.badge || undefined,
      renotify: !!payload.tag,
      data: { url: payload.url || location.href }
    };
    function fallback() {
      try {
        var n = new Notification(title, opts);
        n.onclick = function () { try { window.focus(); } catch (e) { } if (payload.url) location.href = payload.url; n.close(); };
      } catch (e) { }
    }
    if (!supported() || permission() !== 'granted') { fallback(); return; }
    var reg = st.swReg;
    if (reg && reg.showNotification) {
      try {
        var pr = reg.showNotification(title, opts);
        if (pr && pr.catch) pr.catch(fallback);
        return;
      } catch (e) { }
    }
    if (!reg && navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (r) {
        if (r && r.showNotification) { r.showNotification(title, opts).catch(fallback); }
        else fallback();
      }).catch(fallback);
      return;
    }
    fallback();
  }

  function init(opts) {
    opts = opts || {};
    if (opts.app) st.app = opts.app;
    if (typeof opts.onPush === 'function') st.onPush = opts.onPush;
    if (typeof opts.onToast === 'function') st.onToast = opts.onToast;
    loadFlag();
    registerSW();
    connect();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        var d = e.data || {};
        if (d && d.type === 'push') dispatch(d.payload || {});
      });
    }
    return st;
  }

  function enable() {
    if (!supported()) return Promise.resolve(false);
    if (Notification.permission === 'granted') {
      st.enabled = true; saveFlag(); registerSW(); connect();
      return Promise.resolve(true);
    }
    if (Notification.permission === 'denied') return Promise.resolve(false);
    return Notification.requestPermission().then(function (p) {
      st.enabled = (p === 'granted');
      saveFlag();
      if (st.enabled) { registerSW(); connect(); }
      return st.enabled;
    }).catch(function () { return false; });
  }

  function disable() {
    st.enabled = false;
    saveFlag();
    try {
      if (st.swReg && st.swReg.getNotifications) {
        st.swReg.getNotifications().then(function (list) { (list || []).forEach(function (n) { n.close(); }); }).catch(function () { });
      }
    } catch (e) { }
  }

  function notify(payload) {
    payload = payload || {};
    if (!st.enabled || permission() !== 'granted') return false;
    dispatch(payload);
    return true;
  }

  function send(payload) {
    var ch = connect();
    if (!ch || !st.ready) return Promise.reject(new Error('push-not-ready'));
    return ch.send({ type: 'broadcast', event: 'push', payload: payload }).then(function (r) { return r; });
  }

  function onPush(cb) { st.onPush = cb; }

  window.LemonPush = {
    init: init,
    enable: enable,
    disable: disable,
    isEnabled: function () { return !!st.enabled && permission() === 'granted'; },
    permission: permission,
    supported: supported,
    notify: notify,
    send: send,
    onPush: onPush,
    onSubscribers: function (cb) { st.onSubscribers = cb; if (cb) cb(st.count); },
    state: function () { return { enabled: st.enabled, ready: st.ready, count: st.count, app: st.app }; },
    registerSW: registerSW
  };
})();
