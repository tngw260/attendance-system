let allStudents = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  loadStudents();
  setupDragDrop();
});

async function genParentCode(sid) {
  try {
    const res = await apiFetch(`/api/students/${sid}/parent-code`, { method: 'POST' });
    showToast('สร้างรหัสผู้ปกครองสำเร็จ: ' + res.code);
    loadStudents();
    setTimeout(() => showParentCode(sid), 500);
  } catch (e) { showToast(e.message, 'danger'); }
}

async function showParentCode(sid) {
  try {
    const students = await apiFetch('/api/students');
    const s = students.find(x => x.id === sid);
    if (!s || !s.parent_code) {
      showToast('ยังไม่มีรหัสผู้ปกครอง', 'warning');
      return;
    }
    const url = `${location.origin}/parent.html?code=${s.parent_code}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;

    const modal = document.getElementById('parentCodeModal') || (() => {
      const div = document.createElement('div');
      div.id = 'parentCodeModal';
      div.className = 'modal fade';
      div.innerHTML = `<div class="modal-dialog modal-dialog-centered">
        <div class="modal-content"><div class="modal-header bg-success text-white">
          <h5 class="modal-title"><i class="bi bi-qr-code me-2"></i>รหัสผู้ปกครอง</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div><div class="modal-body" id="pcBody"></div>
        <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">ปิด</button>
          <button class="btn btn-primary" onclick="printParentSheet()"><i class="bi bi-printer me-1"></i>พิมพ์ใบแจกผู้ปกครอง</button>
        </div></div></div>`;
      document.body.appendChild(div);
      return div;
    })();

    document.getElementById('pcBody').innerHTML = `
      <div class="text-center">
        <div class="fw-bold mb-1">${s.name}</div>
        <div class="text-muted small mb-3">ม.${s.class_level}/${s.room} ${s.number ? '• เลขที่ '+s.number : ''}</div>
        <div class="mb-3"><img src="${qrUrl}" alt="QR" style="width:220px;height:220px;border:1px solid #ddd;border-radius:8px;padding:8px;"></div>
        <div class="mb-2">รหัสผู้ปกครอง:</div>
        <div class="display-5 fw-bold text-success mb-3" style="letter-spacing:.3em; font-family:monospace;">${s.parent_code}</div>
        <div class="input-group mb-2">
          <input type="text" class="form-control text-center small" value="${url}" id="pcUrl" readonly>
          <button class="btn btn-outline-primary" onclick="navigator.clipboard.writeText(document.getElementById('pcUrl').value); showToast('คัดลอกแล้ว');">
            <i class="bi bi-clipboard"></i>
          </button>
        </div>
        <button class="btn btn-sm btn-link text-danger" onclick="regenParentCode(${s.id})">
          <i class="bi bi-arrow-repeat me-1"></i>สร้างรหัสใหม่ (รหัสเดิมจะใช้ไม่ได้)
        </button>
      </div>`;
    // Store for print
    window._currentParentInfo = { student: s, url, qrUrl };
    new bootstrap.Modal(modal).show();
  } catch (e) { showToast(e.message, 'danger'); }
}

async function regenParentCode(sid) {
  if (!confirm('สร้างรหัสใหม่? รหัสเดิมจะใช้ไม่ได้ทันที')) return;
  await genParentCode(sid);
}

async function bulkGenCodes(level, room) {
  if (!confirm(`สร้างรหัสผู้ปกครองให้ทุกคนใน ม.${level}/${room} ที่ยังไม่มี?`)) return;
  try {
    const res = await apiFetch('/api/students/parent-codes/bulk', {
      method: 'POST', body: JSON.stringify({ level, room })
    });
    showToast(res.message);
    loadStudents();
  } catch (e) { showToast(e.message, 'danger'); }
}

function printParentSheet() {
  const info = window._currentParentInfo;
  if (!info) return;
  const s = info.student;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>ใบแจ้งผู้ปกครอง — ${s.name}</title>
    <style>
      @page { size: A5; margin: 12mm; }
      body { font-family: 'Sarabun', sans-serif; text-align: center; padding: 20px; }
      .logo { width: 90px; height: 90px; border-radius: 50%; }
      h2 { margin: 8px 0 0; }
      h3 { margin: 4px 0 20px; color: #666; font-weight: normal; }
      .student-name { font-size: 1.4rem; font-weight: bold; margin: 16px 0 4px; }
      .student-class { color: #555; margin-bottom: 18px; }
      .qr { width: 200px; height: 200px; border: 1px solid #ccc; padding: 6px; border-radius: 8px; }
      .code-label { margin-top: 14px; color: #555; }
      .code { font-size: 2.2rem; font-weight: bold; letter-spacing: .3em;
              font-family: 'Courier New', monospace; color: #1a5276; margin: 6px 0; }
      .url { font-family: monospace; font-size: .85rem; word-break: break-all;
             color: #666; background: #f5f5f5; padding: 8px 10px; border-radius: 4px;
             margin: 10px 30px; }
      .instructions { text-align: left; margin: 16px 30px 0; padding: 12px 16px;
                      background: #fffbe6; border-left: 4px solid #f0b400; font-size: .9rem; }
      .instructions strong { display: block; margin-bottom: 6px; }
      .instructions ol { margin: 0; padding-left: 20px; }
    </style></head><body>
    <div>
      <img class="logo" src="/assets/school_logo.png" onerror="this.style.display='none'">
      <h2>โรงเรียนตะกั่วทุ่งงานทวีวิทยาคม</h2>
      <h3>ระบบเช็คชื่อ — รหัสเข้าดูข้อมูลของผู้ปกครอง</h3>
    </div>
    <div class="student-name">${s.name}</div>
    <div class="student-class">ม.${s.class_level}/${s.room} ${s.number ? '• เลขที่ '+s.number : ''} ${s.student_code ? '• '+s.student_code : ''}</div>
    <img class="qr" src="${info.qrUrl}">
    <div class="code-label">รหัสผู้ปกครอง</div>
    <div class="code">${s.parent_code}</div>
    <div class="url">${info.url}</div>
    <div class="instructions">
      <strong>วิธีใช้:</strong>
      <ol>
        <li>สแกน QR Code ด้วยกล้องมือถือ หรือเข้าเว็บไซต์ด้านบน</li>
        <li>กรอกรหัส 6 ตัว แล้วกด "เข้าดู"</li>
        <li>ดูข้อมูลการมาเรียนและคะแนนความประพฤติของบุตรหลานได้ตลอด 24 ชั่วโมง</li>
      </ol>
    </div>
    <script>window.onload = () => setTimeout(() => window.print(), 400);</script>
  </body></html>`);
  w.document.close();
}

function setupDragDrop() {
  const zone = document.getElementById('dropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

async function handleFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls'].includes(ext)) {
    showToast('กรุณาเลือกไฟล์ Excel (.xlsx หรือ .xls)', 'warning'); return;
  }

  document.getElementById('importProgress').style.display = '';
  document.getElementById('importResult').style.display = 'none';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/students/import', { method: 'POST', body: formData });
    const data = await res.json();

    document.getElementById('importProgress').style.display = 'none';
    const resultEl = document.getElementById('importResult');
    resultEl.style.display = '';

    if (data.success) {
      resultEl.innerHTML = `
        <div class="alert alert-success mb-0">
          <i class="bi bi-check-circle-fill me-2"></i>
          <strong>${data.message}</strong>
          ${data.errors > 0 ? `<div class="mt-1 small text-muted">ข้ามแถวที่ไม่ถูกต้อง ${data.errors} แถว</div>` : ''}
        </div>`;
      showToast(data.message, 'success');
      await loadStudents();
    } else {
      resultEl.innerHTML = `<div class="alert alert-danger mb-0"><i class="bi bi-x-circle-fill me-2"></i>${data.message}</div>`;
      showToast(data.message, 'danger');
    }
  } catch (e) {
    document.getElementById('importProgress').style.display = 'none';
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }

  document.getElementById('fileInput').value = '';
}

async function loadStudents() {
  try {
    allStudents = await apiFetch('/api/students');
    populateRoomFilter();
    renderTable(allStudents);
  } catch (e) {
    document.getElementById('studentTable').innerHTML =
      `<div class="alert alert-danger">ไม่สามารถโหลดข้อมูลได้: ${e.message}</div>`;
  }
}

function populateRoomFilter() {
  const level = document.getElementById('filterLevel').value;
  const rooms = [...new Set(
    allStudents.filter(s => !level || String(s.class_level) === level).map(s => s.room)
  )].sort((a, b) => a - b);

  const sel = document.getElementById('filterRoom');
  const cur = sel.value;
  sel.innerHTML = '<option value="">ทุกห้อง</option>';
  rooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = `ห้อง ${r}`;
    sel.appendChild(opt);
  });
  if (rooms.includes(+cur)) sel.value = cur;
}

function filterStudents() {
  const level  = document.getElementById('filterLevel').value;
  const room   = document.getElementById('filterRoom').value;
  const search = document.getElementById('filterSearch').value.toLowerCase();

  populateRoomFilter();

  const filtered = allStudents.filter(s => {
    const matchLevel  = !level  || String(s.class_level) === level;
    const matchRoom   = !room   || String(s.room) === room;
    const matchSearch = !search || s.name.toLowerCase().includes(search) ||
                        (s.student_code && s.student_code.includes(search));
    return matchLevel && matchRoom && matchSearch;
  });

  renderTable(filtered);
}

function renderTable(students) {
  const el = document.getElementById('studentTable');

  if (students.length === 0) {
    el.innerHTML = `<div class="text-center text-muted py-5">
      <i class="bi bi-search fs-2 d-block mb-2"></i>ไม่พบรายชื่อนักเรียน
    </div>`;
    return;
  }

  // Group by class_level + room
  const groups = {};
  students.forEach(s => {
    const key = `${s.class_level}_${s.room}`;
    if (!groups[key]) groups[key] = { level: s.class_level, room: s.room, students: [] };
    groups[key].students.push(s);
  });

  let html = '';
  Object.values(groups)
    .sort((a, b) => a.level - b.level || a.room - b.room)
    .forEach(g => {
      html += `
        <div class="card mb-3">
          <div class="card-header d-flex justify-content-between align-items-center py-2">
            <div>
              <span class="fw-bold">ม.${g.level}/${g.room}</span>
              <span class="badge bg-primary ms-1">${g.students.length} คน</span>
            </div>
            <button class="btn btn-sm btn-outline-success" onclick="bulkGenCodes(${g.level}, ${g.room})">
              <i class="bi bi-qr-code-scan me-1"></i>สร้างรหัสผู้ปกครองทั้งห้อง
            </button>
          </div>
          <div class="table-responsive">
            <table class="table table-sm table-hover mb-0" style="font-size:.88rem;">
              <thead class="table-light">
                <tr>
                  <th style="width:3rem;">เลขที่</th>
                  <th style="width:7rem;">รหัส</th>
                  <th>ชื่อ-นามสกุล</th>
                  <th style="width:4rem;">เพศ</th>
                  <th style="width:11rem;">ผู้ปกครอง</th>
                  <th style="width:5rem;"></th>
                </tr>
              </thead>
              <tbody>`;

      g.students.forEach(s => {
        const adminBtn = currentUser?.role === 'admin'
          ? `<button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteStudent(${s.id}, '${s.name.replace(/'/g,"\\'")}')" title="ลบ"><i class="bi bi-trash"></i></button>` : '';
        const parentBadge = s.parent_code
          ? `<button class="btn btn-sm btn-outline-success" onclick="showParentCode(${s.id})" title="ดูรหัสผู้ปกครอง">
              <i class="bi bi-qr-code"></i> <code style="font-size:.75rem;">${s.parent_code}</code>
            </button>`
          : `<button class="btn btn-sm btn-outline-primary" onclick="genParentCode(${s.id})" title="สร้างรหัสผู้ปกครอง">
              <i class="bi bi-plus-circle"></i> สร้างรหัส
            </button>`;
        html += `<tr>
          <td class="text-center">${s.number ?? ''}</td>
          <td class="text-muted">${s.student_code ?? '-'}</td>
          <td>${s.name}</td>
          <td>${s.gender ?? ''}</td>
          <td>${parentBadge}</td>
          <td class="text-end">
            <a href="/behavior.html?id=${s.id}" class="btn btn-link btn-sm p-0 me-2" title="คะแนนความประพฤติ"><i class="bi bi-award"></i></a>
            ${adminBtn}
          </td>
        </tr>`;
      });

      html += `</tbody></table></div></div>`;
    });

  el.innerHTML = `<div class="text-muted small mb-2">พบ ${students.length} คน</div>` + html;
}

async function deleteStudent(id, name) {
  if (!confirm(`ลบ "${name}" ออกจากระบบ?`)) return;
  try {
    await apiFetch(`/api/students/${id}`, { method: 'DELETE' });
    showToast(`ลบ "${name}" แล้ว`, 'success');
    await loadStudents();
    filterStudents();
  } catch (e) {
    showToast('ลบไม่สำเร็จ: ' + e.message, 'danger');
  }
}

async function clearAll() {
  if (!confirm('ลบรายชื่อนักเรียนทั้งหมดและข้อมูลการเช็คชื่อทั้งหมด?\n\nการกระทำนี้ไม่สามารถย้อนกลับได้')) return;
  try {
    await apiFetch('/api/students/all', { method: 'DELETE' });
    showToast('ลบข้อมูลทั้งหมดแล้ว', 'success');
    await loadStudents();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}
