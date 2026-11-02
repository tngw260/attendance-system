# ภาพศิลปะดอกบานบุรีสีเหลือง (flat illustration) พื้นหลังหน้าล็อกอิน — usage: python3 tools/login_art.py public/img  (แล้วเปลี่ยน ?v= ใน login.html)
import math
import random
import sys

OUT = sys.argv[1]


def f(v):
    return f'{v:.1f}'


def petal_path(R):
    """กลีบบานบุรี: กลีบกว้างปลายมน เบี้ยวเล็กน้อยให้ดูหมุนแบบกังหัน (หน่วย = รัศมีดอก)"""
    p = [(0, 0), (0.18, -0.30), (0.55, -0.62), (0.92, -0.42), (1.08, -0.05),
         (1.02, 0.30), (0.70, 0.48), (0.38, 0.30), (0.12, 0.12)]
    s = lambda x, y: f'{f(x * R)},{f(y * R)}'
    return (f'M{s(*p[0])} C{s(*p[1])} {s(*p[2])} {s(*p[3])} C{s(1.0, -0.30)} {s(1.10, -0.18)} {s(*p[4])} '
            f'C{s(1.06, 0.12)} {s(1.10, 0.22)} {s(*p[5])} C{s(0.92, 0.42)} {s(0.82, 0.50)} {s(*p[6])} '
            f'C{s(0.55, 0.45)} {s(0.45, 0.36)} {s(*p[7])} C{s(0.28, 0.22)} {s(0.18, 0.16)} {s(*p[8])} Z')


def flower(x, y, R, rot, uid):
    out = [f'<g transform="translate({f(x)},{f(y)}) rotate({f(rot)})">']
    out.append(f'<circle r="{f(R * 1.02)}" cx="{f(R * 0.06)}" cy="{f(R * 0.09)}" fill="#0b3a1f" opacity=".22"/>')
    for i in range(5):
        out.append(f'<path d="{petal_path(R)}" transform="rotate({i * 72})" fill="url(#petal)" '
                   f'stroke="#d68b00" stroke-width="{f(R * 0.018)}" stroke-linejoin="round"/>')
        # เส้นกลางกลีบอ่อน ๆ
        out.append(f'<path d="M{f(R * 0.25)},{f(-R * 0.02)} Q{f(R * 0.6)},{f(-R * 0.12)} {f(R * 0.86)},{f(-R * 0.06)}" '
                   f'transform="rotate({i * 72})" stroke="#ffe680" stroke-width="{f(R * 0.03)}" fill="none" opacity=".55"/>')
    out.append(f'<circle r="{f(R * 0.42)}" fill="url(#throat)"/>')
    for k in range(10):
        a = math.radians(k * 36 + 8)
        out.append(f'<line x1="{f(math.cos(a) * R * 0.09)}" y1="{f(math.sin(a) * R * 0.09)}" '
                   f'x2="{f(math.cos(a) * R * 0.33)}" y2="{f(math.sin(a) * R * 0.33)}" stroke="#b56a05" '
                   f'stroke-width="{f(R * 0.022)}" stroke-linecap="round" opacity=".75"/>')
    out.append(f'<circle r="{f(R * 0.085)}" fill="#7a4504"/>')
    out.append('</g>')
    return ''.join(out)


def leaf(x, y, L, W, rot, fill='url(#leaf)', vein=True, opacity=1.0):
    d = (f'M0,0 C{f(L * 0.28)},{f(-W)} {f(L * 0.72)},{f(-W * 0.9)} {f(L)},0 '
         f'C{f(L * 0.72)},{f(W * 0.9)} {f(L * 0.28)},{f(W)} 0,0 Z')
    v = f'<path d="M{f(L * 0.04)},0 Q{f(L * 0.5)},{f(-W * 0.12)} {f(L * 0.95)},0" stroke="#bfe3b0" stroke-width="{f(max(1.2, W * 0.08))}" fill="none" opacity=".55"/>' if vein else ''
    return (f'<g transform="translate({f(x)},{f(y)}) rotate({f(rot)})" opacity="{opacity}">'
            f'<path d="{d}" fill="{fill}"/>{v}</g>')


def bud(x, y, L, rot):
    W = L * 0.22
    d = (f'M0,0 C{f(L * 0.25)},{f(-W * 1.1)} {f(L * 0.8)},{f(-W)} {f(L)},0 '
         f'C{f(L * 0.8)},{f(W)} {f(L * 0.25)},{f(W * 1.1)} 0,0 Z')
    return (f'<g transform="translate({f(x)},{f(y)}) rotate({f(rot)})">'
            f'<path d="{d}" fill="url(#bud)" stroke="#d98f0f" stroke-width="1.5"/>'
            f'<path d="M{f(L * 0.15)},0 Q{f(L * 0.6)},{f(W * 0.35)} {f(L * 0.95)},0" stroke="#f6c84a" stroke-width="2" fill="none"/>'
            f'<path d="M0,0 L{f(-L * 0.18)},{f(W * 0.15)}" stroke="#2f6b33" stroke-width="{f(W * 0.35)}" stroke-linecap="round"/></g>')


DEFS = '''<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#0d4426"/><stop offset=".55" stop-color="#155c33"/><stop offset="1" stop-color="#1d7a41"/>
</linearGradient>
<radialGradient id="glow" cx=".3" cy=".45" r=".6">
  <stop offset="0" stop-color="#f7e08a" stop-opacity=".16"/><stop offset="1" stop-color="#f7e08a" stop-opacity="0"/>
</radialGradient>
<radialGradient id="petal" cx="0" cy=".55" r="1.05" fx="0" fy=".55">
  <stop offset="0" stop-color="#ec9a00"/><stop offset=".32" stop-color="#fbbd0b"/><stop offset=".75" stop-color="#ffd52e"/><stop offset="1" stop-color="#ffe04f"/>
</radialGradient>
<radialGradient id="throat">
  <stop offset="0" stop-color="#a85a00"/><stop offset=".35" stop-color="#d98200"/><stop offset=".7" stop-color="#f0a500" stop-opacity=".7"/><stop offset="1" stop-color="#fbbd0b" stop-opacity="0"/>
</radialGradient>
<linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#3f9a4e"/><stop offset="1" stop-color="#226b35"/>
</linearGradient>
<linearGradient id="leaf2" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#2f8040"/><stop offset="1" stop-color="#1a5a2c"/>
</linearGradient>
<linearGradient id="bud" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#e9a020"/><stop offset="1" stop-color="#ffd24a"/>
</linearGradient>
</defs>'''


def cluster(rng, cx, cy, scale, n_flowers, spread, leaf_n=9, buds=2):
    """กลุ่มดอก: ใบรองพื้น → ดอก → ตูม"""
    parts = []
    for _ in range(leaf_n):
        a = rng.uniform(0, 360)
        L = rng.uniform(150, 230) * scale
        parts.append(leaf(cx + rng.uniform(-spread, spread) * 0.6, cy + rng.uniform(-spread, spread) * 0.6,
                          L, L * 0.2, a, rng.choice(['url(#leaf)', 'url(#leaf2)'])))
    pts = []
    for i in range(n_flowers):
        for _ in range(40):
            x, y = cx + rng.uniform(-spread, spread), cy + rng.uniform(-spread, spread) * 0.8
            R = rng.uniform(62, 92) * scale
            if all(math.hypot(x - px, y - py) > (R + pr) * 0.95 for px, py, pr in pts):
                pts.append((x, y, R))
                break
    for x, y, R in sorted(pts, key=lambda p: p[2]):
        parts.append(flower(x, y, R, rng.uniform(0, 72), 0))
    for _ in range(buds):
        a = rng.uniform(0, 360)
        parts.append(bud(cx + rng.uniform(-spread, spread), cy + rng.uniform(-spread, spread), rng.uniform(70, 100) * scale, a))
    return ''.join(parts)


def scene(W, H, clusters, seed):
    rng = random.Random(seed)
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">', DEFS,
         f'<rect width="{W}" height="{H}" fill="url(#bg)"/>', f'<rect width="{W}" height="{H}" fill="url(#glow)"/>']
    # ใบใหญ่จาง ๆ เป็นฉากหลัง (มิติ)
    for _ in range(14):
        L = rng.uniform(380, 620)
        s.append(leaf(rng.uniform(-100, W), rng.uniform(-100, H), L, L * 0.2, rng.uniform(0, 360), '#0a3a20', False, 0.35))
    # จุดแสงนวล (bokeh)
    for _ in range(22):
        s.append(f'<circle cx="{f(rng.uniform(0, W))}" cy="{f(rng.uniform(0, H))}" r="{f(rng.uniform(8, 38))}" '
                 f'fill="#ffe476" opacity="{rng.uniform(.05, .14):.2f}"/>')
    for c in clusters:
        s.append(cluster(rng, *c))
    s.append('</svg>')
    return ''.join(s)


# คอม 16:10 — ดอกล้อมมุมซ้ายบน ล่างซ้าย และขวา (ตรงกลางซ้ายเว้นให้ตัวหนังสือ)
desk = scene(1600, 1000, [(170, 120, 1.0, 5, 210, 10, 2), (300, 900, 1.05, 6, 240, 11, 3),
                          (1480, 170, 0.95, 4, 190, 9, 2), (1420, 880, 1.0, 5, 220, 10, 2),
                          (820, 1010, 0.8, 3, 200, 7, 1)], seed=7)
# มือถือ 9:16 — ดอกแน่นครึ่งบน (กล่องล็อกอินอยู่ล่าง)
mob = scene(900, 1600, [(220, 200, 1.0, 5, 200, 10, 2), (700, 330, 0.95, 4, 190, 9, 2),
                        (430, 620, 0.9, 4, 200, 9, 2), (120, 1450, 0.8, 3, 170, 7, 1),
                        (820, 1500, 0.8, 3, 170, 7, 1)], seed=11)
open(f'{OUT}/login-art.svg', 'w').write(desk)
open(f'{OUT}/login-art-m.svg', 'w').write(mob)
print(len(desk) // 1024, 'KB /', len(mob) // 1024, 'KB')
