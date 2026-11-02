"""สำรองฐานข้อมูลอัตโนมัติ (ตั้งเป็น Scheduled task บน PythonAnywhere วันละครั้ง)

usage: python3 tools/backup_db.py [--keep 14]
  - snapshot ด้วย sqlite backup API (ข้อมูลที่ยังอยู่ใน WAL ครบ ไม่ต้องหยุดเว็บ) → ตรวจ integrity → gzip
  - เก็บที่ data/backups/school_YYYYMMDD_HHMM.db.gz (DATA_DIR เดียวกับแอป) เก็บไว้ล่าสุด --keep ไฟล์ ที่เก่ากว่าลบทิ้ง
  - หน้าแอดมิน แท็บ Backup แสดงไฟล์ล่าสุด (/api/admin/backup/info → auto_backups)
ไฟล์อยู่บนเซิร์ฟเวอร์เดียวกับเว็บ — ยังควรดาวน์โหลด .zip เก็บนอกเครื่องสัปดาห์ละครั้ง
"""
import argparse
import datetime
import glob
import gzip
import os
import shutil
import sqlite3
import sys
import tempfile
import time

os.environ['TZ'] = 'Asia/Bangkok'                    # ชื่อไฟล์ตามเวลาไทย (เซิร์ฟเวอร์เป็น UTC)
if hasattr(time, 'tzset'):
    time.tzset()

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(BASE, 'data'))
DB_PATH = os.path.join(DATA_DIR, 'school.db')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
PATTERN = 'school_*.db.gz'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keep', type=int, default=14, help='จำนวนไฟล์ล่าสุดที่เก็บไว้ (ค่าเริ่มต้น 14 = 2 สัปดาห์)')
    keep = max(1, ap.parse_args().keep)
    if not os.path.exists(DB_PATH):
        sys.exit(f'ไม่พบฐานข้อมูล {DB_PATH}')
    os.makedirs(BACKUP_DIR, exist_ok=True)

    fd, tmp = tempfile.mkstemp(suffix='.db', dir=BACKUP_DIR)
    os.close(fd)
    try:
        src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(tmp)
        with dst:
            src.backup(dst)
        dst.execute('PRAGMA journal_mode=DELETE')     # รวมหน้าจาก WAL ลงไฟล์เดียวก่อนบีบอัด (สำเนาได้โหมด WAL ตามต้นฉบับ)
        ok = dst.execute('PRAGMA quick_check').fetchone()[0]
        counts = {t: dst.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
                  for t in ('students', 'attendance', 'users')}
        src.close()
        dst.close()
        if ok != 'ok':
            sys.exit(f'สำรองไม่สำเร็จ: ฐานข้อมูลสำเนาไม่ผ่าน quick_check ({ok})')
        name = datetime.datetime.now().strftime('school_%Y%m%d_%H%M.db.gz')
        out = os.path.join(BACKUP_DIR, name)
        with open(tmp, 'rb') as fi, gzip.open(out + '.part', 'wb', compresslevel=6) as fo:
            shutil.copyfileobj(fi, fo)
        os.replace(out + '.part', out)
    finally:
        for p in (tmp, tmp + '-wal', tmp + '-shm', tmp + '-journal'):
            if os.path.exists(p):
                os.unlink(p)

    files = sorted(glob.glob(os.path.join(BACKUP_DIR, PATTERN)))
    for old in files[:-keep]:
        os.unlink(old)
    size = os.path.getsize(out) / 1024 / 1024
    print(f'{name}  {size:.2f} MB  นักเรียน {counts["students"]}  เช็คชื่อ {counts["attendance"]}  '
          f'ผู้ใช้ {counts["users"]}  เก็บไว้ {min(len(files), keep)} ไฟล์')


if __name__ == '__main__':
    main()
