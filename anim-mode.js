/* ============================================================
   Lemon soft · 전역 애니메이션 모드
   Developer Hub의 설정(lemon_anim_mode: full | reduced | off)을
   공유 런타임을 쓰지 않는 페이지에서도 그대로 따른다.
   ============================================================ */
(function () {
  'use strict';
  var KEY = 'lemon_anim_mode';
  function read() {
    try {
      var m = localStorage.getItem(KEY) || 'full';
      return (m === 'reduced' || m === 'off') ? m : 'full';
    } catch (e) { return 'full'; }
  }
  function apply(mode) {
    if (mode !== 'reduced' && mode !== 'off') mode = 'full';
    document.documentElement.setAttribute('data-anim', mode);
  }
  function setMode(mode) {
    mode = (mode === 'reduced' || mode === 'off') ? mode : 'full';
    try { localStorage.setItem(KEY, mode); } catch (e) { }
    apply(mode);
    return mode;
  }
  apply(read());
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) apply(e.newValue);
  });

  /* ---- 커스텀 컬러 피커 연결 ----
     <input type="color"> 가 있는 페이지에서만 lemon-picker.js/.css 를
     불러와, 브라우저 기본 색상 대화상자 대신 자체 피커를 쓴다. */
  var src = (document.currentScript && document.currentScript.src) || '';
  function pickerBase() {
    try { return String(src).replace(/[?#].*$/, '').replace(/[^/]*$/, ''); } catch (e) { return ''; }
  }
  function loadPicker() {
    if (window.__lcpLoad) return;
    window.__lcpLoad = 1;
    var base = pickerBase();
    try {
      if (!document.querySelector('link[href$="lemon-picker.css"]')) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = base + 'lemon-picker.css';
        document.head.appendChild(l);
      }
      if (!window.LemonColorPicker) {
        var s = document.createElement('script');
        s.src = base + 'lemon-picker.js';
        s.async = true;
        document.head.appendChild(s);
      }
    } catch (e) { }
  }
  function watchPicker() {
    if (window.LemonColorPicker) { window.LemonColorPicker.enhanceAll(document); return; }
    if (document.querySelector('input[type="color"]')) { loadPicker(); return; }
    if (!window.MutationObserver || !document.body) return;
    var timer = 0;
    var mo = new MutationObserver(function () {
      // 무거운 앱(빌더 등)이 잦게 다시 그려도 문서 전체 검색은 250ms에 한 번만.
      if (timer) return;
      timer = setTimeout(function () {
        timer = 0;
        if (!document.querySelector('input[type="color"]')) return;
        mo.disconnect();
        loadPicker();
      }, 250);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPicker);
  else watchPicker();

  window.LemonAnim = { mode: read, setMode: setMode };
})();
