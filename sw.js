// Caches the app files so it opens offline. Bump VERSION after changing any file.
// Caches are shared with the Purchases app (same website), so only touch 'clothes-' ones.
const VERSION = 'clothes-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'zip.js', 'nepali.js',
  'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('clothes-') && k !== VERSION)
      .map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request, { cacheName: VERSION, ignoreSearch: true })
    .then(r => r || fetch(e.request)));
});
