// ─── THEME (Dark/Light Mode) — init ก่อนทุกอย่าง ป้องกัน flash ───
(function initTheme() {
  try {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.setAttribute('data-bs-theme', theme); // Bootstrap 5.3+
  } catch (e) {}
})();

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.setAttribute('data-bs-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) {}
  // Update toggle button icon + label
  const btn = document.querySelector('.theme-toggle');
  if (btn) {
    const icon = next === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill';
    const label = next === 'dark' ? 'สว่าง' : 'มืด';
    btn.innerHTML = `<i class="bi ${icon}"></i> ${label}`;
  }
  // Update theme-color meta (mobile address bar)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#15171c' : '#0d3b8e';
}

// ─── PWA: register service worker + manifest + iOS support ───
(function initPWA() {
  const head = document.head;
  // Manifest
  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement('link');
    m.rel = 'manifest'; m.href = '/manifest.json';
    head.appendChild(m);
  }
  // Theme color (mobile address bar)
  if (!document.querySelector('meta[name="theme-color"]')) {
    const dark = document.documentElement.dataset.theme === 'dark';
    const t = document.createElement('meta');
    t.name = 'theme-color';
    t.content = dark ? '#15171c' : '#0d3b8e';
    head.appendChild(t);
  }
  // iOS PWA support
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const ai = document.createElement('link');
    ai.rel = 'apple-touch-icon';
    ai.href = '/icons/icon.svg';
    head.appendChild(ai);
  }
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const ac = document.createElement('meta');
    ac.name = 'apple-mobile-web-app-capable'; ac.content = 'yes';
    head.appendChild(ac);
    const at = document.createElement('meta');
    at.name = 'apple-mobile-web-app-title'; at.content = 'เช็คชื่อ';
    head.appendChild(at);
  }
  // Register service worker + auto-update เมื่อ deploy ใหม่
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        // Force check for SW update ทุกครั้งที่โหลดหน้า
        reg.update().catch(() => {});
        // เมื่อมี SW ใหม่กำลังติดตั้ง
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // SW ใหม่พร้อมแล้ว — reload หน้าเพื่อใช้ CSS/JS ใหม่
              console.log('[SW] Update ready — reloading...');
              window.location.reload();
            }
          });
        });
      }).catch(() => {});
      // Listen for controller change (SW เปลี่ยนตัว)
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    });
  }
})();

// ─── SKELETON helper ───
function skeletonBlock(opts = {}) {
  const { lines = 3, withCircle = false } = opts;
  let inner = '';
  if (withCircle) {
    inner += '<div class="d-flex align-items-center gap-2 mb-2">';
    inner += '<div class="skeleton skeleton-circle"></div>';
    inner += '<div style="flex:1"><div class="skeleton skeleton-line lg"></div><div class="skeleton skeleton-line sm"></div></div>';
    inner += '</div>';
  }
  for (let i = 0; i < lines; i++) {
    inner += `<div class="skeleton skeleton-line${i === lines-1 ? ' sm' : ''}"></div>`;
  }
  return `<div class="skeleton-card">${inner}</div>`;
}
function showSkeleton(selectorOrEl, count = 3, opts = {}) {
  const el = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
  if (!el) return;
  let html = '';
  for (let i = 0; i < count; i++) html += skeletonBlock(opts);
  el.innerHTML = html;
}

const THAI_MONTHS = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
];
const THAI_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const THAI_DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatThaiDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function formatThaiDateFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `วัน${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

const STATUS = {
  present:  { label: 'มา',         color: 'success',   icon: 'bi-check-circle-fill'   },
  absent:   { label: 'ขาด',        color: 'danger',    icon: 'bi-x-circle-fill'       },
  late:     { label: 'มาสาย',      color: 'warning',   icon: 'bi-clock-fill'          },
  leave:    { label: 'ลา',         color: 'info',      icon: 'bi-calendar-minus-fill' },
  activity: { label: 'ไปกิจกรรม',  color: 'purple',    icon: 'bi-people-fill'         }
};

let currentUser = null;

async function apiFetch(url, options = {}) {
  const defaults = { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  const res = await fetch(url, { ...defaults, ...options,
    headers: { ...defaults.headers, ...(options.headers || {}) }
  });
  if (res.status === 401) {
    try { sessionStorage.removeItem('authMe.v1'); } catch {}
    if (!location.pathname.endsWith('login.html')) location.href = '/login.html';
    throw new Error('unauthorized');
  }
  if (res.status === 403) throw new Error('สิทธิ์ไม่เพียงพอ');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

function showToast(message, type = 'success') {
  const el = document.getElementById('mainToast');
  if (!el) return;
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.querySelector('.toast-body').textContent = message;
  const toast = bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 });
  toast.show();
}

function injectFooter() {
  // Skip on login / parent / change-password pages
  const skip = ['/login.html', '/parent.html', '/change-password.html'];
  if (skip.some(p => location.pathname.endsWith(p))) return;
  if (document.getElementById('siteFooter')) return;

  const footer = document.createElement('footer');
  footer.id = 'siteFooter';
  footer.className = 'site-footer text-center no-print';
  footer.innerHTML = `
    <div class="container">
      <div class="footer-content">
        <div class="footer-school">
          <i class="bi bi-c-circle me-1"></i>2026 <strong>โรงเรียนตะกั่วทุ่งงานทวีวิทยาคม</strong>
        </div>
        <div class="footer-credit">
          <i class="bi bi-code-slash me-1"></i>พัฒนาโดย <strong>ครูพรเทพ อุ้มชูวัฒนา</strong>
        </div>
      </div>
    </div>`;
  document.body.appendChild(footer);

  // Add padding to body so footer doesn't overlap content
  document.body.style.paddingBottom = '70px';
}

function injectGlobalSearch() {
  // Add a global search bar to navbar if not present
  const navbar = document.querySelector('.navbar .navbar-collapse');
  if (!navbar || document.getElementById('globalSearch')) return;
  const badge = document.getElementById('userBadge');
  if (!badge) return;

  const wrap = document.createElement('div');
  wrap.className = 'position-relative me-2 my-1';
  wrap.style.minWidth = '180px';
  wrap.innerHTML = `
    <input id="globalSearch" type="search" class="form-control form-control-sm"
      placeholder="🔍 ค้นหานักเรียน..." autocomplete="off" style="font-size:.85rem;">
    <div id="globalSearchResults" class="position-absolute end-0 mt-1 shadow rounded bg-white"
      style="display:none; min-width:280px; max-height:420px; overflow-y:auto; z-index:9999;"></div>`;
  badge.parentNode.insertBefore(wrap, badge);

  const input = document.getElementById('globalSearch');
  const box = document.getElementById('globalSearchResults');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/students/search?q=' + encodeURIComponent(q));
        if (res.length === 0) {
          box.innerHTML = '<div class="text-center text-muted p-3">ไม่พบนักเรียน</div>';
        } else {
          box.innerHTML = res.map(s => `
            <a href="/behavior.html?id=${s.id}" class="d-flex align-items-center gap-2 p-2 text-decoration-none text-dark border-bottom hover-bg-light">
              ${s.photo ? `<img src="/photos/${s.photo}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">` : '<i class="bi bi-person-circle fs-4 text-muted"></i>'}
              <div class="flex-grow-1">
                <div class="fw-500" style="font-size:.88rem;">${s.name}</div>
                <small class="text-muted">ม.${s.class_level}/${s.room} • เลขที่ ${s.number || '-'}</small>
              </div>
            </a>`).join('');
        }
        box.style.display = '';
      } catch {}
    }, 200);
  });

  // Hide when clicking outside
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) box.style.display = 'none';
  });
  input.addEventListener('focus', () => { if (input.value.trim()) box.style.display = ''; });
}

// cache ข้อมูลผู้ใช้ใน sessionStorage — หน้าโหลดทันทีไม่ต้องรอ network (revalidate เบื้องหลัง)
const USER_CACHE_KEY = 'authMe.v1';
const USER_CACHE_TTL = 10 * 60 * 1000; // 10 นาที

function readUserCache() {
  try {
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const { user, ts } = JSON.parse(raw);
    if (!user || Date.now() - ts > USER_CACHE_TTL) return null;
    return user;
  } catch { return null; }
}
function writeUserCache(user) {
  try { sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify({ user, ts: Date.now() })); } catch {}
}
function clearUserCache() {
  try { sessionStorage.removeItem(USER_CACHE_KEY); } catch {}
}

async function loadCurrentUser() {
  // 1) มี cache → ใช้ทันที (เร็ว) แล้วตรวจสอบกับ server เบื้องหลัง
  const cached = readUserCache();
  if (cached) {
    currentUser = cached;
    setupUserUI();
    // revalidate เบื้องหลัง — ถ้า session หมด/ข้อมูลเปลี่ยน ค่อยจัดการ
    apiFetch('/api/auth/me').then(data => {
      writeUserCache(data.user);
      if (data.user?.must_change_pw && !location.pathname.endsWith('change-password.html')) {
        location.href = '/change-password.html';
      }
    }).catch(() => {});  // 401 → apiFetch redirect ไป login เอง
    return currentUser;
  }
  // 2) ไม่มี cache → โหลดปกติ
  try {
    const data = await apiFetch('/api/auth/me');
    currentUser = data.user;
    writeUserCache(currentUser);

    // Force change password if flagged
    if (currentUser?.must_change_pw &&
        !location.pathname.endsWith('change-password.html')) {
      location.href = '/change-password.html';
      return null;
    }

    setupUserUI();
    return currentUser;
  } catch (e) {
    if (e.message !== 'unauthorized') console.error(e);
    return null;
  }
}

function setupUserUI() {
  try {
    // Upgrade "คะแนน" link → "คะแนนความประพฤติ" dropdown
    upgradeBehaviorMenu();
    // Add Heatmap link (after รายงาน) if not present
    injectHeatmapLink();
    injectHomeVisitLink();
    injectLibraryLink();
    injectBankLink();
    // Add global student search
    injectGlobalSearch();
    // Apply theme color and logo from settings
    applyTheme();
    // Inject footer credit
    injectFooter();
    // Show LINE/in-app browser banner (if applicable)
    showInAppBrowserBanner();

    const el = document.getElementById('userBadge');
    if (el && currentUser) {
      const roleLabel = currentUser.role === 'admin' ? 'แอดมิน' : 'ครู';
      let assignTxt = '';
      if (currentUser.assigned_level) {
        assignTxt = currentUser.assigned_room
          ? ` <span class="badge bg-warning text-dark ms-1">ม.${currentUser.assigned_level}/${currentUser.assigned_room}</span>`
          : ` <span class="badge bg-warning text-dark ms-1">ม.${currentUser.assigned_level}</span>`;
      }
      const dark = document.documentElement.dataset.theme === 'dark';
      const themeIcon = dark ? 'bi-sun-fill' : 'bi-moon-stars-fill';
      const themeLabel = dark ? 'สว่าง' : 'มืด';
      el.innerHTML = `
        <button class="theme-toggle" onclick="toggleTheme()" title="สลับโหมดมืด/สว่าง">
          <i class="bi ${themeIcon}"></i> ${themeLabel}
        </button>
        <span class="badge bg-light text-dark me-2">${roleLabel}</span>
        <span class="text-light me-2"><i class="bi bi-person-circle me-1"></i>${currentUser.full_name}${assignTxt}</span>
        <button class="btn btn-sm btn-outline-light" onclick="logout()" title="ออกจากระบบ">
          <i class="bi bi-box-arrow-right"></i>
        </button>`;
    }
    if (currentUser?.role !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(e => e.style.display = 'none');
    }
  } catch (e) {
    console.error(e);
  }
}

function injectHeatmapLink() {
  // ถ้ามีแล้ว skip
  if (document.querySelector('a.nav-link[href="/heatmap.html"]')) return;
  const reportLink = document.querySelector('a.nav-link[href="/report.html"]');
  if (!reportLink) return;
  const reportLi = reportLink.closest('li.nav-item');
  if (!reportLi) return;
  const li = document.createElement('li');
  li.className = 'nav-item';
  const isActive = location.pathname === '/heatmap.html';
  li.innerHTML = `<a class="nav-link ${isActive ? 'active' : ''}" href="/heatmap.html"><i class="bi bi-calendar3-week me-1"></i>ปฏิทินมาเรียน</a>`;
  reportLi.parentNode.insertBefore(li, reportLi.nextSibling);
}

function injectHomeVisitLink() {
  if (document.querySelector('a.nav-link[href="/home-visit.html"]')) return;
  const anchor = document.querySelector('a.nav-link[href="/students.html"]');
  if (!anchor) return;
  const anchorLi = anchor.closest('li.nav-item');
  if (!anchorLi) return;
  const li = document.createElement('li');
  li.className = 'nav-item';
  const isActive = location.pathname === '/home-visit.html';
  li.innerHTML = `<a class="nav-link ${isActive ? 'active' : ''}" href="/home-visit.html"><i class="bi bi-house-heart me-1"></i>เยี่ยมบ้าน</a>`;
  anchorLi.parentNode.insertBefore(li, anchorLi.nextSibling);
}

function injectLibraryLink() {
  if (currentUser?.role !== 'admin') return;  // เฉพาะแอดมิน
  if (document.querySelector('a.nav-link[href="/library.html"]')) return;
  const anchor = document.querySelector('a.nav-link[href="/home-visit.html"]')
              || document.querySelector('a.nav-link[href="/students.html"]');
  if (!anchor) return;
  const anchorLi = anchor.closest('li.nav-item');
  if (!anchorLi) return;
  const li = document.createElement('li');
  li.className = 'nav-item';
  const isActive = location.pathname === '/library.html';
  li.innerHTML = `<a class="nav-link ${isActive ? 'active' : ''}" href="/library.html"><i class="bi bi-book-half me-1"></i>ห้องสมุด</a>`;
  anchorLi.parentNode.insertBefore(li, anchorLi.nextSibling);
}

function injectBankLink() {
  // ครูที่ปรึกษา + แอดมิน เห็นได้
  if (!(currentUser?.role === 'admin' || currentUser?.role === 'teacher')) return;
  if (document.querySelector('a.nav-link[href="/bank.html"]')) return;
  const anchor = document.querySelector('a.nav-link[href="/library.html"]')
              || document.querySelector('a.nav-link[href="/home-visit.html"]')
              || document.querySelector('a.nav-link[href="/students.html"]');
  if (!anchor) return;
  const anchorLi = anchor.closest('li.nav-item');
  if (!anchorLi) return;
  const li = document.createElement('li');
  li.className = 'nav-item';
  const isActive = location.pathname === '/bank.html';
  li.innerHTML = `<a class="nav-link ${isActive ? 'active' : ''}" href="/bank.html"><i class="bi bi-bank2 me-1"></i>ธนาคาร</a>`;
  anchorLi.parentNode.insertBefore(li, anchorLi.nextSibling);
}

function upgradeBehaviorMenu() {
  // Find existing simple link to behavior-report.html and convert into dropdown
  const link = document.querySelector('a.nav-link[href="/behavior-report.html"]');
  if (!link) return;
  const li = link.closest('li.nav-item');
  if (!li || li.classList.contains('dropdown')) return;

  const isActive = link.classList.contains('active') ||
                   location.pathname.startsWith('/behavior');
  const rulesItem = currentUser?.role === 'admin'
    ? `<li><a class="dropdown-item ${location.pathname === '/behavior-rules.html' ? 'active' : ''}" href="/behavior-rules.html"><i class="bi bi-list-check me-2"></i>จัดการพฤติกรรม</a></li>`
    : '';

  li.classList.add('dropdown');
  // หมายเหตุ: ใช้ manual handler ล้วน ไม่ใส่ data-bs-toggle เพื่อหลีกเลี่ยงปัญหาใน LINE/FB in-app browser
  li.innerHTML = `
    <a class="nav-link dropdown-toggle ${isActive ? 'active' : ''}" href="#" role="button" aria-expanded="false">
      <i class="bi bi-award me-1"></i>คะแนนความประพฤติ
    </a>
    <ul class="dropdown-menu">
      <li><a class="dropdown-item ${location.pathname === '/behavior-report.html' ? 'active' : ''}" href="/behavior-report.html"><i class="bi bi-bar-chart me-2"></i>รายงานคะแนน</a></li>
      <li><a class="dropdown-item ${location.pathname === '/pc-forms.html' ? 'active' : ''}" href="/pc-forms.html"><i class="bi bi-file-earmark-text me-2"></i>พิมพ์แบบฟอร์ม ปค.</a></li>
      ${rulesItem}
    </ul>`;

  const toggle = li.querySelector('.dropdown-toggle');
  const menu = li.querySelector('.dropdown-menu');

  const openMenu = () => {
    document.querySelectorAll('.dropdown-menu.show').forEach(m => {
      if (m !== menu) m.classList.remove('show');
    });
    menu.classList.add('show');
    toggle.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => {
    menu.classList.remove('show');
    toggle.setAttribute('aria-expanded', 'false');
  };
  const toggleMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.classList.contains('show')) closeMenu();
    else openMenu();
  };

  // ใช้แค่ click event — ใน mobile browser, click ถูก trigger หลังจาก touchend อยู่แล้ว
  // ห้ามใส่ touchend ที่ document เพราะจะ interfere กับ native <select> บน Android WebView
  toggle.addEventListener('click', toggleMenu);

  // ปิดเมื่อ click ข้างนอก (ไม่ใช้ touchend เพื่อไม่ block native input)
  document.addEventListener('click', (e) => {
    if (!li.contains(e.target)) closeMenu();
  });
}

// In-app browser detection (LINE, Facebook, Instagram, etc.)
function detectInAppBrowser() {
  const ua = navigator.userAgent || '';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Messenger/i.test(ua)) return 'Messenger';
  return null;
}

function showInAppBrowserBanner() {
  const inApp = detectInAppBrowser();
  if (!inApp) return;

  // LINE: ลอง auto-redirect ไป external browser ผ่าน parameter พิเศษ
  // (ทำครั้งเดียวต่อ session — ป้องกัน loop)
  if (inApp === 'LINE' && !location.search.includes('openExternalBrowser') &&
      !sessionStorage.getItem('lineExternalTried')) {
    sessionStorage.setItem('lineExternalTried', '1');
    const url = new URL(location.href);
    url.searchParams.set('openExternalBrowser', '1');
    location.replace(url.toString());
    return;
  }

  // Auto-redirect ไม่สำเร็จ → แสดง full-screen overlay พร้อมปุ่มใหญ่
  if (sessionStorage.getItem('inAppOverlayDismissed') === '1') return;
  if (document.getElementById('inAppOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'inAppOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,.85);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  `;
  overlay.innerHTML = `
    <div style="background: white; border-radius: 16px; max-width: 420px; width: 100%;
                padding: 28px 24px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.3);">
      <i class="bi bi-exclamation-triangle-fill text-warning" style="font-size: 4rem;"></i>
      <h4 class="fw-bold mt-3 mb-2">เปิดในเบราว์เซอร์ภายนอก</h4>
      <p class="text-muted mb-3">
        ระบบนี้ใช้งานไม่ได้ใน <strong>${inApp}</strong><br>
        กรุณาเปิดใน <strong>Chrome / Safari / Samsung Internet</strong>
      </p>
      <div class="d-grid gap-2 mb-3">
        <button onclick="openExternal()" class="btn btn-primary btn-lg fw-bold">
          <i class="bi bi-box-arrow-up-right me-2"></i>เปิดในเบราว์เซอร์ภายนอก
        </button>
        <button onclick="copyUrlAndShow()" class="btn btn-outline-secondary">
          <i class="bi bi-clipboard me-2"></i>คัดลอกลิงก์
        </button>
      </div>
      <details class="text-start small">
        <summary class="text-muted">วิธีอื่นในการเปิด ▾</summary>
        <ol class="mt-2 ps-3">
          <li>แตะปุ่ม <strong>⋮ (3 จุด)</strong> มุมขวาบน/ล่างของหน้านี้</li>
          <li>เลือก <strong>"เปิดในเบราว์เซอร์"</strong> หรือ <strong>"Open in browser"</strong></li>
        </ol>
      </details>
      <hr>
      <button onclick="dismissInAppOverlay()" class="btn btn-sm btn-link text-muted">
        ปิดและใช้งานต่อใน ${inApp} (อาจมีบางอย่างใช้ไม่ได้)
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function dismissInAppOverlay() {
  sessionStorage.setItem('inAppOverlayDismissed', '1');
  document.getElementById('inAppOverlay')?.remove();
}

function openExternal() {
  const inApp = detectInAppBrowser();
  const url = location.href.replace(/[?&]openExternalBrowser=1/, '');
  if (inApp === 'LINE') {
    const sep = url.includes('?') ? '&' : '?';
    location.href = url + sep + 'openExternalBrowser=1';
  } else {
    copyUrlAndShow();
  }
}

function copyUrlAndShow() {
  const url = location.href.replace(/[?&]openExternalBrowser=1/, '');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      alert('✅ คัดลอกลิงก์แล้ว\n\nเปิด Chrome/Safari แล้ววางในแถบที่อยู่');
    }).catch(() => {
      prompt('กดค้าง URL ด้านล่างเพื่อคัดลอก:', url);
    });
  } else {
    prompt('กดค้าง URL ด้านล่างเพื่อคัดลอก:', url);
  }
}

async function applyTheme() {
  try {
    // Use public endpoint so login/parent pages also get the theme
    const r = await fetch('/api/public/theme', { credentials: 'same-origin' });
    const s = await r.json();
    if (s.theme_color) {
      const c = s.theme_color;
      const root = document.documentElement.style;
      root.setProperty('--primary', c);
      root.setProperty('--primary-dark', adjustColor(c, -20));
      root.setProperty('--primary-light', adjustColor(c, 25));
      // ลากสี Bootstrap (.btn-primary/.text-primary/.bg-primary) ให้ตรงกับ theme_color เดียวกัน
      root.setProperty('--bs-primary', c);
      const hex = c.replace('#', '');
      const num = parseInt(hex, 16);
      root.setProperty('--bs-primary-rgb', `${(num>>16)&0xff}, ${(num>>8)&0xff}, ${num&0xff}`);
      root.setProperty('--bs-link-color', c);
      root.setProperty('--bs-link-hover-color', adjustColor(c, -20));
    }
    if (s.school_logo) {
      document.querySelectorAll('.navbar-brand i.bi-mortarboard-fill').forEach(icon => {
        const img = document.createElement('img');
        img.src = s.school_logo;
        img.style.cssText = 'height:40px;width:40px;object-fit:contain;border-radius:50%;background:white;padding:2px;margin-right:10px;box-shadow:0 2px 6px rgba(0,0,0,.15);';
        img.alt = 'logo';
        icon.replaceWith(img);
      });
      // Login & parent page logos (larger)
      document.querySelectorAll('.login-header i.bi-mortarboard-fill, .parent-header > .container .bi-person-circle').forEach(icon => {
        const img = document.createElement('img');
        img.src = s.school_logo;
        img.style.cssText = 'width:80px;height:80px;object-fit:contain;border-radius:50%;background:white;padding:6px;box-shadow:0 4px 12px rgba(0,0,0,.2);margin-bottom:.5rem;';
        icon.replaceWith(img);
      });
    }
    if (s.school_name) {
      document.querySelectorAll('.navbar-brand').forEach(el => {
        const text = el.lastChild;
        if (text && text.nodeType === 3 && text.textContent.includes('ตะกั่วทุ่ง')) {
          // Keep the existing text — only change if user changed school_name
          if (!s.school_name.includes('ตะกั่วทุ่ง')) {
            text.textContent = ' ' + s.school_name.replace(/^โรงเรียน/, '');
          }
        }
      });
    }
  } catch {}
}

function adjustColor(hex, percent) {
  hex = hex.replace('#', '');
  const num = parseInt(hex, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + percent));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + percent));
  const b = Math.max(0, Math.min(255, (num & 0xff) + percent));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Helper: ปุ่มย้อนกลับสำหรับหน้าย่อย
function goBack() {
  if (document.referrer && document.referrer.startsWith(location.origin) &&
      document.referrer !== location.href) {
    history.back();
  } else {
    location.href = '/';
  }
}

async function logout() {
  if (!confirm('ออกจากระบบ?')) return;
  clearUserCache();
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  location.href = '/login.html';
}

function classLabel(level, room) { return `ม.${level}/${room}`; }

// สร้าง QR เป็น data URL (สำหรับใช้ใน <img> หรือหน้าต่างพิมพ์)
function makeQRDataURL(text, size = 200) {
  if (typeof QRCode === 'undefined') return '';
  const tmp = document.createElement('div');
  tmp.style.cssText = 'position:absolute;left:-9999px;';
  document.body.appendChild(tmp);
  try {
    new QRCode(tmp, { text: String(text), width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
    const canvas = tmp.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png') : (tmp.querySelector('img')?.src || '');
  } finally {
    tmp.remove();
  }
}

// สร้าง QR ในเครื่อง (ใช้ /js/qrcode.min.js) แทนการเรียก api.qrserver.com
// ใช้: ใส่ <div data-qr="ข้อความ" data-qr-size="160"></div> แล้วเรียก renderLocalQRs()
function renderLocalQRs(root) {
  if (typeof QRCode === 'undefined') return;  // หน้านี้ไม่ได้โหลด qrcode.min.js
  (root || document).querySelectorAll('[data-qr]').forEach(el => {
    if (el.dataset.qrDone) return;
    const size = parseInt(el.dataset.qrSize || '160', 10);
    el.innerHTML = '';
    new QRCode(el, {
      text: String(el.dataset.qr),
      width: size, height: size,
      correctLevel: QRCode.CorrectLevel.M,
    });
    el.dataset.qrDone = '1';
  });
}

function thaiYear() {
  const m = new Date().getMonth() + 1;
  const y = new Date().getFullYear();
  // Thai academic year: 1 May - 30 April
  return (m >= 5 ? y : y - 1) + 543;
}

function gregYear() {
  const m = new Date().getMonth() + 1;
  const y = new Date().getFullYear();
  return m >= 5 ? y : y - 1;
}
