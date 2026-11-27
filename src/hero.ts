import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { G, type DamageKind, type ResType } from './state';
import { unitModel, setModelMat, itemGeo, ITEM_H, makeMesh, Mat, type UnitModel } from './models';
import { Input } from './input';
import { pushOut } from './structures';
import { World } from './world';
import { enemies, type Enemy } from './units';
import { Bar, burst, fly, text, flash } from './fx';
import { Sfx } from './audio';
import { Stat } from './progress';
import { angleLerp, clamp } from './util';

export const SPAWN = { x: 0, z: 2.5 };

export const hero = {
  x: SPAWN.x,
  z: SPAWN.z,
  r: CFG.hero.r,
  hw: 0,
  hd: 0,
  isStruct: false,
  alive: true,
  hp: 100,
  stack: [] as ResType[],
  /** Items still flying toward the stack (not drawn on the back yet). */
  inbound: 0,
  facing: 0,
  moving: false,
  slowT: 0,
  slowAmt: 0,
  stunT: 0,
  damage(amount: number, kind: DamageKind, src?: unknown): void {
    hurt(amount, kind, src);
  },
};

let model: UnitModel | null = null;
let stackGroup: THREE.Group | null = null;
const stackMeshes: (THREE.Mesh | undefined)[] = [];
let stackTopY = 0;
let bar: Bar | null = null;
let atkT = 0;
let harvestT = 0;
let swingT = 1;
let swingStarted = false;
let deadT = 0;
let sinceHit = 99;
let targetFacing = 0;
let flashT = 0;
let fullShown = false;
let spinT = 0;

export const capacity = (): number => Stat.heroCap();
export const maxHp = (): number => Stat.heroMaxHp();
export const respawnIn = (): number => Math.max(0, CFG.hero.respawn - deadT);

export function heroInit(): void {
  model = unitModel('hero');
  scene.add(model.group);
  stackGroup = new THREE.Group();
  stackGroup.position.set(0, 1.1, -0.45);
  model.body.add(stackGroup);
  bar = new Bar(1.2, 0x5fd35f);
  hero.hp = maxHp();
  model.group.position.set(hero.x, 0, hero.z);
}

function hurt(amount: number, kind: DamageKind, src?: unknown): void {
  if (!hero.alive || G.god) return;
  if (Math.random() < Stat.dodge()) {
    text(hero.x, 2.6, hero.z, 'Dodge!', 'xp', 0.6);
    return;
  }
  hero.hp -= amount;
  sinceHit = 0;
  flashT = 0.12;
  if (model) setModelMat(model, Mat.flash);
  Sfx.play('hurt', 0.8);
  const th = Stat.thorns();
  if (th > 0 && kind === 'melee' && src && typeof (src as Enemy).damage === 'function' && (src as Enemy).alive) {
    (src as Enemy).damage(amount * th, 'melee');
  }
  if (hero.hp <= 0) die();
}

/** Frost attacks slow the hero for a moment. */
export function heroSlow(amount: number, dur: number): void {
  if (!hero.alive) return;
  hero.slowAmt = Math.max(hero.slowT > 0 ? hero.slowAmt : 0, amount);
  hero.slowT = Math.max(hero.slowT, dur);
}

export function heroStun(dur: number): void {
  if (!hero.alive || G.god) return;
  hero.stunT = Math.max(hero.stunT, dur);
  text(hero.x, 2.7, hero.z, 'Stunned!', 'red', 0.8);
}

/** Whirlwind animation. */
export function heroSpin(): void {
  spinT = 0.45;
}

export function healHero(frac: number): void {
  if (!hero.alive) return;
  hero.hp = Math.min(maxHp(), hero.hp + maxHp() * frac);
}

function die(): void {
  hero.alive = false;
  hero.hp = 0;
  deadT = 0;
  if (hero.stack.length) text(hero.x, 2.6, hero.z, `Dropped ${hero.stack.length} items`, 'red', 1.6);
  hero.stack.length = 0;
  hero.inbound = 0;
  hero.slowT = hero.stunT = 0;
  burst(hero.x, 1, hero.z, 0xc23b3b, 14, { speed: 3, up: 4, size: 0.18 });
  Sfx.play('die');
  if (model) setModelMat(model, null);
}

export function respawnHero(): void {
  hero.alive = true;
  hero.hp = maxHp();
  hero.x = SPAWN.x;
  hero.z = SPAWN.z;
  sinceHit = 99;
  if (model) {
    model.group.rotation.x = 0;
    model.group.position.set(hero.x, 0, hero.z);
  }
  text(hero.x, 2.6, hero.z, 'Back in action!', 'gold');
}

/** World position just above the top of the carried stack. */
export function stackTop(): THREE.Vector3 {
  const v = new THREE.Vector3(0, stackTopY + 0.1, 0);
  if (!stackGroup) return v.set(hero.x, 2, hero.z);
  stackGroup.updateWorldMatrix(true, false);
  return stackGroup.localToWorld(v);
}

export function popItem(): ResType | undefined {
  return hero.stack.pop();
}

function nearestEnemy(range: number): Enemy | null {
  let best: Enemy | null = null;
  let bd = range;
  for (const e of enemies) {
    if (!e.alive || e.flyH > 4) continue;
    const d = Math.hypot(e.x - hero.x, e.z - hero.z) - e.r - hero.r;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function updateStack(moving: boolean): void {
  if (!stackGroup) return;
  const n = Math.max(0, hero.stack.length - hero.inbound);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = hero.stack[i];
    let m = stackMeshes[i];
    if (!m || m.userData.t !== t) {
      if (m) stackGroup.remove(m);
      m = makeMesh(itemGeo(t), true, false, Mat.unit);
      m.userData.t = t;
      stackMeshes[i] = m;
      stackGroup.add(m);
    }
    m.visible = true;
    const h = ITEM_H[t];
    const sway = Math.sin(G.time * 7 + i * 0.35) * 0.012 * i * (moving ? 1 : 0.25);
    m.position.set(sway, y + h / 2, 0);
    m.rotation.y = (i % 2) * 0.14 - 0.07;
    y += h;
  }
  for (let i = n; i < stackMeshes.length; i++) {
    const m = stackMeshes[i];
    if (m) m.visible = false;
  }
  stackTopY = y;
  stackGroup.rotation.x += ((moving ? -0.12 : 0) - stackGroup.rotation.x) * 0.15;
}

/** Hero melee hit with crits and lifesteal. Returns the damage dealt. */
export function heroStrike(e: Enemy, mult: number, showText = true): number {
  let dmg = Stat.heroDmg() * mult;
  const crit = Math.random() < Stat.crit();
  if (crit) dmg *= 2;
  e.damage(dmg, 'melee', hero);
  const leech = Stat.leech();
  if (leech > 0) hero.hp = Math.min(maxHp(), hero.hp + dmg * leech);
  if (showText) text(e.x, 1.9 * e.scale + 0.5 + e.flyH, e.z, String(Math.round(dmg)) + (crit ? '!' : ''), crit ? 'crit' : 'dmg', 0.7);
  return dmg;
}

function pickup(node: ReturnType<typeof World.nearestHarvestable>): void {
  if (!node) return;
  const from = new THREE.Vector3(node.x, 1.0, node.z);
  const t = World.harvest(node);
  if (!t) return;
  const n = Math.random() < Stat.doubleChance() && hero.stack.length + 2 <= capacity() ? 2 : 1;
  for (let i = 0; i < n; i++) {
    hero.stack.push(t);
    hero.inbound++;
    fly(t, from, stackTop, {
      dur: 0.3 + i * 0.08,
      arc: 1.2,
      done: () => {
        hero.inbound = Math.max(0, hero.inbound - 1);
      },
    });
  }
  if (n === 2) text(node.x, 2.2, node.z, 'Double!', 'xp', 0.7);
  Sfx.play(t === 'wood' ? 'chop' : 'mine');
}

export function heroUpdate(dt: number): void {
  if (!model || !bar) return;
  const m = model;
  if (!hero.alive) {
    deadT += dt;
    m.group.rotation.x = Math.max(-Math.PI / 2, m.group.rotation.x - dt * 6);
    bar.hide();
    updateStack(false);
    if (deadT >= CFG.hero.respawn) respawnHero();
    return;
  }
  if (hero.slowT > 0) hero.slowT -= dt;
  if (hero.stunT > 0) hero.stunT -= dt;
  const stunned = hero.stunT > 0;

  const mv = stunned ? { x: 0, z: 0 } : Input.move();
  const spd = Stat.heroSpeed() * (hero.slowT > 0 ? 1 - hero.slowAmt : 1);
  hero.moving = Math.hypot(mv.x, mv.z) > 0.05;
  hero.x = clamp(hero.x + mv.x * spd * dt, CFG.map.minX, CFG.map.maxX);
  hero.z = clamp(hero.z + mv.z * spd * dt, CFG.map.minZ, CFG.map.maxZ);
  pushOut(hero, hero.r);
  if (hero.moving) targetFacing = Math.atan2(mv.x, mv.z);

  atkT -= dt;
  swingT += dt / 0.3;
  const foe = stunned ? null : nearestEnemy(CFG.hero.attackRange);
  if (foe) {
    harvestT = 0;
    swingStarted = false;
    if (!hero.moving) targetFacing = Math.atan2(foe.x - hero.x, foe.z - hero.z);
    if (atkT <= 0) {
      atkT = Stat.heroAtkCd();
      swingT = 0;
      const dmg = heroStrike(foe, 1);
      const cr = Stat.cleaveR();
      const cm = Stat.cleaveMul();
      for (const e of enemies) {
        if (e !== foe && e.alive && Math.hypot(e.x - foe.x, e.z - foe.z) < cr) e.damage(dmg * cm, 'melee', hero);
      }
      burst(foe.x, 1.1 * foe.scale + foe.flyH, foe.z, 0xff5a3a, 4, { speed: 3, up: 2, size: 0.1, life: 0.35 });
      flash(foe.x, 1.1 * foe.scale + foe.flyH, foe.z, 0xffc080, 0.9, 0.12);
      Sfx.play('hit');
    }
  } else if (!stunned && hero.stack.length < capacity()) {
    const node = World.nearestHarvestable(hero.x, hero.z, CFG.hero.harvestRange, hero.r);
    if (node) {
      if (!hero.moving) targetFacing = Math.atan2(node.x - hero.x, node.z - hero.z);
      harvestT += dt;
      const need = Stat.heroHarvest() * CFG.res[node.type].hard;
      if (!swingStarted && harvestT >= need - 0.12) {
        swingStarted = true;
        swingT = 0;
      }
      if (harvestT >= need) {
        harvestT = 0;
        swingStarted = false;
        pickup(node);
      }
    } else {
      harvestT = 0;
      swingStarted = false;
    }
  }

  if (hero.stack.length >= capacity()) {
    if (!fullShown) {
      fullShown = true;
      text(hero.x, 3.4, hero.z, 'FULL! Sell at the market', 'gold', 1.6);
    }
  } else fullShown = false;

  sinceHit += dt;
  const mh = maxHp();
  if (sinceHit > Stat.regenDelay() && hero.hp < mh) hero.hp = Math.min(mh, hero.hp + Stat.heroRegen() * dt);
  if (hero.hp > mh) hero.hp = mh;
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) setModelMat(m, hero.slowT > 0 ? Mat.chill : null);
  } else setModelMat(m, hero.slowT > 0 ? Mat.chill : null);

  hero.facing = angleLerp(hero.facing, targetFacing, Math.min(1, dt * 14));
  m.group.position.set(hero.x, 0, hero.z);
  if (spinT > 0) {
    spinT -= dt;
    m.group.rotation.y = hero.facing + (1 - spinT / 0.45) * Math.PI * 4;
  } else m.group.rotation.y = hero.facing;
  m.anim(dt, hero.moving, spd, swingT);
  if (stunned) m.body.rotation.z = Math.sin(G.time * 20) * 0.08;
  else m.body.rotation.z = 0;
  updateStack(hero.moving);
  bar.set(hero.hp / mh, hero.x, 2.45, hero.z);
}
