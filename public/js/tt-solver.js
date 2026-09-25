/* ===== จัดตารางอัตโนมัติ — คำนวณในเบราว์เซอร์ของแอดมิน (ไม่กินโควตา CPU ของเซิร์ฟเวอร์) =====
   1) แตกวิชาเป็น "ช่วงเรียน" (คาบคู่ = ช่วงละ 2 คาบ)
   2) วางทีละช่วง เริ่มจากช่วงที่ยากสุด เลือกช่องคะแนนดีสุด (+ สุ่มนิด ๆ)
   3) ช่วงที่วางไม่ลง → ย้ายช่วงที่ขวาง 1-2 ช่วงไปที่อื่น (ซ่อม)
   4) ทำหลายรอบ เก็บผลที่วางได้ครบที่สุด / สายเรียนพร้อมกันมากสุด
   กฎตายตัว: ครูไม่สอนซ้อน, ห้อง/สายไม่ชน, ครูไม่ว่าง · กฎที่ตั้งได้: คาบคู่, ไม่ซ้ำวัน, เลี่ยงคาบ, สอนไม่เกินวันละ N */

function ttSolve(opts) {
  const mode = opts.mode || 'fresh';                  // fresh = จัดใหม่ (คงที่ล็อก) / fill = เติมเฉพาะที่ยังขาด
  const NP = nPeriods(), ND = DAYS.length, LA = lunchAfter(), NS = ND * NP;
  const sidx = (d, p) => (d - 1) * NP + (p - 1);
  const isSub = l => l.kind === 'subject';
  const sameDayOk = l => (l.options || {}).allow_same_day || !isSub(l);
  const avoidOf = l => (l.options || {}).avoid || [];
  const unav = {}, maxDay = {};
  T.teachers.forEach(t => {
    const c = t.constraints || {};
    unav[t.id] = new Set((c.unavailable || []).map(([d, p]) => sidx(d, p)));
    maxDay[t.id] = c.max_per_day || 99;
  });
  const classTracks = T.term.config.tracks || {};

  // ── เตรียม: ช่องคงที่ + ช่วงที่ต้องวาง ──
  const fixed = [], sessions = [], skipped = [];
  T.lessons.forEach(l => {
    if (l.per_week <= 0) return;
    const keep = l.slots.filter(s => s[2] || mode === 'fill');
    keep.forEach(s => fixed.push({ l, d: s[0], p: s[1] }));
    let need = l.per_week - keep.length;
    if (need <= 0) return;
    if (!l.teacher_ids.length && !l.classes.length) return;
    if (isSub(l) && !l.teacher_ids.length) { skipped.push({ l, n: need, why: 'ยังไม่กำหนดครู' }); return; }
    const dbl = (l.options || {}).double;
    while (need > 0) { const len = dbl && need >= 2 ? 2 : 1; sessions.push({ l, len }); need -= len; }
  });
  const fits = (d, p, len) => p + len - 1 <= NP && !(len === 2 && p === LA);

  // ── สถานะของรอบค้นหา ──
  function newState() {
    const st = { at: Array.from({ length: NS }, () => []), tBusy: {}, tDay: {}, dayUse: {}, fixedDay: {}, pos: new Map(), byLesson: new Map() };
    fixed.forEach(f => occupy(st, f.l, f.d, f.p, 1, null));
    return st;
  }
  const arr = (o, k, n) => (o[k] = o[k] || new Int16Array(n));
  function occupy(st, l, d, p, len, sess) {
    for (let q = p; q < p + len; q++) {
      const s = sidx(d, q);
      st.at[s].push({ l, sess });
      l.teacher_ids.forEach(t => { arr(st.tBusy, t, NS)[s]++; if (isSub(l)) arr(st.tDay, t, ND + 1)[d]++; });
    }
    arr(st.dayUse, l.id, ND + 1)[d] += len;
    if (!sess) arr(st.fixedDay, l.id, ND + 1)[d] += len;
    if (sess) { st.pos.set(sess, [d, p]); (st.byLesson.get(l.id) || st.byLesson.set(l.id, new Set()).get(l.id)).add(sess); }
  }
  function vacate(st, sess) {
    const [d, p] = st.pos.get(sess), l = sess.l;
    for (let q = p; q < p + sess.len; q++) {
      const s = sidx(d, q), a = st.at[s];
      a.splice(a.findIndex(e => e.sess === sess), 1);
      l.teacher_ids.forEach(t => { st.tBusy[t][s]--; if (isSub(l)) st.tDay[t][d]--; });
    }
    st.dayUse[l.id][d] -= sess.len;
    st.pos.delete(sess);
    st.byLesson.get(l.id).delete(sess);
  }
  // วางได้ไหม (relax = ข้ามกฎที่ตั้งได้ ใช้ตอนสุดท้ายถ้าวางไม่ลงจริง ๆ)
  function canPlace(st, l, d, p, len, relax) {
    if (!fits(d, p, len)) return false;
    for (let q = p; q < p + len; q++) {
      const s = sidx(d, q);
      for (const t of l.teacher_ids) if ((st.tBusy[t] && st.tBusy[t][s]) || unav[t].has(s)) return false;
      for (const e of st.at[s]) if (e.l.classes.some(c => l.classes.includes(c)) && classOverlap(l, e.l)) return false;
      if (!relax && avoidOf(l).includes(q)) return false;
    }
    if (!relax && !sameDayOk(l) && st.dayUse[l.id] && st.dayUse[l.id][d] > 0) return false;
    if (!relax && isSub(l)) for (const t of l.teacher_ids) if (((st.tDay[t] && st.tDay[t][d]) || 0) + len > maxDay[t]) return false;
    return true;
  }
  // คะแนนตำแหน่ง (มาก = ดี)
  function score(st, l, d, p, len) {
    let sc = Math.random() * 0.8;
    const tr = tracksOf(l);
    for (let q = p; q < p + len; q++) {
      const s = sidx(d, q);
      if (tr.length) sc += st.at[s].some(e => e.l.classes.some(c => l.classes.includes(c))) ? 3 : 0;   // เรียนพร้อมกับสายอื่น
    }
    l.teacher_ids.forEach(t => { sc -= 0.5 * ((st.tDay[t] && st.tDay[t][d]) || 0); });              // กระจายภาระครู
    if (st.dayUse[l.id]) for (let dd = 1; dd <= ND; dd++) if (st.dayUse[l.id][dd] && Math.abs(dd - d) === 1) sc -= 0.6; // เว้นวัน
    if (len === 2 && p <= LA) sc += 0.3;                                                               // คาบคู่ชอบช่วงเช้า
    return sc;
  }
  function placeBest(st, sess, relax) {
    let best = null, bs = -1e9;
    for (let d = 1; d <= ND; d++) for (let p = 1; p <= NP; p++) {
      if (!canPlace(st, sess.l, d, p, sess.len, relax)) continue;
      const sc = score(st, sess.l, d, p, sess.len);
      if (sc > bs) { bs = sc; best = [d, p]; }
    }
    if (!best) return false;
    occupy(st, sess.l, best[0], best[1], sess.len, sess);
    return true;
  }
  // ช่วงที่ขวางตำแหน่ง (null = ขวางด้วยของคงที่/ครูไม่ว่าง แก้ไม่ได้)
  function blockers(st, S, d, p) {
    const l = S.l;
    if (!fits(d, p, S.len)) return null;
    const set = new Set();
    for (let q = p; q < p + S.len; q++) {
      const s = sidx(d, q);
      if (l.teacher_ids.some(t => unav[t].has(s)) || avoidOf(l).includes(q)) return null;
      for (const e of st.at[s]) {
        const hit = e.l.teacher_ids.some(t => l.teacher_ids.includes(t)) || (e.l.classes.some(c => l.classes.includes(c)) && classOverlap(l, e.l));
        if (hit) { if (!e.sess) return null; set.add(e.sess); }
      }
    }
    if (!sameDayOk(l)) {
      if (st.fixedDay[l.id] && st.fixedDay[l.id][d]) return null;
      for (const x of (st.byLesson.get(l.id) || [])) if (x !== S && st.pos.get(x)[0] === d) set.add(x);
    }
    return [...set];
  }
  function repair(st, iters) {
    for (let it = 0; it < iters; it++) {
      const un = sessions.filter(s => !st.pos.has(s));
      if (!un.length) return;
      const S = un[Math.floor(Math.random() * un.length)];
      const cands = [];
      for (let d = 1; d <= ND; d++) for (let p = 1; p <= NP; p++) {
        const b = blockers(st, S, d, p);
        if (b && b.length <= 2) cands.push({ d, p, b, k: b.length + Math.random() * 1.5 });
      }
      cands.sort((a, b) => a.k - b.k);
      for (const c of cands.slice(0, 5)) {
        const saved = c.b.map(x => [x, st.pos.get(x)]);
        saved.forEach(([x]) => vacate(st, x));
        if (!canPlace(st, S.l, c.d, c.p, S.len)) { saved.forEach(([x, pos]) => occupy(st, x.l, pos[0], pos[1], x.len, x)); continue; }
        occupy(st, S.l, c.d, c.p, S.len, S);
        const failed = saved.filter(([x]) => !placeBest(st, x));
        if (failed.length === 0 || (failed.length === 1 && Math.random() < 0.35)) break;   // สำเร็จ / เดินข้าง (หนีทางตัน)
        // ย้อนกลับ
        vacate(st, S);
        saved.forEach(([x]) => { if (st.pos.has(x)) vacate(st, x); });
        saved.forEach(([x, pos]) => occupy(st, x.l, pos[0], pos[1], x.len, x));
      }
    }
  }
  // คุณภาพผลลัพธ์: คาบที่ขาด (หลัก) + ช่องที่บางสายเรียนแต่สายอื่นว่าง + วิชาเดียวกันวันติดกัน
  function evaluate(st) {
    const unplaced = sessions.filter(s => !st.pos.has(s)).reduce((a, s) => a + s.len, 0);
    let mis = 0;
    Object.entries(classTracks).forEach(([cls, trs]) => {
      if (trs.length < 2) return;
      for (let s = 0; s < NS; s++) {
        const here = st.at[s].filter(e => e.l.classes.includes(cls));
        if (!here.length) continue;
        const cov = new Set();
        here.forEach(e => { const t = tracksOf(e.l); (t.length ? t : trs).forEach(x => cov.add(x)); });
        if (trs.some(t => !cov.has(t))) mis++;
      }
    });
    return { unplaced, misaligned: mis, score: -unplaced * 100 - mis * 3 };
  }

  return {
    sessions, skipped, fixed,
    async run(restarts, onProgress) {
      let best = null;
      const base = sessions.map(s => ({ s, k: s.len * 3 + s.l.classes.length * 2 + s.l.teacher_ids.length + (tracksOf(s.l).length ? 4 : 0)
        + s.l.teacher_ids.reduce((a, t) => a + unav[t].size / 5, 0) + avoidOf(s.l).length }));
      let lastYield = performance.now();
      for (let r = 0; r < restarts; r++) {
        const st = newState();
        base.map(x => ({ s: x.s, k: x.k + Math.random() * 3 })).sort((a, b) => b.k - a.k).forEach(x => placeBest(st, x.s));
        repair(st, 300);
        const ev = evaluate(st);
        if (!best || ev.score > best.ev.score) best = { ev, pos: new Map(st.pos), st };
        if (onProgress) onProgress(r + 1, restarts, best.ev);
        if (performance.now() - lastYield > 30) { await yieldUI(); lastYield = performance.now(); }
        if (best.ev.unplaced === 0 && best.ev.misaligned === 0) break;
      }
      // ช่วงที่ยังเหลือ: ลองวางแบบผ่อนกฎที่ตั้งได้ (ไม่ผ่อนครูซ้อน/ห้องชน/ครูไม่ว่าง)
      const relaxed = [];
      sessions.filter(s => !best.st.pos.has(s)).forEach(s => { if (placeBest(best.st, s, true)) relaxed.push(s); });
      const left = sessions.filter(s => !best.st.pos.has(s));
      return { ev: evaluate(best.st), st: best.st, relaxed, left };
    },
  };
}

// พักให้หน้าจอวาดแถบความคืบหน้า — ใช้ MessageChannel แทน setTimeout (แท็บเบื้องหลังถูกหน่วง setTimeout เป็นรอบละ 1 วินาที)
const yieldUI = () => new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });

/* ═════════════ หน้าต่างจัดอัตโนมัติ ═════════════ */
let SOLVED = null;     // ผลที่ยังไม่บันทึก
function openSolveModal() {
  if (previewGuard()) return;
  const nLocked = T.lessons.reduce((a, l) => a + l.slots.filter(s => s[2]).length, 0);
  const body = `
    <div class="mb-2"><b>ภาคเรียน ${esc(T.term.name)}</b> · ${T.lessons.length} รายการ · ล็อกไว้ ${nLocked} ช่อง</div>
    <label class="d-block"><input type="radio" name="svMode" value="fresh" checked> จัดใหม่ทั้งหมด <span class="text-muted small">(คงช่องที่ล็อก 🔒 ไว้)</span></label>
    <label class="d-block mb-2"><input type="radio" name="svMode" value="fill"> วางเฉพาะคาบที่ยังไม่ได้วาง <span class="text-muted small">(ของเดิมอยู่ที่เดิม)</span></label>
    <label class="form-label small mb-0">ความละเอียดการค้นหา</label>
    <select id="svRounds" class="form-select form-select-sm w-auto mb-2"><option value="40">ปกติ (40 รอบ)</option><option value="150">ละเอียด (150 รอบ)</option></select>
    <div class="small text-muted">กฎที่ใช้: ครูไม่สอนซ้อน · ห้อง/สายไม่ชน · ครูไม่ว่าง · คาบคู่ · วิชาไม่ซ้ำวัน · เลี่ยงคาบ · ครูสอนไม่เกินวันละ N คาบ · พยายามให้วิชาต่างสายเรียนพร้อมกัน</div>
    <div class="progress mt-3" style="height:20px;display:none" id="svProg"><div class="progress-bar progress-bar-striped progress-bar-animated" style="width:0%"></div></div>
    <div id="svResult" class="mt-2"></div>`;
  showModal('<i class="bi bi-cpu"></i> จัดตารางอัตโนมัติ', body,
    `<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">ปิด</button><button class="btn btn-primary btn-sm" id="svGo" onclick="runSolve()"><i class="bi bi-play-fill"></i> เริ่มจัด</button>`);
}

async function runSolve() {
  const mode = document.querySelector('input[name=svMode]:checked').value, rounds = +el('svRounds').value;
  el('edModalFoot').querySelectorAll('button').forEach(b => { b.disabled = true; });   // กันกดซ้ำ (รวม "จัดใหม่อีกรอบ")
  el('svProg').style.display = '';
  const bar = el('svProg').firstElementChild;
  bar.classList.add('progress-bar-animated');
  const solver = ttSolve({ mode });
  const need = solver.sessions.reduce((a, s) => a + s.len, 0);
  const t0 = performance.now();
  const res = await solver.run(rounds, (r, n, ev) => { bar.style.width = (r / n * 100) + '%'; bar.textContent = `รอบ ${r}/${n} · ขาด ${ev.unplaced} คาบ`; });
  bar.style.width = '100%'; bar.classList.remove('progress-bar-animated');
  // แปลงผลเป็นช่องของแต่ละรายการ (ช่องคงที่ + ที่เพิ่งวาง)
  const newSlots = new Map(T.lessons.map(l => [l.id, solver.fixed.filter(f => f.l === l).map(f => [f.d, f.p, (l.slots.find(s => s[0] === f.d && s[1] === f.p) || [])[2] || 0])]));
  res.st.pos.forEach(([d, p], sess) => { for (let q = p; q < p + sess.len; q++) newSlots.get(sess.l.id).push([d, q, 0]); });
  SOLVED = { newSlots, res, mode };
  const left = res.left.reduce((a, s) => a + s.len, 0), placed = need - left;
  const lines = [
    `<div class="alert ${left ? 'alert-warning' : 'alert-success'} py-2 mb-2">วางได้ <b>${placed}/${need}</b> คาบ ${left ? `· ยังวางไม่ได้ <b>${left}</b> คาบ` : '✓ ครบ'} · ใช้เวลา ${((performance.now() - t0) / 1000).toFixed(1)} วินาที</div>`,
    res.relaxed.length ? `<div class="small mb-1">⚠ ผ่อนกฎที่ตั้งไว้ (ซ้ำวัน/เลี่ยงคาบ/เกินวันละ N) เพื่อวาง ${res.relaxed.length} ช่วง: ${res.relaxed.map(s => esc(lessonName(s.l) + ' ' + classLabel(s.l))).join(', ')}</div>` : '',
    res.left.length ? `<div class="small mb-1 text-danger">✖ วางไม่ได้ (ครูหรือห้องไม่มีช่องว่างตรงกัน): ${res.left.map(s => esc(lessonName(s.l) + ' ' + classLabel(s.l) + ' (' + s.l.teacher_ids.map(teacherShort).join(',') + ')')).join(', ')}</div>` : '',
    solver.skipped.length ? `<div class="small mb-1">⏭ ข้าม (ยังไม่กำหนดครู): ${solver.skipped.map(x => esc(lessonName(x.l) + ' ' + classLabel(x.l))).join(', ')}</div>` : '',
    `<div class="small text-muted">สายที่ต้องมีคาบว่างเพราะสายอื่นเรียน: ${res.ev.misaligned} ช่อง</div>`,
  ];
  el('svResult').innerHTML = lines.join('');
  el('edModalFoot').innerHTML = `<button class="btn btn-outline-secondary btn-sm me-auto" onclick="runSolve()"><i class="bi bi-arrow-repeat"></i> จัดใหม่อีกรอบ</button>
    <button class="btn btn-outline-primary btn-sm" onclick="previewSolved()"><i class="bi bi-eye"></i> ดูผลในตาราง</button>
    <button class="btn btn-success btn-sm" onclick="saveSolved()"><i class="bi bi-save"></i> บันทึกผลนี้</button>`;
}

// ดูผลในตาราง (ยังไม่บันทึก) — แถบ "บันทึก/ยกเลิก" วาดใน renderEditor ทุกครั้ง (เปลี่ยนห้อง/ครูก็ยังอยู่)
// ระหว่างนี้ห้ามแก้ตาราง (previewGuard) ไม่งั้นข้อมูลในเครื่องกับเซิร์ฟเวอร์ไม่ตรงกัน
function previewSolved() {
  if (!SOLVED) return;
  T.lessons.forEach(l => { l._orig = l._orig || l.slots; l.slots = SOLVED.newSlots.get(l.id); });
  ED.preview = true; ED.picked = null;
  buildIndex(); edModal.hide(); renderEditor();
}
function discardSolved() {
  T.lessons.forEach(l => { if (l._orig) { l.slots = l._orig; delete l._orig; } });
  SOLVED = null; ED.preview = false; buildIndex();
  if (view.mode === 'edit') renderEditor();
}
window.addEventListener('beforeunload', e => { if (ED.preview) { e.preventDefault(); e.returnValue = ''; } });
async function saveSolved() {
  if (!SOLVED) return;
  if (!confirm('บันทึกผลจัดอัตโนมัติลงตาราง? (ช่องที่ไม่ได้ล็อกเดิมจะถูกแทนที่)')) return;
  const lessons = {};
  SOLVED.newSlots.forEach((slots, lid) => { lessons[lid] = slots.filter(s => !s[2]).map(s => [s[0], s[1]]); });
  try {
    const r = await apiFetch(`/api/tt/terms/${T.term.id}/slots-bulk`, { method: 'POST', body: JSON.stringify({ lessons }) });
    SOLVED = null; ED.preview = false; if (edModal) edModal.hide();
    await loadTerm(T.term.id);                                  // loadTerm ล้างประวัติ "ย้อนกลับ" ด้วย
    toastEd(`บันทึกแล้ว ${r.placed} ช่อง`);
  } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
}
