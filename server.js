/**
 * 学生课堂学习评价系统 - 后端服务
 * Node.js 原生 HTTP，无需安装额外依赖
 * 支持本地部署和云部署（Render等）
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

// ── 内存数据库（云部署时使用） ──
let memoryDB = { evaluations: [], courseInfo: {} };

// ── 判断是否为云部署环境 ──
const IS_CLOUD = !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.VERCEL;

// ── 确保数据目录和文件存在（本地部署） ──
if (!IS_CLOUD) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ evaluations: [], courseInfo: {} }, null, 2), 'utf8');
  }
}

// ── 读写数据库 ──
function readDB() {
  if (IS_CLOUD) return memoryDB;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) {
    return { evaluations: [], courseInfo: {} };
  }
}
function writeDB(data) {
  if (IS_CLOUD) {
    memoryDB = data;
    return;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch(e) {
    console.error('写入数据失败:', e.message);
  }
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

// ── 解析请求体（支持大文件上传） ──
function parseBody(req, maxMB = 50) {
  return new Promise((resolve, reject) => {
    let body = [];
    let size = 0;
    const maxSize = maxMB * 1024 * 1024;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      body.push(chunk);
    });
    req.on('end', () => {
      try {
        const str = Buffer.concat(body).toString('utf8');
        resolve(JSON.parse(str || '{}'));
      } catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── JSON 响应辅助 ──
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
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

  // GET /api/health — 健康检查
  if (pathname === '/api/health' && method === 'GET') {
    return json(res, 200, { ok: true, time: new Date().toISOString(), cloud: IS_CLOUD });
  }

  // POST /api/evaluate — 提交评价
  if (pathname === '/api/evaluate' && method === 'POST') {
    try {
      const body = await parseBody(req, 50);
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

  // GET /api/export — 导出全部数据（备份用）
  if (pathname === '/api/export' && method === 'GET') {
    const db = readDB();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename=evaluations-backup-' + new Date().toISOString().slice(0,10) + '.json'
    });
    return res.end(JSON.stringify(db, null, 2));
  }

  // POST /api/import — 导入数据（恢复用）
  if (pathname === '/api/import' && method === 'POST') {
    try {
      const body = await parseBody(req, 100);
      if (!body.evaluations || !Array.isArray(body.evaluations)) {
        return json(res, 400, { ok: false, error: '无效的数据格式' });
      }
      writeDB(body);
      return json(res, 200, { ok: true, count: body.evaluations.length });
    } catch(e) {
      return json(res, 400, { ok: false, error: e.message });
    }
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
  console.log(`☁️  云部署模式: ${IS_CLOUD ? '是' : '否'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // ── 自动保活（仅云部署时生效，防止 Render 15分钟无活动休眠） ──
  if (IS_CLOUD) {
    const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000; // 每10分钟
    setInterval(() => {
      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/api/health',
        method: 'GET'
      };
      const req = http.request(options, (res) => {
        console.log(`[保活] ${new Date().toISOString()} - 状态码: ${res.statusCode}`);
      });
      req.on('error', (e) => {
        console.error(`[保活] 请求失败: ${e.message}`);
      });
      req.end();
    }, KEEP_ALIVE_INTERVAL);
    console.log('🔄 自动保活已启动（每10分钟自检一次）');
  }
});
