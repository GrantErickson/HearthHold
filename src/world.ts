import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { mulberry32 } from './util';
import {
  treeGeo, stumpGeo, rockGeo, pebbleGeo, goldGeo, crystalGeo, crystalStubGeo, makeMesh, mountainGeo, bushGeo, tentGeo, fireGeo,
  mineGeo, quarrySignGeo, caveGeo, grassGeo, torchGeo, lampGeo, TREE_VARIANTS, Mat, groundMaterial, ensureEmit,
} from './models';
import type { ResType } from './state';
import { burst, pop } from './fx';
import { Env, type PLight } from './env';
import { easeOutBack } from './util';

export interface Rect {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface ResNode {
  type: ResType;
  x: number;
  z: number;
  /** Radius used for harvest reach. */
  r: number;
  units: number;
  state: 'grown' | 'regrow' | 'hidden';
  timer: number;
  group: THREE.Group;
  full: THREE.Mesh;
  stump: THREE.Mesh;
  baseScale: number;
  grow: number;
  shake: number;
  reservedBy: object | null;
}

export const nodes: ResNode[] = [];
const reserved: Rect[] = [];
const rng = mulberry32(1337);

const WZ = CFG.map.wallZ;
export const MINE_POS = { x: 27, z: 13.2 };
export const QUARRY_SIGN_POS = { x: 17.2, z: 9.8 };
export const CAVE_POS = { x: 23, z: 30.4 };

/** Playable-area zones (used for painting, grass and chest placement). */
export const ZONES = {
  forest: { x0: -29, x1: -15.5, z0: -17, z1: 38.5 },
  quarry: { x0: 18, x1: 28.5, z0: -6, z1: 9.5 },
  gold: { x0: 18.5, x1: 28.5, z0: 16, z1: 28.5 },
  crystal: { x0: 16.5, x1: 28.5, z0: 32.5, z1: 38.5 },
};

type Pt = [number, number];
const ROADS: { pts: Pt[]; w: number }[] = [
  { pts: [[0, -70], [0, -26], [0, -3]], w: 3.4 },
  { pts: [[-3, 1], [-9, 2.6], [-16, 3.5]], w: 2.4 },
  { pts: [[3, 1], [9, 2.6], [18, 3]], w: 2.4 },
  { pts: [[-4, 6], [-11, 17.5]], w: 2 },
  { pts: [[4, 6], [11, 17.5], [18, 15]], w: 2 },
  { pts: [[0, 16.5], [0, 23]], w: 2 },
  { pts: [[11, 17.5], [14.5, 27], [18, 32]], w: 1.8 },
];

function distSeg(px: number, pz: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}
function nearRoad(x: number, z: number, margin: number): boolean {
  for (const r of ROADS) for (let i = 1; i < r.pts.length; i++) if (distSeg(x, z, r.pts[i - 1], r.pts[i]) < r.w / 2 + margin) return true;
  return false;
}
const inZone = (x: number, z: number, zn: { x0: number; x1: number; z0: number; z1: number }, m = 0) =>
  x > zn.x0 - m && x < zn.x1 + m && z > zn.z0 - m && z < zn.z1 + m;

// Ground texture covers x −80…80, z −95…65 (centred on z = −15).
const GW = 160;
const GZ = -15;

function paintGround(px: number): THREE.CanvasTexture {
  const PX = px;
  const S = PX / GW;
  const c2 = (x: number, z: number): [number, number] => [((x + GW / 2) / GW) * PX, ((z - (GZ - GW / 2)) / GW) * PX];
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const g = cv.getContext('2d')!;
  const r = mulberry32(7);
  g.fillStyle = '#5c973c';
  g.fillRect(0, 0, PX, PX);

  const blot = (x0: number, z0: number, x1: number, z1: number, n: number, colors: string[], rmin: number, rmax: number) => {
    for (let i = 0; i < n; i++) {
      const [qx, qz] = c2(x0 + r() * (x1 - x0), z0 + r() * (z1 - z0));
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.beginPath();
      g.ellipse(qx, qz, (rmin + r() * (rmax - rmin)) * S, (rmin + r() * (rmax - rmin)) * S * 0.8, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  };
  const rect = (x0: number, z0: number, x1: number, z1: number, col: string) => {
    const [ax, az] = c2(x0, z0);
    const [bx, bz] = c2(x1, z1);
    g.fillStyle = col;
    g.fillRect(ax, az, bx - ax, bz - az);
  };

  // Darker outer grass with patches
  blot(-80, -95, 80, 65, 500, ['rgba(80,140,52,0.5)', 'rgba(70,128,46,0.5)', 'rgba(96,152,60,0.45)'], 2, 6);
  // playable area
  rect(-31, -66, 31, 41, '#78bd4c');
  blot(-31, -66, 31, 41, 380, ['rgba(140,205,90,0.35)', 'rgba(100,170,60,0.35)', 'rgba(120,190,70,0.4)'], 1.5, 4);
  // north field: drier grass
  rect(-31, -66, 31, WZ, 'rgba(190,190,90,0.22)');
  blot(-31, -66, 31, WZ - 1, 140, ['rgba(200,190,100,0.3)', 'rgba(150,170,80,0.3)', 'rgba(170,150,90,0.25)'], 1.5, 3.5);
  // trodden yard between the wall and the towers
  blot(-30, WZ + 0.5, 30, WZ + 9, 120, ['rgba(150,128,86,0.28)', 'rgba(130,112,76,0.25)'], 1, 2.5);
  // forest floor
  const f = ZONES.forest;
  blot(f.x0 - 1, f.z0, f.x1 + 0.5, f.z1 + 1, 170, ['rgba(60,120,45,0.55)', 'rgba(70,135,50,0.5)', 'rgba(85,120,50,0.45)'], 1.5, 3.5);
  // quarry gravel
  const q = ZONES.quarry;
  blot(q.x0 - 1, q.z0 - 1, q.x1 + 1.5, q.z1 + 1, 170, ['rgba(176,164,138,0.55)', 'rgba(150,138,112,0.5)', 'rgba(192,182,160,0.5)'], 0.4, 1.3);
  // gold field
  const gd = ZONES.gold;
  blot(gd.x0 - 1, gd.z0 - 1.5, gd.x1 + 1.5, gd.z1 + 1, 150, ['rgba(168,138,96,0.5)', 'rgba(140,118,86,0.45)', 'rgba(182,152,100,0.45)'], 0.4, 1.3);
  // crystal field
  const cr = ZONES.crystal;
  blot(cr.x0 - 1, cr.z0 - 2, cr.x1 + 1.5, cr.z1 + 1, 150, ['rgba(110,104,130,0.55)', 'rgba(90,88,116,0.5)', 'rgba(130,120,150,0.45)'], 0.4, 1.3);

  // roads
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const rd of ROADS) {
    for (const [col, extra] of [['#a88b5c', 0.7], ['#c9a874', 0]] as const) {
      g.strokeStyle = col;
      g.lineWidth = (rd.w + extra) * S;
      g.beginPath();
      rd.pts.forEach(([x, z], i) => {
        const [qx, qz] = c2(x, z);
        if (i) g.lineTo(qx, qz);
        else g.moveTo(qx, qz);
      });
      g.stroke();
    }
  }
  // cobbles on the main road
  for (let i = 0; i < 260; i++) {
    const z = -66 + r() * 63;
    const [qx, qz] = c2((r() - 0.5) * 2.8, z);
    g.fillStyle = r() < 0.5 ? 'rgba(150,120,80,0.35)' : 'rgba(220,196,150,0.3)';
    g.fillRect(qx, qz, (0.25 + r() * 0.3) * S, (0.2 + r() * 0.2) * S);
  }
  // plaza
  for (const [col, extra] of [['#a88b5c', 0.5], ['#d2b48a', 0]] as const) {
    g.fillStyle = col;
    const [qx, qz] = c2(0, 1.8);
    g.beginPath();
    g.ellipse(qx, qz, (8.5 + extra) * S, (5.8 + extra) * S, 0, 0, Math.PI * 2);
    g.fill();
  }
  // plaza flagstones
  for (let i = 0; i < 120; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const [qx, qz] = c2(Math.cos(a) * 7.8 * d, 1.8 + Math.sin(a) * 5.2 * d);
    g.fillStyle = r() < 0.5 ? 'rgba(180,150,110,0.35)' : 'rgba(236,214,172,0.35)';
    g.fillRect(qx, qz, (0.5 + r() * 0.5) * S, (0.4 + r() * 0.3) * S);
  }
  // wall foundation strip
  rect(-30, WZ - 1, 30, WZ + 1, 'rgba(120,95,60,0.45)');

  // fine grain
  const grain = Math.round(14000 * (PX / 1024) ** 2);
  for (let i = 0; i < grain; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.fillRect(r() * PX, r() * PX, 1.5 + r() * 2.5, 1.5 + r() * 2.5);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function isFree(x: number, z: number, margin: number): boolean {
  for (const q of reserved) if (Math.abs(x - q.x) < q.hw + margin && Math.abs(z - q.z) < q.hd + margin) return false;
  return true;
}

function scatter(x0: number, x1: number, z0: number, z1: number, spacing: number, max: number, margin: number, tries = 1500): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < tries && pts.length < max; i++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    if (!isFree(x, z, margin)) continue;
    if (pts.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < spacing * spacing)) continue;
    pts.push([x, z]);
  }
  return pts;
}

function addNode(type: ResType, x: number, z: number, variant: number, active: boolean): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rng() * Math.PI * 2;
  const geo = type === 'wood' ? treeGeo(variant) : type === 'stone' ? rockGeo(variant) : type === 'gold' ? goldGeo(variant) : crystalGeo(variant);
  const full = makeMesh(geo, true, true, type === 'wood' ? Mat.foliage : Mat.vc);
  const stump = makeMesh(type === 'wood' ? stumpGeo() : type === 'crystal' ? crystalStubGeo() : pebbleGeo(), false);
  stump.visible = false;
  const baseScale = type === 'wood' ? 0.9 + rng() * 0.3 : 0.85 + rng() * 0.25;
  full.scale.setScalar(baseScale);
  group.add(full, stump);
  group.visible = active;
  scene.add(group);
  nodes.push({
    type, x, z, r: type === 'wood' ? 0.45 : 0.95 * baseScale, units: CFG.res[type].units,
    state: active ? 'grown' : 'hidden', timer: 0, group, full, stump, baseScale, grow: active ? 1 : 0, shake: 0, reservedBy: null,
  });
}

function addInstanced(geo: THREE.BufferGeometry, pts: Pt[], scaleMin: number, scaleMax: number, cast: boolean, mat: THREE.Material = Mat.foliage): void {
  if (!pts.length) return;
  const im = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  pts.forEach(([x, z], i) => {
    const k = scaleMin + rng() * (scaleMax - scaleMin);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(p.set(x, 0, z), q, s.set(k, k, k));
    im.setMatrixAt(i, m);
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  scene.add(im);
}

const flames: THREE.Mesh[] = [];
let caveLight: PLight | null = null;

function torch(x: number, z: number): void {
  const t = makeMesh(torchGeo(), true, false);
  t.position.set(x, 0, z);
  scene.add(t);
  flames.push(t);
  Env.addGlow(x, 2.3, z, 0xff9a3a, 2.6);
}

function lamp(x: number, z: number): void {
  const l = makeMesh(lampGeo(), true, false);
  l.position.set(x, 0, z);
  scene.add(l);
  Env.addGlow(x, 2.45, z, 0xffd27a, 2.2, true);
}

export const World = {
  init(reservedRects: Rect[], lowSpec: boolean): void {
    reserved.push(...reservedRects);
    reserved.push({ x: CAVE_POS.x, z: CAVE_POS.z, hw: 4.2, hd: 1.6 });

    const ground = new THREE.Mesh(ensureEmit(new THREE.PlaneGeometry(GW, GW)), groundMaterial(paintGround(lowSpec ? 1024 : 2048)));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, GZ);
    ground.receiveShadow = true;
    scene.add(ground);

    this.decor(lowSpec);

    // Harvestable nodes
    const f = ZONES.forest;
    for (const [x, z] of scatter(f.x0, f.x1, f.z0, f.z1, 2.3, 76, 1.0)) addNode('wood', x, z, Math.floor(rng() * TREE_VARIANTS), true);
    const q = ZONES.quarry;
    for (const [x, z] of scatter(q.x0, q.x1, q.z0, q.z1, 2.9, 14, 0.9)) addNode('stone', x, z, Math.floor(rng() * 3), false);
    const gd = ZONES.gold;
    for (const [x, z] of scatter(gd.x0, gd.x1, gd.z0, gd.z1, 3.0, 10, 0.9)) addNode('gold', x, z, Math.floor(rng() * 3), false);
    const cr = ZONES.crystal;
    for (const [x, z] of scatter(cr.x0, cr.x1, cr.z0, cr.z1, 3.0, 9, 0.9)) addNode('crystal', x, z, Math.floor(rng() * 3), false);

    this.grass(lowSpec);
  },

  grass(lowSpec: boolean): void {
    const n = lowSpec ? 1300 : 3200;
    const pts: Pt[][] = [[], [], []];
    let tries = 0;
    while (pts[0].length + pts[1].length + pts[2].length < n && tries++ < n * 6) {
      const x = -30.5 + rng() * 61;
      const z = -65 + rng() * 105;
      if (nearRoad(x, z, 0.3)) continue;
      if (!isFree(x, z, 0.2)) continue;
      if (inZone(x, z, ZONES.quarry, 0.5) || inZone(x, z, ZONES.gold, 0.5) || inZone(x, z, ZONES.crystal, 0.5)) continue;
      if (((x / 8.5) ** 2 + ((z - 1.8) / 5.8) ** 2) < 1.05) continue;
      if (Math.abs(z - WZ) < 1.3) continue;
      const v = rng() < 0.12 ? 2 : rng() < 0.5 ? 1 : 0;
      pts[v].push([x, z]);
    }
    pts.forEach((p, v) => addInstanced(grassGeo(v), p, 0.8, 1.5, false, Mat.grass));
  },

  decor(lowSpec: boolean): void {
    // Mountains framing the map
    const mts: [number, number, number][] = [];
    for (let z = -96; z <= 62; z += 11) {
      mts.push([-45 - rng() * 6, z + rng() * 4, Math.floor(rng() * 3)]);
      mts.push([45 + rng() * 6, z + rng() * 4, Math.floor(rng() * 3)]);
    }
    for (let x = -36; x <= 36; x += 12) {
      mts.push([x + rng() * 4, -90 - rng() * 5, Math.floor(rng() * 3)]);
      mts.push([x + rng() * 4, 60 + rng() * 5, Math.floor(rng() * 3)]);
    }
    for (const [x, z, v] of mts) {
      const m = makeMesh(mountainGeo(v), false, false);
      m.position.set(x, 0, z);
      scene.add(m);
    }
    // Border forest (instanced, purely decorative)
    const border: Pt[] = [];
    const band = (x0: number, x1: number, z0: number, z1: number, n: number) => {
      for (let i = 0; i < n; i++) border.push([x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0)]);
    };
    const k = lowSpec ? 0.6 : 1;
    band(-40, -31, -84, 54, 200 * k);
    band(31, 40, -84, 54, 200 * k);
    band(-31, 31, 41.5, 54, 110 * k);
    band(-31, 31, -84, -71, 110 * k);
    const a = border.filter((_, i) => i % 2 === 0);
    const b = border.filter((_, i) => i % 2 === 1);
    addInstanced(treeGeo(0), a, 1.0, 1.5, true);
    addInstanced(treeGeo(2), b, 1.0, 1.6, true);

    // Bushes and flowers around the village
    const bushes = scatter(-14, 15, 15, 40, 2.6, 30, 0.8, 600).concat(scatter(-30, 30, -64, -24, 4, 34, 0.5, 600));
    addInstanced(bushGeo(0), bushes.filter((_, i) => i % 2 === 0), 0.8, 1.3, true);
    addInstanced(bushGeo(1), bushes.filter((_, i) => i % 2 === 1), 0.8, 1.2, true);

    // Raider camp beyond the north edge
    for (const [x, z, ry] of [[-14, -70, 0.4], [-5, -72.5, -0.2], [7, -71, 0.3], [16, -69.5, -0.5], [-22, -68, 0.8], [24, -72, 0.2]] as const) {
      const t = makeMesh(tentGeo());
      t.position.set(x, 0, z);
      t.rotation.y = ry;
      scene.add(t);
    }
    for (const [x, z] of [[1.5, -68.5], [-18, -66.5], [20, -66]] as const) {
      const fire = makeMesh(fireGeo(), false);
      fire.position.set(x, 0, z);
      scene.add(fire);
      flames.push(fire);
      Env.addGlow(x, 0.8, z, 0xff7a2a, 4, false);
    }
    Env.addLight(1.5, 1.2, -68.5, 0xff8a3a, 6, 10, true);
    Env.addLight(0, 5, 8.5, 0xffb060, 9, 16, false);
    Env.addLight(0, 3.2, WZ + 2.5, 0xff9a40, 8, 18, false);
    Env.addLight(-8, 3, 1.8, 0xffb060, 5, 11, false);
    caveLight = Env.addLight(CAVE_POS.x, 2, CAVE_POS.z + 2, 0x7fe3ff, 0, 10, true);

    // Crystal cavern entrance (shown when opened) is placed by openArea.
    // Torches along the back of the wall and lamps in the village.
    for (const x of [-30, -20, -10, 10, 20, 30]) torch(x, WZ + 1.6);
    torch(-2.2, WZ + 1.6);
    torch(2.2, WZ + 1.6);
    for (const [x, z] of [[-5, -3.4], [5, -3.4], [-2.6, 8.6], [2.6, 8.6], [-3.0, 22.6], [3.0, 22.6], [-5.2, 16.4], [5.2, 16.4]] as const) lamp(x, z);
  },

  update(dt: number, time: number): void {
    for (const n of nodes) {
      if (n.state === 'regrow') {
        n.timer -= dt;
        if (n.timer <= 0) {
          n.state = 'grown';
          n.units = CFG.res[n.type].units;
          n.grow = 0;
          n.full.visible = true;
          n.stump.visible = false;
        }
      }
      if (n.state === 'grown' && n.grow < 1) {
        n.grow = Math.min(1, n.grow + dt * 2.2);
        n.full.scale.setScalar(Math.max(0.001, n.baseScale * easeOutBack(n.grow)));
      }
      if (n.shake > 0) {
        n.shake = Math.max(0, n.shake - dt * 5);
        n.full.rotation.z = Math.sin(time * 55) * 0.07 * n.shake;
        n.full.rotation.x = Math.cos(time * 47) * 0.05 * n.shake;
      }
    }
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      const s = 1 + Math.sin(time * 13 + i * 1.7) * 0.04 + Math.sin(time * 23 + i) * 0.03;
      f.scale.set(1, s, 1);
    }
  },

  nearestHarvestable(x: number, z: number, reach: number, heroR: number): ResNode | null {
    let best: ResNode | null = null;
    let bd = reach;
    for (const n of nodes) {
      if (n.state !== 'grown') continue;
      const d = Math.hypot(n.x - x, n.z - z) - n.r - heroR;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  },

  /** Take one unit from a node. Returns the resource type or null. */
  harvest(n: ResNode): ResType | null {
    if (n.state !== 'grown' || n.units <= 0) return null;
    n.units--;
    n.shake = 1;
    const c = n.type === 'wood' ? 0xc89b5e : n.type === 'stone' ? 0xb0b5ba : n.type === 'gold' ? 0xf4c430 : 0x7fe3ff;
    burst(n.x, n.type === 'wood' ? 1.0 : 0.7, n.z, c, 5, { speed: 3, up: 3, size: 0.13 });
    if (n.type === 'crystal') burst(n.x, 1, n.z, 0x9fe8ff, 4, { speed: 2, up: 2, size: 0.12, glow: true });
    if (n.units <= 0) {
      n.state = 'regrow';
      n.timer = CFG.res[n.type].regrow;
      n.full.visible = false;
      n.stump.visible = true;
      n.reservedBy = null;
      burst(n.x, 1.2, n.z, n.type === 'wood' ? 0x4caf50 : n.type === 'crystal' ? 0x7fe3ff : 0x9ea4aa, 10, { speed: 4, up: 4, size: 0.18 });
    }
    return n.type;
  },

  findForWorker(types: ResType[], x: number, z: number, who: object): ResNode | null {
    let best: ResNode | null = null;
    let bs = Infinity;
    for (const n of nodes) {
      if (n.state !== 'grown' || !types.includes(n.type)) continue;
      if (n.reservedBy && n.reservedBy !== who) continue;
      const s = Math.hypot(n.x - x, n.z - z) - (n.type === 'crystal' ? 26 : n.type === 'gold' ? 14 : 0);
      if (s < bs) {
        bs = s;
        best = n;
      }
    }
    return best;
  },

  /** Reveal quarry rocks, gold veins or crystals. */
  openArea(type: 'stone' | 'gold' | 'crystal', animate: boolean): void {
    let i = 0;
    for (const n of nodes) {
      if (n.type !== type || n.state !== 'hidden') continue;
      n.state = 'grown';
      n.group.visible = true;
      n.grow = 1;
      if (animate) pop(n.group, 0.5, i++ * 0.06);
    }
    const deco = makeMesh(type === 'stone' ? quarrySignGeo() : type === 'gold' ? mineGeo() : caveGeo());
    const pos = type === 'stone' ? QUARRY_SIGN_POS : type === 'gold' ? MINE_POS : CAVE_POS;
    deco.position.set(pos.x, 0, pos.z);
    scene.add(deco);
    if (type === 'crystal' && caveLight) caveLight.base = 4;
    if (animate) pop(deco);
  },

  /** A random open spot for a treasure chest. */
  chestSpot(): { x: number; z: number } {
    for (let i = 0; i < 200; i++) {
      const pick = Math.random();
      let x: number;
      let z: number;
      if (pick < 0.4) {
        const f = ZONES.forest;
        x = f.x0 + Math.random() * (f.x1 - f.x0);
        z = f.z0 + Math.random() * (f.z1 - f.z0);
      } else if (pick < 0.75) {
        x = -27 + Math.random() * 54;
        z = -58 + Math.random() * 32;
      } else {
        x = -14 + Math.random() * 28;
        z = 30 + Math.random() * 8;
      }
      if (!isFree(x, z, 1)) continue;
      if (nodes.some((n) => n.state !== 'hidden' && Math.hypot(n.x - x, n.z - z) < 1.6)) continue;
      return { x, z };
    }
    return { x: -20, z: -40 };
  },
};
