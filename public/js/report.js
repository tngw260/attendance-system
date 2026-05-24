let lastQuery = {};

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();

  try {
    const classes = await apiFetch('/api/classes');
    window._classes = classes;
  } catch {}

  // Default year in BE
  document.getElementById('fYear').value = thaiYear();
  document.getElementById('fMonth').value = todayISO().slice(0, 7);

  document.querySelectorAll('input[name="filterMode"]').forEach(r => {
    r.addEventListener('change', toggleMode);
  });
});

function toggleMode() {
  const mode = document.querySelector('input[name="filterMode"]:checked').value;
  document.getElementById('dateInputs').style.display  = mode === 'date'     ? '' : 'none';
  document.getElementById('monthInputs').style.display = mode === 'month'    ? '' : 'none';
  document.getElementById('semInputs').style.display   = mode === 'semester' ? '' : 'none';
}

async function onLevelChange() {
  const level = document.getElementById('fLevel').value;
  const classes = window._classes || [];
  const rooms = classes.filter(c => !level || String(c.class_level) === level).map(c => c.room);
  const sel = document.getElementById('fRoom');
  sel.innerHTML = '<option value="">ทุกห้อง</option>';
  [...new Set(rooms)].sort((a,b) => a-b).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = `ห้อง ${r}`;
    sel.appendChild(opt);
  });
}

function getFilterParams() {
  const mode = document.querySelector('input[name="filterMode"]:checked').value;
  const params = new URLSearchParams();
  const level = document.getElementById('fLevel').value;
  const room  = document.getElementById('fRoom').value;
  if (level) params.set('level', level);
  if (room)  params.set('room',  room);

  if (mode === 'date') {
    const from = document.getElementById('fFrom').value;
    const to   = document.getElementById('fTo').value;
    if (from) params.set('from', from);
    if (to)   params.set('to',   to);
  } else if (mode === 'month') {
    const m = document.getElementById('fMonth').value;
    if (m) {
      const [yy, mm] = m.split('-');
      const lastDay = new Date(+yy, +mm, 0).getDate();
      params.set('from', `${yy}-${mm}-01`);
      params.set('to',   `${yy}-${mm}-${String(lastDay).padStart(2,'0')}`);
    }
  } else if (mode === 'semester') {
    const sem  = document.getElementById('fSem').value;
    const year = document.getElementById('fYear').value;
    if (sem && year) {
      params.set('semester', sem);
      params.set('year', String(+year - 543)); // convert BE to CE
    }
  }
  return params;
}

async function loadReport() {
  const params = getFilterParams();
  lastQuery = params.toString();

  document.getElementById('reportTable').innerHTML = `
    <div class="text-center py-4 text-muted">
      <div class="spinner-border text-primary mb-2"></div><div>กำลังโหลด...</div>
    </div>`;

  try {
    const d = await apiFetch('/api/report?' + params);
    renderReport(d);
  } catch (e) {
    document.getElementById('reportTable').innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  }
}

function renderReport(d) {
  const rows = d.rows;
  const range = d.range || {};
  const exportBar = document.getElementById('exportBar');
  const summaryBar = document.getElementById('summaryBar');
  const rangeInfo = document.getElementById('rangeInfo');

  // Range display
  if (range.from || range.to) {
    let txt = 'ช่วงข้อมูล: ';
    if (range.from && range.to) txt += `${formatThaiDateShort(range.from)} — ${formatThaiDateShort(range.to)}`;
    else if (range.from)        txt += `ตั้งแต่ ${formatThaiDateShort(range.from)}`;
    else if (range.to)          txt += `ถึง ${formatThaiDateShort(range.to)}`;
    rangeInfo.innerHTML = `<i class="bi bi-calendar-range me-2"></i>${txt}`;
    rangeInfo.style.display = '';
    document.getElementById('printTitle').textContent = 'รายงานการมาเรียน • ' + txt;
  } else {
    rangeInfo.style.display = 'none';
    document.getElementById('printTitle').textContent = 'รายงานการมาเรียน (รวมทั้งหมด)';
  }

  if (rows.length === 0) {
    document.getElementById('reportTable').innerHTML = `<div class="text-center text-muted py-5">
      <i class="bi bi-inbox fs-1 d-block mb-2"></i>ไม่พบข้อมูล
    </div>`;
    exportBar.style.display = 'none';
    summaryBar.style.display = 'none';
    return;
  }

  const totPresent = rows.reduce((s, r) => s + (r.present || 0), 0);
  const totAbsent  = rows.reduce((s, r) => s + (r.absent  || 0), 0);
  const totLate    = rows.reduce((s, r) => s + (r.late    || 0), 0);
  document.getElementById('sumTotal').textContent   = rows.length;
  document.getElementById('sumPresent').textContent = totPresent;
  document.getElementById('sumAbsent').textContent  = totAbsent;
  document.getElementById('sumLate').textContent    = totLate;
  summaryBar.style.display = '';
  exportBar.style.display = '';
  document.getElementById('resultCount').textContent = `(${rows.length} คน)`;

  const groups = {};
  rows.forEach(r => {
    const key = `${r.class_level}_${r.room}`;
    if (!groups[key]) groups[key] = { level: r.class_level, room: r.room, rows: [] };
    groups[key].rows.push(r);
  });

  let html = '';
  Object.values(groups)
    .sort((a,b) => a.level - b.level || a.room - b.room)
    .forEach(g => {
      html += `<div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-bold"><i class="bi bi-journal-text me-2"></i>ม.${g.level}/${g.room}</span>
          <span class="badge bg-primary">${g.rows.length} คน</span>
        </div>
        <div class="table-responsive">
          <table class="table table-hover table-sm mb-0 report-table" style="font-size:.88rem;">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>ชื่อ-นามสกุล</th>
                <th class="text-center">วันบันทึก</th>
                <th class="text-center text-success">มา</th>
                <th class="text-center text-danger">ขาด</th>
                <th class="text-center text-warning">มาสาย</th>
                <th class="text-center text-info">ลา</th>
                <th class="text-center" style="color:#8e44ad;">กิจกรรม</th>
                <th>% มา</th>
                <th class="text-center">คะแนน</th>
              </tr>
            </thead><tbody>`;

      g.rows.forEach(r => {
        const total = r.total_days || 0;
        const pct = total > 0 ? Math.round((r.present / total) * 100) : 0;
        const pctColor = pct >= 80 ? '#198754' : pct >= 60 ? '#fd7e14' : '#dc3545';
        const scoreColor = r.score >= 80 ? 'success' : r.score >= 60 ? 'warning' : 'danger';

        html += `<tr${r.absent >= 3 ? ' class="table-danger"' : ''}>
          <td class="text-center">${r.number ?? ''}</td>
          <td><a href="/behavior.html?id=${r.id}" class="text-decoration-none text-dark">${r.name}</a></td>
          <td class="text-center">${total}</td>
          <td class="text-center fw-bold text-success">${r.present || 0}</td>
          <td class="text-center fw-bold ${r.absent > 0 ? 'text-danger' : 'text-muted'}">${r.absent || 0}</td>
          <td class="text-center fw-bold ${r.late > 0 ? 'text-warning' : 'text-muted'}">${r.late || 0}</td>
          <td class="text-center fw-bold ${r.leave > 0 ? 'text-info' : 'text-muted'}">${r.leave || 0}</td>
          <td class="text-center fw-bold ${r.activity > 0 ? '' : 'text-muted'}" style="${r.activity > 0 ? 'color:#8e44ad;' : ''}">${r.activity || 0}</td>
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="pct-bar flex-grow-1">
                <div class="pct-bar-fill" style="width:${pct}%;background:${pctColor};"></div>
              </div>
              <span style="min-width:2.5rem;font-size:.8rem;font-weight:600;color:${pctColor};">${total > 0 ? pct+'%' : '-'}</span>
            </div>
          </td>
          <td class="text-center"><span class="badge bg-${scoreColor}">${r.score}</span></td>
        </tr>`;
      });
      html += `</tbody></table></div></div>`;
    });

  document.getElementById('reportTable').innerHTML = html;
}

function exportReport() {
  window.location.href = '/api/report/export?' + lastQuery;
  showToast('กำลังดาวน์โหลด Excel...');
}
