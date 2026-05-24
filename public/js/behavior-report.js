let lastQuery = '';
let currentTab = 'summary'; // 'summary' or 'log'

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  try { window._classes = await apiFetch('/api/classes'); } catch {}

  document.getElementById('fYear').value = thaiYear();
  document.getElementById('fMonth').value = todayISO().slice(0, 7);

  document.querySelectorAll('input[name="filterMode"]').forEach(r =>
    r.addEventListener('change', toggleMode)
  );

  document.querySelectorAll('#reportTabs button').forEach(btn =>
    btn.addEventListener('shown.bs.tab', (e) => {
      currentTab = e.target.dataset.bsTarget === '#summaryTab' ? 'summary' : 'log';
      document.getElementById('sourceInput').style.display = currentTab === 'log' ? '' : 'none';
    })
  );
});

function toggleMode() {
  const mode = document.querySelector('input[name="filterMode"]:checked').value;
  document.getElementById('dateInputs').style.display  = mode === 'date'     ? '' : 'none';
  document.getElementById('monthInputs').style.display = mode === 'month'    ? '' : 'none';
  document.getElementById('semInputs').style.display   = mode === 'semester' ? '' : 'none';
}

function onLevelChange() {
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

function getParams() {
  const mode = document.querySelector('input[name="filterMode"]:checked').value;
  const p = new URLSearchParams();
  const level = document.getElementById('fLevel').value;
  const room  = document.getElementById('fRoom').value;
  if (level) p.set('level', level);
  if (room)  p.set('room', room);

  if (mode === 'date') {
    const f = document.getElementById('fFrom').value;
    const t = document.getElementById('fTo').value;
    if (f) p.set('from', f);
    if (t) p.set('to',   t);
  } else if (mode === 'month') {
    const m = document.getElementById('fMonth').value;
    if (m) {
      const [yy, mm] = m.split('-');
      const lastDay = new Date(+yy, +mm, 0).getDate();
      p.set('from', `${yy}-${mm}-01`);
      p.set('to',   `${yy}-${mm}-${String(lastDay).padStart(2,'0')}`);
    }
  } else if (mode === 'semester') {
    const s = document.getElementById('fSem').value;
    const y = document.getElementById('fYear').value;
    if (s && y) { p.set('semester', s); p.set('year', String(+y - 543)); }
  }
  // For log tab
  if (currentTab === 'log') {
    const src = document.getElementById('fSource').value;
    if (src) p.set('source', src);
  }
  return p;
}

async function loadReport() {
  const params = getParams();
  lastQuery = params.toString();

  if (currentTab === 'summary') await loadSummary(params);
  else await loadLogs(params);
}

async function loadSummary(params) {
  document.getElementById('summaryResult').innerHTML = `<div class="text-center py-4">
    <div class="spinner-border text-primary mb-2"></div></div>`;
  try {
    const d = await apiFetch('/api/behavior/report?' + params);
    renderSummary(d);
  } catch (e) {
    document.getElementById('summaryResult').innerHTML =
      `<div class="alert alert-danger">${e.message}</div>`;
  }
}

async function loadLogs(params) {
  document.getElementById('logResult').innerHTML = `<div class="text-center py-4">
    <div class="spinner-border text-primary mb-2"></div></div>`;
  try {
    const d = await apiFetch('/api/behavior/logs?' + params);
    renderLogs(d);
  } catch (e) {
    document.getElementById('logResult').innerHTML =
      `<div class="alert alert-danger">${e.message}</div>`;
  }
}

function renderRangeInfo(range, prefix) {
  const el = document.getElementById('rangeInfo');
  if (range && (range.from || range.to)) {
    let t = '';
    if (range.from && range.to) t = `${formatThaiDateShort(range.from)} — ${formatThaiDateShort(range.to)}`;
    else if (range.from)        t = `ตั้งแต่ ${formatThaiDateShort(range.from)}`;
    else                        t = `ถึง ${formatThaiDateShort(range.to)}`;
    el.innerHTML = `<i class="bi bi-calendar-range me-2"></i>${prefix} • ช่วงข้อมูล: ${t}`;
    el.style.display = '';
    document.getElementById('printTitle').textContent = `${prefix} • ${t}`;
  } else {
    el.innerHTML = `<i class="bi bi-infinity me-2"></i>${prefix} • ตลอดทั้งหมด`;
    el.style.display = '';
    document.getElementById('printTitle').textContent = `${prefix} • ตลอดทั้งหมด`;
  }
}

function renderSummary(d) {
  renderRangeInfo(d.range, 'รายงานคะแนนความประพฤติ');
  document.getElementById('actionBar').style.display = '';

  const rows = d.rows;
  if (!rows.length) {
    document.getElementById('summaryResult').innerHTML =
      `<div class="text-center text-muted py-5"><i class="bi bi-inbox fs-1 d-block mb-2"></i>ไม่พบข้อมูล</div>`;
    document.getElementById('resultCount').textContent = '(0 คน)';
    return;
  }
  document.getElementById('resultCount').textContent = `(${rows.length} คน)`;

  const groups = {};
  rows.forEach(r => {
    const k = `${r.class_level}_${r.room}`;
    if (!groups[k]) groups[k] = { level: r.class_level, room: r.room, rows: [] };
    groups[k].rows.push(r);
  });

  let html = '';
  Object.values(groups).sort((a,b) => a.level - b.level || a.room - b.room).forEach(g => {
    const classDeduction = g.rows.reduce((s, r) => s + (r.range_delta || 0), 0);
    html += `<div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span class="fw-bold"><i class="bi bi-journal-text me-2"></i>ม.${g.level}/${g.room}</span>
        <div>
          <span class="badge bg-primary me-1">${g.rows.length} คน</span>
          ${classDeduction !== 0 ? `<span class="badge bg-danger">หักรวม ${classDeduction} คะแนน</span>` : ''}
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-hover table-sm mb-0 report-table" style="font-size:.88rem;">
          <thead>
            <tr>
              <th class="text-center">เลขที่</th>
              <th>ชื่อ-นามสกุล</th>
              <th class="text-center">ครั้งที่หัก</th>
              <th class="text-center">หักช่วงนี้</th>
              <th class="text-center">ออโต้</th>
              <th class="text-center">บันทึกเอง</th>
              <th class="text-center">คะแนนคงเหลือ</th>
              <th></th>
            </tr>
          </thead><tbody>`;

    g.rows.forEach(r => {
      const cs = r.current_score;
      const color = cs >= d.start_score * 0.8 ? 'success' : cs >= d.start_score * 0.6 ? 'warning' : 'danger';
      html += `<tr${r.range_delta < 0 ? ' class="table-warning"' : ''}>
        <td class="text-center">${r.number ?? ''}</td>
        <td><a href="/behavior.html?id=${r.id}" class="text-decoration-none text-dark fw-500">${r.name}</a></td>
        <td class="text-center">${r.event_count || 0}</td>
        <td class="text-center fw-bold ${r.range_delta < 0 ? 'text-danger' : 'text-muted'}">${r.range_delta || 0}</td>
        <td class="text-center text-secondary">${r.auto_delta || 0}</td>
        <td class="text-center text-info">${r.manual_delta || 0}</td>
        <td class="text-center"><span class="badge bg-${color} fs-6">${cs}</span></td>
        <td class="no-print"><a href="/behavior.html?id=${r.id}" class="btn btn-sm btn-outline-primary">
          <i class="bi bi-eye"></i></a></td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  });

  document.getElementById('summaryResult').innerHTML = html;
}

function renderLogs(d) {
  renderRangeInfo(d.range, 'ประวัติการหักคะแนนย้อนหลัง');
  document.getElementById('actionBar').style.display = '';

  const rows = d.rows;
  if (!rows.length) {
    document.getElementById('logResult').innerHTML =
      `<div class="text-center text-muted py-5"><i class="bi bi-inbox fs-1 d-block mb-2"></i>ไม่พบประวัติ</div>`;
    document.getElementById('resultCount').textContent = '(0 รายการ)';
    return;
  }
  document.getElementById('resultCount').textContent = `(${rows.length} รายการ)`;

  // Group by date
  const byDate = {};
  rows.forEach(r => { if (!byDate[r.date]) byDate[r.date] = []; byDate[r.date].push(r); });

  let html = `<div class="card"><div class="table-responsive">
    <table class="table table-hover table-sm mb-0 report-table" style="font-size:.88rem;">
      <thead>
        <tr>
          <th style="width:120px;">วันที่</th>
          <th style="width:80px;" class="text-center">ชั้น</th>
          <th>นักเรียน</th>
          <th class="text-center">คะแนน</th>
          <th>เหตุผล</th>
          <th>ประเภท</th>
          <th>ผู้บันทึก</th>
        </tr>
      </thead><tbody>`;

  Object.keys(byDate).sort((a,b) => b.localeCompare(a)).forEach(date => {
    const grp = byDate[date];
    const totalDay = grp.reduce((s, r) => s + r.points, 0);
    html += `<tr class="table-light"><td colspan="7" class="fw-bold py-1">
      <i class="bi bi-calendar3 me-2"></i>${formatThaiDateShort(date)}
      <span class="badge bg-secondary ms-2">${grp.length} รายการ</span>
      ${totalDay !== 0 ? `<span class="badge bg-${totalDay < 0 ? 'danger' : 'success'} ms-1">รวม ${totalDay}</span>` : ''}
    </td></tr>`;

    grp.forEach(r => {
      const sourceLabel = r.source === 'attendance'
        ? '<span class="badge bg-secondary">อัตโนมัติ</span>'
        : '<span class="badge bg-info">บันทึกเอง</span>';
      html += `<tr>
        <td></td>
        <td class="text-center"><span class="badge bg-primary">ม.${r.class_level}/${r.room}</span></td>
        <td>
          <a href="/behavior.html?id=${r.student_id}" class="text-decoration-none text-dark fw-500">${r.name}</a>
          ${r.number ? `<small class="text-muted ms-2">เลขที่ ${r.number}</small>` : ''}
        </td>
        <td class="text-center fw-bold ${r.points < 0 ? 'text-danger' : 'text-success'}">${r.points > 0 ? '+' : ''}${r.points}</td>
        <td>${r.reason}</td>
        <td>${sourceLabel}</td>
        <td class="text-muted small">${r.recorded_by_name || '-'}</td>
      </tr>`;
    });
  });
  html += `</tbody></table></div></div>`;
  document.getElementById('logResult').innerHTML = html;
}

function exportReport() {
  const endpoint = currentTab === 'summary' ? '/api/behavior/report/export' : '/api/behavior/logs/export';
  window.location.href = endpoint + '?' + lastQuery;
  showToast('กำลังดาวน์โหลด Excel...');
}
