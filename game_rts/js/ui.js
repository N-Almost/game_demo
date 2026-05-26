import { state, session, SPAWN_POINTS } from './state.js';
import { cfg }                  from './config.js';
import { getEffectiveMaxUnits, getCooldownRatio, getCooldownRemaining } from './units.js';

const ABILITY_ICONS = {
  armor:  `<svg viewBox="0 0 24 28" fill="none"><path d="M12 2L22 6V14C22 20.5 17.2 25 12 27C6.8 25 2 20.5 2 14V6Z" fill="rgba(255,255,255,0.92)"/><path d="M8 14l3 3 5-6" stroke="rgba(0,0,0,0.35)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  splash: `<svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="5" fill="rgba(255,255,255,0.92)"/><path d="M14 2V6M14 22V26M2 14H6M22 14H26M5.5 5.5L8.3 8.3M19.7 19.7L22.5 22.5M22.5 5.5L19.7 8.3M8.3 19.7L5.5 22.5" stroke="rgba(255,255,255,0.82)" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  dodge:  `<svg viewBox="0 0 22 30" fill="none"><path d="M14 1L3 16H10L8 29L19 13H12Z" fill="rgba(255,255,255,0.92)"/></svg>`,
};

// ── Button builders ───────────────────────────────────────────────────────────

export function buildUnitButtons(unitDefs) {
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
    const [r, g, b]    = [u.color.slice(1,3), u.color.slice(3,5), u.color.slice(5,7)].map(h => parseInt(h, 16));
    const gradient     = `linear-gradient(180deg,rgba(${r},${g},${b},0.4) 0%,rgba(${r},${g},${b},0.16) 55%,rgba(0,0,0,0.5) 100%)`;
    const portraitImg  = u.portrait ? `<img class="unit-btn-img" src="${u.portrait}" alt="" onerror="this.style.display='none'">` : '';

    btn.innerHTML =
      `<div class="unit-btn-portrait" style="background:${gradient}">${portraitImg}</div>` +
      `<div class="unit-btn-icon">${icon}</div>` +
      `<div class="unit-btn-info">` +
        `<div class="unit-btn-name">${u.name}</div>` +
        `<div class="unit-btn-meta"><span class="unit-btn-ability">${abilityLabel}</span><span class="unit-btn-cost">${u.cost}<small>cost</small></span></div>` +
      `</div>` +
      `<div class="unit-btn-cooldown"><div class="unit-btn-cooldown-fill"></div><div class="unit-btn-cooldown-content"><span class="unit-btn-cooldown-text"></span><span class="unit-btn-cooldown-label">COOLDOWN</span></div></div>`;
    container.appendChild(btn);
  }
}

const BUILDING_ICONS = {
  farm:     `<svg viewBox="0 0 24 24" fill="none"><path d="M12 22V12M12 12C12 7 7 4 3 6C7 6 10 9 12 12ZM12 12C12 7 17 4 21 6C17 6 14 9 12 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  barracks: `<svg viewBox="0 0 24 24" fill="none"><path d="M3 21h18M5 21V9l7-6 7 6v12M10 21v-6h4v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  turret:   `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

export function buildBuildingButtons(buildingDefs) {
  const container = document.getElementById('building-buttons');
  if (!container) return;
  container.innerHTML = '';
  for (const b of buildingDefs) {
    const btn = document.createElement('button');
    btn.className    = 'building-btn';
    btn.dataset.type = b.id;
    btn.style.setProperty('--bclr', b.color);
    const icon = BUILDING_ICONS[b.id] ?? `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2"/></svg>`;
    btn.innerHTML =
      `<div class="bldg-top" style="background:color-mix(in srgb,${b.color} 18%,transparent)">` +
        `<div class="bldg-icon" style="color:${b.color}">${icon}</div>` +
      `</div>` +
      `<div class="bldg-info">` +
        `<div class="bldg-name">${b.name}</div>` +
        `<div class="bldg-cost">${b.cost}<small>cost</small></div>` +
        `<div class="bldg-desc">${b.description}</div>` +
      `</div>`;
    container.appendChild(btn);
  }
}

// ── HUD rendering ─────────────────────────────────────────────────────────────

export function renderHUD(currentWave) {
  _renderCostDisplay();
  _renderUnitCount();
  _renderUnitMonitor();
  _renderSpawnHpGauge();
  _renderTimer();
  _renderGameOver(currentWave);
  _renderCooldowns();
  _renderCommandState();
}

// ── Private HUD helpers ───────────────────────────────────────────────────────

function _renderCostDisplay() {
  const valEl = document.getElementById('cost-value');
  const incEl = document.getElementById('cost-income');
  if (!valEl || !incEl) return;
  const spawnRate = SPAWN_POINTS.filter(p => p.owner === 'player').length;
  const farmBonus = state.buildings.filter(b => b.owner === 'player' && b.effect === 'income').reduce((s, b) => s + b.effectValue, 0);
  valEl.textContent = state.cost;
  incEl.textContent = `+${spawnRate + farmBonus}/s`;
}

function _renderUnitCount() {
  const el = document.getElementById('unit-val');
  if (el) el.textContent = `${state.units.length}/${getEffectiveMaxUnits()}`;
}

function _renderUnitMonitor() {
  const el = document.getElementById('unit-monitor');
  if (!el) return;
  if (!state.units.length) { el.innerHTML = ''; return; }

  let html = '<div class="um-header">FIELD UNITS</div>';
  for (const u of state.units) {
    const ratio      = Math.max(0, u.hp / u.maxHp);
    const barColor   = ratio > 0.6 ? '#6be07a' : ratio > 0.3 ? '#ffb347' : '#ff5555';
    const barGlow    = ratio > 0.6 ? '107,224,122' : ratio > 0.3 ? '255,179,71' : '255,85,85';
    const isAtk      = u.attackTimer > 0;
    const name       = (cfg.protos[u.type]?.name ?? u.type).toUpperCase();
    const ability    = cfg.protos[u.type]?.ability ?? '';
    const abilityTag = ability ? `<span class="um-ability">${ability.toUpperCase()}</span>` : '';

    html +=
      `<div class="um-card">` +
        `<div class="um-accent" style="background:${u.color};box-shadow:0 0 5px ${u.color}99"></div>` +
        `<div class="um-body">` +
          `<div class="um-top">` +
            `<span class="um-name">${name}</span>` +
            abilityTag +
            `<span class="um-status ${isAtk ? 'atk' : 'idle'}"></span>` +
            `<span class="um-hp-val">${Math.ceil(u.hp)}</span>` +
          `</div>` +
          `<div class="um-bar-track">` +
            `<div class="um-bar-fill" style="width:${(ratio*100).toFixed(1)}%;background:${barColor};box-shadow:0 0 5px rgba(${barGlow},0.55)"></div>` +
          `</div>` +
        `</div>` +
      `</div>`;
  }
  el.innerHTML = html;
}

function _renderSpawnHpGauge() {
  const pHp = SPAWN_POINTS.filter(p => p.owner === 'player').reduce((s, p) => s + p.hp, 0);
  const nHp = SPAWN_POINTS.filter(p => p.owner === 'neutral').reduce((s, p) => s + p.hp, 0);
  const eHp = SPAWN_POINTS.filter(p => p.owner === 'enemy').reduce((s, p) => s + p.hp, 0);
  const tot = pHp + nHp + eHp || 1;
  const pct = v => (v / tot * 100).toFixed(1) + '%';

  const pFill = document.getElementById('hp-gauge-fill-p');
  const nFill = document.getElementById('hp-gauge-fill-n');
  const eFill = document.getElementById('hp-gauge-fill-e');
  const pText = document.getElementById('hp-gauge-p');
  const eText = document.getElementById('hp-gauge-e');
  if (pFill) pFill.style.width = pct(pHp);
  if (nFill) nFill.style.width = pct(nHp);
  if (eFill) eFill.style.width = pct(eHp);
  if (pText) pText.textContent = pHp;
  if (eText) eText.textContent = eHp;
}

function _renderTimer() {
  const timerEl      = document.getElementById('timer');
  const timerLabelEl = document.getElementById('timer-label');
  const timerBlockEl = document.getElementById('timer-block');
  if (!timerEl || !timerLabelEl || !timerBlockEl) return;

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

function _renderGameOver(currentWave) {
  const overlayEl  = document.getElementById('gameover-overlay');
  const overlayBody = document.getElementById('gameover-body');
  if (!overlayEl || !overlayBody) return;
  if (!state.gameOver) { overlayEl.classList.remove('visible'); return; }

  const won    = state.winner === 'player';
  const isDraw = state.winner === 'draw';
  const c      = won ? '#6be07a' : isDraw ? '#aaaaaa' : '#ff6b6b';
  const msg    = won ? 'PLAYER WINS!' : isDraw ? 'DRAW!' : 'ENEMY WINS!';
  const waveLine = won
    ? `<p class="go-wave">WAVE ${currentWave} CLEAR → WAVE ${currentWave + 1}</p>`
    : `<p class="go-wave">WAVE ${currentWave} — เริ่มใหม่ที่ WAVE 1</p>`;

  const goldLine = won && session.goldEarned > 0
    ? `<p class="go-gold"><span class="go-gold-coin">◆</span> +${session.goldEarned} GOLD</p>`
    : '';

  let html;
  if (state.timeUpWin) {
    const sub = isDraw && state.suddenDeath ? 'Sudden Death หมดเวลา — เสมอ' : 'ชนะด้วย Spawn HP สูงกว่า';
    html = `${waveLine}<p class="go-label">TIME UP!</p><p class="go-winner" style="color:${c}">${msg}</p><p class="go-sub">${sub}</p>${goldLine}<p class="go-restart">แตะเพื่อเล่นใหม่</p>`;
  } else {
    html = `${waveLine}<p class="go-winner" style="color:${c}">${msg}</p>${goldLine}<p class="go-restart">แตะเพื่อเล่นใหม่</p>`;
  }
  if (overlayBody.innerHTML !== html) overlayBody.innerHTML = html;
  overlayEl.classList.add('visible');
}

function _renderCooldowns() {
  document.querySelectorAll('.unit-btn').forEach(btn => {
    const type    = btn.dataset.type;
    const ratio   = getCooldownRatio(type);
    const overlay = btn.querySelector('.unit-btn-cooldown');
    const fill    = btn.querySelector('.unit-btn-cooldown-fill');
    const text    = btn.querySelector('.unit-btn-cooldown-text');
    if (!overlay) return;

    if (ratio > 0) {
      overlay.classList.add('active');
      fill.style.height = (ratio * 100).toFixed(1) + '%';
      const rem = getCooldownRemaining(type);
      text.textContent = rem > 0.05 ? rem.toFixed(1) : '';
    } else {
      overlay.classList.remove('active');
    }
  });
}

function _renderCommandState() {
  const defendBtn = document.getElementById('btn-defend');
  if (defendBtn) defendBtn.classList.toggle('active', state.defendMode);

  const rallyCard = document.getElementById('rally-card');
  if (rallyCard) rallyCard.classList.toggle('on', !!state.rallyPoint);
}
