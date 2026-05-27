// PvP lobby UI — runs inside index.html before the game starts.
// Resolves when WebRTC data channel opens.
import * as Net from './network.js';

function _el(id)          { return document.getElementById(id); }
function _show(id)        { _el(id).style.display = 'block'; }
function _hide(id)        { _el(id).style.display = 'none'; }
function _status(id, msg, cls = '') {
  const el = _el(id);
  el.textContent = msg;
  el.className   = 'pvp-status' + (cls ? ' ' + cls : '');
}

// Returns a Promise that resolves with 'host' | 'guest' when connected.
export function showLobby() {
  return new Promise((resolve) => {
    const overlay = _el('pvp-lobby');
    overlay.classList.add('visible');

    // ── Tab switching ────────────────────────────────────────────────────
    function switchTab(tab) {
      _el('pvp-tab-host').classList.toggle('active', tab === 'host');
      _el('pvp-tab-guest').classList.toggle('active', tab === 'guest');
      _el('pvp-panel-host').classList.toggle('active', tab === 'host');
      _el('pvp-panel-guest').classList.toggle('active', tab === 'guest');
    }
    _el('pvp-tab-host').onclick  = () => switchTab('host');
    _el('pvp-tab-guest').onclick = () => switchTab('guest');

    // ── Back button ──────────────────────────────────────────────────────
    _el('pvp-btn-back').onclick = () => {
      Net.close();
      localStorage.removeItem('pvp_mode');
      localStorage.removeItem('pvp_role');
      overlay.classList.remove('visible');
      location.href = 'index.html';
    };

    function _onConnect(role) {
      localStorage.setItem('pvp_role', role);
      overlay.classList.remove('visible');
      resolve(role);
    }

    // ── HOST flow ─────────────────────────────────────────────────────────
    _el('pvp-btn-create').onclick = async () => {
      _el('pvp-btn-create').disabled = true;
      _status('pvp-hs1', 'กำลังสร้างห้อง…');
      try {
        Net.on.connected    = () => _onConnect('host');
        Net.on.disconnected = () => _status('pvp-hs2', 'การเชื่อมต่อขาดหาย', 'err');
        const code = await Net.createOffer();

        // Display big 6-digit code
        _el('pvp-room-code').textContent = code;
        _hide('pvp-h1');
        _show('pvp-h2');
        _status('pvp-hs2', 'รอผู้เล่น 2 เข้าร่วม…', 'ok');

        // Silently poll for guest answer in background
        Net.waitForAnswer(code).catch(e => _status('pvp-hs2', e.message, 'err'));
      } catch (e) {
        _status('pvp-hs1', e.message || 'เกิดข้อผิดพลาด', 'err');
        _el('pvp-btn-create').disabled = false;
      }
    };

    _el('pvp-copy-code').onclick = () => {
      const code = _el('pvp-room-code').textContent;
      navigator.clipboard?.writeText(code).catch(() => {});
    };

    // ── GUEST flow ────────────────────────────────────────────────────────
    const codeInput = _el('pvp-code-in');

    // Auto-submit when 6 digits entered
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
      if (codeInput.value.length === 6) _el('pvp-btn-join').disabled = false;
      else _el('pvp-btn-join').disabled = true;
    });

    _el('pvp-btn-join').onclick = async () => {
      const code = codeInput.value.trim();
      if (code.length !== 6) return;
      _el('pvp-btn-join').disabled = true;
      _status('pvp-gs1', 'กำลังเชื่อมต่อ…');
      try {
        Net.on.connected    = () => _onConnect('guest');
        Net.on.disconnected = () => _status('pvp-gs1', 'การเชื่อมต่อขาดหาย', 'err');
        await Net.joinWithCode(code);
        _status('pvp-gs1', 'รอการเชื่อมต่อ…', 'ok');
      } catch (e) {
        _status('pvp-gs1', e.message || 'เกิดข้อผิดพลาด', 'err');
        _el('pvp-btn-join').disabled = false;
      }
    };
  });
}
