const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

['data', 'uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const db = new Database(path.join('data', 'school.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER,
    student_code TEXT,
    name TEXT NOT NULL,
    class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 6),
    room INTEGER NOT NULL,
    gender TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'present'
      CHECK (status IN ('present', 'absent', 'late', 'leave')),
    note TEXT,
    recorded_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(student_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_att_date     ON attendance(date);
  CREATE INDEX IF NOT EXISTS idx_att_student  ON attendance(student_id);
  CREATE INDEX IF NOT EXISTS idx_stu_class    ON students(class_level, room);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.xlsx', '.xls'].includes(ext));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ── CLASSES ──────────────────────────────────────────────

app.get('/api/classes', (req, res) => {
  const rows = db.prepare(`
    SELECT class_level, room, COUNT(*) as count
    FROM students
    GROUP BY class_level, room
    ORDER BY class_level, room
  `).all();
  res.json(rows);
});

// ── STUDENTS ─────────────────────────────────────────────

app.get('/api/students', (req, res) => {
  const { level, room } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];
  if (level) { sql += ' AND class_level = ?'; params.push(+level); }
  if (room)  { sql += ' AND room = ?';        params.push(+room);  }
  sql += ' ORDER BY class_level, room, number, name';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/students/template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ชั้น (1-6)', 'ห้อง', 'เพศ'],
    [1, '12345', 'เด็กชาย ตัวอย่าง นามสกุลตัวอย่าง', 1, 1, 'ชาย'],
    [2, '12346', 'เด็กหญิง ตัวอย่าง นามสกุลตัวอย่าง', 1, 1, 'หญิง'],
    [3, '12347', 'เด็กชาย สมชาย รักเรียน', 2, 1, 'ชาย'],
  ]);
  ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws, 'รายชื่อนักเรียน');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''student_template.xlsx");
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.post('/api/students/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'ไม่พบไฟล์' });

  try {
    const wb = XLSX.readFile(req.file.path, { codepage: 65001 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (data.length < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'ไฟล์ไม่มีข้อมูล' });
    }

    const rows = data.slice(1).filter(row => row[2] && String(row[2]).trim());
    const insert = db.prepare(`
      INSERT INTO students (number, student_code, name, class_level, room, gender)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let count = 0, errors = 0;
    db.transaction(() => {
      for (const row of rows) {
        const num   = row[0] ? parseInt(row[0]) || null : null;
        const code  = row[1] ? String(row[1]).trim() : null;
        const name  = String(row[2]).trim();
        const level = row[3] ? parseInt(row[3]) : null;
        const room  = row[4] ? parseInt(row[4]) : null;
        const gender = row[5] ? String(row[5]).trim() : null;

        if (!name || !level || !room || level < 1 || level > 6) { errors++; continue; }
        insert.run(num, code, name, level, room, gender);
        count++;
      }
    })();

    fs.unlinkSync(req.file.path);
    res.json({
      success: true, count, errors,
      message: `นำเข้าสำเร็จ ${count} คน` + (errors ? ` (ข้าม ${errors} แถวที่ไม่ถูกต้อง)` : '')
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

app.delete('/api/students/all', (req, res) => {
  db.exec('DELETE FROM attendance; DELETE FROM students;');
  res.json({ success: true, message: 'ลบข้อมูลนักเรียนทั้งหมดแล้ว' });
});

app.delete('/api/students/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(+req.params.id);
  res.json({ success: true });
});

// ── ATTENDANCE ────────────────────────────────────────────

app.get('/api/attendance', (req, res) => {
  const { level, room, date } = req.query;
  if (!level || !room || !date) {
    return res.status(400).json({ error: 'ต้องระบุ level, room และ date' });
  }
  const rows = db.prepare(`
    SELECT s.id, s.number, s.student_code, s.name, s.gender,
           COALESCE(a.status, 'present') AS status,
           a.note,
           CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS is_recorded
    FROM students s
    LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
    WHERE s.class_level = ? AND s.room = ?
    ORDER BY s.number, s.name
  `).all(date, +level, +room);
  res.json(rows);
});

app.post('/api/attendance', (req, res) => {
  const { date, records } = req.body;
  if (!date || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ถูกต้อง' });
  }

  const upsert = db.prepare(`
    INSERT INTO attendance (student_id, date, status, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(student_id, date) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      recorded_at = datetime('now', 'localtime')
  `);

  db.transaction(() => {
    for (const r of records) upsert.run(r.student_id, date, r.status, r.note || null);
  })();

  res.json({ success: true, message: `บันทึกการเช็คชื่อ ${records.length} คน สำเร็จ` });
});

// ── DASHBOARD ─────────────────────────────────────────────

app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const total = db.prepare('SELECT COUNT(*) AS n FROM students').get().n;
  const todayStats = db.prepare(`
    SELECT COUNT(*) AS checked,
           SUM(status='present') AS present,
           SUM(status='absent')  AS absent,
           SUM(status='late')    AS late,
           SUM(status='leave')   AS leave
    FROM attendance WHERE date = ?
  `).get(today);

  const classSummary = db.prepare(`
    SELECT s.class_level, s.room,
           COUNT(DISTINCT s.id) AS total,
           COUNT(DISTINCT a.student_id) AS checked
    FROM students s
    LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
    GROUP BY s.class_level, s.room
    ORDER BY s.class_level, s.room
  `).all(today);

  res.json({ total, today: todayStats, classSummary, date: today });
});

// ── REPORT ────────────────────────────────────────────────

function buildReportSql(level, room, from, to) {
  let joinCond = 's.id = a.student_id';
  const joinParams = [];
  if (from) { joinCond += ' AND a.date >= ?'; joinParams.push(from); }
  if (to)   { joinCond += ' AND a.date <= ?'; joinParams.push(to);   }

  let whereCond = '1=1';
  const whereParams = [];
  if (level) { whereCond += ' AND s.class_level = ?'; whereParams.push(+level); }
  if (room)  { whereCond += ' AND s.room = ?';        whereParams.push(+room);  }

  const sql = `
    SELECT s.id, s.number, s.student_code, s.name, s.class_level, s.room,
      COUNT(a.id) AS total_days,
      SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN a.status='absent'  THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN a.status='late'    THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN a.status='leave'   THEN 1 ELSE 0 END) AS leave
    FROM students s
    LEFT JOIN attendance a ON ${joinCond}
    WHERE ${whereCond}
    GROUP BY s.id
    ORDER BY s.class_level, s.room, s.number, s.name
  `;
  return { sql, params: [...joinParams, ...whereParams] };
}

app.get('/api/report', (req, res) => {
  const { level, room, from, to } = req.query;
  const { sql, params } = buildReportSql(level, room, from, to);
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/report/export', (req, res) => {
  const { level, room, from, to } = req.query;
  const { sql, params } = buildReportSql(level, room, from, to);
  const raw = db.prepare(sql).all(...params);

  const rows = raw.map(r => ({
    'เลขที่': r.number,
    'รหัสนักเรียน': r.student_code,
    'ชื่อ-นามสกุล': r.name,
    'ชั้น': `ม.${r.class_level}/${r.room}`,
    'วันที่บันทึก': r.total_days,
    'มา': r.present,
    'ขาด': r.absent,
    'มาสาย': r.late,
    'ลา': r.leave
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 10 },
    { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'รายงานการมาเรียน');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `attendance_report_${new Date().toISOString().split('T')[0]}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ─────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  ระบบเช็คชื่อนักเรียน');
  console.log('  โรงเรียนตะกั่วทุ่งงานทวีวิทยาคม');
  console.log('========================================');
  console.log(`  http://localhost:${PORT}`);
  console.log('========================================\n');
});
