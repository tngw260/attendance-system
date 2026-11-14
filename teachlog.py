"""
บันทึกหลังสอน (ตามตารางสอน) — ครูกรอกตามวัน-คาบที่สอนจริง พิมพ์ได้ · ฝ่ายวิชาการดูสรุป รับทราบรายสัปดาห์ และพิมพ์ใบสรุป

แบบบันทึก = แบบท้ายแผนการจัดการเรียนรู้ของโรงเรียน
  หน่วย / แผนที่ / เรื่องที่สอน
  1. ผลการสอน            สอนได้ตามแผน / สอนไม่ได้ตามแผน เนื่องจาก … / ไม่มีการเรียนการสอน (สอบ กิจกรรม ฯลฯ) เนื่องจาก …
  2. ผลการจัดการเรียนรู้   K P A — ข้อความ + จำนวนผู้ผ่านเกณฑ์ (ร้อยละคิดจากจำนวนนักเรียน)
  3. ปัญหาและอุปสรรค      ติ๊ก 3 ข้อของแบบฟอร์ม + อื่น ๆ
  4. ข้อเสนอแนะ/แนวทางแก้ไข ควรนำแผนไปปรับปรุง เรื่อง … / แนวทางแก้ไขนักเรียนที่ไม่ผ่าน … / ไม่มีข้อเสนอแนะ

"ครั้งที่สอน" (session) คิดจากตารางสอนของภาคเรียน ด้วยกติกาเดียวกับหน้าสอนแทน
  • เฉพาะรายวิชา (kind='subject' และมีรหัสวิชา) — ไม่รวมชุมนุม ลูกเสือ แนะแนว PLC ประชุม
  • คาบติดกันของรายการเดียวกันในวันเดียว = 1 ครั้ง (1 บันทึก)
  • วันหยุด (holidays.type='holiday') ไม่มีครั้งที่สอน · วันสอนชดเชยใช้ตารางของวันที่ตั้งไว้ (tt_day)
  • ครูไม่มา + มีครูสอนแทนที่อนุมัติแล้ว → ครั้งนั้นเป็นของครูสอนแทน (kind sub / swap)
    ฝากรวมสาย (ครูสอนแทนสอนสายอื่นของห้องเดียวกันอยู่ในคาบนั้น) → ไม่ต้องบันทึกแยก (รวมอยู่ในบันทึกของครูคนนั้น)
    ครูไม่มาและยังไม่มีใครสอนแทน → ไม่ต้องบันทึก (แสดงเป็น "ไม่ได้สอน")
  • ครูร่วมสอนหลายคนในรายการเดียว ใช้บันทึกร่วมกัน 1 ฉบับ

ตาราง
  tl_logs   บันทึก 1 ครั้งที่สอน (date + lesson_id + period_from ไม่ซ้ำ) เก็บรหัสวิชา/ชั้นไว้ด้วย → ประวัติไม่หายเมื่อแก้ตาราง
  tl_acks   ฝ่ายวิชาการรับทราบ รายครู-รายสัปดาห์ (week = วันจันทร์ของสัปดาห์) + ข้อเสนอแนะ · รับทราบแล้วครูแก้ไม่ได้
  tl_links  ลิงก์ส่วนตัวรายครู /tl/<รหัส> — ครูที่ยังไม่มีบัญชีใช้กรอกของตัวเองได้โดยไม่ต้องล็อกอิน

สิทธิ์: ครู = ของตัวเอง (บัญชีที่ผูกกับครูในตารางสอน หรือลิงก์ส่วนตัว) · แอดมิน + ผู้ช่วยจัดตาราง = ดูทุกคน รับทราบ ออกลิงก์ พิมพ์สรุป
"""
import datetime
import json
import re
import secrets

from timetable import DATE_RE, jl, term_dates, tt_day

SCHEMA = """
CREATE TABLE IF NOT EXISTS tl_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    term          TEXT NOT NULL,
    date          TEXT NOT NULL,
    lesson_id     INTEGER NOT NULL,
    period_from   INTEGER NOT NULL,
    period_to     INTEGER NOT NULL,
    teacher_id    INTEGER,                    -- ครูที่บันทึกล่าสุด
    teacher_name  TEXT DEFAULT '',
    kind          TEXT DEFAULT 'own',         -- own / sub (สอนแทน) / swap (แลกคาบ)
    code          TEXT DEFAULT '',
    title         TEXT DEFAULT '',
    class_label   TEXT DEFAULT '',
    unit          TEXT DEFAULT '',
    plan_no       TEXT DEFAULT '',
    topic         TEXT DEFAULT '',
    taught        TEXT DEFAULT 'plan',        -- plan / not / none
    reason        TEXT DEFAULT '',
    total         INTEGER,
    present       INTEGER,
    k_text        TEXT DEFAULT '',
    k_pass        INTEGER,
    p_text        TEXT DEFAULT '',
    p_pass        INTEGER,
    a_text        TEXT DEFAULT '',
    a_pass        INTEGER,
    problems      TEXT DEFAULT '[]',
    problem_other TEXT DEFAULT '',
    improve       TEXT DEFAULT '',
    remedy        TEXT DEFAULT '',
    created_at    TEXT,
    updated_at    TEXT,
    UNIQUE(date, lesson_id, period_from)
);
CREATE INDEX IF NOT EXISTS idx_tl_logs_date ON tl_logs(date);
CREATE TABLE IF NOT EXISTS tl_acks (
    teacher_id  INTEGER NOT NULL,
    week        TEXT NOT NULL,               -- วันจันทร์ของสัปดาห์
    comment     TEXT DEFAULT '',
    ack_by      TEXT DEFAULT '',
    ack_at      TEXT,
    PRIMARY KEY (teacher_id, week)
);
CREATE TABLE IF NOT EXISTS tl_links (
    token       TEXT PRIMARY KEY,
    teacher_id  INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tl_links_teacher ON tl_links(teacher_id);
"""

PROBLEMS = [                                     # ข้อ 3 ของแบบฟอร์ม (ลำดับตามแบบ)
    ('time', 'กิจกรรมการจัดการเรียนรู้ ไม่เหมาะสมกับเวลา'),
    ('late', 'มีนักเรียนทำใบงาน/ใบกิจกรรมไม่ทันตามกำหนดเวลา'),
    ('inattentive', 'มีนักเรียนที่ไม่สนใจเรียน'),
]
PROBLEM_KEYS = [k for k, _ in PROBLEMS]
TAUGHT = ('plan', 'not', 'none')
KIND_LABEL = {'own': '', 'sub': 'สอนแทน', 'swap': 'แลกคาบ'}
TEXT_FIELDS = (('unit', 150), ('plan_no', 20), ('topic', 300), ('reason', 500), ('k_text', 600), ('p_text', 600),
               ('a_text', 600), ('problem_other', 600), ('improve', 600), ('remedy', 600))
DAY = datetime.timedelta(days=1)


def monday(d):
    """วันจันทร์ของสัปดาห์ที่มีวันที่ d (date หรือ 'YYYY-MM-DD') → 'YYYY-MM-DD'"""
    if isinstance(d, str):
        d = datetime.date.fromisoformat(d)
    return (d - datetime.timedelta(days=d.isoweekday() - 1)).isoformat()


def term_weeks(start, end):
    """สัปดาห์ของภาคเรียน [{no, start, end}] — สัปดาห์ที่ 1 = สัปดาห์แรกที่มีวันจันทร์-ศุกร์อยู่ในภาคเรียน"""
    s, e = datetime.date.fromisoformat(start), datetime.date.fromisoformat(end)
    if s.isoweekday() > 5:                       # เปิดเทอมวันเสาร์-อาทิตย์ → เริ่มนับจันทร์ถัดไป
        s += datetime.timedelta(days=8 - s.isoweekday())
    m = datetime.date.fromisoformat(monday(s))
    out, no = [], 1
    while m <= e:
        out.append(dict(no=no, start=m.isoformat(), end=(m + 6 * DAY).isoformat()))
        m += 7 * DAY
        no += 1
    return out


def pct(n, total):
    return round(n * 100 / total, 2) if total else None


def build_sessions(con, settings, d_from, d_to):
    """ครั้งที่สอนรายวิชาทุกครั้งระหว่างวันที่ (รวมปลายทั้งสอง) → list ของ dict เรียงตามวัน-คาบ
    teachers = ครูที่ต้องบันทึกครั้งนั้น (ว่าง = ไม่ต้องบันทึก ดู excuse) · owners = ครูเจ้าของวิชาตามตาราง"""
    names = {r['id']: r['name'] for r in con.execute('SELECT id, name FROM tt_teachers')}
    subj = {r['code']: r['name'] or '' for r in con.execute('SELECT code, name FROM tt_subjects')}
    terms = []
    for r in con.execute('SELECT * FROM tt_terms ORDER BY published DESC, id DESC').fetchall():
        f, t = term_dates(r['name'], settings)
        if f and not (t < d_from or f > d_to):
            terms.append((f, t, r))
    if not terms:
        return []
    grid = {}                                    # term_id → {วัน: [(คาบ, รายการ)]} ทุกชนิด (ใช้ดูฝากรวมสายด้วย)
    cfgs = {}
    for _, _, term in terms:
        cfg = jl(term['config'], {})
        cfgs[term['id']] = dict(times={p['no']: p for p in cfg.get('periods', [])},
                                one_room=all(c.endswith('/1') for c in cfg.get('classes', [])))
        g = grid.setdefault(term['id'], {})
        for l in con.execute("""SELECT l.id, l.code, l.title, l.kind, l.classes, l.track, l.teacher_ids, s.day, s.period
                                FROM tt_lessons l JOIN tt_slots s ON s.lesson_id=l.id WHERE l.term_id=?
                                ORDER BY s.period, l.id""", (term['id'],)).fetchall():
            d = dict(l)
            d['classes'], d['teacher_ids'] = jl(d['classes'], []), jl(d['teacher_ids'], [])
            g.setdefault(l['day'], []).append((l['period'], d))
    hol = {r['date']: dict(r) for r in con.execute('SELECT date, name, type FROM holidays WHERE date BETWEEN ? AND ?', (d_from, d_to))}
    absences = [dict(r, periods=jl(r['periods'], [])) for r in con.execute(
        'SELECT teacher_id, date_from, date_to, periods, reason FROM tt_absences WHERE date_from<=? AND date_to>=?', (d_to, d_from))]
    subs = {(r['date'], r['period'], r['lesson_id']): r for r in con.execute(
        "SELECT * FROM tt_subs WHERE date BETWEEN ? AND ? AND status='approved' AND sub_id IS NOT NULL", (d_from, d_to))}
    backs = {(r['swap_date'], r['swap_period'], r['swap_lesson_id']): r for r in con.execute(
        "SELECT * FROM tt_subs WHERE kind='swap' AND status='approved' AND swap_date BETWEEN ? AND ?", (d_from, d_to))}

    def away(tid, date, p):
        for a in absences:
            if a['teacher_id'] == tid and a['date_from'] <= date <= a['date_to'] and (not a['periods'] or p in a['periods']):
                return a['reason'] or 'ไม่มา'
        return ''

    out = []
    d, last = datetime.date.fromisoformat(d_from), datetime.date.fromisoformat(d_to)
    while d <= last:
        date = d.isoformat()
        d += DAY
        term = next((r for f, t, r in terms if f <= date <= t), None)
        h = hol.get(date)
        if not term or (h and h['type'] == 'holiday'):
            continue
        wd = tt_day(con, date)
        if wd > 5:
            continue
        day = grid[term['id']].get(wd, [])
        cfg = cfgs[term['id']]
        cells = {}                                # lesson_id → [(คาบ, ผู้รับผิดชอบ, ชนิด, หมายเหตุ)]
        for p, l in day:
            if l['kind'] != 'subject' or not l['code']:
                continue
            key = (date, p, l['id'])
            s, bk = subs.get(key), backs.get(key)
            if s:
                merged = any(q == p and o['id'] != l['id'] and s['sub_id'] in o['teacher_ids'] and set(o['classes']) & set(l['classes'])
                             for q, o in day)
                if merged:                        # ฝากรวมสาย: นักเรียนไปเรียนรวมกับสายของครูคนนั้น
                    cell = ((), 'merge', f"ฝากรวมสายกับครู{names.get(s['sub_id'], '')}")
                else:
                    cell = ((s['sub_id'],), 'swap' if s['kind'] == 'swap' else 'sub', '')
            elif bk:                              # ครูที่ขอแลกคาบ มาสอนคืนในคาบนี้
                cell = ((bk['absent_id'],), 'swap', '')
            else:
                gone = {t: away(t, date, p) for t in l['teacher_ids']}
                here = tuple(t for t in l['teacher_ids'] if not gone[t])
                cell = (here, 'own', '') if here else ((), 'away', next((v for v in gone.values() if v), 'ไม่มา'))
            cells.setdefault(l['id'], dict(l=l, items=[]))['items'].append((p,) + cell)
        for v in cells.values():
            l, run = v['l'], []
            for it in sorted(v['items']) + [None]:
                if run and (it is None or it[0] != run[-1][0] + 1 or it[1:] != run[-1][1:]):
                    pf, pt = run[0][0], run[-1][0]
                    a, b = cfg['times'].get(pf, {}), cfg['times'].get(pt, {})
                    cls = ', '.join('ม.' + (c.split('/')[0] if cfg['one_room'] else c) for c in l['classes'])
                    out.append(dict(
                        key=f"{date}|{l['id']}|{pf}", date=date, wd=wd, term=term['name'], lesson_id=l['id'],
                        pf=pf, pt=pt, period=str(pf) if pf == pt else f'{pf}-{pt}', periods=pt - pf + 1,
                        time=f"{a.get('start', '')}-{b.get('end', '')}" if a and b else '',
                        code=l['code'], title=l['title'] or subj.get(l['code'], ''), classes=l['classes'], track=l['track'] or '',
                        class_label=cls + (f" ({l['track']})" if l['track'] else ''),
                        owners=l['teacher_ids'], teachers=list(run[0][1]), kind=run[0][2], excuse=run[0][3],
                        teacher_names=[names.get(t, '') for t in run[0][1]],
                        holiday=dict(name=h['name'], type=h['type']) if h else None))
                    run = []
                if it is not None:
                    run.append(it)
    out.sort(key=lambda x: (x['date'], x['pf'], x['lesson_id']))
    return out


def log_dict(r, full=True):
    d = dict(id=r['id'], date=r['date'], lesson_id=r['lesson_id'], pf=r['period_from'], pt=r['period_to'],
             teacher_id=r['teacher_id'], teacher_name=r['teacher_name'], kind=r['kind'], topic=r['topic'], taught=r['taught'],
             reason=r['reason'], updated_at=r['updated_at'], created_at=r['created_at'])
    if full:
        for k in ('term', 'code', 'title', 'class_label', 'unit', 'plan_no', 'total', 'present', 'k_text', 'k_pass',
                  'p_text', 'p_pass', 'a_text', 'a_pass', 'problem_other', 'improve', 'remedy'):
            d[k] = r[k]
        d['problems'] = jl(r['problems'], [])
    return d


def init(app, get_db, login_required, current_user, get_settings):
    from flask import g, jsonify, request, send_from_directory

    with get_db() as con:
        con.executescript(SCHEMA)

    def bad(msg, code=400):
        return jsonify(success=False, message=msg), code

    def now():
        return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    def today():
        return datetime.date.today().isoformat()

    def clean(s, n):
        s = re.sub(r'[ \t]+', ' ', str(s or '')).strip()
        return re.sub(r'\n{3,}', '\n\n', s)[:n]

    def can_manage(u):
        if not u:
            return False
        if u['role'] == 'admin':
            return True
        with get_db() as con:
            return bool(con.execute('SELECT 1 FROM tt_editors WHERE user_id=?', (u['id'],)).fetchone())

    # ── ตัวตน: บัญชีที่ล็อกอิน หรือ ลิงก์ส่วนตัว (หัว X-TL-Key) ─────────────
    def who():
        """→ (ตัวตน, ข้อผิดพลาด) · ตัวตน = dict(tid, name, manage, link)"""
        key = request.headers.get('X-TL-Key', '')
        if key:
            with get_db() as con:
                r = con.execute('SELECT l.teacher_id, t.name FROM tl_links l JOIN tt_teachers t ON t.id=l.teacher_id '
                                'WHERE l.token=? AND l.revoked_at IS NULL', (key[:64],)).fetchone()
            if not r:
                return None, bad('ลิงก์นี้ใช้ไม่ได้แล้ว (อาจมีการออกลิงก์ใหม่) — ขอลิงก์ล่าสุดจากฝ่ายวิชาการ', 404)
            return dict(tid=r['teacher_id'], name=r['name'], manage=False, link=True), None
        u = current_user()
        if not u:
            return None, (jsonify(error='unauthorized'), 401)
        with get_db() as con:
            me = con.execute('SELECT id, name FROM tt_teachers WHERE user_id=?', (u['id'],)).fetchone()
        return dict(tid=me['id'] if me else None, name=me['name'] if me else u['full_name'], manage=can_manage(u),
                    link=False, user=u['full_name']), None

    def ident(fn):
        from functools import wraps

        @wraps(fn)
        def wrapper(*a, **kw):
            me, err = who()
            if err:
                return err
            g.tl = me
            return fn(*a, **kw)
        return wrapper

    def target_teacher():
        """ครูที่กำลังดู: ?teacher_id= (เฉพาะฝ่ายวิชาการดูคนอื่นได้) ไม่ระบุ = ตัวเอง → (id, ข้อผิดพลาด)"""
        me = g.tl
        raw = request.args.get('teacher_id') or (request.get_json(silent=True) or {}).get('teacher_id')
        try:
            tid = int(raw) if raw not in (None, '') else me['tid']
        except (TypeError, ValueError):
            return None, bad('ระบุครูไม่ถูกต้อง')
        if not tid:
            return None, bad('บัญชีนี้ยังไม่ได้ผูกกับครูในตารางสอน', 404)
        if tid != me['tid'] and not me['manage']:
            return None, bad('ดูได้เฉพาะบันทึกของตัวเอง', 403)
        return tid, None

    def cur_term(con, settings, name=''):
        """ภาคเรียนที่ใช้: ระบุชื่อ → ตามนั้น · ไม่ระบุ → ภาคเรียนของวันนี้ ไม่มีก็ภาคเรียนล่าสุดที่เริ่มแล้ว → (ชื่อ, เริ่ม, จบ)"""
        t, best = today(), None
        for r in con.execute('SELECT name FROM tt_terms ORDER BY published DESC, id DESC').fetchall():
            f, e = term_dates(r['name'], settings)
            if not f:
                continue
            if name:
                if r['name'] == name:
                    return name, f, e
                continue
            if f <= t <= e:
                return r['name'], f, e
            if f <= t and (not best or f > best[1]):
                best = (r['name'], f, e)
        return best or ('', '', '')

    def logs_between(con, d_from, d_to):
        """บันทึกในช่วงวันที่ → {(date, lesson_id): [แถว]}"""
        out = {}
        for r in con.execute('SELECT * FROM tl_logs WHERE date BETWEEN ? AND ? ORDER BY period_from', (d_from, d_to)):
            out.setdefault((r['date'], r['lesson_id']), []).append(r)
        return out

    def find_log(logs, s):
        """บันทึกของครั้งที่สอน s — ตรงคาบเริ่มก่อน ไม่ตรง (ตาราง/สอนแทนเปลี่ยนภายหลัง) ใช้ฉบับที่คาบซ้อนกัน"""
        rows = logs.get((s['date'], s['lesson_id']), [])
        return (next((r for r in rows if r['period_from'] == s['pf']), None)
                or next((r for r in rows if r['period_from'] <= s['pt'] and r['period_to'] >= s['pf']), None))

    def acks_of(con, tid=None):
        q = 'SELECT * FROM tl_acks' + (' WHERE teacher_id=?' if tid else '')
        return {(r['teacher_id'], r['week']): dict(r) for r in con.execute(q, (tid,) if tid else ())}

    def state_of(s, log, t):
        """สถานะของครั้งที่สอน: done / todo (ถึงวันแล้วยังไม่บันทึก) / future"""
        return 'done' if log else 'todo' if s['date'] <= t else 'future'

    def brief(s, log, tid, t):
        """ครั้งที่สอน 1 แถวสำหรับหน้ารายการ (มุมมองของครู tid)"""
        mine = tid in s['teachers']
        d = {k: s[k] for k in ('key', 'date', 'wd', 'lesson_id', 'pf', 'pt', 'period', 'time', 'code', 'title',
                               'class_label', 'kind', 'holiday')}
        d['mine'] = mine
        if mine:
            d['state'] = state_of(s, log, t)
            d['note'] = KIND_LABEL.get(s['kind'], '')
        else:                                     # คาบของตัวเองที่ไม่ได้สอนเอง
            d['state'] = 'off'
            d['note'] = s['excuse'] or ' '.join('ครู' + n for n in s['teacher_names']) + (' มาสอนคืน (แลกคาบ)' if s['kind'] == 'swap' else ' สอนแทน')
        if log:
            d['log'] = log_dict(log, full=False)
        return d

    def student_counts(con, s):
        """จำนวนนักเรียนตามทะเบียน (ไม่นับเรียนยืดหยุ่น) + จำนวนมาเรียนจากการเช็กชื่อวันนั้น (ยังไม่เช็ก = None)"""
        total, present, checked = 0, 0, True
        for c in s['classes']:
            m = re.fullmatch(r'(\d)/(\d+)', c)
            if not m:
                continue
            ids = [r['id'] for r in con.execute('SELECT id FROM students WHERE class_level=? AND room=? AND COALESCE(flexible,0)=0',
                                                (int(m.group(1)), int(m.group(2))))]
            total += len(ids)
            if not ids:
                continue
            qs = ','.join('?' * len(ids))
            rows = con.execute(f'SELECT status, COUNT(*) n FROM attendance WHERE date=? AND student_id IN ({qs}) GROUP BY status',
                               [s['date']] + ids).fetchall()
            if not rows:
                checked = False
            present += sum(r['n'] for r in rows if r['status'] in ('present', 'late', 'activity'))
        return total or None, (present if checked and total else None)

    def find_session(con, settings, date, lesson_id, pf):
        if not DATE_RE.match(date or ''):
            return None
        return next((s for s in build_sessions(con, settings, date, date) if s['lesson_id'] == lesson_id and s['pf'] == pf), None)

    def locked(con, tid, date):
        return con.execute('SELECT 1 FROM tl_acks WHERE teacher_id=? AND week=?', (tid, monday(date))).fetchone() is not None

    def link_of(con, tid, renew=False):
        row = con.execute('SELECT * FROM tl_links WHERE teacher_id=? AND revoked_at IS NULL ORDER BY created_at DESC', (tid,)).fetchone()
        if row and renew:
            con.execute('UPDATE tl_links SET revoked_at=? WHERE teacher_id=? AND revoked_at IS NULL', (now(), tid))
            row = None
        if not row:
            tok = secrets.token_urlsafe(16)
            con.execute('INSERT INTO tl_links (token, teacher_id, created_at) VALUES (?,?,?)', (tok, tid, now()))
            return tok
        return row['token']

    def signers(con, settings, term_name):
        t = con.execute('SELECT config FROM tt_terms WHERE name=?', (term_name,)).fetchone()
        ac = (jl(t['config'], {}).get('signers') or [{}])[0] if t else {}
        return dict(academic=dict(name=ac.get('name', ''), title=ac.get('title') or 'หัวหน้ากลุ่มบริหารงานวิชาการ'),
                    director=dict(name=settings.get('director_name', ''),
                                  title=(settings.get('director_title') or 'ผู้อำนวยการ') + (settings.get('school_name') or '')))

    # ── หน้าเว็บทางลิงก์ส่วนตัว ─────────────────────────────
    @app.get('/tl/<token>')
    def tl_link_page(token):
        resp = send_from_directory(app.static_folder, 'teaching-log.html')
        resp.headers['Cache-Control'] = 'no-store'
        resp.headers['Referrer-Policy'] = 'no-referrer'          # ไม่ส่งรหัสลิงก์ต่อไปยังเว็บอื่น
        return resp

    # ── ข้อมูลตั้งต้น ───────────────────────────────────────
    @app.get('/api/tl/me')
    @ident
    def tl_me():
        me, s = g.tl, get_settings()
        with get_db() as con:
            name, f, e = cur_term(con, s, request.args.get('term', ''))
            terms = [r['name'] for r in con.execute('SELECT name FROM tt_terms ORDER BY id DESC') if term_dates(r['name'], s)[0]]
            teachers = []
            if me['manage'] and name:
                used = set()
                for r in con.execute("SELECT l.teacher_ids FROM tt_lessons l JOIN tt_terms t ON t.id=l.term_id "
                                     "WHERE t.name=? AND l.kind='subject' AND l.code<>''", (name,)):
                    used.update(jl(r['teacher_ids'], []))
                teachers = [dict(id=r['id'], name=r['name']) for r in con.execute(
                    'SELECT id, name FROM tt_teachers WHERE active=1 ORDER BY sort_order, id') if r['id'] in used]
        return jsonify(me=me, term=dict(name=name, start=f, end=e), terms=terms, today=today(),
                       weeks=term_weeks(f, e) if f else [], teachers=teachers, school=s.get('school_name') or '',
                       problems=PROBLEMS)

    # ── รายการของครู 1 คน: ทั้งภาคเรียน (สถิติ + คาบค้าง) และสัปดาห์ที่เลือก ─────
    @app.get('/api/tl/week')
    @ident
    def tl_week():
        tid, err = target_teacher()
        if err:
            return err
        s, t = get_settings(), today()
        with get_db() as con:
            name, f, e = cur_term(con, s, request.args.get('term', ''))
            if not f:
                return bad('ยังไม่มีภาคเรียนในตารางสอน', 404)
            start = request.args.get('start', '')
            start = monday(start) if DATE_RE.match(start) else monday(min(max(t, f), e))
            end = (datetime.date.fromisoformat(start) + 6 * DAY).isoformat()
            ses = [x for x in build_sessions(con, s, f, e) if tid in x['teachers'] or tid in x['owners']]
            logs = logs_between(con, f, e)
            acks = acks_of(con, tid)
            tname = con.execute('SELECT name FROM tt_teachers WHERE id=?', (tid,)).fetchone()
            rows, per_week, pending, lessons = [], {}, [], {}
            for x in ses:
                log = find_log(logs, x)
                b = brief(x, log, tid, t)
                wk = monday(x['date'])
                if b['mine'] and x['kind'] == 'own':          # รายวิชาของครู (ใช้เลือกพิมพ์เล่มรายวิชา)
                    lessons.setdefault(x['lesson_id'], dict(id=x['lesson_id'], code=x['code'], title=x['title'],
                                                            class_label=x['class_label']))
                if b['mine'] and b['state'] != 'future':
                    c = per_week.setdefault(wk, dict(should=0, done=0))
                    c['should'] += 1
                    c['done'] += b['state'] == 'done'
                    if b['state'] == 'todo':
                        pending.append(b)
                if start <= x['date'] <= end:
                    rows.append(b)
            hol = [dict(r) for r in con.execute('SELECT date, name, type FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', (start, end))]
        should = sum(c['should'] for c in per_week.values())
        done = sum(c['done'] for c in per_week.values())
        ack = acks.get((tid, start))
        return jsonify(teacher=dict(id=tid, name=tname['name'] if tname else ''), term=name, start=start, end=end,
                       sessions=rows, holidays=hol, ack=ack, pending=pending[-60:], pending_count=len(pending),
                       lessons=sorted(lessons.values(), key=lambda v: (v['class_label'], v['code'])),
                       stats=dict(should=should, done=done, percent=pct(done, should)),
                       weeks={k: dict(v, ack=(tid, k) in acks) for k, v in per_week.items()})

    # ── บันทึก 1 ครั้งที่สอน ─────────────────────────────────
    def args_key(src):
        try:
            return str(src.get('date') or ''), int(src.get('lesson_id')), int(src.get('pf'))
        except (TypeError, ValueError):
            return None

    @app.get('/api/tl/log')
    @ident
    def tl_log():
        tid, err = target_teacher()
        if err:
            return err
        k = args_key(request.args)
        if not k:
            return bad('ระบุวันที่/รายการ/คาบ')
        with get_db() as con:
            x = find_session(con, get_settings(), *k)
            if not x or (tid not in x['teachers'] and tid not in x['owners']):
                return bad('ไม่พบคาบสอนนี้ในตารางสอน', 404)
            log = find_log(logs_between(con, k[0], k[0]), x)
            total, present = student_counts(con, x)
            prev = con.execute('SELECT * FROM tl_logs WHERE lesson_id=? AND date<? ORDER BY date DESC, period_from DESC LIMIT 1',
                               (x['lesson_id'], x['date'])).fetchone()
            if prev and prev['total']:
                total = prev['total']                 # ห้องที่แยกสาย: ใช้จำนวนที่ครูกรอกครั้งก่อน
            can = tid in x['teachers'] and tid == g.tl['tid'] and x['date'] <= today() and not locked(con, tid, x['date'])
        return jsonify(session=x, log=log_dict(log) if log else None, can_edit=can,
                       locked=bool(log) and not can and tid in x['teachers'] and x['date'] <= today(),
                       prefill=dict(total=total, present=present, prev=log_dict(prev) if prev else None))

    @app.put('/api/tl/log')
    @ident
    def tl_log_save():
        me, b = g.tl, request.get_json(silent=True) or {}
        k = args_key(b)
        if not k or not me['tid']:
            return bad('ระบุวันที่/รายการ/คาบ')
        tid = me['tid']
        with get_db() as con:
            x = find_session(con, get_settings(), *k)
            if not x or tid not in x['teachers']:
                return bad('คาบนี้ไม่ใช่คาบที่คุณต้องบันทึก', 403)
            if x['date'] > today():
                return bad('ยังไม่ถึงวันที่สอน')
            if locked(con, tid, x['date']):
                return bad('ฝ่ายวิชาการรับทราบสัปดาห์นี้แล้ว — ติดต่อฝ่ายวิชาการหากต้องแก้ไข', 409)
            v = {f: clean(b.get(f), n) for f, n in TEXT_FIELDS}
            taught = b.get('taught') if b.get('taught') in TAUGHT else 'plan'
            if taught != 'plan' and not v['reason']:
                return bad('ระบุเหตุผลที่สอนไม่ได้ตามแผน / ไม่มีการเรียนการสอน')
            if taught == 'plan':
                v['reason'] = ''
            if taught != 'none' and not v['topic']:
                return bad('ระบุเรื่องที่สอน')

            def num(f, top=None):
                raw = b.get(f)
                if raw in (None, ''):
                    return None
                n = int(raw)
                if n < 0 or n > 500 or (top is not None and n > top):
                    raise ValueError(f)
                return n
            try:
                total = num('total')
                present = num('present', total)
                kpa = [num(f, total) for f in ('k_pass', 'p_pass', 'a_pass')]
            except (TypeError, ValueError):
                return bad('จำนวนนักเรียนไม่ถูกต้อง (จำนวนมาเรียน/ผ่านเกณฑ์ ต้องไม่เกินจำนวนนักเรียน)')
            if taught == 'none':
                kpa = [None, None, None]
                for f in ('k_text', 'p_text', 'a_text'):
                    v[f] = ''
            probs = [p for p in PROBLEM_KEYS if p in (b.get('problems') or [])]
            log = find_log(logs_between(con, k[0], k[0]), x)
            vals = dict(v, term=x['term'], period_to=x['pt'], teacher_id=tid, teacher_name=me['name'],
                        kind=x['kind'] if x['kind'] in KIND_LABEL else 'own', code=x['code'], title=x['title'],
                        class_label=x['class_label'], taught=taught, total=total, present=present, k_pass=kpa[0],
                        p_pass=kpa[1], a_pass=kpa[2], problems=json.dumps(probs), updated_at=now())
            if log:
                con.execute(f"UPDATE tl_logs SET period_from=?, {', '.join(c + '=?' for c in vals)} WHERE id=?",
                            [x['pf']] + list(vals.values()) + [log['id']])
            else:
                vals.update(date=x['date'], lesson_id=x['lesson_id'], period_from=x['pf'], created_at=now())
                con.execute(f"INSERT INTO tl_logs ({', '.join(vals)}) VALUES ({', '.join('?' * len(vals))})", list(vals.values()))
        return jsonify(success=True, message='บันทึกหลังสอนแล้ว')

    @app.delete('/api/tl/log')
    @ident
    def tl_log_delete():
        me, k = g.tl, args_key(request.args)
        if not k or not me['tid']:
            return bad('ระบุวันที่/รายการ/คาบ')
        with get_db() as con:
            x = find_session(con, get_settings(), *k)
            if not x or me['tid'] not in x['teachers']:
                return bad('ลบได้เฉพาะบันทึกของตัวเอง', 403)
            if locked(con, me['tid'], x['date']):
                return bad('ฝ่ายวิชาการรับทราบสัปดาห์นี้แล้ว — ติดต่อฝ่ายวิชาการหากต้องแก้ไข', 409)
            log = find_log(logs_between(con, k[0], k[0]), x)
            if log:
                con.execute('DELETE FROM tl_logs WHERE id=?', (log['id'],))
        return jsonify(success=True, message='ลบบันทึกแล้ว')

    # ── ข้อมูลสำหรับพิมพ์ ───────────────────────────────────
    @app.get('/api/tl/print')
    @ident
    def tl_print():
        """doc=week  ใบบันทึกหลังสอนรายสัปดาห์ของครู (start = วันจันทร์)
           doc=lesson บันทึกหลังสอนของรายวิชา/ห้องทั้งภาคเรียน (lesson_id)"""
        tid, err = target_teacher()
        if err:
            return err
        s, t = get_settings(), today()
        doc = request.args.get('doc', 'week')
        with get_db() as con:
            name, f, e = cur_term(con, s, request.args.get('term', ''))
            if not f:
                return bad('ยังไม่มีภาคเรียนในตารางสอน', 404)
            weeks = term_weeks(f, e)
            if doc == 'lesson':
                try:
                    lid = int(request.args.get('lesson_id'))
                except (TypeError, ValueError):
                    return bad('ระบุรายวิชา')
                d1, d2, wk = f, min(e, t), None
                pick = lambda x: x['lesson_id'] == lid and tid in x['teachers']
            else:
                start = request.args.get('start', '')
                if not DATE_RE.match(start):
                    return bad('ระบุสัปดาห์')
                d1 = monday(start)
                d2 = (datetime.date.fromisoformat(d1) + 6 * DAY).isoformat()
                wk = next((w for w in weeks if w['start'] == d1), dict(no='', start=d1, end=d2))
                pick = lambda x: tid in x['teachers']
            logs = logs_between(con, d1, d2)
            items = []
            for x in build_sessions(con, s, d1, d2):
                if pick(x):
                    log = find_log(logs, x)
                    items.append(dict(session=x, log=log_dict(log) if log else None, state=state_of(x, log, t)))
            tname = con.execute('SELECT t.name, u.full_name FROM tt_teachers t LEFT JOIN users u ON u.id=t.user_id WHERE t.id=?',
                                (tid,)).fetchone()
            ack = acks_of(con, tid).get((tid, d1)) if wk else None
            sg = signers(con, s, name)
        return jsonify(doc=doc, school=s.get('school_name') or '', logo=s.get('school_logo') or '', term=name, week=wk,
                       teacher=dict(id=tid, name=tname['name'] if tname else '',       # full = ชื่อพร้อมคำนำหน้า (จากบัญชีที่ผูกไว้)
                                    full=(tname['full_name'] or tname['name']) if tname else ''),
                       items=items, ack=ack, signers=sg,
                       problems=PROBLEMS, today=t)

    # ── ฝ่ายวิชาการ: สรุป ───────────────────────────────────
    @app.get('/api/tl/summary')
    @ident
    def tl_summary():
        if not g.tl['manage']:
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        s, t = get_settings(), today()
        with get_db() as con:
            name, f, e = cur_term(con, s, request.args.get('term', ''))
            if not f:
                return bad('ยังไม่มีภาคเรียนในตารางสอน', 404)
            d1, d2 = request.args.get('from', ''), request.args.get('to', '')
            d1 = max(d1, f) if DATE_RE.match(d1) else f
            d2 = min(d2, e) if DATE_RE.match(d2) else e
            d2 = min(d2, t)                          # นับเฉพาะที่ถึงวันสอนแล้ว
            weeks = [w for w in term_weeks(f, e) if w['start'] <= d2 and w['end'] >= d1]
            teachers = {r['id']: dict(id=r['id'], name=r['name'], active=r['active'], should=0, done=0, notplan=0, none=0,
                                      off=0, last_at='', weeks={})
                        for r in con.execute('SELECT id, name, active FROM tt_teachers ORDER BY sort_order, id')}
            ses = build_sessions(con, s, d1, d2) if d1 <= d2 else []
            logs = logs_between(con, d1, d2) if d1 <= d2 else {}
            acks = acks_of(con)
            prob = {k: 0 for k in PROBLEM_KEYS}
            others, notplan, improves = [], [], []
            seen = set()
            for x in ses:
                log = find_log(logs, x)
                wk = monday(x['date'])
                for tid in x['owners']:
                    if tid not in x['teachers'] and tid in teachers:
                        teachers[tid]['off'] += 1
                for tid in x['teachers']:
                    tt = teachers.get(tid)
                    if not tt:
                        continue
                    c = tt['weeks'].setdefault(wk, dict(should=0, done=0))
                    tt['should'] += 1
                    c['should'] += 1
                    if log:
                        tt['done'] += 1
                        c['done'] += 1
                        tt['notplan'] += log['taught'] == 'not'
                        tt['none'] += log['taught'] == 'none'
                        tt['last_at'] = max(tt['last_at'], log['updated_at'] or '')
                if log and log['id'] not in seen:
                    seen.add(log['id'])
                    base = dict(date=x['date'], period=x['period'], code=x['code'], class_label=x['class_label'],
                                teacher=log['teacher_name'])
                    for p in jl(log['problems'], []):
                        if p in prob:
                            prob[p] += 1
                    if log['problem_other']:
                        others.append(dict(base, text=log['problem_other']))
                    if log['taught'] != 'plan':
                        notplan.append(dict(base, taught=log['taught'], text=log['reason']))
                    if log['improve']:
                        improves.append(dict(base, text=log['improve']))
            rows = []
            for tt in teachers.values():
                if not tt['should'] and not (tt['active'] and tt['off']):      # ครูที่ย้ายออกแล้ว/ไม่มีคาบในช่วงนี้ ไม่แสดง
                    continue
                tt['pending'] = tt['should'] - tt['done']
                tt['percent'] = pct(tt['done'], tt['should'])
                for wk, c in tt['weeks'].items():
                    a = acks.get((tt['id'], wk))
                    c['ack'] = bool(a)
                tt['acked'] = sum(1 for c in tt['weeks'].values() if c['ack'])
                rows.append(tt)
            sg = signers(con, s, name)
        should, done = sum(r['should'] for r in rows), sum(r['done'] for r in rows)
        return jsonify(term=name, start=d1, end=d2, weeks=weeks, teachers=rows, signers=sg,
                       school=s.get('school_name') or '', logo=s.get('school_logo') or '', today=t,
                       totals=dict(should=should, done=done, pending=should - done, percent=pct(done, should),
                                   logs=len(seen), teachers=len(rows), complete=sum(1 for r in rows if r['should'] and not r['pending'])),
                       problems=[dict(key=k, label=lb, count=prob[k]) for k, lb in PROBLEMS],
                       others=others[-80:], notplan=notplan[-80:], improves=improves[-80:])

    # ── ฝ่ายวิชาการ: รับทราบรายสัปดาห์ ─────────────────────────
    @app.post('/api/tl/ack')
    @ident
    def tl_ack():
        me = g.tl
        if not me['manage']:
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        b = request.get_json(silent=True) or {}
        try:
            tid = int(b.get('teacher_id'))
        except (TypeError, ValueError):
            return bad('ระบุครู')
        if not DATE_RE.match(str(b.get('week') or '')):
            return bad('ระบุสัปดาห์')
        wk = monday(b['week'])
        with get_db() as con:
            if b.get('on') is False:
                con.execute('DELETE FROM tl_acks WHERE teacher_id=? AND week=?', (tid, wk))
                return jsonify(success=True, message='ยกเลิกการรับทราบแล้ว ครูแก้ไขบันทึกสัปดาห์นี้ได้')
            con.execute('INSERT INTO tl_acks (teacher_id, week, comment, ack_by, ack_at) VALUES (?,?,?,?,?) '
                        'ON CONFLICT(teacher_id, week) DO UPDATE SET comment=excluded.comment, ack_by=excluded.ack_by, ack_at=excluded.ack_at',
                        (tid, wk, clean(b.get('comment'), 1000), me.get('user') or me['name'], now()))
        return jsonify(success=True, message='รับทราบแล้ว')

    # ── ฝ่ายวิชาการ: ลิงก์ส่วนตัวรายครู ────────────────────────
    @app.get('/api/tl/links')
    @ident
    def tl_links():
        if not g.tl['manage']:
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        s = get_settings()
        with get_db() as con:
            name, f, e = cur_term(con, s, request.args.get('term', ''))
            used = set()
            for r in con.execute("SELECT l.teacher_ids FROM tt_lessons l JOIN tt_terms t ON t.id=l.term_id "
                                 "WHERE t.name=? AND l.kind='subject' AND l.code<>''", (name,)):
                used.update(jl(r['teacher_ids'], []))
            out = [dict(id=r['id'], name=r['name'], has_account=bool(r['user_id']), token=link_of(con, r['id']))
                   for r in con.execute('SELECT id, name, user_id FROM tt_teachers WHERE active=1 ORDER BY sort_order, id').fetchall()
                   if r['id'] in used]
        return jsonify(links=out, term=name)

    @app.post('/api/tl/links/renew')
    @ident
    def tl_links_renew():
        if not g.tl['manage']:
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        try:
            tid = int((request.get_json(silent=True) or {}).get('teacher_id'))
        except (TypeError, ValueError):
            return bad('ระบุครู')
        with get_db() as con:
            if not con.execute('SELECT 1 FROM tt_teachers WHERE id=?', (tid,)).fetchone():
                return bad('ไม่พบครู', 404)
            tok = link_of(con, tid, renew=True)
        return jsonify(success=True, token=tok, message='ออกลิงก์ใหม่แล้ว ลิงก์เดิมใช้ไม่ได้แล้ว')
