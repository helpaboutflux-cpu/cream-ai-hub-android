const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  ipcRenderer.on(channel, function (event, payload) { callback(payload); });
}

const fullBridge = {
  env: {
    // Electron 33 샌드박스 프리로드에는 Node 전용 전역(파일 경로·버퍼·프로세스)이 없다.
    // webview의 preload 속성에 쓸 로컬 경로는 메인 프로세스에서 받아온다.
    getPreloadPath: function () {
      try {
        return ipcRenderer.invoke('env:preload-path');
      } catch (err) {
        return Promise.resolve('');
      }
    }
  },
  win: {
    minimize: function () { ipcRenderer.send('win:min'); },
    maxToggle: function () { ipcRenderer.send('win:max'); },
    close: function () { ipcRenderer.send('win:close'); },
    fullscreenToggle: function () { ipcRenderer.send('win:fullscreen'); },
    isMaximized: function () { return ipcRenderer.invoke('win:is-max'); },
    onState: function (cb) { on('win:state', cb); }
  },
  settings: {
    get: function () { return ipcRenderer.invoke('settings:get'); },
    set: function (key, value) { return ipcRenderer.invoke('settings:set', key, value); },
    pickBackground: function () { return ipcRenderer.invoke('settings:pick-background'); },
    clearBackground: function () { return ipcRenderer.invoke('settings:clear-background'); }
  },
  lock: {
    state: function () { return ipcRenderer.invoke('lock:state'); },
    unlock: function (password) { return ipcRenderer.invoke('lock:unlock', password); },
    setPassword: function (currentPassword, newPassword) { return ipcRenderer.invoke('lock:set-password', currentPassword, newPassword); },
    enable: function () { return ipcRenderer.invoke('lock:enable'); },
    disable: function (password) { return ipcRenderer.invoke('lock:disable', password); },
    lockNow: function () { return ipcRenderer.invoke('lock:lock-now'); }
  },
  net: {
    weather: function (lat, lon) { return ipcRenderer.invoke('net:weather', lat, lon); },
    geocode: function (name) { return ipcRenderer.invoke('net:geocode', name); },
    geocodeList: function (name) { return ipcRenderer.invoke('net:geocode-list', name); },
    rss: function () { return ipcRenderer.invoke('net:rss'); },
    fx: function () { return ipcRenderer.invoke('net:fx'); },
    quotes: function () { return ipcRenderer.invoke('net:quotes'); },
    suggest: function (q) { return ipcRenderer.invoke('net:suggest', q); },
    creamy: function (payload) { return ipcRenderer.invoke('net:creamy', payload); }
  },
  translate: {
    batch: function (texts, target) { return ipcRenderer.invoke('translate:batch', texts, target); }
  },
  page: {
    savePdf: function (wcId) { return ipcRenderer.invoke('page:save-pdf', wcId); },
    print: function (wcId) { return ipcRenderer.invoke('page:print', wcId); }
  },
  media: {
    download: function (url, mode) { return ipcRenderer.invoke('media:download', url, mode); },
    checkUrl: function (url) { return ipcRenderer.invoke('media:check-url', url); }
  },
  downloads: {
    list: function () { return ipcRenderer.invoke('dl:list'); },
    cancel: function (id) { return ipcRenderer.invoke('dl:cancel', id); },
    open: function (id) { return ipcRenderer.invoke('dl:open', id); },
    show: function (id) { return ipcRenderer.invoke('dl:show', id); },
    openFile: function (p) { return ipcRenderer.invoke('dl:open-file', p); },
    openFolder: function () { return ipcRenderer.invoke('dl:open-folder'); },
    onUpdate: function (cb) { on('dl:update', cb); }
  },
  updates: {
    getState: function () { return ipcRenderer.invoke('update:get-state'); },
    check: function () { return ipcRenderer.invoke('update:check'); },
    install: function () { return ipcRenderer.invoke('update:install'); },
    launch: function () { return ipcRenderer.invoke('update:launch'); },
    openFolder: function () { return ipcRenderer.invoke('update:open-folder'); },
    openRelease: function () { return ipcRenderer.invoke('update:open-release'); },
    onState: function (cb) { on('update:state', cb); }
  },
  shell: {
    external: function (url) { return ipcRenderer.invoke('shell:external', url); }
  },
  sync: {
    getState: function () { return ipcRenderer.invoke('sync:get-state'); },
    startAuth: function () { return ipcRenderer.invoke('sync:start-auth'); },
    cancelAuth: function () { return ipcRenderer.invoke('sync:cancel-auth'); },
    run: function (input) { return ipcRenderer.invoke('sync:run', input || {}); },
    logout: function () { return ipcRenderer.invoke('sync:logout'); },
    setPassSync: function (enabled) { return ipcRenderer.invoke('sync:set-pass-sync', enabled === true); },
    getAuthUrl: function () { return ipcRenderer.invoke('sync:get-auth-url'); },
    openAuthExternal: function () { return ipcRenderer.invoke('sync:open-auth-external'); },
    onUpdate: function (cb) { on('sync:updated', cb); },
    onAuthUrl: function (cb) { on('sync:auth-url', cb); }
  },
  pass: {
    getVault: function () { return ipcRenderer.invoke('pass:get-vault'); },
    saveVault: function (raw) { return ipcRenderer.invoke('pass:save-vault', raw); }
  },
  app: {
    version: function () { return ipcRenderer.invoke('app:version'); }
  },
  bus: {
    onOpenUrl: function (cb) { on('cb:open-url', cb); },
    onAction: function (cb) { on('cb:action', cb); }
  }
};

const guestBridge = {
  net: {
    weather: function (lat, lon) { return ipcRenderer.invoke('net:weather', lat, lon); },
    geocode: function (name) { return ipcRenderer.invoke('net:geocode', name); },
    geocodeList: function (name) { return ipcRenderer.invoke('net:geocode-list', name); },
    rss: function () { return ipcRenderer.invoke('net:rss'); },
    fx: function () { return ipcRenderer.invoke('net:fx'); },
    quotes: function () { return ipcRenderer.invoke('net:quotes'); }
  },
  settings: {
    get: function () { return ipcRenderer.invoke('settings:get'); },
    set: function (key, value) { return ipcRenderer.invoke('settings:set', key, value); }
  }
};

function bridgeForLocation() {
  let protocol = '';
  let file = '';
  try {
    protocol = window.location.protocol || '';
    file = (window.location.pathname || '').replace(/\\/g, '/');
  } catch (err) {
    protocol = '';
  }
  if (protocol === 'file:' && file.indexOf('start_page') !== -1) {
    return guestBridge;
  }
  if (protocol === 'file:') {
    return fullBridge;
  }
  return {};
}

contextBridge.exposeInMainWorld('creamy', bridgeForLocation());
