// 離線快取：學校網路斷線時，網頁照樣能開、能倒數。
// 每次更新程式要把 VERSION 加 1，瀏覽器才會換成新版。

const VERSION = 'v5';
const FILES = [
  './',
  'index.html',
  'app.css',
  'settings.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/engine.js',
  'js/schedule.js',
  'js/seat-editor.js',
  'js/seating.js',
  'js/settings.js',
  'js/store.js',
  'js/views.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 先用網路（拿到最新版），斷線時才用快取
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
