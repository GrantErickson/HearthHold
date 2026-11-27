import * as THREE from 'three';
import { scene } from './engine';
import { CFG } from './config';
import { G, type DamageKind, type ResType } from './state';
import { humanoid, animateHumanoid, setFlash, itemGeo, ITEM_H, makeMesh, type Humanoid } from './models';
import { Input } from './input';
import { pushOut } from './structures';
import { World } from './world';
import { enemies, type Enemy } from './units';
import { Bar, burst, fly, text } from './fx';
import { Sfx } from './audio';
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
  damage(amount: number, _kind: DamageKind): void {
    hurt(amount);
  },
};

let model: Humanoid | null = null;
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

export const capacity = (): number => CFG.hero.cap[G.up.backpack];
export const maxHp = (): number => CFG.hero.hp[G.up.armor];
export const respawnIn = (): number => Math.max(0, CFG.hero.respawn - deadT);

export function heroInit(): void {
  model = humanoid('hero');
  scene.add(model.group);
  stackGroup = new THREE.Group();
  stackGroup.position.set(0, 1.1, -0.45);
  model.body.add(stackGroup);
  bar = new Bar(1.2, 0x5fd35f);
  hero.hp = maxHp();
  model.group.position.set(hero.x, 0, hero.z);
}

function hurt(amount: number): void {
  if (!hero.alive || G.god) return;
  hero.hp -= amount;
  sinceHit = 0;
  flashT = 0.12;
  if (model) setFlash(model, true);
  Sfx.play('hurt', 0.8);
  if (hero.hp <= 0) die();
}

function die(): void {
  hero.alive = false;
  hero.hp = 0;
  deadT = 0;
  if (hero.stack.length) text(hero.x, 2.6, hero.z, `Dropped ${hero.stack.length} items`, 'red', 1.6);
  hero.stack.length = 0;
  hero.inbound = 0;
  burst(hero.x, 1, hero.z, 0xc23b3b, 14, { speed: 3, up: 4, size: 0.18 });
  Sfx.play('die');
  if (model) setFlash(model, false);
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
    if (!e.alive) continue;
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
      m = makeMesh(itemGeo(t), true, false);
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

  const mv = Input.move();
  const spd = CFG.hero.speed[G.up.boots];
  hero.moving = Math.hypot(mv.x, mv.z) > 0.05;
  hero.x = clamp(hero.x + mv.x * spd * dt, CFG.map.minX, CFG.map.maxX);
  hero.z = clamp(hero.z + mv.z * spd * dt, CFG.map.minZ, CFG.map.maxZ);
  pushOut(hero, hero.r);
  if (hero.moving) targetFacing = Math.atan2(mv.x, mv.z);

  atkT -= dt;
  swingT += dt / 0.3;
  const foe = nearestEnemy(CFG.hero.attackRange);
  if (foe) {
    harvestT = 0;
    swingStarted = false;
    if (!hero.moving) targetFacing = Math.atan2(foe.x - hero.x, foe.z - hero.z);
    if (atkT <= 0) {
      atkT = CFG.hero.attackCd;
      swingT = 0;
      const dmg = CFG.hero.dmg[G.up.sword];
      foe.damage(dmg, 'melee');
      for (const e of enemies) {
        if (e !== foe && e.alive && Math.hypot(e.x - foe.x, e.z - foe.z) < 1.6) e.damage(dmg * CFG.hero.cleave, 'melee');
      }
      text(foe.x, 1.9 * foe.scale + 0.5, foe.z, String(Math.round(dmg)), 'dmg', 0.7);
      burst(foe.x, 1.1 * foe.scale, foe.z, 0xff5a3a, 4, { speed: 3, up: 2, size: 0.1, life: 0.35 });
      Sfx.play('hit');
    }
  } else if (hero.stack.length < capacity()) {
    const node = World.nearestHarvestable(hero.x, hero.z, CFG.hero.harvestRange, hero.r);
    if (node) {
      if (!hero.moving) targetFacing = Math.atan2(node.x - hero.x, node.z - hero.z);
      harvestT += dt;
      const need = CFG.hero.harvest[G.up.tools] * CFG.res[node.type].hard;
      if (!swingStarted && harvestT >= need - 0.12) {
        swingStarted = true;
        swingT = 0;
      }
      if (harvestT >= need) {
        harvestT = 0;
        swingStarted = false;
        const from = new THREE.Vector3(node.x, 1.0, node.z);
        const t = World.harvest(node);
        if (t) {
          hero.stack.push(t);
          hero.inbound++;
          fly(t, from, stackTop, {
            dur: 0.3,
            arc: 1.2,
            done: () => {
              hero.inbound = Math.max(0, hero.inbound - 1);
            },
          });
          Sfx.play(t === 'wood' ? 'chop' : 'mine');
        }
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
  if (sinceHit > CFG.hero.regenDelay && hero.hp < mh) hero.hp = Math.min(mh, hero.hp + CFG.hero.regen * dt);
  if (hero.hp > mh) hero.hp = mh;
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) setFlash(m, false);
  }

  hero.facing = angleLerp(hero.facing, targetFacing, Math.min(1, dt * 14));
  m.group.position.set(hero.x, 0, hero.z);
  m.group.rotation.y = hero.facing;
  animateHumanoid(m, dt, hero.moving, spd, swingT);
  updateStack(hero.moving);
  bar.set(hero.hp / mh, hero.x, 2.45, hero.z);
}
