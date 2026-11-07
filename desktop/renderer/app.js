(function () {
  'use strict';

  var bridge = window.creamy;
  var $ = function (sel) { return document.querySelector(sel); };

  var LS_PREFIX = 'cb.';

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (err) { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (err) { /* ignore */ }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    var value = bytes;
    while (value >= 1024 && i < units.length - 1) { value = value / 1024; i = i + 1; }
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (err) { return ''; }
  }

  var START_URL = (function () {
    var base = new URL('../assets/start_page.html', window.location.href);
    return base.href;
  })();

  var state = {
    tabs: [],
    groups: [],
    activeTabId: null,
    tabSeq: 1,
    groupSeq: 1,
    settings: {
      themePreset: 'default',
      themeMode: 'dark',
      accent: '',
      searchEngine: 'google',
      userName: '',
      translateTarget: 'ko'
    },
    mainSettings: {},
    history: [],
    bookmarks: [],
    bag: [],
    downloads: [],
    activePanel: null,
    translating: {}
  };

  var GROUP_COLORS = ['#e5484d', '#f5a623', '#30a46c', '#3b82f6', '#8e4ec6', '#d6409f'];

  var SEARCH_ENGINES = {
    google: { name: 'Google', search: 'https://www.google.com/search?q={q}', home: 'https://www.google.com' },
    naver: { name: 'Naver', search: 'https://search.naver.com/search.naver?query={q}', home: 'https://www.naver.com' },
    duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q={q}', home: 'https://duckduckgo.com' }
  };

  /* ---------- Tabs ---------- */

  function activeTab() {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === state.activeTabId) return state.tabs[i];
    }
    return null;
  }

  function tabById(id) {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) return state.tabs[i];
    }
    return null;
  }

  function createTab(url, opts) {
    opts = opts || {};
    var tab = {
      id: state.tabSeq,
      url: url || START_URL,
      title: opts.title || '새 탭',
      favicon: '',
      groupId: opts.groupId || null,
      loading: false,
      restored: true
    };
    state.tabSeq = state.tabSeq + 1;
    var webview = document.createElement('webview');
    webview.setAttribute('src', tab.url);
    webview.setAttribute('preload', bridge.env.preloadPath);
    webview.classList.add('offscreen');
    tab.webview = webview;
    state.tabs.push(tab);
    wireWebview(tab);
    renderTabs();
    $('#views').appendChild(webview);
    if (opts.activate !== false) activateTab(tab.id);
    saveSession();
    return tab;
  }

  function closeTab(id) {
    var tab = tabById(id);
    if (!tab) return;
    var index = state.tabs.indexOf(tab);
    state.tabs.splice(index, 1);
    if (tab.webview && tab.webview.parentNode) tab.webview.parentNode.removeChild(tab.webview);
    try { tab.webview.close(); } catch (err) { /* already gone */ }
    if (state.activeTabId === id) {
      var next = state.tabs[index] || state.tabs[index - 1] || null;
      if (next) activateTab(next.id);
      else { state.activeTabId = null; createTab(START_URL); return; }
    }
    renderTabs();
    saveSession();
  }

  function activateTab(id) {
    state.activeTabId = id;
    state.tabs.forEach(function (tab) {
      if (tab.id === id) {
        tab.webview.classList.remove('hidden');
        tab.webview.classList.remove('offscreen');
        tab.webview.focus();
      } else {
        tab.webview.classList.add('offscreen');
      }
    });
    renderTabs();
    updateToolbar();
  }

  function navigateTab(tab, url) {
    if (!tab) return;
    tab.url = url;
    try { tab.webview.loadURL(url); } catch (err) { /* ignore */ }
  }

  function wireWebview(tab) {
    var webview = tab.webview;

    webview.addEventListener('did-navigate', function (e) {
      tab.url = e.url;
      tab.loading = false;
      addHistory(e.url, tab.title);
      if (tab.id === state.activeTabId) { updateToolbar(); updateMediaChip(e.url); }
      renderTabs();
      saveSession();
    });

    webview.addEventListener('did-navigate-in-page', function (e) {
      if (e.isMainFrame && e.url) {
        tab.url = e.url;
        addHistory(e.url, tab.title);
        if (tab.id === state.activeTabId) { updateToolbar(); updateMediaChip(e.url); }
        saveSession();
      }
    });

    webview.addEventListener('did-start-loading', function () {
      tab.loading = true;
      renderTabs();
    });

    webview.addEventListener('did-stop-loading', function () {
      tab.loading = false;
      renderTabs();
      if (tab.id === state.activeTabId) updateToolbar();
    });

    webview.addEventListener('page-title-updated', function (e) {
      tab.title = e.title || '새 탭';
      renderTabs();
      saveSession();
    });

    webview.addEventListener('page-favicon-updated', function (e) {
      if (e.favicons && e.favicons.length > 0) {
        tab.favicon = e.favicons[e.favicons.length - 1];
        renderTabs();
      }
    });

    webview.addEventListener('dom-ready', function () {
      injectBackgroundAudio(webview);
      if (tab.id === state.activeTabId) updateMediaChip(tab.url);
    });

    webview.addEventListener('did-fail-load', function (e) {
      if (e.errorCode === -3) return;
      if (e.isMainFrame && e.errorCode !== 0) {
        showToast('페이지를 불러오지 못했습니다 (' + e.errorDescription + ')');
      }
    });
  }

  function injectBackgroundAudio(webview) {
    try {
      var script = [
        '(function(){',
        'if (window.__cbAudioLock) return; window.__cbAudioLock = true;',
        'try {',
        '  Object.defineProperty(document, "visibilityState", { get: function(){ return "visible"; }, configurable: true });',
        '  Object.defineProperty(document, "hidden", { get: function(){ return false; }, configurable: true });',
        '  document.addEventListener("visibilitychange", function(ev){ ev.stopImmediatePropagation(); }, true);',
        '  document.addEventListener("webkitvisibilitychange", function(ev){ ev.stopImmediatePropagation(); }, true);',
        '} catch (e) {}',
        '})()'
      ].join('\n');
      webview.executeJavaScript(script, false);
    } catch (err) { /* ignore */ }
  }

  function startPageUrl() {
    var preset = state.settings.themePreset;
    var mode = state.settings.themeMode;
    var u = new URL(START_URL);
    u.searchParams.set('theme', preset + '-' + mode);
    u.searchParams.set('user', state.settings.userName || '');
    u.searchParams.set('engine', state.settings.searchEngine || 'google');
    return u.href;
  }

  function goHome() {
    var tab = activeTab();
    if (!tab) return;
    navigateTab(tab, startPageUrl());
    tab.title = '새 탭';
  }

  function saveSession() {
    var data = {
      tabs: state.tabs.map(function (tab) {
        return { url: tab.url, title: tab.title, favicon: tab.favicon, groupId: tab.groupId };
      }),
      groups: state.groups,
      activeIndex: state.tabs.indexOf(activeTab()),
      settings: state.settings
    };
    lsSet('session', data);
  }

  function restoreSession() {
    var saved = lsGet('session', null);
    if (saved && saved.settings) {
      state.settings = Object.assign(state.settings, saved.settings);
    }
    if (saved && saved.groups) {
      state.groups = saved.groups;
      state.groupSeq = 1;
      state.groups.forEach(function (g) { state.groupSeq = Math.max(state.groupSeq, g.id + 1); });
    }
    if (saved && saved.tabs && saved.tabs.length > 0) {
      saved.tabs.forEach(function (t, index) {
        var tab = createTab(t.url, { activate: index === saved.activeIndex, title: t.title, groupId: t.groupId });
        tab.favicon = t.favicon || '';
        tab.title = t.title || '새 탭';
      });
      renderTabs();
    } else {
      createTab(startPageUrl());
    }
  }

  /* ---------- Tab strip rendering ---------- */

  function faviconHtml(tab) {
    if (tab.loading) return '<span class="tab-spinner"></span>';
    if (tab.favicon) return '<img src="' + escapeHtml(tab.favicon) + '" onerror="this.parentNode.innerHTML=\'<svg viewBox=\\\'0 0 16 16\\\' width=\\\'12\\\' height=\\\'12\\\'><circle cx=\\\'8\\\' cy=\\\'8\\\' r=\\\'5.5\\\' fill=\\\'none\\\' stroke=\\\'currentColor\\\' stroke-width=\\\'1.4\\\'/></svg>\'">';
    return '<svg viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="8" cy="8" rx="5.5" ry="2.2" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  }

  function renderTabs() {
    var container = $('#tabs');
    container.innerHTML = '';
    var renderedGroups = {};
    state.tabs.forEach(function (tab) {
      if (tab.groupId !== null) {
        var group = state.groups.filter(function (g) { return g.id === tab.groupId; })[0];
        if (group && !renderedGroups[group.id]) {
          renderedGroups[group.id] = true;
          container.appendChild(buildGroupPill(group));
        }
        if (group && group.collapsed) return;
      }
      container.appendChild(buildTabEl(tab));
    });
  }

  function buildGroupPill(group) {
    var pill = document.createElement('div');
    pill.className = 'group-pill';
    pill.style.setProperty('--group-color', group.color);
    pill.style.borderColor = group.color;
    var collapsedMark = group.collapsed ? '+' : '-';
    var memberCount = state.tabs.filter(function (t) { return t.groupId === group.id; }).length;
    pill.innerHTML = '<span class="group-name">' + escapeHtml(group.name) + '</span>' +
      '<span class="group-count">' + memberCount + '</span>' +
      '<span class="group-arrow">' + collapsedMark + '</span>';
    pill.addEventListener('click', function () {
      group.collapsed = !group.collapsed;
      renderTabs();
      saveSession();
    });
    pill.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showGroupMenu(e, group);
    });
    return pill;
  }

  function buildTabEl(tab) {
    var el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeTabId ? ' active' : '');
    if (tab.groupId !== null) {
      var group = state.groups.filter(function (g) { return g.id === tab.groupId; })[0];
      if (group) el.style.borderTop = '2px solid ' + group.color;
    }
    el.innerHTML = '<span class="tab-favicon">' + faviconHtml(tab) + '</span>' +
      '<span class="tab-title">' + escapeHtml(tab.title) + '</span>' +
      '<button class="tab-close" title="탭 닫기">' +
      '<svg viewBox="0 0 12 12" width="9" height="9"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>' +
      '</button>';
    el.addEventListener('click', function () { activateTab(tab.id); });
    el.addEventListener('auxclick', function (e) { if (e.button === 1) closeTab(tab.id); });
    el.querySelector('.tab-close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showTabMenu(e, tab);
    });
    return el;
  }

  /* ---------- Toolbar ---------- */

  function updateToolbar() {
    var tab = activeTab();
    var input = $('#omni-input');
    if (!tab) return;
    var url = tab.url || '';
    var isStart = url.indexOf('start_page.html') !== -1;
    input.value = isStart ? '' : url;
    var secure = url.indexOf('https://') === 0;
    $('#ssl-icon').classList.toggle('secure', secure);
    $('#ssl-icon').title = secure ? '보안 연결 (HTTPS)' : (url.indexOf('file://') === 0 || isStart ? '' : '보안되지 않은 연결');
    $('#ssl-lock').style.display = secure ? '' : 'none';
    $('#ssl-warn').style.display = secure ? 'none' : '';
    updateMediaChip(url);
    updateStarButton(url);
  }

  function updateMediaChip(url) {
    var chip = $('#chip-media');
    var isMedia = /youtube\.com|youtu\.be/.test(url || '');
    chip.classList.toggle('hidden', !isMedia);
  }

  function isBookmarked(url) {
    return state.bookmarks.filter(function (b) { return b.url === url; }).length > 0;
  }

  function updateStarButton(url) {
    var btn = $('#btn-star');
    var path = $('#star-path');
    if (isBookmarked(url)) path.setAttribute('fill', 'currentColor');
    else path.setAttribute('fill', 'none');
  }

  /* ---------- Omnibox navigation ---------- */

  function looksLikeUrl(text) {
    if (/^https?:\/\//i.test(text)) return true;
    if (/\s/.test(text)) return false;
    return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(text);
  }

  function navigateInput(text) {
    text = text.trim();
    if (text.length === 0) return;
    var tab = activeTab();
    if (!tab) return;
    var url;
    if (looksLikeUrl(text)) {
      if (/^https?:\/\//i.test(text)) url = text;
      else url = 'https://' + text;
    } else {
      var engine = SEARCH_ENGINES[state.settings.searchEngine] || SEARCH_ENGINES.google;
      url = engine.search.replace('{q}', encodeURIComponent(text));
    }
    navigateTab(tab, url);
    $('#omni-suggest').classList.add('hidden');
    $('#omni-input').blur();
  }

  var suggestTimer = null;
  var suggestSelected = -1;
  var suggestItems = [];

  function onOmniInput() {
    var q = $('#omni-input').value.trim();
    if (suggestTimer) clearTimeout(suggestTimer);
    if (q.length === 0) { $('#omni-suggest').classList.add('hidden'); return; }
    suggestTimer = setTimeout(function () { renderSuggestions(q); }, 180);
  }

  function renderSuggestions(q) {
    var lower = q.toLowerCase();
    var local = [];
    state.history.forEach(function (h) {
      if (local.length >= 4) return;
      if (h.title.toLowerCase().indexOf(lower) !== -1 || h.url.toLowerCase().indexOf(lower) !== -1) {
        local.push({ kind: '기록', text: h.title, url: h.url });
      }
    });
    state.bookmarks.forEach(function (b) {
      if (local.length >= 5) return;
      if (b.title.toLowerCase().indexOf(lower) !== -1 || b.url.toLowerCase().indexOf(lower) !== -1) {
        local.push({ kind: '북마크', text: b.title, url: b.url });
      }
    });
    bridge.net.suggest(q).then(function (remote) {
      var items = local.slice();
      (remote || []).forEach(function (s) {
        if (items.length >= 8) return;
        var dupe = items.some(function (it) { return it.text === s; });
        if (!dupe) items.push({ kind: '검색', text: s, url: null });
      });
      suggestItems = items;
      suggestSelected = -1;
      var box = $('#omni-suggest');
      box.innerHTML = '';
      items.forEach(function (item, index) {
        var el = document.createElement('div');
        el.className = 'suggest-item';
        var icon = item.kind === '검색'
          ? '<svg viewBox="0 0 16 16" width="13" height="13"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4"/></svg>'
          : '<svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
        el.innerHTML = icon + '<span class="s-text">' + escapeHtml(item.text) + '</span><span class="s-kind">' + item.kind + '</span>';
        el.addEventListener('click', function () {
          if (item.url) { navigateTab(activeTab(), item.url); $('#omni-suggest').classList.add('hidden'); $('#omni-input').blur(); }
          else { $('#omni-input').value = item.text; navigateInput(item.text); }
        });
        box.appendChild(el);
      });
      if (items.length > 0) box.classList.remove('hidden');
      else box.classList.add('hidden');
    });
  }

  function hideSuggest() {
    $('#omni-suggest').classList.add('hidden');
    suggestSelected = -1;
  }

  /* ---------- History ---------- */

  function addHistory(url, title) {
    if (!url || url.indexOf('http') !== 0) return;
    state.history = state.history.filter(function (h) { return h.url !== url; });
    state.history.unshift({ url: url, title: title || url, time: Date.now() });
    if (state.history.length > 500) state.history.length = 500;
    lsSet('history', state.history);
  }

  /* ---------- Bookmarks ---------- */

  function addBookmarkCurrent() {
    var tab = activeTab();
    if (!tab) return;
    if (isBookmarked(tab.url)) {
      state.bookmarks = state.bookmarks.filter(function (b) { return b.url !== tab.url; });
      showToast('북마크를 삭제했습니다.');
    } else {
      state.bookmarks.unshift({ id: Date.now(), title: tab.title, url: tab.url, folder: '기본' });
      showToast('북마크에 추가했습니다.');
    }
    lsSet('bookmarks', state.bookmarks);
    updateStarButton(tab.url);
    if (state.activePanel === 'bookmarks') renderPanel('bookmarks');
  }

  /* ---------- My Bag ---------- */

  function addToBag() {
    var tab = activeTab();
    if (!tab) return;
    var extract = 'document.querySelector("meta[name=description]") ? document.querySelector("meta[name=description]").content : (document.body ? document.body.innerText.slice(0, 300) : "")';
    tab.webview.executeJavaScript(extract, false).then(function (text) {
      state.bag.unshift({
        id: Date.now(),
        title: tab.title,
        url: tab.url,
        excerpt: (text || '').trim().slice(0, 300),
        date: Date.now()
      });
      lsSet('bag', state.bag);
      showToast('My Bag에 보관했습니다.');
      if (state.activePanel === 'bag') renderPanel('bag');
    }).catch(function () {
      state.bag.unshift({ id: Date.now(), title: tab.title, url: tab.url, excerpt: '', date: Date.now() });
      lsSet('bag', state.bag);
      showToast('My Bag에 보관했습니다.');
    });
  }

  /* ---------- Translation engine ---------- */

  var COLLECT_SCRIPT = [
    '(function(){',
    '  if (window.__cbTranslating) return {already: true, texts: []};',
    '  window.__cbTranslating = true;',
    '  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {acceptNode: function(n){',
    '    var v = n.nodeValue || "";',
    '    if (v.trim().length < 2) return NodeFilter.FILTER_REJECT;',
    '    var p = n.parentElement;',
    '    if (!p) return NodeFilter.FILTER_REJECT;',
    '    var tag = p.tagName;',
    '    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA" || tag === "CODE" || tag === "PRE") return NodeFilter.FILTER_REJECT;',
    '    var el = p;',
    '    while (el) { if (el.getAttribute && el.getAttribute("data-cb-i") !== null) return NodeFilter.FILTER_REJECT; el = el.parentElement; }',
    '    if (!p.offsetParent && tag !== "BODY") return NodeFilter.FILTER_REJECT;',
    '    return NodeFilter.FILTER_ACCEPT;',
    '  }});',
    '  var texts = [];',
    '  while (walker.nextNode() && texts.length < 2000) {',
    '    var node = walker.currentNode;',
    '    var span = document.createElement("span");',
    '    span.setAttribute("data-cb-i", String(texts.length));',
    '    span.setAttribute("data-cb-o", node.nodeValue);',
    '    node.parentNode.replaceChild(span, node);',
    '    span.appendChild(node);',
    '    texts.push(node.nodeValue);',
    '  }',
    '  return {already: false, texts: texts};',
    '})()'
  ].join('\n');

  var APPLY_SCRIPT_PREFIX = [
    '(function(map){',
    '  var spans = document.querySelectorAll("[data-cb-i]");',
    '  var applied = 0;',
    '  spans.forEach(function(s){',
    '    var i = s.getAttribute("data-cb-i");',
    '    if (map[i] !== undefined) { if (s.firstChild) s.firstChild.nodeValue = map[i]; applied++; }',
    '  });',
    '  window.__cbTranslating = false;',
    '  return applied;',
    '})('
  ].join('');

  var RESTORE_SCRIPT = [
    '(function(){',
    '  var spans = document.querySelectorAll("[data-cb-i]");',
    '  spans.forEach(function(s){',
    '    var orig = s.getAttribute("data-cb-o");',
    '    if (orig !== null && s.firstChild) s.firstChild.nodeValue = orig;',
    '    s.removeAttribute("data-cb-i");',
    '    s.removeAttribute("data-cb-o");',
    '  });',
    '  window.__cbTranslating = false;',
    '  return true;',
    '})()'
  ].join('\n');

  async function toggleTranslate() {
    var tab = activeTab();
    if (!tab) return;
    var chip = $('#chip-translate');
    if (state.translating[tab.id]) {
      chip.classList.remove('busy');
      chip.textContent = '번역';
      delete state.translating[tab.id];
      try { await tab.webview.executeJavaScript(RESTORE_SCRIPT, false); } catch (err) { /* gone */ }
      return;
    }
    chip.classList.add('busy');
    chip.textContent = '번역중';
    state.translating[tab.id] = true;
    try {
      var collected = await tab.webview.executeJavaScript(COLLECT_SCRIPT, false);
      if (!collected || collected.already || !collected.texts || collected.texts.length === 0) {
        showToast('번역할 본문이 없거나 이미 번역된 페이지입니다.');
        chip.classList.remove('busy');
        chip.textContent = '번역';
        return;
      }
      var texts = collected.texts;
      var map = {};
      var batchSize = 40;
      for (var start = 0; start < texts.length; start = start + batchSize) {
        var slice = texts.slice(start, start + batchSize);
        var translated = await bridge.translate.batch(slice, state.settings.translateTarget);
        for (var i = 0; i < slice.length; i++) {
          map[start + i] = translated[i];
        }
        chip.textContent = '번역 ' + Math.min(start + batchSize, texts.length) + '/' + texts.length;
      }
      await tab.webview.executeJavaScript(APPLY_SCRIPT_PREFIX + JSON.stringify(map) + ')', false);
      chip.textContent = '원문';
      chip.classList.remove('busy');
      showToast(texts.length + '개 노드를 번역했습니다.');
      state.translating[tab.id] = false;
    } catch (err) {
      showToast('번역에 실패했습니다: ' + (err.message || err));
      chip.classList.remove('busy');
      chip.textContent = '번역';
      delete state.translating[tab.id];
    }
  }

  /* ---------- PDF / print ---------- */

  async function savePdf() {
    var tab = activeTab();
    if (!tab) return;
    try {
      var wcId = tab.webview.getWebContentsId();
      var result = await bridge.page.savePdf(wcId);
      if (result && result.ok) showToast('PDF를 저장했습니다: ' + result.path);
      else if (result && !result.canceled) showToast('PDF 저장에 실패했습니다: ' + (result.error || ''));
    } catch (err) {
      showToast('PDF 저장에 실패했습니다: ' + (err.message || err));
    }
  }

  function printPage() {
    var tab = activeTab();
    if (!tab) return;
    bridge.page.print(tab.webview.getWebContentsId());
  }

  /* ---------- Media download ---------- */

  function showMediaMenu(x, y) {
    var menu = $('#media-menu');
    menu.style.left = Math.max(10, x - 90) + 'px';
    menu.style.top = (y + 8) + 'px';
    menu.classList.remove('hidden');
  }

  function startMediaDownload(mode) {
    var tab = activeTab();
    if (!tab) return;
    bridge.media.download(tab.url, mode);
    $('#media-menu').classList.add('hidden');
    showToast(mode === 'audio' ? '음원(M4A) 추출을 시작합니다.' : '동영상(MP4) 추출을 시작합니다.');
  }

  /* ---------- Sidebar ---------- */

  var SVG_ICONS = {
    open: '<svg viewBox="0 0 14 14" width="13" height="13"><path d="M5 3.5L9 7l-4 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 14 14" width="13" height="13"><path d="M2.5 4h9M5.5 4V2.8h3V4M4 4l.6 7.2h4.8L10 4" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 14 14" width="13" height="13"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M9.5 4.5v-2h-7v7h2" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>'
  };

  function openPanel(name) {
    state.activePanel = name;
    $('#sidebar').classList.remove('hidden');
    document.querySelectorAll('.rail-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-panel') === name);
    });
    renderPanel(name);
  }

  function closePanel() {
    state.activePanel = null;
    $('#sidebar').classList.add('hidden');
    document.querySelectorAll('.rail-btn').forEach(function (btn) {
      btn.classList.remove('active');
    });
  }

  function togglePanel(name) {
    if (state.activePanel === name) closePanel();
    else openPanel(name);
  }

  var PANEL_TITLES = {
    creamy: 'Creamy AI',
    bag: 'My Bag',
    bookmarks: '북마크',
    downloads: '다운로드',
    menu: '전체 메뉴',
    settings: '설정'
  };

  function renderPanel(name) {
    $('#sb-title').textContent = PANEL_TITLES[name] || '';
    var body = $('#sb-body');
    body.innerHTML = '';
    if (name === 'creamy') renderCreamyPanel(body);
    else if (name === 'bag') renderBagPanel(body);
    else if (name === 'bookmarks') renderBookmarksPanel(body);
    else if (name === 'downloads') renderDownloadsPanel(body);
    else if (name === 'menu') renderMenuPanel(body);
    else if (name === 'settings') renderSettingsPanel(body);
  }

  /* ---------- Creamy AI panel ---------- */

  var creamyChat = [];

  function buildSystemPrompt(pageText) {
    var sys = '너는 Creamy Browser에 탑재된 Creamy AI다. 사용자의 웹 사용을 돕는 친절한 한국어 어시스턴트로 답한다.';
    if (pageText) {
      sys = sys + '\n\n[현재 페이지 내용]\n' + pageText.slice(0, 6000);
    }
    return sys;
  }

  async function getCreamyPageText() {
    var tab = activeTab();
    if (!tab) return '';
    try {
      var text = await tab.webview.executeJavaScript('document.body ? document.body.innerText.slice(0, 8000) : ""', false);
      return text || '';
    } catch (err) { return ''; }
  }

  function localExtractive(text, query, count) {
    var cleaned = text.replace(/\s+/g, ' ').trim();
    var sentences = (cleaned.match(/[^.!?。]+[.!?。]?/g) || []).filter(function (s) { return s.length > 20; });
    if (sentences.length === 0) return cleaned.slice(0, 400);
    var stop = ['그리고', '하지만', '그러나', '있다', '없다', '했다', '이다', '하는', '것은', '그것', 'the', 'and', 'for', 'with', 'that', 'this', 'from'];
    var freq = {};
    var words = cleaned.toLowerCase().split(/[^a-zA-Z가-힣0-9]+/);
    words.forEach(function (w) {
      if (w.length < 2 || stop.indexOf(w) !== -1) return;
      freq[w] = (freq[w] || 0) + 1;
    });
    var queryWords = query ? query.toLowerCase().split(/\s+/) : [];
    var scored = sentences.map(function (s, index) {
      var score = 0;
      var sw = s.toLowerCase().split(/[^a-zA-Z가-힣0-9]+/);
      sw.forEach(function (w) { score = score + (freq[w] || 0) * 0.1; });
      if (query) {
        queryWords.forEach(function (qw) {
          if (qw.length > 1 && s.toLowerCase().indexOf(qw) !== -1) score = score + 5;
        });
      }
      score = score - index * 0.01;
      return { s: s, score: score, index: index };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var picked = scored.slice(0, count).sort(function (a, b) { return a.index - b.index; });
    return picked.map(function (p) { return p.s; }).join('\n\n');
  }

  function renderCreamyPanel(body) {
    var wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.minHeight = '100%';

    var log = document.createElement('div');
    log.className = 'creamy-log';
    if (creamyChat.length === 0) {
      log.innerHTML = '<div class="empty-note">Creamy AI에게 페이지에 대해<br>무엇이든 물어보세요.</div>';
    }
    creamyChat.forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
      el.textContent = m.content;
      log.appendChild(el);
    });
    wrap.appendChild(log);

    var quick = document.createElement('div');
    quick.className = 'creamy-quick';
    [
      ['3줄 요약', '이 페이지를 3줄로 요약해줘'],
      ['핵심 질문', '이 페이지에서 알아야 할 핵심 질문 3개를 만들어줘'],
      ['한글 번역', '이 페이지의 핵심 내용을 한국어로 정리해줘']
    ].forEach(function (pair) {
      var chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = pair[0];
      chip.addEventListener('click', function () { sendCreamy(pair[1]); });
      quick.appendChild(chip);
    });
    wrap.appendChild(quick);

    var row = document.createElement('div');
    row.className = 'creamy-input-row';
    var input = document.createElement('textarea');
    input.placeholder = 'Creamy에게 질문하세요.';
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCreamy(input.value);
      }
    });
    var send = document.createElement('button');
    send.className = 'creamy-send';
    send.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 10h13M11 4.5L16.5 10 11 15.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    send.addEventListener('click', function () { sendCreamy(input.value); });
    row.appendChild(input);
    row.appendChild(send);
    wrap.appendChild(row);

    var note = document.createElement('div');
    note.className = 'creamy-note';
    note.textContent = 'API 키를 등록하면 Creamy AI 정품 응답을 받습니다. 미등록 시 페이지 기반 로컬 요약으로 답합니다.';
    wrap.appendChild(note);

    body.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  async function sendCreamy(rawText) {
    var text = (rawText || '').trim();
    if (text.length === 0) return;
    var apiKey = state.mainSettings.creamyApiKey || '';
    var pageText = await getCreamyPageText();

    creamyChat.push({ role: 'user', content: text });
    renderPanel('creamy');

    if (apiKey) {
      var pendingMsg = { role: 'assistant', content: '생각 중...' };
      creamyChat.push(pendingMsg);
      renderPanel('creamy');
      try {
        var messages = [{ role: 'system', content: buildSystemPrompt(pageText) }];
        creamyChat.slice(0, -1).forEach(function (m) { messages.push({ role: m.role, content: m.content }); });
        var res = await bridge.net.creamy({
          baseUrl: state.mainSettings.creamyBaseUrl || 'https://api.openai.com/v1',
          apiKey: apiKey,
          model: state.mainSettings.creamyModel || 'gpt-4o-mini',
          messages: messages
        });
        pendingMsg.content = res.choices[0].message.content;
      } catch (err) {
        pendingMsg.content = '응답에 실패했습니다: ' + (err.message || err);
      }
      renderPanel('creamy');
      return;
    }

    var answer;
    if (pageText && pageText.trim().length > 100) {
      var isSummary = /요약|정리|summary/i.test(text);
      answer = localExtractive(pageText, isSummary ? '' : text, isSummary ? 3 : 3);
      answer = '[로컬 모드 응답]\n' + answer;
    } else {
      answer = '[로콜 모드] 현재 페이지의 본문을 읽을 수 없어 로컬 요약을 제공할 수 없습니다. 설정에서 API 키를 등록하면 Creamy AI 정품 응답을 받을 수 있습니다.';
    }
    creamyChat.push({ role: 'assistant', content: answer });
    renderPanel('creamy');
  }

  /* ---------- Bag panel ---------- */

  function renderBagPanel(body) {
    var actions = document.createElement('div');
    actions.className = 'panel-actions';
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = '이 페이지 보관';
    saveBtn.addEventListener('click', addToBag);
    actions.appendChild(saveBtn);
    body.appendChild(actions);

    if (state.bag.length === 0) {
      var note = document.createElement('div');
      note.className = 'empty-note';
      note.innerHTML = '아직 보관한 페이지가 없습니다.<br>웹서핑 중 마음에 드는 페이지를 보관하세요.';
      body.appendChild(note);
      return;
    }
    state.bag.forEach(function (item) {
      body.appendChild(buildListItem({
        title: item.title,
        sub: hostOf(item.url) + ' / ' + new Date(item.date).toLocaleDateString('ko-KR'),
        sub2: item.excerpt,
        onOpen: function () { navigateTab(activeTab(), item.url); },
        onDelete: function () {
          state.bag = state.bag.filter(function (b) { return b.id !== item.id; });
          lsSet('bag', state.bag);
          renderPanel('bag');
        }
      }));
    });
  }

  function buildListItem(spec) {
    var el = document.createElement('div');
    el.className = 'list-item';
    var main = document.createElement('div');
    main.className = 'li-main';
    main.innerHTML = '<div class="li-title">' + escapeHtml(spec.title || '(제목 없음)') + '</div>' +
      '<div class="li-sub">' + escapeHtml(spec.sub || '') + '</div>' +
      (spec.sub2 ? '<div class="li-sub">' + escapeHtml(spec.sub2) + '</div>' : '');
    var acts = document.createElement('div');
    acts.className = 'li-actions';
    var openBtn = document.createElement('button');
    openBtn.className = 'li-btn';
    openBtn.title = '열기';
    openBtn.innerHTML = SVG_ICONS.open;
    openBtn.addEventListener('click', spec.onOpen);
    var delBtn = document.createElement('button');
    delBtn.className = 'li-btn';
    delBtn.title = '삭제';
    delBtn.innerHTML = SVG_ICONS.trash;
    delBtn.addEventListener('click', spec.onDelete);
    acts.appendChild(openBtn);
    acts.appendChild(delBtn);
    el.appendChild(main);
    el.appendChild(acts);
    return el;
  }

  /* ---------- Bookmarks panel ---------- */

  function renderBookmarksPanel(body) {
    var search = document.createElement('input');
    search.className = 'panel-search';
    search.placeholder = '북마크 검색';
    search.addEventListener('input', function () { renderList(search.value); });
    body.appendChild(search);

    var groups = {};
    state.bookmarks.forEach(function (b) {
      var folder = b.folder || '기본';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(b);
    });

    function renderList(filter) {
      var lower = (filter || '').toLowerCase();
      body.querySelectorAll('.list-item, .folder-label, .empty-note').forEach(function (el) { el.remove(); });
      var any = false;
      Object.keys(groups).forEach(function (folder) {
        var items = groups[folder].filter(function (b) {
          return lower.length === 0 || b.title.toLowerCase().indexOf(lower) !== -1 || b.url.toLowerCase().indexOf(lower) !== -1;
        });
        if (items.length === 0) return;
        any = true;
        var label = document.createElement('div');
        label.className = 'folder-label';
        label.textContent = folder;
        body.appendChild(label);
        items.forEach(function (b) {
          body.appendChild(buildListItem({
            title: b.title,
            sub: b.url,
            onOpen: function () { navigateTab(activeTab(), b.url); },
            onDelete: function () {
              state.bookmarks = state.bookmarks.filter(function (x) { return x.id !== b.id; });
              lsSet('bookmarks', state.bookmarks);
              groups = rebuild();
              renderPanel('bookmarks');
              updateStarButton(activeTab() ? activeTab().url : '');
            }
          }));
        });
      });
      if (!any) {
        var note = document.createElement('div');
        note.className = 'empty-note';
        note.textContent = '북마크가 없습니다. 주소창의 별 버튼으로 추가하세요.';
        body.appendChild(note);
      }
    }

    function rebuild() {
      var map = {};
      state.bookmarks.forEach(function (b) {
        var folder = b.folder || '기본';
        if (!map[folder]) map[folder] = [];
        map[folder].push(b);
      });
      return map;
    }

    renderList('');
  }

  /* ---------- Downloads panel ---------- */

  function renderDownloadsPanel(body) {
    var actions = document.createElement('div');
    actions.className = 'panel-actions';
    var folderBtn = document.createElement('button');
    folderBtn.className = 'btn ghost';
    folderBtn.textContent = '다운로드 폴더 열기';
    folderBtn.addEventListener('click', function () { bridge.downloads.openFolder(); });
    actions.appendChild(folderBtn);
    body.appendChild(actions);

    if (state.downloads.length === 0) {
      var note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = '다운로드 기록이 없습니다.';
      body.appendChild(note);
      return;
    }
    state.downloads.slice().reverse().forEach(function (item) {
      var percent = item.total > 0 ? Math.round((item.received / item.total) * 100) : null;
      var el = document.createElement('div');
      el.className = 'list-item';
      var stateText = item.state === 'completed' ? '완료' : (item.state === 'failed' ? '실패' : (item.kind === 'media' ? '추출 중' : '다운로드 중'));
      if (item.state === 'canceled') stateText = '취소됨';
      var kindText = item.kind === 'media' ? (item.mode === 'audio' ? 'M4A 추출' : 'MP4 추출') : '파일';
      el.innerHTML = '<div class="li-main">' +
        '<div class="li-title">' + escapeHtml(item.filename || '(알 수 없음)') + '</div>' +
        '<div class="li-sub">' + kindText + ' / ' + stateText + (item.total ? ' / ' + formatBytes(item.received) + ' / ' + formatBytes(item.total) : '') + '</div>' +
        (percent !== null && item.state === 'progressing' ? '<div class="progress-track"><div class="progress-fill" style="width:' + percent + '%"></div></div>' : '') +
        '</div>';
      var acts = document.createElement('div');
      acts.className = 'li-actions';
      if (item.path && item.state === 'completed') {
        var openBtn = document.createElement('button');
        openBtn.className = 'li-btn';
        openBtn.title = '열기';
        openBtn.innerHTML = SVG_ICONS.open;
        openBtn.addEventListener('click', function () { bridge.downloads.openFile(item.path); });
        acts.appendChild(openBtn);
      }
      el.appendChild(acts);
      body.appendChild(el);
    });
  }

  /* ---------- Menu panel ---------- */

  function renderMenuPanel(body) {
    function item(label, icon, handler) {
      var el = document.createElement('button');
      el.className = 'menu-item';
      el.innerHTML = icon + '<span>' + label + '</span>';
      el.addEventListener('click', handler);
      return el;
    }
    var svg = function (path) { return '<svg viewBox="0 0 20 20" width="15" height="15">' + path + '</svg>'; };

    body.appendChild(item('새 탭', svg('<path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'), function () {
      createTab(startPageUrl());
      closePanel();
    }));
    body.appendChild(item('PDF로 저장', svg('<path d="M5 3h7l3 3v11H5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>'), function () { savePdf(); }));
    body.appendChild(item('인쇄', svg('<path d="M6 7V3h8v4M6 14H3V8h14v6h-3M6 11h8v6H6z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>'), function () { printPage(); }));
    body.appendChild(item('현재 페이지 번역', svg('<path d="M3 5h9M7 3v2c0 3-2 5-4 5M5 7c1 2 3 3.4 5 4M11 17l3.5-8L18 17M12.3 14.5h4.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'), function () { toggleTranslate(); }));
    body.appendChild(item('전체 화면', svg('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>'), function () {
      bridge.win.fullscreenToggle();
    }));
    body.appendChild(item('방문 기록 지우기', svg('<circle cx="10" cy="10" r="6.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M10 6.5V10l2.5 2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>'), function () {
      state.history = [];
      lsSet('history', state.history);
      showToast('방문 기록을 지웠습니다.');
      renderPanel('menu');
    }));

    var divider = document.createElement('div');
    divider.className = 'menu-divider';
    body.appendChild(divider);

    var caption = document.createElement('div');
    caption.className = 'menu-caption';
    caption.textContent = '방문 기록';
    body.appendChild(caption);

    if (state.history.length === 0) {
      var note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = '방문 기록이 없습니다.';
      body.appendChild(note);
    }
    state.history.slice(0, 30).forEach(function (h) {
      body.appendChild(buildListItem({
        title: h.title,
        sub: new Date(h.time).toLocaleString('ko-KR') + ' / ' + hostOf(h.url),
        onOpen: function () { navigateTab(activeTab(), h.url); },
        onDelete: function () {
          state.history = state.history.filter(function (x) { return x.url !== h.url; });
          lsSet('history', state.history);
          renderPanel('menu');
        }
      }));
    });
  }

  /* ---------- Settings panel ---------- */

  function applyTheme() {
    document.body.setAttribute('data-theme', state.settings.themePreset + '-' + state.settings.themeMode);
    if (state.settings.accent) {
      document.body.style.setProperty('--accent', state.settings.accent);
    } else {
      document.body.style.removeProperty('--accent');
    }
  }

  function reloadStartTabs() {
    state.tabs.forEach(function (tab) {
      if (tab.url.indexOf('start_page.html') !== -1) {
        tab.url = startPageUrl();
        navigateTab(tab, tab.url);
      }
    });
    saveSession();
  }

  function renderSettingsPanel(body) {
    var s = state.settings;
    var ms = state.mainSettings;

    function group() {
      var g = document.createElement('div');
      g.className = 'set-group';
      body.appendChild(g);
      return g;
    }

    function row(parent, label, desc) {
      var r = document.createElement('div');
      r.className = 'set-row';
      var labelBox = document.createElement('div');
      labelBox.innerHTML = '<div class="set-label">' + label + '</div>' + (desc ? '<div class="set-desc">' + desc + '</div>' : '');
      r.appendChild(labelBox);
      parent.appendChild(r);
      return r;
    }

    function switchRow(parent, label, desc, value, onChange) {
      var r = row(parent, label, desc);
      var sw = document.createElement('button');
      sw.className = 'switch' + (value ? ' on' : '');
      sw.addEventListener('click', function () {
        var next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        onChange(next);
      });
      var ctrl = document.createElement('div');
      ctrl.className = 'set-control';
      ctrl.appendChild(sw);
      r.appendChild(ctrl);
      return r;
    }

    var gTheme = group();

    var presetRow = row(gTheme, '테마', '4대 테마 중 선택하세요.');
    presetRow.classList.add('column');
    var chips = document.createElement('div');
    chips.className = 'theme-chips';
    [['default', '기본'], ['pink', '핑크']].forEach(function (pair) {
      var c = document.createElement('button');
      c.className = 'tchip' + (s.themePreset === pair[0] ? ' selected' : '');
      c.textContent = pair[1];
      c.addEventListener('click', function () {
        s.themePreset = pair[0];
        lsSet('settings', s);
        applyTheme();
        renderPanel('settings');
        reloadStartTabs();
      });
      chips.appendChild(c);
    });
    presetRow.appendChild(chips);

    var modeRow = row(gTheme, '모드', '라이트 / 다크 듀얼 모드.');
    modeRow.classList.add('column');
    var modeChips = document.createElement('div');
    modeChips.className = 'theme-chips';
    [['dark', '다크'], ['light', '라이트']].forEach(function (pair) {
      var c = document.createElement('button');
      c.className = 'tchip' + (s.themeMode === pair[0] ? ' selected' : '');
      c.textContent = pair[1];
      c.addEventListener('click', function () {
        s.themeMode = pair[0];
        lsSet('settings', s);
        applyTheme();
        renderPanel('settings');
        reloadStartTabs();
      });
      modeChips.appendChild(c);
    });
    modeRow.appendChild(modeChips);

    var accentRow = row(gTheme, '포인트 컬러', '기본 흑백 외 커스텀 포인트 컬러.');
    var accentWrap = document.createElement('div');
    accentWrap.className = 'set-control';
    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'color-input';
    colorInput.value = s.accent || '#09090b';
    colorInput.addEventListener('change', function () {
      s.accent = colorInput.value;
      lsSet('settings', s);
      applyTheme();
    });
    var accentReset = document.createElement('button');
    accentReset.className = 'btn ghost';
    accentReset.textContent = '해제';
    accentReset.addEventListener('click', function () {
      s.accent = '';
      lsSet('settings', s);
      applyTheme();
      renderPanel('settings');
    });
    accentWrap.appendChild(colorInput);
    accentWrap.appendChild(accentReset);
    accentRow.appendChild(accentWrap);

    var gBrowse = group();

    var engineRow = row(gBrowse, '검색엔진', '옴니박스 기본 검색엔진.');
    var engineSelect = document.createElement('select');
    engineSelect.className = 'set-input';
    [['google', 'Google'], ['naver', 'Naver'], ['duckduckgo', 'DuckDuckGo']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      if (s.searchEngine === pair[0]) opt.selected = true;
      engineSelect.appendChild(opt);
    });
    engineSelect.addEventListener('change', function () {
      s.searchEngine = engineSelect.value;
      lsSet('settings', s);
    });
    var engineCtrl = document.createElement('div');
    engineCtrl.className = 'set-control';
    engineCtrl.style.width = '130px';
    engineCtrl.appendChild(engineSelect);
    engineRow.appendChild(engineCtrl);

    var nameRow = row(gBrowse, '사용자 이름', '시작 페이지 인사말에 사용됩니다.');
    var nameInput = document.createElement('input');
    nameInput.className = 'set-input';
    nameInput.value = s.userName || '';
    nameInput.placeholder = '예: 민중';
    nameInput.addEventListener('change', function () {
      s.userName = nameInput.value.trim();
      lsSet('settings', s);
      reloadStartTabs();
    });
    nameRow.classList.add('column');
    nameRow.appendChild(nameInput);

    var bgRow = row(gBrowse, '시작 페이지 배경', '커스텀 배경 이미지를 지정합니다.');
    var bgCtrl = document.createElement('div');
    bgCtrl.className = 'set-control';
    var bgPick = document.createElement('button');
    bgPick.className = 'btn ghost';
    bgPick.textContent = '이미지 선택';
    bgPick.addEventListener('click', function () {
      bridge.settings.pickBackground().then(function (p) {
        if (p) { showToast('배경 이미지를 적용했습니다.'); reloadStartTabs(); }
      });
    });
    var bgClear = document.createElement('button');
    bgClear.className = 'btn ghost';
    bgClear.textContent = '해제';
    bgClear.addEventListener('click', function () {
      bridge.settings.clearBackground().then(function () { reloadStartTabs(); });
    });
    bgCtrl.appendChild(bgPick);
    bgCtrl.appendChild(bgClear);
    bgRow.appendChild(bgCtrl);

    var gPrivacy = group();
    switchRow(gPrivacy, '클린 광고 차단', '광고와 트래커 도메인을 차단합니다.', ms.adblockEnabled !== false, function (next) {
      bridge.settings.set('adblockEnabled', next).then(function (updated) {
        state.mainSettings = updated;
      });
    });

    var gCity = group();
    var cityRow = row(gCity, '시작 페이지 도시', '날씨 위젯의 기준 도시.');
    var cityInput = document.createElement('input');
    cityInput.className = 'set-input';
    cityInput.value = ms.city || 'Seoul';
    cityInput.placeholder = '도시 영문명';
    var cityBtn = document.createElement('button');
    cityBtn.className = 'btn ghost';
    cityBtn.textContent = '적용';
    cityBtn.addEventListener('click', function () {
      bridge.net.geocode(cityInput.value.trim()).then(function (res) {
        if (res) {
          bridge.settings.set('city', cityInput.value.trim());
          bridge.settings.set('cityLat', res.lat);
          bridge.settings.set('cityLon', res.lon).then(function () {
            showToast('도시를 ' + res.name + ' 로 설정했습니다.');
            reloadStartTabs();
          });
        } else {
          showToast('도시를 찾을 수 없습니다.');
        }
      });
    });
    cityRow.classList.add('column');
    var cityWrap = document.createElement('div');
    cityWrap.className = 'set-control';
    cityWrap.style.display = 'flex';
    cityWrap.style.gap = '6px';
    cityWrap.appendChild(cityInput);
    cityWrap.appendChild(cityBtn);
    cityRow.appendChild(cityWrap);

    var gCreamy = group();
    var keyRow = row(gCreamy, 'Creamy API 키', 'OpenAI 호환 API 키를 등록하면 Creamy AI 정품 응답을 받습니다.');
    keyRow.classList.add('column');
    var keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'set-input';
    keyInput.value = ms.creamyApiKey || '';
    keyInput.placeholder = 'sk-...';
    keyInput.addEventListener('change', function () {
      bridge.settings.set('creamyApiKey', keyInput.value.trim()).then(function (u) { state.mainSettings = u; });
    });
    keyRow.appendChild(keyInput);

    var urlRow = row(gCreamy, 'API 주소', 'OpenAI 호환 베이스 URL.');
    urlRow.classList.add('column');
    var urlInput = document.createElement('input');
    urlInput.className = 'set-input';
    urlInput.value = ms.creamyBaseUrl || 'https://api.openai.com/v1';
    urlInput.addEventListener('change', function () {
      bridge.settings.set('creamyBaseUrl', urlInput.value.trim()).then(function (u) { state.mainSettings = u; });
    });
    urlRow.appendChild(urlInput);

    var modelRow = row(gCreamy, '모델', '사용할 모델 이름.');
    modelRow.classList.add('column');
    var modelInput = document.createElement('input');
    modelInput.className = 'set-input';
    modelInput.value = ms.creamyModel || 'gpt-4o-mini';
    modelInput.addEventListener('change', function () {
      bridge.settings.set('creamyModel', modelInput.value.trim()).then(function (u) { state.mainSettings = u; });
    });
    modelRow.appendChild(modelInput);

    var gInfo = group();
    var infoRow = row(gInfo, '버전', 'Creamy Browser for Windows');
    bridge.app.version().then(function (v) {
      var ctrl = document.createElement('div');
      ctrl.className = 'set-control';
      ctrl.innerHTML = '<span class="li-badge">v' + v + '</span>';
      infoRow.appendChild(ctrl);
    });
  }

  /* ---------- Context menus ---------- */

  function showMenuAt(x, y, build) {
    var menu = $('#ctxmenu');
    menu.innerHTML = '';
    build(menu);
    menu.classList.remove('hidden');
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  }

  function hideMenus() {
    $('#ctxmenu').classList.add('hidden');
    $('#media-menu').classList.add('hidden');
  }

  function ctxItem(menu, label, handler, enabled) {
    var b = document.createElement('button');
    b.className = 'ctx-item';
    b.textContent = label;
    if (enabled === false) b.disabled = true;
    b.addEventListener('click', function () { hideMenus(); handler(); });
    menu.appendChild(b);
  }

  function ctxDivider(menu) {
    var d = document.createElement('div');
    d.className = 'ctx-divider';
    menu.appendChild(d);
  }

  function showTabMenu(e, tab) {
    showMenuAt(e.clientX, e.clientY, function (menu) {
      ctxItem(menu, '새로고침', function () { tab.webview.reload(); });
      ctxDivider(menu);
      ctxItem(menu, '탭 닫기', function () { closeTab(tab.id); });
      ctxItem(menu, '다른 탭 닫기', function () {
        state.tabs.slice().forEach(function (t) { if (t.id !== tab.id) closeTab(t.id); });
      });
      ctxDivider(menu);
      if (tab.groupId !== null) {
        ctxItem(menu, '그룹에서 해제', function () {
          tab.groupId = null;
          cleanupEmptyGroups();
          renderTabs();
          saveSession();
        });
        var groups = state.groups.filter(function (g) { return g.id !== tab.groupId; });
        if (groups.length > 0) {
          ctxItem(menu, '다른 그룹으로 이동', function () {
            showGroupPicker(e, groups, function (g) {
              tab.groupId = g.id;
              cleanupEmptyGroups();
              renderTabs();
              saveSession();
            });
          });
        }
      } else {
        ctxItem(menu, '새 그룹으로 묶기', function () {
          var group = { id: state.groupSeq, name: '그룹 ' + state.groupSeq, color: GROUP_COLORS[state.groupSeq % GROUP_COLORS.length], collapsed: false };
          state.groupSeq = state.groupSeq + 1;
          state.groups.push(group);
          tab.groupId = group.id;
          renderTabs();
          saveSession();
        });
      }
    });
  }

  function showGroupPicker(e, groups, onPick) {
    showMenuAt(e.clientX, e.clientY, function (menu) {
      groups.forEach(function (g) {
        ctxItem(menu, g.name, function () { onPick(g); });
      });
    });
  }

  function showGroupMenu(e, group) {
    showMenuAt(e.clientX, e.clientY, function (menu) {
      var colors = document.createElement('div');
      colors.className = 'ctx-colors';
      GROUP_COLORS.forEach(function (color) {
        var c = document.createElement('button');
        c.className = 'ctx-color' + (group.color === color ? ' selected' : '');
        c.style.background = color;
        c.addEventListener('click', function () {
          group.color = color;
          hideMenus();
          renderTabs();
          saveSession();
        });
        colors.appendChild(c);
      });
      menu.appendChild(colors);
      ctxDivider(menu);
      ctxItem(menu, '그룹 이름 변경', function () {
        var next = window.prompt('그룹 이름', group.name);
        if (next !== null && next.trim().length > 0) {
          group.name = next.trim();
          renderTabs();
          saveSession();
        }
      });
      ctxItem(menu, '그룹 해제', function () {
        state.tabs.forEach(function (t) { if (t.groupId === group.id) t.groupId = null; });
        state.groups = state.groups.filter(function (g) { return g.id !== group.id; });
        renderTabs();
        saveSession();
      });
      ctxItem(menu, '그룹 닫기', function () {
        state.tabs.slice().forEach(function (t) { if (t.groupId === group.id) closeTab(t.id); });
        state.groups = state.groups.filter(function (g) { return g.id !== group.id; });
        renderTabs();
        saveSession();
      });
    });
  }

  function cleanupEmptyGroups() {
    state.groups = state.groups.filter(function (g) {
      return state.tabs.some(function (t) { return t.groupId === g.id; });
    });
  }

  /* ---------- Toast ---------- */

  var toastTimer = null;

  function showToast(text) {
    var toast = $('#toast');
    toast.textContent = text;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 2600);
  }

  /* ---------- Wiring ---------- */

  function bindChrome() {
    bridge.win.onState(function (payload) {
      $('#btn-max').title = payload.maximized ? '복원' : '최대화';
    });
    $('#btn-min').addEventListener('click', function () { bridge.win.minimize(); });
    $('#btn-max').addEventListener('click', function () { bridge.win.maxToggle(); });
    $('#btn-close').addEventListener('click', function () { bridge.win.close(); });

    $('#btn-newtab').addEventListener('click', function () { createTab(startPageUrl()); });

    $('#nav-back').addEventListener('click', function () {
      var tab = activeTab();
      if (tab) {
        tab.webview.goBack();
      }
    });
    $('#nav-fwd').addEventListener('click', function () {
      var tab = activeTab();
      if (tab) tab.webview.goForward();
    });
    $('#nav-reload').addEventListener('click', function () {
      var tab = activeTab();
      if (tab) {
        if (tab.url === START_URL || tab.url.indexOf('start_page.html') !== -1) navigateTab(tab, startPageUrl());
        else tab.webview.reload();
      }
    });
    $('#nav-home').addEventListener('click', goHome);

    var omniInput = $('#omni-input');
    omniInput.addEventListener('focus', function () { omniInput.select(); });
    omniInput.addEventListener('input', onOmniInput);
    omniInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') navigateInput(omniInput.value);
      else if (e.key === 'Escape') { hideSuggest(); omniInput.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var items = document.querySelectorAll('#omni-suggest .suggest-item');
        if (items.length === 0) return;
        suggestSelected = suggestSelected + (e.key === 'ArrowDown' ? 1 : -1);
        if (suggestSelected < 0) suggestSelected = items.length - 1;
        if (suggestSelected >= items.length) suggestSelected = 0;
        items.forEach(function (el, i) { el.classList.toggle('selected', i === suggestSelected); });
      }
    });
    omniInput.addEventListener('blur', function () {
      setTimeout(hideSuggest, 180);
    });

    $('#btn-star').addEventListener('click', addBookmarkCurrent);
    $('#chip-translate').addEventListener('click', toggleTranslate);
    $('#chip-media').addEventListener('click', function (e) {
      var rect = e.currentTarget.getBoundingClientRect();
      showMediaMenu(rect.left, rect.bottom);
    });
    document.querySelectorAll('#media-menu button').forEach(function (btn) {
      btn.addEventListener('click', function () { startMediaDownload(btn.getAttribute('data-mode')); });
    });

    document.querySelectorAll('.rail-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePanel(btn.getAttribute('data-panel')); });
    });
    $('#sb-close').addEventListener('click', closePanel);

    document.addEventListener('click', function (e) {
      var menu = $('#ctxmenu');
      if (!menu.classList.contains('hidden') && !menu.contains(e.target)) hideMenus();
      var mm = $('#media-menu');
      if (!mm.classList.contains('hidden') && !mm.contains(e.target) && e.target.id !== 'chip-media') mm.classList.add('hidden');
    });

    document.addEventListener('keydown', function (e) {
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 't') { e.preventDefault(); createTab(startPageUrl()); }
      else if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTab()) closeTab(activeTab().id); }
      else if (ctrl && e.key === 'l') { e.preventDefault(); omniInput.focus(); }
      else if (ctrl && e.key === 'r') { e.preventDefault(); var t = activeTab(); if (t) t.webview.reload(); }
      else if (ctrl && e.key === 'd') { e.preventDefault(); addBookmarkCurrent(); }
      else if (ctrl && e.key === 'p') { e.preventDefault(); savePdf(); }
      else if (e.key === 'F5') { e.preventDefault(); var t2 = activeTab(); if (t2) t2.webview.reload(); }
      else if (e.key === 'F11') { e.preventDefault(); bridge.win.fullscreenToggle(); }
      else if (e.key === 'Escape') hideMenus();
      else if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        if (state.tabs.length > 1) {
          var index = state.tabs.indexOf(activeTab());
          var next = state.tabs[(index + 1) % state.tabs.length];
          activateTab(next.id);
        }
      }
    });

    bridge.bus.onOpenUrl(function (payload) {
      if (payload && payload.url) createTab(payload.url);
    });

    bridge.bus.onAction(function (payload) {
      if (!payload) return;
      if (payload.action === 'translate') toggleTranslate();
      else if (payload.action === 'pdf') savePdf();
      else if (payload.action === 'bag') addToBag();
      else if (payload.action === 'settings') openPanel('settings');
    });

    bridge.downloads.onUpdate(function (item) {
      state.downloads = state.downloads.filter(function (d) { return d.id !== item.id; });
      state.downloads.push(item);
      if (state.downloads.length > 50) state.downloads.shift();
      if (state.activePanel === 'downloads') renderPanel('downloads');
      if (item.state === 'completed') showToast('다운로드 완료: ' + item.filename);
      if (item.state === 'failed') showToast('다운로드 실패: ' + item.filename);
    });

    window.addEventListener('beforeunload', saveSession);
  }

  async function boot() {
    state.history = lsGet('history', []);
    state.bookmarks = lsGet('bookmarks', []);
    state.bag = lsGet('bag', []);
    state.mainSettings = await bridge.settings.get();
    applyTheme();
    restoreSession();
    bindChrome();
    updateToolbar();
  }

  boot();
})();
