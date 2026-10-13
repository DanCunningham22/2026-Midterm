// Service worker: network first for everything from this site, so new code and numbers arrive as soon as
// you're online; after 4 seconds without an answer, or offline, it serves the last cached copy instead.
// Google Fonts are cached on first use.
const CACHE = 'midterm-map-v11';
const FONTS = 'midterm-fonts-v1';
const SHELL = ['./', './index.html', './app.js', './model.js', './data.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const key = req.mode === 'navigate' ? self.registration.scope : url.origin + url.pathname;
    e.respondWith((async () => {
      const fromNet = (req.mode === 'navigate' ? fetch(req) : fetch(key, { cache: 'no-cache' })).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      });
      try {
        const res = await Promise.race([fromNet, new Promise((r) => setTimeout(r, 4000))]);
        if (res) return res;
        const hit = await caches.match(key);
        return hit || await fromNet;
      } catch (err) {
        const hit = (await caches.match(key)) || (await caches.match(self.registration.scope));
        return hit || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))));
  }
});
