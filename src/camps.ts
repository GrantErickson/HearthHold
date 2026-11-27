import { scene } from './engine';
import { CFG, CAMP, CAMPS, campPlan, hpScale, waveClearBonus, type CampKind } from './config';
import { G, actOf, type DamageKind, type EnemyType } from './state';
import { campModel, hitPulse, updateLook, type CampModel } from './models';
import { Units, Soldier, type Enemy } from './units';
import { hero } from './hero';
import { addCollider, removeCollider } from './structures';
import { nodes } from './world';
import { Bar, boom, burst, dropCoins, dust, fire, poof, ring, scorch, shakeAt, spark, text, puff, hitStop, kick } from './fx';
import { Sfx } from './audio';
import { emit, on } from './events';
import { gainXp } from './progress';
import { UI } from './ui';
import { easeOutBack } from './util';

/**
 * Enemy war camps (Act II on). Pitched out on the far field at the start of a
 * wave, they make every wave harder while they stand, and only the hero and
 * the soldiers who follow him out can tear them down.
 */

const MAP = CFG.map;
const KINDS = Object.keys(CAMPS) as CampKind[];

/** Guards by act: whoever the camp keeps at hand. */
const GUARDS: EnemyType[][] = [
  ['raider', 'raider', 'archer'],
  ['berserker', 'raider', 'archer', 'shield', 'wolf'],
  ['skeleton', 'wraith', 'archer', 'shield', 'skeleton'],
  ['icewolf', 'berserker', 'frostmage', 'shield', 'icewolf'],
  ['knight', 'berserker', 'archer', 'shield', 'knight'],
];

/** Guard posts round a camp (angles / π; 0.5 is straight out front, toward the wall). */
const GUARD_POSTS = [0.18, 0.82, 0, 1, 1.3, 1.7];

let nextId = 1;

export class Camp {
  readonly isStruct = false;
  readonly hw = 0;
  readonly hd = 0;
  readonly r = CAMP.r;
  readonly aimY = 1.4;
  readonly kind: CampKind;
  readonly id: string;
  x: number;
  z: number;
  alive = true;
  removed = false;
  hp: number;
  maxHp: number;
  wave: number;
  /** Seconds until it's raised (no effect before that). */
  buildT: number;
  /** Rams or thieves it still sends this wave, and when the next one goes. */
  charges = 0;
  sendT = 0;
  beatT = 0;
  beat = 0;
  workT = 0;
  fxT = 0;
  flashCd = 0;
  deathT = 0;
  crewT = 1;
  m: CampModel;
  bar: Bar;
  guards: Enemy[] = [];

  constructor(kind: CampKind, x: number, z: number, wave: number, built = false) {
    this.kind = kind;
    this.id = 'camp' + nextId++;
    this.x = x;
    this.z = z;
    this.wave = wave;
    this.hp = this.maxHp = Math.round(CAMP.hp * hpScale(wave));
    this.buildT = built ? 0 : CAMP.build;
    this.m = campModel(kind, !G.autotest);
    this.m.group.position.set(x, 0, z);
    this.m.group.scale.set(1, built ? 1 : 0.05, 1);
    if (!G.autotest) scene.add(this.m.group);
    this.bar = new Bar(2.6, 0xe0453a, 0.2);
    addCollider(this.id, x, z, 1.55, 1.55);
  }

  get def() {
    return CAMPS[this.kind];
  }

  /** Raised and working. */
  get up(): boolean {
    return this.alive && this.buildT <= 0;
  }

  /** Only the hero and his foot soldiers can tear a camp down. */
  damage(amount: number, _kind: DamageKind, src?: unknown): void {
    if (!this.alive) return;
    if (src !== hero && !(src instanceof Soldier && !src.ranged)) return;
    this.hp -= amount;
    hitPulse(this.m, 0.35);
    if (this.flashCd <= 0) {
      this.flashCd = 0.14;
      burst(this.x + (Math.random() - 0.5) * 1.6, 1 + Math.random() * 0.8, this.z + 1, 0x9a7448, 4, { speed: 3.5, up: 3.5, size: 0.13 });
      spark(this.x + (Math.random() - 0.5) * 1.2, 1.1, this.z + 1.2, 0xfff0c8, 0.8, 0.2);
      Sfx.at('chop', this.x, this.z, 0.7);
    }
    if (this.hp <= 0) this.raze();
  }

  /** Fill up the guard post: they march in from the north edge. */
  fillGuards(w: number): void {
    this.guards = this.guards.filter((g) => g.alive);
    const want = CAMP.guards[actOf(w) - 1] ?? 0;
    const pool = GUARDS[actOf(w) - 1];
    const taken = new Set(this.guards.map((g) => g.guardSlot));
    for (let n = this.guards.length; n < want; n++) {
      // Posts on the flanks and behind: the lane out front stays clear for rams and thieves.
      const i = GUARD_POSTS.findIndex((_, k) => !taken.has(k));
      taken.add(i);
      const a = Math.PI * GUARD_POSTS[i];
      const px = this.x + Math.cos(a) * 3.4;
      const pz = this.z + Math.sin(a) * 3.1;
      const e = Units.spawnEnemy(pool[i % pool.length], this.x + (Math.random() - 0.5) * 6, MAP.spawnZ + Math.random() * 2, Math.max(1, w));
      e.setGuard(px, pz);
      e.guardSlot = i;
      this.guards.push(e);
    }
  }

  private raze(): void {
    this.alive = false;
    this.hp = 0;
    this.deathT = 0;
    this.bar.hide();
    removeCollider(this.id);
    const w = Math.max(this.wave, G.wave);
    const coins = Math.round(waveClearBonus(w) * CAMP.coins);
    dropCoins(this.x, this.z + 1, coins);
    gainXp(10 + w * 2);
    G.stats.camps++;
    boom(this.x, 0.8, this.z, 2.9, { big: true, color: 0xffb04a, chunks: 26, smoke: 0x9a8e82 });
    puff(this.x, 1.2, this.z, 0x8a7a6a, { n: 10, spread: 2, size: 1.1, life: 1.4, up: 2.2, out: 1.5, grow: 0.8 });
    burst(this.x, 1.5, this.z, 0x9a2a22, 12, { speed: 5, up: 6, size: 0.2 });
    burst(this.x, 1.5, this.z, 0xc9a477, 14, { speed: 4.5, up: 5, size: 0.22 });
    ring(this.x, this.z, 0xffd54a, 5.5, 0.8);
    scorch(this.x, this.z, 6, 0.6, 24);
    text(this.x, 4.4, this.z, `${this.def.name} razed! +${coins}`, 'gold big', 2.2);
    Sfx.at('bigexplode', this.x, this.z, 1);
    Sfx.at('crumble', this.x, this.z, 1);
    hitStop(0.09);
    shakeAt(this.x, this.z, 0.5, 0.85);
    if (Math.hypot(hero.x - this.x, hero.z - this.z) < 10) kick(0.5);
    // Their guards lose heart and run for it.
    for (const g of this.guards) if (g.alive) g.rout();
    this.guards.length = 0;
    emit('threat', { kind: 'campDown', camp: this, amount: coins });
  }

  update(dt: number): void {
    const g = this.m.group;
    if (!this.alive) {
      // Collapse into a heap, then go.
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.45);
      this.m.body.scale.set(1 + k * 0.25, 1 - k * 0.88, 1 + k * 0.25);
      if (this.deathT > 0.5 && this.deathT - dt <= 0.5) poof(this.x, 0.6, this.z, 2.2, 0xd8ccb8);
      if (this.deathT > 0.75) {
        g.visible = false;
        this.removed = true;
      }
      return;
    }
    if (this.flashCd > 0) this.flashCd -= dt;
    updateLook(this.m, dt, null, G.time);
    const show = !G.autotest;
    if (this.buildT > 0) {
      // Going up: posts, hides and a bit of hammering.
      this.buildT -= dt;
      const k = 1 - Math.max(0, this.buildT) / CAMP.build;
      g.scale.set(1, 0.05 + 0.95 * easeOutBack(k), 1);
      this.fxT -= dt;
      if (show && this.fxT <= 0) {
        this.fxT = 0.35;
        dust(this.x + (Math.random() - 0.5) * 3, this.z + (Math.random() - 0.5) * 3, 0.7);
        Sfx.at('chop', this.x, this.z, 0.4);
      }
      if (this.buildT <= 0) {
        g.scale.set(1, 1, 1);
        if (show) {
          puff(this.x, 0.5, this.z, 0xd8ccb8, { n: 8, spread: 2.2, size: 0.8, life: 0.9, up: 1.2, out: 2 });
          text(this.x, 4, this.z, `${this.def.icon} ${this.def.name}`, 'red', 1.6);
        }
      }
    }
    if (show) {
      // Camp fire.
      this.fxT -= dt;
      if (this.fxT <= 0 && this.buildT <= 0) {
        this.fxT = 0.16;
        fire(this.x - 1.55, 0.45, this.z + 1.35, { n: 1, spread: 0.08, size: 0.13, life: 0.35, up: 1.8, out: 0.15 });
      }
    }
    if (this.up) this.work(dt, show);
    this.bar.set(this.hp / this.maxHp, this.x, 4.2, this.z, this.hp < this.maxHp);
  }

  /** What the camp does while it stands (and how it looks doing it). */
  private work(dt: number, show: boolean): void {
    const crew = this.m.crew;
    const wave = G.phase === 'wave';
    this.crewT += dt / 0.3;
    if (this.kind === 'drums') {
      // Boom, boom, ba-boom: on every beat the skin jumps and the ground thuds.
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beat = (this.beat + 1) % 4;
        this.beatT = wave ? (this.beat === 3 ? 0.26 : 0.52) : 1.4;
        this.crewT = 0;
        if (this.m.skin) this.m.skin.scale.set(1.06, 3, 1.06);
        if (show) {
          if (wave) Sfx.at('wardrum', this.x, this.z, this.beat === 0 ? 1 : 0.7);
          if (this.beat === 0) ring(this.x, this.z + 0.35, 0xff6a4a, 3.2, 0.45);
        }
      }
      if (this.m.skin) {
        const s = this.m.skin.scale;
        s.y += (1 - s.y) * Math.min(1, dt * 14);
        s.x = s.z = 1 + (s.y - 1) * 0.03;
      }
      crew.anim(dt, false, 0, Math.min(1, this.crewT));
    } else if (this.kind === 'workshop') {
      this.workT -= dt;
      if (this.workT <= 0) {
        this.workT = 0.6;
        this.crewT = 0;
        if (show) {
          spark(this.x + 1.3, 0.95, this.z + 0.55, 0xffd27a, 0.7, 0.2);
          Sfx.at('clang', this.x, this.z, 0.25);
        }
      }
      crew.anim(dt, false, 0, Math.min(1, this.crewT));
      if (wave && this.charges > 0) {
        this.sendT -= dt;
        if (this.sendT <= 0) {
          this.sendT = CAMP.workshop.every;
          this.charges--;
          const type: EnemyType = G.wave >= 50 && this.charges % 2 === 0 ? 'trebuchet' : 'ram';
          Units.spawnEnemy(type, this.x, this.z + 3.2, Math.max(1, G.wave));
          if (show) {
            puff(this.x, 0.6, this.z + 2.6, 0xd8ccb8, { n: 6, spread: 1.2, size: 0.7, life: 0.8, up: 1, out: 1.5 });
            text(this.x, 3.6, this.z, type === 'ram' ? 'A ram rolls out!' : 'A trebuchet rolls out!', 'red', 1.4);
            Sfx.at('build', this.x, this.z, 0.7);
          }
        }
      }
    } else if (this.kind === 'warren') {
      // A goblin pops up out of the hole to look around.
      const t = G.time * 0.7 + this.x;
      const up = Math.max(0, Math.sin(t)) ** 0.5;
      crew.group.position.y = -1.4 + up * 1.4;
      crew.group.rotation.y = Math.sin(t * 2.3) * 0.6;
      crew.anim(dt, false, 0, 1);
      if (wave && this.charges > 0) {
        this.sendT -= dt;
        if (this.sendT <= 0) {
          this.sendT = CAMP.warren.every;
          this.charges--;
          const e = Units.spawnEnemy('thief', this.x, this.z + 1.6, Math.max(1, G.wave));
          e.emergeT = 0.5;
          e.facing = 0;
          if (show) {
            dust(this.x, this.z + 1.6, 0.9, 0xb89a72);
            Sfx.at('burrow', this.x, this.z, 0.6);
          }
        }
      }
    } else {
      // The shaman dances; green wisps rise from the fire bowl.
      crew.group.rotation.y = 0.5 + Math.sin(G.time * 2.2) * 0.9;
      this.workT -= dt;
      if (this.workT <= 0) {
        this.workT = 0.9;
        this.crewT = 0;
      }
      crew.anim(dt, true, 2, Math.min(1, this.crewT));
      if (show) {
        this.beatT -= dt;
        if (this.beatT <= 0) {
          this.beatT = 0.3;
          burst(this.x + 0.95, 1.1, this.z + 1.05, 0x7dff8a, 1, { glow: true, speed: 0.5, up: 2.6, life: 0.9 });
          if (wave && Math.random() < 0.15) ring(this.x, this.z, 0x7dff8a, 4, 0.6);
        }
      }
    }
  }

  dispose(): void {
    scene.remove(this.m.group);
    this.bar.dispose();
    removeCollider(this.id);
  }
}

export const camps: Camp[] = [];

/** What the standing camps do to every enemy on the field. */
export const CampFx = { speed: 1, dmg: 1, regen: 0 };

function refreshFx(): void {
  CampFx.speed = 1;
  CampFx.dmg = 1;
  CampFx.regen = 0;
  for (const c of camps) {
    if (!c.up) continue;
    if (c.kind === 'drums') {
      CampFx.speed = CAMP.drums.speed;
      CampFx.dmg = CAMP.drums.dmg;
    } else if (c.kind === 'totem') CampFx.regen = CAMP.totem.regen;
  }
}

/** A clear spot on the far field, away from other camps. */
function campSpot(): { x: number; z: number } {
  let best = { x: 0, z: -42 };
  let bs = -Infinity;
  for (let i = 0; i < 50; i++) {
    const x = (Math.random() * 2 - 1) * 22;
    const z = -50 + Math.random() * 14;
    let s = Math.random() * 4;
    for (const c of camps) if (c.alive) s -= Math.max(0, 15 - Math.hypot(c.x - x, c.z - z)) * 4;
    for (const n of nodes) if (n.state !== 'hidden' && Math.hypot(n.x - x, n.z - z) < 4) s -= 30;
    if (s > bs) {
      bs = s;
      best = { x, z };
    }
  }
  return best;
}

function pitch(w: number): Camp[] {
  const plan = campPlan(w);
  const standing = camps.filter((c) => c.alive).length;
  const out: Camp[] = [];
  let n = Math.min(plan.add, Math.max(0, plan.cap - standing));
  while (n-- > 0) {
    const free = KINDS.filter((k) => w >= CAMPS[k].from && !camps.some((c) => c.alive && c.kind === k));
    if (!free.length) break;
    const kind = free[Math.floor(Math.random() * free.length)];
    const p = campSpot();
    const c = new Camp(kind, p.x, p.z, w);
    camps.push(c);
    out.push(c);
  }
  return out;
}

on('waveStart', (arg) => {
  const w = arg as number;
  for (const c of camps) {
    if (!c.alive) continue;
    c.charges = c.kind === 'workshop' ? CAMP.workshop.n : c.kind === 'warren' ? CAMP.warren.n + (w >= 70 ? 2 : 0) : 0;
    c.sendT = 7 + Math.random() * 4;
  }
  const fresh = pitch(w);
  for (const c of fresh) {
    c.charges = c.kind === 'workshop' ? CAMP.workshop.n : c.kind === 'warren' ? CAMP.warren.n + (w >= 70 ? 2 : 0) : 0;
    c.sendT = CAMP.build + 5 + Math.random() * 4;
  }
  for (const c of camps) if (c.alive) c.fillGuards(w);
  if (fresh.length && !G.autotest) {
    Sfx.play('warn', 0.7);
    const c = fresh[0];
    if (!G.flags.tipCamp) {
      G.flags.tipCamp = true;
      UI.banner('Enemy camp!', `${c.def.icon} ${c.def.name}: ${c.def.desc} while it stands. Go out and tear it down. Your soldiers follow you.`, 'red', 4);
    } else UI.toast(`⛺ ${fresh.map((f) => `${f.def.icon} ${f.def.name}`).join(' and ')} pitched on the field`);
  }
});

export function updateCamps(dt: number): void {
  for (const c of camps) c.update(dt);
  for (let i = camps.length - 1; i >= 0; i--) {
    if (camps[i].removed) {
      camps[i].dispose();
      camps.splice(i, 1);
    }
  }
  refreshFx();
}

/** The nearest standing camp within reach of a circle (for the hero and soldiers). */
export function campNear(x: number, z: number, reach: number): Camp | null {
  let best: Camp | null = null;
  let bd = reach;
  for (const c of camps) {
    if (!c.alive) continue;
    const d = Math.hypot(c.x - x, c.z - z) - c.r;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** For the checkpoint: [kind, x, z, hp fraction, wave]. */
export function campsSave(): [CampKind, number, number, number, number][] {
  return camps.filter((c) => c.alive).map((c) => [c.kind, +c.x.toFixed(1), +c.z.toFixed(1), +(c.hp / c.maxHp).toFixed(3), c.wave]);
}

export function campsRestore(list: [CampKind, number, number, number, number][] | undefined): void {
  for (const c of camps) c.dispose();
  camps.length = 0;
  for (const [kind, x, z, frac, wave] of list ?? []) {
    if (!CAMPS[kind]) continue;
    const c = new Camp(kind, x, z, wave, true);
    c.hp = c.maxHp * Math.max(0.05, Math.min(1, frac));
    camps.push(c);
  }
  refreshFx();
}
