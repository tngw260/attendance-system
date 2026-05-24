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

async function loadCurrentUser() {
  try {
    const data = await apiFetch('/api/auth/me');
    currentUser = data.user;

    // Force change password if flagged
    if (currentUser?.must_change_pw &&
        !location.pathname.endsWith('change-password.html')) {
      location.href = '/change-password.html';
      return null;
    }

    // Upgrade "คะแนน" link → "คะแนนความประพฤติ" dropdown
    upgradeBehaviorMenu();
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
      el.innerHTML = `
        <span class="badge bg-light text-dark me-2">${roleLabel}</span>
        <span class="text-light me-2"><i class="bi bi-person-circle me-1"></i>${currentUser.full_name}${assignTxt}</span>
        <button class="btn btn-sm btn-outline-light" onclick="logout()" title="ออกจากระบบ">
          <i class="bi bi-box-arrow-right"></i>
        </button>`;
    }
    if (currentUser?.role !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(e => e.style.display = 'none');
    }
    return currentUser;
  } catch (e) {
    return null;
  }
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
  // Don't annoy users every page — store dismissal in sessionStorage
  if (sessionStorage.getItem('inAppBannerDismissed') === '1') return;
  if (document.getElementById('inAppBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'inAppBanner';
  banner.style.cssText = `
    position: relative; z-index: 1;
    background: #fff3cd; border-bottom: 2px solid #ffc107;
    padding: 10px 16px; font-size: .88rem;
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
  `;
  banner.innerHTML = `
    <div>
      <i class="bi bi-exclamation-triangle text-warning me-1"></i>
      <strong>คุณกำลังเปิดผ่าน ${inApp}</strong> — เพื่อให้ใช้งานได้ครบ
      <a href="javascript:void(0)" onclick="openExternal()" class="fw-bold text-decoration-underline ms-1">
        แตะที่นี่เพื่อเปิดในเบราว์เซอร์
      </a>
    </div>
    <button onclick="dismissInAppBanner()" class="btn-close" aria-label="ปิด"
      style="font-size: .7rem;"></button>
  `;
  document.body.prepend(banner);
}

function dismissInAppBanner() {
  sessionStorage.setItem('inAppBannerDismissed', '1');
  document.getElementById('inAppBanner')?.remove();
}

function openExternal() {
  const url = location.href;
  const inApp = detectInAppBrowser();
  if (inApp === 'LINE') {
    // LINE: append ?openExternalBrowser=1
    const sep = url.includes('?') ? '&' : '?';
    location.href = url + sep + 'openExternalBrowser=1';
  } else {
    // Try copying URL + show alert
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        alert('คัดลอกลิงก์แล้ว — เปิด Safari/Chrome แล้ววางลิงก์ในแถบที่อยู่');
      });
    } else {
      alert('กรุณาเปิดลิงก์นี้ใน Safari หรือ Chrome:\n\n' + url);
    }
  }
}

async function applyTheme() {
  try {
    // Use public endpoint so login/parent pages also get the theme
    const r = await fetch('/api/public/theme', { credentials: 'same-origin' });
    const s = await r.json();
    if (s.theme_color) {
      const c = s.theme_color;
      document.documentElement.style.setProperty('--primary', c);
      document.documentElement.style.setProperty('--primary-dark',
        adjustColor(c, -20));
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
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  location.href = '/login.html';
}

function classLabel(level, room) { return `ม.${level}/${room}`; }

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
