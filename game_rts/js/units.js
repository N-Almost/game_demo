import { BOUNDARY }                                         from './constants.js';
import { state, session, SPAWN_POINTS }                    from './state.js';
import { cfg }                                              from './config.js';
import { randomTarget, findNearestEnemyUnit, findNearestSpawnPoint, hasLOS, steerAroundWall } from './helpers.js';

// ── Spawn cooldowns ───────────────────────────────────────────────────────────
// keyed by unit type — stores seconds remaining until next spawn is allowed
const _cooldowns = new Map();

export function tickSpawnCooldowns(dt) {
  for (const [type, remaining] of _cooldowns) {
    const next = remaining - dt;
    if (next <= 0) _cooldowns.delete(type);
    else           _cooldowns.set(type, next);
  }
}

/** 0 = ready, 1 = full cooldown */
export function getCooldownRatio(type) {
  const proto = cfg.protos[type];
  if (!proto || !proto.cooldown) return 0;
  return (_cooldowns.get(type) ?? 0) / proto.cooldown;
}

export function getCooldownRemaining(type) {
  return _cooldowns.get(type) ?? 0;
}

// ── Unit management ───────────────────────────────────────────────────────────

export function getEffectiveMaxUnits() {
  return cfg.maxUnits + state.buildings
    .filter(b => b.owner === 'player' && b.effect === 'maxUnits')
    .reduce((sum, b) => sum + b.effectValue, 0);
}

export function spawnUnit(type, x, y) {
  const proto = cfg.protos[type] || cfg.protos[Object.keys(cfg.protos)[0]];
  if (!proto) return false;
  if (_cooldowns.has(type)) return false;
  if (state.units.length >= getEffectiveMaxUnits()) return false;
  if (state.cost < proto.cost) return false;
  state.cost -= proto.cost;
  if (proto.cooldown > 0) _cooldowns.set(type, proto.cooldown);
  state.units.push({
    id: state.nextId++,
    type, x, y, vx: 0, vy: 0,
    radius: proto.radius, color: proto.color,
    speed: proto.speed, range: proto.range,
    attackRate: proto.attackRate, projectileSpeed: proto.projectileSpeed,
    damage: proto.damage, ability: proto.ability, abilityValue: proto.abilityValue ?? 0,
    attackTimer: 0, hp: proto.maxHp, maxHp: proto.maxHp,
    target: randomTarget(),
  });
  session.unitsDeployed++;
  session.unitUsage[type] = (session.unitUsage[type] ?? 0) + 1;
  return true;
}

export function updateUnits(dt) {
  // Auto-clear rally when the target spawn is captured by the player
  if (state.rallyPoint?.owner === 'player') state.rallyPoint = null;

  for (const u of state.units) {
    const nearestEnemy = findNearestEnemyUnit(u.x, u.y, 'player');
    const nearestSpawn = findNearestSpawnPoint(u.x, u.y, 'player');
    const enemyDist    = nearestEnemy ? Math.hypot(nearestEnemy.x - u.x, nearestEnemy.y - u.y) : Infinity;
    const spawnDist    = nearestSpawn ? Math.hypot(nearestSpawn.x  - u.x, nearestSpawn.y  - u.y) : Infinity;

    _updateTarget(u, nearestEnemy, enemyDist, nearestSpawn);
    _moveUnit(u, dt, nearestEnemy, enemyDist, nearestSpawn, spawnDist);

    _pushApart(u, state.units);
    _pushApart(u, state.enemies);
    _clampToBoundary(u);
    _resolveWallCollisions(u);
    _checkStuck(u, dt);
    _tryAttack(u, dt, nearestEnemy, enemyDist, nearestSpawn, spawnDist);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _updateTarget(u, nearestEnemy, enemyDist, nearestSpawn) {
  // DEFEND: hold at nearest player spawn, only attack what's already in range
  if (state.defendMode) {
    const home = SPAWN_POINTS
      .filter(p => p.owner === 'player')
      .reduce((best, p) =>
        Math.hypot(p.x - u.x, p.y - u.y) < Math.hypot(best.x - u.x, best.y - u.y) ? p : best
      , SPAWN_POINTS.find(p => p.owner === 'player') ?? null);
    if (home) u.target = { x: home.x, y: home.y };
    return;
  }

  // RALLY: advance toward the designated spawn point
  if (state.rallyPoint) {
    // Still engage enemies that are very close (opportunistic)
    if (nearestEnemy && enemyDist <= u.range * 1.6) {
      u.target = { x: nearestEnemy.x, y: nearestEnemy.y };
    } else {
      u.target = { x: state.rallyPoint.x, y: state.rallyPoint.y };
    }
    return;
  }

  // NORMAL AI
  if (nearestEnemy && enemyDist <= u.range * 1.6) {
    u.target = { x: nearestEnemy.x, y: nearestEnemy.y };
  } else if (nearestSpawn) {
    u.target = { x: nearestSpawn.x, y: nearestSpawn.y };
  } else if (!u.target) {
    u.target = randomTarget();
  }
}

function _moveUnit(u, dt, nearestEnemy, enemyDist, nearestSpawn, spawnDist) {
  const inAtkRange = (nearestEnemy && enemyDist <= u.range && hasLOS(u.x, u.y, nearestEnemy.x, nearestEnemy.y)) ||
                     (nearestSpawn && spawnDist <= u.range && hasLOS(u.x, u.y, nearestSpawn.x, nearestSpawn.y));

  const dx = u.target.x - u.x, dy = u.target.y - u.y;
  const dist = Math.hypot(dx, dy);

  if (inAtkRange) {
    u.vx = u.vy = 0;
  } else if (dist < 4) {
    u.vx = u.vy = 0;
    u.target = nearestSpawn ? { x: nearestSpawn.x, y: nearestSpawn.y } : randomTarget();
  } else {
    u.vx = (dx / dist) * u.speed;
    u.vy = (dy / dist) * u.speed;
    u.facingDx = u.vx; u.facingDy = u.vy;
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }
}

function _tryAttack(u, dt, nearestEnemy, enemyDist, nearestSpawn, spawnDist) {
  if (u.attackTimer > 0) { u.attackTimer -= dt; return; }
  let atk = null;
  if (nearestEnemy && enemyDist <= u.range && hasLOS(u.x, u.y, nearestEnemy.x, nearestEnemy.y)) atk = nearestEnemy;
  else if (nearestSpawn && spawnDist <= u.range && hasLOS(u.x, u.y, nearestSpawn.x, nearestSpawn.y)) atk = nearestSpawn;
  if (!atk) return;

  const ddx = atk.x - u.x, ddy = atk.y - u.y;
  const d   = Math.hypot(ddx, ddy) || 1;
  u.facingDx = ddx; u.facingDy = ddy;
  state.projectiles.push({
    x: u.x, y: u.y,
    vx: (ddx / d) * u.projectileSpeed, vy: (ddy / d) * u.projectileSpeed,
    radius: 4, damage: u.damage, owner: 'player',
    ability: u.ability, abilityValue: u.abilityValue ?? 0,
  });
  u.attackTimer = 1 / Math.max(0.0001, u.attackRate);
}

function _pushApart(unit, others) {
  for (const other of others) {
    if (other === unit) continue;
    const d = Math.hypot(unit.x - other.x, unit.y - other.y);
    const minDist = unit.radius + other.radius + 2;
    if (d < minDist && d > 0.01) {
      const push = (minDist - d) / 2;
      const nx = (unit.x - other.x) / d, ny = (unit.y - other.y) / d;
      unit.x  += nx * push; unit.y  += ny * push;
      other.x -= nx * push; other.y -= ny * push;
    }
  }
}

function _clampToBoundary(u) {
  if (u.x < BOUNDARY.x + u.radius)                   { u.x = BOUNDARY.x + u.radius;                   u.target = randomTarget(); }
  if (u.x > BOUNDARY.x + BOUNDARY.width  - u.radius) { u.x = BOUNDARY.x + BOUNDARY.width  - u.radius; u.target = randomTarget(); }
  if (u.y < BOUNDARY.y + u.radius)                   { u.y = BOUNDARY.y + u.radius;                   u.target = randomTarget(); }
  if (u.y > BOUNDARY.y + BOUNDARY.height - u.radius) { u.y = BOUNDARY.y + BOUNDARY.height - u.radius; u.target = randomTarget(); }
}

function _resolveWallCollisions(u) {
  for (const w of cfg.walls) {
    const nx = Math.max(w.x, Math.min(u.x, w.x + w.width));
    const ny = Math.max(w.y, Math.min(u.y, w.y + w.height));
    const dx = u.x - nx, dy = u.y - ny;
    const d  = Math.hypot(dx, dy);
    if (d < u.radius) {
      const overlap = u.radius - d + 0.5;
      const wnx = d > 0.01 ? dx / d : 1, wny = d > 0.01 ? dy / d : 0;
      u.x += wnx * overlap;
      u.y += wny * overlap;
      steerAroundWall(u, wnx, wny);
    }
  }
}

function _checkStuck(u, dt) {
  if (!u.stuckCheck) u.stuckCheck = { x: u.x, y: u.y, t: 0 };
  u.stuckCheck.t += dt;
  if (u.stuckCheck.t >= 0.8) {
    if (Math.hypot(u.x - u.stuckCheck.x, u.y - u.stuckCheck.y) < u.speed * 0.05) u.target = randomTarget();
    u.stuckCheck = { x: u.x, y: u.y, t: 0 };
  }
}
