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
  window.LemonAnim = { mode: read, setMode: setMode };
})();
