"""
WSGI entry point สำหรับ PythonAnywhere

วิธีใช้:
1. ใน PythonAnywhere → Web tab → คลิก WSGI configuration file
2. คัดลอกเนื้อหาไฟล์นี้ไปวาง (แทน YOUR_USERNAME ด้วย username จริง)
3. Save → Reload web app
"""
import os
import sys

# ⚠️ แทน YOUR_USERNAME ด้วย PythonAnywhere username ของคุณ
USERNAME = 'YOUR_USERNAME'

# Path ของโค้ดที่ clone จาก git
project_home = f'/home/{USERNAME}/attendance-system'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# เก็บข้อมูล (DB + รูป + โลโก้) นอก git repo เพื่อไม่ให้หาย
# โฟลเดอร์นี้จะถูกสร้างอัตโนมัติเมื่อ app เริ่มทำงาน
os.environ['DATA_DIR'] = f'/home/{USERNAME}/attendance-data'

from app import app as application
