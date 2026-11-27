import * as THREE from 'three';
import { scene } from './engine';
import { CFG, hpScale, bossScale, dmgScale, coinScale, type EnemyDef } from './config';
import { G, type DamageKind, type EnemyType, type ResType, type Target } from './state';
import { humanoid, animateHumanoid, setFlash, itemGeo, ITEM_H, makeMesh, type Humanoid } from './models';
import * as St from './structures';
import { hero } from './hero';
import { World, type ResNode } from './world';
import { Bar, burst, dropCoins, text } from './fx';
import { Sfx } from './audio';
import { Proj } from './projectiles';
import { aimPoint, angleLerp, clamp, surfDist } from './util';

const MAP = CFG.map;

function structId(t: Target): string | undefined {
  return t.isStruct ? (t as St.Structure).id : undefined;
}

// ───────────────────────────── Enemies ─────────────────────────────

export class Enemy implements Target {
  readonly isStruct = false;
  readonly hw = 0;
  readonly hd = 0;
  alive = true;
  removed = false;
  type: EnemyType;
  d: EnemyDef;
  x: number;
  z: number;
  r: number;
  vx = 0;
  vz = 0;
  hp: number;
  maxHp: number;
  dmg: number;
  coins: number;
  speed: number;
  scale: number;
  atkT: number;
  retargetT = 0;
  target: Target | null = null;
  swingT = 1;
  flashT = 0;
  deathT = 0;
  summonT: number;
  facing = 0;
  moving = false;
  m: Humanoid;
  bar: Bar;

  constructor(type: EnemyType, x: number, z: number, wave: number) {
    this.type = type;
    this.d = CFG.enemies[type];
    this.x = x;
    this.z = z;
    this.r = this.d.r;
    this.hp = this.maxHp = Math.round(this.d.hp * (this.d.boss ? bossScale(wave) : hpScale(wave)));
    this.dmg = this.d.dmg * dmgScale(wave);
    this.coins = Math.round(this.d.coins * coinScale(wave));
    this.speed = this.d.speed * (0.9 + Math.random() * 0.2);
    this.scale = this.d.scale;
    this.atkT = Math.random() * 0.5;
    this.summonT = this.d.summon ?? 0;
    this.m = humanoid(type, !G.autotest);
    this.m.group.scale.setScalar(this.scale);
    this.m.group.position.set(x, 0, z);
    if (!G.autotest) scene.add(this.m.group);
    this.bar = new Bar(this.d.boss ? 2.2 : 0.9, 0xe0453a, this.d.boss ? 0.2 : 0.12);
  }

  damage(amount: number, kind: DamageKind): void {
    if (!this.alive) return;
    if (kind === 'arrow' && this.d.arrowResist) amount *= this.d.arrowResist;
    this.hp -= amount;
    this.flashT = 0.1;
    setFlash(this.m, true);
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.alive = false;
    this.hp = 0;
    this.deathT = 0;
    G.stats.kills++;
    this.bar.hide();
    setFlash(this.m, false);
    dropCoins(this.x, this.z, this.coins);
    burst(this.x, 1, this.z, 0x9a8a7a, 10, { speed: 3, up: 3, size: 0.2 });
    Sfx.at('die', this.x, this.z);
    if (this.d.boss) {
      G.shake = 0.6;
      text(this.x, 3.5, this.z, `${this.d.name} defeated!`, 'gold big', 2);
    }
  }

  private pickTarget(): void {
    const d = this.d;
    let best: Target | null = null;
    let bd = d.ranged ? d.range : 4.5;
    const units: Target[] = [hero, ...soldiers];
    for (const t of units) {
      if (!t.alive) continue;
      const dist = surfDist(this.x, this.z, this.r, t);
      if (dist >= bd) continue;
      if (!d.ranged && St.wallBetween(this.x, this.z, t.x, t.z)) continue;
      bd = dist;
      best = t;
    }
    if (!best) {
      bd = d.ranged ? d.range : 6;
      for (const t of St.attackables()) {
        const dist = surfDist(this.x, this.z, this.r, t);
        if (dist >= bd) continue;
        const [ax, az] = aimPoint(this.x, this.z, t);
        if (!d.ranged && St.wallBetween(this.x, this.z, ax, az)) continue;
        bd = dist;
        best = t;
      }
    }
    this.target = best ?? St.S.keep;
  }

  update(dt: number): void {
    if (!this.alive) {
      this.deathT += dt;
      const g = this.m.group;
      g.rotation.x = Math.max(-Math.PI / 2, -this.deathT * 6);
      g.position.y = this.deathT > 0.6 ? -(this.deathT - 0.6) * 1.2 : 0;
      if (this.deathT > 1.3) this.removed = true;
      return;
    }
    const d = this.d;
    this.atkT -= dt;
    this.retargetT -= dt;
    this.swingT += dt / 0.35;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) setFlash(this.m, false);
    }
    if (d.summon) {
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = d.summon;
        summonAround(this);
      }
    }
    if (this.retargetT <= 0 || !this.target || !this.target.alive) {
      this.retargetT = 0.3 + Math.random() * 0.15;
      this.pickTarget();
    }

    let tgt: Target = this.target ?? St.S.keep;
    let moveTo: [number, number] | null = null;
    const W = MAP.wallZ;
    if (this.z < W) {
      const near = W - this.z < 3;
      const here = St.S.walls[St.segIndex(this.x)];
      const [ax, az] = aimPoint(this.x, this.z, tgt);
      if (near && !(here && here.alive) && az > W) {
        // In front of an opening: walk straight through it.
        const i = St.segIndex(this.x);
        const minX = MAP.segStart + i * MAP.segWidth;
        moveTo = [clamp(ax, minX + 0.8, minX + MAP.segWidth - 0.8), W + 2];
      } else {
        const seg = St.wallBetween(this.x, this.z, ax, az);
        if (seg && !(d.ranged && surfDist(this.x, this.z, this.r, tgt) <= d.range)) {
          const gap = !d.noGap && near ? St.nearGap(this.x, 3.5) : null;
          if (gap !== null) moveTo = [gap, this.z];
          else tgt = seg;
        }
      }
    }

    this.moving = false;
    if (moveTo) {
      this.moveToward(moveTo[0], moveTo[1], dt);
    } else if (surfDist(this.x, this.z, this.r, tgt) <= d.range) {
      this.attack(tgt);
    } else {
      const [ax, az] = aimPoint(this.x, this.z, tgt);
      this.moveToward(ax, az, dt, structId(tgt));
    }

    this.m.group.position.set(this.x, 0, this.z);
    this.m.group.rotation.y = this.facing;
    animateHumanoid(this.m, dt, this.moving, this.speed, this.swingT);
    this.bar.set(this.hp / this.maxHp, this.x, 2.2 * this.scale + 0.25, this.z, !!d.boss || this.hp < this.maxHp);
  }

  private moveToward(tx: number, tz: number, dt: number, ignoreId?: string): void {
    let dx = tx - this.x;
    let dz = tz - this.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    dx /= L;
    dz /= L;
    [dx, dz] = St.steer(this.x, this.z, dx, dz, this.r, ignoreId);
    const step = Math.min(L, this.speed * dt);
    const oz = this.z;
    this.x += dx * step;
    this.z += dz * step;
    this.vx = dx * this.speed;
    this.vz = dz * this.speed;
    const stopZ = MAP.wallZ - MAP.wallHalf - this.r;
    if (oz <= stopZ + 0.01 && this.z > stopZ && St.segAlive(St.segIndex(this.x))) this.z = stopZ;
    this.x = clamp(this.x, MAP.minX, MAP.maxX);
    St.pushOut(this, this.r);
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
    this.moving = true;
  }

  private attack(t: Target): void {
    this.vx = this.vz = 0;
    const [ax, az] = aimPoint(this.x, this.z, t);
    this.facing = angleLerp(this.facing, Math.atan2(ax - this.x, az - this.z), 0.3);
    if (this.atkT > 0) return;
    this.atkT = this.d.interval;
    this.swingT = 0;
    if (this.d.ranged) {
      Proj.arrow(this.x, 1.5 * this.scale, this.z, t, this.dmg, true);
      Sfx.at('arrow', this.x, this.z, 0.5);
    } else {
      const isWall = t.isStruct && (t as St.Structure).kind === 'wall';
      t.damage(this.dmg * (isWall ? this.d.wallMul ?? 1 : 1), 'melee');
      Sfx.at('hit', this.x, this.z, 0.5);
      if (this.d.boss) {
        G.shake = Math.min(0.6, G.shake + 0.25);
        burst(ax, 0.4, az, 0x9a8a7a, 10, { speed: 4, up: 4, size: 0.2 });
      }
    }
  }

  dispose(): void {
    scene.remove(this.m.group);
    this.bar.dispose();
  }
}

function summonAround(e: Enemy): void {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.random();
    Units.spawnEnemy('raider', e.x + Math.cos(a) * 1.8, e.z + Math.sin(a) * 1.8 - 1, Math.max(1, G.wave));
  }
  burst(e.x, 1, e.z, 0x8a1c1c, 16, { speed: 5, up: 5, size: 0.2 });
  text(e.x, 4.5, e.z, 'Summons raiders!', 'red');
}

// ───────────────────────────── Soldiers ─────────────────────────────

const POSTS = [-3, 3, -9, 9, -15, 15, -21, 21].map((x) => ({ x, z: MAP.wallZ + 1.05 }));

export class Soldier implements Target {
  readonly isStruct = false;
  readonly hw = 0;
  readonly hd = 0;
  readonly r = CFG.soldier.r;
  alive = true;
  removed = false;
  x: number;
  z: number;
  hp = 1;
  maxHp = 1;
  dmg = 1;
  post: { x: number; z: number };
  target: Enemy | null = null;
  atkT = 0;
  retargetT = 0;
  swingT = 1;
  flashT = 0;
  deathT = 0;
  facing = Math.PI;
  moving = false;
  m: Humanoid;
  bar: Bar;

  constructor(post: { x: number; z: number }) {
    this.post = post;
    this.x = St.barracks.door.x;
    this.z = St.barracks.door.z;
    this.refreshStats();
    this.m = humanoid('soldier', !G.autotest);
    this.m.group.position.set(this.x, 0, this.z);
    if (!G.autotest) scene.add(this.m.group);
    this.bar = new Bar(0.9, 0x5fd35f, 0.12);
  }

  refreshStats(): void {
    const L = clamp(St.barracks.level - 1, 0, CFG.soldier.hp.length - 1);
    this.maxHp = CFG.soldier.hp[L];
    this.hp = this.maxHp;
    this.dmg = CFG.soldier.dmg[L];
  }

  damage(amount: number, _kind: DamageKind): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.flashT = 0.1;
    setFlash(this.m, true);
    if (this.hp <= 0) {
      this.alive = false;
      this.deathT = 0;
      this.bar.hide();
      setFlash(this.m, false);
      burst(this.x, 1, this.z, 0x4f78c4, 10, { speed: 3, up: 3, size: 0.18 });
      Sfx.at('die', this.x, this.z, 0.7);
    }
  }

  private findTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dp = Math.hypot(e.x - this.post.x, e.z - this.post.z);
      const ds = Math.hypot(e.x - this.x, e.z - this.z);
      if (dp > CFG.soldier.engage && ds > 3.5) continue;
      if (ds < bd) {
        bd = ds;
        best = e;
      }
    }
    return best;
  }

  private moveToward(tx: number, tz: number, dt: number): void {
    let dx = tx - this.x;
    let dz = tz - this.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    dx /= L;
    dz /= L;
    [dx, dz] = St.steer(this.x, this.z, dx, dz, this.r);
    const step = Math.min(L, CFG.soldier.speed * dt);
    this.x += dx * step;
    this.z += dz * step;
    St.pushOut(this, this.r);
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
    this.moving = true;
  }

  update(dt: number): void {
    if (!this.alive) {
      this.deathT += dt;
      this.m.group.rotation.x = Math.max(-Math.PI / 2, -this.deathT * 6);
      if (this.deathT > 1.3) this.removed = true;
      return;
    }
    this.atkT -= dt;
    this.retargetT -= dt;
    this.swingT += dt / 0.3;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) setFlash(this.m, false);
    }
    if (this.retargetT <= 0 || (this.target && !this.target.alive)) {
      this.retargetT = 0.3;
      this.target = this.findTarget();
    }
    this.moving = false;
    const t = this.target;
    if (t) {
      if (surfDist(this.x, this.z, this.r, t) <= CFG.soldier.range) {
        this.facing = angleLerp(this.facing, Math.atan2(t.x - this.x, t.z - this.z), 0.3);
        if (this.atkT <= 0) {
          this.atkT = CFG.soldier.interval;
          this.swingT = 0;
          t.damage(this.dmg, 'melee');
          Sfx.at('hit', this.x, this.z, 0.4);
        }
      } else this.moveToward(t.x, t.z, dt);
    } else {
      if (Math.hypot(this.post.x - this.x, this.post.z - this.z) > 0.3) this.moveToward(this.post.x, this.post.z, dt);
      else this.facing = angleLerp(this.facing, Math.PI, Math.min(1, dt * 5));
      this.hp = Math.min(this.maxHp, this.hp + 5 * dt);
    }
    this.m.group.position.set(this.x, 0, this.z);
    this.m.group.rotation.y = this.facing;
    animateHumanoid(this.m, dt, this.moving, CFG.soldier.speed, this.swingT);
    this.bar.set(this.hp / this.maxHp, this.x, 2.4, this.z);
  }

  dispose(): void {
    scene.remove(this.m.group);
    this.bar.dispose();
  }
}

// ───────────────────────────── Workers ─────────────────────────────

export type WorkerKind = 'lumber' | 'miner';

export class Worker {
  kind: WorkerKind;
  x: number;
  z: number;
  home: { x: number; z: number };
  state: 'seek' | 'go' | 'work' | 'deliver' | 'idle' = 'seek';
  node: ResNode | null = null;
  stack: ResType[] = [];
  t = 0;
  swung = false;
  swingT = 1;
  facing = 0;
  moving = false;
  m: Humanoid;
  stackGroup: THREE.Group;
  stackMeshes: THREE.Mesh[] = [];
  shown = -1;

  constructor(kind: WorkerKind) {
    this.kind = kind;
    this.home = kind === 'lumber' ? { x: -11, z: 19.4 } : { x: 11, z: 19.4 };
    this.x = this.home.x + (Math.random() - 0.5);
    this.z = this.home.z;
    this.m = humanoid(kind, !G.autotest);
    this.m.group.scale.setScalar(0.9);
    this.stackGroup = new THREE.Group();
    this.stackGroup.position.set(0, 1.1, -0.45);
    this.m.body.add(this.stackGroup);
    if (!G.autotest) scene.add(this.m.group);
    if (!G.autotest) burst(this.x, 1, this.z, 0xffd54a, 12, { speed: 3, up: 4 });
  }

  private release(): void {
    if (this.node && this.node.reservedBy === this) this.node.reservedBy = null;
    this.node = null;
  }

  private moveToward(tx: number, tz: number, dt: number): number {
    let dx = tx - this.x;
    let dz = tz - this.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return L;
    dx /= L;
    dz /= L;
    [dx, dz] = St.steer(this.x, this.z, dx, dz, 0.4);
    const step = Math.min(L, CFG.worker.speed * dt);
    this.x += dx * step;
    this.z += dz * step;
    St.pushOut(this, 0.4);
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
    this.moving = true;
    return L;
  }

  update(dt: number): void {
    this.moving = false;
    this.swingT += dt / 0.35;
    const types: ResType[] = this.kind === 'lumber' ? ['wood'] : ['gold', 'stone'];
    switch (this.state) {
      case 'seek': {
        const n = World.findForWorker(types, this.x, this.z, this);
        if (n) {
          n.reservedBy = this;
          this.node = n;
          this.state = 'go';
        } else {
          this.state = this.stack.length ? 'deliver' : 'idle';
          this.t = 1.5;
        }
        break;
      }
      case 'idle':
        this.t -= dt;
        if (Math.hypot(this.home.x - this.x, this.home.z - this.z) > 0.6) this.moveToward(this.home.x, this.home.z, dt);
        if (this.t <= 0) this.state = 'seek';
        break;
      case 'go': {
        const n = this.node;
        if (!n || n.state !== 'grown') {
          this.release();
          this.state = 'seek';
          break;
        }
        const d = Math.hypot(n.x - this.x, n.z - this.z) - n.r - 0.4;
        if (d > 0.5) this.moveToward(n.x, n.z, dt);
        else {
          this.state = 'work';
          this.t = 0;
          this.swung = false;
        }
        break;
      }
      case 'work': {
        const n = this.node;
        if (!n || n.state !== 'grown') {
          this.release();
          this.state = this.stack.length ? 'deliver' : 'seek';
          break;
        }
        this.facing = angleLerp(this.facing, Math.atan2(n.x - this.x, n.z - this.z), Math.min(1, dt * 8));
        this.t += dt;
        const need = CFG.worker.harvest * CFG.res[n.type].hard;
        if (!this.swung && this.t >= need - 0.12) {
          this.swung = true;
          this.swingT = 0;
        }
        if (this.t >= need) {
          this.t = 0;
          this.swung = false;
          const r = World.harvest(n);
          if (r) {
            this.stack.push(r);
            Sfx.at(r === 'wood' ? 'chop' : 'mine', this.x, this.z, 0.35);
          }
          if (this.stack.length >= CFG.worker.cap || n.state !== 'grown') {
            this.release();
            this.state = 'deliver';
          }
        }
        break;
      }
      case 'deliver': {
        const p = St.market.drop;
        const L = this.moveToward(p.x, p.z, dt);
        if (L < 1.0) {
          St.deliver(this.stack, new THREE.Vector3(this.x, 1.6, this.z));
          this.stack = [];
          this.state = 'seek';
        }
        break;
      }
    }
    this.m.group.position.set(this.x, 0, this.z);
    this.m.group.rotation.y = this.facing;
    animateHumanoid(this.m, dt, this.moving, CFG.worker.speed, this.swingT);
    if (this.shown !== this.stack.length) {
      this.shown = this.stack.length;
      for (const m of this.stackMeshes) this.stackGroup.remove(m);
      this.stackMeshes = [];
      let y = 0;
      for (const t of this.stack) {
        const m = makeMesh(itemGeo(t), false, false);
        m.position.y = y + ITEM_H[t] / 2;
        y += ITEM_H[t];
        this.stackGroup.add(m);
        this.stackMeshes.push(m);
      }
    }
  }
}

// ───────────────────────────── Lists & API ─────────────────────────────

export const enemies: Enemy[] = [];
export const soldiers: Soldier[] = [];
export const workers: Worker[] = [];

function separate(): void {
  const list = enemies.filter((e) => e.alive);
  const W = MAP.wallZ;
  const blockers: Target[] = [hero, ...soldiers];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const rr = a.r + b.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = rr - d;
        const nx = dx / d;
        const nz = dz / d;
        const wa = b.r / rr;
        const wb = a.r / rr;
        a.x -= nx * push * wa;
        a.z -= nz * push * wa;
        b.x += nx * push * wb;
        b.z += nz * push * wb;
      }
    }
    for (const u of blockers) {
      if (!u.alive) continue;
      const dx = a.x - u.x;
      const dz = a.z - u.z;
      const rr = a.r + u.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        a.x += (dx / d) * (rr - d);
        a.z += (dz / d) * (rr - d);
      }
    }
  }
  // Separation must never shove anyone through a standing wall.
  for (const a of list) {
    if (!St.segAlive(St.segIndex(a.x))) continue;
    const north = W - MAP.wallHalf - a.r;
    const south = W + MAP.wallHalf + a.r;
    if (a.z > north && a.z < W) a.z = north;
    else if (a.z >= W && a.z < south) a.z = south;
  }
}

export const Units = {
  spawnEnemy(type: EnemyType, x: number, z: number, wave: number): Enemy {
    const e = new Enemy(type, x, z, wave);
    enemies.push(e);
    return e;
  },

  addWorker(kind: WorkerKind): void {
    workers.push(new Worker(kind));
  },

  spawnSoldier(): void {
    const used = new Set(soldiers.filter((s) => s.alive).map((s) => s.post));
    const post = POSTS.find((p) => !used.has(p)) ?? POSTS[0];
    const s = new Soldier(post);
    soldiers.push(s);
    if (!G.autotest) burst(s.x, 1, s.z, 0x4f78c4, 10, { speed: 3, up: 4 });
  },

  fillSoldiers(): void {
    if (St.barracks.level <= 0) return;
    const cap = CFG.soldier.cap[St.barracks.level - 1];
    while (soldiers.filter((s) => s.alive).length < cap) Units.spawnSoldier();
  },

  boss(): Enemy | null {
    return enemies.find((e) => e.alive && e.d.boss) ?? null;
  },

  aliveCount(): number {
    let n = 0;
    for (const e of enemies) if (e.alive) n++;
    return n;
  },

  update(dt: number): void {
    for (const e of enemies) e.update(dt);
    separate();
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].removed) {
        enemies[i].dispose();
        enemies.splice(i, 1);
      }
    }
    for (const s of soldiers) s.update(dt);
    for (let i = soldiers.length - 1; i >= 0; i--) {
      if (soldiers[i].removed) {
        soldiers[i].dispose();
        soldiers.splice(i, 1);
      }
    }
    for (const w of workers) w.update(dt);
  },
};
