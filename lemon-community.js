/* ============================================================
   Lemon soft · Community kit  (lemon-community.js)
   ------------------------------------------------------------
   커뮤니티 앱 전시(portal.html · index.html · admin.html)가 함께 쓰는 값과 도구.

   · ICONS      Soft Hub 앱 타일에 쓰는 SVG 아이콘(키 → path). 이모지는 쓰지 않는다.
   · CATEGORIES 등록 분류 — community_apps.category 의 check 제약과 같은 목록
   · statusMeta 승인 대기 / 게시 중 / 반려됨 배지
   · normalizeUrl · esc · dateShort 같은 작은 도구

   색은 앱마다 하나(--c)만 정하고, 밝은 배경·테두리·어두운 모드는 CSS 의
   color-mix 로 만든다. 그래서 어떤 색을 골라도 타일이 깨지지 않는다.
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonCommunity && window.LemonCommunity.__v) return;

  /* ---------------- 아이콘 (24x24 · stroke) ---------------- */
  var ICONS = {
    globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4a14 14 0 0 1 0 17.2 14 14 0 0 1 0-17.2z"/>',
    grid: '<rect x="3.4" y="3.4" width="7.4" height="7.4" rx="2"/><rect x="13.2" y="3.4" width="7.4" height="7.4" rx="2"/><rect x="3.4" y="13.2" width="7.4" height="7.4" rx="2"/><rect x="13.2" y="13.2" width="7.4" height="7.4" rx="2"/>',
    calendar: '<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.6"/><path d="M3.4 10.4h17.2"/><path d="M8 2.8v4.4"/><path d="M16 2.8v4.4"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2"/>',
    note: '<path d="M6 3.4h8.4l4.2 4.2v13H6z"/><path d="M14.2 3.6v4.2h4.2"/><path d="M9 12.4h6.4"/><path d="M9 16.2h4.6"/>',
    chart: '<path d="M4.2 20V10.6"/><path d="M10 20V4.4"/><path d="M15.8 20v-6.2"/><path d="M21.2 20H2.8"/>',
    wallet: '<rect x="2.8" y="6" width="18.4" height="13.2" rx="2.8"/><path d="M2.8 10.4h18.4"/><path d="M16.4 14.8h2.4"/><path d="M6.4 6V4.6h9.6"/>',
    camera: '<path d="M3.4 8.6h3.4l1.8-2.6h6.8l1.8 2.6h3.4v10.4H3.4z"/><circle cx="12" cy="13.2" r="3.4"/>',
    image: '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.6"/><circle cx="8.6" cy="9.4" r="1.7"/><path d="m4.6 18.6 4.8-5 3.4 3.2 2.6-2.6 3.6 3.4"/>',
    music: '<path d="M9.2 17.4V5.6l10-2v11.8"/><ellipse cx="6.6" cy="18" rx="2.6" ry="2.2"/><ellipse cx="16.6" cy="16.8" rx="2.6" ry="2.2"/>',
    film: '<rect x="2.8" y="4.4" width="18.4" height="15.2" rx="2.6"/><path d="M8 4.4v15.2"/><path d="M16 4.4v15.2"/><path d="M2.8 12h18.4"/>',
    game: '<rect x="2.6" y="7.4" width="18.8" height="9.6" rx="4.4"/><path d="M7.4 12.4h3"/><path d="M8.9 10.9v3"/><circle cx="16" cy="11.6" r=".9"/><circle cx="18.2" cy="13.8" r=".9"/>',
    code: '<path d="m8.6 8.4-4 3.6 4 3.6"/><path d="m15.4 8.4 4 3.6-4 3.6"/><path d="m13.4 6.2-2.8 11.6"/>',
    terminal: '<rect x="2.8" y="4.4" width="18.4" height="15.2" rx="2.6"/><path d="m7 9.8 2.6 2.6L7 15"/><path d="M12.6 15.4h4.6"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.2 4.4 4.4 0 0 0 6.5 19z"/>',
    book: '<path d="M12 6.4C10.6 5 8.4 4.4 4.4 4.4v14.2c4 0 6.2.6 7.6 2 1.4-1.4 3.6-2 7.6-2V4.4c-4 0-6.2.6-7.6 2z"/><path d="M12 6.4v14.2"/>',
    mail: '<rect x="2.8" y="5.4" width="18.4" height="13.2" rx="2.8"/><path d="m3.6 7.2 8.4 6 8.4-6"/>',
    map: '<path d="M9 4.2 3.4 6.6v13.2l5.6-2.4 6 2.4 5.6-2.4V4.2L15 6.6z"/><path d="M9 4.2v13.2"/><path d="M15 6.6v13.2"/>',
    chat: '<path d="M20.6 12a8.6 8.6 0 0 1-12.6 7.5L3.4 20.6l1.1-4.7A8.6 8.6 0 1 1 20.6 12z"/>',
    shield: '<path d="M12 3.2l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9v-6z"/><path d="m9.4 12.2 1.9 1.9 3.6-3.7"/>',
    bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10H12z"/>',
    layers: '<path d="m12 3.2 8.4 4.4L12 12 3.6 7.6z"/><path d="m3.6 12.2 8.4 4.4 8.4-4.4"/><path d="m3.6 16.6 8.4 4.4 8.4-4.4"/>',
    search: '<circle cx="11" cy="11" r="7.2"/><path d="m21 21-4.6-4.6"/>',
    link: '<path d="M10 13.8a4.2 4.2 0 0 0 6.3.5l2.4-2.4a4.2 4.2 0 0 0-5.9-5.9l-1.4 1.4"/><path d="M14 10.2a4.2 4.2 0 0 0-6.3-.5l-2.4 2.4a4.2 4.2 0 0 0 5.9 5.9l1.4-1.4"/>',
    box: '<path d="M20.6 7.8 12 3.4 3.4 7.8v8.4L12 20.6l8.6-4.4z"/><path d="m3.6 7.9 8.4 4.3 8.4-4.3"/><path d="M12 12.2v8.4"/>',
    puzzle: '<path d="M10 3.4h4v2.6a1.9 1.9 0 1 0 3.8 0V3.4h2.8v4.8h-2.6a1.9 1.9 0 1 1 0 3.8h2.6v8.6h-8.6v-2.6a1.9 1.9 0 1 0-3.8 0v2.6H3.4V12h2.6a1.9 1.9 0 1 0 0-3.8H3.4V3.4H10z"/>',
    sparkle: '<path d="M12 3.4l1.9 4.4 4.7 1.9-4.7 1.9L12 16l-1.9-4.4L5.4 9.7l4.7-1.9z"/><path d="M18.4 15.4l.9 2 2.1.9-2.1.9-.9 2-.9-2-2.1-.9 2.1-.9z"/>',
    heart: '<path d="M12 20.4S3.6 15 3.6 9.3a4.4 4.4 0 0 1 8.4-1.9 4.4 4.4 0 0 1 8.4 1.9c0 5.7-8.4 11.1-8.4 11.1z"/>',
    checklist: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.8"/><path d="m7.6 12.2 2.6 2.6 5.2-5.4"/>',
    calculator: '<rect x="4.4" y="2.8" width="15.2" height="18.4" rx="2.6"/><rect x="7.4" y="5.6" width="9.2" height="4" rx="1.2"/><path d="M8.2 13.4h.8"/><path d="M12 13.4h.8"/><path d="M15.8 13.4h.8"/><path d="M8.2 17h.8"/><path d="M12 17h.8"/><path d="M15.8 17h.8"/>',
    palette: '<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.6 0 2.2-1.1 1.6-2.4-.7-1.6.5-3 2.2-3h2.4a2.4 2.4 0 0 0 2.4-2.4A8.6 8.6 0 0 0 12 3.4z"/><circle cx="8.4" cy="9.4" r=".9"/><circle cx="12.4" cy="7.6" r=".9"/><circle cx="8.6" cy="14" r=".9"/>',
    mic: '<rect x="9" y="2.6" width="6" height="10.4" rx="3"/><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0"/><path d="M12 18v3.4"/>',
    video: '<rect x="2.6" y="6" width="13.4" height="12" rx="2.8"/><path d="m16.4 12 5-3v6z"/>',
    star: '<polygon points="12 2.6 15.1 8.3 21.4 9.3 16.7 13.9 17.9 20.2 12 17.2 6.1 20.2 7.3 13.9 2.6 9.3 8.9 8.3"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.6-3.6a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.12 2.12 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    rocket: '<path d="M12 3.2c3.2 1.7 5 4.9 5 8.5 0 2.5-1 4.7-2.4 6.3H9.4A9.9 9.9 0 0 1 7 11.7c0-3.6 1.8-6.8 5-8.5z"/><circle cx="12" cy="10" r="1.8"/><path d="M9.4 18 7.6 21l3-1.2"/><path d="m14.6 18 1.8 3-3-1.2"/>'
  };

  /* 픽커에 차례대로 보이는 순서 */
  var ICON_KEYS = [
    'globe', 'grid', 'sparkle', 'rocket', 'bolt',
    'calendar', 'clock', 'checklist', 'note', 'book',
    'calculator', 'wallet', 'chart', 'mail', 'chat',
    'image', 'camera', 'palette', 'music', 'film',
    'video', 'mic', 'game', 'code',
    'terminal', 'cloud', 'link', 'search',
    'map', 'box', 'layers', 'puzzle', 'shield', 'heart', 'star', 'wrench'
  ];

  /* ---------------- 분류 ---------------- */
  var CATEGORIES = [
    { id: 'utility', label: '생활 도구', desc: '돈·일정·여행·집안' },
    { id: 'productivity', label: '생산성', desc: '문서·메모·할 일' },
    { id: 'media', label: '미디어', desc: '사진·영상·음악' },
    { id: 'game', label: '게임', desc: '가볍게 즐기는 놀이' },
    { id: 'dev', label: '개발', desc: '빌드·배포·디버깅' },
    { id: 'etc', label: '기타', desc: '그 밖의 서비스' }
  ];

  function catLabel(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].label;
    return '기타';
  }

  function statusMeta(status) {
    if (status === 'approved') return { id: 'approved', label: '게시 중', cls: 'ok' };
    if (status === 'rejected') return { id: 'rejected', label: '반려됨', cls: 'bad' };
    return { id: 'pending', label: '승인 대기', cls: 'wait' };
  }

  /* ---------------- 작은 도구 ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* http/https 주소만 통과. 스킴이 없으면 https:// 를 붙여 본다. */
  function normalizeUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    if (!/^https?:\/\//i.test(s)) return '';
    try {
      var u = new URL(s);
      if (!u.hostname || u.hostname.indexOf('.') < 0 || /\s/.test(s)) return '';
      return s;
    } catch (e) { return ''; }
  }

  /* 이쁘게 보여 주는 주소 — 스킴과 끝 슬래시를 뺀 host + path */
  function prettyUrl(raw) {
    var s = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return s || String(raw || '');
  }

  function hostOf(raw) {
    try { return new URL(String(raw || '')).hostname.replace(/^www\./i, ''); }
    catch (e) { return ''; }
  }

  function iconSvg(key, extraClass) {
    var body = ICONS[key] || ICONS.globe;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' +
      (extraClass ? ' class="' + esc(extraClass) + '"' : '') + ' aria-hidden="true">' + body + '</svg>';
  }

  function iconKey(key) { return ICONS[key] ? key : 'globe'; }

  /* 타일 색 — --c 하나만 정하고 나머지는 CSS 가 color-mix 로 만든다. */
  function tileStyle(color) {
    var c = String(color || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) c = '#3b82f6';
    return '--c:' + c;
  }

  function daysAgo(iso) {
    var t = iso ? new Date(iso).getTime() : 0;
    if (!t) return '';
    var d = Math.floor((Date.now() - t) / 86400000);
    if (d <= 0) return '오늘';
    if (d === 1) return '어제';
    if (d < 30) return d + '일 전';
    if (d < 365) return Math.floor(d / 30) + '개월 전';
    return Math.floor(d / 365) + '년 전';
  }

  /* ---------------- 즐겨찾기 (커뮤니티 전용 키) ---------------- */
  var FAV_KEY = 'soft_hub_community_favs_v1';
  function favs() {
    try {
      var raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(function (x) { return typeof x === 'string'; }) : [];
    } catch (e) { return []; }
  }
  function isFav(id) { return favs().indexOf(String(id)) >= 0; }
  function toggleFav(id) {
    id = String(id);
    var list = favs(), i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.unshift(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 300))); } catch (e) { }
    return i < 0;
  }

  window.LemonCommunity = {
    __v: 1,
    ICONS: ICONS,
    ICON_KEYS: ICON_KEYS,
    CATEGORIES: CATEGORIES,
    catLabel: catLabel,
    statusMeta: statusMeta,
    esc: esc,
    normalizeUrl: normalizeUrl,
    prettyUrl: prettyUrl,
    hostOf: hostOf,
    iconSvg: iconSvg,
    iconKey: iconKey,
    tileStyle: tileStyle,
    daysAgo: daysAgo,
    favs: favs,
    isFav: isFav,
    toggleFav: toggleFav,
    favKey: FAV_KEY
  };
})();
