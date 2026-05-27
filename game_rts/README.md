# Simple RTS

Browser-based real-time strategy game targeting Android (landscape) and desktop.  
Two sides fight over 12 spawn points on a fixed map. The player who controls more
spawn points — or eliminates all enemy spawn points first — wins.

## How to run

GLB models and JSON configs are loaded via `fetch`, so the game **must be served
over HTTP** (not opened as a local `file://`).

```bash
python3 -m http.server 8080
# open http://localhost:8080/game_rts/menu.html
```

## Pages

| File | Purpose |
|------|---------|
| `menu.html` | Main menu — start game, view profile, go to upgrades |
| `index.html` | Game screen |
| `upgrade.html` | Spend gold to permanently upgrade unit stats |

## Architecture

### Modules (`js/`)

| File | Role |
|------|------|
| `main.js` | Game loop, win-condition checks, wave progression |
| `state.js` | Shared mutable state (`state`, `session`, `SPAWN_POINTS`) |
| `config.js` | Loads all JSON configs, applies per-wave enemy scaling |
| `ui.js` | HUD rendering — cost bar, unit monitor, game-over overlay |
| `input.js` | Touch/click handling, unit/building selection, rally & defend |
| `units.js` | Player unit AI, movement, attack, spawn cooldowns |
| `enemies.js` | Enemy spawn logic and AI |
| `combat.js` | Projectile physics, hit detection, melee, turret fire |
| `helpers.js` | LOS raycasting, steering, nearest-target queries |
| `constants.js` | Map boundary rect |
| `profile.js` | Player profile in `localStorage` — gold, stats, win/loss |
| `upgrades.js` | Permanent unit upgrades stored in `localStorage` |

### Renderer (`renderer.js`)

Three.js r165, orthographic isometric camera (elevation `arctan(0.5)`, azimuth 45°).  
Frustum is 960 × 640 — one world unit = one canvas pixel.

- GLB models loaded from `models/<id>.glb`; procedural fallback mesh if missing
- Unit HP bars: `THREE.Sprite` (always faces camera)
- Spawn HP ring: canvas arc texture on a flat `PlaneGeometry`
- Object pools: 30 projectiles, 20 explosions, 20 damage numbers

### Data files

| File | Content |
|------|---------|
| `units.json` | Player unit types (single source of truth) |
| `enemy_units.json` | Enemy unit types |
| `buildings.json` | Building types (Farm, Barracks, Turret) |
| `config.json` | `startCost`, `matchDuration`, `suddenDeathDuration` |
| `enemy_config.json` | Enemy scaling per wave (`waveScaling`) |
| `walls.json` | Static wall rectangles |

## Game systems

### Economy
- Start with 10 cost
- **+1 cost/s** per owned spawn point (passive)
- **+2 cost** per enemy unit killed
- Farm building: **+2 cost/s** bonus income
- Win a wave → earn **10 + wave × 5 gold** (persistent across sessions)

### Units

| Unit | Ability | Cost | Notes |
|------|---------|------|-------|
| Soldier | Armor 20% | 9 | Reduces all incoming damage by 20% |
| Heavy | Splash 50px | 18 | Projectile deals 50% damage in 50px radius on hit |
| Fast | Dodge 35% | 6 | 35% chance to completely negate a hit |

### Buildings (place at owned spawn points, 1 per spawn)
| Building | Effect | Cost |
|----------|--------|------|
| Farm | +2 cost/s income | 5 |
| Barracks | +2 unit cap | 8 |
| Turret | Auto-attacks enemies in range 200 | 14 |

### Waves
- Win condition: opponent owns 0 spawns, or higher spawn HP total when timer expires
- On win → wave advances, enemy scaling increases (HP / damage / speed / spawn rate)
- Sudden death: 30 s overtime if HP is tied at time-up

### Unit AI modes
- **Normal** — move toward nearest enemy or uncaptured spawn
- **Rally** — advance toward a designated spawn point (tap minimap or spawn)
- **Defend** — hold at nearest player-owned spawn, only engage in range

### Permanent upgrades (persist across sessions)
4 stats × 3 levels per unit, purchased with gold in `upgrade.html`:

| Stat | Bonus/level |
|------|------------|
| HP | +20 HP |
| Damage | +8 DMG |
| Speed | +6 SPD |
| Atk Speed | +0.2 /s |

## Adding content

**New unit type** — add entry to `units.json`, place `models/<id>.glb` in `models/` (optional).  
**New building** — add entry to `buildings.json`, handle `effect` key in `combat.js` / `ui.js`.  
No code changes needed for data-only additions.

## Player profile (`localStorage`)

| Key | Content |
|-----|---------|
| `rts_profile` | Name, gold, wins/losses, lifetime stats |
| `rts_upgrades` | Per-unit per-stat upgrade levels |
| `rts_wave` | Current wave number |
