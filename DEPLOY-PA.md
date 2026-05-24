# คู่มือ Deploy บน PythonAnywhere (ฟรีตลอดชีพ ⭐)

## ทำไม PythonAnywhere ดีกว่า Render สำหรับโรงเรียน?

| คุณสมบัติ | PythonAnywhere ฟรี | Render ฟรี |
|----------|--------------------|-----------|
| 💾 Persistent storage | ✅ 512 MB ตลอด | ❌ ไม่มี |
| ⏰ Sleep ระหว่างวัน | ❌ ไม่ sleep | 😴 sleep 15 นาที |
| 💰 ค่าใช้จ่าย | ฟรีตลอดชีพ | ฟรี (แต่ disk ไม่ฟรี!) |
| 🔄 Renewal | ทุก 3 เดือนกด 1 ครั้ง | ไม่ต้อง |

---

## ⏱ เวลา: ~20 นาที (ครั้งแรก)

---

## ✅ ขั้นที่ 1 — สมัคร PythonAnywhere

1. ไป https://www.pythonanywhere.com/registration/register/beginner/
2. กรอก:
   - **Username:** เช่น `tngw260` (จะกลายเป็น URL → `tngw260.pythonanywhere.com`)
   - **Email** + **Password**
3. ยืนยัน email → login

---

## 📥 ขั้นที่ 2 — Clone โค้ดจาก GitHub

1. หน้า Dashboard → กดแท็บ **"Consoles"** → คลิก **"Bash"**
2. รอ console เปิด → พิมพ์:

```bash
git clone https://github.com/tngw260/attendance-system.git
cd attendance-system
pip3.11 install --user -r requirements.txt
```

⏱ รอ 1-2 นาที (PA โหลด dependencies)

---

## 🌐 ขั้นที่ 3 — สร้าง Web App

1. กลับ Dashboard → แท็บ **"Web"** → กด **"Add a new web app"**
2. ถ้าถาม domain → กด **"Next"** (ใช้ `USERNAME.pythonanywhere.com`)
3. เลือก **"Manual configuration"** (อย่าเลือก Flask quickstart!)
4. เลือก **Python 3.11**
5. กด **"Next"** → สร้างเสร็จ

---

## ⚙️ ขั้นที่ 4 — แก้ WSGI Configuration

1. ในหน้า Web → หา section **"Code"** → คลิกที่ลิงก์ **"WSGI configuration file"**
   (เช่น `/var/www/tngw260_pythonanywhere_com_wsgi.py`)
2. **ลบเนื้อหาทั้งหมด** แล้วใส่:

```python
import os
import sys

# ⚠️ แทน YOUR_USERNAME ด้วย username PythonAnywhere ของคุณ
USERNAME = 'tngw260'

project_home = f'/home/{USERNAME}/attendance-system'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

os.environ['DATA_DIR'] = f'/home/{USERNAME}/attendance-data'

from app import app as application
```

3. กด **"Save"** (มุมขวาบน)

---

## 📁 ขั้นที่ 5 — ตั้งค่า Source Code

ที่หน้า Web tab → section **"Code"**:

| ฟิลด์ | ค่า |
|------|-----|
| **Source code** | `/home/tngw260/attendance-system` |
| **Working directory** | `/home/tngw260/attendance-system` |

(เปลี่ยน `tngw260` เป็น username ของคุณ)

---

## 🎨 ขั้นที่ 6 — Reload

หน้า Web tab → กดปุ่ม **"Reload"** สีเขียวใหญ่ๆ ด้านบน

⏱ รอ 5-10 วินาที → เปิด URL `https://tngw260.pythonanywhere.com` ✓

---

## 🔐 ขั้นที่ 7 — ใช้งานครั้งแรก

1. login: `admin` / `admin123`
2. **ระบบบังคับเปลี่ยนรหัสผ่าน** → ตั้งใหม่
3. ตั้งค่า → อัพโลโก้ + เลือกสี
4. เครื่องมือ → เพิ่มวันหยุดราชการอัตโนมัติ
5. ผู้ใช้ → เพิ่มบัญชีครู
6. นักเรียน → นำเข้า Excel
7. พร้อมใช้! 🎉

---

## 🔄 เวลามีอัพเดทโค้ด

1. เข้า Console → Bash:
```bash
cd ~/attendance-system
git pull
```
2. กลับ Web tab → กด **"Reload"**

---

## 💾 Backup ข้อมูล (สำคัญมาก!)

ทุกสัปดาห์ — login admin → เครื่องมือ → **"ดาวน์โหลด Backup"** → เก็บใน Google Drive

---

## 🆘 ลืมรหัสผ่าน admin

Console → Bash:
```bash
cd ~/attendance-system
python3.11 app.py --reset-admin
```

---

## 🔁 Free Tier ต้อง Renew ทุก 3 เดือน

- PA จะส่ง email เตือนก่อน
- เข้า https://www.pythonanywhere.com/user/USERNAME/webapps/
- กดปุ่ม **"Run until 3 months from today"** → จบ
- ใช้ฟรีต่อได้ 3 เดือน วนไปเรื่อยๆ ตลอดชีพ ✓

---

## ⚠️ ข้อจำกัด Free Tier

| รายการ | จำกัด | ของจริงในโรงเรียน |
|--------|--------|-------------------|
| 💾 Disk | 512 MB | ใช้ ~50 MB (120 คน) — เหลือเยอะ |
| ⏱ CPU | 100 sec/วัน | เช็คชื่อ ~1 นาที/วัน — พอ |
| 🌐 Bandwidth | ไม่จำกัด | ✓ |
| 🔗 Custom domain | ❌ ไม่ได้ | ใช้ `USERNAME.pythonanywhere.com` |

ถ้า CPU เต็ม (ครูเปิดเยอะมาก) → จ่าย $5/เดือน = ~170 บาท ปลดล็อค

---

## 📞 ติดปัญหา → ครูพรเทพ อุ้มชูวัฒนา
