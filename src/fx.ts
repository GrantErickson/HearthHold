import * as THREE from 'three';
import { scene, camera, engine } from './engine';
import { itemGeo, makeMesh, type ItemKind } from './models';
import { hero } from './hero';
import { G, addCoins } from './state';
import { Sfx } from './audio';
import { Stat } from './progress';
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
// All debris cubes are one instanced mesh and all glows are another, so a
// busy battle costs two draw calls for particles instead of hundreds.

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
}
const MAX_DEBRIS = 420;
const MAX_GLOW = 520;
const debris: Particle[] = [];
const glows: Particle[] = [];
let debrisMesh: THREE.InstancedMesh | null = null;
let glowMesh: THREE.InstancedMesh | null = null;
const _col = new THREE.Color();

function ensureParticleMeshes(): void {
  if (debrisMesh) return;
  debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_DEBRIS);
  debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
  debrisMesh.frustumCulled = false;
  debrisMesh.count = 0;
  scene.add(debrisMesh);
  glowMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    MAX_GLOW,
  );
  glowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW * 3), 3);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = 20;
  glowMesh.count = 0;
  scene.add(glowMesh);
}

export interface BurstOpts {
  speed?: number;
  up?: number;
  life?: number;
  size?: number;
  grav?: number;
  /** Glowing additive sprites instead of debris cubes. */
  glow?: boolean;
  drag?: number;
  /** Spawn spread radius. */
  spread?: number;
}

export function burst(x: number, y: number, z: number, color: number, count: number, o: BurstOpts = {}): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  const add = !!o.glow;
  const list = add ? glows : debris;
  const max = add ? MAX_GLOW : MAX_DEBRIS;
  _col.set(color);
  for (let i = 0; i < count; i++) {
    if (list.length >= max) list.shift();
    const sp = o.spread ?? 0;
    const a = Math.random() * Math.PI * 2;
    const s = (o.speed ?? 3) * (0.4 + Math.random() * 0.6);
    list.push({
      x: x + (Math.random() - 0.5) * sp,
      y,
      z: z + (Math.random() - 0.5) * sp,
      vx: Math.cos(a) * s,
      vz: Math.sin(a) * s,
      vy: (o.up ?? 3) * (0.5 + Math.random() * 0.8),
      t: 0,
      life: (o.life ?? 0.6) * (0.7 + Math.random() * 0.6),
      size: (o.size ?? 0.14) * (add ? 3 : 1),
      grow: 0,
      grav: o.grav ?? (add ? 2 : 12),
      drag: o.drag ?? (add ? 2.5 : 0),
      rx: Math.random() * 3,
      ry: Math.random() * 3,
      r: _col.r,
      g: _col.g,
      b: _col.b,
    });
  }
}

/** Short additive glow flash (hits, muzzle flashes, explosions). */
export function flash(x: number, y: number, z: number, color: number, size: number, life = 0.25): void {
  if (G.autotest) return;
  ensureParticleMeshes();
  if (glows.length >= MAX_GLOW) glows.shift();
  _col.set(color);
  glows.push({ x, y, z, vx: 0, vy: 0, vz: 0, t: 0, life, size, grow: 0.5, grav: 0, drag: 0, rx: 0, ry: 0, r: _col.r, g: _col.g, b: _col.b });
}

function stepList(list: Particle[], dt: number, ground: boolean): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
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
    if (ground && p.y < 0.05) {
      p.y = 0.05;
      p.vy = Math.abs(p.vy) * 0.3;
      p.vx *= 0.6;
      p.vz *= 0.6;
    }
    p.rx += dt * 6;
  }
}

function updateParticles(dt: number): void {
  stepList(debris, dt, true);
  stepList(glows, dt, false);
}

const _pm = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _pe = new THREE.Euler();
const _pp = new THREE.Vector3();
const _ps = new THREE.Vector3();

function drawParticles(): void {
  if (!debrisMesh || !glowMesh) return;
  for (let i = 0; i < debris.length; i++) {
    const p = debris[i];
    const s = Math.max(0.001, p.size * (1 - p.t / p.life));
    _pe.set(p.rx, p.ry, 0);
    _pq.setFromEuler(_pe);
    _pm.compose(_pp.set(p.x, p.y, p.z), _pq, _ps.set(s, s, s));
    debrisMesh.setMatrixAt(i, _pm);
    debrisMesh.setColorAt(i, _col.setRGB(p.r, p.g, p.b));
  }
  debrisMesh.count = debris.length;
  debrisMesh.instanceMatrix.needsUpdate = true;
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  const q = camera.quaternion;
  for (let i = 0; i < glows.length; i++) {
    const p = glows[i];
    const k = 1 - p.t / p.life;
    const s = Math.max(0.001, p.grow ? p.size * (1 + (1 - k) * p.grow) : p.size * (0.4 + k * 0.6));
    _pm.compose(_pp.set(p.x, p.y, p.z), q, _ps.set(s, s, s));
    glowMesh.setMatrixAt(i, _pm);
    glowMesh.setColorAt(i, _col.setRGB(p.r * k, p.g * k, p.b * k));
  }
  glowMesh.count = glows.length;
  glowMesh.instanceMatrix.needsUpdate = true;
  if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
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
}

/** Materials created on demand (rings, beams) — returned so they can be precompiled. */
export function fxSampleMaterials(): THREE.Material[] {
  return [
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
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
