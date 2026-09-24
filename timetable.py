"""
ระบบตารางสอน (ฝ่ายวิชาการ)

โครงข้อมูล
  tt_terms     ภาคเรียน เช่น '1/2569' + ค่าคาบเวลา/ผู้ลงนาม (config JSON)
  tt_teachers  ครูผู้สอน (ผูกกับบัญชีผู้ใช้ได้ → ครูเปิดดูตารางตัวเอง)
  tt_lessons   ภาระงานสอน 1 รายการ = วิชา/กิจกรรม + ครู + ชั้น (+ สาย/กลุ่ม) + คาบต่อสัปดาห์
  tt_slots     ช่องในตาราง (วัน 1-5, คาบ 1-7) ที่วางรายการนั้นไว้

สิทธิ์: แอดมินแก้ไขได้ / ครูทุกคนดูได้
"""
import json
import os
import re

SEED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seed')

SCHEMA = """
CREATE TABLE IF NOT EXISTS tt_terms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    config      TEXT,
    published   INTEGER DEFAULT 0,
    note        TEXT,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS tt_teachers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    constraints TEXT,
    sort_order  INTEGER DEFAULT 0,
    active      INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tt_subjects (
    code        TEXT PRIMARY KEY,
    name        TEXT,
    area        TEXT
);
CREATE TABLE IF NOT EXISTS tt_lessons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id     INTEGER NOT NULL REFERENCES tt_terms(id) ON DELETE CASCADE,
    code        TEXT DEFAULT '',
    title       TEXT DEFAULT '',
    kind        TEXT DEFAULT 'subject',
    classes     TEXT NOT NULL DEFAULT '[]',
    track       TEXT DEFAULT '',
    teacher_ids TEXT NOT NULL DEFAULT '[]',
    per_week    INTEGER NOT NULL DEFAULT 1,
    options     TEXT,
    note        TEXT
);
CREATE TABLE IF NOT EXISTS tt_slots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id   INTEGER NOT NULL REFERENCES tt_lessons(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL,
    period      INTEGER NOT NULL,
    locked      INTEGER DEFAULT 0,
    UNIQUE(lesson_id, day, period)
);
CREATE INDEX IF NOT EXISTS idx_ttlesson_term ON tt_lessons(term_id);
CREATE INDEX IF NOT EXISTS idx_ttslot_lesson ON tt_slots(lesson_id);
"""

# ชื่อกลุ่มสาระจากอักษรนำรหัสวิชา
AREAS = {
    'ท': 'ภาษาไทย', 'ค': 'คณิตศาสตร์', 'ว': 'วิทยาศาสตร์และเทคโนโลยี',
    'ส': 'สังคมศึกษาฯ', 'พ': 'สุขศึกษาและพลศึกษา', 'ศ': 'ศิลปะ',
    'ง': 'การงานอาชีพ', 'อ': 'ภาษาอังกฤษ', 'จ': 'ภาษาจีน', 'I': 'IS',
}
PREFIXES = ('นางสาว', 'นาง', 'นาย', 'ว่าที่ร้อยตรีหญิง', 'ว่าที่ร้อยตรี', 'ว่าที่ ร.ต.', 'ครู')


def bare_name(n):
    """ตัดคำนำหน้าและช่องว่างซ้ำ เพื่อจับคู่ชื่อครูกับบัญชีผู้ใช้"""
    n = re.sub(r'\s+', ' ', (n or '')).strip()
    changed = True
    while changed:
        changed = False
        for p in PREFIXES:
            if n.startswith(p):
                n = n[len(p):].strip()
                changed = True
    return n


def jl(s, default):
    try:
        return json.loads(s) if s else default
    except (TypeError, ValueError):
        return default


def term_payload(con, term_id):
    term = con.execute('SELECT * FROM tt_terms WHERE id=?', (term_id,)).fetchone()
    if not term:
        return None
    lessons = []
    for l in con.execute('SELECT * FROM tt_lessons WHERE term_id=? ORDER BY id', (term_id,)).fetchall():
        d = dict(l)
        d['classes'] = jl(d['classes'], [])
        d['teacher_ids'] = jl(d['teacher_ids'], [])
        d['options'] = jl(d['options'], {})
        d['slots'] = [[s['day'], s['period'], s['locked']] for s in con.execute(
            'SELECT day, period, locked FROM tt_slots WHERE lesson_id=? ORDER BY day, period', (l['id'],))]
        lessons.append(d)
    used = {tid for l in lessons for tid in l['teacher_ids']}
    teachers = [dict(t, constraints=jl(t['constraints'], {})) for t in con.execute(
        'SELECT * FROM tt_teachers ORDER BY sort_order, id').fetchall() if t['id'] in used or t['active']]
    subjects = {s['code']: dict(s) for s in con.execute('SELECT * FROM tt_subjects').fetchall()}
    return dict(term=dict(term, config=jl(term['config'], {})), lessons=lessons,
                teachers=teachers, subjects=subjects)


def infer_options(slots, lunch_after=4):
    """เดาเงื่อนไขจากตารางที่วางไว้: มีคาบติดกันในวันเดียว (ไม่ข้ามพักกลางวัน) → วิชานี้เรียนเป็นคาบคู่"""
    by_day = {}
    for d, p in slots:
        by_day.setdefault(d, []).append(p)
    for ps in by_day.values():
        ps = sorted(ps)
        if any(b - a == 1 and a != lunch_after for a, b in zip(ps, ps[1:])):
            return {'double': True}
    return {}


def clean_lesson(b):
    """ตรวจ/จัดรูปข้อมูลภาระงานสอนจากฟอร์ม → dict พร้อมบันทึก (ผิดรูป → ValueError ข้อความภาษาไทย)"""
    code = re.sub(r'\s+', '', str(b.get('code') or ''))
    title = re.sub(r'\s+', ' ', str(b.get('title') or '')).strip()
    if not code and not title:
        raise ValueError('ใส่รหัสวิชา หรือชื่อกิจกรรม')
    classes = [str(c) for c in (b.get('classes') or []) if re.fullmatch(r'\d{1,2}/\d{1,2}', str(c))]
    teacher_ids = [int(t) for t in (b.get('teacher_ids') or []) if str(t).isdigit()]
    if not teacher_ids and not classes:
        raise ValueError('เลือกครูผู้สอน หรือชั้นเรียนอย่างน้อย 1 อย่าง')
    try:
        per_week = int(b.get('per_week') or 1)
    except (TypeError, ValueError):
        raise ValueError('จำนวนคาบต่อสัปดาห์ต้องเป็นตัวเลข')
    if not 0 <= per_week <= 35:
        raise ValueError('จำนวนคาบต่อสัปดาห์ต้องอยู่ระหว่าง 0-35')
    opts = b.get('options') or {}
    options = {}
    if opts.get('double'):
        options['double'] = True
    if opts.get('allow_same_day'):
        options['allow_same_day'] = True
    avoid = sorted({int(p) for p in (opts.get('avoid') or []) if str(p).isdigit()})
    if avoid:
        options['avoid'] = avoid
    track = ','.join(t.strip() for t in str(b.get('track') or '').split(',') if t.strip())
    kind = 'activity' if b.get('kind') == 'activity' else 'subject'
    return dict(code=code, title=title if not code else (title or ''), kind=kind, classes=classes,
                track=track, teacher_ids=teacher_ids, per_week=per_week, options=options,
                note=str(b.get('note') or '').strip())


def lesson_dict(con, lid):
    l = con.execute('SELECT * FROM tt_lessons WHERE id=?', (lid,)).fetchone()
    if not l:
        return None
    d = dict(l)
    d['classes'] = jl(d['classes'], [])
    d['teacher_ids'] = jl(d['teacher_ids'], [])
    d['options'] = jl(d['options'], {})
    d['slots'] = [[s['day'], s['period'], s['locked']] for s in con.execute(
        'SELECT day, period, locked FROM tt_slots WHERE lesson_id=? ORDER BY day, period', (lid,))]
    return d


def init(app, get_db, login_required, admin_required, current_user, get_settings):
    from flask import jsonify, request

    with get_db() as con:
        con.executescript(SCHEMA)
        # ครั้งเดียว: รายการที่ยังไม่มีเงื่อนไข → เดาคาบคู่จากตารางที่วางไว้
        for l in con.execute('SELECT id, term_id FROM tt_lessons WHERE options IS NULL').fetchall():
            slots = [(s['day'], s['period']) for s in con.execute(
                'SELECT day, period FROM tt_slots WHERE lesson_id=?', (l['id'],))]
            cfg = jl((con.execute('SELECT config FROM tt_terms WHERE id=?', (l['term_id'],)).fetchone() or {'config': None})['config'], {})
            con.execute('UPDATE tt_lessons SET options=? WHERE id=?',
                        (json.dumps(infer_options(slots, cfg.get('lunch_after', 4))), l['id']))

    def link_users(con):
        """ผูกครูในตารางกับบัญชีผู้ใช้ที่ชื่อตรงกัน (ทำเฉพาะคนที่ยังไม่ได้ผูก)"""
        users = con.execute('SELECT id, full_name FROM users').fetchall()
        by_name = {bare_name(u['full_name']): u['id'] for u in users}
        for t in con.execute('SELECT id, name FROM tt_teachers WHERE user_id IS NULL').fetchall():
            uid = by_name.get(bare_name(t['name']))
            if uid:
                con.execute('UPDATE tt_teachers SET user_id=? WHERE id=?', (uid, t['id']))

    # ── อ่าน ──────────────────────────────────────────────
    @app.get('/api/tt/terms')
    @login_required
    def tt_terms():
        with get_db() as con:
            rows = con.execute("""SELECT t.*, (SELECT COUNT(*) FROM tt_lessons l WHERE l.term_id=t.id) AS lesson_count
                                  FROM tt_terms t ORDER BY t.id DESC""").fetchall()
        u = current_user()
        out = [dict(r, config=None) for r in rows]
        if not u or u['role'] != 'admin':
            out = [r for r in out if r['published']]
        seeds = []
        if u and u['role'] == 'admin' and os.path.isdir(SEED_DIR):
            have = {r['name'] for r in rows}
            for fn in sorted(os.listdir(SEED_DIR)):
                if fn.startswith('timetable-') and fn.endswith('.json'):
                    name = fn[len('timetable-'):-5].replace('-', '/')
                    if name not in have:
                        seeds.append(dict(file=fn, name=name))
        return jsonify(terms=out, seeds=seeds)

    @app.get('/api/tt/terms/<int:term_id>')
    @login_required
    def tt_term(term_id):
        u = current_user()
        with get_db() as con:
            data = term_payload(con, term_id)
            if not data:
                return jsonify(error='not found'), 404
            if not data['term']['published'] and u['role'] != 'admin':
                return jsonify(error='ตารางนี้ยังไม่เผยแพร่'), 403
            me = con.execute('SELECT id FROM tt_teachers WHERE user_id=?', (u['id'],)).fetchone()
        data['me'] = me['id'] if me else None
        data['can_edit'] = u['role'] == 'admin'
        s = get_settings()
        data['school'] = dict(name=s.get('school_name', ''), director=s.get('director_name', ''),
                              director_title=s.get('director_title', ''), logo=s.get('school_logo', ''))
        return jsonify(data)

    # ── นำเข้าตารางตั้งต้น (อ่านจาก PDF เดิมไว้แล้วในโฟลเดอร์ seed/) ─────────
    @app.post('/api/tt/import-seed')
    @admin_required
    def tt_import_seed():
        fn = os.path.basename((request.get_json() or {}).get('file', ''))
        path = os.path.join(SEED_DIR, fn)
        if not fn.startswith('timetable-') or not os.path.isfile(path):
            return jsonify(success=False, message='ไม่พบไฟล์'), 404
        with open(path, encoding='utf-8') as f:
            seed = json.load(f)
        with get_db() as con:
            if con.execute('SELECT 1 FROM tt_terms WHERE name=?', (seed['term'],)).fetchone():
                return jsonify(success=False, message=f"มีภาคเรียน {seed['term']} อยู่แล้ว"), 409
            cur = con.execute('INSERT INTO tt_terms (name, config, published, note) VALUES (?,?,?,?)',
                              (seed['term'], json.dumps(seed['config'], ensure_ascii=False), 1, seed.get('source', '')))
            term_id = cur.lastrowid
            tid = {}
            for i, name in enumerate(seed['teachers']):
                row = con.execute('SELECT id FROM tt_teachers WHERE name=?', (name,)).fetchone()
                if row:
                    tid[name] = row['id']
                else:
                    tid[name] = con.execute('INSERT INTO tt_teachers (name, sort_order) VALUES (?,?)',
                                            (name, i + 1)).lastrowid
            for l in seed['lessons']:
                code = l.get('code', '')
                if code and not con.execute('SELECT 1 FROM tt_subjects WHERE code=?', (code,)).fetchone():
                    con.execute('INSERT INTO tt_subjects (code, name, area) VALUES (?,?,?)',
                                (code, '', AREAS.get(code[0], '')))
                opts = infer_options(l['slots'], seed['config'].get('lunch_after', 4))
                lid = con.execute("""INSERT INTO tt_lessons (term_id, code, title, kind, classes, track, teacher_ids, per_week, options)
                                     VALUES (?,?,?,?,?,?,?,?,?)""",
                                  (term_id, code, l.get('title', ''), l.get('kind', 'subject'),
                                   json.dumps(l['classes']), l.get('track', ''),
                                   json.dumps([tid[t] for t in l['teachers']]), len(l['slots']),
                                   json.dumps(opts))).lastrowid
                for d, p in l['slots']:
                    con.execute('INSERT OR IGNORE INTO tt_slots (lesson_id, day, period) VALUES (?,?,?)', (lid, d, p))
            link_users(con)
        return jsonify(success=True, term_id=term_id,
                       message=f"นำเข้าตารางภาคเรียน {seed['term']} แล้ว ({len(seed['lessons'])} รายการ)")

    # ── ครูดูตารางตัวเอง ─────────────────────────────────
    @app.get('/api/tt/my')
    @login_required
    def tt_my():
        u = current_user()
        with get_db() as con:
            link_users(con)
            me = con.execute('SELECT * FROM tt_teachers WHERE user_id=?', (u['id'],)).fetchone()
            term = con.execute('SELECT id FROM tt_terms WHERE published=1 ORDER BY id DESC LIMIT 1').fetchone()
        return jsonify(teacher=dict(me) if me else None, term_id=term['id'] if term else None)

    # ── ผูกครูกับบัญชีผู้ใช้ (แอดมิน) ─────────────────────
    @app.post('/api/tt/teachers/<int:teacher_id>/link')
    @admin_required
    def tt_link_teacher(teacher_id):
        uid = (request.get_json() or {}).get('user_id')
        with get_db() as con:
            if uid:
                con.execute('UPDATE tt_teachers SET user_id=NULL WHERE user_id=?', (uid,))
            con.execute('UPDATE tt_teachers SET user_id=? WHERE id=?', (uid or None, teacher_id))
        return jsonify(success=True)

    @app.get('/api/tt/users')
    @admin_required
    def tt_users():
        with get_db() as con:
            rows = con.execute('SELECT id, full_name, role FROM users ORDER BY full_name').fetchall()
        return jsonify([dict(r) for r in rows])

    # ═════════════ ขั้นที่ 2: จัดตาราง / แก้ไข (แอดมิน) ═════════════
    def term_of_lesson(con, lid):
        row = con.execute("""SELECT t.* FROM tt_terms t JOIN tt_lessons l ON l.term_id=t.id WHERE l.id=?""",
                          (lid,)).fetchone()
        return (dict(row, config=jl(row['config'], {})) if row else None)

    @app.post('/api/tt/slots')
    @admin_required
    def tt_slots_update():
        """วาง/ย้าย/เอาออก/ล็อก ช่องของรายการเดียว: {lesson_id, remove:[[d,p]], add:[[d,p]], lock:[[d,p,0|1]]}"""
        b = request.get_json() or {}
        try:
            lid = int(b.get('lesson_id') or 0)
        except (TypeError, ValueError):
            lid = 0
        with get_db() as con:
            term = term_of_lesson(con, lid)
            if not term:
                return jsonify(success=False, message='ไม่พบรายการ'), 404
            nd = len(term['config'].get('days') or [1, 2, 3, 4, 5])
            np_ = len(term['config'].get('periods') or [1] * 7)

            def ok(d, p):
                return isinstance(d, int) and isinstance(p, int) and 1 <= d <= nd and 1 <= p <= np_

            for d, p in (b.get('remove') or []):
                con.execute('DELETE FROM tt_slots WHERE lesson_id=? AND day=? AND period=?', (lid, d, p))
            for d, p in (b.get('add') or []):
                if not ok(d, p):
                    return jsonify(success=False, message='ช่องไม่ถูกต้อง'), 400
                con.execute('INSERT OR IGNORE INTO tt_slots (lesson_id, day, period) VALUES (?,?,?)', (lid, d, p))
            for d, p, lk in (b.get('lock') or []):
                con.execute('UPDATE tt_slots SET locked=? WHERE lesson_id=? AND day=? AND period=?',
                            (1 if lk else 0, lid, d, p))
            return jsonify(success=True, lesson=lesson_dict(con, lid))

    @app.post('/api/tt/lessons')
    @admin_required
    def tt_lesson_create():
        b = request.get_json() or {}
        try:
            v = clean_lesson(b)
            term_id = int(b.get('term_id') or 0)
        except ValueError as e:
            return jsonify(success=False, message=str(e)), 400
        with get_db() as con:
            if not con.execute('SELECT 1 FROM tt_terms WHERE id=?', (term_id,)).fetchone():
                return jsonify(success=False, message='ไม่พบภาคเรียน'), 404
            lid = con.execute("""INSERT INTO tt_lessons (term_id, code, title, kind, classes, track, teacher_ids, per_week, options, note)
                                 VALUES (?,?,?,?,?,?,?,?,?,?)""",
                              (term_id, v['code'], v['title'], v['kind'], json.dumps(v['classes']), v['track'],
                               json.dumps(v['teacher_ids']), v['per_week'], json.dumps(v['options']), v['note'])).lastrowid
            save_subject_name(con, v['code'], b.get('subject_name'))
            return jsonify(success=True, lesson=lesson_dict(con, lid))

    @app.put('/api/tt/lessons/<int:lid>')
    @admin_required
    def tt_lesson_update(lid):
        b = request.get_json() or {}
        try:
            v = clean_lesson(b)
        except ValueError as e:
            return jsonify(success=False, message=str(e)), 400
        with get_db() as con:
            if not con.execute('SELECT 1 FROM tt_lessons WHERE id=?', (lid,)).fetchone():
                return jsonify(success=False, message='ไม่พบรายการ'), 404
            con.execute("""UPDATE tt_lessons SET code=?, title=?, kind=?, classes=?, track=?, teacher_ids=?,
                           per_week=?, options=?, note=? WHERE id=?""",
                        (v['code'], v['title'], v['kind'], json.dumps(v['classes']), v['track'],
                         json.dumps(v['teacher_ids']), v['per_week'], json.dumps(v['options']), v['note'], lid))
            save_subject_name(con, v['code'], b.get('subject_name'))
            return jsonify(success=True, lesson=lesson_dict(con, lid))

    @app.delete('/api/tt/lessons/<int:lid>')
    @admin_required
    def tt_lesson_delete(lid):
        with get_db() as con:
            con.execute('DELETE FROM tt_slots WHERE lesson_id=?', (lid,))
            con.execute('DELETE FROM tt_lessons WHERE id=?', (lid,))
        return jsonify(success=True)

    def save_subject_name(con, code, name):
        if not code or name is None:
            return
        name = re.sub(r'\s+', ' ', str(name)).strip()
        if con.execute('SELECT 1 FROM tt_subjects WHERE code=?', (code,)).fetchone():
            con.execute('UPDATE tt_subjects SET name=? WHERE code=?', (name, code))
        else:
            con.execute('INSERT INTO tt_subjects (code, name, area) VALUES (?,?,?)',
                        (code, name, AREAS.get(code[0], '')))

    @app.post('/api/tt/teachers')
    @admin_required
    def tt_teacher_create():
        name = bare_name((request.get_json() or {}).get('name', ''))
        if not name:
            return jsonify(success=False, message='ใส่ชื่อครู'), 400
        with get_db() as con:
            old = con.execute('SELECT * FROM tt_teachers WHERE name=?', (name,)).fetchone()
            if old and not old['active']:        # เคยย้ายออก/ปิดไว้ → เปิดใช้คนเดิม
                con.execute('UPDATE tt_teachers SET active=1 WHERE id=?', (old['id'],))
                t = con.execute('SELECT * FROM tt_teachers WHERE id=?', (old['id'],)).fetchone()
                return jsonify(success=True, teacher=dict(t, constraints=jl(t['constraints'], {})))
            if old:
                return jsonify(success=False, message='มีชื่อนี้แล้ว'), 409
            n = con.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM tt_teachers').fetchone()['n']
            tid = con.execute('INSERT INTO tt_teachers (name, sort_order) VALUES (?,?)', (name, n)).lastrowid
            link_users(con)
            t = con.execute('SELECT * FROM tt_teachers WHERE id=?', (tid,)).fetchone()
        return jsonify(success=True, teacher=dict(t, constraints={}))

    @app.put('/api/tt/teachers/<int:tid>')
    @admin_required
    def tt_teacher_update(tid):
        """แก้ชื่อ / เงื่อนไข {unavailable:[[d,p]], max_per_day:n} / ผูกบัญชีผู้ใช้"""
        b = request.get_json() or {}
        with get_db() as con:
            t = con.execute('SELECT * FROM tt_teachers WHERE id=?', (tid,)).fetchone()
            if not t:
                return jsonify(success=False, message='ไม่พบครู'), 404
            if 'name' in b:
                name = bare_name(b['name'])
                if not name:
                    return jsonify(success=False, message='ใส่ชื่อครู'), 400
                if con.execute('SELECT 1 FROM tt_teachers WHERE name=? AND id<>?', (name, tid)).fetchone():
                    return jsonify(success=False, message='มีชื่อนี้แล้ว'), 409
                con.execute('UPDATE tt_teachers SET name=? WHERE id=?', (name, tid))
            if 'constraints' in b:
                c = b.get('constraints') or {}
                cons = {}
                un = sorted({(int(d), int(p)) for d, p in (c.get('unavailable') or [])
                             if str(d).isdigit() and str(p).isdigit()})
                if un:
                    cons['unavailable'] = [list(x) for x in un]
                if str(c.get('max_per_day') or '').isdigit() and int(c['max_per_day']) > 0:
                    cons['max_per_day'] = int(c['max_per_day'])
                note = re.sub(r'\s+', ' ', str(c.get('note') or '')).strip()[:100]
                if note:
                    cons['note'] = note          # เหตุผลที่ไม่ว่าง เช่น ไปธนาคาร — แสดงในคำเตือน
                con.execute('UPDATE tt_teachers SET constraints=? WHERE id=?', (json.dumps(cons, ensure_ascii=False), tid))
            if 'user_id' in b:
                uid = b.get('user_id') or None
                if uid:
                    con.execute('UPDATE tt_teachers SET user_id=NULL WHERE user_id=?', (uid,))
                con.execute('UPDATE tt_teachers SET user_id=? WHERE id=?', (uid, tid))
            if 'active' in b:
                con.execute('UPDATE tt_teachers SET active=? WHERE id=?', (1 if b['active'] else 0, tid))
            t = con.execute('SELECT * FROM tt_teachers WHERE id=?', (tid,)).fetchone()
        return jsonify(success=True, teacher=dict(t, constraints=jl(t['constraints'], {})))

    @app.post('/api/tt/terms/<int:term_id>/transfer-teacher')
    @admin_required
    def tt_transfer_teacher(term_id):
        """ครูย้ายออก / เปลี่ยนผู้สอน: โอนทุกวิชา+กิจกรรมของครูคนหนึ่ง "เฉพาะภาคเรียนนี้" ให้ครูอีกคน
        {from_id, to_id | new_name, deactivate} — ภาคเรียนอื่นไม่แตะ ตารางเทอมเก่ายังเป็นชื่อครูเดิม
        ครูที่ยังไม่มา ใช้ชื่อชั่วคราว เช่น "ใหม่ (แทนกันต์กวี)" → มาถึงแล้วแก้ชื่อ + ผูกบัญชีที่ "เงื่อนไขครู" """
        b = request.get_json() or {}
        try:
            src, dst = int(b.get('from_id') or 0), int(b.get('to_id') or 0)
        except (TypeError, ValueError):
            return jsonify(success=False, message='ข้อมูลครูไม่ถูกต้อง'), 400
        with get_db() as con:
            if not con.execute('SELECT 1 FROM tt_terms WHERE id=?', (term_id,)).fetchone():
                return jsonify(success=False, message='ไม่พบภาคเรียน'), 404
            s = con.execute('SELECT * FROM tt_teachers WHERE id=?', (src,)).fetchone()
            if not s:
                return jsonify(success=False, message='ไม่พบครู'), 404
            if dst:
                if dst == src or not con.execute('SELECT 1 FROM tt_teachers WHERE id=?', (dst,)).fetchone():
                    return jsonify(success=False, message='เลือกครูที่รับโอนไม่ถูกต้อง'), 400
                con.execute('UPDATE tt_teachers SET active=1 WHERE id=?', (dst,))
            else:
                name = bare_name(b.get('new_name', ''))
                if not name:
                    return jsonify(success=False, message='ใส่ชื่อครูใหม่'), 400
                if con.execute('SELECT 1 FROM tt_teachers WHERE name=?', (name,)).fetchone():
                    return jsonify(success=False, message=f'มีครูชื่อ "{name}" แล้ว — เลือกจากรายชื่อแทน'), 409
                dst = con.execute('INSERT INTO tt_teachers (name, sort_order) VALUES (?,?)',   # ลำดับเดียวกับครูเดิม
                                  (name, s['sort_order'])).lastrowid
            moved = 0
            for l in con.execute('SELECT id, teacher_ids FROM tt_lessons WHERE term_id=?', (term_id,)).fetchall():
                ids = jl(l['teacher_ids'], [])
                if src in ids:
                    new = []
                    for t in ids:
                        t = dst if t == src else t
                        if t not in new:
                            new.append(t)
                    con.execute('UPDATE tt_lessons SET teacher_ids=? WHERE id=?', (json.dumps(new), l['id']))
                    moved += 1
            if b.get('deactivate'):
                con.execute('UPDATE tt_teachers SET active=0 WHERE id=?', (src,))
        return jsonify(success=True, moved=moved, to_id=dst)

    @app.put('/api/tt/terms/<int:term_id>')
    @admin_required
    def tt_term_update(term_id):
        """แก้ค่าภาคเรียน: ชื่อ, เผยแพร่, config (คาบเวลา / สายการเรียนของแต่ละห้อง / ผู้ลงนาม)"""
        b = request.get_json() or {}
        with get_db() as con:
            row = con.execute('SELECT * FROM tt_terms WHERE id=?', (term_id,)).fetchone()
            if not row:
                return jsonify(success=False, message='ไม่พบภาคเรียน'), 404
            if 'name' in b:
                name = str(b['name']).strip()
                if not re.fullmatch(r'[12]/25\d\d', name):
                    return jsonify(success=False, message='ชื่อภาคเรียนต้องเป็นรูปแบบ 1/2569 หรือ 2/2569'), 400
                if con.execute('SELECT 1 FROM tt_terms WHERE name=? AND id<>?', (name, term_id)).fetchone():
                    return jsonify(success=False, message='มีภาคเรียนนี้แล้ว'), 409
                con.execute('UPDATE tt_terms SET name=? WHERE id=?', (name, term_id))
            if 'published' in b:
                con.execute('UPDATE tt_terms SET published=? WHERE id=?', (1 if b['published'] else 0, term_id))
            if 'config' in b and isinstance(b['config'], dict):
                cfg = jl(row['config'], {})
                for k in ('periods', 'pre', 'lunch', 'lunch_after', 'classes', 'signers', 'tracks', 'days'):
                    if k in b['config']:
                        cfg[k] = b['config'][k]
                con.execute('UPDATE tt_terms SET config=? WHERE id=?', (json.dumps(cfg, ensure_ascii=False), term_id))
        return jsonify(success=True)

    @app.delete('/api/tt/terms/<int:term_id>')
    @admin_required
    def tt_term_delete(term_id):
        with get_db() as con:
            con.execute('DELETE FROM tt_slots WHERE lesson_id IN (SELECT id FROM tt_lessons WHERE term_id=?)', (term_id,))
            con.execute('DELETE FROM tt_lessons WHERE term_id=?', (term_id,))
            con.execute('DELETE FROM tt_terms WHERE id=?', (term_id,))
        return jsonify(success=True)

    # ── ตั้งสายการเรียนจากโครงสร้างหลักสูตร (seed/curriculum-*.json) ──────────
    def load_curriculum():
        files = sorted(f for f in os.listdir(SEED_DIR) if f.startswith('curriculum-') and f.endswith('.json')) \
            if os.path.isdir(SEED_DIR) else []
        if not files:
            return None
        with open(os.path.join(SEED_DIR, files[-1]), encoding='utf-8') as f:
            return json.load(f)

    @app.post('/api/tt/terms/<int:term_id>/apply-tracks')
    @admin_required
    def tt_apply_tracks(term_id):
        """วิชาที่มีเฉพาะบางแผนการเรียน → ใส่ชื่อแผนให้ (วิชาที่ทุกแผนเรียน = ทั้งห้อง)
        ไม่แตะรายการที่ตั้งกลุ่มไว้แล้ว เช่น 'กลุ่ม 1' และรายการที่เรียนรวมหลายชั้น"""
        cur = load_curriculum()
        if not cur:
            return jsonify(success=False, message='ไม่พบไฟล์โครงสร้างหลักสูตร'), 404
        with get_db() as con:
            row = con.execute('SELECT * FROM tt_terms WHERE id=?', (term_id,)).fetchone()
            if not row:
                return jsonify(success=False, message='ไม่พบภาคเรียน'), 404
            cfg = jl(row['config'], {})
            tracks_cfg = dict(cfg.get('tracks') or {})
            members = {}      # ชั้น → {แผน: {รหัสทั้งเทอม 1 และ 2}}
            names = {}
            for g, info in cur.get('grades', {}).items():
                for t in info.get('tracks', []):
                    codes = set()
                    for s in t.get('term1', []):
                        codes.add(s['code']); names.setdefault(s['code'], s.get('name'))
                        if s.get('next'):
                            codes.add(s['next']); names.setdefault(s['next'], s.get('next_name'))
                    for s in t.get('term2_only', []):
                        codes.add(s['code']); names.setdefault(s['code'], s.get('name'))
                    members.setdefault(g, {})[t['abbr']] = codes
            for cls in cfg.get('classes', []):
                g = cls.split('/')[0]
                if len(members.get(g, {})) > 1:
                    tracks_cfg[cls] = list(members[g].keys())
            assigned, unknown = 0, []
            for l in con.execute('SELECT * FROM tt_lessons WHERE term_id=?', (term_id,)).fetchall():
                classes = jl(l['classes'], [])
                if not l['code'] or len(classes) != 1 or (l['track'] or '').strip():
                    continue
                trs = members.get(classes[0].split('/')[0], {})
                if len(trs) < 2:
                    continue
                inside = [abbr for abbr, codes in trs.items() if l['code'] in codes]
                if not inside:
                    unknown.append(f"{l['code']} (ม.{classes[0].split('/')[0]})")
                elif len(inside) < len(trs):
                    con.execute('UPDATE tt_lessons SET track=? WHERE id=?', (','.join(inside), l['id']))
                    assigned += 1
            cfg['tracks'] = tracks_cfg
            con.execute('UPDATE tt_terms SET config=? WHERE id=?', (json.dumps(cfg, ensure_ascii=False), term_id))
            # เติมชื่อวิชาที่ยังว่างจากเอกสารหลักสูตร
            for code, name in names.items():
                if not name:
                    continue
                r = con.execute('SELECT name FROM tt_subjects WHERE code=?', (code,)).fetchone()
                if r is None:
                    con.execute('INSERT INTO tt_subjects (code, name, area) VALUES (?,?,?)', (code, name, AREAS.get(code[0], '')))
                elif not (r['name'] or '').strip():
                    con.execute('UPDATE tt_subjects SET name=? WHERE code=?', (name, code))
        return jsonify(success=True, assigned=assigned, unknown=sorted(set(unknown)),
                       message=f'ตั้งสายการเรียนให้ {assigned} รายการ' + (f' · ไม่พบในโครงสร้างหลักสูตร {len(set(unknown))} รหัส' if unknown else ''))

    # ═════════════ ขั้นที่ 3: ร่างภาคเรียนถัดไป + บันทึกผลจัดอัตโนมัติ ═════════════
    def next_code(code):
        """รหัสภาคเรียนถัดไปตามธรรมเนียม: เลขท้ายคี่ +1 (ท21101→ท21102, พ30209→พ30210)"""
        m = re.fullmatch(r'([ก-ฮI])(\d{5})', code or '')
        if not m or int(m.group(2)) % 2 == 0:
            return None
        return f'{m.group(1)}{int(m.group(2)) + 1:05d}'

    def base_name(n):
        return re.sub(r'[\s\d()]+$', '', re.sub(r'\s+', '', n or ''))[:6]

    @app.post('/api/tt/terms/<int:term_id>/draft-next')
    @admin_required
    def tt_draft_next(term_id):
        """สร้างภาคเรียนถัดไปจากภาคเรียนนี้: วิชาเลื่อนรหัสตามโครงสร้างหลักสูตร ครู/ชั้น/สาย/เงื่อนไขเดิม
        กิจกรรมทั้งโรงเรียน (ชุมนุม ลูกเสือ บำเพ็ญฯ ประชุม) คงช่องเดิม + ล็อก / อย่างอื่นรอจัด"""
        b = request.get_json() or {}
        name = str(b.get('name') or '').strip()
        if not re.fullmatch(r'[12]/25\d\d', name):
            return jsonify(success=False, message='ชื่อภาคเรียนต้องเป็นรูปแบบ 2/2569'), 400
        cur = load_curriculum() or {'grades': {}}
        with get_db() as con:
            src = term_payload(con, term_id)
            if not src:
                return jsonify(success=False, message='ไม่พบภาคเรียนต้นทาง'), 404
            if con.execute('SELECT 1 FROM tt_terms WHERE name=?', (name,)).fetchone():
                return jsonify(success=False, message=f'มีภาคเรียน {name} อยู่แล้ว (ลบก่อนถ้าจะร่างใหม่)'), 409

            def grade_maps(g):
                t1, t2 = {}, {}
                for t in cur['grades'].get(str(g), {}).get('tracks', []):
                    for s in t.get('term1', []):
                        t1.setdefault(s['code'], s)
                        if s.get('next'):
                            t2.setdefault(s['next'], dict(code=s['next'], name=s.get('next_name'), hours=s.get('next_hours')))
                    for s in t.get('term2_only', []):
                        t2.setdefault(s['code'], s)
                return t1, t2

            teacher_name = {t['id']: t['name'] for t in src['teachers']}
            rep = dict(check_code=[], changed=[], no_teacher=[], ended=[], uncovered={}, merged=[])
            out = {}          # key → lesson ใหม่ (รวมรายการซ้ำ)
            for l in src['lessons']:
                classes, g = l['classes'], (int(l['classes'][0].split('/')[0]) if l['classes'] else None)
                who = ', '.join(teacher_name.get(t, '') for t in l['teacher_ids'])
                cls_txt = ', '.join('ม.' + c.split('/')[0] for c in classes)
                if l['kind'] != 'subject' or not l['code']:
                    fixed = bool(re.search(r'ชุมนุม|ลูกเสือ|บำเพ็ญ|ประชุม', l['title'] or ''))
                    key = ('act', l['id'])
                    out[key] = dict(src=l, code=l['code'], title=l['title'], kind=l['kind'], classes=classes,
                                    track=l['track'], teacher_ids=l['teacher_ids'], per_week=l['per_week'],
                                    options=l['options'], slots=[s[:2] for s in l['slots']] if fixed else [])
                    continue
                t1, t2 = grade_maps(g) if g else ({}, {})
                code, e1 = l['code'], None
                basic = bool(re.fullmatch(r'[ก-ฮ]\d{2}1\d{2}', code))
                e1 = t1.get(code)
                nc, how = None, ''
                p1 = next_code(code)
                if not basic and e1 and e1.get('next'):
                    nc, how = e1['next'], 'row'
                elif p1 and p1 in t2:
                    nc, how = p1, 'plus'
                elif e1:
                    rep['ended'].append(f"{code} {e1.get('name') or ''} {cls_txt} ({who})".strip())
                    continue
                else:
                    nc, how = (p1 or code), 'guess'
                info = t2.get(nc, {})
                new_name = info.get('name') or ''
                teacher_ids = list(l['teacher_ids'])
                if nc[0] != code[0]:              # เปลี่ยนกลุ่มสาระ (เช่น ว→ง) = คนละวิชา ไม่ส่งต่อครู
                    teacher_ids = []
                    rep['no_teacher'].append(f"{nc} {new_name} {cls_txt} (แทน {code} ของ{who})")
                elif how == 'row' and e1 and base_name(e1.get('name')) and base_name(new_name) \
                        and base_name(e1.get('name')) != base_name(new_name):
                    rep['changed'].append(f"{code} {e1.get('name')} → {nc} {new_name} {cls_txt} ครูเดิม: {who}")
                if how == 'guess':
                    rep['check_code'].append(f"{code} → {nc} {cls_txt} ({who}) — ไม่พบในโครงสร้างหลักสูตร")
                pw = l['per_week']
                h1, h2 = (e1 or {}).get('hours'), info.get('hours')
                if h1 and h2 and h2 in (20, 40, 60, 80, 100, 120) and round(h1 / 20) == pw:
                    pw = int(h2 // 20)
                key = (nc, tuple(classes), l['track'] or '', tuple(sorted(teacher_ids)) if teacher_ids else ('none', l['id']))
                if key in out:
                    out[key]['per_week'] += pw
                    rep['merged'].append(f"{nc} {cls_txt} ({who}) รวมเป็น {out[key]['per_week']} คาบ")
                else:
                    out[key] = dict(src=l, code=nc, title='', kind='subject', classes=classes, track=l['track'],
                                    teacher_ids=teacher_ids, per_week=pw, options=l['options'], slots=[], name=new_name)
            # วิชาในหลักสูตรภาคเรียนถัดไปที่ยังไม่มีในร่าง (ไม่นับ หน้าที่พลเมือง/สุจริตศึกษา/ศาสนา ที่สอนรวมในกิจกรรม)
            made = {(v['classes'][0].split('/')[0] if v['classes'] else '', v['code']) for v in out.values() if v['code']}
            for g in sorted(cur['grades']):
                _, t2 = grade_maps(g)
                miss = []
                for c, e in t2.items():
                    if (g, c) in made or re.match(r'(หน้าที่พลเมือง|สุจริตศึกษา|ศาสนา)', e.get('name') or ''):
                        continue
                    tr = [t['abbr'] for t in cur['grades'][g]['tracks']
                          if any(s.get('next') == c or s['code'] == c for s in t.get('term1', []) + t.get('term2_only', []))]
                    miss.append(dict(code=c, name=e.get('name') or '', hours=e.get('hours'), grade=int(g),
                                     tracks=tr if len(tr) < len(cur['grades'][g]['tracks']) else []))
                if miss:
                    rep['uncovered'][g] = miss

            cfg = dict(src['term']['config'])
            new_id = con.execute('INSERT INTO tt_terms (name, config, published, note) VALUES (?,?,?,?)',
                                 (name, json.dumps(cfg, ensure_ascii=False), 0,
                                  json.dumps(dict(draft_from=src['term']['name'], report=rep), ensure_ascii=False))).lastrowid
            for v in out.values():
                if v['code']:
                    save_subject_name(con, v['code'], v.get('name') or None) if v.get('name') else None
                    if not con.execute('SELECT 1 FROM tt_subjects WHERE code=?', (v['code'],)).fetchone():
                        con.execute('INSERT INTO tt_subjects (code, name, area) VALUES (?,?,?)', (v['code'], '', AREAS.get(v['code'][0], '')))
                note = 'ยังไม่กำหนดครู' if (v['kind'] == 'subject' and not v['teacher_ids']) else ''
                lid = con.execute("""INSERT INTO tt_lessons (term_id, code, title, kind, classes, track, teacher_ids, per_week, options, note)
                                     VALUES (?,?,?,?,?,?,?,?,?,?)""",
                                  (new_id, v['code'], v['title'], v['kind'], json.dumps(v['classes']), v['track'],
                                   json.dumps(v['teacher_ids']), v['per_week'], json.dumps(v['options'] or {}), note)).lastrowid
                for d, p in v['slots']:
                    con.execute('INSERT OR IGNORE INTO tt_slots (lesson_id, day, period, locked) VALUES (?,?,?,1)', (lid, d, p))
        n_sub = sum(1 for v in out.values() if v['kind'] == 'subject')
        return jsonify(success=True, term_id=new_id, report=rep,
                       message=f'สร้างร่างภาคเรียน {name} แล้ว: รายวิชา {n_sub} รายการ + กิจกรรม {len(out) - n_sub} รายการ')

    @app.post('/api/tt/terms/<int:term_id>/slots-bulk')
    @admin_required
    def tt_slots_bulk(term_id):
        """บันทึกผลจัดอัตโนมัติ: {lessons: {lesson_id: [[d,p],...]}} แทนที่ช่องที่ไม่ได้ล็อกของรายการนั้น"""
        data = (request.get_json() or {}).get('lessons') or {}
        with get_db() as con:
            ids = {r['id'] for r in con.execute('SELECT id FROM tt_lessons WHERE term_id=?', (term_id,))}
            n = 0
            for lid, slots in data.items():
                lid = int(lid)
                if lid not in ids:
                    continue
                con.execute('DELETE FROM tt_slots WHERE lesson_id=? AND locked=0', (lid,))
                for d, p in slots:
                    if 1 <= int(d) <= 7 and 1 <= int(p) <= 12:
                        con.execute('INSERT OR IGNORE INTO tt_slots (lesson_id, day, period) VALUES (?,?,?)', (lid, int(d), int(p)))
                        n += 1
        return jsonify(success=True, placed=n)
