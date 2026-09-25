/* ===== ตัวจัดตารางสอน (แอดมิน) — ใช้คู่กับ timetable.html =====
   ลากวิชาไปวางในช่อง (หรือ แตะเลือก แล้วแตะช่อง — ใช้กับแท็บเล็ตได้)
   ช่องเขียว = วางได้ / เหลือง = ผิดเงื่อนไขอ่อน / แดง = ชน (ครูสอนซ้อน ห้องซ้อน ครูไม่ว่าง)
   สาย/กลุ่มผู้เรียน (ม.4-6): วิชาต่างสายวางช่องเดียวกันได้ ไม่นับว่าชน */

const ED = { by: 'class', key: '', picked: null, undo: [] };
const AREA_COLOR = { 'ท': '#f9d9dc', 'ค': '#d3e3ff', 'ว': '#d4ecdd', 'ส': '#ffe3bd', 'พ': '#cdf1ec',
                     'ศ': '#eadcf8', 'ง': '#f0e3d0', 'อ': '#dde3ff', 'จ': '#ffd8e8', 'I': '#e4e5e7' };
const colorOf = l => l.kind === 'activity' ? '#ececec' : (AREA_COLOR[(l.code || '')[0]] || '#f1f3f5');
const tracksOf = l => (l.track || '').split(',').map(s => s.trim()).filter(Boolean);
const lessonById = id => T.lessons.find(l => l.id === id);
const nPeriods = () => T.term.config.periods.length;
const lunchAfter = () => T.term.config.lunch_after || 4;
const slotHas = (l, d, p) => l.slots.some(s => s[0] === d && s[1] === p);
const lockedAt = (l, d, p) => l.slots.some(s => s[0] === d && s[1] === p && s[2]);

// ครูตั้งไว้ว่าไม่ว่าง (เช่น ไปธนาคารบ่ายวันศุกร์) — วิชาสอน = ชน / กิจกรรม (ประชุม ชุมนุม) = แค่เตือน
const isUnavailable = (tid, d, p) => (((IDX.teachers[tid] || {}).constraints || {}).unavailable || []).some(([a, b]) => a === d && b === p);
const unavReason = tid => ((IDX.teachers[tid] || {}).constraints || {}).note || 'เงื่อนไขครู';

// สองรายการในห้องเดียวกันเรียนพร้อมกันไม่ได้ ถ้ามีฝั่งใดเรียนทั้งห้อง หรือสายซ้อนกัน
function classOverlap(a, b) {
  const ta = tracksOf(a), tb = tracksOf(b);
  if (!ta.length || !tb.length) return true;
  return ta.some(t => tb.includes(t));
}

/* ── ปัญหาถ้าวางรายการ l ที่ (d,p) ── hard = ชนจริง / soft = ผิดเงื่อนไขที่ตั้งไว้ */
function conflictsAt(l, d, p) {
  const out = [];
  const others = (IDX.bySlot[`${d}-${p}`] || []).filter(x => x.id !== l.id);
  others.forEach(x => {
    const tc = x.teacher_ids.filter(t => l.teacher_ids.includes(t));
    if (tc.length) out.push({ hard: true, msg: `${tc.map(teacherShort).join(', ')} ติด ${lessonName(x)} ${classLabel(x)}` });
    const cc = x.classes.filter(c => l.classes.includes(c));
    if (cc.length && classOverlap(l, x)) out.push({ hard: true, msg: `${cc.map(classShort).join(', ')} เรียน ${lessonName(x)} อยู่แล้ว` });
  });
  l.teacher_ids.forEach(tid => {
    if (isUnavailable(tid, d, p))
      out.push({ hard: l.kind === 'subject', msg: `${teacherShort(tid)} ไม่ว่างคาบนี้ (${unavReason(tid)})` });
  });
  if (((l.options || {}).avoid || []).includes(p)) out.push({ hard: false, msg: `วิชานี้ตั้งให้เลี่ยงคาบ ${p}` });
  if (!(l.options || {}).allow_same_day && l.kind === 'subject') {
    const same = l.slots.filter(s => s[0] === d && !(ED.picked && ED.picked.from && ED.picked.from[0] === s[0] && ED.picked.from[1] === s[1]));
    if (same.length && !same.some(s => Math.abs(s[1] - p) === 1 && Math.min(s[1], p) !== lunchAfter()))
      out.push({ hard: false, msg: 'วิชานี้มีในวันเดียวกันแล้ว' });
  }
  return out;
}

/* ── ช่วงเรียน (session) = คาบติดกันของวิชาเดียวในวันเดียว ── */
function sessionsOf(l) {
  const byDay = {};
  l.slots.forEach(([d, p]) => (byDay[d] = byDay[d] || []).push(p));
  const out = [];
  Object.entries(byDay).forEach(([d, ps]) => {
    ps.sort((a, b) => a - b);
    let cur = [ps[0]];
    for (let i = 1; i < ps.length; i++) {
      if (ps[i] === ps[i - 1] + 1 && ps[i - 1] !== lunchAfter()) cur.push(ps[i]);
      else { out.push({ d: +d, ps: cur }); cur = [ps[i]]; }
    }
    out.push({ d: +d, ps: cur });
  });
  return out;
}

/* ── ตรวจทั้งภาคเรียน ── */
function allIssues() {
  const hard = [], soft = [];
  Object.entries(IDX.bySlot).forEach(([k, ls]) => {
    const [d, p] = k.split('-').map(Number);
    const byT = {};
    ls.forEach(l => l.teacher_ids.forEach(t => (byT[t] = byT[t] || []).push(l)));
    Object.entries(byT).forEach(([t, xs]) => {
      if (xs.length > 1) hard.push({ d, p, type: 'teacher', key: t, msg: `${teacherShort(+t)} สอนซ้อน ${xs.map(x => lessonName(x) + ' ' + classLabel(x)).join(' / ')}` });
    });
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j], cc = a.classes.filter(c => b.classes.includes(c));
      if (cc.length && classOverlap(a, b))
        hard.push({ d, p, type: 'class', key: cc[0], msg: `${cc.map(classShort).join(', ')} ชน ${lessonName(a)} กับ ${lessonName(b)}` });
    }
    ls.forEach(l => l.teacher_ids.forEach(tid => {
      if (!isUnavailable(tid, d, p)) return;
      const msg = `${teacherShort(tid)} ไม่ว่าง (${unavReason(tid)}) แต่มี ${lessonName(l)} ${classLabel(l)}`.trim();
      if (l.kind === 'subject') hard.push({ d, p, type: 'teacher', key: tid, lid: l.id, msg });   // lid → ขึ้นในมุมมองห้องด้วย
      else soft.push({ d, p, type: 'teacher', key: tid, msg });                                    // กิจกรรมรวม: เตือนเฉพาะครูคนนั้น
    }));
  });
  T.lessons.forEach(l => {
    const n = l.slots.length, pw = l.per_week, name = `${lessonName(l)} ${classLabel(l)}`.trim();
    const key = l.classes[0] || String(l.teacher_ids[0] || '');
    const type = l.classes.length ? 'class' : 'teacher';
    if (n < pw) soft.push({ type, key, lid: l.id, msg: `${name} ยังวางไม่ครบ (${n}/${pw})` });
    if (n > pw) soft.push({ type, key, lid: l.id, msg: `${name} วางเกิน (${n}/${pw})` });
    if (l.kind !== 'subject') return;
    const ss = sessionsOf(l), o = l.options || {};
    if (o.double && n >= 2 && ss.filter(s => s.ps.length === 1).length > pw % 2)
      soft.push({ type, key, lid: l.id, msg: `${name} ต้องเรียนติดกัน 2 คาบ แต่วางแยก` });
    if (!o.allow_same_day) {
      const days = ss.map(s => s.d);
      if (new Set(days).size < days.length) soft.push({ type, key, lid: l.id, msg: `${name} มีวันเดียวกันมากกว่า 1 ครั้ง` });
    }
    (o.avoid || []).forEach(p => {
      if (l.slots.some(s => s[1] === p)) soft.push({ type, key, lid: l.id, msg: `${name} อยู่คาบ ${p} (ตั้งให้เลี่ยง)` });
    });
  });
  T.teachers.forEach(t => {
    const mx = (t.constraints || {}).max_per_day;
    if (!mx || !IDX.byTeacher[t.id]) return;
    for (let d = 1; d <= DAYS.length; d++) {
      let n = 0;
      for (let p = 1; p <= nPeriods(); p++) if ((IDX.byTeacher[t.id][`${d}-${p}`] || []).some(l => l.kind === 'subject')) n++;
      if (n > mx) soft.push({ type: 'teacher', key: String(t.id), msg: `${teacherShort(t.id)} วัน${DAYS[d - 1]} สอน ${n} คาบ (ตั้งไว้ไม่เกิน ${mx})` });
    }
  });
  return { hard, soft };
}

/* ── รายการของมุมมองปัจจุบัน ── */
function viewLessons() {
  return ED.by === 'class' ? T.lessons.filter(l => l.classes.includes(ED.key))
                           : T.lessons.filter(l => l.teacher_ids.includes(+ED.key));
}
function lessonsInCell(d, p) {
  const map = ED.by === 'class' ? IDX.byClass[ED.key] : IDX.byTeacher[ED.key];
  return (map && map[`${d}-${p}`]) || [];
}

/* ═════════════ วาดหน้าจัดตาราง ═════════════ */
function renderEditor() {
  if (!ED.key) ED.key = ED.by === 'class' ? (IDX.classes[0] || '') : String((T.teachers[0] || {}).id || '');
  const P = T.term.config.periods, issues = allIssues();
  const opts = ED.by === 'class'
    ? IDX.classes.map(c => `<option value="${c}" ${c === ED.key ? 'selected' : ''}>${classShort(c)}</option>`).join('')
    : T.teachers.map(t => `<option value="${t.id}" ${String(t.id) === ED.key ? 'selected' : ''}>ครู${esc(t.name)}</option>`).join('');
  // ปัญหาของมุมมองนี้
  const mine = x => x.type === ED.by && String(x.key) === String(ED.key)
                  || (ED.by === 'class' && x.lid && lessonById(x.lid)?.classes.includes(ED.key))
                  || (ED.by === 'teacher' && x.lid && lessonById(x.lid)?.teacher_ids.includes(+ED.key));
  const hardHere = issues.hard.filter(mine), softHere = issues.soft.filter(mine);

  let head = '<tr><th class="ed-dayh"></th>';
  P.forEach(x => { head += `<th>${x.no}<div class="small fw-normal text-muted">${esc(x.start)}-${esc(x.end)}</div></th>`; if (x.no === lunchAfter()) head += '<th class="ed-lunch"></th>'; });
  head += '</tr>';
  let body = '';
  DAYS.forEach((dn, di) => {
    const d = di + 1;
    body += `<tr><th class="ed-dayh">${dn}</th>`;
    P.forEach(x => {
      const p = x.no, ls = lessonsInCell(d, p);
      const bad = hardHere.some(h => h.d === d && h.p === p);
      body += `<td class="ed-cell${bad ? ' has-bad' : ''}" data-d="${d}" data-p="${p}">${ls.map(l => chipHTML(l, d, p)).join('')}</td>`;
      if (p === lunchAfter()) body += di === 0 ? `<td class="ed-lunch" rowspan="${DAYS.length}"><div>พักกลางวัน</div></td>` : '';
    });
    body += '</tr>';
  });

  const vl = viewLessons();
  const pending = vl.filter(l => l.slots.length < l.per_week);
  const cards = pending.map(l => `
    <div class="ed-card" draggable="true" data-lid="${l.id}" style="background:${colorOf(l)}" title="ลากไปวาง หรือแตะแล้วแตะช่อง">
      <b>${esc(lessonName(l))}</b> ${esc(ED.by === 'class' ? l.teacher_ids.map(teacherShort).join(', ') : classLabel(l))}
      ${tracksOf(l).length ? `<span class="badge text-bg-light border">${esc(l.track)}</span>` : ''}
      ${(l.options || {}).double ? '<span class="badge bg-secondary" title="เรียนติดกัน 2 คาบ">คู่</span>' : ''}
      <span class="float-end badge bg-warning text-dark">เหลือ ${l.per_week - l.slots.length}</span>
    </div>`).join('') || '<div class="text-muted small p-2">✓ วางครบทุกรายการแล้ว</div>';

  const issueList = (arr, cls) => arr.map(x => `<li class="${cls}" ${x.d ? `data-go="${x.d}-${x.p}"` : ''}>${x.d ? `<b>${DAYS[x.d - 1]} คาบ ${x.p}</b> ` : ''}${esc(x.msg)}</li>`).join('');
  const lessonRows = vl.map(l => `<tr>
      <td><span class="ed-swatch" style="background:${colorOf(l)}"></span><b>${esc(lessonName(l))}</b>${l.code && T.subjects[l.code]?.name ? ` <span class="text-muted small">${esc(T.subjects[l.code].name)}</span>` : ''}</td>
      <td>${esc(classLabel(l))}</td>
      <td>${esc(l.teacher_ids.map(teacherShort).join(', '))}</td>
      <td class="text-center">${l.per_week}</td>
      <td class="text-center ${l.slots.length !== l.per_week ? 'text-danger fw-bold' : ''}">${l.slots.length}</td>
      <td class="small">${[(l.options || {}).double ? 'คาบคู่' : '', (l.options || {}).avoid ? 'เลี่ยงคาบ ' + l.options.avoid.join(',') : '', (l.options || {}).allow_same_day ? 'ซ้ำวันได้' : ''].filter(Boolean).join(' · ')}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-primary py-0" onclick="openLessonModal(${l.id})"><i class="bi bi-pencil"></i></button></td></tr>`).join('');

  el('content').innerHTML = `<div class="container-fluid ed-wrap">
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <div class="btn-group btn-group-sm">
        <button class="btn ${ED.by === 'class' ? 'btn-primary' : 'btn-outline-primary'}" onclick="edBy('class')"><i class="bi bi-people"></i> รายห้อง</button>
        <button class="btn ${ED.by === 'teacher' ? 'btn-primary' : 'btn-outline-primary'}" onclick="edBy('teacher')"><i class="bi bi-person-badge"></i> รายครู</button>
      </div>
      <select class="form-select form-select-sm w-auto" onchange="ED.key=this.value; renderEditor()">${opts}</select>
      ${ED.by === 'class' ? `<button class="btn btn-sm btn-outline-secondary" onclick="openTracksModal('${ED.key}')"><i class="bi bi-diagram-3"></i> สายการเรียน ${(T.term.config.tracks || {})[ED.key]?.length ? '(' + T.term.config.tracks[ED.key].length + ')' : ''}</button>`
                           : `<button class="btn btn-sm btn-outline-secondary" onclick="openTeacherModal(${ED.key})"><i class="bi bi-person-gear"></i> เงื่อนไขครู</button>`}
      <button class="btn btn-sm btn-outline-success" onclick="openLessonModal(null)"><i class="bi bi-plus-lg"></i> เพิ่มรายการสอน</button>
      <button class="btn btn-sm btn-outline-info" onclick="applyTracks()" title="อ่านจากโครงสร้างหลักสูตร: วิชาไหนเรียนแผนการเรียนไหน"><i class="bi bi-magic"></i> ตั้งสายจากหลักสูตร</button>
      <button class="btn btn-sm btn-outline-info" onclick="applySuggestedTracks()" title="วิชาที่เรียนพร้อมกับวิชาของสาย A = นักเรียนสายอื่น"><i class="bi bi-lightbulb"></i> แนะนำสายจากตาราง</button>
      <button class="btn btn-sm btn-outline-dark" onclick="edUndo()" ${ED.undo.length ? '' : 'disabled'}><i class="bi bi-arrow-counterclockwise"></i> ย้อนกลับ</button>
      <button class="btn btn-sm btn-primary" onclick="openSolveModal()"><i class="bi bi-cpu"></i> จัดอัตโนมัติ</button>
      <button class="btn btn-sm btn-outline-secondary" onclick="openTermModal()"><i class="bi bi-gear"></i> ภาคเรียน ${esc(T.term.name)}${T.term.published ? '' : ' <span class="badge bg-warning text-dark">ร่าง</span>'}</button>
      ${draftReport() ? '<button class="btn btn-sm btn-outline-warning" onclick="showDraftReport(draftReport())"><i class="bi bi-clipboard-check"></i> รายงานการร่าง</button>' : ''}
      <span class="ms-auto small">
        <span class="badge ${issues.hard.length ? 'bg-danger' : 'bg-success'}" title="ชนทั้งภาคเรียน">ชน ${issues.hard.length}</span>
        <span class="badge ${issues.soft.length ? 'bg-warning text-dark' : 'bg-success'}" title="ผิดเงื่อนไข/วางไม่ครบ ทั้งภาคเรียน">เตือน ${issues.soft.length}</span>
      </span>
    </div>
    <div class="row g-2">
      <div class="col-xl-9">
        <div class="table-responsive"><table class="ed-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
        <div class="small text-muted mt-1"><i class="bi bi-hand-index"></i> ลากวิชาไปวาง หรือแตะวิชาแล้วแตะช่อง • ลากออกไปที่ "ยังไม่ได้วาง" หรือกด × = เอาออก • กดค้าง/ดับเบิลคลิก = ล็อก 🔒</div>
      </div>
      <div class="col-xl-3">
        <div class="ed-panel" id="edPending">
          <div class="ed-panel-h"><i class="bi bi-inbox"></i> ยังไม่ได้วาง (${pending.reduce((a, l) => a + l.per_week - l.slots.length, 0)} คาบ)</div>
          ${cards}
        </div>
        ${(hardHere.length || softHere.length) ? `<div class="ed-panel mt-2"><div class="ed-panel-h"><i class="bi bi-exclamation-triangle"></i> ปัญหาใน${ED.by === 'class' ? 'ห้อง' : 'ตารางครู'}นี้</div>
          <ul class="ed-issues">${issueList(hardHere, 'hard')}${issueList(softHere, 'soft')}</ul></div>` : ''}
      </div>
    </div>
    <div class="card mt-3"><div class="card-body p-2">
      <div class="fw-bold mb-1">ภาระงานสอนของ ${ED.by === 'class' ? classShort(ED.key) : teacherShort(+ED.key)}</div>
      <div class="table-responsive"><table class="table table-sm table-hover mb-0 small">
        <thead class="table-light"><tr><th>วิชา/กิจกรรม</th><th>ชั้น/สาย</th><th>ครู</th><th class="text-center">คาบ/สัปดาห์</th><th class="text-center">วางแล้ว</th><th>เงื่อนไข</th><th></th></tr></thead>
        <tbody>${lessonRows}</tbody></table></div>
    </div></div>
  </div>`;
  bindEditor();
  if (ED.picked) showTargets();
}

function chipHTML(l, d, p) {
  const lk = lockedAt(l, d, p);
  const sub = ED.by === 'class' ? (l.teacher_ids.length > 3 ? `ครู ${l.teacher_ids.length} ท่าน` : l.teacher_ids.map(teacherShort).join(', ')) : classLabel(l);
  const picked = ED.picked && ED.picked.lid === l.id && ED.picked.from && ED.picked.from[0] === d && ED.picked.from[1] === p;
  return `<div class="ed-chip${picked ? ' picked' : ''}${lk ? ' locked' : ''}" draggable="${lk ? 'false' : 'true'}" data-lid="${l.id}" data-d="${d}" data-p="${p}"
            style="background:${colorOf(l)}" title="${esc(lessonName(l) + ' ' + classLabel(l) + ' — ' + l.teacher_ids.map(teacherShort).join(', '))}">
      <b>${esc(lessonName(l))}</b>${tracksOf(l).length ? ` <small class="text-muted">${esc(l.track)}</small>` : ''}<br><small>${esc(sub)}</small>
      ${lk ? '<span class="lk">🔒</span>' : '<span class="x" title="เอาออก">×</span>'}
    </div>`;
}

/* ═════════════ ลากวาง / แตะวาง ═════════════ */
function bindEditor() {
  const root = el('content');
  root.querySelectorAll('.ed-chip, .ed-card').forEach(c => {
    c.addEventListener('dragstart', e => {
      pick(+c.dataset.lid, c.dataset.d ? [+c.dataset.d, +c.dataset.p] : null, false);
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.lid);
    });
    c.addEventListener('dragend', () => { if (ED.picked && ED.picked.drag) clearPick(); });
    c.addEventListener('click', e => {
      if (e.target.classList.contains('x')) { e.stopPropagation(); removeChip(+c.dataset.lid, +c.dataset.d, +c.dataset.p); return; }
      e.stopPropagation();
      const from = c.dataset.d ? [+c.dataset.d, +c.dataset.p] : null;
      if (ED.picked && ED.picked.lid === +c.dataset.lid && String(ED.picked.from) === String(from)) { clearPick(); return; }
      if (ED.picked && c.dataset.d) { doPlace(+c.dataset.d, +c.dataset.p); return; }   // แตะวิชาอื่นในช่อง = วางลงช่องนั้น
      if (c.classList.contains('locked')) { toastEd('ช่องนี้ล็อกไว้ — ดับเบิลคลิกเพื่อปลดล็อก'); return; }
      pick(+c.dataset.lid, from, true);
    });
    if (c.dataset.d) c.addEventListener('dblclick', e => { e.stopPropagation(); toggleLock(+c.dataset.lid, +c.dataset.d, +c.dataset.p); });
  });
  root.querySelectorAll('.ed-cell').forEach(td => {
    td.addEventListener('dragover', e => { if (ED.picked) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    td.addEventListener('drop', e => { e.preventDefault(); doPlace(+td.dataset.d, +td.dataset.p); });
    td.addEventListener('click', () => { if (ED.picked) doPlace(+td.dataset.d, +td.dataset.p); });
  });
  const pend = el('edPending');
  if (pend) {
    pend.addEventListener('dragover', e => { if (ED.picked && ED.picked.from) e.preventDefault(); });
    pend.addEventListener('drop', e => { e.preventDefault(); if (ED.picked && ED.picked.from) removeChip(ED.picked.lid, ...ED.picked.from); });
  }
  root.querySelectorAll('[data-go]').forEach(li => li.addEventListener('click', () => {
    const td = root.querySelector(`.ed-cell[data-d="${li.dataset.go.split('-')[0]}"][data-p="${li.dataset.go.split('-')[1]}"]`);
    if (td) { td.scrollIntoView({ block: 'center', behavior: 'smooth' }); td.classList.add('flash'); setTimeout(() => td.classList.remove('flash'), 1400); }
  }));
}

function pick(lid, from, byClick) {
  ED.picked = { lid, from, drag: !byClick };
  document.querySelectorAll('.ed-chip.picked, .ed-card.picked').forEach(x => x.classList.remove('picked'));
  const sel = from ? `.ed-chip[data-lid="${lid}"][data-d="${from[0]}"][data-p="${from[1]}"]` : `.ed-card[data-lid="${lid}"]`;
  document.querySelector(sel)?.classList.add('picked');
  showTargets();
}
function clearPick() {
  ED.picked = null;
  document.querySelectorAll('.ed-cell').forEach(td => { td.classList.remove('ok', 'soft', 'bad'); td.removeAttribute('title'); });
  document.querySelectorAll('.picked').forEach(x => x.classList.remove('picked'));
}
// ระบายสีทุกช่องตามผลถ้าวางวิชาที่เลือกลงไป
function showTargets() {
  const l = lessonById(ED.picked.lid);
  if (!l) return;
  document.querySelectorAll('.ed-cell').forEach(td => {
    const d = +td.dataset.d, p = +td.dataset.p;
    td.classList.remove('ok', 'soft', 'bad');
    if (slotHas(l, d, p)) { td.removeAttribute('title'); return; }
    const c = conflictsAt(l, d, p);
    td.classList.add(c.some(x => x.hard) ? 'bad' : c.length ? 'soft' : 'ok');
    td.title = c.map(x => (x.hard ? '✖ ' : '⚠ ') + x.msg).join('\n') || 'วางได้';
  });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ED.picked) clearPick(); });

async function doPlace(d, p) {
  const pk = ED.picked; if (!pk) return;
  const l = lessonById(pk.lid);
  if (pk.from && pk.from[0] === d && pk.from[1] === p) { clearPick(); return; }
  if (slotHas(l, d, p)) { toastEd('วิชานี้อยู่ในช่องนั้นแล้ว'); return; }
  const add = [[d, p]];
  // วางจากกล่อง "ยังไม่ได้วาง" + วิชาคาบคู่ + เหลือ ≥ 2 คาบ → วางคาบถัดไปให้ด้วยถ้าว่าง
  if (!pk.from && (l.options || {}).double && l.per_week - l.slots.length >= 2 && p < nPeriods() && p !== lunchAfter()
      && !slotHas(l, d, p + 1) && !conflictsAt(l, d, p + 1).some(c => c.hard)) add.push([d, p + 1]);
  const hard = conflictsAt(l, d, p).filter(c => c.hard);
  if (hard.length && !confirm(`วางแล้วจะชนกัน:\n• ${hard.map(c => c.msg).join('\n• ')}\n\nวางต่อหรือไม่?`)) return;
  if (!pk.from && l.slots.length >= l.per_week && !confirm(`${lessonName(l)} วางครบ ${l.per_week} คาบแล้ว จะวางเพิ่มอีกหรือไม่?`)) return;
  const body = { lesson_id: l.id, add, remove: pk.from ? [pk.from] : [] };
  clearPick();
  await applySlots(body, true);
}

async function removeChip(lid, d, p) {
  const l = lessonById(lid);
  if (lockedAt(l, d, p)) { toastEd('ช่องนี้ล็อกไว้ — ดับเบิลคลิกเพื่อปลดล็อกก่อน'); return; }
  clearPick();
  await applySlots({ lesson_id: lid, add: [], remove: [[d, p]] }, true);
}

async function toggleLock(lid, d, p) {
  const l = lessonById(lid), lk = lockedAt(l, d, p) ? 0 : 1;
  await applySlots({ lesson_id: lid, lock: [[d, p, lk]] }, false);
  toastEd(lk ? '🔒 ล็อกช่องนี้แล้ว (จัดอัตโนมัติจะไม่ย้าย)' : 'ปลดล็อกแล้ว');
}

async function applySlots(body, pushUndo) {
  try {
    const r = await apiFetch('/api/tt/slots', { method: 'POST', body: JSON.stringify(body) });
    const i = T.lessons.findIndex(l => l.id === body.lesson_id);
    T.lessons[i] = r.lesson;
    if (pushUndo) ED.undo.push({ lesson_id: body.lesson_id, add: body.remove || [], remove: body.add || [] });
    if (ED.undo.length > 50) ED.undo.shift();
    buildIndex(); renderEditor();
  } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
}
async function edUndo() {
  const u = ED.undo.pop(); if (!u) return;
  await applySlots(u, false);
}
function edBy(by) { ED.by = by; ED.key = ''; clearPick(); renderEditor(); }

function toastEd(msg) {
  const t = document.createElement('div');
  t.className = 'position-fixed bottom-0 start-50 translate-middle-x mb-3 alert alert-dark py-2 px-3 shadow no-print';
  t.style.zIndex = 9999; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

/* ═════════════ ฟอร์ม: รายการสอน ═════════════ */
let edModal = null;
function showModal(title, bodyHTML, footHTML) {
  el('edModalTitle').innerHTML = title;
  el('edModalBody').innerHTML = bodyHTML;
  el('edModalFoot').innerHTML = footHTML;
  if (!edModal) edModal = new bootstrap.Modal('#edModal');
  edModal.show();
}

function openLessonModal(id, prefill) {
  const l = id ? lessonById(id) : Object.assign({ code: '', title: '', kind: 'subject', classes: ED.by === 'class' ? [ED.key] : [],
    track: '', teacher_ids: ED.by === 'teacher' ? [+ED.key] : [], per_week: 1, options: {}, note: '' }, prefill || {});
  if (prefill && prefill.name && prefill.code) T.subjects[prefill.code] = Object.assign(T.subjects[prefill.code] || { code: prefill.code }, { name: prefill.name });
  const o = l.options || {}, P = T.term.config.periods;
  const trackNames = [...new Set(IDX.classes.flatMap(c => (T.term.config.tracks || {})[c] || []))];
  const body = `
    <div class="mb-2">
      <div class="btn-group btn-group-sm">
        <input type="radio" class="btn-check" name="lfKind" id="lfK1" value="subject" ${l.kind !== 'activity' ? 'checked' : ''}><label class="btn btn-outline-primary" for="lfK1">รายวิชา (นับคาบสอน)</label>
        <input type="radio" class="btn-check" name="lfKind" id="lfK2" value="activity" ${l.kind === 'activity' ? 'checked' : ''}><label class="btn btn-outline-primary" for="lfK2">กิจกรรม</label>
      </div>
    </div>
    <div class="row g-2">
      <div class="col-5"><label class="form-label small mb-0">รหัสวิชา</label><input id="lfCode" class="form-control form-control-sm" value="${esc(l.code)}" placeholder="เช่น ค21102"></div>
      <div class="col-7"><label class="form-label small mb-0">ชื่อวิชา / ชื่อกิจกรรม</label><input id="lfName" class="form-control form-control-sm" value="${esc(l.code ? (T.subjects[l.code]?.name || '') : l.title)}" placeholder="เช่น คณิตศาสตร์ 2 / ชุมนุม"></div>
    </div>
    <label class="form-label small mb-0 mt-2">ชั้น</label>
    <div>${IDX.classes.map(c => `<label class="me-3"><input type="checkbox" class="lfCls" value="${c}" ${l.classes.includes(c) ? 'checked' : ''}> ${classShort(c)}</label>`).join('')}</div>
    <label class="form-label small mb-0 mt-2">สาย/กลุ่มผู้เรียน <span class="text-muted">(ไม่เลือก = ทั้งห้อง · วิชาต่างสายเรียนพร้อมกันได้)</span></label>
    <div id="lfTracks">${trackNames.length ? trackNames.map(t => `<label class="me-3"><input type="checkbox" class="lfTrk" value="${esc(t)}" ${tracksOf(l).includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')
        : '<span class="small text-muted">ยังไม่ได้ตั้งสายการเรียน — ตั้งที่ปุ่ม "สายการเรียน" ของห้อง</span>'}
      ${tracksOf(l).filter(t => !trackNames.includes(t)).map(t => `<label class="me-3"><input type="checkbox" class="lfTrk" value="${esc(t)}" checked> ${esc(t)}</label>`).join('')}</div>
    <label class="form-label small mb-0 mt-2">ครูผู้สอน</label>
    <div class="lf-teachers">${T.teachers.map(t => `<label class="me-3"><input type="checkbox" class="lfT" value="${t.id}" ${l.teacher_ids.includes(t.id) ? 'checked' : ''}> ${esc(t.name.split(' ')[0])}</label>`).join('')}
      <button type="button" class="btn btn-link btn-sm p-0" onclick="addTeacherInline()">+ เพิ่มครู</button></div>
    <div class="row g-2 mt-1">
      <div class="col-4"><label class="form-label small mb-0">คาบ/สัปดาห์</label><input id="lfPw" type="number" min="0" max="35" class="form-control form-control-sm" value="${l.per_week}"></div>
      <div class="col-8 small pt-3">
        <label class="d-block"><input type="checkbox" id="lfDouble" ${o.double ? 'checked' : ''}> เรียนติดกัน 2 คาบ (คาบคู่)</label>
        <label class="d-block"><input type="checkbox" id="lfSameDay" ${o.allow_same_day ? 'checked' : ''}> ให้มีวันเดียวกันได้มากกว่า 1 ครั้ง</label>
      </div>
    </div>
    <label class="form-label small mb-0 mt-1">หลีกเลี่ยงคาบ</label>
    <div>${P.map(x => `<label class="me-2"><input type="checkbox" class="lfAvoid" value="${x.no}" ${(o.avoid || []).includes(x.no) ? 'checked' : ''}> ${x.no}</label>`).join('')}</div>
    <label class="form-label small mb-0 mt-2">หมายเหตุ</label><input id="lfNote" class="form-control form-control-sm" value="${esc(l.note || '')}">
    ${id ? `<div class="small text-muted mt-2">วางในตารางแล้ว ${l.slots.length} คาบ</div>` : ''}`;
  const foot = `${id ? `<button class="btn btn-outline-danger btn-sm me-auto" onclick="deleteLesson(${id})"><i class="bi bi-trash"></i> ลบรายการ</button>` : ''}
    <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button class="btn btn-primary btn-sm" onclick="saveLesson(${id || 'null'})"><i class="bi bi-save"></i> บันทึก</button>`;
  showModal(id ? `แก้ไข ${esc(lessonName(l))}` : 'เพิ่มรายการสอน', body, foot);
}

async function saveLesson(id) {
  const q = s => [...document.querySelectorAll(s)];
  const kind = document.querySelector('input[name=lfKind]:checked').value;
  const code = el('lfCode').value.trim(), name = el('lfName').value.trim();
  const body = {
    term_id: T.term.id, kind, code,
    title: code ? '' : name, subject_name: code ? name : undefined,
    classes: q('.lfCls:checked').map(x => x.value),
    track: q('.lfTrk:checked').map(x => x.value).join(','),
    teacher_ids: q('.lfT:checked').map(x => +x.value),
    per_week: +el('lfPw').value || 0,
    options: { double: el('lfDouble').checked, allow_same_day: el('lfSameDay').checked, avoid: q('.lfAvoid:checked').map(x => +x.value) },
    note: el('lfNote').value.trim(),
  };
  try {
    const r = await apiFetch(id ? `/api/tt/lessons/${id}` : '/api/tt/lessons', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    if (id) T.lessons[T.lessons.findIndex(l => l.id === id)] = r.lesson; else T.lessons.push(r.lesson);
    if (code) T.subjects[code] = Object.assign(T.subjects[code] || { code }, { name });
    edModal.hide(); buildIndex(); renderEditor();
  } catch (e) { alert(e.message); }
}

async function deleteLesson(id) {
  const l = lessonById(id);
  if (!confirm(`ลบ ${lessonName(l)} ${classLabel(l)} ออกจากภาระงานสอน (รวม ${l.slots.length} คาบที่วางไว้)?`)) return;
  try {
    await apiFetch(`/api/tt/lessons/${id}`, { method: 'DELETE' });
    T.lessons = T.lessons.filter(x => x.id !== id);
    edModal.hide(); buildIndex(); renderEditor();
  } catch (e) { alert(e.message); }
}

async function addTeacherInline() {
  const name = prompt('ชื่อ-นามสกุลครู (ไม่ต้องใส่คำนำหน้า)');
  if (!name) return;
  try {
    const r = await apiFetch('/api/tt/teachers', { method: 'POST', body: JSON.stringify({ name }) });
    T.teachers.push(r.teacher); buildIndex();
    const box = document.querySelector('.lf-teachers');
    box.insertAdjacentHTML('afterbegin', `<label class="me-3"><input type="checkbox" class="lfT" value="${r.teacher.id}" checked> ${esc(r.teacher.name.split(' ')[0])}</label>`);
  } catch (e) { alert(e.message); }
}

/* ═════════════ ฟอร์ม: เงื่อนไขครู ═════════════ */
async function openTeacherModal(tid) {
  const t = IDX.teachers[tid]; if (!t) return;
  const c = t.constraints || {}, P = T.term.config.periods;
  let users = [];
  try { users = await apiFetch('/api/tt/users'); } catch (e) {}
  const un = new Set((c.unavailable || []).map(([d, p]) => `${d}-${p}`));
  const quick = d => [['เช้า', 'am'], ['บ่าย', 'pm'], ['ทั้งวัน', 'all']]
    .map(([lab, k]) => `<button type="button" class="btn btn-link btn-sm p-0 px-1" onclick="tcToggle(${d},'${k}')">${lab}</button>`).join('');
  let grid = '<div class="table-responsive"><table class="table table-sm table-bordered text-center mb-1 tc-grid"><tr><th></th>' + P.map(x => `<th>${x.no}</th>`).join('') + '<th class="small fw-normal text-muted">ทั้งช่วง</th></tr>';
  DAYS.forEach((dn, di) => {
    grid += `<tr><th class="text-start">${dn}</th>` + P.map(x => `<td class="tc ${un.has(`${di + 1}-${x.no}`) ? 'off' : ''}" data-k="${di + 1}-${x.no}"></td>`).join('')
          + `<td class="text-nowrap p-0 align-middle">${quick(di + 1)}</td></tr>`;
  });
  grid += '</table></div>';
  // ครูย้ายออก → โอนวิชาทั้งภาคเรียนให้ครูคนอื่น / ครูใหม่ที่รอย้ายมา
  const mine = T.lessons.filter(l => l.teacher_ids.includes(tid)), first = t.name.split(' ')[0];
  const transfer = !mine.length ? '' : `
    <hr class="my-2">
    <div class="small fw-bold"><i class="bi bi-arrow-left-right"></i> ครูย้ายออก / เปลี่ยนผู้สอน</div>
    <div class="small text-muted mb-1">โอนวิชาและกิจกรรมทั้งหมดของครู${esc(first)} (${mine.length} รายการ ${mine.reduce((s, l) => s + l.per_week, 0)} คาบ/สัปดาห์)
      เฉพาะภาคเรียน ${esc(T.term.name)} — ตารางภาคเรียนก่อน ๆ ยังเป็นชื่อเดิม</div>
    <select id="tfTo" class="form-select form-select-sm mb-1" onchange="el('tfNameRow').classList.toggle('d-none', this.value !== 'new')">
      <option value="new">ให้ ➕ ครูใหม่ (รอย้ายมา)</option>
      ${T.teachers.filter(x => x.id !== tid).map(x => `<option value="${x.id}">ให้ ครู${esc(x.name)}</option>`).join('')}</select>
    <div id="tfNameRow" class="mb-1"><input id="tfName" class="form-control form-control-sm" maxlength="60" value="ใหม่ (แทน${esc(first)})">
      <div class="form-text mt-0">ชื่อชั่วคราว (คำแรกขึ้นในช่องตาราง เช่น "ครูใหม่") — ครูมาถึงแล้วค่อยแก้เป็นชื่อจริง + ผูกบัญชีผู้ใช้</div></div>
    <div class="form-check small mb-2"><input class="form-check-input" type="checkbox" id="tfOut" checked>
      <label class="form-check-label" for="tfOut">ครู${esc(first)}ย้ายออกแล้ว (ไม่ต้องแสดงในภาคเรียนถัด ๆ ไป)</label></div>
    <button type="button" class="btn btn-outline-danger btn-sm" onclick="transferTeacher(${tid})"><i class="bi bi-arrow-left-right"></i> โอนวิชาทั้งหมด</button>`;
  const body = `
    <label class="form-label small mb-0">ชื่อ-นามสกุล</label><input id="tcName" class="form-control form-control-sm mb-2" value="${esc(t.name)}">
    <label class="form-label small mb-0">บัญชีผู้ใช้ในระบบ <span class="text-muted">(ครูล็อกอินแล้วเห็นตารางตัวเองทันที)</span></label>
    <select id="tcUser" class="form-select form-select-sm mb-2"><option value="">— ไม่ผูก —</option>${users.map(u => `<option value="${u.id}" ${u.id === t.user_id ? 'selected' : ''}>${esc(u.full_name)} (${u.role === 'admin' ? 'แอดมิน' : 'ครู'})</option>`).join('')}</select>
    <label class="form-label small mb-0">คาบที่ <b class="text-danger">ไม่ว่าง</b> — จัดอัตโนมัติจะไม่วางสอนช่องนี้ (แตะช่องเพื่อสลับ หรือกด เช้า / บ่าย / ทั้งวัน)</label>
    ${grid}
    <input id="tcNote" class="form-control form-control-sm mb-2" maxlength="100" value="${esc(c.note || '')}" placeholder="เหตุผลที่ไม่ว่าง เช่น ไปธนาคารบ่ายวันศุกร์ (ขึ้นในคำเตือน)">
    <div class="row g-2 align-items-center"><div class="col-auto small">สอนไม่เกินวันละ</div>
      <div class="col-3"><input id="tcMax" type="number" min="0" max="7" class="form-control form-control-sm" value="${c.max_per_day || ''}" placeholder="ไม่จำกัด"></div><div class="col-auto small">คาบ</div></div>
    ${transfer}`;
  showModal(`เงื่อนไขครู${esc(t.name)}`, body,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button><button class="btn btn-primary btn-sm" onclick="saveTeacher(${tid})"><i class="bi bi-save"></i> บันทึก</button>`);
  document.querySelectorAll('.tc-grid td.tc').forEach(td => td.addEventListener('click', () => td.classList.toggle('off')));
}

// เลือกทั้งช่วง: เช้า = ก่อนพักกลางวัน / บ่าย = หลังพัก — ถ้าปิดครบอยู่แล้ว กดซ้ำ = เปิดคืน
function tcToggle(d, part) {
  const tds = [...document.querySelectorAll(`.tc-grid td.tc[data-k^="${d}-"]`)].filter(td => {
    const p = +td.dataset.k.split('-')[1];
    return part === 'all' || (part === 'am' ? p <= lunchAfter() : p > lunchAfter());
  });
  const allOff = tds.every(td => td.classList.contains('off'));
  tds.forEach(td => td.classList.toggle('off', !allOff));
}

async function transferTeacher(tid) {
  const isNew = el('tfTo').value === 'new', to = +el('tfTo').value || null;
  const name = isNew ? el('tfName').value.trim() : '';
  if (isNew && !name) { alert('ใส่ชื่อครูใหม่ (ชื่อชั่วคราวได้)'); return; }
  const toLabel = isNew ? 'ครู' + name.replace(/^ครู/, '').trim().split(' ')[0] : teacherShort(to);
  if (!confirm(`โอนวิชาและกิจกรรมทั้งหมดของ${teacherShort(tid)} ภาคเรียน ${T.term.name} ให้ ${toLabel}?`)) return;
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/transfer-teacher`, { method: 'POST',
      body: JSON.stringify({ from_id: tid, to_id: to, new_name: name, deactivate: el('tfOut').checked }) });
    edModal.hide();
    ED.by = 'teacher'; ED.key = String(r.to_id);
    await loadTerm(T.term.id);
    alert(`โอนแล้ว ${r.moved} รายการ → ${toLabel}` +
          (isNew ? `\n\nเมื่อครูใหม่มาถึง: เลือก${toLabel} → กด "เงื่อนไขครู" → แก้เป็นชื่อจริง + เลือกบัญชีผู้ใช้` : ''));
  } catch (e) { alert(e.message); }
}

async function saveTeacher(tid) {
  const unavailable = [...document.querySelectorAll('.tc-grid td.tc.off')].map(td => td.dataset.k.split('-').map(Number));
  const body = { name: el('tcName').value, user_id: +el('tcUser').value || null,
                 constraints: { unavailable, max_per_day: +el('tcMax').value || 0, note: el('tcNote').value.trim() } };
  try {
    const r = await apiFetch(`/api/tt/teachers/${tid}`, { method: 'PUT', body: JSON.stringify(body) });
    T.teachers[T.teachers.findIndex(t => t.id === tid)] = r.teacher;
    edModal.hide(); buildIndex(); renderEditor();
  } catch (e) { alert(e.message); }
}

/* ═════════════ ฟอร์ม: สายการเรียนของห้อง ═════════════ */
function openTracksModal(cls) {
  const cur = ((T.term.config.tracks || {})[cls] || []).join('\n');
  const body = `<div class="small text-muted mb-2">พิมพ์ชื่อสาย/กลุ่มบรรทัดละ 1 ชื่อ เช่น "วิทย์-คณิต" "ศิลป์-ภาษา" — จากนั้นเลือกสายในแต่ละวิชาเพิ่มเติม
    (วิชาพื้นฐานที่เรียนทั้งห้องไม่ต้องเลือก) วิชาต่างสายจะวางช่องเดียวกันได้โดยไม่นับว่าชน</div>
    <textarea id="trkText" class="form-control" rows="5" placeholder="วิทย์-คณิต&#10;ศิลป์-ภาษา">${esc(cur)}</textarea>`;
  showModal(`สายการเรียน ${classShort(cls)}`, body,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button><button class="btn btn-primary btn-sm" onclick="saveTracks('${cls}')"><i class="bi bi-save"></i> บันทึก</button>`);
}
async function saveTracks(cls) {
  const names = [...new Set(el('trkText').value.split('\n').map(s => s.replace(/,/g, ' ').trim()).filter(Boolean))];
  const tracks = Object.assign({}, T.term.config.tracks || {}, { [cls]: names });
  try {
    await apiFetch(`/api/tt/terms/${T.term.id}`, { method: 'PUT', body: JSON.stringify({ config: { tracks } }) });
    T.term.config.tracks = tracks;
    edModal.hide(); renderEditor();
  } catch (e) { alert(e.message); }
}

/* ═════════════ ตั้งสายการเรียนจากโครงสร้างหลักสูตร ═════════════ */
async function applyTracks() {
  if (!confirm('ตั้งสายการเรียนให้ทุกวิชาตามเอกสาร "โครงสร้างหลักสูตร" ของโรงเรียน?\n(วิชาที่ตั้งกลุ่มไว้แล้ว เช่น กลุ่ม 1 จะไม่ถูกเปลี่ยน)')) return;
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/apply-tracks`, { method: 'POST' });
    const before = allIssues().hard.length;
    await loadTerm(T.term.id);
    const after = allIssues().hard.length;
    alert(`${r.message}\nการชน: ${before} → ${after} จุด` + (r.unknown.length ? `\n\nรหัสที่ไม่พบในโครงสร้างหลักสูตร (ต้องเลือกสายเอง):\n${r.unknown.join(', ')}` : ''));
  } catch (e) { alert(e.message); }
}

/* ═════════════ แนะนำสายจากตารางที่วางอยู่ ═════════════
   วิชา L (ยังไม่มีสาย) เรียนพร้อมกับวิชาของสาย A,B → นักเรียนของ L ต้องเป็นสายที่เหลือ
   ถ้าเดาเกินจริง = เข้มกว่าจริง (ปลอดภัย: ไม่ปล่อยให้ชน) · ทำซ้ำจนไม่มีข้อเสนอใหม่ */
// รหัสวิชาพื้นฐาน: หลักที่ 4 เป็น 1 เช่น ส33101 ท21101 (เพิ่มเติม = 2 เช่น ค31201 ว30285)
const isBasic = l => /^[ก-ฮ]\d{2}1\d{2}$/.test(l.code || '');
function suggestTracks() {
  const trk = new Map(T.lessons.map(l => [l.id, tracksOf(l)]));
  const props = new Map();
  for (let round = 0; round < 5; round++) {
    let changed = false;
    T.lessons.forEach(L => {
      if (L.classes.length !== 1 || trk.get(L.id).length || isBasic(L)) return;   // วิชาพื้นฐาน = ทุกคนเรียน ห้ามเดาให้เหลือบางสาย
      const cls = L.classes[0], all = (T.term.config.tracks || {})[cls] || [];
      if (all.length < 2) return;
      const used = new Set();
      L.slots.forEach(([d, p]) => (IDX.bySlot[`${d}-${p}`] || []).forEach(x => {
        if (x.id !== L.id && x.classes.includes(cls)) trk.get(x.id).forEach(t => used.add(t));
      }));
      const rest = all.filter(t => !used.has(t));
      if (used.size && rest.length && rest.length < all.length) { trk.set(L.id, rest); props.set(L.id, rest.join(',')); changed = true; }
    });
    if (!changed) break;
  }
  return [...props.entries()].map(([id, track]) => ({ L: lessonById(id), track }));
}

async function applySuggestedTracks() {
  const props = suggestTracks();
  if (!props.length) { alert('ไม่มีข้อเสนอเพิ่ม — วิชาที่ยังชนต้องตรวจสอบเอง (เปิดแก้ไขวิชาแล้วเลือกสาย)'); return; }
  const list = props.map(x => `• ${lessonName(x.L)} ${classShort(x.L.classes[0])} → ${x.track}`).join('\n');
  if (!confirm(`แนะนำสายการเรียน ${props.length} วิชา (ดูจากวิชาที่เรียนพร้อมกันในตารางปัจจุบัน):\n\n${list}\n\nบันทึกตามนี้?`)) return;
  const before = allIssues().hard.length;
  try {
    for (const x of props) {
      const L = x.L;
      const body = { code: L.code, title: L.title, kind: L.kind, classes: L.classes, track: x.track, teacher_ids: L.teacher_ids,
                     per_week: L.per_week, options: L.options || {}, note: L.note || '' };
      const r = await apiFetch(`/api/tt/lessons/${L.id}`, { method: 'PUT', body: JSON.stringify(body) });
      T.lessons[T.lessons.findIndex(l => l.id === L.id)] = r.lesson;
    }
    buildIndex(); renderEditor();
    alert(`บันทึกแล้ว — การชน: ${before} → ${allIssues().hard.length} จุด`);
  } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
}

/* ═════════════ ภาคเรียน: ร่างภาคเรียนถัดไป / เผยแพร่ / ลบ ═════════════ */
function nextTermName(n) {
  const m = /^([12])\/(\d{4})$/.exec(n || '');
  if (!m) return '';
  return m[1] === '1' ? `2/${m[2]}` : `1/${+m[2] + 1}`;
}
function draftReport() {
  try { const n = JSON.parse(T.term.note || '{}'); return n.report ? Object.assign({ from: n.draft_from }, n.report) : null; } catch (e) { return null; }
}
function openTermModal() {
  const nx = nextTermName(T.term.name);
  const body = `
    <div class="mb-2"><b>ภาคเรียน ${esc(T.term.name)}</b> — ${T.term.published ? '<span class="badge bg-success">เผยแพร่แล้ว ครูทุกคนเห็น</span>' : '<span class="badge bg-warning text-dark">ร่าง — เห็นเฉพาะแอดมิน</span>'}</div>
    <div class="small mb-3"><i class="bi bi-calendar-range"></i> เปิดสอน ${T.term.start_date ? `${formatThaiDateShort(T.term.start_date)} – ${formatThaiDateShort(T.term.end_date)}` : '(ไม่ทราบ)'}
      · <a href="/settings.html">แก้วันเปิด-ปิดภาคเรียน</a>
      <div class="text-muted">ระบบเปิดตารางของเทอมที่ตรงกับวันนี้ให้ครูเอง — เผยแพร่เทอมหน้าล่วงหน้าได้ ครูยังเห็นตารางเทอมปัจจุบันจนกว่าจะเปิดเทอมใหม่</div></div>
    <div class="d-grid gap-2">
      <button class="btn btn-${T.term.published ? 'outline-secondary' : 'success'}" onclick="setPublished(${T.term.published ? 0 : 1})">
        <i class="bi bi-${T.term.published ? 'eye-slash' : 'megaphone'}"></i> ${T.term.published ? 'ซ่อน (กลับเป็นร่าง)' : 'เผยแพร่ให้ครูเห็น'}</button>
      ${nx ? `<button class="btn btn-outline-primary" onclick="draftNext('${nx}')"><i class="bi bi-copy"></i> สร้างร่างภาคเรียน ${nx} จากภาคเรียนนี้</button>` : ''}
      <button class="btn btn-outline-danger" onclick="deleteTerm()"><i class="bi bi-trash"></i> ลบภาคเรียนนี้ทั้งหมด</button>
    </div>
    <div class="small text-muted mt-3">สร้างร่าง = วิชาเลื่อนรหัสตามโครงสร้างหลักสูตร ครู/ชั้น/สาย/เงื่อนไขเดิม · กิจกรรมทั้งโรงเรียนคงช่องเดิม (ล็อก) · แล้วกด "จัดอัตโนมัติ"</div>`;
  showModal('<i class="bi bi-gear"></i> ตั้งค่าภาคเรียน', body, '<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ปิด</button>');
}
async function setPublished(v) {
  try {
    await apiFetch(`/api/tt/terms/${T.term.id}`, { method: 'PUT', body: JSON.stringify({ published: v }) });
    T.term.published = v; edModal.hide(); renderEditor();
    toastEd(v ? 'เผยแพร่แล้ว — ครูเปิดดูได้' : 'ซ่อนแล้ว (ร่าง)');
    const opt = el('selTerm').querySelector(`option[value="${T.term.id}"]`);
    if (opt) opt.textContent = T.term.name + (v ? '' : ' (ร่าง)');
  } catch (e) { alert(e.message); }
}
async function deleteTerm() {
  if (!confirm(`ลบภาคเรียน ${T.term.name} ทั้งหมด (รายการสอน ${T.lessons.length} รายการ และตาราง) — ย้อนกลับไม่ได้`)) return;
  if (prompt('พิมพ์ชื่อภาคเรียนเพื่อยืนยันการลบ') !== T.term.name) return;
  try { await apiFetch(`/api/tt/terms/${T.term.id}`, { method: 'DELETE' }); location.reload(); } catch (e) { alert(e.message); }
}
async function draftNext(name) {
  if (!confirm(`สร้างร่างภาคเรียน ${name} จาก ${T.term.name}?\n• วิชาเลื่อนรหัสตามโครงสร้างหลักสูตร (ครู/ชั้น/สายเดิม)\n• กิจกรรมทั้งโรงเรียนคงช่องเดิม\n• ยังไม่เผยแพร่จนกว่าจะกดเผยแพร่`)) return;
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/draft-next`, { method: 'POST', body: JSON.stringify({ name }) });
    if (edModal) edModal.hide();
    const sel = el('selTerm');
    sel.insertAdjacentHTML('afterbegin', `<option value="${r.term_id}">${esc(name)} (ร่าง)</option>`);
    await loadTerm(r.term_id);
    showDraftReport(Object.assign({ from: T.term.name, message: r.message }, r.report));
  } catch (e) { alert(e.message); }
}
function showDraftReport(rep) {
  const sec = (title, arr, cls) => arr && arr.length ? `<details class="mb-2" ${cls === 'warn' ? 'open' : ''}><summary class="fw-bold">${title} (${arr.length})</summary>
    <ul class="small mb-0">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '';
  let unc = '';
  Object.entries(rep.uncovered || {}).forEach(([g, list]) => {
    unc += `<div class="small fw-bold mt-1">ม.${g}</div>` + list.map((x, i) => `<div class="small d-flex align-items-center gap-2 border-bottom py-1">
      <span class="flex-grow-1">${esc(x.code)} ${esc(x.name)} · ${x.hours ? Math.round(x.hours / 20) + ' คาบ' : '?'}${x.tracks.length ? ' · ' + esc(x.tracks.join(',')) : ''}</span>
      <button class="btn btn-sm btn-outline-success py-0" onclick='addUncovered(${JSON.stringify(x).replace(/'/g, "&#39;")})'>+ เพิ่ม</button></div>`).join('');
  });
  const body = `
    ${rep.message ? `<div class="alert alert-success py-2">${esc(rep.message)}</div>` : ''}
    <div class="small text-muted mb-2">ร่างจากภาคเรียน ${esc(rep.from || '')} + เอกสารโครงสร้างหลักสูตร — ตรวจรายการด้านล่าง แล้วแก้ในหน้าจัดตาราง (ปุ่มดินสอ) ก่อนกด "จัดอัตโนมัติ"</div>
    ${sec('⚠ ต้องตรวจรหัสวิชา (ไม่พบในโครงสร้างหลักสูตร ระบบเดา +1)', rep.check_code, 'warn')}
    ${sec('⚠ ยังไม่กำหนดครู (วิชาเปลี่ยนกลุ่มสาระ)', rep.no_teacher, 'warn')}
    ${sec('ℹ วิชาเปลี่ยน — ตรวจว่าครูเดิมยังสอนไหม', rep.changed)}
    ${sec('ℹ รวมรายการซ้ำ', rep.merged)}
    ${sec('ℹ วิชาที่จบในภาคเรียนก่อน (ไม่ได้สร้าง)', rep.ended)}
    ${unc ? `<details open><summary class="fw-bold">➕ วิชาในหลักสูตรภาคเรียนนี้ที่ยังไม่มีในร่าง</summary><div class="small text-muted">บางวิชาอาจสอนอยู่แล้วภายใต้รหัสอื่น — ถ้าใช่ให้แก้รหัสรายการเดิมแทนการเพิ่ม</div>${unc}</details>` : ''}`;
  showModal('<i class="bi bi-clipboard-check"></i> รายงานการร่างภาคเรียน ' + esc(T.term.name), body, '<button class="btn btn-primary btn-sm" data-bs-dismiss="modal">ไปจัดตาราง</button>');
}
function addUncovered(x) {
  const cls = IDX.classes.find(c => c.split('/')[0] === String(x.grade));
  edModal.hide();
  setTimeout(() => openLessonModal(null, { code: x.code, name: x.name, classes: cls ? [cls] : [], track: (x.tracks || []).join(','),
    per_week: x.hours ? Math.max(1, Math.round(x.hours / 20)) : 1, teacher_ids: [] }), 350);
}
