let currentStudents = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  document.getElementById('selDate').value = todayISO();
  await loadClassDropdown();

  // Pre-fill from URL params
  const params = new URLSearchParams(location.search);
  if (params.get('level') && params.get('room')) {
    document.getElementById('selClass').value = `${params.get('level')}_${params.get('room')}`;
    syncHiddenInputs();
    loadAttendance();
  }

  document.getElementById('selClass').addEventListener('change', syncHiddenInputs);
});

async function loadClassDropdown() {
  try {
    const classes = await apiFetch('/api/classes');
    window._allClasses = classes;
    const sel = document.getElementById('selClass');
    sel.innerHTML = '<option value="">-- เลือกชั้น/ห้อง --</option>';
    // Group by level
    const grouped = {};
    classes.forEach(c => {
      if (!grouped[c.class_level]) grouped[c.class_level] = [];
      grouped[c.class_level].push(c);
    });
    Object.keys(grouped).sort((a,b) => +a - +b).forEach(level => {
      const group = document.createElement('optgroup');
      group.label = `มัธยมศึกษาปีที่ ${level}`;
      grouped[level].forEach(c => {
        const opt = document.createElement('option');
        opt.value = `${c.class_level}_${c.room}`;
        opt.textContent = `ม.${c.class_level}/${c.room}  (${c.count} คน)`;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    });
    // Auto select first option if only one class
    if (classes.length === 1) {
      sel.value = `${classes[0].class_level}_${classes[0].room}`;
      syncHiddenInputs();
    }
  } catch {}
}

function syncHiddenInputs() {
  const val = document.getElementById('selClass').value;
  if (val) {
    const [level, room] = val.split('_');
    document.getElementById('selLevel').value = level;
    document.getElementById('selRoom').value = room;
  } else {
    document.getElementById('selLevel').value = '';
    document.getElementById('selRoom').value = '';
  }
}

async function loadAttendance() {
  const level = document.getElementById('selLevel').value;
  const room  = document.getElementById('selRoom').value;
  const date  = document.getElementById('selDate').value;

  if (!level || !room || !date) {
    showToast('กรุณาเลือกชั้น ห้อง และวันที่', 'warning'); return;
  }

  document.getElementById('studentSection').innerHTML = `
    <div class="text-center py-4 text-muted">
      <div class="spinner-border text-primary mb-2" role="status"></div>
      <div>กำลังโหลดรายชื่อ...</div>
    </div>`;

  try {
    const students = await apiFetch(`/api/attendance?level=${level}&room=${room}&date=${date}`);
    currentStudents = students;
    renderStudents(students, level, room, date);
    document.getElementById('counterSection').style.display = '';
    document.getElementById('saveSection').style.display = '';
    updateCounters();
  } catch (e) {
    document.getElementById('studentSection').innerHTML =
      `<div class="alert alert-danger">เกิดข้อผิดพลาด: ${e.message}</div>`;
  }
}

function renderStudents(students, level, room, date) {
  const sec = document.getElementById('studentSection');

  if (students.length === 0) {
    sec.innerHTML = `<div class="alert alert-info">
      <i class="bi bi-info-circle me-2"></i>ไม่พบรายชื่อนักเรียนในชั้น ม.${level}/${room}
    </div>`;
    return;
  }

  const alreadyRecorded = students.some(s => s.is_recorded);

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <div class="section-title mb-0">
        <i class="bi bi-people-fill me-2"></i>ม.${level}/${room} — ${formatThaiDateShort(date)}
        ${alreadyRecorded ? '<span class="badge bg-success ms-2" style="font-size:.8rem;">บันทึกแล้ว</span>' : ''}
      </div>
      <span class="text-muted" style="font-size:.9rem;">${students.length} คน</span>
    </div>
    <div class="student-list">`;

  students.forEach(s => {
    const statuses = [
      { key: 'present',  label: 'มา',         cls: 'success' },
      { key: 'absent',   label: 'ขาด',        cls: 'danger'  },
      { key: 'leave',    label: 'ลา',         cls: 'info'    },
      { key: 'late',     label: 'มาสาย',      cls: 'warning' },
      { key: 'activity', label: 'ไปกิจกรรม',  cls: 'purple'  },
    ];

    const btnHtml = statuses.map(st => {
      const active = s.status === st.key;
      return `<button type="button"
        class="btn btn-sm ${active ? `btn-${st.cls}` : `btn-outline-${st.cls}`} status-btn"
        data-status="${st.key}">${st.label}</button>`;
    }).join('');

    const scoreColor = s.score >= 80 ? 'success' : s.score >= 60 ? 'warning' : 'danger';
    html += `
      <div class="student-row status-${s.status}" data-id="${s.id}" data-status="${s.status}">
        <div class="student-num">${s.number ?? ''}</div>
        <div class="flex-grow-1">
          <div class="student-name">${s.name}</div>
          <div class="d-flex align-items-center gap-2">
            ${s.student_code ? `<span class="student-code">${s.student_code}</span>` : ''}
            <a href="/behavior.html?id=${s.id}" class="badge bg-${scoreColor}" style="text-decoration:none;"
              title="คะแนนความประพฤติ"><i class="bi bi-award me-1"></i>${s.score}</a>
          </div>
        </div>
        <div class="status-btns btn-group btn-group-sm" role="group">${btnHtml}</div>
        <div class="note-wrap">
          <input type="text" class="form-control form-control-sm note-input"
            placeholder="หมายเหตุ" value="${s.note ?? ''}" style="font-size:.82rem;">
        </div>
      </div>`;
  });

  html += '</div>';
  sec.innerHTML = html;

  // Bind status buttons
  sec.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const row    = this.closest('.student-row');
      const status = this.dataset.status;
      const colors = {
        present: 'success', absent: 'danger',
        late: 'warning', leave: 'info', activity: 'purple'
      };

      row.querySelectorAll('.status-btn').forEach(b => {
        const s = b.dataset.status;
        b.className = `btn btn-sm btn-outline-${colors[s]} status-btn`;
      });
      this.className = `btn btn-sm btn-${colors[status]} status-btn`;

      row.dataset.status = status;
      row.className = `student-row status-${status}`;

      // Update currentStudents
      const sid = +row.dataset.id;
      const stu = currentStudents.find(s => s.id === sid);
      if (stu) stu.status = status;

      updateCounters();
    });
  });
}

function updateCounters() {
  const sec = document.getElementById('studentSection');
  const rows = sec.querySelectorAll('.student-row');
  let counts = { present: 0, absent: 0, late: 0, leave: 0, activity: 0 };
  rows.forEach(r => { if (counts[r.dataset.status] !== undefined) counts[r.dataset.status]++; });
  document.getElementById('cntPresent').textContent  = counts.present;
  document.getElementById('cntAbsent').textContent   = counts.absent;
  document.getElementById('cntLate').textContent     = counts.late;
  document.getElementById('cntLeave').textContent    = counts.leave;
  const elAct = document.getElementById('cntActivity');
  if (elAct) elAct.textContent = counts.activity;
}

function setAll(status) {
  const colors = { present: 'success', absent: 'danger', late: 'warning', leave: 'info', activity: 'purple' };
  document.querySelectorAll('.student-row').forEach(row => {
    row.dataset.status = status;
    row.className = `student-row status-${status}`;
    row.querySelectorAll('.status-btn').forEach(b => {
      const s = b.dataset.status;
      b.className = `btn btn-sm ${s === status ? `btn-${colors[s]}` : `btn-outline-${colors[s]}`} status-btn`;
    });
  });
  currentStudents.forEach(s => s.status = status);
  updateCounters();
}

function printRollcall() {
  const level = document.getElementById('selLevel').value;
  const room  = document.getElementById('selRoom').value;
  if (!level || !room) { showToast('เลือกชั้นและห้องก่อน', 'warning'); return; }
  window.open(`/rollcall.html?level=${level}&room=${room}`, '_blank');
}

async function saveAttendance() {
  const level = document.getElementById('selLevel').value;
  const room  = document.getElementById('selRoom').value;
  const date  = document.getElementById('selDate').value;
  if (!level || !room || !date) return;

  const rows    = document.querySelectorAll('.student-row');
  const records = [];
  rows.forEach(row => {
    const note = row.querySelector('.note-input')?.value.trim() || null;
    records.push({ student_id: +row.dataset.id, status: row.dataset.status, note });
  });

  if (records.length === 0) { showToast('ไม่มีข้อมูลให้บันทึก', 'warning'); return; }

  const btn = document.querySelector('.btn-save-big');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก...';

  try {
    const res = await apiFetch('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({ date, records })
    });
    showToast(res.message, 'success');
    await loadAttendance();
  } catch (e) {
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-save2-fill me-2"></i>บันทึกการเช็คชื่อ';
  }
}
