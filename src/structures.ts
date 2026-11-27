import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { G, addCoins, type DamageKind, type ResType, type Target } from './state';
import {
  makeMesh, keepGeo, keepTop, marketGeo, wallGeo, wallRubbleGeo, towerGeo, towerTop, towerRubbleGeo,
  catBaseGeo, catArmGeo, itemGeo, Mat, frostTowerGeo, frostOrbGeo, mageTowerGeo, mageOrbGeo, ballistaBaseGeo,
  ballistaHeadGeo, fireTowerGeo, flameGeo, spireGeo, spireOrbGeo, spireTop, spikesGeo, spikeBedGeo, tarGeo,
  cannonBaseGeo, cannonGunGeo, aerieGeo, aerieTop, roostGeo, ROOST_PERCH,
} from './models';
import { Bar, burst, fly, pop, text, lightning, beam, ring, fire, puff, spark, shakeAt, scorch } from './fx';
import { Sfx } from './audio';
import { emit, on } from './events';
import { enemies, soldiers, rangers, Units, applySlow, defenders, type Enemy } from './units';
import { Proj } from './projectiles';
import { hero, popItem, stackTop, maxHp as heroMaxHp } from './hero';
import { Stat } from './progress';
import type { Slot } from './pads';
import { clamp, lerp, aimPoint } from './util';

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

export type SpecialKind = 'frost' | 'mage' | 'ballista' | 'fire' | 'spire' | 'cannon' | 'aerie' | 'roost';
export type StructKind = 'wall' | 'tower' | 'keep' | 'catapult' | SpecialKind;

const NAMES: Record<StructKind, string> = {
  wall: 'Wall', tower: 'Tower', keep: 'Keep', catapult: 'Catapult', frost: 'Frost Tower', mage: 'Mage Tower',
  ballista: 'Ballista', fire: 'Fire Tower', spire: 'Holy Spire', cannon: 'Cannon Battery', aerie: 'Griffin Aerie', roost: 'Dragon Roost',
};

export class Structure implements Target {
  readonly isStruct = true;
  readonly r = 0;
  alive = true;
  hp: number;
  maxHp: number;
  baseHp: number;
  cd = 0;
  mesh: THREE.Object3D | null = null;
  bar: Bar;
  slot: Slot | null = null;
  top = 4;
  arm: THREE.Group | null = null;
  armT = 1;
  /** Spinning orb, ballista head or flame. */
  spin: THREE.Object3D | null = null;
  spinY = 0;
  flashT = 0;
  frozenT = 0;
  matState: THREE.Material | null = null;
  id: string;
  kind: StructKind;
  x: number;
  z: number;
  hw: number;
  hd: number;
  level: number;

  constructor(id: string, kind: StructKind, x: number, z: number, hw: number, hd: number, level: number, baseHp: number) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.hw = hw;
    this.hd = hd;
    this.level = level;
    this.baseHp = baseHp;
    this.hp = this.maxHp = Math.round(baseHp * this.hpMul());
    this.bar = new Bar(kind === 'wall' ? 3.2 : kind === 'keep' ? 3.4 : 1.8, 0x5fd35f, 0.16);
  }

  hpMul(): number {
    return this.kind === 'wall' ? Stat.wallHp() : Stat.structHp();
  }

  setBase(baseHp: number): void {
    this.baseHp = baseHp;
    this.hp = this.maxHp = Math.round(baseHp * this.hpMul());
  }

  /** Re-apply HP multipliers, keeping the current health ratio. */
  refreshHp(): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = Math.round(this.baseHp * this.hpMul());
    if (this.alive) this.hp = this.maxHp * ratio;
  }

  get name(): string {
    return NAMES[this.kind];
  }

  freeze(dur: number): void {
    if (!this.alive || this.kind === 'keep' || this.kind === 'wall') return;
    this.frozenT = Math.max(this.frozenT, dur);
  }

  damage(amount: number, _kind: DamageKind): void {
    if (!this.alive) return;
    if (this.kind === 'keep' && G.god) return;
    this.hp -= amount;
    if (this.flashT <= 0.1) this.flashT = 0.3;
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
  special: [] as Structure[],
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
export const range = { level: 0, x: 9, z: 11, door: { x: 9, z: 8.3 }, trainT: 0 };

// ───────────────────────────── Traps ─────────────────────────────

export type TrapKind = 'spikes' | 'tar';
interface Trap {
  id: string;
  kind: TrapKind;
  x: number;
  z: number;
  level: number;
  group: THREE.Group;
  spikes: THREE.Mesh | null;
  cd: number;
  thrust: number;
}
export const traps: Trap[] = [];

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
  s.spin = null;
  s.arm = null;
  o.position.set(s.x, 0, s.z);
  scene.add(o);
  s.matState = null;
  if (animate) pop(o);
}

function setStructMat(s: Structure, mat: THREE.Material | null): void {
  if (s.matState === mat || !s.mesh) return;
  s.matState = mat;
  const use = mat ?? Mat.vc;
  s.mesh.traverse((c) => {
    if (c instanceof THREE.Mesh && c.userData.swap !== false) c.material = use;
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

  on('statsChanged', refreshAllHp);
}

function refreshAllHp(): void {
  for (const s of allStructures()) s.refreshHp();
  Units.refreshDefenders();
  if (hero.alive) hero.hp = Math.min(hero.hp, heroMaxHp());
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
  w.setBase(hp);
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
  t.setBase(CFG.tower.hp[lv - 1]);
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
  c.setBase(CFG.catapult.hp[lv - 1]);
  c.alive = true;
  c.top = 2.4;
  const g = new THREE.Group();
  g.add(makeMesh(catBaseGeo(lv)));
  const arm = new THREE.Group();
  arm.position.set(0, 1.95, 0.2);
  arm.rotation.x = -0.35;
  arm.add(makeMesh(catArmGeo()));
  g.add(arm);
  setMesh(c, g, !G.autotest);
  c.arm = arm;
  addCollider('catapult', x, z, 1.1, 1.4);
}

const SPECIAL_HP: Record<SpecialKind, number[]> = {
  frost: CFG.frost.hp, mage: CFG.mage.hp, ballista: CFG.ballista.hp, fire: CFG.fire.hp, spire: CFG.spire.hp,
  cannon: CFG.cannon.hp, aerie: CFG.aerie.hp, roost: CFG.roost.hp,
};
/** Footprint half-size per special kind. */
const SPECIAL_SIZE: Partial<Record<SpecialKind, number>> = { cannon: 1.75, aerie: 1.9, roost: 2.3 };

export function buildSpecial(slot: Slot, kind: SpecialKind, x: number, z: number, lv: number): void {
  let t = slot.struct;
  const hp = SPECIAL_HP[kind][lv - 1];
  const size = SPECIAL_SIZE[kind] ?? 1.25;
  if (!t) {
    t = new Structure(slot.id, kind, x, z, size, size, lv, hp);
    S.special.push(t);
    slot.struct = t;
    t.slot = slot;
  }
  t.level = lv;
  t.setBase(hp);
  t.alive = true;
  const g = new THREE.Group();
  let spin: THREE.Object3D | null = null;
  switch (kind) {
    case 'frost': {
      const h = 3.2 + lv * 0.5;
      g.add(makeMesh(frostTowerGeo(lv)));
      spin = makeMesh(frostOrbGeo(), true, false);
      t.spinY = h + 1.3;
      t.top = h + 1.3;
      break;
    }
    case 'mage': {
      const h = 4 + lv * 0.5;
      g.add(makeMesh(mageTowerGeo(lv)));
      spin = makeMesh(mageOrbGeo(), true, false);
      t.spinY = h + 4.5;
      t.top = h + 4.5;
      break;
    }
    case 'ballista': {
      g.add(makeMesh(ballistaBaseGeo(lv)));
      spin = makeMesh(ballistaHeadGeo(lv));
      t.spinY = 1.65;
      t.top = 2.3;
      break;
    }
    case 'fire': {
      const h = 3 + lv * 0.4;
      g.add(makeMesh(fireTowerGeo(lv)));
      spin = makeMesh(flameGeo(), false, false);
      spin.scale.setScalar(0.8 + lv * 0.1);
      t.spinY = h + 0.6;
      t.top = h + 1.4;
      break;
    }
    case 'spire': {
      g.add(makeMesh(spireGeo(lv)));
      spin = makeMesh(spireOrbGeo(), true, false);
      t.spinY = spireTop(lv) + 0.3;
      t.top = spireTop(lv) + 0.3;
      break;
    }
    case 'cannon': {
      g.add(makeMesh(cannonBaseGeo(lv)));
      spin = makeMesh(cannonGunGeo(lv));
      spin.rotation.y = Math.PI;
      t.spinY = 1.3;
      t.top = 2.0;
      break;
    }
    case 'aerie': {
      g.add(makeMesh(aerieGeo(lv)));
      t.top = aerieTop(lv);
      break;
    }
    case 'roost': {
      g.add(makeMesh(roostGeo(lv)));
      t.top = ROOST_PERCH + 1.2;
      break;
    }
  }
  setMesh(t, g, !G.autotest);
  if (spin) {
    spin.position.y = t.spinY;
    if (kind !== 'ballista' && kind !== 'cannon') spin.userData.swap = false;
    g.add(spin);
    t.spin = spin;
  }
  addCollider(t.id, x, z, size, size);
}

export function buildTrap(slot: Slot, kind: TrapKind, x: number, z: number, lv: number): void {
  let tr = traps.find((t) => t.id === slot.id);
  if (!tr) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    scene.add(group);
    tr = { id: slot.id, kind, x, z, level: lv, group, spikes: null, cd: 0, thrust: 0 };
    traps.push(tr);
  }
  tr.level = lv;
  tr.group.clear();
  if (kind === 'spikes') {
    tr.group.add(makeMesh(spikeBedGeo(lv), false, true));
    tr.spikes = makeMesh(spikesGeo(lv), true, false);
    tr.spikes.scale.y = 0.4;
    tr.group.add(tr.spikes);
  } else {
    tr.group.add(makeMesh(tarGeo(lv), false, true));
  }
  if (!G.autotest) pop(tr.group);
}

export function setKeepLevel(lv: number): void {
  const k = S.keep;
  G.keepLevel = lv;
  k.level = lv;
  k.setBase(CFG.keep.hp[lv - 1]);
  k.top = keepTop(lv);
  setMesh(k, makeMesh(keepGeo(lv)), !G.autotest);
}

export function setMarketLevel(lv: number): void {
  market.level = lv;
}

export function setBarracksLevel(lv: number): void {
  barracks.level = lv;
  Units.refreshDefenders();
  Units.fillSoldiers();
}

export function setRangeLevel(lv: number): void {
  range.level = lv;
  Units.refreshDefenders();
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
  s.frozenT = 0;
  s.bar.hide();
  const geo = s.kind === 'wall' ? wallRubbleGeo(s.level) : towerRubbleGeo();
  setMesh(s, makeMesh(geo, false), false);
  if (s.kind !== 'wall') removeCollider(s.id);
  if (s.slot) s.slot.destroyed = true;
}

function destroyStructure(s: Structure): void {
  burst(s.x, 1.5, s.z, 0x9a948a, 22, { speed: 6, up: 6, size: 0.3, life: 0.9 });
  burst(s.x, 1.5, s.z, 0x7a5232, 10, { speed: 5, up: 5, size: 0.22, life: 0.9 });
  // A big cartoon dust cloud as it collapses.
  const span = s.kind === 'wall' ? 4.2 : Math.max(1.2, s.hw);
  for (let i = 0; i < (s.kind === 'wall' ? 4 : 1); i++) {
    const px = s.kind === 'wall' ? s.x - span + (i + 0.5) * (span * 2) / 4 : s.x;
    puff(px, 0.6, s.z, 0xd8ccb8, { n: 6, spread: s.kind === 'wall' ? 1.1 : span * 0.7, size: 0.6, life: 1.1, up: 1.6, out: 2.2, grow: 0.7 });
  }
  for (let i = 0; i < 3; i++) spark(s.x + (Math.random() - 0.5) * span * 2, 1.5 + Math.random() * 2, s.z + (Math.random() - 0.5) * 2, 0xfff0c0, 1.1, 0.3);
  shakeAt(s.x, s.z, 0.3, 0.75);
  Sfx.at('crumble', s.x, s.z, 1.2);
  scorch(s.x, s.z, s.kind === 'wall' ? 7 : Math.max(3, s.hw * 3), 0.35, 12);
  if (s.kind === 'wall' && G.phase === 'wave') emit('threat', { kind: 'breach', x: s.x, z: s.z });
  if (s.kind === 'keep') {
    s.alive = false;
    emit('keepDestroyed');
    return;
  }
  ruin(s);
  text(s.x, 3.5, s.z, `${s.name} destroyed!`, 'red');
  emit('structureLost', s);
}

/** After a wave: everything still standing is fully repaired. */
export function repairAll(): void {
  for (const s of allStructures()) {
    if (s.alive) {
      s.hp = s.maxHp;
      s.frozenT = 0;
    }
  }
}

/** Bastion ability: patch everything up by a fraction of max HP. */
export function repairFrac(frac: number): void {
  for (const s of allStructures()) {
    if (!s.alive) continue;
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * frac);
    s.frozenT = 0;
    if (s.kind !== 'wall') burst(s.x, 2, s.z, 0x7dff8a, 6, { glow: true, speed: 2, up: 3 });
  }
  for (const w of S.walls) if (w?.alive) burst(w.x, 2, w.z, 0x7dff8a, 10, { glow: true, speed: 3, up: 3, spread: 8 });
}

/** Things enemies go after on their way to the keep (not walls). */
export function attackables(): Structure[] {
  const out: Structure[] = [];
  for (const t of S.towers) if (t.alive) out.push(t);
  for (const t of S.special) if (t.alive) out.push(t);
  if (S.catapult?.alive) out.push(S.catapult);
  return out;
}

export function allStructures(): Structure[] {
  const all: Structure[] = [S.keep, ...S.towers, ...S.special];
  for (const w of S.walls) if (w) all.push(w);
  if (S.catapult) all.push(S.catapult);
  return all;
}

/** Nearest living structure (optionally including walls and the keep). */
export function nearestStructure(x: number, z: number, maxDist: number, withWalls: boolean): Structure | null {
  let best: Structure | null = null;
  let bd = maxDist;
  const list = withWalls ? allStructures() : attackables();
  for (const s of list) {
    if (!s.alive) continue;
    const [ax, az] = aimPoint(x, z, s);
    const d = Math.hypot(ax - x, az - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Freeze towers near a point. Returns how many were frozen. */
export function freezeAround(x: number, z: number, radius: number, dur: number): number {
  let n = 0;
  for (const s of attackables()) {
    if (Math.hypot(s.x - x, s.z - z) < radius) {
      s.freeze(dur);
      burst(s.x, s.top, s.z, 0xbff4ff, 8, { glow: true, speed: 2, up: 2 });
      n++;
    }
  }
  return n;
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
    const mul = CFG.market.valueMul[L] * Stat.sellMul();
    while (m.timer >= iv && m.queue.length) {
      m.timer -= iv;
      const t = m.queue.shift()!;
      m.pile += Math.round(CFG.res[t].value * mul);
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

const _near: { e: Enemy; d: number }[] = [];
function nearestEnemies(x: number, z: number, range: number, n: number, minRange = 0, ground = false): Enemy[] {
  _near.length = 0;
  for (const e of enemies) {
    if (!e.alive || (ground && e.flying)) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d <= range && d >= minRange) _near.push({ e, d });
  }
  _near.sort((a, b) => a.d - b.d);
  return _near.slice(0, n).map((o) => o.e);
}

/** Enemy with the most HP in range (bosses first). */
function toughestEnemy(x: number, z: number, range: number): Enemy | null {
  let best: Enemy | null = null;
  let bs = -1;
  for (const e of enemies) {
    if (!e.alive || Math.hypot(e.x - x, e.z - z) > range) continue;
    const s = e.hp + (e.isBoss ? 1e7 : 0);
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/** Centre of the densest group of ground enemies in range. */
function densest(x: number, z: number, range: number, minRange: number, r2: number): Enemy | null {
  let best: Enemy | null = null;
  let bestN = 0;
  for (const e of enemies) {
    if (!e.alive || e.flying) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > range || d < minRange) continue;
    let n = 0;
    for (const o of enemies) if (o.alive && !o.flying && (o.x - e.x) ** 2 + (o.z - e.z) ** 2 < r2) n++;
    if (n > bestN) {
      bestN = n;
      best = e;
    }
  }
  return best;
}

/**
 * Counter-battery targeting: siege engines and boulder-throwers first, then
 * archers and casters, then bosses — preferring whatever lurks beyond the
 * reach of the archer towers.
 */
function counterTarget(x: number, z: number, range: number, minRange: number): Enemy | null {
  let best: Enemy | null = null;
  let bs = -Infinity;
  for (const e of enemies) {
    if (!e.alive || e.flying) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > range || d < minRange) continue;
    const dd = e.d;
    let sc = 0;
    if (dd.siege || dd.lob) sc += 1000;
    else if (dd.ranged) sc += 400;
    if (e.isBoss || e.champion) sc += 250;
    sc += Math.max(0, CFG.map.wallZ - 4 - e.z) * 6;
    sc += Math.min(200, e.hp / 60);
    if (sc > bs) {
      bs = sc;
      best = e;
    }
  }
  return best;
}

function updateTowers(dt: number): void {
  const haste = Stat.haste();
  const tdmg = Stat.towerDmg();
  for (const t of S.towers) {
    if (!t.alive || t.frozenT > 0) continue;
    t.cd -= dt * haste;
    if (t.cd > 0) continue;
    const L = t.level - 1;
    const targets = nearestEnemies(t.x, t.z, CFG.tower.range[L], CFG.tower.shots[L] + Stat.extraArrows());
    if (!targets.length) {
      t.cd = 0.15;
      continue;
    }
    for (const e of targets) Proj.arrow(t.x, t.top, t.z, e, CFG.tower.dmg[L] * tdmg, false);
    t.cd = CFG.tower.interval[L];
    Sfx.at('arrow', t.x, t.z, 0.8);
  }
  const k = S.keep;
  if (k.alive && k.level >= 3) {
    k.cd -= dt * haste;
    if (k.cd <= 0) {
      const L = k.level - 1;
      const targets = nearestEnemies(k.x, k.z, CFG.keep.range[L], CFG.keep.shots[L]);
      if (targets.length) {
        for (const e of targets) Proj.arrow(k.x, k.top + 2, k.z, e, CFG.keep.dmg[L] * Stat.keepDmg(), false);
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
  if (c.frozenT > 0) return;
  c.cd -= dt * Stat.haste();
  if (c.cd > 0) return;
  const L = c.level - 1;
  const best = densest(c.x, c.z, CFG.catapult.range[L], CFG.catapult.minRange, 9);
  if (!best) {
    c.cd = 0.3;
    return;
  }
  const flight = Math.max(0.8, Math.hypot(best.x - c.x, best.z - c.z) / 14);
  const tx = best.x + best.vx * flight;
  const tz = best.z + best.vz * flight;
  c.mesh.rotation.y = Math.atan2(-(tx - c.x), -(tz - c.z));
  Proj.boulder(c.x, c.top, c.z, tx, tz, CFG.catapult.dmg[L] * Stat.siegeDmg(), CFG.catapult.splash[L], flight, false, false);
  c.cd = CFG.catapult.interval[L];
  c.armT = 0;
  Sfx.at('swing', c.x, c.z);
}

function updateSpecial(t: Structure, dt: number): void {
  const L = t.level - 1;
  const haste = Stat.haste();
  const mdmg = Stat.magicDmg();
  if (t.spin) {
    if (t.kind === 'ballista') {
      // rotated toward the target when firing
    } else if (t.kind === 'cannon') {
      // Recoil: the gun kicks back along its barrel and rolls forward again.
      if (t.armT < 1) {
        t.armT = Math.min(1, t.armT + dt / 0.6);
        const k = t.armT < 0.12 ? t.armT / 0.12 : 1 - (t.armT - 0.12) / 0.88;
        const a = t.spin.rotation.y;
        t.spin.position.set(-Math.sin(a) * k * 0.45, t.spinY, -Math.cos(a) * k * 0.45);
      }
    } else if (t.kind === 'fire') {
      const s = (0.8 + t.level * 0.1) * (1 + Math.sin(G.time * 14 + t.x) * 0.08);
      t.spin.scale.set(s, s * (1 + Math.sin(G.time * 9) * 0.1), s);
    } else {
      t.spin.rotation.y += dt * (t.frozenT > 0 ? 0.2 : 1.6);
      t.spin.position.y = t.spinY + Math.sin(G.time * 2 + t.x) * 0.15;
    }
  }
  if (t.frozenT > 0) return;
  t.cd -= dt * haste;
  switch (t.kind) {
    case 'aerie':
    case 'roost':
      // Their griffins and dragon fly on their own (see allies.ts).
      return;
    case 'cannon': {
      if (t.cd > 0) return;
      const C = CFG.cannon;
      const e = counterTarget(t.x, t.z, C.range[L], C.minRange);
      if (!e) {
        t.cd = 0.25;
        return;
      }
      t.cd = C.interval[L];
      const dist = Math.hypot(e.x - t.x, e.z - t.z);
      const flight = Math.max(0.55, dist / 26);
      const tx = e.x + e.vx * flight;
      const tz = e.z + e.vz * flight;
      const ang = Math.atan2(tx - t.x, tz - t.z);
      if (t.spin) t.spin.rotation.y = ang;
      t.armT = 0;
      const mx = t.x + Math.sin(ang) * 1.6;
      const mz = t.z + Math.cos(ang) * 1.6;
      const my = t.spinY + 0.75;
      fire(mx, my, mz, { n: 4, spread: 0.15, size: 0.32, life: 0.28, up: 0.6, out: 2.2 });
      puff(mx, my, mz, 0xece6dc, { n: 5, spread: 0.3, size: 0.42, life: 0.9, up: 0.9, out: 1.6, grow: 0.7, delay: 0.04 });
      spark(mx, my, mz, 0xfff0b0, 1.3, 0.2);
      Proj.cannonball(mx, my, mz, tx, tz, C.dmg[L] * Stat.siegeDmg(), C.splash[L], flight);
      shakeAt(t.x, t.z, 0.06, 0.35);
      Sfx.at('cannon', t.x, t.z, 0.9);
      return;
    }
    case 'frost': {
      const aura = CFG.frost.aura[L];
      const slow = CFG.frost.slow[L];
      for (const e of enemies) {
        if (e.alive && Math.hypot(e.x - t.x, e.z - t.z) < aura) applySlow(e, slow, 0.4);
      }
      if (t.cd > 0) return;
      const [e] = nearestEnemies(t.x, t.z, CFG.frost.range[L], 1);
      if (!e) {
        t.cd = 0.2;
        return;
      }
      t.cd = CFG.frost.interval[L];
      Proj.magic(t.x, t.top, t.z, e, CFG.frost.dmg[L] * mdmg, 0x9fe8ff, false, (hit) => applySlow(hit as Enemy, slow + 0.1, 2.5));
      Sfx.at('freeze', t.x, t.z, 0.4);
      return;
    }
    case 'mage': {
      if (t.cd > 0) return;
      const [first] = nearestEnemies(t.x, t.z, CFG.mage.range[L], 1);
      if (!first) {
        t.cd = 0.2;
        return;
      }
      t.cd = CFG.mage.interval[L];
      let dmg = CFG.mage.dmg[L] * mdmg;
      const hit = new Set<Enemy>();
      let cur: Enemy | null = first;
      let px = t.x, py = t.top, pz = t.z;
      for (let j = 0; j < CFG.mage.jumps[L] && cur; j++) {
        hit.add(cur);
        lightning(px, py, pz, cur.x, cur.aimY, cur.z);
        cur.damage(dmg, 'magic');
        px = cur.x;
        py = cur.aimY;
        pz = cur.z;
        dmg *= 0.85;
        let next: Enemy | null = null;
        let nd = 4.5;
        for (const e of enemies) {
          if (!e.alive || hit.has(e)) continue;
          const d = Math.hypot(e.x - px, e.z - pz);
          if (d < nd) {
            nd = d;
            next = e;
          }
        }
        cur = next;
      }
      Sfx.at('zap', t.x, t.z, 0.8);
      return;
    }
    case 'ballista': {
      if (t.cd > 0) return;
      const e = toughestEnemy(t.x, t.z, CFG.ballista.range[L]);
      if (!e) {
        t.cd = 0.2;
        return;
      }
      t.cd = CFG.ballista.interval[L];
      const lead = Math.hypot(e.x - t.x, e.z - t.z) / 40;
      const tx = e.x + e.vx * lead;
      const tz = e.z + e.vz * lead;
      const ang = Math.atan2(tx - t.x, tz - t.z);
      if (t.spin) t.spin.rotation.y = ang;
      Proj.bolt(t.x, t.top, t.z, Math.sin(ang), Math.cos(ang), CFG.ballista.range[L] + 4, CFG.ballista.dmg[L] * Stat.towerDmg(), e.aimY);
      Sfx.at('thunk', t.x, t.z, 0.9);
      return;
    }
    case 'fire': {
      if (t.cd > 0) return;
      const e = densest(t.x, t.z, CFG.fire.range[L], 0, 6) ?? nearestEnemies(t.x, t.z, CFG.fire.range[L], 1)[0];
      if (!e) {
        t.cd = 0.2;
        return;
      }
      t.cd = CFG.fire.interval[L];
      const flight = Math.max(0.6, Math.hypot(e.x - t.x, e.z - t.z) / 16);
      const fm = mdmg * Stat.holyFire();
      Proj.fireball(t.x, t.top, t.z, e.x + e.vx * flight, e.z + e.vz * flight, e.flying ? e.aimY : 0.3, CFG.fire.dmg[L] * fm, CFG.fire.splash[L], CFG.fire.burn[L] * fm, flight);
      Sfx.at('fire', t.x, t.z, 0.7);
      return;
    }
    case 'spire': {
      const R = CFG.spire.range[L];
      const heal = CFG.spire.heal[L] * dt;
      for (const u of defenders()) {
        if (!u.alive || Math.hypot(u.x - t.x, u.z - t.z) > R) continue;
        if (u === hero) hero.hp = Math.min(heroMaxHp(), hero.hp + heal * 2);
        else (u as unknown as { heal(n: number): void }).heal(heal);
      }
      const rep = CFG.spire.repair[L] * dt;
      for (const s of allStructures()) {
        if (!s.alive || s === t || s.hp >= s.maxHp) continue;
        const [ax, az] = aimPoint(t.x, t.z, s);
        if (Math.hypot(ax - t.x, az - t.z) < R) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * rep);
      }
      if (t.cd > 0) return;
      const e = toughestEnemy(t.x, t.z, R + 3);
      if (!e) {
        t.cd = 0.3;
        return;
      }
      t.cd = CFG.spire.interval;
      beam(t.x, t.top, t.z, e.x, e.aimY, e.z, 0xffe27a, 0.35, 0.3);
      beam(t.x, t.top, t.z, e.x, e.aimY, e.z, 0xffffff, 0.12, 0.25);
      spark(e.x, e.aimY + 0.3, e.z, 0xffe27a, 1.6, 0.35);
      burst(e.x, e.aimY, e.z, 0xffe27a, 8, { glow: true, speed: 3, up: 3, life: 0.5 });
      e.damage(CFG.spire.smite[L] * mdmg * Stat.holyFire(), 'holy');
      Sfx.at('magic', t.x, t.z, 0.6);
      return;
    }
  }
}

function updateTraps(dt: number): void {
  const sm = Stat.siegeDmg();
  for (const tr of traps) {
    const L = tr.level - 1;
    if (tr.kind === 'spikes') {
      tr.cd -= dt;
      if (tr.spikes) {
        tr.thrust = Math.max(0, tr.thrust - dt * 4);
        tr.spikes.scale.y = 0.4 + tr.thrust * 0.8;
      }
      if (tr.cd > 0) continue;
      const R = CFG.spikes.radius;
      let any = false;
      for (const e of enemies) {
        if (!e.alive || e.flying || Math.hypot(e.x - tr.x, e.z - tr.z) > R + e.r * 0.5) continue;
        e.damage(CFG.spikes.dmg[L] * sm, 'melee');
        any = true;
      }
      if (any) {
        tr.cd = CFG.spikes.interval;
        tr.thrust = 1;
        Sfx.at('stab', tr.x, tr.z, 0.5);
      } else tr.cd = 0.1;
    } else {
      const R = CFG.tar.radius;
      const burn = CFG.tar.burn[L] * sm;
      for (const e of enemies) {
        if (!e.alive || e.flying || Math.hypot(e.x - tr.x, e.z - tr.z) > R) continue;
        applySlow(e, CFG.tar.slow[L], 0.35);
        if (burn > 0) e.burn(burn, 1.5);
      }
    }
  }
}

function updateBarracks(dt: number): void {
  for (const b of [barracks, range]) {
    if (b.level <= 0) continue;
    const ranged = b === range;
    const cap = Units.soldierCap(ranged);
    const list = ranged ? rangers : soldiers;
    const alive = list.filter((s) => s.alive).length;
    if (alive < cap) {
      b.trainT += dt;
      const need = ranged ? CFG.ranger.train * (1 - 0.08 * G.research.drill) : Stat.trainTime();
      if (b.trainT >= need) {
        b.trainT = 0;
        Units.spawnSoldier(ranged);
      }
    } else b.trainT = 0;
  }
}

function updateBars(dt: number): void {
  for (const s of allStructures()) {
    if (!s.alive) {
      s.bar.hide();
      continue;
    }
    if (s.frozenT > 0) {
      s.frozenT -= dt;
      if (Math.random() < dt * 3) burst(s.x, s.top, s.z, 0xbff4ff, 1, { glow: true, speed: 1, up: 1 });
    }
    const y = s.kind === 'wall' ? 4.2 : s.kind === 'keep' ? s.top + 4.5 : s.top + 1.4;
    s.bar.set(s.hp / s.maxHp, s.x, y, s.z);
    // Hits make the building shudder instead of flashing.
    if (s.flashT > 0) {
      s.flashT = Math.max(0, s.flashT - dt);
      if (s.mesh) {
        const k = s.flashT / 0.3;
        const j = Math.sin(s.flashT * 70) * 0.07 * k;
        s.mesh.position.set(s.x + j, 0, s.z + j * 0.5);
      }
    }
    setStructMat(s, s.frozenT > 0 ? Mat.frozen : null);
  }
}

export function updateStructures(dt: number): void {
  updateMarket(dt);
  updateTowers(dt);
  updateCatapult(dt);
  for (const t of S.special) if (t.alive) updateSpecial(t, dt);
  updateTraps(dt);
  updateBarracks(dt);
  updateBars(dt);
}

/** Visual-only: show a burst ring for an ability or event at the wall. */
export function wallFx(color: number): void {
  for (const w of S.walls) if (w?.alive) ring(w.x, w.z, color, 5, 0.6);
}
