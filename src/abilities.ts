import { CFG } from './config';
import { G } from './state';
import { hero, heroSpin, heroStrike, healHero } from './hero';
import { enemies, soldiers, rangers, type Enemy } from './units';
import { repairFrac, wallFx } from './structures';
import { Proj } from './projectiles';
import { Stat, hasRelic } from './progress';
import { burst, ring, text, slash, dust, spark, fire } from './fx';
import { Sfx } from './audio';

export type AbilityId = 'whirlwind' | 'warcry' | 'meteor' | 'bastion';
export const ABILITIES: AbilityId[] = ['whirlwind', 'warcry', 'meteor', 'bastion'];
export const ABILITY_INFO: Record<AbilityId, { name: string; icon: string; key: string; desc: string }> = {
  whirlwind: { name: 'Whirlwind', icon: '🌀', key: 'Q', desc: 'Spin and hit everything around you' },
  warcry: { name: 'War Cry', icon: '📣', key: 'E', desc: 'Towers, soldiers and you attack 40% faster for 8 s' },
  meteor: { name: 'Meteor', icon: '☄️', key: 'R', desc: 'Call a meteor on the biggest group of enemies' },
  bastion: { name: 'Bastion', icon: '🛡️', key: 'F', desc: 'Repair every defense by 30% and heal your troops' },
};

const cds: Record<AbilityId, number> = { whirlwind: 0, warcry: 0, meteor: 0, bastion: 0 };

export const unlocked = (a: AbilityId): boolean => G.level >= CFG.ability[a].level;

export function maxCd(a: AbilityId): number {
  let cd = CFG.ability[a].cd * Stat.abilityCdMul();
  if (a === 'meteor' && hasRelic('shard')) cd *= 0.6;
  return cd;
}
export const cooldown = (a: AbilityId): number => cds[a];

function meteorTarget(): Enemy | null {
  const R = CFG.ability.meteor.range;
  let best: Enemy | null = null;
  let bn = 0;
  for (const e of enemies) {
    if (!e.alive || Math.hypot(e.x - hero.x, e.z - hero.z) > R) continue;
    let n = e.isBoss ? 3 : 0;
    for (const o of enemies) if (o.alive && (o.x - e.x) ** 2 + (o.z - e.z) ** 2 < 16) n++;
    if (n > bn) {
      bn = n;
      best = e;
    }
  }
  return best;
}

/** Why an ability can't be used right now, or '' if it can. */
export function blocked(a: AbilityId): string {
  if (!unlocked(a)) return `Hero level ${CFG.ability[a].level}`;
  if (!hero.alive) return 'Fallen';
  if (cds[a] > 0) return `${Math.ceil(cds[a])}s`;
  if (G.phase !== 'wave' && G.phase !== 'build') return '…';
  if (a === 'meteor' && !meteorTarget()) return 'No targets';
  if (a === 'whirlwind' && !enemies.some((e) => e.alive && Math.hypot(e.x - hero.x, e.z - hero.z) < CFG.ability.whirlwind.radius + 1)) return 'No targets';
  return '';
}

export function cast(a: AbilityId): boolean {
  if (blocked(a)) return false;
  cds[a] = maxCd(a);
  switch (a) {
    case 'whirlwind': {
      const c = CFG.ability.whirlwind;
      heroSpin();
      for (const e of enemies) {
        if (e.alive && Math.hypot(e.x - hero.x, e.z - hero.z) < c.radius + e.r) heroStrike(e, c.mult);
      }
      ring(hero.x, hero.z, 0xffffff, c.radius, 0.35, 0.5);
      for (let i = 0; i < 4; i++) slash(hero.x, 1.0, hero.z, (i / 4) * Math.PI * 2, 0xe8f4ff, c.radius * 0.9, 0.3, 1.6);
      dust(hero.x, hero.z, 1.6);
      Sfx.play('whoosh');
      break;
    }
    case 'warcry': {
      G.buffs.warcry = CFG.ability.warcry.dur;
      ring(hero.x, hero.z, 0xffc83a, 12, 0.8);
      burst(hero.x, 2, hero.z, 0xffd54a, 20, { glow: true, speed: 5, up: 4 });
      for (const s of [...soldiers, ...rangers]) if (s.alive) burst(s.x, 2, s.z, 0xffd54a, 4, { glow: true, speed: 2, up: 3 });
      wallFx(0xffc83a);
      text(hero.x, 3, hero.z, 'War Cry!', 'gold big', 1.2);
      Sfx.play('warcry');
      break;
    }
    case 'meteor': {
      const t = meteorTarget();
      if (!t) return false;
      const c = CFG.ability.meteor;
      const mult = c.mult * (hasRelic('shard') ? 1.5 : 1);
      Proj.meteor(t.x + t.vx * 0.9, t.z + t.vz * 0.9, Stat.heroDmg() * mult, c.radius);
      spark(hero.x, 2.6, hero.z, 0xffb060, 1.6, 0.35);
      fire(hero.x, 2.4, hero.z, { n: 3, spread: 0.2, size: 0.25, life: 0.35, up: 1.5, out: 0.6 });
      Sfx.play('fire');
      break;
    }
    case 'bastion': {
      repairFrac(CFG.ability.bastion.repair);
      for (const s of [...soldiers, ...rangers]) if (s.alive) s.heal(s.maxHp);
      healHero(1);
      ring(hero.x, hero.z, 0x7dff8a, 10, 0.8);
      text(hero.x, 3, hero.z, 'Bastion!', 'gold big', 1.2);
      Sfx.play('heal');
      break;
    }
  }
  return true;
}

export function updateAbilities(dt: number): void {
  for (const a of ABILITIES) if (cds[a] > 0) cds[a] = Math.max(0, cds[a] - dt);
  if (G.buffs.warcry > 0) {
    G.buffs.warcry = Math.max(0, G.buffs.warcry - dt);
    if (Math.random() < dt * 6) burst(hero.x, 2.2, hero.z, 0xffd54a, 1, { glow: true, speed: 1, up: 2, life: 0.5 });
  }
  if (G.buffs.fury > 0) G.buffs.fury = Math.max(0, G.buffs.fury - dt);
}

export function resetAbilities(): void {
  for (const a of ABILITIES) cds[a] = 0;
  G.buffs.warcry = 0;
}
