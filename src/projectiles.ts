import * as THREE from 'three';
import { scene } from './engine';
import { arrowGeo, boulderGeo, makeMesh } from './models';
import type { Target } from './state';
import { enemies } from './units';
import { burst } from './fx';
import { Sfx } from './audio';
import { aimPoint } from './util';

interface Arrow {
  m: THREE.Mesh;
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
}

interface Boulder {
  m: THREE.Mesh;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  tz: number;
  k: number;
  T: number;
  dmg: number;
  splash: number;
}

const arrows: Arrow[] = [];
const boulders: Boulder[] = [];
const pool = { a: [] as THREE.Mesh[], e: [] as THREE.Mesh[], b: [] as THREE.Mesh[] };
const _look = new THREE.Vector3();
const ARROW_SPEED = 24;

function take(kind: 'a' | 'e' | 'b'): THREE.Mesh {
  let m = pool[kind].pop();
  if (!m) {
    m = makeMesh(kind === 'b' ? boulderGeo() : arrowGeo(kind === 'e'), kind === 'b', false);
    scene.add(m);
  }
  m.visible = true;
  return m;
}

export const Proj = {
  arrow(x: number, y: number, z: number, t: Target, dmg: number, enemy: boolean): void {
    const m = take(enemy ? 'e' : 'a');
    m.position.set(x, y, z);
    const [tx, tz] = aimPoint(x, z, t);
    arrows.push({ m, enemy, x, y, z, t, dmg, life: 3, tx, ty: 1, tz });
  },

  boulder(x: number, y: number, z: number, tx: number, tz: number, dmg: number, splash: number, T: number): void {
    const m = take('b');
    m.position.set(x, y, z);
    boulders.push({ m, fx: x, fy: y, fz: z, tx, tz, k: 0, T, dmg, splash });
  },

  update(dt: number): void {
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.life -= dt;
      if (a.t.alive) {
        const [tx, tz] = aimPoint(a.x, a.z, a.t);
        a.tx = tx;
        a.tz = tz;
        a.ty = a.t.isStruct ? 1.4 : 1.1;
      }
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const dz = a.tz - a.z;
      const L = Math.hypot(dx, dy, dz);
      const step = ARROW_SPEED * dt;
      if (L <= step + 0.3 || a.life <= 0) {
        if (a.t.alive && L <= step + 0.3) a.t.damage(a.dmg, 'arrow');
        a.m.visible = false;
        pool[a.enemy ? 'e' : 'a'].push(a.m);
        arrows.splice(i, 1);
        continue;
      }
      a.x += (dx / L) * step;
      a.y += (dy / L) * step;
      a.z += (dz / L) * step;
      a.m.position.set(a.x, a.y, a.z);
      a.m.lookAt(_look.set(a.tx, a.ty, a.tz));
    }

    for (let i = boulders.length - 1; i >= 0; i--) {
      const b = boulders[i];
      b.k += dt / b.T;
      if (b.k >= 1) {
        for (const e of enemies) {
          if (e.alive && Math.hypot(e.x - b.tx, e.z - b.tz) < b.splash + e.r) e.damage(b.dmg, 'splash');
        }
        burst(b.tx, 0.4, b.tz, 0x9a8a7a, 18, { speed: 6, up: 5, size: 0.22, life: 0.7 });
        burst(b.tx, 0.4, b.tz, 0x6b5a4a, 10, { speed: 4, up: 3, size: 0.3, life: 0.6 });
        Sfx.at('boom', b.tx, b.tz, 0.8);
        b.m.visible = false;
        pool.b.push(b.m);
        boulders.splice(i, 1);
        continue;
      }
      const k = b.k;
      b.m.position.set(b.fx + (b.tx - b.fx) * k, b.fy + (0.3 - b.fy) * k + 9 * k * (1 - k), b.fz + (b.tz - b.fz) * k);
      b.m.rotation.x += dt * 8;
      b.m.rotation.z += dt * 5;
    }
  },
};
