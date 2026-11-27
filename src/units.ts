import * as THREE from 'three';
import { scene } from './engine';
import {
  CFG, AFFIXES, MODS, hpScale, bossScale, dmgScale, coinScale, xpScale, marchScale, type EnemyDef,
} from './config';
import { G, type DamageKind, type EnemyType, type ResType, type Target } from './state';
import { unitModel, setModelMat, hitPulse, updateLook, itemGeo, ITEM_H, makeMesh, Mat, U, type UnitModel } from './models';
import * as St from './structures';
import { hero, heroSlow, heroStun } from './hero';
import { World, type ResNode } from './world';
import { Bar, burst, dropCoins, text, ring, beam, boom, poof, impact, dust, spark, shatter, warnCircle, hitStop, shakeAt, kick, scorch } from './fx';
import { Sfx } from './audio';
import { Proj } from './projectiles';
import { Stat, gainXp } from './progress';
import { emit } from './events';
import { aimPoint, angleLerp, clamp, surfDist } from './util';

const MAP = CFG.map;
const W = MAP.wallZ;
const PHYSICAL = new Set<DamageKind>(['melee', 'arrow', 'splash', 'pierce']);

/** Impact star colour per damage type (splash gets its own explosion instead). */
const HIT_COLOR: Partial<Record<DamageKind, number>> = {
  melee: 0xfff4d0,
  arrow: 0xfff0c0,
  pierce: 0xfff0c0,
  magic: 0xe0a8ff,
  fire: 0xffa040,
  holy: 0xffe27a,
};

/**
 * Cartoon knock-out: squash flat, spring up with a spin, then vanish in a puff.
 * Returns true when the unit can be removed.
 */
function cartoonDeath(m: UnitModel, t: number, x: number, z: number, scale: number, smoke: number): boolean {
  const g = m.group;
  const b = m.body;
  if (t < 0.12) {
    const k = t / 0.12;
    b.scale.set(1 + 0.35 * k, 1 - 0.45 * k, 1 + 0.35 * k);
  } else if (t < 0.38) {
    const k = (t - 0.12) / 0.26;
    b.scale.set(1.35 - 0.6 * k, 0.55 + 0.6 * k, 1.35 - 0.6 * k);
    g.position.y = Math.sin(k * Math.PI) * 0.7 * scale;
    g.rotation.y += 0.35;
  } else {
    poof(x, 0.8 * scale, z, scale, smoke);
    g.visible = false;
    return true;
  }
  return false;
}

function structId(t: Target): string | undefined {
  return t.isStruct ? (t as St.Structure).id : undefined;
}

/** Status effects shared by everything that can be slowed or stunned. */
interface Statused {
  slowT: number;
  slowAmt: number;
  stunT: number;
}
export function applySlow(u: Statused & { slowImmune?: boolean }, amount: number, dur: number): void {
  if (u.slowImmune) return;
  u.slowAmt = Math.max(u.slowT > 0 ? u.slowAmt : 0, amount);
  u.slowT = Math.max(u.slowT, dur);
}

const ringGeo = new THREE.RingGeometry(0.75, 1, 28).rotateX(-Math.PI / 2);
const ringMats = new Map<number, THREE.MeshBasicMaterial>();
function ringMat(c: number): THREE.MeshBasicMaterial {
  let m = ringMats.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    ringMats.set(c, m);
  }
  return m;
}

/** Magic ward bubble: only the hero's blows can break it. */
const wardGeo = new THREE.IcosahedronGeometry(1, 2);
const WARD_COLOR = 0xb98aff;
const wardMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(WARD_COLOR) }, uTime: U.uTime },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vP;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      vP = position;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uTime;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vP;
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      f = pow(f, 1.8);
      float band = smoothstep(0.86, 1.0, fract(vP.y * 3.0 - uTime * 0.8)) * 0.6;
      gl_FragColor = vec4(uColor * (0.1 + f * 1.4 + band * (0.3 + f)), 1.0);
    }`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
export const wardMaterial = (): THREE.Material => wardMat;

/** Seconds a climber needs to get over a wall. */
const CLIMB_TIME = { scaler: 1.5, thief: 1.0 } as Record<string, number>;

/** A fixed point that units can walk to (thieves' treasury and escape). */
function point(x: number, z: number): Target {
  return { x, z, r: 0, hw: 0, hd: 0, alive: true, isStruct: false, damage: () => undefined };
}

// ───────────────────────────── Enemies ─────────────────────────────

export interface SpawnOpts {
  champion?: boolean;
  affix?: string | null;
  summoned?: boolean;
}

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
  xp: number;
  speed: number;
  scale: number;
  armor: number;
  interval: number;
  atkT: number;
  retargetT = 0;
  target: Target | null = null;
  swingT = 1;
  flashT = 0;
  flashCd = 0;
  deathT = 0;
  poofed = false;
  summonT: number;
  healT: number;
  slamT: number;
  novaT: number;
  lobT: number;
  shieldT: number;
  chargeT = 0;
  chargeCd = 3;
  shieldHp = 0;
  shieldMax = 1;
  facing = 0;
  moving = false;
  flying: boolean;
  flyH: number;
  aimY: number;
  slowT = 0;
  slowAmt = 0;
  burnT = 0;
  burnDps = 0;
  stunT = 0;
  slowImmune: boolean;
  enraged = false;
  champion: boolean;
  affix: string | null;
  summoned: boolean;
  heroHit = false;
  exploded = false;
  wave: number;
  m: UnitModel;
  bar: Bar;
  aura: THREE.Mesh | null = null;
  /** Knock-back velocity. */
  kx = 0;
  kz = 0;
  /** Blown into the air by the blow that killed it. */
  launch: { vx: number; vy: number; vz: number; y: number; spin: number } | null = null;
  /** Wall climbing (seconds left, total, from/to z, height). */
  climbT = 0;
  climbDur = 1;
  climbZ0 = 0;
  climbZ1 = 0;
  climbH = 3;
  /** Rising out of a tunnel. */
  emergeT = 0;
  /** Thieves: coins carried, and whether they're running for it. */
  loot = 0;
  fleeing = false;
  goal: Target | null = null;
  /** Hero hits needed to break the ward (0 = no ward). */
  wardHits = 0;
  wardMax = 0;
  wardPhase = 0;
  wardPhases: number[] = [];
  ward: THREE.Mesh | null = null;
  /** Takes extra damage after its ward was shattered. */
  vulnT = 0;
  /** Boss slam wind-up. */
  slamWind = 0;
  stepT = 0;

  constructor(type: EnemyType, x: number, z: number, wave: number, o: SpawnOpts = {}) {
    this.type = type;
    this.wave = wave;
    const d = (this.d = CFG.enemies[type]);
    const mod = MODS[G.mod];
    this.champion = !!o.champion;
    this.affix = o.affix ?? null;
    this.summoned = !!o.summoned;
    this.x = x;
    this.z = z;
    const elite = this.affix ? 1 : 0;
    const champ = this.champion;
    this.r = d.r * (champ ? 1.35 : 1);
    let hp = d.hp * (d.boss ? bossScale(wave) : hpScale(wave)) * (mod?.hp ?? 1);
    if (champ) hp *= 8;
    if (this.affix === 'armored') hp *= 1.4;
    if (this.affix === 'vampiric') hp *= 1.2;
    if (elite) hp *= 1.5;
    this.hp = this.maxHp = Math.round(hp);
    const armorScale = 1 + 0.02 * (wave - 1);
    this.armor = ((d.armor ?? 0) + (mod?.armor ?? 0) + (this.affix === 'armored' ? 3 : 0)) * armorScale;
    this.dmg = d.dmg * dmgScale(wave) * (champ ? 2 : 1) * (elite ? 1.2 : 1);
    const coinMul = (mod?.coins ?? 1) * (elite ? 2.5 : 1) * (champ ? 10 : 1) * (this.summoned ? 0.5 : 1);
    this.coins = d.coins * coinScale(wave) * coinMul;
    this.xp = d.xp * xpScale(wave) * (elite ? 2.5 : 1) * (champ ? 8 : 1) * (this.summoned ? 0.5 : 1);
    this.speed = d.speed * (0.9 + Math.random() * 0.2) * (mod?.speed ?? 1) * (this.affix === 'swift' ? 1.45 : 1) * Stat.enemySpeedMul() * (champ ? 0.9 : 1) * marchScale(wave);
    this.interval = d.interval;
    this.scale = d.scale * (champ ? 1.45 : 1) * (elite ? 1.12 : 1);
    this.slowImmune = !!d.slowImmune || !!d.boss;
    this.atkT = Math.random() * 0.5;
    this.summonT = d.summon ? d.summon.every * (0.5 + Math.random() * 0.5) : 0;
    this.healT = d.heal ? d.heal.every : 0;
    this.slamT = d.slam ? d.slam.every * 0.6 : 0;
    this.novaT = d.nova ? d.nova.every * 0.5 : 0;
    this.lobT = d.lob ? d.lob.every * 0.5 : 0;
    this.shieldT = d.shield ? d.shield.every * 0.4 : 0;
    if (this.affix === 'shielded') {
      this.shieldHp = this.shieldMax = this.maxHp * 0.6;
    }
    this.flying = !!d.flying;
    this.flyH = d.flying ? (type === 'dragon' ? 4.6 : type === 'drake' ? 3.2 : 2.4) : 0;
    this.aimY = this.flyH + 1.1 * Math.min(2, this.scale);
    this.m = unitModel(type, !G.autotest);
    this.m.group.scale.setScalar(this.scale);
    this.m.group.position.set(x, this.flyH, z);
    if (!G.autotest) scene.add(this.m.group);
    const big = !!d.boss || champ;
    this.bar = new Bar(big ? 2.2 : 0.9, champ ? 0xf2a23a : 0xe0453a, big ? 0.2 : 0.12);
    const auraColor = champ ? 0xffc83a : this.affix ? AFFIXES[this.affix].color : 0;
    if (auraColor && !G.autotest) {
      this.aura = new THREE.Mesh(ringGeo, ringMat(auraColor));
      this.aura.scale.setScalar((this.r * 1.8) / this.scale);
      this.aura.position.y = 0.08 / this.scale;
      this.aura.renderOrder = 7;
      this.m.group.add(this.aura);
    }
    if (this.affix === 'warded') this.raiseWard(1, false);
    // From Act III on, bosses and champions the hero can reach raise wards as they weaken.
    if (this.flyH <= 4 && !d.siege) {
      if (d.boss && wave >= 40) this.wardPhases = wave >= 70 ? [0.66, 0.33] : [0.5];
      else if (champ && wave >= 45) this.wardPhases = [0.5];
    }
    if (d.thief) this.goal = point(0, 0);
  }

  get isBoss(): boolean {
    return !!this.d.boss || this.champion;
  }

  get title(): string {
    if (this.champion) return `${this.d.name} Champion`;
    if (this.affix) return `${AFFIXES[this.affix].name} ${this.d.name}`;
    return this.d.name;
  }

  /** Throw up a ward that only the hero can break. */
  raiseWard(hits: number, announce = true): void {
    this.wardHits = this.wardMax = hits;
    if (!G.autotest) {
      if (!this.ward) {
        this.ward = new THREE.Mesh(wardGeo, wardMat);
        this.ward.renderOrder = 18;
        this.m.group.add(this.ward);
      }
      const big = this.isBoss ? 1.25 : 1;
      this.ward.scale.set(0.95 * big, 1.25 * big, 0.95 * big);
      this.ward.position.y = 1.05 + (this.d.model === 'mammoth' ? 1.4 : 0);
      this.ward.visible = true;
    }
    if (announce) {
      ring(this.x, this.z, WARD_COLOR, 4 * Math.min(2, this.scale), 0.7);
      burst(this.x, 1.6 * this.scale, this.z, WARD_COLOR, 20, { glow: true, speed: 4, up: 4 });
      text(this.x, 3.4 * Math.min(2, this.scale), this.z, 'Warded! Strike it yourself!', 'xp big', 1.8);
      Sfx.at('magic', this.x, this.z, 1);
      Sfx.play('warn', 0.8);
      emit('threat', { kind: 'ward', e: this });
    }
  }

  private breakWard(): void {
    this.wardHits = 0;
    if (this.ward) this.ward.visible = false;
    const y = 1.2 * Math.min(2.4, this.scale) + this.flyH;
    shatter(this.x, y, this.z, Math.min(2.4, this.scale), 0xc8a8ff);
    Sfx.at('shatter', this.x, this.z, 1);
    hitStop(this.isBoss ? 0.14 : 0.06);
    shakeAt(this.x, this.z, this.isBoss ? 0.45 : 0.15);
    if (this.isBoss) {
      kick(0.6);
      this.stunT = Math.max(this.stunT, 2.5);
      this.vulnT = 6;
      this.slamWind = 0;
      text(this.x, 3.6 * Math.min(2, this.scale), this.z, 'Ward shattered! Weak point exposed!', 'gold big', 1.8);
    } else text(this.x, 2.6 * this.scale, this.z, 'Shattered!', 'gold', 1);
  }

  /** Shoved away from a blow. Dead small enemies get launched into the air instead. */
  knock(fx: number, fz: number, power: number): void {
    if (this.d.siege || this.climbT > 0 || this.emergeT > 0 || power <= 0) return;
    let dx = this.x - fx;
    let dz = this.z - fz;
    const L = Math.hypot(dx, dz);
    if (L < 0.01) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
    } else {
      dx /= L;
      dz /= L;
    }
    if (!this.alive) {
      if (this.exploded || this.isBoss || this.launch || this.flying || this.deathT > 0.05 || power < 4 || this.scale > 1.6) return;
      const out = 2 + power * 0.45;
      this.launch = { vx: dx * out, vy: 6.5 + power * 0.35 + Math.random() * 2.5, vz: dz * out, y: 0, spin: (Math.random() - 0.5) * 16 };
      if (Math.random() < 0.4) Sfx.at('launch', this.x, this.z, 0.7);
      return;
    }
    let k = power;
    if (this.isBoss) k *= 0.1;
    else if (this.scale > 1.6 || this.d.model === 'mammoth') k *= 0.3;
    else if (this.flying) k *= 0.6;
    this.kx += dx * k;
    this.kz += dz * k;
  }

  /** Raw HP loss without hit flash (burning, shields). */
  private lose(amount: number): void {
    if (this.wardHits > 0) return;
    const phase = this.wardPhases[this.wardPhase];
    if (phase !== undefined && (this.hp - amount) / this.maxHp < phase) {
      // Never skip past a ward phase, however hard the hit.
      this.hp = this.maxHp * phase;
      this.wardPhase++;
      this.raiseWard(this.d.boss ? 3 + Math.floor(this.wave / 30) : 2);
      return;
    }
    if (this.shieldHp > 0) {
      const a = Math.min(this.shieldHp, amount);
      this.shieldHp -= a;
      amount -= a;
      if (this.shieldHp <= 0) burst(this.x, 1.2 * this.scale + this.flyH, this.z, 0x8fb4ff, 10, { glow: true, speed: 4, up: 2 });
    }
    this.hp -= amount;
    if (this.d.enrage && !this.enraged && this.hp < this.maxHp * 0.5) {
      this.enraged = true;
      this.speed *= 1.45;
      this.interval *= 0.65;
      text(this.x, 3 * this.scale, this.z, this.isBoss ? `${this.d.name} is enraged!` : 'Enraged!', 'red', 1.4);
      burst(this.x, 1.2 * this.scale, this.z, 0xff3a2a, 14, { glow: true, speed: 4, up: 3 });
      if (this.isBoss) Sfx.at('roar', this.x, this.z, 0.8);
    }
    if (this.hp <= 0) this.die();
  }

  damage(amount: number, kind: DamageKind, src?: unknown): void {
    if (!this.alive) return;
    const d = this.d;
    if (kind === 'arrow' && d.arrowResist) amount *= d.arrowResist;
    if (kind === 'splash' && d.splashResist) amount *= d.splashResist;
    if (d.ethereal && PHYSICAL.has(kind)) amount *= 0.5;
    if (d.undead && kind === 'holy') amount *= 2;
    if (this.armor > 0 && PHYSICAL.has(kind)) amount = Math.max(amount * 0.25, amount - this.armor);
    if (src === hero) this.heroHit = true;
    const big = this.isBoss || this.scale > 1.6;
    if (this.wardHits > 0) {
      const y = 1.2 * Math.min(2.4, this.scale) + this.flyH;
      if (src !== hero) {
        // Towers and troops just bounce off.
        if (this.flashCd <= 0) {
          this.flashCd = 0.18;
          spark(this.x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.6, this.z + 0.5, 0xd8c0ff, 0.7, 0.2);
          Sfx.at('ward', this.x, this.z, 0.5);
        }
        return;
      }
      this.wardHits--;
      if (this.wardHits > 0) {
        hitPulse(this.m, big ? 0.3 : 1);
        impact(this.x, y, this.z + 0.4, 0xd8c0ff, true, this.x - hero.x, this.z - hero.z);
        text(this.x, y + 1.4, this.z, `Ward ${this.wardHits}`, 'xp', 0.6);
        Sfx.at('clang', this.x, this.z, 0.9);
        return;
      }
      this.breakWard();
    }
    if (this.vulnT > 0) amount *= 1.5;
    // A squash and a soft glow; big enemies that are hit constantly react less.
    hitPulse(this.m, big ? 0.22 : 1);
    if (this.flashCd <= 0) {
      this.flashCd = big ? 0.3 : 0.12;
      const c = HIT_COLOR[kind];
      const fromHero = src === hero;
      if (c) impact(this.x + (Math.random() - 0.5) * 0.4 * this.scale, (this.aimY ?? 1.1) + (Math.random() - 0.3) * 0.4 * this.scale, this.z + 0.3, c, kind === 'melee' || kind === 'pierce', fromHero ? this.x - hero.x : undefined, fromHero ? this.z - hero.z : undefined);
    }
    this.lose(amount);
  }

  burn(dps: number, dur: number): void {
    if (!this.alive) return;
    this.burnDps = Math.max(this.burnT > 0 ? this.burnDps : 0, dps);
    this.burnT = Math.max(this.burnT, dur);
  }

  private die(): void {
    this.alive = false;
    this.hp = 0;
    this.deathT = 0;
    this.bar.hide();
    setModelMat(this.m, null);
    if (this.aura) this.aura.visible = false;
    if (this.ward) this.ward.visible = false;
    if (this.exploded) return;
    G.stats.kills++;
    if (this.loot > 0) {
      dropCoins(this.x, this.z, this.loot);
      text(this.x, 2.6, this.z, `Recovered ${Math.round(this.loot)}!`, 'gold', 1.4);
      emit('threat', { kind: 'recovered', amount: this.loot });
      this.loot = 0;
    }
    dropCoins(this.x, this.z, this.coins * Stat.killCoinMul() + Stat.killCoinFlat());
    gainXp(this.xp * (this.heroHit ? 1.5 : 1));
    if (this.d.undead) burst(this.x, 1 + this.flyH, this.z, 0x9affc8, 8, { speed: 2, up: 3, glow: true });
    Sfx.at('die', this.x, this.z);
    if (this.d.bomb) explode(this.x, this.z, this.d.bomb.radius, this.dmg + this.d.bomb.dmg * dmgScale(this.wave) * 0.6, 'enemies');
    if (this.affix === 'explosive') explode(this.x, this.z, 2.6, 30 * dmgScale(this.wave), 'defenders');
    if (this.isBoss) {
      G.shake = Math.max(G.shake, 0.6);
      hitStop(0.2);
      kick(0.7);
      text(this.x, 3.5 + this.flyH, this.z, `${this.title} defeated!`, 'gold big', 2);
      burst(this.x, 1.5 + this.flyH, this.z, 0xffd54a, 30, { glow: true, speed: 7, up: 6, life: 1 });
      ring(this.x, this.z, 0xffd54a, 7, 0.8);
      if (this.d.boss) {
        G.stats.bosses++;
        emit('bossKilled', this);
      }
    }
  }

  /** Units that enemies can fight. */
  private pickTarget(): void {
    const d = this.d;
    if (d.thief && this.goal) {
      if (this.fleeing) {
        this.goal.x = clamp(this.goal.x, MAP.minX + 2, MAP.maxX - 2);
        this.goal.z = MAP.spawnZ - 3;
      } else {
        this.goal.x = St.market.coin.x;
        this.goal.z = St.market.coin.z;
      }
      this.target = this.goal;
      return;
    }
    if (d.siege) {
      this.target = this.siegeTarget();
      return;
    }
    if (d.hunter) {
      this.target = St.nearestStructure(this.x, this.z, 60, false) ?? St.S.keep;
      return;
    }
    const passWalls = this.flying || !!d.ethereal;
    let best: Target | null = null;
    let bd = d.ranged ? d.range : this.flying ? 6 : 4.5;
    for (const t of defenders()) {
      if (!t.alive) continue;
      const dist = surfDist(this.x, this.z, this.r, t);
      if (dist >= bd) continue;
      if (!d.ranged && !passWalls && St.wallBetween(this.x, this.z, t.x, t.z)) continue;
      bd = dist;
      best = t;
    }
    if (!best) {
      bd = d.ranged ? d.range : 6;
      for (const t of St.attackables()) {
        const dist = surfDist(this.x, this.z, this.r, t);
        if (dist >= bd) continue;
        const [ax, az] = aimPoint(this.x, this.z, t);
        if (!d.ranged && !passWalls && St.wallBetween(this.x, this.z, ax, az)) continue;
        bd = dist;
        best = t;
      }
    }
    this.target = best ?? St.S.keep;
  }

  private siegeTarget(): Target {
    if (this.z < W) {
      const col = this.type === 'trebuchet' ? clamp(this.x, -14, 14) : this.x;
      const seg = St.S.walls[St.segIndex(col)];
      if (seg && seg.alive) return seg;
    }
    if (this.d.lob) return St.nearestStructure(this.x, this.z, 80, true) ?? St.S.keep;
    return St.nearestStructure(this.x, this.z, 10, false) ?? St.S.keep;
  }

  private abilities(dt: number): void {
    const d = this.d;
    if (d.summon) {
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = d.summon.every;
        summonAround(this, d.summon.type, d.summon.n);
      }
    }
    if (d.heal) {
      this.healT -= dt;
      if (this.healT <= 0) {
        this.healT = d.heal.every;
        let n = 0;
        for (const e of enemies) {
          if (!e.alive || e === this || e.hp >= e.maxHp) continue;
          if (Math.hypot(e.x - this.x, e.z - this.z) > d.heal.radius) continue;
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * d.heal.frac);
          burst(e.x, 1.2 * e.scale + e.flyH, e.z, 0x7dff8a, 4, { glow: true, speed: 1.5, up: 2.5 });
          n++;
        }
        if (n) {
          ring(this.x, this.z, 0x7dff8a, d.heal.radius, 0.6);
          Sfx.at('heal', this.x, this.z, 0.5);
        }
      }
    }
    if (this.affix === 'regen' || d.regen) {
      const rate = (d.regen ?? 0) + (this.affix === 'regen' ? 0.025 : 0);
      if (this.burnT <= 0) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * rate * dt);
    }
    if (d.shield) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) {
        this.shieldT = d.shield.every;
        this.shieldHp = this.shieldMax = this.maxHp * d.shield.frac;
        ring(this.x, this.z, 0x8fb4ff, 3.5, 0.6);
        text(this.x, 3 * this.scale, this.z, 'Shielded!', 'xp', 1);
        Sfx.at('magic', this.x, this.z);
      }
    }
    if (d.slam) {
      const s = d.slam;
      if (this.slamWind > 0) {
        // Telegraphed: the red circle fills, then the ground shakes. Get out!
        this.slamWind -= dt;
        if (this.slamWind <= 0) {
          this.swingT = 0.35;
          const dmg = s.dmg * dmgScale(this.wave);
          for (const u of defenders()) {
            if (!u.alive || Math.hypot(u.x - this.x, u.z - this.z) > s.radius) continue;
            u.damage(dmg, 'melee', this);
            if (u === hero) heroStun(s.stun);
            else (u as Soldier).stunT = s.stun;
          }
          ring(this.x, this.z, 0xd8b080, s.radius, 0.6);
          ring(this.x, this.z, 0xfff0d0, s.radius * 0.7, 0.35, 0.1);
          boom(this.x, 0.1, this.z, s.radius * 0.45, { dirt: true, smoke: 0xb8a888, chunks: 16 });
          scorch(this.x, this.z, s.radius * 1.4, 0.5, 6);
          shakeAt(this.x, this.z, 0.5, 0.9);
          if (Math.hypot(hero.x - this.x, hero.z - this.z) < s.radius * 2.5) {
            hitStop(0.09);
            kick(0.5);
          }
          Sfx.at('slam', this.x, this.z, 1);
        }
      } else {
        this.slamT -= dt;
        if (this.slamT <= 0) {
          const near = defenders().some((u) => u.alive && Math.hypot(u.x - this.x, u.z - this.z) < s.radius);
          if (near) {
            this.slamT = s.every;
            this.slamWind = 0.95;
            warnCircle(this.x, this.z, s.radius, 0.95, this);
            Sfx.at('warn', this.x, this.z, 1);
          } else this.slamT = 0.5;
        }
      }
    }
    if (d.nova) {
      this.novaT -= dt;
      if (this.novaT <= 0) {
        this.novaT = d.nova.every;
        const n = St.freezeAround(this.x, this.z, d.nova.radius, d.nova.dur);
        if (n) {
          ring(this.x, this.z, 0x9fe8ff, d.nova.radius, 0.9);
          burst(this.x, 1.5 * this.scale, this.z, 0xbff4ff, 24, { glow: true, speed: 8, up: 3, life: 0.8 });
          text(this.x, 3.2 * this.scale, this.z, 'Frost Nova!', 'xp', 1.2);
          Sfx.at('freeze', this.x, this.z, 1);
        }
      }
    }
    if (d.lob && this.type !== 'trebuchet') {
      this.lobT -= dt;
      if (this.lobT <= 0) {
        const t = St.nearestStructure(this.x, this.z, d.lob.range, true);
        if (t) {
          this.lobT = d.lob.every;
          this.swingT = 0;
          this.lobAt(t);
        } else this.lobT = 0.6;
      }
    }
    if (d.charge && this.z < W - 2) {
      this.chargeCd -= dt;
      if (this.chargeT > 0) this.chargeT -= dt;
      else if (this.chargeCd <= 0 && W - this.z < 12) {
        this.chargeT = 2;
        this.chargeCd = 9;
        text(this.x, 4.5, this.z, 'CHARGE!', 'red', 1.2);
        Sfx.at('roar', this.x, this.z, 0.9);
      }
    }
  }

  private lobAt(t: Target): void {
    const [ax, az] = aimPoint(this.x, this.z, t);
    const dist = Math.hypot(ax - this.x, az - this.z);
    const L = this.d.lob!;
    Proj.boulder(this.x, 2.2 * this.scale, this.z, ax, az, L.dmg * dmgScale(this.wave), L.splash, Math.max(0.9, dist / 11), true, this.type === 'giant' || this.type === 'jarl');
    Sfx.at('swing', this.x, this.z);
  }

  update(dt: number): void {
    if (!this.alive) {
      this.deathT += dt;
      if (this.exploded) {
        this.removed = true;
        return;
      }
      const g = this.m.group;
      if (this.launch) {
        // Sent flying by an explosion: tumble through the air, poof on landing.
        const L = this.launch;
        L.vy -= 24 * dt;
        this.x += L.vx * dt;
        this.z += L.vz * dt;
        L.y += L.vy * dt;
        g.position.set(this.x, Math.max(0, L.y), this.z);
        g.rotation.x += L.spin * dt;
        g.rotation.z += L.spin * 0.6 * dt;
        if ((L.y <= 0 && L.vy < 0) || this.deathT > 2.5) {
          poof(this.x, 0.5, this.z, this.scale, this.d.undead ? 0xd8f0e8 : 0xf2ece4);
          dust(this.x, this.z, 0.8 * this.scale);
          g.visible = false;
          this.removed = true;
        }
        return;
      }
      if (this.isBoss) {
        // Bosses topple, then go up in a big cartoon blast.
        if (this.flying) {
          g.position.y = Math.max(0, this.flyH - this.deathT * this.deathT * 9);
          g.rotation.z += dt * 4;
        } else {
          g.rotation.x = Math.max(-Math.PI / 2, -this.deathT * 3);
        }
        if (this.deathT > 0.9 && !this.poofed) {
          this.poofed = true;
          boom(this.x, 0.6, this.z, 3.2 * Math.min(1.6, this.scale), { color: 0xffc04a });
          poof(this.x, 1.2, this.z, 2.4 * this.scale);
        }
        if (this.deathT > 1.25) this.removed = true;
        return;
      }
      if (this.d.model === 'ram' || this.d.model === 'trebuchet') {
        g.position.y = -this.deathT * 0.6;
        g.rotation.z = Math.min(0.5, this.deathT);
        if (!this.poofed) {
          this.poofed = true;
          boom(this.x, 0.8, this.z, 2.2, { smoke: 0x6a5a48, chunks: 14 });
        }
        if (this.deathT > 0.5) this.removed = true;
        return;
      }
      if (this.flying) {
        g.position.y = Math.max(0, this.flyH - this.deathT * this.deathT * 14);
        g.rotation.z += dt * 8;
        if (g.position.y <= 0.2 && !this.poofed) {
          this.poofed = true;
          poof(this.x, 0.5, this.z, this.scale, this.d.undead ? 0xd8f0e8 : 0xf2ece4);
          this.removed = true;
        }
        if (this.deathT > 1.2) this.removed = true;
        return;
      }
      if (cartoonDeath(this.m, this.deathT, this.x, this.z, this.scale, this.d.undead ? 0xd8f0e8 : 0xf2ece4)) this.removed = true;
      return;
    }
    const d = this.d;
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.lose(this.burnDps * dt);
      if (Math.random() < dt * 8) burst(this.x, 1 * this.scale + this.flyH, this.z, 0xff8a2a, 1, { glow: true, speed: 1, up: 2.5, life: 0.5 });
      if (!this.alive) return;
    }
    if (this.slowT > 0) this.slowT -= dt;
    if (this.flashCd > 0) this.flashCd -= dt;
    if (this.vulnT > 0) this.vulnT -= dt;
    updateLook(this.m, dt, this.stunT > 0 || this.slowT > 0 ? 'chill' : this.burnT > 0 ? 'burn' : this.vulnT > 0 ? 'holy' : null, G.time);
    if (this.ward?.visible) this.ward.rotation.y += dt * 0.8;
    if (this.emergeT > 0) {
      // Clawing up out of a tunnel.
      this.emergeT -= dt;
      const k = Math.max(0, this.emergeT) / 0.6;
      this.m.group.position.set(this.x, -1.8 * this.scale * k * k, this.z);
      this.m.group.rotation.y = this.facing;
      this.m.anim(dt, true, 4, 1);
      return;
    }
    if (this.climbT > 0) {
      this.climbUpdate(dt);
      return;
    }
    if (this.kx !== 0 || this.kz !== 0) {
      this.x += this.kx * dt;
      this.z += this.kz * dt;
      const f = Math.exp(-9 * dt);
      this.kx *= f;
      this.kz *= f;
      if (Math.abs(this.kx) + Math.abs(this.kz) < 0.05) this.kx = this.kz = 0;
      this.x = clamp(this.x, MAP.minX, MAP.maxX);
      if (!this.flying && !d.ethereal) St.pushOut(this, this.r);
    }
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.m.group.position.set(this.x, this.flyH, this.z);
      this.bar.set(this.hp / this.maxHp, this.x, 2.2 * this.scale + 0.25 + this.flyH, this.z, this.isBoss || this.hp < this.maxHp, this.shieldHp / this.shieldMax);
      return;
    }
    this.atkT -= dt;
    this.retargetT -= dt;
    this.swingT += dt / 0.35;
    this.abilities(dt);
    if (!this.alive) return;
    if (this.slamWind > 0) {
      // Rearing up for the slam: weapon raised, rooted to the spot.
      this.swingT = Math.min(this.swingT, 0.33);
      this.m.group.position.set(this.x, this.flyH, this.z);
      this.m.anim(dt, false, 0, this.swingT);
      this.bar.set(this.hp / this.maxHp, this.x, 2.2 * Math.min(this.scale, 2.6) + 0.25 + this.flyH, this.z, true, this.shieldHp / this.shieldMax);
      return;
    }
    if (this.retargetT <= 0 || !this.target || !this.target.alive) {
      this.retargetT = 0.3 + Math.random() * 0.15;
      this.pickTarget();
    }

    let tgt: Target = this.target ?? St.S.keep;
    let moveTo: [number, number] | null = null;
    const passWalls = this.flying || !!d.ethereal;
    if (this.z < W && !passWalls) {
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
          if (d.climber) {
            // Grappling hook: up and over instead of battering.
            if (W - this.z < MAP.wallHalf + this.r + 0.4) {
              this.startClimb(1);
              return;
            }
            moveTo = [this.x, W - MAP.wallHalf - this.r];
          } else {
            const gap = !d.noGap && near ? St.nearGap(this.x, 3.5) : null;
            if (gap !== null) moveTo = [gap, this.z];
            else tgt = seg;
          }
        }
      }
    } else if (d.climber && !passWalls) {
      // Heading back out (thieves with their loot): over the wall again.
      const [ax, az] = aimPoint(this.x, this.z, tgt);
      if (az < W && St.wallBetween(this.x, this.z, ax, az)) {
        if (this.z - W < MAP.wallHalf + this.r + 0.4) {
          this.startClimb(-1);
          return;
        }
        moveTo = [this.x, W + MAP.wallHalf + this.r];
      }
    }

    this.moving = false;
    const reach = d.bomb ? 0.4 : d.range;
    if (d.thief && this.fleeing && this.z < MAP.spawnZ + 2) {
      this.escape();
      return;
    }
    if (moveTo) {
      this.moveToward(moveTo[0], moveTo[1], dt);
    } else if (surfDist(this.x, this.z, this.r, tgt) <= reach) {
      if (d.thief) this.steal();
      else this.attack(tgt);
    } else {
      const [ax, az] = aimPoint(this.x, this.z, tgt);
      this.moveToward(ax, az, dt, structId(tgt));
    }

    const bob = this.flying ? Math.sin(G.time * 3 + this.x) * 0.15 : 0;
    this.m.group.position.set(this.x, this.flyH + bob, this.z);
    this.m.group.rotation.y = this.facing;
    const spd = this.curSpeed();
    this.m.anim(dt, this.moving, spd, this.swingT);
    if (this.moving && !this.flying && (this.isBoss || this.scale >= 1.8 || d.model === 'mammoth')) {
      // Heavy footfalls you can hear and feel coming.
      this.stepT -= dt * Math.max(0.6, spd / 1.6);
      if (this.stepT <= 0) {
        this.stepT = 0.62;
        const sc = d.model === 'mammoth' ? 2.6 : Math.min(2.8, this.scale);
        Sfx.at('stomp', this.x, this.z, Math.min(1, 0.3 * sc));
        dust(this.x + (Math.random() - 0.5) * this.r, this.z + (Math.random() - 0.5) * this.r, 0.35 * sc);
        if (this.isBoss) shakeAt(this.x, this.z, 0.07 * sc, 0.35);
      }
    }
    if (this.aura) this.aura.rotation.y += dt * 1.5;
    this.bar.set(this.hp / this.maxHp, this.x, 2.2 * Math.min(this.scale, 2.6) + 0.25 + this.flyH + (this.d.model === 'mammoth' ? 3.5 : 0), this.z, this.isBoss || this.hp < this.maxHp || this.shieldHp > 0, this.shieldHp / this.shieldMax);
  }

  private startClimb(dir: 1 | -1): void {
    const seg = St.S.walls[St.segIndex(this.x)];
    this.climbDur = this.climbT = CLIMB_TIME[this.type] ?? 1.4;
    this.climbZ0 = this.z;
    this.climbZ1 = W + dir * (MAP.wallHalf + this.r + 0.3);
    this.climbH = 2 + (seg?.level ?? 1) * 0.3;
    this.facing = dir > 0 ? 0 : Math.PI;
    this.kx = this.kz = 0;
    Sfx.at('grapple', this.x, this.z, 0.7);
  }

  private climbUpdate(dt: number): void {
    this.climbT -= dt;
    const k = 1 - Math.max(0, this.climbT) / this.climbDur;
    const up = Math.min(1, k / 0.5);
    const down = k > 0.68 ? (k - 0.68) / 0.32 : 0;
    const y = this.climbH * (k < 0.68 ? 1 - (1 - up) * (1 - up) : 1 - down * down);
    const zf = k < 0.42 ? 0 : k > 0.72 ? 1 : (k - 0.42) / 0.3;
    this.z = this.climbZ0 + (this.climbZ1 - this.climbZ0) * zf;
    const g = this.m.group;
    g.position.set(this.x, y, this.z);
    g.rotation.y = this.facing;
    this.m.anim(dt, true, 5, 1);
    if (this.climbT <= 0) {
      this.z = this.climbZ1;
      g.position.y = 0;
      dust(this.x, this.z, 0.6);
      this.retargetT = 0;
    }
    this.bar.set(this.hp / this.maxHp, this.x, 2.2 * this.scale + 0.25 + y, this.z, this.hp < this.maxHp);
  }

  /** Thief at the treasury: grab what's there and run. */
  private steal(): void {
    if (this.fleeing) return;
    const cap = 60 + this.wave * 28;
    let take = Math.min(cap, St.market.pile);
    St.market.pile -= take;
    const purse = Math.min(cap - take, Math.floor(G.coins * 0.15));
    G.coins -= purse;
    take = Math.round(take + purse);
    this.loot = take;
    this.fleeing = true;
    if (this.goal) this.goal.x = this.x + (Math.random() - 0.5) * 16;
    this.retargetT = 0;
    this.speed *= 1.12;
    burst(this.x, 1.4, this.z, 0xffd23f, 10, { speed: 3, up: 5, size: 0.12 });
    text(this.x, 2.6, this.z, take > 0 ? `-${take} coins!` : 'Nothing to steal!', 'red', 1.4);
    Sfx.at('steal', this.x, this.z, 1);
    emit('threat', { kind: 'stolen', amount: take, e: this });
  }

  /** A thief made it off the field with the loot. */
  private escape(): void {
    this.alive = false;
    this.removed = true;
    this.bar.hide();
    if (this.loot > 0) emit('threat', { kind: 'escaped', amount: this.loot });
    this.loot = 0;
  }

  private curSpeed(): number {
    let s = this.speed;
    if (this.slowT > 0) s *= 1 - this.slowAmt;
    if (this.chargeT > 0) s *= 3;
    return s;
  }

  private moveToward(tx: number, tz: number, dt: number, ignoreId?: string): void {
    let dx = tx - this.x;
    let dz = tz - this.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    dx /= L;
    dz /= L;
    const ghost = this.flying || !!this.d.ethereal;
    if (!ghost) [dx, dz] = St.steer(this.x, this.z, dx, dz, this.r, ignoreId);
    const step = Math.min(L, this.curSpeed() * dt);
    const oz = this.z;
    this.x += dx * step;
    this.z += dz * step;
    this.vx = dx * this.curSpeed();
    this.vz = dz * this.curSpeed();
    if (!ghost) {
      const stopZ = W - MAP.wallHalf - this.r;
      if (oz <= stopZ + 0.01 && this.z > stopZ && St.segAlive(St.segIndex(this.x))) this.z = stopZ;
    }
    this.x = clamp(this.x, MAP.minX, MAP.maxX);
    if (!ghost) St.pushOut(this, this.r);
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
    this.moving = true;
  }

  private attack(t: Target): void {
    this.vx = this.vz = 0;
    const [ax, az] = aimPoint(this.x, this.z, t);
    this.facing = angleLerp(this.facing, Math.atan2(ax - this.x, az - this.z), 0.3);
    if (this.atkT > 0) return;
    const d = this.d;
    if (d.bomb) {
      this.exploded = true;
      explode(this.x, this.z, d.bomb.radius, d.bomb.dmg * dmgScale(this.wave), 'defenders');
      this.alive = false;
      this.hp = 0;
      this.deathT = 0;
      this.bar.hide();
      setModelMat(this.m, null);
      this.m.group.visible = false;
      return;
    }
    this.atkT = this.interval;
    this.swingT = 0;
    if (d.ranged || d.breath) {
      const ty = t.isStruct ? 1.4 : (t.aimY ?? 1.1);
      const sy = (this.flyH || 1.5 * this.scale) + (this.flying ? 0.3 : 0);
      if (d.lob) {
        this.lobAt(t);
      } else if (d.breath) {
        const big = this.type === 'dragon';
        beam(this.x, sy, this.z, ax, ty, az, 0xff7a1a, big ? 0.6 : 0.3, 0.35);
        beam(this.x, sy, this.z, ax, ty, az, 0xffe27a, big ? 0.25 : 0.12, 0.3);
        burst(ax, ty, az, 0xff8a2a, big ? 14 : 6, { glow: true, speed: 3, up: 2, life: 0.5 });
        t.damage(this.dmg, 'fire', this);
        if (big) splashDefenders(ax, az, 2.5, this.dmg * 0.4);
        Sfx.at('fire', this.x, this.z, 0.7);
      } else if (d.magic) {
        const col = this.type === 'frostmage' || this.type === 'witch' ? 0x9fe8ff : this.type === 'shaman' ? 0x9aff7a : this.type === 'lich' ? 0x7dff9a : 0xb08aff;
        const slow = d.slowOnHit ?? 0;
        Proj.magic(this.x, sy, this.z, t, this.dmg, col, true, (hit) => {
          if (!slow) return;
          if (hit === hero) heroSlow(slow, 2);
          else if (hit.isStruct) (hit as St.Structure).freeze(1.2);
          else applySlow(hit as unknown as Statused, slow, 2);
        });
        Sfx.at('magic', this.x, this.z, 0.4);
      } else {
        Proj.arrow(this.x, sy, this.z, t, this.dmg, true);
        Sfx.at('arrow', this.x, this.z, 0.5);
      }
      return;
    }
    const isWall = t.isStruct && (t as St.Structure).kind === 'wall';
    const mul = t.isStruct && (isWall || d.siege) ? d.wallMul ?? 1 : 1;
    const dealt = this.dmg * mul;
    t.damage(dealt, 'melee', this);
    if (isWall) {
      const th = CFG.wall.thorns[(t as St.Structure).level - 1] ?? 0;
      if (th > 0) {
        this.damage(dealt * th, 'magic');
        if (Math.random() < 0.3) burst(ax, 1.2, az, 0x6ad8ff, 3, { glow: true, speed: 2, up: 2 });
      }
    }
    if (d.slowOnHit && !t.isStruct) {
      if (t === hero) heroSlow(d.slowOnHit, 1.5);
      else applySlow(t as unknown as Statused, d.slowOnHit, 1.5);
    }
    const steal = (d.lifesteal ?? 0) + (this.affix === 'vampiric' ? 0.6 : 0);
    if (steal > 0) this.hp = Math.min(this.maxHp, this.hp + dealt * steal);
    Sfx.at('hit', this.x, this.z, 0.5);
    if (this.isBoss || d.siege) {
      G.shake = Math.min(0.6, G.shake + (this.isBoss ? 0.25 : 0.12));
      burst(ax, 0.4, az, 0x9a8a7a, 10, { speed: 4, up: 4, size: 0.2 });
    }
  }

  dispose(): void {
    scene.remove(this.m.group);
    this.bar.dispose();
  }
}

/** Damage hero, soldiers and rangers in a circle. */
function splashDefenders(x: number, z: number, radius: number, dmg: number): void {
  for (const u of defenders()) if (u.alive && Math.hypot(u.x - x, u.z - z) < radius + u.r) u.damage(dmg, 'fire');
}

/**
 * Explosion. 'defenders': hurts structures and defenders (a sapper reaching its target).
 * 'enemies': a sapper shot before it got there blows up its friends instead.
 */
export function explode(x: number, z: number, radius: number, dmg: number, who: 'defenders' | 'enemies'): void {
  if (who === 'defenders') {
    for (const s of St.allStructures()) {
      if (!s.alive) continue;
      const [ax, az] = aimPoint(x, z, s);
      if (Math.hypot(ax - x, az - z) < radius) s.damage(s.kind === 'keep' ? dmg * 0.5 : dmg, 'splash');
    }
    splashDefenders(x, z, radius, dmg * 0.4);
  } else {
    for (const e of enemies) {
      if (!e.alive || Math.hypot(e.x - x, e.z - z) >= radius + e.r) continue;
      e.damage(dmg, 'splash');
      e.knock(x, z, 7);
    }
  }
  boom(x, 0.4, z, radius, { big: radius >= 2.8 });
  shakeAt(x, z, 0.3, 0.7);
  Sfx.at('explode', x, z, 1);
}

function summonAround(e: Enemy, type: EnemyType, n: number): void {
  if (Units.aliveCount() > 140) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    Units.spawnEnemy(type, e.x + Math.cos(a) * 1.8, e.z + Math.sin(a) * 1.8 - 1, Math.max(1, G.wave), { summoned: true });
  }
  burst(e.x, 1, e.z, e.d.undead ? 0x7dff9a : 0x8a1c1c, 16, { speed: 5, up: 5, size: 0.2, glow: e.d.undead });
  text(e.x, 4.5, e.z, `Summons ${CFG.enemies[type].name.toLowerCase()}s!`, 'red');
}

// ───────────────────────────── Soldiers & rangers ─────────────────────────────

const POSTS = [-3, 3, -9, 9, -15, 15, -21, 21, -27, 27, -6, 6].map((x) => ({ x, z: W + 1.05 }));
const RANGER_POSTS = [-2.5, 2.5, -6.5, 6.5, -11.5, 11.5].map((x) => ({ x, z: W + 2.4 }));

export class Soldier implements Target {
  readonly isStruct = false;
  readonly hw = 0;
  readonly hd = 0;
  readonly r: number;
  readonly ranged: boolean;
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
  slowT = 0;
  slowAmt = 0;
  stunT = 0;
  m: UnitModel;
  bar: Bar;

  constructor(post: { x: number; z: number }, ranged: boolean) {
    this.post = post;
    this.ranged = ranged;
    this.r = ranged ? CFG.ranger.r : CFG.soldier.r;
    const door = ranged ? St.range.door : St.barracks.door;
    this.x = door.x;
    this.z = door.z;
    this.refreshStats();
    this.hp = this.maxHp;
    this.m = unitModel(ranged ? 'ranger' : 'soldier', !G.autotest);
    this.m.group.position.set(this.x, 0, this.z);
    if (!G.autotest) scene.add(this.m.group);
    this.bar = new Bar(0.9, 0x5fd35f, 0.12);
  }

  refreshStats(): void {
    const mul = Stat.soldierMul();
    const ratio = this.maxHp > 1 ? this.hp / this.maxHp : 1;
    if (this.ranged) {
      const L = clamp(St.range.level - 1, 0, CFG.ranger.hp.length - 1);
      this.maxHp = CFG.ranger.hp[L] * mul;
      this.dmg = CFG.ranger.dmg[L] * mul * Stat.towerDmg();
    } else {
      const L = clamp(St.barracks.level - 1, 0, CFG.soldier.hp.length - 1);
      this.maxHp = CFG.soldier.hp[L] * mul;
      this.dmg = CFG.soldier.dmg[L] * mul;
    }
    this.hp = this.maxHp * ratio;
  }

  damage(amount: number, _kind: DamageKind): void {
    if (!this.alive) return;
    this.hp -= amount;
    hitPulse(this.m);
    if (this.hp <= 0) {
      this.alive = false;
      this.deathT = 0;
      this.bar.hide();
      setModelMat(this.m, null);
      Sfx.at('die', this.x, this.z, 0.7);
    }
  }

  heal(n: number): void {
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + n);
  }

  private findTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    const range = this.ranged ? CFG.ranger.range : 0;
    for (const e of enemies) {
      if (!e.alive) continue;
      const ds = Math.hypot(e.x - this.x, e.z - this.z);
      if (this.ranged) {
        if (ds > range) continue;
      } else {
        if (e.flying) continue;
        const dp = Math.hypot(e.x - this.post.x, e.z - this.post.z);
        if (dp > CFG.soldier.engage && ds > 3.5) continue;
      }
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
    const sp = CFG.soldier.speed * (this.slowT > 0 ? 1 - this.slowAmt : 1);
    const step = Math.min(L, sp * dt);
    this.x += dx * step;
    this.z += dz * step;
    St.pushOut(this, this.r);
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
    this.moving = true;
  }

  update(dt: number): void {
    if (!this.alive) {
      this.deathT += dt;
      if (cartoonDeath(this.m, this.deathT, this.x, this.z, 1, 0xe8eef8)) this.removed = true;
      return;
    }
    if (this.slowT > 0) this.slowT -= dt;
    updateLook(this.m, dt, this.slowT > 0 || this.stunT > 0 ? 'chill' : null, G.time);
    this.moving = false;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.bar.set(this.hp / this.maxHp, this.x, 2.4, this.z);
      return;
    }
    this.atkT -= dt;
    this.retargetT -= dt;
    this.swingT += dt / 0.3;
    if (this.retargetT <= 0 || (this.target && !this.target.alive)) {
      this.retargetT = 0.3;
      this.target = this.findTarget();
    }
    const t = this.target;
    const haste = Stat.haste();
    if (t && this.ranged) {
      if (Math.hypot(this.post.x - this.x, this.post.z - this.z) > 0.3) this.moveToward(this.post.x, this.post.z, dt);
      this.facing = angleLerp(this.facing, Math.atan2(t.x - this.x, t.z - this.z), 0.3);
      if (this.atkT <= 0 && !this.moving) {
        this.atkT = CFG.ranger.interval / haste;
        this.swingT = 0;
        Proj.arrow(this.x, 1.5, this.z, t, this.dmg, false);
        Sfx.at('arrow', this.x, this.z, 0.4);
      }
    } else if (t) {
      if (surfDist(this.x, this.z, this.r, t) <= CFG.soldier.range) {
        this.facing = angleLerp(this.facing, Math.atan2(t.x - this.x, t.z - this.z), 0.3);
        if (this.atkT <= 0) {
          this.atkT = CFG.soldier.interval / haste;
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
    this.m.anim(dt, this.moving, CFG.soldier.speed, this.swingT);
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
  m: UnitModel;
  stackGroup: THREE.Group;
  stackMeshes: THREE.Mesh[] = [];
  shown = -1;

  constructor(kind: WorkerKind) {
    this.kind = kind;
    this.home = kind === 'lumber' ? { x: -11, z: 19.4 } : { x: 11, z: 19.4 };
    this.x = this.home.x + (Math.random() - 0.5);
    this.z = this.home.z;
    this.m = unitModel(kind, !G.autotest);
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
    const step = Math.min(L, Stat.workerSpeed() * dt);
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
    const types: ResType[] = this.kind === 'lumber' ? ['wood'] : ['crystal', 'gold', 'stone'];
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
          if (this.stack.length >= Stat.workerCap() || n.state !== 'grown') {
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
    this.m.anim(dt, this.moving, Stat.workerSpeed(), this.swingT);
    if (this.shown !== this.stack.length) {
      this.shown = this.stack.length;
      for (const m of this.stackMeshes) this.stackGroup.remove(m);
      this.stackMeshes = [];
      let y = 0;
      for (const t of this.stack) {
        const m = makeMesh(itemGeo(t), false, false, Mat.unit);
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
export const rangers: Soldier[] = [];
export const workers: Worker[] = [];

const _defenders: Target[] = [];
/** Hero, soldiers and rangers: everything enemies can fight. */
export function defenders(): Target[] {
  _defenders.length = 0;
  _defenders.push(hero);
  for (const s of soldiers) _defenders.push(s);
  for (const s of rangers) _defenders.push(s);
  return _defenders;
}

function separate(): void {
  const list = enemies.filter((e) => e.alive && e.climbT <= 0 && e.emergeT <= 0);
  const blockers: Target[] = [hero, ...soldiers, ...rangers];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.flying !== b.flying) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const rr = a.r + b.r;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
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
    if (a.flying) continue;
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
    if (a.flying || a.d.ethereal || !St.segAlive(St.segIndex(a.x))) continue;
    const north = W - MAP.wallHalf - a.r;
    const south = W + MAP.wallHalf + a.r;
    if (a.z > north && a.z < W) a.z = north;
    else if (a.z >= W && a.z < south) a.z = south;
  }
}

function updateList<T extends { removed: boolean; update(dt: number): void; dispose(): void }>(list: T[], dt: number): void {
  for (const u of list) u.update(dt);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].removed) {
      list[i].dispose();
      list.splice(i, 1);
    }
  }
}

export const Units = {
  spawnEnemy(type: EnemyType, x: number, z: number, wave: number, o: SpawnOpts = {}): Enemy {
    const e = new Enemy(type, x, z, wave, o);
    enemies.push(e);
    if (e.isBoss && !o.summoned) {
      Sfx.play('roar');
      G.shake = Math.max(G.shake, 0.4);
    }
    return e;
  },

  addWorker(kind: WorkerKind): void {
    workers.push(new Worker(kind));
  },

  spawnSoldier(ranged = false): void {
    const list = ranged ? rangers : soldiers;
    const posts = ranged ? RANGER_POSTS : POSTS;
    const used = new Set(list.filter((s) => s.alive).map((s) => s.post));
    const post = posts.find((p) => !used.has(p)) ?? posts[0];
    const s = new Soldier(post, ranged);
    list.push(s);
    if (!G.autotest) burst(s.x, 1, s.z, ranged ? 0x3f7a3a : 0x4f78c4, 10, { speed: 3, up: 4 });
  },

  soldierCap(ranged: boolean): number {
    if (ranged) return St.range.level > 0 ? CFG.ranger.cap[St.range.level - 1] : 0;
    return St.barracks.level > 0 ? CFG.soldier.cap[St.barracks.level - 1] : 0;
  },

  fillSoldiers(): void {
    for (const ranged of [false, true]) {
      const list = ranged ? rangers : soldiers;
      const cap = Units.soldierCap(ranged);
      while (list.filter((s) => s.alive).length < cap) Units.spawnSoldier(ranged);
    }
  },

  refreshDefenders(): void {
    for (const s of soldiers) s.refreshStats();
    for (const s of rangers) s.refreshStats();
  },

  boss(): Enemy | null {
    return enemies.find((e) => e.alive && e.d.boss) ?? enemies.find((e) => e.alive && e.champion) ?? null;
  },

  aliveCount(): number {
    let n = 0;
    for (const e of enemies) if (e.alive) n++;
    return n;
  },

  update(dt: number): void {
    updateList(enemies, dt);
    separate();
    updateList(soldiers, dt);
    updateList(rangers, dt);
    for (const w of workers) w.update(dt);
  },
};
