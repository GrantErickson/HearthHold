import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { G, addCoins, type DamageKind, type ResType, type Target } from './state';
import {
  makeMesh, keepGeo, keepTop, marketGeo, wallGeo, wallRubbleGeo, towerGeo, towerTop, towerRubbleGeo,
  catBaseGeo, catArmGeo, itemGeo, Mat,
} from './models';
import { Bar, burst, fly, pop, text } from './fx';
import { Sfx } from './audio';
import { emit } from './events';
import { enemies, soldiers, Units, type Enemy } from './units';
import { Proj } from './projectiles';
import { hero, popItem, stackTop } from './hero';
import type { Slot } from './pads';
import { clamp, lerp } from './util';

// ───────────────────────────── Colliders ─────────────────────────────

export interface Collider {
  id: string;
  x: number;
  z: number;
  hw: number;
  hd: number;
}
export const colliders: Collider[] = [];

export function addCollider(id: string, x: number, z: number, hw: number, hd: number): void {
  removeCollider(id);
  colliders.push({ id, x, z, hw, hd });
}
export function removeCollider(id: string): void {
  const i = colliders.findIndex((c) => c.id === id);
  if (i >= 0) colliders.splice(i, 1);
}

/** Push a circle out of all building boxes. */
export function pushOut(e: { x: number; z: number }, r: number): void {
  for (const c of colliders) {
    const dx = e.x - c.x;
    const dz = e.z - c.z;
    const px = c.hw + r - Math.abs(dx);
    const pz = c.hd + r - Math.abs(dz);
    if (px > 0 && pz > 0) {
      if (px < pz) e.x += px * (dx >= 0 ? 1 : -1);
      else e.z += pz * (dz >= 0 ? 1 : -1);
    }
  }
}

/** Bend a movement direction around a building that is in the way. */
export function steer(x: number, z: number, dx: number, dz: number, r: number, ignoreId?: string): [number, number] {
  const ax = x + dx * 1.6;
  const az = z + dz * 1.6;
  for (const c of colliders) {
    if (c.id === ignoreId) continue;
    if (Math.abs(ax - c.x) < c.hw + r && Math.abs(az - c.z) < c.hd + r) {
      const lx = -dz;
      const lz = dx;
      const side = (c.x - x) * lx + (c.z - z) * lz > 0 ? -1 : 1;
      const nx = dx * 0.3 + lx * side;
      const nz = dz * 0.3 + lz * side;
      const L = Math.hypot(nx, nz) || 1;
      return [nx / L, nz / L];
    }
  }
  return [dx, dz];
}

// ───────────────────────────── Structures ─────────────────────────────

export type StructKind = 'wall' | 'tower' | 'keep' | 'catapult';

export class Structure implements Target {
  readonly isStruct = true;
  readonly r = 0;
  alive = true;
  hp: number;
  maxHp: number;
  cd = 0;
  mesh: THREE.Object3D | null = null;
  bar: Bar;
  slot: Slot | null = null;
  top = 4;
  arm: THREE.Group | null = null;
  armT = 1;
  flashT = 0;
  flashing = false;
  id: string;
  kind: StructKind;
  x: number;
  z: number;
  hw: number;
  hd: number;
  level: number;

  constructor(id: string, kind: StructKind, x: number, z: number, hw: number, hd: number, level: number, maxHp: number) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.hw = hw;
    this.hd = hd;
    this.level = level;
    this.hp = this.maxHp = maxHp;
    this.bar = new Bar(kind === 'wall' ? 3.2 : kind === 'keep' ? 3.4 : 1.8, 0x5fd35f, 0.16);
  }

  damage(amount: number, _kind: DamageKind): void {
    if (!this.alive) return;
    if (this.kind === 'keep' && G.god) return;
    this.hp -= amount;
    this.flashT = 0.12;
    if (this.kind === 'keep') G.shake = Math.min(0.5, G.shake + 0.1);
    if (this.hp <= 0) {
      this.hp = 0;
      destroyStructure(this);
    }
  }
}

export const S = {
  keep: null as unknown as Structure,
  walls: new Array<Structure | null>(CFG.map.segCount).fill(null),
  towers: [] as Structure[],
  catapult: null as Structure | null,
};

export const market = {
  level: 1,
  queue: [] as ResType[],
  timer: 0,
  pile: 0,
  x: -8,
  z: -1,
  drop: { x: -9.6, z: 2.6 },
  coin: { x: -6.4, z: 2.6 },
  sellT: 0,
  fxT: 0,
  pileMesh: null as THREE.InstancedMesh | null,
  shown: -1,
};

export const barracks = { level: 0, x: -9, z: 11, door: { x: -9, z: 8.3 }, trainT: 0 };

// ───────────────────────────── Wall helpers ─────────────────────────────

const M = CFG.map;
export const segIndex = (x: number): number => clamp(Math.floor((x - M.segStart) / M.segWidth), 0, M.segCount - 1);
export const segCenter = (i: number): number => M.segStart + M.segWidth * (i + 0.5);
export const segAlive = (i: number): boolean => !!S.walls[i]?.alive;

/** The living wall segment between two points, if the line crosses the wall. */
export function wallBetween(x1: number, z1: number, x2: number, z2: number): Structure | null {
  if (z1 < M.wallZ === z2 < M.wallZ) return null;
  const t = (M.wallZ - z1) / (z2 - z1);
  const cx = x1 + (x2 - x1) * t;
  const w = S.walls[segIndex(cx)];
  return w && w.alive ? w : null;
}

/** If a neighbouring wall segment is open and close by, return an x inside that gap. */
export function nearGap(x: number, maxDist: number): number | null {
  const i = segIndex(x);
  const minX = M.segStart + i * M.segWidth;
  const maxX = minX + M.segWidth;
  if (i > 0 && !segAlive(i - 1) && x - minX < maxDist) return minX - 1.4;
  if (i < M.segCount - 1 && !segAlive(i + 1) && maxX - x < maxDist) return maxX + 1.4;
  return null;
}

// ───────────────────────────── Building ─────────────────────────────

function setMesh(s: Structure, o: THREE.Object3D, animate = true): void {
  if (s.mesh) scene.remove(s.mesh);
  s.mesh = o;
  o.position.set(s.x, 0, s.z);
  scene.add(o);
  s.flashing = false;
  if (animate) pop(o);
}

function setObjFlash(o: THREE.Object3D, on: boolean): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh && (c.material === Mat.vc || c.material === Mat.flash)) c.material = on ? Mat.flash : Mat.vc;
  });
}

export function initBase(): void {
  const k = new Structure('keep', 'keep', 0, 13, 3.5, 3.5, 1, CFG.keep.hp[0]);
  k.top = keepTop(1);
  S.keep = k;
  setMesh(k, makeMesh(keepGeo(1)), false);
  addCollider('keep', 0, 13, 3.5, 3.5);

  const mk = makeMesh(marketGeo());
  mk.position.set(market.x, 0, market.z);
  scene.add(mk);
  addCollider('market', market.x, market.z, 2.3, 1.6);

  const im = new THREE.InstancedMesh(itemGeo('coin'), Mat.vc, 63);
  im.count = 0;
  im.castShadow = true;
  im.frustumCulled = false;
  scene.add(im);
  market.pileMesh = im;
}

export function buildWall(i: number, lv: number, slot: Slot): void {
  let w = S.walls[i];
  const hp = CFG.wall.hp[lv - 1];
  if (!w) {
    w = new Structure('wall' + i, 'wall', segCenter(i), M.wallZ, M.segWidth / 2, M.wallHalf, lv, hp);
    S.walls[i] = w;
  }
  w.slot = slot;
  slot.struct = w;
  w.level = lv;
  w.maxHp = w.hp = hp;
  w.alive = true;
  setMesh(w, makeMesh(wallGeo(lv)), !G.autotest);
  G.flags.firstWall = true;
}

export function buildTower(slot: Slot, x: number, z: number, lv: number): void {
  let t = slot.struct;
  if (!t) {
    t = new Structure(slot.id, 'tower', x, z, 1.2, 1.2, lv, CFG.tower.hp[lv - 1]);
    S.towers.push(t);
    slot.struct = t;
    t.slot = slot;
  }
  t.level = lv;
  t.maxHp = t.hp = CFG.tower.hp[lv - 1];
  t.alive = true;
  t.top = towerTop(lv);
  setMesh(t, makeMesh(towerGeo(lv)), !G.autotest);
  addCollider(t.id, x, z, 1.2, 1.2);
  G.flags.firstTower = true;
}

export function buildCatapult(slot: Slot, lv: number): void {
  const x = 0;
  const z = -8.6;
  let c = S.catapult;
  if (!c) {
    c = new Structure('catapult', 'catapult', x, z, 1.1, 1.4, lv, CFG.catapult.hp[lv - 1]);
    S.catapult = c;
    slot.struct = c;
    c.slot = slot;
  }
  c.level = lv;
  c.maxHp = c.hp = CFG.catapult.hp[lv - 1];
  c.alive = true;
  c.top = 2.4;
  const g = new THREE.Group();
  g.add(makeMesh(catBaseGeo(lv)));
  const arm = new THREE.Group();
  arm.position.set(0, 1.95, 0.2);
  arm.rotation.x = -0.35;
  arm.add(makeMesh(catArmGeo()));
  g.add(arm);
  c.arm = arm;
  setMesh(c, g, !G.autotest);
  addCollider('catapult', x, z, 1.1, 1.4);
}

export function setKeepLevel(lv: number): void {
  const k = S.keep;
  G.keepLevel = lv;
  k.level = lv;
  k.maxHp = k.hp = CFG.keep.hp[lv - 1];
  k.top = keepTop(lv);
  setMesh(k, makeMesh(keepGeo(lv)), !G.autotest);
}

export function setMarketLevel(lv: number): void {
  market.level = lv;
}

export function setBarracksLevel(lv: number): void {
  barracks.level = lv;
  for (const s of soldiers) s.refreshStats();
  Units.fillSoldiers();
}

/** Non-attackable building (market, smithy, camps). */
export function placeBuilding(id: string, geo: THREE.BufferGeometry, x: number, z: number, hw: number, hd: number): void {
  const m = makeMesh(geo);
  m.position.set(x, 0, z);
  scene.add(m);
  if (!G.autotest) pop(m);
  addCollider(id, x, z, hw, hd);
}

/** Put a structure into its destroyed state (rubble + rebuild pad), without effects. */
export function ruin(s: Structure): void {
  s.alive = false;
  s.hp = 0;
  s.bar.hide();
  const geo = s.kind === 'wall' ? wallRubbleGeo(s.level) : towerRubbleGeo();
  setMesh(s, makeMesh(geo, false), false);
  if (s.kind !== 'wall') removeCollider(s.id);
  if (s.slot) s.slot.destroyed = true;
}

function destroyStructure(s: Structure): void {
  burst(s.x, 1.5, s.z, 0x9a948a, 26, { speed: 6, up: 6, size: 0.3, life: 0.9 });
  burst(s.x, 1.5, s.z, 0x7a5232, 12, { speed: 5, up: 5, size: 0.22, life: 0.9 });
  Sfx.at('crumble', s.x, s.z, 1.2);
  if (s.kind === 'keep') {
    s.alive = false;
    emit('keepDestroyed');
    return;
  }
  ruin(s);
  const name = s.kind === 'wall' ? 'Wall' : s.kind === 'tower' ? 'Tower' : 'Catapult';
  text(s.x, 3.5, s.z, `${name} destroyed!`, 'red');
  emit('structureLost', s);
}

/** After a wave: everything still standing is fully repaired. */
export function repairAll(): void {
  for (const w of S.walls) if (w && w.alive) w.hp = w.maxHp;
  for (const t of S.towers) if (t.alive) t.hp = t.maxHp;
  if (S.catapult?.alive) S.catapult.hp = S.catapult.maxHp;
  S.keep.hp = S.keep.maxHp;
}

export function attackables(): Structure[] {
  const out: Structure[] = [];
  for (const t of S.towers) if (t.alive) out.push(t);
  if (S.catapult?.alive) out.push(S.catapult);
  return out;
}

// ───────────────────────────── Market ─────────────────────────────

/** Workers and the hero hand items to the market. */
export function deliver(items: ResType[], from: THREE.Vector3): void {
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    market.queue.push(t);
    if (i < 6) fly(t, from, () => new THREE.Vector3(market.x, 1.4, market.z + 1.0), { dur: 0.35 + i * 0.05, arc: 1 });
  }
}

const onPad = (p: { x: number; z: number }) => hero.alive && Math.abs(hero.x - p.x) < 1.4 && Math.abs(hero.z - p.z) < 1.4;

function updateMarket(dt: number): void {
  const m = market;
  const L = m.level - 1;
  if (m.queue.length) {
    m.timer += dt;
    const iv = CFG.market.interval[L] / (1 + m.queue.length / 15);
    while (m.timer >= iv && m.queue.length) {
      m.timer -= iv;
      const t = m.queue.shift()!;
      m.pile += Math.round(CFG.res[t].value * CFG.market.valueMul[L]);
    }
  } else m.timer = 0;

  if (onPad(m.drop) && hero.stack.length) {
    m.sellT -= dt;
    while (m.sellT <= 0 && hero.stack.length) {
      m.sellT += 0.06;
      const from = stackTop();
      const t = popItem();
      if (!t) break;
      m.queue.push(t);
      G.flags.firstSale = true;
      fly(t, from, () => new THREE.Vector3(m.x, 1.4, m.z + 1.0), { dur: 0.3, arc: 1 });
      Sfx.play('drop');
    }
  } else m.sellT = 0;

  if (onPad(m.coin) && m.pile > 0) {
    const amt = Math.min(m.pile, Math.max(1, Math.ceil(Math.max(40, m.pile * 2.5) * dt)));
    m.pile -= amt;
    addCoins(amt);
    G.flags.firstCollect = true;
    m.fxT -= dt;
    if (m.fxT <= 0) {
      m.fxT = 0.045;
      fly('coin', new THREE.Vector3(m.coin.x, 0.5, m.coin.z), () => new THREE.Vector3(hero.x, 1.3, hero.z), { dur: 0.25, arc: 0.8 });
      Sfx.play('coin', 0.8);
    }
  }
  updatePile();
}

const _pm = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _pp = new THREE.Vector3();
const _ps = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

function updatePile(): void {
  const im = market.pileMesh;
  if (!im) return;
  const n = Math.min(63, Math.ceil(market.pile / 2));
  if (n === market.shown) return;
  market.shown = n;
  for (let i = 0; i < n; i++) {
    const col = i % 9;
    const lvl = Math.floor(i / 9);
    _pp.set(market.coin.x + ((col % 3) - 1) * 0.55, 0.08 + lvl * 0.07, market.coin.z + (Math.floor(col / 3) - 1) * 0.55);
    _pq.setFromAxisAngle(_up, i * 1.7);
    _pm.compose(_pp, _pq, _ps);
    im.setMatrixAt(i, _pm);
  }
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
}

// ───────────────────────────── Combat ─────────────────────────────

function nearestEnemies(x: number, z: number, range: number, n: number, minRange = 0): Enemy[] {
  const list: { e: Enemy; d: number }[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d <= range && d >= minRange) list.push({ e, d });
  }
  list.sort((a, b) => a.d - b.d);
  return list.slice(0, n).map((o) => o.e);
}

function updateTowers(dt: number): void {
  for (const t of S.towers) {
    if (!t.alive) continue;
    t.cd -= dt;
    if (t.cd > 0) continue;
    const L = t.level - 1;
    const targets = nearestEnemies(t.x, t.z, CFG.tower.range[L], CFG.tower.shots[L]);
    if (!targets.length) {
      t.cd = 0.15;
      continue;
    }
    for (const e of targets) Proj.arrow(t.x, t.top, t.z, e, CFG.tower.dmg[L], false);
    t.cd = CFG.tower.interval[L];
    Sfx.at('arrow', t.x, t.z, 0.8);
  }
  const k = S.keep;
  if (k.alive && k.level >= 3) {
    k.cd -= dt;
    if (k.cd <= 0) {
      const targets = nearestEnemies(k.x, k.z, CFG.keep.range, CFG.keep.shots[k.level - 1]);
      if (targets.length) {
        for (const e of targets) Proj.arrow(k.x, k.top + 2, k.z, e, CFG.keep.dmg[k.level - 1], false);
        k.cd = CFG.keep.interval;
        Sfx.at('arrow', k.x, k.z, 0.7);
      } else k.cd = 0.2;
    }
  }
}

function updateCatapult(dt: number): void {
  const c = S.catapult;
  if (!c || !c.alive || !c.arm || !c.mesh) return;
  if (c.armT < 1) {
    c.armT = Math.min(1, c.armT + dt / 0.9);
    c.arm.rotation.x = c.armT < 0.2 ? lerp(-0.35, 1.9, c.armT / 0.2) : lerp(1.9, -0.35, (c.armT - 0.2) / 0.8);
  }
  c.cd -= dt;
  if (c.cd > 0) return;
  const L = c.level - 1;
  const R = CFG.catapult.range[L];
  let best: Enemy | null = null;
  let bestN = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - c.x, e.z - c.z);
    if (d > R || d < CFG.catapult.minRange) continue;
    let n = 0;
    for (const o of enemies) if (o.alive && (o.x - e.x) ** 2 + (o.z - e.z) ** 2 < 9) n++;
    if (n > bestN) {
      bestN = n;
      best = e;
    }
  }
  if (!best) {
    c.cd = 0.3;
    return;
  }
  const flight = Math.max(0.8, Math.hypot(best.x - c.x, best.z - c.z) / 14);
  const tx = best.x + best.vx * flight;
  const tz = best.z + best.vz * flight;
  c.mesh.rotation.y = Math.atan2(-(tx - c.x), -(tz - c.z));
  Proj.boulder(c.x, c.top, c.z, tx, tz, CFG.catapult.dmg[L], CFG.catapult.splash, flight);
  c.cd = CFG.catapult.interval[L];
  c.armT = 0;
  Sfx.at('swing', c.x, c.z);
}

function updateBarracks(dt: number): void {
  if (barracks.level <= 0) return;
  const cap = CFG.soldier.cap[barracks.level - 1];
  const alive = soldiers.filter((s) => s.alive).length;
  if (alive < cap) {
    barracks.trainT += dt;
    if (barracks.trainT >= CFG.soldier.train) {
      barracks.trainT = 0;
      Units.spawnSoldier();
    }
  } else barracks.trainT = 0;
}

function updateBars(dt: number): void {
  const all: Structure[] = [S.keep, ...S.towers];
  for (const w of S.walls) if (w) all.push(w);
  if (S.catapult) all.push(S.catapult);
  for (const s of all) {
    if (!s.alive) {
      s.bar.hide();
      continue;
    }
    const y = s.kind === 'wall' ? 3.8 : s.kind === 'keep' ? s.top + 4.5 : s.top + 1.4;
    s.bar.set(s.hp / s.maxHp, s.x, y, s.z);
    if (s.flashT > 0) s.flashT -= dt;
    const want = s.flashT > 0;
    if (want !== s.flashing && s.mesh) {
      s.flashing = want;
      setObjFlash(s.mesh, want);
    }
  }
}

export function updateStructures(dt: number): void {
  updateMarket(dt);
  updateTowers(dt);
  updateCatapult(dt);
  updateBarracks(dt);
  updateBars(dt);
}
