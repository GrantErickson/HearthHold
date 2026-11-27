import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { EnemyType, ResType } from './state';

/**
 * All models are built from primitives and merged into one geometry per model
 * with per-vertex colors (and a per-vertex glow value), so each building / unit
 * part is a single draw call.
 */

type V3 = [number, number, number];
interface Part {
  g: THREE.BufferGeometry;
  c: number;
  p: V3;
  r: V3;
  s: V3;
  /** Glow: 0 none, 0..1 always-on, 2 = lit windows (only at night). */
  e?: number;
  /** Facet the part (crystals, rocks, spikes) instead of smooth shading. */
  flat?: boolean;
}

const PI = Math.PI;
const ZERO: V3 = [0, 0, 0];
const ONE: V3 = [1, 1, 1];

// ───────────────────────────── Materials ─────────────────────────────

/** Uniforms shared by every world material (time of day, wind, season, snow). */
export const U = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uSnow: { value: 0 },
  uNight: { value: 0 },
  uSeason: { value: new THREE.Vector4(1, 0.5, 0.15, 0) },
  /** Rim light strength (cartoon edge highlight). */
  uRim: { value: 0.35 },
};

/**
 * Cel shading: the sun's light falls off in three soft bands instead of a
 * smooth gradient, which gives the toy-like cartoon look.
 */
const CEL_LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  `float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	dotNL = smoothstep( 0.0, 0.07, dotNL ) * 0.5 + smoothstep( 0.22, 0.36, dotNL ) * 0.32 + smoothstep( 0.62, 0.78, dotNL ) * 0.18;`,
);

interface MatOpts {
  snow?: boolean;
  /** Bright edge highlight on characters and buildings. */
  rim?: boolean;
  /** Strength of the act's season tint on leafy colours (0 = off). */
  season?: number;
  wind?: [number, number];
}

function inject(mat: THREE.MeshLambertMaterial, o: MatOpts, key: string): THREE.MeshLambertMaterial {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (o.snow) sh.defines = { ...sh.defines, USE_SNOW: '' };
    if (o.rim) sh.defines = { ...sh.defines, USE_RIM: '' };
    if (o.season) sh.defines = { ...sh.defines, USE_SEASON: '', SEASON_MUL: o.season.toFixed(2) };
    if (o.wind) sh.defines = { ...sh.defines, USE_WIND: '', WIND_BASE: o.wind[0].toFixed(3), WIND_AMP: o.wind[1].toFixed(3) };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float emit;
varying float vEmit;
varying float vUpN;
uniform float uTime;
uniform float uWind;`,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
vEmit = emit;
{
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wn = mat3(instanceMatrix) * wn;
  #endif
  vUpN = normalize(mat3(modelMatrix) * wn).y;
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_WIND
{
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  float hh = max(0.0, position.y - WIND_BASE);
  float ph = uTime * 1.6 + wp.x * 0.31 + wp.z * 0.23;
  float sw = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25) * uWind;
  transformed.x += sw * hh * WIND_AMP;
  transformed.z += cos(ph * 0.8) * hh * WIND_AMP * 0.6 * uWind;
}
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vEmit;
varying float vUpN;
uniform float uSnow;
uniform float uNight;
uniform float uRim;
uniform vec4 uSeason;`,
      )
      .replace('#include <lights_lambert_pars_fragment>', CEL_LAMBERT)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_SEASON
{
  float leaf = smoothstep(0.03, 0.12, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, uSeason.rgb * lum * 2.0, leaf * uSeason.a * SEASON_MUL);
}
#endif
#ifdef USE_SNOW
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 1.0), uSnow * smoothstep(0.6, 0.95, vUpN));
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * (vEmit > 1.5 ? uNight * 1.5 : vEmit * 1.2);
#ifdef USE_RIM
{
  float facing = saturate(dot(normal, normalize(vViewPosition)));
  float rim = smoothstep(0.42, 0.12, facing);
  totalEmissiveRadiance += diffuseColor.rgb * rim * uRim;
}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'hh-' + key;
  return mat;
}

const lam = (p: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, ...p });

const unitLam = () => inject(lam(), { rim: true }, 'unit');
const spiritLam = () => inject(lam({ transparent: true, opacity: 0.62, emissive: 0x2a3a5a, emissiveIntensity: 0.6 }), { rim: true }, 'spirit');

export const Mat = {
  vc: inject(lam(), { snow: true, rim: true }, 'vc'),
  foliage: inject(lam(), { snow: true, season: 1, wind: [0.6, 0.045] }, 'fol'),
  grass: inject(lam(), { snow: true, season: 0.8, wind: [0, 0.55] }, 'grass'),
  unit: unitLam(),
  spirit: spiritLam(),
  frozen: inject(lam({ emissive: 0x5ab8ff, emissiveIntensity: 0.55 }), { snow: true, rim: true }, 'frozen'),
  ghost: new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.3, depthWrite: false }),
  marker: new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  pointer: new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false }),
};

/** Cel-shaded material for instanced effects (debris, smoke puffs); colour comes from instanceColor. */
export function celMaterial(key: string): THREE.MeshLambertMaterial {
  return inject(new THREE.MeshLambertMaterial({ color: 0xffffff }), { rim: true }, key);
}

/** Ground-type materials share the season/snow shader but use a texture. */
export function groundMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
  return inject(new THREE.MeshLambertMaterial({ map }), { snow: true, season: 0.45 }, 'ground');
}

/** Geometries without per-vertex glow still need the attribute. */
export function ensureEmit(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.getAttribute('emit')) g.setAttribute('emit', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
  return g;
}

// ───────────────────────────── Part helpers ─────────────────────────────

function part(g: THREE.BufferGeometry, c: number, p: V3 = ZERO, r: V3 = ZERO, s: V3 = ONE): Part {
  return { g, c, p, r, s };
}
/** Soft-cornered box: nothing in the world has razor edges in a cartoon. */
function roundBoxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const m = Math.min(w, h, d);
  const r = Math.min(m * 0.24, 0.16);
  if (r < 0.01) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, m > 0.35 ? 2 : 1, r);
}
/** Round things get enough segments to read as round; 3–4 sided shapes stay faceted on purpose. */
const segUp = (n: number): number => (n >= 5 ? Math.min(24, Math.max(12, n * 2)) : n);
const flatPart = (pt: Part, flat: boolean): Part => {
  if (flat) pt.flat = true;
  return pt;
};
const box = (w: number, h: number, d: number, c: number, p?: V3, r?: V3, s?: V3) => part(roundBoxGeo(w, h, d), c, p, r, s);
/** A deliberately sharp box (planks, blades, trims). */
const sbox = (w: number, h: number, d: number, c: number, p?: V3, r?: V3, s?: V3) => flatPart(part(new THREE.BoxGeometry(w, h, d), c, p, r, s), true);
const cyl = (rt: number, rb: number, h: number, seg: number, c: number, p?: V3, r?: V3, s?: V3) =>
  flatPart(part(new THREE.CylinderGeometry(rt, rb, h, segUp(seg)), c, p, r, s), seg < 5);
const cone = (rad: number, h: number, seg: number, c: number, p?: V3, r?: V3, s?: V3) =>
  flatPart(part(new THREE.ConeGeometry(rad, h, segUp(seg)), c, p, r, s), seg < 5);
const sph = (rad: number, ws: number, hs: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.SphereGeometry(rad, ws < 5 ? ws : Math.max(14, ws * 2), hs < 4 ? hs : Math.max(10, hs * 2)), c, p, r, s);
/** Capsule along Y (limbs, bodies, necks). */
const cap = (rad: number, len: number, c: number, p?: V3, r?: V3, s?: V3) => part(new THREE.CapsuleGeometry(rad, len, 4, 12), c, p, r, s);
/** Rounded lump (rocks, bushes, leafy crowns): soft, chunky, cartoon. */
const dod = (rad: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.IcosahedronGeometry(rad, 1), c, p, r, s);
const oct = (rad: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.OctahedronGeometry(rad, 0), c, p, r, s);
const ico = (rad: number, c: number, p?: V3, r?: V3, s?: V3) =>
  part(new THREE.IcosahedronGeometry(rad, 1), c, p, r, s);
/** Smooth ball (orbs, puffs, cartoon eyes). */
const ball = (rad: number, c: number, p?: V3, r?: V3, s?: V3) => part(new THREE.IcosahedronGeometry(rad, 2), c, p, r, s);
const tor = (rad: number, tube: number, c: number, p?: V3, r?: V3, arc = PI * 2) =>
  part(new THREE.TorusGeometry(rad, tube, 8, 24, arc), c, p, r);
/** Triangular prism (roof) along X: width W along Z, height H, base at local y = 0. */
const prism = (L: number, W: number, H: number, c: number, p?: V3, r?: V3) => part(prismGeo(L, W, H), c, p, r);
const glow = (pt: Part, e = 1): Part => {
  pt.e = e;
  return pt;
};

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

/** Merge parts into one flat-shaded geometry. `ao` darkens vertices near the ground. */
function merge(parts: Part[], ao: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const emi: number[] = [];
  for (const pt of parts) {
    const g = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
    _e.set(pt.r[0], pt.r[1], pt.r[2]);
    _q.setFromEuler(_e);
    _p.set(pt.p[0], pt.p[1], pt.p[2]);
    _s.set(pt.s[0], pt.s[1], pt.s[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    // Keep the primitive's own (smooth) normals; facet only where asked or missing.
    if (pt.flat || !g.getAttribute('normal')) g.computeVertexNormals();
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    _c.set(pt.c);
    const e = pt.e ?? 0;
    for (let i = 0; i < pa.length; i++) {
      pos.push(pa[i]);
      nor.push(na[i]);
    }
    for (let i = 0; i < pa.length; i += 3) {
      let k = 1;
      if (ao && !e) {
        const t = Math.min(1, Math.max(0, pa[i + 1] / 1.1));
        k = 0.68 + 0.32 * t * t * (3 - 2 * t);
      }
      col.push(_c.r * k, _c.g * k, _c.b * k);
      emi.push(e);
    }
    g.dispose();
    pt.g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('emit', new THREE.Float32BufferAttribute(emi, 1));
  geo.computeBoundingSphere();
  return geo;
}

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, fn: () => Part[], ao = true): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = merge(fn(), ao);
    cache.set(key, g);
  }
  return g;
}

export function makeMesh(geo: THREE.BufferGeometry, cast = true, receive = true, mat: THREE.Material = Mat.vc): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ───────────────────────────── Characters ─────────────────────────────

export type HumanKind = 'hero' | 'soldier' | 'ranger' | 'lumber' | 'miner' | 'merchant' | EnemyType;
type Helmet =
  | 'knight' | 'horn' | 'hood' | 'cap' | 'miner' | 'kettle' | 'bandana' | 'crown' | 'bald'
  | 'feather' | 'fullhelm' | 'icecrown' | 'dread' | 'troll' | 'hat';
type Weapon =
  | 'sword' | 'dagger' | 'axe' | 'pick' | 'spear' | 'club' | 'bow' | 'hammer'
  | 'staff' | 'greatsword' | 'scythe' | 'twinaxe' | 'none';

interface HumanSpec {
  body: number;
  legs: number;
  skin: number;
  helmet: Helmet;
  weapon: Weapon;
  plume?: number;
  cape?: number;
  shield?: 'round' | 'tower';
  shieldColor?: number;
  beard?: number;
  cap?: number;
  hood?: number;
  belt?: number;
  /** Torso width multiplier. */
  bulk?: number;
  robe?: number;
  /** Floats with a ghostly tail instead of legs. */
  float?: boolean;
  bones?: boolean;
  eyes?: number;
  orb?: number;
  barrel?: boolean;
  pauldrons?: number;
  weaponColor?: number;
}

const BONE = 0xe8e0cc;

const SPECS: Partial<Record<HumanKind, HumanSpec>> = {
  hero: { body: 0x2d63c8, legs: 0x3a3346, skin: 0xf1c27d, helmet: 'knight', plume: 0xf2c94c, cape: 0xc23b3b, weapon: 'sword', shield: 'round', shieldColor: 0x2d63c8, belt: 0x6b4a2a, pauldrons: 0xc9d1d9 },
  soldier: { body: 0x4f78c4, legs: 0x3a3346, skin: 0xe8b98a, helmet: 'kettle', weapon: 'spear', shield: 'round', shieldColor: 0x9a6b3a },
  ranger: { body: 0x3f7a3a, legs: 0x3a3346, skin: 0xe8b98a, helmet: 'hood', hood: 0x2f5a2a, weapon: 'bow', belt: 0x6b4a2a },
  lumber: { body: 0x3a8a4a, legs: 0x3a4f7a, skin: 0xf0c090, helmet: 'cap', cap: 0xe0a83a, weapon: 'axe', beard: 0x8a5a2a },
  miner: { body: 0x5b6f86, legs: 0x3a3346, skin: 0xe0b080, helmet: 'miner', weapon: 'pick' },
  merchant: { body: 0x8a3ab8, legs: 0x3a3346, skin: 0xf0c090, helmet: 'hat', cap: 0xd94b3b, weapon: 'none', beard: 0xd8d8d8, belt: 0xf2c230, bulk: 1.15 },
  raider: { body: 0x8a3b2e, legs: 0x4a3524, skin: 0xd9a066, helmet: 'horn', weapon: 'axe', beard: 0xb5651d },
  runner: { body: 0xd0702c, legs: 0x4a3524, skin: 0xd9a066, helmet: 'bandana', weapon: 'dagger' },
  brute: { body: 0x5a2a22, legs: 0x3a2a1e, skin: 0xc98a5a, helmet: 'bald', weapon: 'club', beard: 0x3a2a1e, bulk: 1.15 },
  archer: { body: 0x6b5a3a, legs: 0x3f3326, skin: 0xd9a066, helmet: 'hood', hood: 0x4a5a32, weapon: 'bow' },
  shield: { body: 0x7a2d2d, legs: 0x3a2a1e, skin: 0xd9a066, helmet: 'horn', weapon: 'sword', shield: 'tower', shieldColor: 0x6a4a30 },
  sapper: { body: 0x6b4a2a, legs: 0x3a2a1e, skin: 0xd9a066, helmet: 'cap', cap: 0x3a3a3a, weapon: 'none', barrel: true },
  shaman: { body: 0x5a6a3a, legs: 0x3a2a1e, skin: 0xc98a5a, helmet: 'feather', weapon: 'staff', orb: 0x7dff8a, robe: 0x4a5a2a, eyes: 0x9aff7a },
  berserker: { body: 0xd9a066, legs: 0x4a2a1e, skin: 0xd9a066, helmet: 'horn', weapon: 'twinaxe', beard: 0xc0501d, belt: 0x5a2a1a, bulk: 1.1 },
  skeleton: { body: BONE, legs: 0xd8d0bc, skin: 0xefe8d8, helmet: 'bald', weapon: 'sword', bones: true, eyes: 0xff5a2a, weaponColor: 0x9a8a70 },
  necro: { body: 0x2a2238, legs: 0x1a1622, skin: 0xb8c0a0, helmet: 'hood', hood: 0x1e1a2a, weapon: 'staff', orb: 0x9a6aff, robe: 0x2a2238, eyes: 0xb08aff },
  wraith: { body: 0x3a4a5a, legs: 0x3a4a5a, skin: 0x9ab0c0, helmet: 'hood', hood: 0x2a3a4a, weapon: 'scythe', float: true, eyes: 0x7fe8ff },
  golem: { body: BONE, legs: 0xc8c0aa, skin: 0xe0d8c4, helmet: 'bald', weapon: 'club', bones: true, eyes: 0x7dff8a, bulk: 1.35, weaponColor: 0xd8d0bc },
  frostmage: { body: 0x3a6aa8, legs: 0x2a3a5a, skin: 0xe0c8b0, helmet: 'hood', hood: 0x5a8ac8, weapon: 'staff', orb: 0x9fe8ff, robe: 0x3a6aa8, beard: 0xe8eef4 },
  giant: { body: 0x7a8a9a, legs: 0x4a5a6a, skin: 0xa8c0d0, helmet: 'bald', weapon: 'club', beard: 0xe8eef4, bulk: 1.2, belt: 0x5a4a3a, weaponColor: 0x9ac8e8 },
  knight: { body: 0x2a2a32, legs: 0x1a1a20, skin: 0x5a5a62, helmet: 'fullhelm', plume: 0x8a1c1c, weapon: 'greatsword', shield: 'tower', shieldColor: 0x3a1a1a, pauldrons: 0x3a3a44, eyes: 0xff3a2a },
  chieftain: { body: 0x4a1f1f, legs: 0x2a1a14, skin: 0xd9a066, helmet: 'crown', weapon: 'axe', beard: 0xd8d8d8, cape: 0x2a2a2a, pauldrons: 0x6a5a4a },
  warlord: { body: 0x2a2228, legs: 0x1a1418, skin: 0xb07a50, helmet: 'crown', weapon: 'hammer', beard: 0x1a1a1a, cape: 0x8a1c1c, pauldrons: 0x3a3a40 },
  trollking: { body: 0x4a6a3a, legs: 0x3a2a1e, skin: 0x6a8a4a, helmet: 'troll', weapon: 'club', bulk: 1.3, belt: 0x5a3a1a, eyes: 0xffd23f, weaponColor: 0x6b4a2a },
  lich: { body: 0x2a1a3a, legs: 0x1a1028, skin: 0xd8d0bc, helmet: 'crown', weapon: 'staff', orb: 0x7dff9a, robe: 0x2a1a3a, eyes: 0x7dff9a, cape: 0x1a1028, bones: true },
  wraithqueen: { body: 0x5a3a6a, legs: 0x5a3a6a, skin: 0xc0b0d8, helmet: 'icecrown', weapon: 'scythe', float: true, eyes: 0xff6ad8, cape: 0x3a2a4a },
  jarl: { body: 0x6a7a8a, legs: 0x3a4a5a, skin: 0x9ab8d0, helmet: 'horn', beard: 0xf0f4f8, weapon: 'hammer', cape: 0x2a4a7a, bulk: 1.2, pauldrons: 0xc8d8e8 },
  witch: { body: 0xb8d8f0, legs: 0x8ab0d0, skin: 0xe8f0f8, helmet: 'icecrown', weapon: 'staff', orb: 0xbff4ff, robe: 0xd0e8f8, eyes: 0x9fe8ff, cape: 0x8ab8e0 },
  dreadking: { body: 0x1a1418, legs: 0x100c10, skin: 0x504048, helmet: 'dread', weapon: 'greatsword', cape: 0x6a0a14, pauldrons: 0x2a2028, eyes: 0xff2a2a, bulk: 1.15, weaponColor: 0x3a3040 },
};

/** Top half of a sphere (helmets, caps). */
const dome = (rad: number, c: number, p?: V3, s?: V3) =>
  part(new THREE.SphereGeometry(rad, 16, 8, 0, PI * 2, 0, PI / 2), c, p, ZERO, s);

/** Cartoon eyes on a head of radius HEAD_R centred at y. */
function eyes(p: Part[], y: number, glowColor?: number): void {
  for (const sx of [-1, 1]) {
    if (glowColor) {
      p.push(glow(ball(0.062, glowColor, [sx * 0.095, y + 0.02, 0.235]), 1));
    } else {
      p.push(ball(0.072, 0xffffff, [sx * 0.1, y + 0.025, 0.215], ZERO, [1, 1.15, 0.8]));
      p.push(ball(0.04, 0x1a1418, [sx * 0.1, y + 0.02, 0.27]));
    }
  }
}

const HEAD_R = 0.27;
const HEAD_Y = 1.6;

function torsoParts(sp: HumanSpec): Part[] {
  const b = sp.bulk ?? 1;
  const p: Part[] = [];
  if (sp.bones) {
    p.push(
      cyl(0.07, 0.07, 0.72, 5, sp.body, [0, 0.98, 0]),
      ...[0.84, 0.99, 1.14].map((y) => tor(0.21 * b, 0.045, sp.body, [0, y, 0], [PI / 2, 0, 0])),
      sph(0.24 * b, 8, 6, 0xc8c0aa, [0, 0.7, 0], ZERO, [1, 0.45, 0.8]),
    );
  } else {
    // A soft bean of a body with a belt.
    p.push(sph(0.36, 10, 8, sp.body, [0, 1.02, 0], ZERO, [b, 1.15, 0.86 * b]));
    p.push(tor(0.3 * b, 0.065, sp.belt ?? 0x4a3020, [0, 0.8, 0], [PI / 2, 0, 0], PI * 2));
    p.push(ball(0.06, 0xd8b04a, [0, 0.8, 0.33 * b]));
  }
  p.push(sph(HEAD_R, 10, 8, sp.skin, [0, HEAD_Y, 0]));
  if (sp.eyes) eyes(p, HEAD_Y, sp.eyes);
  else {
    eyes(p, HEAD_Y);
    p.push(ball(0.05, sp.skin, [0, HEAD_Y - 0.06, 0.27]));
  }
  // Left arm (static, holds the shield).
  p.push(cap(0.085, 0.34, sp.body, [-0.37 * b, 1.06, 0], [0, 0, -0.14]), ball(0.095, sp.skin, [-0.42 * b, 0.78, 0]));
  if (sp.beard) p.push(sph(0.17, 8, 6, sp.beard, [0, HEAD_Y - 0.15, 0.17], ZERO, [1.05, 0.78, 0.62]));
  if (sp.robe) p.push(cyl(0.32 * b, 0.5 * b, 0.62, 8, sp.robe, [0, 0.36, 0]));
  if (sp.float) p.push(cone(0.42 * b, 0.9, 7, sp.body, [0, 0.25, -0.05], [PI, 0, 0]));
  if (sp.pauldrons) {
    p.push(dome(0.21, sp.pauldrons, [-0.38 * b, 1.28, 0], [1.1, 0.85, 1.1]), dome(0.21, sp.pauldrons, [0.38 * b, 1.28, 0], [1.1, 0.85, 1.1]));
  }
  if (sp.barrel) {
    p.push(
      cyl(0.26, 0.26, 0.5, 8, 0x7a5232, [0, 1.05, -0.42]),
      cyl(0.27, 0.27, 0.05, 8, 0x3a3a40, [0, 1.25, -0.42]),
      cyl(0.27, 0.27, 0.05, 8, 0x3a3a40, [0, 0.85, -0.42]),
      cyl(0.02, 0.02, 0.22, 6, 0x2a2a2a, [0.1, 1.38, -0.42]),
      glow(ball(0.07, 0xffb43a, [0.1, 1.5, -0.42]), 1),
    );
  }
  const bone = 0xefe4c8;
  const top = HEAD_Y + 0.02;
  switch (sp.helmet) {
    case 'knight':
      p.push(
        dome(0.3, 0xc9d1d9, [0, top, 0], [1, 1.05, 1]),
        cyl(0.3, 0.3, 0.08, 10, 0xa8b0b8, [0, top, 0]),
        box(0.08, 0.36, 0.44, sp.plume ?? 0xffffff, [0, top + 0.36, -0.04]),
      );
      break;
    case 'horn':
      p.push(
        dome(0.295, 0x8a8a8a, [0, top, 0]),
        cyl(0.3, 0.3, 0.07, 10, 0x6a6a6a, [0, top, 0]),
        cone(0.075, 0.38, 6, bone, [0.33, top + 0.14, 0], [0, 0, -0.9]),
        cone(0.075, 0.38, 6, bone, [-0.33, top + 0.14, 0], [0, 0, 0.9]),
      );
      break;
    case 'hood':
      p.push(cone(0.34, 0.66, 8, sp.hood ?? 0x444444, [0, top + 0.18, -0.03]), dome(0.3, sp.hood ?? 0x444444, [0, top - 0.04, -0.03]));
      break;
    case 'cap':
      p.push(dome(0.285, sp.cap ?? 0x444444, [0, top, 0]), box(0.34, 0.05, 0.22, sp.cap ?? 0x444444, [0, top + 0.01, 0.26]));
      break;
    case 'hat':
      p.push(cyl(0.44, 0.44, 0.05, 10, sp.cap ?? 0x444444, [0, top + 0.12, 0]), cyl(0.22, 0.27, 0.34, 8, sp.cap ?? 0x444444, [0, top + 0.3, 0]), box(0.06, 0.28, 0.04, 0xf2c94c, [0.18, top + 0.38, 0.12], [0, 0, -0.5]));
      break;
    case 'miner':
      p.push(dome(0.3, 0xe8c23a, [0, top, 0]), cyl(0.32, 0.32, 0.05, 10, 0xd0aa2a, [0, top, 0]), glow(ball(0.07, 0xfff6b0, [0, top + 0.08, 0.29]), 2));
      break;
    case 'kettle':
      p.push(dome(0.29, 0x9aa3ad, [0, top, 0]), cyl(0.44, 0.44, 0.05, 12, 0x9aa3ad, [0, top, 0]));
      break;
    case 'bandana':
      p.push(dome(0.28, 0x2a2a2a, [0, top - 0.04, 0]), box(0.08, 0.22, 0.06, 0x2a2a2a, [0.05, top - 0.1, -0.28]));
      break;
    case 'crown':
      p.push(
        dome(0.295, 0x505050, [0, top, 0]),
        cone(0.085, 0.44, 6, bone, [0.34, top + 0.16, 0], [0, 0, -0.9]),
        cone(0.085, 0.44, 6, bone, [-0.34, top + 0.16, 0], [0, 0, 0.9]),
        cyl(0.2, 0.22, 0.14, 8, 0xf2c230, [0, top + 0.26, 0]),
        ...[0, 1, 2, 3, 4].map((i) => cone(0.04, 0.12, 4, 0xf2c230, [Math.sin(i * 1.257) * 0.19, top + 0.38, Math.cos(i * 1.257) * 0.19])),
      );
      break;
    case 'feather':
      p.push(
        cyl(0.275, 0.275, 0.08, 10, 0x8a3b2e, [0, top - 0.06, 0]),
        box(0.05, 0.4, 0.1, 0xf0f0e0, [0, top + 0.2, -0.2], [-0.3, 0, 0]),
        box(0.05, 0.36, 0.1, 0x3a8a8a, [0.12, top + 0.17, -0.2], [-0.3, 0, -0.3]),
        box(0.05, 0.36, 0.1, 0xd94b3b, [-0.12, top + 0.17, -0.2], [-0.3, 0, 0.3]),
      );
      break;
    case 'fullhelm':
      p.push(
        box(0.58, 0.56, 0.58, 0x3a3a44, [0, HEAD_Y + 0.02, 0]),
        box(0.4, 0.06, 0.06, 0x111111, [0, HEAD_Y + 0.03, 0.29]),
        box(0.06, 0.34, 0.4, sp.plume ?? 0x8a1c1c, [0, HEAD_Y + 0.44, -0.05]),
      );
      break;
    case 'icecrown':
      p.push(cyl(0.28, 0.29, 0.12, 10, 0xd8eef8, [0, top + 0.12, 0]));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * PI * 2;
        p.push(glow(cone(0.06, 0.38 + (i % 2) * 0.15, 4, 0x9fe8ff, [Math.sin(a) * 0.22, top + 0.34, Math.cos(a) * 0.22]), 0.7));
      }
      break;
    case 'dread':
      p.push(dome(0.32, 0x2a2228, [0, top - 0.02, 0], [1, 1.1, 1]));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        p.push(cone(0.07, 0.5, 4, 0x1a1418, [Math.sin(a) * 0.26, top + 0.42, Math.cos(a) * 0.26], [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25]));
      }
      break;
    case 'troll':
      p.push(
        cone(0.12, 0.42, 6, sp.skin, [0.34, HEAD_Y + 0.04, 0], [0, 0, -1.3]),
        cone(0.12, 0.42, 6, sp.skin, [-0.34, HEAD_Y + 0.04, 0], [0, 0, 1.3]),
        cone(0.045, 0.18, 6, bone, [0.1, HEAD_Y - 0.13, 0.24], [-0.3, 0, 0]),
        cone(0.045, 0.18, 6, bone, [-0.1, HEAD_Y - 0.13, 0.24], [-0.3, 0, 0]),
        cyl(0.2, 0.24, 0.12, 8, 0xf2c230, [0, top + 0.26, 0]),
      );
      break;
    case 'bald':
      break;
  }
  if (sp.cape) p.push(box(0.6 * b, 0.95, 0.07, sp.cape, [0, 1.0, -0.32 * b], [0.14, 0, 0]));
  if (sp.shield === 'round') {
    p.push(
      cyl(0.36, 0.36, 0.09, 12, sp.shieldColor ?? 0x8a6a3a, [-0.55 * b, 1.0, 0.08], [0, 0, PI / 2]),
      tor(0.34, 0.035, 0xc9d1d9, [-0.6 * b, 1.0, 0.08], [0, PI / 2, 0]),
      ball(0.1, 0xf2c94c, [-0.61 * b, 1.0, 0.08]),
    );
  } else if (sp.shield === 'tower') {
    p.push(
      box(0.12, 1.15, 0.8, sp.shieldColor ?? 0x6a4a30, [-0.58 * b, 0.95, 0.1]),
      box(0.14, 0.12, 0.84, 0x8a8a8a, [-0.58 * b, 1.45, 0.1]),
      box(0.14, 0.12, 0.84, 0x8a8a8a, [-0.58 * b, 0.45, 0.1]),
    );
  }
  return p;
}

function armParts(sp: HumanSpec): Part[] {
  const p: Part[] = [cap(0.085, 0.34, sp.body, [0, -0.22, 0]), ball(0.095, sp.skin, [0, -0.52, 0])];
  const wood = 0x7a5232;
  const steel = sp.weaponColor ?? 0xd5dce4;
  const iron = sp.weaponColor ?? 0x8f969e;
  switch (sp.weapon) {
    case 'sword':
      p.push(box(0.09, 0.05, 0.86, steel, [0, -0.55, 0.52]), cone(0.045, 0.12, 4, steel, [0, -0.55, 1.0], [PI / 2, PI / 4, 0]), box(0.36, 0.08, 0.09, 0xe0b040, [0, -0.55, 0.1]), cyl(0.035, 0.035, 0.18, 6, 0x5a3a20, [0, -0.55, 0], [PI / 2, 0, 0]));
      break;
    case 'dagger':
      p.push(box(0.07, 0.05, 0.5, steel, [0, -0.55, 0.3]), box(0.2, 0.06, 0.06, 0x5a3a20, [0, -0.55, 0.06]));
      break;
    case 'axe':
      p.push(cyl(0.035, 0.035, 0.8, 6, wood, [0, -0.55, 0.32], [PI / 2, 0, 0]), sph(0.2, 8, 6, iron, [0, -0.45, 0.66], ZERO, [0.25, 1, 0.75]));
      break;
    case 'twinaxe':
      p.push(cyl(0.035, 0.035, 0.9, 6, wood, [0, -0.55, 0.36], [PI / 2, 0, 0]), sph(0.2, 8, 6, iron, [0, -0.36, 0.74], ZERO, [0.25, 1, 0.75]), sph(0.2, 8, 6, iron, [0, -0.74, 0.74], ZERO, [0.25, 1, 0.75]));
      break;
    case 'pick':
      p.push(cyl(0.035, 0.035, 0.8, 6, wood, [0, -0.55, 0.32], [PI / 2, 0, 0]), box(0.07, 0.6, 0.08, iron, [0, -0.55, 0.68]));
      break;
    case 'spear':
      p.push(cyl(0.03, 0.03, 1.7, 6, 0x8b6a4a, [0, -0.55, 0.45], [PI / 2, 0, 0]), cone(0.09, 0.3, 6, steel, [0, -0.55, 1.44], [PI / 2, 0, 0]));
      break;
    case 'club':
      p.push(cyl(0.07, 0.18, 0.95, 8, sp.weaponColor ?? 0x6b4a2a, [0, -0.55, 0.5], [-PI / 2, 0, 0]), ball(0.18, sp.weaponColor ?? 0x6b4a2a, [0, -0.55, 0.95]));
      break;
    case 'bow':
      p.push(tor(0.52, 0.035, wood, [0, -0.55, 0.12], [0, PI / 2, 0], PI * 0.9), box(0.012, 0.98, 0.012, 0xeeeeee, [0, -0.55, -0.02]));
      break;
    case 'hammer':
      p.push(cyl(0.035, 0.035, 1.1, 6, wood, [0, -0.55, 0.45], [PI / 2, 0, 0]), box(0.36, 0.36, 0.54, 0x3a3a40, [0, -0.55, 0.98]));
      break;
    case 'staff':
      p.push(cyl(0.035, 0.04, 1.5, 6, 0x5a3d26, [0, -0.55, 0.35], [PI / 2, 0, 0]), glow(ball(0.14, sp.orb ?? 0xffffff, [0, -0.55, 1.15]), 1));
      break;
    case 'greatsword':
      p.push(box(0.14, 0.05, 1.3, steel, [0, -0.55, 0.75]), box(0.44, 0.09, 0.09, 0x3a3040, [0, -0.55, 0.1]), cyl(0.035, 0.035, 0.22, 6, 0x2a1a14, [0, -0.55, -0.02], [PI / 2, 0, 0]));
      if (sp.eyes) p.push(glow(box(0.03, 0.06, 1.1, sp.eyes, [0, -0.55, 0.8]), 0.8));
      break;
    case 'scythe':
      p.push(cyl(0.03, 0.03, 1.5, 6, 0x3a3030, [0, -0.55, 0.4], [PI / 2, 0, 0]), tor(0.42, 0.045, 0xb8c8d8, [0, -0.2, 1.05], [0, PI / 2, 0], PI * 0.55));
      break;
    case 'none':
      break;
  }
  return p;
}

export interface UnitModel {
  group: THREE.Group;
  body: THREE.Group;
  meshes: THREE.Mesh[];
  /** This model's own material (same shader as every unit), so tints never swap shaders. */
  baseMat: THREE.MeshLambertMaterial;
  baseEmissive: THREE.Color;
  /** Hit pulse 1 → 0 and its strength. */
  hitT: number;
  hitK: number;
  phase: number;
  anim(dt: number, moving: boolean, speed: number, swingT: number): void;
}

function finish(group: THREE.Group, body: THREE.Group, mat: THREE.Material, anim: UnitModel['anim']): UnitModel {
  const own = mat === Mat.spirit ? spiritLam() : unitLam();
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = own;
      meshes.push(o);
    }
  });
  const m: UnitModel = { group, body, meshes, baseMat: own, baseEmissive: own.emissive.clone(), hitT: 0, hitK: 1, phase: Math.random() * 6, anim };
  return m;
}

/** A hit: a quick cartoon squash and a soft warm glow. Rapid hits don't stack into a blob. */
export function hitPulse(m: UnitModel, k = 1): void {
  if (m.hitT > 0.45) return;
  m.hitT = 1;
  m.hitK = k;
}

const _tint = new THREE.Color();
function addTint(c: THREE.Color, k: number): void {
  _tint.r += c.r * k;
  _tint.g += c.g * k;
  _tint.b += c.b * k;
}
const TINT_HIT = new THREE.Color(0xffe8c8);
const TINT_CHILL = new THREE.Color(0x3c8cff);
const TINT_BURN = new THREE.Color(0xff6a1a);
const TINT_HOLY = new THREE.Color(0xffd86a);
export type LookStatus = 'chill' | 'burn' | 'holy' | null;

/** Per-frame: hit squash/glow and status tints on the model's own material. */
export function updateLook(m: UnitModel, dt: number, status: LookStatus, time: number): void {
  if (m.hitT > 0) m.hitT = Math.max(0, m.hitT - dt / 0.22);
  const h = m.hitT * m.hitK;
  _tint.copy(m.baseEmissive);
  if (status === 'chill') addTint(TINT_CHILL, 0.32);
  else if (status === 'burn') addTint(TINT_BURN, 0.22 + 0.12 * Math.sin(time * 18));
  else if (status === 'holy') addTint(TINT_HOLY, 0.3);
  if (h > 0) addTint(TINT_HIT, 0.38 * h);
  if (!m.baseMat.emissive.equals(_tint)) m.baseMat.emissive.copy(_tint);
  // Springy squash: flattened on impact, then a little stretch, then rest.
  const t = 1 - m.hitT;
  const sq = Math.cos(t * PI * 2.4) * m.hitT * 0.17 * m.hitK;
  m.body.scale.set(1 + sq, 1 - sq * 1.25, 1 + sq);
}

function humanoid(kind: HumanKind, cast: boolean): UnitModel {
  const sp = SPECS[kind] ?? SPECS.raider!;
  const mat = sp.float ? Mat.spirit : Mat.unit;
  const torsoGeo = cached('torso:' + kind, () => torsoParts(sp), false);
  const armGeo = cached('arm:' + kind, () => armParts(sp), false);
  const legGeo = cached('leg:' + sp.legs + (sp.bones ? 'b' : ''), () => [
    cap(sp.bones ? 0.045 : 0.1, sp.bones ? 0.4 : 0.28, sp.legs, [0, -0.25, 0]),
    sph(0.13, 8, 6, sp.bones ? sp.legs : 0x3a2a20, [0, -0.52, 0.05], ZERO, [0.85, 0.62, 1.25]),
  ], false);
  const b = sp.bulk ?? 1;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(makeMesh(torsoGeo, cast, false, mat));
  const legL = new THREE.Group();
  legL.position.set(-0.13 * b, 0.6, 0);
  legL.add(makeMesh(legGeo, false, false, mat));
  const legR = new THREE.Group();
  legR.position.set(0.13 * b, 0.6, 0);
  legR.add(makeMesh(legGeo, false, false, mat));
  if (!sp.float) group.add(legL, legR);
  const armR = new THREE.Group();
  armR.position.set(0.37 * b, 1.3, 0);
  armR.add(makeMesh(armGeo, false, false, mat));
  body.add(armR);
  const float = !!sp.float;
  const m = finish(group, body, mat, (dt, moving, speed, swingT) => {
    if (moving) m.phase += dt * speed * 2.3;
    else m.phase += dt * 2;
    const a = moving ? Math.sin(m.phase) * 0.7 : 0;
    const k = Math.min(1, dt * 14);
    legL.rotation.x += (a - legL.rotation.x) * k;
    legR.rotation.x += (-a - legR.rotation.x) * k;
    if (float) body.position.y = 0.35 + Math.sin(m.phase * 0.8) * 0.1;
    else body.position.y = moving ? Math.abs(Math.sin(m.phase)) * 0.06 : 0;
    let ax: number;
    if (swingT < 1) {
      const t = swingT;
      if (t < 0.35) ax = -0.3 + (-2.5 + 0.3) * (t / 0.35);
      else if (t < 0.6) ax = -2.5 + (2.3 * (t - 0.35)) / 0.25;
      else ax = -0.2;
    } else {
      ax = moving ? a * 0.5 - 0.2 : -0.2;
    }
    armR.rotation.x = ax;
  });
  return m;
}

// Quadrupeds (wolf, mammoth)
interface QuadSpec {
  fur: number;
  belly: number;
  len: number;
  h: number;
  w: number;
  leg: number;
  legW: number;
  eyes: number;
  mammoth?: boolean;
}

function quadruped(kind: string, q: QuadSpec, cast: boolean): UnitModel {
  const bodyGeo = cached('quad:' + kind, () => {
    const y = q.leg + q.h / 2;
    const p: Part[] = [
      sph(0.5, 10, 8, q.fur, [0, y, 0], ZERO, [q.w * 1.05, q.h * 1.15, q.len]),
      sph(0.5, 10, 8, q.belly, [0, y - q.h * 0.22, 0.02], ZERO, [q.w * 0.85, q.h * 0.75, q.len * 0.82]),
    ];
    if (q.mammoth) {
      const hy = y + q.h * 0.15;
      const hz = q.len / 2 + 0.35;
      p.push(
        sph(0.5, 10, 8, q.fur, [0, hy, hz], ZERO, [q.w * 0.78, q.h * 0.85, 1.25]),
        sph(0.5, 10, 8, q.fur, [0, hy + q.h * 0.35, hz - 0.2], ZERO, [q.w * 0.55, q.h * 0.45, 0.9]),
        cyl(0.24, 0.12, 1.4, 8, q.fur, [0, hy - 0.75, hz + 0.55], [0.3, 0, 0]),
        cyl(0.12, 0.09, 0.7, 8, q.fur, [0, hy - 1.55, hz + 0.72], [-0.25, 0, 0]),
        // Curved tusks.
        tor(0.75, 0.09, BONE, [0.5, hy - 0.75, hz + 0.25], [0, PI / 2, 0], PI * 0.62),
        tor(0.75, 0.09, BONE, [-0.5, hy - 0.75, hz + 0.25], [0, PI / 2, 0], PI * 0.62),
        sph(0.5, 8, 6, q.fur, [0.82, hy + 0.05, hz - 0.25], [0, 0.35, 0], [0.18, 1.0, 0.85]),
        sph(0.5, 8, 6, q.fur, [-0.82, hy + 0.05, hz - 0.25], [0, -0.35, 0], [0.18, 1.0, 0.85]),
        glow(ball(0.1, q.eyes, [0.34, hy + 0.15, hz + 0.55]), 1),
        glow(ball(0.1, q.eyes, [-0.34, hy + 0.15, hz + 0.55]), 1),
        // War howdah
        box(q.w * 0.8, 0.9, q.len * 0.45, 0x7a3b22, [0, y + q.h / 2 + 0.45, -0.2]),
        box(q.w * 0.86, 0.14, q.len * 0.5, 0xd8b04a, [0, y + q.h / 2 + 0.92, -0.2]),
        cyl(0.05, 0.05, 2.0, 5, 0x5a3d26, [0, y + q.h / 2 + 1.9, -0.2]),
        box(0.9, 0.6, 0.05, 0x8a1c1c, [0.47, y + q.h / 2 + 2.5, -0.2]),
        sph(0.5, 10, 6, 0xd8b04a, [0, y + 0.25, 0.3], ZERO, [q.w * 1.08, 0.3, q.len * 0.32]),
        cone(0.16, 0.9, 6, q.fur, [0, y + 0.1, -q.len / 2 - 0.3], [-0.6, 0, 0]),
      );
    } else {
      const hy = y + q.h * 0.3;
      const hz = q.len / 2 + 0.1;
      p.push(
        sph(0.5, 10, 8, q.fur, [0, hy, hz], ZERO, [q.w * 0.95, q.h * 1.0, q.len * 0.42]),
        sph(0.5, 8, 6, q.belly, [0, hy - q.h * 0.18, hz + q.len * 0.24], ZERO, [q.w * 0.5, q.h * 0.42, q.len * 0.36]),
        ball(0.055, 0x111111, [0, hy - q.h * 0.05, hz + q.len * 0.41]),
        cone(0.1, 0.26, 4, q.fur, [q.w * 0.26, hy + q.h * 0.55, hz - 0.03]),
        cone(0.1, 0.26, 4, q.fur, [-q.w * 0.26, hy + q.h * 0.55, hz - 0.03]),
        glow(ball(0.05, q.eyes, [q.w * 0.2, hy + q.h * 0.16, hz + q.len * 0.17]), 1),
        glow(ball(0.05, q.eyes, [-q.w * 0.2, hy + q.h * 0.16, hz + q.len * 0.17]), 1),
        cone(0.12, q.len * 0.6, 8, q.fur, [0, y + q.h * 0.3, -q.len / 2 - q.len * 0.2], [-1.15, 0, 0]),
        sph(0.5, 8, 6, q.belly, [0, y + q.h * 0.45, -q.len / 2 - q.len * 0.45], ZERO, [0.16, 0.16, 0.22]),
      );
    }
    return p;
  }, false);
  const legGeo = cached('qleg:' + kind, () => [
    cap(q.legW * 0.55, Math.max(0.05, q.leg - q.legW * 1.1), q.fur, [0, -q.leg / 2, 0]),
    sph(q.legW * 0.7, 8, 6, q.belly, [0, -q.leg + q.legW * 0.3, 0.03], ZERO, [1, 0.6, 1.25]),
  ], false);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(makeMesh(bodyGeo, cast, false, Mat.unit));
  const legs: THREE.Group[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const lg = new THREE.Group();
    lg.position.set(sx * (q.w / 2 - q.legW / 2), q.leg, sz * (q.len / 2 - q.legW));
    lg.add(makeMesh(legGeo, false, false, Mat.unit));
    group.add(lg);
    legs.push(lg);
  }
  const m = finish(group, body, Mat.unit, (dt, moving, speed, swingT) => {
    if (moving) m.phase += dt * speed * (q.mammoth ? 1.6 : 2.4);
    const a = moving ? Math.sin(m.phase) * (q.mammoth ? 0.35 : 0.8) : 0;
    const k = Math.min(1, dt * 14);
    legs.forEach((l, i) => {
      const s = i === 0 || i === 3 ? a : -a;
      l.rotation.x += (s - l.rotation.x) * k;
    });
    body.position.y = moving ? Math.abs(Math.sin(m.phase)) * (q.mammoth ? 0.12 : 0.08) : 0;
    const lunge = swingT < 1 ? Math.sin(swingT * PI) : 0;
    body.rotation.x = -lunge * (q.mammoth ? 0.18 : 0.25);
    body.position.z = lunge * (q.mammoth ? 0.4 : 0.25);
  });
  return m;
}

function ramModel(cast: boolean): UnitModel {
  const frame = cached('ram', () => [
    box(1.7, 0.25, 2.8, 0x6b4423, [0, 0.62, 0]),
    ...[-0.75, 0.75].flatMap((x) => [-1.2, 1.2].map((z) => box(0.16, 1.6, 0.16, 0x7a5232, [x, 1.4, z]))),
    prism(2.9, 2.2, 1.1, 0x5a3d26, [0, 2.1, 0], [0, PI / 2, 0]),
    ...[0, 1, 2, 3].map((i) => box(0.06, 0.5, 2.8, 0x8a8a8a, [-0.62 + i * 0.41, 2.25, 0], [0, 0, i < 2 ? 0.6 : -0.6])),
    box(1.9, 0.08, 0.08, 0x3a3a40, [0, 0.9, 1.3]),
  ], false);
  const wheel = cached('ramwheel', () => [cyl(0.42, 0.42, 0.16, 8, 0x4a3520, ZERO, [0, 0, PI / 2]), cyl(0.12, 0.12, 0.2, 6, 0x3a3a40, ZERO, [0, 0, PI / 2])], false);
  const log = cached('ramlog', () => [cyl(0.22, 0.22, 3.2, 7, 0x7a5232, [0, 0, 0.3], [PI / 2, 0, 0]), cyl(0.3, 0.26, 0.5, 7, 0x3a3a40, [0, 0, 1.95], [PI / 2, 0, 0]), cone(0.28, 0.35, 7, 0x50545a, [0, 0, 2.35], [PI / 2, 0, 0])], false);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(makeMesh(frame, cast, false, Mat.unit));
  const wheels: THREE.Mesh[] = [];
  for (const x of [-0.95, 0.95]) {
    for (const z of [-1.0, 1.0]) {
      const w = makeMesh(wheel, false, false, Mat.unit);
      w.position.set(x, 0.42, z);
      body.add(w);
      wheels.push(w);
    }
  }
  const logG = new THREE.Group();
  logG.position.set(0, 1.35, 0);
  logG.add(makeMesh(log, cast, false, Mat.unit));
  body.add(logG);
  const m = finish(group, body, Mat.unit, (dt, moving, speed, swingT) => {
    if (moving) for (const w of wheels) w.rotation.x += dt * speed * 2.2;
    const t = swingT < 1 ? swingT : 1;
    logG.position.z = t < 1 ? (t < 0.4 ? -0.6 * (t / 0.4) : -0.6 + 1.2 * ((t - 0.4) / 0.6)) * (t < 0.7 ? 1 : (1 - t) / 0.3) : 0;
  });
  return m;
}

function trebuchetModel(cast: boolean): UnitModel {
  const frame = cached('treb', () => [
    box(1.8, 0.25, 3.0, 0x6b4423, [0, 0.6, 0]),
    box(0.18, 2.6, 0.18, 0x7a5232, [-0.7, 1.9, 0], [0.25, 0, 0]),
    box(0.18, 2.6, 0.18, 0x7a5232, [0.7, 1.9, 0], [0.25, 0, 0]),
    box(0.18, 2.6, 0.18, 0x7a5232, [-0.7, 1.9, 0.5], [-0.25, 0, 0]),
    box(0.18, 2.6, 0.18, 0x7a5232, [0.7, 1.9, 0.5], [-0.25, 0, 0]),
    box(1.6, 0.16, 0.16, 0x5a3d26, [0, 3.15, 0.25]),
    ...[-0.95, 0.95].flatMap((x) => [-1.1, 1.1].map((z) => cyl(0.38, 0.38, 0.16, 8, 0x4a3520, [x, 0.38, z], [0, 0, PI / 2]))),
    box(1.5, 0.4, 0.6, 0x8a1c1c, [0, 0.95, -1.1]),
  ], false);
  const arm = cached('trebarm', () => [box(0.14, 0.14, 4.2, 0x7a5232, [0, 0, 0.6]), box(0.8, 0.8, 0.8, 0x50545a, [0, -0.3, -1.4]), box(0.4, 0.2, 0.4, 0x5a3d26, [0, 0, 2.6])], false);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(makeMesh(frame, cast, false, Mat.unit));
  const armG = new THREE.Group();
  armG.position.set(0, 3.15, 0.25);
  armG.rotation.x = 0.7;
  armG.add(makeMesh(arm, cast, false, Mat.unit));
  body.add(armG);
  const m = finish(group, body, Mat.unit, (_dt, _moving, _speed, swingT) => {
    armG.rotation.x = swingT < 1 ? (swingT < 0.25 ? 0.7 - 2.4 * (swingT / 0.25) : -1.7 + 2.4 * ((swingT - 0.25) / 0.75)) : 0.7;
  });
  return m;
}

/** Leading edge then a scalloped trailing edge, in wing-local (x out, z forward). */
const DRAGON_WING: [number, number][] = [
  [0, 0.45], [0.7, 0.62], [1.5, 0.5], [2.3, 0.32], [2.75, -0.15], [2.35, -0.35], [2.05, -0.75], [1.7, -0.55],
  [1.35, -1.0], [1.0, -0.7], [0.65, -1.05], [0.3, -0.62], [0, -0.55],
];
const BAT_WING: [number, number][] = [
  [0, 0.25], [0.6, 0.35], [1.4, 0.2], [1.75, -0.15], [1.4, -0.3], [1.15, -0.62], [0.85, -0.38], [0.55, -0.7], [0.3, -0.4], [0, -0.35],
];

/** Thin extruded wing membrane lying flat in XZ. */
function wingMembrane(pts: [number, number][], thick: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  pts.forEach(([x, z], i) => (i === 0 ? sh.moveTo(x, z) : sh.lineTo(x, z)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateX(PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}

interface FlyerSpec {
  body: number;
  wing: number;
  belly: number;
  eyes: number;
  size: number;
  dragon?: boolean;
  bat?: boolean;
}

function flyer(kind: string, f: FlyerSpec, cast: boolean): UnitModel {
  const s = f.size;
  const bodyGeo = cached('fly:' + kind, () => {
    if (f.bat) {
      return [
        sph(0.28, 7, 5, f.body, [0, 0, 0], ZERO, [1, 0.9, 1.2]),
        sph(0.19, 6, 5, f.body, [0, 0.12, 0.3]),
        cone(0.08, 0.24, 4, f.body, [0.1, 0.32, 0.28]),
        cone(0.08, 0.24, 4, f.body, [-0.1, 0.32, 0.28]),
        glow(ball(0.045, f.eyes, [0.075, 0.16, 0.47]), 1),
        glow(ball(0.045, f.eyes, [-0.075, 0.16, 0.47]), 1),
        cone(0.025, 0.07, 4, 0xffffff, [0.05, 0.03, 0.47], [PI, 0, 0]),
        cone(0.025, 0.07, 4, 0xffffff, [-0.05, 0.03, 0.47], [PI, 0, 0]),
      ];
    }
    const p: Part[] = [
      sph(0.5, 10, 8, f.body, [0, 0, 0], ZERO, [0.78 * s, 0.68 * s, 1.55 * s]),
      sph(0.5, 10, 8, f.belly, [0, -0.17 * s, 0.08 * s], ZERO, [0.6 * s, 0.42 * s, 1.3 * s]),
      // neck and head
      cap(0.17 * s, 0.6 * s, f.body, [0, 0.3 * s, 0.95 * s], [1.05, 0, 0]),
      sph(0.5, 10, 8, f.body, [0, 0.52 * s, 1.42 * s], ZERO, [0.48 * s, 0.4 * s, 0.62 * s]),
      sph(0.5, 10, 8, f.belly, [0, 0.4 * s, 1.72 * s], ZERO, [0.34 * s, 0.2 * s, 0.42 * s]),
      ball(0.035 * s, 0x1a1010, [0.07 * s, 0.5 * s, 1.92 * s]),
      ball(0.035 * s, 0x1a1010, [-0.07 * s, 0.5 * s, 1.92 * s]),
      glow(ball(0.065 * s, f.eyes, [0.15 * s, 0.62 * s, 1.6 * s]), 1),
      glow(ball(0.065 * s, f.eyes, [-0.15 * s, 0.62 * s, 1.6 * s]), 1),
      // tail
      cone(0.2 * s, 1.5 * s, 8, f.body, [0, -0.02 * s, -1.4 * s], [-PI / 2 - 0.08, 0, 0]),
      cone(0.16 * s, 0.32 * s, 4, f.wing, [0, 0.02 * s, -2.1 * s], [-PI / 2, 0, 0], [1.8, 1, 0.35]),
      // legs
      cap(0.08 * s, 0.25 * s, f.body, [0.17 * s, -0.42 * s, 0.38 * s], [0.4, 0, 0]),
      cap(0.08 * s, 0.25 * s, f.body, [-0.17 * s, -0.42 * s, 0.38 * s], [0.4, 0, 0]),
      cap(0.09 * s, 0.25 * s, f.body, [0.2 * s, -0.4 * s, -0.4 * s], [0.4, 0, 0]),
      cap(0.09 * s, 0.25 * s, f.body, [-0.2 * s, -0.4 * s, -0.4 * s], [0.4, 0, 0]),
    ];
    if (f.dragon) {
      p.push(
        cone(0.07 * s, 0.5 * s, 6, BONE, [0.15 * s, 0.82 * s, 1.24 * s], [-1.0, 0, -0.2]),
        cone(0.07 * s, 0.5 * s, 6, BONE, [-0.15 * s, 0.82 * s, 1.24 * s], [-1.0, 0, 0.2]),
        ...[0, 1, 2, 3, 4].map((i) => cone(0.09 * s, 0.3 * s, 4, f.wing, [0, (0.36 - i * 0.03) * s, (0.55 - i * 0.38) * s], [-0.3, 0, 0])),
      );
    } else {
      p.push(cone(0.05 * s, 0.3 * s, 6, BONE, [0.12 * s, 0.72 * s, 1.3 * s], [-1.1, 0, 0]), cone(0.05 * s, 0.3 * s, 6, BONE, [-0.12 * s, 0.72 * s, 1.3 * s], [-1.1, 0, 0]));
    }
    return p;
  }, false);
  const wingGeo = cached('wing:' + kind, () => {
    if (f.bat) {
      return [
        part(wingMembrane(BAT_WING, 0.03), f.wing, [0, 0, 0], ZERO, [0.42, 1, 0.42]),
        cap(0.025, 0.55, f.body, [0.36, 0.01, 0.06], [0, 0, PI / 2]),
      ];
    }
    return [
      part(wingMembrane(DRAGON_WING, 0.05), f.wing, [0, 0, 0.2 * s], ZERO, [s, s, s]),
      cap(0.07 * s, 1.1 * s, f.body, [0.65 * s, 0.03 * s, 0.5 * s], [0, 0.12, PI / 2]),
      cap(0.05 * s, 0.9 * s, f.body, [1.75 * s, 0.03 * s, 0.32 * s], [0, 0.42, PI / 2]),
      cone(0.06 * s, 0.25 * s, 6, BONE, [2.32 * s, 0.03 * s, 0.25 * s], [0, 0, -PI / 2]),
    ];
  }, false);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(makeMesh(bodyGeo, cast, false, Mat.unit));
  const wl = new THREE.Group();
  const wr = new THREE.Group();
  const wx = f.bat ? 0.18 : 0.3 * s;
  wl.position.set(-wx, f.bat ? 0.05 : 0.2 * s, f.bat ? 0 : 0.2 * s);
  wr.position.set(wx, f.bat ? 0.05 : 0.2 * s, f.bat ? 0 : 0.2 * s);
  const ml = makeMesh(wingGeo, cast && !f.bat, false, Mat.unit);
  ml.scale.x = -1;
  wl.add(ml);
  wr.add(makeMesh(wingGeo, cast && !f.bat, false, Mat.unit));
  body.add(wl, wr);
  const rate = f.bat ? 16 : f.dragon ? 4.5 : 6.5;
  const m = finish(group, body, Mat.unit, (dt, _moving, _speed, swingT) => {
    m.phase += dt * rate;
    const a = Math.sin(m.phase) * (f.bat ? 0.9 : 0.6);
    wl.rotation.z = -a;
    wr.rotation.z = a;
    body.position.y = Math.sin(m.phase) * (f.bat ? 0.06 : 0.12 * s);
    body.rotation.x = swingT < 1 ? -Math.sin(swingT * PI) * 0.3 : 0;
  });
  return m;
}

/** Build the model for any character or enemy. */
export function unitModel(kind: HumanKind, cast = true): UnitModel {
  switch (kind) {
    case 'wolf':
      return quadruped('wolf', { fur: 0x6b6258, belly: 0x9a8f80, len: 1.1, h: 0.42, w: 0.42, leg: 0.5, legW: 0.12, eyes: 0xffd23f }, cast);
    case 'icewolf':
      return quadruped('icewolf', { fur: 0xc8d8e8, belly: 0xeef4f8, len: 1.2, h: 0.46, w: 0.46, leg: 0.52, legW: 0.13, eyes: 0x7fe8ff }, cast);
    case 'mammoth':
      return quadruped('mammoth', { fur: 0x6a4a2a, belly: 0x4a3420, len: 3.4, h: 2.0, w: 2.2, leg: 1.6, legW: 0.6, eyes: 0xff4a2a, mammoth: true }, cast);
    case 'ram':
      return ramModel(cast);
    case 'trebuchet':
      return trebuchetModel(cast);
    case 'bat':
      return flyer('bat', { body: 0x3a2a3a, wing: 0x5a3a4a, belly: 0x3a2a3a, eyes: 0xff4a2a, size: 1, bat: true }, cast);
    case 'drake':
      return flyer('drake', { body: 0xb8321e, wing: 0xd86a2a, belly: 0xe8a040, eyes: 0xffd23f, size: 0.75 }, cast);
    case 'dragon':
      return flyer('dragon', { body: 0x8a1a12, wing: 0xb8321e, belly: 0xd8903a, eyes: 0xffe24a, size: 2.0, dragon: true }, cast);
    default:
      return humanoid(kind, cast);
  }
}

/** Swap the material of every mesh in a model (frozen solid, ghost…); null restores its own. */
export function setModelMat(m: UnitModel, mat: THREE.Material | null): void {
  const use = mat ?? m.baseMat;
  for (const mesh of m.meshes) if (mesh.material !== use) mesh.material = use;
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
    glow(oct(0.22, 0xf4c430, [0.3, 0.85, 0.35]), 0.25),
    glow(oct(0.18, 0xffd84a, [-0.4, 0.7, 0.45]), 0.25),
    glow(oct(0.2, 0xf4c430, [0.1, 0.6, 0.75]), 0.25),
    oct(0.15, 0xffe27a, [0.75, 0.55, 0.5]),
  ]);
export const crystalGeo = (v: number) =>
  cached('crystal' + v, () => [
    dod(0.7, 0x5a5a6e, [0, 0.3, 0], [0.3, v, 0], [1.3, 0.6, 1.1]),
    glow(cyl(0.0, 0.28, 1.6, 5, 0x7fe3ff, [0, 1.0, 0], [0.1, v, 0.12]), 0.55),
    glow(cyl(0.0, 0.2, 1.1, 5, 0xa8f0ff, [0.45, 0.75, 0.2], [0.2, v, -0.5]), 0.55),
    glow(cyl(0.0, 0.18, 0.9, 5, 0x5ac8ff, [-0.4, 0.65, 0.3], [-0.3, v, 0.5]), 0.55),
    glow(cyl(0.0, 0.16, 0.8, 5, 0xc8a8ff, [0.1, 0.6, -0.45], [-0.4, 0, -0.2]), 0.55),
  ]);
export const crystalStubGeo = () =>
  cached('crystub', () => [dod(0.5, 0x5a5a6e, [0, 0.2, 0], ZERO, [1.3, 0.5, 1.1]), glow(cyl(0, 0.1, 0.3, 5, 0x7fe3ff, [0.1, 0.4, 0]), 0.4)]);
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
export const grassGeo = (v: number) =>
  cached('grass' + v, () => {
    const cols = v === 0 ? [0x5a9e3a, 0x6db04a, 0x4f8f34] : v === 1 ? [0x67aa42, 0x7fbe55, 0x5a9e3a] : [0x5a9e3a, 0x4f8f34, 0x6db04a];
    const p: Part[] = [];
    const n = v === 2 ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + v;
      const h = 0.28 + ((i * 37) % 10) * 0.025;
      p.push(cone(0.045, h, 3, cols[i % 3], [Math.cos(a) * 0.08, h / 2, Math.sin(a) * 0.08], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]));
    }
    if (v === 2) p.push(box(0.07, 0.07, 0.07, 0xfff176, [0.05, 0.36, 0]), box(0.07, 0.07, 0.07, 0xf8f8f8, [-0.08, 0.3, 0.06]));
    return p;
  }, false);
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
    glow(cone(0.35, 0.8, 5, 0xff7a1a, [0, 0.5, 0]), 1),
    glow(cone(0.2, 0.6, 5, 0xffd54a, [0, 0.5, 0]), 1),
  ]);
export const torchGeo = () =>
  cached('torch', () => [
    cyl(0.07, 0.09, 1.9, 5, 0x5a3d26, [0, 0.95, 0]),
    cyl(0.17, 0.1, 0.22, 6, 0x3a3a40, [0, 1.98, 0]),
    glow(cone(0.14, 0.42, 5, 0xff8a2a, [0, 2.26, 0]), 1),
    glow(cone(0.08, 0.3, 5, 0xffe27a, [0, 2.24, 0]), 1),
  ]);
export const lampGeo = () =>
  cached('lamp', () => [
    cyl(0.12, 0.16, 2.2, 6, 0x6f675c, [0, 1.1, 0]),
    box(0.42, 0.06, 0.42, 0x3a3a40, [0, 2.24, 0]),
    glow(box(0.3, 0.36, 0.3, 0xffd27a, [0, 2.45, 0]), 2),
    cone(0.3, 0.26, 4, 0x3a3a40, [0, 2.76, 0], [0, PI / 4, 0]),
  ]);

// ───────────────────────────── Items ─────────────────────────────

export type ItemKind = ResType | 'coin';
export const ITEM_H: Record<ResType, number> = { wood: 0.24, stone: 0.25, gold: 0.17, crystal: 0.26 };

export function itemGeo(t: ItemKind): THREE.BufferGeometry {
  return cached('item:' + t, () => {
    switch (t) {
      case 'wood':
        return [cyl(0.13, 0.13, 0.7, 7, 0x8b5a2b, ZERO, [0, 0, PI / 2]), cyl(0.1, 0.1, 0.72, 7, 0xd9b27c, ZERO, [0, 0, PI / 2])];
      case 'stone':
        return [box(0.46, 0.24, 0.34, 0xa3a8ad), box(0.2, 0.05, 0.15, 0xb9bec3, [0.05, 0.13, 0.03])];
      case 'gold':
        return [box(0.42, 0.16, 0.24, 0xf2c230), box(0.34, 0.04, 0.17, 0xffe27a, [0, 0.09, 0])];
      case 'crystal':
        return [glow(oct(0.17, 0x7fe3ff, ZERO, ZERO, [1, 1.5, 1]), 0.5), glow(oct(0.1, 0xc8a8ff, [0.18, -0.04, 0], ZERO, [1, 1.4, 1]), 0.5)];
      case 'coin':
        return [cyl(0.2, 0.2, 0.06, 10, 0xf5c542), cyl(0.13, 0.13, 0.07, 10, 0xffde6b)];
    }
  }, false);
}

// ───────────────────────────── Buildings ─────────────────────────────

export function keepGeo(lv: number): THREE.BufferGeometry {
  return cached('keep' + lv, () => {
    const st = lv >= 5 ? 0xd8d2c6 : 0xcfc7b8, sd = lv >= 5 ? 0xb4ac9c : 0xada595;
    const roof = lv >= 8 ? 0xe0b030 : lv >= 5 ? 0x5a3db8 : 0x3d63b8, wood = 0x5a3d26;
    const h = 3 + Math.min(lv, 6) * 0.5;
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
    const th = h + 1.4 + Math.min(lv, 6) * 0.35;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        p.push(
          cyl(0.95, 1.08, th, 8, st, [sx * 3.1, th / 2, sz * 3.1]),
          cyl(1.12, 1.12, 0.3, 8, sd, [sx * 3.1, th + 0.15, sz * 3.1]),
          cone(1.25, 1.7, 8, roof, [sx * 3.1, th + 1.15, sz * 3.1]),
          glow(box(0.22, 0.4, 0.06, 0xffd27a, [sx * 3.1, th * 0.6, sz * 3.1 + sz * 1.0]), 2),
        );
        if (lv >= 4) p.push(cyl(1.14, 1.14, 0.12, 8, 0xf2c230, [sx * 3.1, th + 0.36, sz * 3.1]));
        if (lv >= 6) p.push(cyl(0.03, 0.03, 1.2, 4, 0x5a3d26, [sx * 3.1, th + 2.4, sz * 3.1]), box(0.6, 0.35, 0.03, 0x2d63c8, [sx * 3.1 + 0.3, th + 2.75, sz * 3.1]));
      }
    // gate (north, toward the plaza) and door + banners (south, toward the camera)
    p.push(box(1.8, 2.3, 0.2, wood, [0, 1.15, -3.15]), box(2.1, 0.25, 0.25, sd, [0, 2.4, -3.15]));
    p.push(box(1.4, 1.9, 0.2, wood, [0, 0.95, 3.15]));
    p.push(box(0.8, 1.6, 0.06, 0x2d63c8, [-1.9, h - 1.2, 3.13]), box(0.8, 1.6, 0.06, 0x2d63c8, [1.9, h - 1.2, 3.13]));
    p.push(box(0.3, 0.3, 0.07, 0xf2c94c, [-1.9, h - 1.0, 3.16]), box(0.3, 0.3, 0.07, 0xf2c94c, [1.9, h - 1.0, 3.16]));
    p.push(glow(box(0.4, 0.55, 0.06, 0xffd27a, [-1.0, h * 0.55, -3.13]), 2), glow(box(0.4, 0.55, 0.06, 0xffd27a, [1.0, h * 0.55, -3.13]), 2));
    if (lv >= 2) {
      const dh = 2 + (Math.min(lv, 6) - 2) * 0.8;
      p.push(box(3.2, dh, 3.2, st, [0, h + dh / 2, 0]));
      p.push(glow(box(0.5, 0.7, 0.1, 0xffd27a, [0, h + dh * 0.5, 1.61]), 2));
      p.push(cone(2.6, 2.2, 4, roof, [0, h + dh + 1.1, 0], [0, PI / 4, 0]));
      const top = h + dh + 2.2;
      if (lv >= 3 && lv < 7) {
        p.push(cyl(0.06, 0.06, 1.6, 5, 0x6b4a2a, [0, top + 0.6, 0]), box(1.0, 0.6, 0.05, 0xc23b3b, [0.52, top + 1.1, 0]));
      }
      if (lv >= 7) {
        p.push(cyl(0.3, 0.45, 0.4, 6, 0xf2c230, [0, top + 0.1, 0]), glow(oct(0.55, lv >= 8 ? 0xffe27a : 0x7fe3ff, [0, top + 0.95, 0], ZERO, [1, 1.6, 1]), 0.9));
      }
    }
    return p;
  });
}
export const keepTop = (lv: number) => 3 + Math.min(lv, 6) * 0.5 + 1.2;

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
      glow(box(0.2, 0.26, 0.2, 0xffd27a, [2.1, 2.5, 1.6]), 2),
      glow(box(0.2, 0.26, 0.2, 0xffd27a, [-2.1, 2.5, 1.6]), 2),
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
    glow(box(0.8, 0.6, 0.1, 0xff8a3a, [1.0, 1.1, 1.52]), 0.8),
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
    for (const x of [-1.5, 1.5]) p.push(glow(box(0.6, 0.5, 0.1, 0xffd27a, [x, 1.25, 2.03]), 2), glow(box(0.6, 0.5, 0.1, 0xffd27a, [x, 1.25, -2.03]), 2));
    p.push(cyl(0.06, 0.06, 3.2, 5, 0x6b4a2a, [2.6, 1.6, -1.6]), box(0.9, 0.55, 0.04, 0x2d63c8, [3.07, 2.85, -1.6]));
    p.push(
      box(1.2, 0.1, 0.1, 0x6b4a2a, [-1.4, 1.0, -2.4]),
      box(0.05, 1.4, 0.05, 0xc9d1d9, [-1.7, 0.9, -2.45]),
      box(0.05, 1.4, 0.05, 0xc9d1d9, [-1.4, 0.9, -2.45]),
      box(0.05, 1.4, 0.05, 0xc9d1d9, [-1.1, 0.9, -2.45]),
    );
    return p;
  });

export const rangeGeo = () =>
  cached('range', () => {
    const p: Part[] = [box(4.6, 0.25, 4, 0x8b6a4a, [0, 0.12, 0]), prism(5.0, 4.4, 1.5, 0x3f7a3a, [0, 2.3, 0])];
    for (const x of [-2.1, 2.1]) for (const z of [-1.8, 1.8]) p.push(cyl(0.12, 0.12, 2.3, 6, 0x7a5232, [x, 1.15, z]));
    p.push(box(4.4, 1.2, 0.15, 0x9b7653, [0, 0.85, 1.9]));
    for (const x of [-1.2, 0, 1.2]) {
      p.push(
        cyl(0.45, 0.45, 0.1, 10, 0xe8d8b0, [x, 1.0, -2.3], [PI / 2, 0, 0]),
        cyl(0.3, 0.3, 0.11, 10, 0xd94b3b, [x, 1.0, -2.3], [PI / 2, 0, 0]),
        cyl(0.12, 0.12, 0.12, 8, 0xe8d8b0, [x, 1.0, -2.3], [PI / 2, 0, 0]),
        box(0.08, 1.0, 0.08, 0x7a5232, [x, 0.5, -2.2]),
      );
    }
    p.push(box(1.6, 0.08, 0.3, 0x7a5232, [1.2, 1.4, 1.7]), ...[0, 1, 2].map((i) => box(0.04, 0.9, 0.04, 0x8b5a2b, [0.7 + i * 0.4, 1.35, 1.65], [0, 0, 0.2])));
    p.push(cyl(0.05, 0.05, 3.0, 5, 0x6b4a2a, [-2.6, 1.5, 1.6]), box(0.8, 0.5, 0.04, 0x3f7a3a, [-2.18, 2.7, 1.6]));
    return p;
  });

export const academyGeo = () =>
  cached('academy', () => {
    const st = 0xe0d6c4, sd = 0xbcb2a0, roof = 0x3d63b8;
    const p: Part[] = [
      box(5.4, 0.4, 4.2, sd, [0, 0.2, 0]),
      box(5.0, 2.6, 3.6, st, [0, 1.5, 0]),
      prism(5.4, 4.0, 1.4, roof, [0, 2.8, 0]),
      cyl(1.1, 1.2, 4.4, 8, st, [0, 2.2, 0.6]),
      sph(1.15, 8, 6, roof, [0, 4.4, 0.6], ZERO, [1, 0.8, 1]),
      cyl(0.06, 0.06, 1.0, 5, 0xf2c230, [0, 5.6, 0.6]),
      glow(oct(0.2, 0x7fe3ff, [0, 6.2, 0.6]), 0.9),
      box(1.2, 1.7, 0.1, 0x5a3d26, [0, 0.85, -1.82]),
    ];
    for (const x of [-1.9, -1.2, 1.2, 1.9]) p.push(cyl(0.14, 0.16, 2.4, 6, 0xf2ead8, [x, 1.4, -1.95]));
    for (const x of [-2.0, 2.0]) p.push(glow(box(0.5, 0.8, 0.1, 0xffd27a, [x, 1.6, 1.82]), 2), glow(box(0.5, 0.8, 0.1, 0xffd27a, [x, 1.6, -1.82]), 2));
    p.push(glow(box(0.35, 0.6, 0.08, 0x9fe8ff, [0, 3.4, 1.72]), 2));
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
      glow(box(0.5, 0.4, 0.1, 0xffd27a, [1.0, 1.1, -1.42]), 2),
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
    glow(box(0.18, 0.24, 0.18, 0xffd27a, [-2.0, 1.55, 1.05]), 2),
    box(2.6, 0.05, 0.08, 0x555555, [-3.2, 0.03, 0.3]),
    box(2.6, 0.05, 0.08, 0x555555, [-3.2, 0.03, -0.3]),
  ]);

export const caveGeo = () =>
  cached('cave', () => [
    dod(2.0, 0x5a5a6e, [-2.2, 0.7, 0], [0, 0.4, 0], [1.3, 0.8, 0.8]),
    dod(2.3, 0x4f4f62, [1.8, 0.8, 0.2], [0.2, 1.1, 0], [1.3, 0.85, 0.8]),
    dod(1.6, 0x66667a, [0, 1.6, -0.3], [0.5, 0, 0], [1.2, 0.7, 0.8]),
    box(1.6, 1.6, 0.3, 0x0e0c14, [0, 0.8, 0.9]),
    box(0.22, 1.9, 0.22, 0x7a5232, [-0.9, 0.95, 1.05]),
    box(0.22, 1.9, 0.22, 0x7a5232, [0.9, 0.95, 1.05]),
    box(2.2, 0.24, 0.3, 0x7a5232, [0, 1.95, 1.05]),
    glow(cyl(0, 0.2, 1.0, 5, 0x7fe3ff, [-1.6, 1.2, 1.0], [0.3, 0, 0.4]), 0.7),
    glow(cyl(0, 0.16, 0.8, 5, 0xc8a8ff, [1.6, 1.3, 1.0], [0.3, 0, -0.4]), 0.7),
    glow(cyl(0, 0.24, 1.2, 5, 0x5ac8ff, [2.6, 1.0, 0.6], [0.2, 0, -0.2]), 0.7),
  ]);

export const quarrySignGeo = () =>
  cached('qsign', () => [
    box(0.15, 1.6, 0.15, 0x7a5232, [0, 0.8, 0]),
    box(1.4, 0.6, 0.08, 0xd8b27a, [0, 1.45, 0.05]),
    box(0.8, 0.08, 0.1, 0x6b6b6b, [0, 1.45, 0.1], [0, 0, 0.6]),
    box(0.08, 0.4, 0.1, 0x6b6b6b, [0.25, 1.62, 0.1], [0, 0, 0.6]),
  ]);

export const cartGeo = () =>
  cached('cart', () => {
    const p: Part[] = [box(2.0, 0.5, 1.3, 0x8b5a2b, [0, 0.75, 0]), box(2.0, 0.1, 1.4, 0x6b4423, [0, 1.0, 0])];
    for (const x of [-0.7, 0.7]) for (const z of [-0.72, 0.72]) p.push(cyl(0.4, 0.4, 0.1, 8, 0x4a3520, [x, 0.4, z], [PI / 2, 0, 0]));
    for (let i = 0; i < 4; i++) p.push(box(0.5, 0.06, 1.5, i % 2 ? 0xf2c230 : 0x8a3ab8, [-0.75 + i * 0.5, 2.0, 0], [0.12, 0, 0]));
    for (const x of [-0.95, 0.95]) for (const z of [-0.65, 0.65]) p.push(cyl(0.04, 0.04, 1.0, 4, 0x5a3d26, [x, 1.5, z]));
    p.push(
      cyl(0.22, 0.22, 0.42, 8, 0x7a5232, [-0.5, 1.25, 0.2]),
      box(0.4, 0.35, 0.4, 0xc08a4f, [0.5, 1.22, -0.2]),
      glow(box(0.16, 0.22, 0.16, 0xffd27a, [0.95, 1.8, 0.65]), 1),
      box(1.0, 0.06, 0.06, 0x5a3d26, [1.5, 0.6, 0], [0, 0, 0.2]),
    );
    return p;
  });

export const chestGeo = () =>
  cached('chest', () => [
    box(0.9, 0.5, 0.6, 0x8b5a2b, [0, 0.25, 0]),
    box(0.92, 0.25, 0.62, 0x7a4a22, [0, 0.62, 0], [0, 0, 0]),
    box(0.94, 0.08, 0.64, 0xf2c230, [0, 0.5, 0]),
    box(0.1, 0.78, 0.64, 0xf2c230, [-0.3, 0.38, 0]),
    box(0.1, 0.78, 0.64, 0xf2c230, [0.3, 0.38, 0]),
    glow(box(0.14, 0.16, 0.05, 0xffe27a, [0, 0.45, 0.32]), 0.8),
  ]);

// ───────────────────────────── Defenses ─────────────────────────────

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
      const h = [0, 0, 3.6, 4.4, 5.0, 5.6][lv];
      const st = lv === 2 ? 0xb8b0a3 : lv === 3 ? 0xa7a093 : lv === 4 ? 0x9aa0ac : 0xd8d2c6;
      const trim = lv >= 4 ? 0x7f8794 : 0x958e82;
      p.push(cyl(1.05, 1.3, h, 8, st, [0, h / 2, 0]), cyl(1.38, 1.38, 0.35, 8, trim, [0, h + 0.17, 0]));
      p.push(cyl(1.42, 1.5, 0.45, 10, trim, [0, 0.22, 0]));
      for (const f of [0.32, 0.64]) p.push(cyl(1.3 - f * 0.25 + 0.05, 1.3 - f * 0.25 + 0.07, 0.16, 10, trim, [0, h * f, 0]));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        p.push(box(0.34, 0.45, 0.34, trim, [Math.cos(a) * 1.2, h + 0.55, Math.sin(a) * 1.2], [0, -a, 0]));
      }
      p.push(glow(box(0.3, 0.6, 0.1, 0xffd27a, [0, h * 0.55, 1.2]), 2));
      archerFigure(p, h + 0.35);
      if (lv >= 3) {
        p.push(cyl(1.32, 1.32, 0.14, 8, 0xf2c230, [0, h - 0.3, 0]));
        p.push(cyl(0.05, 0.05, 1.8, 5, 0x6b4a2a, [0.9, h + 1.2, -0.6]), box(0.8, 0.5, 0.04, 0x2d63c8, [1.32, h + 1.8, -0.6]));
      }
      if (lv >= 4) {
        for (const a of [0.6, 2.2, 3.8, 5.4]) p.push(cyl(0.05, 0.05, 1.4, 4, 0x5a3d26, [Math.cos(a) * 1.1, h + 1.2, Math.sin(a) * 1.1]));
        p.push(cone(1.5, 1.3, 8, lv === 5 ? 0xe0b030 : 0x3d63b8, [0, h + 2.4, 0]), cyl(1.52, 1.52, 0.1, 10, lv === 5 ? 0xb88a20 : 0x2a4a90, [0, h + 1.78, 0]));
      }
      if (lv === 5) p.push(glow(oct(0.25, 0x7fe3ff, [0, h + 3.35, 0]), 0.9));
    }
    return p;
  });
}
export const towerTop = (lv: number) => [0, 4.2, 4.6, 5.4, 6.0, 6.6][lv];

export const towerRubbleGeo = () =>
  cached('trubble', () => [
    dod(0.55, 0x9a948a, [0.3, 0.25, 0.2], [0.4, 0, 0], [1.3, 0.6, 1]),
    dod(0.45, 0x8a847a, [-0.5, 0.2, -0.3], [0, 1, 0], [1.2, 0.6, 1]),
    box(1.6, 0.14, 0.2, 0x7a5232, [0, 0.15, 0.6], [0, 0.5, 0.2]),
    box(1.2, 0.14, 0.2, 0x6b4423, [-0.2, 0.12, -0.7], [0, -0.7, 0.1]),
  ]);

export function catBaseGeo(lv: number): THREE.BufferGeometry {
  return cached('catbase' + lv, () => {
    const wood = lv === 1 ? 0x8b5a2b : lv === 2 ? 0x6b4423 : 0x5a3d26;
    const s = lv === 3 ? 1.15 : 1;
    const p: Part[] = [box(1.8 * s, 0.3, 2.6 * s, wood, [0, 0.55, 0])];
    for (const sx of [-1.0, 1.0]) for (const sz of [-0.85, 0.85]) p.push(cyl(0.42, 0.42, 0.18, 8, 0x4a3520, [sx * s, 0.42, sz * s], [0, 0, PI / 2]));
    p.push(box(0.2, 1.4, 0.2, wood, [-0.6, 1.3, 0.2]), box(0.2, 1.4, 0.2, wood, [0.6, 1.3, 0.2]), box(1.4, 0.16, 0.16, wood, [0, 1.95, 0.2]));
    if (lv >= 2) p.push(box(1.86 * s, 0.08, 2.66 * s, 0x3c3f46, [0, 0.72, 0]), box(0.24, 0.24, 0.24, 0x3c3f46, [0, 1.95, 0.2]));
    if (lv >= 3) p.push(box(1.2, 0.6, 0.8, 0x50545a, [0, 1.0, -0.9]), box(1.9 * s, 0.1, 0.1, 0xf2c230, [0, 0.74, 1.3 * s]));
    return p;
  });
}
export const catArmGeo = () =>
  cached('catarm', () => [box(0.18, 0.18, 2.6, 0x7a5232, [0, 0, 0.9]), box(0.5, 0.25, 0.5, 0x5a3d26, [0, 0.1, 2.1]), dod(0.25, 0x8a8580, [0, 0.35, 2.1])]);

/** Stone tower body shared by the special towers. */
function spTowerBase(p: Part[], h: number, st: number, trim: number): void {
  p.push(cyl(1.0, 1.25, h, 8, st, [0, h / 2, 0]), cyl(1.32, 1.32, 0.3, 8, trim, [0, h + 0.15, 0]), cyl(1.3, 1.45, 0.5, 8, trim, [0, 0.25, 0]));
  p.push(glow(box(0.28, 0.5, 0.1, 0xffd27a, [0, h * 0.5, 1.12]), 2));
}

export function frostTowerGeo(lv: number): THREE.BufferGeometry {
  return cached('frost' + lv, () => {
    const h = 3.2 + lv * 0.5;
    const p: Part[] = [];
    spTowerBase(p, h, 0xc8d8e8, 0x9ab0c8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + PI / 4;
      p.push(glow(cyl(0, 0.16, 0.9 + lv * 0.15, 4, 0x9fe8ff, [Math.cos(a) * 1.05, h + 0.6, Math.sin(a) * 1.05], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]), 0.6));
    }
    if (lv >= 2) p.push(cyl(1.34, 1.34, 0.1, 8, 0xe8f6ff, [0, h * 0.7, 0]));
    if (lv >= 3) p.push(cyl(1.34, 1.34, 0.1, 8, 0xf2c230, [0, h * 0.35, 0]));
    return p;
  });
}
export const frostOrbGeo = () =>
  cached('frostorb', () => [glow(oct(0.5, 0x9fe8ff, ZERO, ZERO, [1, 1.5, 1]), 0.8), glow(oct(0.3, 0xe8fbff, [0, 0, 0], [0.5, 0.5, 0]), 0.8)], false);

export function mageTowerGeo(lv: number): THREE.BufferGeometry {
  return cached('mage' + lv, () => {
    const h = 4.0 + lv * 0.5;
    const p: Part[] = [];
    spTowerBase(p, h, 0x9a90b0, 0x6e6488);
    p.push(cone(1.45, 2.4, 8, 0x6a3ab8, [0, h + 1.5, 0]));
    p.push(glow(box(0.06, 1.6, 0.06, 0xd08aff, [0, h + 3.2, 0]), 0.9));
    for (let i = 0; i < lv; i++) p.push(glow(cyl(1.02 + 0.02 * i, 1.02 + 0.02 * i, 0.08, 8, 0xd08aff, [0, h * (0.25 + i * 0.18), 0]), 0.7));
    return p;
  });
}
export const mageOrbGeo = () => cached('mageorb', () => [glow(ico(0.38, 0xe08aff), 1), glow(tor(0.6, 0.04, 0xf0c8ff, ZERO, [PI / 2, 0, 0]), 0.8)], false);

export function ballistaBaseGeo(lv: number): THREE.BufferGeometry {
  return cached('ballb' + lv, () => {
    const p: Part[] = [cyl(1.25, 1.4, 1.4, 8, lv >= 3 ? 0xa7a093 : 0xb8b0a3, [0, 0.7, 0]), cyl(1.35, 1.35, 0.2, 8, 0x7a5232, [0, 1.5, 0])];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      p.push(box(0.3, 0.4, 0.3, 0x958e82, [Math.cos(a) * 1.25, 1.75, Math.sin(a) * 1.25], [0, -a, 0]));
    }
    if (lv >= 2) p.push(cyl(1.42, 1.42, 0.12, 8, 0x3c3f46, [0, 1.1, 0]));
    if (lv >= 4) p.push(cyl(1.44, 1.44, 0.12, 8, 0xf2c230, [0, 0.4, 0]));
    return p;
  });
}
export function ballistaHeadGeo(lv: number): THREE.BufferGeometry {
  return cached('ballh' + lv, () => {
    const w = lv >= 3 ? 0x5a3d26 : 0x7a5232;
    const p: Part[] = [
      box(0.4, 0.4, 0.4, 0x3c3f46, [0, 0.2, 0]),
      box(0.3, 0.25, 2.2, w, [0, 0.5, 0.3]),
      box(2.4 + lv * 0.2, 0.12, 0.14, w, [0, 0.55, 1.1], [0, 0, 0]),
      box(0.04, 0.04, 1.4, 0xeeeeee, [1.0, 0.55, 0.45], [0, 0.6, 0]),
      box(0.04, 0.04, 1.4, 0xeeeeee, [-1.0, 0.55, 0.45], [0, -0.6, 0]),
      box(0.08, 0.08, 1.6, 0x8b6a4a, [0, 0.7, 0.6]),
      cone(0.1, 0.3, 4, 0xc9d1d9, [0, 0.7, 1.5], [PI / 2, 0, 0]),
    ];
    if (lv >= 2) p.push(box(0.5, 0.3, 0.3, 0x3c3f46, [0, 0.5, -0.7]));
    return p;
  }, false);
}

export function fireTowerGeo(lv: number): THREE.BufferGeometry {
  return cached('firet' + lv, () => {
    const h = 3.0 + lv * 0.4;
    const p: Part[] = [];
    spTowerBase(p, h, 0x6a5a50, 0x4a3e38);
    p.push(cyl(1.0, 0.6, 0.6, 8, 0x3a3a40, [0, h + 0.55, 0]));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      p.push(glow(box(0.08, h * 0.6, 0.06, 0xff6a1a, [Math.cos(a) * 1.08, h * 0.45, Math.sin(a) * 1.08], [0, -a, 0]), lv >= 3 ? 0.9 : 0.5));
    }
    if (lv >= 4) p.push(cyl(1.36, 1.36, 0.12, 8, 0xf2c230, [0, h * 0.8, 0]));
    return p;
  });
}
export const flameGeo = () =>
  cached('flame', () => [glow(cone(0.6, 1.3, 6, 0xff6a1a, [0, 0.6, 0]), 1), glow(cone(0.38, 1.0, 6, 0xffb43a, [0, 0.5, 0]), 1), glow(cone(0.2, 0.7, 5, 0xffe27a, [0, 0.4, 0]), 1)], false);

export function spireGeo(lv: number): THREE.BufferGeometry {
  return cached('spire' + lv, () => {
    const h = 4.5 + lv * 0.6;
    const p: Part[] = [
      cyl(1.3, 1.5, 0.6, 8, 0xd8d0c0, [0, 0.3, 0]),
      cyl(0.55, 0.95, h, 4, 0xf0ead8, [0, h / 2 + 0.5, 0], [0, PI / 4, 0]),
      cyl(0.7, 0.7, 0.16, 8, 0xf2c230, [0, h * 0.6, 0]),
      cyl(0.62, 0.62, 0.16, 8, 0xf2c230, [0, h + 0.4, 0]),
      glow(box(0.2, 0.9, 0.08, 0xffe27a, [0, h * 0.4, 0.72], [0, 0, 0]), 0.6),
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2;
      p.push(cone(0.18, 1.2, 4, 0xf0ead8, [Math.cos(a) * 1.1, 1.2, Math.sin(a) * 1.1]), glow(oct(0.1, 0xffe27a, [Math.cos(a) * 1.1, 1.95, Math.sin(a) * 1.1]), 0.8));
    }
    if (lv >= 3) p.push(tor(0.9, 0.06, 0xf2c230, [0, h + 1.0, 0], [PI / 2, 0, 0]));
    return p;
  });
}
export const spireOrbGeo = () => cached('spireorb', () => [glow(ico(0.42, 0xffe27a), 1), glow(oct(0.6, 0xfff6c8, ZERO, ZERO, [0.3, 1.4, 0.3]), 0.6)], false);
export const spireTop = (lv: number) => 4.5 + lv * 0.6 + 1.3;

// ───────────────────────────── Counter-siege & allies ─────────────────────────────

/** Round stone bastion the cannon sits on. */
export function cannonBaseGeo(lv: number): THREE.BufferGeometry {
  return cached('cannonbase' + lv, () => {
    const st = [0xcfc4ae, 0xc2bcb2, 0xb4bac6, 0xa8b4d0][lv - 1];
    const trim = [0xa8987c, 0x9a9488, 0x8a92a2, 0x7a86a8][lv - 1];
    const p: Part[] = [
      cyl(1.55, 1.75, 1.2, 12, st, [0, 0.6, 0]),
      cyl(1.62, 1.62, 0.18, 12, trim, [0, 1.22, 0]),
      cyl(1.8, 1.85, 0.3, 12, trim, [0, 0.15, 0]),
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2 + PI / 8;
      p.push(box(0.42, 0.42, 0.36, st, [Math.cos(a) * 1.42, 1.5, Math.sin(a) * 1.42], [0, -a, 0]));
    }
    // Powder kegs and a pile of shot.
    p.push(cyl(0.22, 0.22, 0.42, 10, 0x7a5232, [1.0, 1.52, 0.75]), cyl(0.23, 0.23, 0.05, 10, 0x3a3a40, [1.0, 1.62, 0.75]));
    for (const [x, z] of [[-0.95, 0.75], [-0.75, 0.95], [-1.0, 0.98]]) p.push(ball(0.13, 0x2a2a30, [x, 1.43, z]));
    if (lv >= 3) p.push(cyl(1.64, 1.64, 0.1, 12, 0xf2c230, [0, 1.0, 0]));
    if (lv >= 4) for (let i = 0; i < 4; i++) p.push(glow(ball(0.1, 0x6ad8ff, [Math.cos(i * 1.57) * 1.72, 0.7, Math.sin(i * 1.57) * 1.72], ZERO, [1, 1, 0.5]), 1));
    return p;
  });
}

/** Cannon on its carriage; the barrel points along +Z. Rotates as one piece. */
export function cannonGunGeo(lv: number): THREE.BufferGeometry {
  return cached('cannongun' + lv, () => {
    const metal = lv >= 4 ? 0x3a4a6a : 0x2e2e36;
    const ring = lv >= 3 ? 0xf2c230 : 0x8a7a5a;
    const len = 1.5 + lv * 0.12;
    const p: Part[] = [
      box(0.9, 0.36, 1.2, 0x7a5232, [0, 0.18, -0.1]),
      ...[-0.5, 0.5].flatMap((x) => [cyl(0.3, 0.3, 0.12, 12, 0x5a3d26, [x, 0.3, 0.2], [0, 0, PI / 2]), cyl(0.3, 0.3, 0.12, 12, 0x5a3d26, [x, 0.3, -0.45], [0, 0, PI / 2])]),
      cyl(0.27, 0.36, len, 14, metal, [0, 0.62, 0.35], [PI / 2 - 0.12, 0, 0]),
      ball(0.38, metal, [0, 0.58, -0.38]),
      tor(0.31, 0.06, ring, [0, 0.66, 0.35 + len * 0.45], [-0.12, 0, 0]),
      tor(0.34, 0.06, ring, [0, 0.62, 0.15], [-0.12, 0, 0]),
      ball(0.08, ring, [0, 0.62, -0.75]),
    ];
    return p;
  }, false);
}

export const cannonballGeo = () => cached('cannonball', () => [ball(0.28, 0x26262c)], false);

/** Rocky spire with a great nest and banners: home of the griffin riders. */
export function aerieGeo(lv: number): THREE.BufferGeometry {
  return cached('aerie' + lv, () => {
    const rock = 0xa89c8a;
    const h = 4.2 + lv * 0.5;
    const p: Part[] = [
      dod(1.9, rock, [0, 1.1, 0], [0.2, 0.4, 0], [1.1, 0.75, 1.1]),
      dod(1.4, 0x988c7a, [0.3, 2.6, -0.2], [0.5, 0.1, 0.3], [1, 1.1, 1]),
      dod(1.05, rock, [-0.15, 3.8, 0.1], [0.1, 0.9, 0.2], [1, 1.2, 1]),
      // nest
      tor(1.2, 0.36, 0x8a6a3a, [0, h, 0], [PI / 2, 0, 0]),
      cyl(1.15, 0.8, 0.5, 14, 0x6b4a2a, [0, h - 0.18, 0]),
      ball(0.24, 0xf4eee0, [0.3, h + 0.05, 0.2], ZERO, [1, 1.25, 1]),
      ball(0.22, 0xf4eee0, [-0.25, h + 0.04, -0.15], ZERO, [1, 1.25, 1]),
      // banners on poles
      cyl(0.05, 0.05, 2.2, 6, 0x5a3d26, [1.25, h + 0.6, 0.4]),
      sbox(0.8, 0.55, 0.04, 0x2d63c8, [1.66, h + 1.35, 0.4]),
      cyl(0.05, 0.05, 2.0, 6, 0x5a3d26, [-1.2, h + 0.5, -0.5]),
      sbox(0.7, 0.5, 0.04, 0xf2c230, [-1.56, h + 1.2, -0.5]),
      // ladder
      ...[0, 1, 2, 3, 4, 5].map((i) => box(0.7, 0.06, 0.08, 0x7a5232, [0, 0.5 + i * 0.55, 1.75 - i * 0.05])),
      box(0.07, 3.4, 0.07, 0x6b4423, [-0.33, 1.85, 1.65], [-0.05, 0, 0]),
      box(0.07, 3.4, 0.07, 0x6b4423, [0.33, 1.85, 1.65], [-0.05, 0, 0]),
    ];
    if (lv >= 3) p.push(tor(1.22, 0.07, 0xf2c230, [0, h + 0.22, 0], [PI / 2, 0, 0]));
    if (lv >= 4) p.push(glow(ball(0.2, 0x7fe3ff, [0, h + 2.2, 0]), 1));
    return p;
  });
}
export const aerieTop = (lv: number) => 4.2 + lv * 0.5 + 0.4;

/** A crag with a gilded perch: the friendly dragon rests here between waves. */
export function roostGeo(lv: number): THREE.BufferGeometry {
  return cached('roost' + lv, () => {
    const p: Part[] = [
      dod(2.3, 0x8a8478, [0, 0.9, 0], [0.3, 0.2, 0.1], [1.15, 0.6, 1.0]),
      dod(1.7, 0x7a7468, [-0.6, 2.0, -0.3], [0.1, 0.7, 0.4], [1, 0.8, 1]),
      dod(1.2, 0x8a8478, [0.5, 2.7, 0.2], [0.6, 0.2, 0.1], [1.1, 0.8, 1]),
      cyl(1.5, 1.5, 0.22, 14, 0x7a5232, [0, 3.4, 0]),
      tor(1.5, 0.1, 0xf2c230, [0, 3.52, 0], [PI / 2, 0, 0]),
      cyl(0.08, 0.08, 1.4, 6, 0xf2c230, [1.2, 4.1, 0]),
      cyl(0.08, 0.08, 1.4, 6, 0xf2c230, [-1.2, 4.1, 0]),
      cyl(0.08, 0.08, 2.5, 6, 0xf2c230, [0, 4.8, 0], [0, 0, PI / 2]),
      // treasure hoard
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => cyl(0.16, 0.16, 0.05, 10, 0xffd54a, [Math.cos(i * 0.9) * 0.9, 3.55 + (i % 3) * 0.05, Math.sin(i * 0.9) * 0.6 - 0.4], [0.2 * (i % 2), 0, 0.3])),
      box(0.5, 0.36, 0.36, 0x8a3b2e, [-0.8, 3.7, 0.6], [0, 0.4, 0]),
      // claw-mark banners
      cyl(0.05, 0.05, 2.6, 6, 0x5a3d26, [1.9, 1.6, 1.2]),
      sbox(0.9, 0.7, 0.04, 0x2f8a4a, [2.36, 2.5, 1.2]),
    ];
    if (lv >= 2) p.push(glow(ball(0.22, 0x7fffd4, [0, 4.8, 0]), 1));
    if (lv >= 3) for (let i = 0; i < 3; i++) p.push(glow(cone(0.12, 0.6, 4, 0x7fffd4, [Math.cos(i * 2.1) * 1.9, 1.8 + i * 0.4, Math.sin(i * 2.1) * 1.6]), 0.8));
    return p;
  });
}
export const ROOST_PERCH = 3.6;

/** Griffin with a little knight on its back (flies, flaps, dives). */
export function griffinModel(): UnitModel {
  const s = 1;
  const bodyGeo = cached('griffin', () => [
    sph(0.5, 10, 8, 0xc89a5a, [0, 0, 0], ZERO, [0.7, 0.62, 1.35]),
    sph(0.5, 10, 8, 0xe8c890, [0, -0.15, 0.05], ZERO, [0.55, 0.4, 1.1]),
    // eagle front: white chest and head with a golden beak
    sph(0.5, 10, 8, 0xf4f0e6, [0, 0.18, 0.62], ZERO, [0.62, 0.6, 0.55]),
    sph(0.26, 10, 8, 0xf4f0e6, [0, 0.42, 0.92]),
    cone(0.1, 0.3, 8, 0xf2b630, [0, 0.36, 1.2], [PI / 2 + 0.3, 0, 0]),
    ball(0.045, 0x1a1418, [0.12, 0.48, 1.1]),
    ball(0.045, 0x1a1418, [-0.12, 0.48, 1.1]),
    cone(0.06, 0.22, 6, 0xf4f0e6, [0.1, 0.66, 0.84], [-0.5, 0, -0.2]),
    cone(0.06, 0.22, 6, 0xf4f0e6, [-0.1, 0.66, 0.84], [-0.5, 0, 0.2]),
    // lion tail with a tuft
    cone(0.06, 0.8, 6, 0xc89a5a, [0, 0.05, -0.95], [-PI / 2 - 0.4, 0, 0]),
    ball(0.12, 0x8a5a2a, [0, 0.22, -1.32]),
    // legs: talons in front, paws behind
    cap(0.07, 0.22, 0xf2b630, [0.16, -0.38, 0.5], [0.5, 0, 0]),
    cap(0.07, 0.22, 0xf2b630, [-0.16, -0.38, 0.5], [0.5, 0, 0]),
    cap(0.09, 0.22, 0xc89a5a, [0.18, -0.36, -0.42], [0.5, 0, 0]),
    cap(0.09, 0.22, 0xc89a5a, [-0.18, -0.36, -0.42], [0.5, 0, 0]),
    // rider
    sph(0.24, 8, 6, 0x2d63c8, [0, 0.5, -0.05], ZERO, [1, 1.2, 0.9]),
    ball(0.16, 0xf1c27d, [0, 0.86, 0]),
    dome(0.18, 0xc9d1d9, [0, 0.88, 0]),
    box(0.05, 0.22, 0.24, 0xf2c94c, [0, 1.1, -0.02]),
    cyl(0.03, 0.03, 1.5, 6, 0x8b6a4a, [0.26, 0.56, 0.35], [PI / 2 - 0.2, 0, 0]),
    cone(0.06, 0.24, 6, 0xd5dce4, [0.26, 0.72, 1.12], [PI / 2 - 0.2, 0, 0]),
    sbox(0.3, 0.22, 0.02, 0xc23b3b, [0.26, 0.66, 0.85]),
  ], false);
  const wingGeo = cached('griffinwing', () => [
    part(wingMembrane(GRIFFIN_WING, 0.05), 0xe8dcc4, [0, 0, 0.1], ZERO, [0.62, 1, 0.62]),
    cap(0.06, 0.8, 0xc89a5a, [0.5, 0.03, 0.32], [0, 0.1, PI / 2]),
    ...[0, 1, 2].map((i) => sbox(0.42, 0.03, 0.12, 0x8a5a2a, [1.25 + i * 0.08, 0.02, -0.25 - i * 0.18], [0, 0.4 + i * 0.25, 0])),
  ], false);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(makeMesh(bodyGeo, true, false, Mat.unit));
  const wl = new THREE.Group();
  const wr = new THREE.Group();
  wl.position.set(-0.28 * s, 0.22 * s, 0.25 * s);
  wr.position.set(0.28 * s, 0.22 * s, 0.25 * s);
  const ml = makeMesh(wingGeo, true, false, Mat.unit);
  ml.scale.x = -1;
  wl.add(ml);
  wr.add(makeMesh(wingGeo, true, false, Mat.unit));
  body.add(wl, wr);
  const m = finish(group, body, Mat.unit, (dt, moving, _speed, swingT) => {
    m.phase += dt * (moving ? 9 : 5);
    const a = Math.sin(m.phase) * (moving ? 0.75 : 0.35) + (swingT < 1 ? -0.6 : 0);
    wl.rotation.z = -a;
    wr.rotation.z = a;
    body.position.y = Math.sin(m.phase) * 0.08;
    body.rotation.x = swingT < 1 ? 0.5 * Math.sin(swingT * PI) : 0;
  });
  return m;
}
const GRIFFIN_WING: [number, number][] = [
  [0, 0.4], [0.8, 0.55], [1.7, 0.4], [2.4, 0.1], [2.2, -0.2], [2.25, -0.4], [1.9, -0.45], [1.85, -0.7], [1.45, -0.7], [1.3, -0.95], [0.9, -0.85], [0.6, -1.0], [0.3, -0.7], [0, -0.55],
];

/** The village's own dragon: emerald and gold. */
export function allyDragonModel(): UnitModel {
  return flyer('allydragon', { body: 0x2f9a5a, wing: 0xe8b830, belly: 0xf2dc8a, eyes: 0x7fffd4, size: 1.45, dragon: true }, true);
}

export function spikesGeo(lv: number): THREE.BufferGeometry {
  return cached('spikes' + lv, () => {
    const metal = lv >= 4 ? 0xe0b030 : lv >= 3 ? 0xc9d1d9 : 0xa8a8a8;
    const p: Part[] = [];
    const n = 5 + lv * 2;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      const r = 0.5 + Math.sqrt(i / n) * 1.6;
      p.push(cone(0.1, 0.55 + (i % 3) * 0.1, 4, metal, [Math.cos(a) * r, 0.25, Math.sin(a) * r]));
    }
    return p;
  }, false);
}
export const spikeBedGeo = (lv: number) =>
  cached('spikebed' + lv, () => [
    cyl(2.0, 2.1, 0.05, 12, 0x9a8462, [0, 0.02, 0]),
    ...[0, 1, 2].map((i) => box(3.4, 0.08, 0.12, 0x7a5232, [0, 0.06, -0.8 + i * 0.8], [0, 0.2, 0])),
    ...(lv >= 3 ? [0, 1, 2, 3, 4, 5].map((i) => box(0.3, 0.2, 0.3, 0x8a847a, [Math.cos(i * 1.05) * 2.0, 0.1, Math.sin(i * 1.05) * 2.0])) : []),
  ]);
export const tarGeo = (lv: number) =>
  cached('tar' + lv, () => {
    const p: Part[] = [cyl(2.15, 2.25, 0.04, 14, 0x4a3a2a, [0, 0.02, 0]), cyl(1.8, 1.8, 0.05, 14, 0x2e2620, [0.15, 0.03, -0.1])];
    for (let i = 0; i < 7; i++) {
      const a = i * 2.1;
      p.push(sph(0.12 + (i % 3) * 0.05, 6, 4, 0x5a4a3a, [Math.cos(a) * (0.5 + (i % 3) * 0.45), 0.05, Math.sin(a) * (0.5 + (i % 3) * 0.45)], ZERO, [1, 0.5, 1]));
    }
    if (lv >= 3) for (let i = 0; i < 5; i++) p.push(glow(cone(0.14, 0.4, 4, 0xff7a1a, [Math.cos(i * 1.3) * 1.2, 0.22, Math.sin(i * 1.3) * 1.2]), 1));
    if (lv >= 2) for (let i = 0; i < 8; i++) p.push(box(0.2, 0.26, 0.2, 0x8a847a, [Math.cos(i * 0.785) * 2.2, 0.13, Math.sin(i * 0.785) * 2.2]));
    return p;
  });

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
      const H = [0, 0, 2.2, 2.8, 3.2, 3.4, 3.6][lv];
      const D = [0, 0, 1.1, 1.3, 1.4, 1.45, 1.5][lv];
      // Light, warm cartoon stone; later tiers get cooler and more magical.
      const col = [0, 0, 0xd9c7a2, 0xcbc3b4, 0xbcc0c8, 0xa9bad0, 0x9a9ccc][lv];
      const dark = [0, 0, 0xb59f7a, 0xa59d8e, 0x8f959f, 0x7c8ca6, 0x6c6ea8][lv];
      const top = [0, 0, 0xeadcbc, 0xe0dacd, 0xd6dae0, 0xc8d6e8, 0xbcbfe6][lv];
      const jit = (i: number) => ((i * 7919) % 13) / 13;
      p.push(box(10, H, D, col, [0, H / 2, 0]), box(10.1, 0.5, D + 0.18, dark, [0, 0.25, 0]));
      p.push(box(10.02, 0.14, D * 0.92, top, [0, H + 0.02, 0]));
      // Big rounded stones on the side facing the village (the camera side).
      const rows = Math.max(2, Math.floor((H - 0.6) / 0.62));
      for (let r = 0; r < rows; r++) {
        const y = 0.62 + r * 0.62 + 0.25;
        if (y > H - 0.2) break;
        const off = r % 2 ? 0.62 : 0;
        for (let i = 0; i < 9; i++) {
          const x = -4.6 + off + i * 1.24;
          if (x > 4.6) continue;
          const k = jit(r * 11 + i);
          p.push(box(1.08 - k * 0.12, 0.52, 0.12, k > 0.6 ? top : k < 0.25 ? dark : col, [x, y, D / 2 + 0.03]));
        }
      }
      // Battlements on the enemy side of the walkway, each with a cap stone.
      for (let i = 0; i < 7; i++) {
        const x = -4.4 + i * 1.47;
        p.push(box(0.92, 0.62, D * 0.5, col, [x, H + 0.34, -D * 0.22]), box(1.04, 0.14, D * 0.58, top, [x, H + 0.68, -D * 0.22]));
      }
      if (lv >= 3) for (const x of [-3, 0, 3]) p.push(box(0.8, H * 0.82, 0.5, dark, [x, H * 0.41, D / 2 + 0.22]), box(0.9, 0.14, 0.6, top, [x, H * 0.82, D / 2 + 0.22]));
      if (lv >= 4) {
        p.push(box(10.06, 0.18, D + 0.08, 0x4a4e58, [0, 0.9, 0]), box(10.06, 0.18, D + 0.08, 0x4a4e58, [0, H - 0.7, 0]));
        for (let i = 0; i < 9; i++) p.push(cone(0.12, 0.6, 4, 0x6a6e78, [-4 + i, 1.4, -D / 2 - 0.27], [-PI / 2, 0, 0]));
      }
      if (lv >= 5) {
        const rune = lv === 5 ? 0x6ad8ff : 0xd08aff;
        for (let i = 0; i < 7; i++) p.push(glow(ball(0.11, rune, [-4.4 + i * 1.47, H + 0.36, -D * 0.22 + D * 0.25 + 0.02], ZERO, [1, 1, 0.35]), 1));
        for (let i = 0; i < 6; i++) p.push(glow(box(0.5, 0.1, 0.04, rune, [-3.75 + i * 1.5, H * 0.55, -D / 2 - 0.02]), 0.9));
        if (lv === 6) p.push(box(10.06, 0.12, 0.08, 0xf2c230, [0, H - 0.04, -D / 2 - 0.03]), box(10.06, 0.12, 0.08, 0xf2c230, [0, H - 0.04, D / 2 + 0.06]));
      }
      p.push(cyl(0.04, 0.04, 1.8, 6, 0x5a3d26, [-2.2, H + 0.9, D / 2 - 0.1]), sbox(0.55, 0.8, 0.04, lv >= 5 ? 0x5a3aa8 : 0x2d63c8, [-1.9, H + 1.35, D / 2 - 0.08]));
      p.push(cyl(0.04, 0.04, 1.8, 6, 0x5a3d26, [2.2, H + 0.9, D / 2 - 0.1]), sbox(0.55, 0.8, 0.04, lv >= 5 ? 0x5a3aa8 : 0x2d63c8, [2.5, H + 1.35, D / 2 - 0.08]));
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
  ], false);
export const boltGeo = () =>
  cached('bolt', () => [box(0.1, 0.1, 1.6, 0x6b4423), cone(0.13, 0.36, 4, 0xd5dce4, [0, 0, 0.95], [PI / 2, 0, 0]), box(0.03, 0.22, 0.3, 0xd94b3b, [0, 0, -0.7]), box(0.22, 0.03, 0.3, 0xd94b3b, [0, 0, -0.7])], false);
export const boulderGeo = () => cached('boulder', () => [dod(0.35, 0x8a8580)], false);
export const iceBoulderGeo = () => cached('iceboulder', () => [glow(dod(0.42, 0x9fd8f0), 0.3)], false);
export const orbGeo = (color: number, size = 0.22) => cached('orb' + color + size, () => [glow(ico(size, color), 1)], false);
export const meteorGeo = () => cached('meteor', () => [glow(dod(0.9, 0xff7a2a), 0.6), dod(0.7, 0x4a3020, [0.2, 0.2, 0.1])], false);

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
