export const SPAWN_POINTS = [
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

export const state = {
  units:           [],
  enemies:         [],
  projectiles:     [],
  buildings:       [],
  cost:            0,
  nextId:          1,
  gameOver:        false,
  winner:          null,
  timeLeft:        0,
  timeUpWin:       false,
  suddenDeath:     false,
  damageNumbers:   [],
  explosions:      [],
  incomeTimer:     0,
  enemySpawnTimer: 0,
  rallyPoint:      null,   // reference to a SPAWN_POINTS entry (non-player) to advance toward
  defendMode:      false,  // when true, units hold at nearest player spawn
  // PvP fields
  enemyCost:        0,
  enemyRallyPoint:  null,  // enemy side rally (PvP guest controls)
  enemyDefendMode:  false, // enemy side defend (PvP guest controls)
};

export const session = {
  kills: 0,
  unitsDeployed: 0,
  spawnsCaptured: 0,
  unitUsage: {},
  startTimestamp: 0,
  durationSec: 0,
  won: false,
  goldEarned: 0,
};

export function addDamageNumber(x, y, damage, color) {
  state.damageNumbers.push({ x, y, damage, color, alpha: 1.0 });
}

export function addExplosion(x, y, size = 20) {
  state.explosions.push({ x, y, size, alpha: 1 });
}
