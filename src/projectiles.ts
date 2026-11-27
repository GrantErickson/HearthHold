import * as THREE from 'three';
import { scene } from './engine';
import { arrowGeo, boulderGeo, iceBoulderGeo, boltGeo, orbGeo, meteorGeo, cannonballGeo, makeMesh } from './models';
import type { Target } from './state';
import { enemies, defenders, type Enemy } from './units';
import { allStructures } from './structures';
import { burst, flash, ring, puff, fire, boom, spark, dust, warnCircle, shakeAt, streaks, scorch, hitStop, kick } from './fx';
import { hero } from './hero';
import { Sfx } from './audio';
import { aimPoint } from './util';
import { G } from './state';

interface Homing {
  m: THREE.Mesh;
  pool: string;
  enemy: boolean;
  x: number;
  y: number;
  z: number;
  t: Target;
  dmg: number;
  life: number;
  tx: number;
  ty: number;
  tz: number;
  speed: number;
  magic: boolean;
  color: number;
  trailT: number;
  onHit?: (t: Target) => void;
}

interface Lob {
  m: THREE.Mesh;
  pool: string;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  k: number;
  T: number;
  dmg: number;
  splash: number;
  enemy: boolean;
  burn: number;
  kind: 'boulder' | 'fire' | 'ice' | 'cannon';
  trailT: number;
  arc: number;
}

interface Bolt {
  m: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  left: number;
  dmg: number;
  ty: number;
  hit: Set<Enemy>;
}

interface Meteor {
  m: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  dmg: number;
  splash: number;
  t: number;
  T: number;
}

const homing: Homing[] = [];
const lobs: Lob[] = [];
const bolts: Bolt[] = [];
const meteors: Meteor[] = [];
const pools = new Map<string, THREE.Mesh[]>();
const _look = new THREE.Vector3();
const ARROW_SPEED = 24;

function take(key: string, make: () => THREE.Mesh): THREE.Mesh {
  let list = pools.get(key);
  if (!list) {
    list = [];
    pools.set(key, list);
  }
  let m = list.pop();
  if (!m) {
    m = make();
    if (!G.autotest) scene.add(m);
  }
  m.visible = true;
  return m;
}
function give(key: string, m: THREE.Mesh): void {
  m.visible = false;
  pools.get(key)?.push(m);
}

export const Proj = {
  arrow(x: number, y: number, z: number, t: Target, dmg: number, enemy: boolean): void {
    const key = enemy ? 'e' : 'a';
    const m = take(key, () => makeMesh(arrowGeo(enemy), false, false));
    m.position.set(x, y, z);
    const [tx, tz] = aimPoint(x, z, t);
    homing.push({ m, pool: key, enemy, x, y, z, t, dmg, life: 3, tx, ty: 1, tz, speed: ARROW_SPEED, magic: false, color: 0, trailT: 0 });
  },

  /** Glowing magic bolt. Enemy bolts hit defenders; friendly ones hit enemies. */
  magic(x: number, y: number, z: number, t: Target, dmg: number, color: number, enemy: boolean, onHit?: (t: Target) => void): void {
    const key = 'm' + color;
    const m = take(key, () => makeMesh(orbGeo(color), false, false));
    m.position.set(x, y, z);
    const [tx, tz] = aimPoint(x, z, t);
    homing.push({ m, pool: key, enemy, x, y, z, t, dmg, life: 3, tx, ty: 1, tz, speed: 17, magic: true, color, trailT: 0, onHit });
  },

  /** Arcing boulder. `enemy` boulders smash structures; friendly ones crush raiders. */
  boulder(x: number, y: number, z: number, tx: number, tz: number, dmg: number, splash: number, T: number, enemy: boolean, ice: boolean): void {
    const key = ice ? 'bi' : 'b';
    const m = take(key, () => makeMesh(ice ? iceBoulderGeo() : boulderGeo(), true, false));
    m.position.set(x, y, z);
    m.scale.setScalar(enemy ? 1.3 : 1);
    // Incoming! Enemy boulders mark where they'll land.
    if (enemy) warnCircle(tx, tz, splash, T, undefined, ice ? 0x6ac8ff : 0xff4a2a);
    lobs.push({ m, pool: key, fx: x, fy: y, fz: z, tx, ty: 0.3, tz, k: 0, T, dmg, splash, enemy, burn: 0, kind: ice ? 'ice' : 'boulder', trailT: 0, arc: 9 });
  },

  fireball(x: number, y: number, z: number, tx: number, tz: number, ty: number, dmg: number, splash: number, burn: number, T: number): void {
    const m = take('f', () => makeMesh(orbGeo(0xff8a2a, 0.36), false, false));
    m.position.set(x, y, z);
    lobs.push({ m, pool: 'f', fx: x, fy: y, fz: z, tx, ty, tz, k: 0, T, dmg, splash, enemy: false, burn, kind: 'fire', trailT: 0, arc: 4 });
  },

  /** Cannonball: a fast, flat arc that explodes on impact. */
  cannonball(x: number, y: number, z: number, tx: number, tz: number, dmg: number, splash: number, T: number): void {
    const m = take('cb', () => makeMesh(cannonballGeo(), true, false));
    m.position.set(x, y, z);
    lobs.push({ m, pool: 'cb', fx: x, fy: y, fz: z, tx, ty: 0.3, tz, k: 0, T, dmg, splash, enemy: false, burn: 0, kind: 'cannon', trailT: 0, arc: 5 });
  },

  /** Ballista bolt: flies straight and pierces everything in its path. */
  bolt(x: number, y: number, z: number, dx: number, dz: number, range: number, dmg: number, ty: number): void {
    const m = take('bolt', () => makeMesh(boltGeo(), false, false));
    m.position.set(x, y, z);
    bolts.push({ m, x, y, z, dx, dz, left: range, dmg, ty, hit: new Set() });
  },

  meteor(tx: number, tz: number, dmg: number, splash: number): void {
    const m = take('met', () => makeMesh(meteorGeo(), true, false));
    m.position.set(tx - 8, 30, tz - 14);
    meteors.push({ m, x: tx - 8, y: 30, z: tz - 14, tx, tz, dmg, splash, t: 0, T: 0.9 });
  },

  clear(): void {
    for (const h of homing) give(h.pool, h.m);
    for (const l of lobs) give(l.pool, l.m);
    for (const b of bolts) give('bolt', b.m);
    for (const m of meteors) give('met', m.m);
    homing.length = lobs.length = bolts.length = meteors.length = 0;
  },

  update(dt: number): void {
    for (let i = homing.length - 1; i >= 0; i--) {
      const a = homing[i];
      a.life -= dt;
      if (a.t.alive) {
        const [tx, tz] = aimPoint(a.x, a.z, a.t);
        a.tx = tx;
        a.tz = tz;
        a.ty = a.t.isStruct ? 1.4 : (a.t.aimY ?? 1.1);
      }
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const dz = a.tz - a.z;
      const L = Math.hypot(dx, dy, dz);
      const step = a.speed * dt;
      if (L <= step + 0.3 || a.life <= 0) {
        if (a.t.alive && L <= step + 0.3) {
          a.t.damage(a.dmg, a.magic ? 'magic' : 'arrow');
          a.onHit?.(a.t);
          if (a.magic) {
            spark(a.tx, a.ty, a.tz, a.color, 1.1, 0.3);
            flash(a.tx, a.ty, a.tz, a.color, 0.9, 0.16);
            burst(a.tx, a.ty, a.tz, a.color, 6, { glow: true, speed: 3.5, up: 1.5, life: 0.35 });
          }
        }
        give(a.pool, a.m);
        homing.splice(i, 1);
        continue;
      }
      a.x += (dx / L) * step;
      a.y += (dy / L) * step;
      a.z += (dz / L) * step;
      a.m.position.set(a.x, a.y, a.z);
      if (a.magic) {
        a.trailT -= dt;
        if (a.trailT <= 0) {
          a.trailT = 0.035;
          burst(a.x, a.y, a.z, a.color, 1, { glow: true, speed: 0.3, up: 0.2, life: 0.3, size: 0.12, grav: 0 });
        }
      } else {
        a.m.lookAt(_look.set(a.tx, a.ty, a.tz));
        a.trailT -= dt;
        if (a.trailT <= 0 && !a.enemy) {
          a.trailT = 0.05;
          burst(a.x, a.y, a.z, 0xfff4d8, 1, { glow: true, speed: 0.1, up: 0, life: 0.18, size: 0.05, grav: 0 });
        }
      }
    }

    for (let i = lobs.length - 1; i >= 0; i--) {
      const b = lobs[i];
      b.k += dt / b.T;
      if (b.k >= 1) {
        impact(b);
        give(b.pool, b.m);
        lobs.splice(i, 1);
        continue;
      }
      const k = b.k;
      b.m.position.set(b.fx + (b.tx - b.fx) * k, b.fy + (b.ty - b.fy) * k + b.arc * k * (1 - k), b.fz + (b.tz - b.fz) * k);
      b.m.rotation.x += dt * 8;
      b.m.rotation.z += dt * 5;
      b.trailT -= dt;
      if (b.trailT <= 0) {
        const p = b.m.position;
        if (b.kind === 'fire') {
          b.trailT = 0.035;
          fire(p.x, p.y, p.z, { n: 1, spread: 0.1, size: 0.3, life: 0.35, up: 0.4, out: 0.2 });
        } else if (b.kind === 'cannon') {
          b.trailT = 0.04;
          puff(p.x, p.y, p.z, 0xe8e4dc, { n: 1, spread: 0.05, size: 0.22, life: 0.5, up: 0.3, out: 0.1, grow: 0.6 });
        } else if (b.kind === 'ice') {
          b.trailT = 0.04;
          burst(p.x, p.y, p.z, 0xbff4ff, 1, { glow: true, speed: 0.4, up: 0.4, life: 0.4, size: 0.18, grav: 0 });
        } else {
          b.trailT = 0.12;
          puff(p.x, p.y, p.z, 0xd8ccb8, { n: 1, spread: 0.05, size: 0.13, life: 0.3, up: 0.2, out: 0.1, grow: 0.2 });
        }
      }
    }

    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const step = 40 * dt;
      b.left -= step;
      b.x += b.dx * step;
      b.z += b.dz * step;
      b.y += (b.ty - b.y) * Math.min(1, dt * 6);
      b.m.position.set(b.x, b.y, b.z);
      b.m.lookAt(_look.set(b.x + b.dx, b.y, b.z + b.dz));
      for (const e of enemies) {
        if (!e.alive || b.hit.has(e)) continue;
        if (Math.hypot(e.x - b.x, e.z - b.z) < e.r + 0.55) {
          b.hit.add(e);
          e.damage(b.dmg, 'pierce');
          spark(e.x, e.aimY, e.z, 0xfff0c0, 1.0, 0.25);
        }
      }
      if (b.left <= 0) {
        give('bolt', b.m);
        bolts.splice(i, 1);
      }
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.t += dt / m.T;
      const k = Math.min(1, m.t);
      m.m.position.set(m.x + (m.tx - m.x) * k, m.y + (0.5 - m.y) * k, m.z + (m.tz - m.z) * k);
      m.m.rotation.x += dt * 6;
      const mp = m.m.position;
      fire(mp.x, mp.y, mp.z, { n: 2, spread: 0.4, size: 0.55, life: 0.4, up: 0.5, out: 0.4 });
      if (Math.random() < 0.35) puff(mp.x, mp.y + 0.3, mp.z, 0x6a605a, { n: 1, spread: 0.3, size: 0.42, life: 0.6, up: 0.6, out: 0.2, grow: 0.5 });
      if (m.t >= 1) {
        for (const e of enemies) {
          if (e.alive && Math.hypot(e.x - m.tx, e.z - m.tz) < m.splash + e.r) {
            e.damage(m.dmg, 'fire', hero);
            e.burn(m.dmg * 0.05, 3);
            e.knock(m.tx, m.tz, 10);
          }
        }
        boom(m.tx, 0.3, m.tz, m.splash * 1.1, { chunks: 22, big: true });
        ring(m.tx, m.tz, 0xffd27a, m.splash * 1.9, 0.7);
        ring(m.tx, m.tz, 0xffffff, m.splash * 1.2, 0.3, 0.1);
        scorch(m.tx, m.tz, m.splash * 2.8, 0.75, 14);
        shakeAt(m.tx, m.tz, 0.6, 0.95);
        hitStop(0.1);
        Sfx.at('bigexplode', m.tx, m.tz, 1.2);
        give('met', m.m);
        meteors.splice(i, 1);
      }
    }
  },
};

function impact(b: Lob): void {
  if (b.enemy) {
    for (const s of allStructures()) {
      if (!s.alive) continue;
      const [ax, az] = aimPoint(b.tx, b.tz, s);
      if (Math.hypot(ax - b.tx, az - b.tz) < b.splash) s.damage(b.dmg, 'splash');
    }
    for (const u of defenders()) if (u.alive && Math.hypot(u.x - b.tx, u.z - b.tz) < b.splash + u.r) u.damage(b.dmg * 0.5, 'splash');
  } else {
    const power = b.kind === 'cannon' ? 6 : b.kind === 'fire' ? 2.5 : 5;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (b.kind !== 'fire' && e.flying) continue;
      const dy = b.kind === 'fire' && e.flying ? Math.abs(e.aimY - b.ty) : 0;
      if (Math.hypot(e.x - b.tx, e.z - b.tz) < b.splash + e.r && dy < 2) {
        e.damage(b.dmg, b.kind === 'fire' ? 'fire' : 'splash');
        if (b.burn > 0) e.burn(b.burn, 3);
        e.knock(b.tx, b.tz, power);
      }
    }
  }
  if (b.kind === 'cannon') {
    boom(b.tx, 0.3, b.tz, b.splash * 0.85);
    shakeAt(b.tx, b.tz, 0.12, 0.5);
    Sfx.at('explode', b.tx, b.tz, 0.7);
  } else if (b.kind === 'fire') {
    fire(b.tx, b.ty + 0.2, b.tz, { n: 7, spread: b.splash * 0.4, size: 0.4, life: 0.5, up: 2, out: 2 });
    puff(b.tx, b.ty + 0.5, b.tz, 0x4a4038, { n: 3, spread: b.splash * 0.4, size: 0.4, life: 0.8, up: 1.2, delay: 0.1 });
    ring(b.tx, b.tz, 0xff7a2a, b.splash, 0.4);
    Sfx.at('fire', b.tx, b.tz, 0.6);
  } else {
    const ice = b.kind === 'ice';
    dust(b.tx, b.tz, 1.2 + b.splash * 0.3, ice ? 0xd8f0fa : 0xc8b898);
    burst(b.tx, 0.4, b.tz, ice ? 0xbfe8f8 : 0x8a7a6a, 14, { speed: 6, up: 6, size: 0.22, life: 0.8, trail: b.enemy ? 0.07 : 0 });
    streaks(b.tx, 0.6, b.tz, ice ? 0xdff8ff : 0xfff0d0, 6, { speed: 8, up: 5, life: 0.3, size: 0.5 });
    spark(b.tx, 0.8, b.tz, ice ? 0xbff4ff : 0xfff0c0, 1.2, 0.28);
    scorch(b.tx, b.tz, b.splash * 1.6, ice ? 0.25 : 0.4, 7);
    if (b.enemy) {
      ring(b.tx, b.tz, ice ? 0x9fe8ff : 0xd8b080, b.splash * 1.3, 0.4);
      shakeAt(b.tx, b.tz, 0.18, 0.6);
      if (Math.hypot(hero.x - b.tx, hero.z - b.tz) < b.splash + 1) kick(0.3);
    }
    Sfx.at('boom', b.tx, b.tz, 0.9);
  }
}
