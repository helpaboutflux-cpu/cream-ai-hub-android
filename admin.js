/* ============================================================
   Soft Hub · 관리자 콘솔 (admin.js)
   admin.html 전용. 사이트 어디에서도 링크하지 않는다.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var K_AUTH = 'lemon_admin_auth';
  var K_UNLOCK = 'lemon_admin_unlocked';
  var ITER = 150000;

  var state = {
    cfg: null,
    ads: [],
    unlocked: false,
    dirty: false,
    draft: null,
    editingId: null,
    pvMode: 'grid'
  };

  /* ---------------- 유틸 ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
  function readJSON(k, fb) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch (e) { return fb; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function bytesToHex(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
  }
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2), i;
    for (i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function randomSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return bytesToHex(a);
  }

  function hashPassword(pw, saltHex, iter) {
    var enc = new TextEncoder();
    if (window.crypto && crypto.subtle && crypto.subtle.importKey) {
      return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
        .then(function (key) {
          return crypto.subtle.deriveBits({
            name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iter, hash: 'SHA-256'
          }, key, 256);
        })
        .then(function (bits) { return bytesToHex(new Uint8Array(bits)); })
        .catch(function () { return fallbackHash(pw, saltHex); });
    }
    return Promise.resolve(fallbackHash(pw, saltHex));
  }
  function fallbackHash(pw, saltHex) {
    /* crypto.subtle 이 없는 환경(http 아닌 file:// 등)용 SHA-256 단일 해시 */
    return sha256Hex(saltHex + '|' + pw + '|' + saltHex);
  }

  /* 최소 SHA-256 구현 (fallback) */
  function sha256Hex(str) {
    function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mathPow = Math.pow, maxWord = mathPow(2, 32);
    var result = '', words = [], asciiBitLength = str.length * 8;
    var hash = sha256Hex.h = sha256Hex.h || [];
    var k = sha256Hex.k = sha256Hex.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    str += '\x80';
    while (str.length % 64 - 56) str += '\x00';
    for (i = 0; i < str.length; i++) {
      var j = str.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (
            w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
            w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  /* ---------------- 토스트 ---------------- */
  function toast(msg, kind) {
    var wrap = $('toastWrap');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast toast--' + (kind || 'ok');
    var icon = kind === 'err'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="13"></line><circle cx="12" cy="16.2" r=".9" fill="currentColor" stroke="none"></circle></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    el.innerHTML = icon + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------------- 테마 ---------------- */
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    var label = $('themeLabel');
    if (label) label.textContent = dark ? '라이트' : '다크';
    try { localStorage.setItem('cream_theme', dark ? 'dark' : 'light'); } catch (e) { }
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('cream_theme'); } catch (e) { }
    applyTheme(saved ? saved === 'dark' : true);
    $('themeBtn').addEventListener('click', function () {
      applyTheme(!document.documentElement.classList.contains('dark'));
    });
  }

  /* ---------------- 잠금 게이트 ---------------- */
  var authRec = null;

  function readAuth() {
    var rec = readJSON(K_AUTH, null);
    if (rec && rec.hash && rec.salt) return rec;
    return null;
  }

  function setGateMode(setup) {
    $('gateSetupOnly').style.display = setup ? '' : 'none';
    $('gateConfirmOnly').style.display = setup ? '' : 'none';
    $('gatePw').parentNode.style.display = setup ? 'none' : '';
    $('gatePwLabel').textContent = '비밀번호';
    $('gateTitle').textContent = setup ? '관리자 비밀번호 설정' : '관리자 콘솔';
    $('gateSub').textContent = setup
      ? '이 페이지를 처음 열었습니다. 관리자 비밀번호를 정하면 다음부터 이 비밀번호로만 열립니다.'
      : '비밀번호를 입력하면 사이트 공지·배너·광고를 관리할 수 있습니다.';
    $('gateSubmit').textContent = setup ? '비밀번호 설정하고 열기' : '잠금 해제';
  }

  function gateErr(msg) {
    var el = $('gateErr');
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function openConsole() {
    state.unlocked = true;
    $('gate').classList.add('hidden');
    $('console').classList.remove('hidden');
    bootConsole();
  }

  function lockNow(silent) {
    state.unlocked = false;
    try { sessionStorage.removeItem(K_UNLOCK); } catch (e) { }
    $('console').classList.add('hidden');
    $('gate').classList.remove('hidden');
    setGateMode(false);
    gateErr('');
    $('gatePw').value = '';
    $('gatePw').focus();
    if (!silent) toast('잠겼습니다.', 'ok');
  }

  function initGate() {
    authRec = readAuth();
    var unlockedKey = null;
    try { unlockedKey = sessionStorage.getItem(K_UNLOCK); } catch (e) { }

    if (!authRec) {
      setGateMode(true);
      $('gateNew').focus();
    } else {
      setGateMode(false);
      if (unlockedKey && unlockedKey === authRec.hash.slice(0, 16) + ':' + authRec.salt.slice(0, 8)) {
        openConsole();
        return;
      }
      $('gatePw').focus();
    }

    $('gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!authRec) return doSetup();
      return doUnlock();
    });
    $('sideLockBtn').addEventListener('click', function () { lockNow(); });
  }

  function doSetup() {
    var pw = $('gateNew').value;
    var pw2 = $('gateConfirm').value;
    if (!pw || pw.length < 6) { gateErr('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (pw !== pw2) { gateErr('비밀번호 확인이 일치하지 않습니다.'); return; }
    gateErr('');
    $('gateSubmit').disabled = true;
    var salt = randomSalt();
    hashPassword(pw, salt, ITER).then(function (hash) {
      var rec = { v: 2, salt: salt, iter: ITER, hash: hash, created: Date.now() };
      writeJSON(K_AUTH, rec);
      authRec = rec;
      try { sessionStorage.setItem(K_UNLOCK, hash.slice(0, 16) + ':' + salt.slice(0, 8)); } catch (e) { }
      persistAdminHash(rec);
      $('gateSubmit').disabled = false;
      toast('관리자 비밀번호를 설정했습니다.');
      openConsole();
    });
  }

  function doUnlock() {
    var pw = $('gatePw').value;
    if (!pw) { gateErr('비밀번호를 입력하세요.'); return; }
    gateErr('');
    $('gateSubmit').disabled = true;
    hashPassword(pw, authRec.salt, authRec.iter || ITER).then(function (hash) {
      $('gateSubmit').disabled = false;
      if (hash === authRec.hash) {
        try { sessionStorage.setItem(K_UNLOCK, authRec.hash.slice(0, 16) + ':' + authRec.salt.slice(0, 8)); } catch (e) { }
        openConsole();
      } else {
        gateErr('비밀번호가 올바르지 않습니다.');
        $('gatePw').select();
      }
    });
  }

  function persistAdminHash(rec) {
    try {
      if (window.LemonCloud && LemonCloud.configured && LemonCloud.configured() && LemonCloud.hasSession()) {
        LemonCloud.saveConfigRow('admin', { salt: rec.salt, iter: rec.iter, hash: rec.hash, updated_at: Date.now() });
      }
    } catch (e) { }
  }

  /* ---------------- 상태 로드 ---------------- */
  function loadState() {
    var cfg = window.LemonSite ? LemonSite.getConfig() : { notice: {}, home: {}, ads: { enabled: true } };
    state.cfg = cfg;
    state.ads = (window.LemonSite ? LemonSite.getAds() : []).map(function (a) { return clone(a); });
  }

  function markDirty() {
    state.dirty = true;
    $('dirtyFlag').classList.remove('hidden');
  }
  function clearDirty() {
    state.dirty = false;
    $('dirtyFlag').classList.add('hidden');
  }

  function cloudOn() {
    try { return !!(window.LemonCloud && LemonCloud.configured && LemonCloud.configured()); } catch (e) { return false; }
  }

  /* 원격이 기준인 사이트에서 옛 로컬 저장본은 원격과 어긋난 화면을 만든다.
     원격 저장이 끝난 뒤에는 이 브라우저에 그 값을 남기지 않는다. */
  function forgetLocalOverrides() {
    try {
      if (window.LemonSite && LemonSite.keys) {
        localStorage.removeItem(LemonSite.keys.cfg);
        localStorage.removeItem(LemonSite.keys.ads);
      }
    } catch (e) { }
  }

  /* ---------------- 화면 전환 ---------------- */
  var TITLES = {
    notice: ['상단 공지 배너', '모든 서비스 상단에 표시'],
    home: ['홈 배너', 'index.html 홈 최상단'],
    ads: ['광고 관리', 'Flux Feed 기사 사이에 노출'],
    push: ['푸시 알림', '구독 중인 사용자에게 즉시 발송'],
    cloud: ['Supabase', '로그인 · 짧은 공유 링크 · 원격 설정'],
    security: ['보안', '관리자 비밀번호 · 숨김 점검'],
    accounts: ['LK ID 계정', 'Soft Hub LK ID 가입자 목록']
  };

  function switchView(name) {
    var btns = document.querySelectorAll('.navbtn');
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('on', v.id === 'view-' + name);
    });
    var t = TITLES[name] || ['', ''];
    $('topTitle').textContent = t[0];
    $('topSub').textContent = t[1];
    if (name === 'push' && window.FluxAdminPush) window.FluxAdminPush.onShow();
    if (name === 'cloud') refreshCloudPanel();
    if (name === 'security') checkAdminLinks();
    if (name === 'accounts') loadAccounts();
  }

  /* ---------------- 색상 페어 ---------------- */
  function bindColorPair(colorId, hexId, onChange) {
    var c = $(colorId), h = $(hexId);
    if (!c || !h) return;
    c.addEventListener('input', function () {
      h.value = c.value;
      if (onChange) onChange(c.value);
    });
    h.addEventListener('input', function () {
      var v = h.value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
        if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
        c.value = v;
        if (onChange) onChange(v);
      }
    });
    h.addEventListener('blur', function () {
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h.value.trim())) h.value = c.value;
      else if (onChange) onChange(c.value);
    });
  }

  /* ---------------- 공지 배너 ---------------- */
  function fillNotice(n) {
    n = n || {};
    $('nEnabled').checked = !!n.enabled;
    $('nBadge').value = n.badge || '';
    $('nText').value = n.text || '';
    $('nLink').value = n.link || '';
    $('nLinkText').value = n.linkText || '';
    $('nDismiss').checked = n.dismissible !== false;
    setColorPair('nBg', 'nBgHex', n.bg || '#111827');
    setColorPair('nFg', 'nFgHex', n.fg || '#ffffff');
    setColorPair('nAccent', 'nAccentHex', n.accent || '#3b82f6');
  }
  function setColorPair(colorId, hexId, val) {
    if ($(colorId)) $(colorId).value = /^#[0-9a-f]{6}$/i.test(val) ? val : '#000000';
    if ($(hexId)) $(hexId).value = val || '';
  }
  function collectNotice() {
    return {
      enabled: $('nEnabled').checked,
      badge: $('nBadge').value.trim(),
      text: $('nText').value.trim(),
      link: $('nLink').value.trim(),
      linkText: $('nLinkText').value.trim(),
      dismissible: $('nDismiss').checked,
      bg: $('nBg').value,
      fg: $('nFg').value,
      accent: $('nAccent').value
    };
  }

  function renderNoticePreview() {
    var n = collectNotice();
    var box = $('noticePreview');
    if (!n.enabled) {
      box.innerHTML = '<div style="padding:22px;text-align:center;color:var(--fg-3);font-size:11.5px;font-weight:700">배너가 꺼져 있습니다. 위의 [사용] 을 켜면 미리보기가 나타납니다.</div>';
      updateNoticePill(n);
      return;
    }
    var link = n.link
      ? '<a class="ls-notice__cta" href="javascript:void(0)">' + esc(n.linkText || '자세히 보기') +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></a>'
      : '';
    box.innerHTML =
      '<div style="--ls-notice-bg:' + esc(n.bg) + ';--ls-notice-fg:' + esc(n.fg) + ';--ls-notice-accent:' + esc(n.accent) + '">' +
      '<div class="ls-notice" style="padding-right:' + (n.dismissible ? '46px' : '16px') + '">' +
      '<div class="ls-notice__inner">' +
      (n.badge ? '<span class="ls-notice__badge">' + esc(n.badge) + '</span>' : '') +
      '<span class="ls-notice__text">' + esc(n.text || '공지 문구를 입력하세요') + '</span>' + link +
      '</div>' +
      (n.dismissible ? '<span class="ls-notice__close" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>' : '') +
      '</div></div>';
    updateNoticePill(n);
  }
  function updateNoticePill(n) {
    var on = n ? n.enabled : $('nEnabled').checked;
    var pill = $('noticePill');
    pill.className = 'pill ' + (on ? 'pill--ok' : 'pill--off');
    $('noticePillText').textContent = on ? 'ON · 모든 서비스 상단' : 'OFF';
    $('navNoticeState').textContent = on ? 'ON' : 'OFF';
  }

  /* ---------------- 홈 배너 ---------------- */
  function fillHome(h) {
    h = h || {};
    $('hEnabled').checked = !!h.enabled;
    $('hBadge').value = h.badge || '';
    $('hTitle').value = h.title || '';
    $('hSub').value = h.subtitle || '';
    $('hBtn').value = h.btnText || '';
    $('hUrl').value = h.btnUrl || '';
    $('hStyle').value = h.style || 'gradient';
    setColorPair('hAccent', 'hAccentHex', h.accent || '#6366f1');
    setColorPair('hBg', 'hBgHex', h.bg || '#2563eb');
    setColorPair('hFg', 'hFgHex', h.fg || '#ffffff');
    $('hDismiss').checked = h.dismissible !== false;
    if (window.Lemon && Lemon.upgradeDropdowns) Lemon.upgradeDropdowns();
  }
  function collectHome() {
    return {
      enabled: $('hEnabled').checked,
      badge: $('hBadge').value.trim(),
      title: $('hTitle').value.trim(),
      subtitle: $('hSub').value.trim(),
      btnText: $('hBtn').value.trim(),
      btnUrl: $('hUrl').value.trim(),
      style: $('hStyle').value,
      accent: $('hAccent').value,
      bg: $('hBg').value,
      fg: $('hFg').value,
      dismissible: $('hDismiss').checked
    };
  }

  function renderHomePreview() {
    var h = collectHome();
    var box = $('homePreview');
    updateHomePill(h);
    if (!h.enabled) {
      box.innerHTML = '<div style="padding:22px;text-align:center;color:var(--fg-3);font-size:11.5px;font-weight:700">홈 배너가 꺼져 있습니다.</div>';
      return;
    }
    var style = ['gradient', 'solid', 'outline', 'dark'].indexOf(h.style) >= 0 ? h.style : 'gradient';
    var vars = '--ls-home-accent:' + esc(h.accent) + ';';
    if (style === 'solid') vars += '--ls-home-solid:' + esc(h.bg) + ';';
    if (h.fg && style !== 'gradient') vars += '--ls-home-fg:' + esc(h.fg) + ';';
    if (h.bg && (style === 'gradient' || style === 'outline')) vars += '--ls-home-bg:' + esc(h.bg) + ';';
    box.innerHTML =
      '<div class="ls-homebanner ls-homebanner--' + style + ' ls-anim-off" style="' + esc(vars) + '">' +
      '<span class="ls-homebanner__orb"></span>' +
      '<span class="ls-homebanner__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6L20.5 11l-5.9 2.4L12 19l-2.6-5.6L3.5 11l5.9-2.4z"></path></svg></span>' +
      '<div class="ls-homebanner__body">' +
      (h.badge ? '<span class="ls-homebanner__kicker">' + esc(h.badge) + '</span>' : '') +
      '<h2 class="ls-homebanner__title">' + esc(h.title || '제목을 입력하세요') + '</h2>' +
      (h.subtitle ? '<p class="ls-homebanner__sub">' + esc(h.subtitle) + '</p>' : '') +
      '</div>' +
      (h.btnUrl ? '<div class="ls-homebanner__actions"><span class="ls-homebanner__btn">' + esc(h.btnText || '열기') +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span></div>' : '') +
      '</div>';
  }
  function updateHomePill(h) {
    var on = h ? h.enabled : $('hEnabled').checked;
    var pill = $('homePill');
    pill.className = 'pill ' + (on ? 'pill--ok' : 'pill--off');
    $('homePillText').textContent = on ? 'ON · 홈 최상단' : 'OFF';
    $('navHomeState').textContent = on ? 'ON' : 'OFF';
  }

  /* ---------------- 저장 ---------------- */
  function savedAtLabel(key) {
    var meta = readJSON('lemon_site_saved_v1', {}) || {};
    var ts = meta[key];
    if (!ts) return '';
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ' 저장됨';
  }
  function stampSaved(key) {
    var meta = readJSON('lemon_site_saved_v1', {}) || {};
    meta[key] = Date.now();
    writeJSON('lemon_site_saved_v1', meta);
    var el = key === 'notice' ? $('noticeSavedAt') : $('homeSavedAt');
    if (el) el.textContent = savedAtLabel(key);
    var adsEl = $('adsSavedAt');
    if (adsEl) adsEl.textContent = savedAtLabel('ads');
  }

  function saveAll(which) {
    var cfg = window.LemonSite ? LemonSite.getConfig() : {};
    cfg.notice = collectNotice();
    cfg.home = collectHome();
    cfg.ads = { enabled: $('adsEnabled').checked };

    /* Supabase 가 연결된 사이트에서는 원격이 유일한 기준이다.
       예전처럼 '로컬 저장 + 원격 저장'을 같이 하면, 원격 저장이 실패했을 때 이 브라우저에만
       다른 값이 남아 다른 브라우저와 화면이 갈린다. 그래서 원격만 쓴다. */
    if (cloudOn()) {
      if (!LemonCloud.hasSession()) {
        toast('LK ID 로그인이 없어 저장하지 못했습니다. 로그인한 뒤 다시 저장하세요.', 'err');
        return;
      }
      LemonCloud.saveSiteData(cfg, state.ads).then(function () {
        /* 원격 저장 성공 → 이 브라우저도 다른 방문자와 같은 상태로 맞춘다. */
        if (window.LemonSite && LemonSite.setRemote) LemonSite.setRemote(cfg, state.ads);
        forgetLocalOverrides();
        stampSaved(which || 'notice');
        clearDirty();
        toast('저장했습니다. 모든 방문자에게 반영됩니다.');
      }, function (e) {
        toast('원격 저장 실패: ' + (e && e.message ? e.message : '오류'), 'err');
      });
      return;
    }

    if (!window.LemonSite || !LemonSite.keys) { toast('사이트 스크립트를 불러오지 못했습니다.', 'err'); return; }
    var ok1 = writeJSON(LemonSite.keys.cfg, cfg);
    var ok2 = writeJSON(LemonSite.keys.ads, state.ads);
    if (!ok1 || !ok2) { toast('저장 공간이 부족합니다. 브라우저 저장 공간을 확인하세요.', 'err'); return; }
    stampSaved(which || 'notice');
    clearDirty();
    toast('저장했습니다. 모든 서비스에 반영됩니다.');
  }

  /* ---------------- 광고 ---------------- */
  var SIZE_LABEL = { compact: '소형 띠배너', standard: '중형 카드', featured: '대형 와이드' };
  var STYLE_LABEL = { minimal: '미니멀 라이트', dark: '다크 글래스', brand: '브랜드 컬러', outline: '아웃라인 카드' };
  var POS_LABEL = { feed: 'Flux Feed', all: '전체 피드' };

  function renderAdList() {
    var wrap = $('adList');
    var enabledCount = state.ads.filter(function (a) { return a.enabled !== false; }).length;
    $('navAdCount').textContent = String(state.ads.length);
    $('adsTotalPill').textContent = '광고 ' + state.ads.length + '개 · 노출 ' + enabledCount + '개';
    var on = $('adsEnabled').checked;
    $('adsPill').className = 'pill ' + (on ? 'pill--ok' : 'pill--off');
    $('adsPillText').textContent = on ? 'ON · 피드에 노출' : 'OFF · 전체 중지';

    if (!state.ads.length) {
      wrap.innerHTML = '<div class="emptybox">등록된 광고가 없습니다. [새 광고 만들기] 로 추가하거나 [샘플 광고 복원] 을 눌러보세요.</div>';
      return;
    }
    wrap.innerHTML = state.ads.map(function (a) {
      var thumb = a.type === 'image' && a.image
        ? '<img src="' + esc(a.image) + '" alt="">'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"></path><path d="M4 11h10"></path><path d="M4 16h13"></path></svg>';
      var meta = [
        a.type === 'image' ? '이미지+링크' : '텍스트+버튼',
        SIZE_LABEL[a.size] || a.size || '중형 카드',
        STYLE_LABEL[a.style] || a.style || '미니멀 라이트',
        (a.interval || 6) + '개 기사마다',
        POS_LABEL[a.position] || 'Flux Feed'
      ].join(' · ');
      return '<div class="adrow" data-id="' + esc(a.id) + '">' +
        '<div class="adrow__thumb">' + thumb + '</div>' +
        '<div class="adrow__main">' +
        '<div class="adrow__name">' + esc(a.title || a.name || '이름 없는 광고') + '</div>' +
        '<div class="adrow__meta">' + esc(meta) + '</div>' +
        '</div>' +
        '<label class="sw" title="이 광고 노출"><input type="checkbox" data-act="toggle" ' + (a.enabled !== false ? 'checked' : '') + '><span class="sw__track"></span></label>' +
        '<div class="adrow__acts">' +
        '<button class="btn btn--sm btn--ghost" data-act="edit" type="button">수정</button>' +
        '<button class="btn btn--sm btn--ghost" data-act="dup" type="button">복제</button>' +
        '<button class="btn btn--sm btn--ghost" data-act="del" type="button">삭제</button>' +
        '</div></div>';
    }).join('');
  }

  function findAd(id) {
    for (var i = 0; i < state.ads.length; i++) if (state.ads[i].id === id) return state.ads[i];
    return null;
  }

  function openEditor(ad) {
    state.draft = ad ? clone(ad) : {
      id: '', name: '', enabled: true, type: 'text', size: 'standard', style: 'minimal',
      badge: 'AD', sponsor: '', title: '', desc: '', btnText: '자세히 보기', url: '',
      image: '', imageAlt: '', caption: '', bg: '', accent: '#2563eb',
      position: 'feed', interval: 6, order: (state.ads.length + 1)
    };
    state.editingId = ad ? ad.id : null;
    $('adModalTitle').textContent = ad ? '광고 수정' : '광고 만들기';
    $('adDelete').style.visibility = ad ? 'visible' : 'hidden';
    fillEditor(state.draft);
    renderEditorPreview();
    $('adModal').classList.remove('hidden');
  }
  function closeEditor() {
    $('adModal').classList.add('hidden');
    state.draft = null;
    state.editingId = null;
  }

  function fillEditor(a) {
    $('adName').value = a.name || '';
    $('adSponsor').value = a.sponsor || '';
    $('adTitle').value = a.title || '';
    $('adDesc').value = a.desc || '';
    $('adBtn').value = a.btnText || '';
    $('adUrl').value = a.url || '';
    $('adAlt').value = a.imageAlt || '';
    $('adCaption').value = a.caption || '';
    $('adPos').value = a.position || 'feed';
    $('adInterval').value = a.interval || 6;
    $('adOrder').value = a.order || 1;
    $('adEnabled').checked = a.enabled !== false;
    $('adImageUrl').value = a.image && a.image.indexOf('data:') === 0 ? '' : (a.image || '');
    $('adImageUrl').placeholder = a.image && a.image.indexOf('data:') === 0 ? '업로드된 이미지 사용 중' : '이미지 URL 또는 파일 업로드';
    setColorPair('adAccent', 'adAccentHex', a.accent || '#2563eb');
    setColorPair('adBg', 'adBgHex', a.bg || '');
    if (!a.bg) $('adBgHex').value = '';
    updateThumb();
    syncSegs(a.type, a.size, a.style);
    $('adImageBlock').style.display = a.type === 'image' ? '' : 'none';
    if (window.Lemon && Lemon.upgradeDropdowns) Lemon.upgradeDropdowns();
    if (window.Lemon && Lemon.upgradeColorPickers) Lemon.upgradeColorPickers($('adModal'));
  }

  function syncSegs(type, size, style) {
    Array.prototype.forEach.call($('adTypeSeg').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-type') === type);
    });
    Array.prototype.forEach.call($('adSizeOpts').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-size') === size);
    });
    Array.prototype.forEach.call($('adStyleOpts').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-style') === style);
    });
  }

  function updateThumb() {
    var a = state.draft || {};
    var box = $('adThumb');
    if (a.image) {
      box.innerHTML = '<img src="' + esc(a.image) + '" alt="">' +
        '<button type="button" class="thumbbox__clear" id="adThumbClear" aria-label="이미지 제거">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
      var c = $('adThumbClear');
      if (c) c.addEventListener('click', function () {
        state.draft.image = '';
        $('adImageUrl').value = '';
        updateThumb();
        renderEditorPreview();
      });
    } else {
      box.innerHTML = '<span class="thumbbox__empty">이미지 없음</span>';
    }
  }

  function pullEditor() {
    var a = state.draft;
    if (!a) return;
    a.name = $('adName').value.trim();
    a.sponsor = $('adSponsor').value.trim();
    a.title = $('adTitle').value.trim();
    a.desc = $('adDesc').value.trim();
    a.btnText = $('adBtn').value.trim();
    a.url = $('adUrl').value.trim();
    a.imageAlt = $('adAlt').value.trim();
    a.caption = $('adCaption').value.trim();
    a.position = $('adPos').value;
    a.interval = Math.max(1, parseInt($('adInterval').value, 10) || 6);
    a.order = Math.max(1, parseInt($('adOrder').value, 10) || 1);
    a.enabled = $('adEnabled').checked;
    a.accent = $('adAccent').value;
    var bgHex = $('adBgHex').value.trim();
    a.bg = /^#[0-9a-f]{6}$/i.test(bgHex) ? bgHex : '';
    var urlImg = $('adImageUrl').value.trim();
    if (urlImg) a.image = urlImg;
  }

  function renderEditorPreview() {
    var a = state.draft;
    if (!a || !window.LemonSite) return;
    var box = $('adPreview');
    box.innerHTML = '';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    var holder = document.createElement('div');
    holder.style.width = state.pvMode === 'grid' ? '300px' : '100%';
    holder.style.maxWidth = '100%';
    var node = LemonSite.buildAd(a);
    node.classList.add('ls-anim-off');
    holder.appendChild(node);
    box.appendChild(holder);
    $('adPreviewNote').textContent = (a.enabled === false ? '[꺼짐] ' : '') +
      (SIZE_LABEL[a.size] || '') + ' · ' + (STYLE_LABEL[a.style] || '') + ' · ' + (a.interval || 6) + '개 기사마다';
  }

  function resizeImage(file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var maxW = 1200;
      var scale = Math.min(1, maxW / img.width);
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      var q = 0.86;
      var data = c.toDataURL('image/jpeg', q);
      while (data.length > 190000 && q > 0.45) {
        q -= 0.1;
        data = c.toDataURL('image/jpeg', q);
      }
      URL.revokeObjectURL(url);
      cb(data);
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  /* ---------------- 광고 이벤트 ---------------- */
  function bindAds() {
    $('adAdd').addEventListener('click', function () { openEditor(null); });
    var adsSaveBtn = $('adsSave');
    if (adsSaveBtn) adsSaveBtn.addEventListener('click', function () { saveAll('ads'); });
    $('adSeed').addEventListener('click', function () {
      var have = {};
      state.ads.forEach(function (a) { have[a.id] = 1; });
      var added = 0;
      (window.LemonSite ? LemonSite.SAMPLE_ADS : []).forEach(function (s) {
        if (!have[s.id]) { state.ads.push(clone(s)); added++; }
      });
      renderAdList();
      markDirty();
      toast(added ? '샘플 광고 ' + added + '개를 복원했습니다. [저장] 을 눌러 반영하세요.' : '샘플 광고가 이미 모두 있습니다.');
    });

    $('adsEnabled').addEventListener('change', function () {
      markDirty();
      renderAdList();
      toast('바뀐 내용은 [변경사항 저장] 을 눌러야 반영됩니다.');
    });

    $('adList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var row = e.target.closest('.adrow');
      var id = row && row.getAttribute('data-id');
      var ad = findAd(id);
      if (!ad) return;
      var act = btn.getAttribute('data-act');
      if (act === 'edit') openEditor(ad);
      if (act === 'dup') {
        var copy = clone(ad);
        copy.id = 'ad-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        copy.name = (ad.name || ad.title || '광고') + ' 사본';
        copy.order = state.ads.length + 1;
        state.ads.push(copy);
        renderAdList();
        markDirty();
        toast('광고를 복제했습니다. [저장] 을 눌러 반영하세요.');
      }
      if (act === 'del') {
        if (!confirm('이 광고를 삭제할까요?')) return;
        state.ads = state.ads.filter(function (a) { return a.id !== id; });
        renderAdList();
        markDirty();
        toast('광고를 삭제했습니다. [변경사항 저장] 을 눌러 반영하세요.');
      }
    });

    $('adList').addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-act="toggle"]');
      if (!cb) return;
      var row = e.target.closest('.adrow');
      var ad = findAd(row.getAttribute('data-id'));
      if (!ad) return;
      ad.enabled = cb.checked;
      renderAdList();
      markDirty();
    });

    /* 모달 */
    $('adCancel').addEventListener('click', closeEditor);
    $('adCancelX').addEventListener('click', closeEditor);
    $('adModal').addEventListener('click', function (e) {
      if (e.target === $('adModal')) closeEditor();
    });

    $('adTypeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-type]');
      if (!b) return;
      state.draft.type = b.getAttribute('data-type');
      $('adImageBlock').style.display = state.draft.type === 'image' ? '' : 'none';
      syncSegs(state.draft.type, state.draft.size, state.draft.style);
      renderEditorPreview();
    });
    $('adSizeOpts').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-size]');
      if (!b) return;
      state.draft.size = b.getAttribute('data-size');
      syncSegs(state.draft.type, state.draft.size, state.draft.style);
      renderEditorPreview();
    });
    $('adStyleOpts').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-style]');
      if (!b) return;
      state.draft.style = b.getAttribute('data-style');
      syncSegs(state.draft.type, state.draft.size, state.draft.style);
      renderEditorPreview();
    });
    $('adPreviewSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pv]');
      if (!b) return;
      state.pvMode = b.getAttribute('data-pv');
      Array.prototype.forEach.call($('adPreviewSeg').children, function (x) {
        x.classList.toggle('on', x.getAttribute('data-pv') === state.pvMode);
      });
      renderEditorPreview();
    });

    ['adName', 'adSponsor', 'adTitle', 'adDesc', 'adBtn', 'adUrl', 'adAlt', 'adCaption', 'adInterval', 'adOrder'].forEach(function (id) {
      $(id).addEventListener('input', function () { pullEditor(); renderEditorPreview(); });
    });
    ['adPos', 'adEnabled'].forEach(function (id) {
      $(id).addEventListener('change', function () { pullEditor(); renderEditorPreview(); });
    });
    $('adAccent').addEventListener('input', function () { $('adAccentHex').value = $('adAccent').value; pullEditor(); renderEditorPreview(); });
    $('adBg').addEventListener('input', function () { $('adBgHex').value = $('adBg').value; pullEditor(); renderEditorPreview(); });
    $('adAccentHex').addEventListener('input', function () {
      if (/^#[0-9a-f]{6}$/i.test($('adAccentHex').value)) { $('adAccent').value = $('adAccentHex').value; pullEditor(); renderEditorPreview(); }
    });
    $('adBgHex').addEventListener('input', function () {
      var v = $('adBgHex').value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) $('adBg').value = v;
      pullEditor(); renderEditorPreview();
    });

    $('adImageUrl').addEventListener('input', function () {
      pullEditor();
      updateThumb();
      renderEditorPreview();
    });
    $('adPick').addEventListener('click', function () { $('adFile').click(); });
    $('adFile').addEventListener('change', function () {
      var f = $('adFile').files && $('adFile').files[0];
      if (!f) return;
      resizeImage(f, function (data) {
        if (!data) { toast('이미지를 읽지 못했습니다.', 'err'); return; }
        state.draft.image = data;
        $('adImageUrl').value = '';
        $('adImageUrl').placeholder = '업로드된 이미지 사용 중';
        updateThumb();
        renderEditorPreview();
        toast('이미지를 압축해 넣었습니다 (' + Math.round(data.length / 1024) + 'KB)');
      });
      $('adFile').value = '';
    });

    $('adSave').addEventListener('click', function () {
      pullEditor();
      var a = state.draft;
      if (!a.title) { toast('제목을 입력하세요.', 'err'); $('adTitle').focus(); return; }
      if (a.type === 'image' && !a.image) { toast('이미지를 올리거나 URL을 입력하세요.', 'err'); return; }
      if (!a.name) a.name = a.title.slice(0, 30);
      if (state.editingId) {
        for (var i = 0; i < state.ads.length; i++) if (state.ads[i].id === state.editingId) state.ads[i] = clone(a);
      } else {
        a.id = 'ad-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        state.ads.push(clone(a));
      }
      closeEditor();
      renderAdList();
      markDirty();
      toast('광고를 수정했습니다. [변경사항 저장] 을 눌러 Flux Feed에 반영하세요.');
    });

    $('adDelete').addEventListener('click', function () {
      if (!state.editingId) return;
      if (!confirm('이 광고를 삭제할까요?')) return;
      state.ads = state.ads.filter(function (x) { return x.id !== state.editingId; });
      closeEditor();
      renderAdList();
      markDirty();
      toast('광고를 삭제했습니다. [변경사항 저장] 을 눌러 반영하세요.');
    });
  }

  /* ---------------- Supabase ---------------- */
  function refreshCloudPanel() {
    if (!window.LemonCloud) return;
    var c = LemonCloud.config();
    $('cUrl').value = c.url || '';
    $('cKey').value = c.anonKey || '';
    updateCloudPills();
  }
  function updateCloudPills() {
    var on = window.LemonCloud && LemonCloud.configured();
    var pill = $('cloudPill');
    pill.className = 'pill ' + (on ? 'pill--ok' : 'pill--off');
    $('cloudPillText').textContent = on ? 'Supabase 연결됨' : '로컬 모드';
    $('navCloudState').textContent = on ? 'ON' : '로컬';
    var u = window.LemonCloud ? LemonCloud.sessionUser() : null;
    $('cloudUserPill').textContent = u ? ('로그인 · ' + u.email) : '로그인 없음';
    var warn = $('remoteWarn');
    if (warn) warn.classList.toggle('hidden', !on || !!u);
  }

  function bindCloud() {
    $('cloudTest').addEventListener('click', function () {
      var box = $('cloudTestResult');
      box.style.display = '';
      box.className = 'note';
      box.innerHTML = '연결 확인 중...';
      LemonCloud.testConnection($('cUrl').value, $('cKey').value).then(function (r) {
        box.className = 'note' + (r.ok ? '' : ' note--warn');
        box.innerHTML = esc(r.ok ? (r.note || '연결되었습니다.') : (r.error || '연결 실패'));
      });
    });
    $('cloudSave').addEventListener('click', function () {
      var url = $('cUrl').value.trim();
      var key = $('cKey').value.trim();
      if (!url && !key) {
        LemonCloud.clearConfig();
        updateCloudPills();
        toast('로컬 모드로 전환했습니다.');
        return;
      }
      LemonCloud.setConfig(url, key);
      updateCloudPills();
      toast(LemonCloud.configured() ? 'Supabase 설정을 저장했습니다.' : 'URL과 anon key를 모두 입력하세요.', LemonCloud.configured() ? 'ok' : 'err');
    });
    $('cloudClear').addEventListener('click', function () {
      if (!confirm('Supabase 연결을 해제하고 로컬 모드로 돌아갈까요?')) return;
      LemonCloud.clearConfig();
      $('cUrl').value = LemonCloud.config().url || '';
      $('cKey').value = LemonCloud.config().anonKey || '';
      updateCloudPills();
      toast(LemonCloud.configured() ? '공개 설정(lemon-cloud-config.js)으로 되돌렸습니다.' : '로컬 모드로 전환했습니다.');
    });

    $('sqlCopy').addEventListener('click', function () {
      var txt = $('sqlBox').value;
      if (!txt) { toast('스키마 파일을 불러오지 못했습니다.', 'err'); return; }
      copyText(txt).then(function (ok) { toast(ok ? 'SQL을 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err'); });
    });

    $('cfgDownload').addEventListener('click', function () {
      var c = LemonCloud.config();
      var body = '/* Soft Hub · 공용 Supabase 설정 (배포용)\n' +
        '   이 파일을 저장소에 올리면 모든 방문자가 같은 Supabase를 사용합니다. */\n' +
        'window.LEMON_CLOUD_CONFIG = ' + JSON.stringify({ url: c.url || '', anonKey: c.anonKey || '' }, null, 2) + ';\n';
      var blob = new Blob([body], { type: 'text/javascript' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lemon-cloud-config.js';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      toast('설정 파일을 내려받았습니다.');
    });
    $('cfgCopy').addEventListener('click', function () {
      var c = LemonCloud.config();
      var body = 'window.LEMON_CLOUD_CONFIG = ' + JSON.stringify({ url: c.url || '', anonKey: c.anonKey || '' }) + ';';
      copyText(body).then(function (ok) { toast(ok ? '설정 내용을 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err'); });
    });

    $('remotePush').addEventListener('click', function () {
      if (!LemonCloud.configured()) { toast('먼저 Supabase를 연결하세요.', 'err'); return; }
      if (!LemonCloud.hasSession()) { toast('관리자 로그인이 필요합니다 (auth.html).', 'err'); return; }
      var cfg = LemonSite.getConfig();
      cfg.notice = collectNotice();
      cfg.home = collectHome();
      cfg.ads = { enabled: $('adsEnabled').checked };
      LemonCloud.saveSiteData(cfg, state.ads).then(function () {
        if (window.LemonSite && LemonSite.setRemote) LemonSite.setRemote(cfg, state.ads);
        forgetLocalOverrides();
        clearDirty();
        stampSaved('ads');
        toast('Supabase에 저장했습니다. 전 방문자에게 반영됩니다.');
        refreshCloudPanel();
      }, function (e) {
        toast('원격 저장 실패: ' + (e && e.message ? e.message : '오류'), 'err');
      });
    });

    window.addEventListener('lemoncloud:signed-in', updateCloudPills);
    window.addEventListener('lemoncloud:signed-out', updateCloudPills);
  }

  var schemaLoaded = false;
  function loadSchema() {
    if (schemaLoaded) { fillAccSql(); return; }
    schemaLoaded = true;
    if (!/^https?:$/.test(location.protocol)) {
      $('sqlBox').value = '로컬 파일로 열려 있어 supabase_schema.sql 을 불러올 수 없습니다.\n저장소의 supabase_schema.sql 파일을 열어 복사하세요.';
      fillAccSql();
      return;
    }
    fetch('supabase_schema.sql', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (t) { $('sqlBox').value = t; fillAccSql(); })
      .catch(function () {
        $('sqlBox').value = 'supabase_schema.sql 을 불러오지 못했습니다. 저장소 루트의 같은 파일을 직접 여세요.';
        fillAccSql();
      });
  }

  /* ---------------- 숨김 점검 ---------------- */
  function checkAdminLinks() {
    var el = $('kvAdminLinks');
    if (!el) return;
    el.textContent = '확인 중...';
    var pages = ['index.html', 'feed.html', 'sitemap.xml', 'robots.txt'];
    var hits = [];
    var failed = 0;
    Promise.all(pages.map(function (p) {
      return fetch(p, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) {
          if (t && t.indexOf('admin.html') >= 0) hits.push(p);
        }).catch(function () { failed++; });
    })).then(function () {
      if (failed === pages.length) { el.textContent = '확인 불가 (로컬 파일 모드)'; return; }
      el.textContent = hits.length
        ? '경고: ' + hits.join(', ') + ' 에 admin.html 링크가 있습니다!'
        : 'index.html · feed.html · sitemap.xml · robots.txt 어디에도 링크 없음';
      el.style.color = hits.length ? 'var(--danger)' : 'var(--ok)';
    });
  }

  /* ---------------- 콘솔 부트 ---------------- */
  var booted = false;

  /* 상태 → 화면. 원격 설정을 새로 받을 때마다 다시 부른다. */
  function hydrateConsole() {
    loadState();
    fillNotice(state.cfg.notice);
    fillHome(state.cfg.home);
    $('adsEnabled').checked = !(state.cfg.ads && state.cfg.ads.enabled === false);
    renderAdList();
    renderNoticePreview();
    renderHomePreview();
    $('noticeSavedAt').textContent = savedAtLabel('notice');
    $('homeSavedAt').textContent = savedAtLabel('home');
    $('adsSavedAt').textContent = savedAtLabel('ads');
    updateCloudPills();
    refreshCloudPanel();
    loadSchema();
    $('kvAdminUrl').textContent = location.pathname.split('/').pop() || 'admin.html';
    checkAdminLinks();
  }

  /* 관리자 화면도 다른 방문자와 같은 원격 설정을 본다.
     (사이트 레이어는 이 페이지에서 mount off 이므로 직접 받아 온다)
     LemonCloud.init() 을 기다렸다가 받아야 공용 설정(lemon-cloud-config.js)이
     늦게 로드된 경우에도 처음부터 같은 상태로 맞는다. */
  function syncRemoteState() {
    if (!window.LemonCloud) return Promise.resolve(false);
    var ready = LemonCloud.init ? LemonCloud.init() : Promise.resolve();
    return ready.then(function () {
      if (!cloudOn()) return false;
      return LemonCloud.fetchSiteData().then(function (data) {
        if (!data) return false;
        if (window.LemonSite && LemonSite.setRemote) LemonSite.setRemote(data.config, data.ads);
        return true;
      }, function () { return false; });
    }, function () { return false; });
  }

  function bootConsole() {
    hydrateConsole();

    if (!booted) {
      booted = true;
      bindConsole();
    }

    /* 폼을 채운 뒤 원격 설정으로 한 번 더 맞춘다(그새 고친 값이 있으면 놔둔다). */
    if (state.dirty) return;
    syncRemoteState().then(function (ok) {
      if (!ok || !state.unlocked || state.dirty) return;
      hydrateConsole();
    });
  }

  function bindConsole() {
    switchView('notice');
    Array.prototype.forEach.call(document.querySelectorAll('.navbtn'), function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });

    /* 공지 */
    ['nEnabled', 'nBadge', 'nText', 'nLink', 'nLinkText', 'nDismiss'].forEach(function (id) {
      $(id).addEventListener('input', function () { markDirty(); renderNoticePreview(); });
      $(id).addEventListener('change', function () { markDirty(); renderNoticePreview(); });
    });
    bindColorPair('nBg', 'nBgHex', function () { markDirty(); renderNoticePreview(); });
    bindColorPair('nFg', 'nFgHex', function () { markDirty(); renderNoticePreview(); });
    bindColorPair('nAccent', 'nAccentHex', function () { markDirty(); renderNoticePreview(); });
    $('noticeSave').addEventListener('click', function () { saveAll('notice'); });
    $('noticeReset').addEventListener('click', function () {
      fillNotice(state.cfg.notice);
      renderNoticePreview();
      clearDirty();
      toast('저장된 값으로 되돌렸습니다.');
    });

    /* 홈 */
    ['hEnabled', 'hBadge', 'hTitle', 'hSub', 'hBtn', 'hUrl', 'hDismiss', 'hStyle'].forEach(function (id) {
      $(id).addEventListener('input', function () { markDirty(); renderHomePreview(); });
      $(id).addEventListener('change', function () { markDirty(); renderHomePreview(); });
    });
    bindColorPair('hAccent', 'hAccentHex', function () { markDirty(); renderHomePreview(); });
    bindColorPair('hBg', 'hBgHex', function () { markDirty(); renderHomePreview(); });
    bindColorPair('hFg', 'hFgHex', function () { markDirty(); renderHomePreview(); });
    $('homeSave').addEventListener('click', function () { saveAll('home'); });
    $('homeReset').addEventListener('click', function () {
      fillHome(state.cfg.home);
      renderHomePreview();
      clearDirty();
      toast('저장된 값으로 되돌렸습니다.');
    });

    bindAds();
    bindCloud();

    /* 로그인/로그아웃하면 원격 설정을 다시 받아 이 화면을 맞춘다. */
    window.addEventListener('lemoncloud:signed-in', function () {
      if (!state.unlocked) return;
      syncRemoteState().then(function (ok) { if (ok && !state.dirty) hydrateConsole(); });
    });

    /* 사이트 보기 */
    $('siteBtn').addEventListener('click', function () {
      window.open('index.html', '_blank', 'noopener');
    });

    /* 보안 */
    $('pwLock').addEventListener('click', function () { lockNow(); });
    $('pwSave').addEventListener('click', function () {
      var cur = $('pwCur').value, n1 = $('pwNew').value, n2 = $('pwNew2').value;
      if (!authRec) return;
      if (n1.length < 6) { toast('새 비밀번호는 6자 이상이어야 합니다.', 'err'); return; }
      if (n1 !== n2) { toast('새 비밀번호 확인이 일치하지 않습니다.', 'err'); return; }
      hashPassword(cur, authRec.salt, authRec.iter || ITER).then(function (h) {
        if (h !== authRec.hash) { toast('현재 비밀번호가 올바르지 않습니다.', 'err'); return; }
        var salt = randomSalt();
        return hashPassword(n1, salt, ITER).then(function (hash) {
          var rec = { v: 2, salt: salt, iter: ITER, hash: hash, created: Date.now() };
          writeJSON(K_AUTH, rec);
          authRec = rec;
          try { sessionStorage.setItem(K_UNLOCK, hash.slice(0, 16) + ':' + salt.slice(0, 8)); } catch (e) { }
          persistAdminHash(rec);
          $('pwCur').value = $('pwNew').value = $('pwNew2').value = '';
          toast('비밀번호를 변경했습니다.');
        });
      });
    });

    /* 자동 잠금 (30분 무입력) */
    var lockTimer = 0;
    function bumpLock() {
      if (!state.unlocked) return;
      if (lockTimer) clearTimeout(lockTimer);
      lockTimer = setTimeout(function () { lockNow(); toast('30분 동안 입력이 없어 자동으로 잠겼습니다.'); }, 30 * 60 * 1000);
    }
    ['pointerdown', 'keydown', 'focusin'].forEach(function (ev) {
      document.addEventListener(ev, bumpLock, true);
    });
    bumpLock();

    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    bindAccounts();
  }

  /* ---------------- LK ID 계정 ---------------- */
  /* auth.users 는 브라우저에서 직접 읽을 수 없다.
     supabase_schema.sql 의 admin_list_lk_accounts() 가 관리자 세션에만 목록을 돌려준다. */
  var ACC_SQL_FALLBACK = [
    'create or replace function public.admin_list_lk_accounts()',
    'returns table (',
    '  id                 uuid,',
    '  email              text,',
    '  display_name       text,',
    '  provider           text,',
    '  created_at         timestamptz,',
    '  last_sign_in_at    timestamptz,',
    '  email_confirmed_at timestamptz',
    ')',
    'language plpgsql',
    'stable',
    'security definer',
    'set search_path = public, auth',
    'as $$',
    'begin',
    "  if not public.is_site_admin() then",
    "    raise exception 'forbidden';",
    '  end if;',
    '  return query',
    '    select u.id, u.email::text,',
    "           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')::text,",
    "           (u.raw_app_meta_data ->> 'provider')::text,",
    '           u.created_at, u.last_sign_in_at, u.email_confirmed_at',
    '      from auth.users u',
    '     order by u.created_at desc;',
    'end;',
    '$$;',
    '',
    'revoke all on function public.admin_list_lk_accounts() from public;',
    'grant execute on function public.admin_list_lk_accounts() to authenticated;'
  ].join('\n');

  var acc = { rows: [], mode: '', loaded: false, loading: false, at: 0, q: '' };

  function accDate(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (!d || isNaN(d.getTime())) return '—';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function accAgo(v) {
    if (!v) return '—';
    var t = new Date(v).getTime();
    if (!isFinite(t)) return '—';
    var diff = Math.max(0, Date.now() - t);
    var m = Math.floor(diff / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.floor(m / 60);
    if (h < 24) return h + '시간 전';
    var dd = Math.floor(h / 24);
    if (dd < 8) return dd + '일 전';
    return accDate(v);
  }
  function accClock(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function accProvider(v) {
    var p = String(v || '').toLowerCase();
    if (p === 'google') return { label: 'Google 가입', google: true };
    if (!p || p === 'email') return { label: '이메일 가입', google: false };
    return { label: p.charAt(0).toUpperCase() + p.slice(1) + ' 가입', google: false };
  }
  function accText(r) {
    return String((r && r.email) || '') + ' ' + String((r && r.display_name) || '');
  }
  function accFiltered() {
    var q = String(acc.q || '').trim().toLowerCase();
    if (!q) return acc.rows.slice();
    return acc.rows.filter(function (r) { return accText(r).toLowerCase().indexOf(q) >= 0; });
  }

  function accErrorKind(e) {
    var msg = String((e && e.message) || '');
    var st = e && e.status;
    if (st === 404 || /could not find the function|function .* does not exist|schema cache|PGRST202|permission denied for function/i.test(msg)) return 'setup';
    if (/forbidden/i.test(msg)) return 'forbidden';
    if (st === 401 || /jwt|admin-login-required|not authenticated|no api key/i.test(msg)) return 'no-session';
    return 'error';
  }

  function accountsSqlText() {
    var full = ($('sqlBox') && $('sqlBox').value) || '';
    var a = full.indexOf('-- >> admin_list_lk_accounts');
    var b = full.indexOf('-- << admin_list_lk_accounts');
    if (a >= 0 && b > a) {
      var nl = full.indexOf('\n', a);
      return nl > 0 ? full.slice(nl + 1, b).replace(/\s+$/, '') : '';
    }
    return ACC_SQL_FALLBACK;
  }
  function fillAccSql() {
    var box = $('accSqlBox');
    if (!box) return;
    var txt = accountsSqlText();
    if (txt && box.value !== txt) box.value = txt;
  }
  function accSqlUrl() {
    try {
      var u = (window.LemonCloud && LemonCloud.config().url) || '';
      var m = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(u);
      if (m) return 'https://supabase.com/dashboard/project/' + m[1] + '/sql/new';
    } catch (e) { }
    return 'https://supabase.com/dashboard';
  }

  function renderAccStats() {
    var ok = acc.loaded && !acc.loading && acc.mode === 'ok';
    var total = 0, mail = 0, google = 0, recent = 0;
    var since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (ok) {
      acc.rows.forEach(function (r) {
        total++;
        var isGoogle = String(r.provider || '').toLowerCase() === 'google';
        if (isGoogle) google++; else mail++;
        var t = r.last_sign_in_at ? new Date(r.last_sign_in_at).getTime() : 0;
        if (t && t >= since) recent++;
      });
    }
    $('accTotal').textContent = ok ? String(total) : '—';
    $('accEmail').textContent = ok ? String(mail) : '—';
    $('accGoogle').textContent = ok ? String(google) : '—';
    $('accRecent').textContent = ok ? String(recent) : '—';
    $('navAccCount').textContent = ok ? String(total) : '0';
  }

  function accMsg(title, desc, action) {
    return '<div class="accmsg"><div class="accmsg__icon">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="10.5" x2="12" y2="16.5"></line><circle cx="12" cy="7.6" r=".9" fill="currentColor" stroke="none"></circle></svg>' +
      '</div><b>' + esc(title) + '</b><span>' + esc(desc) + '</span>' + (action || '') + '</div>';
  }

  function renderAccTable() {
    var box = $('accTable');
    if (!box) return;
    if (acc.loading) {
      box.innerHTML = '<div class="emptybox">계정 목록을 불러오는 중입니다.</div>';
      return;
    }
    if (!acc.loaded) {
      box.innerHTML = '<div class="emptybox">아직 불러오지 않았습니다.</div>';
      return;
    }
    if (acc.mode === 'err') {
      var login = '<a class="btn btn--primary btn--sm" href="auth.html?next=admin.html" target="_blank" rel="noopener">LK ID 로그인</a>';
      if (acc.error === 'setup') {
        box.innerHTML = accMsg('아직 조회 함수가 없습니다', '위의 SQL을 Supabase SQL Editor에서 1회 실행한 뒤 [저장한 뒤 다시 확인] 을 눌러 주세요.');
      } else if (acc.error === 'no-session') {
        box.innerHTML = accMsg('LK ID 로그인이 필요합니다', '관리자 이메일(public.admin_users)로 로그인한 세션에서만 계정 목록을 볼 수 있습니다.', login);
      } else if (acc.error === 'forbidden') {
        box.innerHTML = accMsg('관리자 계정이 아닙니다', '지금 로그인한 이메일이 Supabase 의 public.admin_users 에 등록되어 있는지 확인해 주세요.', login);
      } else if (acc.error === 'no-cloud') {
        box.innerHTML = accMsg('Supabase 연결이 없습니다', 'Supabase 탭에서 Project URL 과 anon key 를 저장하면 계정 목록을 볼 수 있습니다.');
      } else {
        box.innerHTML = accMsg('불러오지 못했습니다', '잠시 뒤 [새로고침] 으로 다시 시도해 주세요.');
      }
      return;
    }
    var rows = accFiltered();
    if (!acc.rows.length) {
      box.innerHTML = '<div class="emptybox">아직 가입한 LK ID 계정이 없습니다.</div>';
      return;
    }
    if (!rows.length) {
      box.innerHTML = '<div class="emptybox">검색 결과가 없습니다.</div>';
      return;
    }
    box.innerHTML = rows.map(function (r) {
      var prov = accProvider(r.provider);
      var confirmed = !!r.email_confirmed_at;
      return '<div class="accrow">' +
        '<div class="accrow__id">' +
        '<div class="accrow__mail" title="' + esc(r.email || '') + '">' + esc(r.email || '(이메일 없음)') + '</div>' +
        '<div class="accrow__name">' + esc(r.display_name || '표시 이름 없음') + '</div>' +
        '</div>' +
        '<div class="accrow__tags">' +
        '<span class="accbadge' + (prov.google ? ' accbadge--google' : '') + '">' + esc(prov.label) + '</span>' +
        '<span class="accbadge' + (confirmed ? ' accbadge--ok' : ' accbadge--wait') + '">' + (confirmed ? '인증됨' : '미인증') + '</span>' +
        '</div>' +
        '<div class="accrow__col"><em>가입일</em><span>' + esc(accDate(r.created_at)) + '</span></div>' +
        '<div class="accrow__col"><em>최근 로그인</em><span>' + esc(accAgo(r.last_sign_in_at)) + '</span></div>' +
        '</div>';
    }).join('');
  }

  function renderAccounts() {
    renderAccStats();
    var pill = $('accPill');
    var txt = $('accPillText');
    var on = acc.loaded && !acc.loading && acc.mode === 'ok';
    if (acc.loading) {
      pill.className = 'pill pill--warn';
      txt.textContent = '불러오는 중';
    } else if (on) {
      pill.className = 'pill pill--ok';
      txt.textContent = '계정 ' + acc.rows.length + '개';
    } else {
      pill.className = 'pill pill--off';
      txt.textContent = acc.loaded ? '확인 필요' : '불러오기 전';
    }
    $('accSyncPill').textContent = '최근 갱신 ' + accClock(acc.at);
    var setup = acc.mode === 'err' && acc.error === 'setup';
    /* 조회 함수가 아직 없을 때는 안내 카드만 보여 준다(빈 목록은 겹치지 않게 숨김). */
    $('accSetupCard').style.display = setup ? '' : 'none';
    $('accListCard').style.display = setup ? 'none' : '';
    if (setup) {
      fillAccSql();
      var open = $('accSqlOpen');
      if (open) open.setAttribute('href', accSqlUrl());
    }
    var note = $('accFootNote');
    if (note) {
      if (on) {
        var shown = accFiltered().length;
        note.textContent = acc.q ? ('검색 ' + shown + ' / 전체 ' + acc.rows.length + '개') : ('전체 ' + acc.rows.length + '개 · 최근 가입 순');
      } else {
        note.textContent = '';
      }
    }
    renderAccTable();
    var rf = $('accRefresh');
    if (rf) rf.disabled = acc.loading;
  }

  function loadAccounts(force) {
    if (acc.loading) return;
    if (!force && acc.loaded && acc.mode === 'ok' && Date.now() - acc.at < 5 * 60 * 1000) {
      renderAccounts();
      return;
    }
    if (!cloudOn()) {
      acc.loaded = true; acc.mode = 'err'; acc.error = 'no-cloud'; acc.at = Date.now();
      renderAccounts();
      return;
    }
    if (!LemonCloud.hasSession()) {
      acc.loaded = true; acc.mode = 'err'; acc.error = 'no-session'; acc.at = Date.now();
      renderAccounts();
      return;
    }
    acc.loading = true;
    acc.mode = 'loading';
    renderAccounts();
    LemonCloud.listAccounts().then(function (rows) {
      acc.loading = false;
      acc.loaded = true;
      acc.at = Date.now();
      acc.rows = Array.isArray(rows) ? rows : [];
      acc.mode = 'ok';
      acc.error = '';
      renderAccounts();
    }, function (e) {
      acc.loading = false;
      acc.loaded = true;
      acc.at = Date.now();
      acc.mode = 'err';
      acc.error = accErrorKind(e);
      renderAccounts();
    });
  }

  function bindAccounts() {
    var search = $('accSearch');
    if (search) {
      search.addEventListener('input', function () {
        acc.q = search.value;
        renderAccounts();
      });
    }
    var rf = $('accRefresh');
    if (rf) rf.addEventListener('click', function () { loadAccounts(true); });
    var again = $('accSqlAgain');
    if (again) again.addEventListener('click', function () { loadAccounts(true); });
    var copy = $('accSqlCopy');
    if (copy) copy.addEventListener('click', function () {
      var txt = accountsSqlText();
      if (!txt) { toast('SQL을 준비하지 못했습니다.', 'err'); return; }
      copyText(txt).then(function (ok) { toast(ok ? 'SQL을 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err'); });
    });
    window.addEventListener('lemoncloud:signed-in', function () { acc.loaded = false; acc.mode = ''; });
    window.addEventListener('lemoncloud:signed-out', function () { acc.loaded = false; acc.mode = ''; acc.rows = []; });
  }

  /* ---------------- 부트 ---------------- */
  function boot() {
    initTheme();
    initGate();
    if (window.LemonCloud && LemonCloud.init) {
      LemonCloud.init().then(function () {
        updateCloudPills();
        refreshCloudPanel();
      }, function () { });
    }
    if (window.Lemon && Lemon.upgradeColorPickers) Lemon.upgradeColorPickers(document);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
