/**
 * 学生课堂学习评价系统 - 后端服务
 * Node.js 原生 HTTP，无需安装额外依赖
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'evaluations.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── 确保数据目录和文件存在 ──
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ evaluations: [], courseInfo: {} }, null, 2), 'utf8');
}

// ── 读写数据库 ──
function readDB() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── MIME 映射 ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ── 解析请求体 ──
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── JSON 响应辅助 ──
function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// ── 静态文件服务 ──
function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}

// ── 主路由 ──
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method.toUpperCase();

  // OPTIONS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // ── API 路由 ──

  // POST /api/evaluate — 提交评价
  if (pathname === '/api/evaluate' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const db = readDB();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      const record = {
        id,
        submittedAt: new Date().toISOString(),
        teacherName: body.teacherName || '',
        courseTitle: body.courseTitle || '',
        evalDate: body.evalDate || '',
        student: {
          name: body.studentName || '',
          no: body.studentNo || '',
          class: body.studentClass || ''
        },
        singleEval: body.singleEval || {},
        overallEval: body.overallEval || {},
        photos: body.photos || {}
      };
      db.evaluations.push(record);
      writeDB(db);
      return json(res, 200, { ok: true, id });
    } catch(e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  // GET /api/evaluations — 所有评价列表
  if (pathname === '/api/evaluations' && method === 'GET') {
    const db = readDB();
    const list = db.evaluations.map(e => ({
      id: e.id,
      submittedAt: e.submittedAt,
      teacherName: e.teacherName,
      courseTitle: e.courseTitle,
      evalDate: e.evalDate,
      studentName: e.student.name,
      studentClass: e.student.class,
      studentNo: e.student.no,
      singleLevel: e.singleEval?.level || '-',
      overallLevel: e.overallEval?.level || '-'
    }));
    return json(res, 200, { ok: true, list });
  }

  // GET /api/evaluation/:id — 单条评价详情
  if (pathname.startsWith('/api/evaluation/') && method === 'GET') {
    const id = pathname.split('/')[3];
    const db = readDB();
    const record = db.evaluations.find(e => e.id === id);
    if (!record) return json(res, 404, { ok: false, error: '未找到' });
    return json(res, 200, { ok: true, record });
  }

  // DELETE /api/evaluation/:id — 删除评价
  if (pathname.startsWith('/api/evaluation/') && method === 'DELETE') {
    const id = pathname.split('/')[3];
    const db = readDB();
    const before = db.evaluations.length;
    db.evaluations = db.evaluations.filter(e => e.id !== id);
    if (db.evaluations.length === before) return json(res, 404, { ok: false, error: '未找到' });
    writeDB(db);
    return json(res, 200, { ok: true });
  }

  // GET /api/stats — 统计数据
  if (pathname === '/api/stats' && method === 'GET') {
    const db = readDB();
    const evals = db.evaluations;
    const byStudent = {};
    evals.forEach(e => {
      const name = e.student.name;
      if (!byStudent[name]) byStudent[name] = [];
      byStudent[name].push(e);
    });
    return json(res, 200, {
      ok: true,
      total: evals.length,
      studentCount: Object.keys(byStudent).length,
      teacherCount: [...new Set(evals.map(e=>e.teacherName).filter(Boolean))].length,
      recentSubmissions: evals.slice(-5).reverse()
    });
  }

  // ── 静态文件服务 ──
  let filePath;
  if (pathname === '/' || pathname === '/teacher') {
    filePath = path.join(PUBLIC_DIR, 'teacher.html');
  } else if (pathname === '/admin') {
    filePath = path.join(PUBLIC_DIR, 'admin.html');
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
  }
  serveStatic(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ 评价系统已启动！`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📱 老师端（手机）: http://[本机IP]:${PORT}/teacher`);
  console.log(`🖥️  管理后台（PC）: http://[本机IP]:${PORT}/admin`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
