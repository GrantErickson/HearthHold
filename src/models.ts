import * as THREE from 'three';
import type { EnemyType, ResType } from './state';

/**
 * All models are built from primitives and merged into one geometry per model
 * with per-vertex colors, so each building / unit part is a single draw call.
 */

type V3 = [number, number, number];
interface Part {
  g: THREE.BufferGeometry;
  c: number;
  p: V3;
  r: V3;
  s: V3;
}

const PI = Math.PI;
const ZERO: V3 = [0, 0, 0];
const ONE: V3 = [1, 1, 1];

export const Mat = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
  flash: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff2a2a, emissiveIntensity: 0.75 }),
  ghost: new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.3, depthWrite: false }),
  marker: new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  pointer: new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false }),
};

function part(g: THREE.BufferGeometry, c: number, p: V3 = ZERO, r: V3 = ZERO, s: V3 = ONE): Part {
  return { g, c, p, r, s };
}
const box = (w: number, h: number, d: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.BoxGeometry(w, h, d), c, p, r, s);
const cyl = (rt: number, rb: number, h: number, seg: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.CylinderGeometry(rt, rb, h, seg), c, p, r, s);
const cone = (rad: number, h: number, seg: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.ConeGeometry(rad, h, seg), c, p, r, s);
const sph = (rad: number, ws: number, hs: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.SphereGeometry(rad, ws, hs), c, p, r, s);
const dod = (rad: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.DodecahedronGeometry(rad, 0), c, p, r, s);
const oct = (rad: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.OctahedronGeometry(rad, 0), c, p, r, s);
/** Triangular prism (roof) along X: width W along Z, height H, base at local y = 0. */
const prism = (L: number, W: number, H: number, c: number, p?: V3, r?: V3) => part(prismGeo(L, W, H), c, p, r);

function prismGeo(L: number, W: number, H: number): THREE.BufferGeometry {
  const x0 = -L / 2, x1 = L / 2, z0 = -W / 2, z1 = W / 2;
  const A0: V3 = [x0, 0, z0], B0: V3 = [x0, 0, z1], C0: V3 = [x0, H, 0];
  const A1: V3 = [x1, 0, z0], B1: V3 = [x1, 0, z1], C1: V3 = [x1, H, 0];
  const v: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => v.push(...a, ...b, ...c);
  tri(A0, B0, C0);
  tri(A1, C1, B1);
  tri(A1, A0, C0);
  tri(A1, C0, C1);
  tri(B0, B1, C1);
  tri(B0, C1, C0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function merge(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const pt of parts) {
    const g = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
    _e.set(pt.r[0], pt.r[1], pt.r[2]);
    _q.setFromEuler(_e);
    _p.set(pt.p[0], pt.p[1], pt.p[2]);
    _s.set(pt.s[0], pt.s[1], pt.s[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    g.computeVertexNormals(); // non-indexed → flat, faceted shading
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    _c.set(pt.c);
    for (let i = 0; i < pa.length; i++) {
      pos.push(pa[i]);
      nor.push(na[i]);
    }
    for (let i = 0; i < pa.length; i += 3) col.push(_c.r, _c.g, _c.b);
    g.dispose();
    pt.g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, fn: () => Part[]): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = merge(fn());
    cache.set(key, g);
  }
  return g;
}

export function makeMesh(geo: THREE.BufferGeometry, cast = true, receive = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, Mat.vc);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ───────────────────────────── Characters ─────────────────────────────

export type HumanKind = 'hero' | 'soldier' | 'lumber' | 'miner' | EnemyType;

interface HumanSpec {
  body: number;
  legs: number;
  skin: number;
  helmet: 'knight' | 'horn' | 'hood' | 'cap' | 'miner' | 'kettle' | 'bandana' | 'crown' | 'bald';
  weapon: 'sword' | 'dagger' | 'axe' | 'pick' | 'spear' | 'club' | 'bow' | 'hammer';
  plume?: number;
  cape?: number;
  shield?: 'round' | 'tower';
  shieldColor?: number;
  beard?: number;
  cap?: number;
  hood?: number;
  belt?: number;
}

const SPECS: Record<HumanKind, HumanSpec> = {
  hero: { body: 0x2d63c8, legs: 0x3a3346, skin: 0xf1c27d, helmet: 'knight', plume: 0xf2c94c, cape: 0xc23b3b, weapon: 'sword', shield: 'round', shieldColor: 0x2d63c8, belt: 0x6b4a2a },
  soldier: { body: 0x4f78c4, legs: 0x3a3346, skin: 0xe8b98a, helmet: 'kettle', weapon: 'spear', shield: 'round', shieldColor: 0x9a6b3a },
  lumber: { body: 0x3a8a4a, legs: 0x3a4f7a, skin: 0xf0c090, helmet: 'cap', cap: 0xe0a83a, weapon: 'axe', beard: 0x8a5a2a },
  miner: { body: 0x5b6f86, legs: 0x3a3346, skin: 0xe0b080, helmet: 'miner', weapon: 'pick' },
  raider: { body: 0x8a3b2e, legs: 0x4a3524, skin: 0xd9a066, helmet: 'horn', weapon: 'axe', beard: 0xb5651d },
  runner: { body: 0xd0702c, legs: 0x4a3524, skin: 0xd9a066, helmet: 'bandana', weapon: 'dagger' },
  brute: { body: 0x5a2a22, legs: 0x3a2a1e, skin: 0xc98a5a, helmet: 'bald', weapon: 'club', beard: 0x3a2a1e },
  archer: { body: 0x6b5a3a, legs: 0x3f3326, skin: 0xd9a066, helmet: 'hood', hood: 0x4a5a32, weapon: 'bow' },
  shield: { body: 0x7a2d2d, legs: 0x3a2a1e, skin: 0xd9a066, helmet: 'horn', weapon: 'sword', shield: 'tower', shieldColor: 0x6a4a30 },
  chieftain: { body: 0x4a1f1f, legs: 0x2a1a14, skin: 0xd9a066, helmet: 'crown', weapon: 'axe', beard: 0xd8d8d8, cape: 0x2a2a2a },
  warlord: { body: 0x2a2228, legs: 0x1a1418, skin: 0xb07a50, helmet: 'crown', weapon: 'hammer', beard: 0x1a1a1a, cape: 0x8a1c1c },
};

function torsoParts(sp: HumanSpec): Part[] {
  const p: Part[] = [
    cyl(0.3, 0.36, 0.72, 7, sp.body, [0, 0.98, 0]),
    cyl(0.37, 0.37, 0.1, 7, sp.belt ?? 0x4a3020, [0, 0.68, 0]),
    sph(0.25, 8, 6, sp.skin, [0, 1.58, 0]),
    box(0.06, 0.07, 0.04, 0x222222, [-0.09, 1.61, 0.235]),
    box(0.06, 0.07, 0.04, 0x222222, [0.09, 1.61, 0.235]),
    box(0.16, 0.52, 0.18, sp.body, [-0.43, 1.05, 0], [0, 0, -0.12]),
    sph(0.09, 6, 4, sp.skin, [-0.47, 0.76, 0]),
  ];
  if (sp.beard) p.push(box(0.32, 0.2, 0.12, sp.beard, [0, 1.44, 0.2]));
  const bone = 0xefe4c8;
  switch (sp.helmet) {
    case 'knight':
      p.push(cyl(0.27, 0.29, 0.26, 8, 0xc9d1d9, [0, 1.74, 0]), box(0.07, 0.3, 0.42, sp.plume ?? 0xffffff, [0, 1.98, -0.04]));
      break;
    case 'horn':
      p.push(
        cyl(0.27, 0.28, 0.2, 8, 0x707070, [0, 1.76, 0]),
        cone(0.07, 0.36, 5, bone, [0.31, 1.88, 0], [0, 0, -0.9]),
        cone(0.07, 0.36, 5, bone, [-0.31, 1.88, 0], [0, 0, 0.9]),
      );
      break;
    case 'hood':
      p.push(cone(0.33, 0.62, 7, sp.hood ?? 0x444444, [0, 1.8, -0.03]));
      break;
    case 'cap':
      p.push(cyl(0.26, 0.27, 0.16, 8, sp.cap ?? 0x444444, [0, 1.77, 0]), box(0.32, 0.04, 0.2, sp.cap ?? 0x444444, [0, 1.71, 0.24]));
      break;
    case 'miner':
      p.push(cyl(0.28, 0.3, 0.2, 8, 0xe8c23a, [0, 1.77, 0]), box(0.1, 0.1, 0.06, 0xfff6b0, [0, 1.8, 0.29]));
      break;
    case 'kettle':
      p.push(cyl(0.26, 0.29, 0.18, 8, 0x9aa3ad, [0, 1.77, 0]), cyl(0.42, 0.42, 0.04, 8, 0x9aa3ad, [0, 1.69, 0]));
      break;
    case 'bandana':
      p.push(cyl(0.265, 0.265, 0.1, 8, 0x2a2a2a, [0, 1.68, 0]), box(0.08, 0.22, 0.06, 0x2a2a2a, [0.05, 1.6, -0.27]));
      break;
    case 'crown':
      p.push(
        cyl(0.27, 0.28, 0.2, 8, 0x505050, [0, 1.76, 0]),
        cone(0.08, 0.42, 5, bone, [0.33, 1.9, 0], [0, 0, -0.9]),
        cone(0.08, 0.42, 5, bone, [-0.33, 1.9, 0], [0, 0, 0.9]),
        cyl(0.22, 0.22, 0.14, 8, 0xf2c230, [0, 1.92, 0]),
      );
      break;
    case 'bald':
      break;
  }
  if (sp.cape) p.push(box(0.58, 0.9, 0.06, sp.cape, [0, 1.0, -0.34], [0.12, 0, 0]));
  if (sp.shield === 'round') {
    p.push(
      cyl(0.34, 0.34, 0.08, 8, sp.shieldColor ?? 0x8a6a3a, [-0.58, 1.0, 0.05], [0, 0, PI / 2]),
      cyl(0.1, 0.1, 0.1, 6, 0xf2c94c, [-0.63, 1.0, 0.05], [0, 0, PI / 2]),
    );
  } else if (sp.shield === 'tower') {
    p.push(
      box(0.1, 1.15, 0.8, sp.shieldColor ?? 0x6a4a30, [-0.6, 0.95, 0.1]),
      box(0.12, 0.12, 0.84, 0x8a8a8a, [-0.6, 1.45, 0.1]),
      box(0.12, 0.12, 0.84, 0x8a8a8a, [-0.6, 0.45, 0.1]),
    );
  }
  return p;
}

function armParts(sp: HumanSpec): Part[] {
  const p: Part[] = [box(0.16, 0.52, 0.18, sp.body, [0, -0.24, 0]), sph(0.09, 6, 4, sp.skin, [0, -0.53, 0])];
  const wood = 0x7a5232;
  const steel = 0xd5dce4;
  const iron = 0x8f969e;
  switch (sp.weapon) {
    case 'sword':
      p.push(box(0.07, 0.07, 0.86, steel, [0, -0.55, 0.5]), box(0.34, 0.07, 0.08, 0xe0b040, [0, -0.55, 0.1]), box(0.05, 0.05, 0.16, 0x5a3a20, [0, -0.55, 0]));
      break;
    case 'dagger':
      p.push(box(0.06, 0.06, 0.5, steel, [0, -0.55, 0.3]), box(0.2, 0.06, 0.06, 0x5a3a20, [0, -0.55, 0.06]));
      break;
    case 'axe':
      p.push(box(0.06, 0.06, 0.8, wood, [0, -0.55, 0.32]), box(0.05, 0.34, 0.24, iron, [0, -0.46, 0.64]));
      break;
    case 'pick':
      p.push(box(0.06, 0.06, 0.8, wood, [0, -0.55, 0.32]), box(0.06, 0.56, 0.07, iron, [0, -0.55, 0.68]));
      break;
    case 'spear':
      p.push(box(0.05, 0.05, 1.7, 0x8b6a4a, [0, -0.55, 0.45]), cone(0.08, 0.28, 4, steel, [0, -0.55, 1.42], [PI / 2, 0, 0]));
      break;
    case 'club':
      p.push(cyl(0.07, 0.17, 0.95, 6, 0x6b4a2a, [0, -0.55, 0.5], [-PI / 2, 0, 0]));
      break;
    case 'bow':
      p.push(box(0.05, 1.05, 0.06, wood, [0, -0.55, 0.2]), box(0.015, 1.0, 0.015, 0xeeeeee, [0, -0.55, 0.13]));
      break;
    case 'hammer':
      p.push(box(0.07, 0.07, 1.1, wood, [0, -0.55, 0.45]), box(0.34, 0.34, 0.52, 0x3a3a40, [0, -0.55, 0.98]));
      break;
  }
  return p;
}

export interface Humanoid {
  group: THREE.Group;
  body: THREE.Group;
  torso: THREE.Mesh;
  legL: THREE.Group;
  legR: THREE.Group;
  armR: THREE.Group;
  phase: number;
}

export function humanoid(kind: HumanKind, castShadow = true): Humanoid {
  const sp = SPECS[kind];
  const torsoGeo = cached('torso:' + kind, () => torsoParts(sp));
  const armGeo = cached('arm:' + kind, () => armParts(sp));
  const legGeo = cached('leg:' + sp.legs, () => [
    box(0.17, 0.5, 0.2, sp.legs, [0, -0.25, 0]),
    box(0.19, 0.13, 0.27, 0x3a2a20, [0, -0.53, 0.03]),
  ]);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const torso = makeMesh(torsoGeo, castShadow, false);
  body.add(torso);
  const legL = new THREE.Group();
  legL.position.set(-0.13, 0.6, 0);
  legL.add(makeMesh(legGeo, castShadow, false));
  const legR = new THREE.Group();
  legR.position.set(0.13, 0.6, 0);
  legR.add(makeMesh(legGeo, castShadow, false));
  group.add(legL, legR);
  const armR = new THREE.Group();
  armR.position.set(0.43, 1.3, 0);
  armR.add(makeMesh(armGeo, castShadow, false));
  body.add(armR);
  return { group, body, torso, legL, legR, armR, phase: Math.random() * 6 };
}

/** Walk cycle and weapon swing. `swingT` runs 0→1 during an attack (≥1 = idle). */
export function animateHumanoid(m: Humanoid, dt: number, moving: boolean, speed: number, swingT: number): void {
  if (moving) m.phase += dt * speed * 2.3;
  const a = moving ? Math.sin(m.phase) * 0.7 : 0;
  const k = Math.min(1, dt * 14);
  m.legL.rotation.x += (a - m.legL.rotation.x) * k;
  m.legR.rotation.x += (-a - m.legR.rotation.x) * k;
  m.body.position.y = moving ? Math.abs(Math.sin(m.phase)) * 0.06 : 0;
  let ax: number;
  if (swingT < 1) {
    const t = swingT;
    if (t < 0.35) ax = -0.3 + (-2.5 + 0.3) * (t / 0.35);
    else if (t < 0.6) ax = -2.5 + (2.3 * (t - 0.35)) / 0.25;
    else ax = -0.2;
  } else {
    ax = moving ? a * 0.5 - 0.2 : -0.2;
  }
  m.armR.rotation.x = ax;
}

export function setFlash(m: Humanoid, on: boolean): void {
  m.torso.material = on ? Mat.flash : Mat.vc;
}

// ───────────────────────────── Nature ─────────────────────────────

export const TREE_VARIANTS = 3;
export function treeGeo(v: number): THREE.BufferGeometry {
  return cached('tree' + v, () => {
    const trunk = cyl(0.16, 0.24, 1.1, 6, 0x7a5232, [0, 0.55, 0]);
    if (v === 0)
      return [trunk, cone(1.05, 1.5, 7, 0x3a8a3e, [0, 1.6, 0]), cone(0.82, 1.25, 7, 0x44a046, [0, 2.25, 0]), cone(0.56, 1.0, 7, 0x52b552, [0, 2.85, 0])];
    if (v === 1)
      return [trunk, dod(0.95, 0x4a9e44, [0, 2.0, 0], ZERO, [1, 0.9, 1]), dod(0.62, 0x5cb455, [0.35, 2.6, 0.15]), dod(0.5, 0x3f8f3c, [-0.45, 2.3, -0.2])];
    return [trunk, cone(0.95, 1.7, 6, 0x2f7a3a, [0, 1.7, 0]), cone(0.7, 1.4, 6, 0x388a42, [0, 2.5, 0]), cone(0.45, 1.1, 6, 0x41994a, [0, 3.2, 0])];
  });
}
export const stumpGeo = () =>
  cached('stump', () => [cyl(0.22, 0.27, 0.32, 6, 0x7a5232, [0, 0.16, 0]), cyl(0.19, 0.19, 0.03, 6, 0xdcb27a, [0, 0.33, 0])]);
export const rockGeo = (v: number) =>
  cached('rock' + v, () => [
    dod(0.8, 0x9ea4aa, [0, 0.45, 0], [0.3, v, 0], [1.25, 0.85, 1]),
    dod(0.48, 0x8b9198, [0.75, 0.28, 0.35], [v, 0.5, 0]),
    dod(0.34, 0xadb3b9, [-0.62, 0.2, 0.42]),
  ]);
export const pebbleGeo = () =>
  cached('pebbles', () => [dod(0.25, 0x8b9198, [0.2, 0.1, 0]), dod(0.2, 0x9ea4aa, [-0.25, 0.08, 0.15]), dod(0.18, 0xadb3b9, [0, 0.07, -0.25])]);
export const goldGeo = (v: number) =>
  cached('gold' + v, () => [
    dod(0.8, 0x6f665c, [0, 0.45, 0], [0.3, v, 0], [1.2, 0.85, 1]),
    dod(0.45, 0x7d7368, [0.7, 0.26, 0.3]),
    oct(0.22, 0xf4c430, [0.3, 0.85, 0.35]),
    oct(0.18, 0xffd84a, [-0.4, 0.7, 0.45]),
    oct(0.2, 0xf4c430, [0.1, 0.6, 0.75]),
    oct(0.15, 0xffe27a, [0.75, 0.55, 0.5]),
  ]);
export const bushGeo = (v: number) =>
  cached('bush' + v, () =>
    v === 0
      ? [dod(0.5, 0x4f9e3f, [0, 0.35, 0], ZERO, [1.2, 0.8, 1]), dod(0.35, 0x5fb24c, [0.4, 0.3, 0.1])]
      : [
          dod(0.45, 0x4a963c, [0, 0.32, 0], ZERO, [1.1, 0.8, 1]),
          box(0.1, 0.1, 0.1, 0xf06292, [0.15, 0.68, 0.2]),
          box(0.1, 0.1, 0.1, 0xfff176, [-0.25, 0.62, 0.1]),
          box(0.1, 0.1, 0.1, 0xffffff, [0.05, 0.66, -0.25]),
        ],
  );
export const mountainGeo = (v: number) =>
  cached('mountain' + v, () => {
    const h = 13 + v * 3;
    const r = 9 + v * 1.5;
    return [
      cone(r, h, 6, v % 2 ? 0x7f8c8d : 0x8a9597, [0, h / 2, 0], [0, v, 0]),
      cone(r * 0.33, h * 0.33, 6, 0xf4f6f7, [0, h - (h * 0.33) / 2 + 0.05, 0], [0, v, 0]),
      cone(r * 1.05, h * 0.3, 6, 0x5f8a45, [0, h * 0.15, 0], [0, v + 0.3, 0]),
    ];
  });
export const tentGeo = () =>
  cached('tent', () => [cone(1.7, 2.3, 6, 0x8a3b2e, [0, 1.15, 0]), box(0.7, 1.0, 0.1, 0x2a1a14, [0, 0.5, 1.3]), cyl(0.04, 0.04, 0.8, 4, 0x6b4a2a, [0, 2.6, 0])]);
export const fireGeo = () =>
  cached('fire', () => [
    cyl(0.1, 0.1, 1.0, 5, 0x5a3d26, [0, 0.1, 0], [0, 0, PI / 2]),
    cyl(0.1, 0.1, 1.0, 5, 0x5a3d26, [0, 0.1, 0], [PI / 2, 0, 0]),
    cone(0.35, 0.8, 5, 0xff7a1a, [0, 0.5, 0]),
    cone(0.2, 0.6, 5, 0xffd54a, [0, 0.5, 0]),
  ]);

// ───────────────────────────── Items ─────────────────────────────

export type ItemKind = ResType | 'coin';
export const ITEM_H: Record<ResType, number> = { wood: 0.24, stone: 0.25, gold: 0.17 };

export function itemGeo(t: ItemKind): THREE.BufferGeometry {
  return cached('item:' + t, () => {
    switch (t) {
      case 'wood':
        return [cyl(0.13, 0.13, 0.7, 7, 0x8b5a2b, ZERO, [0, 0, PI / 2]), cyl(0.1, 0.1, 0.72, 7, 0xd9b27c, ZERO, [0, 0, PI / 2])];
      case 'stone':
        return [box(0.46, 0.24, 0.34, 0xa3a8ad), box(0.2, 0.05, 0.15, 0xb9bec3, [0.05, 0.13, 0.03])];
      case 'gold':
        return [box(0.42, 0.16, 0.24, 0xf2c230), box(0.34, 0.04, 0.17, 0xffe27a, [0, 0.09, 0])];
      case 'coin':
        return [cyl(0.2, 0.2, 0.06, 10, 0xf5c542), cyl(0.13, 0.13, 0.07, 10, 0xffde6b)];
    }
  });
}

// ───────────────────────────── Buildings ─────────────────────────────

export function keepGeo(lv: number): THREE.BufferGeometry {
  return cached('keep' + lv, () => {
    const st = 0xcfc7b8, sd = 0xada595, roof = 0x3d63b8, wood = 0x5a3d26;
    const h = 3 + lv * 0.5;
    const p: Part[] = [box(6.8, 0.6, 6.8, sd, [0, 0.3, 0]), box(6.2, h, 6.2, st, [0, h / 2, 0])];
    for (let i = 0; i < 5; i++) {
      const a = -2.5 + i * 1.25;
      p.push(
        box(0.6, 0.5, 0.5, sd, [a, h + 0.25, -2.85]),
        box(0.6, 0.5, 0.5, sd, [a, h + 0.25, 2.85]),
        box(0.5, 0.5, 0.6, sd, [-2.85, h + 0.25, a]),
        box(0.5, 0.5, 0.6, sd, [2.85, h + 0.25, a]),
      );
    }
    const th = h + 1.4 + lv * 0.35;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        p.push(
          cyl(0.95, 1.08, th, 8, st, [sx * 3.1, th / 2, sz * 3.1]),
          cyl(1.12, 1.12, 0.3, 8, sd, [sx * 3.1, th + 0.15, sz * 3.1]),
          cone(1.25, 1.7, 8, roof, [sx * 3.1, th + 1.15, sz * 3.1]),
        );
        if (lv >= 4) p.push(cyl(1.14, 1.14, 0.12, 8, 0xf2c230, [sx * 3.1, th + 0.36, sz * 3.1]));
      }
    // gate (north, toward the plaza) and door + banners (south, toward the camera)
    p.push(box(1.8, 2.3, 0.2, wood, [0, 1.15, -3.15]), box(2.1, 0.25, 0.25, sd, [0, 2.4, -3.15]));
    p.push(box(1.4, 1.9, 0.2, wood, [0, 0.95, 3.15]));
    p.push(box(0.8, 1.6, 0.06, 0x2d63c8, [-1.9, h - 1.2, 3.13]), box(0.8, 1.6, 0.06, 0x2d63c8, [1.9, h - 1.2, 3.13]));
    p.push(box(0.3, 0.3, 0.07, 0xf2c94c, [-1.9, h - 1.0, 3.16]), box(0.3, 0.3, 0.07, 0xf2c94c, [1.9, h - 1.0, 3.16]));
    if (lv >= 2) {
      const dh = 2 + (lv - 2) * 0.8;
      p.push(box(3.2, dh, 3.2, st, [0, h + dh / 2, 0]));
      p.push(box(0.5, 0.7, 0.1, 0x2a2a3a, [0, h + dh * 0.5, 1.61]));
      p.push(cone(2.6, 2.2, 4, roof, [0, h + dh + 1.1, 0], [0, PI / 4, 0]));
      if (lv >= 3) {
        const top = h + dh + 2.2;
        p.push(cyl(0.06, 0.06, 1.6, 5, 0x6b4a2a, [0, top + 0.6, 0]), box(1.0, 0.6, 0.05, 0xc23b3b, [0.52, top + 1.1, 0]));
      }
    }
    return p;
  });
}
export const keepTop = (lv: number) => 3 + lv * 0.5 + 1.2;

export const marketGeo = () =>
  cached('market', () => {
    const p: Part[] = [
      box(4.6, 0.3, 3.2, 0x9c6b3f, [0, 0.15, 0]),
      box(4.4, 1.9, 0.2, 0xb07a48, [0, 1.25, -1.45]),
      box(4.2, 0.9, 0.7, 0xa0703f, [0, 0.75, 1.15]),
      box(4.3, 0.1, 0.8, 0xc58a50, [0, 1.24, 1.15]),
    ];
    for (const sx of [-2.1, 2.1]) for (const sz of [-1.45, 1.45]) p.push(cyl(0.1, 0.1, 2.7, 6, 0x7a5232, [sx, 1.5, sz]));
    for (let i = 0; i < 5; i++) {
      const c = i % 2 ? 0xfaf3e3 : 0xd94b3b;
      p.push(box(0.92, 0.1, 3.5, c, [-1.84 + i * 0.92, 2.95, 0.05], [0.16, 0, 0]));
      p.push(box(0.92, 0.32, 0.06, c, [-1.84 + i * 0.92, 2.55, 1.8]));
    }
    p.push(
      box(0.55, 0.3, 0.4, 0xc08a4f, [-1.3, 1.45, 1.1]),
      sph(0.12, 6, 4, 0xd93b3b, [-1.4, 1.65, 1.05]),
      sph(0.12, 6, 4, 0xd93b3b, [-1.2, 1.65, 1.15]),
      sph(0.12, 6, 4, 0x8bc34a, [-1.3, 1.65, 0.95]),
      cyl(0.2, 0.16, 0.22, 8, 0x8b5a2b, [1.2, 1.4, 1.1]),
      cyl(0.16, 0.16, 0.06, 8, 0xf5c542, [1.2, 1.52, 1.1]),
      box(0.6, 0.6, 0.6, 0xc08a4f, [1.7, 0.6, -0.7]),
      box(0.45, 0.45, 0.45, 0xb07a40, [1.6, 1.12, -0.7]),
      cyl(0.3, 0.3, 0.75, 8, 0x8b5a2b, [-1.75, 0.67, -0.75]),
      box(1.8, 0.55, 0.08, 0xf2d27a, [0, 3.35, 1.75]),
      cyl(0.16, 0.16, 0.06, 10, 0xf5c542, [0, 3.35, 1.8], [PI / 2, 0, 0]),
    );
    return p;
  });

export const smithGeo = () =>
  cached('smith', () => [
    box(4, 2.2, 3, 0x8d8478, [0, 1.1, 0]),
    box(4.1, 0.3, 3.1, 0x6f675c, [0, 0.15, 0]),
    prism(4.4, 3.4, 1.4, 0x7a3b2a, [0, 2.2, 0]),
    box(0.7, 2.0, 0.7, 0x6f675c, [1.3, 3.2, -0.6]),
    box(1.0, 1.5, 0.1, 0x4a3426, [-0.6, 0.75, 1.52]),
    box(0.8, 0.6, 0.1, 0xff8a3a, [1.0, 1.1, 1.52]),
    box(0.5, 0.4, 0.3, 0x3a3a40, [-2.6, 0.2, 0.8]),
    box(0.7, 0.18, 0.32, 0x45454c, [-2.6, 0.5, 0.8]),
    box(0.5, 0.06, 0.06, 0xd5dce4, [-2.6, 0.62, 0.8]),
  ]);

export const barracksGeo = () =>
  cached('barracks', () => {
    const p: Part[] = [
      box(4.6, 2, 4, 0x9b7653, [0, 1, 0]),
      box(4.7, 0.3, 4.1, 0x7d5f42, [0, 0.15, 0]),
      prism(5.0, 4.5, 1.6, 0x4f6ea8, [0, 2, 0]),
      box(1.1, 1.5, 0.1, 0x5a3d26, [0, 0.75, -2.03]),
      box(1.1, 1.5, 0.1, 0x5a3d26, [0, 0.75, 2.03]),
    ];
    for (const x of [-1.5, 1.5]) p.push(box(0.6, 0.5, 0.1, 0x2a2a3a, [x, 1.25, 2.03]), box(0.6, 0.5, 0.1, 0x2a2a3a, [x, 1.25, -2.03]));
    p.push(cyl(0.06, 0.06, 3.2, 5, 0x6b4a2a, [2.6, 1.6, -1.6]), box(0.9, 0.55, 0.04, 0x2d63c8, [3.07, 2.85, -1.6]));
    p.push(
      box(1.2, 0.1, 0.1, 0x6b4a2a, [-1.4, 1.0, -2.4]),
      box(0.05, 1.4, 0.05, 0xc9d1d9, [-1.7, 0.9, -2.45]),
      box(0.05, 1.4, 0.05, 0xc9d1d9, [-1.4, 0.9, -2.45]),
      box(0.05, 1.4, 0.05, 0xc9d1d9, [-1.1, 0.9, -2.45]),
    );
    return p;
  });

export const lumberGeo = () =>
  cached('lumber', () => {
    const p: Part[] = [box(3.4, 1.7, 2.8, 0x8b5a2b, [0, 0.85, 0]), prism(3.8, 3.3, 1.3, 0x6b3e1f, [0, 1.7, 0])];
    for (let y = 0.3; y < 1.7; y += 0.4) p.push(box(3.45, 0.06, 2.85, 0x6b4423, [0, y, 0]));
    p.push(box(0.9, 1.3, 0.1, 0x4a3020, [0, 0.65, -1.42]));
    for (const [x, y] of [[2.1, 0.18], [2.48, 0.18], [2.86, 0.18], [2.29, 0.5], [2.67, 0.5]] as const)
      p.push(cyl(0.18, 0.18, 1.8, 7, 0x8b5a2b, [x, y, 0], [PI / 2, 0, 0]));
    p.push(
      cyl(0.3, 0.33, 0.5, 7, 0x7a5232, [-2.2, 0.25, -0.8]),
      box(0.05, 0.6, 0.05, 0x7a5232, [-2.2, 0.75, -0.8], [0.3, 0, 0]),
      box(0.05, 0.2, 0.25, 0x9aa0a8, [-2.2, 1.0, -0.72]),
    );
    return p;
  });

export const lodgeGeo = () =>
  cached('lodge', () => {
    const p: Part[] = [
      box(3.4, 1.8, 2.8, 0x9a958c, [0, 0.9, 0]),
      box(3.5, 0.3, 2.9, 0x7d786f, [0, 0.15, 0]),
      prism(3.8, 3.3, 1.3, 0x55606e, [0, 1.8, 0]),
      box(0.9, 1.3, 0.1, 0x4a3020, [0, 0.65, -1.42]),
      box(1.1, 0.5, 0.7, 0x6b4a2a, [-2.4, 0.55, -0.4]),
      dod(0.2, 0x9ea4aa, [-2.6, 0.9, -0.4]),
      dod(0.18, 0xf4c430, [-2.25, 0.88, -0.3]),
      dod(0.2, 0x8b9198, [-2.4, 0.92, -0.55]),
    ];
    for (const x of [-2.75, -2.05]) for (const z of [-0.78, -0.02]) p.push(cyl(0.2, 0.2, 0.1, 8, 0x333333, [x, 0.22, z], [PI / 2, 0, 0]));
    return p;
  });

export const mineGeo = () =>
  cached('mine', () => [
    dod(2.2, 0x7a6f62, [0.8, 0.6, 0], [0, 0.4, 0], [1.4, 0.75, 1.1]),
    box(0.1, 1.5, 1.3, 0x1a1410, [-1.85, 0.75, 0]),
    box(0.25, 1.8, 0.25, 0x7a5232, [-2.0, 0.9, 0.8]),
    box(0.25, 1.8, 0.25, 0x7a5232, [-2.0, 0.9, -0.8]),
    box(0.3, 0.25, 1.9, 0x7a5232, [-2.0, 1.85, 0]),
    box(2.6, 0.05, 0.08, 0x555555, [-3.2, 0.03, 0.3]),
    box(2.6, 0.05, 0.08, 0x555555, [-3.2, 0.03, -0.3]),
  ]);

export const quarrySignGeo = () =>
  cached('qsign', () => [
    box(0.15, 1.6, 0.15, 0x7a5232, [0, 0.8, 0]),
    box(1.4, 0.6, 0.08, 0xd8b27a, [0, 1.45, 0.05]),
    box(0.8, 0.08, 0.1, 0x6b6b6b, [0, 1.45, 0.1], [0, 0, 0.6]),
    box(0.08, 0.4, 0.1, 0x6b6b6b, [0.25, 1.62, 0.1], [0, 0, 0.6]),
  ]);

function archerFigure(p: Part[], y: number): void {
  p.push(
    cyl(0.2, 0.25, 0.55, 6, 0x2d63c8, [0, y + 0.28, 0]),
    sph(0.17, 6, 5, 0xf1c27d, [0, y + 0.72, 0]),
    cone(0.2, 0.3, 6, 0x3a5a2a, [0, y + 0.92, 0]),
  );
}

export function towerGeo(lv: number): THREE.BufferGeometry {
  return cached('tower' + lv, () => {
    const p: Part[] = [];
    if (lv === 1) {
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.85, 0.85]) p.push(box(0.24, 3.3, 0.24, 0x7a5232, [sx, 1.65, sz]));
      p.push(box(1.9, 0.14, 0.14, 0x6b4423, [0, 1.2, 0.85], [0, 0, 0.5]), box(1.9, 0.14, 0.14, 0x6b4423, [0, 1.2, -0.85], [0, 0, -0.5]));
      p.push(box(2.4, 0.25, 2.4, 0x9c6b3f, [0, 3.3, 0]));
      p.push(
        box(2.4, 0.5, 0.1, 0x8b5a2b, [0, 3.65, 1.15]),
        box(2.4, 0.5, 0.1, 0x8b5a2b, [0, 3.65, -1.15]),
        box(0.1, 0.5, 2.4, 0x8b5a2b, [1.15, 3.65, 0]),
        box(0.1, 0.5, 2.4, 0x8b5a2b, [-1.15, 3.65, 0]),
      );
      for (const sx of [-1.05, 1.05]) for (const sz of [-1.05, 1.05]) p.push(box(0.12, 1.2, 0.12, 0x7a5232, [sx, 4.0, sz]));
      p.push(cone(1.9, 1.2, 4, 0xb5522d, [0, 5.15, 0], [0, PI / 4, 0]));
      archerFigure(p, 3.45);
    } else {
      const h = lv === 2 ? 3.6 : 4.4;
      const st = lv === 2 ? 0xb8b0a3 : 0xa7a093;
      p.push(cyl(1.05, 1.3, h, 8, st, [0, h / 2, 0]), cyl(1.38, 1.38, 0.35, 8, 0x958e82, [0, h + 0.17, 0]));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        p.push(box(0.34, 0.45, 0.34, 0x958e82, [Math.cos(a) * 1.2, h + 0.55, Math.sin(a) * 1.2], [0, -a, 0]));
      }
      p.push(box(0.3, 0.6, 0.1, 0x2a2a3a, [0, h * 0.55, 1.2]));
      archerFigure(p, h + 0.35);
      if (lv === 3) {
        p.push(cyl(1.32, 1.32, 0.14, 8, 0xf2c230, [0, h - 0.3, 0]));
        p.push(cyl(0.05, 0.05, 1.8, 5, 0x6b4a2a, [0.9, h + 1.2, -0.6]), box(0.8, 0.5, 0.04, 0x2d63c8, [1.32, h + 1.8, -0.6]));
      }
    }
    return p;
  });
}
export const towerTop = (lv: number) => (lv === 1 ? 4.2 : lv === 2 ? 4.6 : 5.4);

export const towerRubbleGeo = () =>
  cached('trubble', () => [
    dod(0.55, 0x9a948a, [0.3, 0.25, 0.2], [0.4, 0, 0], [1.3, 0.6, 1]),
    dod(0.45, 0x8a847a, [-0.5, 0.2, -0.3], [0, 1, 0], [1.2, 0.6, 1]),
    box(1.6, 0.14, 0.2, 0x7a5232, [0, 0.15, 0.6], [0, 0.5, 0.2]),
    box(1.2, 0.14, 0.2, 0x6b4423, [-0.2, 0.12, -0.7], [0, -0.7, 0.1]),
  ]);

export function catBaseGeo(lv: number): THREE.BufferGeometry {
  return cached('catbase' + lv, () => {
    const wood = lv === 1 ? 0x8b5a2b : 0x6b4423;
    const p: Part[] = [box(1.8, 0.3, 2.6, wood, [0, 0.55, 0])];
    for (const sx of [-1.0, 1.0]) for (const sz of [-0.85, 0.85]) p.push(cyl(0.42, 0.42, 0.18, 8, 0x4a3520, [sx, 0.42, sz], [0, 0, PI / 2]));
    p.push(box(0.2, 1.4, 0.2, wood, [-0.6, 1.3, 0.2]), box(0.2, 1.4, 0.2, wood, [0.6, 1.3, 0.2]), box(1.4, 0.16, 0.16, wood, [0, 1.95, 0.2]));
    if (lv >= 2) p.push(box(1.86, 0.08, 2.66, 0x3c3f46, [0, 0.72, 0]), box(0.24, 0.24, 0.24, 0x3c3f46, [0, 1.95, 0.2]));
    return p;
  });
}
export const catArmGeo = () =>
  cached('catarm', () => [box(0.18, 0.18, 2.6, 0x7a5232, [0, 0, 0.9]), box(0.5, 0.25, 0.5, 0x5a3d26, [0, 0.1, 2.1]), dod(0.25, 0x8a8580, [0, 0.35, 2.1])]);

export function wallGeo(lv: number): THREE.BufferGeometry {
  return cached('wall' + lv, () => {
    const p: Part[] = [];
    if (lv === 1) {
      for (let i = 0; i < 16; i++) {
        const x = -4.69 + i * 0.625;
        p.push(cyl(0.3, 0.32, 2.2, 6, i % 2 ? 0x8b5a2b : 0x7c4f25, [x, 1.1, 0]), cone(0.3, 0.5, 6, 0xa67445, [x, 2.45, 0]));
      }
      p.push(box(10, 0.22, 0.16, 0x6b4423, [0, 0.7, 0.34]), box(10, 0.22, 0.16, 0x6b4423, [0, 1.6, 0.34]));
    } else {
      const H = lv === 2 ? 2.2 : lv === 3 ? 2.8 : 3.2;
      const D = lv === 2 ? 1.1 : lv === 3 ? 1.3 : 1.4;
      const col = lv === 2 ? 0xb3aca1 : lv === 3 ? 0x9c968c : 0x77726c;
      const dark = lv === 2 ? 0x958e83 : lv === 3 ? 0x7f796f : 0x5a5650;
      p.push(box(10, H, D, col, [0, H / 2, 0]), box(10.04, 0.4, D + 0.1, dark, [0, 0.2, 0]));
      for (let i = 0; i < 7; i++) p.push(box(0.8, 0.55, D, dark, [-4.4 + i * 1.47, H + 0.27, 0]));
      if (lv >= 3) for (const x of [-3, 0, 3]) p.push(box(0.8, H * 0.8, 0.5, dark, [x, H * 0.4, D / 2 + 0.2]));
      if (lv === 4) {
        p.push(box(10.06, 0.2, D + 0.06, 0x3c3f46, [0, 0.9, 0]), box(10.06, 0.2, D + 0.06, 0x3c3f46, [0, 2.3, 0]));
        for (let i = 0; i < 9; i++) p.push(cone(0.12, 0.55, 4, 0x50545a, [-4 + i, 1.4, -D / 2 - 0.25], [-PI / 2, 0, 0]));
      }
      if (lv === 2) for (let i = 0; i < 5; i++) p.push(box(1.2, 0.04, 0.02, 0x8d867b, [-3.6 + i * 1.8, 0.9 + (i % 2) * 0.6, D / 2 + 0.01]));
    }
    return p;
  });
}

export function wallRubbleGeo(lv: number): THREE.BufferGeometry {
  return cached('wrubble' + lv, () => {
    const p: Part[] = [];
    for (let i = 0; i < 7; i++) {
      const x = -4.3 + i * 1.45;
      if (lv === 1)
        p.push(cyl(0.28, 0.3, 0.9 + (i % 3) * 0.3, 6, 0x7c4f25, [x, 0.4, (i % 2) * 0.3 - 0.15], [0.3 * (i % 2 ? 1 : -1), 0, 0.5 * ((i % 3) - 1)]));
      else p.push(dod(0.45 + (i % 3) * 0.12, 0x9a948a, [x, 0.25, (i % 2) * 0.4 - 0.2], [i, i * 2, 0], [1.2, 0.6, 1]));
    }
    return p;
  });
}

// ───────────────────────────── Projectiles & markers ─────────────────────────────

export const arrowGeo = (enemy: boolean) =>
  cached('arrow' + (enemy ? 'e' : ''), () => [
    box(0.05, 0.05, 0.75, enemy ? 0x3a2a1a : 0x8b6a4a),
    cone(0.07, 0.18, 4, 0xc9d1d9, [0, 0, 0.45], [PI / 2, 0, 0]),
    box(0.02, 0.12, 0.16, enemy ? 0x8a1c1c : 0xf0f0f0, [0, 0, -0.32]),
  ]);
export const boulderGeo = () => cached('boulder', () => [dod(0.35, 0x8a8580)]);

export function makeMarker(): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4), Mat.marker);
  head.rotation.x = PI;
  head.position.y = 0.4;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.6, 0.28), Mat.marker);
  shaft.position.y = 1.05;
  g.add(head, shaft);
  return g;
}

/** Flat triangle used as the ground arrow around the hero. Points along +X. */
export function makePointer(): THREE.Group {
  const g = new THREE.Group();
  const tri = new THREE.Mesh(new THREE.CircleGeometry(0.42, 3), Mat.pointer);
  tri.rotation.x = -PI / 2;
  tri.position.y = 0.06;
  tri.renderOrder = 6;
  g.add(tri);
  return g;
}
