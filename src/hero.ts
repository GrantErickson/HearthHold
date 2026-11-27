import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { G, type DamageKind, type ResType } from './state';
import { unitModel, setModelMat, hitPulse, updateLook, itemGeo, ITEM_H, makeMesh, Mat, type UnitModel } from './models';
import { Input } from './input';
import { pushOut } from './structures';
import { World } from './world';
import { enemies, wallHop, type Enemy } from './units';
import { campNear, type Camp } from './camps';
import { Bar, burst, fly, text, slash, dust, spark, ring, puff, hitStop, shakeAt } from './fx';
import { on } from './events';
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
let slashFlip = 1;
/** Red screen-edge pulse after the hero takes damage (0–1). */
export let heroHurt = 0;
let targetFacing = 0;
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
  if (model) hitPulse(model);
  Sfx.play('hurt', 0.8);
  // Big hits make the screen edges flash red.
  heroHurt = Math.min(1, heroHurt + 0.25 + (amount / maxHp()) * 4);
  if (amount > maxHp() * 0.12) G.shake = Math.min(0.6, G.shake + 0.15);
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
  const wasAlive = e.alive;
  const warded = e.wardHits > 0;
  e.damage(dmg, 'melee', hero);
  // A blow that only chips a ward shows the ward count instead of damage.
  if (warded && e.wardHits > 0) showText = false;
  // Knock them back; heavy blows send the fallen flying.
  e.knock(hero.x, hero.z, crit ? 6 : mult > 1.5 ? 5 : 2.2);
  if (crit) {
    hitStop(0.05);
    shakeAt(e.x, e.z, 0.08, 0.5);
    Sfx.at('crit', e.x, e.z, 0.9);
  }
  if (wasAlive && !e.alive && (e.isBoss || e.scale >= 1.4)) hitStop(0.07);
  const leech = Stat.leech();
  if (leech > 0) hero.hp = Math.min(maxHp(), hero.hp + dmg * leech);
  if (showText) text(e.x, 1.9 * e.scale + 0.5 + e.flyH, e.z, String(Math.round(dmg)) + (crit ? '!' : ''), crit ? 'crit' : 'dmg', 0.7);
  return dmg;
}

/** Hero blow against an enemy camp (only the hero and his soldiers can tear one down). */
export function heroHitCamp(c: Camp, mult: number, showText = true): void {
  let dmg = Stat.heroDmg() * mult;
  const crit = Math.random() < Stat.crit();
  if (crit) dmg *= 2;
  c.damage(dmg, 'melee', hero);
  if (crit) {
    hitStop(0.04);
    shakeAt(c.x, c.z, 0.06, 0.4);
    Sfx.at('crit', c.x, c.z, 0.8);
  }
  if (showText) text(c.x + (Math.random() - 0.5), 3.2, c.z + 1, String(Math.round(dmg)) + (crit ? '!' : ''), crit ? 'crit' : 'dmg', 0.7);
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

let stepT = 0;
on('levelUp', () => {
  if (G.autotest) return;
  ring(hero.x, hero.z, 0xffd54a, 3.2, 0.6);
  puff(hero.x, 0.4, hero.z, 0xfff4c8, { n: 8, spread: 0.6, size: 0.35, life: 0.7, up: 2.2, out: 2 });
  for (let i = 0; i < 4; i++) spark(hero.x + (Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.6, hero.z + (Math.random() - 0.5) * 1.6, 0xffe27a, 1.1, 0.45);
  burst(hero.x, 1.2, hero.z, 0xffd54a, 16, { glow: true, speed: 4, up: 5, life: 0.8 });
});

export function heroUpdate(dt: number): void {
  if (!model || !bar) return;
  const m = model;
  if (heroHurt > 0) heroHurt = Math.max(0, heroHurt - dt * 1.6);
  if (hero.alive && hero.moving) {
    stepT -= dt;
    if (stepT <= 0) {
      stepT = 0.26;
      dust(hero.x - Math.sin(hero.facing) * 0.3, hero.z - Math.cos(hero.facing) * 0.3, 0.45);
    }
  }
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
  const camp = foe || stunned ? null : campNear(hero.x, hero.z, CFG.hero.attackRange + hero.r);
  if (camp) {
    // Tearing down an enemy camp.
    harvestT = 0;
    swingStarted = false;
    if (!hero.moving) targetFacing = Math.atan2(camp.x - hero.x, camp.z - hero.z);
    if (atkT <= 0) {
      atkT = Stat.heroAtkCd();
      swingT = 0;
      heroHitCamp(camp, 1);
      slashFlip = -slashFlip;
      slash(hero.x, 1.05, hero.z, Math.atan2(camp.x - hero.x, camp.z - hero.z), 0xfff4dc, 1.55, 0.2, slashFlip);
      Sfx.play('hit');
    }
  } else if (foe) {
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
      slashFlip = -slashFlip;
      slash(hero.x, 1.05 + foe.flyH * 0.5, hero.z, Math.atan2(foe.x - hero.x, foe.z - hero.z), 0xfff4dc, 1.55, 0.2, slashFlip);
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
  updateLook(m, dt, hero.slowT > 0 ? 'chill' : G.buffs.warcry > 0 ? 'holy' : null, G.time);

  hero.facing = angleLerp(hero.facing, targetFacing, Math.min(1, dt * 14));
  // Over the top of a standing wall in one bound.
  m.group.position.set(hero.x, wallHop(hero.x, hero.z, hero.r), hero.z);
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
