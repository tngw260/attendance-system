"""ใบรายชื่อนักเรียน ตามแบบฟอร์มของงานทะเบียน — ดาวน์โหลด Word (.docx) / หน้าพิมพ์ PDF (public/class-list.html)

แบบฟอร์ม (ไฟล์ Excel ของนายทะเบียน "รายชื่อนักเรียน เลขบัตร ปีการศึกษา 2569-1DMC"):
  หัว 4 บรรทัด  รายชื่อนักเรียนชั้นมัธยมศึกษาปีที่ N / โรงเรียน… ปีการศึกษา … / … (ครูที่ปรึกษา) / จำนวนนักเรียนทั้งหมด … ชาย … หญิง …
  ตาราง        เลขที่ · เลขประจำตัว · ชื่อ | สกุล (ไม่มีเส้นคั่นกลาง) + ช่องว่าง 9 ช่อง · TH SarabunPSK 16 ตัวหนา · A4 แนวตั้ง
  ไม่ใส่เลขบัตรประชาชน — ครูทุกคนดาวน์โหลดได้ (ข้อมูลส่วนบุคคล)
รายชื่อมาจากตาราง students ที่นายทะเบียนดูแล → ทุกใบในโรงเรียนตรงกัน

ครูที่ปรึกษาบนหัวกระดาษ: settings.class_advisors (ตั้งต้นจากแบบฟอร์ม แอดมินแก้ได้) → ไม่มีใช้บัญชีครูที่ผูกห้อง
ใช้ 2 แบบ
  ?level=&room=                    ใบรายชื่อรายห้อง (หน้าเช็คชื่อ)
  ?date=&period=&lesson_id=        ใบรายชื่อสอนแทน (หน้าสอนแทน) เพิ่ม วิชา/ผู้สอน/ครูสอนแทน/วัน-คาบ + ลงชื่อครูสอนแทน
                                   วิชาเรียนรวมหลายชั้น = ชั้นละหน้า
สิทธิ์: แอดมิน/ผู้ช่วยจัดตาราง · ครูที่ไม่ได้ผูกห้อง (เหมือนใบเช็คชื่อเดิม) · ห้องที่ปรึกษา · ห้องที่สอนในตารางที่เผยแพร่
       · ใบสอนแทน: ครูเจ้าของวิชาและครูที่รับสอนแทนคาบนั้น
"""
import datetime
import io
import json
import re
import zipfile
from xml.sax.saxutils import escape

from timetable import DATE_RE, jl, term_for_date

THAI_DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']          # isoweekday 1–7
THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม',
               'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
NAME_PREFIXES = ('เด็กชาย', 'เด็กหญิง', 'นางสาว', 'นาย', 'นาง')
CHECK_COLS = 9                                       # ช่องว่างท้ายตาราง ตามแบบฟอร์ม
# ครูที่ปรึกษาตั้งต้น จากแบบฟอร์มของนายทะเบียน ปีการศึกษา 2569 → settings.class_advisors (ครั้งแรกที่เปิดแอป)
# แอดมินแก้ได้ที่หน้าใบรายชื่อ · ห้องที่ไม่มีในค่าตั้ง ใช้บัญชีครูที่ผูกห้องนั้น (users.assigned_level/room)
DEFAULT_ADVISORS = {
    '1/1': 'นางสาวรตนมน พรหมขอม  และนางสาวประภาสิริ ศิษย์นันท์',
    '2/1': 'นางสาวณัฐธิดา ดวงสมร  และนางสาวเสาวณิต ชาญณรงค์',
    '3/1': 'นางสาวเกษร บัวผุด  และครูคหกรรม',
    '4/1': 'นายฐิติวารินทร์ เลี้ยงรักษา  และนายพรเทพ อุ้มชูวัฒนา',
    '5/1': 'นางสาวจันจิรา ธรรมทีโป  และนางสาวเปี่ยมจิตร นางหลาด',
    '6/1': 'นายชยุตม์ คงบัน  และนางสาวพจณิชา บุญเรือน',
}


def thai_date(d):
    d = datetime.date.fromisoformat(d)
    return f'วัน{THAI_DAYS[d.isoweekday() - 1]}ที่ {d.day} {THAI_MONTHS[d.month - 1]} {d.year + 543}'


def split_name(name):
    """"เด็กชาย คงศกร คงทน" / "เด็กชายธนเทพ ณ ถลาง" → ("เด็กชายคงศกร", "คงทน") / ("เด็กชายธนเทพ", "ณ ถลาง")"""
    n = re.sub(r'\s+', ' ', name or '').strip()
    pre = next((p for p in NAME_PREFIXES if n.startswith(p)), '')
    rest = n[len(pre):].strip()
    first, _, last = rest.partition(' ')
    return pre + first, last


def gender_of(gender, name):
    g = (gender or '').strip().lower()
    if g in ('ชาย', 'ช', 'm', 'male', 'boy'):
        return 'M'
    if g in ('หญิง', 'ญ', 'f', 'female', 'girl'):
        return 'F'
    n = (name or '').strip()
    return 'M' if n.startswith(('เด็กชาย', 'นาย')) else 'F' if n.startswith(('เด็กหญิง', 'นาง')) else None


def academic_year(con, date, settings):
    """ปีการศึกษา (พ.ศ.) ของวันนั้น — จากชื่อภาคเรียนในตารางสอน ("2/2569") ไม่มีก็นับปีการศึกษาเริ่ม 16 พ.ค."""
    term = term_for_date(con, date, settings)
    m = re.search(r'/(\d{4})$', term['name']) if term else None
    if m:
        return m.group(1)
    d = datetime.date.fromisoformat(date)
    return str(d.year + 543 - (1 if (d.month, d.day) < (5, 16) else 0))


def class_sheet(con, level, room, year, settings):
    rows = con.execute("""SELECT number, student_code, name, gender FROM students
                          WHERE class_level=? AND room=? ORDER BY number, name""", (level, room)).fetchall()
    students, male, female = [], 0, 0
    for r in rows:
        first, last = split_name(r['name'])
        g = gender_of(r['gender'], r['name'])
        male += g == 'M'
        female += g == 'F'
        students.append(dict(number=r['number'], code=r['student_code'] or '', first=first, last=last))
    advisors = (jl(settings.get('class_advisors'), {}).get(f'{level}/{room}') or '').strip() or '  และ'.join(
        r['full_name'] for r in con.execute(
            """SELECT full_name FROM users WHERE role='teacher' AND assigned_level=? AND (assigned_room=? OR assigned_room IS NULL)
               ORDER BY id""", (level, room)))
    return dict(level=level, room=room, year=year, school=settings.get('school_name', ''),
                advisors=advisors, students=students, total=len(students), male=male, female=female)


def parse_class(c):
    m = re.fullmatch(r'(\d)/(\d+)', c or '')
    return (int(m.group(1)), int(m.group(2))) if m else None


def sub_context(con, date, period, lesson_id):
    """คาบสอนแทน → วิชา ผู้สอน ครูสอนแทน วัน-คาบ ชั้นของรายการ (None = ไม่พบ)"""
    l = con.execute('SELECT * FROM tt_lessons WHERE id=?', (lesson_id,)).fetchone()
    if not l:
        return None
    names = {r['id']: r['name'] for r in con.execute('SELECT id, name FROM tt_teachers')}
    term = con.execute('SELECT config FROM tt_terms WHERE id=?', (l['term_id'],)).fetchone()
    times = {p['no']: p for p in jl(term['config'] if term else None, {}).get('periods', [])}
    s = con.execute('SELECT sub_id, status FROM tt_subs WHERE date=? AND period=? AND lesson_id=?',
                    (date, period, lesson_id)).fetchone()
    subj = con.execute('SELECT name FROM tt_subjects WHERE code=?', (l['code'],)).fetchone() if l['code'] else None
    tids = jl(l['teacher_ids'], [])
    t = times.get(period)
    return dict(date=date, date_label=thai_date(date), period=period, time=f"{t['start']}-{t['end']}" if t else '',
                code=l['code'] or '', subject=(subj['name'] if subj else '') or (l['title'] if not l['code'] else ''),
                track=l['track'] or '', teacher_ids=tids, teachers=['ครู' + names[i] for i in tids if i in names],
                sub_id=s['sub_id'] if s else None, sub=('ครู' + names[s['sub_id']]) if s and s['sub_id'] in names else '',
                pending=bool(s and s['status'] == 'pending'),
                classes=[c for c in (parse_class(x) for x in jl(l['classes'], [])) if c])


# ── Word (.docx) — เขียน XML เอง ไม่ต้องลง python-docx บนเซิร์ฟเวอร์ ──────────────
FONT = 'TH SarabunPSK'
PAGE_W, MARGIN_L, MARGIN_R = 11906, 1021, 850       # A4 · ซ้าย 1.8 ซม. ขวา 1.5 ซม.
TEXT_W = PAGE_W - MARGIN_L - MARGIN_R               # 10035 twips
COL_NO, COL_CODE, COL_FIRST, COL_LAST = 650, 1450, 2450, 1850
CELL_LINE = 380                                     # บรรทัดในตาราง 19pt พอดีสระบน-ล่าง · ห้องละ ~33 คนต่อหน้า
COL_CHECK = (TEXT_W - COL_NO - COL_CODE - COL_FIRST - COL_LAST) // CHECK_COLS


def _run(text, bold=True, size=16):
    b = '<w:b/><w:bCs/>' if bold else ''
    return (f'<w:r><w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}" w:eastAsia="{FONT}"/>{b}'
            f'<w:sz w:val="{size * 2}"/><w:szCs w:val="{size * 2}"/><w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr>'
            f'<w:t xml:space="preserve">{escape(text)}</w:t></w:r>')


def _para(text='', align='center', bold=True, ind=0, page_break=False, keep=False):
    kn = '<w:keepNext/>' if keep else ''
    indent = '<w:ind w:left="%d"/>' % ind if ind else ''
    ppr = (f'<w:pPr>{kn}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
           f'{indent}<w:jc w:val="{align}"/></w:pPr>')
    br = '<w:r><w:br w:type="page"/></w:r>' if page_break else ''
    return f'<w:p>{ppr}{br}{_run(text, bold) if text else ""}</w:p>'


def _cell(text, w, align='center', span=1, borders=''):
    gs = '<w:gridSpan w:val="%d"/>' % span if span > 1 else ''
    bd = '<w:tcBorders>%s</w:tcBorders>' % borders if borders else ''
    tcpr = f'<w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{gs}{bd}<w:vAlign w:val="center"/></w:tcPr>'
    p = (f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="{CELL_LINE}" w:lineRule="exact"/><w:jc w:val="{align}"/></w:pPr>'
         f'{_run(text) if text else ""}</w:p>')
    return f'<w:tc>{tcpr}{p}</w:tc>'


NO_RIGHT = '<w:right w:val="nil"/>'                 # ชื่อ | สกุล ไม่มีเส้นคั่นกลาง (ตามแบบฟอร์ม)
NO_LEFT = '<w:left w:val="nil"/>'


def header_lines(sh, sub):
    out = [f"รายชื่อนักเรียนชั้นมัธยมศึกษาปีที่ {sh['level']}" + (f"/{sh['room']}" if sh['room'] > 1 else ''),
           f"{sh['school']}  ปีการศึกษา {sh['year']}",
           (sh['advisors'] or '...........................................') + ' (ครูที่ปรึกษา)',
           f"จำนวนนักเรียนทั้งหมด {sh['total']} คน นักเรียนชายจำนวน {sh['male']} คน นักเรียนหญิงจำนวน {sh['female']} คน"]
    if sub:
        subj = ' '.join(x for x in (sub['code'], sub['subject']) if x) + (f" ({sub['track']})" if sub['track'] else '')
        out += [f"วิชา {subj}   ผู้สอน {', '.join(sub['teachers']) or '-'}",
                f"ครูสอนแทน {sub['sub'] or '.............................'}{' (รออนุมัติ)' if sub['pending'] else ''}   "
                f"{sub['date_label']} คาบที่ {sub['period']}{' (' + sub['time'] + ')' if sub['time'] else ''}"]
    return out


def sheet_docx_xml(sh, sub, first):
    body = ''.join(_para(t, page_break=(not first and i == 0), keep=True) for i, t in enumerate(header_lines(sh, sub)))
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in [COL_NO, COL_CODE, COL_FIRST, COL_LAST] + [COL_CHECK] * CHECK_COLS)
    head = (f'<w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="{CELL_LINE}" w:hRule="atLeast"/></w:trPr>'
            + _cell('เลขที่', COL_NO) + _cell('เลขประจำตัว', COL_CODE) + _cell('ชื่อ - สกุล', COL_FIRST + COL_LAST, span=2)
            + ''.join(_cell('', COL_CHECK) for _ in range(CHECK_COLS)) + '</w:tr>')
    rows = ''.join(
        f'<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="{CELL_LINE}" w:hRule="atLeast"/></w:trPr>'
        + _cell(str(s['number'] or ''), COL_NO) + _cell(s['code'], COL_CODE)
        + _cell(s['first'], COL_FIRST, 'left', borders=NO_RIGHT) + _cell(s['last'], COL_LAST, 'left', borders=NO_LEFT)
        + ''.join(_cell('', COL_CHECK) for _ in range(CHECK_COLS)) + '</w:tr>' for s in sh['students'])
    if not sh['students']:
        rows = ('<w:tr>' + _cell('— ยังไม่มีรายชื่อนักเรียนห้องนี้ —', TEXT_W, span=4 + CHECK_COLS) + '</w:tr>')
    b = '<w:{0} w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    tbl = (f'<w:tbl><w:tblPr><w:tblW w:w="{TEXT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
           f'<w:tblBorders>{"".join(b.format(x) for x in ("top", "left", "bottom", "right", "insideH", "insideV"))}</w:tblBorders>'
           f'<w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr>'
           f'<w:tblGrid>{grid}</w:tblGrid>{head}{rows}</w:tbl>')
    body += tbl
    if sub:                                          # ลงชื่อครูสอนแทน ชิดขวา
        body += (_para('') + _para('ลงชื่อ........................................ครูสอนแทน', 'right')
                 + _para(f"({sub['sub'] or '........................................'})", 'right', ind=0))
    return body


def build_docx(sheets, sub, title):
    body = ''.join(sheet_docx_xml(sh, sub, i == 0) for i, sh in enumerate(sheets))
    sect = (f'<w:sectPr><w:pgSz w:w="{PAGE_W}" w:h="16838"/>'
            f'<w:pgMar w:top="720" w:right="{MARGIN_R}" w:bottom="720" w:left="{MARGIN_L}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>')
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{body}{sect}</w:body></w:document>'
    styles = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {ns}><w:docDefaults><w:rPrDefault><w:rPr>'
              f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}" w:eastAsia="{FONT}"/><w:sz w:val="32"/><w:szCs w:val="32"/>'
              '<w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>'
              '</w:pPr></w:pPrDefault></w:docDefaults></w:styles>')
    now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
        'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{escape(title)}</dc:title><dc:creator>{escape(sheets[0]["school"] if sheets else "")}</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created></cp:coreProperties>',
        'word/document.xml': document,
        'word/styles.xml': styles,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    buf.seek(0)
    return buf


def init(app, get_db, login_required, current_user, get_settings):
    from flask import jsonify, request, send_file

    with get_db() as con:
        if not con.execute("SELECT 1 FROM settings WHERE key='class_advisors'").fetchone():
            con.execute("INSERT INTO settings (key, value) VALUES ('class_advisors', ?)",
                        (json.dumps(DEFAULT_ADVISORS, ensure_ascii=False),))

    def teaches(con, me, level, room):
        cls = f'{level}/{room}'
        for r in con.execute("""SELECT l.teacher_ids, l.classes FROM tt_lessons l JOIN tt_terms t ON t.id=l.term_id
                                WHERE t.published=1"""):
            if me in jl(r['teacher_ids'], []) and cls in jl(r['classes'], []):
                return True
        return False

    def allowed(con, u, classes, sub):
        if u['role'] == 'admin' or con.execute('SELECT 1 FROM tt_editors WHERE user_id=?', (u['id'],)).fetchone():
            return True
        me = con.execute('SELECT id FROM tt_teachers WHERE user_id=?', (u['id'],)).fetchone()
        me = me['id'] if me else None
        if sub and me and (me in sub['teacher_ids'] or me == sub['sub_id']):
            return True
        for lv, rm in classes:
            if not (not u.get('assigned_level')                              # ครูไม่ได้ผูกห้อง (กติกาเดียวกับใบเช็คชื่อเดิม)
                    or (u['assigned_level'] == lv and (not u.get('assigned_room') or u['assigned_room'] == rm))
                    or (me and teaches(con, me, lv, rm))):
                return False
        return True

    def collect():
        """→ (sheets, sub, title, None) หรือ (None, None, None, (ข้อความ, status))"""
        a, u, s = request.args, current_user(), get_settings()
        today = datetime.date.today().isoformat()
        with get_db() as con:
            sub = None
            if a.get('lesson_id'):
                d = a.get('date', '')
                try:
                    p, lid = int(a.get('period', '')), int(a.get('lesson_id', ''))
                except ValueError:
                    return None, None, None, ('ข้อมูลไม่ถูกต้อง', 400)
                if not DATE_RE.match(d):
                    return None, None, None, ('วันที่ไม่ถูกต้อง', 400)
                sub = sub_context(con, d, p, lid)
                if not sub or not sub['classes']:
                    return None, None, None, ('ไม่พบคาบนี้ หรือคาบนี้ไม่มีนักเรียน', 404)
                classes, year_date = sub['classes'], d
            else:
                try:
                    classes = [(int(a.get('level', '')), int(a.get('room', '')))]
                except ValueError:
                    return None, None, None, ('ต้องระบุชั้น/ห้อง', 400)
                if not 1 <= classes[0][0] <= 6:
                    return None, None, None, ('ชั้นไม่ถูกต้อง', 400)
                year_date = today
            if not allowed(con, u, classes, sub):
                return None, None, None, ('ดาวน์โหลดได้เฉพาะห้องที่ปรึกษา ห้องที่สอน หรือคาบที่รับสอนแทน', 400)
            year = academic_year(con, year_date, s)
            sheets = [class_sheet(con, lv, rm, year, s) for lv, rm in classes]
        cls = '-'.join(f'ม.{lv}-{rm}' for lv, rm in classes)
        title = f"รายชื่อสอนแทน {sub['date']} คาบ{sub['period']} {cls}" if sub else f'รายชื่อนักเรียน {cls}'
        return sheets, sub, title, None

    @app.get('/api/class-list')
    @login_required
    def class_list():
        sheets, sub, title, err = collect()
        if err:
            return jsonify(success=False, message=err[0]), err[1]
        out_sub = {k: v for k, v in sub.items() if k not in ('teacher_ids', 'sub_id', 'classes')} if sub else None
        return jsonify(sheets=[dict(sh, header=header_lines(sh, sub)) for sh in sheets], sub=out_sub, title=title,
                       can_edit_advisors=current_user()['role'] == 'admin')

    @app.put('/api/class-advisors')
    @login_required
    def class_advisors_put():
        """แอดมินแก้ชื่อครูที่ปรึกษาบนหัวใบรายชื่อ {cls: "1/1", text} · text ว่าง = กลับไปใช้บัญชีครูที่ผูกห้อง"""
        if current_user()['role'] != 'admin':
            return jsonify(success=False, message='เฉพาะแอดมิน'), 403
        b = request.get_json() or {}
        cls = str(b.get('cls') or '')
        if not parse_class(cls):
            return jsonify(success=False, message='ห้องไม่ถูกต้อง'), 400
        text = re.sub(r'[ \t]{3,}', '  ', str(b.get('text') or '').replace('\n', ' ')).strip()[:200]
        text = re.sub(r'\s*\(?ครูที่ปรึกษา\)?\s*$', '', text)          # วางมาทั้งบรรทัดจากใบเดิม
        with get_db() as con:
            cur = jl((con.execute("SELECT value FROM settings WHERE key='class_advisors'").fetchone() or {'value': None})['value'], {})
            if text:
                cur[cls] = text
            else:
                cur.pop(cls, None)
            con.execute("INSERT INTO settings (key, value) VALUES ('class_advisors', ?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(cur, ensure_ascii=False),))
        return jsonify(success=True, cls=cls, text=text)

    @app.get('/api/class-list.docx')
    @login_required
    def class_list_docx():
        sheets, sub, title, err = collect()
        if err:
            return jsonify(success=False, message=err[0]), err[1]
        return send_file(build_docx(sheets, sub, title), as_attachment=True, download_name=title.replace(' ', '_') + '.docx',
                         mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
