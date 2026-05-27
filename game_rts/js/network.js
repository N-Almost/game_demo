// WebRTC P2P — signaling via local HTTP server (signaling.js on port 8765)
// Both peers must be on the same LAN; host runs signaling.js + http.server 8080.

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Signaling server lives on the same host that serves the game files
const SIGNAL = () => `http://${location.hostname}:8765`;

let _pc   = null;
let _dc   = null;
let _role = null; // 'host' | 'guest'

// Mutable callbacks — assign via Net.on.connected = fn (object property, not module binding)
export const on = {
  data:         () => {},
  connected:    () => {},
  disconnected: () => {},
};

function _makePC() {
  _pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });
  _pc.onconnectionstatechange = () => {
    const s = _pc.connectionState;
    if (s === 'disconnected' || s === 'failed') on.disconnected();
  };
  return _pc;
}

function _waitIce(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(pc.localDescription.sdp); return; }
    const h = () => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', h);
      resolve(pc.localDescription.sdp);
    };
    pc.addEventListener('icegatheringstatechange', h);
    // Fallback: LAN host candidates are ready almost instantly; 2 s is plenty
    setTimeout(() => resolve(pc.localDescription.sdp), 2000);
  });
}

function _attachDC(dc) {
  _dc = dc;
  dc.onopen    = () => on.connected();
  dc.onclose   = () => on.disconnected();
  dc.onmessage = e => { try { on.data(JSON.parse(e.data)); } catch {} };
}

// ── HOST: step 1 — returns 6-digit room code ──────────────────────────────────
export async function createOffer() {
  _role = 'host';
  const pc = _makePC();
  const dc = pc.createDataChannel('rts', { ordered: false, maxRetransmits: 0 });
  _attachDC(dc);
  await pc.setLocalDescription(await pc.createOffer());
  const sdp = await _waitIce(pc);

  const res = await fetch(`${SIGNAL()}/offer`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sdp }),
  });
  if (!res.ok) throw new Error('Signaling server error');
  const { code } = await res.json();
  return code; // 6-digit string
}

// ── HOST: step 2 — poll signaling server until guest's answer arrives ─────────
export async function waitForAnswer(code) {
  for (let i = 0; i < 120; i++) { // poll up to 3 minutes
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`${SIGNAL()}/answer/${code}`);
    const { answer } = await res.json();
    if (answer) {
      await _pc.setRemoteDescription({ type: 'answer', sdp: answer });
      return;
    }
  }
  throw new Error('หมดเวลารอ Guest');
}

// ── GUEST: enter code → fetch offer → upload answer ───────────────────────────
export async function joinWithCode(code) {
  _role = 'guest';
  const offerRes = await fetch(`${SIGNAL()}/offer/${code}`);
  if (!offerRes.ok) throw new Error('รหัสไม่ถูกต้องหรือหมดอายุ');
  const { sdp: offerSdp } = await offerRes.json();

  const pc = _makePC();
  pc.ondatachannel = e => _attachDC(e.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  await pc.setLocalDescription(await pc.createAnswer());
  const answerSdp = await _waitIce(pc);

  const answerRes = await fetch(`${SIGNAL()}/answer/${code}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sdp: answerSdp }),
  });
  if (!answerRes.ok) throw new Error('ส่ง answer ไม่สำเร็จ');
  // ICE negotiation continues; on.connected() fires when DataChannel opens
}

// ── Send / receive ─────────────────────────────────────────────────────────────
export function send(msg) {
  if (_dc?.readyState === 'open') _dc.send(JSON.stringify(msg));
}

export function getRole()  { return _role; }
export function isOpen()   { return _dc?.readyState === 'open'; }

export function close() {
  _dc?.close(); _pc?.close();
  _dc = null; _pc = null; _role = null;
}
