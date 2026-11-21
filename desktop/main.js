const { app, BrowserWindow, ipcMain, session, dialog, webContents, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
const { setupAdblock } = require('./adblock');
const { translateTexts } = require('./translate');
const { createSync } = require('./sync');

let mainWindow = null;
let shellContents = null;
let sync = null;
let pendingAuthUrl = '';

function userDataPath() {
  return app.getPath('userData');
}

function settingsFile() {
  return path.join(userDataPath(), 'creamy-settings.json');
}

let settings = {
  adblockEnabled: true,
  autoUpdateCheck: true,
  userName: '',
  city: 'Seoul',
  cityLat: 37.5665,
  cityLon: 126.978,
  startBackground: ''
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw);
    Object.keys(settings).forEach(function (k) {
      if (parsed[k] !== undefined) settings[k] = parsed[k];
    });
  } catch (err) { /* first run */ }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) { /* ignore */ }
}

/* ---------- Downloads ---------- */

/* Electron의 session.defaultSession 에는 getAllDownloads() 가 없고,
   DownloadItem 에도 getUniqueId() 가 없다. 다운로드 기록은 이 프로세스가
   직접 Map 으로 들고 있으면서 실제 DownloadItem API 만 사용한다. */

const downloadRegistry = new Map();
const DOWNLOAD_HISTORY_LIMIT = 100;
let downloadSeq = 0;

function nextDownloadId() {
  downloadSeq = downloadSeq + 1;
  return 'dl_' + Date.now().toString(36) + '_' + downloadSeq;
}

function safeRead(fn, fallback) {
  try {
    const value = fn();
    return value === undefined || value === null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function normalizeDownloadState(state) {
  if (state === 'completed') return 'completed';
  if (state === 'cancelled' || state === 'canceled') return 'canceled';
  if (state === 'interrupted') return 'interrupted';
  return 'progressing';
}

function downloadSnapshot(rec) {
  const item = rec.item;
  const live = !!item && rec.state === 'progressing';
  const total = live ? Number(safeRead(function () { return item.getTotalBytes(); }, rec.total)) || 0 : rec.total;
  const received = live ? Number(safeRead(function () { return item.getReceivedBytes(); }, rec.received)) || 0 : rec.received;
  const state = live ? normalizeDownloadState(safeRead(function () { return item.getState(); }, 'progressing')) : rec.state;
  const pathText = (live ? safeRead(function () { return item.getSavePath(); }, '') : '') || rec.path;
  const filename = (live ? safeRead(function () { return item.getFilename(); }, '') : '') || rec.filename;
  return {
    id: rec.id,
    kind: 'file',
    filename: filename,
    path: pathText,
    url: rec.url,
    total: total,
    received: received,
    state: state,
    startedAt: rec.startedAt
  };
}

function syncDownloadRecord(rec, forcedState) {
  const item = rec.item;
  if (item) {
    rec.total = Number(safeRead(function () { return item.getTotalBytes(); }, rec.total)) || 0;
    rec.received = Number(safeRead(function () { return item.getReceivedBytes(); }, rec.received)) || 0;
    rec.path = safeRead(function () { return item.getSavePath(); }, rec.path) || rec.path;
    rec.filename = safeRead(function () { return item.getFilename(); }, rec.filename) || rec.filename;
  }
  if (forcedState) {
    rec.state = normalizeDownloadState(forcedState);
  } else if (item) {
    rec.state = normalizeDownloadState(safeRead(function () { return item.getState(); }, rec.state));
  }
}

function broadcastDownload(rec) {
  sendToRenderer('dl:update', downloadSnapshot(rec));
}

function trimDownloadHistory() {
  if (downloadRegistry.size <= DOWNLOAD_HISTORY_LIMIT) return;
  const keys = Array.from(downloadRegistry.keys());
  for (let i = 0; i < keys.length && downloadRegistry.size > DOWNLOAD_HISTORY_LIMIT; i++) {
    const rec = downloadRegistry.get(keys[i]);
    if (rec && rec.state !== 'progressing') downloadRegistry.delete(keys[i]);
  }
}

function downloadStates() {
  return Array.from(downloadRegistry.values()).map(downloadSnapshot);
}

function findDownload(id) {
  if (id === undefined || id === null) return null;
  return downloadRegistry.get(String(id)) || null;
}

function registerDownloads() {
  const dl = session.defaultSession;
  dl.on('will-download', function (event, item) {
    const downloadPath = app.getPath('downloads');
    if (!item.getSavePath()) {
      const savePath = path.join(downloadPath, item.getFilename());
      let finalPath = savePath;
      let n = 1;
      const ext = path.extname(savePath);
      const stem = path.basename(savePath, ext);
      while (fs.existsSync(finalPath)) {
        finalPath = path.join(downloadPath, stem + ' (' + n + ')' + ext);
        n = n + 1;
      }
      item.setSavePath(finalPath);
    }
    const rec = {
      id: nextDownloadId(),
      item: item,
      filename: safeRead(function () { return item.getFilename(); }, ''),
      url: safeRead(function () { return item.getURL(); }, ''),
      path: safeRead(function () { return item.getSavePath(); }, ''),
      total: Number(safeRead(function () { return item.getTotalBytes(); }, 0)) || 0,
      received: 0,
      state: 'progressing',
      startedAt: Date.now()
    };
    downloadRegistry.set(rec.id, rec);
    trimDownloadHistory();
    broadcastDownload(rec);

    item.on('updated', function (e, state) {
      syncDownloadRecord(rec, state === 'interrupted' ? 'interrupted' : '');
      broadcastDownload(rec);
    });
    item.on('done', function (e, state) {
      syncDownloadRecord(rec, state);
      rec.item = null;
      broadcastDownload(rec);
    });
  });
}

/* ---------- Browser lock ---------- */

const LOCK_MIN_PASSWORD = 4;

let lockStore = { enabled: false, salt: '', hash: '', updatedAt: '' };
let isLocked = false;
let failedUnlocks = 0;

function lockFilePath() {
  return path.join(userDataPath(), 'creamy-lock.json');
}

function loadLockStore() {
  try {
    const raw = fs.readFileSync(lockFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    lockStore = {
      enabled: parsed.enabled === true,
      salt: typeof parsed.salt === 'string' ? parsed.salt : '',
      hash: typeof parsed.hash === 'string' ? parsed.hash : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
    };
  } catch (err) {
    lockStore = { enabled: false, salt: '', hash: '', updatedAt: '' };
  }
  if (!lockStore.salt || !lockStore.hash) lockStore.enabled = false;
  isLocked = !!(lockStore.enabled && lockStore.salt && lockStore.hash);
}

function saveLockStore() {
  try {
    fs.writeFileSync(lockFilePath(), JSON.stringify(lockStore, null, 2), { encoding: 'utf8', mode: 384 });
  } catch (err) { /* ignore */ }
}

function lockHasPassword() {
  return !!(lockStore.salt && lockStore.hash);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function passwordMatches(password) {
  if (!lockHasPassword()) return false;
  let trial = null;
  try {
    trial = crypto.scryptSync(String(password), lockStore.salt, 64);
  } catch (err) {
    return false;
  }
  let stored = null;
  try {
    stored = Buffer.from(lockStore.hash, 'hex');
  } catch (err) {
    return false;
  }
  if (!stored || stored.length !== trial.length) return false;
  try {
    return crypto.timingSafeEqual(trial, stored);
  } catch (err) {
    return false;
  }
}

function lockState() {
  return { locked: isLocked, enabled: lockStore.enabled === true, hasPassword: lockHasPassword() };
}

function passwordText(value) {
  return typeof value === 'string' ? value : '';
}

function unlockPenalty() {
  const delay = Math.min(250 + failedUnlocks * 250, 2500);
  return new Promise(function (resolve) { setTimeout(resolve, delay); });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function fetchBuffer(url, destPath, maxRedirects) {
  return new Promise(function (resolve, reject) {
    let redirects = maxRedirects || 5;
    function run(currentUrl) {
      const lib = currentUrl.indexOf('https://') === 0 ? https : http;
      const req = lib.get(currentUrl, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          redirects = redirects - 1;
          let next = res.headers.location;
          if (next.indexOf('https://') !== 0 && next.indexOf('http://') !== 0) {
            const base = new URL(currentUrl);
            next = base.protocol + '//' + base.host + next;
          }
          run(next);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          const buf = Buffer.concat(chunks);
          if (destPath) {
            fs.writeFileSync(destPath, buf);
          }
          resolve(buf);
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, function () { req.destroy(new Error('timeout')); });
    }
    run(url);
  });
}

function fetchText(url, headers) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { headers: headers || {} }, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body = body + c; });
      res.on('end', function () { resolve(body); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
  });
}

function postJson(url, data, headers) {
  return new Promise(function (resolve, reject) {
    const target = new URL(url);
    const payload = JSON.stringify(data);
    const options = {
      hostname: target.hostname,
      port: 443,
      path: target.pathname + target.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }, headers || {})
    };
    const req = https.request(options, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body = body + c; });
      res.on('end', function () {
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ' ' + body.slice(0, 300)));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, function () { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 980,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  shellContents = mainWindow.webContents;
  const shellWc = shellContents;

  mainWindow.webContents.on('before-input-event', function (event, input) {
    if (input.key === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('did-fail-load', function (event, errorCode, errorDescription, validatedURL) {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.on('maximize', function () { sendToRenderer('win:state', { maximized: true }); });
  mainWindow.on('unmaximize', function () { sendToRenderer('win:state', { maximized: false }); });
  mainWindow.on('closed', function () { mainWindow = null; if (shellContents === shellWc) shellContents = null; });
}

/* ---------- 웹사이트 팝업 창(window.open) ---------- */

/* 로그인·연동·결제는 window.opener / postMessage 로 결과를 돌려받는 팝업 창을 쓴다.
   이런 요청은 탭으로 보내면 opener 가 사라져 로그인이 끝나지 않으므로, 아래 조건에
   해당하면 진짜 Electron 팝업 창을 허용하고 나머지 새 창 요청만 탭으로 라우팅한다. */

const POPUP_DEFAULT_WIDTH = 520;
const POPUP_DEFAULT_HEIGHT = 680;
const POPUP_MIN_WIDTH = 320;
const POPUP_MIN_HEIGHT = 240;
const POPUP_MAX_WIDTH = 1600;
const POPUP_MAX_HEIGHT = 1200;

// 로그인·연동 팝업으로 흔히 쓰이는 URL. 새 창 요청이 이곳을 향하면 팝업 창으로 연다.
const POPUP_URL_PATTERNS = [
  /^about:blank/i,
  /\/\/accounts\.google\.com\//i,
  /\/\/accounts\.youtube\.com\//i,
  /\/\/appleid\.apple\.com\//i,
  /\/\/login\.microsoftonline\.com\//i,
  /\/\/login\.live\.com\//i,
  /\/\/kauth\.kakao\.com\//i,
  /\/\/nid\.naver\.com\//i,
  /\/dialog\/oauth/i,
  /\/oauth2?\/authorize/i
];

// window.open(url, 'oauthPopup') 처럼 팝업 의도가 드러난 창 이름.
const POPUP_FRAME_NAME = /^(popup|pop|oauth2?|auth|authorize|login|signin|sign-in|connect|share|dialog|picker|accounts?|_oauth)/i;

function parseWindowFeatures(features) {
  const out = { width: 0, height: 0, hasSize: false, wantsPopup: false };
  if (!features || typeof features !== 'string') return out;
  features.split(/[,\s]+/).forEach(function (token) {
    if (!token) return;
    const eq = token.indexOf('=');
    if (eq === -1) {
      if (/^popup$/i.test(token)) out.wantsPopup = true;
      return;
    }
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = parseInt(token.slice(eq + 1).trim(), 10);
    if (!isFinite(value)) return;
    if (key === 'width' || key === 'innerwidth' || key === 'outerwidth') {
      out.width = value;
      out.hasSize = true;
    } else if (key === 'height' || key === 'innerheight' || key === 'outerheight') {
      out.height = value;
      out.hasSize = true;
    }
  });
  return out;
}

function clampPopupSize(value, min, max, fallback) {
  const num = Math.round(Number(value));
  if (!isFinite(num) || num <= 0) return fallback;
  return Math.min(max, Math.max(min, num));
}

function looksLikePopupUrl(url) {
  const target = String(url || '');
  return POPUP_URL_PATTERNS.some(function (re) { return re.test(target); });
}

function shouldOpenPopupWindow(details) {
  if (!details) return false;
  const features = parseWindowFeatures(details.features);
  if (details.disposition === 'new-window') return true;
  if (features.hasSize || features.wantsPopup) return true;
  if (looksLikePopupUrl(details.url)) return true;
  const name = String(details.frameName || '');
  if (name && name !== '_blank' && name !== '_self' && POPUP_FRAME_NAME.test(name)) return true;
  return false;
}

function popupWindowOptions(details) {
  const features = parseWindowFeatures(details && details.features);
  const options = {
    width: clampPopupSize(features.width, POPUP_MIN_WIDTH, POPUP_MAX_WIDTH, POPUP_DEFAULT_WIDTH),
    height: clampPopupSize(features.height, POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT, POPUP_DEFAULT_HEIGHT),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    modal: false,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      plugins: false
    }
  };
  if (mainWindow && !mainWindow.isDestroyed()) options.parent = mainWindow;
  return options;
}

function windowOpenHandlerFor(wc) {
  return function (details) {
    try {
      if (shouldOpenPopupWindow(details)) {
        return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(details) };
      }
      sendToRenderer('cb:open-url', { url: details.url });
    } catch (err) {
      sendToRenderer('cb:open-url', { url: details && details.url });
    }
    return { action: 'deny' };
  };
}

function chromeUserAgent() {
  const raw = safeRead(function () { return session.defaultSession.getUserAgent(); }, '') || '';
  return raw.replace(/Electron\/[\d.]+\s*/i, '').replace(/creamy-browser\/[\d.]+\s*/i, '');
}

/* 웹뷰 탭과 팝업 창 모두에 같은 정책을 건다: Electron 토큰이 없는 Chrome UA,
   팝업/새 탭 라우팅, 컨텍스트 메뉴, 그리고 팝업 안에서 또 열리는 창까지 이어서 적용. */
function attachWindowPolicy(wc) {
  if (!wc || wc.__creamyWindowPolicy) return;
  wc.__creamyWindowPolicy = true;
  const ua = chromeUserAgent();
  if (ua && typeof wc.setUserAgent === 'function') {
    try { wc.setUserAgent(ua, 'ko-KR'); } catch (err) { /* ignore */ }
  }
  if (typeof wc.setWindowOpenHandler === 'function') {
    wc.setWindowOpenHandler(windowOpenHandlerFor(wc));
  }
  wc.on('context-menu', function (event, params) {
    event.preventDefault();
    buildContextMenu(wc, params);
  });
  wc.on('did-create-window', function (win) {
    if (win && win.webContents) attachWindowPolicy(win.webContents);
  });
}

function registerWebviewContents() {
  app.on('web-contents-created', function (event, wc) {
    const type = safeRead(function () { return wc.getType(); }, '');
    if (type === 'webview') {
      wc.setBackgroundThrottling(false);
      attachWindowPolicy(wc);
      return;
    }
    if (type === 'window') {
      /* 앱 UI 셸 창은 대상이 아니다. new BrowserWindow 직후에는 mainWindow 대입 전이라
         다음 틱에서 셸 여부를 확인한다(팝업 창은 이때 셸과 다른 webContents 다). */
      setImmediate(function () {
        if (wc === shellContents) return;
        if (safeRead(function () { return wc.isDestroyed(); }, false)) return;
        attachWindowPolicy(wc);
      });
    }
  });
}

function buildContextMenu(wc, params) {
  const items = [];
  if (params.linkURL) {
    items.push({
      label: '새 탭에서 링크 열기',
      click: function () { sendToRenderer('cb:open-url', { url: params.linkURL }); }
    });
    items.push({ type: 'separator' });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    items.push({
      label: '이미지 저장',
      click: function () {
        try { wc.downloadURL(params.srcURL); } catch (err) { /* ignore */ }
      }
    });
  }
  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    items.push({
      label: params.mediaType === 'video' ? '동영상 저장' : '음원 저장',
      click: function () { startMediaDownload(params.srcURL, params.mediaType === 'video' ? 'video' : 'audio'); }
    });
  }
  if (params.mediaType === 'none' || !params.mediaType) {
    items.push({
      label: '페이지 번역',
      click: function () { sendToRenderer('cb:action', { action: 'translate', webContentsId: wc.getId() }); }
    });
    items.push({
      label: 'PDF로 저장',
      click: function () { sendToRenderer('cb:action', { action: 'pdf', webContentsId: wc.getId() }); }
    });
    items.push({
      label: 'My Bag에 보관',
      click: function () { sendToRenderer('cb:action', { action: 'bag', webContentsId: wc.getId() }); }
    });
    items.push({ type: 'separator' });
    items.push({
      label: '뒤로',
      enabled: wc.navigationHistory.canGoBack(),
      click: function () { wc.goBack(); }
    });
    items.push({
      label: '앞으로',
      enabled: wc.navigationHistory.canGoForward(),
      click: function () { wc.goForward(); }
    });
    items.push({
      label: '새로고침',
      click: function () { wc.reload(); }
    });
  }
  if (params.editable) {
    items.push({ type: 'separator' });
    items.push({ label: '잘라내기', role: 'cut', enabled: params.editFlags.canCut });
    items.push({ label: '복사', role: 'copy', enabled: params.editFlags.canCopy });
    items.push({ label: '붙여넣기', role: 'paste', enabled: params.editFlags.canPaste });
    items.push({ label: '모두 선택', role: 'selectAll' });
  } else if (params.selectionText && params.selectionText.length > 0) {
    items.push({ type: 'separator' });
    items.push({ label: '복사', role: 'copy' });
  }
  if (items.length === 0) return;
  const ownerWindow = safeRead(function () { return BrowserWindow.fromWebContents(wc); }, null) || mainWindow;
  Menu.buildFromTemplate(items).popup({ window: ownerWindow || undefined });
}

/* ---------- GitHub Releases 자동 업데이트 ---------- */

const UPDATE_REPO = 'helpaboutflux-cpu/cream-ai-hub-android';
const UPDATE_API_BASE = (process.env.CREAMY_UPDATE_API_BASE || 'https://api.github.com').replace(/\/$/, '');
const UPDATE_ASSET_SETUP = 'creamy-browser-setup.exe';
const UPDATE_ASSET_PORTABLE = 'creamy-browser-portable.exe';
const UPDATE_AUTO_DELAY = 4000;

let updateState = {
  status: 'idle',
  currentVersion: '',
  latestVersion: '',
  tag: '',
  releaseName: '',
  releaseUrl: '',
  publishedAt: '',
  assetName: '',
  assetSize: 0,
  assetUrl: '',
  assetSha256: '',
  portable: false,
  received: 0,
  percent: 0,
  error: '',
  manual: false,
  downloadedPath: '',
  updatedAt: 0
};

let updateCheckPromise = null;
let updateDownloadPromise = null;

function versionParts(raw) {
  const match = String(raw || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function isPortableBuild() {
  const portablePath = process.env.PORTABLE_EXECUTABLE_FILE;
  return !!(portablePath && safeRead(function () { return fs.existsSync(portablePath); }, false));
}

function patchUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch || {}, { updatedAt: Date.now() });
  sendToRenderer('update:state', updateState);
  return updateState;
}

function fetchJson(url, headers) {
  return new Promise(function (resolve, reject) {
    let target = null;
    try { target = new URL(url); } catch (err) { reject(new Error('bad-url')); return; }
    const lib = target.protocol === 'http:' ? http : https;
    const options = {
      headers: Object.assign({
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'CreamyBrowser/' + app.getVersion()
      }, headers || {})
    };
    const req = lib.get(target, options, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, target).toString();
        fetchJson(next, headers).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body = body + chunk; });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (err) { reject(new Error('invalid-json')); }
      });
    });
    req.on('error', function (err) { reject(err); });
    req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
  });
}

function checkForUpdate(options) {
  const manual = !!(options && options.manual);
  if (updateCheckPromise) return updateCheckPromise;
  const current = app.getVersion();
  patchUpdateState({
    status: 'checking',
    error: '',
    manual: manual,
    currentVersion: current,
    received: 0,
    percent: 0,
    downloadedPath: ''
  });
  const url = UPDATE_API_BASE + '/repos/' + UPDATE_REPO + '/releases/latest';
  updateCheckPromise = fetchJson(url).then(function (release) {
    const tag = String((release && release.tag_name) || '');
    const latest = tag.replace(/^creamy-/i, '').replace(/^v/i, '');
    const assets = Array.isArray(release && release.assets) ? release.assets : [];
    const portable = isPortableBuild();
    const wanted = portable ? UPDATE_ASSET_PORTABLE : UPDATE_ASSET_SETUP;
    let asset = null;
    for (let i = 0; i < assets.length; i++) {
      if (assets[i] && assets[i].name === wanted) { asset = assets[i]; break; }
    }
    if (!asset) {
      for (let i = 0; i < assets.length; i++) {
        if (assets[i] && assets[i].name === UPDATE_ASSET_SETUP) { asset = assets[i]; break; }
      }
    }
    const digest = asset && typeof asset.digest === 'string' ? asset.digest : '';
    const base = {
      currentVersion: current,
      latestVersion: latest,
      tag: tag,
      releaseName: (release && release.name) || '',
      releaseUrl: (release && release.html_url) || '',
      publishedAt: (release && release.published_at) || '',
      assetName: asset ? asset.name : wanted,
      assetSize: asset ? Number(asset.size) || 0 : 0,
      assetUrl: asset ? String(asset.browser_download_url || asset.url || '') : '',
      assetSha256: digest.indexOf('sha256:') === 0 ? digest.slice(7).toLowerCase() : '',
      portable: portable
    };
    if (latest && isNewerVersion(latest, current)) {
      return patchUpdateState(Object.assign({ status: 'available', error: '' }, base));
    }
    return patchUpdateState(Object.assign({ status: 'current', error: '' }, base));
  }).catch(function (err) {
    return patchUpdateState({
      status: 'error',
      error: (err && err.message) || 'check-failed',
      currentVersion: current
    });
  }).then(function (result) {
    updateCheckPromise = null;
    return result;
  });
  return updateCheckPromise;
}

function downloadUpdateAsset(url, destPath, onProgress) {
  return new Promise(function (resolve, reject) {
    let redirects = 5;
    let finished = false;
    const partPath = destPath + '.part';

    function fail(err) {
      if (finished) return;
      finished = true;
      try { fs.unlinkSync(partPath); } catch (e) { /* ignore */ }
      reject(err);
    }

    function run(currentUrl) {
      let target = null;
      try { target = new URL(currentUrl); } catch (err) { fail(new Error('bad-url')); return; }
      const lib = target.protocol === 'http:' ? http : https;
      const req = lib.get(target, {
        headers: { 'User-Agent': 'CreamyBrowser/' + app.getVersion() }
      }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          redirects = redirects - 1;
          run(new URL(res.headers.location, target).toString());
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error('HTTP ' + res.statusCode));
          return;
        }
        const total = Number(res.headers['content-length'] || 0) || 0;
        const hash = crypto.createHash('sha256');
        let received = 0;
        const out = fs.createWriteStream(partPath);
        out.on('error', fail);
        res.on('data', function (chunk) {
          received = received + chunk.length;
          hash.update(chunk);
          out.write(chunk);
          if (onProgress) onProgress(received, total);
        });
        res.on('error', fail);
        res.on('end', function () {
          if (finished) return;
          out.end(function () {
            if (finished) return;
            const sha256 = hash.digest('hex');
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(partPath, destPath);
            } catch (err) { fail(err); return; }
            finished = true;
            resolve({ size: received, total: total, sha256: sha256 });
          });
        });
      });
      req.on('error', fail);
      req.setTimeout(180000, function () { req.destroy(new Error('timeout')); });
    }

    run(url);
  });
}

function installUpdate() {
  if (updateDownloadPromise) return updateDownloadPromise;
  if (updateState.status === 'downloaded') return Promise.resolve(launchUpdateInstaller());
  if (updateState.status !== 'available' || !updateState.assetUrl) {
    return Promise.resolve({ ok: false, error: updateState.status === 'available' ? 'asset-missing' : 'no-update' });
  }

  const version = String(updateState.latestVersion || 'latest').replace(/[^0-9A-Za-z._-]/g, '_');
  const dir = path.join(app.getPath('temp'), 'creamy-browser-update', version);
  const fileName = updateState.assetName || (isPortableBuild() ? UPDATE_ASSET_PORTABLE : UPDATE_ASSET_SETUP);
  const destPath = path.join(dir, fileName);
  let lastEmit = 0;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return Promise.resolve({ ok: false, error: 'temp-failed' });
  }

  patchUpdateState({ status: 'downloading', error: '', received: 0, percent: 0 });

  updateDownloadPromise = downloadUpdateAsset(updateState.assetUrl, destPath, function (received, total) {
    const now = Date.now();
    const size = total || updateState.assetSize || 0;
    const percent = size > 0 ? Math.min(100, Math.round((received / size) * 100)) : 0;
    if (now - lastEmit < 180 && percent < 100) return;
    lastEmit = now;
    patchUpdateState({ received: received, percent: percent });
  }).then(function (result) {
    if (updateState.assetSha256 && result.sha256 !== updateState.assetSha256) {
      try { fs.unlinkSync(destPath); } catch (err) { /* ignore */ }
      return patchUpdateState({ status: 'available', error: 'checksum-mismatch', received: 0, percent: 0 });
    }
    return patchUpdateState({
      status: 'downloaded',
      error: '',
      received: result.size,
      percent: 100,
      downloadedPath: destPath
    });
  }).catch(function (err) {
    return patchUpdateState({ status: 'available', error: (err && err.message) || 'download-failed', received: 0, percent: 0 });
  }).then(function (result) {
    updateDownloadPromise = null;
    return { ok: updateState.status === 'downloaded', error: updateState.error, state: updateState, result: result };
  });
  return updateDownloadPromise;
}

function launchUpdateInstaller() {
  const file = updateState.downloadedPath;
  if (!file || !safeRead(function () { return fs.existsSync(file); }, false)) {
    return { ok: false, error: 'missing-file' };
  }
  let child = null;
  let quitTimer = null;
  try {
    child = spawn(file, [], { detached: true, stdio: 'ignore' });
    if (child && typeof child.unref === 'function') child.unref();
  } catch (err) {
    return { ok: false, error: 'launch-failed' };
  }
  if (child && typeof child.on === 'function') {
    child.on('error', function (err) {
      if (quitTimer) { clearTimeout(quitTimer); quitTimer = null; }
      patchUpdateState({ status: 'downloaded', error: 'launch-failed' });
    });
  }
  patchUpdateState({ status: 'installing', error: '' });
  quitTimer = setTimeout(function () { app.quit(); }, 1500);
  return { ok: true, path: file };
}

function applyAdblock() {
  if (settings.adblockEnabled) {
    setupAdblock(session.defaultSession);
  } else {
    session.defaultSession.webRequest.onBeforeRequest(null);
  }
}

function ensureYtDlp() {
  const exePath = path.join(userDataPath(), 'yt-dlp.exe');
  if (fs.existsSync(exePath) && fs.statSync(exePath).size > 1000000) {
    return Promise.resolve(exePath);
  }
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  return fetchBuffer(url, exePath, 5).then(function () {
    return exePath;
  });
}

function startMediaDownload(url, mode) {
  const args = [];
  const outDir = app.getPath('downloads');
  const template = path.join(outDir, '%(title)s.%(ext)s');
  if (mode === 'audio') {
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio');
  } else {
    args.push('-f', 'b[ext=mp4][height<=1080]/b[ext=mp4]/b');
  }
  args.push('--newline', '--no-playlist', '-o', template, url);

  const mediaId = 'media-' + Date.now();
  sendToRenderer('dl:update', {
    id: mediaId,
    kind: 'media',
    mode: mode,
    url: url,
    filename: url,
    path: '',
    total: 0,
    received: 0,
    state: 'progressing'
  });

  ensureYtDlp().then(function (exePath) {
    return new Promise(function (resolve, reject) {
      let lastFile = '';
      const child = spawn(exePath, args, { windowsHide: true });
      child.stdout.on('data', function (chunk) {
        const lines = chunk.toString().split(/\r?\n/);
        lines.forEach(function (line) {
          const m = line.match(/\[download\]\s+([\d.]+)%/);
          if (m) {
            sendToRenderer('dl:update', {
              id: mediaId,
              kind: 'media',
              mode: mode,
              url: url,
              filename: lastFile || url,
              path: lastFile,
              total: 100,
              received: parseFloat(m[1]),
              state: 'progressing'
            });
          }
          const dest = line.match(/\[download\] Destination: (.+)/);
          if (dest) {
            lastFile = dest[1].trim();
          }
          const merged = line.match(/\[Merger\] (.+)/) || line.match(/has already been downloaded/);
          if (dest && merged) { lastFile = dest[1].trim(); }
        });
      });
      child.stderr.on('data', function (chunk) {
        const text = chunk.toString();
        const dest = text.match(/Destination: (.+)/);
        if (dest) { lastFile = dest[1].trim(); }
      });
      child.on('close', function (code) {
        if (code === 0) {
          sendToRenderer('dl:update', {
            id: mediaId,
            kind: 'media',
            mode: mode,
            url: url,
            filename: path.basename(lastFile),
            path: lastFile,
            total: 100,
            received: 100,
            state: 'completed'
          });
          resolve();
        } else {
          sendToRenderer('dl:update', {
            id: mediaId,
            kind: 'media',
            mode: mode,
            url: url,
            filename: url,
            path: '',
            total: 0,
            received: 0,
            state: 'failed'
          });
          reject(new Error('yt-dlp exited with code ' + code));
        }
      });
    });
  }).catch(function (err) {
    sendToRenderer('dl:update', {
      id: mediaId,
      kind: 'media',
      mode: mode,
      url: url,
      filename: url,
      path: '',
      total: 0,
      received: 0,
      state: 'failed'
    });
  });
}

function parseRssItems(xml, limit) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/).slice(1);
  blocks.forEach(function (block) {
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1];
    let link = (block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1];
    if (!link) {
      const anchor = block.match(/<a[^>]+href="([^"]+)"/);
      if (anchor) link = anchor[1];
    }
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    if (title) {
      items.push({
        title: title.trim(),
        link: link ? link.trim() : '',
        date: pub ? pub.trim() : ''
      });
    }
  });
  return items.slice(0, limit || 10);
}

function registerIpc() {
  initSync();

  // webview의 preload 속성에 쓸 경로. 샌드박스 프리로드는 __filename을 쓸 수 없어 여기서 넘긴다.
  ipcMain.handle('env:preload-path', function () {
    return path.join(__dirname, 'preload.js');
  });

  ipcMain.on('win:min', function () { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('win:max', function () {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('win:fullscreen', function () {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  ipcMain.on('win:close', function () { if (mainWindow) mainWindow.close(); });
  ipcMain.handle('win:is-max', function () {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.handle('lock:state', function () { return lockState(); });

  ipcMain.handle('lock:unlock', async function (event, password) {
    if (!isLocked) return { ok: true, state: lockState() };
    if (!lockStore.enabled || !lockHasPassword()) {
      isLocked = false;
      return { ok: true, state: lockState() };
    }
    await unlockPenalty();
    if (passwordMatches(passwordText(password))) {
      isLocked = false;
      failedUnlocks = 0;
      return { ok: true, state: lockState() };
    }
    failedUnlocks = failedUnlocks + 1;
    return { ok: false, error: '비밀번호가 올바르지 않습니다.', state: lockState() };
  });

  ipcMain.handle('lock:set-password', function (event, currentPassword, newPassword) {
    const next = passwordText(newPassword);
    if (next.length < LOCK_MIN_PASSWORD) {
      return { ok: false, error: '비밀번호는 ' + LOCK_MIN_PASSWORD + '자 이상이어야 합니다.', state: lockState() };
    }
    if (next.length > 128) {
      return { ok: false, error: '비밀번호는 128자까지 입력할 수 있습니다.', state: lockState() };
    }
    if (lockHasPassword() && !passwordMatches(passwordText(currentPassword))) {
      return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.', state: lockState() };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    lockStore.salt = salt;
    lockStore.hash = hashPassword(next, salt);
    lockStore.enabled = true;
    lockStore.updatedAt = new Date().toISOString();
    saveLockStore();
    failedUnlocks = 0;
    return { ok: true, state: lockState() };
  });

  ipcMain.handle('lock:enable', function () {
    if (!lockHasPassword()) {
      return { ok: false, error: '비밀번호를 먼저 설정하세요.', state: lockState() };
    }
    lockStore.enabled = true;
    lockStore.updatedAt = new Date().toISOString();
    saveLockStore();
    return { ok: true, state: lockState() };
  });

  ipcMain.handle('lock:disable', function (event, password) {
    if (lockHasPassword() && !passwordMatches(passwordText(password))) {
      return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.', state: lockState() };
    }
    lockStore.enabled = false;
    lockStore.updatedAt = new Date().toISOString();
    saveLockStore();
    isLocked = false;
    failedUnlocks = 0;
    return { ok: true, state: lockState() };
  });

  ipcMain.handle('lock:lock-now', function () {
    if (!lockStore.enabled || !lockHasPassword()) {
      return { ok: false, error: '브라우저 잠금이 설정되지 않았습니다.', state: lockState() };
    }
    isLocked = true;
    return { ok: true, state: lockState() };
  });

  /* ---------- LK 계정 · Google Drive 동기화 ---------- */

  function initSync() {
    sync = createSync({
      userDataPath: userDataPath,
      openExternal: function (url) { shell.openExternal(url); },
      openAuthUrl: function (url) {
        pendingAuthUrl = url;
        sendToRenderer('sync:auth-url', { url: url });
      },
      focusWindow: function () {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      },
      onUpdate: function (snapshot) { sendToRenderer('sync:updated', snapshot); },
      apiBase: process.env.CREAMY_DRIVE_API_BASE || undefined,
      authUrl: process.env.CREAMY_AUTH_URL || undefined,
      timeoutMs: process.env.CREAMY_AUTH_TIMEOUT_MS ? Number(process.env.CREAMY_AUTH_TIMEOUT_MS) : undefined
    });
    sync.load();
  }

  ipcMain.handle('sync:get-state', function () {
    if (!sync) {
      return {
        linked: false, lkUser: null,
        drive: { connected: false, wasConnected: false, expired: false, email: '', expiresAt: 0 },
        passSyncEnabled: false, passVaultCount: 0, lastSyncAt: 0, lastSync: null,
        lastError: 'sync-unavailable', busy: false, pendingAuth: false
      };
    }
    return sync.state();
  });

  ipcMain.handle('sync:start-auth', async function () {
    if (!sync) return { ok: false, error: 'sync-unavailable' };
    try {
      const result = await sync.startAuth();
      pendingAuthUrl = '';
      return result;
    } catch (err) {
      const code = (err && err.code) || 'start-failed';
      if (code !== 'busy') pendingAuthUrl = '';
      return { ok: false, error: code };
    }
  });

  ipcMain.handle('sync:cancel-auth', function () {
    if (!sync) return { ok: false, error: 'sync-unavailable' };
    return sync.cancelAuth();
  });

  ipcMain.handle('sync:get-auth-url', function () {
    return { url: pendingAuthUrl };
  });

  ipcMain.handle('sync:open-auth-external', function () {
    if (!pendingAuthUrl) return { ok: false, error: 'no-auth-url' };
    shell.openExternal(pendingAuthUrl);
    return { ok: true, url: pendingAuthUrl };
  });

  ipcMain.handle('sync:run', function (event, input) {
    if (!sync) return { ok: false, error: 'sync-unavailable' };
    return sync.run(input || {});
  });

  ipcMain.handle('sync:logout', function () {
    if (!sync) return { ok: false, error: 'sync-unavailable' };
    return sync.logout();
  });

  ipcMain.handle('sync:set-pass-sync', function (event, enabled) {
    if (!sync) return { ok: false, error: 'sync-unavailable' };
    return sync.setPassSync(enabled === true);
  });

  ipcMain.handle('pass:get-vault', function () {
    if (!sync) return { ok: false, error: 'sync-unavailable', vault: '', count: 0, updatedAt: 0, passSyncEnabled: false };
    return sync.getVault();
  });

  ipcMain.handle('pass:save-vault', function (event, raw) {
    if (!sync) return { ok: false, error: 'sync-unavailable' };
    return sync.saveVault(raw);
  });

  ipcMain.handle('settings:get', function () { return settings; });
  ipcMain.handle('settings:set', function (event, key, value) {
    settings[key] = value;
    saveSettings();
    if (key === 'adblockEnabled') applyAdblock();
    if (key === 'autoUpdateCheck' && value === true) checkForUpdate({ manual: false });
    return settings;
  });

  ipcMain.handle('settings:pick-background', async function () {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '배경 이미지 선택',
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return '';
    const src = result.filePaths[0];
    const bgDir = path.join(userDataPath(), 'backgrounds');
    if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
    const dest = path.join(bgDir, 'custom-background' + path.extname(src).toLowerCase());
    fs.copyFileSync(src, dest);
    settings.startBackground = dest;
    saveSettings();
    return dest;
  });
  ipcMain.handle('settings:clear-background', function () {
    settings.startBackground = '';
    saveSettings();
    return '';
  });

  ipcMain.handle('net:weather', async function (event, lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4';
    const body = await fetchText(url);
    return JSON.parse(body);
  });

  ipcMain.handle('net:geocode', async function (event, name) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=ko&name=' + encodeURIComponent(name);
    const body = await fetchText(url);
    const data = JSON.parse(body);
    if (data.results && data.results.length > 0) {
      return { lat: data.results[0].latitude, lon: data.results[0].longitude, name: data.results[0].name };
    }
    return null;
  });

  ipcMain.handle('net:geocode-list', async function (event, name) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?count=6&language=ko&format=json&name=' + encodeURIComponent(name);
    const body = await fetchText(url);
    const data = JSON.parse(body);
    const list = (data.results || []).map(function (r) {
      return {
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        region: [r.admin1, r.country].filter(Boolean).join(' · ')
      };
    });
    return list;
  });

  ipcMain.handle('net:rss', async function () {
    const body = await fetchText('https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko');
    return parseRssItems(body, 8);
  });

  ipcMain.handle('net:fx', async function () {
    const body = await fetchText('https://open.er-api.com/v6/latest/USD');
    const data = JSON.parse(body);
    const rates = data.rates || {};
    return {
      KRW: rates.KRW,
      JPY: rates.JPY,
      EUR: rates.EUR,
      updated: data.time_last_update_utc || ''
    };
  });

  ipcMain.handle('net:quotes', async function () {
    const url = 'https://stooq.com/q/l/?s=^ks11,^dji,^ixic,^spx&f=sd2t2c1p1&e=csv';
    const body = await fetchText(url);
    const lines = body.trim().split(/\r?\n/);
    const out = [];
    const names = { '^ks11': 'KOSPI', '^dji': 'DOW', '^ixic': 'NASDAQ', '^spx': 'S&P 500' };
    lines.slice(1).forEach(function (line) {
      const cols = line.split(',');
      if (cols.length >= 5 && cols[2]) {
        out.push({ symbol: cols[0], name: names[cols[0]] || cols[0], close: parseFloat(cols[2]) });
      }
    });
    return out;
  });

  ipcMain.handle('net:suggest', async function (event, q) {
    if (!q || q.trim().length === 0) return [];
    const url = 'https://suggestqueries.google.com/complete/search?client=firefox&q=' + encodeURIComponent(q);
    try {
      const body = await fetchText(url);
      const data = JSON.parse(body);
      return Array.isArray(data[1]) ? data[1].slice(0, 8) : [];
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('net:creamy', async function (event, payload) {
    const baseUrl = payload.baseUrl || 'https://api.openai.com/v1';
    const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'Authorization': 'Bearer ' + payload.apiKey };
    return postJson(endpoint, {
      model: payload.model || 'gpt-4o-mini',
      messages: payload.messages,
      temperature: 0.4
    }, headers);
  });

  ipcMain.handle('translate:batch', async function (event, texts, target) {
    return translateTexts(texts, target || 'ko');
  });

  ipcMain.handle('page:save-pdf', async function (event, webContentsId) {
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { ok: false, error: 'no webContents' };
    let title = 'page';
    try { title = wc.getTitle() || 'page'; } catch (err) { /* ignore */ }
    const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'page';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'PDF로 저장',
      defaultPath: path.join(app.getPath('downloads'), safe + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const pdfData = await wc.printToPDF({
      landscape: false,
      printHeader: false,
      printFooter: false,
      printBackground: true,
      pageSize: 'A4',
      scaleFactor: 1.58
    });
    fs.writeFileSync(result.filePath, pdfData);
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle('page:print', async function (event, webContentsId) {
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { ok: false };
    wc.print();
    return { ok: true };
  });

  ipcMain.handle('media:download', function (event, url, mode) {
    startMediaDownload(url, mode);
    return { started: true };
  });

  ipcMain.handle('media:check-url', function (event, url) {
    return /youtube\.com|youtu\.be/.test(url);
  });

  ipcMain.handle('dl:open-file', function (event, filePath) {
    if (filePath && fs.existsSync(filePath)) shell.openPath(filePath);
  });
  ipcMain.handle('dl:open-folder', function () {
    shell.openPath(app.getPath('downloads'));
  });
  ipcMain.handle('dl:cancel', function (event, id) {
    const rec = findDownload(id);
    if (!rec) return { ok: false, error: 'not-found' };
    if (rec.state !== 'progressing' || !rec.item) return { ok: false, error: 'not-running' };
    safeRead(function () { rec.item.cancel(); }, null);
    syncDownloadRecord(rec, 'cancelled');
    rec.item = null;
    broadcastDownload(rec);
    return { ok: true, item: downloadSnapshot(rec) };
  });
  ipcMain.handle('dl:open', function (event, id) {
    const rec = findDownload(id);
    if (!rec || !rec.path) return { ok: false, error: 'not-found' };
    if (!fs.existsSync(rec.path)) return { ok: false, error: 'missing-file' };
    shell.openPath(rec.path);
    return { ok: true };
  });
  ipcMain.handle('dl:show', function (event, id) {
    const rec = findDownload(id);
    if (!rec || !rec.path) return { ok: false, error: 'not-found' };
    if (!fs.existsSync(rec.path)) return { ok: false, error: 'missing-file' };
    shell.showItemInFolder(rec.path);
    return { ok: true };
  });
  ipcMain.handle('shell:external', function (event, url) {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:version', function () { return app.getVersion(); });
  ipcMain.handle('dl:list', function () { return downloadStates(); });

  ipcMain.handle('update:get-state', function () {
    return Object.assign({}, updateState, { currentVersion: app.getVersion() });
  });
  ipcMain.handle('update:check', function () { return checkForUpdate({ manual: true }); });
  ipcMain.handle('update:install', function () { return installUpdate(); });
  ipcMain.handle('update:launch', function () { return launchUpdateInstaller(); });
  ipcMain.handle('update:open-folder', function () {
    const file = updateState.downloadedPath;
    if (!file || !safeRead(function () { return fs.existsSync(file); }, false)) return { ok: false, error: 'missing-file' };
    shell.showItemInFolder(file);
    return { ok: true };
  });
  ipcMain.handle('update:open-release', function () {
    if (updateState.releaseUrl) shell.openExternal(updateState.releaseUrl);
    return { ok: true };
  });
}

app.whenReady().then(function () {
  loadSettings();
  loadLockStore();
  const ua = chromeUserAgent();
  if (ua) session.defaultSession.setUserAgent(ua, 'ko-KR');
  session.defaultSession.setPermissionRequestHandler(function (wc, permission, callback) {
    const allowed = ['media', 'audio', 'video', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen', 'pointerLock'];
    callback(allowed.indexOf(permission) !== -1);
  });

  registerWebviewContents();
  registerDownloads();
  registerIpc();
  applyAdblock();
  createWindow();

  if (settings.autoUpdateCheck !== false) {
    setTimeout(function () { checkForUpdate({ manual: false }); }, UPDATE_AUTO_DELAY);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});
