(() => {
  const canvas = document.getElementById('gameCanvas');
  const costEl        = document.getElementById('cost-display');
  const unitCountEl   = document.getElementById('unit-count');
  const unitMonitorEl  = document.getElementById('unit-monitor');
  const hpGaugePFillEl = document.getElementById('hp-gauge-fill-p');
  const hpGaugeNFillEl = document.getElementById('hp-gauge-fill-n');
  const hpGaugeEFillEl = document.getElementById('hp-gauge-fill-e');
  const hpGaugePEl     = document.getElementById('hp-gauge-p');
  const hpGaugeEEl     = document.getElementById('hp-gauge-e');
  const hintEl       = document.getElementById('hint-text');
  const timerEl      = document.getElementById('timer');
  const timerLabelEl = document.getElementById('timer-label');
  const timerBlockEl = document.getElementById('timer-block');
  const overlayEl    = document.getElementById('gameover-overlay');
  const overlayBody  = document.getElementById('gameover-body');

  const BOUNDARY = { x: 120, y: 20, width: 720, height: 600 };
  let WALLS = [];
  const SPAWN_POINTS = [
    { x: 180, y: 560, owner: 'player',  hp: 100, maxHp: 100 },  // bottom-left
    { x: 180, y: 320, owner: 'player',  hp: 100, maxHp: 100 },  // left-middle
    { x: 480, y: 560, owner: 'player',  hp: 100, maxHp: 100 },  // bottom-center
    { x: 780, y: 80,  owner: 'enemy',   hp: 100, maxHp: 100 },  // top-right
    { x: 780, y: 320, owner: 'enemy',   hp: 100, maxHp: 100 },  // right-middle
    { x: 480, y: 80,  owner: 'enemy',   hp: 100, maxHp: 100 },  // top-center
    { x: 180, y: 80,  owner: 'neutral', hp: 100, maxHp: 100 },  // top-left
    { x: 780, y: 560, owner: 'neutral', hp: 100, maxHp: 100 },  // bottom-right
    { x: 360, y: 220, owner: 'neutral', hp: 100, maxHp: 100 },  // center upper-left
    { x: 600, y: 220, owner: 'neutral', hp: 100, maxHp: 100 },  // center upper-right
    { x: 360, y: 420, owner: 'neutral', hp: 100, maxHp: 100 },  // center lower-left
    { x: 600, y: 420, owner: 'neutral', hp: 100, maxHp: 100 },  // center lower-right
  ];
  const SPAWN_RADIUS = 18;

  let MATCH_DURATION        = 180;
  let SUDDEN_DEATH_DURATION = 30;
  let START_COST            = 10;

  let KILL_REWARD                = 2;
  let ENEMY_MAX_UNITS            = 5;
  let ENEMY_SPAWN_INTERVALS      = [2.0, 1.5, 1.2];
  let ENEMY_MAX_UNITS_BASE       = 5;
  let ENEMY_SPAWN_INTERVALS_BASE = [2.0, 1.5, 1.2];
  let WAVE_SCALING               = {};
  let ENEMY_HP_MULT              = 1;
  let ENEMY_DMG_MULT             = 1;
  let ENEMY_SPD_MULT             = 1;
  let currentWave                = 1;

  let BUILDING_PROTOS = {};

  const state = {
    units: [],
    enemies: [],
    projectiles: [],
    buildings: [],
    cost: START_COST,
    nextId: 1,
    gameOver: false,
    winner: null,
    timeLeft: MATCH_DURATION,
    timeUpWin: false,
    suddenDeath: false,
    damageNumbers: [],
    explosions: [],
    incomeTimer:    0,
    enemySpawnTimer: 0,
  };

  // Populated from units.json / enemy_units.json at startup
  let PROTOS       = {};
  let ENEMY_PROTOS = {};
  let MAX_UNITS    = 5;

  async function loadGameConfig() {
    const cfg = await fetch('config.json').then(r => r.json());
    START_COST            = cfg.startCost           ?? 10;
    MATCH_DURATION        = cfg.matchDuration       ?? 180;
    SUDDEN_DEATH_DURATION = cfg.suddenDeathDuration ?? 30;
  }

  async function loadEnemyConfig() {
    const cfg = await fetch('enemy_config.json').then(r => r.json());
    KILL_REWARD                = cfg.killReward      ?? 2;
    ENEMY_MAX_UNITS_BASE       = cfg.maxUnits        ?? 5;
    ENEMY_SPAWN_INTERVALS_BASE = cfg.spawnIntervals  ?? [2.0, 1.5, 1.2];
    WAVE_SCALING               = cfg.waveScaling     ?? {};
  }

  function loadCurrentWave() {
    currentWave = Math.max(1, parseInt(localStorage.getItem('rts_wave') || '1', 10));
  }

  function applyWaveScaling() {
    const w = currentWave - 1;
    const s = WAVE_SCALING;
    ENEMY_MAX_UNITS       = ENEMY_MAX_UNITS_BASE + Math.floor(w * (s.maxUnitsPerWave ?? 0));
    const minI            = s.minSpawnInterval ?? 0.5;
    ENEMY_SPAWN_INTERVALS = ENEMY_SPAWN_INTERVALS_BASE.map(v => Math.max(minI, v - w * (s.spawnIntervalReduction ?? 0)));
    ENEMY_HP_MULT         = 1 + w * (s.hpPerWave    ?? 0);
    ENEMY_DMG_MULT        = 1 + w * (s.damagePerWave ?? 0);
    ENEMY_SPD_MULT        = 1 + w * (s.speedPerWave  ?? 0);
  }

  async function loadWallConfig() {
    const data = await fetch('walls.json').then(r => r.json());
    WALLS = data.walls ?? [];
  }

  async function loadBuildingConfig() {
    const data = await fetch('buildings.json').then(r => r.json());
    BUILDING_PROTOS = Object.fromEntries(data.buildings.map(b => [b.id, b]));
    buildBuildingButtons(data.buildings);
  }

  async function loadUnitConfig() {
    const data = await fetch('units.json').then(r => r.json());
    MAX_UNITS = data.maxUnits ?? 5;
    PROTOS    = {};
    for (const u of data.units) {
      PROTOS[u.id] = {
        name: u.name, radius: u.radius, color: u.color, enemyColor: u.enemyColor,
        speed: u.speed, range: u.range, attackRate: u.attackRate,
        projectileSpeed: u.projectileSpeed, damage: u.damage,
        cost: u.cost, maxHp: u.maxHp,
        ability: u.ability ?? null, abilityValue: u.abilityValue ?? 0,
      };
    }
    buildUnitButtons(data.units);
    return data.units;
  }

  async function loadEnemyUnitConfig() {
    const data = await fetch('enemy_units.json').then(r => r.json());
    ENEMY_PROTOS = {};
    for (const u of data.units) {
      ENEMY_PROTOS[u.id] = {
        radius: u.radius, color: u.color,
        speed: u.speed, range: u.range, attackRate: u.attackRate,
        projectileSpeed: u.projectileSpeed, damage: u.damage,
        maxHp: u.maxHp,
        ability: u.ability ?? null, abilityValue: u.abilityValue ?? 0,
      };
    }
    return data.units;
  }

  const ABILITY_ICONS = {
    armor:  `<svg viewBox="0 0 24 28" fill="none"><path d="M12 2L22 6V14C22 20.5 17.2 25 12 27C6.8 25 2 20.5 2 14V6Z" fill="rgba(255,255,255,0.92)"/><path d="M8 14l3 3 5-6" stroke="rgba(0,0,0,0.35)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    splash: `<svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="5" fill="rgba(255,255,255,0.92)"/><path d="M14 2V6M14 22V26M2 14H6M22 14H26M5.5 5.5L8.3 8.3M19.7 19.7L22.5 22.5M22.5 5.5L19.7 8.3M8.3 19.7L5.5 22.5" stroke="rgba(255,255,255,0.82)" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    dodge:  `<svg viewBox="0 0 22 30" fill="none"><path d="M14 1L3 16H10L8 29L19 13H12Z" fill="rgba(255,255,255,0.92)"/></svg>`,
  };

  function buildUnitButtons(unitDefs) {
    const container = document.getElementById('unit-buttons');
    if (!container) return;
    container.innerHTML = '';
    for (const u of unitDefs) {
      const btn = document.createElement('button');
      btn.className    = 'unit-btn';
      btn.dataset.type = u.id;
      btn.style.setProperty('--clr', u.color);
      const icon         = ABILITY_ICONS[u.ability] ?? `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" fill="rgba(255,255,255,0.7)"/></svg>`;
      const abilityLabel = { armor: 'ARMOR', splash: 'SPLASH', dodge: 'DODGE' }[u.ability] ?? '';
      const r = parseInt(u.color.slice(1,3),16), g = parseInt(u.color.slice(3,5),16), b = parseInt(u.color.slice(5,7),16);
      const gradient   = `linear-gradient(180deg,rgba(${r},${g},${b},0.4) 0%,rgba(${r},${g},${b},0.16) 55%,rgba(0,0,0,0.5) 100%)`;
      const portraitImg = u.portrait
        ? `<img class="unit-btn-img" src="${u.portrait}" alt="" onerror="this.style.display='none'">`
        : '';
      btn.innerHTML =
        `<div class="unit-btn-portrait" style="background:${gradient}">${portraitImg}</div>` +
        `<div class="unit-btn-icon">${icon}</div>` +
        `<div class="unit-btn-info">` +
          `<div class="unit-btn-name">${u.name}</div>` +
          `<div class="unit-btn-meta"><span class="unit-btn-ability">${abilityLabel}</span><span class="unit-btn-cost">${u.cost}<small>cost</small></span></div>` +
        `</div>`;
      container.appendChild(btn);
    }
    bindUnitButtons();
  }

  function buildBuildingButtons(buildingDefs) {
    const container = document.getElementById('building-buttons');
    if (!container) return;
    container.innerHTML = '';
    for (const b of buildingDefs) {
      const btn = document.createElement('button');
      btn.className    = 'building-btn';
      btn.dataset.type = b.id;
      btn.innerHTML    = `${b.name}<br><small>${b.cost} cost · ${b.description}</small>`;
      container.appendChild(btn);
    }
    bindBuildingButtons();
  }

  // ── Touch controls ────────────────────────────────────────────────────────

  let selectedUnitType     = null;
  let selectedBuildingType = null;

  function bindUnitButtons() {
    document.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type  = btn.dataset.type;
        const proto = PROTOS[type];
        if (!proto) return;
        // Deselect buildings
        selectedBuildingType = null;
        document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('selected'));
        if (selectedUnitType === type) {
          selectedUnitType = null;
          document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
          if (hintEl) hintEl.textContent = 'เลือกยูนิต แล้วแตะจุดเขียว';
        } else {
          document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          selectedUnitType = type;
          if (hintEl) hintEl.textContent = `${proto.name} (cost ${proto.cost}) — แตะจุดเขียวเพื่อวาง`;
        }
      });
    });
  }

  function bindBuildingButtons() {
    document.querySelectorAll('.building-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type  = btn.dataset.type;
        const proto = BUILDING_PROTOS[type];
        if (!proto) return;
        // Deselect units
        selectedUnitType = null;
        document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
        if (selectedBuildingType === type) {
          selectedBuildingType = null;
          document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('selected'));
          if (hintEl) hintEl.textContent = 'เลือกยูนิต แล้วแตะจุดเขียว';
        } else {
          document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          selectedBuildingType = type;
          if (hintEl) hintEl.textContent = `${proto.name} (cost ${proto.cost}) — แตะ spawn ของฝ่ายเราเพื่อสร้าง`;
        }
      });
    });
  }

  function getEffectiveMaxUnits() {
    return MAX_UNITS + state.buildings
      .filter(b => b.owner === 'player' && b.effect === 'maxUnits')
      .reduce((sum, b) => sum + b.effectValue, 0);
  }

  function placeBuilding(type, sp) {
    const proto = BUILDING_PROTOS[type];
    if (!proto) return false;
    if (state.cost < proto.cost) { if (hintEl) hintEl.textContent = 'cost ไม่พอ'; return false; }
    if (state.buildings.some(b => b.spawnRef === sp)) { if (hintEl) hintEl.textContent = 'Spawn นี้มีสิ่งปลูกสร้างแล้ว'; return false; }
    state.cost -= proto.cost;
    state.buildings.push({
      type, x: sp.x, y: sp.y,
      hp: proto.maxHp, maxHp: proto.maxHp,
      owner: 'player', spawnRef: sp,
      color: proto.color, radius: proto.radius ?? 12,
      effect: proto.effect, effectValue: proto.effectValue,
    });
    return true;
  }

  function handleCanvasTap(clientX, clientY) {
    if (state.gameOver) {
      const next = state.winner === 'player' ? currentWave + 1 : 1;
      localStorage.setItem('rts_wave', next);
      location.reload();
      return;
    }
    if (!selectedUnitType && !selectedBuildingType) return;

    const pt = window.Renderer ? window.Renderer.getGroundIntersect(clientX, clientY) : null;
    if (!pt) return;
    const { x, y } = pt;

    let nearest = null, nearestDist = Infinity;
    for (const p of SPAWN_POINTS) {
      if (p.owner !== 'player') continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < nearestDist) { nearest = p; nearestDist = d; }
    }
    if (!nearest || nearestDist >= SPAWN_RADIUS + 60) return;

    if (selectedBuildingType) {
      if (placeBuilding(selectedBuildingType, nearest)) {
        if (navigator.vibrate) navigator.vibrate(30);
      }
    } else if (selectedUnitType) {
      if (spawnUnit(selectedUnitType, nearest.x, nearest.y)) {
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }
  }

  canvas.addEventListener('click',      e => handleCanvasTap(e.clientX, e.clientY));
  canvas.addEventListener('touchend',   e => { e.preventDefault(); handleCanvasTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });

  // ── Game helpers ──────────────────────────────────────────────────────────

  function lineIntersectsRect(ax, ay, bx, by, rx, ry, rw, rh) {
    const dx = bx - ax, dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - rx, rx + rw - ax, ay - ry, ry + rh - ay];
    let tmin = 0, tmax = 1;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; }
      else { const t = q[i] / p[i]; if (p[i] < 0) tmin = Math.max(tmin, t); else tmax = Math.min(tmax, t); }
    }
    return tmin <= tmax;
  }

  function hasLOS(ax, ay, bx, by) {
    const PAD = 5;
    for (const w of WALLS) {
      if (lineIntersectsRect(ax, ay, bx, by, w.x - PAD, w.y - PAD, w.width + PAD * 2, w.height + PAD * 2)) return false;
    }
    return true;
  }

  function randomTarget() {
    return {
      x: BOUNDARY.x + Math.random() * BOUNDARY.width,
      y: BOUNDARY.y + Math.random() * BOUNDARY.height
    };
  }

  function findNearestSpawnPoint(x, y, owner) {
    const points = SPAWN_POINTS.filter(p => p.owner !== owner);
    if (!points.length) return null;
    return points.reduce((best, p) =>
      Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best
    , points[0]);
  }

  function findNearestEnemyUnit(x, y, owner) {
    const list = owner === 'player' ? state.enemies : state.units;
    if (!list.length) return null;
    return list.reduce((best, unit) =>
      Math.hypot(unit.x - x, unit.y - y) < Math.hypot(best.x - x, best.y - y) ? unit : best
    , list[0]);
  }

  function spawnUnit(type, x, y) {
    const proto = PROTOS[type] || PROTOS[Object.keys(PROTOS)[0]];
    if (!proto) return false;
    if (state.units.length >= getEffectiveMaxUnits()) return false;
    if (state.cost < proto.cost) return false;
    state.cost -= proto.cost;
    state.units.push({
      id: state.nextId++,
      type, x, y,
      vx: 0, vy: 0,
      radius: proto.radius,
      color: proto.color,
      speed: proto.speed,
      range: proto.range,
      attackRate: proto.attackRate,
      projectileSpeed: proto.projectileSpeed,
      damage: proto.damage,
      ability: proto.ability, abilityValue: proto.abilityValue ?? 0,
      attackTimer: 0,
      hp: proto.maxHp,
      maxHp: proto.maxHp,
      target: randomTarget()
    });
    return true;
  }

  function addDamageNumber(x, y, damage, color) {
    state.damageNumbers.push({ x, y, damage, color, alpha: 1.0 });
  }

  function addExplosion(x, y, size = 20) {
    state.explosions.push({ x, y, size, alpha: 1 });
  }

  // When a unit hits a wall, steer along the wall surface toward the goal
  // rather than picking a random target that likely passes through the same wall.
  function steerAroundWall(unit, wallNx, wallNy) {
    const t1x = -wallNy, t1y =  wallNx;  // tangent A (perpendicular to normal)
    const t2x =  wallNy, t2y = -wallNx;  // tangent B (opposite direction)
    const gx = unit.target ? unit.target.x - unit.x : 0;
    const gy = unit.target ? unit.target.y - unit.y : 0;
    const useT1 = (t1x * gx + t1y * gy) >= (t2x * gx + t2y * gy);
    const sx = useT1 ? t1x : t2x;
    const sy = useT1 ? t1y : t2y;
    unit.target = {
      x: Math.max(BOUNDARY.x + unit.radius, Math.min(BOUNDARY.x + BOUNDARY.width  - unit.radius, unit.x + sx * 120)),
      y: Math.max(BOUNDARY.y + unit.radius, Math.min(BOUNDARY.y + BOUNDARY.height - unit.radius, unit.y + sy * 120))
    };
  }



  // ── Game loop ─────────────────────────────────────────────────────────────

  let last = performance.now();
  function loop(ts) {
    const dt = Math.min((ts - last) / 1000, 0.05);
    update(dt);
    render();
    last = ts;
    requestAnimationFrame(loop);
  }

  // Init Three.js renderer then start loop.
  // renderer.js is a module script — poll briefly in case it hasn't assigned
  // window.Renderer yet when this defer script fires.
  const loadingEl = document.getElementById('loading-screen');
  ;(async () => {
    try {
      await loadGameConfig();
      state.cost     = START_COST;
      state.timeLeft = MATCH_DURATION;

      // Load all configs in parallel
      const [unitList, enemyUnitList] = await Promise.all([
        loadUnitConfig(),
        loadEnemyUnitConfig(),
        loadBuildingConfig(),
        loadWallConfig(),
        loadEnemyConfig(),
      ]);

      loadCurrentWave();
      applyWaveScaling();
      const waveLabelEl = document.getElementById('wave-label');
      if (waveLabelEl) waveLabelEl.textContent = `WAVE ${currentWave}`;

      let waited = 0;
      while (!window.Renderer && waited < 3000) {
        await new Promise(r => setTimeout(r, 50));
        waited += 50;
      }
      if (window.Renderer) {
        await window.Renderer.init(canvas, SPAWN_POINTS, unitList, WALLS, enemyUnitList);
      }
    } catch (err) {
      console.error('[Init] failed:', err);
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
      requestAnimationFrame(loop);
    }
  })();

  // ── Update ────────────────────────────────────────────────────────────────

  function update(dt) {
    if (!state.gameOver) {
      if (!SPAWN_POINTS.some(p => p.owner === 'player')) { state.gameOver = true; state.winner = 'enemy'; }
      if (!SPAWN_POINTS.some(p => p.owner === 'enemy'))  { state.gameOver = true; state.winner = 'player'; }

      // Match timer countdown
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        const pHp = SPAWN_POINTS.reduce((sum, p) => p.owner === 'player' ? sum + p.hp : sum, 0);
        const eHp = SPAWN_POINTS.reduce((sum, p) => p.owner === 'enemy'  ? sum + p.hp : sum, 0);
        if (pHp !== eHp) {
          // Clear winner by HP — end game normally
          state.timeLeft = 0;
          state.gameOver = true;
          state.timeUpWin = true;
          state.winner = pHp > eHp ? 'player' : 'enemy';
        } else if (!state.suddenDeath) {
          // Equal HP → enter Sudden Death: 30-second overtime
          state.timeLeft = SUDDEN_DEATH_DURATION;
          state.suddenDeath = true;
        } else {
          // Sudden Death timer also expired with equal HP → Draw
          state.timeLeft = 0;
          state.gameOver = true;
          state.timeUpWin = true;
          state.winner = 'draw';
        }
      }
    }
    if (state.gameOver) return;

    // ── Income tick: +1 cost per owned spawn per second ─────────────────────
    state.incomeTimer += dt;
    if (state.incomeTimer >= 1) {
      state.incomeTimer -= 1;
      const baseIncome = SPAWN_POINTS.filter(p => p.owner === 'player').length;
      const farmBonus  = state.buildings
        .filter(b => b.owner === 'player' && b.effect === 'income')
        .reduce((sum, b) => sum + b.effectValue, 0);
      state.cost += baseIncome + farmBonus;
    }

    // ── Enemy spawner: interval shrinks as enemy owns more spawns ────────────
    const enemySpawns = SPAWN_POINTS.filter(p => p.owner === 'enemy');
    const spawnInterval = enemySpawns.length >= 3 ? ENEMY_SPAWN_INTERVALS[2]
                        : enemySpawns.length >= 2 ? ENEMY_SPAWN_INTERVALS[1]
                        : ENEMY_SPAWN_INTERVALS[0];
    state.enemySpawnTimer += dt;
    if (state.enemySpawnTimer >= spawnInterval && state.enemies.length < ENEMY_MAX_UNITS && enemySpawns.length) {
      state.enemySpawnTimer = 0;
      const sp    = enemySpawns[Math.floor(Math.random() * enemySpawns.length)];
      const types = Object.keys(ENEMY_PROTOS);
      if (types.length) {
        const type  = types[Math.floor(Math.random() * types.length)];
        const proto = ENEMY_PROTOS[type];
        const scaledHp  = Math.round(proto.maxHp  * ENEMY_HP_MULT);
        const scaledDmg = Math.round(proto.damage  * ENEMY_DMG_MULT);
        const scaledSpd = proto.speed * ENEMY_SPD_MULT;
        state.enemies.push({
          x: sp.x, y: sp.y, type,
          radius: proto.radius, color: proto.color,
          speed: scaledSpd, range: proto.range,
          attackRate: proto.attackRate, projectileSpeed: proto.projectileSpeed,
          damage: scaledDmg, hp: scaledHp, maxHp: scaledHp,
          ability: proto.ability, abilityValue: proto.abilityValue ?? 0,
          attackTimer: 0
        });
      }
    }

    for (let u of state.units) {
      const nearestEnemy = findNearestEnemyUnit(u.x, u.y, 'player');
      const nearestSpawn = findNearestSpawnPoint(u.x, u.y, 'player');
      const enemyDist = nearestEnemy ? Math.hypot(nearestEnemy.x - u.x, nearestEnemy.y - u.y) : Infinity;

      if (nearestEnemy && enemyDist <= u.range * 1.6) {
        u.target = { x: nearestEnemy.x, y: nearestEnemy.y };
      } else if (nearestSpawn) {
        u.target = { x: nearestSpawn.x, y: nearestSpawn.y };
      } else if (!u.target) {
        u.target = randomTarget();
      }

      const spawnDist   = nearestSpawn ? Math.hypot(nearestSpawn.x - u.x, nearestSpawn.y - u.y) : Infinity;
      const inAtkRange  = (nearestEnemy && enemyDist <= u.range && hasLOS(u.x, u.y, nearestEnemy.x, nearestEnemy.y)) ||
                          (nearestSpawn && spawnDist <= u.range && hasLOS(u.x, u.y, nearestSpawn.x, nearestSpawn.y));

      const dx = u.target.x - u.x;
      const dy = u.target.y - u.y;
      const dist = Math.hypot(dx, dy);
      if (inAtkRange) {
        u.vx = u.vy = 0;  // stop and shoot
      } else if (dist < 4) {
        u.vx = u.vy = 0;
        u.target = nearestSpawn ? { x: nearestSpawn.x, y: nearestSpawn.y } : randomTarget();
      } else {
        u.vx = (dx / dist) * u.speed;
        u.vy = (dy / dist) * u.speed;
        u.x += u.vx * dt;
        u.y += u.vy * dt;
      }

      // Collision avoidance with other player units
      for (let other of state.units) {
        if (other === u) continue;
        const d = Math.hypot(u.x - other.x, u.y - other.y);
        const minDist = u.radius + other.radius + 2;
        if (d < minDist && d > 0.01) {
          const push = (minDist - d) / 2;
          const nx = (u.x - other.x) / d;
          const ny = (u.y - other.y) / d;
          u.x += nx * push; u.y += ny * push;
          other.x -= nx * push; other.y -= ny * push;
        }
      }
      // Collision avoidance with enemies
      for (let e of state.enemies) {
        const d = Math.hypot(u.x - e.x, u.y - e.y);
        const minDist = u.radius + e.radius + 2;
        if (d < minDist && d > 0.01) {
          const push = (minDist - d) / 2;
          const nx = (u.x - e.x) / d;
          const ny = (u.y - e.y) / d;
          u.x += nx * push; u.y += ny * push;
          e.x -= nx * push; e.y -= ny * push;
        }
      }

      if (u.x < BOUNDARY.x + u.radius) { u.x = BOUNDARY.x + u.radius; u.target = randomTarget(); }
      if (u.x > BOUNDARY.x + BOUNDARY.width  - u.radius) { u.x = BOUNDARY.x + BOUNDARY.width  - u.radius; u.target = randomTarget(); }
      if (u.y < BOUNDARY.y + u.radius) { u.y = BOUNDARY.y + u.radius; u.target = randomTarget(); }
      if (u.y > BOUNDARY.y + BOUNDARY.height - u.radius) { u.y = BOUNDARY.y + BOUNDARY.height - u.radius; u.target = randomTarget(); }

      for (let w of WALLS) {
        const nearestX = Math.max(w.x, Math.min(u.x, w.x + w.width));
        const nearestY = Math.max(w.y, Math.min(u.y, w.y + w.height));
        const dxw = u.x - nearestX;
        const dyw = u.y - nearestY;
        const d = Math.hypot(dxw, dyw);
        if (d < u.radius) {
          const overlap = u.radius - d + 0.5;
          const wnx = d > 0.01 ? dxw / d : 1;
          const wny = d > 0.01 ? dyw / d : 0;
          u.x += wnx * overlap;
          u.y += wny * overlap;
          steerAroundWall(u, wnx, wny);
        }
      }

      // Stuck safety net: if unit barely moved in 0.8 s despite having speed, force a new route
      if (!u.stuckCheck) u.stuckCheck = { x: u.x, y: u.y, t: 0 };
      u.stuckCheck.t += dt;
      if (u.stuckCheck.t >= 0.8) {
        if (Math.hypot(u.x - u.stuckCheck.x, u.y - u.stuckCheck.y) < u.speed * 0.05) {
          u.target = randomTarget();
        }
        u.stuckCheck = { x: u.x, y: u.y, t: 0 };
      }

      if (u.attackTimer > 0) u.attackTimer -= dt;
      if (u.attackTimer <= 0) {
        let atk = null;
        if (nearestEnemy && enemyDist <= u.range && hasLOS(u.x, u.y, nearestEnemy.x, nearestEnemy.y)) {
          atk = nearestEnemy;
        } else if (nearestSpawn && spawnDist <= u.range && hasLOS(u.x, u.y, nearestSpawn.x, nearestSpawn.y)) {
          atk = nearestSpawn;
        }
        if (atk) {
          const ddx = atk.x - u.x;
          const ddy = atk.y - u.y;
          const ddist = Math.hypot(ddx, ddy) || 1;
          state.projectiles.push({
            x: u.x, y: u.y,
            vx: (ddx / ddist) * u.projectileSpeed,
            vy: (ddy / ddist) * u.projectileSpeed,
            radius: 4, damage: u.damage, owner: 'player',
            ability: u.ability, abilityValue: u.abilityValue ?? 0,
          });
          u.attackTimer = 1 / Math.max(0.0001, u.attackRate);
        }
      }
    }

    for (let e of state.enemies) {
      const nearestFriendly = findNearestEnemyUnit(e.x, e.y, 'enemy');
      const nearestPlayerSpawn = findNearestSpawnPoint(e.x, e.y, 'enemy');
      const eNFDist = nearestFriendly    ? Math.hypot(nearestFriendly.x    - e.x, nearestFriendly.y    - e.y) : Infinity;
      const eNSDist = nearestPlayerSpawn ? Math.hypot(nearestPlayerSpawn.x - e.x, nearestPlayerSpawn.y - e.y) : Infinity;
      const eInAtkRange = (eNFDist <= e.range && hasLOS(e.x, e.y, nearestFriendly.x, nearestFriendly.y)) ||
                          (eNSDist <= e.range && hasLOS(e.x, e.y, nearestPlayerSpawn.x, nearestPlayerSpawn.y));

      let target = nearestPlayerSpawn;
      if (nearestFriendly && eNFDist <= 180) target = nearestFriendly;
      if (e.wallSlideTimer > 0) { e.wallSlideTimer -= dt; target = e.wallSlideTarget || target; }
      const tx = target ? target.x : canvas.width / 2;
      const ty = target ? target.y : canvas.height / 2;
      const dx = tx - e.x, dy = ty - e.y;
      const dist = Math.hypot(dx, dy);
      if (eInAtkRange || dist <= 1) {
        e.vx = 0; e.vy = 0;  // stop and shoot
      } else {
        e.vx = (dx / dist) * e.speed;
        e.vy = (dy / dist) * e.speed;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }

      for (let w of WALLS) {
        const nearestX = Math.max(w.x, Math.min(e.x, w.x + w.width));
        const nearestY = Math.max(w.y, Math.min(e.y, w.y + w.height));
        const dxw = e.x - nearestX;
        const dyw = e.y - nearestY;
        const d = Math.hypot(dxw, dyw);
        if (d < e.radius) {
          const overlap = e.radius - d + 0.5;
          const wnx = d > 0.01 ? dxw / d : 1;
          const wny = d > 0.01 ? dyw / d : 0;
          e.x += wnx * overlap;
          e.y += wny * overlap;
          // Slide along wall surface toward goal
          const t1x = -wny, t1y = wnx, t2x = wny, t2y = -wnx;
          const useT1 = (t1x * (tx - e.x) + t1y * (ty - e.y)) >= (t2x * (tx - e.x) + t2y * (ty - e.y));
          e.wallSlideTarget = { x: e.x + (useT1 ? t1x : t2x) * 100, y: e.y + (useT1 ? t1y : t2y) * 100 };
          e.wallSlideTimer = 0.4;
        }
      }

      for (let other of state.enemies) {
        if (other === e) continue;
        const d = Math.hypot(e.x - other.x, e.y - other.y);
        const minDist = e.radius + other.radius + 2;
        if (d < minDist && d > 0.01) {
          const push = (minDist - d) / 2;
          const nx = (e.x - other.x) / d;
          const ny = (e.y - other.y) / d;
          e.x += nx * push; e.y += ny * push;
          other.x -= nx * push; other.y -= ny * push;
        }
      }

      if (!e.attackTimer) e.attackTimer = 0;
      if (e.attackTimer > 0) e.attackTimer -= dt;

      let shouldAttack = false, attackTarget = null;
      if (nearestFriendly && eNFDist <= e.range && hasLOS(e.x, e.y, nearestFriendly.x, nearestFriendly.y)) {
        shouldAttack = true; attackTarget = nearestFriendly;
      }
      if (!shouldAttack && nearestPlayerSpawn && eNSDist <= e.range && hasLOS(e.x, e.y, nearestPlayerSpawn.x, nearestPlayerSpawn.y)) {
        shouldAttack = true; attackTarget = nearestPlayerSpawn;
      }
      if (shouldAttack && attackTarget && e.attackTimer <= 0) {
        const ddx = attackTarget.x - e.x;
        const ddy = attackTarget.y - e.y;
        const ddist = Math.hypot(ddx, ddy) || 1;
        state.projectiles.push({
          x: e.x, y: e.y,
          vx: (ddx / ddist) * e.projectileSpeed,
          vy: (ddy / ddist) * e.projectileSpeed,
          radius: 4, damage: e.damage, owner: 'enemy',
          ability: e.ability, abilityValue: e.abilityValue ?? 0,
        });
        e.attackTimer = 1 / Math.max(0.0001, e.attackRate);
      }
    }

    for (let pi = state.projectiles.length - 1; pi >= 0; pi--) {
      const p = state.projectiles[pi];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < -20 || p.x > canvas.width + 20 || p.y < -20 || p.y > canvas.height + 20) {
        state.projectiles.splice(pi, 1); continue;
      }

      let hit = false;
      for (let w of WALLS) {
        if (p.x + p.radius > w.x && p.x - p.radius < w.x + w.width &&
            p.y + p.radius > w.y && p.y - p.radius < w.y + w.height) {
          state.projectiles.splice(pi, 1); hit = true; break;
        }
      }
      if (hit) continue;

      for (let spi = SPAWN_POINTS.length - 1; spi >= 0; spi--) {
        const sp = SPAWN_POINTS[spi];
        if (Math.hypot(sp.x - p.x, sp.y - p.y) < SPAWN_RADIUS + p.radius && sp.owner !== p.owner) {
          const bldgIdx = state.buildings.findIndex(b => b.spawnRef === sp);
          if (bldgIdx !== -1) {
            // Building absorbs the hit — spawn is protected
            const bldg = state.buildings[bldgIdx];
            bldg.hp -= p.damage;
            addDamageNumber(bldg.x, bldg.y, p.damage);
            addExplosion(p.x, p.y, 12);
            state.projectiles.splice(pi, 1);
            if (bldg.hp <= 0) { state.buildings.splice(bldgIdx, 1); addExplosion(bldg.x, bldg.y, 28); }
          } else {
            sp.hp -= p.damage;
            addDamageNumber(sp.x, sp.y, p.damage);
            addExplosion(p.x, p.y, 15);
            state.projectiles.splice(pi, 1);
            if (sp.hp <= 0) {
              sp.owner = p.owner; sp.hp = sp.maxHp;
              // Remove any building that belonged to the captured spawn's former owner
              const lostBldg = state.buildings.findIndex(b => b.spawnRef === sp);
              if (lostBldg !== -1) { addExplosion(state.buildings[lostBldg].x, state.buildings[lostBldg].y, 25); state.buildings.splice(lostBldg, 1); }
            }
          }
          hit = true; break;
        }
      }
      if (hit) continue;

      for (let ei = state.enemies.length - 1; ei >= 0; ei--) {
        const en = state.enemies[ei];
        if (Math.hypot(en.x - p.x, en.y - p.y) < en.radius + p.radius && p.owner === 'player') {
          const enProto = PROTOS[en.type];
          // Dodge
          if (enProto?.ability === 'dodge' && Math.random() < (enProto.abilityValue ?? 0)) {
            addDamageNumber(en.x, en.y, 'MISS', '#88aaff');
            state.projectiles.splice(pi, 1);
            hit = true; break;
          }
          // Armor
          let dmg = p.damage;
          if (enProto?.ability === 'armor') dmg = Math.max(1, Math.round(dmg * (1 - (enProto.abilityValue ?? 0))));
          // Direct hit
          en.hp -= dmg;
          addDamageNumber(en.x, en.y, dmg);
          addExplosion(p.x, p.y, 12);
          state.projectiles.splice(pi, 1);
          // Splash
          if (p.ability === 'splash') {
            for (let si = state.enemies.length - 1; si >= 0; si--) {
              if (si === ei) continue;
              const st = state.enemies[si];
              if (Math.hypot(st.x - p.x, st.y - p.y) < (p.abilityValue ?? 0)) {
                const stProto = PROTOS[st.type];
                let sDmg = Math.max(1, Math.round(p.damage * 0.5));
                if (stProto?.ability === 'armor') sDmg = Math.max(1, Math.round(sDmg * (1 - (stProto.abilityValue ?? 0))));
                st.hp -= sDmg;
                addDamageNumber(st.x, st.y, sDmg);
                addExplosion(st.x, st.y, 10);
                if (st.hp <= 0) { state.enemies.splice(si, 1); state.cost += KILL_REWARD; addExplosion(st.x, st.y, 20); if (si < ei) ei--; }
              }
            }
          }
          if (en.hp <= 0) {
            const idx = state.enemies.indexOf(en);
            if (idx !== -1) state.enemies.splice(idx, 1);
            state.cost += KILL_REWARD; addExplosion(en.x, en.y, 25);
          }
          hit = true; break;
        }
      }
      if (hit) continue;

      for (let ui = state.units.length - 1; ui >= 0; ui--) {
        const u = state.units[ui];
        if (Math.hypot(u.x - p.x, u.y - p.y) < u.radius + p.radius && p.owner === 'enemy') {
          const uProto = PROTOS[u.type];
          // Dodge
          if (uProto?.ability === 'dodge' && Math.random() < (uProto.abilityValue ?? 0)) {
            addDamageNumber(u.x, u.y, 'MISS', '#88aaff');
            state.projectiles.splice(pi, 1);
            break;
          }
          // Armor
          let dmg = p.damage;
          if (uProto?.ability === 'armor') dmg = Math.max(1, Math.round(dmg * (1 - (uProto.abilityValue ?? 0))));
          // Direct hit
          u.hp -= dmg;
          addDamageNumber(u.x, u.y, dmg);
          addExplosion(p.x, p.y, 12);
          state.projectiles.splice(pi, 1);
          // Splash
          if (p.ability === 'splash') {
            for (let si = state.units.length - 1; si >= 0; si--) {
              if (si === ui) continue;
              const st = state.units[si];
              if (Math.hypot(st.x - p.x, st.y - p.y) < (p.abilityValue ?? 0)) {
                const stProto = PROTOS[st.type];
                let sDmg = Math.max(1, Math.round(p.damage * 0.5));
                if (stProto?.ability === 'armor') sDmg = Math.max(1, Math.round(sDmg * (1 - (stProto.abilityValue ?? 0))));
                st.hp -= sDmg;
                addDamageNumber(st.x, st.y, sDmg);
                addExplosion(st.x, st.y, 10);
                if (st.hp <= 0) { state.units.splice(si, 1); addExplosion(st.x, st.y, 18); if (si < ui) ui--; }
              }
            }
          }
          if (u.hp <= 0) {
            const idx = state.units.indexOf(u);
            if (idx !== -1) state.units.splice(idx, 1);
            addExplosion(u.x, u.y, 20);
          }
          break;
        }
      }
    }

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      for (let j = state.units.length - 1; j >= 0; j--) {
        const u = state.units[j];
        if (Math.hypot(u.x - e.x, u.y - e.y) < u.radius + e.radius) {
          u.hp -= 20 * dt;
          e.hp -= 30 * dt;
          const now = performance.now();
          if (!u.lastCollisionDamageTime || now - u.lastCollisionDamageTime > 300) {
            addDamageNumber(u.x, u.y, Math.round(20 * 0.3));
            u.lastCollisionDamageTime = now;
          }
          if (!e.lastCollisionDamageTime || now - e.lastCollisionDamageTime > 300) {
            addDamageNumber(e.x, e.y, Math.round(30 * 0.3));
            e.lastCollisionDamageTime = now;
          }
        }
        if (u.hp <= 0) { addExplosion(u.x, u.y, 20); state.units.splice(j, 1); }
        if (e.hp <= 0) { addExplosion(e.x, e.y, 25); state.enemies.splice(i, 1); state.cost += KILL_REWARD; break; }
      }
    }

    for (let i = state.damageNumbers.length - 1; i >= 0; i--) {
      const dmg = state.damageNumbers[i];
      dmg.y -= 60 * dt;
      dmg.alpha -= dt / 1.2;
      if (dmg.alpha <= 0) state.damageNumbers.splice(i, 1);
    }

    for (let i = state.explosions.length - 1; i >= 0; i--) {
      const exp = state.explosions[i];
      exp.size  += 50 * dt;
      exp.alpha -= dt * 1.25;
      if (exp.alpha <= 0) state.explosions.splice(i, 1);
    }
  }

  // ── Unit monitor ──────────────────────────────────────────────────────────

  function updateUnitMonitor() {
    if (!unitMonitorEl) return;
    if (state.units.length === 0) { unitMonitorEl.innerHTML = ''; return; }
    let html = '<div class="um-header">UNITS</div>';
    for (const u of state.units) {
      const ratio    = u.hp / u.maxHp;
      const barColor = ratio > 0.6 ? '#6be07a' : ratio > 0.3 ? '#ffb347' : '#ff5555';
      const name     = (PROTOS[u.type]?.name ?? u.type);
      html += `<div class="um-row">`
            + `<span class="um-dot" style="background:${u.color}"></span>`
            + `<span class="um-name">${name}</span>`
            + `<div class="um-bar-bg"><div class="um-bar" style="width:${(ratio * 100).toFixed(1)}%;background:${barColor}"></div></div>`
            + `<span class="um-hp">${Math.ceil(u.hp)}</span>`
            + `</div>`;
    }
    unitMonitorEl.innerHTML = html;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    if (window.Renderer) {
      window.Renderer.render(state, selectedUnitType || selectedBuildingType, SPAWN_POINTS, performance.now());
    }

    // HUD
    if (costEl) {
      const spawnRate = SPAWN_POINTS.filter(p => p.owner === 'player').length;
      const farmRate  = state.buildings
        .filter(b => b.owner === 'player' && b.effect === 'income')
        .reduce((sum, b) => sum + b.effectValue, 0);
      costEl.textContent = `Cost: ${state.cost} (+${spawnRate + farmRate}/s)`;
    }
    if (unitCountEl) unitCountEl.textContent = `Units: ${state.units.length}/${getEffectiveMaxUnits()}`;
    updateUnitMonitor();

    // Spawn HP gauge
    {
      const pHp  = SPAWN_POINTS.filter(p => p.owner === 'player').reduce((s, p) => s + p.hp, 0);
      const nHp  = SPAWN_POINTS.filter(p => p.owner === 'neutral').reduce((s, p) => s + p.hp, 0);
      const eHp  = SPAWN_POINTS.filter(p => p.owner === 'enemy').reduce((s, p) => s + p.hp, 0);
      const tot  = pHp + nHp + eHp || 1;
      const pct  = v => (v / tot * 100).toFixed(1) + '%';
      if (hpGaugePFillEl) hpGaugePFillEl.style.width = pct(pHp);
      if (hpGaugeNFillEl) hpGaugeNFillEl.style.width = pct(nHp);
      if (hpGaugeEFillEl) hpGaugeEFillEl.style.width = pct(eHp);
      if (hpGaugePEl)     hpGaugePEl.textContent = pHp;
      if (hpGaugeEEl)     hpGaugeEEl.textContent = eHp;
    }

    // Timer
    if (timerEl && timerLabelEl && timerBlockEl) {
      const t = Math.max(0, state.timeLeft);
      const m = Math.floor(t / 60);
      const s = Math.ceil(t % 60);
      timerEl.textContent = `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
      if (state.suddenDeath) {
        timerLabelEl.textContent = 'SUDDEN DEATH';
        timerBlockEl.classList.add('sudden-death');
        timerEl.classList.remove('warning');
      } else {
        timerLabelEl.textContent = 'TIME';
        timerBlockEl.classList.remove('sudden-death');
        if (t <= 10 && !state.gameOver) timerEl.classList.add('warning');
        else                             timerEl.classList.remove('warning');
      }
    }

    // Game-over overlay (HTML div)
    if (overlayEl && overlayBody) {
      if (state.gameOver) {
        let html;
        const won = state.winner === 'player';
        if (state.timeUpWin) {
          const c   = won ? '#6be07a' : state.winner === 'enemy' ? '#ff6b6b' : '#aaaaaa';
          const msg = won ? 'PLAYER WINS!' : state.winner === 'enemy' ? 'ENEMY WINS!' : 'DRAW!';
          const sub = state.winner === 'draw' && state.suddenDeath
            ? 'Sudden Death หมดเวลา — เสมอ' : 'ชนะด้วย Spawn HP สูงกว่า';
          const waveLine = won
            ? `<p class="go-wave">WAVE ${currentWave} CLEAR → WAVE ${currentWave + 1}</p>`
            : `<p class="go-wave">WAVE ${currentWave} — เริ่มใหม่ที่ WAVE 1</p>`;
          html = `${waveLine}<p class="go-label">TIME UP!</p><p class="go-winner" style="color:${c}">${msg}</p><p class="go-sub">${sub}</p><p class="go-restart">แตะเพื่อเล่นใหม่</p>`;
        } else {
          const c   = won ? '#6be07a' : '#ff6b6b';
          const msg = won ? 'PLAYER WINS!' : 'ENEMY WINS!';
          const waveLine = won
            ? `<p class="go-wave">WAVE ${currentWave} CLEAR → WAVE ${currentWave + 1}</p>`
            : `<p class="go-wave">WAVE ${currentWave} — เริ่มใหม่ที่ WAVE 1</p>`;
          html = `${waveLine}<p class="go-winner" style="color:${c}">${msg}</p><p class="go-restart">แตะเพื่อเล่นใหม่</p>`;
        }
        if (overlayBody.innerHTML !== html) overlayBody.innerHTML = html;
        overlayEl.classList.add('visible');
      } else {
        overlayEl.classList.remove('visible');
      }
    }
  }

  window._spawnUnit = spawnUnit;
})();
