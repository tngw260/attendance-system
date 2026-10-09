/* ===== ตัวจัดตารางสอน (แอดมิน) — ใช้คู่กับ timetable.html =====
   ลากวิชาไปวางในช่อง (หรือ แตะเลือก แล้วแตะช่อง — ใช้กับแท็บเล็ตได้)
   ช่องเขียว = วางได้ / เหลือง = ผิดเงื่อนไขอ่อน / แดง = ชน (ครูสอนซ้อน ห้องซ้อน ครูไม่ว่าง)
   สาย/กลุ่มผู้เรียน (ม.4-6): วิชาต่างสายวางช่องเดียวกันได้ ไม่นับว่าชน */

const ED = { by: 'class', key: '', picked: null, undo: [], preview: false };

// ระหว่างดูผลจัดอัตโนมัติ (ยังไม่บันทึก) ห้ามแก้ — ไม่งั้นข้อมูลในเครื่องกับเซิร์ฟเวอร์ไม่ตรงกัน
function previewGuard() {
  if (!ED.preview) return false;
  toastEd('กำลังดูผลจัดอัตโนมัติ — กด "บันทึกผลนี้" หรือ "ยกเลิก" ก่อนแก้ไข');
  return true;
}
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
// ครูบางคนไม่สอนคาบคู่ (เงื่อนไขครู) → วิชาของครูคนนั้นวางทีละคาบ แม้รายการจะติ๊กคาบคู่ไว้
const noDoubleTeacher = l => l.teacher_ids.find(t => ((IDX.teachers[t] || {}).constraints || {}).no_double);
const wantsDouble = l => !!(l.options || {}).double && !noDoubleTeacher(l);
// สอนติดกันไม่เกิน N คาบ: เงื่อนไขรายครู > กฎของครูทุกคน (config.max_run) · 0 = ไม่จำกัด
// นับเฉพาะคาบที่มีนักเรียน (รายการที่มีชั้น) · พักกลางวันตัดช่วง (เช้า 1..lunch / บ่าย lunch+1..คาบสุดท้ายของนักเรียน)
const maxRunOf = tid => +((((IDX.teachers[tid] || {}).constraints || {}).max_run) || T.term.config.max_run || 0);
const runSegments = () => [[1, lunchAfter()], [lunchAfter() + 1, periodsFor('class').length]];
// คาบที่อยู่กับนักเรียนต่อสัปดาห์ (รายการที่มีชั้น ตามจำนวนคาบ/สัปดาห์)
// คาบสอน = อยู่กับนักเรียน (รายการที่มีชั้น) ยกเว้นประชุม (เช่น ประชุมสุดสัปดาห์ที่นักเรียนเข้าร่วม) — ใช้กับกฎสอนติดกัน
const teachesStudents = l => l.classes.length > 0 && !isMeeting(l);
const teachLoad = tid => T.lessons.filter(l => teachesStudents(l) && l.teacher_ids.includes(tid)).reduce((a, l) => a + l.per_week, 0);
// สอนได้สูงสุดกี่คาบ/สัปดาห์ ถ้าห้ามติดกันเกิน m: ช่วงว่างยาว k คาบ สอนได้ k − ⌊k/(m+1)⌋ (คาบไม่ว่าง/ประชุม/PLC ตัดช่วง)
function runCapacity(tid, m) {
  const map = IDX.byTeacher[tid] || {}, un = new Set((((IDX.teachers[tid] || {}).constraints || {}).unavailable || []).map(([d, p]) => `${d}-${p}`));
  let cap = 0;
  for (let d = 1; d <= DAYS.length; d++) for (const [a, b] of runSegments()) {
    let k = 0;
    for (let p = a; p <= b + 1; p++) {
      if (p <= b && !un.has(`${d}-${p}`) && !(map[`${d}-${p}`] || []).some(x => !teachesStudents(x))) { k++; continue; }
      cap += k - Math.floor(k / (m + 1)); k = 0;
    }
  }
  return cap;
}
// กฎที่ทำได้จริงของครูคนนี้: ถ้าคาบสอนรวมเกินที่กฎรองรับ → ผ่อนทีละ 1 คาบจนพอ (0 = ไม่จำกัด)
function effectiveMaxRun(tid, m = maxRunOf(tid)) {
  if (!m) return 0;
  const load = teachLoad(tid);
  let e = m;
  while (e < 7 && runCapacity(tid, e) < load) e++;
  return e;
}
// ครูขอ "คาบว่างติดกัน 2 คาบทุกวัน" (เงื่อนไขครู free_pair): ว่าง = ไม่มีรายการใดเลย (วิชา/กิจกรรม/ประชุม)
// นับคาบ 1..คาบสุดท้ายของนักเรียน (PLC หลังเลิกเรียนไม่นับ) · คาบ 4 กับ 5 ที่คั่นพักกลางวันนับว่าติดกัน
const wantsFreePair = tid => !!(((IDX.teachers[tid] || {}).constraints || {}).free_pair);
const busyLoad = tid => T.lessons.filter(l => l.teacher_ids.includes(tid) && !(l.options || {}).staff).reduce((a, l) => a + l.per_week, 0);
// เพดานคาบต่อวัน: ไม่มีคู่ว่าง / มีคู่ว่าง (คิดรวมกฎสอนติดกันของครูคนนั้น — ช่วงยาว k สอนได้ k − ⌊k/(m+1)⌋)
const segCap = (k, m) => m ? k - Math.floor(k / (m + 1)) : k;
function pairDayCaps(tid) {
  const m = effectiveMaxRun(tid), segs = runSegments(), n = periodsFor('class').length;
  const noPair = segs.reduce((a, [s, e]) => a + segCap(e - s + 1, m), 0);
  let pair = 0;
  for (let q = 1; q < n; q++) {                     // ว่างคาบ q กับ q+1 → ที่เหลือในแต่ละช่วงคิดเพดานใหม่
    let cap = 0;
    for (const [s, e] of segs) {
      let k = 0;
      for (let p = s; p <= e + 1; p++) { if (p <= e && p !== q && p !== q + 1) k++; else { cap += segCap(k, m); k = 0; } }
    }
    pair = Math.max(pair, cap);
  }
  return { noPair, pair };
}
// วันที่มีคู่ว่างได้มากสุดต่อสัปดาห์ (ครูมีรายการ busyLoad คาบ)
function freePairMaxDays(tid) {
  const { noPair, pair } = pairDayCaps(tid), D = DAYS.length, load = busyLoad(tid);
  if (noPair <= pair) return D;
  return Math.max(0, Math.min(D, Math.floor((D * noPair - load) / (noPair - pair))));
}
function hasFreePair(isBusy) {                     // isBusy(p) → คาบ p ครูมีรายการ
  const n = periodsFor('class').length;
  for (let p = 1; p < n; p++) if (!isBusy(p) && !isBusy(p + 1)) return true;
  return false;
}
const dayBusy = (tid, d) => p => ((IDX.byTeacher[tid] || {})[`${d}-${p}`] || []).length > 0;
function teacherRuns(tid) {                       // [{d, s, e}] ช่วงที่ครูสอนต่อเนื่อง
  const map = IDX.byTeacher[tid] || {}, out = [];
  for (let d = 1; d <= DAYS.length; d++) for (const [a, b] of runSegments()) {
    let s = 0;
    for (let p = a; p <= b + 1; p++) {
      const on = p <= b && (map[`${d}-${p}`] || []).some(teachesStudents);
      if (on && !s) s = p;
      if (!on && s) { out.push({ d, s, e: p - 1 }); s = 0; }
    }
  }
  return out;
}

// สายย่อย: config.track_parents[ห้อง][สาย] = สายแม่ เช่น ม.5 "กลุ่ม 2" อยู่ใน "BEP" (เด็กชุดเดียวกัน)
const trackParents = cls => ((T.term.config.track_parents || {})[cls]) || {};
function trackChain(cls, t) {                    // [สาย, สายแม่, สายแม่ของแม่, …]
  const P = trackParents(cls), out = [t];
  while (P[out[out.length - 1]] && out.length < 6) out.push(P[out[out.length - 1]]);
  return out;
}
const trackRoot = (cls, t) => { const c = trackChain(cls, t); return c[c.length - 1]; };

// กฎ "นักเรียนไม่ว่างคาบ …" (config.class_busy เช่น [1] = คาบแรก): ทุกสายหลักของห้องต้องมีเรียนในคาบนั้นทุกวัน
const classBusyPeriods = () => (T.term.config.class_busy || []).filter(p => !isStaffPeriod(p));
const classRoots = cls => [...new Set(((T.term.config.tracks || {})[cls] || []).map(t => trackRoot(cls, t)))];
// สายหลักที่ยังไม่มีเรียนในช่องนี้ (ห้องไม่แยกสาย: ว่างทั้งห้อง = ['*'])
function missingRoots(cls, here, roots = classRoots(cls)) {
  if (!here.length) return roots.length >= 2 ? roots : ['*'];
  if (roots.length < 2) return [];
  const cov = new Set();
  here.forEach(l => { const t = tracksOf(l); (t.length ? t.map(x => trackRoot(cls, x)) : roots).forEach(x => cov.add(x)); });
  return roots.filter(r => !cov.has(r));
}
function classHoles(periods = classBusyPeriods()) {      // [{cls, d, p, miss}] ช่องที่นักเรียนว่างในคาบที่ห้ามว่าง
  const out = [];
  if (!periods.length) return out;
  IDX.classes.forEach(cls => {
    const roots = classRoots(cls);
    for (let d = 1; d <= DAYS.length; d++) periods.forEach(p => {
      const miss = missingRoots(cls, (IDX.byClass[cls] || {})[`${d}-${p}`] || [], roots);
      if (miss.length) out.push({ cls, d, p, miss });
    });
  });
  return out;
}
const holeLabel = h => `${classShort(h.cls)} วัน${DAYS[h.d - 1]} คาบ ${h.p}${h.miss[0] === '*' ? '' : ' (สาย ' + h.miss.join(', ') + ')'}`;

// นักเรียนทุกสายในห้องต้องเรียนพร้อมกัน: ช่องที่บางสายเรียน แต่บางสายว่าง → [{cls, d, p, busy, idle}]
function trackGaps() {
  const out = [], n = periodsFor('class').length;
  IDX.classes.forEach(cls => {
    const roots = classRoots(cls);
    if (roots.length < 2) return;
    for (let d = 1; d <= DAYS.length; d++) for (let p = 1; p <= n; p++) {
      const here = (IDX.byClass[cls] || {})[`${d}-${p}`] || [];
      const idle = here.length ? missingRoots(cls, here, roots) : [];
      if (idle.length && idle.length < roots.length) out.push({ cls, d, p, idle, busy: roots.filter(r => !idle.includes(r)) });
    }
  });
  return out;
}
// คาบต่อสัปดาห์: เรียนทั้งห้อง + เฉพาะแต่ละสายหลัก — สายต่าง ๆ ควรมีคาบเฉพาะสายเท่ากัน ถึงจะเรียนพร้อมกันได้ทุกคาบ
function trackBalance(cls) {
  const roots = classRoots(cls), per = Object.fromEntries(roots.map(r => [r, 0]));
  let whole = 0;
  T.lessons.filter(l => l.classes.includes(cls)).forEach(l => {
    const rs = [...new Set(tracksOf(l).map(t => trackRoot(cls, t)))].filter(r => r in per);
    if (rs.length) rs.forEach(r => { per[r] += l.per_week; }); else whole += l.per_week;
  });
  return { roots, per, whole, slots: DAYS.length * periodsFor('class').length };
}

// สองรายการในห้องเดียวกันเรียนพร้อมกันไม่ได้ ถ้ามีฝั่งใดเรียนทั้งห้อง หรือสายซ้อนกัน
// (สายเดียวกัน หรือสายย่อยกับสายแม่ของมัน · สายย่อยต่างสายแม่ / กลุ่มย่อยคนละกลุ่ม = คนละคน เรียนพร้อมกันได้)
function classOverlap(a, b) {
  const ta = tracksOf(a), tb = tracksOf(b);
  if (!ta.length || !tb.length) return true;
  const shared = a.classes.filter(c => b.classes.includes(c));
  return (shared.length ? shared : ['']).some(c =>
    ta.some(x => tb.some(y => trackChain(c, x).includes(y) || trackChain(c, y).includes(x))));
}

/* ── ปัญหาถ้าวางรายการ l ที่ (d,p) ── hard = ชนจริง / soft = ผิดเงื่อนไขที่ตั้งไว้ */
// opt.ignore = รายการที่ไม่นับ (เช่น ตอนคิดสลับช่อง) · opt.from = ช่องเดิมของ l ที่กำลังย้ายออก (ค่าเริ่มต้น: ช่องที่เลือกอยู่)
function conflictsAt(l, d, p, opt = {}) {
  const out = [];
  const fromSlot = 'from' in opt ? opt.from : (ED.picked && ED.picked.lid === l.id ? ED.picked.from : null);
  const others = (IDX.bySlot[`${d}-${p}`] || []).filter(x => x.id !== l.id && !(opt.ignore || []).includes(x.id));
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
  if (l.classes.length && isStaffPeriod(p)) out.push({ hard: true, msg: `คาบ ${p} เป็นคาบของครูหลังเลิกเรียน นักเรียนไม่มีเรียน` });
  if (teachesStudents(l) && !isStaffPeriod(p)) l.teacher_ids.forEach(tid => {      // วางแล้วครูสอนติดกันเกินกฎไหม
    const mx = maxRunOf(tid);
    if (!mx) return;
    const from = fromSlot && fromSlot[0] === d ? fromSlot[1] : 0;
    const on = q => q === p || (q !== from && ((IDX.byTeacher[tid] || {})[`${d}-${q}`] || []).some(teachesStudents));
    const seg = runSegments().find(([a, b]) => p >= a && p <= b);
    if (!seg) return;
    const [a, b] = seg;
    let s = p, e = p;
    while (s - 1 >= a && on(s - 1)) s--;
    while (e + 1 <= b && on(e + 1)) e++;
    if (e - s + 1 > mx) out.push({ hard: false, msg: `${teacherShort(tid)} จะสอนติดกัน ${e - s + 1} คาบ (กฎไม่เกิน ${mx})` });
  });
  if (!isStaffPeriod(p)) l.teacher_ids.forEach(tid => {                         // วางแล้ววันนั้นครูไม่เหลือคาบว่างติดกัน 2 คาบ
    if (!wantsFreePair(tid)) return;
    const from = fromSlot && fromSlot[0] === d ? fromSlot[1] : 0;
    const busy = q => q !== from && dayBusy(tid, d)(q);
    if (hasFreePair(busy) && !hasFreePair(q => q === p || busy(q))) out.push({ hard: false, msg: `${teacherShort(tid)} วันนี้จะไม่มีคาบว่างติดกัน 2 คาบ` });
  });
  if (((l.options || {}).avoid || []).includes(p)) out.push({ hard: false, msg: `วิชานี้ตั้งให้เลี่ยงคาบ ${p}` });
  if (!(l.options || {}).allow_same_day && l.kind === 'subject') {
    const same = l.slots.filter(s => s[0] === d && !(fromSlot && fromSlot[0] === s[0] && fromSlot[1] === s[1]));
    const adj = same.some(s => Math.abs(s[1] - p) === 1 && Math.min(s[1], p) !== lunchAfter());
    if (same.length && adj && noDoubleTeacher(l)) out.push({ hard: false, msg: `${teacherShort(noDoubleTeacher(l))} ไม่สอนคาบคู่` });
    else if (same.length && !adj) out.push({ hard: false, msg: 'วิชานี้มีในวันเดียวกันแล้ว' });
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
    if (isSupervise(l)) return;                                     // ครูดูแลซ่อมเสริม: ระบบจัดเอง ไม่เตือนวางไม่ครบ
    if (n < pw) soft.push({ type, key, lid: l.id, msg: `${name} ยังวางไม่ครบ (${n}/${pw})` });
    if (n > pw) soft.push({ type, key, lid: l.id, msg: `${name} วางเกิน (${n}/${pw})` });
    if (l.classes.length) l.slots.filter(s => isStaffPeriod(s[1])).forEach(([d, p]) =>
      hard.push({ d, p, type, key, lid: l.id, msg: `${name} อยู่คาบ ${p} ซึ่งเป็นคาบของครูหลังเลิกเรียน — ย้ายไปคาบ 1-${T.term.config.periods.filter(x => !x.teacher_only).length}` }));
    if (l.kind !== 'subject') return;
    // รหัสวิชาบอกชั้น: หลักที่ 1 = 2 ม.ต้น / 3 ม.ปลาย · หลักที่ 2 = ปีที่ (0 = วิชาเลือกได้หลายชั้น ไม่ตรวจ) เช่น ง31102 = ม.4
    if (l.code && !/^([ก-ฮ]{1,2}|[A-Z]{1,3})\d{5}$/.test(l.code))          // เช่น "พ3020..." ที่ถูกตัดมาจากไฟล์ตารางเดิม
      soft.push({ type, key, lid: l.id, msg: `${name}: รหัสวิชาไม่ครบ/รูปแบบผิด (ควรเป็นอักษร + ตัวเลข 5 หลัก เช่น พ30201)` });
    const cm = /^[ก-ฮA-Z]+([23])([1-3])\d{3}$/.exec(l.code || '');
    if (cm && l.classes.length) {
      const want = +cm[2] + (cm[1] === '3' ? 3 : 0), got = [...new Set(l.classes.map(c => +c.split('/')[0]))];
      if (got.length !== 1 || got[0] !== want)
        soft.push({ type, key, lid: l.id, msg: `${name}: รหัสวิชาเป็นของ ม.${want} แต่เรียนที่ ${got.map(g => 'ม.' + g).join(', ')} — ตรวจรหัสวิชา` });
    }
    const ss = sessionsOf(l), o = l.options || {};
    if (wantsDouble(l) && n >= 2 && ss.filter(s => s.ps.length === 1).length > pw % 2)
      soft.push({ type, key, lid: l.id, msg: `${name} ต้องเรียนติดกัน 2 คาบ แต่วางแยก` });
    if (noDoubleTeacher(l) && ss.some(s => s.ps.length > 1))
      soft.push({ type, key, lid: l.id, msg: `${name} วางติดกัน แต่${teacherShort(noDoubleTeacher(l))}ไม่สอนคาบคู่` });
    if (!o.allow_same_day) {
      const days = ss.map(s => s.d);
      if (new Set(days).size < days.length) soft.push({ type, key, lid: l.id, msg: `${name} มีวันเดียวกันมากกว่า 1 ครั้ง` });
    }
    (o.avoid || []).forEach(p => {
      if (l.slots.some(s => s[1] === p)) soft.push({ type, key, lid: l.id, msg: `${name} อยู่คาบ ${p} (ตั้งให้เลี่ยง)` });
    });
  });
  T.teachers.forEach(t => {
    if (!wantsFreePair(t.id) || !IDX.byTeacher[t.id]) return;
    const k = freePairMaxDays(t.id), note = k < DAYS.length ? ` (มีรายการ ${busyLoad(t.id)} คาบ/สัปดาห์ ว่างติดกันได้มากสุด ${k} วัน)` : '';
    for (let d = 1; d <= DAYS.length; d++) if (!hasFreePair(dayBusy(t.id, d)))
      soft.push({ type: 'teacher', key: String(t.id), msg: `${teacherShort(t.id)} วัน${DAYS[d - 1]} ไม่มีคาบว่างติดกัน 2 คาบ${note}` });
  });
  trackGaps().forEach(g => soft.push({ d: g.d, p: g.p, type: 'class', key: g.cls,
    msg: `${classShort(g.cls)} สาย ${g.busy.join(', ')} เรียน แต่สาย ${g.idle.join(', ')} ว่าง (ทุกสายควรเรียนพร้อมกัน)` }));
  IDX.classes.forEach(cls => {
    const b = trackBalance(cls);
    if (b.roots.length < 2) return;
    const vals = b.roots.map(r => b.per[r]), mx = Math.max(...vals), mn = Math.min(...vals);
    if (mx !== mn) soft.push({ type: 'class', key: cls, msg: `${classShort(cls)}: คาบเฉพาะสายไม่เท่ากัน (${b.roots.map(r => `${r} ${b.per[r]}`).join(' · ')}) — จะมีอย่างน้อย ${mx - mn} ช่องที่บางสายว่าง · ตรวจว่าวิชาเลือกตั้งสายครบไหม (ปุ่ม สายการเรียน)` });
    const over = b.roots.filter(r => b.whole + b.per[r] > b.slots);
    if (over.length) soft.push({ type: 'class', key: cls, msg: `${classShort(cls)}: สาย ${over.join(', ')} มีคาบเรียน ${Math.max(...over.map(r => b.whole + b.per[r]))} คาบ เกิน ${b.slots} ช่อง — วิชาที่ "เรียนทั้งห้อง" บางวิชาน่าจะเป็นวิชาเฉพาะสาย` });
  });
  const busyP = classBusyPeriods();
  classHoles(busyP).forEach(h => soft.push({ d: h.d, p: h.p, type: 'class', key: h.cls,
    msg: `${holeLabel(h)} นักเรียนว่าง — กฎนักเรียนไม่ว่างคาบ ${busyP.join(', ')}` }));
  T.teachers.forEach(t => {
    const mx = maxRunOf(t.id);
    if (!mx || !IDX.byTeacher[t.id]) return;
    const over = effectiveMaxRun(t.id, mx) > mx ? ` · คาบสอน ${teachLoad(t.id)} คาบ/สัปดาห์ เกินที่กฎรองรับ (${runCapacity(t.id, mx)})` : '';
    teacherRuns(t.id).filter(r => r.e - r.s + 1 > mx).forEach(r => soft.push({ d: r.d, p: r.s, type: 'teacher', key: String(t.id),
      msg: `${teacherShort(t.id)} สอนติดกัน ${r.e - r.s + 1} คาบ (คาบ ${r.s}-${r.e}) — กฎไม่เกิน ${mx} คาบ${over}` }));
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
  const P = periodsFor(ED.by), issues = allIssues();      // มุมมองรายห้องไม่แสดงคาบของครูหลังเลิกเรียน
  const opts = ED.by === 'class'
    ? IDX.classes.map(c => `<option value="${c}" ${c === ED.key ? 'selected' : ''}>${classShort(c)}</option>`).join('')
    : T.teachers.map(t => `<option value="${t.id}" ${String(t.id) === ED.key ? 'selected' : ''}>ครู${esc(t.name)}</option>`).join('');
  // ปัญหาของมุมมองนี้
  const mine = x => x.type === ED.by && String(x.key) === String(ED.key)
                  || (ED.by === 'class' && x.lid && lessonById(x.lid)?.classes.includes(ED.key))
                  || (ED.by === 'teacher' && x.lid && lessonById(x.lid)?.teacher_ids.includes(+ED.key));
  const hardHere = issues.hard.filter(mine), softHere = issues.soft.filter(mine);
  const holesHere = new Set(ED.by === 'class' ? classHoles().filter(h => h.cls === ED.key).map(h => `${h.d}-${h.p}`) : []);
  const gapsHere = new Map(ED.by === 'class' ? trackGaps().filter(g => g.cls === ED.key).map(g => [`${g.d}-${g.p}`, g]) : []);

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
      const hole = holesHere.has(`${d}-${p}`), gap = gapsHere.get(`${d}-${p}`);
      const tip = hole ? 'คาบนี้นักเรียนห้ามว่าง (กฎการจัดตาราง)' : gap ? `สาย ${gap.busy.join(', ')} เรียน แต่สาย ${gap.idle.join(', ')} ว่าง` : '';
      body += `<td class="ed-cell${bad ? ' has-bad' : ''}${hole ? ' must-fill' : ''}${gap ? ' track-gap' : ''}" data-d="${d}" data-p="${p}"${tip ? ` title="${esc(tip)}"` : ''}>${ls.map(l => chipHTML(l, d, p)).join('')}</td>`;
      if (p === lunchAfter()) body += di === 0 ? `<td class="ed-lunch" rowspan="${DAYS.length}"><div>พักกลางวัน</div></td>` : '';
    });
    body += '</tr>';
  });

  const vl = viewLessons();
  const pending = vl.filter(l => l.slots.length < l.per_week && !isSupervise(l));
  const cards = pending.map(l => `
    <div class="ed-card" draggable="true" data-lid="${l.id}" style="background:${colorOf(l)}" title="ลากไปวาง หรือแตะแล้วแตะช่อง">
      <b>${esc(lessonName(l))}</b> ${esc(ED.by === 'class' ? l.teacher_ids.map(teacherShort).join(', ') : classLabel(l))}
      ${tracksOf(l).length ? `<span class="badge text-bg-light border">${esc(l.track)}</span>` : ''}
      ${wantsDouble(l) ? '<span class="badge bg-secondary" title="เรียนติดกัน 2 คาบ">คู่</span>' : ''}
      <span class="float-end badge bg-warning text-dark">เหลือ ${l.per_week - l.slots.length}</span>
      ${wantsDouble(l) ? `<div class="mt-1"><button type="button" class="btn btn-sm btn-light border py-0 px-2 ed-split"
        title="ยกเลิกคาบคู่ของวิชานี้ → ลากวางทีละคาบ หรือให้จัดอัตโนมัติวางแยกได้">✂ แยกคาบคู่</button></div>` : ''}
    </div>`).join('') || '<div class="text-muted small p-2">✓ วางครบทุกรายการแล้ว</div>';

  const issueList = (arr, cls) => arr.map(x => `<li class="${cls}" ${x.d ? `data-go="${x.d}-${x.p}"` : ''}>${x.d ? `<b>${DAYS[x.d - 1]} คาบ ${x.p}</b> ` : ''}${esc(x.msg)}</li>`).join('');
  const lessonRows = vl.map(l => `<tr>
      <td><span class="ed-swatch" style="background:${colorOf(l)}"></span><b>${esc(lessonName(l))}</b>${l.code && T.subjects[l.code]?.name ? ` <span class="text-muted small">${esc(T.subjects[l.code].name)}</span>` : ''}</td>
      <td>${esc(classLabel(l))}</td>
      <td>${esc(l.teacher_ids.map(teacherShort).join(', '))}</td>
      <td class="text-center">${l.per_week}</td>
      <td class="text-center ${l.slots.length !== l.per_week ? 'text-danger fw-bold' : ''}">${l.slots.length}</td>
      <td class="small">${[wantsDouble(l) ? 'คาบคู่' : (l.options || {}).double ? 'ทีละคาบ (ครูไม่สอนคาบคู่)' : '', (l.options || {}).avoid ? 'เลี่ยงคาบ ' + l.options.avoid.join(',') : '', (l.options || {}).allow_same_day ? 'ซ้ำวันได้' : ''].filter(Boolean).join(' · ')}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-primary py-0" onclick="openLessonModal(${l.id})"><i class="bi bi-pencil"></i></button></td></tr>`).join('');

  const act = (fn, icon, label) => `<li><a class="dropdown-item" href="#" onclick="${fn}; return false;"><i class="bi bi-${icon} me-1"></i>${label}</a></li>`;
  el('content').innerHTML = `<div class="container-fluid ed-wrap">
    ${ED.preview ? `<div class="alert alert-info d-flex flex-wrap align-items-center gap-2 py-2 mb-2 sv-banner">
      <i class="bi bi-eye fs-5"></i><div class="me-auto">กำลังดู <b>ผลจัดอัตโนมัติ (ยังไม่บันทึก)</b> — เลือกดูห้อง/ครูอื่นได้ แต่ยังแก้ไม่ได้จนกว่าจะบันทึกหรือยกเลิก</div>
      <button class="btn btn-sm btn-outline-secondary" onclick="discardSolved()">ยกเลิก</button>
      <button class="btn btn-sm btn-success" onclick="saveSolved()"><i class="bi bi-save"></i> บันทึกผลนี้</button></div>` : ''}
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <div class="btn-group btn-group-sm">
        <button class="btn ${ED.by === 'class' ? 'btn-primary' : 'btn-outline-primary'}" onclick="edBy('class')"><i class="bi bi-people"></i> รายห้อง</button>
        <button class="btn ${ED.by === 'teacher' ? 'btn-primary' : 'btn-outline-primary'}" onclick="edBy('teacher')"><i class="bi bi-person-badge"></i> รายครู</button>
      </div>
      <select class="form-select form-select-sm w-auto" onchange="ED.key=this.value; clearPick(); renderEditor()">${opts}</select>
      ${ED.by === 'class' ? `<button class="btn btn-sm btn-outline-secondary" onclick="openTracksModal('${ED.key}')"><i class="bi bi-diagram-3"></i> สายการเรียน ${(T.term.config.tracks || {})[ED.key]?.length ? '(' + T.term.config.tracks[ED.key].length + ')' : ''}</button>`
                           : `<button class="btn btn-sm btn-outline-secondary" onclick="openTeacherModal(${ED.key})"><i class="bi bi-person-gear"></i> เงื่อนไขครู</button>`}
      <button class="btn btn-sm btn-outline-success" onclick="openLessonModal(null)"><i class="bi bi-plus-lg"></i> เพิ่มรายการสอน</button>
      <button class="btn btn-sm btn-outline-secondary" onclick="edUndo()" ${ED.undo.length ? '' : 'disabled'} title="ย้อนการวาง/ย้าย/เอาออกครั้งล่าสุด"><i class="bi bi-arrow-counterclockwise"></i> ย้อนกลับ</button>
      <button class="btn btn-sm btn-primary" onclick="openSolveModal()"><i class="bi bi-cpu"></i> จัดอัตโนมัติ</button>
      <div class="dropdown">
        <button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-tools"></i> เครื่องมือ</button>
        <ul class="dropdown-menu">
          ${act('applyTracks()', 'magic', 'ตั้งสายการเรียนจากโครงสร้างหลักสูตร')}
          ${act('applySuggestedTracks()', 'lightbulb', 'แนะนำสายจากตารางปัจจุบัน')}
          ${act('openImportModal()', 'file-earmark-spreadsheet', 'นำเข้ารายวิชาจาก Excel (แบบสำรวจภาระงานสอน)')}
          ${act('openSupervisionModal()', 'person-check', 'ครูดูแลซ่อมเสริม (คาบว่างนักเรียน)')}
          ${act('openClearModal()', 'eraser', 'ล้างตาราง (เอาวิชาออกจากช่อง)')}
          ${act('openDoublesModal()', 'layout-split', 'ตั้งคาบคู่หลายวิชา (เช่น แลปวิทยาศาสตร์)')}
          ${act('openRulesModal()', 'sliders', 'กฎการจัดตาราง (สอนติดกัน · นักเรียนไม่ว่างคาบแรก)')}
          ${act('openStaffModal()', 'people', 'คาบของครูหลังเลิกเรียน (PLC)')}
          ${draftReport() ? act('showDraftReport(draftReport())', 'clipboard-check', 'รายงานการร่างภาคเรียน') : ''}
          <li><hr class="dropdown-divider"></li>
          ${act('openShareModal()', 'line', 'ส่งลิงก์จัดตารางทาง LINE')}
          ${T.is_admin ? act('openEditorsModal()', 'person-plus', 'ผู้ช่วยจัดตาราง (ฝ่ายวิชาการ)') : ''}
        </ul>
      </div>
      <button class="btn btn-sm btn-outline-secondary" onclick="openTermModal()" title="ตั้งค่า / เผยแพร่ภาคเรียน"><i class="bi bi-calendar-week"></i> ${esc(T.term.name)}${T.term.published ? ' <span class="badge bg-success">เผยแพร่แล้ว</span>' : ' <span class="badge bg-warning text-dark">ร่าง</span>'}</button>
      <button class="btn btn-sm btn-outline-secondary" onclick="openEditorHelp()"><i class="bi bi-question-circle"></i> วิธีใช้</button>
      <span class="ms-auto">
        <button class="btn btn-sm py-0 ${issues.hard.length ? 'btn-danger' : 'btn-success'}" onclick="openIssuesModal('hard')" title="ครูสอนซ้อน / ห้องชน / ครูไม่ว่าง — กดดูทั้งหมด">ชน ${issues.hard.length}</button>
        <button class="btn btn-sm py-0 ${issues.soft.length ? 'btn-warning' : 'btn-success'}" onclick="openIssuesModal('soft')" title="ผิดเงื่อนไข / วางไม่ครบ — กดดูทั้งหมด">เตือน ${issues.soft.length}</button>
      </span>
    </div>
    <div class="row g-2">
      <div class="col-xl-9">
        <div class="table-responsive"><table class="ed-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
        <div class="small text-muted mt-1"><i class="bi bi-hand-index"></i> ลากวิชาไปวาง หรือแตะวิชาแล้วแตะช่อง • × หรือลากไปที่ "ยังไม่ได้วาง" = เอาออก • 🔓 = ล็อกช่อง (จัดอัตโนมัติจะไม่ย้าย)
          <span class="ms-2 text-nowrap">สีช่องตอนเลือกวิชา: <span class="ed-swatch" style="background:#4caf50"></span>วางได้ <span class="ed-swatch" style="background:#e0a800"></span>ผิดเงื่อนไข <span class="ed-swatch" style="background:#dc3545"></span>ชน <span class="ed-swatch" style="background:#0d6efd"></span>สลับช่องได้</span></div>
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
      ${lk ? '' : '<span class="x" title="เอาออก">×</span>'}
      <span class="lk${lk ? ' on' : ''}" title="${lk ? 'ล็อกอยู่ — กดเพื่อปลดล็อก' : 'ล็อกช่องนี้ (จัดอัตโนมัติจะไม่ย้าย)'}">${lk ? '🔒' : '🔓'}</span>
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
      if (e.target.classList.contains('lk')) { e.stopPropagation(); toggleLock(+c.dataset.lid, +c.dataset.d, +c.dataset.p); return; }
      if (e.target.closest('.ed-split')) { e.stopPropagation(); clearPick(); setDouble(+c.dataset.lid, false); return; }
      e.stopPropagation();
      const from = c.dataset.d ? [+c.dataset.d, +c.dataset.p] : null;
      if (ED.picked && ED.picked.lid === +c.dataset.lid && String(ED.picked.from) === String(from)) { clearPick(); return; }
      if (ED.picked && c.dataset.d) { doPlace(+c.dataset.d, +c.dataset.p); return; }   // แตะวิชาอื่นในช่อง = วางลงช่องนั้น
      if (c.classList.contains('locked')) { toastEd('ช่องนี้ล็อกไว้ — กด 🔒 เพื่อปลดล็อกก่อนย้าย'); return; }
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
  if (previewGuard()) return;
  ED.picked = { lid, from, drag: !byClick };
  document.querySelectorAll('.ed-chip.picked, .ed-card.picked').forEach(x => x.classList.remove('picked'));
  const sel = from ? `.ed-chip[data-lid="${lid}"][data-d="${from[0]}"][data-p="${from[1]}"]` : `.ed-card[data-lid="${lid}"]`;
  document.querySelector(sel)?.classList.add('picked');
  showTargets();
}
function clearPick() {
  ED.picked = null;
  document.querySelectorAll('.ed-cell').forEach(td => { td.classList.remove('ok', 'soft', 'bad', 'swap'); td.removeAttribute('title'); });
  document.querySelectorAll('.picked').forEach(x => x.classList.remove('picked'));
}
// ระบายสีทุกช่องตามผลถ้าวางวิชาที่เลือกลงไป
function showTargets() {
  const l = lessonById(ED.picked.lid);
  if (!l) return;
  document.querySelectorAll('.ed-cell').forEach(td => {
    const d = +td.dataset.d, p = +td.dataset.p;
    td.classList.remove('ok', 'soft', 'bad', 'swap');
    if (slotHas(l, d, p)) { td.removeAttribute('title'); return; }
    const c = conflictsAt(l, d, p), B = c.some(x => x.hard) ? swapOption(l, ED.picked.from, d, p) : null;
    td.classList.add(B ? 'swap' : c.some(x => x.hard) ? 'bad' : c.length ? 'soft' : 'ok');
    td.title = B ? `⇄ สลับช่องกับ ${lessonName(B)} ${classLabel(B)} ได้` : c.map(x => (x.hard ? '✖ ' : '⚠ ') + x.msg).join('\n') || 'วางได้';
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
  if (!pk.from && wantsDouble(l) && l.per_week - l.slots.length >= 2 && p < nPeriods() && p !== lunchAfter()
      && !slotHas(l, d, p + 1) && !conflictsAt(l, d, p + 1).some(c => c.hard)) add.push([d, p + 1]);
  const hard = conflictsAt(l, d, p).filter(c => c.hard);
  const B = hard.length ? swapOption(l, pk.from, d, p) : null;               // ช่องปลายทางมีวิชาอื่น → สลับช่องกันได้ไหม
  if (B) {
    clearPick();
    if (confirm(`สลับช่องกัน?\n• ${lessonName(l)} ${classLabel(l)} → วัน${DAYS[d - 1]} คาบ ${p}\n• ${lessonName(B)} ${classLabel(B)} → วัน${DAYS[pk.from[0] - 1]} คาบ ${pk.from[1]}`)) await doSwap(l, pk.from, B, [d, p]);
    return;
  }
  if (hard.length && !confirm(`วางแล้วจะชนกัน:\n• ${hard.map(c => c.msg).join('\n• ')}\n\nวางต่อหรือไม่?`)) return;
  if (!pk.from && l.slots.length >= l.per_week && !confirm(`${lessonName(l)} วางครบ ${l.per_week} คาบแล้ว จะวางเพิ่มอีกหรือไม่?`)) return;
  const body = { lesson_id: l.id, add, remove: pk.from ? [pk.from] : [] };
  clearPick();
  await applySlots(body, true);
}

// ย้ายวิชา l จากช่อง from ไป (d,p) ที่มีวิชา B ขวางอยู่ 1 วิชา → สลับกันได้ถ้าทั้งสองฝั่งไม่ชน (B ต้องไม่ล็อก)
function swapOption(l, from, d, p) {
  if (!from) return null;
  const blockers = (IDX.bySlot[`${d}-${p}`] || []).filter(x => x.id !== l.id &&
    (x.teacher_ids.some(t => l.teacher_ids.includes(t)) || (x.classes.some(c => l.classes.includes(c)) && classOverlap(l, x))));
  if (blockers.length !== 1) return null;
  const B = blockers[0];
  if (lockedAt(B, d, p) || slotHas(B, from[0], from[1])) return null;
  if (conflictsAt(l, d, p, { ignore: [B.id], from }).some(c => c.hard)) return null;
  if (conflictsAt(B, from[0], from[1], { ignore: [l.id], from: [d, p] }).some(c => c.hard)) return null;
  return B;
}
async function doSwap(A, from, B, to) {
  if (previewGuard()) return;
  try {
    const r1 = await apiFetch('/api/tt/slots', { method: 'POST', body: JSON.stringify({ lesson_id: A.id, remove: [from], add: [to] }) });
    T.lessons[T.lessons.findIndex(l => l.id === A.id)] = r1.lesson;
    const r2 = await apiFetch('/api/tt/slots', { method: 'POST', body: JSON.stringify({ lesson_id: B.id, remove: [to], add: [from] }) });
    T.lessons[T.lessons.findIndex(l => l.id === B.id)] = r2.lesson;
    ED.undo.push({ multi: [{ lesson_id: B.id, add: [to], remove: [from] }, { lesson_id: A.id, add: [from], remove: [to] }] });
    if (ED.undo.length > 50) ED.undo.shift();
    buildIndex(); renderEditor();
    toastEd(`สลับแล้ว: ${lessonName(A)} ⇄ ${lessonName(B)} (กด ย้อนกลับ ได้)`);
  } catch (e) { alert('สลับไม่สำเร็จ: ' + e.message); await loadTerm(T.term.id); }
}

async function removeChip(lid, d, p) {
  const l = lessonById(lid);
  if (lockedAt(l, d, p)) { toastEd('ช่องนี้ล็อกไว้ — กด 🔒 เพื่อปลดล็อกก่อน'); return; }
  clearPick();
  await applySlots({ lesson_id: lid, add: [], remove: [[d, p]] }, true);
}

// ล็อก/ปลดล็อกทั้งช่วงที่ติดกัน (คาบคู่ = 2 ช่องพร้อมกัน) — ล็อกครึ่งเดียว จัดอัตโนมัติจะย้ายอีกครึ่งไปวันอื่นจนคู่แตก
async function toggleLock(lid, d, p) {
  const l = lessonById(lid), lk = lockedAt(l, d, p) ? 0 : 1;
  const ps = (sessionsOf(l).find(s => s.d === d && s.ps.includes(p)) || { ps: [p] }).ps;
  await applySlots({ lesson_id: lid, lock: ps.map(q => [d, q, lk]) }, false);
  toastEd(lk ? `🔒 ล็อกแล้ว${ps.length > 1 ? ` (คาบคู่ ${ps.length} ช่อง)` : ''} — จัดอัตโนมัติจะไม่ย้าย` : `ปลดล็อกแล้ว${ps.length > 1 ? ` (${ps.length} ช่อง)` : ''}`);
}

async function applySlots(body, pushUndo) {
  if (previewGuard()) return;
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
  if (u.restore) {                                // ย้อนการล้างตาราง
    try { await setSlotsBulk(u.restore); toastEd('ย้อนกลับแล้ว — ตารางกลับเป็นเหมือนก่อนล้าง'); } catch (e) { alert(e.message); }
    return;
  }
  if (u.multi) { for (const op of u.multi) await applySlots(op, false); return; }   // ย้อนการสลับช่อง
  await applySlots(u, false);
}
// แทนที่ช่องของหลายรายการพร้อมกัน {lid: [[d,p,locked]]} (ล้างตาราง / ย้อนกลับ) — เซิร์ฟเวอร์ทำในธุรกรรมเดียว
async function setSlotsBulk(map) {
  await apiFetch(`/api/tt/terms/${T.term.id}/set-slots`, { method: 'POST', body: JSON.stringify({ lessons: map }) });
  Object.entries(map).forEach(([lid, slots]) => { const L = lessonById(+lid); if (L) L.slots = slots.map(s => [s[0], s[1], s[2] ? 1 : 0]); });
  buildIndex(); renderEditor();
}

/* ── ครูดูแลคาบซ่อมเสริม (คาบว่างของนักเรียน) ──
   รายการ "ซ่อมเสริม" options.supervise = true · ห้อง+สาย(ที่ว่าง)+ครู · ช่องล็อก · จัดอัตโนมัติไม่นับ แล้วตัดช่องที่ชนออกตอนบันทึก */
const isSupervise = l => !!(l.options || {}).supervise;
let SUP = null;   // { items: [{cls, track, d, p, key}], pick: Map(key → teacher_id|0) }
function supFreeSlots() {
  const out = [], n = periodsFor('class').length;
  IDX.classes.forEach(cls => {
    const roots = classRoots(cls);
    for (let d = 1; d <= DAYS.length; d++) for (let p = 1; p <= n; p++) {
      const here = ((IDX.byClass[cls] || {})[`${d}-${p}`] || []).filter(l => !isSupervise(l));
      let track = null;
      if (!here.length) track = '';
      else if (roots.length >= 2) { const idle = missingRoots(cls, here, roots); if (idle.length && idle.length < roots.length) track = idle.join(','); }
      if (track !== null) out.push({ cls, track, d, p, key: `${cls}|${track}|${d}-${p}` });
    }
  });
  return out;
}
// ครูที่ดูแลช่องนี้ได้: ไม่มีรายการ (ไม่นับซ่อมเสริมเดิม) · ไม่ตั้งไม่ว่าง · ไม่ถูกเลือกให้ช่องอื่นในคาบเดียวกัน
function supCandidates(it, pick) {
  const taken = new Set([...pick.entries()].filter(([k, t]) => t && k !== it.key && k.endsWith(`|${it.d}-${it.p}`)).map(([, t]) => t));
  const duty = {}; pick.forEach(t => { if (t) duty[t] = (duty[t] || 0) + 1; });
  return T.teachers.filter(t => t.active !== 0 && !taken.has(t.id) && !isUnavailable(t.id, it.d, it.p)
      && !((IDX.byTeacher[t.id] || {})[`${it.d}-${it.p}`] || []).some(l => !isSupervise(l)))
    .map(t => {
      const mine = T.lessons.filter(l => l.teacher_ids.includes(t.id) && !isSupervise(l));
      const knows = mine.some(l => l.classes.includes(it.cls));
      const dayN = Object.keys(IDX.byTeacher[t.id] || {}).filter(k => k.startsWith(`${it.d}-`) && (IDX.byTeacher[t.id][k] || []).some(l => !isSupervise(l))).length;
      let sc = (knows ? 3 : 0) - 1.5 * (duty[t.id] || 0) + (pick.get(it.key) === t.id ? 1.5 : 0) - 0.3 * dayN;
      const mx = maxRunOf(t.id);                                     // ไม่ให้ผิดกฎสอนติดกัน / คาบว่างติดกันของครู
      if (mx) { let s = it.p, e = it.p; const on = q => ((IDX.byTeacher[t.id] || {})[`${it.d}-${q}`] || []).some(teachesStudents);
        const [a, b] = runSegments().find(([a, b]) => it.p >= a && it.p <= b) || [it.p, it.p];
        while (s - 1 >= a && on(s - 1)) s--; while (e + 1 <= b && on(e + 1)) e++; if (e - s + 1 > mx) sc -= 4; }
      if (wantsFreePair(t.id)) { const busy = dayBusy(t.id, it.d); if (hasFreePair(busy) && !hasFreePair(q => q === it.p || busy(q))) sc -= 4; }
      return { t, sc, knows, dayN };
    }).sort((a, b) => b.sc - a.sc);
}
function supAuto(keepCurrent) {
  const order = [...SUP.items].sort((a, b) => supCandidates(a, SUP.pick).length - supCandidates(b, SUP.pick).length);
  if (!keepCurrent) SUP.pick = new Map(SUP.items.map(it => [it.key, 0]));
  order.forEach(it => { if (keepCurrent && SUP.pick.get(it.key)) return; const c = supCandidates(it, SUP.pick)[0]; SUP.pick.set(it.key, c ? c.t.id : 0); });
}
function openSupervisionModal() {
  if (previewGuard()) return;
  const cur = new Map();                                             // ครูดูแลเดิม (ช่องเดิมที่ยังเป็นซ่อมเสริม)
  T.lessons.filter(isSupervise).forEach(l => l.slots.forEach(([d, p]) => cur.set(`${l.classes[0]}|${d}-${p}`, l.teacher_ids[0])));
  const items = supFreeSlots();
  SUP = { items, pick: new Map(items.map(it => [it.key, cur.get(`${it.cls}|${it.d}-${it.p}`) || 0])) };
  if (!cur.size) supAuto(false);
  const body = `
    <div class="small text-muted mb-2">คาบที่นักเรียนว่าง (ซ่อมเสริม) ของทุกห้อง — รวมคาบที่บางสายว่างขณะสายอื่นเรียน · ระบบเลือกครูที่ว่างคาบนั้นให้
      (ครูที่สอนห้องนั้นก่อน · กระจายให้เท่า ๆ กัน · ไม่ผิดกฎสอนติดกัน) เปลี่ยนเองได้ทีละช่อง · บันทึกแล้วตารางเรียนขึ้น "ซ่อมเสริม ครู…" และตารางครูขึ้นคาบนี้</div>
    <div class="d-flex flex-wrap gap-2 mb-2">
      <button class="btn btn-sm btn-outline-primary py-0" onclick="supAuto(false); drawSupervision()"><i class="bi bi-magic"></i> จัดให้ใหม่ทั้งหมด</button>
      <button class="btn btn-sm btn-outline-secondary py-0" onclick="supAuto(true); drawSupervision()">เติมเฉพาะช่องที่ยังไม่มีครู</button>
      <button class="btn btn-sm btn-outline-danger py-0" onclick="SUP.pick = new Map(SUP.items.map(it => [it.key, 0])); drawSupervision()">ไม่จัดทั้งหมด</button>
    </div>
    <div id="supSum" class="small mb-2"></div><div id="supList"></div>`;
  showModal('<i class="bi bi-person-check"></i> ครูดูแลซ่อมเสริม', body, `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button class="btn btn-primary btn-sm" onclick="saveSupervision()"><i class="bi bi-save"></i> บันทึก</button>`);
  drawSupervision();
}
function drawSupervision() {
  const { items, pick } = SUP;
  if (!items.length) { el('supList').innerHTML = '<div class="text-success small py-2"><i class="bi bi-check-circle"></i> ไม่มีคาบซ่อมเสริม — นักเรียนมีเรียนครบทุกคาบ</div>'; el('supSum').innerHTML = ''; return; }
  const duty = {}; pick.forEach(t => { if (t) duty[t] = (duty[t] || 0) + 1; });
  const done = items.filter(it => pick.get(it.key)).length;
  el('supSum').innerHTML = `ซ่อมเสริม <b>${items.length}</b> คาบ · มีครูดูแล <b>${done}</b>${done < items.length ? ` · <span class="text-danger">ยังไม่มีครู ${items.length - done}</span>` : ''}
    <div class="text-muted">${Object.entries(duty).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(teacherShort(+t))} ${n}`).join(' · ')}</div>`;
  let lastCls = '';
  el('supList').innerHTML = `<div class="table-responsive" style="max-height:52vh"><table class="table table-sm align-middle mb-0">
    <thead class="table-light sticky-top"><tr><th>ห้อง</th><th>วัน คาบ</th><th>ครูดูแล</th></tr></thead><tbody>${items.map(it => {
      const cands = supCandidates(it, pick), sel = pick.get(it.key) || 0;
      const head = it.cls !== lastCls; lastCls = it.cls;
      return `<tr${head ? ' class="border-top border-2"' : ''}><td class="small">${esc(classShort(it.cls))}${it.track ? ` <span class="badge text-bg-light border">${esc(trackLabel(it.track))} ว่าง</span>` : ''}</td>
        <td class="small text-nowrap">${DAYS[it.d - 1]} คาบ ${it.p}</td>
        <td><select class="form-select form-select-sm" onchange="SUP.pick.set('${it.key}', +this.value); drawSupervision()">
          <option value="0">— ไม่จัด —${cands.length ? '' : ' (ไม่มีครูว่าง)'}</option>
          ${cands.map(c => `<option value="${c.t.id}" ${c.t.id === sel ? 'selected' : ''}>${esc(teacherShort(c.t.id))}${c.knows ? ' · สอนห้องนี้' : ''} · วันนี้ ${c.dayN} คาบ</option>`).join('')}</select></td></tr>`;
    }).join('')}</tbody></table></div>`;
}
async function saveSupervision() {
  const items = SUP.items.filter(it => SUP.pick.get(it.key)).map(it => ({ cls: it.cls, track: it.track, d: it.d, p: it.p, teacher_id: SUP.pick.get(it.key) }));
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/supervision`, { method: 'POST', body: JSON.stringify({ items }) });
    edModal.hide(); await loadTerm(T.term.id); toastEd(r.message);
  } catch (e) { alert(e.message); }
}
// หลังบันทึกผลจัดอัตโนมัติ: ช่องครูดูแลที่ตอนนี้ชน (มีวิชาลง/ครูติดสอน) → เอาออก · คืนจำนวนคาบที่เอาออก
async function dropClashingSupervision() {
  const fix = {};
  let n = 0;
  T.lessons.filter(isSupervise).forEach(l => {
    const keep = l.slots.filter(([d, p]) => !(IDX.bySlot[`${d}-${p}`] || []).some(x => x.id !== l.id && !isSupervise(x) &&
      (x.teacher_ids.some(t => l.teacher_ids.includes(t)) || (x.classes.some(c => l.classes.includes(c)) && classOverlap(l, x)))));
    if (keep.length < l.slots.length) { n += l.slots.length - keep.length; fix[l.id] = keep.map(s => [s[0], s[1], s[2] ? 1 : 0]); }
  });
  if (n) { try { await setSlotsBulk(fix); } catch (e) { alert(e.message); } }
  return n;
}

/* ── ตั้งคาบคู่หลายวิชาพร้อมกัน (เช่น แลปวิทยาศาสตร์): 3 คาบ = คู่ 1 + เดี่ยว 1 · 2 คาบ = คู่ 1 ── */
const AREA_NAME = { 'ท': 'ภาษาไทย', 'ค': 'คณิตศาสตร์', 'ว': 'วิทยาศาสตร์และเทคโนโลยี', 'ส': 'สังคมศึกษาฯ', 'พ': 'สุขศึกษาและพลศึกษา',
                    'ศ': 'ศิลปะ', 'ง': 'การงานอาชีพ', 'อ': 'ภาษาอังกฤษ', 'จ': 'ภาษาจีน', 'I': 'IS' };
let DBL = null;   // ค่าที่ติ๊กในหน้าต่าง: lesson_id → true/false
const splitLabel = (pw, dbl) => !dbl || pw < 2 ? `เดี่ยว ${pw}` : `คู่ ${Math.floor(pw / 2)}${pw % 2 ? ' + เดี่ยว 1' : ''}`;
function openDoublesModal() {
  if (previewGuard()) return;
  DBL = new Map(T.lessons.map(l => [l.id, !!(l.options || {}).double]));
  const areas = [...new Set(T.lessons.filter(l => l.kind === 'subject' && l.code).map(l => l.code[0]))].sort();
  const body = `
    <div class="small text-muted mb-2">ติ๊ก = เรียนติดกัน 2 คาบ (3 คาบ/สัปดาห์ → คู่ 1 + เดี่ยว 1) · จัดอัตโนมัติจะวางคาบคู่ในช่วงเช้าหรือบ่ายช่วงเดียว ไม่คร่อมพักกลางวัน</div>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <select id="dbArea" class="form-select form-select-sm w-auto" onchange="drawDoubles()">
        <option value="">ทุกกลุ่มสาระ</option>${areas.map(a => `<option value="${a}" ${a === 'ว' ? 'selected' : ''}>${esc(AREA_NAME[a] || a)}</option>`).join('')}</select>
      <label class="small"><input type="checkbox" id="dbMulti" checked onchange="drawDoubles()"> เฉพาะวิชา 2 คาบขึ้นไป</label>
      <button class="btn btn-sm btn-outline-secondary py-0" onclick="dblAll(true)">ติ๊กทั้งหมดที่แสดง</button>
      <button class="btn btn-sm btn-outline-secondary py-0" onclick="dblAll(false)">ไม่ติ๊ก</button>
    </div>
    <div id="dbList"></div>`;
  showModal('<i class="bi bi-layout-split"></i> ตั้งคาบคู่หลายวิชา', body, `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button class="btn btn-primary btn-sm" onclick="saveDoubles()"><i class="bi bi-save"></i> บันทึก</button>`);
  drawDoubles();
}
const dblShown = () => T.lessons.filter(l => l.kind === 'subject' && (!el('dbArea').value || (l.code || '')[0] === el('dbArea').value) && (!el('dbMulti').checked || l.per_week >= 2))
  .sort((a, b) => lessonName(a).localeCompare(lessonName(b), 'th'));
function drawDoubles() {
  const ls = dblShown();
  el('dbList').innerHTML = ls.length ? `<div class="table-responsive" style="max-height:55vh"><table class="table table-sm table-hover align-middle mb-0">
    <thead class="table-light sticky-top"><tr><th class="text-center">คาบคู่</th><th>วิชา</th><th>ชั้น/สาย</th><th>ครู</th><th class="text-center">คาบ/สัปดาห์</th><th>แบ่งเป็น</th></tr></thead>
    <tbody>${ls.map(l => { const on = DBL.get(l.id), nd = noDoubleTeacher(l); return `<tr>
      <td class="text-center"><input type="checkbox" class="form-check-input" ${on ? 'checked' : ''} onchange="DBL.set(${l.id}, this.checked); this.closest('tr').querySelector('.db-split').textContent = splitLabel(${l.per_week}, this.checked)"></td>
      <td><b>${esc(lessonName(l))}</b> <span class="small text-muted">${esc(T.subjects[l.code]?.name || '')}</span></td>
      <td class="small">${esc(classLabel(l))}</td>
      <td class="small">${esc(l.teacher_ids.map(teacherShort).join(', '))}${nd ? ` <span class="badge text-bg-warning" title="ครูตั้งเงื่อนไขไม่สอนคาบคู่ — ระบบวางทีละคาบ">ครูไม่สอนคาบคู่</span>` : ''}</td>
      <td class="text-center">${l.per_week}</td><td class="small db-split">${splitLabel(l.per_week, on)}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="text-muted small py-2">ไม่มีวิชาตามเงื่อนไขที่เลือก</div>';
}
function dblAll(v) { dblShown().forEach(l => DBL.set(l.id, v)); drawDoubles(); }
async function saveDoubles() {
  const changes = {};
  T.lessons.forEach(l => { if (DBL.get(l.id) !== !!(l.options || {}).double) changes[l.id] = { double: DBL.get(l.id) }; });
  const n = Object.keys(changes).length;
  if (!n) { edModal.hide(); return; }
  try {
    await apiFetch(`/api/tt/terms/${T.term.id}/lesson-options`, { method: 'POST', body: JSON.stringify({ lessons: changes }) });
    Object.entries(changes).forEach(([lid, o]) => {
      const L = lessonById(+lid), opt = Object.assign({}, L.options || {});
      if (o.double) opt.double = true; else delete opt.double;
      L.options = opt;
    });
    edModal.hide(); buildIndex(); renderEditor();
    toastEd(`ตั้งคาบคู่แล้ว ${n} วิชา — กด จัดอัตโนมัติ → จัดใหม่ทั้งหมด เพื่อจัดตามเงื่อนไขใหม่`);
  } catch (e) { alert(e.message); }
}

/* ── ล้างตาราง: เอาวิชาออกจากช่อง (รายการสอนยังอยู่ครบ) ทั้งภาคเรียน / เฉพาะห้อง / เฉพาะครู · ย้อนกลับได้ ── */
function openClearModal() {
  if (previewGuard()) return;
  const here = ED.by === 'class' ? classShort(ED.key) : teacherShort(+ED.key);
  const body = `
    <div class="mb-2">เอาวิชาออกจากช่องในตาราง — <b>รายการสอนยังอยู่ครบ</b> (ไปอยู่ที่ "ยังไม่ได้วาง") แล้วลากวางเอง หรือกด <b>จัดอัตโนมัติ</b></div>
    <label class="d-block"><input type="radio" name="clScope" value="all" checked onchange="clearPreview()"> ทั้งภาคเรียน ${esc(T.term.name)}</label>
    <label class="d-block"><input type="radio" name="clScope" value="here" onchange="clearPreview()"> เฉพาะ${ED.by === 'class' ? 'ห้อง' : ''} ${esc(here)}
      ${ED.by === 'class' ? '<span class="text-muted small">(วิชาที่เรียนรวมหลายห้อง เช่น ศาสนา คงไว้)</span>' : '<span class="text-muted small">(วิชาที่สอนร่วมกับครูอื่นจะออกทั้งรายการ)</span>'}</label>
    <label class="d-block mt-2"><input type="checkbox" id="clKeep" checked onchange="clearPreview()"> เก็บช่องที่ล็อก 🔒 ไว้ <span class="text-muted small">(เช่น ชุมนุม ลูกเสือ ประชุม PLC)</span></label>
    <div id="clNow" class="alert alert-warning py-2 mt-2 mb-0 small"></div>`;
  showModal('<i class="bi bi-eraser"></i> ล้างตาราง', body, `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button id="clGo" class="btn btn-danger btn-sm" onclick="doClear()"><i class="bi bi-eraser"></i> ล้างตาราง</button>`);
  clearPreview();
}
function clearPlan() {
  const scope = document.querySelector('input[name="clScope"]:checked').value, keep = el('clKeep').checked;
  const inScope = l => scope === 'all' || (ED.by === 'class' ? l.classes.length === 1 && l.classes[0] === ED.key : l.teacher_ids.includes(+ED.key));
  const map = {}, prev = {};
  let n = 0;
  T.lessons.filter(inScope).forEach(l => {
    const stay = keep ? l.slots.filter(s => s[2]) : [];
    if (stay.length === l.slots.length) return;
    n += l.slots.length - stay.length;
    map[l.id] = stay.map(s => [s[0], s[1], 1]);
    prev[l.id] = l.slots.map(s => [s[0], s[1], s[2] ? 1 : 0]);
  });
  return { map, prev, n, lessons: Object.keys(map).length };
}
function clearPreview() {
  const c = clearPlan();
  el('clNow').innerHTML = c.n ? `จะเอาออก <b>${c.n}</b> ช่อง จาก ${c.lessons} รายการ · เปลี่ยนใจกด <b>ย้อนกลับ</b> ได้` : 'ไม่มีช่องที่ต้องเอาออก';
  el('clGo').disabled = !c.n;
}
async function doClear() {
  const c = clearPlan();
  if (!c.n) return;
  if (T.term.published && !confirm(`ภาคเรียน ${T.term.name} เผยแพร่แล้ว ครูจะเห็นตารางว่างทันที — ล้างต่อหรือไม่?`)) return;
  try {
    await setSlotsBulk(c.map);
    ED.undo.push({ restore: c.prev });
    if (ED.undo.length > 50) ED.undo.shift();
    edModal.hide(); renderEditor();
    toastEd(`ล้างแล้ว ${c.n} ช่อง — ลากวางเอง หรือกด จัดอัตโนมัติ · เปลี่ยนใจกด ย้อนกลับ`);
  } catch (e) { alert(e.message); }
}
function edBy(by) { ED.by = by; ED.key = ''; clearPick(); renderEditor(); }

// แยก/รวมคาบคู่ของวิชาเดียว (เงื่อนไข "คาบคู่" ของรายการ) — คาบคู่ที่หาช่องติดกันไม่ได้ แยกแล้วลากวางทีละคาบ
// หรือให้จัดอัตโนมัติวางแยกได้ · quiet = ไม่วาดหน้าใหม่/ไม่แจ้ง (ใช้ตอนแยกหลายวิชาจากหน้าจัดอัตโนมัติ)
async function setDouble(lid, on, quiet) {
  if (previewGuard()) return false;
  const L = lessonById(lid);
  if (!L) return false;
  const body = { code: L.code, title: L.title, kind: L.kind, classes: L.classes, track: L.track, teacher_ids: L.teacher_ids,
                 per_week: L.per_week, options: Object.assign({}, L.options || {}, { double: on }), note: L.note || '' };
  try {
    const r = await apiFetch(`/api/tt/lessons/${lid}`, { method: 'PUT', body: JSON.stringify(body) });
    T.lessons[T.lessons.findIndex(l => l.id === lid)] = r.lesson;
    if (!quiet) {
      buildIndex(); renderEditor();
      toastEd(on ? `${lessonName(L)} กลับเป็นคาบคู่แล้ว` : `แยกคาบคู่ ${lessonName(L)} แล้ว — ลากวางทีละคาบ หรือกด "จัดอัตโนมัติ" (รวมกลับได้ที่ ✏️ แก้ไขรายการ)`);
    }
    return true;
  } catch (e) { alert(e.message); return false; }
}

/* ── ชน / เตือน ทั้งภาคเรียน: กดรายการ → ไปที่ห้อง/ครูนั้น แล้วกะพริบช่อง ── */
function issueWhere(x) {
  if (x.type === 'class') return { by: 'class', key: String(x.key), label: classShort(x.key) };
  return { by: 'teacher', key: String(x.key), label: teacherShort(+x.key) };
}
function openIssuesModal(kind) {
  const list = allIssues()[kind];
  const body = list.length ? `<div class="small text-muted mb-2">กดรายการเพื่อไปที่ตารางนั้น</div>
    <div class="list-group">${list.map((x, i) => `<button type="button" class="list-group-item list-group-item-action d-flex gap-2 align-items-start" onclick="gotoIssue('${kind}', ${i})">
      <span class="badge ${kind === 'hard' ? 'bg-danger' : 'bg-warning text-dark'} mt-1">${esc(issueWhere(x).label)}</span>
      <span class="small">${x.d ? `<b>${DAYS[x.d - 1]} คาบ ${x.p}</b> ` : ''}${esc(x.msg)}</span></button>`).join('')}</div>`
    : `<div class="text-center text-success py-3"><i class="bi bi-check-circle fs-2 d-block"></i>ไม่มี${kind === 'hard' ? 'จุดที่ชน' : 'คำเตือน'}</div>`;
  showModal(kind === 'hard' ? `<i class="bi bi-x-octagon text-danger"></i> จุดที่ชนทั้งภาคเรียน (${list.length})`
                            : `<i class="bi bi-exclamation-triangle text-warning"></i> คำเตือนทั้งภาคเรียน (${list.length})`, body,
    '<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ปิด</button>');
}
function gotoIssue(kind, i) {
  const x = allIssues()[kind][i];
  if (!x) return;
  const w = issueWhere(x);
  edModal.hide(); clearPick();
  ED.by = w.by; ED.key = w.key; renderEditor();
  const td = x.d && document.querySelector(`.ed-cell[data-d="${x.d}"][data-p="${x.p}"]`);
  const card = !td && x.lid && document.querySelector(`.ed-card[data-lid="${x.lid}"]`);   // วางไม่ครบ → กล่อง "ยังไม่ได้วาง"
  const target = td || card;
  if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1400); }
}

/* ── วิธีใช้ (เปิดเองครั้งแรกที่เข้าหน้าจัดตาราง) ── */
function openEditorHelp() {
  const step = (n, t, d) => `<div class="d-flex gap-2 mb-2"><span class="badge rounded-pill bg-primary align-self-start mt-1">${n}</span><div><b>${t}</b><div class="small text-muted">${d}</div></div></div>`;
  showModal('<i class="bi bi-question-circle"></i> วิธีจัดตารางสอน', `
    ${step(1, 'ตรวจรายการสอน', 'เลือก "รายห้อง" หรือ "รายครู" ด้านบน → ตารางด้านล่างคือวิชาที่ต้องสอน กด ✏️ เพื่อแก้ครู คาบ/สัปดาห์ หรือติ๊ก "คาบคู่" · ขาดวิชาไหนกด "+ เพิ่มรายการสอน"')}
    ${step(2, 'ตั้งเงื่อนไข', 'ครูไม่ว่างบางช่วง (เช่น ไปธนาคารบ่ายวันศุกร์): รายครู → "เงื่อนไขครู" · ม.4-6 ที่แยกสาย: รายห้อง → "สายการเรียน"')}
    ${step(3, 'ล็อกช่องที่ห้ามย้าย', 'กด 🔓 บนวิชาที่ต้องอยู่ช่องเดิม (เช่น ชุมนุม ลูกเสือ ประชุม) → กลายเป็น 🔒')}
    ${step(4, 'จัดอัตโนมัติ', 'กด "จัดอัตโนมัติ" → "ดูผลในตาราง" (ยังไม่บันทึก เลือกดูห้องอื่นได้) → พอใจแล้วกด "บันทึกผลนี้"')}
    ${step(5, 'ปรับเอง', 'ลากวิชาไปช่องใหม่ หรือแตะวิชาแล้วแตะช่อง (ใช้บนแท็บเล็ตได้) · คาบคู่ที่หาช่องติดกันไม่ได้ กด "✂ แยกคาบคู่" บนการ์ดแล้ววางทีละคาบ · ระหว่างเลือก ช่องจะเป็น <span class="text-success fw-bold">เขียว</span>=วางได้ <span class="text-warning fw-bold">เหลือง</span>=ผิดเงื่อนไข <span class="text-danger fw-bold">แดง</span>=ชน · พลาดกด "ย้อนกลับ"')}
    ${step(6, 'ตรวจแล้วเผยแพร่', 'ปุ่ม "ชน" และ "เตือน" มุมขวาต้องเป็น 0 (กดดูได้ว่าอยู่ตรงไหน) → กดปุ่มภาคเรียน → "เผยแพร่ให้ครูเห็น"')}`,
    '<a class="btn btn-outline-primary btn-sm me-auto" href="/timetable-guide.html" target="_blank" rel="noopener"><i class="bi bi-book"></i> คู่มือฉบับเต็ม (มีภาพประกอบ)</a>'
    + '<button class="btn btn-primary btn-sm" data-bs-dismiss="modal">เข้าใจแล้ว</button>');
}
/* ── ชวนฝ่ายวิชาการเข้ามาจัด: ลิงก์ตรงเข้าหน้าจัดตารางของภาคเรียนนี้ (ต้องล็อกอิน + มีสิทธิ์ผู้ช่วยจัดตาราง) ── */
function shareLink() { return `${location.origin}/timetable.html?tab=edit&term=${encodeURIComponent(T.term.name)}`; }
function openShareModal() {
  const text = `📅 ชวนจัดตารางสอน ภาคเรียน ${T.term.name}${T.term.published ? '' : ' (ร่าง)'}\n`
    + `เปิดลิงก์แล้วเข้าสู่ระบบด้วยบัญชีครูของตัวเอง ระบบจะพาเข้าหน้าจัดตารางให้เลย\n${shareLink()}\n\n`
    + `💡 แนะนำเปิดในคอมพิวเตอร์หรือแท็บเล็ต (ลากวางสะดวกกว่ามือถือ)\n📖 คู่มือจัดตารางสอน (มีภาพประกอบ): ${location.origin}/timetable-guide.html`;
  showModal('<i class="bi bi-line"></i> ส่งลิงก์จัดตารางทาง LINE', `
    <div class="small mb-2">คนที่เปิดลิงก์ต้องเป็น <b>แอดมิน</b> หรือ <b>ผู้ช่วยจัดตาราง</b> ถึงจะแก้ได้ — คนอื่นเปิดแล้วดูได้อย่างเดียว
      ${T.is_admin ? ' · เพิ่มผู้ช่วยได้ที่ <a href="#" onclick="openEditorsModal(); return false;">ผู้ช่วยจัดตาราง</a>' : ''}</div>
    <textarea id="lineMsg" class="form-control" rows="7" style="font-size:.9rem">${esc(text)}</textarea>`,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ปิด</button>
     <a class="btn btn-outline-success btn-sm d-none" id="lineOpen" href="https://line.me/R/" target="_blank" rel="noopener"><i class="bi bi-line"></i> เปิดไลน์</a>
     <button class="btn btn-success btn-sm" onclick="copyLine()"><i class="bi bi-clipboard-check"></i> ก๊อปข้อความ</button>`);
}

async function openEditorsModal() {
  let r;
  try { r = await apiFetch('/api/tt/editors'); } catch (e) { alert(e.message); return; }
  const on = new Set(r.editors);
  const admins = r.users.filter(u => u.role === 'admin'), others = r.users.filter(u => u.role !== 'admin');
  showModal('<i class="bi bi-person-plus"></i> ผู้ช่วยจัดตาราง', `
    <div class="small text-muted mb-2">ติ๊กครูที่ให้จัดตารางสอน / จัดครูสอนแทน / เผยแพร่ได้ (เช่น หัวหน้าวิชาการ) —
      ไม่ได้เป็นแอดมินทั้งระบบ แก้ข้อมูลนักเรียน บัญชีผู้ใช้ หรือการตั้งค่าอื่นไม่ได้</div>
    <div class="list-group mb-2" style="max-height:45vh; overflow:auto">
      ${others.map(u => `<label class="list-group-item d-flex gap-2 align-items-center">
        <input class="form-check-input m-0 edU" type="checkbox" value="${u.id}" ${on.has(u.id) ? 'checked' : ''}>
        <span>${esc(u.full_name)} <span class="text-muted small">(${esc(u.username)})</span></span></label>`).join('')
        || '<div class="list-group-item text-muted small">ยังไม่มีบัญชีครู — สร้างบัญชีที่หน้า "จัดการผู้ใช้" ก่อน</div>'}
    </div>
    <div class="small text-muted">แอดมินจัดได้อยู่แล้ว: ${admins.map(u => esc(u.full_name)).join(', ') || '-'}</div>`,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
     <button class="btn btn-primary btn-sm" onclick="saveEditors()"><i class="bi bi-save"></i> บันทึก</button>`);
}
async function saveEditors() {
  const ids = [...document.querySelectorAll('.edU:checked')].map(x => +x.value);
  try {
    await apiFetch('/api/tt/editors', { method: 'PUT', body: JSON.stringify({ user_ids: ids }) });
    edModal.hide();
    toastEd(ids.length ? `ตั้งผู้ช่วยจัดตาราง ${ids.length} คนแล้ว — ส่งลิงก์ให้ได้ที่ เครื่องมือ → ส่งลิงก์` : 'ไม่มีผู้ช่วยจัดตารางแล้ว');
  } catch (e) { alert(e.message); }
}

function maybeShowEditorHelp() {
  try { if (localStorage.getItem('ttEditorHelpSeen')) return; localStorage.setItem('ttEditorHelpSeen', '1'); } catch (e) { return; }
  openEditorHelp();
}

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
  const o = l.options || {}, P = periodsFor('class');
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
    <label class="form-label small mb-0 mt-2">ชั้น <a href="#" class="ms-2" onclick="document.querySelectorAll('.lfCls').forEach(x => x.checked = true); return false;">เลือกทุกชั้น</a></label>
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
        <label class="d-block"><input type="checkbox" id="lfDouble" ${o.double ? 'checked' : ''}> เรียนติดกัน 2 คาบ (คาบคู่)${id && noDoubleTeacher(l) ? ` <span class="text-muted">— ${esc(teacherShort(noDoubleTeacher(l)))}ตั้ง "ไม่สอนคาบคู่" ระบบวางทีละคาบ</span>` : ''}</label>
        <label class="d-block"><input type="checkbox" id="lfSameDay" ${o.allow_same_day ? 'checked' : ''}> ให้มีวันเดียวกันได้มากกว่า 1 ครั้ง</label>
      </div>
    </div>
    <label class="form-label small mb-0 mt-1">หลีกเลี่ยงคาบ</label>
    <div>${P.map(x => `<label class="me-2"><input type="checkbox" class="lfAvoid" value="${x.no}" ${(o.avoid || []).includes(x.no) ? 'checked' : ''}> ${x.no}</label>`).join('')}</div>
    <label class="form-label small mb-0 mt-2">หมายเหตุ</label><input id="lfNote" class="form-control form-control-sm" value="${esc(l.note || '')}">
    ${id ? `<div class="small text-muted mt-2">วางในตารางแล้ว ${l.slots.length} คาบ</div>` : ''}
    ${id && l.classes.length && l.teacher_ids.length >= 2 && l.teacher_ids.length <= 4 && !tracksOf(l).length ? `<div class="alert alert-info py-2 px-2 small mt-2 mb-0">
      <b>ครู ${l.teacher_ids.length} คนนี้สอนแยกกลุ่มกันไหม?</b> (นักเรียนแบ่งไปเรียนกับครูแต่ละคน เช่น วิชาเลือก)
      ถ้าใช่ กดแยก — ครูคนไหนไม่มา ระบบจะจัดครูแทนให้เฉพาะกลุ่มนั้น · ถ้าสอนร่วมกันในห้องเดียว ไม่ต้องกด
      <div class="mt-1"><button type="button" class="btn btn-sm btn-outline-primary" onclick="splitByTeacher(${id})">✂ แยกเป็นกลุ่มละครู</button></div></div>` : ''}`;
  const foot = `${id ? `<button class="btn btn-outline-danger btn-sm me-auto" onclick="deleteLesson(${id})"><i class="bi bi-trash"></i> ลบรายการ</button>` : ''}
    <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button class="btn btn-primary btn-sm" onclick="saveLesson(${id || 'null'})"><i class="bi bi-save"></i> บันทึก</button>`;
  showModal(id ? `แก้ไข ${esc(lessonName(l))}` : 'เพิ่มรายการสอน', body, foot);
}

async function saveLesson(id) {
  if (previewGuard()) return;
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

// วิชาเดียวที่มีครูหลายคนแต่นักเรียนแยกกลุ่ม → รายการละครู สาย "กลุ่ม 1, 2, …" (ช่องในตาราง/ล็อกเหมือนเดิม)
async function splitByTeacher(lid) {
  if (previewGuard()) return;
  const L = lessonById(lid);
  if (!confirm(`แยก ${lessonName(L)} ${classLabel(L)} เป็น ${L.teacher_ids.length} กลุ่ม กลุ่มละครู (${L.teacher_ids.map(teacherShort).join(', ')})?\n• ช่องในตารางเหมือนเดิม\n• ห้องนี้จะมีสาย "กลุ่ม 1, 2, …" เพิ่ม (แก้ชื่อได้ที่ปุ่มสายการเรียน)`)) return;
  try {
    const r = await apiFetch(`/api/tt/lessons/${lid}/split-teachers`, { method: 'POST' });
    r.lessons.forEach(nl => { const i = T.lessons.findIndex(l => l.id === nl.id); if (i >= 0) T.lessons[i] = nl; else T.lessons.push(nl); });
    T.term.config.tracks = Object.assign({}, T.term.config.tracks || {}, r.tracks);
    edModal.hide(); buildIndex(); renderEditor();
    toastEd(`แยกแล้ว: ${r.lessons.map(l => `${l.track} ${teacherShort(l.teacher_ids[0])}`).join(' · ')}`);
  } catch (e) { alert(e.message); }
}

async function deleteLesson(id) {
  if (previewGuard()) return;
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
    const box = document.querySelector('.lf-teachers');
    const had = box.querySelector(`.lfT[value="${r.teacher.id}"]`);        // ชื่อเดิมที่เคยปิดไว้ → เซิร์ฟเวอร์เปิดคนเดิมกลับมา
    if (had) { had.checked = true; return; }
    if (!T.teachers.some(t => t.id === r.teacher.id)) T.teachers.push(r.teacher);
    buildIndex();
    box.insertAdjacentHTML('afterbegin', `<label class="me-3"><input type="checkbox" class="lfT" value="${r.teacher.id}" checked> ${esc(r.teacher.name.split(' ')[0])}</label>`);
  } catch (e) { alert(e.message); }
}

/* ═════════════ ฟอร์ม: เงื่อนไขครู ═════════════ */
async function openTeacherModal(tid) {
  const t = IDX.teachers[tid]; if (!t) return;
  const c = t.constraints || {}, P = T.term.config.periods;
  let users = [];
  if (T.is_admin) try { users = await apiFetch('/api/tt/users'); } catch (e) {}
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
    ${T.is_admin ? `<label class="form-label small mb-0">บัญชีผู้ใช้ในระบบ <span class="text-muted">(ครูล็อกอินแล้วเห็นตารางตัวเองทันที)</span></label>
    <select id="tcUser" class="form-select form-select-sm mb-2"><option value="">— ไม่ผูก —</option>${users.map(u => `<option value="${u.id}" ${u.id === t.user_id ? 'selected' : ''}>${esc(u.full_name)} (${u.role === 'admin' ? 'แอดมิน' : 'ครู'})</option>`).join('')}</select>` : ''}
    <label class="form-label small mb-0">คาบที่ <b class="text-danger">ไม่ว่าง</b> — จัดอัตโนมัติจะไม่วางสอนช่องนี้ (แตะช่องเพื่อสลับ หรือกด เช้า / บ่าย / ทั้งวัน)</label>
    ${grid}
    <input id="tcNote" class="form-control form-control-sm mb-2" maxlength="100" value="${esc(c.note || '')}" placeholder="เหตุผลที่ไม่ว่าง เช่น ไปธนาคารบ่ายวันศุกร์ (ขึ้นในคำเตือน)">
    <div class="row g-2 align-items-center"><div class="col-auto small">สอนไม่เกินวันละ</div>
      <div class="col-3"><input id="tcMax" type="number" min="0" max="7" class="form-control form-control-sm" value="${c.max_per_day || ''}" placeholder="ไม่จำกัด"></div><div class="col-auto small">คาบ</div></div>
    <div class="row g-2 align-items-center mt-1"><div class="col-auto small">สอนติดกันไม่เกิน</div>
      <div class="col-3"><input id="tcRun" type="number" min="2" max="7" class="form-control form-control-sm" value="${c.max_run || ''}" placeholder="${T.term.config.max_run ? 'ตามกฎ ' + T.term.config.max_run : 'ไม่จำกัด'}"></div>
      <div class="col-auto small">คาบ <span class="text-muted">(ว่าง = ตามกฎการจัดตาราง${T.term.config.max_run ? ' ' + T.term.config.max_run + ' คาบ' : ''})</span></div></div>
    <label class="d-block small mt-2"><input type="checkbox" id="tcFreePair" ${c.free_pair ? 'checked' : ''}> <b>อยากมีคาบว่างติดกันอย่างน้อย 2 คาบทุกวัน</b>
      <span class="text-muted">— คาบ 4 กับ 5 ที่คั่นพักกลางวันนับว่าติดกัน</span>
      ${freePairMaxDays(tid) < DAYS.length ? `<span class="d-block text-warning-emphasis">⚠ ครูคนนี้มีรายการ ${busyLoad(tid)} คาบ/สัปดาห์ (วิชา+กิจกรรม) ทำได้มากสุด ${freePairMaxDays(tid)} วัน — ถ้าจะให้ครบทุกวัน ต้องไม่เกิน ${DAYS.length * pairDayCaps(tid).pair} คาบ${effectiveMaxRun(tid) ? ' (คิดรวมกฎสอนติดกันแล้ว)' : ''}</span>` : ''}</label>
    <label class="d-block small mt-2"><input type="checkbox" id="tcNoDbl" ${c.no_double ? 'checked' : ''}> <b>ไม่สอนคาบคู่</b>
      <span class="text-muted">— วิชาของครูคนนี้วางทีละคาบ ไม่เรียนติดกัน 2 คาบ (จัดอัตโนมัติจะแยกให้เอง)</span></label>
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
  if (previewGuard()) return;
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
  const body = { name: el('tcName').value,
                 constraints: { unavailable, max_per_day: +el('tcMax').value || 0, note: el('tcNote').value.trim(), no_double: el('tcNoDbl').checked, max_run: +el('tcRun').value || 0, free_pair: el('tcFreePair').checked } };
  if (el('tcUser')) body.user_id = +el('tcUser').value || null;          // ผูกบัญชี = แอดมินเท่านั้น
  try {
    const r = await apiFetch(`/api/tt/teachers/${tid}`, { method: 'PUT', body: JSON.stringify(body) });
    T.teachers[T.teachers.findIndex(t => t.id === tid)] = r.teacher;
    edModal.hide(); buildIndex(); renderEditor();
  } catch (e) { alert(e.message); }
}

/* ═════════════ ฟอร์ม: สายการเรียนของห้อง (ตารางติ๊ก วิชา × สาย) ═════════════
   ตั้งชื่อสาย + ติ๊กว่าแต่ละวิชาเรียนสายไหน ในหน้าเดียว · แก้ชื่อสาย = วิชาที่ใช้ชื่อเดิมเปลี่ยนตาม · บันทึกครั้งเดียว */
let TRK = null;
const trkClean = n => String(n || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
async function openTracksModal(cls) {
  const list = (T.term.config.tracks || {})[cls] || [];
  const ls = T.lessons.filter(l => l.classes.includes(cls))
    .sort((a, b) => (a.kind === 'activity') - (b.kind === 'activity') || lessonName(a).localeCompare(lessonName(b), 'th'));
  // ชื่อสายที่วิชาในห้องนี้ใช้อยู่แต่ไม่อยู่ในรายชื่อ (เคยเปลี่ยนชื่อ/ลบ) → เพิ่มให้เห็น จะได้แก้หรือลบได้
  const orphans = [...new Set(ls.filter(l => l.classes.length === 1).flatMap(tracksOf))].filter(n => !list.includes(n));
  TRK = { cls, seq: 0, rows: [], ticks: new Map(), keep: new Map(), ls, orphans };
  [...list, ...orphans].forEach(n => TRK.rows.push({ id: ++TRK.seq, old: n, name: n }));
  ls.forEach(l => {
    const names = tracksOf(l);
    TRK.ticks.set(l.id, new Set(TRK.rows.filter(r => names.includes(r.old)).map(r => r.id)));
    TRK.keep.set(l.id, names.filter(n => !TRK.rows.some(r => r.old === n)));   // สายของห้องอื่น (วิชาเรียนรวมหลายห้อง) — คงไว้
  });
  const par = trackParents(cls);
  TRK.rows.forEach(r => { const pr = par[r.old] && TRK.rows.find(x => x.old === par[r.old]); r.parent = pr ? pr.id : null; });
  // แนะนำ "กลุ่ม …" อยู่ในสายไหน จากตารางเทอมนี้ · ร่างที่ยังไม่ชัด → ดูจากตารางเทอมที่ใช้สอนอยู่
  TRK.suggest = inferParents(cls, TRK.rows, T.lessons);
  const cur = typeof termForDate === 'function' && termForDate(todayLocal());
  if (TRK.rows.some(r => !r.parent && /^กลุ่ม/.test(r.name) && !TRK.suggest[r.id]) && cur && cur.id !== T.term.id) {
    try { Object.assign(TRK.suggest, inferParents(cls, TRK.rows, (await apiFetch(`/api/tt/terms/${cur.id}`)).lessons), TRK.suggest); } catch (e) {}
  }
  showModal(`<i class="bi bi-diagram-3"></i> สายการเรียน ${classShort(cls)}`, '<div id="trkBox"></div>',
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
     <button class="btn btn-primary btn-sm" onclick="saveTracks()"><i class="bi bi-save"></i> บันทึก</button>`);
  el('edModal').querySelector('.modal-dialog').classList.add('modal-xl');
  el('edModal').addEventListener('hidden.bs.modal', () => el('edModal').querySelector('.modal-dialog').classList.remove('modal-xl'), { once: true });
  drawTracks();
}
function drawTracks() {
  const R = TRK.rows;
  const nameRow = R.map(r => `<div class="input-group input-group-sm" style="width:auto">
      <input class="form-control trk-name" data-id="${r.id}" style="width:120px" maxlength="30" value="${esc(r.name)}" placeholder="ชื่อสาย" oninput="trkRename(${r.id}, this.value)">
      <select class="form-select trk-par" style="max-width:150px" onchange="trkParent(${r.id}, this.value)" title="กลุ่มย่อยของสายไหน (เด็กชุดเดียวกัน)">
        <option value="">สายหลัก</option>${R.filter(x => x.id !== r.id).map(x => `<option value="${x.id}" ${r.parent === x.id ? 'selected' : ''}>อยู่ใน ${esc(x.name) || '(ไม่มีชื่อ)'}</option>`).join('')}</select>
      <button class="btn btn-outline-danger" onclick="trkRemove(${r.id})" title="ลบสายนี้"><i class="bi bi-x-lg"></i></button></div>`).join('');
  const sug = Object.entries(TRK.suggest || {}).map(([id, p]) => [R.find(x => x.id === +id), R.find(x => x.id === p)]).filter(([a, b]) => a && b && !a.parent);
  const rowsHTML = TRK.ls.map(l => {
    const tk = TRK.ticks.get(l.id), sub = l.code && T.subjects[l.code]?.name;
    return `<tr class="${l.kind === 'activity' ? 'text-muted' : ''}">
      <td><b>${esc(lessonName(l))}</b>${sub ? ` <span class="small text-muted">${esc(sub)}</span>` : ''}
        ${l.classes.length > 1 ? ` <span class="badge text-bg-light border" title="เรียนรวมหลายห้อง">${esc(classLabel({ ...l, track: '' }))}</span>` : ''}</td>
      <td class="small text-nowrap">${esc(l.teacher_ids.length > 3 ? `ครู ${l.teacher_ids.length} ท่าน` : l.teacher_ids.map(teacherShort).join(', '))}</td>
      ${R.map(r => `<td class="text-center"><input type="checkbox" class="form-check-input" ${tk.has(r.id) ? 'checked' : ''} onchange="trkTick(${l.id}, ${r.id}, this.checked)"></td>`).join('')}
      <td class="text-center"><button type="button" class="btn btn-sm py-0 ${tk.size ? 'btn-outline-secondary' : 'btn-success'}" id="trkAll${l.id}"
        onclick="trkWhole(${l.id})" title="${tk.size ? 'กดเพื่อให้เรียนทั้งห้อง (ล้างติ๊ก)' : 'เรียนทั้งห้อง'}">${tk.size ? 'ทั้งห้อง' : '✓ ทั้งห้อง'}</button></td></tr>`;
  }).join('');
  el('trkBox').innerHTML = `
    <div class="small text-muted mb-2"><b>1)</b> ตั้งชื่อสายของห้องนี้ (แก้ชื่อได้ วิชาที่ใช้ชื่อเดิมจะเปลี่ยนตามให้เอง)
      <b class="ms-2">2)</b> ติ๊กว่าแต่ละวิชาเรียนสายไหน — ไม่ติ๊ก = เรียนทั้งห้อง · วิชาต่างสายวางคาบเดียวกันได้ ไม่นับว่าชน</div>
    ${TRK.orphans.length ? `<div class="alert alert-warning py-1 px-2 small">พบชื่อสายที่วิชาใช้อยู่แต่ไม่อยู่ในรายชื่อ: ${TRK.orphans.map(esc).join(', ')} — ใส่ไว้ให้แล้ว แก้ชื่อหรือลบได้</div>` : ''}
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">${nameRow}
      <button class="btn btn-sm btn-outline-primary" onclick="trkAdd()"><i class="bi bi-plus-lg"></i> เพิ่มสาย</button></div>
    <div class="small text-muted mb-2"><b>3)</b> ถ้าเป็น<b>กลุ่มย่อย</b>ของสาย (เช่น "กลุ่ม 2" คือเด็ก BEP) เลือก <b>อยู่ใน BEP</b> — ระบบจะนับว่าชนกับวิชาของ BEP (เด็กชุดเดียวกัน)
      แต่เรียนพร้อมวิชาของสายอื่นได้</div>
    ${sug.length ? `<div class="alert alert-info py-1 px-2 small d-flex flex-wrap align-items-center gap-2">
      <span>💡 แนะนำจากตาราง: ${sug.map(([a, b]) => `<b>${esc(a.name)}</b> อยู่ใน <b>${esc(b.name)}</b>`).join(' · ')} (ไม่เคยเรียนพร้อมกัน)</span>
      <button class="btn btn-sm btn-info py-0" onclick="trkUseSuggest()">ใช้คำแนะนำ</button></div>` : ''}
    <div id="trkBal">${trkBalanceHTML()}</div>
    ${R.length ? `<div class="table-responsive" style="max-height:55vh">
      <table class="table table-sm table-hover align-middle mb-0">
        <thead class="table-light sticky-top"><tr><th>วิชา / กิจกรรม</th><th>ครู</th>
          ${R.map(r => `<th class="text-center" id="trkH${r.id}">${esc(r.name) || '<span class="text-danger">(ไม่มีชื่อ)</span>'}</th>`).join('')}
          <th class="text-center">เรียนทั้งห้อง</th></tr></thead>
        <tbody>${rowsHTML}</tbody></table></div>`
      : `<div class="text-muted small py-2">ห้องนี้ไม่แยกสาย — ทุกวิชาเรียนทั้งห้อง · ถ้าแยกสาย กด "+ เพิ่มสาย"</div>`}`;
}
function trkRename(id, v) {
  const r = TRK.rows.find(x => x.id === id); r.name = v;
  const h = el('trkH' + id); if (h) h.innerHTML = esc(trkClean(v)) || '<span class="text-danger">(ไม่มีชื่อ)</span>';
  document.querySelectorAll(`.trk-par option[value="${id}"]`).forEach(o => { o.textContent = 'อยู่ใน ' + (trkClean(v) || '(ไม่มีชื่อ)'); });
}
function trkParent(id, v) { TRK.rows.find(x => x.id === id).parent = v ? +v : null; trkBalanceUpdate(); }
// คาบเฉพาะสายต่อสัปดาห์ของแต่ละสายหลัก ตามที่ติ๊กอยู่ (กลุ่มย่อยนับรวมสายแม่) — ควรเท่ากัน ทุกสายจึงเรียนพร้อมกันได้ทุกคาบ
function trkBalanceHTML() {
  const R = TRK.rows, rootOf = id => { let r = R.find(x => x.id === id), k = 0; while (r && r.parent && k++ < 6) r = R.find(x => x.id === r.parent) || r; return r ? r.id : id; };
  const roots = R.filter(r => !r.parent);
  if (roots.length < 2) return '';
  const per = Object.fromEntries(roots.map(r => [r.id, 0]));
  let whole = 0;
  TRK.ls.forEach(l => {
    const rs = [...new Set([...TRK.ticks.get(l.id)].map(rootOf))].filter(id => id in per);
    if (rs.length) rs.forEach(id => { per[id] += l.per_week; }); else whole += l.per_week;
  });
  const slots = DAYS.length * periodsFor('class').length, vals = roots.map(r => per[r.id]), mx = Math.max(...vals), mn = Math.min(...vals);
  const tot = r => whole + per[r.id], over = roots.filter(r => tot(r) > slots);
  const chips = roots.map(r => `<span class="badge ${per[r.id] < mx ? 'text-bg-warning' : 'text-bg-light border'} me-1">${esc(trkClean(r.name) || '(ไม่มีชื่อ)')} ${per[r.id]} คาบ</span>`).join('');
  const status = over.length
    ? `<span class="text-danger">✖ สาย ${over.map(r => esc(trkClean(r.name))).join(', ')} มีคาบเรียน ${Math.max(...over.map(tot))} คาบ เกิน ${slots} ช่อง — วิชาที่เรียนทั้งห้องบางวิชาน่าจะเป็นวิชาเฉพาะสาย</span>`
    : mx === mn ? '<span class="text-success">✓ ทุกสายมีคาบเฉพาะสายเท่ากัน — จัดให้ทุกสายเรียนพร้อมกันได้ทุกคาบ</span>'
    : `<span class="text-warning-emphasis">⚠ ไม่เท่ากัน — จะมีอย่างน้อย ${mx - mn} ช่องที่บางสายเรียนแต่บางสายว่าง · ตรวจว่าวิชาเลือกของสายที่น้อยกว่า (สีเหลือง) ติ๊กครบไหม</span>`;
  const subs = roots.filter(r => /^กลุ่ม/.test(trkClean(r.name))), mains = roots.filter(r => !/^กลุ่ม/.test(trkClean(r.name)));
  const hint = subs.length && mains.length ? `<br><span class="text-muted">💡 ${subs.map(r => esc(trkClean(r.name))).join(', ')} ยังนับเป็นสายแยก — ถ้าเป็นกลุ่มย่อยของสายไหน เลือก "อยู่ใน …" ก่อน (หรือกด ใช้คำแนะนำ) ตัวเลขจะถูกต้อง</span>` : '';
  return `<div class="small mb-2 p-2 border rounded"><b>คาบเฉพาะสายต่อสัปดาห์</b> (ควรเท่ากัน): ${chips} · เรียนทั้งห้อง ${whole} คาบ<br>${status}${hint}</div>`;
}
const trkBalanceUpdate = () => { const b = el('trkBal'); if (b) b.innerHTML = trkBalanceHTML(); };
function trkUseSuggest() {
  Object.entries(TRK.suggest || {}).forEach(([id, p]) => { const r = TRK.rows.find(x => x.id === +id); if (r && !r.parent && TRK.rows.some(x => x.id === p)) r.parent = p; });
  drawTracks();
}
// "กลุ่ม …" ที่ไม่เคยเรียนพร้อมกับวิชาของสายหลักสายเดียว (แต่เรียนพร้อมสายอื่น) = น่าจะเป็นเด็กสายนั้น
function inferParents(cls, rows, lessons) {
  const at = {}, out = {};
  lessons.filter(l => l.classes.includes(cls)).forEach(l => l.slots.forEach(([d, p]) => (at[d + '-' + p] = at[d + '-' + p] || []).push(l)));
  rows.forEach(r => {
    if (r.parent || !r.old || !/^กลุ่ม/.test(r.old)) return;
    const co = new Set(); let seen = false;
    Object.values(at).forEach(ls => {
      if (!ls.some(l => tracksOf(l).includes(r.old))) return;
      seen = true;
      ls.forEach(l => { if (!tracksOf(l).includes(r.old)) tracksOf(l).forEach(t => co.add(t)); });
    });
    const cand = rows.filter(x => x.id !== r.id && x.old && !/^กลุ่ม/.test(x.old) && !co.has(x.old));
    if (seen && co.size && cand.length === 1) out[r.id] = cand[0].id;
  });
  return out;
}
function trkAdd() {
  const id = ++TRK.seq;
  TRK.rows.push({ id, old: null, name: '' });
  drawTracks();
  document.querySelector(`.trk-name[data-id="${id}"]`)?.focus();
}
function trkRemove(id) {
  const r = TRK.rows.find(x => x.id === id);
  const used = TRK.ls.filter(l => TRK.ticks.get(l.id).has(id));
  if (used.length && !confirm(`สาย "${trkClean(r.name) || '(ไม่มีชื่อ)'}" มี ${used.length} วิชาติ๊กไว้ (${used.slice(0, 5).map(lessonName).join(', ')}${used.length > 5 ? ' …' : ''})\nลบแล้ววิชาเหล่านี้จะไม่อยู่ในสายนี้ (ถ้าไม่เหลือสายไหนเลย = เรียนทั้งห้อง) ลบเลยไหม?`)) return;
  TRK.rows = TRK.rows.filter(x => x.id !== id);
  TRK.rows.forEach(x => { if (x.parent === id) x.parent = null; });
  TRK.ticks.forEach(set => set.delete(id));
  drawTracks();
}
function trkTick(lid, id, on) {
  const tk = TRK.ticks.get(lid);
  if (on) tk.add(id); else tk.delete(id);
  const b = el('trkAll' + lid);
  b.className = `btn btn-sm py-0 ${tk.size ? 'btn-outline-secondary' : 'btn-success'}`; b.textContent = tk.size ? 'ทั้งห้อง' : '✓ ทั้งห้อง';
  trkBalanceUpdate();
}
function trkWhole(lid) { TRK.ticks.get(lid).clear(); drawTracks(); }
async function saveTracks() {
  if (previewGuard()) return;
  const names = TRK.rows.map(r => trkClean(r.name));
  if (names.some(n => !n)) { alert('ใส่ชื่อสายให้ครบ (หรือกด ✖ ลบช่องที่ไม่ใช้)'); return; }
  if (new Set(names).size !== names.length) { alert('มีชื่อสายซ้ำกัน'); return; }
  const before = allIssues().hard.length;                          // จุดชนก่อนบันทึก (บอกผลหลังบันทึก)
  const lessons = {};
  TRK.ls.forEach(l => {
    const next = [...new Set([...TRK.keep.get(l.id), ...TRK.rows.filter(r => TRK.ticks.get(l.id).has(r.id)).map(r => trkClean(r.name))])];
    if ([...next].sort().join(',') !== [...tracksOf(l)].sort().join(',')) lessons[l.id] = next;
  });
  const parents = {};
  TRK.rows.forEach(r => { const p = r.parent && TRK.rows.find(x => x.id === r.parent); if (p) parents[trkClean(r.name)] = trkClean(p.name); });
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/class-tracks`, { method: 'POST', body: JSON.stringify({ cls: TRK.cls, tracks: names, lessons, parents }) });
    const tr = Object.assign({}, T.term.config.tracks || {});
    if (r.tracks.length) tr[TRK.cls] = r.tracks; else delete tr[TRK.cls];
    T.term.config.tracks = tr;
    const tp = Object.assign({}, T.term.config.track_parents || {});
    if (Object.keys(r.parents || {}).length) tp[TRK.cls] = r.parents; else delete tp[TRK.cls];
    T.term.config.track_parents = tp;
    r.lessons.forEach(nl => { T.lessons[T.lessons.findIndex(l => l.id === nl.id)] = nl; });
    edModal.hide(); buildIndex(); renderEditor();
    const after = allIssues().hard.length;
    toastEd(`บันทึกสายการเรียน ${classShort(TRK.cls)} แล้ว: ${r.tracks.length} สาย · แก้ ${r.lessons.length} วิชา` + (after !== before ? ` · จุดชน ${before} → ${after}` : ''));
  } catch (e) { alert(e.message); }
}

/* ═════════════ ตั้งสายการเรียนจากโครงสร้างหลักสูตร ═════════════ */
async function applyTracks() {
  if (previewGuard()) return;
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
  if (previewGuard()) return;
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
/* ── นำเข้ารายวิชาจาก Excel "แบบสำรวจภาระงานสอน" (ชีตละกลุ่มสาระ) → แทนรายวิชาเดิม ── */
let IMP = null;   // { file, plan }
function openImportModal() {
  if (previewGuard()) return;
  IMP = null;
  const body = `
    <div class="small text-muted mb-2">ไฟล์แบบสำรวจภาระงานสอนจากหัวหน้ากลุ่มสาระ (ชีตละสาระ มีคอลัมน์ รหัสวิชา · รายวิชา · ชั้น · คาบ/สัปดาห์ · ครูผู้สอน · หมายเหตุ)
      ภาคเรียน ${esc(T.term.name)} · กิจกรรม (ชุมนุม ลูกเสือ ประชุม PLC ฯลฯ) คงเดิม · วิชาที่ตรงกับของเดิมอยู่ที่เดิมในตาราง ·
      หมายเหตุ "นอกตาราง" ไม่นำเข้า · "2 คาบคู่" / "1 คาบเดี่ยว, 2 คาบคู่" = ตั้งคาบคู่ให้ · แถวที่ไม่มีชื่อครูใช้ครูเดิมในร่าง</div>
    <div class="mb-2">
      <label class="d-block"><input type="radio" name="impMode" value="replace" checked onchange="importModeChanged()"> <b>แทนรายวิชาเดิมทั้งหมด</b> <span class="small text-muted">(ไฟล์แบบสำรวจครบทุกกลุ่มสาระ — วิชาเดิมที่ไม่มีในไฟล์จะถูกลบ)</span></label>
      <label class="d-block"><input type="radio" name="impMode" value="update" onchange="importModeChanged()"> <b>อัปเดตเฉพาะวิชาที่อยู่ในไฟล์</b> <span class="small text-muted">(ไม่ลบวิชาอื่น — เช่น ไฟล์ของกลุ่มสาระเดียว)</span></label>
    </div>
    <div class="d-flex gap-2 align-items-center">
      <input type="file" id="impFile" accept=".xlsx" class="form-control form-control-sm">
      <button class="btn btn-sm btn-primary text-nowrap" onclick="importCheck()"><i class="bi bi-search"></i> ตรวจไฟล์</button>
    </div>
    <div id="impOut" class="mt-3"></div>`;
  const foot = `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button id="impGo" class="btn btn-success btn-sm" onclick="importApply()" disabled><i class="bi bi-box-arrow-in-down"></i> นำเข้า</button>`;
  showModal('<i class="bi bi-file-earmark-spreadsheet"></i> นำเข้ารายวิชาจาก Excel', body, foot);
}
const importMode = () => (document.querySelector('input[name="impMode"]:checked') || {}).value || 'replace';
function importModeChanged() { if (el('impFile') && el('impFile').files[0]) importCheck(); }
function importSetMode(m) { const r = document.querySelector(`input[name="impMode"][value="${m}"]`); if (r) { r.checked = true; importCheck(); } }
async function importPost(file, apply) {
  const fd = new FormData();
  fd.append('file', file); fd.append('apply', apply ? '1' : '0'); fd.append('mode', importMode());
  const res = await fetch(`/api/tt/terms/${T.term.id}/import-load`, { method: 'POST', body: fd, credentials: 'same-origin' });
  if (res.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('unauthorized'); }
  if (res.status === 403) throw new Error('สิทธิ์ไม่เพียงพอ');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}
async function importCheck() {
  const file = el('impFile').files[0];
  if (!file) { alert('เลือกไฟล์ Excel ก่อน'); return; }
  el('impOut').innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm"></span> กำลังอ่านไฟล์…</div>';
  el('impGo').disabled = true;
  try {
    const r = await importPost(file, false);
    IMP = { file, plan: r.plan };
    el('impOut').innerHTML = importPlanHTML(r.plan, r.rows);
    el('impGo').disabled = false;
  } catch (e) { el('impOut').innerHTML = `<div class="alert alert-danger py-2 small">${esc(e.message)}</div>`; }
}
function importPlanHTML(p, rows) {
  const changed = p.update.filter(x => x.changes.length);
  const sec = (icon, title, n, inner, open) => n ? `<details class="mb-2" ${open ? 'open' : ''}><summary class="fw-bold">${icon} ${title} (${n})</summary><div class="small mt-1">${inner}</div></details>` : '';
  const li = arr => `<ul class="mb-0 ps-3">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const lesson = x => `<b>${esc(x.label)}</b> · ${x.per_week} คาบ${x.double ? ' <span class="badge bg-secondary">คู่</span>' : ''} · ครู${esc(x.teachers)}${x.track ? ` · <span class="badge text-bg-light border">${esc(x.track)}</span>` : ''}${x.note ? ` <span class="text-muted">(${esc(x.note)})</span>` : ''}`;
  const missing = (p.term_areas || []).filter(a => !(p.file_areas || []).includes(a));
  const partialWarn = p.mode === 'replace' && missing.length ? `<div class="alert alert-danger py-2 small">
      ⚠ ไฟล์นี้มีแค่กลุ่มสาระ <b>${esc((p.file_areas || []).map(a => AREA_NAME[a] || a).join(', '))}</b> — ถ้า "แทนรายวิชาเดิมทั้งหมด" วิชาของกลุ่มสาระอื่น
      (${esc(missing.map(a => AREA_NAME[a] || a).join(', '))}) จะถูกลบ
      <div class="mt-1"><button class="btn btn-sm btn-danger py-0" onclick="importSetMode('update')">เปลี่ยนเป็น อัปเดตเฉพาะวิชาที่อยู่ในไฟล์</button></div></div>` : '';
  return `${partialWarn}
    <div class="mb-2">อ่านได้ ${rows} แถว →
      <span class="badge bg-success">เพิ่ม ${p.add.length}</span>
      <span class="badge bg-primary">แก้ ${changed.length}</span>
      <span class="badge bg-secondary">เหมือนเดิม ${p.update.length - changed.length}</span>
      <span class="badge bg-danger">ลบ ${p.remove.length}</span>
      <span class="badge text-bg-light border">นอกตาราง ${p.skip.length}</span></div>
    ${sec('⚠', 'ต้องตรวจ', p.warnings.length, li(p.warnings.map(esc)), true)}
    ${sec('🔧', 'แก้รหัสวิชาให้ตรงชั้น', p.fixes.length, li(p.fixes.map(esc)), true)}
    ${sec('➕', 'วิชาใหม่ (รอจัดลงตาราง)', p.add.length, li(p.add.map(lesson)))}
    ${sec('✏️', 'วิชาเดิมที่เปลี่ยน (คงช่องในตาราง)', changed.length, li(changed.map(x => `<b>${esc(x.label)}</b> · ${esc(x.changes.join(' · '))}`)))}
    ${sec('➖', 'รายวิชาเดิมที่ไม่มีในไฟล์ (จะลบ)', p.remove.length, li(p.remove.map(x => `${esc(x.label)} · ครู${esc(x.teachers)}${x.slots ? ` · วางแล้ว ${x.slots} คาบ` : ''}`)))}
    ${sec('ℹ', 'วิชาเลือก/เพิ่มเติมที่ยังเรียนทั้งห้อง — ถ้าเรียนบางสาย ตั้งที่ปุ่ม "สายการเรียน" หลังนำเข้า', p.notrack.length, li(p.notrack.map(esc)))}
    ${sec('⏭', 'ไม่นำเข้า (นอกตาราง)', p.skip.length, li(p.skip.map(esc)))}`;
}
async function importApply() {
  if (!IMP) return;
  const p = IMP.plan;
  if (!confirm(`${p.mode === 'update' ? 'อัปเดตเฉพาะวิชาที่อยู่ในไฟล์' : 'นำเข้ารายวิชาแทนของเดิม'} ใน ${T.term.name}?\n• เพิ่ม ${p.add.length} · แก้ ${p.update.filter(x => x.changes.length).length} · ลบ ${p.remove.length} รายวิชา\n• กิจกรรมคงเดิม · วิชาเดิมอยู่ที่เดิมในตาราง`
    + (T.term.published ? '\n\n⚠ ภาคเรียนนี้เผยแพร่แล้ว ครูเห็นการเปลี่ยนแปลงทันที' : ''))) return;
  el('impGo').disabled = true;
  try {
    const r = await importPost(IMP.file, true);
    IMP = null;
    edModal.hide();
    await loadTerm(T.term.id);
    const left = T.lessons.filter(l => l.slots.length < l.per_week).length;
    showModal('<i class="bi bi-check-circle text-success"></i> นำเข้าแล้ว', `
      <div class="alert alert-success py-2">${esc(r.message)}</div>
      <div class="fw-bold mb-1">ขั้นต่อไป</div>
      <ol class="small mb-0">
        <li>วิชาที่ยังไม่มีครู → กด ✏️ ที่รายการนั้นแล้วเลือกครู</li>
        <li>วิชาเลือกที่เรียนบางสาย → รายห้อง → ปุ่ม <b>สายการเรียน</b> ติ๊กสายให้ถูก</li>
        <li>กด <b>จัดอัตโนมัติ</b> → เลือก <b>วางเฉพาะคาบที่ยังไม่ได้วาง</b> (ยังวางไม่ครบ ${left} รายการ)</li>
      </ol>`, '<button class="btn btn-primary btn-sm" data-bs-dismiss="modal">ตกลง</button>');
  } catch (e) { el('impGo').disabled = false; alert(e.message); }
}

/* ── กฎการจัดตาราง (ของภาคเรียน · ร่างเทอมถัดไปคัดลอกไปด้วย)
   config.max_run = ครูสอนติดกันไม่เกิน N คาบ · config.class_busy = คาบที่นักเรียนห้ามว่าง เช่น [1] ── */
function openRulesModal() {
  if (previewGuard()) return;
  const cfg = T.term.config, cur = +(cfg.max_run || 0), la = lunchAfter(), P = periodsFor('class');
  const busy = cfg.class_busy || [1];                       // ยังไม่เคยตั้ง → แนะนำคาบแรก
  const opts = [[0, 'ไม่จำกัด'], [2, '2 คาบ'], [3, '3 คาบ'], [4, '4 คาบ'], [5, '5 คาบ']];
  const body = `
    <div class="fw-bold mb-1">1) ครูสอนติดกัน</div>
    <div class="d-flex align-items-center gap-2"><span>ครูสอนติดกันไม่เกิน</span>
      <select id="ruRun" class="form-select form-select-sm w-auto" onchange="rulesPreview()">${opts.map(([v, t]) => `<option value="${v}" ${v === (cur || 3) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="small text-muted mt-1">นับเฉพาะคาบที่มีนักเรียน (รายวิชาและกิจกรรมที่มีชั้นเรียน) · ประชุมครูและ PLC ไม่นับ ·
      พักกลางวันตัดช่วง (เช้า คาบ 1–${la} / บ่าย คาบ ${la + 1}–${P.length}) · ครูบางคนต้องการต่างจากนี้ ตั้งรายคนได้ที่ รายครู → เงื่อนไขครู</div>
    <div id="ruRunNow" class="small mt-1"></div>
    <hr class="my-2">
    <div class="fw-bold mb-1">2) คาบที่นักเรียนห้ามว่าง</div>
    <div>${P.map(x => `<label class="me-3"><input type="checkbox" class="ruBusy" value="${x.no}" ${busy.includes(x.no) ? 'checked' : ''} onchange="rulesPreview()"> คาบ ${x.no}</label>`).join('')}</div>
    <div class="small text-muted mt-1">ทุกห้องต้องมีเรียนในคาบที่ติ๊กทุกวัน — ห้องที่แยกสาย ทุกสายต้องมีเรียน (เช่น คาบแรก นักเรียนไม่ว่าง) · ไม่ติ๊กเลย = ไม่ใช้กฎนี้</div>
    <div id="ruBusyNow" class="small mt-1"></div>
    <div class="small text-muted mt-2">จัดอัตโนมัติจะจัดตามกฎเหล่านี้ · จุดที่ยังผิดกฎขึ้นในปุ่ม <b>เตือน</b></div>`;
  showModal('<i class="bi bi-sliders"></i> กฎการจัดตาราง', body, `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button class="btn btn-primary btn-sm" onclick="saveRules()"><i class="bi bi-save"></i> บันทึก</button>`);
  rulesPreview();
}
// จุดที่เกินถ้าใช้กฎ n (เงื่อนไขรายครูยังมีผลเหนือกว่า)
function runViolations(n) {
  const out = [];
  T.teachers.forEach(t => {
    const mx = +((t.constraints || {}).max_run || n || 0);
    if (mx) teacherRuns(t.id).forEach(r => { if (r.e - r.s + 1 > mx) out.push(`${teacherShort(t.id)} วัน${DAYS[r.d - 1]} คาบ ${r.s}-${r.e}`); });
  });
  return out;
}
// ครูที่คาบสอนรวมเกินที่กฎ n รองรับ (ทำตามกฎไม่ได้ทุกวัน)
function runOverloaded(n) {
  return T.teachers.map(t => {
    const m = +((t.constraints || {}).max_run || n || 0);
    return m && IDX.byTeacher[t.id] ? { t, m, load: teachLoad(t.id), cap: runCapacity(t.id, m), eff: effectiveMaxRun(t.id, m) } : null;
  }).filter(x => x && x.eff > x.m);
}
const rulesBusy = () => [...document.querySelectorAll('.ruBusy:checked')].map(x => +x.value);
function rulesPreview() {
  const n = +el('ruRun').value, v = runViolations(n), ov = n ? runOverloaded(n) : [];
  const list = arr => `<div class="text-muted">${esc(arr.slice(0, 8).join(' · '))}${arr.length > 8 ? ' …' : ''}</div>`;
  el('ruRunNow').innerHTML = (!n ? '' : v.length
    ? `<div class="alert alert-warning py-2 mb-0">ตารางตอนนี้มี <b>${v.length}</b> จุดที่สอนติดกันเกิน ${n} คาบ${list(v)}</div>`
    : `<div class="text-success"><i class="bi bi-check-circle"></i> ตารางตอนนี้ไม่มีครูสอนติดกันเกิน ${n} คาบ</div>`)
    + (ov.length ? `<div class="alert alert-info py-2 mt-2 mb-0"><b>ครูที่คาบสอนมากเกินกว่าจะทำตามกฎได้ทุกวัน</b> — จัดอัตโนมัติจะยอมให้ติดกันได้มากขึ้นเฉพาะครูคนนั้น:
        <ul class="mb-0 ps-3">${ov.map(x => `<li>${esc(teacherShort(x.t.id))} สอน ${x.load} คาบ/สัปดาห์ แต่ถ้าไม่เกิน ${x.m} คาบติด สอนได้สูงสุด ${x.cap} คาบ → ยอมให้ <b>${x.eff} คาบติด</b></li>`).join('')}</ul>
        <div class="text-muted">ถ้าต้องการให้ได้ตามกฎ: ลดคาบ/ย้ายบางวิชาให้ครูคนอื่น หรือปลดคาบไม่ว่าง</div></div>` : '');
  const bp = rulesBusy(), h = classHoles(bp).map(holeLabel);
  el('ruBusyNow').innerHTML = !bp.length ? '' : h.length
    ? `<div class="alert alert-warning py-2 mb-0">ตารางตอนนี้มี <b>${h.length}</b> ช่องที่นักเรียนว่างในคาบ ${bp.join(', ')}${list(h)}</div>`
    : `<div class="text-success"><i class="bi bi-check-circle"></i> ตารางตอนนี้นักเรียนไม่ว่างในคาบ ${bp.join(', ')}</div>`;
}
async function saveRules() {
  const n = +el('ruRun').value, bp = rulesBusy();
  try {
    await apiFetch(`/api/tt/terms/${T.term.id}`, { method: 'PUT', body: JSON.stringify({ config: { max_run: n, class_busy: bp } }) });
    if (n) T.term.config.max_run = n; else delete T.term.config.max_run;
    if (bp.length) T.term.config.class_busy = bp; else delete T.term.config.class_busy;
    edModal.hide(); renderEditor();
    const v = n ? runViolations(n).length : 0, h = classHoles().length;
    const msgs = [v ? `ครูสอนติดกันเกิน ${n} คาบ <b>${v}</b> จุด` : '', h ? `นักเรียนว่างในคาบ ${bp.join(', ')} <b>${h}</b> ช่อง` : ''].filter(Boolean);
    if (msgs.length) showModal('<i class="bi bi-sliders"></i> บันทึกกฎแล้ว', `<div class="alert alert-warning py-2">ตารางตอนนี้ยังผิดกฎ: ${msgs.join(' · ')} (ขึ้นในปุ่ม เตือน)</div>
      กด <b>จัดอัตโนมัติ → จัดใหม่ทั้งหมด</b> ระบบจะจัดให้ตามกฎ (ช่องที่ล็อก 🔒 อยู่ที่เดิม)`,
      `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ไว้ทีหลัง</button><button class="btn btn-primary btn-sm" onclick="openSolveModal()"><i class="bi bi-cpu"></i> จัดอัตโนมัติ</button>`);
    else toastEd('บันทึกกฎการจัดตารางแล้ว — ตารางตอนนี้ตรงตามกฎ');
  } catch (e) { alert(e.message); }
}

/* ── คาบของครูหลังเลิกเรียน (PLC) — ต่อท้ายคาบเรียน ขึ้นเฉพาะตารางครู ── */
function openStaffModal() {
  if (previewGuard()) return;
  const cfg = T.term.config, sp = cfg.periods.filter(x => x.teacher_only), reg = cfg.periods.filter(x => !x.teacher_only);
  const cur = T.lessons.find(l => (l.options || {}).staff);
  const mins = t => { const [h, m] = t.split(/[.:]/).map(Number); return h * 60 + m; };
  const len = sp.length ? mins(sp[0].end) - mins(sp[0].start) : 40;   // ค่าเริ่มต้นของโรงเรียน: คาบละ 40 นาที (15.10-16.30)
  const days = cur ? [...new Set(cur.slots.map(s => s[0]))] : DAYS.map((_, i) => i + 1);
  const tids = cur ? cur.teacher_ids : T.teachers.filter(t => t.active !== 0).map(t => t.id);
  const body = `
    <div class="small text-muted mb-2">เพิ่มคาบต่อจากคาบ ${reg.length} (เลิกเรียน ${esc(reg[reg.length - 1].end)} น.) <b>ขึ้นเฉพาะตารางสอนครู</b> ·
      ตารางเรียนนักเรียน จัดอัตโนมัติ และสอนแทน ไม่ใช้คาบเหล่านี้ · กล่องสรุปคาบในตารางครูแยกบรรทัดให้</div>
    <div class="row g-2">
      <div class="col-5"><label class="form-label small mb-0">ชื่อ</label><input id="spTitle" class="form-control form-control-sm" value="${esc(cfg.staff_label || 'PLC')}"></div>
      <div class="col-3"><label class="form-label small mb-0">จำนวนคาบ</label>
        <select id="spCount" class="form-select form-select-sm" onchange="spPreview()">${[1, 2, 3].map(n => `<option ${n === (sp.length || 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="col-4"><label class="form-label small mb-0">นาที/คาบ</label><input id="spMin" type="number" min="20" max="120" step="5" class="form-control form-control-sm" value="${len}" oninput="spPreview()"></div>
    </div>
    <div id="spTimes" class="small fw-bold text-primary mt-1"></div>
    <label class="form-label small mb-0 mt-2">วัน</label>
    <div>${DAYS.map((dn, i) => `<label class="me-3"><input type="checkbox" class="spDay" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''}> ${dn}</label>`).join('')}</div>
    <label class="form-label small mb-0 mt-2">ครูที่เข้าร่วม
      <a href="#" class="ms-2" onclick="document.querySelectorAll('.spT').forEach(x => x.checked = true); return false;">เลือกทุกคน</a>
      <a href="#" class="ms-2" onclick="document.querySelectorAll('.spT').forEach(x => x.checked = false); return false;">ไม่เลือก</a></label>
    <div>${T.teachers.map(t => `<label class="me-3"><input type="checkbox" class="spT" value="${t.id}" ${tids.includes(t.id) ? 'checked' : ''}> ${esc(t.name.split(' ')[0])}</label>`).join('')}</div>`;
  const foot = `${sp.length ? '<button class="btn btn-outline-danger btn-sm me-auto" onclick="saveStaff(true)"><i class="bi bi-trash"></i> เอาคาบหลังเลิกเรียนออก</button>' : ''}
    <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ยกเลิก</button>
    <button class="btn btn-primary btn-sm" onclick="saveStaff(false)"><i class="bi bi-save"></i> บันทึก</button>`;
  showModal('<i class="bi bi-people"></i> คาบของครูหลังเลิกเรียน (PLC)', body, foot);
  spPreview();
}
function spPreview() {
  const reg = T.term.config.periods.filter(x => !x.teacher_only), n = +el('spCount').value, m = +el('spMin').value || 0;
  const [h, mm] = reg[reg.length - 1].end.split(/[.:]/).map(Number), fmt = x => `${String(Math.floor(x / 60)).padStart(2, '0')}.${String(x % 60).padStart(2, '0')}`;
  el('spTimes').textContent = Array.from({ length: n }, (_, i) => { const s = h * 60 + mm + i * m; return `คาบ ${reg.length + i + 1} ${fmt(s)}-${fmt(s + m)} น.`; }).join(' · ');
}
async function saveStaff(remove) {
  const sp = T.term.config.periods.filter(x => x.teacher_only).length;
  if (remove && !confirm(`เอาคาบ ${T.term.config.periods.length - sp + 1}-${T.term.config.periods.length} ออกจากตารางครูทุกคน?`)) return;
  const b = remove ? { count: 0 } : {
    title: el('spTitle').value.trim(), count: +el('spCount').value, minutes: +el('spMin').value,
    days: [...document.querySelectorAll('.spDay:checked')].map(x => +x.value),
    teacher_ids: [...document.querySelectorAll('.spT:checked')].map(x => +x.value) };
  if (!remove && !b.days.length) { alert('เลือกวันอย่างน้อย 1 วัน'); return; }
  if (!remove && !b.teacher_ids.length) { alert('เลือกครูอย่างน้อย 1 คน'); return; }
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/staff-periods`, { method: 'POST', body: JSON.stringify(b) });
    edModal.hide();
    await loadTerm(T.term.id);
    toastEd(r.message);
  } catch (e) { alert(e.message); }
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
      ${T.is_admin ? '<button class="btn btn-outline-danger" onclick="deleteTerm()"><i class="bi bi-trash"></i> ลบภาคเรียนนี้ทั้งหมด</button>' : ''}
    </div>
    <div class="small text-muted mt-3">สร้างร่าง = วิชาเลื่อนรหัสตามโครงสร้างหลักสูตร ครู/ชั้น/สาย/เงื่อนไขเดิม · กิจกรรมทั้งโรงเรียนคงช่องเดิม (ล็อก) · แล้วกด "จัดอัตโนมัติ"</div>`;
  showModal('<i class="bi bi-gear"></i> ตั้งค่าภาคเรียน', body, '<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ปิด</button>');
}
async function setPublished(v) {
  try {
    await apiFetch(`/api/tt/terms/${T.term.id}`, { method: 'PUT', body: JSON.stringify({ published: v }) });
    T.term.published = v; edModal.hide(); renderEditor();
    const tt = TERMS.find(t => t.id === T.term.id); if (tt) tt.published = v;   // ให้การเลือกเทอมตามวันที่รู้ทันที
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
