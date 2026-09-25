/* ===== จัดครูสอนแทน — ใช้คู่กับ timetable.html (+ tt-editor.js สำหรับ showModal / isUnavailable) =====
   1) บันทึกครูไม่มา (ลา / ไปราชการ / ย้ายออก) ทั้งวัน บางคาบ หรือหลายวัน
   2) คาบที่ต้องมีครูแทน = คาบของครูที่ไม่มาในตารางภาคเรียนที่เปิดอยู่ (วิชาที่มีครูร่วมสอน / ประชุมครู ไม่ต้องจัด)
   3) แนะนำครู: ว่างคาบนั้น → สอนแทนมาน้อยสุดในภาคเรียน (กระจายให้เท่ากัน) → สาระเดียวกัน → สอนห้องนั้นอยู่ → วันนั้นมีคาบน้อย
   4) พิมพ์ใบบันทึกการสอนแทนรายวัน · ครูเปิดตารางตัวเองเห็นคาบสอนแทน 7 วันข้างหน้า */

const SUB = { date: '', data: null, from: '', to: '' };
const SUB_REASONS = ['ลาป่วย', 'ลากิจ', 'ไปราชการ', 'อบรม/ประชุม', 'ลาคลอด', 'ย้ายออก/รอครูใหม่', 'อื่น ๆ'];
const OPEN_END = '9999-12-31';
const MON_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return isoOf(d); };
const wdOf = s => dateOf(s).getDay();                       // 1 = จันทร์ … 5 = ศุกร์
const todayLocal = () => isoOf(new Date());                  // todayISO() ใน common.js เป็นเวลา UTC (ก่อน 7 โมงได้เมื่อวาน)
const shortDate = s => { const d = dateOf(s); return `${d.getDate()} ${MON_ABBR[d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)}`; };
const nextSchoolDay = (s, step) => { let d = s; do { d = addDays(d, step); } while (wdOf(d) === 0 || wdOf(d) === 6); return d; };

// อยู่ในช่วงภาคเรียนของตารางที่เปิดอยู่ไหม (ช่วงวันที่จากหน้าตั้งค่า · ไม่มีข้อมูล = ถือว่าอยู่)
const inTerm = date => !T.term.start_date || (T.term.start_date <= date && date <= T.term.end_date);

// ต้นภาคเรียนโดยประมาณ (16 พ.ค. / 1 พ.ย.) — สำรองไว้เมื่อภาคเรียนไม่มีช่วงวันที่
function termStart(s) {
  const d = dateOf(s), y = d.getFullYear(), m = d.getMonth() + 1;
  if (m >= 11) return `${y}-11-01`;
  if (m <= 4 || (m === 5 && d.getDate() < 16)) return `${y - 1}-11-01`;
  return `${y}-05-16`;
}

const periodsOf = () => T.term.config.periods;
const periodLabel = ps => {
  if (!ps || !ps.length) return 'ทั้งวัน';
  const la = lunchAfter(), n = periodsOf().length;
  const am = Array.from({ length: la }, (_, i) => i + 1), pm = Array.from({ length: n - la }, (_, i) => la + i + 1);
  if (ps.join() === am.join()) return 'ช่วงเช้า';
  if (ps.join() === pm.join()) return 'ช่วงบ่าย';
  return 'คาบ ' + ps.join(', ');
};
const spanLabel = a => shortDate(a.date_from) + (a.date_to === a.date_from ? '' : a.date_to === OPEN_END ? ' เป็นต้นไป (ยังไม่มีกำหนด)' : ' – ' + shortDate(a.date_to));
// ครูที่ย้ายออกแล้วไม่อยู่ในตารางเทอมนี้ → ใช้ชื่อจากเซิร์ฟเวอร์ (teacher_names)
const tFull = id => IDX.teachers[id]?.name || SUB.data?.teacher_names?.[id] || '';
const tName = id => tFull(id) ? 'ครู' + tFull(id) : `ครู (รหัส ${id})`;
const tShort = id => tFull(id) ? 'ครู' + tFull(id).split(' ')[0] : `ครู (รหัส ${id})`;

/* ── ข้อมูลของวัน ── */
const absencesOn = date => (SUB.data?.absences || []).filter(a => a.date_from <= date && a.date_to >= date);
const absentAt = (tid, date, p) => absencesOn(date).some(a => a.teacher_id === tid && (!a.periods.length || a.periods.includes(p)));
const holidayOn = date => (SUB.data?.holidays || []).find(h => h.date === date);
const savedOn = date => (SUB.data?.subs || []).filter(s => s.date === date);

function needsOn(date) {
  const wd = wdOf(date);
  if (wd < 1 || wd > DAYS.length || holidayOn(date)?.type === 'holiday' || !inTerm(date)) return [];
  const out = [];
  periodsOf().forEach(({ no: p }) => {
    (IDX.bySlot[`${wd}-${p}`] || []).forEach(l => {
      const gone = l.teacher_ids.filter(t => absentAt(t, date, p));
      if (!gone.length) return;
      const stay = l.teacher_ids.filter(t => !gone.includes(t));
      let skip = '';
      if (!l.classes.length) skip = 'ไม่มีนักเรียน';
      else if (stay.length) skip = stay.length > 2 ? `ครูอีก ${stay.length} ท่านดูแล` : `${stay.map(tShort).join(', ')} ดูแลอยู่`;
      out.push({ key: `${p}-${l.id}`, p, l, absent: Math.min(...gone), gone, skip });
    });
  });
  return out;
}

function subCounts(date) {                                    // คาบที่สอนแทน: ทั้งภาคเรียน / วันนั้น
  const total = {}, day = {};
  (SUB.data?.subs || []).forEach(s => {
    if (!s.sub_id) return;
    total[s.sub_id] = (total[s.sub_id] || 0) + 1;
    if (s.date === date) day[s.sub_id] = (day[s.sub_id] || 0) + 1;
  });
  return { total, day };
}

// assigned: Map key → sub_id ของวันนั้น (รวมที่กำลังจัดอัตโนมัติ)
function candidatesFor(n, date, assigned, counts) {
  const wd = wdOf(date), p = n.p, area = n.l.kind === 'subject' ? (n.l.code || '')[0] : '';
  const busySub = new Set([...assigned].filter(([k, sid]) => sid && +k.split('-')[0] === p && k !== n.key).map(([, sid]) => sid));
  return T.teachers.filter(t => t.active !== 0 && IDX.byTeacher[t.id]).map(t => {
    const why = [], own = IDX.byTeacher[t.id][`${wd}-${p}`] || [];
    let ok = true, score = 0;
    if (n.gone.includes(t.id) || absentAt(t.id, date, p)) { ok = false; why.push('ไม่มา'); }
    else if (own.length) { ok = false; why.push('มีสอน ' + lessonName(own[0])); }
    else if (busySub.has(t.id)) { ok = false; why.push('สอนแทนห้องอื่นแล้ว'); }
    else if (isUnavailable(t.id, wd, p)) { ok = false; why.push(`ไม่ว่าง (${unavReason(t.id)})`); }
    const total = counts.total[t.id] || 0;
    const dayLoad = Object.keys(IDX.byTeacher[t.id]).filter(k => k.startsWith(wd + '-')).length + (counts.day[t.id] || 0);
    score -= total * 10 + dayLoad * 3;
    if (area && T.lessons.some(l => l.kind === 'subject' && l.teacher_ids.includes(t.id) && (l.code || '')[0] === area)) { score += 6; why.push('สาระเดียวกัน'); }
    if (T.lessons.some(l => l.teacher_ids.includes(t.id) && l.classes.some(c => n.l.classes.includes(c)))) { score += 3; why.push('สอนห้องนี้'); }
    // คาบคู่วิชาเดียวกัน (ไม่ข้ามพักกลางวัน) → ให้ครูคนเดิมดูต่อ
    if ([p - 1, p + 1].some(q => Math.min(p, q) !== lunchAfter() && assigned.get(`${q}-${n.l.id}`) === t.id)) { score += 12; why.push('ต่อคาบคู่'); }
    const mx = (t.constraints || {}).max_per_day;
    if (mx && dayLoad >= mx) { score -= 40; why.push(`ครบวันละ ${mx} คาบแล้ว`); }
    return { t, ok, score, why, total, dayLoad };
  }).sort((a, b) => (b.ok - a.ok) || (b.score - a.score) || (a.t.sort_order - b.t.sort_order) || (a.t.id - b.t.id));
}

const itemOf = (n, sid, note) => ({ period: n.p, lesson_id: n.l.id, absent_id: n.absent, sub_id: sid || null,
  subject: lessonName(n.l), class_label: classLabel(n.l), note: note || '' });

/* ── โหลด / บันทึก ── */
async function loadSubs() {
  // นับความถี่การสอนแทนตั้งแต่ต้นภาคเรียนนี้ (ทำให้กระจายงานเท่ากันทั้งเทอม)
  SUB.from = T.term.start_date && T.term.start_date <= SUB.date ? T.term.start_date : termStart(SUB.date);
  SUB.to = addDays(SUB.date, 14);
  SUB.data = await apiFetch(`/api/tt/subs?from=${SUB.from}&to=${SUB.to}`);
}

async function saveSubs(body) {
  try {
    const r = await apiFetch('/api/tt/subs', { method: 'POST', body: JSON.stringify(body) });
    SUB.data.subs = SUB.data.subs.filter(s => s.date !== body.date).concat(r.subs);
    renderSubsBody();
    return true;
  } catch (e) { alert(e.message); renderSubsBody(); return false; }
}

async function setSub(key, val) {
  const n = needsOn(SUB.date).find(x => x.key === key);
  if (!n) return;
  if (val === '') return saveSubs({ date: SUB.date, clear: [{ period: n.p, lesson_id: n.l.id }] });
  const old = savedOn(SUB.date).find(s => s.period === n.p && s.lesson_id === n.l.id);
  const note = val === 'none' ? ((old && !old.sub_id && old.note) || 'มอบหมายงาน') : (old?.note || '');
  return saveSubs({ date: SUB.date, items: [itemOf(n, val === 'none' ? null : +val, note)] });
}

async function setSubNote(key, note) {
  const n = needsOn(SUB.date).find(x => x.key === key);
  const old = n && savedOn(SUB.date).find(s => s.period === n.p && s.lesson_id === n.l.id);
  if (!old) return;
  return saveSubs({ date: SUB.date, items: [itemOf(n, old.sub_id, note.trim())] });
}

async function autoAssign() {
  const date = SUB.date, counts = subCounts(date);
  const saved = savedOn(date), assigned = new Map(saved.map(s => [`${s.period}-${s.lesson_id}`, s.sub_id]));
  const todo = needsOn(date).filter(n => !n.skip && !assigned.has(n.key));
  if (!todo.length) { toastEd('ทุกคาบจัดแล้ว'); return; }
  // คาบติดกันของวิชาเดียวกัน (คาบคู่ ไม่ข้ามพักกลางวัน) = 1 ช่วง → ครูคนเดียวดูทั้งช่วง
  const groups = [];
  todo.sort((a, b) => a.l.id - b.l.id || a.p - b.p).forEach(n => {
    const g = groups[groups.length - 1], last = g && g[g.length - 1];
    if (last && last.l.id === n.l.id && n.p === last.p + 1 && last.p !== lunchAfter()) g.push(n); else groups.push([n]);
  });
  const pickFor = g => {                                                   // ครูที่ว่างทุกคาบในช่วง เรียงคะแนนรวม
    const lists = g.map(n => candidatesFor(n, date, assigned, counts));
    return lists[0].filter(c => c.ok && lists.every(L => L.find(x => x.t.id === c.t.id)?.ok))
      .map(c => ({ id: c.t.id, score: lists.reduce((s, L) => s + L.find(x => x.t.id === c.t.id).score, 0) }))
      .sort((a, b) => b.score - a.score);
  };
  const items = [], stuck = [];
  while (groups.length) {
    groups.sort((a, b) => pickFor(a).length - pickFor(b).length || a[0].p - b[0].p);   // ช่วงที่มีตัวเลือกน้อยก่อน
    const g = groups.shift(), best = pickFor(g)[0];
    if (!best) {
      if (g.length > 1) groups.push(...g.map(n => [n]));                   // ไม่มีใครว่างทั้งช่วง → แยกจัดทีละคาบ
      else stuck.push(g[0]);
      continue;
    }
    g.forEach(n => {
      assigned.set(n.key, best.id);
      counts.total[best.id] = (counts.total[best.id] || 0) + 1;
      counts.day[best.id] = (counts.day[best.id] || 0) + 1;
      items.push(itemOf(n, best.id, ''));
    });
  }
  if (items.length && await saveSubs({ date, items }))
    toastEd(`จัดแล้ว ${items.length} คาบ` + (stuck.length ? ` · ไม่มีครูว่าง ${stuck.length} คาบ (เลือก "ไม่มีครูแทน" หรือสลับเอง)` : ''));
  else if (stuck.length) alert(`ไม่มีครูว่างเลย ${stuck.length} คาบ — เลือก "ไม่มีครูแทน (มอบงาน)" หรือขอให้ครูสลับคาบ`);
}

async function clearDay() {
  const saved = savedOn(SUB.date);
  if (!saved.length || !confirm(`ล้างการจัดครูแทนทั้งหมดของ${formatThaiDateFull(SUB.date)}?`)) return;
  saveSubs({ date: SUB.date, clear: saved.map(s => ({ period: s.period, lesson_id: s.lesson_id })) });
}

/* ── หน้าจอ ── */
async function renderSubs() {
  if (!SUB.date) { SUB.date = todayLocal(); if (wdOf(SUB.date) === 0 || wdOf(SUB.date) === 6) SUB.date = nextSchoolDay(SUB.date, 1); }
  el('content').innerHTML = `<div class="container sub-screen"><div id="subBody"><div class="text-center text-muted py-5"><div class="spinner-border"></div></div></div></div>
    <div class="sub-print" id="subPrint"></div>`;
  try { await loadSubs(); } catch (e) { el('subBody').innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`; return; }
  renderSubsBody();
}

async function gotoDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return;
  SUB.date = d;
  const want = termAt(d);                                    // ข้ามไปวันของอีกเทอม → ใช้ตารางเทอมนั้น
  if (want && want.id !== T.term.id) { await loadTerm(want.id); return; }
  if (d < SUB.from || d > SUB.to) { await renderSubs(); return; }
  renderSubsBody();
}

function renderSubsBody() {
  const box = el('subBody');
  if (!box) return;
  const date = SUB.date, admin = !!T.can_edit, hol = holidayOn(date), wd = wdOf(date);
  const needs = needsOn(date), saved = savedOn(date), counts = subCounts(date);
  const savedBy = new Map(saved.map(s => [`${s.period}-${s.lesson_id}`, s]));
  const assigned = new Map(saved.map(s => [`${s.period}-${s.lesson_id}`, s.sub_id]));
  const todo = needs.filter(n => !n.skip), done = todo.filter(n => savedBy.has(n.key)).length;
  const P = Object.fromEntries(periodsOf().map(x => [x.no, x]));

  // แถบวันที่
  let html = `<div class="card mb-2 mt-2"><div class="card-body py-2 d-flex flex-wrap align-items-center gap-2">
    <div class="btn-group btn-group-sm">
      <button class="btn btn-outline-secondary" onclick="gotoDate(nextSchoolDay(SUB.date,-1))" title="วันก่อน"><i class="bi bi-chevron-left"></i></button>
      <input type="date" class="form-control form-control-sm" style="width:150px" value="${date}" onchange="gotoDate(this.value)">
      <button class="btn btn-outline-secondary" onclick="gotoDate(nextSchoolDay(SUB.date,1))" title="วันถัดไป"><i class="bi bi-chevron-right"></i></button>
    </div>
    <button class="btn btn-sm btn-outline-primary" onclick="gotoDate(todayLocal())">วันนี้</button>
    <div class="fw-bold fs-6">${formatThaiDateFull(date)}</div>
    <span class="badge text-bg-light border">ตารางภาคเรียน ${esc(T.term.name)}${T.term.published ? '' : ' (ร่าง)'}</span>
    ${hol ? `<span class="badge ${hol.type === 'holiday' ? 'bg-danger' : 'bg-info'}">${hol.type === 'holiday' ? 'วันหยุด' : hol.type === 'exam' ? 'สอบ' : 'กิจกรรม'}: ${esc(hol.name)}</span>` : ''}
    ${wd === 0 || wd === 6 ? '<span class="badge bg-secondary">วันเสาร์-อาทิตย์</span>' : ''}
    ${!inTerm(date) ? `<span class="badge bg-secondary">ปิดภาคเรียน (ภาคเรียน ${esc(T.term.name)} ${shortDate(T.term.start_date)} – ${shortDate(T.term.end_date)})</span>` : ''}
  </div></div><div class="row g-2">`;

  // ซ้าย: ครูไม่มา + สรุป
  const abs = absencesOn(date);
  html += `<div class="col-lg-4">
    <div class="card mb-2"><div class="card-body py-2">
      <div class="d-flex align-items-center mb-1"><div class="fw-bold flex-fill"><i class="bi bi-person-dash me-1"></i>ครูที่ไม่มา</div>
        ${admin ? `<button class="btn btn-sm btn-danger" onclick="openAbsenceModal()"><i class="bi bi-plus-lg"></i> บันทึกครูไม่มา</button>` : ''}</div>
      ${abs.length ? abs.map(a => `<div class="sub-abs d-flex align-items-start gap-2">
          <div class="flex-fill"><b>${esc(tName(a.teacher_id))}</b> <span class="badge text-bg-warning">${esc(a.reason || 'ไม่มา')}</span>
            <div class="small text-muted">${esc(periodLabel(a.periods))} · ${esc(spanLabel(a))}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
          ${admin ? `<button class="btn btn-sm btn-link p-0" onclick="openAbsenceModal(${a.id})" title="แก้ไข"><i class="bi bi-pencil-square"></i></button>` : ''}
        </div>`).join('') : '<div class="small text-muted py-1">— ไม่มี —</div>'}
    </div></div>
    <div class="d-none d-lg-block">${statsHTML(counts)}</div>
  </div>`;

  // ขวา: คาบที่ต้องจัด
  const rows = needs.map(n => {
    const s = savedBy.get(n.key), time = P[n.p] ? `${P[n.p].start}-${P[n.p].end}` : '';
    let pick;
    if (n.skip) pick = `<span class="text-muted small">ไม่ต้องจัด (${esc(n.skip)})</span>`;
    else if (admin) {
      const cands = candidatesFor(n, date, assigned, counts);
      const opt = c => `<option value="${c.t.id}" ${s?.sub_id === c.t.id ? 'selected' : ''} ${c.ok || s?.sub_id === c.t.id ? '' : 'disabled'}>` +
        `${esc(tShort(c.t.id))} · แทนแล้ว ${c.total}${c.why.length ? ' · ' + esc(c.why.join(' · ')) : ''}</option>`;
      pick = `<select class="form-select form-select-sm ${s ? (s.sub_id ? 'is-valid' : 'border-warning') : 'border-danger'}" onchange="setSub('${n.key}', this.value)">
          <option value="" ${s ? '' : 'selected'}>— ยังไม่จัด —</option>
          <option value="none" ${s && !s.sub_id ? 'selected' : ''}>✗ ไม่มีครูแทน (มอบงาน/รวมห้อง)</option>
          <optgroup label="ว่าง — เรียงตามความเหมาะสม">${cands.filter(c => c.ok).map(opt).join('')}</optgroup>
          <optgroup label="ไม่ว่าง">${cands.filter(c => !c.ok).map(opt).join('')}</optgroup></select>
        ${s ? `<input class="form-control form-control-sm mt-1" placeholder="หมายเหตุ เช่น ให้ทำใบงาน หน้า 12" value="${esc(s.note)}" onchange="setSubNote('${n.key}', this.value)">` : ''}`;
    } else pick = s ? (s.sub_id ? `<b>${esc(tShort(s.sub_id))}</b>` : 'ไม่มีครูแทน') + (s.note ? `<div class="small text-muted">${esc(s.note)}</div>` : '')
                    : '<span class="text-danger small">ยังไม่จัด</span>';
    const mine = !admin && s?.sub_id && s.sub_id === T.me;
    return `<tr class="${n.skip ? 'table-light text-muted' : ''}${mine ? ' table-warning' : ''}">
      <td class="text-center"><b>${n.p}</b><div class="small text-muted text-nowrap">${esc(time)}</div></td>
      <td class="text-nowrap">${esc(classLabel(n.l))}</td>
      <td><b>${esc(lessonName(n.l))}</b>${n.l.code && T.subjects[n.l.code]?.name ? `<div class="small text-muted">${esc(T.subjects[n.l.code].name)}</div>` : ''}
        <div class="small text-muted d-md-none">แทน${esc(n.gone.map(tShort).join(', '))}</div></td>
      <td class="text-nowrap d-none d-md-table-cell">${esc(n.gone.map(tShort).join(', '))}</td>
      <td style="min-width:${admin ? 180 : 110}px">${pick}</td></tr>`;
  }).join('');
  // บันทึกที่ไม่ตรงตารางปัจจุบันแล้ว (ตาราง/บันทึกไม่มาเปลี่ยน)
  const stale = saved.filter(s => !needs.some(n => n.key === `${s.period}-${s.lesson_id}` && !n.skip));
  html += `<div class="col-lg-8"><div class="card"><div class="card-body py-2">
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <div class="fw-bold flex-fill"><i class="bi bi-arrow-left-right me-1"></i>คาบที่ต้องมีครูสอนแทน
        <span class="badge ${done < todo.length ? 'bg-danger' : 'bg-success'}">จัดแล้ว ${done}/${todo.length}</span></div>
      ${admin && todo.length ? `<button class="btn btn-sm btn-primary" onclick="autoAssign()"><i class="bi bi-magic"></i> จัดอัตโนมัติ</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="clearDay()">ล้าง</button>` : ''}
      ${todo.length ? `<button class="btn btn-sm btn-success" onclick="openLineModal()"><i class="bi bi-line"></i> ส่ง LINE</button>` : ''}
    </div>
    ${needs.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-1 sub-table">
      <thead class="table-light"><tr><th class="text-center">คาบ</th><th>ชั้น</th><th>วิชา</th><th class="d-none d-md-table-cell">ครูที่ไม่มา</th><th>สอนแทนโดย</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      ${admin ? '<div class="small text-muted">รายชื่อเรียง: สอนแทนมาน้อยก่อน (นับตั้งแต่ ' + shortDate(SUB.from) + ') · สาระเดียวกัน · สอนห้องนี้อยู่ · วันนั้นมีคาบน้อย</div>' : ''}`
      : `<div class="text-center text-muted py-4">${hol?.type === 'holiday' || wd === 0 || wd === 6 || !inTerm(date) ? 'ไม่มีการเรียนการสอน' : abs.length ? 'ครูที่ไม่มาไม่มีคาบสอนวันนี้' : 'ไม่มีครูไม่มา — ไม่ต้องจัดครูแทน'}</div>`}
    ${stale.length ? `<div class="alert alert-warning py-1 px-2 small mt-2 mb-0">มีบันทึกที่ไม่ตรงตาราง/บันทึกไม่มาแล้ว ${stale.length} รายการ
      (${stale.map(s => `คาบ ${s.period} ${esc(s.class_label)} ${esc(s.subject)}`).join(', ')})
      ${admin ? `<button class="btn btn-sm btn-link p-0 ms-1" onclick="saveSubs({date: SUB.date, clear: ${esc(JSON.stringify(stale.map(s => ({ period: s.period, lesson_id: s.lesson_id }))))}})">ลบทิ้ง</button>` : ''}</div>` : ''}
  </div></div></div>
  <div class="col-12 d-lg-none">${statsHTML(counts)}</div></div>`;   // มือถือ: สรุปไว้ท้ายสุด
  box.innerHTML = html;
  el('subPrint').innerHTML = sheetHTML(needs.filter(n => !n.skip), savedBy);
}

function statsHTML(counts) {
  const list = T.teachers.filter(t => t.active !== 0 && IDX.byTeacher[t.id]);
  if (!list.length) return '';
  const max = Math.max(1, ...list.map(t => counts.total[t.id] || 0));
  return `<div class="card mb-2"><div class="card-body py-2">
    <div class="fw-bold mb-1"><i class="bi bi-bar-chart me-1"></i>จำนวนคาบสอนแทน <span class="small text-muted fw-normal">ตั้งแต่ ${shortDate(SUB.from)}</span></div>
    ${list.map(t => { const n = counts.total[t.id] || 0; return `<div class="d-flex align-items-center small mb-1${t.id === T.me ? ' fw-bold' : ''}">
      <div style="width:110px" class="text-truncate">${esc(tShort(t.id))}</div>
      <div class="flex-fill me-2"><div class="progress" style="height:8px"><div class="progress-bar" style="width:${n / max * 100}%"></div></div></div>
      <div style="width:28px" class="text-end">${n}</div></div>`; }).join('')}
  </div></div>`;
}

/* ── ฟอร์มบันทึกครูไม่มา ── */
function openAbsenceModal(id) {
  const a = id ? SUB.data.absences.find(x => x.id === id) : { teacher_id: '', date_from: SUB.date, date_to: SUB.date, periods: [], reason: 'ลาป่วย', note: '' };
  if (!a) return;
  const list = T.teachers.filter(t => IDX.byTeacher[t.id] || t.id === a.teacher_id);
  const la = lunchAfter(), P = periodsOf();
  const mode = !a.periods.length ? 'all' : periodLabel(a.periods) === 'ช่วงเช้า' ? 'am' : periodLabel(a.periods) === 'ช่วงบ่าย' ? 'pm' : 'some';
  const open = a.date_to === OPEN_END;
  const body = `
    <label class="form-label small mb-0">ครู</label>
    <select id="abT" class="form-select form-select-sm mb-2"><option value="">— เลือกครู —</option>
      ${list.map(t => `<option value="${t.id}" ${t.id === a.teacher_id ? 'selected' : ''}>ครู${esc(t.name)}</option>`).join('')}
      ${a.teacher_id && !list.some(t => t.id === a.teacher_id) ? `<option value="${a.teacher_id}" selected>${esc(tName(a.teacher_id))}</option>` : ''}</select>
    <div class="row g-2 mb-2">
      <div class="col-6"><label class="form-label small mb-0">สาเหตุ</label>
        <select id="abR" class="form-select form-select-sm">${[...new Set([...SUB_REASONS, a.reason].filter(Boolean))].map(r => `<option ${r === a.reason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
      <div class="col-6"><label class="form-label small mb-0">หมายเหตุ</label>
        <input id="abN" class="form-control form-control-sm" maxlength="200" value="${esc(a.note)}" placeholder="เช่น ไปอบรมที่ สพม."></div>
    </div>
    <div class="row g-2 align-items-end mb-2">
      <div class="col-6"><label class="form-label small mb-0">ตั้งแต่วันที่</label><input id="abF" type="date" class="form-control form-control-sm" value="${a.date_from}"></div>
      <div class="col-6"><label class="form-label small mb-0">ถึงวันที่</label><input id="abTo" type="date" class="form-control form-control-sm" value="${open ? '' : a.date_to}" ${open ? 'disabled' : ''}></div>
      <div class="col-12"><div class="form-check small"><input class="form-check-input" type="checkbox" id="abOpen" ${open ? 'checked' : ''}
        onchange="el('abTo').disabled = this.checked"><label class="form-check-label" for="abOpen">ยังไม่มีกำหนด (เช่น ย้ายออก รอครูใหม่ — กลับมาแก้ "ถึงวันที่" ทีหลัง)</label></div></div>
    </div>
    <label class="form-label small mb-0">คาบที่ไม่อยู่</label>
    <div class="btn-group btn-group-sm w-100 mb-1" role="group">
      ${[['all', 'ทั้งวัน'], ['am', 'ช่วงเช้า'], ['pm', 'ช่วงบ่าย'], ['some', 'เลือกคาบ']].map(([k, lab]) =>
        `<input type="radio" class="btn-check" name="abM" id="abM_${k}" value="${k}" ${k === mode ? 'checked' : ''} onchange="el('abPs').classList.toggle('d-none', this.value !== 'some')">
         <label class="btn btn-outline-primary" for="abM_${k}">${lab}</label>`).join('')}
    </div>
    <div id="abPs" class="${mode === 'some' ? '' : 'd-none'}">${P.map(x => `<div class="form-check form-check-inline small">
      <input class="form-check-input" type="checkbox" id="abP${x.no}" value="${x.no}" ${a.periods.includes(x.no) ? 'checked' : ''}><label class="form-check-label" for="abP${x.no}">${x.no}</label></div>`).join('')}</div>`;
  showModal(id ? 'แก้ไขบันทึกครูไม่มา' : 'บันทึกครูไม่มา', body,
    `${id ? `<button class="btn btn-outline-danger btn-sm me-auto" onclick="deleteAbsence(${id})"><i class="bi bi-trash"></i> ลบ</button>` : ''}
     <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
     <button class="btn btn-primary btn-sm" onclick="saveAbsence(${id || 0})"><i class="bi bi-save"></i> บันทึก</button>`);
}

async function saveAbsence(id) {
  const m = document.querySelector('input[name="abM"]:checked')?.value || 'all', la = lunchAfter(), n = periodsOf().length;
  const periods = m === 'am' ? Array.from({ length: la }, (_, i) => i + 1)
                : m === 'pm' ? Array.from({ length: n - la }, (_, i) => la + i + 1)
                : m === 'some' ? [...document.querySelectorAll('#abPs input:checked')].map(i => +i.value) : [];
  if (m === 'some' && !periods.length) { alert('เลือกคาบอย่างน้อย 1 คาบ'); return; }
  const body = { teacher_id: +el('abT').value || 0, reason: el('abR').value, note: el('abN').value,
                 date_from: el('abF').value, date_to: el('abOpen').checked ? OPEN_END : (el('abTo').value || el('abF').value), periods };
  if (!body.teacher_id) { alert('เลือกครู'); return; }
  try {
    const r = await apiFetch(id ? `/api/tt/absences/${id}` : '/api/tt/absences', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    edModal.hide();
    if (r.removed_subs) toastEd(`ลบการจัดครูแทนที่ไม่ต้องใช้แล้ว ${r.removed_subs} คาบ`);
    await loadSubs(); renderSubsBody();
  } catch (e) { alert(e.message); }
}

async function deleteAbsence(id) {
  const a = SUB.data.absences.find(x => x.id === id);
  if (!a || !confirm(`ลบบันทึก "${tName(a.teacher_id)} ${a.reason}" ${spanLabel(a)}?\n(การจัดครูแทนของบันทึกนี้จะถูกลบด้วย)`)) return;
  try {
    await apiFetch(`/api/tt/absences/${id}`, { method: 'DELETE' });
    edModal.hide(); await loadSubs(); renderSubsBody();
  } catch (e) { alert(e.message); }
}

/* ── ส่ง LINE (แบบเดียวกับหน้าแจ้งไลน์ครูเวร: ก๊อปข้อความ → เปิดไลน์ → วางในกลุ่มครู) ── */
function lineText() {
  const date = SUB.date, P = Object.fromEntries(periodsOf().map(x => [x.no, x]));
  const saved = new Map(savedOn(date).map(s => [`${s.period}-${s.lesson_id}`, s]));
  const out = [`📋 สอนแทน ${formatThaiDateFull(date).replace('พ.ศ. ', '')}`];
  const abs = absencesOn(date);
  if (abs.length) out.push('ครูไม่มา: ' + abs.map(a => `${tShort(a.teacher_id)} (${a.reason || 'ไม่มา'}${a.periods.length ? ' ' + periodLabel(a.periods) : ''})`).join(', '));
  const rows = [];                                   // คาบติดกัน วิชาเดียวกัน ครูแทนคนเดียวกัน → รวมเป็น "คาบ 3-4"
  needsOn(date).filter(n => !n.skip).forEach(n => {
    const s = saved.get(n.key);
    const who = !s ? '❗ยังไม่จัด' : s.sub_id ? tShort(s.sub_id) : 'ไม่มีครูแทน';
    const last = rows[rows.length - 1];
    if (last && last.l.id === n.l.id && last.p2 === n.p - 1 && last.who === who) { last.p2 = n.p; return; }
    rows.push({ l: n.l, p1: n.p, p2: n.p, who, gone: n.gone, note: s?.note || '' });
  });
  out.push('');
  rows.forEach(r => out.push(`คาบ ${r.p1 === r.p2 ? r.p1 : r.p1 + '-' + r.p2} (${P[r.p1]?.start || ''}) ${classLabel(r.l)} ${lessonName(r.l)}` +
    ` (${r.gone.map(tShort).join(', ')}) → ${r.who}${r.note ? ' · ' + r.note : ''}`));
  out.push('', 'ดูทั้งหมด: ' + location.origin + '/timetable.html?tab=sub&date=' + date);
  return out.join('\n');
}

function openLineModal() {
  const left = needsOn(SUB.date).filter(n => !n.skip && !savedOn(SUB.date).some(s => `${s.period}-${s.lesson_id}` === n.key)).length;
  showModal('<i class="bi bi-line"></i> ส่งรายการสอนแทนเข้า LINE', `
    ${left ? `<div class="alert alert-warning py-1 px-2 small">ยังไม่ได้จัด ${left} คาบ — ในข้อความจะขึ้นว่า "❗ยังไม่จัด"</div>` : ''}
    <textarea id="lineMsg" class="form-control" rows="12" style="font-size:.9rem">${esc(lineText())}</textarea>
    <div class="small text-muted mt-1">แก้ข้อความได้ก่อนก๊อป · กด "ก๊อปข้อความ" แล้ววางในกลุ่มไลน์ครู</div>`,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ปิด</button>
     <a class="btn btn-outline-success btn-sm d-none" id="lineOpen" href="https://line.me/R/" target="_blank" rel="noopener"><i class="bi bi-line"></i> เปิดไลน์</a>
     <button class="btn btn-success btn-sm" onclick="copyLine()"><i class="bi bi-clipboard-check"></i> ก๊อปข้อความ</button>`);
}

async function copyLine() {
  const ta = el('lineMsg');
  try { await navigator.clipboard.writeText(ta.value); }
  catch (e) { ta.select(); document.execCommand('copy'); }          // เบราว์เซอร์ในแอป LINE บางรุ่นไม่ให้ใช้ clipboard API
  el('lineOpen').classList.remove('d-none');
  toastEd('ก๊อปแล้ว — วางในกลุ่มไลน์ได้เลย');
}

/* ── ใบบันทึกการสอนแทน (A4 แนวตั้ง) ── */
function sheetHTML(needs, savedBy) {
  const date = SUB.date, P = Object.fromEntries(periodsOf().map(x => [x.no, x]));
  const d = dateOf(date), school = T.school.name || '';
  const abs = absencesOn(date);
  const signer = (T.term.config.signers || [])[0];
  const dirTitle = T.school.director_title || 'ผู้อำนวยการ';
  const dirFull = school.startsWith('โรงเรียน') ? dirTitle.replace(/โรงเรียน$/, '') + school : dirTitle + school;
  const rows = needs.map((n, i) => {
    const s = savedBy.get(n.key);
    return `<tr><td class="c">${i + 1}</td><td class="c">${n.p}</td><td class="c nw">${esc(P[n.p] ? P[n.p].start + '-' + P[n.p].end : '')}</td>
      <td class="c nw">${esc(classLabel(n.l))}</td><td class="nw">${esc(lessonName(n.l))}</td><td class="nw">${esc(n.gone.map(tShort).join(', '))}</td>
      <td class="nw">${s ? (s.sub_id ? esc(tShort(s.sub_id)) : 'ไม่มีครูแทน') : ''}</td><td></td><td class="sm">${esc(s?.note || '')}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="c">— ไม่มีคาบที่ต้องจัดครูสอนแทน —</td></tr>';
  return `<div class="sub-sheet">
    <div class="ss-c ss-b ss-big">บันทึกการจัดครูสอนแทน</div>
    <div class="ss-c">${esc(school)} ภาคเรียนที่ ${esc(T.term.name)}</div>
    <div class="ss-c">${formatThaiDateFull(date).replace(/ที่ (\d+) /, 'ที่ $1 เดือน')}</div>
    <div class="ss-abs"><b>ครูที่ไม่ได้ปฏิบัติการสอน</b> ${abs.length ? abs.map((a, i) => `${i + 1}) ${esc(tName(a.teacher_id))} (${esc(a.reason || 'ไม่มา')}${a.periods.length ? ' ' + esc(periodLabel(a.periods)) : ''})`).join('  ') : '-'}</div>
    <table class="ss-table"><thead><tr><th>ที่</th><th>คาบ</th><th>เวลา</th><th>ชั้น</th><th>วิชา</th><th>ครูผู้สอน</th><th>ครูสอนแทน</th><th style="width:26mm">ลงชื่อ</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="ss-signs">
      <div>ลงชื่อ...............................................ผู้จัด<br>(${esc(signer ? signer.name : '')}${signer ? '' : '...............................................'})<br>${esc(signer ? signer.title : 'หัวหน้ากลุ่มบริหารงานวิชาการ')}</div>
      <div>ลงชื่อ...............................................ทราบ<br>(${esc(T.school.director || '...............................................')})<br>${esc(dirFull)}</div>
    </div></div>`;
}

/* ── ครูเปิดตารางตัวเอง: เตือนคาบสอนแทน 7 วันข้างหน้า ── */
async function mySubsBanner() {
  if (!T || !T.me || view.mode !== 'teacher' || view.key !== String(T.me)) return;
  const from = todayLocal(), to = addDays(from, 7);
  let data;
  try { data = await apiFetch(`/api/tt/subs?from=${from}&to=${to}`); } catch (e) { return; }
  const mine = data.subs.filter(s => s.sub_id === T.me);
  if (!mine.length || view.mode !== 'teacher' || el('mySubs')) return;
  const P = Object.fromEntries(periodsOf().map(x => [x.no, x]));
  const box = document.createElement('div');
  box.id = 'mySubs'; box.className = 'container no-print mb-2';
  box.innerHTML = `<div class="alert alert-warning py-2 mb-0"><b><i class="bi bi-arrow-left-right me-1"></i>คาบสอนแทนของคุณ</b>
    ${mine.map(s => `<div>${s.date === from ? '<span class="badge bg-danger">วันนี้</span> ' : ''}${esc(formatThaiDateFull(s.date).replace(/ พ\.ศ\. \d+/, ''))}
      คาบ ${s.period}${P[s.period] ? ` (${esc(P[s.period].start)}-${esc(P[s.period].end)})` : ''} · <b>${esc(s.class_label)} ${esc(s.subject)}</b>
      แทนครู${esc((IDX.teachers[s.absent_id]?.name || data.teacher_names?.[s.absent_id] || '').split(' ')[0])}${s.note ? ` · ${esc(s.note)}` : ''}</div>`).join('')}</div>`;
  el('content').prepend(box);
}
