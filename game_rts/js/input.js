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
        _setHint('เลือกยูนิต แล้วแตะจุดเขียว');
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
        _setHint('เลือกยูนิต แล้วแตะจุดเขียว');
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
  canvas.addEventListener('click',      e => _handleTap(e.clientX, e.clientY));
  canvas.addEventListener('touchend',   e => { e.preventDefault(); _handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });
}

// ── Private ───────────────────────────────────────────────────────────────────

function _handleTap(clientX, clientY) {
  if (state.gameOver) {
    const next = state.winner === 'player' ? cfg.currentWave + 1 : 1;
    localStorage.setItem('rts_wave', next);
    location.reload();
    return;
  }
  if (!selectedUnitType && !selectedBuildingType) return;

  const pt = window.Renderer?.getGroundIntersect(clientX, clientY);
  if (!pt) return;

  const nearest = _nearestPlayerSpawnTo(pt.x, pt.y);
  if (!nearest || Math.hypot(nearest.x - pt.x, nearest.y - pt.y) >= SPAWN_RADIUS + 60) return;

  if (selectedBuildingType) {
    if (_placeBuilding(selectedBuildingType, nearest) && navigator.vibrate) navigator.vibrate(30);
  } else if (selectedUnitType) {
    if (spawnUnit(selectedUnitType, nearest.x, nearest.y) && navigator.vibrate) navigator.vibrate(30);
  }
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

function _setHint(text) {
  const el = document.getElementById('hint-text');
  if (el) el.textContent = text;
}
