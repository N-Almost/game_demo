import { SPAWN_RADIUS }      from './constants.js';
import { state, SPAWN_POINTS } from './state.js';
import { cfg }                 from './config.js';
import { spawnUnit }           from './units.js';

export let selectedUnitType     = null;
export let selectedBuildingType = null;

// ── Button event binding ──────────────────────────────────────────────────────

export function bindUnitButtons() {
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type  = btn.dataset.type;
      const proto = cfg.protos[type];
      if (!proto) return;

      selectedBuildingType = null;
      document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('selected'));

      if (selectedUnitType === type) {
        selectedUnitType = null;
        document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
        _setHint(_idleHint());
      } else {
        document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedUnitType = type;
        _setHint(`${proto.name} (cost ${proto.cost}) — แตะจุดเขียวเพื่อวาง`);
      }
    });
  });
}

export function bindBuildingButtons() {
  document.querySelectorAll('.building-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type  = btn.dataset.type;
      const proto = cfg.buildingProtos[type];
      if (!proto) return;

      selectedUnitType = null;
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));

      if (selectedBuildingType === type) {
        selectedBuildingType = null;
        document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('selected'));
        _setHint(_idleHint());
      } else {
        document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedBuildingType = type;
        _setHint(`${proto.name} (cost ${proto.cost}) — แตะ spawn ของฝ่ายเราเพื่อสร้าง`);
      }
    });
  });
}

// ── Canvas input ──────────────────────────────────────────────────────────────

export function setupCanvasInput(canvas) {
  // ── Pinch-to-zoom state ─────────────────────────────
  let _pinchActive    = false;
  let _pinchStartDist = 0;
  let _pinchStartZoom = 1;

  // ── Single-finger drag-to-pan state ─────────────────
  let _dragActive = false;
  let _dragLastX  = 0;
  let _dragLastY  = 0;
  let _dragStartX = 0;
  let _dragStartY = 0;
  const DRAG_THRESHOLD = 8;

  function _touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  // ── Touch events ────────────────────────────────────
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      _pinchActive    = true;
      _pinchStartDist = _touchDist(e.touches);
      _pinchStartZoom = window.Renderer?.getZoom() ?? 1;
      _dragActive = false;
    } else if (e.touches.length === 1) {
      _pinchActive = false;
      _dragActive  = false;
      _dragStartX  = e.touches[0].clientX;
      _dragStartY  = e.touches[0].clientY;
      _dragLastX   = _dragStartX;
      _dragLastY   = _dragStartY;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && _pinchActive) {
      const dist  = _touchDist(e.touches);
      window.Renderer?.setZoom(_pinchStartZoom * (dist / _pinchStartDist));
    } else if (e.touches.length === 1 && !_pinchActive) {
      const tx = e.touches[0].clientX;
      const ty = e.touches[0].clientY;
      if (!_dragActive && Math.hypot(tx - _dragStartX, ty - _dragStartY) > DRAG_THRESHOLD) {
        _dragActive = true;
      }
      if (_dragActive) {
        window.Renderer?.panBy(tx - _dragLastX, ty - _dragLastY);
        _dragLastX = tx;
        _dragLastY = ty;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (_pinchActive) {
      if (e.touches.length < 2) _pinchActive = false;
      return;  // don't fire a tap after pinch
    }
    const wasDrag = _dragActive;
    _dragActive = false;
    if (wasDrag) return;  // don't fire a tap after drag
    if (e.changedTouches.length > 0) {
      _handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }
  }, { passive: false });

  // ── Mouse wheel zoom (desktop) ──────────────────────
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    window.Renderer?.setZoom((window.Renderer.getZoom() ?? 1) * factor);
  }, { passive: false });

  canvas.addEventListener('click', e => _handleTap(e.clientX, e.clientY));

  const overlay = document.getElementById('gameover-overlay');
  if (overlay) {
    const _overlayNav = el => {
      const btn = el?.closest?.('button') ?? el;
      if (btn?.id === 'btn-go-next') { location.reload(); return; }
      if (btn?.id === 'btn-go-menu') { location.href = 'menu.html'; return; }
      // Loss / draw: tap anywhere restarts from wave 1
      if (state.winner !== 'player') {
        localStorage.setItem('rts_wave', 1);
        location.href = 'menu.html';
      }
    };
    overlay.addEventListener('click', e => _overlayNav(e.target));
    overlay.addEventListener('touchend', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      _overlayNav(document.elementFromPoint(t.clientX, t.clientY));
    }, { passive: false });
  }
}

export function bindCommandButtons() {
  const defendBtn = document.getElementById('btn-defend');
  if (defendBtn) {
    defendBtn.addEventListener('click', () => {
      state.defendMode = !state.defendMode;
      if (state.defendMode) {
        state.rallyPoint = null;
        _setHint('🛡 DEFEND — ยูนิตยึดตำแหน่ง spawn ของเรา');
      } else {
        _setHint(_idleHint());
      }
    });
  }

  const cancelBtn = document.getElementById('btn-cancel-rally');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', e => {
      e.stopPropagation(); // don't bubble to canvas
      state.rallyPoint = null;
      _setHint(_idleHint());
    });
  }

}

// ── Private ───────────────────────────────────────────────────────────────────

function _handleTap(clientX, clientY) {
  if (state.gameOver) {
    // Win: handled by overlay buttons. Loss/draw: tap to restart.
    if (state.winner !== 'player') {
      localStorage.setItem('rts_wave', 1);
      location.href = 'menu.html';
    }
    return;
  }

  const pt = window.Renderer?.getGroundIntersect(clientX, clientY);
  if (!pt) return;

  if (selectedUnitType || selectedBuildingType) {
    // Place unit / building at nearest player spawn
    const nearest = _nearestPlayerSpawnTo(pt.x, pt.y);
    if (!nearest || Math.hypot(nearest.x - pt.x, nearest.y - pt.y) >= SPAWN_RADIUS + 60) return;
    if (selectedBuildingType) {
      if (_placeBuilding(selectedBuildingType, nearest) && navigator.vibrate) navigator.vibrate(30);
    } else {
      if (spawnUnit(selectedUnitType, nearest.x, nearest.y) && navigator.vibrate) navigator.vibrate(30);
    }
    return;
  }

  // No selection — try to set / clear rally point on a non-player spawn
  _trySetRally(pt.x, pt.y);
}

function _trySetRally(x, y) {
  let nearest = null, nearestDist = Infinity;
  for (const p of SPAWN_POINTS) {
    if (p.owner === 'player') continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < nearestDist) { nearest = p; nearestDist = d; }
  }
  if (!nearest || nearestDist >= SPAWN_RADIUS + 60) return;

  // Toggle: tap same spawn again to cancel rally
  state.rallyPoint = (state.rallyPoint === nearest) ? null : nearest;
  // Rally cancels defend mode
  if (state.rallyPoint) state.defendMode = false;
  if (navigator.vibrate) navigator.vibrate(18);
}

function _nearestPlayerSpawnTo(x, y) {
  let nearest = null, nearestDist = Infinity;
  for (const p of SPAWN_POINTS) {
    if (p.owner !== 'player') continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < nearestDist) { nearest = p; nearestDist = d; }
  }
  return nearest;
}

function _placeBuilding(type, sp) {
  const proto = cfg.buildingProtos[type];
  if (!proto) return false;
  if (state.cost < proto.cost)               { _setHint('cost ไม่พอ'); return false; }
  if (state.buildings.some(b => b.spawnRef === sp)) { _setHint('Spawn นี้มีสิ่งปลูกสร้างแล้ว'); return false; }
  state.cost -= proto.cost;
  state.buildings.push({
    type, x: sp.x, y: sp.y,
    hp: proto.maxHp, maxHp: proto.maxHp,
    owner: 'player', spawnRef: sp,
    color: proto.color, radius: proto.radius ?? 12,
    effect: proto.effect, effectValue: proto.effectValue,
    // turret-specific (undefined for non-turrets, ignored by non-turret logic)
    range:           proto.range,
    damage:          proto.damage,
    attackRate:      proto.attackRate,
    projectileSpeed: proto.projectileSpeed,
    attackTimer:     0,
  });
  return true;
}

function _idleHint() {
  return 'เลือกยูนิต/สิ่งปลูกสร้าง · แตะ spawn ศัตรูเพื่อ Rally';
}

function _setHint(text) {
  const el = document.getElementById('hint-text');
  if (el) el.textContent = text;
}
