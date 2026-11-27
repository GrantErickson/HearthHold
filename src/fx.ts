import * as THREE from 'three';
import { scene, camera, engine } from './engine';
import { itemGeo, makeMesh, celMaterial, ensureEmit, type ItemKind } from './models';
import { hero } from './hero';
import { G, addCoins } from './state';
import { Sfx } from './audio';
import { Stat } from './progress';
import { Post } from './post';
import { easeOutBack } from './util';

// ───────────────────────────── Shared textures ─────────────────────────────

function radialTex(stops: [number, string][]): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, c] of stops) grd.addColorStop(o, c);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']]);
export const softTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);

// ───────────────────────────── Particles ─────────────────────────────
// Every particle kind is one instanced mesh, so a busy battle costs a handful
// of draw calls: rounded debris chunks, cartoon smoke puffs (shaded balls that
// pop in and shrink away), fire puffs (bright balls that bloom), additive
// glows and star-shaped impact sparks.

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  size: number;
  grow: number;
  grav: number;
  drag: number;
  rx: number;
  ry: number;
  r: number;
  g: number;
  b: number;
  /** Seconds before it appears (staggered explosions). */
  delay: number;
  /** Debris that leaves a smoke trail (seconds between puffs, 0 = none). */
  trail: number;
  trailT: number;
}

function starTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const c = 64;
  const grd = g.createRadialGradient(c, c, 0, c, c, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // Four-point twinkle star.
  g.fillStyle = '#fff';
  g.beginPath();
  const pts = 8;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 60 : 13;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Layer {
  readonly list: Particle[] = [];
  mesh: THREE.InstancedMesh | null = null;
  constructor(
    readonly max: number,
    readonly make: () => THREE.InstancedMesh,
    readonly draw: (p: Particle, i: number, mesh: THREE.InstancedMesh) => void,
    readonly ground: boolean,
    readonly tick?: (p: Particle, dt: number) => void,
  ) {}
  ensure(): void {
    if (this.mesh) return;
    this.mesh = this.make();
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  add(p: Particle): void {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(p);
  }
  step(dt: number): void {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.t += dt;
      if (p.t >= p.life) {
        list.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vz *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (this.ground && p.y < 0.05) {
        p.y = 0.05;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rx += dt * 6;
      if (this.tick) this.tick(p, dt);
    }
  }
  render(): void {
    const m = this.mesh;
    if (!m) return;
    let n = 0;
    for (const p of this.list) {
      if (p.delay > 0) continue;
      this.draw(p, n, m);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

const _col = new THREE.Color();
const _pm = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _pe = new THREE.Euler();
const _pp = new THREE.Vector3();
const _ps = new THREE.Vector3();

const ballGeo = ensureEmit(new THREE.IcosahedronGeometry(1, 2));
const chunkGeo = ensureEmit(new THREE.IcosahedronGeometry(0.62, 0));
const quadGeo = new THREE.PlaneGeometry(1, 1);
const starTex = starTexture();

/** Pop in fast with a little overshoot, then shrink away: the classic cartoon puff. */
function puffScale(k: number): number {
  if (k < 0.18) {
    const t = k / 0.18;
    return 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  }
  const t = (k - 0.18) / 0.82;
  return 1 - t * t * t;
}

const debrisL = new Layer(
  420,
  () => new THREE.InstancedMesh(chunkGeo, celMaterial('fx-chunk'), 420),
  (p, i, m) => {
    const s = Math.max(0.001, p.size * (1 - (p.t / p.life) ** 2));
    _pe.set(p.rx, p.ry, 0);
    _pq.setFromEuler(_pe);
    _pm.compose(_pp.set(p.x, p.y, p.z), _pq, _ps.set(s, s, s));
    m.setMatrixAt(i, _pm);
    m.setColorAt(i, _col.setRGB(p.r, p.g, p.b));
  },
  true,
  (p, dt) => {
    // Flying chunks from a big blast trail little puffs of smoke.
    if (!p.trail || p.y < 0.2 || p.t > p.life * 0.55) return;
    p.trailT -= dt;
    if (p.trailT > 0) return;
    p.trailT = p.trail * (1 + p.t * 3);
    smokeL.add(mk(p.x, p.y, p.z, 0xa8a098, { life: 0.32, size: 0.08 + p.size * 0.35, grow: 0.7, vy: 0.3, drag: 3 }));
  },
);

const smokeL = new Layer(
  360,
  () => {
    const m = new THREE.InstancedMesh(ballGeo, celMaterial('fx-smoke'), 360);
    m.castShadow = false;
    return m;
  },
  (p, i, m) => {
    const k = p.t / p.life;
    const s = Math.max(0.001, p.size * puffScale(k) * (1 + k * p.grow));
    _pe.set(p.rx * 0.2, p.ry, 0);
    _pq.setFromEuler(_pe);
    _pm.compose(_pp.set(p.x, p.y, p.z), _pq, _ps.set(s, s * 0.9, s));
    m.setMatrixAt(i, _pm);
    m.setColorAt(i, _col.setRGB(p.r, p.g, p.b));
  },
  false,
);

const fireL = new Layer(
  260,
  () => new THREE.InstancedMesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 260),
  (p, i, m) => {
    const k = p.t / p.life;
    const s = Math.max(0.001, p.size * puffScale(k) * (1 + k * p.grow));
    _pm.compose(_pp.set(p.x, p.y, p.z), _pq.identity(), _ps.set(s, s, s));
    m.setMatrixAt(i, _pm);
    // White-hot → the particle's colour → embers. Values above 1 bloom.
    const hot = Math.max(0, 1 - k * 3.2);
    const cool = Math.max(0, (k - 0.45) / 0.55);
    const f = 1 - cool * 0.75;
    m.setColorAt(i, _col.setRGB((p.r + hot * 1.4) * f * 1.6, (p.g + hot * 1.2) * f * (1.5 - cool), (p.b + hot * 0.9) * f * (1.4 - cool)));
  },
  false,
);

const glowL = new Layer(
  520,
  () => {
    const m = new THREE.InstancedMesh(quadGeo, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 520);
    m.renderOrder = 20;
    return m;
  },
  (p, i, m) => {
    const k = 1 - p.t / p.life;
    const s = Math.max(0.001, p.grow ? p.size * (1 + (1 - k) * p.grow) : p.size * (0.4 + k * 0.6));
    _pm.compose(_pp.set(p.x, p.y, p.z), camera.quaternion, _ps.set(s, s, s));
    m.setMatrixAt(i, _pm);
    m.setColorAt(i, _col.setRGB(p.r * k, p.g * k, p.b * k));
  },
  false,
);

const starL = new Layer(
  200,
  () => {
    const m = new THREE.InstancedMesh(quadGeo, new THREE.MeshBasicMaterial({ map: starTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }), 200);
    m.renderOrder = 24;
    return m;
  },
  (p, i, m) => {
    const k = p.t / p.life;
    const s = Math.max(0.001, p.size * (k < 0.2 ? easeOutBack(k / 0.2) : 1 - (k - 0.2) / 0.8));
    _pe.set(0, 0, p.rx * 0.6);
    _pq.setFromEuler(_pe).premultiply(camera.quaternion);
    _pm.compose(_pp.set(p.x, p.y, p.z), _pq, _ps.set(s, s, s));
    m.setMatrixAt(i, _pm);
    const b = 1.6 * (1 - k * 0.5);
    m.setColorAt(i, _col.setRGB(p.r * b, p.g * b, p.b * b));
  },
  false,
);

/** Spark streaks: thin bright quads stretched along their velocity. */
const _vel = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const streakL = new Layer(
  320,
  () => {
    const m = new THREE.InstancedMesh(quadGeo, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 320);
    m.renderOrder = 23;
    return m;
  },
  (p, i, m) => {
    const k = p.t / p.life;
    _vel.set(p.vx, p.vy, p.vz);
    const sp = _vel.length();
    if (sp < 0.01) _vel.set(1, 0, 0);
    else _vel.divideScalar(sp);
    _toCam.copy(camera.position).sub(_pp.set(p.x, p.y, p.z)).normalize();
    _side.crossVectors(_vel, _toCam);
    if (_side.lengthSq() < 1e-6) _side.set(0, 1, 0);
    _side.normalize();
    _fwd.crossVectors(_vel, _side);
    _rot.makeBasis(_vel, _side, _fwd);
    _pq.setFromRotationMatrix(_rot);
    const len = Math.max(0.05, p.size * (0.4 + sp * 0.07) * (1 - k * 0.5));
    const wid = p.size * 0.18 * (1 - k * 0.6);
    // The quad trails behind the spark's head.
    _pp.set(p.x - _vel.x * len * 0.4, p.y - _vel.y * len * 0.4, p.z - _vel.z * len * 0.4);
    _pm.compose(_pp, _pq, _ps.set(len, Math.max(0.001, wid), 1));
    m.setMatrixAt(i, _pm);
    const b = 1.8 * (1 - k * k);
    m.setColorAt(i, _col.setRGB(p.r * b, p.g * b, p.b * b));
  },
  false,
);

/** Expanding blast shell: a bright fresnel bubble that grows and fades in a blink. */
const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vC = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHELL_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  f = pow(f, 2.4);
  gl_FragColor = vec4(vC * (0.08 + f * 1.5), 1.0);
}`;
/** Additive fresnel bubble (blast shells, ward domes). Needs an instanced mesh with instance colours. */
export function shellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
}
const shellL = new Layer(
  40,
  () => {
    const m = new THREE.InstancedMesh(ballGeo, shellMaterial(), 40);
    m.renderOrder = 19;
    return m;
  },
  (p, i, m) => {
    const k = p.t / p.life;
    const s = Math.max(0.001, p.size * (1 - (1 - k) ** 3));
    _pm.compose(_pp.set(p.x, p.y, p.z), _pq.identity(), _ps.set(s, s * 0.75, s));
    m.setMatrixAt(i, _pm);
    const f = (1 - k) ** 2;
    m.setColorAt(i, _col.setRGB(p.r * f, p.g * f, p.b * f));
  },
  false,
);

/** Scorch marks left on the ground by explosions. The texture stores darkness (white = darkest). */
function scorchTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = i === 0 ? 0 : 14 + Math.random() * 22;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const rad = i === 0 ? 54 : 12 + Math.random() * 16;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, i === 0 ? 'rgba(200,200,200,1)' : 'rgba(70,70,70,1)');
    grd.addColorStop(0.55, i === 0 ? 'rgba(120,120,120,1)' : 'rgba(30,30,30,1)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(cv);
}
const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const scorchL = new Layer(
  48,
  () => {
    // ground × (1 − darkness × strength): the mark only ever darkens what's under it.
    const mat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.ZeroFactor;
    mat.blendDst = THREE.OneMinusSrcColorFactor;
    const m = new THREE.InstancedMesh(flatGeo, mat, 48);
    m.renderOrder = 2;
    return m;
  },
  (p, i, m) => {
    const k = p.t / p.life;
    _pe.set(0, p.ry, 0);
    _pq.setFromEuler(_pe);
    const s = Math.max(0.001, p.size * (k < 0.04 ? k / 0.04 : 1));
    _pm.compose(_pp.set(p.x, 0.045, p.z), _pq, _ps.set(s, 1, s));
    m.setMatrixAt(i, _pm);
    // p.r is the mark's strength; it fades out over the last 30% of its life.
    const f = p.r * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    m.setColorAt(i, _col.setRGB(f * 0.9, f * 0.95, f));
  },
  false,
);

const LAYERS = [scorchL, debrisL, smokeL, fireL, glowL, starL, streakL, shellL];


function ensureParticleMeshes(): void {
  for (const l of LAYERS) l.ensure();
}

function mk(x: number, y: number, z: number, color: number, o: Partial<Particle>): Particle {
  _col.set(color);
  return { x, y, z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.6, size: 0.2, grow: 0, grav: 0, drag: 0, rx: Math.random() * 6, ry: Math.random() * 6, r: _col.r, g: _col.g, b: _col.b, delay: 0, trail: 0, trailT: 0, ...o };
}

export interface BurstOpts {
  speed?: number;
  up?: number;
  life?: number;
  size?: number;
  grav?: number;
  /** Glowing additive sprites instead of debris chunks. */
  glow?: boolean;
  drag?: number;
  /** Spawn spread radius. */
  spread?: number;
  /** Chunks trail smoke (seconds between puffs). */
  trail?: number;
}

export function burst(x: number, y: number, z: number, color: number, count: number, o: BurstOpts = {}): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  const add = !!o.glow;
  const layer = add ? glowL : debrisL;
  for (let i = 0; i < count; i++) {
    const sp = o.spread ?? 0;
    const a = Math.random() * Math.PI * 2;
    const s = (o.speed ?? 3) * (0.4 + Math.random() * 0.6);
    layer.add(
      mk(x + (Math.random() - 0.5) * sp, y, z + (Math.random() - 0.5) * sp, color, {
        vx: Math.cos(a) * s,
        vz: Math.sin(a) * s,
        vy: (o.up ?? 3) * (0.5 + Math.random() * 0.8),
        life: (o.life ?? 0.6) * (0.7 + Math.random() * 0.6),
        size: (o.size ?? 0.14) * (add ? 3 : 1.1),
        grav: o.grav ?? (add ? 2 : 12),
        drag: o.drag ?? (add ? 2.5 : 0),
        trail: add ? 0 : o.trail ?? 0,
      }),
    );
  }
}

/** Short additive glow (magic, muzzle flashes). */
export function flash(x: number, y: number, z: number, color: number, size: number, life = 0.25): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  glowL.add(mk(x, y, z, color, { life, size, grow: 0.5 }));
}

export interface PuffOpts {
  /** Number of puffs. */
  n?: number;
  /** Radius the puffs are scattered over. */
  spread?: number;
  size?: number;
  life?: number;
  /** Upward drift. */
  up?: number;
  /** Outward speed. */
  out?: number;
  /** Extra growth over life (0 = none). */
  grow?: number;
  delay?: number;
}

/** Cartoon smoke / dust puffs: shaded balls that pop in and shrink away. */
export function puff(x: number, y: number, z: number, color: number, o: PuffOpts = {}): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  const n = o.n ?? 5;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (o.spread ?? 0.5) * Math.sqrt(Math.random());
    const out = (o.out ?? 1.2) * (0.5 + Math.random() * 0.7);
    const shade = 0.86 + Math.random() * 0.22;
    _col.set(color);
    smokeL.add({
      ...mk(x + Math.cos(a) * r, y + Math.random() * 0.2, z + Math.sin(a) * r, color, {
        vx: Math.cos(a) * out,
        vz: Math.sin(a) * out,
        vy: (o.up ?? 1.2) * (0.6 + Math.random() * 0.8),
        life: (o.life ?? 0.8) * (0.75 + Math.random() * 0.5),
        size: (o.size ?? 0.4) * (0.7 + Math.random() * 0.6),
        grow: o.grow ?? 0.3,
        drag: 2.2,
        delay: (o.delay ?? 0) + Math.random() * 0.06,
      }),
      r: _col.r * shade,
      g: _col.g * shade,
      b: _col.b * shade,
    });
  }
}

/** Bright fire balls (they bloom), white-hot at first and cooling to embers. */
export function fire(x: number, y: number, z: number, o: PuffOpts & { color?: number } = {}): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  const n = o.n ?? 5;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (o.spread ?? 0.4) * Math.sqrt(Math.random());
    const out = (o.out ?? 1.5) * (0.5 + Math.random() * 0.7);
    fireL.add(
      mk(x + Math.cos(a) * r, y + Math.random() * 0.25, z + Math.sin(a) * r, o.color ?? 0xff7a1a, {
        vx: Math.cos(a) * out,
        vz: Math.sin(a) * out,
        vy: (o.up ?? 2) * (0.6 + Math.random() * 0.8),
        life: (o.life ?? 0.5) * (0.75 + Math.random() * 0.5),
        size: (o.size ?? 0.35) * (0.7 + Math.random() * 0.6),
        grow: o.grow ?? 0.2,
        drag: 2.6,
        delay: (o.delay ?? 0) + Math.random() * 0.05,
      }),
    );
  }
}

/** Star-shaped impact sparkle. */
export function spark(x: number, y: number, z: number, color = 0xfff2c0, size = 0.7, life = 0.28): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  starL.add(mk(x, y, z, color, { life, size }));
}

/** Bright spark streaks flying out from a point (optionally biased along a direction). */
export function streaks(
  x: number, y: number, z: number, color: number, n: number,
  o: { speed?: number; up?: number; life?: number; size?: number; dirX?: number; dirZ?: number; grav?: number; cone?: number } = {},
): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  const sp0 = o.speed ?? 9;
  const hasDir = o.dirX !== undefined && o.dirZ !== undefined;
  const base = hasDir ? Math.atan2(o.dirZ!, o.dirX!) : 0;
  const cone = o.cone ?? 1.1;
  for (let i = 0; i < n; i++) {
    const a = hasDir ? base + (Math.random() - 0.5) * cone * 2 : Math.random() * Math.PI * 2;
    const sp = sp0 * (0.45 + Math.random() * 0.75);
    const h = Math.random();
    streakL.add(
      mk(x, y, z, color, {
        vx: Math.cos(a) * sp * (1 - h * 0.4),
        vz: Math.sin(a) * sp * (1 - h * 0.4),
        vy: (o.up ?? 4) * (0.2 + h),
        life: (o.life ?? 0.32) * (0.6 + Math.random() * 0.7),
        size: (o.size ?? 0.55) * (0.7 + Math.random() * 0.6),
        grav: o.grav ?? 16,
        drag: 2.2,
      }),
    );
  }
}

/**
 * A hit landing: a popping star, sparks sprayed away from the attacker and a
 * couple of flecks. Colour by damage type; `big` for heavy blows.
 */
export function impact(x: number, y: number, z: number, color = 0xfff2c0, big = false, dirX?: number, dirZ?: number): void {
  if (G.autotest) return;
  spark(x, y, z, color, big ? 1.35 : 0.8, big ? 0.32 : 0.24);
  streaks(x, y, z, color, big ? 7 : 3, { speed: big ? 11 : 7, up: big ? 4 : 2.5, life: big ? 0.3 : 0.22, size: big ? 0.7 : 0.45, dirX, dirZ, cone: dirX === undefined ? 3.2 : 0.9 });
  burst(x, y, z, color, big ? 4 : 2, { glow: true, speed: big ? 5 : 3.5, up: 2, life: 0.25, size: 0.06 });
}

// ───────────────────────────── Juice: shake, hit-stop, camera punch, light ─────────────────────────────

let stopAt = 0;
/** Freeze the action for a heartbeat so a big hit lands. */
export function hitStop(sec: number): void {
  if (G.autotest) return;
  const now = performance.now();
  if (sec < 0.09 && now - stopAt < 220) return;
  stopAt = now;
  G.hitStop = Math.max(G.hitStop, sec);
}

/** Camera shake that fades with distance from the hero. */
export function shakeAt(x: number, z: number, amount: number, cap = 0.85): void {
  const d = Math.hypot(x - hero.x, z - hero.z);
  const k = d < 12 ? 1 : Math.max(0.2, 1 - (d - 12) / 40);
  G.shake = Math.min(cap, G.shake + amount * k);
}

/** Punch the camera toward the action. */
export function kick(amount: number): void {
  G.kick = Math.min(1, Math.max(G.kick, amount));
}

interface FlashLight {
  l: THREE.PointLight;
  t: number;
  life: number;
  peak: number;
}
const lights: FlashLight[] = [];
/** A fixed pool, added once, so the number of lights (and so the shaders) never changes. */
function ensureLights(): void {
  if (lights.length || G.autotest) return;
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xffa040, 0, 14, 1.6);
    l.position.set(0, -100, 0);
    scene.add(l);
    lights.push({ l, t: 1, life: 1, peak: 0 });
  }
}

/** A real light that briefly lights up everything around an explosion. */
export function lightFlash(x: number, y: number, z: number, color: number, intensity: number, radius: number, life = 0.35): void {
  if (G.autotest || !lights.length) return;
  // Reuse the light that is furthest through its fade.
  let best = lights[0];
  for (const f of lights) if (f.t / f.life > best.t / best.life) best = f;
  best.l.color.set(color);
  best.l.position.set(x, y, z);
  best.l.distance = radius;
  best.t = 0;
  best.life = life;
  best.peak = intensity;
  best.l.intensity = intensity;
}

function updateLights(dt: number): void {
  for (const f of lights) {
    if (f.t >= f.life) continue;
    f.t += dt;
    const k = Math.min(1, f.t / f.life);
    f.l.intensity = f.peak * (1 - k) * (1 - k);
    if (k >= 1) {
      f.l.intensity = 0;
      f.l.position.y = -100;
    }
  }
}

/** Darkened, blasted ground. `dark` is how strongly it shows (0–1). */
export function scorch(x: number, z: number, size: number, dark = 0.55, life = 9): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  scorchL.add(mk(x, 0, z, 0xffffff, { size, life, ry: Math.random() * 6.3, r: dark, g: dark, b: dark }));
}

export interface BoomOpts {
  color?: number;
  smoke?: number;
  chunks?: number;
  /** Screen shockwave, a bigger light flash, hit-stop and a camera punch. */
  big?: boolean;
  /** Leave a scorch mark (default on, except for dirt bursts). */
  scorch?: boolean;
  /** No fire: a dirt and stone burst (boulders, tunnels). */
  dirt?: boolean;
}

/**
 * Cartoon explosion: a white-hot flash and blast shell, fireballs that roll up
 * into a smoke column, spark streaks, embers, smoking chunks, a dust skirt
 * racing along the ground, a shockwave ring and a scorch mark.
 */
export function boom(x: number, y: number, z: number, radius: number, o: BoomOpts = {}): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  const r = Math.max(0.6, radius);
  const col = o.color ?? 0xffb060;
  const smoke = o.smoke ?? 0x857c74;
  const dirt = !!o.dirt;
  if (!dirt) {
    flash(x, y + 0.4, z, col, r * 2.6, 0.2);
    shellL.add(mk(x, y + 0.3, z, col, { size: r * 1.35, life: 0.28 }));
    // A white-hot core that pops first, then the rolling fireballs.
    fire(x, y + 0.4, z, { n: 3, spread: r * 0.15, size: 0.45 + r * 0.22, life: 0.3, up: 1, out: 0.6, color: 0xfff0c0 });
    fire(x, y + 0.3, z, { n: Math.round(6 + r * 3), spread: r * 0.35, size: 0.34 + r * 0.17, life: 0.55, up: 2.6, out: 1.6 + r * 0.9, color: o.color });
    fire(x, y + 0.6, z, { n: Math.round(2 + r), spread: r * 0.2, size: 0.3 + r * 0.12, life: 0.7, up: 4.2, out: 0.4, color: o.color, delay: 0.05 });
    streaks(x, y + 0.5, z, 0xffe0a0, Math.round(6 + r * 4), { speed: 8 + r * 3, up: 6, life: 0.4, size: 0.6 + r * 0.1 });
    // Embers that arc out and fall.
    burst(x, y + 0.5, z, 0xffa040, Math.round(4 + r * 3), { glow: true, speed: 3 + r * 1.5, up: 7, life: 1.1, size: 0.05, grav: 9, drag: 0.8 });
    lightFlash(x, y + 1.5, z, col, o.big ? 70 : 26 + r * 8, r * (o.big ? 9 : 6), o.big ? 0.5 : 0.3);
  } else {
    puff(x, y + 0.4, z, 0xb89a72, { n: Math.round(5 + r * 3), spread: r * 0.4, size: 0.4 + r * 0.15, life: 0.8, up: 3, out: 1 + r * 0.7, grow: 0.4 });
    spark(x, y + 0.6, z, 0xfff0c0, 0.8 + r * 0.3, 0.3);
    streaks(x, y + 0.4, z, 0xfff0d0, Math.round(3 + r * 2), { speed: 7 + r * 2, up: 5, life: 0.3, size: 0.45 });
  }
  // Smoke: a squat cloud, then a slower column rising out of it.
  puff(x, y + 0.5, z, smoke, { n: Math.round(4 + r * 1.8), spread: r * 0.45, size: 0.32 + r * 0.14, life: 1.0, up: 1.8, out: 0.8 + r * 0.5, delay: 0.08, grow: 0.45 });
  puff(x, y + 1.2, z, smoke, { n: Math.round(1 + r), spread: r * 0.2, size: 0.28 + r * 0.11, life: 1.4, up: 3.4, out: 0.25, delay: 0.18, grow: 0.8 });
  // A dust skirt racing out along the ground.
  const skirt = Math.round(6 + r * 2);
  for (let i = 0; i < skirt; i++) {
    const a = (i / skirt) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 3 + r * 1.6;
    smokeL.add(mk(x + Math.cos(a) * r * 0.3, 0.25, z + Math.sin(a) * r * 0.3, 0xd8ccb8, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.3, life: 0.7, size: 0.28 + r * 0.06, grow: 0.9, drag: 3.2, delay: 0.03 }));
  }
  burst(x, y + 0.3, z, dirt ? 0x8a6a4a : 0x5a4a3a, o.chunks ?? Math.round(5 + r * 2), { speed: 4 + r * 2, up: 7, size: 0.16 + r * 0.035, life: 1.0, trail: o.big || r > 1.8 ? 0.06 : 0 });
  for (let i = 0; i < 3; i++) spark(x + (Math.random() - 0.5) * r, y + 0.6 + Math.random() * r * 0.6, z + (Math.random() - 0.5) * r, 0xfff0b0, 0.8 + r * 0.25, 0.35);
  ring(x, z, dirt ? 0xe8d8b8 : o.color ?? 0xffa04a, r * 1.4, 0.45);
  if (o.scorch ?? !dirt) scorch(x, z, r * 2.4, dirt ? 0.4 : 0.6);
  if (o.big) {
    Post.shock(x, y + 0.5, z, Math.min(1, 0.45 + r * 0.12));
    hitStop(0.07);
    kick(0.5);
  }
}

/** The ground bursting open: dirt fountains, rocks and a dark hole (tunnels, graves). */
export function erupt(x: number, z: number, radius: number, color = 0x7a5a3a): void {
  if (G.autotest) return;
  boom(x, 0.2, z, radius, { dirt: true, smoke: 0x9a8a72, chunks: Math.round(10 + radius * 4), scorch: false });
  puff(x, 0.5, z, color, { n: 8, spread: radius * 0.6, size: 0.45, life: 1.1, up: 4.5, out: 1.8, grow: 0.4 });
  burst(x, 0.5, z, color, 14, { speed: 4, up: 9, size: 0.2, life: 1.2, trail: 0.08 });
  scorch(x, z, radius * 2.2, 0.75, 18);
  Post.shock(x, 0.5, z, 0.5);
}

/** A magic ward shattering into glittering shards. */
export function shatter(x: number, y: number, z: number, size: number, color = 0xc8a8ff): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  shellL.add(mk(x, y, z, color, { size: size * 1.8, life: 0.35 }));
  streaks(x, y, z, 0xffffff, 10, { speed: 10, up: 5, life: 0.4, size: 0.6 });
  streaks(x, y, z, color, 12, { speed: 7, up: 6, life: 0.6, size: 0.5, grav: 10 });
  burst(x, y, z, color, 18, { glow: true, speed: 6, up: 5, life: 0.8, size: 0.07, grav: 8 });
  spark(x, y + 0.3, z, 0xffffff, 1.4 * size, 0.4);
  lightFlash(x, y + 1, z, color, 30, 10, 0.4);
  Post.shock(x, y, z, 0.35);
}

/** A defeated enemy vanishes in a puff of cartoon smoke. */
export function poof(x: number, y: number, z: number, size = 1, color = 0xf2ece4): void {
  if (G.autotest) return;
  puff(x, y, z, color, { n: Math.round(5 + size * 3), spread: 0.35 * size, size: 0.32 * size, life: 0.6, up: 1.4, out: 1.6 * size, grow: 0.25 });
  spark(x, y + 0.4 * size, z, 0xffffff, 0.7 * size, 0.3);
}

/** Little dust kick (footfalls, landings, building). */
export function dust(x: number, z: number, size = 1, color = 0xc8b898): void {
  if (G.autotest) return;
  puff(x, 0.15, z, color, { n: Math.round(3 + size * 2), spread: 0.4 * size, size: 0.22 * size, life: 0.55, up: 0.6, out: 1.4 * size, grow: 0.3 });
}

function updateParticles(dt: number): void {
  for (const l of LAYERS) l.step(dt);
}

function drawParticles(): void {
  for (const l of LAYERS) l.render();
}

// ───────────────────────────── Rings, flashes and beams ─────────────────────────────

interface Ring {
  m: THREE.Mesh;
  t: number;
  life: number;
  from: number;
  to: number;
}
const ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
const rings: Ring[] = [];

/** Expanding ground shockwave. */
export function ring(x: number, z: number, color: number, radius: number, life = 0.5, from = 0.2): void {
  if (G.autotest) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(ringGeo, mat);
  m.position.set(x, 0.12, z);
  m.renderOrder = 8;
  scene.add(m);
  rings.push({ m, t: 0, life, from: radius * from, to: radius });
}

interface Warn {
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  t: number;
  life: number;
  r: number;
  follow?: { x: number; z: number; alive: boolean };
}
const warnRingGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
const warnFillGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const warns: Warn[] = [];

/**
 * Danger telegraph: a red circle on the ground that fills up until the blow
 * lands. Get out of it! Optionally follows a unit.
 */
export function warnCircle(x: number, z: number, radius: number, dur: number, follow?: { x: number; z: number; alive: boolean }, color = 0xff3a2a): void {
  if (G.autotest) return;
  // Drawn over walls and units so you can always see where it's going to land.
  const make = (geo: THREE.BufferGeometry, op: number) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    m.position.set(x, 0.1, z);
    m.scale.setScalar(radius);
    m.renderOrder = 6;
    scene.add(m);
    return m;
  };
  warns.push({ ring: make(warnRingGeo, 0.85), fill: make(warnFillGeo, 0.22), t: 0, life: dur, r: radius, follow });
}

function updateWarns(dt: number): void {
  for (let i = warns.length - 1; i >= 0; i--) {
    const w = warns[i];
    w.t += dt;
    const k = w.t / w.life;
    if (k >= 1 || (w.follow && !w.follow.alive)) {
      for (const m of [w.ring, w.fill]) {
        scene.remove(m);
        (m.material as THREE.Material).dispose();
      }
      warns.splice(i, 1);
      continue;
    }
    if (w.follow) {
      w.ring.position.set(w.follow.x, 0.1, w.follow.z);
      w.fill.position.set(w.follow.x, 0.1, w.follow.z);
    }
    w.fill.scale.setScalar(Math.max(0.01, w.r * k));
    const pulse = 0.7 + 0.3 * Math.sin(w.t * 22);
    (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * pulse;
    (w.fill.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.24 * k;
  }
}

export function clearWarns(): void {
  warns.forEach((w) => (w.t = w.life));
}

interface Slash {
  m: THREE.Mesh;
  t: number;
  life: number;
  spin: number;
  size: number;
}
const slashGeo = new THREE.RingGeometry(0.62, 1, 28, 1, 0, Math.PI * 0.95).rotateX(-Math.PI / 2);
const slashes: Slash[] = [];

/** Cartoon sword swoosh: a bright crescent that sweeps and fades in front of `facing`. */
export function slash(x: number, y: number, z: number, facing: number, color = 0xffffff, size = 1.5, life = 0.2, spin = 1): void {
  if (G.autotest) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(slashGeo, mat);
  m.position.set(x, y, z);
  m.rotation.set(0, facing + Math.PI - spin * 0.5, 0);
  m.renderOrder = 21;
  scene.add(m);
  slashes.push({ m, t: 0, life, spin, size });
}

interface Beam {
  m: THREE.Mesh;
  t: number;
  life: number;
}
const beamGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const beams: Beam[] = [];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Glowing straight line between two points. */
export function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 0.12, life = 0.18): void {
  if (G.autotest) return;
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  if (len < 0.01) return;
  const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(_a);
  m.lookAt(_b);
  m.scale.set(width, width, len);
  m.renderOrder = 22;
  scene.add(m);
  beams.push({ m, t: 0, life });
}

/** Jagged lightning bolt. */
export function lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color = 0xd8b8ff): void {
  if (G.autotest) return;
  const n = 5;
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const j = i === n ? 0 : 0.55;
    const nx = ax + (bx - ax) * t + (Math.random() - 0.5) * j;
    const ny = ay + (by - ay) * t + (Math.random() - 0.5) * j;
    const nz = az + (bz - az) * t + (Math.random() - 0.5) * j;
    beam(px, py, pz, nx, ny, nz, color, 0.1, 0.16);
    beam(px, py, pz, nx, ny, nz, 0xffffff, 0.04, 0.12);
    px = nx;
    py = ny;
    pz = nz;
  }
  flash(bx, by, bz, color, 1.4, 0.2);
}

function updateShapes(dt: number): void {
  updateWarns(dt);
  updateLights(dt);
  for (let i = slashes.length - 1; i >= 0; i--) {
    const sl = slashes[i];
    sl.t += dt;
    const k = sl.t / sl.life;
    if (k >= 1) {
      scene.remove(sl.m);
      (sl.m.material as THREE.Material).dispose();
      slashes.splice(i, 1);
      continue;
    }
    sl.m.rotation.y += sl.spin * dt * 7;
    sl.m.scale.setScalar(sl.size * (0.7 + 0.45 * Math.sqrt(k)));
    (sl.m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    const k = r.t / r.life;
    if (k >= 1) {
      scene.remove(r.m);
      (r.m.material as THREE.Material).dispose();
      rings.splice(i, 1);
      continue;
    }
    const e = 1 - (1 - k) * (1 - k);
    r.m.scale.setScalar(r.from + (r.to - r.from) * e);
    (r.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
  }
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.t += dt;
    const k = b.t / b.life;
    if (k >= 1) {
      scene.remove(b.m);
      (b.m.material as THREE.Material).dispose();
      beams.splice(i, 1);
      continue;
    }
    (b.m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
  }
}

// ───────────────────────────── Flying items ─────────────────────────────

interface Flyer {
  m: THREE.Mesh;
  kind: ItemKind;
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  done?: () => void;
}
const flyers: Flyer[] = [];
const flyPool = new Map<ItemKind, THREE.Mesh[]>();

export function fly(
  kind: ItemKind,
  from: THREE.Vector3,
  to: () => THREE.Vector3,
  o: { dur?: number; arc?: number; done?: () => void } = {},
): void {
  if (G.autotest) {
    o.done?.();
    return;
  }
  if (flyers.length > 140) finishFlyer(0);
  const pool = flyPool.get(kind) ?? [];
  flyPool.set(kind, pool);
  let m = pool.pop();
  if (!m) {
    m = makeMesh(itemGeo(kind), false, false);
    scene.add(m);
  }
  m.visible = true;
  m.position.copy(from);
  flyers.push({ m, kind, from: from.clone(), to, t: 0, dur: o.dur ?? 0.32, arc: o.arc ?? 1.4, done: o.done });
}

function finishFlyer(i: number): void {
  const f = flyers[i];
  flyers.splice(i, 1);
  f.m.visible = false;
  flyPool.get(f.kind)?.push(f.m);
  f.done?.();
}

function updateFlyers(dt: number): void {
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    f.t += dt / f.dur;
    if (f.t >= 1) {
      finishFlyer(i);
      continue;
    }
    const to = f.to();
    const e = f.t;
    f.m.position.set(
      f.from.x + (to.x - f.from.x) * e,
      f.from.y + (to.y - f.from.y) * e + 4 * f.arc * e * (1 - e),
      f.from.z + (to.z - f.from.z) * e,
    );
    f.m.rotation.y += dt * 10;
    f.m.rotation.x = f.kind === 'coin' ? Math.PI / 2 : 0;
  }
}

// ───────────────────────────── Floating text ─────────────────────────────

interface FText {
  el: HTMLDivElement;
  p: THREE.Vector3;
  t: number;
  life: number;
}
const texts: FText[] = [];
let layer: HTMLElement | null = null;
const _v = new THREE.Vector3();

export function text(x: number, y: number, z: number, str: string, cls = '', life = 1.1): void {
  if (G.autotest) return;
  if (!layer) layer = document.getElementById('fx');
  if (!layer) return;
  if (texts.length > 46) {
    const old = texts.shift();
    old?.el.remove();
  }
  const el = document.createElement('div');
  el.className = 'ft ' + cls;
  el.textContent = str;
  layer.appendChild(el);
  texts.push({ el, p: new THREE.Vector3(x, y, z), t: 0, life });
}

export function clearTexts(): void {
  for (const f of texts) f.el.remove();
  texts.length = 0;
}

/** Called after the camera moved so text sticks to the world. */
export function updateTexts(dt: number): void {
  for (let i = texts.length - 1; i >= 0; i--) {
    const f = texts[i];
    f.t += dt;
    if (f.t >= f.life) {
      f.el.remove();
      texts.splice(i, 1);
      continue;
    }
    f.p.y += dt * 1.3;
    _v.copy(f.p).project(camera);
    const sx = (_v.x * 0.5 + 0.5) * engine.w;
    const sy = (-_v.y * 0.5 + 0.5) * engine.h;
    const k = f.t / f.life;
    f.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${(k < 0.15 ? 0.6 + k * 2.7 : 1).toFixed(2)})`;
    f.el.style.opacity = String(1 - k * k);
  }
}

// ───────────────────────────── Coin drops ─────────────────────────────

interface Drop {
  m: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  value: number;
  state: 'bounce' | 'rest' | 'fly';
  delay: number;
  sp: number;
}
const drops: Drop[] = [];
const dropPool: THREE.Mesh[] = [];

export function dropCoins(x: number, z: number, total: number): void {
  total = Math.round(total);
  if (total <= 0) return;
  if (G.autotest) {
    addCoins(total);
    return;
  }
  const n = Math.max(1, Math.min(6, Math.ceil(total / 4)));
  let left = total;
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? left : Math.floor(total / n);
    left -= v;
    let m = dropPool.pop();
    if (!m) {
      m = makeMesh(itemGeo('coin'), true, false);
      scene.add(m);
    }
    m.visible = true;
    const a = Math.random() * Math.PI * 2;
    const s = 1.2 + Math.random() * 1.8;
    drops.push({ m, x, y: 0.6, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 4 + Math.random() * 2, value: v, state: 'bounce', delay: 0, sp: 0 });
  }
  // Too many coins lying around: merge the oldest into the hero's purse.
  while (drops.length > 160) {
    const d = drops.shift()!;
    addCoins(d.value);
    d.m.visible = false;
    dropPool.push(d.m);
  }
}

/** End of wave: everything on the ground flies to the hero. */
export function collectAllDrops(): void {
  drops.forEach((d, i) => {
    d.state = 'fly';
    d.delay = 0.6 + Math.min(i, 60) * 0.02;
  });
}

function updateDrops(dt: number): void {
  const mag = Stat.magnet();
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (d.state === 'bounce') {
      d.vy -= 18 * dt;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.y += d.vy * dt;
      if (d.y <= 0.08) {
        d.y = 0.08;
        if (Math.abs(d.vy) < 1.5) d.state = 'rest';
        d.vy = Math.abs(d.vy) * 0.4;
        d.vx *= 0.5;
        d.vz *= 0.5;
      }
    }
    if (d.state !== 'fly' && hero.alive && Math.hypot(hero.x - d.x, hero.z - d.z) < mag) d.state = 'fly';
    if (d.state === 'fly') {
      if (d.delay > 0) {
        d.delay -= dt;
      } else if (hero.alive) {
        d.sp = Math.min(34, d.sp + dt * 44);
        const tx = hero.x, ty = 1.2, tz = hero.z;
        const dx = tx - d.x, dy = ty - d.y, dz = tz - d.z;
        const L = Math.hypot(dx, dy, dz);
        const step = d.sp * dt;
        if (L <= step + 0.2) {
          addCoins(d.value);
          Sfx.play('coin', 0.7);
          d.m.visible = false;
          dropPool.push(d.m);
          drops.splice(i, 1);
          continue;
        }
        d.x += (dx / L) * step;
        d.y += (dy / L) * step;
        d.z += (dz / L) * step;
      }
    }
    d.m.position.set(d.x, d.y + (d.state === 'rest' ? Math.sin(G.time * 4 + i) * 0.05 + 0.1 : 0), d.z);
    d.m.rotation.set((Math.PI / 2) * (d.state === 'rest' ? 1 : 0.5), 0, G.time * 4 + i);
  }
}

// ───────────────────────────── Health bars ─────────────────────────────
// Every bar in the world is drawn by three instanced meshes (background,
// fill, shield) that face the camera.

const MAX_BARS = 320;
const bars = new Set<Bar>();
let barBg: THREE.InstancedMesh | null = null;
let barFill: THREE.InstancedMesh | null = null;
let barShield: THREE.InstancedMesh | null = null;

function ensureBarMeshes(): void {
  if (barBg) return;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mk = (mat: THREE.MeshBasicMaterial, order: number, colors: boolean) => {
    const m = new THREE.InstancedMesh(geo, mat, MAX_BARS);
    if (colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BARS * 3), 3);
    m.frustumCulled = false;
    m.renderOrder = order;
    m.count = 0;
    scene.add(m);
    return m;
  };
  barBg = mk(new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }), 30, false);
  barFill = mk(new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true }), 31, true);
  barShield = mk(new THREE.MeshBasicMaterial({ color: 0x8fb4ff, depthTest: false, depthWrite: false, transparent: true }), 32, false);
}

export class Bar {
  private readonly w: number;
  private readonly h: number;
  private readonly color = new THREE.Color();
  private ratio = 1;
  private shield = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  visible = false;

  constructor(w: number, color: number, h = 0.13) {
    this.w = w;
    this.h = h;
    this.color.set(color);
    bars.add(this);
  }

  set(ratio: number, x: number, y: number, z: number, show = ratio < 0.999, shield = 0): void {
    this.visible = show && ratio > 0;
    if (!this.visible) return;
    this.ratio = Math.min(1, ratio);
    this.shield = Math.min(1, Math.max(0, shield));
    this.x = x;
    this.y = y;
    this.z = z;
  }

  hide(): void {
    this.visible = false;
  }

  dispose(): void {
    bars.delete(this);
  }

  /** Write this bar into the instanced meshes. Returns whether a shield row was drawn. */
  draw(i: number, si: number, right: THREE.Vector3, up: THREE.Vector3, q: THREE.Quaternion): boolean {
    const { w, h } = this;
    _pp.set(this.x, this.y, this.z);
    _pm.compose(_pp, q, _ps.set(w + 0.08, h + 0.07, 1));
    barBg!.setMatrixAt(i, _pm);
    const fw = Math.max(0.001, w * this.ratio);
    _pp.set(this.x, this.y, this.z).addScaledVector(right, -w / 2 + fw / 2);
    _pm.compose(_pp, q, _ps.set(fw, h, 1));
    barFill!.setMatrixAt(i, _pm);
    barFill!.setColorAt(i, this.color);
    if (this.shield <= 0) return false;
    const sw = Math.max(0.001, w * this.shield);
    _pp.set(this.x, this.y, this.z).addScaledVector(right, -w / 2 + sw / 2).addScaledVector(up, h * 0.9);
    _pm.compose(_pp, q, _ps.set(sw, h * 0.6, 1));
    barShield!.setMatrixAt(si, _pm);
    return true;
  }
}

const _right = new THREE.Vector3();
const _upv = new THREE.Vector3();

function drawBars(): void {
  if (!bars.size) return;
  ensureBarMeshes();
  const q = camera.quaternion;
  _right.set(1, 0, 0).applyQuaternion(q);
  _upv.set(0, 1, 0).applyQuaternion(q);
  let i = 0;
  let si = 0;
  for (const b of bars) {
    if (!b.visible) continue;
    if (i >= MAX_BARS) break;
    if (b.draw(i, si, _right, _upv, q)) si++;
    i++;
  }
  for (const m of [barBg!, barFill!]) {
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
  }
  if (barFill!.instanceColor) barFill!.instanceColor.needsUpdate = true;
  barShield!.count = si;
  barShield!.instanceMatrix.needsUpdate = true;
}

/** Create the shared instanced meshes up front so their shaders compile at boot. */
export function warmFX(): void {
  ensureParticleMeshes();
  ensureBarMeshes();
  ensureLights();
}

/** Materials created on demand (rings, beams) — returned so they can be precompiled. */
export function fxSampleMaterials(): THREE.Material[] {
  return [
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  ];
}

/** Called once per frame after the camera moved: writes instanced particles and bars. */
export function renderFX(): void {
  drawParticles();
  drawBars();
}

// ───────────────────────────── Pop-in tweens ─────────────────────────────

interface Pop {
  o: THREE.Object3D;
  t: number;
  dur: number;
  delay: number;
}
const pops: Pop[] = [];

/** Scale an object from 0 to 1 with a little overshoot. */
export function pop(o: THREE.Object3D, dur = 0.45, delay = 0): void {
  o.scale.setScalar(0.001);
  pops.push({ o, t: 0, dur, delay });
}

function updatePops(dt: number): void {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    if (p.delay > 0) {
      p.delay -= dt;
      continue;
    }
    p.t += dt / p.dur;
    if (p.t >= 1) {
      p.o.scale.setScalar(1);
      pops.splice(i, 1);
      continue;
    }
    p.o.scale.setScalar(Math.max(0.001, easeOutBack(p.t)));
  }
}

export function updateFX(dt: number): void {
  updateParticles(dt);
  updateFlyers(dt);
  updateDrops(dt);
  updatePops(dt);
  updateShapes(dt);
}
