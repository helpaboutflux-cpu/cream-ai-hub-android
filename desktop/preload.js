const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  ipcRenderer.on(channel, function (event, payload) { callback(payload); });
}

const fullBridge = {
  env: {
    preloadPath: __filename
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
  net: {
    weather: function (lat, lon) { return ipcRenderer.invoke('net:weather', lat, lon); },
    geocode: function (name) { return ipcRenderer.invoke('net:geocode', name); },
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
    openFile: function (p) { return ipcRenderer.invoke('dl:open-file', p); },
    openFolder: function () { return ipcRenderer.invoke('dl:open-folder'); },
    onUpdate: function (cb) { on('dl:update', cb); }
  },
  shell: {
    external: function (url) { return ipcRenderer.invoke('shell:external', url); }
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
    rss: function () { return ipcRenderer.invoke('net:rss'); },
    fx: function () { return ipcRenderer.invoke('net:fx'); },
    quotes: function () { return ipcRenderer.invoke('net:quotes'); }
  },
  settings: {
    get: function () { return ipcRenderer.invoke('settings:get'); }
  }
};

function bridgeForLocation() {
  let protocol = '';
  let file = '';
  try {
    protocol = window.location.protocol;
    file = window.location.pathname || '';
  } catch (err) {
    protocol = '';
  }
  if (protocol === 'file:' && file.indexOf('start_page') !== -1) {
    return guestBridge;
  }
  return {};
}

contextBridge.exposeInMainWorld('creamy', bridgeForLocation());
