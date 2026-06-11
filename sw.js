// Service worker FiTrack — minimal, requis pour que les navigateurs
// (notamment Chrome/Android) proposent "Installer l'application" /
// "Ajouter à l'écran d'accueil", et permet un chargement plus rapide
// + un fonctionnement basique hors-ligne pour l'app shell.
const CACHE_NAME = 'fitrack-v4-shell-1';
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
      return Promise.all(keys.filter(function(k){return k!==CACHE_NAME;}).map(function(k){return caches.delete(k);}));
    })
  );
  self.clients.claim();
});

// Stratégie : "network first" pour toujours avoir les dernières
// données/pages à jour quand il y a du réseau, et fallback sur le
// cache (app shell) si hors-ligne.
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  // On ne touche pas aux appels vers Supabase / API externes
  if (url.origin !== self.location.origin) return;
  // On ne met pas en cache les URLs avec paramètres (ex: redirection
  // OAuth contenant un code/jeton dans l'URL) pour éviter de stocker
  // des informations sensibles dans le Cache Storage de l'appareil.
  if (url.search) { event.respondWith(fetch(event.request)); return; }

  event.respondWith(
    fetch(event.request).then(function(res) {
      var resClone = res.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, resClone); });
      return res;
    }).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});
