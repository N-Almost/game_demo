// Minimal WebRTC signaling server — no npm needed (Node.js built-ins only)
// Usage: node signaling.js
// Clients connect to http://<this-machine-ip>:8765
//
// Protocol:
//   POST /offer              { sdp }        → { code }   (host registers offer)
//   GET  /offer/:code                       → { sdp }    (guest fetches offer)
//   POST /answer/:code       { sdp }        → {}         (guest registers answer)
//   GET  /answer/:code                      → { answer } (host polls for answer)

const http = require('http');

const PORT  = 8765;
const EXPIRY_MS = 10 * 60 * 1000; // sessions expire after 10 min

const store = new Map(); // code → { sdp, answer, timer }

function code6() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

function respond(res, status, body = {}) {
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const path = req.url.split('?')[0];

    // ── POST /offer ──────────────────────────────────────
    if (req.method === 'POST' && path === '/offer') {
      let sdp;
      try { sdp = JSON.parse(body).sdp; } catch { respond(res, 400, { error: 'bad json' }); return; }
      if (!sdp) { respond(res, 400, { error: 'missing sdp' }); return; }

      const code = code6();
      const timer = setTimeout(() => store.delete(code), EXPIRY_MS);
      store.set(code, { sdp, answer: null, timer });
      console.log(`[+] offer  code=${code}`);
      respond(res, 200, { code });
      return;
    }

    // ── GET /offer/:code ─────────────────────────────────
    if (req.method === 'GET' && path.startsWith('/offer/')) {
      const code = path.slice(7);
      const entry = store.get(code);
      if (!entry) { respond(res, 404, { error: 'not found' }); return; }
      respond(res, 200, { sdp: entry.sdp });
      return;
    }

    // ── POST /answer/:code ───────────────────────────────
    if (req.method === 'POST' && path.startsWith('/answer/')) {
      const code = path.slice(8);
      const entry = store.get(code);
      if (!entry) { respond(res, 404, { error: 'not found' }); return; }
      let sdp;
      try { sdp = JSON.parse(body).sdp; } catch { respond(res, 400, { error: 'bad json' }); return; }
      entry.answer = sdp;
      console.log(`[+] answer code=${code}`);
      respond(res, 200, {});
      return;
    }

    // ── GET /answer/:code ────────────────────────────────
    if (req.method === 'GET' && path.startsWith('/answer/')) {
      const code = path.slice(8);
      const entry = store.get(code);
      respond(res, 200, { answer: entry?.answer ?? null });
      return;
    }

    respond(res, 404, { error: 'not found' });
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server listening on port ${PORT}`);
  console.log('Start game server:  python3 -m http.server 8080');
  console.log('Guest opens:        http://<this-ip>:8080');
});
