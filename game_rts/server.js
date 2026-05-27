// server.js — all-in-one game + signaling server (Node.js built-ins only)
// Usage: node server.js
// Host opens : http://localhost:8080
// Guest opens: http://<lan-ip>:8080

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT   = 8080;
const ROOT   = __dirname;
const EXPIRY = 10 * 60 * 1000;

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

// ── HTTP server ───────────────────────────────────────────────────────────────

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  // ── Signaling ─────────────────────────────────────────

  const isSignal = urlPath === '/offer'
    || urlPath.startsWith('/offer/')
    || urlPath.startsWith('/answer/');

  if (isSignal) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      // POST /offer
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

      // GET /offer/:code
      if (req.method === 'GET' && urlPath.startsWith('/offer/')) {
        const entry = store.get(urlPath.slice(7));
        if (!entry) { jsonReply(res, 404, { error: 'not found' }); return; }
        jsonReply(res, 200, { sdp: entry.sdp });
        return;
      }

      // POST /answer/:code
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

      // GET /answer/:code
      if (req.method === 'GET' && urlPath.startsWith('/answer/')) {
        const entry = store.get(urlPath.slice(8));
        jsonReply(res, 200, { answer: entry?.answer ?? null });
        return;
      }

      jsonReply(res, 404, { error: 'not found' });
    });
    return;
  }

  // ── Static files ──────────────────────────────────────

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
