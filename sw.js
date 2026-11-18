/* Lemon soft · Service Worker (푸시 알림) */
var VERSION = 'lemon-push-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: (e.data && e.data.text) ? e.data.text() : '' }; }
  var title = d.title || 'Flux Groups Plus';
  var opts = {
    body: d.body || '',
    tag: d.tag || ('lemon-' + Date.now()),
    renotify: !!d.tag,
    data: { url: d.url || './' },
    badge: d.badge || undefined,
    icon: d.icon || undefined
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        try {
          if ('focus' in c) {
            c.postMessage({ type: 'push', payload: { title: '', body: '' } });
            if (url && c.navigate) { c.navigate(url).catch(function () { }); }
            return c.focus();
          }
        } catch (err) { }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'ping') {
    try { e.source.postMessage({ type: 'pong' }); } catch (err) { }
  }
});
