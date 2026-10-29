// Network first with a short timeout, cache fallback.
// On the mixer's Wi-Fi there is no internet: after 2.5 s the app opens from the copy saved on the phone.
const C = 'wing-console-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js'];
self.addEventListener('install', e => e.waitUntil(
  caches.open(C).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    const timer = setTimeout(() => fromCache().then(hit => { if (hit && !done) { done = true; resolve(hit); } }), 2500);
    fetch(req, { cache: 'no-store' }).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(C).then(c => c.put(req, copy)).catch(() => {}); }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => fromCache().then(hit => { if (!done) { done = true; clearTimeout(timer); resolve(hit || Response.error()); } }));
  }));
});
