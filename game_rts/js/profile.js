import { syncProfile } from './auth.js';

const KEY = 'rts_profile';

const _defaults = () => ({
  name: 'COMMANDER',
  bestWave: 1,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  totalKills: 0,
  totalUnitsDeployed: 0,
  totalSpawnsCaptured: 0,
  playTimeSec: 0,
  unitUsage: {},
  gold: 0,
});

export function loadProfile() {
  try {
    return { ..._defaults(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return _defaults();
  }
}

export function saveProfile(p) {
  localStorage.setItem(KEY, JSON.stringify(p));
  syncProfile(p);
}

export function setProfileName(raw) {
  const p = loadProfile();
  p.name = raw.trim().toUpperCase().slice(0, 12) || 'COMMANDER';
  saveProfile(p);
  return p.name;
}

export function addGold(amount) {
  const p = loadProfile();
  p.gold = (p.gold ?? 0) + amount;
  saveProfile(p);
  return p.gold;
}

export function goldRewardForWave(wave) {
  return 10 + wave * 5;
}

export function recordMatchEnd(session, wave) {
  const p = loadProfile();
  p.gamesPlayed++;
  if (session.won) p.wins++; else p.losses++;
  p.totalKills          += session.kills          ?? 0;
  p.totalUnitsDeployed  += session.unitsDeployed  ?? 0;
  p.totalSpawnsCaptured += session.spawnsCaptured ?? 0;
  p.playTimeSec         += Math.round(session.durationSec ?? 0);
  p.bestWave             = Math.max(p.bestWave, wave);
  for (const [type, count] of Object.entries(session.unitUsage ?? {})) {
    p.unitUsage[type] = (p.unitUsage[type] ?? 0) + count;
  }
  saveProfile(p);
}
