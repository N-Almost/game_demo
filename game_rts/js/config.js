// All mutable game config in one object so importers always see the latest values
export const cfg = {
  walls:                [],
  protos:               {},   // player unit prototypes (from units.json)
  enemyProtos:          {},   // enemy unit prototypes (from enemy_units.json)
  buildingProtos:       {},
  maxUnits:             5,
  killReward:           2,
  matchDuration:        180,
  suddenDeathDuration:  30,
  startCost:            10,
  currentWave:          1,
  enemyMaxUnits:        5,
  enemySpawnIntervals:  [2.0, 1.5, 1.2],
  enemyHpMult:          1,
  enemyDmgMult:         1,
  enemySpdMult:         1,
};

// Private wave-scaling baseline values
let _enemyMaxUnitsBase       = 5;
let _enemySpawnIntervalsBase = [2.0, 1.5, 1.2];
let _waveScaling             = {};

export async function loadAllConfigs() {
  const [gameCfg, enemyCfg, wallsData, buildingsData, unitsData, enemyUnitsData] = await Promise.all([
    fetch('config.json').then(r => r.json()),
    fetch('enemy_config.json').then(r => r.json()),
    fetch('walls.json').then(r => r.json()),
    fetch('buildings.json').then(r => r.json()),
    fetch('units.json').then(r => r.json()),
    fetch('enemy_units.json').then(r => r.json()),
  ]);

  cfg.startCost           = gameCfg.startCost           ?? 10;
  cfg.matchDuration       = gameCfg.matchDuration       ?? 180;
  cfg.suddenDeathDuration = gameCfg.suddenDeathDuration ?? 30;

  cfg.killReward          = enemyCfg.killReward     ?? 2;
  _enemyMaxUnitsBase      = enemyCfg.maxUnits       ?? 5;
  _enemySpawnIntervalsBase = enemyCfg.spawnIntervals ?? [2.0, 1.5, 1.2];
  _waveScaling            = enemyCfg.waveScaling    ?? {};

  cfg.walls         = wallsData.walls ?? [];
  cfg.buildingProtos = Object.fromEntries(buildingsData.buildings.map(b => [b.id, b]));

  cfg.maxUnits = unitsData.maxUnits ?? 5;
  cfg.protos   = Object.fromEntries(unitsData.units.map(u => [u.id, {
    name: u.name, radius: u.radius, color: u.color, enemyColor: u.enemyColor,
    speed: u.speed, range: u.range, attackRate: u.attackRate,
    projectileSpeed: u.projectileSpeed, damage: u.damage,
    cost: u.cost, maxHp: u.maxHp,
    ability: u.ability ?? null, abilityValue: u.abilityValue ?? 0,
    cooldown: u.cooldown ?? 0,
  }]));

  cfg.enemyProtos = Object.fromEntries(enemyUnitsData.units.map(u => [u.id, {
    radius: u.radius, color: u.color,
    speed: u.speed, range: u.range, attackRate: u.attackRate,
    projectileSpeed: u.projectileSpeed, damage: u.damage, maxHp: u.maxHp,
    ability: u.ability ?? null, abilityValue: u.abilityValue ?? 0,
  }]));

  return {
    unitList:     unitsData.units,
    enemyUnitList: enemyUnitsData.units,
    buildingList: buildingsData.buildings,
  };
}

export function loadCurrentWave() {
  cfg.currentWave = Math.max(1, parseInt(localStorage.getItem('rts_wave') || '1', 10));
}

export function applyWaveScaling() {
  const w = cfg.currentWave - 1;
  const s = _waveScaling;
  cfg.enemyMaxUnits       = _enemyMaxUnitsBase + Math.floor(w * (s.maxUnitsPerWave ?? 0));
  const minI              = s.minSpawnInterval ?? 0.5;
  cfg.enemySpawnIntervals = _enemySpawnIntervalsBase.map(v => Math.max(minI, v - w * (s.spawnIntervalReduction ?? 0)));
  cfg.enemyHpMult         = 1 + w * (s.hpPerWave    ?? 0);
  cfg.enemyDmgMult        = 1 + w * (s.damagePerWave ?? 0);
  cfg.enemySpdMult        = 1 + w * (s.speedPerWave  ?? 0);
}
