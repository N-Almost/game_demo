import { state, SPAWN_POINTS }                                   from './state.js';
import { cfg }                                                    from './config.js';
import { findNearestEnemyUnit, findNearestSpawnPoint, hasLOS }    from './helpers.js';

// ── Enemy spawn cooldowns (PvP guest side) ────────────────────────────────────

const _enemyCooldowns = new Map();

export function tickEnemySpawnCooldowns(dt) {
  for (const [type, remaining] of _enemyCooldowns) {
    const next = remaining - dt;
    if (next <= 0) _enemyCooldowns.delete(type);
    else           _enemyCooldowns.set(type, next);
  }
}

export function getEnemyCooldownRatio(type) {
  const proto = cfg.protos[type];
  if (!proto?.cooldown) return 0;
  return (_enemyCooldowns.get(type) ?? 0) / proto.cooldown;
}

export function getEnemyCooldownRemaining(type) {
  return _enemyCooldowns.get(type) ?? 0;
}

export function setEnemyCooldowns(entries) {
  _enemyCooldowns.clear();
  for (const [t, rem] of Object.entries(entries)) {
    if (rem > 0) _enemyCooldowns.set(t, rem);
  }
}

// Called by PvP host when guest sends a spawn command
export function spawnEnemyUnit(type, x, y) {
  const proto = cfg.enemyProtos[type] ?? cfg.enemyProtos[Object.keys(cfg.enemyProtos)[0]];
  if (!proto) return false;
  const cost = proto.cost ?? cfg.protos[type]?.cost ?? 0;
  if (state.enemyCost < cost) return false;
  if (state.enemies.length >= cfg.enemyMaxUnits) return false;
  if (_enemyCooldowns.has(type)) return false;
  state.enemyCost -= cost;
  const cooldown = cfg.protos[type]?.cooldown ?? 0;
  if (cooldown > 0) _enemyCooldowns.set(type, cooldown);
  state.enemies.push({
    id: state.nextId++,
    type, x, y, vx: 0, vy: 0,
    radius: proto.radius, color: proto.color,
    speed:           proto.speed,
    range:           proto.range,
    attackRate:      proto.attackRate,
    projectileSpeed: proto.projectileSpeed,
    damage:          proto.damage,
    hp:              proto.maxHp, maxHp: proto.maxHp,
    ability: proto.ability, abilityValue: proto.abilityValue ?? 0,
    attackTimer: 0,
  });
  return true;
}

export function spawnEnemies(dt) {
  const enemySpawns = SPAWN_POINTS.filter(p => p.owner === 'enemy');
  if (!enemySpawns.length) return;

  const count    = enemySpawns.length;
  const interval = count >= 3 ? cfg.enemySpawnIntervals[2]
                 : count >= 2 ? cfg.enemySpawnIntervals[1]
                 :               cfg.enemySpawnIntervals[0];

  state.enemySpawnTimer += dt;
  if (state.enemySpawnTimer < interval || state.enemies.length >= cfg.enemyMaxUnits) return;
  state.enemySpawnTimer = 0;

  const types = Object.keys(cfg.enemyProtos);
  if (!types.length) return;

  const sp    = enemySpawns[Math.floor(Math.random() * enemySpawns.length)];
  const type  = types[Math.floor(Math.random() * types.length)];
  const proto = cfg.enemyProtos[type];

  state.enemies.push({
    x: sp.x, y: sp.y, type,
    radius: proto.radius, color: proto.color,
    speed:           proto.speed  * cfg.enemySpdMult,
    range:           proto.range,
    attackRate:      proto.attackRate,
    projectileSpeed: proto.projectileSpeed,
    damage:          Math.round(proto.damage * cfg.enemyDmgMult),
    hp:              Math.round(proto.maxHp  * cfg.enemyHpMult),
    maxHp:           Math.round(proto.maxHp  * cfg.enemyHpMult),
    ability: proto.ability, abilityValue: proto.abilityValue ?? 0,
    attackTimer: 0,
  });
}

export function updateEnemies(dt) {
  for (const e of state.enemies) {
    const nearestFriendly    = findNearestEnemyUnit(e.x, e.y, 'enemy');
    const nearestPlayerSpawn = findNearestSpawnPoint(e.x, e.y, 'enemy');
    const friendDist = nearestFriendly    ? Math.hypot(nearestFriendly.x    - e.x, nearestFriendly.y    - e.y) : Infinity;
    const spawnDist  = nearestPlayerSpawn ? Math.hypot(nearestPlayerSpawn.x - e.x, nearestPlayerSpawn.y - e.y) : Infinity;

    const inAtkRange =
      (nearestFriendly    && friendDist <= e.range && hasLOS(e.x, e.y, nearestFriendly.x, nearestFriendly.y)) ||
      (nearestPlayerSpawn && spawnDist  <= e.range && hasLOS(e.x, e.y, nearestPlayerSpawn.x, nearestPlayerSpawn.y));

    // PvP: respect enemyRallyPoint and enemyDefendMode (mirrors player unit AI)
    const rally  = state.enemyRallyPoint;
    const defend = state.enemyDefendMode;

    let moveTarget = nearestPlayerSpawn;
    if (rally) moveTarget = rally;
    if (defend) {
      // Hold at nearest enemy spawn
      const ownSpawn = findNearestSpawnPoint(e.x, e.y, 'player'); // nearest player-side spawn = "enemy" territory target becomes own territory
      const nearestEnemyOwn = SPAWN_POINTS.filter(p => p.owner === 'enemy')
        .reduce((best, p) => {
          const d = Math.hypot(p.x - e.x, p.y - e.y);
          return (!best || d < best.dist) ? { p, dist: d } : best;
        }, null);
      moveTarget = nearestEnemyOwn?.p ?? nearestPlayerSpawn;
    }

    _moveEnemy(e, dt, nearestFriendly, friendDist, moveTarget, inAtkRange);
    _resolveWallCollisions(e);
    _pushApart(e);
    _tryAttack(e, dt, nearestFriendly, friendDist, nearestPlayerSpawn, spawnDist);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _moveEnemy(e, dt, nearestFriendly, friendDist, nearestPlayerSpawn, inAtkRange) {
  let target = nearestPlayerSpawn;
  if (nearestFriendly && friendDist <= 180) target = nearestFriendly;
  if (e.wallSlideTimer > 0) { e.wallSlideTimer -= dt; target = e.wallSlideTarget || target; }

  const tx = target ? target.x : 480;
  const ty = target ? target.y : 320;
  const dx = tx - e.x, dy = ty - e.y;
  const dist = Math.hypot(dx, dy);

  if (inAtkRange || dist <= 1) {
    e.vx = 0; e.vy = 0;
  } else {
    e.vx = (dx / dist) * e.speed;
    e.vy = (dy / dist) * e.speed;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }
}

function _tryAttack(e, dt, nearestFriendly, friendDist, nearestPlayerSpawn, spawnDist) {
  if (!e.attackTimer) e.attackTimer = 0;
  if (e.attackTimer > 0) { e.attackTimer -= dt; return; }

  let atk = null;
  if (nearestFriendly && friendDist <= e.range && hasLOS(e.x, e.y, nearestFriendly.x, nearestFriendly.y)) atk = nearestFriendly;
  else if (nearestPlayerSpawn && spawnDist <= e.range && hasLOS(e.x, e.y, nearestPlayerSpawn.x, nearestPlayerSpawn.y)) atk = nearestPlayerSpawn;
  if (!atk) return;

  const ddx = atk.x - e.x, ddy = atk.y - e.y;
  const d   = Math.hypot(ddx, ddy) || 1;
  state.projectiles.push({
    x: e.x, y: e.y,
    vx: (ddx / d) * e.projectileSpeed, vy: (ddy / d) * e.projectileSpeed,
    radius: 4, damage: e.damage, owner: 'enemy',
    ability: e.ability, abilityValue: e.abilityValue ?? 0,
  });
  e.attackTimer = 1 / Math.max(0.0001, e.attackRate);
}

function _resolveWallCollisions(e) {
  for (const w of cfg.walls) {
    const nearestX = Math.max(w.x, Math.min(e.x, w.x + w.width));
    const nearestY = Math.max(w.y, Math.min(e.y, w.y + w.height));
    const dx = e.x - nearestX, dy = e.y - nearestY;
    const d  = Math.hypot(dx, dy);
    if (d < e.radius) {
      const overlap = e.radius - d + 0.5;
      const wnx = d > 0.01 ? dx / d : 1, wny = d > 0.01 ? dy / d : 0;
      e.x += wnx * overlap;
      e.y += wny * overlap;
      // Slide along wall surface toward current movement goal
      const t1x = -wny, t1y = wnx, t2x = wny, t2y = -wnx;
      const gx = e.wallSlideTarget ? e.wallSlideTarget.x - e.x : -dx;
      const gy = e.wallSlideTarget ? e.wallSlideTarget.y - e.y : -dy;
      const useT1 = (t1x * gx + t1y * gy) >= (t2x * gx + t2y * gy);
      e.wallSlideTarget = { x: e.x + (useT1 ? t1x : t2x) * 100, y: e.y + (useT1 ? t1y : t2y) * 100 };
      e.wallSlideTimer  = 0.4;
    }
  }
}

function _pushApart(e) {
  for (const other of state.enemies) {
    if (other === e) continue;
    const d = Math.hypot(e.x - other.x, e.y - other.y);
    const minDist = e.radius + other.radius + 2;
    if (d < minDist && d > 0.01) {
      const push = (minDist - d) / 2;
      const nx = (e.x - other.x) / d, ny = (e.y - other.y) / d;
      e.x     += nx * push; e.y     += ny * push;
      other.x -= nx * push; other.y -= ny * push;
    }
  }
}
