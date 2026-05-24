# คู่มือ Deploy ขึ้น Render.com (ฟรี ไม่มีค่าใช้จ่าย)

ระบบเช็คชื่อสำหรับโรงเรียนตะกั่วทุ่งงานทวีวิทยาคม ติดตั้งบน **Render.com** ใช้ได้จริงโดยไม่ต้องมีเซิร์ฟเวอร์

---

## ⏱ เวลาที่ใช้: ประมาณ 20-30 นาที (ครั้งแรก)

---

## ✅ สิ่งที่ต้องเตรียม

1. **บัญชี GitHub** (ฟรี) — สมัครที่ https://github.com/signup
2. **บัญชี Render** (ฟรี) — สมัครที่ https://render.com (login ด้วย GitHub ได้เลย)
3. ติดตั้ง [Git](https://git-scm.com/downloads) บนเครื่อง (ถ้ายังไม่มี)

---

## 📦 ขั้นตอนที่ 1 — อัพโค้ดขึ้น GitHub

```bash
cd ~/attendance-system

# Init git (ครั้งแรก)
git init
git add .
git commit -m "Initial commit"

# สร้าง repo บน GitHub (https://github.com/new)
#   - ตั้งชื่อ: attendance-system
#   - เลือก Private (แนะนำ — ไม่ให้คนอื่นเห็นโค้ด)
#   - ไม่ต้องเลือก "Add README"

# Push ขึ้น GitHub (แทน <username> ด้วยชื่อ GitHub ของคุณ)
git remote add origin https://github.com/<username>/attendance-system.git
git branch -M main
git push -u origin main
```

---

## 🚀 ขั้นตอนที่ 2 — Deploy บน Render

1. เข้า https://render.com → กด **"New +"** → เลือก **"Blueprint"**
2. กด **"Connect GitHub"** → อนุญาตให้ Render เข้าถึง repo
3. เลือก repo `attendance-system`
4. Render จะอ่านไฟล์ `render.yaml` อัตโนมัติ — กด **"Apply"**
5. รอ build เสร็จ (ประมาณ 3-5 นาที) — เห็น **"Live"** สีเขียวเมื่อพร้อม
6. URL จะเป็น `https://attendance-tngw.onrender.com` (Render สุ่มให้)

---

## 🔐 ขั้นตอนที่ 3 — เข้าใช้งานครั้งแรก

1. เปิด URL ที่ได้ → หน้า login
2. login: `admin` / `admin123`
3. **ระบบจะบังคับเปลี่ยนรหัสผ่าน** — ตั้งรหัสใหม่ที่จำง่าย (อย่างน้อย 6 ตัว)
4. ไปหน้า **ตั้งค่า** → อัพโลโก้โรงเรียน + เลือกสีหลัก
5. ไปหน้า **เครื่องมือ** → กด "เพิ่มวันหยุดราชการอัตโนมัติ"
6. ไปหน้า **ผู้ใช้** → สร้างบัญชีให้ครูแต่ละท่าน + กำหนดห้องประจำ
7. ไปหน้า **นักเรียน** → นำเข้ารายชื่อจาก Excel
8. พร้อมใช้งาน! 🎉

---

## 💤 ข้อจำกัดของ Render Free Tier (และวิธีแก้)

### ปัญหา 1: Cold start (sleep หลังไม่ใช้ 15 นาที)
- เข้าครั้งแรกหลังว่าง 15+ นาทีจะรอ **30-50 วินาที** ให้ตื่น
- **วิธีแก้:** ใช้ **[cron-job.org](https://cron-job.org)** (ฟรี) ปลุกทุก 10 นาที
  1. สมัคร cron-job.org
  2. สร้าง cron ใหม่
  3. URL: `https://<ชื่อ-app>.onrender.com/api/public/theme`
  4. ตั้งให้ยิงทุก 10 นาที (เฉพาะวันจันทร์-ศุกร์ 6:00-18:00 ก็พอ)
  5. จบ — server จะตื่นตลอดเวลาเรียนการสอน

### ปัญหา 2: เก็บข้อมูลได้ 1 GB (Free disk)
- ใช้ได้ ~5,000-10,000 นักเรียน + ประวัติเช็คชื่อ 5 ปี
- รูปนักเรียนใหญ่ → อาจเต็มเร็ว → แนะนำย่อรูปก่อนอัพโหลด (< 200 KB ต่อรูป)

### ปัญหา 3: 750 ชั่วโมง/เดือน ฟรี
- ตลอด 24/7 = 720 ชม → **ใช้ฟรีตลอดเดือนได้** ✅

---

## 🔄 อัพเดทระบบในอนาคต

```bash
cd ~/attendance-system
git add .
git commit -m "Update: <รายละเอียดที่แก้>"
git push
```

Render จะ deploy ใหม่อัตโนมัติ (~3 นาที)

---

## 💾 Backup ข้อมูล

**ทำทุกสัปดาห์** (กันเหนียว):
1. login เป็น admin
2. ไปหน้า **เครื่องมือ** → แท็บ **Backup/Restore**
3. กด **"ดาวน์โหลด Backup (.zip)"** → เซฟใส่ Google Drive/USB

---

## 🆘 ลืมรหัสผ่าน admin

ไปที่ Render dashboard → **Shell** → รัน:
```
python app.py --reset-admin
```
รหัสจะถูกตั้งใหม่เป็น `admin123`

---

## 🌐 ใช้ Domain ของโรงเรียน (ถ้ามี)

Render รองรับ custom domain ฟรี:
1. Dashboard → Settings → **Custom Domain**
2. ใส่ domain เช่น `attendance.yourschool.ac.th`
3. ตั้งค่า DNS ตามที่ Render แนะนำ
4. ใช้งานผ่าน domain ได้ทันที (มี HTTPS ฟรี)

---

## 📞 ติดต่อผู้พัฒนา

หากมีปัญหาการใช้งาน — ครูพรเทพ อุ้มชูวัฒนา
