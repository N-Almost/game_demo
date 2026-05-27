// server.js — all-in-one game + signaling + auth server (Node.js built-ins only)
// Usage: node server.js
// Host opens : http://localhost:8080
// Guest opens: http://<lan-ip>:8080

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const PORT   = 8080;
const ROOT   = __dirname;
const EXPIRY = 10 * 60 * 1000;

// ── User data storage ─────────────────────────────────────────────────────────

const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function defaultProfile(username) {
  return {
    name:                 username.toUpperCase().slice(0, 12),
    bestWave:             1,
    gamesPlayed:          0,
    wins:                 0,
    losses:               0,
    totalKills:           0,
    totalUnitsDeployed:   0,
    totalSpawnsCaptured:  0,
    playTimeSec:          0,
    unitUsage:            {},
    gold:                 0,
  };
}

// ── Session store (in-memory, 24 h TTL) ───────────────────────────────────────

const sessions    = new Map(); // token → { userId, expiresAt }
const SESSION_TTL = 24 * 60 * 60 * 1000;

function createSession(userId) {
  const token = randomHex(32);
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}

function getBearerToken(req) {
  const h = (req.headers['authorization'] || '').trim();
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function getAuthedUser(req) {
  const session = getSession(getBearerToken(req));
  if (!session) return null;
  return loadUsers().find(u => u.id === session.userId) ?? null;
}

// ── Signaling store ───────────────────────────────────────────────────────────

const store = new Map();

function code6() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.css':         'text/css',
  '.js':          'application/javascript',
  '.json':        'application/json',
  '.glb':         'model/gltf-binary',
  '.mp4':         'video/mp4',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.webp':        'image/webp',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonReply(res, status, body = {}) {
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function serveStatic(res, filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(resolved).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
    fs.createReadStream(resolved).pipe(res);
  });
}

function userPublic(u) {
  return { id: u.id, username: u.username, email: u.email, profile: u.profile, upgrades: u.upgrades };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  // ── Auth / profile API ────────────────────────────────────────────────────

  if (urlPath.startsWith('/api/')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let d = {};
      try { if (body) d = JSON.parse(body); } catch { jsonReply(res, 400, { error: 'invalid json' }); return; }

      // POST /api/signup
      if (req.method === 'POST' && urlPath === '/api/signup') {
        const { username = '', email = '', password = '' } = d;
        if (!username || !password)
          return jsonReply(res, 400, { error: 'ต้องระบุชื่อผู้ใช้และรหัสผ่าน' });
        if (username.length < 3 || username.length > 16)
          return jsonReply(res, 400, { error: 'ชื่อผู้ใช้ต้อง 3–16 ตัวอักษร' });
        if (/[\x00-\x1f\x7f"'<>&/\\]/.test(username))
          return jsonReply(res, 400, { error: 'ชื่อผู้ใช้มีอักขระที่ไม่อนุญาต' });
        if (password.length < 6)
          return jsonReply(res, 400, { error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });

        const users = loadUsers();
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
          return jsonReply(res, 409, { error: 'ชื่อผู้ใช้นี้มีผู้ใช้แล้ว' });

        const salt = randomHex(16);
        const user = {
          id:           randomHex(16),
          username,
          email,
          passwordHash: hashPassword(password, salt),
          salt,
          createdAt:    new Date().toISOString(),
          profile:      defaultProfile(username),
          upgrades:     {},
        };
        users.push(user);
        saveUsers(users);

        const token = createSession(user.id);
        console.log(`[auth] signup username=${username}`);
        return jsonReply(res, 201, { token, user: userPublic(user) });
      }

      // POST /api/login
      if (req.method === 'POST' && urlPath === '/api/login') {
        const { username = '', password = '' } = d;
        if (!username || !password)
          return jsonReply(res, 400, { error: 'ต้องระบุชื่อผู้ใช้และรหัสผ่าน' });

        const users = loadUsers();
        const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user || hashPassword(password, user.salt) !== user.passwordHash)
          return jsonReply(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

        const token = createSession(user.id);
        console.log(`[auth] login  username=${username}`);
        return jsonReply(res, 200, { token, user: userPublic(user) });
      }

      // POST /api/logout
      if (req.method === 'POST' && urlPath === '/api/logout') {
        const token = getBearerToken(req);
        if (token) sessions.delete(token);
        return jsonReply(res, 200, {});
      }

      // GET /api/me
      if (req.method === 'GET' && urlPath === '/api/me') {
        const user = getAuthedUser(req);
        if (!user) return jsonReply(res, 401, { error: 'ไม่ได้เข้าสู่ระบบ' });
        return jsonReply(res, 200, userPublic(user));
      }

      // PUT /api/profile
      if (req.method === 'PUT' && urlPath === '/api/profile') {
        const user = getAuthedUser(req);
        if (!user) return jsonReply(res, 401, { error: 'ไม่ได้เข้าสู่ระบบ' });
        const users = loadUsers();
        const idx   = users.findIndex(u => u.id === user.id);
        if (idx < 0) return jsonReply(res, 404, { error: 'ไม่พบผู้ใช้' });
        users[idx].profile = { ...defaultProfile(user.username), ...d };
        saveUsers(users);
        return jsonReply(res, 200, {});
      }

      // PUT /api/upgrades
      if (req.method === 'PUT' && urlPath === '/api/upgrades') {
        const user = getAuthedUser(req);
        if (!user) return jsonReply(res, 401, { error: 'ไม่ได้เข้าสู่ระบบ' });
        const users = loadUsers();
        const idx   = users.findIndex(u => u.id === user.id);
        if (idx < 0) return jsonReply(res, 404, { error: 'ไม่พบผู้ใช้' });
        users[idx].upgrades = d;
        saveUsers(users);
        return jsonReply(res, 200, {});
      }

      return jsonReply(res, 404, { error: 'not found' });
    });
    return;
  }

  // ── Signaling ─────────────────────────────────────────────────────────────

  const isSignal = urlPath === '/offer'
    || urlPath.startsWith('/offer/')
    || urlPath.startsWith('/answer/');

  if (isSignal) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST' && urlPath === '/offer') {
        let sdp;
        try { sdp = JSON.parse(body).sdp; } catch { jsonReply(res, 400, { error: 'bad json' }); return; }
        if (!sdp) { jsonReply(res, 400, { error: 'missing sdp' }); return; }
        const code  = code6();
        const timer = setTimeout(() => store.delete(code), EXPIRY);
        store.set(code, { sdp, answer: null, timer });
        console.log(`[signal] offer  code=${code}`);
        jsonReply(res, 200, { code });
        return;
      }

      if (req.method === 'GET' && urlPath.startsWith('/offer/')) {
        const entry = store.get(urlPath.slice(7));
        if (!entry) { jsonReply(res, 404, { error: 'not found' }); return; }
        jsonReply(res, 200, { sdp: entry.sdp });
        return;
      }

      if (req.method === 'POST' && urlPath.startsWith('/answer/')) {
        const code  = urlPath.slice(8);
        const entry = store.get(code);
        if (!entry) { jsonReply(res, 404, { error: 'not found' }); return; }
        let sdp;
        try { sdp = JSON.parse(body).sdp; } catch { jsonReply(res, 400, { error: 'bad json' }); return; }
        entry.answer = sdp;
        console.log(`[signal] answer code=${code}`);
        jsonReply(res, 200, {});
        return;
      }

      if (req.method === 'GET' && urlPath.startsWith('/answer/')) {
        const entry = store.get(urlPath.slice(8));
        jsonReply(res, 200, { answer: entry?.answer ?? null });
        return;
      }

      jsonReply(res, 404, { error: 'not found' });
    });
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────

  const rel      = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const filePath = path.join(ROOT, rel);
  serveStatic(res, filePath);

}).listen(PORT, '0.0.0.0', () => {
  const lanIp = Object.values(os.networkInterfaces())
    .flat()
    .find(a => a.family === 'IPv4' && !a.internal)?.address;

  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║          GAME SERVER STARTED             ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║  Host  → http://localhost:${PORT}             ║`);
  if (lanIp) {
    const url = `http://${lanIp}:${PORT}`;
    const pad = ' '.repeat(Math.max(0, 40 - url.length));
    console.log(`  ║  Guest → ${url}${pad}║`);
  }
  console.log('  ╚══════════════════════════════════════════╝\n');
});
