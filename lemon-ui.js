/* ============================================================
   Lemon soft · Shared UI runtime
   theme · toast · ripple · tabs · archive · download · reveal
   ============================================================ */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  /* ---------------- storage ---------------- */
  var lastStoreError = null;
  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || ''));
  }

  /* ---- IndexedDB fallback ----
     localStorage(약 5MB)가 꽉 차 QuotaExceededError 가 나면, 같은 키를
     IndexedDB(lemon_kv_idb_v1 · store 'kv')에 { key, value, ts } 로 이어서 저장한다.
     새로고침하면 이 값을 먼저 메모리(memStore)로 올리므로 store.get/raw,
     makeArchive, Lemon.project 같은 호출부는 아무것도 바꾸지 않아도 된다. */
  var IDB_NAME = 'lemon_kv_idb_v1';
  var IDB_STORE = 'kv';
  var MEM_MISS = {};
  var memStore = {};      /* key -> 파싱된 값 (IndexedDB 사본·이번 세션 저장본) */
  var memText = {};       /* key -> 저장된 원본 문자열 (rawGet/rawSet 용) */
  var idbSaved = {};      /* key -> true: IndexedDB 사본이 최신 저장본 */
  var idbSeq = {};        /* key -> 마지막 쓰기 순번 (늦게 끝난 옛 쓰기가 새 값을 덮지 않게) */
  var pendingWrites = {}; /* key -> { text, seq }: 복원 전에 온 저장 요청 */
  var pendingOrder = [];
  var idbTail = {};       /* key -> IndexedDB 작업 직렬화 꼬리 */
  var idbDb = null, idbOpenP = null;
  var hydrated = false, hydrateP = null, readyQ = [], idbNoticeShown = false;

  function emit(name, detail) {
    try { doc.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { }
  }
  function safeParse(text, fallback) {
    try { return JSON.parse(text); } catch (e) { return fallback; }
  }
  function safeStringify(v) {
    try { var s = JSON.stringify(v); return s === undefined ? '' : s; } catch (e) { return ''; }
  }
  function idbUsable() { return !!window.indexedDB; }

  function idbOpen() {
    if (idbDb) return Promise.resolve(idbDb);
    if (idbOpenP) return idbOpenP;
    idbOpenP = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('no-indexeddb')); return; }
      var rq;
      try { rq = indexedDB.open(IDB_NAME, 1); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      };
      rq.onsuccess = function () { idbDb = rq.result; res(idbDb); };
      rq.onerror = function () { rej(rq.error || new Error('idb-open')); };
      rq.onblocked = function () { rej(new Error('idb-blocked')); };
    });
    /* 실패하면 다음 호출에서 다시 시도할 수 있게 열기 상태를 비운다. */
    idbOpenP = idbOpenP.then(function (db) { return db; }, function (err) { idbOpenP = null; throw err; });
    return idbOpenP;
  }

  /* 같은 키의 IndexedDB 작업은 보낸 순서대로 하나씩 처리한다. */
  function idbQueue(key, fn) {
    var prev = idbTail[key] || Promise.resolve();
    var next = prev.then(fn, fn);
    idbTail[key] = next.then(function () { }, function () { });
    return next;
  }

  function idbWrite(key, fn) {
    return idbQueue(key, function () {
      return idbOpen().then(function (db) {
        return new Promise(function (res, rej) {
          var tx, st;
          try {
            tx = db.transaction(IDB_STORE, 'readwrite');
            st = tx.objectStore(IDB_STORE);
            fn(st);
          } catch (e) { rej(e); return; }
          tx.oncomplete = function () { res(true); };
          tx.onerror = function () { rej(tx.error || new Error('idb-tx')); };
          tx.onabort = function () { rej(tx.error || new Error('idb-abort')); };
        });
      });
    });
  }
  function idbPut(key, text) {
    return idbWrite(key, function (st) { st.put({ key: key, value: text, ts: Date.now() }); });
  }
  function idbDrop(key) {
    return idbWrite(key, function (st) { st.delete(key); });
  }
  function idbGetAll() {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var rq;
        try { rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll(); }
        catch (e) { rej(e); return; }
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error || new Error('idb-read')); };
      });
    });
  }

  function memSet(key, text) {
    memText[key] = text;
    delete memStore[key];
    var v = safeParse(text, MEM_MISS);
    if (v !== MEM_MISS) memStore[key] = v;
  }

  /* IndexedDB 는 비동기라 페이지가 먼저 그려지면 옛 화면이 보일 수 있다.
     같은 탭에서만 쓰는 sessionStorage 에 같은 값을 복사해 두면, Lemon.ready 를
     부르지 않는 페이지도 첫 화면부터 복원된 값을 동기적으로 읽을 수 있다.
     (sessionStorage 한도도 넘으면 조용히 건너뛴다. 원본은 IndexedDB 에 있다.) */
  var SESS_PREFIX = 'lemonkv:';
  var SESS_RELOAD_KEY = 'lemonkv:boot-reloaded';
  var bootReloaded = false;
  var stalePage = false;   /* 복원보다 먼저 그려진 화면: 다시 불러오기 전까지 저장을 받지 않는다 */
  function sessPut(key, text) {
    try { sessionStorage.setItem(SESS_PREFIX + key, text); return true; } catch (e) { return false; }
  }
  function sessDrop(key) {
    try { sessionStorage.removeItem(SESS_PREFIX + key); } catch (e) { }
  }
  function sessSeed() {
    var n = 0;
    try {
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (!k || k.indexOf(SESS_PREFIX) !== 0) continue;
        var text = sessionStorage.getItem(k);
        if (text === null) continue;
        memSet(k.slice(SESS_PREFIX.length), text);
        n += 1;
      }
    } catch (e) { }
    return n;
  }

  /* localStorage 쓰기가 한도 초과로 막혔을 때: 메모리에 먼저 반영하고 IndexedDB에 저장한다.
     IndexedDB 저장까지 성공하면 남아 있던 옛 localStorage 사본을 지워 새 값이 가려지지 않게 한다. */
  function idbFallback(key, text, seq) {
    if (!idbUsable()) return false;
    memSet(key, text);
    sessPut(key, text);
    var startNotice = !idbNoticeShown;
    idbSaved[key] = true;
    idbPut(key, text).then(function () {
      if (idbSeq[key] !== seq) return;              /* 그 사이 더 새 값이 저장됨 */
      try { localStorage.removeItem(key); } catch (e) { }
      if (startNotice) {
        idbNoticeShown = true;
        toast('저장 공간이 부족해 IndexedDB에 자동으로 이어서 저장했어요', 'info');
      }
      emit('lemon:idb-saved', { key: key });
    }).catch(function (err) {
      idbSaved[key] = false;
      lastStoreError = err;
      storageWarn({ key: key });
      emit('lemon:idb-error', { key: key, error: err });
    });
    return true;
  }

  function writeKey(key, text) {
    var seq = (idbSeq[key] || 0) + 1;
    idbSeq[key] = seq;
    /* 복원이 끝나기 전에 들어온 저장 요청은 바로 쓰지 않고 잠시 모아 둔다.
       (그 화면은 아직 IndexedDB 값을 못 본 상태라, 빈 상태로 덮어쓰면 데이터가 사라진다) */
    if (!hydrated) {
      if (!pendingWrites[key]) pendingOrder.push(key);
      pendingWrites[key] = { text: text, seq: seq };
      return true;
    }
    /* 복원보다 먼저 그려진 낡은 화면의 저장은 받지 않는다 (IndexedDB 사본을 덮지 않게). */
    if (stalePage) return true;
    try {
      localStorage.setItem(key, text);
      lastStoreError = null;
      /* localStorage 에 들어갔으니 메모리 캐시와 IndexedDB·sessionStorage 사본은 정리한다. */
      delete memText[key];
      delete memStore[key];
      sessDrop(key);
      if (idbSaved[key]) {
        idbSaved[key] = false;
        if (idbUsable()) idbDrop(key).catch(function () { });
      }
      return true;
    } catch (e) {
      lastStoreError = e;
      if (isQuotaError(e)) {
        if (idbFallback(key, text, seq)) return true;
        storageWarn({ key: key });
      }
      return false;
    }
  }

  var store = {
    get: function (key, fallback) {
      if (memStore.hasOwnProperty(key)) return memStore[key];
      if (memText.hasOwnProperty(key)) return safeParse(memText[key], fallback);
      try {
        var raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    /* 한도 초과 시 IndexedDB로 이어서 저장한다. IndexedDB 저장까지 실패했을 때만 false. */
    set: function (key, value) {
      var text;
      try { text = JSON.stringify(value); } catch (e) { lastStoreError = e; return false; }
      if (text === undefined) return false;
      return writeKey(key, text);
    },
    raw: function (key, fallback) {
      if (memText.hasOwnProperty(key)) return memText[key];
      try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    rawSet: function (key, value) { return writeKey(key, String(value)); },
    /* 저장된 값을 지운다 (localStorage · 메모리 · IndexedDB 사본 모두). */
    remove: function (key) {
      try { localStorage.removeItem(key); } catch (e) { }
      delete memText[key];
      delete memStore[key];
      sessDrop(key);
      idbSaved[key] = false;
      idbSeq[key] = (idbSeq[key] || 0) + 1;   /* 진행 중이던 옛 쓰기가 되살리지 않게 */
      if (idbUsable()) idbDrop(key).catch(function () { });
      return true;
    },
    /* 이 키가 지금 어디에 저장돼 있는지: 'idb' | 'ls' | null */
    source: function (key) {
      if (idbSaved[key] || memText.hasOwnProperty(key)) return 'idb';
      try { return localStorage.getItem(key) === null ? null : 'ls'; } catch (e) { return null; }
    },
    lastError: function () { return lastStoreError; },
    isQuotaError: isQuotaError
  };

  /* 새 탭처럼 sessionStorage 미러가 빈 상태에서 IndexedDB 값을 뒤늦게 읽으면,
     이미 그려 놓은 페이지(Lemon.ready 를 부르지 않는 페이지)는 빈 화면을 보여 준다.
     그대로 두면 그 빈 상태가 저장돼 IndexedDB 사본을 덮을 수 있으므로,
     탭마다 한 번만 다시 불러와 미러를 동기로 읽게 한다. */
  function maybeBootReload(late, mirrored) {
    if (!late || !mirrored || bootReloaded) return;
    if (doc.readyState === 'loading') return;      /* 아직 그리기 전: 그릴 때부터 값이 보인다 */
    if (readyQ.length) return;                     /* Lemon.ready 로 기다리는 페이지는 직접 처리 */
    try {
      if (sessionStorage.getItem(SESS_RELOAD_KEY) === '1') return;
      sessionStorage.setItem(SESS_RELOAD_KEY, '1');
    } catch (e) { return; }                        /* 기록할 수 없으면 반복 새로고침을 피한다 */
    bootReloaded = true;
    stalePage = true;                              /* 이 화면의 상태는 낡았다: 저장을 막고 새로 불러온다 */
    try { location.reload(); } catch (e) { }
  }

  /* 복원 전에 모아 둔 쓰기를 처리한다: IndexedDB 사본과 같은 내용이면 버리고,
     다른 내용이면 복원된 값을 살리고 화면을 다시 부른다. */
  function takePending(key, restoredText) {
    var item = pendingWrites[key];
    if (!item) return false;
    delete pendingWrites[key];
    return item.text !== restoredText;      /* true = 화면이 낡은 상태에서 쓴 값 */
  }

  function flushPending() {
    var keys = pendingOrder;
    pendingOrder = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], item = pendingWrites[key];
      if (!item) continue;
      delete pendingWrites[key];
      if (idbSeq[key] !== item.seq) continue;   /* 그 사이 지워진 키 */
      writeKey(key, item.text);
    }
  }

  /* 새로고침 시: IndexedDB 에 넘겨 저장했던 키들을 메모리로 복원한다. */
  function finishHydrate(n, mirrored, overrode) {
    if (hydrated) return;
    hydrated = true;
    flushPending();
    var q = readyQ;
    readyQ = [];
    for (var i = 0; i < q.length; i++) { try { q[i](n); } catch (e) { } }
    emit('lemon:idb-hydrated', { count: n });
    maybeBootReload(n > 0 || overrode, mirrored);
  }

  function hydrate() {
    if (hydrateP) return hydrateP;
    var job = idbUsable() ? idbGetAll() : Promise.reject(new Error('no-indexeddb'));
    hydrateP = job.then(function (list) {
      var n = 0, mirrored = 0, overrode = false;
      (list || []).forEach(function (rec) {
        if (!rec || rec.key === undefined || rec.key === null) return;
        var key = String(rec.key);
        if (idbSaved[key]) return;                         /* 이번 세션에서 이미 IDB 로 저장됨 */
        var text = typeof rec.value === 'string' ? rec.value : safeStringify(rec.value);
        if (!text) return;
        if (takePending(key, text)) {
          /* 복원 전 낙은 화면이 쓴 값이다: 버리고 IndexedDB 사본을 살린다 */
          overrode = true;
          try { localStorage.removeItem(key); } catch (e) { }
        }
        memSet(key, text);
        if (sessPut(key, text)) mirrored += 1;              /* 다음 로드에서는 동기로 읽힌다 */
        idbSaved[key] = true;
        n += 1;
      });
      return { n: n, mirrored: mirrored, overrode: overrode };
    }).then(function (r) { finishHydrate(r.n, r.mirrored, r.overrode); return r.n; },
            function () { finishHydrate(0, 0, false); return 0; });
    return hydrateP;
  }

  /* lemon:idb-hydrated 이후(= IndexedDB 복원 완료)에 실행. 이미 끝났으면 즉시. */
  function ready(fn) {
    if (typeof fn !== 'function') return;
    if (hydrated) { try { fn(); } catch (e) { } return; }
    readyQ.push(fn);
  }

  /* ---------------- storage-full warning ---------------- */
  /* Shown instead of silently deleting data. Cooldown + closeable so it never nags. */
  var WARN_COOLDOWN = 45000;
  var WARN_MUTE_KEY = 'lemon_storage_warn_muted';
  var warnEl = null, warnAt = 0, warnMuted = false;

  /* [다시 보지 않기] 상태: 메모리 → sessionStorage → localStorage → IndexedDB 순으로 확인한다.
     localStorage 가 꽉 차 못 쓰는 경우가 바로 이 경고의 상황이라 sessionStorage·IDB 에도 남긴다. */
  function warnMutedNow() {
    if (warnMuted) return true;
    try { if (sessionStorage.getItem(WARN_MUTE_KEY) === '1') return (warnMuted = true); } catch (e) { }
    try { if (localStorage.getItem(WARN_MUTE_KEY) === '1') return (warnMuted = true); } catch (e) { }
    if (store.raw(WARN_MUTE_KEY, '') === '1') return (warnMuted = true);
    return false;
  }
  function setWarnMuted(on) {
    warnMuted = !!on;
    try {
      if (on) sessionStorage.setItem(WARN_MUTE_KEY, '1');
      else sessionStorage.removeItem(WARN_MUTE_KEY);
    } catch (e) { }
    if (on) store.rawSet(WARN_MUTE_KEY, '1');          /* localStorage 가 꽉 차면 IndexedDB 로 */
    else store.remove(WARN_MUTE_KEY);
    try { doc.dispatchEvent(new CustomEvent('lemon:storage-warn-mute', { detail: { muted: warnMuted } })); } catch (e) { }
  }
  try {
    window.addEventListener('storage', function (e) {
      if (e && e.key === WARN_MUTE_KEY) warnMuted = e.newValue === '1';
    });
  } catch (e) { }

  function kitStyle() {
    if (doc.getElementById('lemonKitStyle')) return;
    var st = doc.createElement('style');
    st.id = 'lemonKitStyle';
    st.textContent = [
      '.as-badge[data-state="full"]{color:#e11d48;border-color:rgba(225,29,72,.42);background:rgba(225,29,72,.10)}',
      '.dark .as-badge[data-state="full"]{color:#fb7185;border-color:rgba(251,113,133,.42);background:rgba(225,29,72,.16)}',
      '.as-badge[data-state="idb"]{color:#0f766e;border-color:rgba(13,148,136,.42);background:rgba(13,148,136,.10)}',
      '.dark .as-badge[data-state="idb"]{color:#2dd4bf;border-color:rgba(45,212,191,.40);background:rgba(13,148,136,.16)}',
      '.as-badge[data-state="idb"]::before{opacity:1}',
      '.as-badge[data-state="full"]::before{opacity:1;animation:pulseSoft 1.4s ease-in-out infinite}',
      '.lemon-storage-warn{position:fixed;top:.75rem;left:50%;z-index:88;width:min(96vw,34rem);',
      'transform:translate(-50%,-150%);opacity:0;pointer-events:none;',
      'display:flex;align-items:flex-start;gap:.7rem;padding:.8rem .85rem;border-radius:1.1rem;',
      'background:rgba(255,255,255,.97);border:1px solid #fecdd3;',
      'box-shadow:0 24px 60px -26px rgba(225,29,72,.55),0 2px 6px rgba(16,16,20,.06);',
      'transition:transform .38s cubic-bezier(.22,1,.36,1),opacity .28s ease;}',
      '.dark .lemon-storage-warn{background:rgba(22,16,19,.97);border-color:rgba(225,29,72,.45);',
      'box-shadow:0 26px 64px -28px rgba(0,0,0,.9),0 0 0 1px rgba(225,29,72,.16);}',
      '.lemon-storage-warn.show{transform:translate(-50%,0);opacity:1;pointer-events:auto;}',
      '.lemon-storage-warn .lsw-ico{width:2rem;height:2rem;border-radius:.7rem;flex-shrink:0;',
      'display:inline-flex;align-items:center;justify-content:center;color:#fff;',
      'background:linear-gradient(135deg,#f43f5e,#e11d48);box-shadow:0 8px 18px -10px rgba(225,29,72,.9)}',
      '.lemon-storage-warn .lsw-ico svg{width:1.05rem;height:1.05rem}',
      '.lemon-storage-warn .lsw-body{min-width:0;flex:1}',
      '.lemon-storage-warn .lsw-title{margin:0;font-size:.78rem;font-weight:800;color:#111114;letter-spacing:-.01em}',
      '.dark .lemon-storage-warn .lsw-title{color:#fafafa}',
      '.lemon-storage-warn .lsw-text{margin:.15rem 0 0;font-size:.7rem;line-height:1.55;color:#52525b}',
      '.dark .lemon-storage-warn .lsw-text{color:#a1a1aa}',
      '.lemon-storage-warn .lsw-act{display:flex;align-items:center;gap:.3rem;flex-shrink:0;padding-top:.05rem}',
      '.lemon-storage-warn .lsw-mute{display:inline-flex;align-items:center;justify-content:center;padding:.42rem .5rem;',
      'border-radius:.7rem;font-size:.66rem;font-weight:800;color:#71717a;white-space:nowrap;letter-spacing:-.01em;',
      'border:1px solid transparent;transition:background .18s,color .18s,border-color .18s}',
      '.lemon-storage-warn .lsw-mute:hover{background:rgba(0,0,0,.05);color:#18181b;border-color:rgba(0,0,0,.08)}',
      '.dark .lemon-storage-warn .lsw-mute{color:#a1a1aa}',
      '.dark .lemon-storage-warn .lsw-mute:hover{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.12)}',
      '.lemon-storage-warn .lsw-open{display:inline-flex;align-items:center;gap:.28rem;padding:.42rem .6rem;border-radius:.7rem;',
      'font-size:.68rem;font-weight:800;color:#fff;white-space:nowrap;',
      'background:linear-gradient(135deg,#e11d48,#be123c);box-shadow:0 8px 18px -12px rgba(225,29,72,.9);',
      'transition:transform .14s ease,filter .2s ease}',
      '.lemon-storage-warn .lsw-open:hover{filter:brightness(1.06);transform:translateY(-1px)}',
      '.lemon-storage-warn .lsw-open:active{transform:scale(.95)}',
      '.lemon-storage-warn .lsw-open svg{width:.8rem;height:.8rem}',
      '.lemon-storage-warn .lsw-close{width:1.6rem;height:1.6rem;border-radius:.55rem;display:inline-flex;',
      'align-items:center;justify-content:center;color:#71717a;border:1px solid transparent;transition:background .18s,color .18s}',
      '.lemon-storage-warn .lsw-close:hover{background:rgba(0,0,0,.06);color:#18181b}',
      '.dark .lemon-storage-warn .lsw-close:hover{background:rgba(255,255,255,.10);color:#fff}',
      '.lemon-storage-warn .lsw-close svg{width:.8rem;height:.8rem}',
      '@media (max-width:420px){.lemon-storage-warn{width:calc(100vw - 1rem);padding:.7rem;gap:.55rem;',
      'flex-wrap:wrap}.lemon-storage-warn .lsw-act{width:100%;justify-content:flex-end;flex-wrap:wrap}}'
    ].join('');
    (doc.head || doc.documentElement).appendChild(st);
  }

  function managerHref() {
    try { return new URL('manager.html', location.href).href; } catch (e) { return 'manager.html'; }
  }

  function closeStorageWarn() {
    if (!warnEl) return;
    var el = warnEl;
    warnEl = null;
    el.classList.remove('show');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 360);
  }

  function storageWarn(opts) {
    opts = opts || {};
    /* 사용자가 '다시 보지 않기'를 눌렀다면 자동 경고는 쉰다. force(미리보기)는 예외. */
    if (!opts.force && warnMutedNow()) return null;
    kitStyle();
    if (warnEl) { warnEl.classList.add('show'); return warnEl; }
    var now = Date.now();
    if (!opts.force && now - warnAt < WARN_COOLDOWN) return null;
    warnAt = now;

    var el = doc.createElement('div');
    el.id = 'lemonStorageWarn';
    el.className = 'lemon-storage-warn';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<span class="lsw-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>' +
      '<line x1="12" y1="9" x2="12" y2="13.6"></line><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"></circle></svg></span>' +
      '<div class="lsw-body">' +
      '<p class="lsw-title">저장 공간이 부족해요</p>' +
      '<p class="lsw-text">저장 공간(LocalStorage·IndexedDB)이 부족해 변경 사항을 저장하지 못했어요. 기존 데이터는 삭제되지 않았습니다. Lemon Manager에서 용량을 확인하고 불필요한 데이터를 정리해 주세요.</p>' +
      '</div>' +
      '<div class="lsw-act">' +
      '<button class="lsw-mute" type="button">다시 보지 않기</button>' +
      '<a class="lsw-open" href="' + managerHref() + '">Lemon Manager 열기' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M9 7h8v8"></path></svg></a>' +
      '<button class="lsw-close" type="button" aria-label="경고 닫기">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg></button>' +
      '</div>';
    doc.body.appendChild(el);
    el.querySelector('.lsw-close').addEventListener('click', closeStorageWarn);
    el.querySelector('.lsw-mute').addEventListener('click', function () {
      setWarnMuted(true);
      closeStorageWarn();
      toast('저장 공간 경고를 다시 보지 않아요', 'info');
      hap(10);
    });
    void el.offsetWidth;
    el.classList.add('show');
    warnEl = el;
    try {
      doc.dispatchEvent(new CustomEvent('lemon:storage-full', { detail: { key: opts.key || null, error: lastStoreError } }));
    } catch (e) { }
    return el;
  }

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && warnEl) closeStorageWarn();
  });

  /* ---------------- haptics ---------------- */
  var _acted = false;
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) {
    doc.addEventListener(t, function () { _acted = true; }, { once: true, passive: true });
  });
  function hap(ms) {
    try { if (_acted && navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { }
  }

  /* ---------------- toast ---------------- */
  var ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="4 12 9 17 20 6"></polyline></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="9" x2="12" y2="16"></line><circle cx="12" cy="5.5" r="1.2" fill="currentColor" stroke="none"></circle></svg>'
  };
  var toastTimer = null;
  function toast(msg, type) {
    var el = doc.getElementById('lemonToast');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'lemonToast';
      el.className = 'lemon-toast';
      el.setAttribute('role', 'status');
      doc.body.appendChild(el);
    }
    type = type || 'ok';
    el.className = 'lemon-toast ' + type;
    el.innerHTML = '<span class="lt-ico">' + (ICONS[type] || ICONS.ok) + '</span><span class="lt-msg"></span>';
    el.querySelector('.lt-msg').textContent = msg;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2500);
  }

  /* ---------------- copy / download ---------------- */
  function copy(text, okMsg) {
    var done = function () { toast(okMsg || '클립보드에 복사했어요', 'ok'); hap(10); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    try { doc.execCommand('copy'); done(); } catch (e) { toast('복사에 실패했어요', 'err'); }
    doc.body.removeChild(ta);
  }
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url; a.download = name;
    doc.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); doc.body.removeChild(a); }, 1200);
  }
  function download(name, data, mime) {
    if (data instanceof Blob) return downloadBlob(name, data);
    var blob = new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
    downloadBlob(name, blob);
  }

  /* ---------------- formatting ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }
  function fmtDateTime(ts) {
    var d = new Date(ts || Date.now());
    return fmtDate(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function timeAgo(ts) {
    var s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전';
    return fmtDate(ts);
  }
  function fmtBytes(b) {
    if (!b && b !== 0) return '-';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i === 0 ? b : b.toFixed(b < 10 ? 2 : 1)) + ' ' + u[i];
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- theme ---------------- */
  function isDark() { return root.classList.contains('dark'); }
  function setTheme(mode, silent) {
    var dark = mode === 'dark';
    root.classList.toggle('dark', dark);
    store.rawSet('cream_theme', dark ? 'dark' : 'light');
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#09090b' : '#ffffff');
    doc.dispatchEvent(new CustomEvent('lemon:theme', { detail: { dark: dark } }));
    if (!silent) { toast(dark ? '다크 모드로 전환했어요' : '라이트 모드로 전환했어요', 'info'); hap(8); }
  }
  function toggleTheme() { setTheme(isDark() ? 'light' : 'dark'); }

  /* ---------------- global animation mode ----------------
     Developer Hub의 '애니메이션 줄이기/끄기' 설정(lemon_anim_mode)을
     이 런타임을 쓰는 모든 서비스가 함께 따른다. */
  var ANIM_KEY = 'lemon_anim_mode';
  function readAnimMode() {
    try {
      var m = store.raw(ANIM_KEY, null);
      if (m === null || m === undefined) m = localStorage.getItem(ANIM_KEY);
      m = String(m == null ? 'full' : m).replace(/^"|"$/g, '');
      return (m === 'reduced' || m === 'off') ? m : 'full';
    } catch (e) { return 'full'; }
  }
  function applyAnimMode(mode) {
    if (mode !== 'full' && mode !== 'reduced' && mode !== 'off') mode = 'full';
    root.setAttribute('data-anim', mode);
    doc.dispatchEvent(new CustomEvent('lemon:anim', { detail: { mode: mode } }));
    return mode;
  }
  function setAnimMode(mode) {
    mode = (mode === 'reduced' || mode === 'off') ? mode : 'full';
    try { localStorage.setItem(ANIM_KEY, mode); } catch (e) { }
    return applyAnimMode(mode);
  }
  function bindAnim() {
    applyAnimMode(readAnimMode());
    window.addEventListener('storage', function (e) {
      if (e.key === ANIM_KEY) applyAnimMode(e.newValue);
    });
  }

  function bindTheme() {
    var btns = doc.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) { e.preventDefault(); toggleTheme(); });
    }
    var saved = store.raw('cream_theme', null);
    if (saved) root.classList.toggle('dark', saved === 'dark');
  }

  /* ---------------- ripple ---------------- */
  function bindRipple() {
    doc.addEventListener('pointerdown', function (e) {
      var t = e.target.closest ? e.target.closest('.btn-tap, .primary-btn, .pill-btn, .ghost-btn, .nav-tab, .ripple') : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var span = doc.createElement('span');
      span.className = 'click-ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - r.left - size / 2) + 'px';
      span.style.top = (e.clientY - r.top - size / 2) + 'px';
      var cs = getComputedStyle(t);
      if (cs.position === 'static') t.style.position = 'relative';
      if (cs.overflow === 'visible') t.style.overflow = 'hidden';
      t.appendChild(span);
      setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, 640);
    }, { passive: true });
  }

  /* ---------------- tabs ---------------- */
  function initTabs(defaultView) {
    var btns = Array.prototype.slice.call(doc.querySelectorAll('[data-tab]'));
    var panels = Array.prototype.slice.call(doc.querySelectorAll('[data-view]'));
    if (!panels.length) return function () { };

    function go(id, silent) {
      var found = false;
      panels.forEach(function (p) {
        var on = p.getAttribute('data-view') === id;
        if (on) found = true;
        p.classList.toggle('hidden', !on);
        if (on) {
          p.classList.remove('view-anim');
          void p.offsetWidth;
          p.classList.add('view-anim');
        }
      });
      if (!found) return;
      btns.forEach(function (b) {
        var on = b.getAttribute('data-tab') === id;
        b.classList.toggle('nav-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (!silent) {
        hap(10);
        try { history.replaceState(null, '', '#' + id); } catch (e) { }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      doc.dispatchEvent(new CustomEvent('lemon:view', { detail: { view: id } }));
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); go(b.getAttribute('data-tab')); });
    });

    var hash = (location.hash || '').replace('#', '');
    var names = panels.map(function (p) { return p.getAttribute('data-view'); });
    go(names.indexOf(hash) > -1 ? hash : (defaultView || names[0]), true);
    return go;
  }

  /* ---------------- archive ---------------- */
  function makeArchive(key, max) {
    max = max || 16;
    function all() {
      var list = store.get(key, []);
      return Array.isArray(list) ? list : [];
    }
    /* On failure nothing is trimmed, nothing is overwritten: the previous value stays intact. */
    var saveOk = true;
    function save(list) {
      saveOk = store.set(key, list);
      return saveOk;
    }
    return {
      key: key,
      all: all,
      add: function (item) {
        var list = all();
        var rec = Object.assign({ id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now() }, item);
        list.unshift(rec);
        list = list.slice(0, max);
        var ok = save(list);
        return ok ? rec : null;
      },
      remove: function (id) {
        var list = all().filter(function (x) { return x.id !== id; });
        save(list);
        return list;
      },
      update: function (id, patch) {
        var list = all();
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === id) {
            list[i] = Object.assign({}, list[i], patch, { ts: Date.now() });
            save(list);
            return list[i];
          }
        }
        return null;
      },
      save: save,
      saveOk: function () { return saveOk; },
      clear: function () { return store.set(key, []); },
      count: function () { return all().length; }
    };
  }

  /* ---------------- project autosave ---------------- */
  /* Keeps one archive record per working project: edits upsert the same id,
     "새로 만들기" starts a fresh record so earlier work stays in the archive. */
  function project(key, opts) {
    opts = opts || {};
    var arch = makeArchive(key, opts.max || 20);
    var ACTIVE = key + '__active';
    var timer = null, pending = null, badge = null;

    /* IndexedDB 저장까지 실패한 경우에만 경고 배지로 돌린다. */
    doc.addEventListener('lemon:idb-error', function (e) {
      var k = e.detail && e.detail.key;
      if (k === key || k === ACTIVE) setBadge('저장 공간 부족', 'full');
    });

    function currentId() { var v = store.raw(ACTIVE, ''); return v || null; }
    function stamp() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function setBadge(text, state) {
      if (!badge) return;
      badge.textContent = text;
      badge.setAttribute('data-state', state || 'idle');
    }
    function flush() {
      timer = null;
      if (!pending) return null;
      var payload;
      try { payload = pending(); } catch (e) { return null; }
      if (!payload) return null;
      var id = currentId();
      var rec = id ? arch.update(id, Object.assign({}, payload, { auto: true })) : null;
      if (!rec) rec = arch.add(Object.assign({}, payload, { auto: true }));
      if (rec && arch.saveOk()) {
        store.rawSet(ACTIVE, rec.id);
        /* localStorage 가 꽉 차 IndexedDB 로 넘겨 저장된 경우도 정상 저장으로 보여 준다. */
        if (store.source(key) === 'idb' || store.source(ACTIVE) === 'idb') setBadge('자동 저장됨 (IDB) ' + stamp(), 'idb');
        else setBadge('자동 저장됨 ' + stamp(), 'saved');
        return rec;
      }
      /* Storage is full: keep what the user has, say so plainly. */
      setBadge('저장 공간 부족', 'full');
      storageWarn();
      return null;
    }
    var api = {
      archive: arch,
      id: currentId,
      bind: function (el) {
        if (typeof el === 'string' && el.charAt(0) !== '#' && el.charAt(0) !== '[') el = '#' + el;
        badge = typeof el === 'string' ? doc.querySelector(el) : el;
        if (!badge) return;
        if (!badge.classList.contains('as-badge')) badge.classList.add('as-badge');
        setBadge(currentId() ? '자동 저장됨' : '자동 저장 대기', currentId() ? 'saved' : 'idle');
      },
      badgeState: function (text, state) { setBadge(text, state); },
      touch: function (fn) {
        pending = fn;
        setBadge('저장 중…', 'saving');
        clearTimeout(timer);
        timer = setTimeout(flush, opts.delay || 1200);
      },
      flushNow: function (fn) {
        if (fn) pending = fn;
        clearTimeout(timer);
        return flush();
      },
      newProject: function () {
        if (pending) flush();
        clearTimeout(timer);
        timer = null;
        pending = null;
        store.rawSet(ACTIVE, '');
        setBadge('새 프로젝트', 'new');
      },
      restore: function (id) {
        var list = arch.all();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
      },
      openProject: function (id) { store.rawSet(ACTIVE, id); setBadge('자동 저장됨 ' + stamp(), 'saved'); }
    };
    return api;
  }

  /* ---------------- reveal on scroll ---------------- */
  function reveal() {
    var els = doc.querySelectorAll('.fade-up:not(.in)');
    if (!('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) els[i].classList.add('in');
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  /* ---------------- 3D tilt ---------------- */
  function tilt(el, max) {
    if (!el) return;
    max = max || 10;
    var rect = null;
    function move(e) {
      if (!rect) rect = el.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width - 0.5;
      var y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = 'perspective(1100px) rotateY(' + (x * max).toFixed(2) + 'deg) rotateX(' + (-y * max).toFixed(2) + 'deg) scale(1.015)';
      var glare = el.querySelector('.tilt-glare');
      if (glare) {
        glare.style.background = 'radial-gradient(circle at ' + ((x + 0.5) * 100).toFixed(0) + '% ' + ((y + 0.5) * 100).toFixed(0) + '%, rgba(255,255,255,.30), transparent 55%)';
      }
    }
    function leave() {
      el.style.transform = '';
      var glare = el.querySelector('.tilt-glare');
      if (glare) glare.style.background = 'transparent';
      rect = null;
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointercancel', leave);
  }

  /* ---------------- confetti ---------------- */
  function confetti(n) {
    n = n || 26;
    var colors = ['var(--brand)', 'var(--brand-2)', '#fbbf24', '#ffffff'];
    for (var i = 0; i < n; i++) {
      var p = doc.createElement('div');
      p.style.position = 'fixed';
      p.style.left = (45 + Math.random() * 10) + 'vw';
      p.style.top = (32 + Math.random() * 12) + 'vh';
      p.style.width = (5 + Math.random() * 6) + 'px';
      p.style.height = (5 + Math.random() * 8) + 'px';
      p.style.borderRadius = '2px';
      p.style.background = colors[i % colors.length];
      p.style.pointerEvents = 'none';
      p.style.zIndex = '999';
      p.style.opacity = '1';
      p.style.transform = 'translate(0,0) rotate(0deg)';
      p.style.transition = 'transform 1.1s cubic-bezier(.2,.7,.3,1), opacity 1.1s ease-out';
      doc.body.appendChild(p);
      (function (node) {
        var tx = (Math.random() - 0.5) * 340;
        var ty = 220 + Math.random() * 260;
        var rot = (Math.random() - 0.5) * 720;
        requestAnimationFrame(function () {
          node.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotate(' + rot + 'deg)';
          node.style.opacity = '0';
        });
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1400);
      })(p);
    }
  }

  /* ---------------- range fill helper ---------------- */
  function refreshRange(input) {
    var min = parseFloat(input.min || 0), max = parseFloat(input.max || 100);
    var val = parseFloat(input.value);
    var pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--pct', pct + '%');
  }
  function bindRanges() {
    var list = doc.querySelectorAll('input[type="range"].lemon-range');
    for (var i = 0; i < list.length; i++) {
      (function (r) {
        refreshRange(r);
        r.addEventListener('input', function () { refreshRange(r); });
      })(list[i]);
    }
  }

  /* ---------------- custom color picker ----------------
     모든 Soft Hub 서비스의 <input type="color"> 는 브라우저 기본 색상
     대화상자 대신 자체 구현 피커(lemon-picker.js / .css)를 쓴다.
     필요한 페이지에서만 지연 로드하고, 나중에 동적으로 생기는
     input[type=color](모달 재렌더링 등)도 피커가 스스로 감지한다. */
  var selfSrc = (doc.currentScript && doc.currentScript.src) || '';
  function pickerBase() {
    try { return String(selfSrc).replace(/[?#].*$/, '').replace(/[^/]*$/, ''); } catch (e) { return ''; }
  }
  function loadPicker() {
    if (window.__lcpLoad) return;
    window.__lcpLoad = 1;
    var base = pickerBase();
    try {
      if (!doc.querySelector('link[href$="lemon-picker.css"]')) {
        var l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = base + 'lemon-picker.css';
        (doc.head || root).appendChild(l);
      }
      if (!window.LemonColorPicker) {
        var s = doc.createElement('script');
        s.src = base + 'lemon-picker.js';
        s.async = true;
        (doc.head || root).appendChild(s);
      }
    } catch (e) { }
  }
  function watchPicker() {
    if (window.LemonColorPicker) { window.LemonColorPicker.enhanceAll(doc); return; }
    if (doc.querySelector('input[type="color"]')) { loadPicker(); return; }
    if (!window.MutationObserver || !doc.body) return;
    var timer = 0;
    var mo = new MutationObserver(function () {
      // 무거운 앱(빌더 등)이 잦게 다시 그려도 문서 전체 검색은 250ms에 한 번만.
      if (timer) return;
      timer = setTimeout(function () {
        timer = 0;
        if (!doc.querySelector('input[type="color"]')) return;
        mo.disconnect();
        loadPicker();
      }, 250);
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  /* ---------------- boot ---------------- */
  /* IndexedDB 복원은 페이지가 그려지기 전에 시작해 둔다. sessionStorage 미러는 먼저 동기적으로 읽는다. */
  sessSeed();
  hydrate();

  doc.addEventListener('DOMContentLoaded', function () {
    kitStyle();
    bindTheme();
    bindAnim();
    bindRipple();
    bindRanges();
    reveal();
    watchPicker();
  });

  window.Lemon = {
    store: store,
    ready: ready,
    hydrated: function () { return hydrated; },
    hydrate: hydrate,
    idb: { name: IDB_NAME, store: IDB_STORE, open: idbOpen, all: idbGetAll },
    storageWarn: storageWarn,
    storageWarnMuted: function () { return warnMutedNow(); },
    storageWarnMute: function () { setWarnMuted(true); },
    storageWarnUnmute: function () { setWarnMuted(false); },
    closeStorageWarn: closeStorageWarn,
    toast: toast,
    copy: copy,
    download: download,
    downloadBlob: downloadBlob,
    hap: hap,
    isDark: isDark,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    setAnimMode: setAnimMode,
    animMode: readAnimMode,
    initTabs: initTabs,
    archive: makeArchive,
    project: project,
    reveal: reveal,
    tilt: tilt,
    confetti: confetti,
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    timeAgo: timeAgo,
    fmtBytes: fmtBytes,
    pad: pad,
    refreshRange: refreshRange,
    upgradeColorPickers: function (scope) {
      loadPicker();
      if (window.LemonColorPicker) window.LemonColorPicker.enhanceAll(scope || doc);
    }
  };

  try {
    Object.defineProperty(window.Lemon, 'colorPicker', {
      configurable: true,
      get: function () { return window.LemonColorPicker || null; }
    });
  } catch (e) { }
})();
