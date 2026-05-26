// Service worker — minimal caching strategy
// - HTML/API → network-first (always fresh, fallback to cache when offline)
// - Static assets (CSS/JS/images/fonts) → cache-first

const CACHE_NAME = 'school-v1';
const STATIC_CACHE = 'school-static-v1';

const STATIC_ASSETS = [
  '/css/style.css',
  '/js/common.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // API and HTML: network-first
  if (url.pathname.startsWith('/api/') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Cache successful HTML responses for offline fallback
          if (res.ok && (url.pathname.endsWith('.html') || url.pathname === '/')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then(r => r || new Response(
          '<h1 style="font-family:Sarabun;text-align:center;padding:2rem">📡 ไม่มีอินเทอร์เน็ต<br><small>โปรดเชื่อมต่อใหม่</small></h1>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )))
    );
    return;
  }

  // Static assets: cache-first
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/i) ||
      url.pathname.startsWith('/css/') ||
      url.pathname.startsWith('/js/') ||
      url.pathname.startsWith('/photos/') ||
      url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});
