# Simple RTS Demo (Drag & Drop)

Lightweight single-file demo showing a minimal RTS-like experience.

 - Drag unit icons from the left palette onto the map to spawn friendly units.
	 - Units move automatically inside a visible boundary box.
	 - Some areas are blocked by walls and only specific spawn points can be used.
	 - Enemies spawn from dedicated enemy spawn points on the map.
	 - Spawn points have HP and will convert ownership when destroyed.
 - Game starts with cost 10. Each Soldier costs 1 to spawn, and killing an enemy gives +2 cost.
 - Enemies periodically spawn from enemy spawn points and move toward player units.

How to run:
1. Open `index.html` in your browser (double-click or run a local static server).

Optional: run a local server (recommended) from the project folder:

```bash
# using Python 3
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

Files:
- `index.html` — main page and UI
- `style.css` — styling
- `app.js` — game logic

Next steps you may want:
- Add pathfinding (A*), selection box, multiple selection, move formations.
- Add animations and nicer graphics.
