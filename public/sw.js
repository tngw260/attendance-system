// Service worker v2 — strategy ที่ deploy CSS/JS ได้ทันที
// - HTML/API → network-first
// - CSS/JS → network-first + cache fallback (ให้ update ทันที)
// - Images/fonts → cache-first (เปลี่ยนน้อย, ประหยัด data)

const VERSION = 'v2-2026';
const CACHE_NAME = `school-${VERSION}`;
const STATIC_CACHE = `school-static-${VERSION}`;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // ลบ cache เก่าทั้งหมดที่ไม่ใช่ version ปัจจุบัน
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // CSS/JS — network-first (อัพเดททันทีเมื่อ deploy)
  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') ||
      url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // API + HTML — network-first
  if (url.pathname.startsWith('/api/') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
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

  // รูป/ไอคอน/ฟอนต์ — cache-first (เปลี่ยนน้อย)
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/i) ||
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
