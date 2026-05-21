# CLAUDE.md — Simple RTS

## Overview

Browser-based RTS targeting Android (Nothing Phone 3a Lite) in landscape mode.
Two players (human vs AI) fight over spawn points on a fixed 480×480 map.
Must be served over HTTP (GLTFLoader uses fetch) — `python3 -m http.server 8080`.

## Architecture

### Dual-canvas layout
- `#gameCanvas` (invisible, z-index 1) — captures touch/click events
- `#threeCanvas` (Three.js, z-index 2, pointer-events:none) — renders the scene

Canvas2D was removed entirely. All rendering goes through Three.js.

### File responsibilities
| File | Role |
|------|------|
| `index.html` | DOM shell, importmap (Three.js r165 via jsdelivr), script tags |
| `style.css` | Layout, HUD, timer, game-over overlay |
| `config.json` | Game-wide settings (costs, rewards, match duration) |
| `units.json` | **Single source of truth** for unit types — edit here to balance/add units |
| `buildings.json` | Building type definitions (Farm, Barracks) — same data-driven pattern as units |
| `renderer.js` | ES module, `window.Renderer = { init, render, getGroundIntersect }` |
| `app.js` | Game logic (defer script), reads `window.Renderer` after polling |

### Script loading order
`renderer.js` is `type="module"` (async), `app.js` is `defer`.
`app.js` polls `window.Renderer` for up to 3 s before starting the loop.

## Key systems

### units.json — data-driven units
Add/remove/tune unit types here. No code changes needed.

Fields per unit:
```json
{
  "id": "soldier",        // used as key and model filename (models/soldier.glb)
  "name": "Soldier",      // display name in HUD
  "ability": "armor",     // "armor" | "splash" | "dodge" | null
  "abilityValue": 0.2,    // armor: damage reduction %; splash: radius px; dodge: evade chance 0–1
  "cost": 9,
  "maxHp": 100,
  "radius": 10,           // collision radius in game units (pixels)
  "speed": 60,
  "range": 140,
  "damage": 30,
  "attackRate": 1.0,      // attacks per second
  "projectileSpeed": 320,
  "color": "#6be07a",     // player-side color
  "enemyColor": "#c44040" // enemy-side tint
}
```

`maxUnits` at the top level controls the player unit cap (default 5).

### Unit abilities (symmetric — affects both sides)
- **armor**: incoming projectile damage reduced by `abilityValue * 100`%
- **splash**: on hit, deal 50% damage to all units within `abilityValue` px of impact point
- **dodge**: `abilityValue * 100`% chance to negate a projectile hit (shows "MISS")

### Economy (tunable via `config.json`)
```json
{
  "startCost": 10,
  "killReward": 2,
  "matchDuration": 180,
  "suddenDeathDuration": 30
}
```
- Passive income: `+1 cost/second` per owned spawn point (hardcoded design decision, not configurable)

### Buildings
- Placed only at player-owned spawn points, 1 per spawn
- Must destroy building before the spawn point can take damage
- `effect: "income"` → adds `effectValue` cost/second (Farm)
- `effect: "maxUnits"` → adds `effectValue` to unit cap (Barracks), recalculated each frame via `getEffectiveMaxUnits()`
- `spawnRef` — object reference to the spawn point; used to find and remove building when spawn is captured
- Defined in `buildings.json`; add new types there without touching code
- Rendered via `makeBuildingMesh()` / `buildingMeshMap` in renderer.js (box + pyramid roof + HP bar)

### Enemy AI
- Spawn interval: 2.0s (1 spawn) → 1.5s (2 spawns) → 1.2s (3+ spawns)
- Priority: attack nearest player unit → attack nearest non-enemy spawn

### Spawn points
- 12 total: player × 3, enemy × 3, neutral × 6
- Neutral color: gold (`#d4af37`). Captured when HP → 0; owner = attacker
- Owning more spawns = more passive income + more enemy spawn points

### Timer / win conditions
- Match: 3 minutes. At time-up, higher spawn HP total wins.
- Equal HP → 30s Sudden Death overtime.
- Equal again → Draw.
- Instant win: opponent owns zero spawn points.

## Three.js renderer (`renderer.js`)

### Camera
Orthographic, dimetric isometric: elevation `arctan(0.5)`, azimuth 45°.
Frustum is exactly 960×640 — one world unit = one canvas pixel.

### Unit mesh pipeline
1. `loadModels()` — loads `models/<id>.glb`, auto-scales to `2.8 * radius` height
2. `makeUnitMesh(type, isEnemy)` — returns a `THREE.Group` (wrapper):
   - `modelClone` (scaled) is a child of the unscaled wrapper
   - HP bar `THREE.Sprite`s are attached to the wrapper at world-space `y`
   - If no GLB found, `makeFallbackMesh()` returns a procedural humanoid
3. `unitMeshMap` (`Map<unitRef, Object3D>`) tracks live units; dead ones are removed each frame

### Object pools
- 30 projectile spheres, 20 explosion torus rings, 20 damage-number sprites
- Damage number sprites support a `color` field (default `#ffdc50`, MISS uses `#88aaff`)

### Public API
```js
await Renderer.init(gameCanvas, spawnPoints, unitList)
Renderer.render(state, selectedUnitType, spawnPoints, now)
Renderer.getGroundIntersect(clientX, clientY)  // → {x, y} in game coords
```

## Map layout

Game boundary: `{ x: 120, y: 20, width: 720, height: 600 }` (canvas pixel coords, centered on 960×640 canvas).

```
(120,20)────────────────────────────────(840,20)
  │  [neutral] [neutral] [enemy]  [enemy]    │
  │                                          │
  │  [player]  [neutral]   [neutral] [enemy] │
  │                                          │
  │  [player]  [neutral]   [neutral] [enemy] │
  │                                          │
  │  [player]  [player]  [neutral]           │
(120,620)───────────────────────────────(840,620)
```

12 spawn points total: 3 player (bottom-left, left-middle, bottom-center), 3 enemy (top-right, right-middle, top-center), 6 neutral (top-left, bottom-right corners + 4 center-area symmetric positions). Diagonally symmetric.

Walls: 7 static rectangles defined in both `app.js` and `renderer.js` (must stay in sync).

## Adding a new unit type

1. Add entry to `units.json` (copy an existing one, change fields)
2. Place `models/<id>.glb` in the `models/` folder (optional — fallback mesh is used otherwise)
3. No code changes needed

## Common pitfalls

- **GLB models must be served over HTTP** — `file://` will fail on GLTFLoader fetch
- **WALLS array is duplicated** in `app.js` and `renderer.js` — keep them in sync
- **HP bar sprites must be children of the wrapper Group**, not the model clone, or their `position.y` gets multiplied by the model's bake-in scale
- **Capture logic uses `p.owner`** (attacker) not a toggle — neutral → player/enemy works correctly
- **Enemy attack stats** come from `e.damage`, `e.projectileSpeed`, `e.attackRate` on the unit object (populated from proto at spawn time) — do not hardcode
