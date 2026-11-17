/* ============================================================
   Lemon soft · 자체 구현 커스텀 드롭다운  (lemon-dropdown.js)
   ------------------------------------------------------------
   Soft Hub 전 서비스의 네이티브 <select> 를 감지해
   브라우저 기본 드롭다운 대신 직접 만든 선택 UI 로 바꾼다.

   · 트리거는 원래 select 의 클래스·인라인 스타일을 그대로 이어받아
     페이지마다 다른 디자인(.sel / .lemon-select / Tailwind 유틸)을 유지
   · 옵션이 많으면(8개 이상) 상단 검색 필터 — 한글 초성·부분 일치
   · 옵션이 아주 많거나 모바일(640px 이하)이면 바텀시트로 전환
   · 데스크톱은 트리거 위/아래 스마트 팝오버(화면 잘림 방지, 스크롤·리사이즈 추적)
   · 키보드 탐색(↑ ↓ Home End Enter Esc, 타자 검색)
   · 라이트/다크(cream_theme · .dark · 시스템) 대응
   · lemon_anim_mode(full/reduced/off) 애니메이션 연동
   · 원본 select 의 value / selectedIndex / options / disabled /
     input · change 이벤트를 그대로 동기화 — 기존 페이지 로직 무손상

   사용법
     LemonDropdown.enhanceAll(root)   select 전수 업그레이드
     LemonDropdown.enhance(el)        하나만
     LemonDropdown.open(select)       특정 select 열기
     LemonDropdown.close()
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonDropdown) return;

  var doc = document;
  var ANIM_KEY = 'lemon_anim_mode';
  var THEME_KEY = 'cream_theme';
  var SEARCH_MIN = 8;    /* 이 개수 이상이면 검색 필터 표시 */
  var SHEET_OPTS = 24;   /* 이 개수 이상이면 바텀시트 */
  var SHEET_W = 640;     /* 이 폭 이하(모바일)면 바텀시트 */
  var PANEL_MIN = 208;
  var PANEL_MAX = 344;

  /* ---------------- 아이콘 (SVG only, 이모지 0) ---------------- */
  var ICON_CARET =
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.7 4.5 6 7.8l3.3-3.3"/></svg>';
  var ICON_CHECK =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.3 8.4l3.1 3.1 6.3-6.7"/></svg>';
  var ICON_SEARCH =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="7.2" cy="7.2" r="4.3"/><path d="M10.6 10.6 13.6 13.6"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  /* ---------------- 환경 읽기 ---------------- */
  function isDarkNow() {
    var root = doc.documentElement;
    if (root.classList.contains('dark')) return true;
    if (doc.body && doc.body.classList.contains('dark')) return true;
    try {
      var t = localStorage.getItem(THEME_KEY);
      t = t ? String(t).replace(/^"|"$/g, '') : '';
      if (t === 'dark') return true;
      if (t === 'light') return false;
    } catch (e) { }
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function animMode() {
    try {
      var m = String(localStorage.getItem(ANIM_KEY) || doc.documentElement.getAttribute('data-anim') || 'full').replace(/^"|"$/g, '');
      return (m === 'reduced' || m === 'off') ? m : 'full';
    } catch (e) { return 'full'; }
  }

  function brandColor() {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue('--brand').trim();
      if (v && v.indexOf('var(') < 0) return v;
    } catch (e) { }
    return '#7c3aed';
  }

  function fire(el, type) {
    try { el.dispatchEvent(new Event(type, { bubbles: true })); }
    catch (e) {
      try {
        var ev = doc.createEvent('Event');
        ev.initEvent(type, true, false);
        el.dispatchEvent(ev);
      } catch (e2) { }
    }
  }

  /* select 의 클래스를 트리거로 옮기되, 우리가 붙이는 표시용 클래스(ldd-*)는 뺀다.
     .ldd-src 를 그대로 복사하면 트리거 자신이 1px 로 숨겨져 버리므로 반드시 걸러낸다. */
  function copyClasses(el) {
    var raw = el && el.className ? String(el.className) : '';
    var parts = raw.split(/\s+/), keep = [];
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i];
      if (!c) continue;
      if (c === 'ldd-src' || c === 'ldd-skip' || c === 'ldd-trigger' || c === 'ldd-field') continue;
      keep.push(c);
    }
    return keep.length ? keep.join(' ') + ' ' : '';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }

  /* ---------------- 한글 초성 검색 ---------------- */
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  var CHO_LIST = ('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ').split('');

  function chosungOf(str) {
    var s = String(str || ''), out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) out += CHO_LIST[Math.floor((c - 0xAC00) / 588)];
      else out += s.charAt(i);
    }
    return out;
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
  }

  function matches(q, text, value) {
    if (!q) return true;
    var t = norm(text), v = norm(value);
    if (t.indexOf(q) >= 0 || v.indexOf(q) >= 0) return true;
    /* 초성 검색: 검색어가 한글 자모이거나 완성형일 때 */
    var ct = norm(chosungOf(text)), cq = norm(chosungOf(q));
    if (cq && ct.indexOf(cq) >= 0) return true;
    var cv = norm(chosungOf(value));
    if (cq && cv.indexOf(cq) >= 0) return true;
    return false;
  }

  /* ---------------- select 값 제어 ---------------- */
  var selProto = window.HTMLSelectElement ? window.HTMLSelectElement.prototype : null;
  var valDesc = selProto ? Object.getOwnPropertyDescriptor(selProto, 'value') : null;
  var idxDesc = selProto ? Object.getOwnPropertyDescriptor(selProto, 'selectedIndex') : null;

  function setIndex(sel, i) {
    if (idxDesc && idxDesc.set) { idxDesc.set.call(sel, i); return; }
    sel.selectedIndex = i;
  }
  function getIndex(sel) {
    if (idxDesc && idxDesc.get) return idxDesc.get.call(sel);
    return sel.selectedIndex;
  }
  function getValue(sel) {
    if (valDesc && valDesc.get) return valDesc.get.call(sel);
    return sel.value;
  }

  function optionText(o) {
    var t = (o.label != null && o.label !== '') ? o.label : (o.textContent || '');
    t = String(t).replace(/\s+/g, ' ').trim();
    if (!t) t = String(o.value || '').replace(/\s+/g, ' ').trim();
    return t;
  }

  /* ---------------- 전역 상태 ---------------- */
  var instances = [];
  var openState = null;   /* { inst, items, flat, active, q, sheet } */
  var root = null, panel = null, scrim = null, headEl = null, titleEl = null,
    searchWrap = null, searchEl = null, clearEl = null, listEl = null,
    emptyEl = null, footEl = null, grabEl = null;
  var scrollLock = null, closingTimer = 0;

  /* ---------------- 오버레이 DOM ---------------- */
  function build() {
    if (root) return;
    root = doc.createElement('div');
    root.className = 'ldd-root';
    root.setAttribute('data-name', 'lemon-dropdown');
    root.style.display = 'none';
    root.innerHTML =
      '<div class="ldd-scrim" data-ldd-scrim="1"></div>' +
      '<div class="ldd-panel" role="dialog" aria-modal="true" aria-label="선택">' +
      '<div class="ldd-grab" aria-hidden="true"></div>' +
      '<div class="ldd-head">' +
      '<span class="ldd-title"></span>' +
      '<button type="button" class="ldd-x" aria-label="닫기">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="ldd-search" hidden>' +
      '<span class="ldd-search-i">' + ICON_SEARCH + '</span>' +
      '<input class="ldd-search-input" type="text" inputmode="search" autocomplete="off" spellcheck="false" placeholder="검색" aria-label="옵션 검색">' +
      '<button type="button" class="ldd-clear" aria-label="검색어 지우기" hidden>' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="ldd-list" role="listbox" tabindex="-1"></div>' +
      '<div class="ldd-empty">조건에 맞는 항목이 없어요</div>' +
      '<div class="ldd-foot">' +
      '<button type="button" class="ldd-btn ldd-btn-ghost" data-ldd-cancel="1">취소</button>' +
      '</div>' +
      '</div>';
    doc.body.appendChild(root);

    panel = root.querySelector('.ldd-panel');
    scrim = root.querySelector('.ldd-scrim');
    grabEl = root.querySelector('.ldd-grab');
    headEl = root.querySelector('.ldd-head');
    titleEl = root.querySelector('.ldd-title');
    searchWrap = root.querySelector('.ldd-search');
    searchEl = root.querySelector('.ldd-search-input');
    clearEl = root.querySelector('.ldd-clear');
    listEl = root.querySelector('.ldd-list');
    emptyEl = root.querySelector('.ldd-empty');
    footEl = root.querySelector('.ldd-foot');

    root.querySelector('.ldd-x').addEventListener('click', function () { close(true); });
    root.querySelector('[data-ldd-cancel]').addEventListener('click', function () { close(true); });
    scrim.addEventListener('pointerdown', function (e) {
      /* 스크림(바깥) 탭 = 값 변경 없이 닫기 */
      e.preventDefault();
      close(true);
    });
    panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    searchEl.addEventListener('input', onSearchInput);
    clearEl.addEventListener('click', function () {
      searchEl.value = '';
      onSearchInput();
      searchEl.focus();
    });
    searchEl.addEventListener('keydown', onSearchKey);

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.ldd-opt') : null;
      if (!btn) return;
      var i = parseInt(btn.getAttribute('data-i'), 10);
      if (isNaN(i)) return;
      choose(i);
    });
    listEl.addEventListener('pointermove', function (e) {
      var btn = e.target.closest ? e.target.closest('.ldd-opt') : null;
      if (!btn) return;
      var i = parseInt(btn.getAttribute('data-i'), 10);
      if (!isNaN(i) && openState && openState.active !== i) setActive(i, false);
    });

    doc.addEventListener('keydown', onDocKey, true);
    window.addEventListener('resize', onViewport, { passive: true });
    window.addEventListener('orientationchange', onViewport, { passive: true });
    window.addEventListener('scroll', onViewport, { passive: true, capture: true });
    doc.addEventListener('lemon:theme', function () {
      if (!root) return;
      root.setAttribute('data-theme', isDarkNow() ? 'dark' : 'light');
      if (openState) layout();
    });
  }

  /* ---------------- 항목 수집·렌더 ---------------- */
  function collectInst(inst) {
    var sel = inst.sel;
    var out = [], n = sel.options ? sel.options.length : 0;
    for (var i = 0; i < n; i++) {
      var o = sel.options[i];
      var group = null;
      var p = o.parentNode;
      if (p && p.nodeName === 'OPTGROUP') group = p.label || '';
      out.push({
        i: i,
        opt: o,
        text: optionText(o),
        value: String(o.value == null ? '' : o.value),
        icon: o.getAttribute ? o.getAttribute('data-icon') : null,
        group: group,
        disabled: !!(o.disabled || (p && p.nodeName === 'OPTGROUP' && p.disabled))
      });
    }
    return out;
  }

  function renderList(inst) {
    var sel = inst.sel;
    var all = collectInst(inst);
    var q = norm(openState.q);
    var selIdx = getIndex(sel);
    var html = '', shown = 0, lastGroup = null;
    var flat = [];
    for (var k = 0; k < all.length; k++) {
      var it = all[k];
      if (q && !matches(q, it.text, it.value)) continue;
      if (it.group !== null && it.group !== lastGroup) {
        html += '<div class="ldd-group">' + escHtml(it.group) + '</div>';
        lastGroup = it.group;
      }
      var on = it.i === selIdx;
      flat.push(it);
      html += '<button type="button" role="option" class="ldd-opt' +
        (on ? ' is-sel' : '') + (it.disabled ? ' is-dis' : '') + (it.value === '' ? ' is-empty' : '') +
        '" data-i="' + it.i + '" aria-selected="' + (on ? 'true' : 'false') + '"' +
        (it.disabled ? ' disabled' : '') + ' tabindex="-1">' +
        (it.icon ? '<span class="ldd-ico">' + iconHtml(it.icon) + '</span>' : '') +
        '<span class="ldd-lab">' + escHtml(it.text || ' ') + '</span>' +
        '<span class="ldd-mark">' + ICON_CHECK + '</span>' +
        '</button>';
      shown++;
    }
    listEl.innerHTML = html;
    openState.items = flat;
    openState.all = all;
    emptyEl.style.display = shown ? 'none' : 'block';
    listEl.style.display = shown ? '' : 'none';

    /* 현재 선택 위치를 활성 항목으로 */
    var start = 0;
    for (var j = 0; j < flat.length; j++) {
      if (flat[j].i === selIdx) { start = j; break; }
    }
    openState.active = -1;
    if (flat.length) setActive(start, false);
  }

  function iconHtml(raw) {
    var s = String(raw || '').trim();
    if (s.charAt(0) === '<') return s;   /* 페이지가 넘긴 SVG 마크업 */
    return '<span class="ldd-ico-t">' + escHtml(s) + '</span>';
  }

  function setActive(i, doScroll) {
    if (!openState) return;
    var opts = listEl.querySelectorAll('.ldd-opt');
    for (var k = 0; k < opts.length; k++) opts[k].classList.remove('is-active');
    openState.active = i;
    if (i < 0 || !opts[i]) return;
    var el = opts[i];
    el.classList.add('is-active');
    if (doScroll !== false) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { }
    }
  }

  function moveActive(dir) {
    if (!openState) return;
    var items = openState.items, n = items.length;
    if (!n) return;
    var i = openState.active;
    for (var step = 0; step < n; step++) {
      i = i + dir;
      if (i < 0) i = n - 1;
      if (i >= n) i = 0;
      if (!items[i].disabled) break;
    }
    setActive(i, true);
  }

  function typeahead(ch) {
    if (!openState) return;
    var items = openState.items;
    openState.buf = (openState.buf || '') + ch;
    openState.bufTimer && clearTimeout(openState.bufTimer);
    openState.bufTimer = setTimeout(function () { if (openState) openState.buf = ''; }, 700);
    var q = norm(openState.buf);
    for (var k = 0; k < items.length; k++) {
      var idx = (openState.active + 1 + k) % items.length;
      var it = items[idx];
      if (it.disabled) continue;
      if (matches(q, it.text, it.value)) { setActive(idx, true); return; }
    }
  }

  function onSearchInput() {
    if (!openState) return;
    openState.q = searchEl.value;
    clearEl.hidden = !searchEl.value;
    renderList(openState.inst);
  }

  function onSearchKey(ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveActive(1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveActive(-1); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (openState && openState.active >= 0 && openState.items[openState.active]) choose(openState.active);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
    }
  }

  /* ---------------- 선택 반영 ---------------- */
  function choose(i) {
    if (!openState) return;
    var item = openState.items[i];
    if (!item || item.disabled) return;
    var inst = openState.inst;
    var sel = inst.sel;
    var prevVal = getValue(sel), prevIdx = getIndex(sel);
    setIndex(sel, item.i);
    inst.syncLabel();
    var changed = (getIndex(sel) !== prevIdx) || (getValue(sel) !== prevVal);
    close(true);
    if (changed) {
      fire(sel, 'input');
      fire(sel, 'change');
    }
  }

  function onDocKey(ev) {
    if (!openState) return;
    var k = ev.key;
    if (k === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
      return;
    }
    if (k === 'Tab') { close(true); return; }
    if (k === 'ArrowDown') { ev.preventDefault(); moveActive(1); return; }
    if (k === 'ArrowUp') { ev.preventDefault(); moveActive(-1); return; }
    if (k === 'Home') { ev.preventDefault(); setActive(0, true); return; }
    if (k === 'End') { ev.preventDefault(); setActive(openState.items.length - 1, true); return; }
    if (k === 'Enter') {
      ev.preventDefault();
      if (openState.active >= 0) choose(openState.active);
      return;
    }
    if (k === ' ' && ev.target !== searchEl) {
      ev.preventDefault();
      if (openState.active >= 0) choose(openState.active);
      return;
    }
    /* 타자 검색: 검색창이 없을 때만 */
    if (searchWrap.hidden && k && k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      typeahead(k);
    }
  }

  /* ---------------- 위치 잡기 ---------------- */
  function layout() {
    if (!openState) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var rect = openState.inst.trigger.getBoundingClientRect();
    var count = openState.all.length;
    var sheet = vw <= SHEET_W || count >= SHEET_OPTS;
    openState.sheet = sheet;
    root.setAttribute('data-mode', sheet ? 'sheet' : 'pop');

    if (sheet) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.maxHeight = '';
      return;
    }
    var w = clamp(Math.round(rect.width), PANEL_MIN, PANEL_MAX);
    var left = clamp(Math.round(rect.left), 10, Math.max(10, vw - w - 10));
    panel.style.width = w + 'px';

    /* 내용 높이 먼저 계산 (임시로 위쪽 기준) */
    panel.style.maxHeight = Math.max(180, Math.min(vh - 24, 420)) + 'px';
    var ph = panel.offsetHeight || 260;
    var gap = 6;
    var below = rect.bottom + gap;
    var above = rect.top - ph - gap;
    var place;
    var top;
    if (below + ph <= vh - 10) { top = below; place = 'below'; }
    else if (above >= 10) { top = above; place = 'above'; }
    else { place = 'center'; top = clamp(vh / 2 - ph / 2, 10, Math.max(10, vh - ph - 10)); }

    panel.style.left = left + 'px';
    panel.style.top = Math.max(10, top) + 'px';
    root.setAttribute('data-place', place);
    var ox = clamp(rect.left + rect.width / 2 - left, 18, w - 18);
    root.style.setProperty('--ldd-origin', ox.toFixed(0) + 'px ' + (place === 'above' ? '100%' : '0%'));
  }

  var vpRaf = 0;
  function onViewport() {
    if (!openState || vpRaf) return;
    vpRaf = window.requestAnimationFrame(function () {
      vpRaf = 0;
      if (!openState) return;
      if (!openState.inst.sel.isConnected) { close(false); return; }
      layout();
    });
  }

  /* ---------------- 열기 / 닫기 ---------------- */
  function open(inst) {
    if (!inst || inst.sel.disabled) return;
    build();
    if (openState) {
      if (openState.inst === inst) { close(true); return; }
      close(false, true);
    }
    clearTimeout(closingTimer);

    openState = { inst: inst, items: [], all: [], active: -1, q: '', sheet: false, buf: '' };
    var sel = inst.sel;

    /* 제목: aria-label → 연결된 label → 기본 문구 */
    var title = sel.getAttribute('aria-label') || '';
    if (!title && sel.labels && sel.labels[0]) title = sel.labels[0].textContent || '';
    if (!title) {
      var lb = findLabelText(sel);
      if (lb) title = lb;
    }
    title = String(title).replace(/\s+/g, ' ').trim() || '선택';
    titleEl.textContent = title;

    var n = sel.options ? sel.options.length : 0;
    var useSearch = n >= SEARCH_MIN;
    searchWrap.hidden = !useSearch;
    searchEl.value = '';
    clearEl.hidden = true;

    renderList(inst);

    root.setAttribute('data-theme', isDarkNow() ? 'dark' : 'light');
    root.setAttribute('data-anim', animMode());
    root.style.setProperty('--ldd-brand', brandColor());
    panel.style.visibility = 'hidden';
    root.style.display = 'block';
    root.classList.remove('ldd-on');

    layout();
    panel.style.visibility = '';

    var sheet = openState.sheet;
    if (sheet) {
      try {
        scrollLock = doc.body.style.overflow;
        doc.body.style.overflow = 'hidden';
      } catch (e) { scrollLock = null; }
    }
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () {
      raf(function () {
        if (!openState) return;
        root.classList.add('ldd-on');
        layout();
      });
    });
    inst.trigger.setAttribute('aria-expanded', 'true');

    /* 포커스: 모바일 바텀시트에서는 키보드가 올라오지 않도록 목록에 둔다 */
    setTimeout(function () {
      if (!openState) return;
      if (useSearch && !openState.sheet) { try { searchEl.focus({ preventScroll: true }); } catch (e) { searchEl.focus(); } }
      else { try { listEl.focus({ preventScroll: true }); } catch (e) { } }
    }, 30);

    doc.dispatchEvent(new CustomEvent('lemon:dropdownopen', { detail: { select: sel } }));
  }

  function findLabelText(sel) {
    try {
      var p = sel.parentNode;
      for (var hop = 0; p && hop < 3; hop++, p = p.parentNode) {
        var labels = p.querySelectorAll ? p.querySelectorAll('label') : [];
        for (var i = 0; i < labels.length; i++) {
          var l = labels[i];
          if (l.control === sel || l.getAttribute('for') === sel.id) {
            return (l.textContent || '').replace(/\s+/g, ' ').trim();
          }
        }
      }
    } catch (e) { }
    return '';
  }

  function restoreScroll() {
    if (scrollLock !== null) {
      try { doc.body.style.overflow = scrollLock; } catch (e) { }
      scrollLock = null;
    }
  }

  function close(focusTrigger, quick) {
    if (!openState) return;
    var inst = openState.inst;
    openState = null;
    root.classList.remove('ldd-on');
    var wait = animMode() === 'off' ? 0 : (quick ? 90 : 180);
    clearTimeout(closingTimer);
    closingTimer = setTimeout(function () {
      if (openState) return;
      root.style.display = 'none';
      listEl.innerHTML = '';
    }, wait);
    restoreScroll();
    try { inst.trigger.setAttribute('aria-expanded', 'false'); } catch (e) { }
    if (focusTrigger && inst.trigger.isConnected) {
      try { inst.trigger.focus({ preventScroll: true }); } catch (e) { }
    }
  }

  /* ---------------- 시각 동기화 ----------------
     클래스만으로 표현되지 않는(태그 선택자 등) 스타일을 트리거에 복사해
     페이지마다 다른 select 디자인을 그대로 유지한다. */
  var COPY_PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-transform', 'text-align', 'color',
    'background-color', 'box-shadow',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'min-height'
  ];

  function syncVisual(inst) {
    var sel = inst.sel, tr = inst.trigger;
    if (!sel.isConnected || !tr.isConnected) return;
    var cs, ct;
    try { cs = getComputedStyle(sel); ct = getComputedStyle(tr); } catch (e) { return; }
    for (var i = 0; i < COPY_PROPS.length; i++) {
      var p = COPY_PROPS[i];
      var a = cs.getPropertyValue(p), b = ct.getPropertyValue(p);
      if (a && a !== b) tr.style.setProperty(p, a);
    }
    /* 네이티브 화살표 배경(data-uri svg)은 지운다 — 우리 화살표를 쓴다 */
    var bi = cs.getPropertyValue('background-image');
    if (bi && bi !== 'none' && /svg\+xml|data:image/i.test(bi) && /M6 9l6 6 6-6|chevron|<path/i.test(bi)) {
      tr.style.setProperty('background-image', 'none');
    }
    /* 인라인으로 고정된 폭(style="width:118px")은 그대로 옮긴다 */
    if (sel.style && sel.style.width && !tr.style.width) tr.style.setProperty('width', sel.style.width);
    if (sel.style && sel.style.height && !tr.style.height) tr.style.setProperty('height', sel.style.height);
    syncCaretRoom(inst);
  }

  /* 숨아둔 원본 select 를 잡시 다시 펼쳐 네이티브일 때의 폭/높이를 잰다.
     페이지가 모달·탭을 열어 주면 트리거가 그 폭을 그대로 이어받게 한다. */
  function measureNative(inst) {
    var sel = inst.sel, tr = inst.trigger;
    if (!sel || !tr || !sel.isConnected) return;
    if (!sel.classList.contains('ldd-src')) return;
    var w = 0, h = 0, disp = '';
    try {
      sel.classList.remove('ldd-src');
      var r = sel.getBoundingClientRect();
      w = r.width; h = r.height;
      disp = getComputedStyle(sel).display;
    } catch (e) { } finally {
      sel.classList.add('ldd-src');
    }
    if (!w || !h || disp === 'none') return;   /* 아직 화면에 없음 */
    inst.natW = w;
    var inlineW = sel.style ? sel.style.width : '';
    if (inlineW || tr.style.width) return;      /* 인라인 폭은 syncVisual 이 옮긴다 */
    var host = inst.field && inst.field.parentElement;
    var room = host ? host.clientWidth : 0;
    var min = Math.round(w);
    if (room > 8) min = Math.min(min, Math.round(room));
    if (min > 0) {
      var val = Math.min(min, 420) + 'px';
      if (tr.style.minWidth !== val) tr.style.minWidth = val;
    }
  }

  function scheduleMeasure(inst) {
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () {
      if (!inst.sel || !inst.sel.isConnected) return;
      measureNative(inst);
      syncVisual(inst);
    });
  }

  function syncCaretRoom(inst) {
    var pr = 0;
    try { pr = parseFloat(getComputedStyle(inst.trigger).paddingRight) || 0; } catch (e) { }
    inst.trigger.style.setProperty('--ldd-vp', pr >= 16 ? '0px' : '14px');
  }

  /* ---------------- 한 개 업그레이드 ---------------- */
  function isTinyA11y(sel) {
    /* 화면에는 안 보이고 스크린리더용으로만 쓰는 select(sr-only 류)는 건드리지 않는다.
       숨겨진 모달 안(레이아웃 상자 없음)은 나중에 보일 수 있으니 업그레이드한다. */
    try {
      var cs = getComputedStyle(sel);
      if (cs.display === 'none') return false;
      var rects = sel.getClientRects ? sel.getClientRects() : [];
      if (!rects || !rects.length) return false;   /* 숨은 조상/아직 안 보임 → 업그레이드 */
      var r = sel.getBoundingClientRect();
      if (r.width <= 6 || r.height <= 6) return true;
      if (cs.clip && cs.clip !== 'auto' && cs.clip.indexOf('rect(0px, 0px') === 0) return true;
      if (cs.clipPath && cs.clipPath.indexOf('inset(50%') === 0) return true;
    } catch (e) { }
    return false;
  }

  function enhanceOne(sel) {
    if (!sel || sel.nodeName !== 'SELECT') return null;
    if (sel.getAttribute('data-ldd') === '1') return null;
    if (sel.multiple || (sel.size && sel.size > 1)) return null;
    if (sel.hasAttribute('data-native-select') || sel.hasAttribute('data-no-dropdown')) return null;
    if (isTinyA11y(sel)) { sel.setAttribute('data-ldd', 'skip'); return null; }

    sel.setAttribute('data-ldd', '1');
    var parent = sel.parentNode;
    if (!parent) return null;

    /* 원래 크기·자동 폭은 measureNative 가 잰다 */
    var inst = { sel: sel, trigger: null, field: null, lastVal: null, wasHidden: null };

    var field = doc.createElement('span');
    field.className = 'ldd-field';

    var trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = copyClasses(sel) + 'ldd-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var styleAttr = sel.getAttribute('style');
    if (styleAttr) trigger.setAttribute('style', styleAttr);
    if (sel.getAttribute('aria-label')) trigger.setAttribute('aria-label', sel.getAttribute('aria-label'));
    if (sel.getAttribute('title')) trigger.setAttribute('title', sel.getAttribute('title'));
    if (sel.disabled) { trigger.disabled = true; trigger.classList.add('is-dis'); }

    trigger.innerHTML =
      '<span class="ldd-val"><span class="ldd-txt"></span></span>' +
      '<span class="ldd-caret">' + ICON_CARET + '</span>';

    inst.sel = sel;
    inst.trigger = trigger;
    inst.field = field;
    inst.txt = trigger.querySelector('.ldd-txt');

    /* 원본 select 는 값·이벤트·폼 전송을 위해 DOM 에 그대로 두고
       화면에서만 1px 로 접어 감춘다. 인라인 style 은 건드리지 않고
       클래스 하나로만 숨긴다 — 페이지가 넣은 width/height/padding 을
       트리거로 그대로 옮겨 그려야 하기 때문. (숨김 정의는 .ldd-src) */
    sel.classList.add('ldd-src');
    sel.setAttribute('tabindex', '-1');

    parent.insertBefore(field, sel);
    field.appendChild(sel);
    field.appendChild(trigger);

    /* 자동 폭 select 는 네이티브일 때의 폭을 最小 폭으로 유지 — 값이 바뀌어도
       줄이 밀리지 않는다. (숨은 채로 만들어졌으면 보이는 순간 다시 젠다) */
    if (sel.style.getPropertyValue('height')) trigger.style.height = sel.style.getPropertyValue('height');

    instances.push(inst);
    measureNative(inst);

    inst.syncLabel = function () {
      var v = sel.options && sel.options.length ? optionText(sel.options[getIndex(sel)] || {}) : '';
      if (v === undefined || v === null) v = '';
      if (inst.txt.textContent !== v) inst.txt.textContent = v;
      inst.lastVal = getValue(sel);
      trigger.classList.toggle('is-placeholder', !v);
    };
    inst.syncLabel();

    /* value / selectedIndex 를 페이지가 직접 바꿔도 라벨이 따라간다 */
    try {
      if (valDesc && valDesc.get && valDesc.set) {
        Object.defineProperty(sel, 'value', {
          configurable: true, enumerable: true,
          get: function () { return valDesc.get.call(this); },
          set: function (v) { valDesc.set.call(this, v); try { inst.syncLabel(); } catch (e) { } }
        });
      }
      if (idxDesc && idxDesc.get && idxDesc.set) {
        Object.defineProperty(sel, 'selectedIndex', {
          configurable: true, enumerable: true,
          get: function () { return idxDesc.get.call(this); },
          set: function (v) { idxDesc.set.call(this, v); try { inst.syncLabel(); } catch (e) { } }
        });
      }
    } catch (e) { }

    /* 상호작용 */
    trigger.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (sel.disabled) return;
      open(inst);
    });
    trigger.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
        ev.preventDefault();
        if (sel.disabled) return;
        open(inst);
        if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp') return;
      }
    });

    /* label 클릭 등으로 select 가 직접 눌려도 네이티브 팝업이 뜨지 않게 */
    sel.addEventListener('mousedown', function (ev) { ev.preventDefault(); }, true);
    sel.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sel.disabled) open(inst);
    }, true);
    sel.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        if (!sel.disabled) open(inst);
      }
    }, true);
    sel.addEventListener('change', function () { inst.syncLabel(); });

    /* 옵션 재구성 · 표시/비활성 변화 추적 */
    var mutating = false;
    function mirror() {
      if (mutating) return;
      /* 보임/숨김 */
      var hidden = false;
      try {
        var cs = getComputedStyle(sel);
        hidden = (cs.display === 'none') || (cs.visibility === 'hidden');
      } catch (e) { }
      if (sel.hidden) hidden = true;
      trigger.style.display = hidden ? 'none' : '';
      /* 조상이 display:none 이면 getClientRects 가 비어 있다(모달·탭이 닫힌 상태).
         트리거 자체는 숨기지 않는다 — 감싸는 상자가 어차피 안 보이고,
         여기서 display:none 을 걸면 탭이 열려도 다시 보이지 않는다. */
      var laidOut = false;
      try {
        var rects = sel.getClientRects ? sel.getClientRects() : null;
        laidOut = !!(rects && rects.length);
      } catch (e) { }
      if (laidOut !== inst.wasHidden) {
        inst.wasHidden = laidOut;
        if (laidOut) scheduleMeasure(inst);   /* 숨어서 만들어진 select 를 이제 젠다 */
      }
      /* 클래스 동기화 (페이지가 상태 클래스를 붙였다 떼는 경우) */
      var want = copyClasses(sel) + 'ldd-trigger' +
        (trigger.classList.contains('is-dis') && !sel.disabled ? ' is-dis' : '');
      if (trigger.className !== want) {
        var dis = trigger.disabled;
        trigger.className = want;
        trigger.disabled = dis;
      }
      trigger.disabled = !!sel.disabled;
      trigger.classList.toggle('is-dis', !!sel.disabled);
    }
    function refresh() {
      mutating = true;
      mirror();
      inst.syncLabel();
      syncVisual(inst);
      mutating = false;
      if (openState && openState.inst === inst) {
        var keep = openState.q;
        renderList(inst);
        if (keep) { searchEl.value = keep; onSearchInput(); }
      }
    }

    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { mutating = false; refresh(); });
      mo.observe(sel, { childList: true, subtree: true, characterData: true, attributes: true });
    }

    syncVisual(inst);
    mirror();

    return inst;
  }

  /* ---------------- 문서 전체 업그레이드 ---------------- */
  function enhanceAll(scope) {
    var host = scope || doc;
    if (!host) return;
    if (host.nodeType === 1 && host.nodeName === 'SELECT') { enhanceOne(host); return; }
    if (!host.querySelectorAll) return;
    var found = host.querySelectorAll('select');
    for (var i = 0; i < found.length; i++) enhanceOne(found[i]);
  }

  var queue = [], queued = false;
  function flush() {
    queued = false;
    var list = queue;
    queue = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n || n.nodeType !== 1 || !n.isConnected) continue;
      if (n.nodeName === 'SELECT') { enhanceOne(n); continue; }
      if (root && root.contains(n)) continue;
      if (n.querySelector) {
        var s = n.querySelectorAll('select');
        for (var j = 0; j < s.length; j++) enhanceOne(s[j]);
      }
    }
  }

  function watch() {
    if (!doc.body || !window.MutationObserver) return;
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n && n.nodeType === 1 && n !== root) queue.push(n);
        }
      }
      if (!queue.length || queued) return;
      queued = true;
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(flush);
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  /* value 를 직접 대입하는(옵션 재렌더 없이) 페이지를 위한 주기 점검 */
  function heartbeat() {
    setInterval(function () {
      for (var i = 0; i < instances.length; i++) {
        var it = instances[i];
        if (!it.sel.isConnected) continue;
        var v = getValue(it.sel);
        if (v !== it.lastVal) it.syncLabel();
      }
    }, 900);
  }

  function boot() {
    enhanceAll(doc);
    watch();
    heartbeat();
    doc.addEventListener('lemon:theme', function () {
      for (var i = 0; i < instances.length; i++) syncVisual(instances[i]);
    });
    var rt = 0;
    window.addEventListener('resize', function () {
      if (rt) return;
      rt = setTimeout(function () {
        rt = 0;
        for (var i = 0; i < instances.length; i++) {
          if (!instances[i].sel.isConnected) continue;
          measureNative(instances[i]);
          syncVisual(instances[i]);
        }
      }, 220);
    }, { passive: true });
    /* 웹폰트가 늦게 도착하면 글자 폭이 바뀐다 — 그때 한 번 더 잰다 */
    try {
      if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
        doc.fonts.ready.then(function () {
          for (var i = 0; i < instances.length; i++) {
            if (instances[i].sel.isConnected) { measureNative(instances[i]); syncVisual(instances[i]); }
          }
        });
      }
    } catch (e) { }
    /* 주기적 재측정: 탭이 늦게 열리거나 애니메이션으로 크기가 바뀌는 경우 */
    var tick = 0;
    setInterval(function () {
      if (++tick % 2) return;   /* 2초마다 */
      for (var i = 0; i < instances.length; i++) {
        var it = instances[i];
        if (!it.sel.isConnected || it.natW) continue;
        var r = it.trigger.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) measureNative(it);
      }
    }, 1000);
    /* 페이지가 늦게 그리는 select (모달·재렌더) 한 번 더 */
    setTimeout(function () { enhanceAll(doc); }, 500);
    setTimeout(function () { enhanceAll(doc); }, 1500);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LemonDropdown = {
    enhance: enhanceOne,
    enhanceAll: function (scope) { enhanceAll(scope || doc); },
    open: function (sel) {
      var inst = null;
      for (var i = 0; i < instances.length; i++) if (instances[i].sel === sel) inst = instances[i];
      if (!inst) inst = enhanceOne(sel);
      if (inst) open(inst);
    },
    close: function () { close(true); },
    isOpen: function () { return !!openState; },
    refresh: function (sel) {
      for (var i = 0; i < instances.length; i++) {
        if (!sel || instances[i].sel === sel) {
          instances[i].syncLabel();
          syncVisual(instances[i]);
        }
      }
    }
  };
})();
