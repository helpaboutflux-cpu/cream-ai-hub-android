const { app, BrowserWindow, ipcMain, session, dialog, webContents, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
const { setupAdblock } = require('./adblock');
const { translateTexts } = require('./translate');

let mainWindow = null;

function userDataPath() {
  return app.getPath('userData');
}

function settingsFile() {
  return path.join(userDataPath(), 'creamy-settings.json');
}

let settings = {
  adblockEnabled: true,
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
  mainWindow.on('closed', function () { mainWindow = null; });
}

function registerWebviewContents() {
  app.on('web-contents-created', function (event, wc) {
    if (wc.getType() === 'webview') {
      wc.setBackgroundThrottling(false);
      wc.setWindowOpenHandler(function (details) {
        sendToRenderer('cb:open-url', { url: details.url });
        return { action: 'deny' };
      });
      wc.on('context-menu', function (event, params) {
        event.preventDefault();
        buildContextMenu(wc, params);
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
  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function downloadStates() {
  const list = [];
  session.defaultSession.getAllDownloads().forEach(function (item) {
    list.push(downloadStateOf(item));
  });
  return list;
}

function downloadStateOf(item) {
  return {
    id: item.getUniqueId(),
    filename: item.getFilename(),
    path: item.getSavePath(),
    url: item.getURL(),
    total: item.getTotalBytes(),
    received: item.getReceivedBytes(),
    state: item.getState(),
    kind: 'file'
  };
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
    item.on('updated', function (e, state) {
      sendToRenderer('dl:update', downloadStateOf(item));
    });
    item.on('done', function (e, state) {
      sendToRenderer('dl:update', downloadStateOf(item));
    });
  });
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

  ipcMain.handle('settings:get', function () { return settings; });
  ipcMain.handle('settings:set', function (event, key, value) {
    settings[key] = value;
    saveSettings();
    if (key === 'adblockEnabled') applyAdblock();
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
  ipcMain.handle('shell:external', function (event, url) {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:version', function () { return app.getVersion(); });
  ipcMain.handle('dl:list', function () { return downloadStates(); });
}

app.whenReady().then(function () {
  loadSettings();
  const ua = session.defaultSession.getUserAgent()
    .replace(/Electron\/[\d.]+\s*/i, '')
    .replace(/creamy-browser\/[\d.]+\s*/i, '');
  session.defaultSession.setUserAgent(ua, 'ko-KR');
  session.defaultSession.setPermissionRequestHandler(function (wc, permission, callback) {
    const allowed = ['media', 'audio', 'video', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen', 'pointerLock'];
    callback(allowed.indexOf(permission) !== -1);
  });

  registerWebviewContents();
  registerDownloads();
  registerIpc();
  applyAdblock();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});
