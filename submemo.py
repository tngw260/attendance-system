"""บันทึกข้อความ "การสอนแทน/แลกเปลี่ยนคาบสอน" ตามแบบฟอร์มของโรงเรียน — ระบบกรอกให้จากข้อมูลสอนแทน
ดาวน์โหลด Word (.docx) / หน้าพิมพ์ PDF (public/sub-memo.html) · ใช้แทน "ใบบันทึกการจัดครูสอนแทน" รายวันแบบเดิม

แบบฟอร์ม (ไฟล์ Word "บันทึกข้อความสอนแทน" หน้า 1):
  ครุฑ + บันทึกข้อความ · วันที่ เดือน พ.ศ. · ส่วนราชการ / เรื่อง การสอนแทน/แลกเปลี่ยนคาบสอน / เรียน ผู้อำนวยการ
  ด้วย [ครูที่ไม่มา] ไม่ได้ปฏิบัติราชการเป็นเหตุให้ขาดการสอนวิชา [วิชา] เนื่องจาก [สาเหตุ] จึงให้
    [ครูสอนแทน] เข้าสอนแทน ดังนี้ — แถวละ: วันที่ รหัส-วิชา ชั้น เวลา ถึง รวม…คาบ ห้องเรียน (คาบติดกันรวมเป็นแถวเดียว)
  ซ้าย: ลงชื่อผู้ขออนุญาต + ผู้สอนแทนทุกคน · กรอบขวา: หัวหน้ากลุ่มบริหารงานวิชาการตรวจ / รอง ผอ. / ผอ. อนุญาต-ไม่อนุญาต
  (รอง ผอ. ครูสั่งเพิ่ม 29 ต.ค. 69 — ชื่อจากผู้ลงนามท้ายตารางสอนคนที่ 2)
หน้า 2 "การแลกเปลี่ยนคาบสอน" (มีเมื่อมีการแลกคาบ tt_subs.kind=swap): ตามที่ข้าพเจ้า… ไม่ได้มาปฏิบัติราชการเนื่องจาก…
  ตาราง ที่ | คาบสอนปกติ ว/ด/ป คาบที่ ชั้น รหัสวิชา | คาบที่ขอแลก ว/ด/ป คาบที่ รหัสวิชา | ผู้สอนแทน · ตำแหน่ง เว้นให้เขียน
1 ใบ = บันทึกครูไม่มา 1 รายการ (ลาหลายวัน = ใบเดียว) · ไม่มีกำหนด/ยาวเกิน 14 วัน = เฉพาะวันที่เลือก
คาบที่ยังไม่มีคนรับ = กลุ่มชื่อว่าง (เขียนเพิ่มได้) · ห้องเรียน: ระบบไม่มีข้อมูลห้อง เว้นจุดไว้ให้เขียน
คำนำหน้าชื่อ: ระบบเก็บชื่อครูไม่มีคำนำหน้า → หาจากชื่อครูที่ปรึกษา / บัญชีผู้ใช้ / ผู้ลงนาม ไม่พบ = "นาย/นาง/นางสาว" ให้ขีดเลือก
สิทธิ์: ผู้ใช้ที่ล็อกอินทุกคน (ข้อมูลชุดเดียวกับแท็บสอนแทนที่ครูทุกคนเห็นอยู่แล้ว)
"""
import datetime
import io
import math
import os
import re
import unicodedata
import zipfile
from xml.sax.saxutils import escape

from classlist import DEFAULT_ADVISORS, THAI_MONTHS
from timetable import DATE_RE, OPEN_END, day_summary, jl

GARUDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'img', 'garuda.png')
MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
PREFIX_RE = r'นางสาว|นาง|นาย|ว่าที่ร้อยตรีหญิง|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.หญิง|ว่าที่ ร\.ต\.|ดร\.'
NO_PREFIX = 'นาย/นาง/นางสาว'
MAX_SPAN = 14                                       # ลาเกินนี้ (หรือไม่มีกำหนด) ทำใบเฉพาะวันที่เลือก

# หน้ากระดาษ A4 ขอบ 0.5 นิ้วทุกด้านเหมือนแบบฟอร์ม · หน่วย twips (1/20 pt)
FONT = 'TH SarabunPSK'
PAGE_W, PAGE_H, MARGIN = 11906, 16838, 720
W = PAGE_W - 2 * MARGIN                             # 10466
AVAIL_PT = (PAGE_H - 2 * MARGIN) / 20 - 30           # เผื่อ ~1 ซม. (Word วางบรรทัดหลวมกว่าที่ประมาณเล็กน้อย)
LINE = 1.34                                         # บรรทัด single ของ TH SarabunPSK ≈ 1.34 เท่าตัวอักษร (วัดจากแบบฟอร์ม)
TOP_PT = 6                                          # ย่อหน้าว่างที่ยึดครุฑ (ครุฑสูง 1.5 ซม. อยู่ระดับเดียวกับ "บันทึกข้อความ")
TITLE_PT = 29                                       # "บันทึกข้อความ" 29pt ตัวหนา ตามระเบียบงานสารบรรณ (ครูสั่งให้ใหญ่ขึ้น 29 ต.ค. 69 · ไม่ย่อตาม k)
INFO_TAB = 1418                                     # ส่วนราชการ / เรื่อง / เรียน
DATE_IND = 5130                                     # บรรทัดวันที่เริ่มกลางหน้า
FIRST_IND = 722                                     # ย่อหน้า "ด้วย…"
SUB_IND, SUB_TAB = 500, 8288                        # "นาย/นาง/นางสาว……เข้าสอนแทน ดังนี้"
# แถวคาบสอนแทน: (ป้าย, ความกว้างตามแบบฟอร์มที่ 15pt) — กว้างขึ้นตามข้อความจริง ทุกแถวในใบเดียวกันตรงกันเป็นคอลัมน์
FIELDS = [('วันที่', 1731), ('รหัส-วิชา', 2403), ('ชั้น', 910), ('เวลา', 1009), ('ถึง', 771), ('รวม', 890), ('คาบ  ห้องเรียน', 1909)]
ROW_MAX = W - 40
MIN_DOTS = 0.8                                      # จุดอย่างน้อยหลังค่าในแต่ละช่อง (เท่าของตัวอักษร)
# หน้า 2 แลกคาบ: ความกว้างคอลัมน์ตามแบบฟอร์ม (ที่ · ว/ด/ป คาบที่ ชั้น รหัสวิชา · ว/ด/ป คาบที่ รหัสวิชา · ผู้สอนแทน)
SWAP_COLS = [493, 1120, 807, 759, 1281, 1120, 807, 1281, 2798]
SWAP_ROWS = 10                                      # แถวอย่างน้อย (ที่เหลือว่างไว้เขียนเพิ่มเหมือนแบบฟอร์ม)
COL_LEFT, COL_BOX = 5182, 4708                      # ช่องลงชื่อซ้าย / กรอบ หัวหน้าวิชาการ-ผอ. (ที่เหลือ = ช่องว่างขวา)
SIGN_DOTS = 10                                      # ความยาวเส้นจุดลงชื่อ (เท่าของตัวอักษร)
DEFAULT_DEPUTY = 'นางภัคกัญญา นิ่มจงจิตร์'            # รอง ผอ. เมื่อยังไม่ตั้งในตารางสอน (เหมือน DEFAULT_DEPUTY ใน timetable.html)
BOX_LINES = 15                                      # บรรทัดในกรอบขวา: ตรวจ(5) + รอง ผอ.(4) + อนุญาต(2) + ผอ.(3) + ว่าง

# ความกว้างตัวอักษร TH Sarabun New ตัวธรรมดา (1/1000 เท่าของขนาด วัดจากไฟล์ฟอนต์ public/fonts ด้วย Pillow)
# สระบน-ล่าง/วรรณยุกต์ = 0 · ตัวที่ไม่มีในตาราง = 450 · TH SarabunPSK ใน Word กว้างใกล้เคียงกัน
_W = {
    120: "'", 143: 'i', 147: '!I', 153: '|', 155: 'j', 162: ',.:;', 190: '()', 196: '[]', 200: 'l', 203: 'เ',
    204: '`', 205: 'ๅ', 206: 'f', 208: '"{}', 216: ' -', 217: 'r', 237: 'โ', 238: 't', 242: 'ใ', 244: 'ไ', 262: '\\',
    264: 'J', 270: '/', 282: 's', 283: '?', 285: '*', 294: 'ง', 311: 'g', 316: 'kาำ', 318: 'x', 321: 'z', 322: 'ร',
    331: 'c', 335: 'ธว', 337: 'y', 341: 'v', 343: 'ฐ', 344: 'a', 351: 'EF', 352: 'S_', 353: 'L', 357: 'ะ', 361: '$',
    362: '0123456789', 366: 'Y', 367: 'จ', 372: 'ฮ', 374: 'e', 375: 'ย', 376: 'K', 377: 'ฉแ', 378: 'BPขถฤ',
    379: 'RT', 380: 'ช', 381: 'ผฝลส', 382: 'ฃ', 384: 'ซ', 386: 'ก', 387: 'อ', 390: 'Vhnu', 391: 'ดตฯ', 393: 'คฅศ',
    398: 'o', 399: 'ๆ', 400: 'Aม', 401: 'bdpq', 403: '#', 406: 'C', 408: 'ฆ', 411: '+<=>฿', 412: '^', 416: '~',
    418: 'X', 420: 'น', 423: '&', 424: 'Z', 425: 'Gฎฏภฦ', 427: 'ห', 428: 'บป', 430: 'ท', 431: 'D', 438: 'ษ',
    441: 'HN', 447: 'พฟ', 449: '๐๑๒๓๔๕๖๗๘๙', 450: '๏', 454: 'ฬ', 461: 'ฑ', 466: 'U', 486: 'O', 487: 'Q', 507: 'w',
    519: 'ฌญ', 522: '๚', 532: 'ฒ', 536: '@', 543: 'ณ', 548: 'M', 585: '%', 588: 'W', 601: 'm', 697: '๛',
}
WIDTHS = {ch: w / 1000 for w, chars in _W.items() for ch in chars}


def text_em(text):
    """ความกว้างข้อความ (เท่าของขนาดตัวอักษร)"""
    return sum(0 if unicodedata.category(ch) == 'Mn' else WIDTHS.get(ch, 0.45) for ch in text or '')


def iso(d):
    return datetime.date.fromisoformat(d)


def short_date(d):
    d = iso(d)
    return f'{d.day} {MONTH_ABBR[d.month - 1]} {str(d.year + 543)[2:]}'


def full_date(d):
    d = iso(d)
    return f'{d.day} {THAI_MONTHS[d.month - 1]} {d.year + 543}'


def ranges(ps):
    """[1, 2, 3, 5] → "1–3, 5" """
    out, ps = [], sorted(ps)
    for p in ps:
        if out and p == out[-1][1] + 1:
            out[-1][1] = p
        else:
            out.append([p, p])
    return ', '.join(str(a) if a == b else f'{a}–{b}' for a, b in out)


def span_text(f, t, ps):
    a, b = iso(f), iso(t)
    if f == t:
        s = f'วันที่ {full_date(f)}'
    elif (a.year, a.month) == (b.year, b.month):
        s = f'วันที่ {a.day}–{b.day} {THAI_MONTHS[a.month - 1]} {a.year + 543}'
    elif a.year == b.year:
        s = f'วันที่ {a.day} {THAI_MONTHS[a.month - 1]} – {b.day} {THAI_MONTHS[b.month - 1]} {a.year + 543}'
    else:
        s = f'วันที่ {full_date(f)} – {full_date(t)}'
    return s + (f' คาบที่ {ranges(ps)}' if ps else '')


def prefix_index(con, settings):
    """ชื่อจริง → คำนำหน้า จากข้อความในระบบที่มีคำนำหน้า (ค่าที่แอดมินแก้ล่าสุดมาก่อน)"""
    texts = list(jl(settings.get('class_advisors'), {}).values())
    texts += [r['full_name'] or '' for r in con.execute('SELECT full_name FROM users')]
    for r in con.execute('SELECT config FROM tt_terms ORDER BY id DESC'):
        texts += [x.get('name') or '' for x in jl(r['config'], {}).get('signers') or [] if isinstance(x, dict)]
    texts += [settings.get('director_name') or ''] + list(DEFAULT_ADVISORS.values())
    out = {}
    for t in texts:
        for m in re.finditer(rf'({PREFIX_RE})\s*([^\s()]+)', t):
            out.setdefault(m.group(2), m.group(1))
    return out


def person(name, pre):
    """ชื่อครูในตาราง → (ในประโยค, ในวงเล็บใต้ลายเซ็น) เช่น ("นางสาวเปี่ยมจิตร นางหลาด", "นางสาวเปี่ยมจิตร  นางหลาด")"""
    first, _, last = re.sub(r'\s+', ' ', name or '').strip().partition(' ')
    p = pre.get(first, '')
    full = (p or NO_PREFIX) + first + (' ' + last if last else '')
    return full, p + first + ('  ' + last if last else '')


def build_memo(con, a, day, settings, pre, names, subjects):
    """บันทึกครูไม่มา 1 รายการ → ข้อมูลบันทึกข้อความ 1 ใบ (ใช้ทั้งหน้าพิมพ์และ Word)"""
    f, t = a['date_from'], a['date_to']
    if t == OPEN_END or (iso(t) - iso(f)).days >= MAX_SPAN:
        f = t = day if f <= day <= t else f
    ps, tid = jl(a['periods'], []), a['teacher_id']
    items = []
    d = iso(f)
    while d <= iso(t):
        if d.isoweekday() <= 5:
            ds = d.isoformat()
            subs = {(r['period'], r['lesson_id']): r for r in con.execute('SELECT * FROM tt_subs WHERE date=?', (ds,))}
            for n in day_summary(con, ds, settings)['needs']:
                if tid in n['absent_ids'] and (not ps or n['period'] in ps):
                    items.append(dict(date=ds, period=n['period'], lesson_id=n['lesson_id'], subject=n['subject'],
                                      cls=n['class_label'], time=n['time'], sub=subs.get((n['period'], n['lesson_id']))))
        d += datetime.timedelta(days=1)

    # กลุ่มตามครูสอนแทน (ลำดับตามคาบแรกที่สอน) · ไม่มีครูแทน (มอบงาน) · ยังไม่มีคนรับ
    blocks, order = {}, []
    for it in items:
        s = it['sub']
        key = ('sub', s['sub_id']) if s and s['sub_id'] else ('none', 0) if s else ('open', 0)
        if key not in blocks:
            blocks[key] = []
            order.append(key)
        rows = blocks[key]
        st, _, en = it['time'].partition('-')
        last = rows[-1] if rows else None
        if last and last['_d'] == it['date'] and last['_l'] == it['lesson_id'] and last['_p'] == it['period'] - 1:
            last.update(_p=it['period'], end=en or last['end'], n=last['n'] + 1)      # คาบติดกัน = แถวเดียว
            continue
        code = it['subject']
        rows.append(dict(_d=it['date'], _l=it['lesson_id'], _p=it['period'], date=short_date(it['date']),
                         subject=f"{code} {subjects[code]}" if subjects.get(code) else code,
                         code=code if subjects.get(code) else '', cls=it['cls'], start=st, end=en, n=1))
    out_blocks, signers = [], []
    absent, absent_sign = person(names.get(tid, ''), pre)
    signers.append(dict(label='ผู้ขออนุญาต', name=absent_sign))
    for key in sorted(order, key=lambda k: k[0] == 'open'):          # คาบที่ยังไม่มีคนรับไว้ท้าย
        rows = [{k: v for k, v in r.items() if not k.startswith('_')} for r in blocks[key]]
        if key[0] == 'sub':
            full, sign = person(names.get(key[1], ''), pre)
            out_blocks.append(dict(kind='sub', name=full, rows=rows))
            signers.append(dict(label='ผู้สอนแทน', name=sign))
        else:
            out_blocks.append(dict(kind=key[0], name='', rows=rows))
    if not out_blocks:                                                 # ไม่มีคาบสอน = แบบฟอร์มเปล่า 1 กลุ่ม
        out_blocks.append(dict(kind='open', name='', rows=[]))
    if not any(b['kind'] == 'sub' for b in out_blocks) or any(b['kind'] == 'open' for b in out_blocks):
        signers.append(dict(label='ผู้สอนแทน', name=''))

    seen = []
    for it in items:
        code = it['subject']
        lab = f"{code} {subjects[code]}" if subjects.get(code) else code
        if lab not in seen:
            seen.append(lab)
    reason = (a['reason'] or 'ไม่มาปฏิบัติราชการ') + (f" ({a['note']})" if a['note'] else '') + ' ใน' + span_text(f, t, ps)
    # หน้า 2 การแลกเปลี่ยนคาบสอน — คาบละแถว
    swaps, swap_subj = [], []
    for it in items:
        sw = it['sub']
        if sw and sw['kind'] == 'swap':
            code = it['subject']
            swaps.append(dict(date=short_date(it['date']), period=it['period'], cls=it['cls'], code=code,
                              swap_date=short_date(sw['swap_date']), swap_period=sw['swap_period'], swap_code=sw['swap_subject'],
                              sub=person(names.get(sw['sub_id'], ''), pre)[0], status=sw['status']))
            lab = f"{code} {subjects[code]}" if subjects.get(code) else code
            if lab not in swap_subj:
                swap_subj.append(lab)
    md = min(datetime.date.today().isoformat(), f)                     # ลงวันที่ก่อน/วันแรกที่ไม่มา
    m = dict(absence_id=a['id'], teacher=names.get(tid, ''), date_from=f, date_to=t, count=len(items),
             memo_date=dict(day=str(iso(md).day), month=THAI_MONTHS[iso(md).month - 1], year=str(iso(md).year + 543)),
             school=settings.get('school_name', ''),
             para=[['ด้วย', 0], [absent, 1], ['ไม่ได้ปฏิบัติราชการเป็นเหตุให้ขาดการสอนวิชา', 0], [', '.join(seen) or '-', 1],
                   ['เนื่องจาก', 0], [reason, 1], ['จึงให้', 0]],
             blocks=out_blocks, signers=signers, swaps=swaps,
             swap_para=dict(name=absent, reason=reason, subjects=', '.join(swap_subj), count=len(swaps)))
    layout(m)
    return m


def layout(m):
    """ย่อทั้งใบให้พอดี 1 หน้า (ไม่ต่ำกว่า 78%) + ความกว้างช่องในแถวคาบ (ทุกแถวตรงกัน)"""
    rows = [r for b in m['blocks'] for r in b['rows']]
    nlines = sum(1 + max(len(b['rows']), 3 if not b['rows'] else 0) for b in m['blocks'])
    para_em = sum(text_em(f' {t} ' if v else t) for t, v in m['para']) + FIRST_IND / 300

    def height(k):
        head, body, sign = 16 * k, 15 * k, 14 * k
        h = TOP_PT + TITLE_PT * LINE + head * LINE * 6                # บันทึกข้อความ | ว่าง วันที่ ว่าง ส่วนราชการ เรื่อง เรียน
        h += body * LINE * math.ceil(para_em * 1.05 / (W / (20 * body)) + 0.15)       # ตัดคำไทยเหลือท้ายบรรทัด ~5%
        h += body * LINE * nlines
        left = body * LINE + len(m['signers']) * 3 * sign * LINE
        return h + max(left, BOX_LINES * head * LINE + 10)

    k = 1.0
    while k > 0.78 and height(k) > AVAIL_PT:
        k -= 0.02
    half = lambda x: round(x * 2) / 2                                   # noqa: E731
    size = dict(head=half(16 * k), body=half(15 * k), sign=half(14 * k))

    def widths(rs, short=False):
        def need(i, r):
            lab = FIELDS[i][0]
            val = ('' if r is None else [r['date'], (r['code'] or r['subject']) if short else r['subject'],
                                        r['cls'], r['start'], r['end'], str(r['n']), ''][i])
            return (text_em(lab) + (text_em(' ' + val) if val else 0) + MIN_DOTS) * 1.03 * rs * 20
        return [round(max(w * rs / 15, max([need(i, r) for r in rows] or [0]))) for i, (_, w) in enumerate(FIELDS)]

    rs = size['body']
    ws = widths(rs)
    while sum(ws) > ROW_MAX and rs > 12:                               # วิชาชื่อยาว → ย่อเฉพาะแถวคาบ
        rs -= 0.5
        ws = widths(rs)
    if sum(ws) > ROW_MAX:                                              # ยังล้น → เหลือแค่รหัสวิชา
        for r in rows:
            r['subject'] = r['code'] or r['subject']
        ws = widths(rs, True)
    size['row'] = rs
    m.update(size=size, widths=ws, k=round(k, 2))


# ── Word (.docx) ──────────────────────────────────────────────────────────
def _rpr(size, bold=False, u=False, font=FONT):
    sz = int(round(size * 2))
    ul = '<w:u w:val="dotted"/>' if u else ''           # Python 3.9: ห้าม backslash ใน f-string
    return (f'<w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:cs="{font}" w:eastAsia="{font}"/>'
            f'{"<w:b/><w:bCs/>" if bold else ""}{ul}'
            f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/><w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr>')


def _r(text, size, bold=False, u=False, font=FONT):
    return f'<w:r>{_rpr(size, bold, u, font)}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>' if text else ''


def _tab(size):
    return f'<w:r>{_rpr(size)}<w:tab/></w:r>'


def _p(runs, jc='left', ind='', tabs=(), exact=None, brk=False, keep=False):
    """tabs = [(ชนิด, ตำแหน่ง, leader จุด?)] · exact = ความสูงบรรทัดคงที่ (twips)"""
    leader = ' w:leader="dot"'
    tb = ''.join(f'<w:tab w:val="{k}"{leader if dot else ""} w:pos="{pos}"/>' for k, pos, dot in tabs)
    line = f'w:line="{exact}" w:lineRule="exact"' if exact else 'w:line="240" w:lineRule="auto"'
    return (f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if brk else ""}{"<w:keepNext/>" if keep else ""}'
            f'{f"<w:tabs>{tb}</w:tabs>" if tb else ""}<w:spacing w:before="0" w:after="0" {line}/>{ind}'
            f'<w:jc w:val="{jc}"/></w:pPr>{runs}</w:p>')


def _garuda(n):
    cx, cy = 481700, 540000                                            # สูง 1.5 ซม. ตามระเบียบงานสารบรรณ
    return (f'<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{n}" '
            'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>'
            '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>'
            '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
            f'<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>'
            f'<wp:docPr id="{n}" name="ครุฑ {n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
            f'<pic:nvPicPr><pic:cNvPr id="{n}" name="garuda.png"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="rIdGaruda"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>')


def _sign(label, name, size, left, dots_em=SIGN_DOTS, mid=None):
    """ลงชื่อ……label / (ชื่อ) — ชื่อกึ่งกลางใต้เส้นจุด (ตำแหน่งแท็บวัดจากขอบซ้ายของช่อง)"""
    em = size * 20
    w_sign = text_em('ลงชื่อ') * em
    if mid is not None:                                                # จัดให้กึ่งกลางเส้นจุดอยู่ที่ mid
        left = round(mid - w_sign - dots_em * em / 2)
    end, mid = round(left + w_sign + dots_em * em), round(left + w_sign + dots_em * em / 2)
    ind = f'<w:ind w:left="{left}"/>'
    return (_p(_r('ลงชื่อ', size) + _tab(size) + _r(label, size), ind=ind, tabs=[('left', end, True)], keep=True)
            + _p(_tab(size) + _r(f"({name or '.' * 40})", size), ind=ind, tabs=[('center', mid, False)], keep=True))


def memo_xml(m, n, boss):
    sz = m['size']
    h, b, s, rs = sz['head'], sz['body'], sz['sign'], sz['row']
    md = m['memo_date']
    x = _p(_garuda(n), exact=TOP_PT * 20, brk=n > 1)
    x += _p(_r('บันทึกข้อความ', TITLE_PT, True), 'center')
    x += _p(_r(' ', h))
    x += _p(_r('วันที่ ', h) + _r(f" {md['day']} ", h, u=True) + _r(' เดือน ', h) + _r(f" {md['month']} ", h, u=True)
            + _r(' พ.ศ. ', h) + _r(f" {md['year']} ", h, u=True), ind=f'<w:ind w:left="{DATE_IND}"/>')
    x += _p(_r(' ', h))
    info_tab = [('left', INFO_TAB, False)]
    school = m['school']
    dir_title = boss['director']['title']
    for lab, val in (('ส่วนราชการ', school), ('เรื่อง', 'การสอนแทน/แลกเปลี่ยนคาบสอน'), ('เรียน', dir_title)):
        x += _p(_r(lab, h, True) + _tab(h) + _r(val, h), tabs=info_tab)
    x += _p(''.join(_r(f' {t} ' if v else t, b, u=bool(v)) for t, v in m['para']),
            ind=f'<w:ind w:firstLine="{FIRST_IND}"/>')

    pos = [sum(m['widths'][:i + 1]) for i in range(len(FIELDS))]
    row_tabs = [('left', p_, True) for p_ in pos]
    for blk in m['blocks']:
        name = blk['name'] or (NO_PREFIX if blk['kind'] == 'open' else '')
        if blk['kind'] == 'none':
            x += _p(_r('ไม่มีครูสอนแทน (มอบหมายงาน/รวมห้อง) ดังนี้', b), ind=f'<w:ind w:left="{SUB_IND}"/>', keep=True)
        else:
            x += _p(_r(name, b) + _tab(b) + _r('เข้าสอนแทน ดังนี้', b), ind=f'<w:ind w:left="{SUB_IND}"/>',
                    tabs=[('left', SUB_TAB, True)], keep=True)
        for r in blk['rows'] or [None] * 3:
            vals = ['', '', '', '', '', '', ''] if r is None else [r['date'], r['subject'], r['cls'], r['start'], r['end'], str(r['n']), '']
            runs = ''.join(_r(lab + (' ' if v else ''), rs) + _r(v, rs) + _tab(rs) for (lab, _), v in zip(FIELDS, vals))
            x += _p(runs, tabs=row_tabs)

    # ท้ายบันทึก: ซ้าย = จึงเรียน + ลงชื่อ · ขวา = กรอบ หัวหน้าวิชาการ / ผอ.
    left = _p(_r('จึงเรียนมาเพื่อโปรดพิจารณาอนุญาต', b), keep=True)
    for sg in m['signers']:
        left += _p(_r(' ', s), keep=True) + _sign(sg['label'], sg['name'], s, 0)
    c = COL_BOX // 2
    acad, dep, dirc = boss['academic'], boss['deputy'], boss['director']
    box = (_p(_r('ได้ตรวจสอบวิชาที่สอนแทนแล้ว', h), 'center') + _p(_r(' ', h))
           + _sign('', acad['name'], h, 0, mid=c) + _p(_r(acad['title'], h), 'center') + _p(_r(' ', h))
           + _sign('', dep['name'], h, 0, mid=c) + _p(_r(dep['title'], h), 'center') + _p(_r(' ', h))
           + _p(_r('○', h + 2, font='Segoe UI Symbol') + _r(' อนุญาต      ', h) + _r('○', h + 2, font='Segoe UI Symbol')
                + _r(' ไม่อนุญาต', h), 'center') + _p(_r(' ', h))
           + _sign('', dirc['name'], h, 0, mid=c) + _p(_r(dirc['full_title'], h), 'center'))
    one = '<w:{0} w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
    nil = ''.join(f'<w:{e} w:val="nil"/>' for e in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    spare = W - COL_LEFT - COL_BOX
    x += (f'<w:tbl><w:tblPr><w:tblW w:w="{W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>{nil}</w:tblBorders>'
          '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>'
          f'<w:tblGrid><w:gridCol w:w="{COL_LEFT}"/><w:gridCol w:w="{COL_BOX}"/><w:gridCol w:w="{spare}"/></w:tblGrid>'
          f'<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="{COL_LEFT}" w:type="dxa"/></w:tcPr>{left}</w:tc>'
          f'<w:tc><w:tcPr><w:tcW w:w="{COL_BOX}" w:type="dxa"/>'
          f'<w:tcBorders>{"".join(one.format(e) for e in ("top", "left", "bottom", "right"))}</w:tcBorders>'
          '<w:tcMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="140" w:type="dxa"/></w:tcMar></w:tcPr>'
          f'{box}</w:tc><w:tc><w:tcPr><w:tcW w:w="{spare}" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>')
    # Word บังคับย่อหน้าต่อท้ายตาราง → สูง 1pt ไม่งั้นหน้าเต็มจะมีหน้าว่างเกินมา
    x += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
    return x


def swap_xml(m):
    """หน้า 2 การแลกเปลี่ยนคาบสอน (ขึ้นหน้าใหม่) — ตารางเส้นทึบ หัวตาราง 2 แถวพื้นเทา"""
    sp = m['swap_para']
    uv = lambda t: _r(f' {t} ', 16, u=True)                            # noqa: E731
    x = _p(_r('การแลกเปลี่ยนคาบสอน', 18, True), 'center', brk=True) + _p(_r(' ', 16))
    x += _p(_r('ตามที่ข้าพเจ้า', 16) + uv(sp['name']) + _r(' ตำแหน่ง ', 16) + _r('.' * 50, 16))
    x += _p(_r('ไม่ได้มาปฏิบัติราชการเนื่องจาก', 16) + uv(sp['reason']))
    x += _p(_r('เป็นเหตุให้ไม่สามารถเข้าสอนวิชา', 16) + uv(sp['subjects']))
    x += _p(_r('รวมจำนวน', 16) + uv(str(sp['count'])) + _r(' คาบ จึงขอแลกเปลี่ยนคาบสอน ดังนี้', 16)) + _p(_r(' ', 16))
    one = '<w:{0} w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    borders = ''.join(one.format(e) for e in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))

    def cell(text, w, span=1, vmerge=None, head=False, align='center', size=15):
        gs = f'<w:gridSpan w:val="{span}"/>' if span > 1 else ''
        vm = '' if vmerge is None else ('<w:vMerge w:val="restart"/>' if vmerge else '<w:vMerge/>')
        shd = '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>' if head else ''
        return (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{gs}{vm}{shd}<w:vAlign w:val="center"/></w:tcPr>'
                f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="{align}"/></w:pPr>'
                f'{_r(text, size, head)}</w:p></w:tc>')
    c = SWAP_COLS
    tr = lambda cells, h=440: f'<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="{h}" w:hRule="atLeast"/></w:trPr>{cells}</w:tr>'   # noqa: E731
    head1 = tr(cell('ที่', c[0], vmerge=True, head=True) + cell('คาบสอนปกติ', sum(c[1:5]), 4, head=True, align='left')
               + cell('คาบที่ขอแลก', sum(c[5:8]), 3, head=True, align='left') + cell('ผู้สอนแทน', c[8], vmerge=True, head=True, align='left'))
    head2 = tr(cell('', c[0], vmerge=False, head=True) + ''.join(cell(t, w, head=True, align='left') for t, w in
               zip(('ว/ด/ป', 'คาบที่', 'ชั้น', 'รหัสวิชา', 'ว/ด/ป', 'คาบที่', 'รหัสวิชา'), c[1:8]))
               + cell('', c[8], vmerge=False, head=True))
    rows = ''
    for i in range(max(SWAP_ROWS, len(m['swaps']))):
        r = m['swaps'][i] if i < len(m['swaps']) else None
        vals = ([str(i + 1), r['date'], str(r['period']), r['cls'], r['code'], r['swap_date'], str(r['swap_period']), r['swap_code'], r['sub']]
                if r else [''] * 9)
        rows += tr(''.join(cell(v, w, align='left' if k == 8 else 'center') for k, (v, w) in enumerate(zip(vals, c))), 460)
    grid = ''.join('<w:gridCol w:w="%d"/>' % w for w in c)               # Python 3.9: ห้าม backslash ใน f-string
    x += (f'<w:tbl><w:tblPr><w:tblW w:w="{W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>{borders}</w:tblBorders>'
          '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
          f'<w:tblGrid>{grid}</w:tblGrid>{head1}{head2}{rows}</w:tbl>')
    return x + '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'


def build_docx(memos, title, sg):
    body = ''.join(memo_xml(m, i + 1, sg) + (swap_xml(m) if m['swaps'] else '') for i, m in enumerate(memos))
    sect = (f'<w:sectPr><w:pgSz w:w="{PAGE_W}" w:h="{PAGE_H}"/><w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" '
            f'w:left="{MARGIN}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>')
    ns = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
          'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
    w_ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
        'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/styles" Target="styles.xml"/>'
            f'<Relationship Id="rId2" Type="{rel}/settings" Target="settings.xml"/>'
            f'<Relationship Id="rIdGaruda" Type="{rel}/image" Target="media/garuda.png"/></Relationships>',
        'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{escape(title)}</dc:title><dc:creator>{escape(memos[0]["school"] if memos else "")}</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created></cp:coreProperties>',
        'word/document.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{body}{sect}</w:body></w:document>',
        'word/styles.xml': (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {w_ns}><w:docDefaults><w:rPrDefault><w:rPr>'
            f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}" w:eastAsia="{FONT}"/><w:sz w:val="30"/><w:szCs w:val="30"/>'
            '<w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>'
            '</w:pPr></w:pPrDefault></w:docDefaults></w:styles>'),
        # compatibilityMode 15 = ไม่ขึ้น "โหมดความเข้ากันได้" (รูปลอย/แท็บวางตรงกับ Word รุ่นใหม่)
        'word/settings.xml': (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings {w_ns}>'
            '<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" '
            'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
        z.write(GARUDA, 'word/media/garuda.png')
    buf.seek(0)
    return buf


def signers_of(con, settings):
    """ผู้ลงนามในกรอบขวา: หัวหน้ากลุ่มบริหารงานวิชาการ + รอง ผอ. (ผู้ลงนามคนที่ 1, 2 ท้ายตารางสอน) + ผอ. (หน้าตั้งค่า)
    รอง ผอ. ขึ้นเสมอแม้ตั้งซ่อนในตารางสอน (ครูสั่งให้มีในบันทึกข้อความ)"""
    raw = []
    for r in con.execute('SELECT config FROM tt_terms ORDER BY published DESC, id DESC'):
        raw = [x if isinstance(x, dict) else {} for x in jl(r['config'], {}).get('signers') or []]
        if any(x.get('name') for x in raw):
            break
    acad = raw[0] if raw and raw[0].get('name') else {}
    dep = raw[1] if len(raw) > 1 and raw[1].get('name') else {}
    school = settings.get('school_name', '')
    title = settings.get('director_title') or 'ผู้อำนวยการโรงเรียน'
    full_title = (title.replace('โรงเรียน', '') + school) if school.startswith('โรงเรียน') else title + school
    paren = lambda n: re.sub(r'\s+', '  ', (n or '').strip())          # noqa: E731  (ชื่อ  นามสกุล เว้น 2 เคาะตามแบบฟอร์ม)
    return dict(academic=dict(name=paren(acad.get('name')), title=acad.get('title') or 'หัวหน้ากลุ่มบริหารงานวิชาการ'),
                deputy=dict(name=paren(dep.get('name') or DEFAULT_DEPUTY), title=dep.get('title') or 'รอง' + full_title),
                director=dict(name=paren(settings.get('director_name')), title=full_title, full_title=full_title))


def init(app, get_db, login_required, current_user, get_settings):
    from flask import jsonify, request, send_file

    def collect():
        """?date=วันที่ [&absence_id=] → (memos, title, ผู้ลงนาม, None) หรือ (None, None, None, (ข้อความ, status))"""
        a, s = request.args, get_settings()
        day = a.get('date', '') or datetime.date.today().isoformat()
        if not DATE_RE.match(day):
            return None, None, None, ('วันที่ไม่ถูกต้อง', 400)
        with get_db() as con:
            if a.get('absence_id'):
                try:
                    rows = [con.execute('SELECT * FROM tt_absences WHERE id=?', (int(a['absence_id']),)).fetchone()]
                except ValueError:
                    rows = [None]
                if not rows[0]:
                    return None, None, None, ('ไม่พบบันทึกครูไม่มา (อาจถูกลบแล้ว)', 404)
            else:
                rows = con.execute('SELECT * FROM tt_absences WHERE date_from<=? AND date_to>=? ORDER BY id', (day, day)).fetchall()
            pre = prefix_index(con, s)
            names = {r['id']: r['name'] for r in con.execute('SELECT id, name FROM tt_teachers')}
            subjects = {r['code']: r['name'] for r in con.execute('SELECT code, name FROM tt_subjects')}
            memos = [build_memo(con, r, day, s, pre, names, subjects) for r in rows]
            if not a.get('absence_id'):                                # พิมพ์รายวัน: เฉพาะครูที่มีคาบต้องมีคนสอนแทน
                memos = [m for m in memos if m['count']]
            sg = signers_of(con, s)
        if a.get('absence_id'):
            m = memos[0]
            title = f"บันทึกข้อความสอนแทน ครู{m['teacher'].split(' ')[0]} {m['date_from']}"
        else:
            title = f'บันทึกข้อความสอนแทน {day}'
        return memos, title, sg, None

    @app.get('/api/sub-memo')
    @login_required
    def sub_memo():
        memos, title, sg, err = collect()
        if err:
            return jsonify(success=False, message=err[0]), err[1]
        return jsonify(memos=memos, title=title, **sg)

    @app.get('/api/sub-memo.docx')
    @login_required
    def sub_memo_docx():
        memos, title, sg, err = collect()
        if err:
            return jsonify(success=False, message=err[0]), err[1]
        if not memos:
            return jsonify(success=False, message='วันนี้ไม่มีครูที่ต้องมีคนสอนแทน'), 404
        return send_file(build_docx(memos, title, sg), as_attachment=True,
                         download_name=title.replace(' ', '_') + '.docx',
                         mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
