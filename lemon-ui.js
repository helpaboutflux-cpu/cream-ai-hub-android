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
  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    /* Never truncates or overwrites on failure: returns false and keeps the old value. */
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); lastStoreError = null; return true; }
      catch (e) {
        lastStoreError = e;
        if (isQuotaError(e)) storageWarn({ key: key });
        return false;
      }
    },
    raw: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    rawSet: function (key, value) {
      try { localStorage.setItem(key, value); lastStoreError = null; return true; }
      catch (e) {
        lastStoreError = e;
        if (isQuotaError(e)) storageWarn({ key: key });
        return false;
      }
    },
    lastError: function () { return lastStoreError; },
    isQuotaError: isQuotaError
  };

  /* ---------------- storage-full warning ---------------- */
  /* Shown instead of silently deleting data. Cooldown + closeable so it never nags. */
  var WARN_COOLDOWN = 45000;
  var warnEl = null, warnAt = 0;

  function kitStyle() {
    if (doc.getElementById('lemonKitStyle')) return;
    var st = doc.createElement('style');
    st.id = 'lemonKitStyle';
    st.textContent = [
      '.as-badge[data-state="full"]{color:#e11d48;border-color:rgba(225,29,72,.42);background:rgba(225,29,72,.10)}',
      '.dark .as-badge[data-state="full"]{color:#fb7185;border-color:rgba(251,113,133,.42);background:rgba(225,29,72,.16)}',
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
      'flex-wrap:wrap}.lemon-storage-warn .lsw-act{width:100%;justify-content:flex-end}}'
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
      '<p class="lsw-text">저장 공간(LocalStorage)이 부족해 변경 사항을 저장하지 못했어요. 기존 데이터는 삭제되지 않았습니다. Lemon Manager에서 용량을 확인하고 불필요한 데이터를 정리해 주세요.</p>' +
      '</div>' +
      '<div class="lsw-act">' +
      '<a class="lsw-open" href="' + managerHref() + '">Lemon Manager 열기' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M9 7h8v8"></path></svg></a>' +
      '<button class="lsw-close" type="button" aria-label="경고 닫기">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg></button>' +
      '</div>';
    doc.body.appendChild(el);
    el.querySelector('.lsw-close').addEventListener('click', closeStorageWarn);
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
  function hap(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { }
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
        setBadge('자동 저장됨 ' + stamp(), 'saved');
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

  /* ---------------- boot ---------------- */
  doc.addEventListener('DOMContentLoaded', function () {
    kitStyle();
    bindTheme();
    bindRipple();
    bindRanges();
    reveal();
  });

  window.Lemon = {
    store: store,
    storageWarn: storageWarn,
    closeStorageWarn: closeStorageWarn,
    toast: toast,
    copy: copy,
    download: download,
    downloadBlob: downloadBlob,
    hap: hap,
    isDark: isDark,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
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
    refreshRange: refreshRange
  };
})();
