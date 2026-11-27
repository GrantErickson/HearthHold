import { G } from './state';
import { CFG, PERKS, RELICS, xpForLevel, type PerkDef } from './config';
import { emit } from './events';

const p = (id: string): number => G.perks[id] ?? 0;
export const hasRelic = (id: string): boolean => G.relics.includes(id);

/**
 * Every derived number (equipment × research × perks × relics × buffs).
 * Read these instead of CFG wherever the player can improve something.
 */
const glory = (): number => 1 + 0.02 * G.research.glory;
const gloryHp = (): number => 1 + 0.02 * G.research.glory;

export const Stat = {
  haste: (): number => (G.buffs.warcry > 0 ? CFG.ability.warcry.haste : 1),
  heroDmg: (): number =>
    CFG.hero.dmg[G.up.sword] * (1 + 0.12 * p('blade')) * (hasRelic('anvil') ? 1.3 : 1) * (G.buffs.fury > 0 ? 1.5 : 1) * glory(),
  heroMaxHp: (): number => Math.round(CFG.hero.hp[G.up.armor] * (1 + 0.15 * p('vitality')) * (hasRelic('heart') ? 1.2 : 1)),
  heroSpeed: (): number => CFG.hero.speed[G.up.boots] * (1 + 0.06 * p('fleet')) * (hasRelic('league') ? 1.2 : 1),
  heroCap: (): number => CFG.hero.cap[G.up.backpack] + 3 * p('pockets'),
  heroHarvest: (): number => CFG.hero.harvest[G.up.tools] / (1 + 0.1 * p('nimble')),
  heroAtkCd: (): number => CFG.hero.attackCd / (1 + 0.08 * p('quick')) / Stat.haste(),
  crit: (): number => 0.06 * p('crit'),
  leech: (): number => 0.04 * p('leech'),
  cleaveMul: (): number => CFG.hero.cleave * (1 + 0.15 * p('cleave')),
  cleaveR: (): number => 1.6 * (1 + 0.15 * p('cleave')),
  heroRegen: (): number => CFG.hero.regen * (1 + 0.5 * p('wind')) * (hasRelic('heart') ? 3 : 1),
  regenDelay: (): number => CFG.hero.regenDelay - 0.5 * p('wind'),
  dodge: (): number => (hasRelic('veil') ? 0.2 : 0),
  thorns: (): number => 0.2 * p('thorns'),
  magnet: (): number => CFG.hero.magnet * (1 + 0.4 * p('magnet')),
  doubleChance: (): number => 0.15 * p('bounty'),
  sellMul: (): number => (1 + 0.05 * p('haggler')) * (1 + 0.06 * G.research.commerce) * (G.happening === 'rush' ? 1.5 : 1),
  killCoinMul: (): number => (1 + 0.08 * G.research.commerce) * (hasRelic('crown') ? 1.25 : 1),
  killCoinFlat: (): number => p('tax'),
  waveBonusMul: (): number => (1 + 0.1 * p('tax')) * (hasRelic('coffer') ? 2 : 1),
  /** Archer towers, rangers, ballista. */
  towerDmg: (): number => (1 + 0.1 * G.research.fletching) * (1 + 0.05 * p('eagle')) * glory(),
  keepDmg: (): number => Stat.towerDmg() * (hasRelic('lantern') ? 1.5 : 1),
  /** Mage, fire, frost and holy towers. */
  magicDmg: (): number => (1 + 0.1 * G.research.alchemy) * (hasRelic('phylactery') ? 1.25 : 1) * glory(),
  /** Catapult and traps. */
  siegeDmg: (): number => (1 + 0.1 * G.research.alchemy) * glory(),
  holyFire: (): number => (hasRelic('lantern') ? 1.4 : 1),
  wallHp: (): number => (1 + 0.1 * G.research.masonry) * (1 + 0.08 * p('bulwark')) * (hasRelic('tusk') ? 1.3 : 1) * gloryHp(),
  structHp: (): number => (1 + 0.1 * G.research.masonry) * (1 + 0.08 * p('bulwark')) * gloryHp(),
  soldierMul: (): number => (1 + 0.1 * G.research.drill) * (1 + 0.1 * p('drillmaster')) * (hasRelic('banner') ? 1.35 : 1) * glory(),
  trainTime: (): number => CFG.soldier.train * (1 - 0.08 * G.research.drill),
  workerSpeed: (): number =>
    CFG.worker.speed * (1 + 0.12 * G.research.logistics) * (1 + 0.1 * p('foreman')) * (hasRelic('league') ? 1.25 : 1),
  workerCap: (): number => CFG.worker.cap + G.research.logistics,
  enemySpeedMul: (): number => (hasRelic('frostcrown') ? 0.9 : 1),
  abilityCdMul: (): number => 1 / (1 + 0.1 * p('focus')),
  extraArrows: (): number => (hasRelic('quiver') ? 1 : 0),
};

// ───────────────────────────── XP & levels ─────────────────────────────

export function gainXp(n: number): void {
  if (n <= 0 || G.phase === 'gameover') return;
  G.xp += n;
  while (G.xp >= xpForLevel(G.level)) {
    G.xp -= xpForLevel(G.level);
    G.level++;
    G.pendingPerks++;
    emit('levelUp', G.level);
  }
}

export const xpRatio = (): number => G.xp / xpForLevel(G.level);

// ───────────────────────────── Choices ─────────────────────────────

export type ChoiceKind = 'perk' | 'relic';
export interface Choice {
  kind: ChoiceKind;
  id: string;
  def: PerkDef;
  stacks: number;
}

let offer: Choice[] | null = null;
let offerKind: ChoiceKind | null = null;

function pick<T>(list: T[], n: number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Next pending choice: relics first (they're rarer), then perks. Stable until taken. */
export function currentOffer(): Choice[] | null {
  const kind: ChoiceKind | null = G.pendingRelics > 0 ? 'relic' : G.pendingPerks > 0 ? 'perk' : null;
  if (!kind) {
    offer = null;
    return null;
  }
  if (offer && offerKind === kind) return offer;
  offerKind = kind;
  if (kind === 'relic') {
    const ids = Object.keys(RELICS).filter((id) => !hasRelic(id));
    offer = pick(ids, 3).map((id) => ({ kind, id, def: RELICS[id], stacks: 0 }));
    if (!offer.length) {
      // Every relic owned: convert to a perk.
      G.pendingRelics = 0;
      G.pendingPerks++;
      return currentOffer();
    }
  } else {
    const ids = Object.keys(PERKS).filter((id) => p(id) < PERKS[id].max && G.level >= (PERKS[id].min ?? 0));
    offer = pick(ids, 3).map((id) => ({ kind, id, def: PERKS[id], stacks: p(id) }));
    if (!offer.length) {
      G.pendingPerks = 0;
      return null;
    }
  }
  return offer;
}

export function takeChoice(c: Choice): void {
  if (c.kind === 'relic') {
    if (!hasRelic(c.id)) G.relics.push(c.id);
    G.pendingRelics = Math.max(0, G.pendingRelics - 1);
  } else {
    G.perks[c.id] = p(c.id) + 1;
    G.pendingPerks = Math.max(0, G.pendingPerks - 1);
  }
  offer = null;
  offerKind = null;
  emit('statsChanged');
}

export const pendingChoices = (): number => G.pendingPerks + G.pendingRelics;
