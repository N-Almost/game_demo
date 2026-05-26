import { state, SPAWN_POINTS }                                    from './state.js';
import { cfg, loadAllConfigs, loadCurrentWave, applyWaveScaling } from './config.js';
import { buildUnitButtons, buildBuildingButtons, renderHUD }      from './ui.js';
import { bindUnitButtons, bindBuildingButtons, setupCanvasInput, bindCommandButtons, selectedUnitType, selectedBuildingType } from './input.js';
import { updateUnits, spawnUnit, tickSpawnCooldowns }               from './units.js';
import { updateEnemies, spawnEnemies }                             from './enemies.js';
import { updateProjectiles, updateMeleeCombat, updateTurrets }      from './combat.js';

const canvas    = document.getElementById('gameCanvas');
const loadingEl = document.getElementById('loading-screen');

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

  _updateIncome(dt);
  tickSpawnCooldowns(dt);
  spawnEnemies(dt);
  updateUnits(dt);
  updateEnemies(dt);
  updateTurrets(dt);
  updateProjectiles(dt);
  updateMeleeCombat(dt);
  _tickEffects(dt);
}

function render() {
  if (window.Renderer) {
    window.Renderer.render(state, selectedUnitType || selectedBuildingType, SPAWN_POINTS, performance.now());
  }
  renderHUD(cfg.currentWave);
}

// ── Update sub-systems ────────────────────────────────────────────────────────

function _checkWinConditions(dt) {
  if (!SPAWN_POINTS.some(p => p.owner === 'player')) { state.gameOver = true; state.winner = 'enemy';  return; }
  if (!SPAWN_POINTS.some(p => p.owner === 'enemy'))  { state.gameOver = true; state.winner = 'player'; return; }

  state.timeLeft -= dt;
  if (state.timeLeft > 0) return;

  const pHp = SPAWN_POINTS.filter(p => p.owner === 'player').reduce((s, p) => s + p.hp, 0);
  const eHp = SPAWN_POINTS.filter(p => p.owner === 'enemy').reduce((s, p) => s + p.hp, 0);

  if (pHp !== eHp) {
    state.timeLeft  = 0;
    state.gameOver  = true;
    state.timeUpWin = true;
    state.winner    = pHp > eHp ? 'player' : 'enemy';
  } else if (!state.suddenDeath) {
    state.timeLeft    = cfg.suddenDeathDuration;
    state.suddenDeath = true;
  } else {
    state.timeLeft  = 0;
    state.gameOver  = true;
    state.timeUpWin = true;
    state.winner    = 'draw';
  }
}

function _updateIncome(dt) {
  state.incomeTimer += dt;
  if (state.incomeTimer < 1) return;
  state.incomeTimer -= 1;
  const baseIncome = SPAWN_POINTS.filter(p => p.owner === 'player').length;
  const farmBonus  = state.buildings.filter(b => b.owner === 'player' && b.effect === 'income').reduce((s, b) => s + b.effectValue, 0);
  state.cost += baseIncome + farmBonus;
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

    state.cost     = cfg.startCost;
    state.timeLeft = cfg.matchDuration;

    loadCurrentWave();
    applyWaveScaling();

    const waveLabelEl = document.getElementById('wave-label');
    if (waveLabelEl) waveLabelEl.textContent = `WAVE ${cfg.currentWave}`;

    // renderer.js is a separate module script — wait up to 3 s for it to assign window.Renderer
    await new Promise(resolve => {
      if (window.Renderer) { resolve(); return; }
      window.addEventListener('renderer-ready', resolve, { once: true });
      setTimeout(resolve, 3000);
    });

    if (window.Renderer) {
      await window.Renderer.init(canvas, SPAWN_POINTS, unitList, cfg.walls, enemyUnitList);
    }
  } catch (err) {
    console.error('[Init] failed:', err);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
    requestAnimationFrame(loop);
  }
})();

// Expose for browser console debugging
window._spawnUnit = spawnUnit;
