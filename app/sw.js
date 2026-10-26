// Network-first: always load the newest version, fall back to cache when offline.
const C = 'wing-console';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(C).then(x => x.put(e.request, c)).catch(() => {}); return r; })
    .catch(() => caches.match(e.request)));
});
