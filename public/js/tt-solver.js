/* ===== จัดตารางอัตโนมัติ — คำนวณในเบราว์เซอร์ของแอดมิน (ไม่กินโควตา CPU ของเซิร์ฟเวอร์) =====
   1) แตกวิชาเป็น "ช่วงเรียน" (คาบคู่ = ช่วงละ 2 คาบ)
   2) วางทีละช่วง เริ่มจากช่วงที่ยากสุด เลือกช่องคะแนนดีสุด (+ สุ่มนิด ๆ)
   3) ช่วงที่วางไม่ลง → ย้ายช่วงที่ขวาง 1-2 ช่วงไปที่อื่น (ซ่อม)
   4) ทำหลายรอบ เก็บผลที่วางได้ครบที่สุด / สายเรียนพร้อมกันมากสุด
   กฎตายตัว: ครูไม่สอนซ้อน, ห้อง/สายไม่ชน, ครูไม่ว่าง · กฎที่ตั้งได้: คาบคู่, ไม่ซ้ำวัน, เลี่ยงคาบ, สอนไม่เกินวันละ N, สอนติดกันไม่เกิน N
   เป้าหมาย: นักเรียนไม่ว่างในคาบที่กำหนด (เช่น คาบแรก) · วิชาต่างสายเรียนพร้อมกัน */

function ttSolve(opts) {
  const mode = opts.mode || 'fresh';                  // fresh = จัดใหม่ (คงที่ล็อก) / fill = เติมเฉพาะที่ยังขาด
  const NP = nPeriods(), ND = DAYS.length, LA = lunchAfter(), NS = ND * NP;
  const sidx = (d, p) => (d - 1) * NP + (p - 1);
  const isSub = l => l.kind === 'subject';
  // ครูไม่สอนคาบคู่ → ทีละคาบ และไม่ให้วิชาเดียวกันอยู่วันเดียวกัน (กันวางติดกันเป็นคาบคู่โดยปริยาย)
  const sameDayOk = l => !isSub(l) || ((l.options || {}).allow_same_day && !noDoubleTeacher(l));
  const avoidOf = l => (l.options || {}).avoid || [];
  const unav = {}, maxDay = {}, maxRun = {};
  T.teachers.forEach(t => {
    const c = t.constraints || {};
    unav[t.id] = new Set((c.unavailable || []).map(([d, p]) => sidx(d, p)));
    maxDay[t.id] = c.max_per_day || 99;
    maxRun[t.id] = effectiveMaxRun(t.id) || 99;        // คาบสอนรวมเกินที่กฎรองรับ → ผ่อนเฉพาะครูคนนั้น
  });
  // ครูขอคาบว่างติดกัน 2 คาบทุกวัน: pairAllow = จำนวนวันที่ยอมให้ไม่มีคู่ว่าง (0 = ต้องได้ทุกวัน · คาบมากเกิน → ยอมเท่าที่จำเป็น)
  const pairAllow = {};
  T.teachers.forEach(t => { if (wantsFreePair(t.id)) pairAllow[t.id] = ND - freePairMaxDays(t.id); });
  const pairList = Object.keys(pairAllow).map(Number);
  const pairT = Object.fromEntries(pairList.map(t => [t, pairAllow[t] ? 'soft' : 'hard']));
  const runRaised = T.teachers.filter(t => maxRunOf(t.id) && maxRun[t.id] > maxRunOf(t.id))
    .map(t => ({ t, from: maxRunOf(t.id), to: maxRun[t.id], load: teachLoad(t.id) }));
  const classTracks = T.term.config.tracks || {};
  // นักเรียนไม่ว่างคาบ … (config.class_busy): ทุกสายหลักของห้องต้องมีเรียนในคาบนั้น
  const REQ = new Set(classBusyPeriods()), rootsCache = {};
  const rootsOf = c => (rootsCache[c] = rootsCache[c] || classRoots(c));
  const hereOf = (st, c, s) => st.at[s].filter(e => e.l.classes.includes(c)).map(e => e.l);

  // วิชาของนักเรียนวางได้ถึงคาบสุดท้ายของนักเรียน (คาบของครูหลังเลิกเรียน เช่น PLC ไม่ใช้)
  const NPS = T.term.config.periods.filter(x => !x.teacher_only).length || NP;
  // ── เตรียม: ช่องคงที่ + ช่วงที่ต้องวาง ──
  const fixed = [], sessions = [], skipped = [];
  T.lessons.forEach(l => {
    if (l.per_week <= 0 || isSupervise(l)) return;      // ครูดูแลซ่อมเสริม: จัดทีหลังจากคาบว่างที่เหลือ (ไม่ขวางการจัด)
    const keep = l.slots.filter(s => s[2] || mode === 'fill');
    keep.forEach(s => fixed.push({ l, d: s[0], p: s[1] }));
    let need = l.per_week - keep.length;
    if (need <= 0) return;
    if (!l.teacher_ids.length && !l.classes.length) return;
    if (isSub(l) && !l.teacher_ids.length) { skipped.push({ l, n: need, why: 'ยังไม่กำหนดครู' }); return; }
    const dbl = wantsDouble(l);
    // คาบคู่ที่ล็อกไว้ช่องเดียว → อีกคาบต้องอยู่ติดกันวันเดียวกัน (anchor) ไม่งั้นคู่แตก
    if (dbl && mode !== 'fill') {
      const lk = new Set(keep.map(s => `${s[0]}-${s[1]}`));
      keep.forEach(([d, p]) => {
        if (need <= 0 || [p - 1, p + 1].some(q => lk.has(`${d}-${q}`) && Math.min(p, q) !== LA)) return;
        const ps = [p - 1, p + 1].filter(q => q >= 1 && q <= NPS && Math.min(p, q) !== LA && !lk.has(`${d}-${q}`));
        if (ps.length) { sessions.push({ l, len: 1, anchor: { d, ps } }); need--; }
      });
    }
    while (need > 0) { const len = dbl && need >= 2 ? 2 : 1; sessions.push({ l, len }); need -= len; }
  });
  const fits = (l, d, p, len) => p + len - 1 <= (l.classes.length ? NPS : NP) && !(len === 2 && p === LA);
  // สอนติดกัน: นับคาบที่ครูอยู่กับนักเรียน (tTeach) ต่อจากช่วงที่จะวาง ทั้งซ้าย-ขวา ภายในช่วงเช้า/บ่าย
  function runAround(st, t, d, p, len) {
    const tt = st.tTeach[t], [a, b] = p <= LA ? [1, LA] : [LA + 1, NPS];
    let L = 0, R = 0;
    if (tt) {
      for (let q = p - 1; q >= a && tt[sidx(d, q)]; q--) L++;
      for (let q = p + len; q <= b && tt[sidx(d, q)]; q++) R++;
    }
    return [L, R];
  }
  // วาง l ที่ (d,p) ช่วยคาบที่นักเรียนห้ามว่างแค่ไหน: เติมจนครบทุกสาย +1 · ต่อเติมช่องที่มีบางสายแล้ว +0.5
  // · เริ่มช่องว่างด้วยวิชาเฉพาะสาย (สายอื่นยังว่าง) −0.6 → คาบแรกควรเป็นวิชาทั้งห้อง หรือวิชาเลือกที่เรียนพร้อมกันครบทุกสาย
  function holeGain(st, l, d, p, len) {
    if (!REQ.size || !l.classes.length) return 0;
    let g = 0;
    for (let q = p; q < p + len; q++) {
      if (!REQ.has(q)) continue;
      for (const c of l.classes) {
        const roots = rootsOf(c), here = hereOf(st, c, sidx(d, q));
        const before = missingRoots(c, here, roots).length;
        if (!before) continue;
        const after = missingRoots(c, [...here, l], roots).length;
        g += !after ? 1 : after < before ? (here.length ? 0.5 : -0.6) : 0;
      }
    }
    return g;
  }
  // วันนั้นครู t ยังมีคู่คาบว่างติดกันไหม หลังเพิ่มช่วง adds [[p,len]] และเอาช่วง rem [p,len] ออก
  function pairOK(st, t, d, adds, rem) {
    const tb = st.tBusy[t];
    const busy = q => adds.some(([a, n]) => q >= a && q < a + n) || (!(rem && q >= rem[0] && q < rem[0] + rem[1]) && !!(tb && tb[sidx(d, q)]));
    for (let q = 1; q < NPS; q++) if (!busy(q) && !busy(q + 1)) return true;
    return false;
  }
  const killsPair = (st, t, d, p, len) => pairOK(st, t, d, []) && !pairOK(st, t, d, [[p, len]]);
  const missDays = (st, t) => { let n = 0; for (let d = 1; d <= ND; d++) if (!pairOK(st, t, d, [])) n++; return n; };
  // ครูที่ทำได้ทุกวัน: ห้ามวางจนวันนั้นไม่เหลือคู่ว่าง · ครูที่คาบมากเกิน: ไม่ห้าม แต่หักคะแนน (ดู score)
  const pairBlocked = (st, t, d, p, len) => pairAllow[t] === 0 && killsPair(st, t, d, p, len);
  const runOk = (st, l, d, p, len) => !teachesStudents(l) || l.teacher_ids.every(t => {
    if (maxRun[t] >= 99) return true;
    const [L, R] = runAround(st, t, d, p, len);
    return L + len + R <= maxRun[t];
  });

  // ── สถานะของรอบค้นหา ──
  function newState() {
    const st = { at: Array.from({ length: NS }, () => []), tBusy: {}, tTeach: {}, tDay: {}, dayUse: {}, fixedDay: {}, pos: new Map(), byLesson: new Map() };
    fixed.forEach(f => occupy(st, f.l, f.d, f.p, 1, null));
    return st;
  }
  const arr = (o, k, n) => (o[k] = o[k] || new Int16Array(n));
  function occupy(st, l, d, p, len, sess) {
    for (let q = p; q < p + len; q++) {
      const s = sidx(d, q);
      st.at[s].push({ l, sess });
      l.teacher_ids.forEach(t => { arr(st.tBusy, t, NS)[s]++; if (isSub(l)) arr(st.tDay, t, ND + 1)[d]++; if (teachesStudents(l)) arr(st.tTeach, t, NS)[s]++; });
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
      l.teacher_ids.forEach(t => { st.tBusy[t][s]--; if (isSub(l)) st.tDay[t][d]--; if (teachesStudents(l)) st.tTeach[t][s]--; });
    }
    st.dayUse[l.id][d] -= sess.len;
    st.pos.delete(sess);
    st.byLesson.get(l.id).delete(sess);
  }
  // วางได้ไหม (relax = ข้ามกฎที่ตั้งได้ ใช้ตอนสุดท้ายถ้าวางไม่ลงจริง ๆ)
  function canPlace(st, l, d, p, len, relax, sess) {
    if (!fits(l, d, p, len)) return false;
    if (sess && sess.anchor && !relax && (d !== sess.anchor.d || !sess.anchor.ps.includes(p))) return false;   // ครบคู่กับช่องที่ล็อก
    for (let q = p; q < p + len; q++) {
      const s = sidx(d, q);
      for (const t of l.teacher_ids) if ((st.tBusy[t] && st.tBusy[t][s]) || unav[t].has(s)) return false;
      for (const e of st.at[s]) if (e.l.classes.some(c => l.classes.includes(c)) && classOverlap(l, e.l)) return false;
      if (!relax && avoidOf(l).includes(q)) return false;
    }
    if (!relax && !(sess && sess.anchor) && !sameDayOk(l) && st.dayUse[l.id] && st.dayUse[l.id][d] > 0) return false;
    if (!relax && isSub(l)) for (const t of l.teacher_ids) if (((st.tDay[t] && st.tDay[t][d]) || 0) + len > maxDay[t]) return false;
    if (!relax && !runOk(st, l, d, p, len)) return false;
    if (!relax) for (const t of l.teacher_ids) if (pairBlocked(st, t, d, p, len)) return false;
    return true;
  }
  // คะแนนตำแหน่ง (มาก = ดี)
  function score(st, l, d, p, len) {
    let sc = Math.random() * 0.8;
    const tr = tracksOf(l);
    for (let q = p; q < p + len; q++) {
      const s = sidx(d, q);
      if (tr.length) sc += st.at[s].some(e => e.l.classes.some(c => l.classes.includes(c))) ? 5 : 0;   // เรียนพร้อมกับสายอื่น
    }
    l.teacher_ids.forEach(t => { sc -= 0.5 * ((st.tDay[t] && st.tDay[t][d]) || 0); });              // กระจายภาระครู
    if (st.dayUse[l.id]) for (let dd = 1; dd <= ND; dd++) if (st.dayUse[l.id][dd] && Math.abs(dd - d) === 1) sc -= 0.6; // เว้นวัน
    if (len === 2 && p <= LA) sc += 0.3;                                                               // คาบคู่ชอบช่วงเช้า
    sc += 5 * holeGain(st, l, d, p, len);                                                              // เติมคาบที่นักเรียนห้ามว่าง
    for (const t of l.teacher_ids) if (pairT[t] === 'soft' && killsPair(st, t, d, p, len))            // ครูขอคาบว่างติดกัน (ทำไม่ได้ครบ)
      sc -= missDays(st, t) < pairAllow[t] ? 1 : 6;                                                    // ใช้โควตาวันที่ยอมได้ก่อน เกินแล้วหักหนัก
    if (teachesStudents(l)) for (const x of runRaised) if (l.teacher_ids.includes(x.t.id)) {            // ครูที่ผ่อนกฎ: เกินกฎเดิมให้น้อยวันที่สุด
      const [L, R] = runAround(st, x.t.id, d, p, len);
      if (L + len + R > x.from) sc -= 1.5;
    }
    return sc;
  }
  function placeBest(st, sess, relax) {
    let best = null, bs = -1e9;
    for (let d = 1; d <= ND; d++) for (let p = 1; p <= NP; p++) {
      if (!canPlace(st, sess.l, d, p, sess.len, relax, sess)) continue;
      const sc = score(st, sess.l, d, p, sess.len);
      if (sc > bs) { bs = sc; best = [d, p]; }
    }
    if (!best) return false;
    occupy(st, sess.l, best[0], best[1], sess.len, sess);
    return true;
  }
  // ช่วงที่ขวางตำแหน่ง (null = ขวางด้วยของคงที่/ครูไม่ว่าง แก้ไม่ได้)
  function blockers(st, S, d, p, relax) {
    const l = S.l;
    if (!fits(l, d, p, S.len)) return null;
    if (S.anchor && !relax && (d !== S.anchor.d || !S.anchor.ps.includes(p))) return null;
    const set = new Set();
    for (let q = p; q < p + S.len; q++) {
      const s = sidx(d, q);
      if (l.teacher_ids.some(t => unav[t].has(s)) || (!relax && avoidOf(l).includes(q))) return null;
      for (const e of st.at[s]) {
        const hit = e.l.teacher_ids.some(t => l.teacher_ids.includes(t)) || (e.l.classes.some(c => l.classes.includes(c)) && classOverlap(l, e.l));
        if (hit) { if (!e.sess) return null; set.add(e.sess); }
      }
    }
    if (relax) return [...set];                   // ผ่อนกฎที่ตั้งได้: เหลือแค่ครูซ้อน/ห้องชน/ครูไม่ว่าง
    if (!sameDayOk(l) && !S.anchor) {
      if (st.fixedDay[l.id] && st.fixedDay[l.id][d]) return null;
      for (const x of (st.byLesson.get(l.id) || [])) if (x !== S && st.pos.get(x)[0] === d) set.add(x);
    }
    // สอนติดกันเกินกฎ → ย้ายช่วงที่อยู่ติดกันของครูคนนั้นออก (ข้างเดียวถ้าพอ ไม่งั้นทั้งสองข้าง)
    if (teachesStudents(l)) for (const t of l.teacher_ids) {
      const mx = maxRun[t];
      if (mx >= 99) continue;
      const [L, R] = runAround(st, t, d, p, S.len);
      if (L + S.len + R <= mx) continue;
      const nb = q => st.at[sidx(d, q)].find(e => teachesStudents(e.l) && e.l.teacher_ids.includes(t));
      const left = L ? nb(p - 1) : null, right = R ? nb(p + S.len) : null;
      if (left && left.sess && S.len + R <= mx) set.add(left.sess);
      else if (right && right.sess && L + S.len <= mx) set.add(right.sess);
      else if ((!L || (left && left.sess)) && (!R || (right && right.sess))) { if (left) set.add(left.sess); if (right) set.add(right.sess); }
      else return null;
    }
    // ครูขอคาบว่างติดกัน: วางแล้ววันนั้นไม่เหลือคู่ว่าง → ย้ายช่วงอื่นของครูคนนั้นในวันนั้นออก 1 ช่วง
    for (const t of l.teacher_ids) {
      if (!pairBlocked(st, t, d, p, S.len)) continue;
      const mine = new Set();
      for (let q = 1; q <= NPS; q++) st.at[sidx(d, q)].forEach(e => { if (e.sess && e.l.teacher_ids.includes(t)) mine.add(e.sess); });
      const x = [...mine].find(X => { const [, xp] = st.pos.get(X); return pairOK(st, t, d, [[p, S.len]], [xp, X.len]); });
      if (!x) return null;
      set.add(x);
    }
    return [...set];
  }
  function repair(st, iters, relax) {
    for (let it = 0; it < iters; it++) {
      const un = sessions.filter(s => !st.pos.has(s));
      if (!un.length) return;
      const S = un[Math.floor(Math.random() * un.length)];
      const cands = [];
      for (let d = 1; d <= ND; d++) for (let p = 1; p <= NP; p++) {
        const b = blockers(st, S, d, p, relax);
        if (b && b.length <= 2) cands.push({ d, p, b, k: b.length + Math.random() * 1.5 });
      }
      cands.sort((a, b) => a.k - b.k);
      for (const c of cands.slice(0, 5)) {
        const saved = c.b.map(x => [x, st.pos.get(x)]);
        saved.forEach(([x]) => vacate(st, x));
        if (!canPlace(st, S.l, c.d, c.p, S.len, relax, S)) { saved.forEach(([x, pos]) => occupy(st, x.l, pos[0], pos[1], x.len, x)); continue; }
        occupy(st, S.l, c.d, c.p, S.len, S);
        const failed = saved.filter(([x]) => !placeBest(st, x) && !(relax && placeBest(st, x, true)));
        if (failed.length === 0 || (failed.length === 1 && Math.random() < 0.35)) break;   // สำเร็จ / เดินข้าง (หนีทางตัน)
        // ย้อนกลับ
        vacate(st, S);
        saved.forEach(([x]) => { if (st.pos.has(x)) vacate(st, x); });
        saved.forEach(([x, pos]) => occupy(st, x.l, pos[0], pos[1], x.len, x));
      }
    }
  }
  // ช่องที่นักเรียนห้ามว่างแต่ยังว่าง → ลองย้ายวิชาของห้องนั้นจากที่อื่นมาลง (ที่เดิมต้องไม่กลายเป็นช่องว่างต้องห้าม)
  const isHole = (st, c, d, q) => missingRoots(c, hereOf(st, c, sidx(d, q)), rootsOf(c)).length > 0;
  // ย้ายช่วง S ไป (d,p1) ได้ไหม โดยที่เดิมของ S ไม่กลายเป็นช่องว่างต้องห้าม (ทำแล้วถ้าไม่ได้ คืนที่เดิม)
  function tryMove(st, S, d, p1) {
    const [d0, p0] = st.pos.get(S);
    vacate(st, S);
    let ok = p1 >= 1 && canPlace(st, S.l, d, p1, S.len, false, S);
    for (let r = p0; ok && r < p0 + S.len; r++) if (REQ.has(r) && S.l.classes.some(c2 => isHole(st, c2, d0, r))) ok = false;
    occupy(st, S.l, ok ? d : d0, ok ? p1 : p0, S.len, S);
    return ok;
  }
  // ช่องที่นักเรียนห้ามว่างแต่ยังว่าง → (1) ย้ายวิชาของห้องนั้นจากที่อื่นมาเติม (2) ช่องที่มีแค่บางสาย: สลับกับวิชาทั้งห้อง
  function fillHoles(st) {
    if (!REQ.size) return;
    for (const c of IDX.classes) for (let d = 1; d <= ND; d++) for (const q of REQ) {
      if (q > NPS || !isHole(st, c, d, q)) continue;
      const mine = [...st.pos.keys()].filter(S => S.l.classes.includes(c)).sort(() => Math.random() - 0.5);
      for (const S of mine) {
        const [d0, p0] = st.pos.get(S);
        if (d0 === d && p0 <= q && q < p0 + S.len) continue;
        const p1 = (S.len === 2 ? [q, q - 1] : [q]).find(x => x >= 1 && holeGain(st, S.l, d, x, S.len) > 0.9 && tryMove(st, S, d, x));
        if (p1) break;
      }
      if (!isHole(st, c, d, q)) continue;
      // มีวิชาเฉพาะสายอยู่ในช่องนี้ (สายอื่นว่าง) → ย้ายวิชาเหล่านั้นไปที่ของวิชาทั้งห้องคาบเดี่ยว แล้วเอาวิชาทั้งห้องมาลงแทน
      const occ = st.at[sidx(d, q)].filter(e => e.l.classes.includes(c));
      if (!occ.length || occ.some(e => !e.sess || e.sess.len !== 1)) continue;
      const whole = mine.filter(S => S.len === 1 && !tracksOf(S.l).length && S.l.classes.length === 1 && !REQ.has(st.pos.get(S)[1]));
      for (const W of whole) {
        const [d2, p2] = st.pos.get(W), xs = occ.map(e => e.sess);
        vacate(st, W); xs.forEach(x => vacate(st, x));
        let ok = canPlace(st, W.l, d, q, 1, false, W);
        if (ok) { occupy(st, W.l, d, q, 1, W); ok = xs.every(x => { if (!canPlace(st, x.l, d2, p2, 1, false, x)) return false; occupy(st, x.l, d2, p2, 1, x); return true; }); }
        if (ok) break;
        // คืนที่เดิมทั้งหมด
        xs.forEach(x => { if (st.pos.has(x)) vacate(st, x); });
        if (st.pos.has(W)) vacate(st, W);
        occupy(st, W.l, d2, p2, 1, W); xs.forEach(x => occupy(st, x.l, d, q, 1, x));
      }
    }
  }
  // ครูที่ขอคาบว่างติดกัน: วันที่ยังไม่มีคู่ว่าง → ย้ายช่วงหนึ่งของครูคนนั้นไปวันอื่น (วันนั้นต้องไม่เสียคู่ว่างแทน)
  function fixPairs(st) {
    for (const t of pairList) for (let d = 1; d <= ND; d++) {
      if (pairOK(st, t, d, [])) continue;
      const xs = new Set();
      for (let q = 1; q <= NPS; q++) st.at[sidx(d, q)].forEach(e => { if (e.sess && e.l.teacher_ids.includes(t)) xs.add(e.sess); });
      let done = false;
      for (const X of [...xs].sort(() => Math.random() - 0.5)) {
        if (!pairOK(st, t, d, [], [st.pos.get(X)[1], X.len])) continue;      // ย้ายตัวนี้ออกแล้ววันนี้ต้องมีคู่ว่าง
        for (let d2 = 1; d2 <= ND && !done; d2++) for (let p2 = 1; d2 !== d && p2 <= NPS && !done; p2++) {
          if (X.l.teacher_ids.some(u => pairAllow[u] !== undefined && killsPair(st, u, d2, p2, X.len))) continue;
          if (tryMove(st, X, d2, p2)) done = true;
        }
        if (done) break;
      }
    }
  }
  // ทุกสายในห้องเรียนพร้อมกัน: ช่องที่บางสายว่าง → ดึงวิชาของสายที่ว่างจากช่องอื่นที่ "บางสายว่าง" เหมือนกันมาเติม (ช่องที่ครบแล้วไม่แตะ)
  const partial = (st, c, s) => { const h = hereOf(st, c, s); return h.length > 0 && missingRoots(c, h, rootsOf(c)).length > 0; };
  function alignTracks(st) {
    for (const c of IDX.classes) {
      if (rootsOf(c).length < 2) continue;
      for (let d = 1; d <= ND; d++) for (let p = 1; p <= NPS; p++) {
        if (!partial(st, c, sidx(d, p))) continue;
        const miss = missingRoots(c, hereOf(st, c, sidx(d, p)), rootsOf(c));
        const cands = [...st.pos.keys()].filter(X => X.l.classes.length === 1 && X.l.classes[0] === c && tracksOf(X.l).length
          && tracksOf(X.l).every(t => miss.includes(trackRoot(c, t)))).sort(() => Math.random() - 0.5);
        let moved = false;
        for (const X of cands) {
          const [d0, p0] = st.pos.get(X), oldS = Array.from({ length: X.len }, (_, i) => sidx(d0, p0 + i));
          if (oldS.some(x => !partial(st, c, x))) continue;
          for (const q of X.len === 2 ? [p, p - 1] : [p]) {
            const newS = Array.from({ length: X.len }, (_, i) => sidx(d, q + i));
            if (q < 1 || newS.some(x => oldS.includes(x))) continue;
            const aff = [...oldS, ...newS], cnt = () => aff.reduce((a, x) => a + (partial(st, c, x) ? 1 : 0), 0), before = cnt();
            if (!tryMove(st, X, d, q)) continue;
            if (cnt() < before) { moved = true; break; }
            tryMove(st, X, d0, p0);                                    // ไม่ดีขึ้น → กลับที่เดิม
          }
          if (moved) break;
        }
      }
    }
  }
  // ซ่อมให้สายเรียนพร้อมกัน (แรงกว่า alignTracks): ย้ายวิชาเฉพาะสายจากช่องที่บางสายว่าง ไปลงอีกช่องที่สายนั้นว่างอยู่
  // ถ้าปลายทางติดครู/วิชาอื่น → ย้ายตัวที่ขวาง (ไม่เกิน 2) ไปที่อื่น · รับเฉพาะเมื่อคะแนนรวมดีขึ้น ไม่งั้นคืนทั้งหมด
  function alignRepair(st) {
    let base = evaluate(st).score;
    for (const c of IDX.classes) {
      if (rootsOf(c).length < 2) continue;
      for (let d = 1; d <= ND; d++) for (let p = 1; p <= NPS; p++) {
        if (!partial(st, c, sidx(d, p))) continue;
        const xs = st.at[sidx(d, p)].filter(e => e.sess && e.l.classes.length === 1 && e.l.classes[0] === c && tracksOf(e.l).length).map(e => e.sess);
        let improved = false;
        for (const X of xs) {
          if (improved || !st.pos.has(X)) break;
          const [dx, px] = st.pos.get(X), mine = tracksOf(X.l).map(t => trackRoot(c, t));
          for (let d2 = 1; d2 <= ND && !improved; d2++) for (let p2 = 1; p2 + X.len - 1 <= NPS && !improved; p2++) {
            if (d2 === dx && Math.abs(p2 - px) < X.len) continue;
            let okT = true;                                    // ปลายทางทุกคาบ: บางสายเรียนอยู่ และสายของ X ว่าง
            for (let q = p2; q < p2 + X.len && okT; q++) {
              const s2 = sidx(d2, q);
              okT = partial(st, c, s2) && mine.every(r => missingRoots(c, hereOf(st, c, s2), rootsOf(c)).includes(r));
            }
            if (!okT) continue;
            const b = blockers(st, X, d2, p2);
            if (!b || b.length > 2 || b.includes(X)) continue;
            const moved = [X, ...b].map(Y => [Y, st.pos.get(Y)]);
            moved.forEach(([Y]) => vacate(st, Y));
            let ok = canPlace(st, X.l, d2, p2, X.len, false, X);
            if (ok) { occupy(st, X.l, d2, p2, X.len, X); ok = b.every(Y => placeBest(st, Y)); }
            const sc = ok ? evaluate(st).score : -Infinity;
            if (sc > base) { base = sc; improved = true; break; }
            moved.forEach(([Y]) => { if (st.pos.has(Y)) vacate(st, Y); });      // คืนที่เดิมทั้งหมด
            moved.forEach(([Y, pos]) => occupy(st, Y.l, pos[0], pos[1], Y.len, Y));
          }
        }
      }
    }
  }
  // คุณภาพผลลัพธ์: คาบที่ขาด (หลัก) + ช่องที่บางสายเรียนแต่สายอื่นว่าง + วิชาเดียวกันวันติดกัน
  function evaluate(st) {
    const unplaced = sessions.filter(s => !st.pos.has(s)).reduce((a, s) => a + s.len, 0);
    let mis = 0;
    Object.entries(classTracks).forEach(([cls, trs]) => {
      const roots = [...new Set(trs.map(t => trackRoot(cls, t)))];     // นับที่สายหลัก (สายย่อยรวมกับสายแม่)
      if (roots.length < 2) return;
      for (let s = 0; s < NS; s++) {
        const here = st.at[s].filter(e => e.l.classes.includes(cls));
        if (!here.length) continue;
        const cov = new Set();
        here.forEach(e => { const t = tracksOf(e.l); (t.length ? t.map(x => trackRoot(cls, x)) : roots).forEach(x => cov.add(x)); });
        if (roots.some(t => !cov.has(t))) mis++;
      }
    });
    let over = 0;                                 // ครูที่ผ่อนกฎ: จำนวนช่วงที่ติดกันเกินกฎเดิม (ยิ่งน้อยยิ่งดี)
    for (const x of runRaised) {
      const tt = st.tTeach[x.t.id];
      if (tt) for (let d = 1; d <= ND; d++) for (const [a, b] of [[1, LA], [LA + 1, NPS]]) {
        let k = 0;
        for (let p = a; p <= b + 1; p++) { if (p <= b && tt[sidx(d, p)]) k++; else { if (k > x.from) over++; k = 0; } }
      }
    }
    let holes = 0;                                // ช่องที่นักเรียนห้ามว่างแต่ยังว่าง
    if (REQ.size) for (const c of IDX.classes) for (let d = 1; d <= ND; d++) for (const q of REQ)
      if (q <= NPS && missingRoots(c, hereOf(st, c, sidx(d, q)), rootsOf(c)).length) holes++;
    let pairMiss = 0;                             // วันที่ครูที่ขอคาบว่างติดกันไม่มีคู่ว่าง
    for (const t of pairList) for (let d = 1; d <= ND; d++) if (!pairOK(st, t, d, [])) pairMiss++;
    return { unplaced, misaligned: mis, over, holes, pairMiss, score: -unplaced * 100 - mis * 8 - over * 4 - holes * 6 - pairMiss * 4 };
  }

  return {
    sessions, skipped, fixed, runRaised, pairList, pairT,
    async run(restarts, onProgress) {
      let best = null;
      const tLoad = {}; T.teachers.forEach(t => { tLoad[t.id] = maxRun[t.id] < 99 ? teachLoad(t.id) : 0; });
      const base = sessions.map(s => ({ s, k: s.len * 3 + s.l.classes.length * 2 + s.l.teacher_ids.length + (tracksOf(s.l).length ? 4 : 0)
        + s.l.teacher_ids.reduce((a, t) => a + unav[t].size / 5 + (tLoad[t] || 0) / 8 + (pairAllow[t] !== undefined ? 3 : 0), 0) + avoidOf(s.l).length }));
      let lastYield = performance.now();
      for (let r = 0; r < restarts; r++) {
        const st = newState();
        base.map(x => ({ s: x.s, k: x.k + Math.random() * 3 })).sort((a, b) => b.k - a.k).forEach(x => placeBest(st, x.s));
        repair(st, 300);
        fillHoles(st);
        alignTracks(st); alignRepair(st); alignTracks(st);
        if (pairList.length) { fixPairs(st); fixPairs(st); }
        const ev = evaluate(st);
        if (!best || ev.score > best.ev.score) best = { ev, pos: new Map(st.pos), st };
        if (onProgress) onProgress(r + 1, restarts, best.ev);
        if (performance.now() - lastYield > 30) { await yieldUI(); lastYield = performance.now(); }
        if (best.ev.unplaced === 0 && best.ev.misaligned === 0 && !best.ev.holes && !best.ev.over && !best.ev.pairMiss) break;
      }
      // ช่วงที่ยังเหลือ: ซ่อม + วางแบบผ่อนกฎที่ตั้งได้ (ไม่ผ่อนครูซ้อน/ห้องชน/ครูไม่ว่าง)
      const pending = sessions.filter(s => !best.st.pos.has(s));
      if (pending.length) repair(best.st, 400, true);
      sessions.filter(s => !best.st.pos.has(s)).forEach(s => placeBest(best.st, s, true));
      const relaxed = pending.filter(s => best.st.pos.has(s));
      fillHoles(best.st);
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
    <div class="small text-muted">กฎที่ใช้: ครูไม่สอนซ้อน · ห้อง/สายไม่ชน · ครูไม่ว่าง · คาบคู่ · วิชาไม่ซ้ำวัน · เลี่ยงคาบ · ครูสอนไม่เกินวันละ N คาบ
      · ${T.term.config.max_run ? `<b>ครูสอนติดกันไม่เกิน ${T.term.config.max_run} คาบ</b>` : 'ครูสอนติดกัน: ไม่จำกัด'}
      · ${classBusyPeriods().length ? `<b>นักเรียนไม่ว่างคาบ ${classBusyPeriods().join(', ')}</b>` : 'คาบว่างนักเรียน: ไม่กำหนด'}
      · ครูที่ขอคาบว่างติดกัน 2 คาบ / ไม่สอนคาบคู่ (ตั้งที่ เงื่อนไขครู) <span class="text-nowrap">(แก้ที่ เครื่องมือ → กฎการจัดตาราง)</span>
      · พยายามให้วิชาต่างสายเรียนพร้อมกัน</div>
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
  const leftDbl = [...new Set(res.left.filter(s => s.len === 2).map(s => s.l.id))];     // คาบคู่ที่หาช่องติดกันไม่ได้
  SOLVED = { newSlots, res, mode, leftDbl };
  const left = res.left.reduce((a, s) => a + s.len, 0), placed = need - left;
  const lines = [
    `<div class="alert ${left ? 'alert-warning' : 'alert-success'} py-2 mb-2">วางได้ <b>${placed}/${need}</b> คาบ ${left ? `· ยังวางไม่ได้ <b>${left}</b> คาบ` : '✓ ครบ'} · ใช้เวลา ${((performance.now() - t0) / 1000).toFixed(1)} วินาที</div>`,
    res.relaxed.length ? `<div class="small mb-1">⚠ ผ่อนกฎที่ตั้งไว้ (ซ้ำวัน/เลี่ยงคาบ/เกินวันละ N/สอนติดกันเกิน N) เพื่อวาง ${res.relaxed.length} ช่วง: ${res.relaxed.map(s => esc(lessonName(s.l) + ' ' + classLabel(s.l))).join(', ')}</div>` : '',
    res.left.length ? `<div class="small mb-1 text-danger">✖ วางไม่ได้ (ครูหรือห้องไม่มีช่องว่างตรงกัน): ${res.left.map(s => esc(lessonName(s.l) + ' ' + classLabel(s.l) + ' (' + s.l.teacher_ids.map(teacherShort).join(',') + ')' + (s.len === 2 ? ' [คาบคู่]' : ''))).join(', ')}</div>` : '',
    leftDbl.length ? `<div class="alert alert-warning py-2 px-2 small mb-2 d-flex flex-wrap align-items-center gap-2">
      <div class="me-auto">คาบคู่ <b>${leftDbl.length}</b> วิชาหาช่องติดกัน 2 คาบไม่ได้ — แยกเป็นคาบเดี่ยวแล้วให้ระบบจัดใหม่ได้เลย</div>
      <button class="btn btn-sm btn-warning" onclick="splitLeftAndRerun(this)">✂ แยกคาบคู่แล้วจัดใหม่</button></div>` : '',
    solver.runRaised.length ? `<div class="small mb-1">ℹ คาบสอนมากเกินกว่าจะทำตามกฎสอนติดกันได้ทุกวัน จึงผ่อนเฉพาะ: ${solver.runRaised.map(x => esc(`${teacherShort(x.t.id)} (${x.load} คาบ/สัปดาห์) ${x.from}→${x.to} คาบติด`)).join(', ')}</div>` : '',
    solver.skipped.length ? `<div class="small mb-1">⏭ ข้าม (ยังไม่กำหนดครู): ${solver.skipped.map(x => esc(lessonName(x.l) + ' ' + classLabel(x.l))).join(', ')}</div>` : '',
    solver.pairList.length ? `<div class="small mb-1 ${res.ev.pairMiss ? 'text-warning-emphasis' : 'text-success'}">${res.ev.pairMiss ? '⚠' : '✓'} ครูที่ขอคาบว่างติดกัน 2 คาบทุกวัน (${solver.pairList.map(t => esc(teacherShort(t))).join(', ')}): ขาด ${res.ev.pairMiss} วัน${
      solver.pairList.some(t => solver.pairT[t] === 'soft') ? ` · คาบมากเกินกว่าจะได้ทุกวัน: ${solver.pairList.filter(t => solver.pairT[t] === 'soft').map(t => esc(`${teacherShort(t)} (ได้มากสุด ${freePairMaxDays(t)} วัน)`)).join(', ')}` : ''}</div>` : '',
    classBusyPeriods().length ? `<div class="small mb-1 ${res.ev.holes ? 'text-danger' : 'text-success'}">${res.ev.holes ? '✖' : '✓'} นักเรียนว่างในคาบที่ห้ามว่าง (คาบ ${classBusyPeriods().join(', ')}): ${res.ev.holes} ช่อง</div>` : '',
    `<div class="small mb-1 ${res.ev.misaligned ? 'text-warning-emphasis' : 'text-success'}">${res.ev.misaligned ? '⚠' : '✓'} ช่องที่บางสายเรียนแต่บางสายว่าง: ${res.ev.misaligned} ช่อง${res.ev.misaligned ? ' (ถ้าคาบเฉพาะสายไม่เท่ากัน จะเหลือแบบนี้เสมอ — ดูปุ่ม สายการเรียน)' : ''}</div>`,
  ];
  el('svResult').innerHTML = lines.join('');
  el('edModalFoot').innerHTML = `<button class="btn btn-outline-secondary btn-sm me-auto" onclick="runSolve()"><i class="bi bi-arrow-repeat"></i> จัดใหม่อีกรอบ</button>
    <button class="btn btn-outline-primary btn-sm" onclick="previewSolved()"><i class="bi bi-eye"></i> ดูผลในตาราง</button>
    <button class="btn btn-success btn-sm" onclick="saveSolved()"><i class="bi bi-save"></i> บันทึกผลนี้</button>`;
}

// ดูผลในตาราง (ยังไม่บันทึก) — แถบ "บันทึก/ยกเลิก" วาดใน renderEditor ทุกครั้ง (เปลี่ยนห้อง/ครูก็ยังอยู่)
// ระหว่างนี้ห้ามแก้ตาราง (previewGuard) ไม่งั้นข้อมูลในเครื่องกับเซิร์ฟเวอร์ไม่ตรงกัน
// แยกคาบคู่ของวิชาที่วางไม่ได้ (บันทึกเงื่อนไขของรายการนั้น) แล้วจัดใหม่ทันที
async function splitLeftAndRerun(btn) {
  const ids = (SOLVED && SOLVED.leftDbl) || [];
  if (!ids.length) return;
  if (btn) btn.disabled = true;
  for (const id of ids) if (!(await setDouble(id, false, true))) { if (btn) btn.disabled = false; return; }
  buildIndex(); renderEditor();                                   // การ์ด/ตารางด้านหลังอัปเดตตาม
  toastEd(`แยกคาบคู่ ${ids.length} วิชาแล้ว — กำลังจัดใหม่`);
  await runSolve();
}

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
    const dropped = await dropClashingSupervision();             // คาบซ่อมเสริมที่ตอนนี้มีวิชาลงแล้ว → เอาครูดูแลออก
    toastEd(`บันทึกแล้ว ${r.placed} ช่อง${dropped ? ` · เอาครูดูแลซ่อมเสริมออก ${dropped} คาบ (ตารางเปลี่ยน) — จัดใหม่ได้ที่ เครื่องมือ → ครูดูแลซ่อมเสริม` : ''}`);
  } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
}
