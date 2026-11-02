# ไอคอนแอป Baanburi One — ดอกบานบุรีสีเหลืองบนพื้นเขียว (เต็มกรอบ ไม่มีมุมมน: iOS/Android ตัดมุมเอง)
# usage: python3 tools/app_icon.py public/icons   → icon.svg (แล้วแปลงเป็น PNG 512/192/180 ด้วย WebKit ดู DEPLOY/คอมมิต)
# ดอกอยู่ในวงกลมรัศมี 40% (safe zone ของไอคอนแบบ maskable)
import math
import sys

OUT = sys.argv[1]
S = 512
C = S / 2


def f(v):
    return f'{v:.1f}'


def petal_path(R):
    s = lambda x, y: f'{f(x * R)},{f(y * R)}'
    return (f'M0,0 C{s(0.18, -0.30)} {s(0.55, -0.62)} {s(0.92, -0.42)} C{s(1.0, -0.30)} {s(1.10, -0.18)} {s(1.08, -0.05)} '
            f'C{s(1.06, 0.12)} {s(1.10, 0.22)} {s(1.02, 0.30)} C{s(0.92, 0.42)} {s(0.82, 0.50)} {s(0.70, 0.48)} '
            f'C{s(0.55, 0.45)} {s(0.45, 0.36)} {s(0.38, 0.30)} C{s(0.28, 0.22)} {s(0.18, 0.16)} {s(0.12, 0.12)} Z')


def leaf(x, y, L, W, rot):
    d = (f'M0,0 C{f(L * 0.28)},{f(-W)} {f(L * 0.72)},{f(-W * 0.9)} {f(L)},0 '
         f'C{f(L * 0.72)},{f(W * 0.9)} {f(L * 0.28)},{f(W)} 0,0 Z')
    return (f'<g transform="translate({f(x)},{f(y)}) rotate({rot})"><path d="{d}" fill="url(#leaf)"/>'
            f'<path d="M{f(L * 0.05)},0 Q{f(L * 0.5)},{f(-W * 0.1)} {f(L * 0.93)},0" stroke="#bfe3b0" stroke-width="4" fill="none" opacity=".6"/></g>')


R = 128
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">',
         '''<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a9152"/><stop offset="1" stop-color="#11502b"/></linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#fff3b0" stop-opacity=".35"/><stop offset="1" stop-color="#fff3b0" stop-opacity="0"/></radialGradient>
<radialGradient id="petal" cx="0" cy=".55" r="1.05" fx="0" fy=".55">
  <stop offset="0" stop-color="#ec9a00"/><stop offset=".32" stop-color="#fbbd0b"/><stop offset=".75" stop-color="#ffd52e"/><stop offset="1" stop-color="#ffe04f"/>
</radialGradient>
<radialGradient id="throat"><stop offset="0" stop-color="#a85a00"/><stop offset=".35" stop-color="#d98200"/><stop offset=".7" stop-color="#f0a500" stop-opacity=".7"/><stop offset="1" stop-color="#fbbd0b" stop-opacity="0"/></radialGradient>
<linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fb062"/><stop offset="1" stop-color="#2a7a3c"/></linearGradient>
</defs>''',
         f'<rect width="{S}" height="{S}" fill="url(#bg)"/>',
         f'<circle cx="{C}" cy="{C}" r="{S * 0.42}" fill="url(#halo)"/>',
         leaf(C - 18, C + 26, 190, 42, 145), leaf(C + 18, C - 22, 185, 40, -35),
         f'<g transform="translate({C},{C}) rotate(-12)">',
         f'<circle r="{R * 1.0}" cx="6" cy="9" fill="#0b3a1f" opacity=".25"/>']
for i in range(5):
    parts.append(f'<path d="{petal_path(R)}" transform="rotate({i * 72})" fill="url(#petal)" stroke="#d68b00" stroke-width="3" stroke-linejoin="round"/>')
    parts.append(f'<path d="M{f(R * 0.25)},{f(-R * 0.02)} Q{f(R * 0.6)},{f(-R * 0.12)} {f(R * 0.86)},{f(-R * 0.06)}" '
                 f'transform="rotate({i * 72})" stroke="#ffe680" stroke-width="4" fill="none" opacity=".55"/>')
parts.append(f'<circle r="{f(R * 0.42)}" fill="url(#throat)"/>')
for k in range(10):
    a = math.radians(k * 36 + 8)
    parts.append(f'<line x1="{f(math.cos(a) * R * 0.09)}" y1="{f(math.sin(a) * R * 0.09)}" x2="{f(math.cos(a) * R * 0.33)}" '
                 f'y2="{f(math.sin(a) * R * 0.33)}" stroke="#b56a05" stroke-width="3" stroke-linecap="round" opacity=".75"/>')
parts.append(f'<circle r="{f(R * 0.085)}" fill="#7a4504"/></g></svg>')
open(f'{OUT}/icon.svg', 'w').write(''.join(parts))
print('icon.svg', len(''.join(parts)) // 1024, 'KB')
