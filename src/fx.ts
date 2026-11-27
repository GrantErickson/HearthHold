import * as THREE from 'three';
import { scene, camera, engine } from './engine';
import { itemGeo, makeMesh, type ItemKind } from './models';
import { hero } from './hero';
import { G, addCoins } from './state';
import { Sfx } from './audio';
import { CFG } from './config';
import { easeOutBack } from './util';

// ───────────────────────────── Particles ─────────────────────────────

interface Particle {
  m: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  size: number;
  grav: number;
}
const pGeo = new THREE.BoxGeometry(1, 1, 1);
const pMats = new Map<number, THREE.MeshBasicMaterial>();
const pFree: THREE.Mesh[] = [];
const particles: Particle[] = [];
const MAX_PARTICLES = 280;

function pMat(c: number): THREE.MeshBasicMaterial {
  let m = pMats.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c });
    pMats.set(c, m);
  }
  return m;
}

export interface BurstOpts {
  speed?: number;
  up?: number;
  life?: number;
  size?: number;
  grav?: number;
}

export function burst(x: number, y: number, z: number, color: number, count: number, o: BurstOpts = {}): void {
  if (G.autotest) return;
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) {
      const old = particles.shift();
      if (old) {
        old.m.visible = false;
        pFree.push(old.m);
      }
    }
    let m = pFree.pop();
    if (!m) {
      m = new THREE.Mesh(pGeo);
      scene.add(m);
    }
    m.material = pMat(color);
    m.visible = true;
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const a = Math.random() * Math.PI * 2;
    const s = (o.speed ?? 3) * (0.4 + Math.random() * 0.6);
    particles.push({
      m,
      vx: Math.cos(a) * s,
      vz: Math.sin(a) * s,
      vy: (o.up ?? 3) * (0.5 + Math.random() * 0.8),
      t: 0,
      life: (o.life ?? 0.6) * (0.7 + Math.random() * 0.6),
      size: o.size ?? 0.14,
      grav: o.grav ?? 12,
    });
  }
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) {
      p.m.visible = false;
      pFree.push(p.m);
      particles.splice(i, 1);
      continue;
    }
    p.vy -= p.grav * dt;
    p.m.position.x += p.vx * dt;
    p.m.position.y += p.vy * dt;
    p.m.position.z += p.vz * dt;
    if (p.m.position.y < 0.05) {
      p.m.position.y = 0.05;
      p.vy = Math.abs(p.vy) * 0.3;
      p.vx *= 0.6;
      p.vz *= 0.6;
    }
    p.m.rotation.x += dt * 6;
    p.m.scale.setScalar(Math.max(0.001, p.size * (1 - p.t / p.life)));
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
  if (texts.length > 40) {
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
}

/** End of wave: everything on the ground flies to the hero. */
export function collectAllDrops(): void {
  drops.forEach((d, i) => {
    d.state = 'fly';
    d.delay = 0.6 + i * 0.03;
  });
}

function updateDrops(dt: number): void {
  const mag = CFG.hero.magnet;
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
        d.sp = Math.min(30, d.sp + dt * 40);
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
    d.m.rotation.set(Math.PI / 2 * (d.state === 'rest' ? 1 : 0.5), 0, G.time * 4 + i);
  }
}

// ───────────────────────────── Health bars ─────────────────────────────

const barBg = new THREE.SpriteMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthTest: false });
const barMats = new Map<number, THREE.SpriteMaterial>();
function barMat(c: number): THREE.SpriteMaterial {
  let m = barMats.get(c);
  if (!m) {
    m = new THREE.SpriteMaterial({ color: c, depthTest: false, transparent: true });
    barMats.set(c, m);
  }
  return m;
}

export class Bar {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Sprite;
  private readonly w: number;

  constructor(w: number, color: number, h = 0.13) {
    this.w = w;
    const bg = new THREE.Sprite(barBg);
    bg.center.set(0, 0.5);
    bg.scale.set(w + 0.08, h + 0.07, 1);
    bg.position.x = -w / 2 - 0.04;
    bg.renderOrder = 30;
    this.fill = new THREE.Sprite(barMat(color));
    this.fill.center.set(0, 0.5);
    this.fill.scale.set(w, h, 1);
    this.fill.position.x = -w / 2;
    this.fill.renderOrder = 31;
    this.group.add(bg, this.fill);
    this.group.visible = false;
    scene.add(this.group);
  }

  set(ratio: number, x: number, y: number, z: number, show = ratio < 0.999): void {
    this.group.visible = show && ratio > 0;
    if (!this.group.visible) return;
    this.group.position.set(x, y, z);
    this.fill.scale.x = Math.max(0.001, this.w * Math.min(1, ratio));
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    scene.remove(this.group);
  }
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
}
