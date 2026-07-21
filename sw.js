// Service worker FiTrack — cache app shell + gestion notifications push
const CACHE_NAME = 'fitrack-v4-shell-57';
// Cache séparé et persistant pour les libs CDN versionnées (zxing-wasm, html5-qrcode)
// → scanner fonctionnel hors-ligne une fois chargé une première fois.
const CDN_CACHE = 'fitrack-cdn-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){return k!==CACHE_NAME&&k!==CDN_CACHE;}).map(function(k){return caches.delete(k);}));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  // Libs CDN (zxing-wasm + wasm, html5-qrcode) : cache-first → scanner hors-ligne
  if (url.origin === 'https://cdn.jsdelivr.net') {
    event.respondWith(
      caches.open(CDN_CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(res) {
            if (res && res.ok) cache.put(event.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.search) { event.respondWith(fetch(event.request)); return; }
  event.respondWith(
    fetch(event.request).then(function(res) {
      if(res.ok){
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, resClone); });
      }
      return res;
    }).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  var title = data.title || 'FiTrack';
  var options = {
    body: data.body || '',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    tag: data.tag || 'fitrack-notif',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur une notification : ouvre / focus l'app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) { client.focus(); return; }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
