import { state, session, SPAWN_POINTS }                            from './state.js';
import { recordMatchEnd, addGold, goldRewardForWave }             from './profile.js';
import { cfg, loadAllConfigs, loadCurrentWave, applyWaveScaling } from './config.js';
import { buildUnitButtons, buildBuildingButtons, renderHUD }      from './ui.js';
import { bindUnitButtons, bindBuildingButtons, setupCanvasInput, bindCommandButtons, selectedUnitType, selectedBuildingType, setPvpSend } from './input.js';
import { updateUnits, spawnUnit, tickSpawnCooldowns }               from './units.js';
import { updateEnemies, spawnEnemies, spawnEnemyUnit, tickEnemySpawnCooldowns, getEnemyCooldownRemaining, setEnemyCooldowns } from './enemies.js';
import { updateProjectiles, updateMeleeCombat, updateTurrets }      from './combat.js';

const canvas    = document.getElementById('gameCanvas');
const loadingEl = document.getElementById('loading-screen');

// PvP flags — read from localStorage (set by pvp-lobby after connection)
const PVP_MODE = localStorage.getItem('pvp_mode') === '1';
let PVP_ROLE = localStorage.getItem('pvp_role'); // 'host' | 'guest' | null — updated after lobby

let _pvpNet = null; // network module reference (set during PvP init)

// ── Game loop ─────────────────────────────────────────────────────────────────

let last = performance.now();
function loop(ts) {
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;
  try {
    update(dt);
    render();
  } catch (e) {
    console.error('[loop]', e);
  }
  requestAnimationFrame(loop);
}

function update(dt) {
  if (!state.gameOver) _checkWinConditions(dt);
  if (state.gameOver) return;

  // Guest: simulation runs on host; guest only renders received state
  if (PVP_MODE && PVP_ROLE === 'guest') {
    _tickEffects(dt);
    return;
  }

  _updateIncome(dt);
  tickSpawnCooldowns(dt);
  if (PVP_MODE) tickEnemySpawnCooldowns(dt);
  if (!PVP_MODE) spawnEnemies(dt);   // AI spawn — disabled in PvP
  updateUnits(dt);
  updateEnemies(dt);
  updateTurrets(dt);
  updateProjectiles(dt);
  updateMeleeCombat(dt);
  _tickEffects(dt);

  // Host: broadcast state snapshot to guest every frame
  if (PVP_MODE && PVP_ROLE === 'host' && _pvpNet?.isOpen()) {
    _pvpNet.send(_buildSnapshot());
  }
}

function render() {
  if (window.Renderer) {
    window.Renderer.render(state, selectedUnitType || selectedBuildingType, SPAWN_POINTS, performance.now(), PVP_ROLE === 'guest');
  }
  renderHUD(cfg.currentWave);
}

// ── Win conditions ────────────────────────────────────────────────────────────

function _checkWinConditions(dt) {
  if (!SPAWN_POINTS.some(p => p.owner === 'player')) { _setGameOver('enemy');  return; }
  if (!SPAWN_POINTS.some(p => p.owner === 'enemy'))  { _setGameOver('player'); return; }

  state.timeLeft -= dt;
  if (state.timeLeft > 0) return;

  const pHp = SPAWN_POINTS.filter(p => p.owner === 'player').reduce((s, p) => s + p.hp, 0);
  const eHp = SPAWN_POINTS.filter(p => p.owner === 'enemy').reduce((s, p) => s + p.hp, 0);

  if (pHp !== eHp) {
    state.timeLeft  = 0;
    state.timeUpWin = true;
    _setGameOver(pHp > eHp ? 'player' : 'enemy');
  } else if (!state.suddenDeath) {
    state.timeLeft    = cfg.suddenDeathDuration;
    state.suddenDeath = true;
  } else {
    state.timeLeft  = 0;
    state.timeUpWin = true;
    _setGameOver('draw');
  }
}

function _setGameOver(winner) {
  if (state.gameOver) return;
  state.gameOver      = true;
  state.winner        = winner;
  session.durationSec = (performance.now() - session.startTimestamp) / 1000;

  if (!PVP_MODE) {
    session.won = winner === 'player';
    if (session.won) {
      session.goldEarned = goldRewardForWave(cfg.currentWave);
      addGold(session.goldEarned);
      localStorage.setItem('rts_wave', cfg.currentWave + 1);
    }
    recordMatchEnd(session, cfg.currentWave);
  }
}

// ── Income ────────────────────────────────────────────────────────────────────

function _updateIncome(dt) {
  state.incomeTimer += dt;
  if (state.incomeTimer < 1) return;
  state.incomeTimer -= 1;

  const baseIncome = SPAWN_POINTS.filter(p => p.owner === 'player').length;
  const farmBonus  = state.buildings.filter(b => b.owner === 'player' && b.effect === 'income').reduce((s, b) => s + b.effectValue, 0);
  state.cost += baseIncome + farmBonus;

  if (PVP_MODE) {
    const eBase  = SPAWN_POINTS.filter(p => p.owner === 'enemy').length;
    const eFarm  = state.buildings.filter(b => b.owner === 'enemy' && b.effect === 'income').reduce((s, b) => s + b.effectValue, 0);
    state.enemyCost += eBase + eFarm;
  }
}

function _tickEffects(dt) {
  for (let i = state.damageNumbers.length - 1; i >= 0; i--) {
    const d = state.damageNumbers[i];
    d.y    -= 60 * dt;
    d.alpha -= dt / 1.2;
    if (d.alpha <= 0) state.damageNumbers.splice(i, 1);
  }
  for (let i = state.explosions.length - 1; i >= 0; i--) {
    const e = state.explosions[i];
    e.size  += 50 * dt;
    e.alpha -= dt * 1.25;
    if (e.alpha <= 0) state.explosions.splice(i, 1);
  }
}

// ── PvP: host → guest state snapshot ─────────────────────────────────────────

function _buildSnapshot() {
  return {
    t:   state.timeLeft,
    pc:  state.cost,
    ec:  state.enemyCost,
    u:   state.units.map(u    => [u.id, u.x|0, u.y|0, u.hp|0, u.type]),
    e:   state.enemies.map(e  => [e.id, e.x|0, e.y|0, e.hp|0, e.type]),
    s:   SPAWN_POINTS.map(p   => [p.hp|0, p.owner === 'player' ? 1 : p.owner === 'enemy' ? 2 : 0]),
    b:   state.buildings.map(b => [b.type, SPAWN_POINTS.indexOf(b.spawnRef), b.hp|0, b.owner === 'enemy' ? 2 : 1]),
    g:   state.gameOver  ? 1  : 0,
    w:   state.winner    ?? '',
    sd:  state.suddenDeath  ? 1 : 0,
    tuw: state.timeUpWin    ? 1 : 0,
    proj: state.projectiles.map(p  => [p.x|0, p.y|0, p.vx|0, p.vy|0, p.owner === 'enemy' ? 1 : 0]),
    expl: state.explosions.map(ex  => [ex.x|0, ex.y|0, ex.size|0, Math.round(ex.alpha * 255)]),
    dmg:  state.damageNumbers.map(d => [d.x|0, d.y|0, d.damage|0, Math.round(d.alpha * 255), d.color ?? '']),
    cd:   Object.fromEntries(Object.keys(cfg.protos).map(t => [t, getEnemyCooldownRemaining(t)]).filter(([, r]) => r > 0)),
    ed:  state.enemyDefendMode ? 1 : 0,
    er:  state.enemyRallyPoint ? SPAWN_POINTS.indexOf(state.enemyRallyPoint) : -1,
  };
}

// ── PvP: guest applies host's snapshot ───────────────────────────────────────

function _applySnapshot(snap) {
  state.timeLeft    = snap.t;
  state.cost        = snap.pc;
  state.enemyCost   = snap.ec;
  state.gameOver    = !!snap.g;
  state.winner      = snap.w  || null;
  state.suddenDeath = !!snap.sd;
  state.timeUpWin   = !!snap.tuw;

  _reconcile(state.units,   snap.u, cfg.protos);
  _reconcile(state.enemies, snap.e, cfg.enemyProtos);

  if (snap.proj) {
    state.projectiles = snap.proj.map(([x, y, vx, vy, isEnemy]) => ({
      x, y, vx, vy, radius: 4, owner: isEnemy ? 'enemy' : 'player',
      damage: 0, ability: null, abilityValue: 0,
    }));
  }
  if (snap.expl) {
    state.explosions = snap.expl.map(([x, y, size, alphaInt]) => ({
      x, y, size, alpha: alphaInt / 255,
    }));
  }
  if (snap.dmg) {
    state.damageNumbers = snap.dmg.map(([x, y, damage, alphaInt, color]) => ({
      x, y, damage, alpha: alphaInt / 255, color: color || undefined,
    }));
  }
  if (snap.cd) setEnemyCooldowns(snap.cd);
  state.enemyDefendMode = !!snap.ed;
  state.enemyRallyPoint = (snap.er != null && snap.er >= 0) ? SPAWN_POINTS[snap.er] : null;

  snap.s.forEach((data, i) => {
    SPAWN_POINTS[i].hp    = data[0];
    SPAWN_POINTS[i].owner = data[1] === 1 ? 'player' : data[1] === 2 ? 'enemy' : 'neutral';
  });

  // Reconcile buildings by spawn index
  const liveByIdx = new Map(state.buildings.map(b => [SPAWN_POINTS.indexOf(b.spawnRef), b]));
  const snapIdxs  = new Set(snap.b.map(d => d[1]));
  state.buildings = state.buildings.filter(b => snapIdxs.has(SPAWN_POINTS.indexOf(b.spawnRef)));
  for (const [bType, si, bHp, bOwner] of snap.b) {
    const sp = SPAWN_POINTS[si];
    if (!sp) continue;
    const existing = liveByIdx.get(si);
    if (existing) {
      existing.hp = bHp;
    } else {
      const proto = cfg.buildingProtos[bType] ?? {};
      state.buildings.push({
        type: bType, x: sp.x, y: sp.y,
        hp: bHp, maxHp: proto.maxHp ?? bHp,
        owner: bOwner === 2 ? 'enemy' : 'player', spawnRef: sp,
        color: proto.color ?? '#d4af37', radius: proto.radius ?? 12,
        effect: proto.effect, effectValue: proto.effectValue ?? 0,
        range: proto.range, damage: proto.damage,
        attackRate: proto.attackRate, projectileSpeed: proto.projectileSpeed,
        attackTimer: 0,
      });
    }
  }
}

function _reconcile(liveArr, snapData, protos) {
  const byId = new Map(snapData.map(d => [d[0], d]));
  for (let i = liveArr.length - 1; i >= 0; i--) {
    if (!byId.has(liveArr[i].id)) liveArr.splice(i, 1);
  }
  for (const [id, data] of byId) {
    const ex = liveArr.find(u => u.id === id);
    if (ex) {
      ex.x = data[1]; ex.y = data[2]; ex.hp = data[3];
    } else {
      const proto = protos[data[4]] ?? Object.values(protos)[0] ?? {};
      liveArr.push({
        id, type: data[4], x: data[1], y: data[2],
        hp: data[3], maxHp: proto.maxHp ?? data[3],
        radius: proto.radius ?? 10, color: proto.color ?? '#fff',
        speed: proto.speed ?? 60, range: proto.range ?? 140,
        attackRate: proto.attackRate ?? 1, projectileSpeed: proto.projectileSpeed ?? 320,
        damage: proto.damage ?? 20, ability: proto.ability, abilityValue: proto.abilityValue ?? 0,
        attackTimer: 0, vx: 0, vy: 0, target: null,
      });
    }
  }
}

// ── PvP: host handles guest commands ─────────────────────────────────────────

function _handleEnemyCmd(msg) {
  switch (msg.t) {
    case 'sp': { // spawn enemy unit
      const sp = msg.si != null ? SPAWN_POINTS[msg.si] : null;
      if (sp) spawnEnemyUnit(msg.u, sp.x, sp.y);
      break;
    }
    case 'bl': { // place building on enemy spawn
      const sp = SPAWN_POINTS[msg.si];
      if (!sp || sp.owner !== 'enemy') break;
      const proto = cfg.buildingProtos[msg.bt];
      if (!proto || state.enemyCost < proto.cost) break;
      if (state.buildings.some(b => b.spawnRef === sp)) break;
      state.enemyCost -= proto.cost;
      state.buildings.push({
        type: msg.bt, x: sp.x, y: sp.y,
        hp: proto.maxHp, maxHp: proto.maxHp,
        owner: 'enemy', spawnRef: sp,
        color: proto.color, radius: proto.radius ?? 12,
        effect: proto.effect, effectValue: proto.effectValue ?? 0,
        range: proto.range, damage: proto.damage,
        attackRate: proto.attackRate, projectileSpeed: proto.projectileSpeed,
        attackTimer: 0,
      });
      break;
    }
    case 'ra':
      state.enemyRallyPoint = msg.si != null ? SPAWN_POINTS[msg.si] : null;
      break;
    case 'df':
      state.enemyDefendMode = !!msg.v;
      if (state.enemyDefendMode) state.enemyRallyPoint = null;
      break;
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

(async () => {
  try {
    const { unitList, enemyUnitList, buildingList } = await loadAllConfigs();

    buildUnitButtons(unitList);
    buildBuildingButtons(buildingList);
    bindUnitButtons();
    bindBuildingButtons();
    bindCommandButtons();
    setupCanvasInput(canvas);

    // PvP: show lobby overlay and wait for WebRTC connection
    if (PVP_MODE) {
      const { showLobby } = await import('./pvp-lobby.js');
      const role = await showLobby();
      localStorage.setItem('pvp_role', role);
      PVP_ROLE = role;

      _pvpNet = await import('./network.js');

      if (role === 'host') {
        _pvpNet.on.data         = _handleEnemyCmd;
        _pvpNet.on.disconnected = () => { state.gameOver = true; state.winner = 'disconnect'; };
      } else {
        // Guest: receive state from host, send commands
        _pvpNet.on.data         = _applySnapshot;
        _pvpNet.on.disconnected = () => { state.gameOver = true; state.winner = 'disconnect'; };
        setPvpSend(_pvpNet.send);
      }
    }

    state.cost      = cfg.startCost;
    state.enemyCost = cfg.startCost;
    state.timeLeft  = cfg.matchDuration;
    session.startTimestamp = performance.now();

    if (!PVP_MODE) {
      loadCurrentWave();
      applyWaveScaling();
    }

    const waveLabelEl = document.getElementById('wave-label');
    if (waveLabelEl) {
      waveLabelEl.textContent = PVP_MODE ? 'PVP' : `WAVE ${cfg.currentWave}`;
    }

    await new Promise(resolve => {
      if (window.Renderer) { resolve(); return; }
      window.addEventListener('renderer-ready', resolve, { once: true });
      setTimeout(resolve, 3000);
    });

    if (window.Renderer) {
      await window.Renderer.init(canvas, SPAWN_POINTS, unitList, cfg.walls, enemyUnitList, buildingList);
    }
  } catch (err) {
    console.error('[Init] failed:', err);
  } finally {
    if (loadingEl) {
      loadingEl.style.opacity = '0';
      setTimeout(() => { loadingEl.style.display = 'none'; }, 420);
    }
    requestAnimationFrame(loop);
  }
})();

window._spawnUnit = spawnUnit;
