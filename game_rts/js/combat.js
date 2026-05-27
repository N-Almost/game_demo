import { SPAWN_RADIUS }                             from './constants.js';
import { state, session, SPAWN_POINTS, addDamageNumber, addExplosion } from './state.js';
import { cfg }                                      from './config.js';
import { hasLOS }                                   from './helpers.js';

export function updateProjectiles(dt) {
  for (let pi = state.projectiles.length - 1; pi >= 0; pi--) {
    const p = state.projectiles[pi];
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < -20 || p.x > 980 || p.y < -20 || p.y > 660) {
      state.projectiles.splice(pi, 1); continue;
    }

    if (_hitWall(p, pi))                        continue;
    if (_hitSpawnPoint(p, pi))                  continue;
    if (p.owner === 'player' && _hitEnemy(p, pi)) continue;
    if (p.owner === 'enemy'  && _hitUnit(p, pi))  continue;
  }
}

export function updateTurrets(dt) {
  for (const b of state.buildings) {
    if (b.owner !== 'player' || b.effect !== 'turret') continue;

    b.attackTimer = Math.max(0, b.attackTimer - dt);

    // Always find nearest visible enemy in range (for aiming even on cooldown)
    let target = null, nearest = Infinity;
    for (const e of state.enemies) {
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d < b.range && d < nearest && hasLOS(b.x, b.y, e.x, e.y)) {
        target = e; nearest = d;
      }
    }
    if (!target) continue;

    const dx = target.x - b.x, dy = target.y - b.y;
    const d  = Math.hypot(dx, dy) || 1;

    b.aimAngle = Math.atan2(dx, dy); // store for renderer rotation

    if (b.attackTimer > 0) continue;

    state.projectiles.push({
      x: b.x, y: b.y,
      vx: (dx / d) * b.projectileSpeed,
      vy: (dy / d) * b.projectileSpeed,
      radius: 4, damage: b.damage, owner: 'player',
      ability: null, abilityValue: 0,
      fromTurret: true,
    });
    b.attackTimer = 1 / Math.max(0.0001, b.attackRate);
  }
}

export function updateMeleeCombat(dt) {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    for (let j = state.units.length - 1; j >= 0; j--) {
      const u = state.units[j];
      if (Math.hypot(u.x - e.x, u.y - e.y) >= u.radius + e.radius) continue;

      u.hp -= 20 * dt;
      e.hp -= 30 * dt;

      // Throttle visible damage numbers to once per 300 ms
      const now = performance.now();
      if (!u.lastMeleeDmgTime || now - u.lastMeleeDmgTime > 300) {
        addDamageNumber(u.x, u.y, Math.round(20 * 0.3));
        u.lastMeleeDmgTime = now;
      }
      if (!e.lastMeleeDmgTime || now - e.lastMeleeDmgTime > 300) {
        addDamageNumber(e.x, e.y, Math.round(30 * 0.3));
        e.lastMeleeDmgTime = now;
      }

      if (u.hp <= 0) { addExplosion(u.x, u.y, 20); state.units.splice(j, 1); }
      if (e.hp <= 0) { addExplosion(e.x, e.y, 25); state.enemies.splice(i, 1); state.cost += cfg.killReward; break; }
    }
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _hitWall(p, pi) {
  for (const w of cfg.walls) {
    if (p.x + p.radius > w.x && p.x - p.radius < w.x + w.width &&
        p.y + p.radius > w.y && p.y - p.radius < w.y + w.height) {
      state.projectiles.splice(pi, 1);
      return true;
    }
  }
  return false;
}

function _hitSpawnPoint(p, pi) {
  for (let spi = SPAWN_POINTS.length - 1; spi >= 0; spi--) {
    const sp = SPAWN_POINTS[spi];
    if (Math.hypot(sp.x - p.x, sp.y - p.y) >= SPAWN_RADIUS + p.radius) continue;
    if (sp.owner === p.owner) continue;

    const bldgIdx = state.buildings.findIndex(b => b.spawnRef === sp);
    if (bldgIdx !== -1) {
      // Building absorbs the hit — spawn point is protected
      const bldg = state.buildings[bldgIdx];
      bldg.hp -= p.damage;
      addDamageNumber(bldg.x, bldg.y, p.damage);
      addExplosion(p.x, p.y, 12);
      state.projectiles.splice(pi, 1);
      if (bldg.hp <= 0) { addExplosion(bldg.x, bldg.y, 28); state.buildings.splice(bldgIdx, 1); }
    } else {
      sp.hp -= p.damage;
      addDamageNumber(sp.x, sp.y, p.damage);
      addExplosion(p.x, p.y, 15);
      state.projectiles.splice(pi, 1);
      if (sp.hp <= 0) {
        if (p.owner === 'player') session.spawnsCaptured++;
        sp.owner = p.owner;
        sp.hp    = sp.maxHp;
        const lostBldg = state.buildings.findIndex(b => b.spawnRef === sp);
        if (lostBldg !== -1) {
          addExplosion(state.buildings[lostBldg].x, state.buildings[lostBldg].y, 25);
          state.buildings.splice(lostBldg, 1);
        }
      }
    }
    return true;
  }
  return false;
}

function _hitEnemy(p, pi) {
  for (let ei = state.enemies.length - 1; ei >= 0; ei--) {
    const en = state.enemies[ei];
    if (Math.hypot(en.x - p.x, en.y - p.y) >= en.radius + p.radius) continue;

    const proto = cfg.enemyProtos[en.type];
    if (proto?.ability === 'dodge' && Math.random() < (proto.abilityValue ?? 0)) {
      addDamageNumber(en.x, en.y, 'MISS', '#88aaff');
      state.projectiles.splice(pi, 1);
      return true;
    }

    let dmg = p.damage;
    if (proto?.ability === 'armor') dmg = Math.max(1, Math.round(dmg * (1 - (proto.abilityValue ?? 0))));

    en.hp -= dmg;
    addDamageNumber(en.x, en.y, dmg);
    addExplosion(p.x, p.y, 12);
    state.projectiles.splice(pi, 1);

    if (p.ability === 'splash') _applySplashDamage(p, state.enemies, ei, cfg.enemyProtos, true);

    if (en.hp <= 0) {
      const idx = state.enemies.indexOf(en);
      if (idx !== -1) { state.enemies.splice(idx, 1); state.cost += cfg.killReward; addExplosion(en.x, en.y, 25); session.kills++; }
    }
    return true;
  }
  return false;
}

function _hitUnit(p, pi) {
  for (let ui = state.units.length - 1; ui >= 0; ui--) {
    const u = state.units[ui];
    if (Math.hypot(u.x - p.x, u.y - p.y) >= u.radius + p.radius) continue;

    const proto = cfg.protos[u.type];
    if (proto?.ability === 'dodge' && Math.random() < (proto.abilityValue ?? 0)) {
      addDamageNumber(u.x, u.y, 'MISS', '#88aaff');
      state.projectiles.splice(pi, 1);
      return true;
    }

    let dmg = p.damage;
    if (proto?.ability === 'armor') dmg = Math.max(1, Math.round(dmg * (1 - (proto.abilityValue ?? 0))));

    u.hp -= dmg;
    addDamageNumber(u.x, u.y, dmg);
    addExplosion(p.x, p.y, 12);
    state.projectiles.splice(pi, 1);

    if (p.ability === 'splash') _applySplashDamage(p, state.units, ui, cfg.protos, false);

    if (u.hp <= 0) {
      const idx = state.units.indexOf(u);
      if (idx !== -1) { state.units.splice(idx, 1); addExplosion(u.x, u.y, 20); }
    }
    return true;
  }
  return false;
}

function _applySplashDamage(p, list, skipIdx, protoMap, awardKillReward) {
  for (let si = list.length - 1; si >= 0; si--) {
    if (si === skipIdx) continue;
    const st = list[si];
    if (Math.hypot(st.x - p.x, st.y - p.y) >= (p.abilityValue ?? 0)) continue;

    const proto = protoMap[st.type];
    let sDmg = Math.max(1, Math.round(p.damage * 0.5));
    if (proto?.ability === 'armor') sDmg = Math.max(1, Math.round(sDmg * (1 - (proto.abilityValue ?? 0))));

    st.hp -= sDmg;
    addDamageNumber(st.x, st.y, sDmg);
    addExplosion(st.x, st.y, 10);
    if (st.hp <= 0) {
      list.splice(si, 1);
      addExplosion(st.x, st.y, awardKillReward ? 20 : 18);
      if (awardKillReward) state.cost += cfg.killReward;
    }
  }
}
