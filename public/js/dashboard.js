document.addEventListener('DOMContentLoaded', async () => {
  // Greeting ตามเวลา
  const h = new Date().getHours();
  const greet = h < 12 ? 'สวัสดีตอนเช้า 🌅'
              : h < 17 ? 'สวัสดีตอนบ่าย ☀️'
              : 'สวัสดีตอนเย็น 🌙';
  await loadCurrentUser();
  const userName = currentUser?.full_name || currentUser?.username || '';
  document.getElementById('heroGreeting').textContent =
    userName ? `${greet}, คุณ${userName}` : greet;
  document.getElementById('thaiDate').innerHTML =
    `<i class="bi bi-calendar3 me-1"></i>${formatThaiDateFull(todayISO())}`;

  try {
    const d = await apiFetch('/api/dashboard');
    document.getElementById('statTotal').textContent   = d.total;
    document.getElementById('statPresent').textContent = d.today?.present ?? 0;
    document.getElementById('statAbsent').textContent  = d.today?.absent  ?? 0;
    document.getElementById('statLate').textContent    = d.today?.late    ?? 0;
    document.getElementById('statLeave').textContent   = d.today?.leave   ?? 0;
    const heroC = document.getElementById('heroClasses');
    if (heroC) heroC.textContent = (d.classSummary || []).length;

    document.getElementById('monPresent').textContent = d.monthStats?.present ?? 0;
    document.getElementById('monAbsent').textContent  = d.monthStats?.absent  ?? 0;
    document.getElementById('monLate').textContent    = d.monthStats?.late    ?? 0;
    document.getElementById('monDays').textContent    = d.monthStats?.days    ?? 0;

    renderAlerts(d.alerts || [], d.alertThreshold);
    renderBehavior(d.behavior || {});
    renderClassGrid(d.classSummary);
    renderTodayChart(d.today || {});
    loadWeeklyChart();
  } catch (e) {
    if (e.message !== 'unauthorized') {
      document.getElementById('classGrid').innerHTML =
        `<div class="alert alert-danger">${e.message}</div>`;
    }
  }
});

function renderAlerts(alerts, threshold) {
  const row = document.getElementById('alertRow');
  if (!alerts || alerts.length === 0) { row.style.display = 'none'; return; }

  row.style.display = '';
  document.getElementById('alertCount').textContent = alerts.length + ' คน';

  let html = '<div class="table-responsive"><table class="table table-sm mb-0">';
  html += `<thead class="table-light"><tr>
    <th>ชั้น</th><th>เลขที่</th><th>ชื่อ-นามสกุล</th>
    <th class="text-center">ขาดเรียน (เดือนนี้)</th><th></th>
  </tr></thead><tbody>`;

  alerts.forEach(a => {
    html += `<tr>
      <td><span class="badge bg-primary">ม.${a.class_level}/${a.room}</span></td>
      <td>${a.number ?? '-'}</td>
      <td class="fw-500">${a.name}</td>
      <td class="text-center"><span class="badge bg-danger">${a.absent_count} ครั้ง</span></td>
      <td><a href="/behavior.html?id=${a.id}" class="btn btn-sm btn-outline-primary">
        <i class="bi bi-person-lines-fill"></i> ดูข้อมูล
      </a></td>
    </tr>`;
  });

  html += `</tbody></table></div>
    <div class="text-muted small p-2 text-end">
      <i class="bi bi-info-circle"></i> เกณฑ์: ขาดเรียนเกิน ${threshold} ครั้ง/เดือน
    </div>`;
  document.getElementById('alertList').innerHTML = html;
}

function renderTodayChart(t) {
  const canvas = document.getElementById('todayChart');
  if (!canvas || typeof Chart === 'undefined') return;
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['มา', 'ขาด', 'มาสาย', 'ลา', 'ไปกิจกรรม'],
      datasets: [{
        data: [t.present || 0, t.absent || 0, t.late || 0, t.leave || 0, t.activity || 0],
        backgroundColor: ['#198754', '#dc3545', '#fd7e14', '#0dcaf0', '#8e44ad']
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

async function loadWeeklyChart() {
  const canvas = document.getElementById('weeklyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  try {
    const rows = await apiFetch('/api/charts/weekly');
    const labels = rows.map(r => {
      const d = new Date(r.date + 'T00:00:00');
      return `${d.getDate()}/${d.getMonth()+1}`;
    });
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'มา',         data: rows.map(r=>r.present  ||0), backgroundColor: '#198754' },
          { label: 'ขาด',        data: rows.map(r=>r.absent   ||0), backgroundColor: '#dc3545' },
          { label: 'มาสาย',      data: rows.map(r=>r.late     ||0), backgroundColor: '#fd7e14' },
          { label: 'ลา',         data: rows.map(r=>r.leave    ||0), backgroundColor: '#0dcaf0' },
          { label: 'ไปกิจกรรม',  data: rows.map(r=>r.activity ||0), backgroundColor: '#8e44ad' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom' } }
      }
    });
  } catch {}
}

function renderBehavior(b) {
  document.getElementById('bhvAvg').textContent = b.avgScore ?? '-';
  document.getElementById('bhvMin').textContent = b.minScore ?? '-';
  document.getElementById('bhvDeducted').textContent = (b.deductedCount ?? 0) + ' คน';
  document.getElementById('bhvMonthEvents').textContent = b.monthEvents ?? 0;
  document.getElementById('bhvMonthDeduction').textContent = b.monthDeduction ?? 0;

  // Color avg score based on start score
  const start = b.startScore || 100;
  const pct = b.avgScore / start;
  const el = document.getElementById('bhvAvg');
  el.className = `display-6 fw-bold text-${pct >= 0.8 ? 'success' : pct >= 0.6 ? 'warning' : 'danger'}`;
  // Color min score
  const minEl = document.getElementById('bhvMin');
  const minPct = b.minScore / start;
  minEl.className = `display-6 fw-bold text-${minPct >= 0.8 ? 'success' : minPct >= 0.6 ? 'warning' : 'danger'}`;

  // Low score list
  const list = document.getElementById('lowScoreList');
  if (!b.lowScores || b.lowScores.length === 0) {
    list.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="bi bi-emoji-smile fs-3 d-block mb-2"></i>
        ยังไม่มีนักเรียนที่ถูกหักคะแนน
      </div>`;
    return;
  }

  let html = '<div class="table-responsive"><table class="table table-hover table-sm mb-0">';
  html += `<thead class="table-light"><tr>
    <th class="text-center">ชั้น</th>
    <th>นักเรียน</th>
    <th class="text-center">คะแนนหัก</th>
    <th class="text-center">คงเหลือ</th>
    <th></th>
  </tr></thead><tbody>`;
  b.lowScores.forEach(s => {
    const color = s.score >= (b.startScore || 100) * 0.8 ? 'success'
                : s.score >= (b.startScore || 100) * 0.6 ? 'warning' : 'danger';
    html += `<tr>
      <td class="text-center"><span class="badge bg-primary">ม.${s.class_level}/${s.room}</span></td>
      <td>${s.number ? `<small class="text-muted">เลขที่ ${s.number}</small> ` : ''}<span class="fw-500">${s.name}</span></td>
      <td class="text-center text-danger fw-bold">${s.delta}</td>
      <td class="text-center"><span class="badge bg-${color}">${s.score}</span></td>
      <td><a href="/behavior.html?id=${s.id}" class="btn btn-sm btn-outline-primary" title="ดู">
        <i class="bi bi-person-lines-fill"></i></a></td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  list.innerHTML = html;
}

function renderClassGrid(classes) {
  const grid = document.getElementById('classGrid');
  if (!classes || classes.length === 0) {
    grid.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-inbox fs-1 d-block mb-3"></i>
        <p class="mb-2">ยังไม่มีข้อมูลนักเรียน</p>
        <a href="/students.html" class="btn btn-primary btn-sm">
          <i class="bi bi-upload me-1"></i>นำเข้ารายชื่อนักเรียน
        </a>
      </div>`;
    return;
  }

  const byLevel = {};
  classes.forEach(c => {
    if (!byLevel[c.class_level]) byLevel[c.class_level] = [];
    byLevel[c.class_level].push(c);
  });

  let html = '';
  for (const level of [1,2,3,4,5,6]) {
    if (!byLevel[level]) continue;
    html += `<div class="mb-3">
      <div class="fw-bold text-muted mb-2" style="font-size:.88rem;">ชั้นมัธยมศึกษาปีที่ ${level}</div>
      <div class="row g-2">`;

    for (const cls of byLevel[level]) {
      const done = cls.checked >= cls.total && cls.total > 0;
      const pct  = cls.total > 0 ? Math.round(cls.checked / cls.total * 100) : 0;
      const badge = done
        ? `<span class="checked-badge badge bg-success">เช็คแล้ว</span>`
        : cls.checked > 0
        ? `<span class="checked-badge badge bg-warning text-dark">${pct}%</span>`
        : `<span class="checked-badge badge bg-secondary">ยังไม่ได้เช็ค</span>`;

      html += `
        <div class="col-6 col-sm-4 col-lg-3">
          <a href="/attendance.html?level=${cls.class_level}&room=${cls.room}" class="class-card">
            <div class="class-badge">ม.${cls.class_level}/${cls.room}</div>
            <div class="class-info">
              <div style="font-size:.9rem; font-weight:600;">${cls.total} คน</div>
              <small>${cls.checked}/${cls.total} เช็คแล้ว</small>
            </div>
            ${badge}
          </a>
        </div>`;
    }
    html += `</div></div>`;
  }
  grid.innerHTML = html;
}
