const express = require('express');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const MENTOR_PASSWORD = process.env.MENTOR_PASSWORD || 'mentor2026';
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'quiz.db');

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(ip, endpoint, maxPerMinute = 10) {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > maxPerMinute;
}



if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── DB setup ──────────────────────────────────────────────────────────────────
let db;
let SQL;
let saveTimer = null;

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      roll TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      answers TEXT NOT NULL,
      score REAL NOT NULL,
      max_score REAL NOT NULL,
      breakdown TEXT NOT NULL,
      submitted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(student_id) REFERENCES students(id)
    );
  `);
  saveDb();
}

function saveDb() {
  // Debounce writes — flush at most once per second to avoid thrashing disk
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch(e) {
      console.error('DB save error:', e);
    }
    saveTimer = null;
  }, 500);
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Student Routes ────────────────────────────────────────────────────────────

app.post('/api/register', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (rateLimit(ip, 'register', 15)) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const { name, roll } = req.body;
  if (!name || !roll) return res.status(400).json({ error: 'Name and roll number required.' });

  // Input length validation
  if (name.trim().length < 2 || name.trim().length > 100)
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
  if (roll.trim().length < 1 || roll.trim().length > 30)
    return res.status(400).json({ error: 'Roll number must be between 1 and 30 characters.' });

  const existing = dbGet('SELECT * FROM students WHERE roll = ?', [roll.trim().toUpperCase()]);
  if (existing) {
    const sub = dbGet('SELECT * FROM submissions WHERE student_id = ?', [existing.id]);
    if (sub) return res.status(409).json({ error: 'already_submitted', studentId: existing.id });
    return res.json({ studentId: existing.id, name: existing.name, roll: existing.roll });
  }

  const id = uuidv4();
  dbRun('INSERT INTO students (id, name, roll) VALUES (?, ?, ?)', [id, name.trim(), roll.trim().toUpperCase()]);
  res.json({ studentId: id, name: name.trim(), roll: roll.trim().toUpperCase() });
});

app.post('/api/submit', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (rateLimit(ip, 'submit', 5)) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const { studentId, answers } = req.body;
  if (!studentId || !answers) return res.status(400).json({ error: 'Missing data.' });

  const student = dbGet('SELECT * FROM students WHERE id = ?', [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const existingSub = dbGet('SELECT * FROM submissions WHERE student_id = ?', [studentId]);
  if (existingSub) return res.status(409).json({ error: 'Already submitted.' });

  const { score, maxScore, breakdown } = gradeAnswers(answers);

  const subId = uuidv4();
  dbRun(
    'INSERT INTO submissions (id, student_id, answers, score, max_score, breakdown) VALUES (?, ?, ?, ?, ?, ?)',
    [subId, studentId, JSON.stringify(answers), score, maxScore, JSON.stringify(breakdown)]
  );

  res.json({ score, maxScore, breakdown });
});

app.get('/api/result/:studentId', (req, res) => {
  const sub = dbGet(`
    SELECT s.*, st.name, st.roll FROM submissions s
    JOIN students st ON s.student_id = st.id
    WHERE s.student_id = ?
  `, [req.params.studentId]);
  if (!sub) return res.status(404).json({ error: 'No submission found.' });
  res.json({
    name: sub.name, roll: sub.roll,
    score: sub.score, maxScore: sub.max_score,
    breakdown: JSON.parse(sub.breakdown),
    answers: JSON.parse(sub.answers),
    submittedAt: sub.submitted_at
  });
});

// ── Mentor Routes ─────────────────────────────────────────────────────────────

app.post('/api/mentor/login', (req, res) => {
  const { password } = req.body;
  if (password === MENTOR_PASSWORD) return res.json({ success: true });
  res.status(401).json({ error: 'Invalid password.' });
});

app.get('/api/mentor/results', (req, res) => {
  const auth = req.headers['x-mentor-auth'];
  if (auth !== MENTOR_PASSWORD) return res.status(401).json({ error: 'Unauthorized.' });

  const results = dbAll(`
    SELECT st.name, st.roll, s.score, s.max_score, s.breakdown, s.answers, s.submitted_at
    FROM submissions s
    JOIN students st ON s.student_id = st.id
    ORDER BY s.score DESC
  `);

  res.json(results.map(r => ({
    ...r,
    breakdown: JSON.parse(r.breakdown),
    answers: JSON.parse(r.answers)
  })));
});

// ── Mentor CSV Export ─────────────────────────────────────────────────────────

app.get('/api/mentor/export', (req, res) => {
  const auth = req.headers['x-mentor-auth'];
  if (auth !== MENTOR_PASSWORD) return res.status(401).json({ error: 'Unauthorized.' });

  const results = dbAll(`
    SELECT st.name, st.roll, s.score, s.max_score, s.breakdown, s.submitted_at
    FROM submissions s
    JOIN students st ON s.student_id = st.id
    ORDER BY s.score DESC
  `);

  const rows = results.map(r => {
    const bd = JSON.parse(r.breakdown);
    return [
      `"${r.name.replace(/"/g,'""')}"`,
      `"${r.roll}"`,
      r.score,
      r.max_score,
      Math.round((r.score / r.max_score) * 100),
      bd.q1 ? bd.q1.total : 0,
      bd.q2 ? bd.q2.total : 0,
      bd.q3 ? bd.q3.total : 0,
      bd.q4 ? bd.q4.total : 0,
      bd.q5 ? bd.q5.total : 0,
      `"${r.submitted_at}"`
    ].join(',');
  });

  const header = 'Name,Roll,Score,MaxScore,Percent,Q1,Q2,Q3,Q4,Q5,SubmittedAt';
  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="rl-quiz-results.csv"');
  res.send(csv);
});

// ── Grading Engine ────────────────────────────────────────────────────────────

function gradeAnswers(answers) {
  const breakdown = {};
  let score = 0;
  const maxScore = 25;

  const questions = [
    { key: 'q1', fn: gradeQ1 },
    { key: 'q2', fn: gradeQ2 },
    { key: 'q3', fn: gradeQ3 },
    { key: 'q4', fn: gradeQ4 },
    { key: 'q5', fn: gradeQ5 },
  ];

  for (const q of questions) {
    const result = q.fn(answers[q.key] || {});
    breakdown[q.key] = result;
    score += result.total;
  }

  return { score, maxScore, breakdown };
}

function isClose(val, target, tol = 0.05) {
  // Blank / missing fields are NEVER considered correct — student must type something
  if (val === '' || val === null || val === undefined) return false;
  const n = parseFloat(val);
  return !isNaN(n) && Math.abs(n - target) <= tol;
}

function gradeQ1(a) {
  const parts = {};
  parts.a = isClose(a.a, 1) ? 1 : 0;
  parts.b = isClose(a.b, 0.8647, 0.01) ? 1 : 0;
  const cDist = (a.c_dist || '').toLowerCase().includes('geo') ? 0.5 : 0;
  const cProb = isClose(a.c_prob, 0.125, 0.005) ? 0.5 : 0;
  parts.c = cDist + cProb;
  parts.d = isClose(a.d, 2) ? 1 : 0;
  parts.e = isClose(a.e, 2) ? 1 : 0;
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  return { parts, total, max: 5 };
}

function gradeQ2(a) {
  const parts = {};

  // Q2a: 4 values, each worth 0.25 marks (total 1 mark)
  let aScore = 0;
  if (isClose(a.a_p0, 20/120, 0.01)) aScore += 0.25;
  if (isClose(a.a_p1, 60/120, 0.01)) aScore += 0.25;
  if (isClose(a.a_p2, 36/120, 0.01)) aScore += 0.25;
  if (isClose(a.a_p3, 4/120, 0.01))  aScore += 0.25;
  parts.a = aScore;

  parts.b = isClose(a.b, 1.2) ? 1 : 0;

  // Q2c: only MCQ selection matters (n and p are shown in the option text, not asked separately)
  // Full 1 mark for selecting Binomial distribution
  parts.c = (a.c_dist || '').toLowerCase().includes('binom') ? 1 : 0;

  // Q2d: 2 values, each worth 0.5 marks (total 1 mark)
  let dScore = 0;
  if (isClose(a.d_ew, 4)) dScore += 0.5;
  if (isClose(a.d_var, 2.4)) dScore += 0.5;
  parts.d = dScore;

  // Q2e: accept 2/n or 2/N
  let eScore = 0;
  if (typeof a.e === 'string') {
    const cleaned = a.e.trim().toLowerCase().replace(/\s/g,'');
    if (cleaned === '2/n' || cleaned.includes('2/n') || cleaned.includes('2/(n)')) eScore = 1;
  }
  parts.e = eScore;

  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  return { parts, total, max: 5 };
}

function gradeQ3(a) {
  const parts = {};
  parts.a = isClose(a.a, 0.25) ? 1 : 0;
  parts.b = isClose(a.b, 0.04) ? 1 : 0;
  parts.c = a.c === 'mgf_product' ? 1 : 0;
  parts.d = isClose(a.d, 1/3, 0.03) ? 1 : 0;
  parts.e = a.e === 'bounded_intervals' ? 1 : 0;
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  return { parts, total, max: 5 };
}

function gradeQ4(a) {
  const parts = {};

  // Q4a: 9 matrix cells, each worth 1/9 marks (total 1 mark)
  // Student must explicitly type 0 for zero-cells — blank = no marks
  const matCells = [
    [a.a_mm, 0],  [a.a_md, 0.5],  [a.a_mq, 0.5],
    [a.a_dm, 1],  [a.a_dd, 0],    [a.a_dq, 0],
    [a.a_qm, 1],  [a.a_qd, 0],    [a.a_qq, 0],
  ];
  let aScore = 0;
  for (const [val, target] of matCells) {
    if (isClose(val, target)) aScore += 1/9;
  }
  parts.a = Math.round(aScore * 1000) / 1000;

  parts.b = a.b === 'current_only' ? 1 : 0;

  // Q4c: 3 values, each worth 1/3 marks (total 1 mark)
  let cScore = 0;
  if (isClose(a.c_m, 0, 0.01)) cScore += 1/3;
  if (isClose(a.c_d, 0.5))     cScore += 1/3;
  if (isClose(a.c_q, 0.5))     cScore += 1/3;
  parts.c = Math.round(cScore * 1000) / 1000;

  parts.d = a.d === 'all_recurrent' ? 1 : 0;
  parts.e = a.e === 'tractable_value' ? 1 : 0;
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  return { parts, total, max: 5 };
}

function gradeQ5(a) {
  const parts = {};
  parts.a = a.a === 'equals_sn' ? 1 : 0;
  parts.b = a.b === 'fair_game' ? 1 : 0;
  let cScore = 0;
  if (typeof a.c === 'string') {
    const v = a.c.trim().toLowerCase();
    if (v === 'k' || v === '5' || isClose(a.c, 5, 0.01)) cScore = 1;
  }
  parts.c = cScore;
  parts.d = isClose(a.d, 0.5) ? 1 : 0;
  parts.e = a.e === 'super_martingale' ? 1 : 0;
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  return { parts, total, max: 5 };
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb().then(() => {
  app.listen(PORT, () => console.log(`🕷️  RL Quiz running on port ${PORT}`));
});

// Graceful shutdown — flush DB immediately before process exits
function flushAndExit(signal) {
  console.log(`\n${signal} received — saving DB and exiting...`);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('DB saved.');
  } catch(e) {
    console.error('DB flush error:', e);
  }
  process.exit(0);
}
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
process.on('SIGINT',  () => flushAndExit('SIGINT'));
