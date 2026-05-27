import { syncUpgrades } from './auth.js';

const KEY = 'rts_upgrades';

export const UPGRADE_DEFS = {
  hp:         { label: 'HP',        unit: 'HP',   perLevel: 20,   costs: [15, 35, 65] },
  damage:     { label: 'DAMAGE',    unit: 'DMG',  perLevel: 8,    costs: [20, 45, 80] },
  speed:      { label: 'SPEED',     unit: 'SPD',  perLevel: 6,    costs: [15, 35, 60] },
  attackRate: { label: 'ATK SPEED', unit: '/s',   perLevel: 0.2,  costs: [25, 55, 90] },
};

export const MAX_LEVEL = 3;

export function loadUpgrades() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); }
  catch { return {}; }
}

export function saveUpgrades(u) {
  localStorage.setItem(KEY, JSON.stringify(u));
  syncUpgrades(u);
}

export function getUnitUpgrades(type) {
  return { hp: 0, damage: 0, speed: 0, attackRate: 0, ...loadUpgrades()[type] };
}

// Returns gold cost spent, or null on failure (maxed / insufficient gold)
export function buyUpgrade(type, stat, currentGold) {
  const all   = loadUpgrades();
  const uv    = { hp: 0, damage: 0, speed: 0, attackRate: 0, ...all[type] };
  const level = uv[stat] ?? 0;
  if (level >= MAX_LEVEL) return null;
  const cost  = UPGRADE_DEFS[stat].costs[level];
  if (currentGold < cost) return null;
  uv[stat]    = level + 1;
  all[type]   = uv;
  saveUpgrades(all);
  return cost;
}

// Apply saved upgrades to a unit's base proto values at spawn time
export function applyUpgrades(proto, type) {
  const uv = getUnitUpgrades(type);
  return {
    ...proto,
    maxHp:      proto.maxHp      + uv.hp         * UPGRADE_DEFS.hp.perLevel,
    damage:     proto.damage     + uv.damage      * UPGRADE_DEFS.damage.perLevel,
    speed:      proto.speed      + uv.speed       * UPGRADE_DEFS.speed.perLevel,
    attackRate: +(proto.attackRate + uv.attackRate * UPGRADE_DEFS.attackRate.perLevel).toFixed(2),
  };
}
