/* ============================================================
   Lemon soft · 자체 구현 커스텀 컬러 피커  (lemon-picker.js)
   ------------------------------------------------------------
   Soft Hub 전 서비스의 <input type="color"> 를 감지해
   브라우저 기본 색상 대화상자 대신 직접 만든 피커를 연다.

   · 2D 채도/명도(SV) 스펙트럼 캔버스 — 마우스·터치 드래그 실시간
   · 색상(Hue) 스펙트럼 슬라이더
   · HEX 직접 입력(실시간 검증·복사) + RGB 수치 표시
   · 최근 사용 색상(localStorage) + 큐레이션 스와치
   · 라이트/다크(cream_theme) 대응, 모바일은 바텀시트
   · lemon_anim_mode(full/reduced/off) 애니메이션 연동
   · 원본 input 의 value / input / change 이벤트 100% 호환

   사용법
     LemonColorPicker.open(input)            특정 input 의 피커 열기
     LemonColorPicker.enhanceAll(root)       input[type=color] 전수 업그레이드
     LemonColorPicker.close()                닫기
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonColorPicker) return;

  var doc = document;
  var RECENT_KEY = 'lemon_cp_recent';
  var ANIM_KEY = 'lemon_anim_mode';
  var MAX_RECENT = 18;
  var PRESETS = ['#111114', '#f5f5f7', '#7c3aed', '#4f46e5', '#0ea5e9', '#10b981',
    '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#94a3b8'];

  /* ---------------- 색 계산 ---------------- */
  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }

  function normHex(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (s.charAt(0) === '#') s = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(s)) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    if (!/^[0-9a-f]{6}$/.test(s)) return null;
    return '#' + s;
  }

  function hexToRgb(hex) {
    var h = normHex(hex) || '#000000';
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16)
    };
  }

  function rgbToHex(r, g, b) {
    function p(n) { var s = Math.round(clamp(n, 0, 255)).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + p(r) + p(g) + p(b);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: mx === 0 ? 0 : d / mx, v: mx };
  }

  function hsvToHex(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  function isDarkNow() {
    var root = doc.documentElement;
    if (root.classList.contains('dark') || (doc.body && doc.body.classList.contains('dark'))) return true;
    try {
      var t = localStorage.getItem('cream_theme');
      t = t ? String(t).replace(/^"|"$/g, '') : '';
      if (t === 'dark') return true;
      if (t === 'light') return false;
    } catch (e) { }
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function animMode() {
    try {
      var m = String(localStorage.getItem(ANIM_KEY) || 'full').replace(/^"|"$/g, '');
      return (m === 'reduced' || m === 'off') ? m : 'full';
    } catch (e) { return 'full'; }
  }

  function brandHex() {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue('--brand').trim();
      return normHex(v);
    } catch (e) { return null; }
  }

  /* ---------------- 최근 사용 색 ---------------- */
  function readRecent() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var h = normHex(arr[i]);
        if (h && out.indexOf(h) < 0) out.push(h);
      }
      return out.slice(0, MAX_RECENT);
    } catch (e) { return []; }
  }

  function pushRecent(hex) {
    hex = normHex(hex);
    if (!hex) return;
    var list = readRecent().filter(function (c) { return c !== hex; });
    list.unshift(hex);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch (e) { }
  }

  /* ---------------- 아이콘 ---------------- */
  var ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  var ICON_COPY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="5.4" y="5.4" width="8.1" height="8.1" rx="2"/><path d="M10.6 5.4V4.2A1.7 1.7 0 008.9 2.5H4.2A1.7 1.7 0 002.5 4.2v4.7a1.7 1.7 0 001.7 1.7h1.2"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 8.4l3 3 6.2-6.6"/></svg>';

  /* ---------------- 상태 ---------------- */
  var root = null, panel = null, scrim = null, canvas = null, ctx = null;
  var dotEl = null, hueEl = null, hueDot = null, previewEl = null, hexEl = null;
  var copyEl = null, recentEl = null, presetEl = null, footEl = null;
  var st = { input: null, original: '', h: 0, s: 1, v: 1, hex: '#000000', typing: false, mode: 'pop' };
  var openFlag = false;
  var rafPending = 0, pendingHex = null;
  var bodyLock = null;
  var closingTimer = 0;

  /* ---------------- DOM 생성 ---------------- */
  function build() {
    if (root) return;
    root = doc.createElement('div');
    root.className = 'lcp-root';
    root.setAttribute('role', 'presentation');
    root.style.display = 'none';
    root.innerHTML =
      '<div class="lcp-scrim" data-lcp-scrim="1"></div>' +
      '<div class="lcp-panel" role="dialog" aria-modal="false" aria-label="색상 선택">' +
      '<div class="lcp-grab"></div>' +
      '<div class="lcp-head">' +
      '<span class="lcp-title">색상 선택</span>' +
      '<span class="lcp-hint">드래그해서 고르기</span>' +
      '<button type="button" class="lcp-close" aria-label="닫기">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="lcp-body">' +
      '<div class="lcp-sv"><canvas aria-hidden="true"></canvas><i class="lcp-dot"></i></div>' +
      '<div class="lcp-hue" role="slider" aria-label="색상" aria-valuemin="0" aria-valuemax="360" tabindex="0"><i class="lcp-hue-dot"></i></div>' +
      '<div class="lcp-row">' +
      '<span class="lcp-preview"></span>' +
      '<input class="lcp-hex" type="text" inputmode="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="HEX 코드">' +
      '<button type="button" class="lcp-copy" aria-label="HEX 코드 복사">' + ICON_COPY + '</button>' +
      '</div>' +
      '<div class="lcp-rgb"><span>R <b data-rgb="r">0</b></span><span>G <b data-rgb="g">0</b></span><span>B <b data-rgb="b">0</b></span></div>' +
      '<div class="lcp-sec"><div class="lcp-sec-t">최근 사용</div><div class="lcp-sw lcp-recent"></div></div>' +
      '<div class="lcp-sec"><div class="lcp-sec-t">추천 색 <em>브랜드 · 큐레이션</em></div><div class="lcp-sw lcp-preset"></div></div>' +
      '</div>' +
      '<div class="lcp-foot">' +
      '<button type="button" class="lcp-btn lcp-btn-ghost" data-lcp-cancel="1">취소</button>' +
      '<button type="button" class="lcp-btn lcp-btn-primary" data-lcp-ok="1">적용</button>' +
      '</div>' +
      '</div>';
    doc.body.appendChild(root);

    panel = root.querySelector('.lcp-panel');
    scrim = root.querySelector('.lcp-scrim');
    canvas = root.querySelector('.lcp-sv canvas');
    ctx = canvas.getContext('2d');
    dotEl = root.querySelector('.lcp-dot');
    hueEl = root.querySelector('.lcp-hue');
    hueDot = root.querySelector('.lcp-hue-dot');
    previewEl = root.querySelector('.lcp-preview');
    hexEl = root.querySelector('.lcp-hex');
    copyEl = root.querySelector('.lcp-copy');
    recentEl = root.querySelector('.lcp-recent');
    presetEl = root.querySelector('.lcp-preset');
    footEl = root.querySelector('.lcp-foot');

    root.querySelector('.lcp-close').addEventListener('click', function () { close(true); });
    root.querySelector('[data-lcp-cancel]').addEventListener('click', function () { cancel(); });
    root.querySelector('[data-lcp-ok]').addEventListener('click', function () { close(true); });
    scrim.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      close(true);
    });
    // 패널 밖(스크림) 탭 = 닫기. 스크림이 모든 클릭을 가로채므로 팝오버에선 스크림만 투명.
    panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    bindSV();
    bindHue();
    bindHex();
    copyEl.addEventListener('click', doCopy);
    recentEl.addEventListener('click', onChipClick);
    presetEl.addEventListener('click', onChipClick);
    doc.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onViewport, { passive: true });
    window.addEventListener('scroll', onViewport, { passive: true, capture: true });
    doc.addEventListener('lemon:theme', function () { if (openFlag) root.setAttribute('data-theme', isDarkNow() ? 'dark' : 'light'); });
  }

  /* ---------------- 그리기 ---------------- */
  function paintSV() {
    if (!ctx) return;
    var box = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(box.width));
    var h = Math.max(1, Math.round(box.height));
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = hsvToHex(st.h, 1, 1);
    ctx.fillRect(0, 0, w, h);
    var gx = ctx.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gx;
    ctx.fillRect(0, 0, w, h);
    var gy = ctx.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gy;
    ctx.fillRect(0, 0, w, h);
  }

  function placeDots() {
    if (!canvas || !dotEl) return;
    var box = canvas.getBoundingClientRect();
    dotEl.style.transform = 'translate(' + (st.s * box.width).toFixed(2) + 'px,' + ((1 - st.v) * box.height).toFixed(2) + 'px)';
    var hb = hueEl.getBoundingClientRect();
    hueDot.style.transform = 'translate(' + ((st.h / 360) * hb.width).toFixed(2) + 'px,0)';
    hueDot.style.setProperty('--lcp-hue', hsvToHex(st.h, 1, 1));
  }

  /* ---------------- UI 동기화 ---------------- */
  function syncUI(skipHexField) {
    root.style.setProperty('--lcp-c', st.hex);
    previewEl.style.background = st.hex;
    var rgb = hexToRgb(st.hex);
    var rr = root.querySelector('[data-rgb="r"]'), gg = root.querySelector('[data-rgb="g"]'), bb = root.querySelector('[data-rgb="b"]');
    if (rr) rr.textContent = rgb.r;
    if (gg) gg.textContent = rgb.g;
    if (bb) bb.textContent = rgb.b;
    if (!skipHexField && !st.typing) hexEl.value = st.hex.toUpperCase();
    placeDots();
    markSelected();
  }

  function markSelected() {
    var chips = root.querySelectorAll('.lcp-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('lcp-sel', chips[i].getAttribute('data-c') === st.hex);
    }
  }

  function makeChip(hex) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'lcp-chip';
    b.setAttribute('data-c', hex);
    b.setAttribute('aria-label', hex.toUpperCase());
    b.title = hex.toUpperCase();
    b.style.setProperty('--c', hex);
    return b;
  }

  function renderSwatches() {
    var rec = readRecent();
    recentEl.innerHTML = '';
    if (!rec.length) {
      var empty = doc.createElement('span');
      empty.className = 'lcp-empty';
      empty.textContent = '고른 색이 여기에 쌓여요';
      recentEl.appendChild(empty);
    } else {
      for (var i = 0; i < rec.length; i++) recentEl.appendChild(makeChip(rec[i]));
    }
    var list = [];
    var b = brandHex();
    if (b) list.push(b);
    for (var j = 0; j < PRESETS.length; j++) if (list.indexOf(PRESETS[j]) < 0) list.push(PRESETS[j]);
    presetEl.innerHTML = '';
    for (var k = 0; k < list.length; k++) presetEl.appendChild(makeChip(list[k]));
    markSelected();
  }

  function onChipClick(e) {
    var chip = e.target.closest ? e.target.closest('.lcp-chip') : null;
    if (!chip) return;
    var hex = normHex(chip.getAttribute('data-c'));
    if (!hex) return;
    setHex(hex, false);
    applyLive(hex);
    chip.classList.remove('lcp-pop');
    void chip.offsetWidth;
    chip.classList.add('lcp-pop');
    setTimeout(function () {
      if (!openFlag) return;
      commit();
      close(true);
    }, animMode() === 'off' ? 0 : 150);
  }

  function setHex(hex, keepHue) {
    hex = normHex(hex) || '#000000';
    var rgb = hexToRgb(hex);
    var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    st.hex = hex;
    st.s = hsv.s;
    st.v = hsv.v;
    if (!(keepHue && hsv.s === 0)) st.h = hsv.h;
    paintSV();
    syncUI();
  }

  /* ---------------- 원본 input 반영 ---------------- */
  function fire(el, type) {
    try { el.dispatchEvent(new Event(type, { bubbles: true })); }
    catch (e) {
      var ev = doc.createEvent('Event');
      ev.initEvent(type, true, false);
      el.dispatchEvent(ev);
    }
  }

  function writeInput(hex, commitNow) {
    var el = st.input;
    if (!el) return;
    var prev = el.value;
    if (prev === hex && !commitNow) return;
    el.value = hex;
    el.setAttribute('value', hex);
    if (el.isConnected) {
      fire(el, 'input');
      if (commitNow) fire(el, 'change');
    }
  }

  function applyLive(hex) {
    pendingHex = hex;
    if (rafPending) return;
    rafPending = window.requestAnimationFrame(function () {
      rafPending = 0;
      if (pendingHex) writeInput(pendingHex, false);
    });
  }

  function commit() {
    if (rafPending) { window.cancelAnimationFrame(rafPending); rafPending = 0; }
    writeInput(st.hex, true);
    pushRecent(st.hex);
    if (recentEl && openFlag) renderSwatches();
  }

  /* ---------------- SV · Hue 드래그 ---------------- */
  function bindSV() {
    var dragging = false;
    function update(ev) {
      var box = canvas.getBoundingClientRect();
      var s = clamp((ev.clientX - box.left) / Math.max(1, box.width), 0, 1);
      var v = 1 - clamp((ev.clientY - box.top) / Math.max(1, box.height), 0, 1);
      st.s = s; st.v = v;
      st.hex = hsvToHex(st.h, s, v);
      syncUI();
      applyLive(st.hex);
    }
    var sv = root.querySelector('.lcp-sv');
    sv.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      dragging = true;
      try { sv.setPointerCapture(ev.pointerId); } catch (e) { }
      update(ev);
    });
    sv.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      ev.preventDefault();
      update(ev);
    });
    function end(ev) {
      if (!dragging) return;
      dragging = false;
      try { sv.releasePointerCapture(ev.pointerId); } catch (e) { }
      commit();
    }
    sv.addEventListener('pointerup', end);
    sv.addEventListener('pointercancel', end);
    sv.addEventListener('lostpointercapture', end);
  }

  function bindHue() {
    var dragging = false;
    function update(ev) {
      var box = hueEl.getBoundingClientRect();
      var h = clamp((ev.clientX - box.left) / Math.max(1, box.width), 0, 1) * 360;
      st.h = h % 360;
      st.hex = hsvToHex(st.h, Math.max(st.s, 0.001), st.v);
      if (st.s === 0) { st.s = 1; st.hex = hsvToHex(st.h, 1, st.v); }
      paintSV();
      syncUI();
      hueEl.setAttribute('aria-valuenow', String(Math.round(st.h)));
      applyLive(st.hex);
    }
    hueEl.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      dragging = true;
      try { hueEl.setPointerCapture(ev.pointerId); } catch (e) { }
      update(ev);
    });
    hueEl.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      ev.preventDefault();
      update(ev);
    });
    function end(ev) {
      if (!dragging) return;
      dragging = false;
      try { hueEl.releasePointerCapture(ev.pointerId); } catch (e) { }
      commit();
    }
    hueEl.addEventListener('pointerup', end);
    hueEl.addEventListener('pointercancel', end);
    hueEl.addEventListener('lostpointercapture', end);
    hueEl.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 15 : 3;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); st.h = (st.h - step + 360) % 360; }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); st.h = (st.h + step) % 360; }
      else return;
      if (st.s === 0) st.s = 1;
      st.hex = hsvToHex(st.h, st.s, st.v);
      paintSV();
      syncUI();
      applyLive(st.hex);
      commit();
    });
  }

  /* ---------------- HEX 입력 ---------------- */
  function bindHex() {
    var badTimer = 0;
    function clearBad() { clearTimeout(badTimer); hexEl.classList.remove('lcp-bad'); }
    hexEl.addEventListener('focus', function () { st.typing = true; });
    hexEl.addEventListener('blur', function () {
      st.typing = false;
      clearBad();
      hexEl.value = st.hex.toUpperCase();
    });
    hexEl.addEventListener('input', function () {
      var raw = hexEl.value.replace(/[^#0-9a-fA-F]/g, '');
      if (raw !== hexEl.value) hexEl.value = raw;
      var hex = normHex(raw);
      if (!hex) {
        // 입력 중에는 조용히 두고, 잠시 멈췄을 때만 잘못된 코드임을 알린다.
        clearTimeout(badTimer);
        badTimer = setTimeout(function () {
          if (!normHex(hexEl.value) && hexEl.value.replace('#', '').length >= 3) hexEl.classList.add('lcp-bad');
        }, 700);
        return;
      }
      clearBad();
      setHex(hex, true);
      applyLive(hex);
    });
    hexEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        var hex = normHex(hexEl.value);
        if (hex) { setHex(hex, true); commit(); hexEl.blur(); }
        else hexEl.classList.add('lcp-bad');
      } else if (ev.key === 'Escape') {
        ev.stopPropagation();
        st.typing = false;
        hexEl.blur();
        cancel();
      }
    });
  }

  function doCopy() {
    var text = st.hex.toUpperCase();
    function done() {
      copyEl.innerHTML = ICON_CHECK;
      copyEl.classList.add('lcp-done');
      setTimeout(function () {
        copyEl.innerHTML = ICON_COPY;
        copyEl.classList.remove('lcp-done');
      }, 1200);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else fallback();
    } catch (e) { fallback(); }
    function fallback() {
      try {
        var ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        doc.execCommand('copy');
        doc.body.removeChild(ta);
        done();
      } catch (e) { }
    }
  }

  /* ---------------- 위치 · 뷰포트 ---------------- */
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var sheet = vw <= 680;
    st.mode = sheet ? 'sheet' : 'pop';
    root.setAttribute('data-mode', st.mode);
    if (sheet) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      return;
    }
    var rect = st.input ? st.input.getBoundingClientRect() : { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2, width: 40, height: 30 };
    var pw = 300;
    var ph = panel.offsetHeight || 420;
    var left = clamp(rect.left + rect.width / 2 - pw / 2, 10, Math.max(10, vw - pw - 10));
    var below = rect.bottom + 10;
    var above = rect.top - ph - 10;
    var top, place;
    var offscreen = rect.bottom < 0 || rect.top > vh;
    if (!offscreen && below + ph <= vh - 10) { top = below; place = 'below'; }
    else if (!offscreen && above >= 10) { top = above; place = 'above'; }
    else { top = vh - ph - 10; place = 'center'; }
    top = clamp(top, 10, Math.max(10, vh - ph - 10));
    root.setAttribute('data-place', place);
    var originX = clamp(rect.left + rect.width / 2 - left, 16, pw - 16);
    root.style.setProperty('--lcp-origin', originX.toFixed(0) + 'px ' + (place === 'above' ? '100%' : '0%'));
    panel.style.left = left.toFixed(0) + 'px';
    panel.style.top = top.toFixed(0) + 'px';
  }

  var ro = null;
  function watchPanelSize() {
    if (!window.ResizeObserver || ro) return;
    ro = new ResizeObserver(function () {
      if (!openFlag || st.mode !== 'pop') return;
      layout();
    });
    ro.observe(panel);
  }

  var vpRaf = 0;
  function onViewport() {
    if (!openFlag || st.mode === 'sheet') return;
    if (vpRaf) return;
    vpRaf = window.requestAnimationFrame(function () {
      vpRaf = 0;
      if (!openFlag) return;
      if (st.input && !st.input.isConnected) { cancel(); return; }
      layout();
    });
  }

  /* ---------------- 열기 / 닫기 ---------------- */
  function open(input) {
    if (!input || input.type !== 'color') return;
    build();
    if (openFlag && st.input === input) { cancel(); return; }
    if (openFlag) close(true, true);
    clearTimeout(closingTimer);
    st.input = input;
    st.original = input.value || '';
    st.typing = false;
    hexEl.classList.remove('lcp-bad');
    hexEl.value = '';
    var start = normHex(input.value) || '#000000';
    setHex(start, false);
    renderSwatches();

    root.setAttribute('data-theme', isDarkNow() ? 'dark' : 'light');
    root.setAttribute('data-anim', animMode());
    root.style.setProperty('--lcp-brand', brandHex() || '#7c3aed');
    root.style.display = 'block';
    root.classList.remove('lcp-on');
    openFlag = true;
    layout();
    paintSV();
    placeDots();
    syncUI();

    if (st.mode === 'sheet') {
      try {
        bodyLock = doc.body.style.overflow;
        doc.body.style.overflow = 'hidden';
      } catch (e) { bodyLock = null; }
    }
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () {
      raf(function () {
        root.classList.add('lcp-on');
        layout();  // 스타일·폰트가 늦게 적용돼도 위치·높이를 다시 잡는다.
      });
    });
    watchPanelSize();
    doc.dispatchEvent(new CustomEvent('lemon:pickeropen', { detail: { input: input } }));
  }

  function restoreBody() {
    if (bodyLock !== null) {
      try { doc.body.style.overflow = bodyLock; } catch (e) { }
      bodyLock = null;
    }
  }

  function close(keepValue, quick) {
    if (!openFlag) return;
    openFlag = false;
    root.classList.remove('lcp-on');
    var wait = animMode() === 'off' ? 0 : (quick ? 110 : 220);
    clearTimeout(closingTimer);
    closingTimer = setTimeout(function () {
      if (openFlag) return;
      root.style.display = 'none';
    }, wait);
    restoreBody();
    st.input = null;
    st.typing = false;
  }

  function cancel() {
    var el = st.input;
    var orig = normHex(st.original);
    if (el) {
      if (rafPending) { window.cancelAnimationFrame(rafPending); rafPending = 0; }
      if (orig) { writeInput(orig, false); }
      else { el.value = st.original || ''; }
      fire(el, 'change');
    }
    close(false, true);
  }

  function onKey(ev) {
    if (!openFlag) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (st.typing) { st.typing = false; hexEl.blur(); cancel(); return; }
      cancel();
    }
  }

  /* ---------------- input 업그레이드 ---------------- */
  function enhanceOne(el) {
    if (!el || el.nodeName !== 'INPUT' || el.type !== 'color' || el.getAttribute('data-lcp') === '1') return;
    el.setAttribute('data-lcp', '1');
    el.classList.add('lcp-color-input');
    // 브라우저 기본 색상 대화상자를 열지 않고, 자체 피커를 연다.
    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      open(el);
    }, true);
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        open(el);
      }
    }, true);
  }

  var queue = [], queued = false;
  function flush() {
    queued = false;
    var list = queue;
    queue = [];
    for (var i = 0; i < list.length; i++) enhanceNode(list[i]);
  }
  function enhanceNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.nodeName === 'INPUT') { enhanceOne(node); return; }
    if (!node.querySelectorAll) return;
    var found = node.querySelectorAll('input[type="color"]');
    for (var i = 0; i < found.length; i++) enhanceOne(found[i]);
  }

  function enhanceAll(scopeEl) {
    var scope = scopeEl || doc;
    if (scope.nodeType === 1 && scope.nodeName === 'INPUT') { enhanceOne(scope); return; }
    if (scope.querySelectorAll) {
      var found = scope.querySelectorAll('input[type="color"]');
      for (var i = 0; i < found.length; i++) enhanceOne(found[i]);
    }
  }

  function watch() {
    if (!doc.body || !window.MutationObserver) return;
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          if (n !== root) queue.push(n);
        }
      }
      if (!queue.length || queued) return;
      queued = true;
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(flush);
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  function boot() {
    enhanceAll(doc);
    watch();
    doc.addEventListener('lemon:theme', function () {
      if (openFlag) root.setAttribute('data-theme', isDarkNow() ? 'dark' : 'light');
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LemonColorPicker = {
    open: open,
    close: function () { close(true); },
    cancel: cancel,
    enhance: enhanceOne,
    enhanceAll: enhanceAll,
    upgradeColorPickers: function (scope) { enhanceAll(scope || doc); },
    isOpen: function () { return openFlag; }
  };
})();
