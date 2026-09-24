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


def init(app, get_db, login_required, admin_required, current_user, get_settings):
    from flask import jsonify, request

    with get_db() as con:
        con.executescript(SCHEMA)

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
                lid = con.execute("""INSERT INTO tt_lessons (term_id, code, title, kind, classes, track, teacher_ids, per_week)
                                     VALUES (?,?,?,?,?,?,?,?)""",
                                  (term_id, code, l.get('title', ''), l.get('kind', 'subject'),
                                   json.dumps(l['classes']), l.get('track', ''),
                                   json.dumps([tid[t] for t in l['teachers']]), len(l['slots']))).lastrowid
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
