import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { mulberry32 } from './util';
import {
  treeGeo, stumpGeo, rockGeo, pebbleGeo, goldGeo, makeMesh, mountainGeo, bushGeo, tentGeo, fireGeo,
  mineGeo, quarrySignGeo, TREE_VARIANTS, Mat,
} from './models';
import type { ResType } from './state';
import { burst, pop } from './fx';
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
let sun: THREE.DirectionalLight;
const rng = mulberry32(1337);

export const MINE_POS = { x: 27, z: 13.2 };
export const QUARRY_SIGN_POS = { x: 17.2, z: 9.8 };

// Ground texture covers x −80…80, z −89…71 (centred on z = −9).
const GW = 160;
const GZ = -9;
const PX = 1024;
const S = PX / GW;
const c2 = (x: number, z: number): [number, number] => [((x + GW / 2) / GW) * PX, ((z - (GZ - GW / 2)) / GW) * PX];

function paintGround(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const g = cv.getContext('2d')!;
  const r = mulberry32(7);
  g.fillStyle = '#5c973c';
  g.fillRect(0, 0, PX, PX);

  const blot = (x0: number, z0: number, x1: number, z1: number, n: number, colors: string[], rmin: number, rmax: number) => {
    for (let i = 0; i < n; i++) {
      const [px, pz] = c2(x0 + r() * (x1 - x0), z0 + r() * (z1 - z0));
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.beginPath();
      g.ellipse(px, pz, (rmin + r() * (rmax - rmin)) * S, (rmin + r() * (rmax - rmin)) * S * 0.8, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  };

  // playable area
  const [ax, az] = c2(-31, -50);
  const [bx, bz] = c2(31, 31);
  g.fillStyle = '#78bd4c';
  g.fillRect(ax, az, bx - ax, bz - az);
  blot(-31, -50, 31, 31, 260, ['rgba(140,205,90,0.35)', 'rgba(100,170,60,0.35)', 'rgba(120,190,70,0.4)'], 1.5, 4);
  // north field: drier grass
  const [fx0, fz0] = c2(-31, -50);
  const [fx1, fz1] = c2(31, -14);
  g.fillStyle = 'rgba(190,190,90,0.22)';
  g.fillRect(fx0, fz0, fx1 - fx0, fz1 - fz0);
  blot(-31, -50, 31, -15, 90, ['rgba(200,190,100,0.3)', 'rgba(150,170,80,0.3)'], 1.5, 3.5);
  // forest floor
  blot(-30, -8, -15, 29, 120, ['rgba(60,120,45,0.55)', 'rgba(70,135,50,0.5)', 'rgba(85,120,50,0.45)'], 1.5, 3.5);
  // quarry gravel
  blot(17, -7, 30, 10.5, 170, ['rgba(176,164,138,0.55)', 'rgba(150,138,112,0.5)', 'rgba(192,182,160,0.5)'], 0.4, 1.3);
  // gold field
  blot(17.5, 14.5, 30, 29.5, 150, ['rgba(168,138,96,0.5)', 'rgba(140,118,86,0.45)', 'rgba(182,152,100,0.45)'], 0.4, 1.3);

  // roads
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const road = (pts: [number, number][], w: number) => {
    for (const [col, extra] of [['#a88b5c', 0.7], ['#c9a874', 0]] as const) {
      g.strokeStyle = col;
      g.lineWidth = (w + extra) * S;
      g.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, pz] = c2(x, z);
        if (i) g.lineTo(px, pz);
        else g.moveTo(px, pz);
      });
      g.stroke();
    }
  };
  road([[0, -52], [0, -20], [0, -3]], 3.4);
  road([[-3, 1], [-9, 2.6], [-16, 3.5]], 2.4);
  road([[3, 1], [9, 2.6], [18, 3]], 2.4);
  road([[-4, 6], [-11, 17.5]], 2);
  road([[4, 6], [11, 17.5], [18, 15]], 2);
  // plaza
  for (const [col, extra] of [['#a88b5c', 0.5], ['#d2b48a', 0]] as const) {
    g.fillStyle = col;
    const [px, pz] = c2(0, 1.8);
    g.beginPath();
    g.ellipse(px, pz, (8.5 + extra) * S, (5.8 + extra) * S, 0, 0, Math.PI * 2);
    g.fill();
  }
  // wall foundation strip
  const [wx0, wz0] = c2(-30, -15);
  const [wx1] = c2(30, -15);
  g.fillStyle = 'rgba(120,95,60,0.45)';
  g.fillRect(wx0, wz0, wx1 - wx0, 2 * S);

  // fine grain
  for (let i = 0; i < 14000; i++) {
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

function scatter(x0: number, x1: number, z0: number, z1: number, spacing: number, max: number, margin: number, tries = 1500): [number, number][] {
  const pts: [number, number][] = [];
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
  const full = makeMesh(type === 'wood' ? treeGeo(variant) : type === 'stone' ? rockGeo(variant) : goldGeo(variant));
  const stump = makeMesh(type === 'wood' ? stumpGeo() : pebbleGeo(), false);
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

function addInstanced(geo: THREE.BufferGeometry, pts: [number, number][], scaleMin: number, scaleMax: number, cast: boolean): void {
  if (!pts.length) return;
  const im = new THREE.InstancedMesh(geo, Mat.vc, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  pts.forEach(([x, z], i) => {
    const k = scaleMin + rng() * (scaleMax - scaleMin);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    m.compose(p.set(x, 0, z), q, s.set(k, k, k));
    im.setMatrixAt(i, m);
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  scene.add(im);
}

export const World = {
  init(reservedRects: Rect[], lowSpec: boolean): void {
    reserved.push(...reservedRects);
    scene.background = new THREE.Color(0x9fd3f0);
    scene.fog = new THREE.Fog(0x9fd3f0, 55, 110);

    const hemi = new THREE.HemisphereLight(0xe2f3ff, 0x5d7a3a, 1.9);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(lowSpec ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 90;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GW), new THREE.MeshLambertMaterial({ map: paintGround() }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, GZ);
    ground.receiveShadow = true;
    scene.add(ground);

    this.decor();

    // Harvestable nodes
    for (const [x, z] of scatter(-29, -15.5, -7.5, 28.5, 2.3, 52, 1.0)) addNode('wood', x, z, Math.floor(rng() * TREE_VARIANTS), true);
    for (const [x, z] of scatter(18, 28.5, -6, 9.5, 2.9, 14, 0.9)) addNode('stone', x, z, Math.floor(rng() * 3), false);
    for (const [x, z] of scatter(18.5, 28.5, 16, 28.5, 3.0, 10, 0.9)) addNode('gold', x, z, Math.floor(rng() * 3), false);
  },

  decor(): void {
    // Mountains framing the map
    const mts: [number, number, number][] = [];
    for (let z = -70; z <= 45; z += 11) {
      mts.push([-44 - rng() * 6, z + rng() * 4, Math.floor(rng() * 3)]);
      mts.push([44 + rng() * 6, z + rng() * 4, Math.floor(rng() * 3)]);
    }
    for (let x = -36; x <= 36; x += 12) {
      mts.push([x + rng() * 4, -72 - rng() * 5, Math.floor(rng() * 3)]);
      mts.push([x + rng() * 4, 48 + rng() * 5, Math.floor(rng() * 3)]);
    }
    for (const [x, z, v] of mts) {
      const m = makeMesh(mountainGeo(v), false, false);
      m.position.set(x, 0, z);
      scene.add(m);
    }
    // Border forest (instanced, purely decorative)
    const border: [number, number][] = [];
    const band = (x0: number, x1: number, z0: number, z1: number, n: number) => {
      for (let i = 0; i < n; i++) border.push([x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0)]);
    };
    band(-40, -31, -62, 40, 140);
    band(31, 40, -62, 40, 140);
    band(-31, 31, 31, 42, 90);
    band(-31, 31, -66, -56, 90);
    const a = border.filter((_, i) => i % 2 === 0);
    const b = border.filter((_, i) => i % 2 === 1);
    addInstanced(treeGeo(0), a, 1.0, 1.5, true);
    addInstanced(treeGeo(2), b, 1.0, 1.6, true);

    // Bushes and flowers around the village
    const bushes = scatter(-14, 15, 15, 29, 2.6, 26, 0.8, 600).concat(scatter(-30, 30, -46, -16, 4, 26, 0.5, 600));
    addInstanced(bushGeo(0), bushes.filter((_, i) => i % 2 === 0), 0.8, 1.3, true);
    addInstanced(bushGeo(1), bushes.filter((_, i) => i % 2 === 1), 0.8, 1.2, true);

    // Raider camp beyond the north edge
    for (const [x, z, ry] of [[-14, -54, 0.4], [-5, -56.5, -0.2], [7, -55, 0.3], [16, -53.5, -0.5], [-22, -52, 0.8]] as const) {
      const t = makeMesh(tentGeo());
      t.position.set(x, 0, z);
      t.rotation.y = ry;
      scene.add(t);
    }
    const fire = makeMesh(fireGeo(), false);
    fire.position.set(1.5, 0, -52.5);
    scene.add(fire);
    const glow = new THREE.PointLight(0xff8a3a, 6, 9, 1.6);
    glow.position.set(1.5, 1.2, -52.5);
    scene.add(glow);
  },

  /** Keep the shadow frustum centred on what the camera sees. */
  focus(x: number, z: number): void {
    if (!sun) return;
    sun.position.set(x + 14, 30, z + 10);
    sun.target.position.set(x, 0, z);
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
    const c = n.type === 'wood' ? 0xc89b5e : n.type === 'stone' ? 0xb0b5ba : 0xf4c430;
    burst(n.x, n.type === 'wood' ? 1.0 : 0.7, n.z, c, 5, { speed: 3, up: 3, size: 0.13 });
    if (n.units <= 0) {
      n.state = 'regrow';
      n.timer = CFG.res[n.type].regrow;
      n.full.visible = false;
      n.stump.visible = true;
      n.reservedBy = null;
      burst(n.x, 1.2, n.z, n.type === 'wood' ? 0x4caf50 : 0x9ea4aa, 10, { speed: 4, up: 4, size: 0.18 });
    }
    return n.type;
  },

  findForWorker(types: ResType[], x: number, z: number, who: object): ResNode | null {
    let best: ResNode | null = null;
    let bs = Infinity;
    for (const n of nodes) {
      if (n.state !== 'grown' || !types.includes(n.type)) continue;
      if (n.reservedBy && n.reservedBy !== who) continue;
      const s = Math.hypot(n.x - x, n.z - z) - (n.type === 'gold' ? 14 : 0);
      if (s < bs) {
        bs = s;
        best = n;
      }
    }
    return best;
  },

  /** Reveal quarry rocks or gold veins. */
  openArea(type: 'stone' | 'gold', animate: boolean): void {
    let i = 0;
    for (const n of nodes) {
      if (n.type !== type || n.state !== 'hidden') continue;
      n.state = 'grown';
      n.group.visible = true;
      n.grow = 1;
      if (animate) pop(n.group, 0.5, i++ * 0.06);
    }
    const deco = makeMesh(type === 'stone' ? quarrySignGeo() : mineGeo());
    const pos = type === 'stone' ? QUARRY_SIGN_POS : MINE_POS;
    deco.position.set(pos.x, 0, pos.z);
    scene.add(deco);
    if (animate) pop(deco);
  },
};
