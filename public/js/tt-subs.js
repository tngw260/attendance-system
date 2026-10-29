/* ===== จัดครูสอนแทน — ใช้คู่กับ timetable.html (+ tt-editor.js สำหรับ showModal / isUnavailable) =====
   1) บันทึกครูไม่มา (ลา / ไปราชการ / ย้ายออก) ทั้งวัน บางคาบ หรือหลายวัน
   2) คาบที่ต้องมีครูแทน = คาบของครูที่ไม่มาในตารางภาคเรียนที่เปิดอยู่ (วิชาที่มีครูร่วมสอน / ประชุมครู ไม่ต้องจัด)
   3) แนะนำครู: ว่างคาบนั้น → สอนแทนมาน้อยสุดในภาคเรียน (กระจายให้เท่ากัน) → สาระเดียวกัน → สอนห้องนั้นอยู่ → วันนั้นมีคาบน้อย
   4) พิมพ์ = บันทึกข้อความ "การสอนแทน" ตามแบบฟอร์มโรงเรียน (sub-memo.html / submemo.py) ครูที่ไม่มาคนละใบ
      ปุ่ม 📄 ข้างชื่อครูที่ไม่มา = เปิดใบของคนนั้น (Word / PDF) · ครูเปิดตารางตัวเองเห็นคาบสอนแทน 7 วันข้างหน้า
   5) ครูทุกคน: "ฝากสอน" ของตัวเอง (ลาป่วย/ลากิจ/ไปราชการ) · กด "รับสอนแทน" คาบที่ว่าง (คนแรกได้) → รอผู้จัดสอนแทนอนุมัติ
      ผู้จัดสอนแทน (T.can_subs) = แอดมิน ผู้ช่วยจัดตาราง หรือครูที่แอดมินตั้งให้จัดเฉพาะสอนแทน (แก้ตารางไม่ได้)
   6) ใบรายชื่อนักเรียนของคาบ Word / PDF (ครูเจ้าของวิชา ครูที่รับสอนแทน ผู้จัดสอนแทน)
   7) แลกคาบ: ครูที่ไม่มากด 🔁 ในคาบของตัวเอง เลือกครูคู่แลก + คาบของครูคนนั้นที่จะไปสอนคืน → ครูคู่แลกยืนยัน (offer → pending)
      → ผู้จัดสอนแทนอนุมัติ · วันสอนคืนขึ้นในกล่อง "คาบสอนคืนจากการแลกคาบ" · ไม่นับในสถิติสอนแทน */

const SUB = { date: '', data: null, from: '', to: '' };
const SUB_REASONS = ['ลาป่วย', 'ลากิจ', 'ไปราชการ', 'อบรม/ประชุม', 'ลาคลอด', 'ย้ายออก/รอครูใหม่', 'อื่น ๆ'];
const SELF_REASONS = ['ลาป่วย', 'ลากิจ', 'ไปราชการ'];          // ครูฝากสอนเอง (ตรงกับ SELF_REASONS ใน timetable.py)
const isPending = s => s?.status === 'pending';
const isOffer = s => s?.status === 'offer';                   // แลกคาบ: รอครูคู่แลกยืนยัน
const isSwap = s => s?.kind === 'swap';
const notFinal = s => isPending(s) || isOffer(s);
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
// แลกคาบที่ต้องไปสอนคืนในวันนั้น (ครูคู่แลกยืนยันแล้ว) — ครู absent_id สอนคาบ swap_* ของครู sub_id
const backsOn = (date, subs = SUB.data?.subs) => (subs || []).filter(s => isSwap(s) && s.swap_date === date && !isOffer(s));
const swapLabel = s => `${shortDate(s.swap_date)} คาบ ${s.swap_period} ${s.swap_class_label || ''} ${s.swap_subject || ''}`.replace(/\s+/g, ' ').trim();

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
    if (!notFinal(s) && !isSwap(s) && s.date >= SUB.from) total[s.sub_id] = (total[s.sub_id] || 0) + 1;   // แลกคาบไม่นับ (ได้คืนแล้ว) · รออนุมัติยังไม่นับ
    if (s.date === date) day[s.sub_id] = (day[s.sub_id] || 0) + 1;     // แต่นับเป็นภาระของวันนั้น
  });
  backsOn(date).forEach(s => { day[s.absent_id] = (day[s.absent_id] || 0) + 1; });
  return { total, day };
}

// assigned: Map key → sub_id ของวันนั้น (รวมที่กำลังจัดอัตโนมัติ)
function candidatesFor(n, date, assigned, counts) {
  const wd = wdOf(date), p = n.p, area = n.l.kind === 'subject' ? (n.l.code || '')[0] : '';
  const busySub = new Set([...assigned].filter(([k, sid]) => sid && +k.split('-')[0] === p && k !== n.key).map(([, sid]) => sid));
  const busyBack = new Set(backsOn(date).filter(s => s.swap_period === p).map(s => s.absent_id));
  return T.teachers.filter(t => t.active !== 0 && IDX.byTeacher[t.id]).map(t => {
    const why = [], own = IDX.byTeacher[t.id][`${wd}-${p}`] || [];
    let ok = true, score = 0;
    if (n.gone.includes(t.id) || absentAt(t.id, date, p)) { ok = false; why.push('ไม่มา'); }
    else if (own.length) { ok = false; why.push('มีสอน ' + lessonName(own[0])); }
    else if (busySub.has(t.id)) { ok = false; why.push('สอนแทนห้องอื่นแล้ว'); }
    else if (busyBack.has(t.id)) { ok = false; why.push('สอนคืนจากการแลกคาบ'); }
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

/* ── ใบรายชื่อนักเรียนของคาบ (แบบฟอร์มงานทะเบียน, classlist.py) — ครูเจ้าของวิชา ครูที่รับสอนแทน ผู้จัดสอนแทน ── */
const canClassList = (n, s) => T.can_subs || (!!T.me && (n.l.teacher_ids.includes(T.me) || s?.sub_id === T.me));
function classListLinks(n) {
  const q = `date=${SUB.date}&period=${n.p}&lesson_id=${n.l.id}`;
  return `<div class="small mt-1 text-nowrap"><i class="bi bi-people me-1"></i>รายชื่อ:
    <a href="#" onclick="subClassList('${q}'); return false">Word</a> ·
    <a href="/class-list.html?${q}&print=1" target="_blank" rel="noopener">PDF</a></div>`;
}
// บันทึกข้อความสอนแทนของครูที่ไม่มา 1 รายการ (ลาหลายวัน = ใบเดียว) — ครูทุกคนเปิดได้
function openMemo(id) { window.open(`/sub-memo.html?absence_id=${id}&date=${SUB.date}`, '_blank'); }

async function subClassList(q) {
  try { await downloadFile('/api/class-list.docx?' + q); } catch (e) { alert(e.message); }
}

/* ── ครูกดรับสอนแทน / ผู้มีสิทธิ์อนุมัติ ── */
async function subPost(url, body, ok) {
  try {
    const r = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
    SUB.data.subs = SUB.data.subs.filter(s => s.date !== body.date).concat(r.subs);
    renderSubsBody();
    if (ok) toastEd(ok);
    return r;
  } catch (e) { alert(e.message); await loadSubs(); renderSubsBody(); return null; }  // มีคนกดก่อน → โหลดใหม่ให้เห็นชื่อ
}

const subKey = n => ({ date: SUB.date, period: n.p, lesson_id: n.l.id });

async function volunteer(key) {
  const n = needsOn(SUB.date).find(x => x.key === key);
  if (!n || !confirm(`รับสอนแทน คาบ ${n.p} ${classLabel(n.l)} ${lessonName(n.l)}\nแทน${n.gone.map(tShort).join(', ')} · ${formatThaiDateFull(SUB.date)}?`)) return;
  subPost('/api/tt/subs/volunteer', { ...subKey(n), subject: lessonName(n.l), class_label: classLabel(n.l) },
          'ส่งคำขอรับสอนแทนแล้ว — รอผู้จัดสอนแทนอนุมัติ');
}

async function withdrawSub(key) {
  const n = needsOn(SUB.date).find(x => x.key === key);
  const s = savedOn(SUB.date).find(x => `${x.period}-${x.lesson_id}` === key);
  if (!n || !confirm(isSwap(s) && s.absent_id === T.me ? `ยกเลิกคำขอแลกคาบ คาบ ${n.p} ${classLabel(n.l)}?` : `ยกเลิกการรับสอนแทน คาบ ${n.p} ${classLabel(n.l)}?`)) return;
  subPost('/api/tt/subs/withdraw', subKey(n), 'ยกเลิกแล้ว');
}

async function approveSubs(keys) {
  const items = keys.map(k => ({ period: +k.split('-')[0], lesson_id: +k.split('-')[1] }));
  if (items.length) subPost('/api/tt/subs/approve', { date: SUB.date, items }, `อนุมัติแล้ว ${items.length} คาบ`);
}

async function rejectSub(key) {
  const s = savedOn(SUB.date).find(x => `${x.period}-${x.lesson_id}` === key);
  if (!s || !confirm(`ไม่อนุมัติให้${tShort(s.sub_id)}สอนแทน คาบ ${s.period}?\nคาบนี้จะกลับไปว่าง ให้ครูคนอื่นกดรับหรือจัดเองได้`)) return;
  saveSubs({ date: SUB.date, clear: [{ period: s.period, lesson_id: s.lesson_id }] });
}

/* ── แลกคาบ: ครูที่ไม่มาเลือกครูคู่แลก + คาบของครูคนนั้นที่จะไปสอนคืน (ภายใน 3 สัปดาห์ ในภาคเรียนเดียวกัน) ── */
const SWAP = { n: null, data: null };
async function openSwapModal(key) {
  const n = needsOn(SUB.date).find(x => x.key === key);
  if (!n) return;
  const start = todayLocal() > SUB.date ? todayLocal() : SUB.date;
  try { SWAP.data = await apiFetch(`/api/tt/subs?from=${todayLocal()}&to=${addDays(start, 21)}`); } catch (e) { alert(e.message); return; }
  SWAP.n = n; SWAP.to = addDays(start, 21);
  const saved = savedOn(SUB.date), assigned = new Map(saved.map(s => [`${s.period}-${s.lesson_id}`, s.sub_id]));
  const cands = candidatesFor(n, SUB.date, assigned, subCounts(SUB.date)).filter(c => c.ok && c.t.id !== T.me);
  showModal('🔁 แลกคาบ', `
    <div class="small mb-2">คาบของคุณ: <b>${esc(formatThaiDateFull(SUB.date))} คาบ ${n.p} ${esc(classLabel(n.l))} ${esc(lessonName(n.l))}</b><br>
      ครูคู่แลกสอนคาบนี้แทนคุณ แล้วคุณไปสอนคาบของครูคนนั้นคืน (แบบฟอร์มหน้า 2 "การแลกเปลี่ยนคาบสอน")</div>
    <label class="form-label small mb-0">ครูคู่แลก <span class="text-muted">(ว่างคาบนี้)</span></label>
    <select id="swB" class="form-select form-select-sm mb-2" onchange="fillSwapSlots()">
      <option value="">— เลือกครู —</option>${cands.map(c => `<option value="${c.t.id}">${esc(tShort(c.t.id))}${c.why.length ? ' · ' + esc(c.why.join(' · ')) : ''}</option>`).join('')}</select>
    <label class="form-label small mb-0">คาบของครูคู่แลกที่คุณจะไปสอนคืน <span class="text-muted">(คุณว่าง · ภายใน ${esc(shortDate(SWAP.to))})</span></label>
    <select id="swSlot" class="form-select form-select-sm mb-2" disabled><option value="">— เลือกครูคู่แลกก่อน —</option></select>
    <div class="small text-muted">ส่งแล้วครูคู่แลกต้องกด <b>ยืนยัน</b> ในแท็บสอนแทน จากนั้นผู้จัดสอนแทนอนุมัติ · ยกเลิกเองได้ก่อนอนุมัติ</div>
    ${cands.length ? '' : '<div class="alert alert-warning small py-1 mt-2 mb-0">ไม่มีครูที่ว่างคาบนี้</div>'}`,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
     <button class="btn btn-primary btn-sm" onclick="sendSwap()"><i class="bi bi-send"></i> ส่งคำขอแลก</button>`);
}
// คาบสอนของครู B ที่ฉันว่าง: ไม่มีสอน ไม่ได้ลา ไม่ได้สอนแทน/สอนคืนที่อื่น และยังไม่ถูกใช้แลก
function swapSlots(bid) {
  const me = T.me, R = SWAP.data, out = [];
  const absent = (d, p) => R.absences.some(a => a.teacher_id === me && a.date_from <= d && d <= a.date_to && (!a.periods.length || a.periods.includes(p)));
  for (let d = todayLocal(); d <= SWAP.to; d = addDays(d, 1)) {
    const wd = wdOf(d);
    if (wd < 1 || wd > 5 || !inTerm(d) || R.holidays.some(h => h.date === d && h.type === 'holiday')) continue;
    periodsOf().forEach(({ no: p }) => {
      if (d === SUB.date && p === SWAP.n.p) return;
      if ((IDX.byTeacher[me] || {})[`${wd}-${p}`]?.length || absent(d, p) || isUnavailable(me, wd, p)) return;
      if (R.subs.some(s => (s.date === d && s.period === p && s.sub_id === me) || (isSwap(s) && s.swap_date === d && s.swap_period === p && s.absent_id === me))) return;
      ((IDX.byTeacher[bid] || {})[`${wd}-${p}`] || []).forEach(l => {
        if (!l.classes.length || l.teacher_ids.includes(me) || (typeof isSupervise === 'function' && isSupervise(l))) return;
        if (R.subs.some(s => isSwap(s) && s.swap_date === d && s.swap_period === p && s.swap_lesson_id === l.id)) return;
        out.push({ d, p, l });
      });
    });
  }
  return out;
}
function fillSwapSlots() {
  const bid = +el('swB').value, sel = el('swSlot'), P = Object.fromEntries(periodsOf().map(x => [x.no, x]));
  const list = bid ? swapSlots(bid) : [];
  sel.disabled = !list.length;
  sel.innerHTML = !bid ? '<option value="">— เลือกครูคู่แลกก่อน —</option>'
    : !list.length ? '<option value="">— ไม่มีคาบที่คุณว่างตรงกับคาบสอนของครูคนนี้ —</option>'
    : list.map(x => `<option value="${x.d}|${x.p}|${x.l.id}">${esc(shortDate(x.d))} (${['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][wdOf(x.d)]}) คาบ ${x.p}${P[x.p] ? ` ${P[x.p].start}` : ''} · ${esc(classLabel(x.l))} ${esc(lessonName(x.l))}</option>`).join('');
}
async function sendSwap() {
  const bid = +el('swB').value, v = el('swSlot').value;
  if (!bid || !v) { alert('เลือกครูคู่แลก และคาบที่จะไปสอนคืน'); return; }
  const [sd, sp, sl] = v.split('|'), n = SWAP.n;
  const r = await subPost('/api/tt/subs/swap', { ...subKey(n), sub_id: bid, swap_date: sd, swap_period: +sp, swap_lesson_id: +sl },
    `ส่งคำขอแลกคาบแล้ว — รอ${tShort(bid)}ยืนยัน`);
  if (r) edModal.hide();
}
async function answerSwap(key, accept) {
  const n = needsOn(SUB.date).find(x => x.key === key), s = savedOn(SUB.date).find(x => `${x.period}-${x.lesson_id}` === key);
  if (!n || !s) return;
  if (!confirm(accept ? `ยืนยันแลกคาบ: คุณสอนคาบ ${n.p} ${classLabel(n.l)} แทน${tShort(s.absent_id)}\nและ${tShort(s.absent_id)}สอนคืน ${swapLabel(s)}?`
                      : `ไม่รับแลกคาบกับ${tShort(s.absent_id)}? (คาบนี้จะกลับไปว่าง)`)) return;
  await subPost('/api/tt/subs/swap/answer', { ...subKey(n), accept }, accept ? 'ยืนยันแลกคาบแล้ว — รอผู้จัดสอนแทนอนุมัติ' : 'ไม่รับแลกคาบแล้ว');
  if (accept) { await loadSubs(); renderSubsBody(); }        // ให้กล่องคาบสอนคืนอัปเดต
}

/* ── หน้าจอ ── */
async function renderSubs() {
  if (!SUB.date) { SUB.date = todayLocal(); if (wdOf(SUB.date) === 0 || wdOf(SUB.date) === 6) SUB.date = nextSchoolDay(SUB.date, 1); }
  el('content').innerHTML = `<div class="container sub-screen"><div id="subBody"><div class="text-center text-muted py-5"><div class="spinner-border"></div></div></div></div>`;
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
  const date = SUB.date, admin = !!T.can_subs, hol = holidayOn(date), wd = wdOf(date);
  const needs = needsOn(date), saved = savedOn(date), counts = subCounts(date);
  const savedBy = new Map(saved.map(s => [`${s.period}-${s.lesson_id}`, s]));
  const assigned = new Map(saved.map(s => [`${s.period}-${s.lesson_id}`, s.sub_id]));
  const backs = backsOn(date), backBy = new Map(backs.map(s => [`${s.swap_period}-${s.swap_lesson_id}`, s]));
  const todo = needs.filter(n => !n.skip);
  const done = todo.filter(n => (savedBy.has(n.key) && !notFinal(savedBy.get(n.key))) || backBy.has(n.key)).length;
  const pend = todo.filter(n => isPending(savedBy.get(n.key))).map(n => n.key);
  const canPick = !!T.me && date >= todayLocal();             // ครูที่ผูกบัญชีแล้ว กดรับได้ตั้งแต่วันนี้เป็นต้นไป
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
    <span class="ms-auto d-flex gap-1">
      ${T.is_admin ? `<button class="btn btn-sm btn-outline-secondary" onclick="openEditorsModal()" title="ตั้งว่าใครจัด/อนุมัติสอนแทนได้"><i class="bi bi-person-gear"></i> สิทธิ์</button>` : ''}
      ${T.is_admin ? `<button class="btn btn-sm btn-outline-danger" onclick="openResetModal()" title="ล้างข้อมูลสอนแทนทดลองของภาคเรียนนี้ เริ่มนับสถิติใหม่"><i class="bi bi-arrow-counterclockwise"></i> รีเซตสถิติ</button>` : ''}
      <a class="btn btn-sm btn-outline-secondary" href="/subs-guide.html" target="_blank" rel="noopener"><i class="bi bi-book"></i> คู่มือ</a></span>
  </div></div><div class="row g-2">`;

  // ซ้าย: ครูไม่มา + สรุป
  const abs = absencesOn(date);
  html += `<div class="col-lg-4">
    <div class="card mb-2"><div class="card-body py-2">
      <div class="d-flex align-items-center mb-1"><div class="fw-bold flex-fill"><i class="bi bi-person-dash me-1"></i>ครูที่ไม่มา / ฝากสอน</div>
        ${admin ? `<button class="btn btn-sm btn-danger" onclick="openAbsenceModal()"><i class="bi bi-plus-lg"></i> บันทึกครูไม่มา</button>`
          : T.me ? `<button class="btn btn-sm btn-warning" onclick="openAbsenceModal()"><i class="bi bi-send"></i> ฝากสอน</button>` : ''}</div>
      ${abs.length ? abs.map(a => `<div class="sub-abs d-flex align-items-start gap-2">
          <div class="flex-fill"><b>${esc(tName(a.teacher_id))}</b> <span class="badge text-bg-warning">${esc(a.reason || 'ไม่มา')}</span>
            <div class="small text-muted">${esc(periodLabel(a.periods))} · ${esc(spanLabel(a))}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
          <button class="btn btn-sm btn-link p-0" onclick="openMemo(${a.id})" title="บันทึกข้อความขออนุญาตสอนแทน (Word / PDF)"><i class="bi bi-file-earmark-text"></i></button>
          ${admin || a.editable ? `<button class="btn btn-sm btn-link p-0" onclick="openAbsenceModal(${a.id})" title="แก้ไข"><i class="bi bi-pencil-square"></i></button>` : ''}
        </div>`).join('') : '<div class="small text-muted py-1">— ไม่มี —</div>'}
    </div></div>
    <div class="d-none d-lg-block">${statsHTML(counts)}</div>
  </div>`;

  // ขวา: คาบที่ต้องจัด
  const rows = needs.map(n => {
    const s = savedBy.get(n.key), time = P[n.p] ? `${P[n.p].start}-${P[n.p].end}` : '';
    let pick;
    const bk = !s && backBy.get(n.key);
    const swapInfo = isSwap(s) ? `<div class="small text-primary">🔁 แลกคาบ — ${esc(tShort(s.absent_id))}สอนคืน ${esc(swapLabel(s))}</div>` : '';
    if (n.skip) pick = `<span class="text-muted small">ไม่ต้องจัด (${esc(n.skip)})</span>`;
    else if (bk) pick = `<b>${esc(tShort(bk.absent_id))}</b> <span class="badge ${isPending(bk) ? 'text-bg-warning' : 'text-bg-success'}">${isPending(bk) ? 'รออนุมัติ' : 'สอนคืน'}</span>
        <div class="small text-primary">🔁 แลกคาบกับ${esc(tShort(bk.sub_id))} (${esc(shortDate(bk.date))} คาบ ${bk.period})</div>`;
    else if (admin) {
      const cands = candidatesFor(n, date, assigned, counts);
      const opt = c => `<option value="${c.t.id}" ${s?.sub_id === c.t.id ? 'selected' : ''} ${c.ok || s?.sub_id === c.t.id ? '' : 'disabled'}>` +
        `${esc(tShort(c.t.id))} · แทนแล้ว ${c.total}${c.why.length ? ' · ' + esc(c.why.join(' · ')) : ''}</option>`;
      pick = (isOffer(s) ? `<div class="sub-req mb-1"><span class="badge text-bg-info">รอ${esc(tShort(s.sub_id))}ยืนยัน</span> ${esc(tShort(s.absent_id))}ขอแลกคาบ${swapInfo}</div>`
        : isPending(s) ? `<div class="sub-req mb-1"><span class="badge text-bg-warning">รออนุมัติ</span> <b>${esc(tShort(s.sub_id))}</b> ${isSwap(s) ? 'แลกคาบ' : 'ขอรับสอนแทน'}${swapInfo}
          <div class="mt-1"><button class="btn btn-sm btn-success py-0" onclick="approveSubs(['${n.key}'])"><i class="bi bi-check-lg"></i> อนุมัติ</button>
          <button class="btn btn-sm btn-outline-danger py-0" onclick="rejectSub('${n.key}')">ไม่อนุมัติ</button></div></div>` : '') +
        `<select class="form-select form-select-sm ${!s ? 'border-danger' : notFinal(s) || !s.sub_id ? 'border-warning' : 'is-valid'}" onchange="setSub('${n.key}', this.value)">
          <option value="" ${s ? '' : 'selected'}>— ยังไม่จัด —</option>
          <option value="none" ${s && !s.sub_id ? 'selected' : ''}>✗ ไม่มีครูแทน (มอบงาน/รวมห้อง)</option>
          <optgroup label="ว่าง — เรียงตามความเหมาะสม">${cands.filter(c => c.ok).map(opt).join('')}</optgroup>
          <optgroup label="ไม่ว่าง">${cands.filter(c => !c.ok).map(opt).join('')}</optgroup></select>
        ${s && !notFinal(s) ? (isSwap(s) ? swapInfo : '') + `<input class="form-control form-control-sm mt-1" placeholder="หมายเหตุ เช่น ให้ทำใบงาน หน้า 12" value="${esc(s.note)}" onchange="setSubNote('${n.key}', this.value)">` : ''}`;
    } else if (!s) {                                             // ยังไม่มีใครรับ → ครูที่ว่างกดรับได้
      const me = canPick ? candidatesFor(n, date, assigned, counts).find(c => c.t.id === T.me) : null;
      const free = canPick && (me ? me.ok : !n.gone.includes(T.me));
      const ownPeriod = canPick && n.gone.includes(T.me);         // คาบของฉันที่ฝากสอนไว้ → ขอแลกคาบได้
      pick = `<span class="text-danger small">ยังไม่มีครูแทน</span>` +
        (free ? `<div><button class="btn btn-sm btn-primary mt-1 text-nowrap" onclick="volunteer('${n.key}')">🙋 รับสอนแทน</button></div>`
          : ownPeriod ? `<div><button class="btn btn-sm btn-outline-primary mt-1 text-nowrap" onclick="openSwapModal('${n.key}')">🔁 แลกคาบ</button></div>`
          : me && me.why.length ? `<div class="small text-muted">${esc(me.why[0])}</div>` : '');
    } else if (isOffer(s)) pick = s.sub_id === T.me
        ? `<div class="sub-req"><b>🔁 ${esc(tShort(s.absent_id))}ขอแลกคาบกับคุณ</b><div class="small">คุณสอนคาบนี้ · ${esc(tShort(s.absent_id))}สอนคืน ${esc(swapLabel(s))}</div>
            <div class="mt-1"><button class="btn btn-sm btn-success py-0" onclick="answerSwap('${n.key}', true)"><i class="bi bi-check-lg"></i> ยืนยัน</button>
            <button class="btn btn-sm btn-outline-danger py-0" onclick="answerSwap('${n.key}', false)">ไม่รับ</button></div></div>`
        : `<span class="badge text-bg-info">รอ${esc(tShort(s.sub_id))}ยืนยัน</span>${swapInfo}` +
          (s.absent_id === T.me ? `<div><button class="btn btn-sm btn-link p-0 text-danger" onclick="withdrawSub('${n.key}')">ยกเลิกคำขอแลก</button></div>` : '');
    else if (isPending(s)) pick = `<span class="badge text-bg-warning">รออนุมัติ</span> <b>${esc(tShort(s.sub_id))}</b>${swapInfo}` +
        (s.sub_id === T.me || (isSwap(s) && s.absent_id === T.me) ? `<div><button class="btn btn-sm btn-link p-0 text-danger" onclick="withdrawSub('${n.key}')">${isSwap(s) && s.absent_id === T.me ? 'ยกเลิกคำขอแลก' : 'ยกเลิกการรับ'}</button></div>` : '');
    else pick = (s.sub_id ? `<b>${esc(tShort(s.sub_id))}</b> <span class="badge text-bg-success">อนุมัติแล้ว</span>` : 'ไม่มีครูแทน') + swapInfo +
        (s.note ? `<div class="small text-muted">${esc(s.note)}</div>` : '');
    const mine = !admin && s?.sub_id && s.sub_id === T.me;
    return `<tr class="${n.skip ? 'table-light text-muted' : ''}${mine ? ' table-warning' : ''}">
      <td class="text-center"><b>${n.p}</b><div class="small text-muted text-nowrap">${esc(time)}</div></td>
      <td class="text-nowrap">${esc(classLabel(n.l))}</td>
      <td><b>${esc(lessonName(n.l))}</b>${n.l.code && T.subjects[n.l.code]?.name ? `<div class="small text-muted">${esc(T.subjects[n.l.code].name)}</div>` : ''}
        <div class="small text-muted d-md-none">แทน${esc(n.gone.map(tShort).join(', '))}</div>
        ${!n.skip && canClassList(n, s) ? classListLinks(n) : ''}</td>
      <td class="text-nowrap d-none d-md-table-cell">${esc(n.gone.map(tShort).join(', '))}</td>
      <td style="min-width:${admin ? 180 : 110}px">${pick}</td></tr>`;
  }).join('');
  // บันทึกที่ไม่ตรงตารางปัจจุบันแล้ว (ตาราง/บันทึกไม่มาเปลี่ยน)
  const stale = saved.filter(s => !needs.some(n => n.key === `${s.period}-${s.lesson_id}` && !n.skip));
  html += `<div class="col-lg-8"><div class="card"><div class="card-body py-2">
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <div class="fw-bold flex-fill"><i class="bi bi-arrow-left-right me-1"></i>คาบที่ต้องมีครูสอนแทน
        <span class="badge ${done < todo.length ? 'bg-danger' : 'bg-success'}">จัดแล้ว ${done}/${todo.length}</span>
        ${pend.length ? `<span class="badge text-bg-warning">รออนุมัติ ${pend.length}</span>` : ''}</div>
      ${admin && pend.length > 1 ? `<button class="btn btn-sm btn-success" onclick="approveSubs(${esc(JSON.stringify(pend))})"><i class="bi bi-check2-all"></i> อนุมัติทั้งหมด</button>` : ''}
      ${admin && todo.length ? `<button class="btn btn-sm btn-primary" onclick="autoAssign()"><i class="bi bi-magic"></i> จัดอัตโนมัติ</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="clearDay()">ล้าง</button>` : ''}
      ${todo.length ? `<button class="btn btn-sm btn-success" onclick="openLineModal()"><i class="bi bi-line"></i> ส่ง LINE / รูปภาพ</button>` : ''}
    </div>
    ${needs.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-1 sub-table">
      <thead class="table-light"><tr><th class="text-center">คาบ</th><th>ชั้น</th><th>วิชา</th><th class="d-none d-md-table-cell">ครูที่ไม่มา</th><th>สอนแทนโดย</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      ${admin ? '<div class="small text-muted">รายชื่อเรียง: สอนแทนมาน้อยก่อน (นับตั้งแต่ ' + shortDate(SUB.from) + ') · สาระเดียวกัน · สอนห้องนี้อยู่ · วันนั้นมีคาบน้อย · ครูกดรับเองได้ (รออนุมัติ)</div>'
        : canPick ? '<div class="small text-muted">คาบที่คุณว่างจะมีปุ่ม 🙋 รับสอนแทน — คนแรกที่กดได้คาบนั้น แล้วรอผู้จัดสอนแทนอนุมัติ</div>' : ''}`
      : `<div class="text-center text-muted py-4">${hol?.type === 'holiday' || wd === 0 || wd === 6 || !inTerm(date) ? 'ไม่มีการเรียนการสอน' : abs.length ? 'ครูที่ไม่มาไม่มีคาบสอนวันนี้' : 'ไม่มีครูไม่มา — ไม่ต้องจัดครูแทน'}</div>`}
    ${stale.length ? `<div class="alert alert-warning py-1 px-2 small mt-2 mb-0">มีบันทึกที่ไม่ตรงตาราง/บันทึกไม่มาแล้ว ${stale.length} รายการ
      (${stale.map(s => `คาบ ${s.period} ${esc(s.class_label)} ${esc(s.subject)}`).join(', ')})
      ${admin ? `<button class="btn btn-sm btn-link p-0 ms-1" onclick="saveSubs({date: SUB.date, clear: ${esc(JSON.stringify(stale.map(s => ({ period: s.period, lesson_id: s.lesson_id }))))}})">ลบทิ้ง</button>` : ''}</div>` : ''}
  </div></div>
  ${backs.length ? `<div class="card mt-2"><div class="card-body py-2"><div class="fw-bold mb-1">🔁 คาบสอนคืนจากการแลกคาบ</div>
    ${backs.sort((a, b) => a.swap_period - b.swap_period).map(b => `<div class="small border-top py-1">คาบ <b>${b.swap_period}</b>${P[b.swap_period] ? ` (${esc(P[b.swap_period].start)}-${esc(P[b.swap_period].end)})` : ''}
      · ${esc(b.swap_class_label)} ${esc(b.swap_subject)} — <b>${esc(tShort(b.absent_id))}</b> สอนแทน${esc(tShort(b.sub_id))}
      <span class="badge ${isPending(b) ? 'text-bg-warning' : 'text-bg-success'}">${isPending(b) ? 'รออนุมัติ' : 'อนุมัติแล้ว'}</span>
      <span class="text-muted">(แลกกับคาบ ${b.period} วันที่ ${esc(shortDate(b.date))})</span></div>`).join('')}</div></div>` : ''}
  </div>
  <div class="col-12 d-lg-none">${statsHTML(counts)}</div></div>`;   // มือถือ: สรุปไว้ท้ายสุด
  box.innerHTML = html;
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
  const self = !T.can_subs;                                  // ครูทั่วไป = ฝากสอนของตัวเอง (สาเหตุ 3 อย่าง ไม่ย้อนหลัง)
  const start = self && SUB.date < todayLocal() ? todayLocal() : SUB.date;
  const a = id ? SUB.data.absences.find(x => x.id === id)
               : { teacher_id: self ? T.me : '', date_from: start, date_to: start, periods: [], reason: 'ลาป่วย', note: '' };
  if (!a) return;
  const list = T.teachers.filter(t => IDX.byTeacher[t.id] || t.id === a.teacher_id);
  const la = lunchAfter(), P = periodsOf();
  const mode = !a.periods.length ? 'all' : periodLabel(a.periods) === 'ช่วงเช้า' ? 'am' : periodLabel(a.periods) === 'ช่วงบ่าย' ? 'pm' : 'some';
  const open = a.date_to === OPEN_END;
  const reasons = self ? SELF_REASONS : [...new Set([...SUB_REASONS, a.reason].filter(Boolean))];
  const body = self ? `
    <div class="mb-2"><span class="small text-muted">ครูที่ฝากสอน</span> <b>${esc(tName(a.teacher_id))}</b><input type="hidden" id="abT" value="${a.teacher_id}"></div>` : `
    <label class="form-label small mb-0">ครู</label>
    <select id="abT" class="form-select form-select-sm mb-2"><option value="">— เลือกครู —</option>
      ${list.map(t => `<option value="${t.id}" ${t.id === a.teacher_id ? 'selected' : ''}>ครู${esc(t.name)}</option>`).join('')}
      ${a.teacher_id && !list.some(t => t.id === a.teacher_id) ? `<option value="${a.teacher_id}" selected>${esc(tName(a.teacher_id))}</option>` : ''}</select>`;
  const minD = self ? ` min="${todayLocal()}"` : '';
  const body2 = `
    <div class="row g-2 mb-2">
      <div class="col-6"><label class="form-label small mb-0">สาเหตุที่ไม่ได้สอน</label>
        <select id="abR" class="form-select form-select-sm">${reasons.map(r => `<option ${r === a.reason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
      <div class="col-6"><label class="form-label small mb-0">${self ? 'งานที่ฝาก / หมายเหตุ' : 'หมายเหตุ'}</label>
        <input id="abN" class="form-control form-control-sm" maxlength="200" value="${esc(a.note)}" placeholder="${self ? 'เช่น ให้ทำใบงานหน้า 12' : 'เช่น ไปอบรมที่ สพม.'}"></div>
    </div>
    <div class="row g-2 align-items-end mb-2">
      <div class="col-6"><label class="form-label small mb-0">ตั้งแต่วันที่</label><input id="abF" type="date" class="form-control form-control-sm" value="${a.date_from}"${minD}></div>
      <div class="col-6"><label class="form-label small mb-0">ถึงวันที่</label><input id="abTo" type="date" class="form-control form-control-sm" value="${open ? '' : a.date_to}" ${open ? 'disabled' : ''}${minD}></div>
      ${self ? '' : `<div class="col-12"><div class="form-check small"><input class="form-check-input" type="checkbox" id="abOpen" ${open ? 'checked' : ''}
        onchange="el('abTo').disabled = this.checked"><label class="form-check-label" for="abOpen">ยังไม่มีกำหนด (เช่น ย้ายออก รอครูใหม่ — กลับมาแก้ "ถึงวันที่" ทีหลัง)</label></div></div>`}
    </div>
    <label class="form-label small mb-0">คาบที่ไม่อยู่</label>
    <div class="btn-group btn-group-sm w-100 mb-1" role="group">
      ${[['all', 'ทั้งวัน'], ['am', 'ช่วงเช้า'], ['pm', 'ช่วงบ่าย'], ['some', 'เลือกคาบ']].map(([k, lab]) =>
        `<input type="radio" class="btn-check" name="abM" id="abM_${k}" value="${k}" ${k === mode ? 'checked' : ''} onchange="el('abPs').classList.toggle('d-none', this.value !== 'some')">
         <label class="btn btn-outline-primary" for="abM_${k}">${lab}</label>`).join('')}
    </div>
    <div id="abPs" class="${mode === 'some' ? '' : 'd-none'}">${P.map(x => `<div class="form-check form-check-inline small">
      <input class="form-check-input" type="checkbox" id="abP${x.no}" value="${x.no}" ${a.periods.includes(x.no) ? 'checked' : ''}><label class="form-check-label" for="abP${x.no}">${x.no}</label></div>`).join('')}</div>
    ${self ? '<div class="small text-muted mt-2">บันทึกแล้ว ครูคนอื่นจะเห็นคาบของคุณและกด "รับสอนแทน" ได้ จากนั้นผู้จัดสอนแทนอนุมัติ · พิมพ์บันทึกข้อความได้ที่ปุ่ม 📄</div>' : ''}`;
  showModal(self ? (id ? 'แก้ไขการฝากสอน' : 'ฝากสอน') : id ? 'แก้ไขบันทึกครูไม่มา' : 'บันทึกครูไม่มา', body + body2,
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
                 date_from: el('abF').value, date_to: el('abOpen')?.checked ? OPEN_END : (el('abTo').value || el('abF').value), periods };
  if (!body.teacher_id) { alert('เลือกครู'); return; }
  try {
    const r = await apiFetch(id ? `/api/tt/absences/${id}` : '/api/tt/absences', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    edModal.hide();
    if (r.removed_subs) toastEd(`ลบการจัดครูแทนที่ไม่ต้องใช้แล้ว ${r.removed_subs} คาบ`);
    else if (!T.can_subs && !id) toastEd('ฝากสอนแล้ว — ครูคนอื่นกดรับสอนแทนได้ · พิมพ์บันทึกข้อความได้ที่ปุ่ม 📄 ข้างชื่อ');
    await loadSubs();
    if (!T.can_subs && body.date_from !== SUB.date) { await gotoDate(body.date_from); return; }   // ไปวันที่ฝาก ให้เห็นคาบของตัวเอง
    renderSubsBody();
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

/* ── ส่ง LINE / ดาวน์โหลดรูป — รูปแบบที่โรงเรียนใช้ในกลุ่มไลน์ครู:
   🧡วันพฤหัสบดี ที่ 24 กันยายน 2569 · แยกตามครูที่ไม่มา "ครูณัฐธิดา (ไปราชการ)" · "คาบ 1-2 ม.5 ครูเปี่ยมจิตร" ── */
function lineText() {
  const date = SUB.date, d = dateOf(date);
  const saved = new Map(savedOn(date).map(s => [`${s.period}-${s.lesson_id}`, s]));
  const out = [`🧡วัน${THAI_DAYS[d.getDay()]} ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`];
  const needs = needsOn(date).filter(n => !n.skip), abs = absencesOn(date);
  const order = [...new Set(abs.map(a => a.teacher_id))];                 // เรียงตามบันทึกครูไม่มา
  needs.forEach(n => { if (!order.includes(n.absent)) order.push(n.absent); });
  order.forEach(tid => {
    const mine = needs.filter(n => n.absent === tid).sort((a, b) => a.p - b.p);
    if (!mine.length) return;                                             // ไม่มา แต่วันนั้นไม่มีคาบต้องจัด → ไม่ต้องแสดง
    const reason = abs.find(a => a.teacher_id === tid)?.reason;
    out.push('', `${tShort(tid)}${reason ? ` (${reason})` : ''}`);
    const rows = [];                                                      // คาบติดกัน ห้องเดียวกัน ครูแทนคนเดียวกัน → "คาบ 1-2"
    mine.forEach(n => {
      const s = saved.get(n.key), cls = classLabel({ ...n.l, track: '' });
      const bk = !s && backsOn(date).find(b => `${b.swap_period}-${b.swap_lesson_id}` === n.key);
      const who = bk ? tShort(bk.absent_id) + ' (สอนคืน แลกคาบ)' : !s ? '❗ยังไม่จัด'
        : s.sub_id ? tShort(s.sub_id) + (isSwap(s) ? ' (แลกคาบ)' : '') + (isOffer(s) ? ' (รอยืนยัน)' : isPending(s) ? ' (รออนุมัติ)' : '') : `ไม่มีครูแทน${s.note ? ` (${s.note})` : ''}`;
      const last = rows[rows.length - 1];
      if (last && last.cls === cls && last.who === who && last.p2 === n.p - 1) { last.p2 = n.p; return; }
      rows.push({ p1: n.p, p2: n.p, cls, who });
    });
    rows.forEach(r => out.push(`คาบ ${r.p1 === r.p2 ? r.p1 : r.p1 + '-' + r.p2} ${r.cls} ${r.who}`));
  });
  const backs = backsOn(date).filter(b => !needs.some(n => n.key === `${b.swap_period}-${b.swap_lesson_id}`)).sort((a, b) => a.swap_period - b.swap_period);
  if (backs.length) out.push('', '🔁 แลกคาบ (สอนคืน)', ...backs.map(b => `คาบ ${b.swap_period} ${b.swap_class_label} ${tShort(b.absent_id)} สอนแทน${tShort(b.sub_id)}`));
  if (out.length === 1) out.push('', 'ไม่มีคาบที่ต้องจัดครูสอนแทน');
  return out.join('\n');
}

function openLineModal() {
  const left = needsOn(SUB.date).filter(n => !n.skip && !savedOn(SUB.date).some(s => `${s.period}-${s.lesson_id}` === n.key)).length;
  const pend = savedOn(SUB.date).filter(isPending).length;
  showModal('<i class="bi bi-line"></i> ส่งรายการสอนแทน — ข้อความ / รูปภาพ', `
    ${left ? `<div class="alert alert-warning py-1 px-2 small">ยังไม่ได้จัด ${left} คาบ — ในข้อความจะขึ้นว่า "❗ยังไม่จัด"</div>` : ''}
    ${pend ? `<div class="alert alert-warning py-1 px-2 small">รออนุมัติ ${pend} คาบ — ในข้อความจะขึ้นว่า "(รออนุมัติ)"</div>` : ''}
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label small mb-1">ข้อความ <span class="text-muted">(แก้ได้ รูปเปลี่ยนตาม)</span></label>
        <textarea id="lineMsg" class="form-control" rows="14" style="font-size:.95rem" oninput="updateSubPreview()">${esc(lineText())}</textarea>
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-1">รูปภาพ <span class="text-muted">(มือถือ: กดค้างที่รูปเพื่อบันทึกได้ด้วย)</span></label>
        <img id="subImgPrev" class="img-fluid border rounded w-100" alt="รูปรายการสอนแทน" style="background:#fff">
      </div>
    </div>`,
    `<button class="btn btn-secondary btn-sm me-auto" data-bs-dismiss="modal">ปิด</button>
     <a class="btn btn-outline-success btn-sm d-none" id="lineOpen" href="https://line.me/R/" target="_blank" rel="noopener"><i class="bi bi-line"></i> เปิดไลน์</a>
     <button class="btn btn-outline-success btn-sm" onclick="copyLine()"><i class="bi bi-clipboard-check"></i> ก๊อปข้อความ</button>
     <button class="btn btn-success btn-sm" onclick="downloadSubImage()"><i class="bi bi-download"></i> ดาวน์โหลดรูป</button>
     ${canShareFiles() ? '<button class="btn btn-primary btn-sm" onclick="shareSubImage()"><i class="bi bi-share"></i> แชร์รูป</button>' : ''}`);
  updateSubPreview();
}

// วาดข้อความเป็นรูป (พื้นขาว ตัวหนังสือเทาเข้ม แบบรูปที่ใช้ในกลุ่มไลน์) — กว้าง 1080 px ชัดทั้งมือถือและคอม
async function subImageCanvas(text) {
  try { await document.fonts.load('400 42px Sarabun'); await document.fonts.load('600 42px Sarabun'); } catch (e) {}
  const W = 1080, PAD = 64, FS = 42, LH = Math.round(FS * 1.62), MAXW = W - PAD * 2;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d');
  const font = w => `${w} ${FS}px Sarabun, "Noto Sans Thai", Thonburi, sans-serif`;
  cx.font = font(600);
  const lines = [];                                        // ตัดบรรทัดที่ยาวเกินรูป (ตัดที่ช่องว่างก่อน ไม่มีก็ตัดทีละตัวอักษร)
  text.replace(/\r/g, '').split('\n').forEach(raw => {
    let cur = '';
    for (const part of raw.split(/(\s+)/)) {
      if (cx.measureText(cur + part).width <= MAXW) { cur += part; continue; }
      if (cur.trim()) { lines.push(cur.trimEnd()); cur = ''; }
      for (const ch of part.trimStart()) {
        if (cx.measureText(cur + ch).width > MAXW) { lines.push(cur); cur = ''; }
        cur += ch;
      }
    }
    lines.push(cur);
  });
  cv.width = W; cv.height = PAD * 2 + lines.length * LH;
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    const head = i === 0 || (ln.trim() && !/^คาบ\s/.test(ln) && (i === 0 || !lines[i - 1].trim()));   // หัววัน / ชื่อครูที่ไม่มา
    cx.font = font(head ? 600 : 400); cx.fillStyle = head ? '#1f1f1f' : '#3d3d3d';
    cx.fillText(ln, PAD, PAD + i * LH + LH / 2);
  });
  return cv;
}
let subPrevTimer = null;
function updateSubPreview() {
  clearTimeout(subPrevTimer);
  subPrevTimer = setTimeout(async () => {
    const img = el('subImgPrev'), ta = el('lineMsg');
    if (img && ta) img.src = (await subImageCanvas(ta.value)).toDataURL('image/png');
  }, 250);
}
const subImageName = () => `สอนแทน-${SUB.date}.png`;
async function subImageBlob() {
  const cv = await subImageCanvas(el('lineMsg').value);
  return new Promise(res => cv.toBlob(res, 'image/png'));
}
async function downloadSubImage() {
  const url = URL.createObjectURL(await subImageBlob());
  const a = Object.assign(document.createElement('a'), { href: url, download: subImageName() });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toastEd('ดาวน์โหลดรูปแล้ว — ส่งในกลุ่มไลน์ได้เลย');
}
// มือถือ: เปิดหน้าแชร์ของเครื่อง (เลือก LINE ได้ทันที) · ไม่รองรับ → ดาวน์โหลดแทน
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; }
}
async function shareSubImage() {
  const file = new File([await subImageBlob()], subImageName(), { type: 'image/png' });
  try { await navigator.share({ files: [file], title: 'สอนแทน' }); }
  catch (e) { if (e.name !== 'AbortError') downloadSubImage(); }
}

async function copyLine() {
  const ta = el('lineMsg');
  try { await navigator.clipboard.writeText(ta.value); }
  catch (e) { ta.select(); document.execCommand('copy'); }          // เบราว์เซอร์ในแอป LINE บางรุ่นไม่ให้ใช้ clipboard API
  el('lineOpen').classList.remove('d-none');
  toastEd('ก๊อปแล้ว — วางในกลุ่มไลน์ได้เลย');
}

/* ── รีเซตสถิติสอนแทน (แอดมิน): ลบบันทึกครูไม่มา + การจัดครูแทนของภาคเรียนที่เปิดอยู่ ใช้ล้างข้อมูลทดลอง ── */
async function openResetModal() {
  let r;
  try { r = await apiFetch(`/api/tt/subs/reset?term_id=${T.term.id}`); } catch (e) { alert(e.message); return; }
  const list = r.absences.map(a => `<li>${esc('ครู' + a.teacher)} — ${esc(a.reason || 'ไม่มา')} · ${esc(spanLabel(a))}</li>`).join('');
  showModal('<i class="bi bi-arrow-counterclockwise"></i> รีเซตสถิติสอนแทน', `
    <div class="small mb-2">ลบข้อมูลสอนแทนทั้งหมดของภาคเรียน <b>${esc(T.term.name)}</b> (${shortDate(r.date_from)} – ${shortDate(r.date_to)})
      แล้วสถิติ "จำนวนคาบสอนแทน" จะเริ่มนับใหม่ตั้งแต่ต้นภาคเรียน — ใช้ล้างข้อมูลทดลอง เช่น ก่อนเปิดเทอม หรือหลังสาธิตในที่ประชุม</div>
    <div class="fw-bold">จะลบ: บันทึกครูไม่มา / ฝากสอน ${r.absences.length} รายการ · การจัดครูแทน ${r.subs} คาบ</div>
    ${list ? `<ul class="small mb-2" style="max-height:35vh; overflow:auto">${list}</ul>` : '<div class="small text-muted mb-2">— ไม่มีบันทึกครูไม่มา —</div>'}
    <div class="alert alert-warning small py-1 mb-0">ลบแล้วกู้คืนไม่ได้ · บันทึกที่เริ่มก่อนเปิดภาคเรียน (เช่น ย้ายออก ไม่มีกำหนด) ไม่ถูกลบ</div>`,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
     <button class="btn btn-danger btn-sm" onclick="doReset()" ${r.absences.length || r.subs ? '' : 'disabled'}><i class="bi bi-trash"></i> ลบทั้งหมด</button>`);
}
async function doReset() {
  if (!confirm('ยืนยันลบข้อมูลสอนแทนทั้งหมดของภาคเรียน ' + T.term.name + ' ?')) return;
  try {
    const r = await apiFetch('/api/tt/subs/reset', { method: 'POST', body: JSON.stringify({ term_id: T.term.id }) });
    edModal.hide();
    toastEd(`รีเซตแล้ว — ลบบันทึกครูไม่มา ${r.absences} รายการ · การจัดครูแทน ${r.subs} คาบ`);
    await renderSubs();
  } catch (e) { alert(e.message); }
}

/* ── ครูเปิดตารางตัวเอง: เตือนคาบสอนแทน 7 วันข้างหน้า ── */
async function mySubsBanner() {
  if (!T || !T.me || view.mode !== 'teacher' || view.key !== String(T.me)) return;
  const from = todayLocal(), to = addDays(from, 7);
  let data;
  try { data = await apiFetch(`/api/tt/subs?from=${from}&to=${to}`); } catch (e) { return; }
  const mine = data.subs.filter(s => s.sub_id === T.me && s.date >= from && s.date <= to)
    .concat(data.subs.filter(s => isSwap(s) && !isOffer(s) && s.absent_id === T.me && s.swap_date >= from && s.swap_date <= to)
      .map(s => ({ ...s, date: s.swap_date, period: s.swap_period, class_label: s.swap_class_label, subject: s.swap_subject,
                   absent_id: s.sub_id, note: 'สอนคืน (แลกคาบ)' })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  if (!mine.length || view.mode !== 'teacher' || el('mySubs')) return;
  const P = Object.fromEntries(periodsOf().map(x => [x.no, x]));
  const box = document.createElement('div');
  box.id = 'mySubs'; box.className = 'container no-print mb-2';
  box.innerHTML = `<div class="alert alert-warning py-2 mb-0"><b><i class="bi bi-arrow-left-right me-1"></i>คาบสอนแทนของคุณ</b>
    ${mine.map(s => `<div>${s.date === from ? '<span class="badge bg-danger">วันนี้</span> ' : ''}${isOffer(s) ? '<span class="badge text-bg-info">ขอแลกคาบ รอคุณยืนยัน</span> ' : isPending(s) ? '<span class="badge text-bg-light border">รออนุมัติ</span> ' : ''}${esc(formatThaiDateFull(s.date).replace(/ พ\.ศ\. \d+/, ''))}
      คาบ ${s.period}${P[s.period] ? ` (${esc(P[s.period].start)}-${esc(P[s.period].end)})` : ''} · <b>${esc(s.class_label)} ${esc(s.subject)}</b>
      แทนครู${esc((IDX.teachers[s.absent_id]?.name || data.teacher_names?.[s.absent_id] || '').split(' ')[0])}${s.note ? ` · ${esc(s.note)}` : ''}</div>`).join('')}</div>`;
  el('content').prepend(box);
}
