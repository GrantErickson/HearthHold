import { G } from './state';
import { hero, capacity } from './hero';
import { nodes } from './world';
import { market } from './structures';
import { getSlot, slots, costOf, nameOf, type Slot } from './pads';
import { Waves } from './waves';
import { on } from './events';
import { pendingChoices } from './progress';
import { nearestChest } from './happenings';

export interface Objective {
  text: string;
  target: { x: number; z: number } | null;
}

let newest: { slot: Slot; until: number } | null = null;
on('unlock', (s) => {
  newest = { slot: s as Slot, until: G.time + 12 };
});

function nearestPad(ids: string[]): Slot | null {
  let best: Slot | null = null;
  let bd = Infinity;
  for (const id of ids) {
    const s = getSlot(id);
    if (!s || !s.visible) continue;
    const d = Math.hypot(s.pad.x - hero.x, s.pad.z - hero.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function nearestTree(): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bd = Infinity;
  for (const n of nodes) {
    if (n.type !== 'wood' || n.state !== 'grown') continue;
    const d = Math.hypot(n.x - hero.x, n.z - hero.z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

const padTarget = (s: Slot | null) => (s ? { x: s.pad.x, z: s.pad.z } : null);

/** Advance the tutorial and describe the current objective. */
export function updateTutorial(): Objective {
  const f = G.flags;
  if (G.tut === 0 && (hero.stack.length >= Math.min(5, capacity()) || f.firstSale)) G.tut = 1;
  if (G.tut === 1 && f.firstSale) G.tut = 2;
  if (G.tut === 2 && (f.firstCollect || G.coins >= 25)) G.tut = 3;
  if (G.tut === 3 && f.firstWall) G.tut = 4;
  if (G.tut === 4 && f.firstTower) G.tut = 5;
  if (G.tut === 5 && G.wavesCleared >= 1) G.tut = 6;

  if (G.phase === 'wave') {
    const n = Waves.remaining();
    const word = G.wave <= 20 ? (n === 1 ? 'raider' : 'raiders') : n === 1 ? 'enemy' : 'enemies';
    return { text: `Defend the keep! ${n} ${word} left`, target: null };
  }
  if (G.phase !== 'build') return { text: '', target: null };

  switch (G.tut) {
    case 0:
      return { text: 'Walk into the forest — you chop trees automatically', target: nearestTree() };
    case 1:
      if (hero.stack.length === 0) return { text: 'Chop some wood in the forest', target: nearestTree() };
      return { text: 'Carry the wood to the market and stand on SELL', target: market.drop };
    case 2:
      return { text: 'Stand on COINS to collect your money', target: market.coin };
    case 3: {
      const s = nearestPad(['wall2', 'wall3']);
      if (s && G.coins < costOf(s) - s.paid && !hero.stack.length)
        return { text: `Build a wall (${costOf(s)} coins) — sell more wood first`, target: padTarget(s) };
      return { text: 'Stand on a wall pad to build a Palisade', target: padTarget(s) };
    }
    case 4:
      return { text: 'Build an Archer Tower behind your wall', target: padTarget(nearestPad(['tower2', 'tower3'])) };
    case 5:
      return { text: 'Get ready — raiders attack from the north!', target: null };
  }

  if (newest && G.time < newest.until && newest.slot.visible) {
    return { text: `New: ${nameOf(newest.slot)}`, target: padTarget(newest.slot) };
  }
  const picks = pendingChoices();
  if (picks > 0) return { text: G.pendingRelics > 0 ? 'A relic awaits! Press L or tap ⭐ to claim it' : `Level up! Press L or tap ⭐ to choose a perk${picks > 1 ? ` (${picks})` : ''}`, target: null };
  if (hero.stack.length >= capacity()) return { text: 'Backpack full — sell at the market', target: market.drop };
  if (market.pile >= 30) return { text: `${market.pile} coins waiting at the market`, target: market.coin };
  const chest = nearestChest();
  if (chest && Math.hypot(chest.x - hero.x, chest.z - hero.z) < 34) return { text: 'A treasure chest is nearby!', target: chest };
  if (G.flags.merchant) {
    const m = getSlot('merchant1');
    if (m?.visible && G.time % 20 < 6) return { text: 'The merchant has rare goods by the keep', target: padTarget(m) };
  }
  if (G.happening === 'rush' && hero.stack.length) return { text: 'Gold Rush! Sell now for 50% more', target: market.drop };
  let cheapest: Slot | null = null;
  for (const s of slots) {
    if (!s.visible) continue;
    const rem = costOf(s) - s.paid;
    if (rem <= G.coins && (!cheapest || rem < costOf(cheapest) - cheapest.paid)) cheapest = s;
  }
  if (cheapest) return { text: `You can afford: ${nameOf(cheapest)}`, target: padTarget(cheapest) };
  return { text: 'Gather and sell resources to earn coins', target: null };
}
