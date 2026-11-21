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
    preloadPath: '',
    lock: { locked: false, enabled: false, hasPassword: false },
    sync: null,
    pass: {
      loaded: false, loading: false, view: 'loading', meta: null, key: null, items: [],
      msg: '', msgKind: '', formOpen: false, reveal: {}, confirmDelete: '', lockTimer: null
    },
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
    // 프리로드 경로는 부팅 때 메인 프로세스에서 받아 둔다. 아직 없으면 속성 없이 그대로 연다.
    var tabPreload = state.preloadPath || (bridge && bridge.env && bridge.env.preloadPath) || '';
    if (tabPreload) {
      webview.setAttribute('preload', tabPreload);
    }
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
        // dom-ready 이전에는 focus()가 예외를 던질 수 있다. 탭 전환은 계속 진행한다.
        try {
          tab.webview.focus();
        } catch (err) {
          console.warn('[creamy] webview focus를 건너뜁니다:', err && err.message ? err.message : err);
        }
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
    pill.setAttribute('data-group-id', String(group.id));
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
    Promise.resolve(bridgeCall('net', 'suggest', q) || []).then(function (remote) {
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
        var translated = await Promise.resolve(bridgeCall('translate', 'batch', slice, state.settings.translateTarget) || []);
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
      var result = await bridgeCall('page', 'savePdf', wcId);
      if (result && result.ok) showToast('PDF를 저장했습니다: ' + result.path);
      else if (result && !result.canceled) showToast('PDF 저장에 실패했습니다: ' + (result.error || ''));
    } catch (err) {
      showToast('PDF 저장에 실패했습니다: ' + (err.message || err));
    }
  }

  function printPage() {
    var tab = activeTab();
    if (!tab) return;
    safeRun('인쇄', function () {
      bridgeCall('page', 'print', tab.webview.getWebContentsId());
    });
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
    bridgeCall('media', 'download', tab.url, mode);
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
    if (name === 'pass' && state.pass.view !== 'open') {
      safeRun('금고 상태', function () { loadPassVault(true); });
    }
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
    pass: 'Lemon Pass',
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
    else if (name === 'pass') renderPassPanel(body);
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
        var res = await bridgeCall('net', 'creamy', {
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
    folderBtn.addEventListener('click', function () { bridgeCall('downloads', 'openFolder'); });
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
        openBtn.addEventListener('click', function () { bridgeCall('downloads', 'openFile', item.path); });
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
      winAction('fullscreenToggle');
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

  /* ---------- LK 계정 · Google Drive 동기화 ---------- */

  function syncApiGroup() { return bridgeGroup('sync', ['getState', 'run']); }

  function syncErrorText(code) {
    var map = {
      'sync-unavailable': '동기화 기능을 사용할 수 없습니다.',
      'not-linked': '먼저 LK 계정을 연결해 주세요.',
      'drive-missing': 'Google Drive 연결이 필요합니다.',
      'drive-expired': 'Google Drive 연결이 만료되었습니다. 계정을 다시 연결해 주세요.',
      'busy': '다른 동기화가 진행 중입니다. 잠시 뒤 다시 시도하세요.',
      'timeout': '연결 시간이 지났습니다. 계정 연결을 다시 눌러 주세요.',
      'network': '네트워크 오류로 Google Drive에 연결하지 못했습니다.',
      'forbidden': 'Google Drive 접근이 거부되었습니다. 계정을 다시 연결해 주세요.',
      'rate-limit': 'Google 요청이 잠시 제한되었습니다. 잠시 뒤 다시 시도하세요.',
      'folder-create-failed': 'Drive에 백업 폴더를 만들지 못했습니다.',
      'server-error': 'Google 서버가 잠시 응답하지 않습니다.',
      'open-failed': '브라우저를 열지 못했습니다. 기본 브라우저 설정을 확인해 주세요.',
      'bad-state': '연결 요청이 만료되었습니다. 계정 연결을 다시 눌러 주세요.'
    };
    if (!code) return '동기화를 마치지 못했습니다.';
    return map[code] || ('동기화를 마치지 못했습니다 (' + code + ').');
  }

  function syncTimeText(ts) {
    if (!ts) return '없음';
    try { return new Date(ts).toLocaleString('ko-KR'); } catch (err) { return '없음'; }
  }

  function syncApplySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    state.sync = snapshot;
    if (state.activePanel === 'settings') safeRun('설정 다시 그리기', function () { renderPanel('settings'); });
  }

  async function loadSyncState() {
    var api = bridgeGroup('sync', ['getState']);
    if (!api) {
      state.sync = {
        linked: false, lkUser: null, unavailable: true,
        drive: { connected: false, email: '', expired: false, expiresAt: 0 },
        passSyncEnabled: false, passVaultCount: 0, lastSyncAt: 0, lastSync: null, lastError: '', busy: false
      };
      return state.sync;
    }
    try {
      var s = await api.getState();
      if (s && typeof s === 'object') state.sync = s;
    } catch (err) {
      console.error('[creamy] sync.getState 실패:', err);
    }
    return state.sync;
  }

  function startSyncAuth(btn) {
    var api = bridgeGroup('sync', ['startAuth']);
    if (!api) { showToast(BRIDGE_GONE_TEXT); return; }
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '브라우저에서 연결 중'; }
    showToast('기본 브라우저에서 계정 연결을 마쳐 주세요.');
    api.startAuth().then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (res && res.ok) {
        state.sync = res.state || state.sync;
        showToast('LK 계정과 Google Drive를 연결했습니다.');
        safeRun('연결 후 동기화', function () {
          if (state.sync && state.sync.drive && state.sync.drive.connected) syncRunNow(null, { silent: false });
        });
      } else {
        showToast(syncErrorText(res && res.error));
      }
      safeRun('설정 다시 그리기', function () { renderPanel('settings'); });
    }, function (err) {
      console.error('[creamy] sync.startAuth 실패:', err);
      if (btn) { btn.disabled = false; btn.textContent = label; }
      showToast(BRIDGE_GONE_TEXT);
    });
  }

  function syncRunNow(btn, opts) {
    var api = bridgeGroup('sync', ['run']);
    if (!api) { showToast(BRIDGE_GONE_TEXT); return; }
    var options = opts || {};
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '동기화 중'; }
    var input = {
      bookmarks: state.bookmarks,
      history: state.history,
      passOnly: options.passOnly === true
    };
    api.run(input).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      var done = function () {
        loadSyncState().then(function () {
          if (!options.silent) safeRun('설정 다시 그리기', function () { renderPanel(state.activePanel || 'settings'); });
        });
      };
      if (!res || !res.ok) {
        if (!options.silent) showToast(syncErrorText(res && res.error));
        done();
        return;
      }
      if (!options.passOnly) {
        state.bookmarks = Array.isArray(res.bookmarks) ? res.bookmarks : state.bookmarks;
        state.history = Array.isArray(res.history) ? res.history : state.history;
        lsSet('bookmarks', state.bookmarks);
        lsSet('history', state.history);
      }
      if (res.passVault && state.pass.view !== 'open') {
        var meta = CreamyPassVault.parse(res.passVault);
        if (meta) {
          state.pass.meta = meta;
          state.pass.view = 'locked';
          state.pass.loaded = true;
        }
      }
      if (!options.silent) {
        var bits = [];
        if (!options.passOnly) {
          bits.push('북마크 ' + state.bookmarks.length + '개');
          bits.push('방문기록 ' + state.history.length + '개');
        }
        if (res.passAction && res.passAction !== 'off') bits.push('금고 ' + (res.passAction === 'pull' ? '가져옴' : (res.passAction === 'push' ? '올림' : '최신')));
        showToast('동기화 완료 · ' + (bits.length ? bits.join(' · ') : '변경 없음'));
      }
      done();
    }, function (err) {
      console.error('[creamy] sync.run 실패:', err);
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (!options.silent) showToast(BRIDGE_GONE_TEXT);
    });
  }

  function syncLogout() {
    var api = bridgeGroup('sync', ['logout']);
    if (!api) { showToast(BRIDGE_GONE_TEXT); return; }
    api.logout().then(function (res) {
      if (res && res.state) state.sync = res.state;
      showToast('LK 계정 연결을 해제했습니다. 이 기기의 데이터는 그대로 남습니다.');
      safeRun('설정 다시 그리기', function () { renderPanel('settings'); });
    }, function () { showToast(BRIDGE_GONE_TEXT); });
  }

  function syncSetPass(enabled) {
    var api = bridgeGroup('sync', ['setPassSync']);
    if (!api) { showToast(BRIDGE_GONE_TEXT); return; }
    api.setPassSync(enabled === true).then(function (res) {
      if (res && res.state) state.sync = res.state;
      showToast(enabled
        ? 'Lemon Pass 금고를 Drive 백업에 포함합니다.'
        : '금고 동기화를 껐습니다. 금고는 이 PC에만 남습니다.');
      safeRun('설정 다시 그리기', function () { renderPanel('settings'); });
      if (enabled) syncRunNow(null, { passOnly: true, silent: false });
    }, function () { showToast(BRIDGE_GONE_TEXT); });
  }

  /* ---------- Lemon Pass panel ---------- */

  function passApiGroup() { return bridgeGroup('pass', ['getVault', 'saveVault']); }

  function passCurrentHost() {
    var tab = activeTab();
    if (!tab || !tab.url || tab.url.indexOf('http') !== 0) return '';
    return CreamyPassVault.hostOf(tab.url);
  }

  async function loadPassVault(force) {
    var p = state.pass;
    if (p.loading) return;
    if (p.loaded && !force) return;
    p.loading = true;
    var api = passApiGroup();
    if (!api) {
      p.loading = false;
      p.loaded = true;
      p.view = 'setup';
      p.msg = BRIDGE_GONE_TEXT;
      p.msgKind = 'err';
      if (state.activePanel === 'pass') renderPanel('pass');
      return;
    }
    try {
      var res = await api.getVault();
      var meta = res && res.vault ? CreamyPassVault.parse(res.vault) : null;
      p.meta = meta || null;
      p.key = null;
      p.items = [];
      p.confirmDelete = '';
      p.formOpen = false;
      p.view = p.meta ? 'locked' : 'setup';
      p.loaded = true;
      p.msg = '';
    } catch (err) {
      console.error('[creamy] pass.getVault 실패:', err);
      p.loaded = true;
      p.view = 'setup';
      p.msg = '금고를 불러오지 못했습니다.';
      p.msgKind = 'err';
    }
    p.loading = false;
    if (state.activePanel === 'pass') renderPanel('pass');
  }

  function passTouch() {
    var p = state.pass;
    if (p.lockTimer) { clearTimeout(p.lockTimer); p.lockTimer = null; }
    p.lockTimer = setTimeout(function () {
      if (state.pass.view === 'open') passLock(true);
    }, 10 * 60 * 1000);
  }

  function passLock(silent) {
    var p = state.pass;
    p.key = null;
    p.items = [];
    p.formOpen = false;
    p.confirmDelete = '';
    p.view = p.meta ? 'locked' : 'setup';
    if (p.lockTimer) { clearTimeout(p.lockTimer); p.lockTimer = null; }
    if (!silent) showToast('금고를 잠갔습니다.');
    if (state.activePanel === 'pass') renderPanel('pass');
  }

  async function passCreate() {
    var p = state.pass;
    var pw = (document.querySelector('#passNew') || {}).value || '';
    var pw2 = (document.querySelector('#passNew2') || {}).value || '';
    var hint = (document.querySelector('#passHint') || {}).value || '';
    function fail(text) { p.msg = text; p.msgKind = 'err'; renderPanel('pass'); }
    if (!CreamyPassVault.subtleOK()) { fail('이 환경에서는 암호화를 쓸 수 없습니다.'); return; }
    if (pw.length < 8) { fail('마스터 비밀번호는 8자 이상으로 정하세요.'); return; }
    if (pw !== pw2) { fail('두 입력이 일치하지 않습니다.'); return; }
    var api = passApiGroup();
    if (!api) { fail(BRIDGE_GONE_TEXT); return; }
    try {
      var created = await CreamyPassVault.create(pw, hint);
      var res = await api.saveVault(JSON.stringify(created.meta));
      if (!res || !res.ok) { fail('금고를 저장하지 못했습니다.'); return; }
      p.meta = created.meta;
      p.key = created.key;
      p.items = [];
      p.view = 'open';
      p.msg = '';
      passTouch();
      showToast('금고를 만들었습니다.');
      renderPanel('pass');
    } catch (err) {
      console.error('[creamy] pass.create 실패:', err);
      fail('금고를 만들지 못했습니다.');
    }
  }

  async function passUnlock() {
    var p = state.pass;
    var input = document.querySelector('#passPw');
    var pw = (input && input.value) || '';
    function fail(text) { p.msg = text; p.msgKind = 'err'; renderPanel('pass'); }
    if (!pw) { fail('마스터 비밀번호를 입력하세요.'); return; }
    if (!p.meta) { fail('금고가 없습니다.'); return; }
    try {
      var opened = await CreamyPassVault.unlock(pw, p.meta);
      p.key = opened.key;
      p.items = opened.items;
      p.view = 'open';
      p.msg = '';
      passTouch();
      showToast('금고를 열었습니다.');
      renderPanel('pass');
    } catch (err) {
      fail('마스터 비밀번호가 맞지 않습니다.');
    }
  }

  async function passPersist() {
    var p = state.pass;
    if (!p.key || !p.meta) return false;
    var api = passApiGroup();
    if (!api) { showToast(BRIDGE_GONE_TEXT); return false; }
    try {
      var meta = await CreamyPassVault.seal(p.key, p.meta, p.items);
      var res = await api.saveVault(JSON.stringify(meta));
      if (!res || !res.ok) { showToast('금고를 저장하지 못했습니다.'); return false; }
      p.meta = meta;
      passTouch();
      if (state.sync && state.sync.passSyncEnabled) {
        safeRun('금고 동기화', function () { syncRunNow(null, { passOnly: true, silent: true }); });
      }
      return true;
    } catch (err) {
      console.error('[creamy] pass.saveVault 실패:', err);
      showToast('금고를 저장하지 못했습니다.');
      return false;
    }
  }

  async function passAddItem() {
    var p = state.pass;
    function val(id) { var el = document.querySelector(id); return el ? String(el.value || '').trim() : ''; }
    var site = val('#passSite');
    var url = val('#passUrl');
    var user = val('#passUser');
    var pass = val('#passPass');
    var memo = val('#passMemo');
    if (!site) { p.msg = '사이트 이름을 입력하세요.'; p.msgKind = 'err'; renderPanel('pass'); return; }
    if (!pass) { p.msg = '비밀번호를 입력하세요.'; p.msgKind = 'err'; renderPanel('pass'); return; }
    p.items.unshift({
      id: CreamyPassVault.itemId(),
      type: 'login',
      site: site,
      url: url,
      user: user,
      pass: pass,
      env: '',
      memo: memo,
      ts: Date.now(),
      upd: Date.now()
    });
    p.formOpen = false;
    p.msg = '';
    var ok = await passPersist();
    showToast(ok ? '항목을 암호화해 저장했습니다.' : '항목을 저장하지 못했습니다.');
    renderPanel('pass');
  }

  async function passDeleteItem(id) {
    var p = state.pass;
    p.items = p.items.filter(function (it) { return it.id !== id; });
    p.confirmDelete = '';
    var ok = await passPersist();
    showToast(ok ? '항목을 삭제했습니다.' : '삭제하지 못했습니다.');
    renderPanel('pass');
  }

  function passCopy(text, label) {
    if (!text) { showToast('복사할 값이 없습니다.'); return; }
    function done() { showToast(label + '를 복사했습니다.'); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        document.body.removeChild(ta);
        if (ok) done(); else showToast('복사하지 못했습니다.');
      } catch (err) { showToast('복사하지 못했습니다.'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function passFillScript(user, pass) {
    var payload = JSON.stringify({ user: String(user || ''), pass: String(pass || '') });
    return [
      '(function(){',
      '  var d = ' + payload + ';',
      '  function setNative(el, v){',
      '    if (!el) return false;',
      '    var desc = null;',
      '    try { desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value"); } catch (e) { desc = null; }',
      '    try { if (desc && desc.set) desc.set.call(el, v); else el.value = v; } catch (e) { try { el.value = v; } catch (e2) { } }',
      '    try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) { }',
      '    return true;',
      '  }',
      '  var pws = Array.prototype.slice.call(document.querySelectorAll("input[type=password]")).filter(function (el) { return el.offsetParent !== null && !el.disabled && !el.readOnly; });',
      '  var pw = pws[0] || document.querySelector("input[type=password]");',
      '  if (!pw) return { ok: false, reason: "no-password-field" };',
      '  var scope = pw.form || document;',
      '  var cands = Array.prototype.slice.call(scope.querySelectorAll("input[type=text],input[type=email],input[type=tel],input[name*=user i],input[name*=mail i],input[id*=user i],input[id*=mail i],input:not([type])"));',
      '  var uf = null;',
      '  for (var i = 0; i < cands.length; i++) {',
      '    var c = cands[i];',
      '    if (c === pw || c.offsetParent === null || c.disabled || c.readOnly) continue;',
      '    uf = c; break;',
      '  }',
      '  if (uf && d.user) setNative(uf, d.user);',
      '  setNative(pw, d.pass);',
      '  try { pw.focus(); } catch (e) { }',
      '  return { ok: true, user: !!uf };',
      '})()'
    ].join('\n');
  }

  async function passFillActive(item) {
    var tab = activeTab();
    if (!tab) { showToast('먼저 로그인할 탭을 열어 주세요.'); return; }
    try {
      var res = await tab.webview.executeJavaScript(passFillScript(item.user, item.pass), false);
      if (res && res.ok) showToast('현재 페이지의 로그인 칸을 채웠습니다.');
      else showToast('이 페이지에서 로그인 입력칸을 찾지 못했습니다.');
    } catch (err) {
      console.error('[creamy] pass 자동 입력 실패:', err);
      showToast('현재 페이지에 입력하지 못했습니다.');
    }
  }

  var PASS_KEY_SVG = '<svg viewBox="0 0 22 22" width="19" height="19"><circle cx="7.5" cy="11" r="3.6" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M11 11h7.5M16 11v3M18.5 11v2.2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';

  function passItemRow(it, host, reveal, confirmId) {
    var matched = host && CreamyPassVault.hostMatches(it.url, host);
    var sub = it.user || '아이디 없음';
    var pwText = reveal ? String(it.pass || '') : '••••••••';
    var id = escapeHtml(it.id);
    return '<div class="pass-item' + (matched ? ' matched' : '') + '" data-item="' + id + '">' +
      '<div class="pass-item-head">' +
        '<span class="pass-item-site">' + escapeHtml(it.site || '이름 없음') + '</span>' +
        (matched ? '<span class="pass-badge">현재 사이트</span>' : '') +
      '</div>' +
      '<div class="pass-item-sub">' + escapeHtml(sub) + '</div>' +
      '<div class="pass-item-pw">' + escapeHtml(pwText) + '</div>' +
      (it.memo ? '<div class="pass-item-memo">' + escapeHtml(it.memo) + '</div>' : '') +
      '<div class="pass-item-actions">' +
        '<button class="pass-mini" data-act="fill">자동 입력</button>' +
        '<button class="pass-mini" data-act="copy-user">아이디</button>' +
        '<button class="pass-mini" data-act="copy-pass">비밀번호</button>' +
        '<button class="pass-mini" data-act="reveal">' + (reveal ? '숨기기' : '보기') + '</button>' +
        (confirmId === it.id
          ? '<button class="pass-mini danger" data-act="delete-confirm">정말 삭제</button>' +
            '<button class="pass-mini" data-act="delete-cancel">취소</button>'
          : '<button class="pass-mini danger" data-act="delete">삭제</button>') +
      '</div>' +
    '</div>';
  }

  function renderPassPanel(body) {
    var p = state.pass;
    if (!p.loaded && !p.loading) {
      body.innerHTML = '<div class="empty-note">금고를 확인하는 중입니다.</div>';
      loadPassVault();
      return;
    }

    var host = passCurrentHost();
    var wrap = document.createElement('div');
    wrap.className = 'pass-wrap';

    var head = document.createElement('div');
    head.className = 'pass-head';
    head.innerHTML =
      '<span class="pass-head-icon">' + PASS_KEY_SVG + '</span>' +
      '<div class="pass-head-text">' +
        '<div class="pass-head-title">Lemon Pass</div>' +
        '<div class="pass-head-sub">' +
          (p.view === 'open'
            ? (p.items.length + '개 항목 · 이 PC에 암호화 저장')
            : (p.meta ? '잠김 · 마스터 비밀번호 필요' : '아직 만든 금고가 없습니다')) +
        '</div>' +
      '</div>' +
      (p.view === 'open' ? '<button class="btn ghost pass-head-btn" id="passLock">잠그기</button>' : '');
    wrap.appendChild(head);

    if (p.msg) {
      var m = document.createElement('div');
      m.className = 'pass-msg' + (p.msgKind === 'err' ? ' err' : '');
      m.textContent = p.msg;
      wrap.appendChild(m);
    }

    if (p.view === 'setup') {
      var setup = document.createElement('div');
      setup.className = 'set-inline';
      setup.innerHTML =
        '<div class="set-inline-title">금고를 처음 만듭니다</div>' +
        '<input class="set-input" id="passNew" type="password" autocomplete="new-password" placeholder="마스터 비밀번호 (8자 이상)">' +
        '<input class="set-input" id="passNew2" type="password" autocomplete="new-password" placeholder="같은 값 다시 입력">' +
        '<input class="set-input" id="passHint" type="text" maxlength="40" placeholder="힌트 (선택)">' +
        '<button class="btn" id="passCreate">금고 만들기</button>';
      wrap.appendChild(setup);
      var note = document.createElement('p');
      note.className = 'set-hint';
      note.textContent = 'pass.html과 같은 형식(PBKDF2 250,000회 · AES-256-GCM)으로 이 PC에만 암호화해 저장합니다. 마스터 비밀번호를 잊으면 되살릴 수 없습니다.';
      wrap.appendChild(note);
    } else if (p.view === 'locked') {
      var locked = document.createElement('div');
      locked.className = 'set-inline';
      locked.innerHTML =
        '<div class="set-inline-title">마스터 비밀번호로 금고를 엽니다</div>' +
        '<input class="set-input" id="passPw" type="password" autocomplete="current-password" placeholder="마스터 비밀번호">' +
        '<button class="btn" id="passOpen">금고 열기</button>';
      wrap.appendChild(locked);
      if (p.meta && p.meta.hint) {
        var hint = document.createElement('p');
        hint.className = 'set-hint';
        hint.textContent = '힌트: ' + p.meta.hint;
        wrap.appendChild(hint);
      }
      var lnote = document.createElement('p');
      lnote.className = 'set-hint';
      lnote.textContent = '금고는 암호문으로만 저장되어 있어 마스터 비밀번호 없이는 열 수 없습니다.';
      wrap.appendChild(lnote);
    } else {
      var bar = document.createElement('div');
      bar.className = 'panel-actions';
      var addBtn = document.createElement('button');
      addBtn.className = 'btn';
      addBtn.id = 'passAdd';
      addBtn.textContent = p.formOpen ? '닫기' : '새 항목';
      bar.appendChild(addBtn);
      var syncNow = document.createElement('button');
      syncNow.className = 'btn ghost';
      syncNow.id = 'passSyncNow';
      syncNow.textContent = state.sync && state.sync.drive && state.sync.drive.connected ? 'Drive 동기화' : 'Drive 미연결';
      syncNow.disabled = !(state.sync && state.sync.drive && state.sync.drive.connected);
      bar.appendChild(syncNow);
      wrap.appendChild(bar);

      if (p.formOpen) {
        var form = document.createElement('div');
        form.className = 'set-inline';
        form.innerHTML =
          '<div class="set-inline-title">새 항목</div>' +
          '<input class="set-input" id="passSite" type="text" placeholder="사이트 이름 (예: 네이버)">' +
          '<input class="set-input" id="passUrl" type="text" placeholder="주소 (예: naver.com)">' +
          '<input class="set-input" id="passUser" type="text" autocomplete="off" placeholder="아이디">' +
          '<input class="set-input" id="passPass" type="password" autocomplete="new-password" placeholder="비밀번호">' +
          '<input class="set-input" id="passMemo" type="text" maxlength="200" placeholder="메모 (선택)">' +
          '<div class="set-inline-actions"><button class="btn ghost" id="passCancel">취소</button><button class="btn" id="passSave">저장</button></div>';
        wrap.appendChild(form);
      }

      var list = p.items.slice().sort(function (a, b) {
        var am = host && CreamyPassVault.hostMatches(a.url, host) ? 1 : 0;
        var bm = host && CreamyPassVault.hostMatches(b.url, host) ? 1 : 0;
        if (am !== bm) return bm - am;
        return ((b.upd || b.ts) || 0) - ((a.upd || a.ts) || 0);
      });
      if (list.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'empty-note';
        empty.textContent = '저장된 항목이 없습니다. 새 항목을 눌러 첫 사이트를 저장하세요.';
        wrap.appendChild(empty);
      } else {
        var box = document.createElement('div');
        box.className = 'pass-list';
        box.innerHTML = list.map(function (it) {
          return passItemRow(it, host, p.reveal && p.reveal[it.id] === true, p.confirmDelete);
        }).join('');
        wrap.appendChild(box);

        box.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('[data-act]') : null;
          if (!btn) return;
          var row = btn.closest('.pass-item');
          var id = row ? row.getAttribute('data-item') : '';
          var item = p.items.filter(function (x) { return x.id === id; })[0];
          if (!item) return;
          var act = btn.getAttribute('data-act');
          passTouch();
          if (act === 'fill') { passFillActive(item); return; }
          if (act === 'copy-user') { passCopy(item.user, '아이디'); return; }
          if (act === 'copy-pass') { passCopy(item.pass, '비밀번호'); return; }
          if (act === 'reveal') {
            p.reveal = p.reveal || {};
            p.reveal[id] = !p.reveal[id];
            renderPanel('pass');
            return;
          }
          if (act === 'delete') { p.confirmDelete = id; renderPanel('pass'); return; }
          if (act === 'delete-cancel') { p.confirmDelete = ''; renderPanel('pass'); return; }
          if (act === 'delete-confirm') { passDeleteItem(id); return; }
        });
      }

      var footNote = document.createElement('p');
      footNote.className = 'set-hint';
      footNote.textContent = state.sync && state.sync.passSyncEnabled
        ? '금고 동기화가 켜져 있습니다. 저장하면 암호문 그대로 Drive 백업에도 반영됩니다.'
        : '금고는 이 PC에만 저장됩니다. 설정에서 Lemon Pass 비밀번호 동기화를 켜면 Drive 백업에도 포함됩니다.';
      wrap.appendChild(footNote);
    }

    body.appendChild(wrap);

    if ($('#passLock')) $('#passLock').addEventListener('click', function () { passLock(false); });
    if ($('#passCreate')) $('#passCreate').addEventListener('click', passCreate);
    if ($('#passNew2')) $('#passNew2').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); passCreate(); } });
    if ($('#passOpen')) $('#passOpen').addEventListener('click', passUnlock);
    if ($('#passPw')) $('#passPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); passUnlock(); } });
    if ($('#passAdd')) $('#passAdd').addEventListener('click', function () { state.pass.formOpen = !state.pass.formOpen; state.pass.msg = ''; renderPanel('pass'); });
    if ($('#passCancel')) $('#passCancel').addEventListener('click', function () { state.pass.formOpen = false; renderPanel('pass'); });
    if ($('#passSave')) $('#passSave').addEventListener('click', passAddItem);
    if ($('#passSyncNow')) $('#passSyncNow').addEventListener('click', function () { syncRunNow(this, { passOnly: true }); });
  }

  /* ---------- Settings panel ---------- */

  function applyTheme() {
    var themeClass = state.settings.themePreset + '-' + state.settings.themeMode;
    document.documentElement.setAttribute('data-theme', themeClass);
    document.body.setAttribute('data-theme', themeClass);
    if (state.settings.accent) {
      document.documentElement.style.setProperty('--accent', state.settings.accent);
      document.body.style.setProperty('--accent', state.settings.accent);
    } else {
      document.documentElement.style.removeProperty('--accent');
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
      Promise.resolve(bridgeCall('settings', 'pickBackground')).then(function (p) {
        if (p) { showToast('배경 이미지를 적용했습니다.'); reloadStartTabs(); }
      });
    });
    var bgClear = document.createElement('button');
    bgClear.className = 'btn ghost';
    bgClear.textContent = '해제';
    bgClear.addEventListener('click', function () {
      Promise.resolve(bridgeCall('settings', 'clearBackground')).then(function () { reloadStartTabs(); });
    });
    bgCtrl.appendChild(bgPick);
    bgCtrl.appendChild(bgClear);
    bgRow.appendChild(bgCtrl);

    var gPrivacy = group();
    switchRow(gPrivacy, '클린 광고 차단', '광고와 트래커 도메인을 차단합니다.', ms.adblockEnabled !== false, function (next) {
      Promise.resolve(bridgeCall('settings', 'set', 'adblockEnabled', next)).then(function (updated) {
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
      var geo = bridgeCall('net', 'geocode', cityInput.value.trim());
      if (!geo || typeof geo.then !== 'function') {
        showToast('이 환경에서는 도시를 변경할 수 없습니다.');
        return;
      }
      geo.then(function (res) {
        if (res) {
          bridgeCall('settings', 'set', 'city', cityInput.value.trim());
          bridgeCall('settings', 'set', 'cityLat', res.lat);
          Promise.resolve(bridgeCall('settings', 'set', 'cityLon', res.lon)).then(function () {
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
      Promise.resolve(bridgeCall('settings', 'set', 'creamyApiKey', keyInput.value.trim())).then(function (u) { state.mainSettings = u || state.mainSettings; });
    });
    keyRow.appendChild(keyInput);

    var urlRow = row(gCreamy, 'API 주소', 'OpenAI 호환 베이스 URL.');
    urlRow.classList.add('column');
    var urlInput = document.createElement('input');
    urlInput.className = 'set-input';
    urlInput.value = ms.creamyBaseUrl || 'https://api.openai.com/v1';
    urlInput.addEventListener('change', function () {
      Promise.resolve(bridgeCall('settings', 'set', 'creamyBaseUrl', urlInput.value.trim())).then(function (u) { state.mainSettings = u || state.mainSettings; });
    });
    urlRow.appendChild(urlInput);

    var modelRow = row(gCreamy, '모델', '사용할 모델 이름.');
    modelRow.classList.add('column');
    var modelInput = document.createElement('input');
    modelInput.className = 'set-input';
    modelInput.value = ms.creamyModel || 'gpt-4o-mini';
    modelInput.addEventListener('change', function () {
      Promise.resolve(bridgeCall('settings', 'set', 'creamyModel', modelInput.value.trim())).then(function (u) { state.mainSettings = u || state.mainSettings; });
    });
    modelRow.appendChild(modelInput);

    var gSync = group();
    var syncState = state.sync || {};
    var syncDrive = syncState.drive || {};
    var syncUser = syncState.lkUser || null;
    var syncLinked = !!syncUser;
    var syncConnected = syncDrive.connected === true;

    var lkRow = row(gSync, 'LK 계정', syncLinked
      ? (escapeHtml(syncUser.email || '연결됨') + (syncUser.name ? ' · ' + escapeHtml(syncUser.name) : ''))
      : 'LK 계정을 연결하면 북마크·방문 기록·Lemon Pass 금고를 다른 기기와 맞춥니다.');
    var lkCtrl = document.createElement('div');
    lkCtrl.className = 'set-control';
    var lkTag = document.createElement('span');
    lkTag.className = 'li-badge';
    lkTag.textContent = syncLinked ? '연결됨' : '연결 필요';
    lkCtrl.appendChild(lkTag);
    var lkBtn = document.createElement('button');
    lkBtn.className = 'btn ghost';
    lkBtn.id = 'syncAuthBtn';
    lkBtn.textContent = syncLinked ? '다시 연결' : '계정 연결';
    lkCtrl.appendChild(lkBtn);
    if (syncLinked) {
      var outBtn = document.createElement('button');
      outBtn.className = 'btn ghost';
      outBtn.id = 'syncLogoutBtn';
      outBtn.textContent = '로그아웃';
      lkCtrl.appendChild(outBtn);
    }
    lkRow.classList.add('column');
    lkRow.appendChild(lkCtrl);

    var driveRow = row(gSync, 'Google Drive', syncConnected
      ? ('연결됨' + (syncDrive.email ? ' · ' + escapeHtml(syncDrive.email) : '') + ' · Soft Hub Backup 폴더')
      : (syncDrive.expired
        ? '연결이 만료되었습니다. 계정을 다시 연결해 주세요.'
        : '계정 연결을 마치면 Google Drive도 함께 연결됩니다.'));
    driveRow.classList.add('column');
    var driveCtrl = document.createElement('div');
    driveCtrl.className = 'set-control';
    driveCtrl.style.gap = '6px';
    var driveTag = document.createElement('span');
    driveTag.className = 'li-badge';
    driveTag.textContent = syncConnected ? 'Drive 연결됨' : (syncDrive.expired ? 'Drive 만료' : 'Drive 미연결');
    driveCtrl.appendChild(driveTag);
    var runBtn = document.createElement('button');
    runBtn.className = 'btn ghost';
    runBtn.id = 'syncRunBtn';
    runBtn.textContent = syncState.busy ? '동기화 중' : '지금 동기화';
    runBtn.disabled = !syncConnected || !!syncState.busy;
    driveCtrl.appendChild(runBtn);
    driveRow.appendChild(driveCtrl);

    switchRow(gSync, 'Lemon Pass 비밀번호 동기화',
      '금고를 마스터 비밀번호로 암호화한 암호문 그대로 Drive 백업에 포함합니다. 기본은 꺼짐입니다.',
      syncState.passSyncEnabled === true,
      function (next) { syncSetPass(next); });

    var syncHint = document.createElement('div');
    syncHint.className = 'set-hint';
    var lastText = syncState.lastSyncAt ? ('마지막 동기화 ' + escapeHtml(syncTimeText(syncState.lastSyncAt))) : '아직 동기화한 적이 없습니다.';
    var errText = syncState.lastError ? '<br>' + escapeHtml(syncErrorText(syncState.lastError)) : '';
    syncHint.innerHTML = lastText + '<br>계정을 연결하면 브라우저를 열 때 한 번 조용히 맞춥니다. 토큰과 금고 암호문은 이 PC의 <b>creamy-sync.json</b>에만 저장됩니다.' + errText;
    gSync.appendChild(syncHint);

    if ($('#syncAuthBtn')) $('#syncAuthBtn').addEventListener('click', function () { startSyncAuth(this); });
    if ($('#syncLogoutBtn')) $('#syncLogoutBtn').addEventListener('click', syncLogout);
    if ($('#syncRunBtn')) $('#syncRunBtn').addEventListener('click', function () { syncRunNow(this); });

    var gLock = group();
    var lockInfo = state.lock || { enabled: false, hasPassword: false };
    var lockDesc = lockInfo.enabled
      ? '켜짐 · 앱을 열면 잠금 화면이 먼저 표시되고, 비밀번호를 넣어야 브라우저가 열립니다.'
      : (lockInfo.hasPassword
        ? '꺼짐 · 저장된 비밀번호는 그대로 유지됩니다.'
        : '꺼짐 · 비밀번호를 설정하면 앱을 열 때 잠금 화면이 먼저 표시됩니다.');
    var lockRow = row(gLock, '브라우저 잠금', lockDesc);
    var lockStateChip = document.createElement('span');
    lockStateChip.className = 'lock-state' + (lockInfo.enabled ? ' on' : '');
    lockStateChip.textContent = lockInfo.enabled ? '잠금 켜짐' : '잠금 꺼짐';
    var lockSwitch = document.createElement('button');
    lockSwitch.className = 'switch' + (lockInfo.enabled ? ' on' : '');
    lockSwitch.title = lockInfo.enabled ? '브라우저 잠금 끄기' : '브라우저 잠금 켜기';
    var lockCtrl = document.createElement('div');
    lockCtrl.className = 'set-control';
    lockCtrl.appendChild(lockStateChip);
    lockCtrl.appendChild(lockSwitch);
    lockRow.appendChild(lockCtrl);

    function lockField(placeholder, autocomplete) {
      var input = document.createElement('input');
      input.type = 'password';
      input.className = 'set-input';
      input.placeholder = placeholder;
      input.autocomplete = autocomplete || 'new-password';
      input.spellcheck = false;
      input.maxLength = 128;
      return input;
    }

    function lockFormBox(title, inputs, submitLabel, handler) {
      var box = document.createElement('div');
      box.className = 'set-inline';
      var t = document.createElement('div');
      t.className = 'set-inline-title';
      t.textContent = title;
      box.appendChild(t);
      inputs.forEach(function (el) { box.appendChild(el); });
      var msg = document.createElement('div');
      msg.className = 'set-inline-msg hidden';
      box.appendChild(msg);
      var actions = document.createElement('div');
      actions.className = 'set-inline-actions';
      var cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '취소';
      var submit = document.createElement('button');
      submit.className = 'btn';
      submit.textContent = submitLabel;
      actions.appendChild(cancel);
      actions.appendChild(submit);
      box.appendChild(actions);

      var ctx = {
        fail: function (text) {
          msg.textContent = text;
          msg.classList.remove('hidden');
        },
        busy: function (state) {
          submit.disabled = state;
          submit.textContent = state ? '처리 중' : submitLabel;
        },
        finish: function (res, okMessage) {
          ctx.busy(false);
          if (res && res.state) applyLockState(res.state);
          if (res && res.ok) {
            settingsLockForm = '';
            if (okMessage) showToast(okMessage);
            renderPanel('settings');
            return;
          }
          ctx.fail((res && res.error) || '요청을 처리하지 못했습니다. 다시 시도하세요.');
        }
      };

      cancel.addEventListener('click', function () {
        settingsLockForm = '';
        renderPanel('settings');
      });
      submit.addEventListener('click', function () {
        msg.classList.add('hidden');
        msg.textContent = '';
        handler(ctx);
      });
      inputs.forEach(function (el) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit.click();
          }
        });
        el.addEventListener('input', function () { msg.classList.add('hidden'); });
      });
      gLock.appendChild(box);
      setTimeout(function () {
        try { inputs[0].focus(); } catch (err) { /* ignore */ }
      }, 60);
    }

    if (!bridgeGroup('lock', ['enable', 'disable'])) {
      // Lock bridge unavailable: keep the section read-only.
      lockSwitch.disabled = true;
    }

    lockSwitch.addEventListener('click', function () {
      if (!bridge || !bridge.lock) return;
      if (lockInfo.enabled) {
        if (lockInfo.hasPassword) {
          settingsLockForm = 'disable';
          renderPanel('settings');
        } else {
          lockToggle(lockSwitch, 'disable', [''], '브라우저 잠금을 껐습니다.', '요청을 처리하지 못했습니다.');
        }
      } else if (lockInfo.hasPassword) {
        lockToggle(lockSwitch, 'enable', [], '브라우저 잠금을 켰습니다.', '요청을 처리하지 못했습니다.');
      } else {
        settingsLockForm = 'setup';
        renderPanel('settings');
      }
    });

    if (settingsLockForm === 'setup') {
      var setupNew = lockField('새 비밀번호 (4자 이상)');
      var setupConfirm = lockField('새 비밀번호 확인');
      lockFormBox('잠금에 사용할 비밀번호를 설정하고 잠금을 켭니다.', [setupNew, setupConfirm], '비밀번호 설정 및 잠금 켜기', function (ctx) {
        var next = setupNew.value;
        if (next.length < 4) { ctx.fail('비밀번호는 4자 이상이어야 합니다.'); return; }
        if (next !== setupConfirm.value) { ctx.fail('새 비밀번호가 서로 일치하지 않습니다.'); return; }
        lockSubmit(ctx, 'setPassword', ['', next], '브라우저 잠금을 켰습니다.');
      });
    } else if (settingsLockForm === 'change') {
      var changeCurrent = lockField('현재 비밀번호', 'current-password');
      var changeNew = lockField('새 비밀번호 (4자 이상)');
      var changeConfirm = lockField('새 비밀번호 확인');
      lockFormBox('현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다.', [changeCurrent, changeNew, changeConfirm], '비밀번호 변경', function (ctx) {
        if (!changeCurrent.value) { ctx.fail('현재 비밀번호를 입력하세요.'); return; }
        if (changeNew.value.length < 4) { ctx.fail('새 비밀번호는 4자 이상이어야 합니다.'); return; }
        if (changeNew.value !== changeConfirm.value) { ctx.fail('새 비밀번호가 서로 일치하지 않습니다.'); return; }
        if (changeNew.value === changeCurrent.value) { ctx.fail('현재 비밀번호와 다른 비밀번호를 입력하세요.'); return; }
        lockSubmit(ctx, 'setPassword', [changeCurrent.value, changeNew.value], '비밀번호를 변경했습니다.');
      });
    } else if (settingsLockForm === 'disable') {
      var disableCurrent = lockField('현재 비밀번호', 'current-password');
      lockFormBox('현재 비밀번호를 확인한 뒤 잠금을 끕니다. 저장된 비밀번호는 유지됩니다.', [disableCurrent], '잠금 끄기', function (ctx) {
        if (!disableCurrent.value) { ctx.fail('현재 비밀번호를 입력하세요.'); return; }
        lockSubmit(ctx, 'disable', [disableCurrent.value], '브라우저 잠금을 껐습니다.');
      });
    } else {
      var lockActions = document.createElement('div');
      lockActions.className = 'set-inline';
      var lockActionRow = document.createElement('div');
      lockActionRow.className = 'set-inline-actions';
      lockActionRow.style.justifyContent = 'flex-start';
      if (lockInfo.enabled) {
        var lockNowBtn = document.createElement('button');
        lockNowBtn.className = 'btn ghost';
        lockNowBtn.textContent = '지금 바로 잠그기';
        lockNowBtn.addEventListener('click', function () {
          var lock = bridgeGroup('lock', ['lockNow']);
          if (!lock) { showToast(BRIDGE_GONE_TEXT); return; }
          lockNowBtn.disabled = true;
          var pending = null;
          try {
            pending = lock.lockNow();
          } catch (err) {
            console.error('[creamy] lock.lockNow 호출 실패:', err);
            pending = null;
          }
          if (!pending || typeof pending.then !== 'function') {
            lockNowBtn.disabled = false;
            showToast(BRIDGE_GONE_TEXT);
            return;
          }
          pending.then(function (res) {
            if (res && res.ok) {
              saveSession();
              window.location.reload();
              return;
            }
            lockNowBtn.disabled = false;
            showToast((res && res.error) || '잠금을 실행하지 못했습니다.');
          }, function (err) {
            console.error('[creamy] lock.lockNow 실패:', err);
            lockNowBtn.disabled = false;
            showToast('잠금을 실행하지 못했습니다.');
          });
        });
        lockActionRow.appendChild(lockNowBtn);
      }
      var pwBtn = document.createElement('button');
      pwBtn.className = 'btn ghost';
      pwBtn.textContent = lockInfo.hasPassword ? '비밀번호 변경' : '비밀번호 설정';
      pwBtn.addEventListener('click', function () {
        settingsLockForm = lockInfo.hasPassword ? 'change' : 'setup';
        renderPanel('settings');
      });
      lockActionRow.appendChild(pwBtn);
      lockActions.appendChild(lockActionRow);
      gLock.appendChild(lockActions);
    }

    var lockHint = document.createElement('div');
    lockHint.className = 'set-hint';
    lockHint.innerHTML = '비밀번호는 scrypt 해시로 이 PC에만 저장됩니다. 잊으면 잠금을 해제할 수 없으니, ' +
      '사용자 데이터 폴더의 <b>creamy-lock.json</b> 파일을 삭제해 잠금 설정을 초기화하세요.';
    gLock.appendChild(lockHint);

    var gInfo = group();
    var infoRow = row(gInfo, '버전', 'Creamy Browser for Windows');
    var versionCall = bridgeCall('app', 'version');
    if (versionCall && typeof versionCall.then === 'function') {
      versionCall.then(function (v) {
        var ctrl = document.createElement('div');
        ctrl.className = 'set-control';
        ctrl.innerHTML = '<span class="li-badge">v' + v + '</span>';
        infoRow.appendChild(ctrl);
      });
    }
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
        startGroupRename(group);
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

  function startGroupRename(group) {
    var pills = document.querySelectorAll('#tabs .group-pill');
    var target = null;
    for (var i = 0; i < pills.length; i++) {
      if (pills[i].getAttribute('data-group-id') === String(group.id)) { target = pills[i]; break; }
    }
    if (!target) return;
    var input = document.createElement('input');
    input.className = 'group-rename';
    input.value = group.name;
    input.spellcheck = false;
    input.maxLength = 40;
    target.innerHTML = '';
    target.appendChild(input);
    try { input.focus(); input.select(); } catch (err) { /* ignore */ }
    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      var next = input.value.trim();
      if (save && next.length > 0) group.name = next;
      renderTabs();
      saveSession();
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', function () { commit(true); });
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

  /* ---------- Browser lock ---------- */

  var settingsLockForm = '';
  var browserStarted = false;
  var unlockBusy = false;

  function setLockError(text) {
    var box = $('#lock-error');
    if (!box) return;
    if (!text) {
      box.textContent = '';
      box.classList.add('hidden');
      return;
    }
    box.textContent = text;
    box.classList.remove('hidden');
  }

  function shakeLockCard() {
    var card = $('#lock-card');
    if (!card) return;
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }

  function applyLockState(next) {
    if (!next) return;
    state.lock = {
      locked: next.locked === true,
      enabled: next.enabled === true,
      hasPassword: next.hasPassword === true
    };
  }

  function showLockScreen() {
    state.lock.locked = true;
    document.body.classList.remove('boot-pending');
    document.body.classList.add('locked');
    var screen = $('#lock-screen');
    if (screen) screen.classList.remove('hidden');

    var input = $('#lock-input');
    var eye = $('#lock-eye');
    var form = $('#lock-form');
    var submit = $('#lock-submit');

    $('#lock-btn-min').addEventListener('click', function () { winAction('minimize'); });
    $('#lock-btn-close').addEventListener('click', function () { winAction('close', function () { window.close(); }); });

    eye.addEventListener('click', function () {
      var reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      $('#lock-eye-open').classList.toggle('hidden', reveal);
      $('#lock-eye-off').classList.toggle('hidden', !reveal);
      eye.title = reveal ? '비밀번호 숨기기' : '비밀번호 보기';
      eye.setAttribute('aria-label', eye.title);
      input.focus();
    });

    input.addEventListener('input', function () { setLockError(''); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      attemptUnlock();
    });

    setTimeout(function () {
      try { input.focus(); } catch (err) { /* ignore */ }
    }, 80);
  }

  async function attemptUnlock() {
    if (unlockBusy) return;
    var input = $('#lock-input');
    var submit = $('#lock-submit');
    var password = input.value;
    if (!password) {
      setLockError('비밀번호를 입력하세요.');
      shakeLockCard();
      return;
    }
    unlockBusy = true;
    submit.disabled = true;
    submit.textContent = '확인 중';
    var res = null;
    var lockApi = bridgeGroup('lock', ['unlock']);
    if (!lockApi) {
      unlockBusy = false;
      submit.disabled = false;
      submit.textContent = '잠금 해제';
      setLockError(BRIDGE_GONE_TEXT);
      return;
    }
    try {
      res = await lockApi.unlock(password);
    } catch (err) {
      res = { ok: false, error: '잠금 상태를 확인하지 못했습니다. 다시 시도하세요.' };
    }
    unlockBusy = false;
    submit.disabled = false;
    submit.textContent = '잠금 해제';
    if (res && res.ok) {
      applyLockState(res.state);
      state.lock.locked = false;
      input.value = '';
      setLockError('');
      document.body.classList.remove('locked');
      $('#lock-screen').classList.add('hidden');
      startBrowser();
      return;
    }
    input.value = '';
    setLockError((res && res.error) || '비밀번호가 올바르지 않습니다.');
    shakeLockCard();
    try { input.focus(); } catch (err) { /* ignore */ }
  }

  async function startBrowser() {
    if (browserStarted) return;
    browserStarted = true;
    document.body.classList.remove('boot-pending');
    document.body.classList.remove('locked');
    var screen = $('#lock-screen');
    if (screen) screen.classList.add('hidden');

    // 창이 열리자마자 닫기/최대화/사이드바/설정 등 모든 껍데기 버튼을 먼저 건다.
    // 복원이나 테마에서 무슨 일이 생겨도 버튼은 살아 있어야 한다.
    safeRun('브라우저 버튼', function () { bindChrome(); });
    safeRun('테마 적용', function () { applyTheme(); });

    // webview가 쓸 preload 경로를 먼저 받아 둔다. 샌드박스 프리로드는 이 값을 스스로 만들 수 없다.
    try {
      if (bridge && bridge.env && typeof bridge.env.getPreloadPath === 'function') {
        var preloadPath = await bridge.env.getPreloadPath();
        if (typeof preloadPath === 'string' && preloadPath) state.preloadPath = preloadPath;
      } else if (bridge && bridge.env && typeof bridge.env.preloadPath === 'string' && bridge.env.preloadPath) {
        state.preloadPath = bridge.env.preloadPath;
      }
    } catch (err) {
      console.error('Preload path error:', err);
    }

    try {
      if (bridge && bridge.settings && typeof bridge.settings.get === 'function') {
        state.mainSettings = (await bridge.settings.get()) || {};
      }
    } catch (err) {
      console.error('Settings get error:', err);
    }

    safeRun('테마 적용', function () { applyTheme(); });
    safeRun('세션 복원', function () { restoreSession(); });
    safeRun('툴바 갱신', function () { updateToolbar(); });

    // LK 계정 · Drive 상태는 화면이 뜬 뒤에 읽고, 연결돼 있으면 조용히 한 번 맞춘다.
    safeRun('동기화 구독', function () {
      if (bridge && bridge.sync && typeof bridge.sync.onUpdate === 'function') {
        bridge.sync.onUpdate(function (snapshot) { syncApplySnapshot(snapshot); });
      }
    });
    safeRun('동기화 상태', function () {
      loadSyncState().then(function () {
        if (state.sync && state.sync.linked && state.sync.drive && state.sync.drive.connected) {
          setTimeout(function () { syncRunNow(null, { silent: true }); }, 1200);
        }
      }, function () { /* ignore */ });
    });

    // 금고 메타는 미리 읽어 둔다(패널을 열 때 바로 상태를 보여 주기 위해).
    safeRun('금고 상태', function () { loadPassVault(false); });
  }

  /* ---------- Wiring ---------- */

  var chromeBound = false;

  // 어떤 오류가 나도 나머지 바인딩을 막지 않는다.
  function safeRun(label, fn) {
    try {
      return fn();
    } catch (err) {
      console.error('[creamy] ' + label + ' 바인딩 실패:', err);
      return null;
    }
  }

  // 프리로드 브리지가 없거나 일부 API가 빠져 있어도 화면이 죽지 않게 호출한다.
  function bridgeCall(group, name) {
    var args = Array.prototype.slice.call(arguments, 2);
    var svc = bridge ? bridge[group] : null;
    if (!svc || typeof svc[name] !== 'function') return null;
    try {
      return svc[name].apply(svc, args);
    } catch (err) {
      console.error('[creamy] ' + group + '.' + name + ' 호출 실패:', err);
      return null;
    }
  }

  function winApi() {
    return bridge && bridge.win ? bridge.win : null;
  }

  // 브리지가 없거나 일부 API가 빠져 있어도 화면이 '처리 중'에 멈추지 않게 쓴다.
  function bridgeGroup(group, names) {
    var svc = bridge ? bridge[group] : null;
    if (!svc) return null;
    var list = names || [];
    for (var i = 0; i < list.length; i++) {
      if (typeof svc[list[i]] !== 'function') return null;
    }
    return svc;
  }

  var BRIDGE_GONE_TEXT = '브라우저 연결을 사용할 수 없습니다.';

  // 잠금 폼 제출: 브리지 호출이 없거나 던져도 버튼이 '처리 중'으로 남지 않는다.
  function lockSubmit(ctx, method, args, okMessage) {
    function refuse() {
      if (ctx && ctx.busy) ctx.busy(false);
      if (ctx && ctx.fail) ctx.fail(BRIDGE_GONE_TEXT);
    }
    var lock = bridgeGroup('lock', [method]);
    if (!lock) { refuse(); return; }
    if (ctx && ctx.busy) ctx.busy(true);
    var pending = null;
    try {
      pending = lock[method].apply(lock, args || []);
    } catch (err) {
      console.error('[creamy] lock.' + method + ' 호출 실패:', err);
      pending = null;
    }
    if (!pending || typeof pending.then !== 'function') { refuse(); return; }
    pending.then(function (res) {
      if (ctx && ctx.finish) ctx.finish(res, okMessage);
    }, function (err) {
      console.error('[creamy] lock.' + method + ' 실패:', err);
      if (ctx && ctx.finish) ctx.finish(null);
    });
  }

  // 설정의 잠금 스위치: 실패해도 스위치가 꺼진 채로 남지 않는다.
  function lockToggle(button, method, args, okMessage, failMessage) {
    function refuse() {
      if (button) button.disabled = false;
      showToast(BRIDGE_GONE_TEXT);
    }
    var lock = bridgeGroup('lock', [method]);
    if (!lock) { refuse(); return; }
    if (button) button.disabled = true;
    var pending = null;
    try {
      pending = lock[method].apply(lock, args || []);
    } catch (err) {
      console.error('[creamy] lock.' + method + ' 호출 실패:', err);
      pending = null;
    }
    if (!pending || typeof pending.then !== 'function') { refuse(); return; }
    pending.then(function (res) {
      if (button) button.disabled = false;
      if (res && res.state) applyLockState(res.state);
      settingsLockForm = '';
      showToast((res && res.ok) ? okMessage : ((res && res.error) || failMessage));
      renderPanel('settings');
    }, function (err) {
      console.error('[creamy] lock.' + method + ' 실패:', err);
      if (button) button.disabled = false;
      showToast(failMessage);
    });
  }

  function winAction(action, fallback) {
    var api = winApi();
    var done = false;
    if (api && typeof api[action] === 'function') {
      try {
        api[action]();
        done = true;
      } catch (err) {
        console.error('[creamy] 창 제어 실패 (' + action + '):', err);
      }
    }
    if (!done && typeof fallback === 'function') {
      try { fallback(); } catch (err) { console.error('[creamy] 창 제어 대체 실패 (' + action + '):', err); }
    }
  }

  function onEl(sel, event, handler) {
    var el = document.querySelector(sel);
    if (!el) {
      console.error('[creamy] 요소를 찾지 못했습니다: ' + sel);
      return null;
    }
    el.addEventListener(event, handler);
    return el;
  }

  function onAll(sel, event, handler) {
    var list = document.querySelectorAll(sel);
    if (!list || list.length === 0) console.error('[creamy] 요소를 찾지 못했습니다: ' + sel);
    else list.forEach(function (el) { el.addEventListener(event, handler); });
    return list;
  }

  // 브라우저 껍데기 버튼은 창이 뜨는 즉시, 다른 어떤 초기화보다 먼저 건다.
  function bindChrome() {
    if (chromeBound) return;
    chromeBound = true;

    safeRun('창 제어 버튼', function () {
      onEl('#btn-min', 'click', function () { winAction('minimize'); });
      onEl('#btn-max', 'click', function () { winAction('maxToggle'); });
      onEl('#btn-close', 'click', function () { winAction('close', function () { window.close(); }); });
    });

    safeRun('창 상태 구독', function () {
      var api = winApi();
      if (api && typeof api.onState === 'function') {
        api.onState(function (payload) {
          var btn = document.querySelector('#btn-max');
          if (btn && payload) btn.title = payload.maximized ? '복원' : '최대화';
        });
      }
    });

    safeRun('새 탭 버튼', function () {
      onEl('#btn-newtab', 'click', function () { createTab(startPageUrl()); });
    });

    safeRun('탐색 버튼', function () {
      onEl('#nav-back', 'click', function () {
        var tab = activeTab();
        if (tab) safeRun('뒤로', function () { tab.webview.goBack(); });
      });
      onEl('#nav-fwd', 'click', function () {
        var tab = activeTab();
        if (tab) safeRun('앞으로', function () { tab.webview.goForward(); });
      });
      onEl('#nav-reload', 'click', function () {
        var tab = activeTab();
        if (!tab) return;
        safeRun('새로고침', function () {
          if (tab.url === START_URL || tab.url.indexOf('start_page.html') !== -1) navigateTab(tab, startPageUrl());
          else tab.webview.reload();
        });
      });
      onEl('#nav-home', 'click', function () { goHome(); });
    });

    safeRun('주소창', function () {
      var omniInput = document.querySelector('#omni-input');
      if (!omniInput) {
        console.error('[creamy] 요소를 찾지 못했습니다: #omni-input');
        return;
      }
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
    });

    safeRun('툴바 칩', function () {
      onEl('#btn-star', 'click', function () { addBookmarkCurrent(); });
      onEl('#chip-translate', 'click', function () { toggleTranslate(); });
      onEl('#chip-media', 'click', function (e) {
        var rect = e.currentTarget.getBoundingClientRect();
        showMediaMenu(rect.left, rect.bottom);
      });
      onAll('#media-menu button', 'click', function (e) {
        startMediaDownload(e.currentTarget.getAttribute('data-mode'));
      });
    });

    safeRun('사이드 패널', function () {
      onAll('.rail-btn', 'click', function (e) { togglePanel(e.currentTarget.getAttribute('data-panel')); });
      onEl('#sb-close', 'click', function () { closePanel(); });
    });

    safeRun('메뉴 닫기', function () {
      document.addEventListener('click', function (e) {
        var menu = document.querySelector('#ctxmenu');
        if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) hideMenus();
        var mm = document.querySelector('#media-menu');
        if (mm && !mm.classList.contains('hidden') && !mm.contains(e.target) && e.target.id !== 'chip-media') mm.classList.add('hidden');
      });
    });

    safeRun('단축키', function () {
      document.addEventListener('keydown', function (e) {
        var ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key === 't') { e.preventDefault(); createTab(startPageUrl()); }
        else if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTab()) closeTab(activeTab().id); }
        else if (ctrl && e.key === 'l') { e.preventDefault(); var omni = document.querySelector('#omni-input'); if (omni) omni.focus(); }
        else if (ctrl && e.key === 'r') { e.preventDefault(); var t = activeTab(); if (t) safeRun('새로고침', function () { t.webview.reload(); }); }
        else if (ctrl && e.key === 'd') { e.preventDefault(); addBookmarkCurrent(); }
        else if (ctrl && e.key === 'p') { e.preventDefault(); savePdf(); }
        else if (e.key === 'F5') { e.preventDefault(); var t2 = activeTab(); if (t2) safeRun('새로고침', function () { t2.webview.reload(); }); }
        else if (e.key === 'F11') { e.preventDefault(); winAction('fullscreenToggle'); }
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
    });

    safeRun('메인 프로세스 이벤트 구독', function () {
      if (bridge && bridge.bus && typeof bridge.bus.onOpenUrl === 'function') {
        bridge.bus.onOpenUrl(function (payload) {
          if (payload && payload.url) createTab(payload.url);
        });
      }
      if (bridge && bridge.bus && typeof bridge.bus.onAction === 'function') {
        bridge.bus.onAction(function (payload) {
          if (!payload) return;
          if (payload.action === 'translate') toggleTranslate();
          else if (payload.action === 'pdf') savePdf();
          else if (payload.action === 'bag') addToBag();
          else if (payload.action === 'settings') openPanel('settings');
        });
      }
    });

    safeRun('다운로드 구독', function () {
      if (!(bridge && bridge.downloads && typeof bridge.downloads.onUpdate === 'function')) return;
      bridge.downloads.onUpdate(function (item) {
        if (!item) return;
        state.downloads = state.downloads.filter(function (d) { return d.id !== item.id; });
        state.downloads.push(item);
        if (state.downloads.length > 50) state.downloads.shift();
        if (state.activePanel === 'downloads') renderPanel('downloads');
        if (item.state === 'completed') showToast('다운로드 완료: ' + item.filename);
        if (item.state === 'failed') showToast('다운로드 실패: ' + item.filename);
      });
    });

    safeRun('종료 시 세션 저장', function () {
      window.addEventListener('beforeunload', saveSession);
    });
  }

  async function boot() {
    // 부팅 도중 무엇이 실패하더라도 창 제어와 껍데기 버튼은 먼저 살려 둔다.
    safeRun('브라우저 버튼', function () { bindChrome(); });

    var savedSession = lsGet('session', null);
    if (savedSession && savedSession.settings) {
      state.settings = Object.assign(state.settings, savedSession.settings);
    }
    safeRun('테마 적용', function () { applyTheme(); });

    state.history = lsGet('history', []);
    state.bookmarks = lsGet('bookmarks', []);
    state.bag = lsGet('bag', []);

    var lockState = null;
    try {
      if (bridge && bridge.lock && bridge.lock.state) lockState = await bridge.lock.state();
    } catch (err) {
      console.error('Lock state error:', err);
    }
    applyLockState(lockState);

    if (state.lock.locked) {
      showLockScreen();
      return;
    }
    await startBrowser();
  }

  boot();
})();
