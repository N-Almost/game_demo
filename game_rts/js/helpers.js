import { BOUNDARY }           from './constants.js';
import { state, SPAWN_POINTS } from './state.js';
import { cfg }                 from './config.js';

export function lineIntersectsRect(ax, ay, bx, by, rx, ry, rw, rh) {
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

export function hasLOS(ax, ay, bx, by) {
  const PAD = 5;
  for (const w of cfg.walls) {
    if (lineIntersectsRect(ax, ay, bx, by, w.x - PAD, w.y - PAD, w.width + PAD * 2, w.height + PAD * 2)) return false;
  }
  return true;
}

export function randomTarget() {
  return {
    x: BOUNDARY.x + Math.random() * BOUNDARY.width,
    y: BOUNDARY.y + Math.random() * BOUNDARY.height,
  };
}

export function findNearestSpawnPoint(x, y, excludeOwner) {
  const points = SPAWN_POINTS.filter(p => p.owner !== excludeOwner);
  if (!points.length) return null;
  return points.reduce((best, p) =>
    Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best
  , points[0]);
}

export function findNearestEnemyUnit(x, y, myOwner) {
  const list = myOwner === 'player' ? state.enemies : state.units;
  if (!list.length) return null;
  return list.reduce((best, u) =>
    Math.hypot(u.x - x, u.y - y) < Math.hypot(best.x - x, best.y - y) ? u : best
  , list[0]);
}

// Steer a unit tangentially along a wall surface toward its current goal.
export function steerAroundWall(unit, wallNx, wallNy) {
  const t1x = -wallNy, t1y =  wallNx;
  const t2x =  wallNy, t2y = -wallNx;
  const gx = unit.target ? unit.target.x - unit.x : 0;
  const gy = unit.target ? unit.target.y - unit.y : 0;
  const useT1 = (t1x * gx + t1y * gy) >= (t2x * gx + t2y * gy);
  unit.target = {
    x: Math.max(BOUNDARY.x + unit.radius, Math.min(BOUNDARY.x + BOUNDARY.width  - unit.radius, unit.x + (useT1 ? t1x : t2x) * 120)),
    y: Math.max(BOUNDARY.y + unit.radius, Math.min(BOUNDARY.y + BOUNDARY.height - unit.radius, unit.y + (useT1 ? t1y : t2y) * 120)),
  };
}
