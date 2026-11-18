/* ============================================================
   Lemon soft · Site layer  (lemon-site.js)
   ------------------------------------------------------------
   Soft Hub 전 서비스에 한 번 붙는 사이트 공통 런타임.

   1) 상단 공지사항 배너 — 관리자 콘솔에서 ON/OFF · 문구 · 배지 · 링크 ·
      닫기 허용 · 배경/글자색을 정하면 모든 서비스 위에 자동으로 표시된다.
   2) Soft Hub 홈 배너 — index.html 홈 최상단 배너(#lemonHomeBanner).
   3) 광고 — Flux Feed(feed.html)가 기사 사이에 광고 카드를 끼워 넣을 때 쓰는
      렌더러와 노출 규칙(activeAds / feedAds). 관리자 미리보기도 같은 렌더러.
   4) 허브 로그인 상태 — 우측 상단 / 모바일 메뉴의 로그인 버튼.

   저장 위치
     localStorage['lemon_site_config_v1']  ← 관리자 콘솔이 저장 (이 브라우저)
     localStorage['lemon_site_ads_v1']     ← 관리자 콘솔이 저장 (이 브라우저)
     Supabase site_config / site_ads       ← 연결 시 원격 저장본 (전 방문자)
   읽는 순서: 기본값 → 원격 → 이 브라우저 저장본
   Supabase 가 설정되지 않아도 모든 기능이 로컬만으로 동작한다.
   ============================================================ */
(function () {
  'use strict';

  if (window.LemonSite && window.LemonSite.__v) return;

  var doc = document;

  /* ---------------- 저장 키 ---------------- */
  var K_CFG = 'lemon_site_config_v1';
  var K_ADS = 'lemon_site_ads_v1';
  var K_REMOTE_CFG = 'lemon_site_remote_cfg_v1';
  var K_REMOTE_ADS = 'lemon_site_remote_ads_v1';
  var K_NOTICE_ACK = 'lemon_notice_ack_v1';
  var K_HOME_ACK = 'lemon_home_ack_v1';

  /* ---------------- 기본값 ---------------- */
  var DEFAULTS = {
    notice: {
      enabled: false,
      badge: '안내',
      text: 'Soft Hub에 새 서비스가 추가되었습니다.',
      link: '',
      linkText: '자세히 보기',
      dismissible: true,
      bg: '#111827',
      fg: '#ffffff',
      accent: '#3b82f6'
    },
    home: {
      enabled: true,
      badge: 'NEW',
      title: 'FLUX Feed — 24개 언론사 헤드라인을 한 화면에',
      subtitle: '설치도 로그인도 없이 바로 열리는 무료 도구 78종. 오늘도 그대로 무료입니다.',
      btnText: 'FLUX Feed 열기',
      btnUrl: 'feed.html',
      style: 'gradient',
      bg: '#2563eb',
      fg: '#ffffff',
      accent: '#6366f1',
      dismissible: true
    },
    ads: { enabled: true }
  };

  /* ---------------- 샘플 광고 이미지 (인라인 SVG, 외부 요청 0) ---------------- */
  function svgImage(label, sub, c1, c2) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="1200" height="675" fill="url(#g)"/>' +
      '<circle cx="985" cy="120" r="190" fill="#ffffff" opacity="0.10"/>' +
      '<circle cx="1090" cy="600" r="240" fill="#ffffff" opacity="0.07"/>' +
      '<rect x="88" y="88" width="150" height="150" rx="38" fill="#ffffff" opacity="0.14"/>' +
      '<rect x="118" y="118" width="90" height="90" rx="24" fill="#ffffff" opacity="0.9"/>' +
      '<text x="88" y="410" font-family="Helvetica, Arial, sans-serif" font-size="88" font-weight="bold" fill="#ffffff">' + label + '</text>' +
      '<text x="90" y="470" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#ffffff" opacity="0.82">' + sub + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------------- 기본 광고 프리셋 (관리자가 아직 등록하지 않아도 보임) ---------------- */
  var SAMPLE_ADS = [
    {
      id: 'sample-hub',
      name: 'Soft Hub 소개 (샘플)',
      enabled: true,
      type: 'text',
      size: 'compact',
      style: 'brand',
      badge: 'AD',
      sponsor: 'Lemon soft',
      title: 'Soft Hub — 무료 웹 도구 78종',
      desc: '문서·시트·슬라이드부터 가계부까지, 설치 없이 바로 여는 도구 모음',
      btnText: '둘러보기',
      url: 'index.html',
      image: '',
      imageAlt: '',
      caption: '',
      bg: '',
      accent: '#2563eb',
      position: 'feed',
      interval: 6,
      order: 1
    },
    {
      id: 'sample-money',
      name: 'Lemon Money (샘플)',
      enabled: true,
      type: 'text',
      size: 'standard',
      style: 'dark',
      badge: 'AD',
      sponsor: 'Lemon soft',
      title: 'Lemon Money — 카드 문자로 끝나는 가계부',
      desc: '카드 결제 문자와 영수증을 붙여넣으면 자동으로 분류합니다. 예산·자산·고정비까지 한 화면에서.',
      btnText: '가계부 열기',
      url: 'money.html',
      image: '',
      imageAlt: '',
      caption: '',
      bg: '',
      accent: '#22c55e',
      position: 'feed',
      interval: 9,
      order: 2
    },
    {
      id: 'sample-slides',
      name: 'FLUX Slides (샘플)',
      enabled: true,
      type: 'image',
      size: 'standard',
      style: 'minimal',
      badge: 'AD',
      sponsor: 'FLUX',
      title: 'FLUX Slides — 3분 만에 끝나는 발표자료',
      desc: '템플릿 5종 · 전환 9종 · PPTX·PDF 내보내기까지 브라우저에서.',
      btnText: '슬라이드 만들기',
      url: 'slides.html',
      image: svgImage('FLUX Slides', 'Presentation, built in the browser', '#3b82f6', '#8b5cf6'),
      imageAlt: 'FLUX Slides 템플릿 미리보기',
      caption: '',
      bg: '',
      accent: '#6366f1',
      position: 'feed',
      interval: 9,
      order: 3
    },
    {
      id: 'sample-builder',
      name: 'Flux Builder (샘플)',
      enabled: true,
      type: 'image',
      size: 'featured',
      style: 'outline',
      badge: 'AD',
      sponsor: 'FLUX',
      title: 'Flux Builder — 클릭만으로 웹사이트 완성',
      desc: '20종 블록을 끌어다 놓으면 끝. 폼·블로그·퀴즈까지 붙이고 바로 게시하세요. 코딩은 필요 없습니다.',
      btnText: '사이트 만들기',
      url: 'builder.html',
      image: svgImage('Flux Builder', 'Drag, drop, publish', '#0f172a', '#334155'),
      imageAlt: 'Flux Builder 편집 화면 미리보기',
      caption: '',
      bg: '',
      accent: '#2563eb',
      position: 'feed',
      interval: 15,
      order: 4
    }
  ];

  /* ---------------- 유틸 ---------------- */
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
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
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function sig(str) {
    var h = 5381, i = 0;
    str = String(str || '');
    for (i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36) + '-' + str.length;
  }
  function animOff() {
    try { return (localStorage.getItem('lemon_anim_mode') || 'full') === 'off'; } catch (e) { return false; }
  }
  function isSafeUrl(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    if (/^(javascript|data:text\/html|vbscript):/i.test(s)) return '';
    return s;
  }
  function mergeDeep(base, over) {
    var out = clone(base) || {};
    if (!over || typeof over !== 'object') return out;
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = mergeDeep(out[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    });
    return out;
  }

  /* ---------------- 설정 읽기 ---------------- */
  var remoteCfg = null, remoteAds = null, loadP = null, listeners = [];

  function localCfg() { var v = readJSON(K_CFG, null); return v && typeof v === 'object' ? v : null; }
  function localAds() { var v = readJSON(K_ADS, null); return Array.isArray(v) ? v : null; }

  function getConfig() {
    var cfg = mergeDeep(DEFAULTS, remoteCfg || {});
    var loc = localCfg();
    if (loc) cfg = mergeDeep(cfg, loc);
    return cfg;
  }

  function getAds() {
    var loc = localAds();
    if (loc) return loc.slice();
    /* 관리자가 원격에 광고 설정을 저장한 뒤라면, 목록이 비어 있어도 그 상태를 따른다.
       (저장 전에는 기본 샘플 광고가 보인다.) */
    if (remoteCfg && remoteCfg.ads && Array.isArray(remoteAds)) return remoteAds.slice();
    return clone(SAMPLE_ADS);
  }

  function activeAds(position) {
    var cfg = getConfig();
    if (cfg.ads && cfg.ads.enabled === false) return [];
    return getAds()
      .filter(function (a) {
        if (!a || a.enabled === false) return false;
        var p = a.position || 'feed';
        return p === position || p === 'all';
      })
      .sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
  }

  /* ---------------- 렌더: 상단 공지 배너 ---------------- */
  function renderNotice() {
    var old = doc.getElementById('lemonNoticeBar');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var cfg = getConfig();
    var n = cfg.notice || {};
    if (!n.enabled || !String(n.text || '').trim()) return;

    var ackKey = sig([n.badge, n.text, n.link].join('|'));
    if (n.dismissible) {
      try { if (localStorage.getItem(K_NOTICE_ACK) === ackKey) return; } catch (e) { }
    }

    var bar = doc.createElement('div');
    bar.id = 'lemonNoticeBar';
    if (animOff()) bar.className = 'ls-anim-off';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '사이트 공지사항');
    bar.style.setProperty('--ls-notice-bg', n.bg || '#111827');
    bar.style.setProperty('--ls-notice-fg', n.fg || '#ffffff');
    bar.style.setProperty('--ls-notice-accent', n.accent || '#3b82f6');

    var link = isSafeUrl(n.link);
    var inner =
      '<div class="ls-notice">' +
      '<div class="ls-notice__inner">' +
      (n.badge ? '<span class="ls-notice__badge">' + esc(n.badge) + '</span>' : '') +
      '<span class="ls-notice__text">' + esc(n.text) + '</span>' +
      (link ? '<a class="ls-notice__cta" href="' + esc(link) + '" rel="noopener">' + esc(n.linkText || '자세히 보기') +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg></a>' : '') +
      '</div>' +
      (n.dismissible ?
        '<button type="button" class="ls-notice__close" aria-label="공지사항 닫기">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' : '') +
      '</div>';
    bar.innerHTML = inner;

    var close = bar.querySelector('.ls-notice__close');
    if (close) {
      close.addEventListener('click', function () {
        try { localStorage.setItem(K_NOTICE_ACK, ackKey); } catch (e) { }
        bar.style.transition = 'opacity .22s ease, transform .22s ease';
        bar.style.opacity = '0';
        bar.style.transform = 'translateY(-10px)';
        setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 220);
      });
    }

    if (doc.body) {
      doc.body.insertBefore(bar, doc.body.firstChild);
      /* body 가 가로 flex 레이아웃인 페이지(예: 좌측 레일 + 앱)에서는
         공지 바를 흐름에 넣으면 레일과 나란히 서서 가로로 넘친다.
         그런 페이지에서만 고정 바로 띄우고 본문을 그만큼 내린다. */
      try {
        var bs = getComputedStyle(doc.body);
        if (bs.display === 'flex' && bs.flexDirection.indexOf('row') === 0) {
          var h = Math.max(32, Math.round(bar.getBoundingClientRect().height) || 40);
          bar.style.position = 'fixed';
          bar.style.top = '0';
          bar.style.left = '0';
          bar.style.right = '0';
          bar.style.zIndex = '900';
          bar.style.width = '100%';
          doc.body.style.paddingTop = h + 'px';
        }
      } catch (e) { }
    }
  }

  /* ---------------- 렌더: Soft Hub 홈 배너 ---------------- */
  function renderHome() {
    var host = doc.getElementById('lemonHomeBanner');
    if (!host) return;
    var cfg = getConfig();
    var h = cfg.home || {};
    if (!h.enabled) { host.className = 'ls-hidden'; host.innerHTML = ''; return; }

    var ackKey = sig([h.badge, h.title, h.subtitle, h.btnText, h.btnUrl].join('|'));
    if (h.dismissible) {
      try { if (localStorage.getItem(K_HOME_ACK) === ackKey) { host.className = 'ls-hidden'; host.innerHTML = ''; return; } } catch (e) { }
    }

    var style = ['gradient', 'solid', 'outline', 'dark'].indexOf(h.style) >= 0 ? h.style : 'gradient';
    var accent = h.accent || '#6366f1';
    var cls = 'ls-homebanner ls-homebanner--' + style + (animOff() ? ' ls-anim-off' : '');
    var url = isSafeUrl(h.btnUrl);
    var vars = '--ls-home-accent:' + esc(accent) + ';';
    if (style === 'solid') vars += '--ls-home-solid:' + esc(h.bg || '#2563eb') + ';';
    if (h.fg && style !== 'gradient') vars += '--ls-home-fg:' + esc(h.fg) + ';';
    if (h.bg && (style === 'gradient' || style === 'outline')) vars += '--ls-home-bg:' + esc(h.bg) + ';';

    host.className = '';
    host.innerHTML =
      '<div class="' + cls + '" style="' + esc(vars) + '">' +
      '<span class="ls-homebanner__orb" aria-hidden="true"></span>' +
      '<span class="ls-homebanner__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3l2.6 5.6L20.5 11l-5.9 2.4L12 19l-2.6-5.6L3.5 11l5.9-2.4z"></path></svg></span>' +
      '<div class="ls-homebanner__body">' +
      (h.badge ? '<span class="ls-homebanner__kicker">' + esc(h.badge) + '</span>' : '') +
      '<h2 class="ls-homebanner__title">' + esc(h.title || '') + '</h2>' +
      (h.subtitle ? '<p class="ls-homebanner__sub">' + esc(h.subtitle) + '</p>' : '') +
      '</div>' +
      (url ? '<div class="ls-homebanner__actions"><a class="ls-homebanner__btn" href="' + esc(url) + '">' +
        esc(h.btnText || '열기') +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>' +
        '</a></div>' : '') +
      (h.dismissible ? '<button type="button" class="ls-homebanner__close" aria-label="배너 닫기">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>' : '') +
      '</div>';

    var close = host.querySelector('.ls-homebanner__close');
    if (close) {
      close.addEventListener('click', function () {
        try { localStorage.setItem(K_HOME_ACK, ackKey); } catch (e) { }
        host.className = 'ls-hidden';
        host.innerHTML = '';
      });
    }
  }

  /* ---------------- 렌더: 광고 카드 ---------------- */
  function normalizeAd(a) {
    var ad = mergeDeep({
      id: '', name: '', enabled: true, type: 'text', size: 'standard', style: 'minimal',
      badge: 'AD', sponsor: '', title: '', desc: '', btnText: '자세히 보기', url: '',
      image: '', imageAlt: '', caption: '', bg: '', accent: '#2563eb', position: 'feed', interval: 6
    }, a || {});
    if (['compact', 'standard', 'featured'].indexOf(ad.size) < 0) ad.size = 'standard';
    if (['minimal', 'dark', 'brand', 'outline'].indexOf(ad.style) < 0) ad.style = 'minimal';
    if (['text', 'image'].indexOf(ad.type) < 0) ad.type = 'text';
    ad.interval = Math.max(1, parseInt(ad.interval, 10) || 6);
    return ad;
  }

  function buildAd(a) {
    var ad = normalizeAd(a);
    var hasImg = ad.type === 'image' && String(ad.image || '').trim();
    var url = isSafeUrl(ad.url);
    var tag = url ? 'a' : 'div';
    var el = doc.createElement('div');
    el.className = 'ls-ad ls-ad--' + ad.size + ' ls-ad--' + ad.style + (hasImg ? '' : ' ls-ad--noimg') + (animOff() ? ' ls-anim-off' : '');
    el.setAttribute('data-ad-id', ad.id || '');
    el.style.setProperty('--ls-ad-accent', ad.accent || '#2563eb');
    if (ad.bg) { el.setAttribute('data-custombg', '1'); el.style.setProperty('--ls-ad-custombg', ad.bg); }
    if (ad.fg) { el.setAttribute('data-customfg', '1'); el.style.setProperty('--ls-ad-customfg', ad.fg); }

    var media = '';
    if (hasImg) {
      media = '<div class="ls-ad__media"><img src="' + esc(ad.image) + '" alt="' + esc(ad.imageAlt || ad.title || '광고 이미지') + '" loading="lazy" decoding="async"></div>';
    }
    var body =
      '<div class="ls-ad__body">' +
      '<div class="ls-ad__top"><span class="ls-ad__badge">' + esc(ad.badge || 'AD') + '</span>' +
      (ad.sponsor ? '<span class="ls-ad__sponsor">' + esc(ad.sponsor) + '</span>' : '') + '</div>' +
      '<h3 class="ls-ad__title">' + esc(ad.title || '') + '</h3>' +
      (ad.desc ? '<p class="ls-ad__desc">' + esc(ad.desc) + '</p>' : '') +
      ((ad.caption && hasImg) ? '<p class="ls-ad__desc">' + esc(ad.caption) + '</p>' : '') +
      (ad.btnText ? '<span class="ls-ad__btn">' + esc(ad.btnText) +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>' : '') +
      '</div>';

    el.innerHTML = '<' + tag + ' class="ls-ad__link"' + (url ? ' href="' + esc(url) + '" rel="noopener sponsored"' : '') + '>' +
      media + body + '</' + tag + '>';
    return el;
  }

  function slotFor(ad) {
    var s = doc.createElement('div');
    s.className = 'ls-ad-slot' + (ad.size === 'standard' ? '' : ' ls-ad-slot--wide');
    s.appendChild(buildAd(ad));
    return s;
  }

  /* Flux Feed: 기사 count 편 뒤에 노출 규칙에 맞는 광고를 끼워 넣는다.
     · 광고마다 정한 간격(N개 기사마다)과
     · 한 화면에 너무 많지 않도록 하는 최소 간격(전체 기사 수 / 8, 최소 8)을
       모두 만족할 때만 넣고, 한 페이지에서 최대 8개까지만 넣는다. */
  function feedAds(container, count, view, total) {
    if (!container) return 0;
    var ads = activeAds('feed');
    if (!ads.length) return 0;
    if (count === 1) {
      container.dataset.lsAdInserted = '0';
      container.dataset.lsAdLast = '0';
    }
    var inserted = parseInt(container.dataset.lsAdInserted || '0', 10) || 0;
    var last = parseInt(container.dataset.lsAdLast || '0', 10) || 0;
    if (inserted >= 8) return 0;
    var minGap = total ? Math.max(6, Math.min(12, Math.ceil(total / 8))) : 12;
    if (count - last < minGap) return 0;
    /* 광고를 돌아가며 한 개씩: 삽입 순번으로 고르고, 그 광고의 간격도 지킨다. */
    var ad = ads[inserted % ads.length];
    var ownGap = Math.max(1, parseInt(ad.interval, 10) || 6);
    if (count - last < ownGap) return 0;
    container.appendChild(slotFor(ad));
    container.dataset.lsAdInserted = String(inserted + 1);
    container.dataset.lsAdLast = String(count);
    return 1;
  }

  /* ---------------- LK ID 계정 설정 팝오버 ---------------- */
  var POP_CSS_ID = 'lsLkPopCss';
  var POP_CSS = [
    '.lkpop-layer{--lp-bg:#ffffff;--lp-ink:#000000;--lp-ink2:#3f3f3f;--lp-muted:#8a8a8a;--lp-line:#e2e2e2;--lp-line2:#c9c9c9;--lp-inv:#ffffff;--lp-field:#ffffff;',
    '--lp-font:"Pretendard","Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;',
    '--lp-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;}',
    '.lkpop-layer.is-dark{--lp-bg:#000000;--lp-ink:#ffffff;--lp-ink2:#cfcfcf;--lp-muted:#8c8c8c;--lp-line:#232323;--lp-line2:#343434;--lp-inv:#000000;--lp-field:#0a0a0a;}',
    '.lkpop-scrim{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.28);-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px);}',
    '.lkpop{position:fixed;z-index:1001;box-sizing:border-box;background:var(--lp-bg);color:var(--lp-ink);border:1px solid var(--lp-line2);',
    'font-family:var(--lp-font);text-align:left;box-shadow:0 28px 70px -34px rgba(0,0,0,.6);}',
    '.lkpop *{box-sizing:border-box;}',
    '.lkpop.is-pop{animation:lkpopIn .18s cubic-bezier(.22,1,.36,1) both;}',
    '.lkpop.is-sheet{left:0;right:0;bottom:0;width:100%;border-left:0;border-right:0;border-bottom:0;animation:lkpopUp .22s cubic-bezier(.22,1,.36,1) both;}',
    '.lkpop-head{display:flex;align-items:flex-start;gap:11px;padding:14px 15px 13px;border-bottom:1px solid var(--lp-line);}',
    '.lkpop-tile{width:30px;height:30px;flex:none;display:grid;place-items:center;background:var(--lp-ink);color:var(--lp-inv);}',
    '.lkpop-tile svg{width:17px;height:12px;display:block;}',
    '.lkpop-id{min-width:0;flex:1;}',
    '.lkpop-id b{display:block;font-size:12.5px;font-weight:800;letter-spacing:-.01em;}',
    '.lkpop-id span{display:block;margin-top:2px;font-size:11px;font-weight:600;color:var(--lp-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.lkpop-x{width:26px;height:26px;flex:none;display:grid;place-items:center;border:0;background:none;color:var(--lp-muted);cursor:pointer;}',
    '.lkpop-x:hover{color:var(--lp-ink);}',
    '.lkpop-x svg{width:13px;height:13px;}',
    '.lkpop-body{padding:13px 15px 15px;}',
    '.lkpop-kv{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11px;padding-bottom:11px;}',
    '.lkpop-swrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:11px;font-size:11px;font-weight:600;color:var(--lp-muted);}',
    '.lkpop-sw{position:relative;display:inline-flex;align-items:center;cursor:pointer;}',
    '.lkpop-sw input{position:absolute;opacity:0;width:1px;height:1px;}',
    '.lkpop-sw i{display:block;width:38px;height:21px;border:1px solid var(--lp-line2);background:var(--lp-field);position:relative;transition:background-color .16s ease,border-color .16s ease;}',
    '.lkpop-sw i::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;background:var(--lp-ink2);transition:transform .16s ease,background-color .16s ease;}',
    '.lkpop-sw input:checked + i{background:var(--lp-ink);border-color:var(--lp-ink);}',
    '.lkpop-sw input:checked + i::after{transform:translateX(19px);background:var(--lp-inv);}',
    '.lkpop-sw input:focus-visible + i{outline:1px solid var(--lp-ink);outline-offset:2px;}',
    '.lkpop.is-off .lkpop-urow,.lkpop.is-off .lkpop-track{opacity:.4;}',
    '.lkpop-kv span{color:var(--lp-muted);font-weight:600;}',
    '.lkpop-kv b{font-weight:800;font-family:var(--lp-mono);font-size:10.5px;letter-spacing:.02em;}',
    '.lkpop-urow{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11px;}',
    '.lkpop-urow span{color:var(--lp-muted);font-weight:600;}',
    '.lkpop-urow b{font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}',
    '.lkpop-track{height:5px;margin:8px 0 0;background:var(--lp-line);overflow:hidden;}',
    '.lkpop-track i{display:block;height:100%;width:0;background:var(--lp-ink);transition:width .45s cubic-bezier(.22,1,.36,1);}',
    '.lkpop.is-full .lkpop-track{background:repeating-linear-gradient(135deg,var(--lp-ink) 0 3px,transparent 3px 6px);}',
    '.lkpop-msg{display:none;margin:11px 0 0;font-size:10.5px;line-height:1.6;font-weight:600;color:var(--lp-ink2);}',
    '.lkpop-msg.on{display:block;}',
    '.lkpop-msg.is-err{color:var(--lp-ink);text-decoration:underline;text-underline-offset:3px;}',
    '.lkpop-btn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;height:38px;margin-top:8px;padding:0 12px;',
    'border:1px solid var(--lp-line2);background:transparent;color:var(--lp-ink);font-family:inherit;font-size:12px;font-weight:800;',
    'text-decoration:none;cursor:pointer;transition:background-color .16s ease,color .16s ease,border-color .16s ease;}',
    '.lkpop-btn:hover:not(:disabled){border-color:var(--lp-ink);}',
    '.lkpop-btn--solid{background:var(--lp-ink);border-color:var(--lp-ink);color:var(--lp-inv);}',
    '.lkpop-btn--solid:hover:not(:disabled){background:transparent;color:var(--lp-ink);}',
    '.lkpop-btn--ghost{margin-top:12px;border-color:transparent;color:var(--lp-muted);font-weight:700;}',
    '.lkpop-btn--ghost:hover:not(:disabled){color:var(--lp-ink);}',
    '.lkpop-btn:disabled{opacity:.5;cursor:not-allowed;}',
    '.lkpop-btn svg{width:14px;height:14px;flex:none;}',
    '.lkpop-spin{width:11px;height:11px;flex:none;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:lkpopSpin .7s linear infinite;}',
    '.lkpop.out{animation:lkpopOut .16s ease both;}',
    '.lkpop.is-sheet.out{animation:lkpopDown .18s ease both;}',
    '@keyframes lkpopIn{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:none;}}',
    '@keyframes lkpopOut{from{opacity:1;}to{opacity:0;}}',
    '@keyframes lkpopUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:none;}}',
    '@keyframes lkpopDown{from{opacity:1;}to{opacity:0;transform:translateY(12px);}}',
    '@keyframes lkpopSpin{to{transform:rotate(360deg);}}',
    '@media (max-width:639px){.lkpop.is-sheet{padding-bottom:calc(10px + env(safe-area-inset-bottom));}}'
  ].join('\n');

  var ICON_LK_SMALL = '<svg viewBox="0 0 46 32" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true"><path d="M3 5V27H17"></path><path d="M24 5V27"></path><path d="M42 5L26.5 16L42 27"></path></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  var popLayer = null;

  function ensurePopStyles() {
    if (doc.getElementById(POP_CSS_ID)) return;
    var st = doc.createElement('style');
    st.id = POP_CSS_ID;
    st.textContent = POP_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  function fmtMB(n) { return ((Number(n) || 0) / 1048576).toFixed(1) + ' MB'; }
  function fmtB(n) {
    try { if (window.LemonCloud && LemonCloud.fmtBytes) return LemonCloud.fmtBytes(n); } catch (e) { }
    return fmtMB(n);
  }
  function hhmmss(ts) {
    try { return new Date(ts).toLocaleTimeString('ko-KR', { hour12: false }); } catch (e) { return ''; }
  }
  function closePop() {
    if (!popLayer) return;
    var node = popLayer;
    popLayer = null;
    doc.removeEventListener('keydown', popKeydown, true);
    node.classList.add('out');
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 180);
  }
  function popKeydown(e) { if (e && e.key === 'Escape') { e.stopPropagation(); closePop(); } }

  function popMarkup(user) {
    var mail = String((user && user.email) || 'LK ID');
    var ok = !!(user && user.email_confirmed_at);
    return '<div class="lkpop is-pop" role="dialog" aria-modal="true" aria-label="LK ID 계정 설정">' +
      '<div class="lkpop-head">' +
      '<span class="lkpop-tile" aria-hidden="true">' + ICON_LK_SMALL + '</span>' +
      '<div class="lkpop-id"><b>LK ID 계정 설정</b><span>' + esc(mail) + '</span></div>' +
      '<button type="button" class="lkpop-x" data-pop-close aria-label="닫기">' + ICON_X + '</button>' +
      '</div>' +
      '<div class="lkpop-body">' +
      '<div class="lkpop-kv"><span>계정 상태</span><b>' + (ok ? '이메일 인증 완료' : '이메일 인증 대기') + '</b></div>' +
      '<div class="lkpop-swrow"><span>클라우드 저장</span><label class="lkpop-sw"><input type="checkbox" data-pop-sync aria-label="클라우드 저장 켜기"><i></i></label></div>' +
      '<div class="lkpop-urow"><span>클라우드 저장 공간</span><b data-pop-use>-</b></div>' +
      '<div class="lkpop-track"><i data-pop-fill></i></div>' +
      '<p class="lkpop-msg" data-pop-msg role="status" aria-live="polite"></p>' +
      '<button type="button" class="lkpop-btn lkpop-btn--solid" data-pop-backup>지금 클라우드 백업</button>' +
      '<a class="lkpop-btn" data-pop-settings href="' + esc(authHref()) + '">LK ID 계정 설정</a>' +
      '<button type="button" class="lkpop-btn lkpop-btn--ghost" data-pop-out>로그아웃</button>' +
      '</div></div>';
  }

  function placePop(box, anchor) {
    if (!box) return;
    if (window.innerWidth < 640 || !anchor || !anchor.getBoundingClientRect) {
      box.classList.remove('is-pop');
      box.classList.add('is-sheet');
      return;
    }
    box.classList.remove('is-sheet');
    box.classList.add('is-pop');
    var r = anchor.getBoundingClientRect();
    var w = 296;
    var left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w));
    var top = r.bottom + 10;
    box.style.width = w + 'px';
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    var h = box.offsetHeight || 260;
    if (top + h > window.innerHeight - 12) {
      box.style.top = Math.max(12, r.top - h - 10) + 'px';
    }
  }

  function openAccountPop(anchor) {
    if (popLayer) { closePop(); return; }
    var user = null;
    try { user = window.LemonCloud ? LemonCloud.sessionUser() : null; } catch (e) { }
    if (!user) { location.href = authHref(); return; }
    ensurePopStyles();

    var layer = doc.createElement('div');
    layer.className = 'lkpop-layer' + (doc.documentElement.classList.contains('dark') ? ' is-dark' : '');
    layer.innerHTML = '<div class="lkpop-scrim" data-pop-close></div>' + popMarkup(user);
    (doc.body || doc.documentElement).appendChild(layer);
    popLayer = layer;

    var box = layer.querySelector('.lkpop');
    placePop(box, anchor);

    Array.prototype.forEach.call(layer.querySelectorAll('[data-pop-close]'), function (el) {
      el.addEventListener('click', closePop);
    });
    doc.addEventListener('keydown', popKeydown, true);
    window.addEventListener('resize', function () { if (popLayer) placePop(box, anchor); });

    var msgEl = box.querySelector('[data-pop-msg]');
    function setMsg(text, kind) {
      if (!msgEl) return;
      msgEl.textContent = text || '';
      msgEl.className = 'lkpop-msg' + (text ? ' on' : '') + (kind === 'err' ? ' is-err' : '');
    }

    function paintUsage(u) {
      if (!u) return;
      var use = box.querySelector('[data-pop-use]');
      var fill = box.querySelector('[data-pop-fill]');
      var pct = u.limit ? Math.min(100, (Number(u.bytes) || 0) / u.limit * 100) : 0;
      if (use) use.textContent = fmtMB(u.bytes) + ' / ' + fmtMB(u.limit);
      if (fill) fill.style.width = pct + '%';
      box.classList.toggle('is-full', !!u.limit && (u.bytes || 0) >= u.limit * 0.95);
    }
    function refreshUsage() {
      var c = window.LemonCloud;
      if (!c || !c.usage) return;
      (c.init ? c.init() : Promise.resolve()).then(function () { return c.usage(); })
        .then(function (u) { if (popLayer === layer) paintUsage(u); }, function () { });
    }

    var bk = box.querySelector('[data-pop-backup]');
    if (bk) {
      bk.addEventListener('click', function () {
        if (bk.disabled) return;
        var label = bk.textContent;
        bk.disabled = true;
        bk.innerHTML = '<span class="lkpop-spin" aria-hidden="true"></span>백업 중';
        setMsg('클라우드로 올리는 중입니다.');
        window.LemonCloud.backupNow().then(function (r) {
          bk.disabled = false;
          bk.textContent = label;
          if (r && r.ok) {
            setMsg('백업 완료 · ' + hhmmss(r.ts) + ' · ' + r.count + '개 항목 (' + fmtB(r.bytes) + ')');
          } else if (r && r.error === 'quota-exceeded') {
            setMsg('클라우드 저장 한도(' + fmtB(r.limit) + ')를 초과해 백업할 수 없습니다. 불필요한 항목을 정리해 주세요.', 'err');
          } else if (r && r.error === 'sync-off') {
            setMsg('클라우드 저장이 꺼져 있어 백업하지 않았습니다.', 'err');
          } else if (r && r.error === 'login-required') {
            setMsg('로그인이 풀렸습니다. 다시 로그인해 주세요.', 'err');
          } else {
            setMsg('백업하지 못했습니다: ' + ((r && r.error) || '알 수 없는 오류'), 'err');
          }
          refreshUsage();
        }, function () {
          bk.disabled = false;
          bk.textContent = label;
          setMsg('백업하지 못했습니다.', 'err');
        });
      });
    }

    var out = box.querySelector('[data-pop-out]');
    if (out) {
      out.addEventListener('click', function () {
        if (out.disabled) return;
        out.disabled = true;
        out.textContent = '로그아웃 중';
        var c = window.LemonCloud;
        (c && c.signOut ? c.signOut() : Promise.resolve()).then(function () {
          closePop();
          renderAuth();
        }, function () {
          out.disabled = false;
          out.textContent = '로그아웃';
          setMsg('로그아웃하지 못했습니다.', 'err');
        });
      });
    }

    var sw = box.querySelector('[data-pop-sync]');
    function paintMode() {
      var c = window.LemonCloud;
      var on = c && c.syncEnabled ? c.syncEnabled() : true;
      if (sw) sw.checked = on;
      box.classList.toggle('is-off', !on);
      if (bk) {
        bk.disabled = !on;
        bk.title = on ? '' : '클라우드 저장이 꺼져 있습니다';
      }
      var use = box.querySelector('[data-pop-use]');
      if (!on && use) use.textContent = '꺼짐 · 기기에만 저장';
      if (on) refreshUsage();
      setMsg(on ? '' : '클라우드 저장이 꺼져 있습니다. 데이터는 이 기기에만 저장됩니다.');
    }
    if (sw) {
      sw.addEventListener('change', function () {
        var on = window.LemonCloud.setSyncEnabled(!!sw.checked);
        paintMode();
        if (on) setMsg('클라우드 저장을 켰습니다.');
      });
    }
    paintMode();
    setTimeout(function () { if (bk) { try { bk.focus({ preventScroll: true }); } catch (e) { } } }, 40);
  }

  /* ---------------- 허브 로그인 상태 (LK ID) ---------------- */
  var ICON_LK = '<svg viewBox="0 0 46 32" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true"><path d="M3 5V27H17"></path><path d="M24 5V27"></path><path d="M42 5L26.5 16L42 27"></path></svg>';

  /* 지금 보고 있는 페이지로 돌아올 수 있도록 ?next= 를 붙인다. */
  function authHref() {
    var file = '';
    try { file = String(location.pathname || '').split('/').pop() || 'index.html'; } catch (e) { file = ''; }
    if (!/\.html$/i.test(file)) file = 'index.html';
    return 'auth.html?next=' + encodeURIComponent(file + (location.search || ''));
  }

  function renderAuth() {
    var btns = [doc.getElementById('lsAuthBtn'), doc.getElementById('lsAuthBtnMobile')];
    if (!btns[0] && !btns[1]) return;
    var user = null;
    try {
      if (window.LemonCloud) user = LemonCloud.sessionUser();
    } catch (e) { }
    btns.forEach(function (b) {
      if (!b) return;
      var label = user ? (user.email || '내 계정').split('@')[0] : '로그인';
      var caret = user ? '<svg class="ls-authbtn__caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>' : '';
      b.innerHTML = ICON_LK + '<span class="ls-authbtn__label">' + esc(label) + '</span>' + caret + (user ? '<span class="ls-authbtn__dot" aria-hidden="true"></span>' : '');
      b.title = user ? ('LK ID 계정 설정 · ' + (user.email || '') + ' — 눌러서 백업·로그아웃') : 'LK ID 로그인';
      b.setAttribute('aria-label', user ? ('LK ID 계정 설정 · ' + (user.email || '')) : 'LK ID 로그인');
      b.setAttribute('aria-haspopup', user ? 'dialog' : 'false');
      b.setAttribute('aria-expanded', 'false');
      b.onclick = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!user) { location.href = authHref(); return; }
        openAccountPop(b);
        b.setAttribute('aria-expanded', popLayer ? 'true' : 'false');
      };
    });
  }

  /* 로그인/로그아웃이 일어나면 상단 버튼을 다시 그린다. */
  try {
    window.addEventListener('lemoncloud:signed-in', renderAuth);
    window.addEventListener('lemoncloud:signed-out', function () { closePop(); renderAuth(); });
  } catch (e) { }

  /* ---------------- 원격 설정 읽기 ---------------- */
  function cloudBase() {
    try {
      var cs = doc.currentScript;
      if (!cs) {
        var list = doc.querySelectorAll('script[src$="lemon-site.js"]');
        cs = list[list.length - 1];
      }
      return String(cs && cs.src || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    } catch (e) { return ''; }
  }

  /* 방문자 첫 화면에서도 공지·배너가 바로 뜨도록, 지난번에 받아둔 원격 설정을 먼저 쓴다. */
  function applyCachedRemote() {
    var c = readJSON(K_REMOTE_CFG, null);
    var a = readJSON(K_REMOTE_ADS, null);
    if (c && typeof c === 'object') remoteCfg = c;
    if (Array.isArray(a)) remoteAds = a;
  }

  function applyRemote() {
    var changed = false;
    if (window.LemonCloud && LemonCloud.configured && LemonCloud.configured()) {
      var c = readJSON(K_REMOTE_CFG, null);
      var a = readJSON(K_REMOTE_ADS, null);
      if (c) { remoteCfg = c; changed = true; }
      if (Array.isArray(a)) { remoteAds = a; changed = true; }
    }
    if (changed) refresh();
  }

  function loadCloud() {
    if (loadP) return loadP;
    loadP = new Promise(function (resolve) {
      if (window.LemonCloud && LemonCloud.init) {
        LemonCloud.init().then(resolve, resolve);
        return;
      }
      var base = cloudBase();
      var s = doc.createElement('script');
      s.src = base + 'lemon-cloud.js';
      s.async = true;
      s.onload = function () {
        if (window.LemonCloud && LemonCloud.init) LemonCloud.init().then(resolve, resolve);
        else resolve();
      };
      s.onerror = function () { resolve(); };
      (doc.head || doc.documentElement).appendChild(s);
    }).then(function () {
      try {
        if (!window.LemonCloud || !LemonCloud.configured || !LemonCloud.configured()) return;
        return LemonCloud.fetchSiteData().then(function (data) {
          if (!data) return;
          if (data.config) { remoteCfg = data.config; writeJSON(K_REMOTE_CFG, data.config); }
          if (data.ads) { remoteAds = data.ads; writeJSON(K_REMOTE_ADS, data.ads); }
          refresh();
        }, function () { });
      } catch (e) { }
    });
    return loadP;
  }

  /* ---------------- mount ---------------- */
  var mounted = false;
  function mount() {
    if (!doc.body) return;
    var meta = doc.querySelector('meta[name="lemon-site-mount"]');
    if (meta && String(meta.getAttribute('content') || '').toLowerCase() === 'off') return;
    applyCachedRemote();
    renderNotice();
    renderHome();
    renderAuth();
    if (!mounted) {
      mounted = true;
      loadCloud();
      window.addEventListener('storage', function (e) {
        if (e && (e.key === K_CFG || e.key === K_ADS)) refresh();
      });
      doc.addEventListener('lemon:theme', renderNotice);
    }
  }

  function refresh() {
    renderNotice();
    renderHome();
    renderAuth();
    try {
      window.dispatchEvent(new CustomEvent('lemonsite:config', {
        detail: { config: getConfig(), ads: getAds() }
      }));
    } catch (e) { }
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return;
    listeners.push(fn);
    window.addEventListener('lemonsite:config', function () { try { fn(getConfig(), getAds()); } catch (e) { } });
  }

  window.LemonSite = {
    __v: 1,
    DEFAULTS: DEFAULTS,
    SAMPLE_ADS: SAMPLE_ADS,
    getConfig: getConfig,
    getAds: getAds,
    activeAds: activeAds,
    buildAd: buildAd,
    slotFor: slotFor,
    feedAds: feedAds,
    mount: mount,
    refresh: refresh,
    onChange: onChange,
    openAccount: openAccountPop,
    closeAccount: closePop,
    esc: esc,
    svgImage: svgImage,
    keys: { cfg: K_CFG, ads: K_ADS, remoteCfg: K_REMOTE_CFG, remoteAds: K_REMOTE_ADS }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
