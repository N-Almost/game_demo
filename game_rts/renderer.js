import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let _SkeletonUtils = null;

// ── Constants ─────────────────────────────────────────────────────────────────
const BOUNDARY    = { x: 120, y: 20, width: 720, height: 600 };
const SPAWN_RADIUS = 18;
const WALL_H       = 26;
const ISO_CX = BOUNDARY.x + BOUNDARY.width  / 2;  // 480
const ISO_CY = BOUNDARY.y + BOUNDARY.height / 2;  // 320

// ── Module state ──────────────────────────────────────────────────────────────
let threeRenderer, scene, camera, hitPlane;
let   lastTs    = 0;
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

// Unit mesh tracking — keyed by unit object reference (stable while object lives in array)
const unitMeshMap     = new Map();
const buildingMeshMap = new Map();

// Spawn point mesh tracking
let spawnMeshes = [];

// Object pools
const projectilePool = [];
const explosionPool  = [];
const damagePool     = [];

// Phase 6: GLB model cache
const modelTemplates = {};
const animClips      = {};

// Wall GLB cache — keyed by model name (e.g. "wall_stone")
const wallModels = {};

// Shared GLTFLoader instance (declared here so loadWallModels can use it)
const loader = new GLTFLoader();

// Unit config map — populated from units.json via init()
let unitCfgMap = {};

// ── Camera ────────────────────────────────────────────────────────────────────
function buildCamera() {
  // Frustum matches canvas 960×640 exactly (one world-unit = one canvas pixel)
  camera = new THREE.OrthographicCamera(-480, 480, 320, -320, 0.1, 5000);
  // Dimetric iso: elevation arctan(0.5) ≈ 26.57°, azimuth 45° — matches toIso() in app.js
  const elev = Math.atan(0.5);
  const azim = Math.PI / 4;
  const dist = 2000;
  camera.position.set(
    ISO_CX + dist * Math.cos(elev) * Math.sin(azim),
    dist  * Math.sin(elev),
    ISO_CY + dist * Math.cos(elev) * Math.cos(azim)
  );
  camera.lookAt(ISO_CX, 0, ISO_CY);
}

// ── Lights ────────────────────────────────────────────────────────────────────
function buildLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(ISO_CX + 400, 600, ISO_CY - 300);
  dir.castShadow            = true;
  dir.shadow.mapSize.width  = 1024;
  dir.shadow.mapSize.height = 1024;
  const sc = dir.shadow.camera;
  sc.left = -600; sc.right = 600; sc.top = 600; sc.bottom = -600;
  sc.near = 0.5;  sc.far = 3000;
  scene.add(dir);
}

// ── Ground ────────────────────────────────────────────────────────────────────
function buildGround() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(BOUNDARY.width, BOUNDARY.height),
    new THREE.MeshLambertMaterial({ color: 0x0d1020 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(ISO_CX, 0, ISO_CY);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Grid lines (slightly above ground to avoid z-fighting)
  const pts = [];
  const step = 80;
  for (let gx = BOUNDARY.x; gx <= BOUNDARY.x + BOUNDARY.width; gx += step)
    pts.push(gx, 0.3, BOUNDARY.y,  gx, 0.3, BOUNDARY.y + BOUNDARY.height);
  for (let gy = BOUNDARY.y; gy <= BOUNDARY.y + BOUNDARY.height; gy += step)
    pts.push(BOUNDARY.x, 0.3, gy,  BOUNDARY.x + BOUNDARY.width, 0.3, gy);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(gridGeo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045 })));

  // Boundary border
  const bPts = [
    BOUNDARY.x,                  0.3, BOUNDARY.y,
    BOUNDARY.x + BOUNDARY.width, 0.3, BOUNDARY.y,
    BOUNDARY.x + BOUNDARY.width, 0.3, BOUNDARY.y + BOUNDARY.height,
    BOUNDARY.x,                  0.3, BOUNDARY.y + BOUNDARY.height,
    BOUNDARY.x,                  0.3, BOUNDARY.y,
  ];
  const borderGeo = new THREE.BufferGeometry();
  borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPts, 3));
  scene.add(new THREE.Line(borderGeo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })));

  // Invisible hit plane for raycasting (covers full play area generously)
  hitPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  hitPlane.rotation.x = -Math.PI / 2;
  hitPlane.position.set(ISO_CX, 0, ISO_CY);
  scene.add(hitPlane);
}

// ── Walls ─────────────────────────────────────────────────────────────────────
async function loadWallModels(walls) {
  const types = [...new Set(walls.map(w => w.model).filter(Boolean))];
  await Promise.all(
    types.map(type =>
      new Promise(resolve => {
        loader.load(
          `models/${type}.glb`,
          gltf => {
            const root = gltf.scene;
            root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            wallModels[type] = root;
            resolve();
          },
          undefined,
          err => { console.warn(`[Renderer] ${type}.glb not loaded, using box fallback.`, err); resolve(); }
        );
      })
    )
  );
}

function makeWallMesh(w) {
  const group    = new THREE.Group();
  const template = w.model && wallModels[w.model];

  if (template) {
    const clone = template.clone(true);
    const box   = new THREE.Box3().setFromObject(clone);
    const size  = new THREE.Vector3();
    box.getSize(size);
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      const s = Math.min(w.width / size.x, WALL_H / size.y, w.height / size.z);
      clone.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(clone);
      clone.position.y = -box2.min.y;  // sit on ground
    }
    group.add(clone);
  } else {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w.width, WALL_H, w.height),
      [
        new THREE.MeshLambertMaterial({ color: 0x1e1e34 }),  // +X east
        new THREE.MeshLambertMaterial({ color: 0x1e1e34 }),  // -X west
        new THREE.MeshLambertMaterial({ color: 0x3a3a56 }),  // +Y top
        new THREE.MeshLambertMaterial({ color: 0x111128 }),  // -Y bottom
        new THREE.MeshLambertMaterial({ color: 0x26263e }),  // +Z south
        new THREE.MeshLambertMaterial({ color: 0x1a1a30 }),  // -Z north
      ]
    );
    mesh.position.y  = WALL_H / 2;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.position.set(w.x + w.width / 2, 0, w.y + w.height / 2);
  return group;
}

function buildWalls(walls) {
  for (const w of walls) scene.add(makeWallMesh(w));
}

// ── Spawn points ──────────────────────────────────────────────────────────────
function buildSpawnPoints(spawnPoints) {
  spawnMeshes = [];
  for (const sp of spawnPoints) {
    const hex = sp.owner === 'player' ? 0x6be07a
              : sp.owner === 'enemy'  ? 0xff7878
              :                         0xd4af37;  // neutral — gold

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(SPAWN_RADIUS, SPAWN_RADIUS, 2, 32),
      new THREE.MeshLambertMaterial({ color: hex, transparent: true, opacity: 0.28 })
    );
    disc.position.set(sp.x, 1, sp.y);
    scene.add(disc);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(SPAWN_RADIUS + 4, 1.5, 6, 32),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(sp.x, 2, sp.y);
    scene.add(ring);

    const barW  = SPAWN_RADIUS * 2.2;
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 4),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false })
    );
    barBg.rotation.x = -Math.PI / 2;
    barBg.position.set(sp.x, 3, sp.y - SPAWN_RADIUS - 10);
    scene.add(barBg);

    const barFg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 4),
      new THREE.MeshBasicMaterial({ color: hex, depthTest: false })
    );
    barFg.rotation.x = -Math.PI / 2;
    barFg.position.set(sp.x, 3.1, sp.y - SPAWN_RADIUS - 10);
    scene.add(barFg);

    spawnMeshes.push({ disc, ring, barFg, sp });
  }
}

// ── Object pools ──────────────────────────────────────────────────────────────
function buildPools() {
  // Projectile pool
  for (let i = 0; i < 30; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd86b })
    );
    m.visible = false;
    scene.add(m);
    projectilePool.push(m);
  }

  // Explosion pool (flat torus ring on XZ plane)
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.45, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0xffb450, transparent: true })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    explosionPool.push(m);
  }

  // Damage number sprites (CanvasTexture)
  for (let i = 0; i < 20; i++) {
    const cvs = document.createElement('canvas');
    cvs.width = 80; cvs.height = 40;
    const tex    = new THREE.CanvasTexture(cvs);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
    );
    sprite.scale.set(28, 14, 1);
    sprite.visible = false;
    scene.add(sprite);
    damagePool.push({ sprite, cvs, ctx: cvs.getContext('2d'), tex });
  }
}

// Deep-clone a GLB scene and properly rebind any SkinnedMesh skeletons.
// SkeletonUtils.clone() handles this natively; the manual path below is a fallback
// so the game works even when the CDN import fails.
function _cloneModel(template) {
  if (_SkeletonUtils) return _SkeletonUtils.clone(template);

  const clone = template.clone(true);

  // .clone(true) gives each SkinnedMesh a new bone hierarchy but leaves the
  // skeleton property pointing at the *original* bones.  Re-bind each
  // SkinnedMesh to the corresponding cloned bones (matched by name).
  const clonedBones = new Map();
  clone.traverse(n => { if (n.isBone) clonedBones.set(n.name, n); });

  clone.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const origSkel  = node.skeleton;
    const newBones  = origSkel.bones.map(b => clonedBones.get(b.name) ?? b);
    // Re-use the original boneInverses so the bind pose is preserved exactly.
    // Recalculating them from unupdated world matrices would give wrong deformation.
    const newInvs   = origSkel.boneInverses.map(m => m.clone());
    node.bind(new THREE.Skeleton(newBones, newInvs), node.bindMatrix);
  });

  return clone;
}

// ── Unit mesh factory ─────────────────────────────────────────────────────────
function makeUnitMesh(type, isEnemy) {
  if (modelTemplates[type]) {
    const modelClone = _cloneModel(modelTemplates[type]);

    // SkinnedMesh bounding spheres are often stale after cloning — disable culling so the
    // mesh is always drawn regardless of where Three.js thinks it is.
    modelClone.traverse(node => {
      node.visible       = true;
      node.frustumCulled = false;
      if (node.isMesh || node.isSkinnedMesh) node.castShadow = true;
    });

    const clips       = animClips[type] || {};
    const mixer       = new THREE.AnimationMixer(modelClone);
    const initialClip = clips.idle ? 'idle' : clips.walk ? 'walk' : (Object.keys(clips)[0] ?? null);
    if (initialClip) mixer.clipAction(clips[initialClip]).play();

    // Apply enemy tint
    if (isEnemy) {
      modelClone.traverse(node => {
        if (node.isMesh && node.material) {
          node.material = node.material.clone();
          node.material.color.multiplyScalar(0.6);
          node.material.color.r = Math.min(1, node.material.color.r + 0.35);
        }
      });
    }

    // Wrap in an unscaled Group so HP bar sprites sit at correct world-space height.
    // (modelClone already has scale baked in from loadModels; adding sprites directly
    //  to it would multiply their positions by that scale and push them off-screen.)
    const wrapper = new THREE.Group();
    wrapper.add(modelClone);

    const R   = 0.8 * (unitCfgMap[type]?.radius ?? 10);
    const hpY = modelTargetH(type) + 6;
    const { bgBar, fgBar, fgCvs, fgCtx, fgTex } = makeHpBarSprites(R, isEnemy);
    bgBar.position.y = hpY;
    fgBar.position.y = hpY;
    wrapper.add(bgBar, fgBar);

    wrapper.userData = { mixer, clips, currentClip: initialClip, isEnemy, fgBar, fgCvs, fgCtx, fgTex };
    return wrapper;
  }
  return makeFallbackMesh(type, isEnemy);
}

function makeFallbackMesh(type, isEnemy) {
  const cfg = unitCfgMap[type] ?? { radius: 10, color: '#6be07a', enemyColor: '#c44040' };
  const sc  = cfg.radius / 10;
  const H   = 28 * sc;
  const R   = 8  * sc;

  const bodyHex = new THREE.Color(isEnemy ? (cfg.enemyColor ?? cfg.color) : cfg.color).getHex();
  const skinHex = isEnemy ? 0xc47a6a : 0xf5c8a0;
  const legHex  = isEnemy ? 0x6b2a2a : 0x2a2a5a;

  const group = new THREE.Group();
  const bodyM = new THREE.MeshLambertMaterial({ color: bodyHex });
  const skinM = new THREE.MeshLambertMaterial({ color: skinHex });
  const legM  = new THREE.MeshLambertMaterial({ color: legHex  });

  // Leg pivots sit at hip height — rotating the pivot swings the leg from the hip
  const legGeo = new THREE.CylinderGeometry(R * 0.20, R * 0.22, H * 0.36, 6);
  const legPivots = [-0.28, 0.28].map(ox => {
    const pivot = new THREE.Group();
    pivot.position.set(R * ox, H * 0.36, 0);
    const mesh = new THREE.Mesh(legGeo, legM);
    mesh.position.y = -H * 0.18;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  });

  // Body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.54, R * 0.34, H * 0.44, 8), bodyM
  );
  const baseBodyY = H * 0.54;
  body.position.y = baseBodyY;
  group.add(body);

  // Arm pivots sit at shoulder height
  const armGeo = new THREE.CylinderGeometry(R * 0.17, R * 0.17, H * 0.30, 6);
  const armPivots = [[-R * 0.76, 0.18], [R * 0.76, -0.18]].map(([ox, rz]) => {
    const pivot = new THREE.Group();
    pivot.position.set(ox, H * 0.76, 0);
    const mesh = new THREE.Mesh(armGeo, bodyM);
    mesh.position.y = -H * 0.15;
    mesh.rotation.z = rz;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(R * 0.44, 8, 8), skinM);
  const baseHeadY = H * 0.76 + R * 0.44;
  head.position.y = baseHeadY;
  group.add(head);

  const hpY = baseHeadY + R * 0.44 + 5;
  const { bgBar, fgBar, fgCvs, fgCtx, fgTex } = makeHpBarSprites(R, isEnemy);
  bgBar.position.y = hpY;
  fgBar.position.y = hpY;
  group.add(bgBar, fgBar);

  group.userData = {
    fgBar, fgCvs, fgCtx, fgTex, isEnemy,
    parts: { legPivots, armPivots, body, head, baseBodyY, baseHeadY, H, R },
    animTime: 0,
  };
  return group;
}

function makeHpBarSprites(R, isEnemy) {
  const bgCvs = makeHpCanvas(0, false);
  const bgTex  = new THREE.CanvasTexture(bgCvs);
  const bgBar  = new THREE.Sprite(new THREE.SpriteMaterial({ map: bgTex, depthTest: false }));
  bgBar.scale.set(R * 3.2, R * 0.45, 1);

  const fgCvs = makeHpCanvas(1, isEnemy);
  const fgTex  = new THREE.CanvasTexture(fgCvs);
  const fgBar  = new THREE.Sprite(new THREE.SpriteMaterial({ map: fgTex, depthTest: false }));
  fgBar.scale.set(R * 3.2, R * 0.45, 1);

  return { bgBar, fgBar, fgCvs, fgCtx: fgCvs.getContext('2d'), fgTex };
}

function makeHpCanvas(fillRatio, isEnemy) {
  const cvs = document.createElement('canvas');
  cvs.width = 64; cvs.height = 8;
  const c = cvs.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0.6)';
  c.fillRect(0, 0, 64, 8);
  if (fillRatio > 0) {
    c.fillStyle = isEnemy ? '#ff7a7a' : '#6be07a';
    c.fillRect(0, 0, fillRatio * 64, 8);
  }
  return cvs;
}

function updateHpBar(mesh, hp, maxHp) {
  const { fgCtx, fgTex, isEnemy } = mesh.userData;
  if (!fgCtx) return;
  fgCtx.clearRect(0, 0, 64, 8);
  fgCtx.fillStyle = isEnemy ? '#ff7a7a' : '#6be07a';
  fgCtx.fillRect(0, 0, (hp / maxHp) * 64, 8);
  fgTex.needsUpdate = true;
}

// ── Building mesh factory ─────────────────────────────────────────────────────
function makeBuildingMesh(building) {
  if (building.effect === 'turret') return _makeTurretMesh(building);

  const R         = building.radius ?? 12;
  const H         = R * 2.2;
  const mainColor = new THREE.Color(building.color ?? '#d4af37');
  const darkColor = mainColor.clone().multiplyScalar(0.55);

  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(R * 1.7, H, R * 1.7),
    new THREE.MeshLambertMaterial({ color: mainColor })
  );
  body.position.y = H / 2;
  body.castShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(R * 1.4, H * 0.45, 4),
    new THREE.MeshLambertMaterial({ color: darkColor })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = H + H * 0.225;
  group.add(roof);

  const hpY = H + H * 0.45 + 7;
  const { bgBar, fgBar, fgCtx, fgTex } = makeHpBarSprites(R, false);
  bgBar.position.y = hpY;
  fgBar.position.y = hpY;
  group.add(bgBar, fgBar);

  group.userData = { fgBar, fgCtx, fgTex, isEnemy: false };
  return group;
}

function _makeTurretMesh(building) {
  const R         = building.radius ?? 10;
  const accentColor = new THREE.Color(building.color ?? '#e05555');
  const group     = new THREE.Group();

  // Base platform
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.1, R * 1.3, R * 0.7, 8),
    new THREE.MeshLambertMaterial({ color: 0x2e2e46 })
  );
  base.position.y = R * 0.35;
  base.castShadow = true;
  group.add(base);

  // Turret head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(R * 1.4, R * 0.9, R * 1.4),
    new THREE.MeshLambertMaterial({ color: accentColor })
  );
  head.position.y = R * 1.15;
  head.castShadow = true;
  group.add(head);

  // Gun barrel (pointing toward top of screen in iso = -Z direction)
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.15, R * 0.15, R * 1.6, 6),
    new THREE.MeshLambertMaterial({ color: 0x1a1a2e })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, R * 1.15, -R * 1.1);
  group.add(barrel);

  const hpY = R * 1.6 + 10;
  const { bgBar, fgBar, fgCtx, fgTex } = makeHpBarSprites(R, false);
  bgBar.position.y = hpY;
  fgBar.position.y = hpY;
  group.add(bgBar, fgBar);

  group.userData = { fgBar, fgCtx, fgTex, isEnemy: false };
  return group;
}

// ── Frame sync ────────────────────────────────────────────────────────────────
function syncBuildings(buildings) {
  const liveSet = new Set(buildings);

  for (const [ref, mesh] of buildingMeshMap) {
    if (!liveSet.has(ref)) {
      scene.remove(mesh);
      buildingMeshMap.delete(ref);
    }
  }

  for (const b of buildings) {
    if (!buildingMeshMap.has(b)) {
      const mesh = makeBuildingMesh(b);
      mesh.position.set(b.x, 0, b.y);
      scene.add(mesh);
      buildingMeshMap.set(b, mesh);
    }
    updateHpBar(buildingMeshMap.get(b), b.hp, b.maxHp);
  }
}

function syncUnits(units, enemies, delta) {
  const liveSet = new Set([...units, ...enemies]);

  // Remove meshes for dead units
  for (const [ref, mesh] of unitMeshMap) {
    if (!liveSet.has(ref)) {
      scene.remove(mesh);
      unitMeshMap.delete(ref);
    }
  }

  for (const [list, isEnemy] of [[units, false], [enemies, true]]) {
    for (const u of list) {
      if (!unitMeshMap.has(u)) {
        const mesh = makeUnitMesh(u.type, isEnemy);
        scene.add(mesh);
        unitMeshMap.set(u, mesh);
      }
      const mesh = unitMeshMap.get(u);
      mesh.position.set(u.x, 0, u.y);

      const spd = Math.hypot(u.vx || 0, u.vy || 0);
      if (spd > 1) {
        const target = Math.atan2(u.vx, u.vy);
        let diff = target - mesh.rotation.y;
        // Wrap diff to [-π, π] so we always rotate the short way round
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        mesh.rotation.y += diff * Math.min(1, delta * 14);
      }

      updateHpBar(mesh, u.hp, u.maxHp);
      advanceAnimation(mesh, u, delta);
    }
  }
}

function _animateFallback(mesh, unit, delta) {
  const { parts, animTime } = mesh.userData;
  if (!parts) return;
  const t = animTime + delta;
  mesh.userData.animTime = t;

  const { legPivots, armPivots, body, head, baseBodyY, baseHeadY } = parts;
  const spd       = Math.hypot(unit.vx || 0, unit.vy || 0);
  const attacking = unit.attackTimer > 0 && unit.attackTimer < 0.45;

  if (attacking) {
    // Rapid arm thrust — both arms swing forward together
    const thrust = Math.sin(t * 18) * 0.55;
    armPivots[0].rotation.x = -0.4 + thrust;
    armPivots[1].rotation.x = -0.4 + thrust;
    legPivots[0].rotation.x = 0;
    legPivots[1].rotation.x = 0;
    body.position.y = baseBodyY + Math.sin(t * 18) * 0.8;
    head.rotation.x = 0;
  } else if (spd > 8) {
    // Walk: legs alternate, arms counter-swing, body bobs
    const swing = Math.sin(t * 7);
    legPivots[0].rotation.x =  swing * 0.55;
    legPivots[1].rotation.x = -swing * 0.55;
    armPivots[0].rotation.x = -swing * 0.40;
    armPivots[1].rotation.x =  swing * 0.40;
    body.position.y  = baseBodyY + Math.abs(swing) * 1.2;
    head.rotation.x  = 0;
    head.position.y  = baseHeadY + Math.abs(swing) * 0.5;
  } else {
    // Idle: gentle breathing bob
    const breath = Math.sin(t * 1.8);
    legPivots[0].rotation.x = 0;
    legPivots[1].rotation.x = 0;
    armPivots[0].rotation.x = breath * 0.06;
    armPivots[1].rotation.x = breath * 0.06;
    body.position.y = baseBodyY + breath * 0.6;
    head.position.y = baseHeadY + breath * 0.4;
    head.rotation.x = breath * 0.04;
  }
}

function advanceAnimation(mesh, unit, delta) {
  const { mixer, clips, currentClip } = mesh.userData;

  if (mixer && clips) {
    // GLB skeletal animation
    const spd    = Math.hypot(unit.vx || 0, unit.vy || 0);
    const target = clips.attack && unit.attackTimer > 0 && unit.attackTimer < 0.3 ? 'attack'
                 : spd > 8 ? 'walk'
                 : clips.idle ? 'idle' : 'walk';
    if (target !== currentClip && clips[target]) {
      if (currentClip && clips[currentClip]) mixer.clipAction(clips[currentClip]).fadeOut(0.15);
      mixer.clipAction(clips[target]).reset().fadeIn(0.15).play();
      mesh.userData.currentClip = target;
    }
    mixer.update(delta);
  } else {
    // Procedural animation for fallback mesh
    _animateFallback(mesh, unit, delta);
  }
}

function syncProjectiles(projectiles) {
  projectilePool.forEach(m => { m.visible = false; });
  const n = Math.min(projectiles.length, projectilePool.length);
  for (let i = 0; i < n; i++) {
    const p = projectiles[i];
    projectilePool[i].position.set(p.x, 7, p.y);
    projectilePool[i].material.color.setHex(p.fromTurret ? 0xff8c42 : p.owner === 'player' ? 0xffd86b : 0xff6b6b);
    projectilePool[i].visible = true;
  }
}

function syncExplosions(explosions) {
  explosionPool.forEach(m => { m.visible = false; });
  const n = Math.min(explosions.length, explosionPool.length);
  for (let i = 0; i < n; i++) {
    const exp = explosions[i];
    const s   = exp.size * 0.55;
    explosionPool[i].scale.set(s, s, s);
    explosionPool[i].position.set(exp.x, 1, exp.y);
    explosionPool[i].material.opacity = exp.alpha * 0.7;
    explosionPool[i].visible = true;
  }
}

function syncDamageNumbers(damageNumbers) {
  damagePool.forEach(d => { d.sprite.visible = false; });
  const n = Math.min(damageNumbers.length, damagePool.length);
  for (let i = 0; i < n; i++) {
    const dmg = damageNumbers[i];
    const { sprite, ctx, cvs, tex } = damagePool[i];
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.font         = typeof dmg.damage === 'string' ? 'bold 18px Arial' : 'bold 24px Arial';
    ctx.fillStyle    = dmg.color ?? '#ffdc50';
    ctx.globalAlpha  = dmg.alpha;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(dmg.damage), 40, 20);
    ctx.globalAlpha  = 1;
    tex.needsUpdate  = true;
    sprite.material.opacity = dmg.alpha;
    sprite.position.set(dmg.x, 20, dmg.y);
    sprite.visible = true;
  }
}

function syncSpawnPoints(_spawnPoints, selectedUnitType, now) {
  for (const { disc, ring, barFg, sp } of spawnMeshes) {
    const hex = sp.owner === 'player' ? 0x6be07a
              : sp.owner === 'enemy'  ? 0xff7878
              :                         0xd4af37;
    disc.material.color.setHex(hex);
    ring.material.color.setHex(hex);
    barFg.material.color.setHex(hex);
    barFg.scale.x = sp.hp / sp.maxHp;

    if (sp.owner === 'player' && selectedUnitType) {
      const pulse = (Math.sin(now / 280) + 1) / 2;
      ring.scale.set(1 + pulse * 0.3, 1, 1 + pulse * 0.3);
      ring.material.opacity = 0.3 + pulse * 0.55;
    } else {
      ring.scale.set(1, 1, 1);
      ring.material.opacity = 0.7;
    }
  }
}

// ── Phase 6: Model loading ────────────────────────────────────────────────────
function buildClipMap(animations) {
  const map = {};
  for (const clip of animations) {
    const n = clip.name.toLowerCase();
    const s = _stripRootMotion(clip);
    if (n.includes('idle'))                       map.idle   = s;
    if (n.includes('walk') || n.includes('run'))  map.walk   = s;
    if (n.includes('attack') || n.includes('hit') || n.includes('punch') || n.includes('slash')) map.attack = s;
  }

  // Fallback: if keywords matched nothing, assign by position (walk=first, attack=second)
  if (!map.idle && !map.walk && !map.attack && animations.length > 0) {
    console.warn('[Renderer] No keyword match — raw names:', animations.map(a => a.name));
    map.walk = _stripRootMotion(animations[0]);
    if (animations.length > 1) map.attack = _stripRootMotion(animations[1]);
  }
  return map;
}

// Remove position/scale tracks on the scene root (root-motion) so animated models
// don't drift away from their game-logic position.
function _stripRootMotion(clip) {
  const kept = clip.tracks.filter(t => {
    const parts = t.name.split('.');
    const prop  = parts[parts.length - 1];
    // Keep rotation always; drop position & scale on the root node (index 0 or named 'root')
    if (prop === 'quaternion') return true;
    const nodeName = parts[0].toLowerCase();
    if ((nodeName === '' || nodeName === 'root' || nodeName === 'armature') && prop === 'position') return false;
    return true;
  });
  if (kept.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, kept);
}

// Target height for auto-scaling GLB: derived from unit radius in config
function modelTargetH(type) {
  return 2.8 * (unitCfgMap[type]?.radius ?? 10);
}

async function loadModels() {
  try {
    const mod = await import('three/addons/utils/SkeletonUtils.js');
    _SkeletonUtils = mod.SkeletonUtils;
  } catch (e) {
    console.warn('[Renderer] SkeletonUtils unavailable, using .clone() fallback');
  }

  await Promise.allSettled(
    Object.keys(unitCfgMap).map(type =>
      loader.loadAsync(`models/${type}.glb`)
        .then(gltf => {
          const root = gltf.scene;

          // Auto-scale: fit model bounding-box height to game world units
          const box  = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          box.getSize(size);
          if (size.y > 0) {
            const s = modelTargetH(type) / size.y;
            root.scale.setScalar(s);
            box.setFromObject(root);
            root.position.y = -box.min.y;  // feet at y=0
          }

          modelTemplates[type] = root;
          animClips[type] = buildClipMap(gltf.animations);
          console.log(`[Renderer] Loaded ${type}.glb | raw clips: [${gltf.animations.map(a => a.name).join(', ')}] | mapped: [${Object.keys(animClips[type]).join(', ')}]`);
        })
        .catch(err => console.warn(`[Renderer] ${type}.glb not loaded, using fallback.`, err))
    )
  );
}

// ── Public API ────────────────────────────────────────────────────────────────
async function init(_gameCanvas, spawnPoints, unitList = [], walls = [], enemyUnitList = []) {
  // Player entries take precedence; enemy-only types are added without overwriting
  unitCfgMap = Object.fromEntries(unitList.map(u => [u.id, u]));
  for (const u of enemyUnitList) {
    if (!unitCfgMap[u.id]) unitCfgMap[u.id] = u;
  }

  const canvas = document.getElementById('threeCanvas');

  threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  threeRenderer.setSize(960, 640, false);
  threeRenderer.setClearColor(0x0a0a12);
  threeRenderer.shadowMap.enabled = true;
  threeRenderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  buildCamera();
  buildLights();
  buildGround();
  buildSpawnPoints(spawnPoints);
  buildPools();
  await Promise.all([loadModels(), loadWallModels(walls)]);
  buildWalls(walls);
}

function render(state, selectedUnitType, spawnPoints, now) {
  const delta = lastTs ? Math.min((now - lastTs) / 1000, 0.05) : 0;
  lastTs = now;
  syncUnits(state.units, state.enemies, delta);
  syncBuildings(state.buildings ?? []);
  syncProjectiles(state.projectiles);
  syncExplosions(state.explosions);
  syncDamageNumbers(state.damageNumbers);
  syncSpawnPoints(spawnPoints, selectedUnitType, now);
  threeRenderer.render(scene, camera);
}

function getGroundIntersect(clientX, clientY) {
  const rect = document.getElementById('threeCanvas').getBoundingClientRect();
  pointer.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  pointer.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(hitPlane);
  if (!hits.length) return null;
  return { x: hits[0].point.x, y: hits[0].point.z };
}

window.Renderer = { init, render, getGroundIntersect };
window.dispatchEvent(new CustomEvent('renderer-ready'));
