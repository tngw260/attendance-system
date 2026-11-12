"""ระบบนิเทศการสอนออนไลน์ (public/supervision.html)

นัดนิเทศ (sv_visits) = ครูผู้รับการนิเทศ 1 คน × คาบสอน 1 คาบจากตารางสอน × กรรมการ 3 คน
  กรรมการ 1 ใน 3 คนเป็น "เพื่อนคู่นิเทศ" (peer_seat) — มาสังเกตการสอนก่อนวันนิเทศภายใน 1 รอบ
แบบประเมิน (sv_evals) ต่อ 1 นัด มีได้ 4 ใบ
  round='pre'   ของเพื่อนคู่นิเทศ (สังเกตก่อน) ใช้ "แบบบันทึกการสังเกตชั้นเรียน" (sv_visits.pre_form)
                ผู้รับการนิเทศเห็นผลทันทีที่ส่ง เพื่อปรับก่อนวันจริง
  round='main'  ของกรรมการที่นั่ง 1–3 (วันนิเทศภายใน) ต่างคนต่างให้คะแนน เห็นของกันเมื่อส่งครบ 3 คน
ส่งครบ 3 คน → ระบบแปลผล (ค่าเฉลี่ยรายข้อ ระดับคุณภาพ ร้อยละ จุดเด่น ข้อที่ควรพัฒนา ข้อที่ให้คะแนนต่างกันมาก)
  + ส่วนที่ 4 เทียบ "ก่อนนิเทศ" (รอบเพื่อนคู่นิเทศ) กับ "หลังนิเทศ" (ค่าเฉลี่ยกรรมการ) รายด้าน
ผู้รับการนิเทศ: กรอกข้อมูลก่อนสอน → ดูผล → เขียนสะท้อนคิด → กดรับทราบ

ลิงก์เฉพาะกิจ (sv_links): ฝ่ายวิชาการออกลิงก์ให้ผู้รับการนิเทศ + กรรมการแต่ละที่นั่ง ส่งทางไลน์ เปิดแล้วกรอกได้เลยไม่ต้องล็อกอิน
  ลิงก์ = รหัสสุ่มยาว ผูกกับ "คน" ในนัดนั้น (เพื่อนคู่นิเทศใช้ลิงก์เดียวทั้งรอบสังเกตและวันจริง) · ออกลิงก์ใหม่แล้วลิงก์เก่าใช้ไม่ได้
  เปลี่ยนตัวกรรมการแล้วลิงก์ของที่นั่งนั้นใช้ไม่ได้ · หมดอายุ 14 วันหลังผู้รับการนิเทศกดรับทราบ
บัญชีครูส่วนใหญ่เป็นบัญชีรวม → ผู้ใช้ "เลือกชื่อตัวเอง" บนหน้าเว็บ (ส่งมาเป็น as=t:<id> หรือ n:<ชื่อ>)
  บัญชีที่ผูกกับครูในตารางสอนแล้ว (tt_teachers.user_id) ถูกบังคับให้เป็นครูคนนั้น เลือกชื่อคนอื่นไม่ได้
สิทธิ์จัดการนัด/เปิดคืนแบบประเมิน/ดูสรุปทั้งโรงเรียน = แอดมิน หรือผู้ช่วยจัดตาราง (tt_editors = ฝ่ายวิชาการ)

แบบประเมิน (FORMS) เก็บเป็นข้อมูล — เปลี่ยนรายการ/เกณฑ์ได้โดยเพิ่มเวอร์ชันใหม่ นัดเก่ายังอ้างเวอร์ชันเดิม
"""
import datetime
import json
import re
import secrets

from timetable import bare_name, jl, term_for_date, tt_day

SCHEMA = """
CREATE TABLE IF NOT EXISTS sv_visits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    term          TEXT NOT NULL,
    form          TEXT NOT NULL DEFAULT 'v1',
    pre_form      TEXT NOT NULL DEFAULT 'v1',
    kind          TEXT NOT NULL DEFAULT 'full',     -- full = สังเกตการสอน + นิเทศภายใน · obs = สังเกตการสอนเพิ่มเติมอย่างเดียว
    teacher_id    INTEGER REFERENCES tt_teachers(id) ON DELETE SET NULL,
    teacher_name  TEXT NOT NULL,
    area          TEXT DEFAULT '',
    date          TEXT NOT NULL,
    period        TEXT DEFAULT '',
    code          TEXT DEFAULT '',
    title         TEXT DEFAULT '',
    class_label   TEXT DEFAULT '',
    peer_seat     INTEGER NOT NULL DEFAULT 1,
    pre_date      TEXT DEFAULT '',
    pre_period    TEXT DEFAULT '',
    pre_lesson    TEXT DEFAULT '',
    plan_no       TEXT DEFAULT '',
    unit          TEXT DEFAULT '',
    topic         TEXT DEFAULT '',
    focus         TEXT DEFAULT '',
    reflection    TEXT DEFAULT '{}',
    agreed        TEXT DEFAULT '',
    ack_at        TEXT,
    created_by    INTEGER,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sv_term ON sv_visits(term, date);
CREATE TABLE IF NOT EXISTS sv_evals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id       INTEGER NOT NULL REFERENCES sv_visits(id) ON DELETE CASCADE,
    round          TEXT NOT NULL CHECK (round IN ('pre','main')),
    seat           INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 3),
    evaluator_id   INTEGER REFERENCES tt_teachers(id) ON DELETE SET NULL,
    evaluator_name TEXT NOT NULL,
    position       TEXT DEFAULT '',
    scores         TEXT DEFAULT '{}',
    comments       TEXT DEFAULT '{}',
    highlight      TEXT DEFAULT '',
    strengths      TEXT DEFAULT '',
    improvements   TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'draft',
    submitted_at   TEXT,
    updated_at     TEXT,
    UNIQUE(visit_id, round, seat)
);
CREATE TABLE IF NOT EXISTS sv_links (
    token       TEXT PRIMARY KEY,
    visit_id    INTEGER NOT NULL REFERENCES sv_visits(id) ON DELETE CASCADE,
    seat        INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),   -- 0 = ผู้รับการนิเทศ · 1–3 = กรรมการที่นั่งนั้น
    name        TEXT NOT NULL,                                   -- ชื่อคนตอนออกลิงก์ (เปลี่ยนตัวแล้วลิงก์ใช้ไม่ได้)
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sv_links_visit ON sv_links(visit_id);
"""

# ── แบบประเมิน (ร่างจาก "แบบนิเทศการจัดการเรียนรู้" ของโรงเรียน) ─────────────
FORMS = {
    'v1': {
        'name': 'แบบนิเทศการจัดการเรียนรู้',
        'scale': [[4, 'ดีมาก'], [3, 'ดี'], [2, 'พอใช้'], [1, 'น้อยมาก'], [0, 'ไม่มีการปฏิบัติ']],
        'parts': [
            {'id': 'p1', 'title': 'ส่วนที่ 1 การสังเกตก่อนการสอน (Pre-conference)', 'items': [
                {'id': 'p1_1', 'title': 'การวางแผนและออกแบบการจัดการเรียนรู้',
                 'desc': 'จุดประสงค์ชัดเจนสอดคล้องมาตรฐาน/ตัวชี้วัด กิจกรรม วิธีสอน การวัดผล การจัดเวลา และคุณลักษณะอันพึงประสงค์'},
                {'id': 'p1_2', 'title': 'การเตรียมสื่อ นวัตกรรม และสภาพแวดล้อมการเรียนรู้',
                 'desc': 'สื่อ/อุปกรณ์/เทคโนโลยี ใบงาน และการจัดสภาพแวดล้อมพร้อมและสอดคล้องกับกิจกรรม'},
                {'id': 'p1_3', 'title': 'การวิเคราะห์ผู้เรียนและการเตรียมความพร้อม',
                 'desc': 'เข้าใจความแตกต่างระหว่างบุคคล รองรับผู้เรียนพิเศษ และตั้งเป้าหมายที่ท้าทายแต่บรรลุได้'},
            ]},
            {'id': 'p2', 'title': 'ส่วนที่ 2 บันทึกการนิเทศการสอน', 'items': [
                {'id': 'p2_1', 'title': 'การนำเข้าสู่บทเรียนและการกระตุ้นความสนใจ',
                 'desc': 'ทบทวนความรู้เดิม เร้าความสนใจ และแจ้งจุดประสงค์การเรียนรู้'},
                {'id': 'p2_2', 'title': 'การจัดกิจกรรมการเรียนรู้เชิงรุก (Active Learning)',
                 'desc': 'ผู้เรียนลงมือปฏิบัติและสร้างองค์ความรู้ด้วยตนเอง ทำงานกลุ่ม เชื่อมโยงชีวิตจริง และใช้เทคนิคที่หลากหลาย'},
                {'id': 'p2_3', 'title': 'การส่งเสริมการคิดขั้นสูงและความคิดสร้างสรรค์',
                 'desc': 'ใช้คำถามระดับสูง กระตุ้นการคิดวิเคราะห์ การแก้ปัญหา และการสรุปองค์ความรู้ด้วยตนเอง'},
                {'id': 'p2_4', 'title': 'การจัดการชั้นเรียนและบรรยากาศการเรียนรู้',
                 'desc': 'บรรยากาศเชิงบวก การมีส่วนร่วมเท่าเทียม การบริหารเวลา และการเสริมแรงทางบวก'},
                {'id': 'p2_5', 'title': 'การใช้สื่อ นวัตกรรม และเทคโนโลยี',
                 'desc': 'ใช้สื่อหลากหลายและเทคโนโลยีได้คล่องแคล่ว ช่วยเพิ่มความเข้าใจและความสนใจของผู้เรียน'},
                {'id': 'p2_6', 'title': 'การวัดและประเมินผลระหว่างเรียน',
                 'desc': 'ตรวจสอบความเข้าใจต่อเนื่อง ให้ข้อมูลป้อนกลับที่สร้างสรรค์ และประเมินครบทั้ง K P A'},
                {'id': 'p2_7', 'title': 'บุคลิกภาพและมาตรฐานวิชาชีพครู',
                 'desc': 'การแต่งกาย การใช้ภาษา ความเมตตา การควบคุมอารมณ์ ความเชี่ยวชาญเนื้อหา และความรับผิดชอบ'},
                {'id': 'p2_8', 'title': 'การสอดแทรกคุณค่าและสมรรถนะที่พึงประสงค์',
                 'desc': 'คุณธรรมจริยธรรม สมรรถนะตามหลักสูตร หลักปรัชญาเศรษฐกิจพอเพียง และทักษะแห่งศตวรรษที่ 21'},
            ]},
        ],
        # ส่วนที่ 4 ติดตามพัฒนาการ: ด้าน ← ข้อที่ใช้คิด
        'aspects': [
            ['การวางแผนและออกแบบการจัดการเรียนรู้เชิงรุก', ['p1_1']],
            ['การนำกิจกรรม Active Learning สู่การปฏิบัติ', ['p2_2']],
            ['การส่งเสริมการคิดขั้นสูงของผู้เรียน', ['p2_3']],
            ['การจัดการชั้นเรียนและบรรยากาศการเรียนรู้', ['p2_4']],
            ['การใช้สื่อ นวัตกรรม และเทคโนโลยี', ['p2_5']],
            ['การวัดและประเมินผลระหว่างเรียน', ['p2_6']],
            ['บุคลิกภาพและมาตรฐานวิชาชีพ', ['p2_7']],
        ],
        # ช่องข้อความท้ายแบบ (คอลัมน์ใน sv_evals → หัวข้อ)
        'texts': [['highlight', 'พฤติกรรมเด่น / นวัตกรรมที่พบในการสอนคาบนี้'],
                  ['strengths', 'จุดเด่น / สิ่งที่ควรรักษาไว้'],
                  ['improvements', 'จุดที่ควรพัฒนาและแนวทาง']],
        'item_note': 'ข้อเสนอแนะ',
        'reflect': [
            ['r1', 'สิ่งที่ดำเนินไปได้ดีที่สุดในคาบนี้ และการมีส่วนร่วมของผู้เรียน'],
            ['r2', 'เทคนิค Active Learning / การคิดขั้นสูงที่ผู้เรียนแสดงออก'],
            ['r3', 'ปัญหา อุปสรรค และสิ่งที่จะปรับปรุงหากสอนใหม่'],
            ['r4', 'ผู้เรียนบรรลุจุดประสงค์การเรียนรู้มากน้อยเพียงใด'],
        ],
        # เกณฑ์แปลผล: ค่าเฉลี่ยรายข้อ (0–4) และร้อยละรวม — [ขั้นต่ำ, ระดับ]
        'mean_levels': [[3.51, 'ดีมาก'], [2.51, 'ดี'], [1.51, 'พอใช้'], [0.51, 'น้อยมาก'], [0, 'ไม่มีการปฏิบัติ']],
        'pct_levels': [[80, 'ดีมาก'], [70, 'ดี'], [60, 'พอใช้'], [0, 'ควรพัฒนา']],
    },
    # แบบบันทึกการสังเกตชั้นเรียน (CLASSROOM OBSERVATION) ตามระบบนิเทศภายใน PEER CARE Model ของโรงเรียน
    # ใช้กับรอบเพื่อนคู่นิเทศสังเกตการสอน · คะแนน 1–5 · แปลผลด้วยค่าเฉลี่ยรายด้านและรวมทุกด้าน
    'obs1': {
        'name': 'แบบบันทึกการสังเกตชั้นเรียน (CLASSROOM OBSERVATION)',
        'subtitle': 'ตามระบบการนิเทศภายในสถานศึกษา PEER CARE Model',
        'kind': 'observe',
        'scale': [[5, 'ดีมาก'], [4, 'ดี'], [3, 'ปานกลาง'], [2, 'พอใช้'], [1, 'ควรปรับปรุงแก้ไข']],
        'parts': [
            {'id': 'a', 'title': 'ก. การจัดบรรยากาศในชั้นเรียน', 'items': [
                {'id': 'a1', 'title': 'มีบรรยากาศเหมาะสมต่อการเรียนรู้'},
                {'id': 'a2', 'title': 'มีความเป็นระเบียบของห้อง เช่น โต๊ะเก้าอี้ครู-นักเรียน'},
                {'id': 'a3', 'title': 'บรรยากาศในห้องเรียนเป็นบรรยากาศทางวิชาการ มีการจัดมุมความรู้/ป้ายนิเทศ/มุมสื่อการเรียนรู้ ข่าวสารความรู้ต่าง ๆ'},
                {'id': 'a4', 'title': 'มีการจัดแสดงผลงานนักเรียน/ผลงานห้องเรียน'},
                {'id': 'a5', 'title': 'การจัดมุมเก็บอุปกรณ์ทำความสะอาดมีความเหมาะสม ห้องเรียนสะอาด สะดวก เรียบร้อย ปลอดภัย'},
            ]},
            {'id': 'b', 'title': 'ข. การประเมินสมรรถนะการจัดการเรียนรู้เชิงรุก', 'items': [
                {'id': 'b1', 'title': 'มีการวางแผนและออกแบบการจัดการเรียนรู้เชิงรุก'},
                {'id': 'b2', 'title': 'มีการนำกิจกรรมการเรียนรู้เชิงรุกสู่การปฏิบัติในชั้นเรียน'},
                {'id': 'b3', 'title': 'การจัดบรรยากาศและบริหารจัดการชั้นเรียนเชิงรุก'},
                {'id': 'b4', 'title': 'การวัดและประเมินผลตามสภาพจริง'},
                {'id': 'b5', 'title': 'การส่งเสริมทักษะการคิดขั้นสูงและสมรรถนะศตวรรษที่ 21'},
            ]},
            {'id': 'c', 'title': 'ค. ด้านพฤติกรรมของนักเรียน', 'items': [
                {'id': 'c1', 'title': 'สามารถแสดงออก/สื่อสารและกล้าซักถามครูผู้สอนได้อย่างเหมาะสม'},
                {'id': 'c2', 'title': 'นักเรียนมีความสนใจใฝ่รู้และกระตือรือร้นที่จะเรียนรู้'},
                {'id': 'c3', 'title': 'มีความสนใจปฏิบัติกิจกรรมที่ได้รับมอบหมาย'},
                {'id': 'c4', 'title': 'แต่งกายสะอาด เรียบร้อย มีระเบียบวินัยดี และมีมารยาท'},
                {'id': 'c5', 'title': 'มีระเบียบวินัยดี และมีมารยาทเรียบร้อย'},
            ]},
        ],
        'office': 'สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพังงา ภูเก็ต ระนอง',
        'texts': [['improvements', 'ตอนที่ 3 ข้อเสนอแนะ']],
        'item_note': 'หมายเหตุ',
        'aspects': [],
        'reflect': [],
        # ต้นฉบับพิมพ์ช่วง "ปานกลาง" ผิดเป็น 2.51–2.50 → ใช้ 2.51–3.50
        'mean_levels': [[4.51, 'ดีมาก'], [3.51, 'ดี'], [2.51, 'ปานกลาง'], [1.51, 'พอใช้'], [0, 'ควรปรับปรุงแก้ไข']],
    },
}
DEFAULT_FORM = 'v1'          # วันนิเทศภายใน (กรรมการ 3 คน) — รอแบบประเมินฉบับจริงจากโรงเรียน
DEFAULT_PRE_FORM = 'obs1'    # เพื่อนคู่นิเทศสังเกตการสอน
DATE_RE = re.compile(r'\d{4}-\d{2}-\d{2}')
SPREAD_FLAG = 2          # กรรมการให้คะแนนข้อเดียวกันห่างกันตั้งแต่กี่ระดับ จึงติดธงให้คุยกัน
TREND_EPS = 0.25         # ส่วนที่ 4: ต่างกันเกินเท่านี้จึงนับว่าดีขึ้น/ลดลง
LINK_DAYS = 14           # ลิงก์เฉพาะกิจใช้ได้อีกกี่วันหลังผู้รับการนิเทศกดรับทราบ


def form_items(form):
    return [it for p in form['parts'] for it in p['items']]


def scale_range(form):
    vals = [n for n, _ in form['scale']]
    return min(vals), max(vals)


def form_of(v, rnd):
    """แบบที่ใช้กับรอบนั้นของนัด: รอบสังเกตก่อนใช้ pre_form · วันนิเทศภายในใช้ form"""
    key = v['pre_form'] if rnd == 'pre' else v['form']
    return FORMS.get(key) or FORMS[DEFAULT_PRE_FORM if rnd == 'pre' else DEFAULT_FORM]


def observe_result(form, scores):
    """แปลผลแบบสังเกตชั้นเรียน 1 ใบ: รวม/ค่าเฉลี่ยรายด้าน + รวมเฉลี่ยทุกด้าน (ตามแบบฟอร์มกระดาษ)"""
    parts, means = [], []
    for p in form['parts']:
        vals = [scores[it['id']] for it in p['items'] if it['id'] in scores]
        mean = r2(sum(vals) / len(vals)) if vals else None
        parts.append(dict(id=p['id'], title=p['title'], total=sum(vals), n=len(vals), mean=mean,
                          level=level_of(mean, form['mean_levels']) if mean is not None else ''))
        if mean is not None:
            means.append(mean)
    overall = r2(sum(means) / len(means)) if len(means) == len(parts) and parts else None
    ranked = sorted((p for p in parts if p['mean'] is not None), key=lambda p: -p['mean'])
    return dict(parts=parts, mean=overall, level=level_of(overall, form['mean_levels']) if overall is not None else '',
                best=ranked[0]['title'] if ranked else '', weakest=ranked[-1]['title'] if len(ranked) > 1 else '')


def level_of(value, table):
    for low, name in table:
        if value >= low:
            return name
    return table[-1][1]


def r2(x):
    return round(x + 1e-9, 2)


def aspect_scores(form, scores):
    """คะแนนรายด้าน (ส่วนที่ 4) จาก {ข้อ: คะแนน} → [ค่าเฉลี่ย 0–4 | None]"""
    out = []
    for _, ids in form['aspects']:
        vals = [scores[i] for i in ids if i in scores]
        out.append(r2(sum(vals) / len(vals)) if vals else None)
    return out


def interpret(form, mains, pre=None):
    """แปลผลจากแบบประเมินรอบจริงที่ส่งแล้ว (mains = [{name, scores}]) + รอบเพื่อนคู่นิเทศ (pre = scores | None)"""
    items = form_items(form)
    rows, total = [], 0.0
    for it in items:
        vals = [m['scores'][it['id']] for m in mains if it['id'] in m['scores']]
        mean = sum(vals) / len(vals) if vals else 0.0
        total += mean
        rows.append(dict(id=it['id'], title=it['title'], scores=vals, mean=r2(mean),
                         level=level_of(r2(mean), form['mean_levels']),
                         spread=(max(vals) - min(vals)) if vals else 0,
                         flag=bool(vals) and max(vals) - min(vals) >= SPREAD_FLAG))
    top_score = scale_range(form)[1]
    full = top_score * len(items)
    pct = r2(total * 100 / full) if full else 0
    parts = []
    for p in form['parts']:
        ids = {it['id'] for it in p['items']}
        s = sum(r['mean'] for r in rows if r['id'] in ids)
        parts.append(dict(id=p['id'], title=p['title'], score=r2(s), full=top_score * len(ids)))
    # จุดเด่น = 3 ข้อคะแนนสูงสุดที่ได้ระดับดีขึ้นไป · ควรพัฒนา = 3 ข้อต่ำสุดที่ยังไม่ถึงดีมาก (ไม่ซ้ำกับจุดเด่น)
    ranked = sorted(rows, key=lambda r: -r['mean'])          # sorted คงลำดับเดิมเมื่อคะแนนเท่ากัน
    good, best = form['mean_levels'][1][0], form['mean_levels'][0][0]     # เกณฑ์ระดับ "ดี" และ "ดีมาก"
    top = [r['title'] for r in ranked[:3] if r['mean'] >= good]
    low = [r['title'] for r in sorted(rows, key=lambda r: r['mean']) if r['mean'] < best and r['title'] not in top][:3]
    level = level_of(pct, form['pct_levels'])
    text = f'ผลการนิเทศอยู่ในระดับ{level} ได้ {r2(total):g} จาก {full} คะแนน คิดเป็นร้อยละ {pct:g} '
    if top:
        text += 'จุดเด่น ได้แก่ ' + ' · '.join(top) + ' '
    text += ('ควรพัฒนาเพิ่มเติมเรื่อง ' + ' · '.join(low)) if low else 'ทุกรายการอยู่ในระดับดีมาก'
    flagged = [r['title'] for r in rows if r['flag']]
    res = dict(items=rows, parts=parts, total=r2(total), full=full, percent=pct, level=level,
               strengths=top, improve=low, flagged=flagged, summary=text, raters=len(mains))
    # ส่วนที่ 4: ก่อนนิเทศ (เพื่อนคู่นิเทศสังเกตก่อน) เทียบหลังนิเทศ (ค่าเฉลี่ยกรรมการ)
    after_scores = {r['id']: r['mean'] for r in rows}
    after = aspect_scores(form, after_scores)
    before = aspect_scores(form, pre) if pre else [None] * len(after)
    asp = []
    for (name, _), b, a in zip(form['aspects'], before, after):
        trend = ''
        if b is not None and a is not None:
            trend = 'ดีขึ้น' if a - b > TREND_EPS else 'ลดลง' if b - a > TREND_EPS else 'คงที่'
        asp.append(dict(name=name, before=b, after=a, trend=trend))
    full4 = top_score * len(asp)

    def tot(vals):
        vals = [v for v in vals if v is not None]
        return dict(score=r2(sum(vals)), percent=r2(sum(vals) * 100 / full4)) if len(vals) == len(asp) and asp else None
    res['aspects'] = dict(rows=asp, full=full4, before=tot(before), after=tot(after))
    return res


def init(app, get_db, login_required, current_user, get_settings):
    from flask import g, jsonify, request, send_from_directory

    with get_db() as con:
        con.executescript(SCHEMA)
        cols = {r[1] for r in con.execute('PRAGMA table_info(sv_visits)')}
        if 'pre_form' not in cols:                  # ฐานข้อมูลเดิมก่อนมีแบบสังเกตชั้นเรียน: นัดเก่ายังใช้แบบเดิมทั้งสองรอบ
            con.execute("ALTER TABLE sv_visits ADD COLUMN pre_form TEXT NOT NULL DEFAULT 'v1'")
        if 'kind' not in cols:
            con.execute("ALTER TABLE sv_visits ADD COLUMN kind TEXT NOT NULL DEFAULT 'full'")

    def fill_areas():
        """นัดที่ยังไม่มีกลุ่มสาระ (สร้างตอนยังไม่กำหนดวันนิเทศภายใน) → ใส่กลุ่มสาระหลักของครูจากตารางสอน"""
        with get_db() as con:
            for v in con.execute("SELECT v.id, v.teacher_id, t.id term_id FROM sv_visits v JOIN tt_terms t ON t.name=v.term "
                                 "WHERE COALESCE(v.area,'')='' AND v.teacher_id IS NOT NULL").fetchall():
                a = teacher_area(con, v['teacher_id'], v['term_id'])
                if a:
                    con.execute('UPDATE sv_visits SET area=? WHERE id=?', (a, v['id']))

    def bad(msg, code=400):
        return jsonify(success=False, message=msg), code

    def can_manage(u):
        if not u:
            return False
        if u['role'] == 'admin':
            return True
        with get_db() as con:
            return bool(con.execute('SELECT 1 FROM tt_editors WHERE user_id=?', (u['id'],)).fetchone())

    def clean(s, n=3000):
        return re.sub(r'[ \t]+', ' ', str(s or '')).strip()[:n]

    def now():
        return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # ── "ฉันคือใคร" ───────────────────────────────────────
    def acting(con, u, raw):
        """ตัวตนของผู้ใช้บนหน้าเว็บ → ('t', id, ชื่อ) | ('n', None, ชื่อ) | None
        บัญชีที่ผูกกับครูในตารางสอนแล้วใช้ครูคนนั้นเสมอ (เลือกชื่อคนอื่นไม่ได้) · เข้าทางลิงก์เฉพาะกิจ = คนในลิงก์"""
        if getattr(g, 'sv_who', None):
            return g.sv_who
        if not u:
            return None
        me = con.execute('SELECT id, name FROM tt_teachers WHERE user_id=?', (u['id'],)).fetchone()
        if me:
            return ('t', me['id'], me['name'])
        raw = str(raw or '')
        if raw.startswith('t:') and raw[2:].isdigit():
            t = con.execute('SELECT id, name FROM tt_teachers WHERE id=?', (int(raw[2:]),)).fetchone()
            return ('t', t['id'], t['name']) if t else None
        if raw.startswith('n:') and clean(raw[2:], 80):
            return ('n', None, clean(raw[2:], 80))
        return None

    def same(who, pid, pname):
        """ตัวตน who ตรงกับบุคคล (id, ชื่อ) ไหม"""
        if not who:
            return False
        if who[0] == 't' and pid:
            return who[1] == pid
        return bool(pname) and bare_name(who[2]) == bare_name(pname)

    def person(con, p):
        """{id | name, position} จากหน้าเว็บ → (id|None, ชื่อ, ตำแหน่ง)"""
        p = p or {}
        pos = clean(p.get('position'), 80)
        pid = p.get('id')
        if pid not in (None, ''):
            try:
                t = con.execute('SELECT id, name FROM tt_teachers WHERE id=?', (int(pid),)).fetchone()
            except (TypeError, ValueError):
                t = None
            if t:
                return t['id'], t['name'], pos
        name = clean(p.get('name'), 80)
        if name:
            for t in con.execute('SELECT id, name FROM tt_teachers'):
                if bare_name(t['name']) == bare_name(name):
                    return t['id'], t['name'], pos
        return None, name, pos

    # ── ตารางสอน ─────────────────────────────────────────
    def area_of(con, code):
        r = con.execute('SELECT area FROM tt_subjects WHERE code=?', (re.sub(r'\s+', '', code or ''),)).fetchone()
        return (r['area'] or '') if r else ''

    def teacher_area(con, tid, term_id):
        """กลุ่มสาระหลักของครู = กลุ่มสาระที่สอนมากที่สุดในตารางสอนภาคเรียนนั้น"""
        count = {}
        for r in con.execute('SELECT l.code, l.teacher_ids, COUNT(s.id) n FROM tt_lessons l JOIN tt_slots s ON s.lesson_id=l.id '
                             "WHERE l.term_id=? AND l.kind='subject' AND l.code<>'' GROUP BY l.id", (term_id,)):
            if tid in jl(r['teacher_ids'], []):
                a = area_of(con, r['code'])
                if a:
                    count[a] = count.get(a, 0) + r['n']
        return max(count, key=count.get) if count else ''

    def subject_title(con, code):
        r = con.execute('SELECT name FROM tt_subjects WHERE code=?', (code,)).fetchone()
        return (r['name'] or '') if r else ''

    def day_lessons(con, teacher_id, date, settings):
        """คาบสอนของครูในวันนั้นจากตารางสอน (คาบติดกันของวิชาเดียวกันรวมเป็น "3-4")"""
        try:
            d = datetime.date.fromisoformat(date)
        except (TypeError, ValueError):
            return None, []
        term = term_for_date(con, date, settings)
        wd = tt_day(con, date)                       # วันสอนชดเชย (เสาร์) ใช้ตารางวันที่ตั้งไว้
        if not term or wd > 5:
            return term, []
        times = {p['no']: p for p in jl(term['config'], {}).get('periods', [])}
        slots = {}
        for r in con.execute("""SELECT l.id, l.code, l.title, l.kind, l.classes, l.track, l.teacher_ids, s.period
                                FROM tt_lessons l JOIN tt_slots s ON s.lesson_id=l.id
                                WHERE l.term_id=? AND s.day=? ORDER BY s.period""", (term['id'], wd)):
            if teacher_id in jl(r['teacher_ids'], []) and r['kind'] == 'subject' and r['code']:
                slots.setdefault(r['id'], dict(r=r, periods=[]))['periods'].append(r['period'])
        out = []
        for v in slots.values():
            r, run = v['r'], []
            for p in sorted(v['periods']) + [None]:
                if run and (p is None or p != run[-1] + 1):
                    a, b = times.get(run[0], {}), times.get(run[-1], {})
                    cls = ', '.join('ม.' + c for c in jl(r['classes'], []))
                    out.append(dict(
                        period=str(run[0]) if len(run) == 1 else f'{run[0]}-{run[-1]}',
                        time=f"{a.get('start', '')}–{b.get('end', '')}" if a and b else '',
                        code=r['code'], title=r['title'] or subject_title(con, r['code']),
                        class_label=cls + (f" ({r['track']})" if r['track'] else ''), area=area_of(con, r['code'])))
                    run = []
                if p is not None:
                    run.append(p)
        out.sort(key=lambda x: int(x['period'].split('-')[0]))
        return term, out

    # ── โหลดนัด + แบบประเมิน ───────────────────────────────
    def eval_dict(r, full):
        d = dict(round=r['round'], seat=r['seat'], evaluator_id=r['evaluator_id'], evaluator_name=r['evaluator_name'],
                 position=r['position'], status=r['status'], submitted_at=r['submitted_at'])
        if full:
            d.update(scores=jl(r['scores'], {}), comments=jl(r['comments'], {}), highlight=r['highlight'],
                     strengths=r['strengths'], improvements=r['improvements'], updated_at=r['updated_at'])
        return d

    def load(con, vid):
        v = con.execute('SELECT * FROM sv_visits WHERE id=?', (vid,)).fetchone()
        if not v:
            return None, []
        return v, con.execute('SELECT * FROM sv_evals WHERE visit_id=? ORDER BY round DESC, seat', (vid,)).fetchall()

    def progress(v, evals):
        """สถานะของนัด (คำนวณจากแบบประเมิน ไม่เก็บซ้ำ)"""
        mains = [e for e in evals if e['round'] == 'main']
        pre = next((e for e in evals if e['round'] == 'pre'), None)
        done = sum(e['status'] == 'submitted' for e in mains)
        pre_done = bool(pre) and pre['status'] == 'submitted'
        if v['kind'] == 'obs':
            st, th = ('pre_done', 'สังเกตแล้ว') if pre_done else ('scheduled', 'รอสังเกตการสอน')
        elif v['ack_at']:
            st, th = 'ack', 'รับทราบผลแล้ว'
        elif len(mains) == 3 and done == 3:
            st, th = 'done', 'ประเมินครบ รอรับทราบ'
        elif done:
            st, th = 'evaluating', f'กำลังประเมิน {done}/3'
        elif pre_done:
            st, th = 'pre_done', 'เพื่อนคู่นิเทศสังเกตแล้ว'
        else:
            st, th = 'scheduled', 'รอนิเทศ'
        return dict(status=st, status_th=th, main_done=done, main_total=3, main_set=len(mains), pre_done=pre_done)

    def visit_brief(v, evals):
        d = {k: v[k] for k in ('id', 'term', 'teacher_id', 'teacher_name', 'area', 'date', 'period', 'code', 'title',
                               'class_label', 'peer_seat', 'pre_date', 'pre_period', 'pre_lesson', 'kind')}
        d.update(progress(v, evals))
        d['committee'] = [dict(seat=e['seat'], id=e['evaluator_id'], name=e['evaluator_name'], position=e['position'],
                               peer=e['seat'] == v['peer_seat'], submitted=e['status'] == 'submitted')
                          for e in evals if e['round'] == 'main']
        return d

    def result_of(v, evals):
        form = FORMS.get(v['form'], FORMS[DEFAULT_FORM])
        mains = [e for e in evals if e['round'] == 'main']
        if len(mains) < 3 or any(e['status'] != 'submitted' for e in mains):
            return None
        pre = next((e for e in evals if e['round'] == 'pre' and e['status'] == 'submitted'), None)
        same_form = v['pre_form'] == v['form']       # ส่วนที่ 4 เทียบก่อน-หลังได้เมื่อสองรอบใช้แบบเดียวกัน
        return interpret(form, [dict(name=e['evaluator_name'], scores=jl(e['scores'], {})) for e in mains],
                         jl(pre['scores'], {}) if (pre and same_form) else None)

    # ── อ่าน ──────────────────────────────────────────────
    @app.get('/api/sv/meta')
    @login_required
    def sv_meta():
        u, s = current_user(), get_settings()
        with get_db() as con:
            terms = [r['name'] for r in con.execute('SELECT name FROM tt_terms')]
            terms = sorted(set(terms) | {r['term'] for r in con.execute('SELECT DISTINCT term FROM sv_visits')},
                           key=lambda n: (n[2:], n[0]), reverse=True)
            cur = term_for_date(con, datetime.date.today().isoformat(), s)
            teachers = [dict(r) for r in con.execute(
                'SELECT id, name FROM tt_teachers WHERE COALESCE(active,1)=1 ORDER BY sort_order, id')]
            others = sorted({r['evaluator_name'] for r in con.execute(
                'SELECT DISTINCT evaluator_name FROM sv_evals WHERE evaluator_id IS NULL')})
            me = con.execute('SELECT id FROM tt_teachers WHERE user_id=?', (u['id'],)).fetchone()
        return jsonify(terms=terms, default_term=cur['name'] if cur else (terms[0] if terms else ''),
                       teachers=teachers, others=others, my_teacher_id=me['id'] if me else None,
                       can_manage=can_manage(u), forms=FORMS, default_form=DEFAULT_FORM, default_pre_form=DEFAULT_PRE_FORM,
                       director=s.get('director_name') or '')

    @app.get('/api/sv/slots')
    @login_required
    def sv_slots():
        """คาบสอนของครูในวันที่เลือก (ดึงจากตารางสอน) ?teacher_id=&date="""
        try:
            tid = int(request.args.get('teacher_id', ''))
        except ValueError:
            return bad('เลือกครูก่อน')
        with get_db() as con:
            term, lessons = day_lessons(con, tid, request.args.get('date', ''), get_settings())
        return jsonify(term=term['name'] if term else '', lessons=lessons)

    @app.get('/api/sv/visits')
    @login_required
    def sv_visits():
        term = request.args.get('term', '')
        u = current_user()
        with get_db() as con:
            who = acting(con, u, request.args.get('as'))
            mgr = can_manage(u)
            out = []
            for v in con.execute('SELECT * FROM sv_visits WHERE term=? ORDER BY date, period, id', (term,)).fetchall():
                evals = con.execute('SELECT * FROM sv_evals WHERE visit_id=? ORDER BY round DESC, seat', (v['id'],)).fetchall()
                d = visit_brief(v, evals)
                # บทบาทของ "ฉัน" ในนัดนี้ + งานที่ยังค้าง
                roles, todo = [], []
                if same(who, v['teacher_id'], v['teacher_name']):
                    roles.append('teacher')
                    if d['status'] == 'done':
                        todo.append('ดูผลและกดรับทราบ')
                    elif not (v['unit'] or v['topic']):
                        todo.append('กรอกข้อมูลก่อนสอน')
                for e in evals:
                    if same(who, e['evaluator_id'], e['evaluator_name']):
                        roles.append(e['round'] + str(e['seat']))
                        if e['status'] != 'submitted':
                            todo.append('สังเกตการสอนก่อนนิเทศ' if e['round'] == 'pre' else 'ให้คะแนนนิเทศ')
                d.update(my_roles=roles, todo=todo)
                if mgr and d['status'] in ('done', 'ack'):
                    res = result_of(v, evals)
                    d.update(percent=res['percent'], level=res['level'])
                out.append(d)
        return jsonify(visits=out)

    @app.get('/api/sv/visits/<int:vid>')
    @login_required
    def sv_visit(vid):
        u = current_user()
        with get_db() as con:
            v, evals = load(con, vid)
            if not v:
                return bad('ไม่พบนัดนิเทศ', 404)
            who = acting(con, u, request.args.get('as'))
            mgr = can_manage(u)
            is_teacher = same(who, v['teacher_id'], v['teacher_name'])
            mine = [e for e in evals if same(who, e['evaluator_id'], e['evaluator_name'])]
            if not (mgr or is_teacher or mine):
                return bad('นัดนี้ไม่ใช่ของคุณ — เลือกชื่อตัวเองให้ตรงก่อน')
            prog = progress(v, evals)
            all_done = prog['status'] in ('done', 'ack')
            out = []
            for e in evals:
                own = e in mine
                if e['round'] == 'pre':
                    # รอบสังเกตก่อน: เจ้าของเห็นเสมอ · ผู้รับการนิเทศเห็นเมื่อส่งแล้ว · กรรมการอีก 2 คนเห็นเมื่อรอบจริงครบ
                    full = mgr or own or (e['status'] == 'submitted' and (is_teacher or all_done))
                else:
                    full = mgr or own or all_done
                out.append(dict(eval_dict(e, full), mine=own, peer=e['seat'] == v['peer_seat']))
            d = visit_brief(v, evals)
            pre_e = next((e for e in evals if e['round'] == 'pre'), None)
            pre_seen = pre_e is not None and pre_e['status'] == 'submitted' and \
                (mgr or pre_e in mine or is_teacher or all_done)
            d.update(pre_result=observe_result(form_of(v, 'pre'), jl(pre_e['scores'], {})) if pre_seen else None)
            # ประวัติการนิเทศของครูคนนี้ในภาคเรียนอื่น (ผลที่แปลแล้ว) — ฝ่ายวิชาการและเจ้าตัวเห็น
            hist = []
            if (mgr or is_teacher) and v['teacher_id']:
                for h in con.execute('SELECT * FROM sv_visits WHERE teacher_id=? AND term<>? ORDER BY date DESC',
                                     (v['teacher_id'], v['term'])).fetchall():
                    hev = con.execute('SELECT * FROM sv_evals WHERE visit_id=?', (h['id'],)).fetchall()
                    row = dict(term=h['term'], date=h['date'], code=h['code'], title=h['title'],
                               class_label=h['class_label'], **progress(h, hev))
                    res = result_of(h, hev)
                    if res:
                        row.update(percent=res['percent'], level=res['level'])
                    hp = next((e for e in hev if e['round'] == 'pre' and e['status'] == 'submitted'), None)
                    if hp and form_of(h, 'pre').get('kind') == 'observe':
                        ob = observe_result(form_of(h, 'pre'), jl(hp['scores'], {}))
                        row.update(obs_mean=ob['mean'], obs_level=ob['level'])
                    hist.append(row)
            d.update(history=hist)
            d.update(form=v['form'], pre_form=v['pre_form'], plan_no=v['plan_no'], unit=v['unit'], topic=v['topic'], focus=v['focus'],
                     reflection=jl(v['reflection'], {}), agreed=v['agreed'], ack_at=v['ack_at'],
                     is_teacher=is_teacher, can_manage=mgr, evals=out,
                     result=result_of(v, evals) if (all_done and (mgr or is_teacher or mine)) else None)
        return jsonify(d)

    # ── จัดการนัด (ฝ่ายวิชาการ) ─────────────────────────────
    def visit_fields(con, b, settings):
        tid, tname, _ = person(con, {'id': b.get('teacher_id')})
        if not tid:
            return None, 'เลือกครูผู้รับการนิเทศ'
        # วันนิเทศภายในเว้นไว้ก่อนได้ (นัดสังเกตการสอนอย่างเดียว) — ภาคเรียนมาจากช่อง "ภาคเรียน" บนหน้าเว็บ
        kind = 'obs' if b.get('kind') == 'obs' else 'full'
        date = '' if kind == 'obs' else str(b.get('date') or '')
        if date and not DATE_RE.fullmatch(date):
            return None, 'วันที่นิเทศภายในไม่ถูกต้อง'
        if date:
            term = term_for_date(con, date, settings)
            if not term:
                return None, ('ยังไม่มีตารางสอนของภาคเรียนที่วันนี้อยู่ — สร้าง/นำเข้าตารางสอนภาคเรียนนั้นก่อน '
                              '(เมนู วิชาการ → ตารางสอน) แล้วค่อยสร้างนัดนิเทศ เพราะคาบสอนดึงจากตารางสอน')
            code = clean(b.get('code'), 20)
            if not code:
                return None, 'เลือกคาบสอนที่จะนิเทศภายใน (หรือลบวันที่ออก ถ้ายังไม่กำหนดวันนิเทศภายใน)'
        else:
            term = con.execute('SELECT * FROM tt_terms WHERE name=?', (clean(b.get('term'), 10),)).fetchone() \
                or term_for_date(con, datetime.date.today().isoformat(), settings)
            if not term:
                return None, 'เลือกภาคเรียนก่อน'
            code = ''
        com = (b.get('committee') or [])[:3]
        com += [{}] * (3 - len(com))
        # ที่นั่งว่างได้: เพื่อนคู่นิเทศเข้าสังเกตก่อน กรรมการอีก 2 คนกำหนดทีหลังได้ (ต้องครบ 3 คนก่อนวันนิเทศภายในจึงแปลผล)
        people = [person(con, p) for p in com]
        try:
            peer = int(b.get('peer_seat') or 0)
        except (TypeError, ValueError):
            peer = 0
        if peer not in (1, 2, 3):
            return None, 'เลือกว่ากรรมการคนไหนเป็นเพื่อนคู่นิเทศ'
        if not people[peer - 1][1]:
            return None, f'ใส่ชื่อเพื่อนคู่นิเทศ (แถวที่ {peer}) — กรรมการอีก 2 คนเว้นไว้ก่อนได้'
        keys = [p[0] or bare_name(p[1]) for p in people if p[1]]
        if len(set(keys)) != len(keys):
            return None, 'กรรมการซ้ำกัน'
        if tid in [p[0] for p in people]:
            return None, 'ผู้รับการนิเทศเป็นกรรมการของตัวเองไม่ได้'
        pre_date = str(b.get('pre_date') or '')
        if pre_date and not DATE_RE.fullmatch(pre_date):
            return None, 'วันที่สังเกตก่อนนิเทศไม่ถูกต้อง'
        if kind == 'obs':                            # สังเกตเพิ่มเติม: มีแค่ผู้สังเกต 1 คน
            people = [people[peer - 1] if i == peer - 1 else (None, '', '') for i in range(3)]
        f = dict(kind=kind, term=term['name'], teacher_id=tid, teacher_name=tname,
                 area=clean(b.get('area'), 60) or (area_of(con, code) if code else teacher_area(con, tid, term['id'])),
                 date=date, period=clean(b.get('period'), 10) if date else '', code=code,
                 title=clean(b.get('title'), 120) if date else '', class_label=clean(b.get('class_label'), 60) if date else '', peer_seat=peer, pre_date=pre_date,
                 pre_period=clean(b.get('pre_period'), 10), pre_lesson=clean(b.get('pre_lesson'), 160))
        return (f, people), None

    def sync_evals(con, vid, people, peer_seat):
        """ตั้ง/ปรับกรรมการของนัด — เปลี่ยนตัวคนแล้วแบบประเมินของที่นั่งนั้นเริ่มใหม่ ไม่เปลี่ยนตัวคงคะแนนเดิมไว้"""
        want = {('main', i + 1): p for i, p in enumerate(people) if p[1]}     # ที่นั่งที่ยังไม่กำหนดตัว = ยังไม่มีแบบประเมิน
        want[('pre', peer_seat)] = people[peer_seat - 1]
        have = {(e['round'], e['seat']): e for e in con.execute('SELECT * FROM sv_evals WHERE visit_id=?', (vid,))}
        for key, e in have.items():
            p = want.get(key)
            if not p or not same(('t', p[0], p[1]) if p[0] else ('n', None, p[1]), e['evaluator_id'], e['evaluator_name']):
                con.execute('DELETE FROM sv_evals WHERE id=?', (e['id'],))
                have[key] = None
        for (rnd, seat), (pid, pname, pos) in want.items():
            if have.get((rnd, seat)):
                con.execute('UPDATE sv_evals SET position=? WHERE id=?', (pos, have[(rnd, seat)]['id']))
            else:
                con.execute('INSERT INTO sv_evals (visit_id, round, seat, evaluator_id, evaluator_name, position) '
                            'VALUES (?,?,?,?,?,?)', (vid, rnd, seat, pid, pname, pos))

    @app.post('/api/sv/visits')
    @login_required
    def sv_create():
        u = current_user()
        if not can_manage(u):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        with get_db() as con:
            got, err = visit_fields(con, request.get_json() or {}, get_settings())
            if err:
                return bad(err)
            f, people = got
            if f['kind'] == 'full' and con.execute("SELECT 1 FROM sv_visits WHERE term=? AND teacher_id=? AND kind='full'",
                                                   (f['term'], f['teacher_id'])).fetchone():
                return bad(f"{f['teacher_name']} มีนัดนิเทศในภาคเรียน {f['term']} แล้ว (นิเทศคนละ 1 ครั้ง) — "
                           'ถ้าต้องการให้อีกคนเข้าสังเกตเพิ่ม ติ๊ก "นัดสังเกตการสอนเพิ่มเติม"')
            if f['kind'] == 'obs':
                pname = people[f['peer_seat'] - 1][1]
                for o in con.execute("SELECT e.evaluator_name FROM sv_visits v JOIN sv_evals e ON e.visit_id=v.id AND e.round='pre' "
                                     "WHERE v.term=? AND v.teacher_id=?", (f['term'], f['teacher_id'])):
                    if bare_name(o['evaluator_name']) == bare_name(pname):
                        return bad(f"{pname} เป็นผู้สังเกต {f['teacher_name']} อยู่แล้วในภาคเรียนนี้")
            cur = con.execute(
                f"INSERT INTO sv_visits ({', '.join(f)}, form, pre_form, created_by) VALUES ({', '.join('?' * len(f))}, ?, ?, ?)",
                list(f.values()) + [DEFAULT_FORM, DEFAULT_PRE_FORM, u['id']])
            sync_evals(con, cur.lastrowid, people, f['peer_seat'])
        return jsonify(success=True, id=cur.lastrowid,
                       message='สร้างนัดนิเทศแล้ว' if f['date'] else 'สร้างนัดสังเกตการสอนเพิ่มเติมแล้ว' if f['kind'] == 'obs'
                       else 'สร้างนัดสังเกตการสอนแล้ว — ใส่วันนิเทศภายในทีหลังด้วย "แก้นัด"')

    @app.put('/api/sv/visits/<int:vid>')
    @login_required
    def sv_update(vid):
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        with get_db() as con:
            v, _ = load(con, vid)
            if not v:
                return bad('ไม่พบนัดนิเทศ', 404)
            got, err = visit_fields(con, request.get_json() or {}, get_settings())
            if err:
                return bad(err)
            f, people = got
            if f['kind'] == 'full' and con.execute("SELECT 1 FROM sv_visits WHERE term=? AND teacher_id=? AND id<>? AND kind='full'",
                                                   (f['term'], f['teacher_id'], vid)).fetchone():
                return bad(f"{f['teacher_name']} มีนัดนิเทศในภาคเรียน {f['term']} แล้ว")
            con.execute(f"UPDATE sv_visits SET {', '.join(k + '=?' for k in f)} WHERE id=?", list(f.values()) + [vid])
            sync_evals(con, vid, people, f['peer_seat'])
        return jsonify(success=True, message='บันทึกนัดนิเทศแล้ว')

    @app.delete('/api/sv/visits/<int:vid>')
    @login_required
    def sv_delete(vid):
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        with get_db() as con:
            con.execute('DELETE FROM sv_evals WHERE visit_id=?', (vid,))
            con.execute('DELETE FROM sv_links WHERE visit_id=?', (vid,))
            con.execute('DELETE FROM sv_visits WHERE id=?', (vid,))
        return jsonify(success=True, message='ลบนัดนิเทศแล้ว')

    # ── กรรมการ: ให้คะแนน / คอมเมนต์ / ส่ง ─────────────────
    def my_eval(con, vid, rnd, seat, as_raw):
        u = current_user()
        v, evals = load(con, vid)
        if not v:
            return None, None, bad('ไม่พบนัดนิเทศ', 404)
        e = next((x for x in evals if x['round'] == rnd and (seat is None or x['seat'] == seat)), None)
        if not e:
            return None, None, bad('ไม่พบแบบประเมินนี้', 404)
        if not same(acting(con, u, as_raw), e['evaluator_id'], e['evaluator_name']):
            return None, None, bad(f"แบบประเมินนี้เป็นของ {e['evaluator_name']} — เลือกชื่อตัวเองให้ตรงก่อน")
        return v, e, None

    @app.put('/api/sv/visits/<int:vid>/eval/<rnd>/<int:seat>')
    @login_required
    def sv_eval_save(vid, rnd, seat):
        """บันทึกร่าง (หน้าเว็บบันทึกให้อัตโนมัติระหว่างกรอก)"""
        b = request.get_json() or {}
        with get_db() as con:
            v, e, err = my_eval(con, vid, rnd, seat, b.get('as'))
            if err:
                return err
            if e['status'] == 'submitted':
                return bad('ส่งผลแล้ว แก้ไขไม่ได้ — ให้ฝ่ายวิชาการเปิดคืนก่อน')
            f = form_of(v, rnd)
            ids, (lo, hi) = {it['id'] for it in form_items(f)}, scale_range(f)
            scores = {}
            for k, val in (b.get('scores') or {}).items():
                if k in ids and isinstance(val, int) and not isinstance(val, bool) and lo <= val <= hi:
                    scores[k] = val
            comments = {k: clean(val, 1000) for k, val in (b.get('comments') or {}).items() if k in ids and clean(val, 1000)}
            con.execute("""UPDATE sv_evals SET scores=?, comments=?, highlight=?, strengths=?, improvements=?, updated_at=?
                           WHERE id=?""",
                        (json.dumps(scores), json.dumps(comments, ensure_ascii=False), clean(b.get('highlight')),
                         clean(b.get('strengths')), clean(b.get('improvements')), now(), e['id']))
        return jsonify(success=True, saved_at=now())

    @app.post('/api/sv/visits/<int:vid>/eval/<rnd>/<int:seat>/submit')
    @login_required
    def sv_eval_submit(vid, rnd, seat):
        b = request.get_json() or {}
        with get_db() as con:
            v, e, err = my_eval(con, vid, rnd, seat, b.get('as'))
            if err:
                return err
            if e['status'] == 'submitted':
                return bad('ส่งผลไปแล้ว')
            if rnd == 'pre' and not v['pre_date']:
                return bad('เลือกวันที่และคาบที่เข้าสังเกตการสอนก่อนส่ง (ด้านบนของแบบสังเกต)')
            items = form_items(form_of(v, rnd))
            scores = jl(e['scores'], {})
            missing = [it['title'] for it in items if it['id'] not in scores]
            if missing:
                return bad(f'ยังให้คะแนนไม่ครบ {len(missing)} ข้อ เช่น "{missing[0]}"')
            con.execute("UPDATE sv_evals SET status='submitted', submitted_at=? WHERE id=?", (now(), e['id']))
            _, evals = load(con, vid)
            prog = progress(v, evals)
        msg = 'ส่งผลแล้ว' + (' — กรรมการครบ 3 คน ระบบแปลผลให้แล้ว' if prog['status'] == 'done' else '')
        return jsonify(success=True, message=msg, status=prog['status'])

    @app.post('/api/sv/visits/<int:vid>/eval/<rnd>/<int:seat>/reopen')
    @login_required
    def sv_eval_reopen(vid, rnd, seat):
        """ฝ่ายวิชาการเปิดคืนให้กรรมการแก้คะแนน (ผู้รับการนิเทศต้องรับทราบผลใหม่)"""
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        with get_db() as con:
            con.execute("UPDATE sv_evals SET status='draft', submitted_at=NULL WHERE visit_id=? AND round=? AND seat=?",
                        (vid, rnd, seat))
            if rnd == 'main':
                con.execute('UPDATE sv_visits SET ack_at=NULL WHERE id=?', (vid,))
        return jsonify(success=True, message='เปิดคืนแบบประเมินแล้ว')

    # ── เพื่อนคู่นิเทศ: เลือกวัน/คาบที่เข้าสังเกตเอง (คาบไหนก็ได้ กรอกย้อนหลังได้) ──
    @app.put('/api/sv/visits/<int:vid>/observed')
    @login_required
    def sv_observed(vid):
        b = request.get_json() or {}
        with get_db() as con:
            v, e, err = my_eval(con, vid, 'pre', None, b.get('as'))
            if err and not can_manage(current_user()):
                return err
            v, _ = load(con, vid)
            if not v:
                return bad('ไม่พบนัดนิเทศ', 404)
            if e is not None and e['status'] == 'submitted' and not can_manage(current_user()):
                return bad('ส่งผลการสังเกตแล้ว แก้ไขไม่ได้ — ให้ฝ่ายวิชาการเปิดคืนก่อน')
            date = str(b.get('date') or '')
            if date and not DATE_RE.fullmatch(date):
                return bad('วันที่ไม่ถูกต้อง')
            con.execute('UPDATE sv_visits SET pre_date=?, pre_period=?, pre_lesson=? WHERE id=?',
                        (date, clean(b.get('period'), 10) if date else '', clean(b.get('lesson'), 160) if date else '', vid))
        return jsonify(success=True, message='บันทึกวันและคาบที่เข้าสังเกตแล้ว')

    # ── ผู้รับการนิเทศ: ข้อมูลก่อนสอน / สะท้อนคิด / รับทราบ ──
    def my_visit(con, vid, as_raw):
        u = current_user()
        v, evals = load(con, vid)
        if not v:
            return None, None, bad('ไม่พบนัดนิเทศ', 404)
        if not (can_manage(u) or same(acting(con, u, as_raw), v['teacher_id'], v['teacher_name'])):
            return None, None, bad(f"ส่วนนี้ให้ {v['teacher_name']} เป็นผู้กรอก — เลือกชื่อตัวเองให้ตรงก่อน")
        return v, evals, None

    @app.put('/api/sv/visits/<int:vid>/pre')
    @login_required
    def sv_pre(vid):
        b = request.get_json() or {}
        with get_db() as con:
            v, _, err = my_visit(con, vid, b.get('as'))
            if err:
                return err
            con.execute('UPDATE sv_visits SET plan_no=?, unit=?, topic=?, focus=? WHERE id=?',
                        (clean(b.get('plan_no'), 20), clean(b.get('unit'), 160), clean(b.get('topic'), 200),
                         clean(b.get('focus')), vid))
        return jsonify(success=True, message='บันทึกข้อมูลก่อนสอนแล้ว')

    @app.put('/api/sv/visits/<int:vid>/reflect')
    @login_required
    def sv_reflect(vid):
        b = request.get_json() or {}
        with get_db() as con:
            v, evals, err = my_visit(con, vid, b.get('as'))
            if err:
                return err
            keys = {k for k, _ in FORMS.get(v['form'], FORMS[DEFAULT_FORM])['reflect']}
            ref = {k: clean(val, 2000) for k, val in (b.get('reflection') or {}).items() if k in keys and clean(val, 2000)}
            ack = v['ack_at']
            if b.get('ack'):
                if progress(v, evals)['status'] not in ('done', 'ack'):
                    return bad('กรรมการยังประเมินไม่ครบ ยังกดรับทราบไม่ได้')
                ack = ack or now()
            con.execute('UPDATE sv_visits SET reflection=?, agreed=?, ack_at=? WHERE id=?',
                        (json.dumps(ref, ensure_ascii=False), clean(b.get('agreed')), ack, vid))
        return jsonify(success=True, message='รับทราบผลการนิเทศแล้ว' if b.get('ack') else 'บันทึกแล้ว')

    # ── ลิงก์เฉพาะกิจ (ไม่ต้องล็อกอิน) ───────────────────────
    def seat_person(v, evals, seat):
        """(ตัวตน, ชื่อ, หน้าที่) ของที่นั่ง 0 = ผู้รับการนิเทศ · 1–3 = กรรมการ"""
        if seat == 0:
            return (('t', v['teacher_id'], v['teacher_name']) if v['teacher_id'] else ('n', None, v['teacher_name'])), \
                v['teacher_name'], 'ผู้รับการนิเทศ'
        e = next((x for x in evals if x['round'] == 'main' and x['seat'] == seat), None)
        if not e:
            return None, '', ''
        who = ('t', e['evaluator_id'], e['evaluator_name']) if e['evaluator_id'] else ('n', None, e['evaluator_name'])
        return who, e['evaluator_name'], ('เพื่อนคู่นิเทศ' if seat == v['peer_seat'] else f'กรรมการนิเทศคนที่ {seat}')

    def link_open(con, token):
        """ลิงก์ → (นัด, ตัวตน, ข้อมูลลิงก์) หรือข้อความแจ้งว่าใช้ไม่ได้"""
        row = con.execute('SELECT * FROM sv_links WHERE token=?', (str(token)[:64],)).fetchone()
        if not row or row['revoked_at']:
            return None, None, None, 'ลิงก์นี้ใช้ไม่ได้แล้ว (อาจมีการออกลิงก์ใหม่) — ขอลิงก์ล่าสุดจากฝ่ายวิชาการ'
        v, evals = load(con, row['visit_id'])
        if not v:
            return None, None, None, 'นัดนิเทศนี้ถูกลบแล้ว'
        if v['ack_at'] and v['ack_at'][:10] < (datetime.date.today() - datetime.timedelta(days=LINK_DAYS)).isoformat():
            return None, None, None, 'ลิงก์หมดอายุแล้ว (นัดนิเทศนี้ปิดไปแล้ว)'
        who, name, role = seat_person(v, evals, row['seat'])
        if not who or not same(who, None, row['name']):
            return None, None, None, 'ที่นั่งนี้เปลี่ยนตัวผู้ประเมินแล้ว — ขอลิงก์ใหม่จากฝ่ายวิชาการ'
        return v, who, dict(seat=row['seat'], name=name, role=role, peer=row['seat'] == v['peer_seat']), None

    def via_link(token, fn, *args):
        """เรียก API เดิมในนามคนในลิงก์ (ตรวจสิทธิ์ด้วยตัวตน เหมือนเลือกชื่อตัวเอง)"""
        with get_db() as con:
            v, who, info, err = link_open(con, token)
        if err:
            return bad(err, 404)
        g.sv_who = who
        return fn.__wrapped__(v['id'], *args)

    @app.get('/sv/<token>')
    def sv_link_page(token):
        resp = send_from_directory(app.static_folder, 'supervision.html')
        resp.headers['Cache-Control'] = 'no-store'
        resp.headers['Referrer-Policy'] = 'no-referrer'          # ไม่ส่งรหัสลิงก์ต่อไปยังเว็บอื่น
        return resp

    @app.get('/api/svl/<token>')
    def sv_link_visit(token):
        with get_db() as con:
            v, who, info, err = link_open(con, token)
        if err:
            return bad(err, 404)
        g.sv_who = who
        r = sv_visit.__wrapped__(v['id'])
        if isinstance(r, tuple):
            return r
        d = r.get_json()
        d['link'] = info
        s = get_settings()
        return jsonify(visit=d, forms=FORMS, default_form=DEFAULT_FORM, default_pre_form=DEFAULT_PRE_FORM,
                       school=s.get('school_name') or '')

    @app.put('/api/svl/<token>/eval/<rnd>/<int:seat>')
    def sv_link_eval_save(token, rnd, seat):
        return via_link(token, sv_eval_save, rnd, seat)

    @app.post('/api/svl/<token>/eval/<rnd>/<int:seat>/submit')
    def sv_link_eval_submit(token, rnd, seat):
        return via_link(token, sv_eval_submit, rnd, seat)

    @app.put('/api/svl/<token>/observed')
    def sv_link_observed(token):
        return via_link(token, sv_observed)

    @app.get('/api/svl/<token>/slots')
    def sv_link_slots(token):
        """คาบสอนของครูผู้รับการนิเทศในวันที่เลือก (ให้เพื่อนคู่นิเทศเลือกคาบที่เข้าสังเกต)"""
        with get_db() as con:
            v, who, info, err = link_open(con, token)
            if err:
                return bad(err, 404)
            term, lessons = day_lessons(con, v['teacher_id'], request.args.get('date', ''), get_settings())
        return jsonify(term=term['name'] if term else '', lessons=lessons)

    @app.put('/api/svl/<token>/pre')
    def sv_link_pre(token):
        return via_link(token, sv_pre)

    @app.put('/api/svl/<token>/reflect')
    def sv_link_reflect(token):
        return via_link(token, sv_reflect)

    def links_of(con, v, renew=None):
        """ลิงก์ที่ยังใช้ได้ของทุกคนในนัด (ออกให้อัตโนมัติถ้ายังไม่มี/เปลี่ยนตัวแล้ว) · renew = ที่นั่งที่จะออกลิงก์ใหม่"""
        _, evals = load(con, v['id'])
        out = []
        for seat in (0, 1, 2, 3):
            who, name, role = seat_person(v, evals, seat)
            if not who:
                continue
            row = con.execute('SELECT * FROM sv_links WHERE visit_id=? AND seat=? AND revoked_at IS NULL ORDER BY created_at DESC',
                              (v['id'], seat)).fetchone()
            if row and (seat == renew or not same(who, None, row['name'])):
                con.execute('UPDATE sv_links SET revoked_at=? WHERE token=?', (now(), row['token']))
                row = None
            if not row:
                tok = secrets.token_urlsafe(16)
                con.execute('INSERT INTO sv_links (token, visit_id, seat, name) VALUES (?,?,?,?)', (tok, v['id'], seat, name))
                row = dict(token=tok, created_at=now())
            out.append(dict(seat=seat, name=name, role=role, peer=seat == v['peer_seat'], token=row['token'],
                            created_at=row['created_at']))
        return out

    @app.get('/api/sv/visits/<int:vid>/links')
    @login_required
    def sv_links(vid):
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        with get_db() as con:
            v, _ = load(con, vid)
            if not v:
                return bad('ไม่พบนัดนิเทศ', 404)
            return jsonify(links=links_of(con, v))

    @app.post('/api/sv/visits/<int:vid>/links/renew')
    @login_required
    def sv_links_renew(vid):
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        try:
            seat = int((request.get_json() or {}).get('seat'))
        except (TypeError, ValueError):
            return bad('ระบุที่นั่ง')
        with get_db() as con:
            v, _ = load(con, vid)
            if not v:
                return bad('ไม่พบนัดนิเทศ', 404)
            return jsonify(links=links_of(con, v, renew=seat), message='ออกลิงก์ใหม่แล้ว ลิงก์เดิมใช้ไม่ได้แล้ว')

    @app.get('/api/sv/links')
    @login_required
    def sv_links_term():
        """ลิงก์ของทุกนัดในภาคเรียน (ออกให้อัตโนมัติถ้ายังไม่มี) — หน้าสรุปลิงก์รายคู่"""
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        term = request.args.get('term', '')
        out = []
        with get_db() as con:
            for v in con.execute('SELECT * FROM sv_visits WHERE term=? ORDER BY id', (term,)).fetchall():
                _, evals = load(con, v['id'])
                d = visit_brief(v, evals)
                d['links'] = links_of(con, v)
                out.append(d)
        return jsonify(visits=out)

    # ── สรุปทั้งโรงเรียน (ฝ่ายวิชาการ / ผู้บริหาร) ─────────────
    @app.get('/api/sv/summary')
    @login_required
    def sv_summary():
        if not can_manage(current_user()):
            return bad('เฉพาะฝ่ายวิชาการหรือแอดมิน', 403)
        term = request.args.get('term', '')
        with get_db() as con:
            # ผู้บริหาร (ชื่อขึ้นต้นด้วย รอง/ผอ.) ไม่อยู่ในการนิเทศ จึงไม่นับเป็นครูที่ต้องมีนัด
            teachers = [dict(r) for r in con.execute(
                'SELECT id, name FROM tt_teachers WHERE COALESCE(active,1)=1 ORDER BY sort_order, id')
                if not re.match(r'(รอง|ผอ)', r['name'])]
            rows, item_sum, item_n, seen = [], {}, {}, set()
            obs_form, obs_sum, obs_n, obs_means = FORMS[DEFAULT_PRE_FORM], {}, {}, []
            for v in con.execute('SELECT * FROM sv_visits WHERE term=? ORDER BY date, id', (term,)).fetchall():
                evals = con.execute('SELECT * FROM sv_evals WHERE visit_id=?', (v['id'],)).fetchall()
                if v['kind'] == 'full':
                    seen.add(v['teacher_id'])
                d = visit_brief(v, evals)
                res = result_of(v, evals)
                if res:
                    d.update(percent=res['percent'], level=res['level'], total=res['total'], full=res['full'],
                             strengths=res['strengths'], improve=res['improve'])
                    for it in res['items']:
                        item_sum[it['id']] = item_sum.get(it['id'], 0) + it['mean']
                        item_n[it['id']] = item_n.get(it['id'], 0) + 1
                # ผลการสังเกตการสอนของเพื่อนคู่นิเทศ (แบบสังเกตชั้นเรียน)
                pre = next((e for e in evals if e['round'] == 'pre' and e['status'] == 'submitted'), None)
                pre_any = next((e for e in evals if e['round'] == 'pre'), None)
                d['observer'] = pre_any['evaluator_name'] if pre_any else ''
                if pre and v['pre_form'] == DEFAULT_PRE_FORM:
                    ob = observe_result(obs_form, jl(pre['scores'], {}))
                    if ob['mean'] is not None:
                        d.update(obs_mean=ob['mean'], obs_level=ob['level'], observer=pre['evaluator_name'],
                                 obs_parts=[dict(id=x['id'], mean=x['mean'], level=x['level']) for x in ob['parts']],
                                 obs_at=pre['submitted_at'])
                        obs_means.append(ob['mean'])
                        for prt in ob['parts']:
                            obs_sum[prt['id']] = obs_sum.get(prt['id'], 0) + prt['mean']
                            obs_n[prt['id']] = obs_n.get(prt['id'], 0) + 1
                rows.append(d)
            form = FORMS[DEFAULT_FORM]
            items = [dict(id=it['id'], title=it['title'], n=item_n.get(it['id'], 0),
                          mean=r2(item_sum[it['id']] / item_n[it['id']]) if item_n.get(it['id']) else None,
                          level=level_of(r2(item_sum[it['id']] / item_n[it['id']]), form['mean_levels'])
                          if item_n.get(it['id']) else '')
                     for it in form_items(form)]
            obs_parts = [dict(id=p['id'], title=p['title'], n=obs_n.get(p['id'], 0),
                              mean=r2(obs_sum[p['id']] / obs_n[p['id']]) if obs_n.get(p['id']) else None,
                              level=level_of(r2(obs_sum[p['id']] / obs_n[p['id']]), obs_form['mean_levels'])
                              if obs_n.get(p['id']) else '') for p in obs_form['parts']]
            obs_mean = r2(sum(obs_means) / len(obs_means)) if obs_means else None
            tt = con.execute('SELECT config FROM tt_terms WHERE name=?', (term,)).fetchone()
            signers = jl(tt['config'], {}).get('signers', []) if tt else []      # หัวหน้ากลุ่มบริหารงานวิชาการ ฯลฯ
            done = [r for r in rows if 'percent' in r]
            count_full = len([r for r in rows if r['kind'] == 'full'])
            areas = {}
            for r in done:
                areas.setdefault(r['area'] or 'ไม่ระบุ', []).append(r['percent'])
        return jsonify(
            visits=rows, items=items,
            areas=[dict(area=a, n=len(v), percent=r2(sum(v) / len(v))) for a, v in sorted(areas.items())],
            not_scheduled=[t['name'] for t in teachers if t['id'] not in seen],
            count=dict(teachers=len(teachers), scheduled=count_full, done=len(done), observed=len(obs_means)),
            observe=dict(parts=obs_parts, mean=obs_mean, form=DEFAULT_PRE_FORM,
                         level=level_of(obs_mean, obs_form['mean_levels']) if obs_mean is not None else ''),
            form=DEFAULT_FORM, signers=signers,
            percent=r2(sum(r['percent'] for r in done) / len(done)) if done else None,
            level=level_of(r2(sum(r['percent'] for r in done) / len(done)), form['pct_levels']) if done else '')

    fill_areas()
