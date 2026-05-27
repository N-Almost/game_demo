// Client-side auth helper — wraps /api/* routes
// Token stored in localStorage under 'rts_token'

const TOKEN_KEY = 'rts_token';

export function getToken()   { return localStorage.getItem(TOKEN_KEY); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function _post(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('ไม่สามารถเชื่อมต่อ server ได้ — รัน node server.js ก่อนเล่น');
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

export async function login(username, password) {
  const data = await _post('/api/login', { username, password });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data; // { token, user: { id, username, email, profile, upgrades } }
}

export async function signup(username, email, password) {
  const data = await _post('/api/signup', { username, email, password });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data;
}

export async function logout() {
  const token = getToken();
  if (token) {
    try { await _post('/api/logout', {}, token); } catch {}
  }
  clearToken();
}

export async function getMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { clearToken(); return null; }
    try { return await res.json(); } catch { return null; }
  } catch { return null; }
}

export function syncProfile(profile) {
  const token = getToken();
  if (!token) return;
  fetch('/api/profile', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify(profile),
  }).catch(() => {});
}

export function syncUpgrades(upgrades) {
  const token = getToken();
  if (!token) return;
  fetch('/api/upgrades', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify(upgrades),
  }).catch(() => {});
}
