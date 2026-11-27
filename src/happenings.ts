import * as THREE from 'three';
import { scene } from './engine';
import { G } from './state';
import { RELICS } from './config';
import { chestGeo, cartGeo, makeMesh, unitModel, type UnitModel } from './models';
import { World } from './world';
import { hero } from './hero';
import { setTempOffer, MERCHANT_CART } from './pads';
import { burst, dropCoins, text, pop, ring } from './fx';
import { Sfx } from './audio';
import { on, emit } from './events';
import { gainXp, hasRelic } from './progress';

/**
 * Things that happen between waves: treasure chests, the travelling merchant
 * and gold rushes.
 */

interface Chest {
  m: THREE.Mesh;
  x: number;
  z: number;
  value: number;
  age: number;
}
const chests: Chest[] = [];
let cart: THREE.Group | null = null;
let merchantModel: UnitModel | null = null;
let sinceMerchant = 0;

export interface HappeningInfo {
  title: string;
  sub: string;
}

function spawnChest(value: number): void {
  const p = World.chestSpot();
  const m = makeMesh(chestGeo());
  m.position.set(p.x, 0, p.z);
  m.rotation.y = Math.random() * Math.PI * 2;
  if (!G.autotest) {
    scene.add(m);
    pop(m, 0.5);
  }
  chests.push({ m, x: p.x, z: p.z, value, age: 0 });
}

export const chestList = (): readonly Chest[] => chests;

function showCart(on: boolean): void {
  if (G.autotest) return;
  if (on && !cart) {
    cart = new THREE.Group();
    cart.add(makeMesh(cartGeo()));
    merchantModel = unitModel('merchant');
    merchantModel.group.position.set(1.1, 0, 0.9);
    merchantModel.group.rotation.y = 0.3;
    cart.add(merchantModel.group);
    cart.position.set(MERCHANT_CART.x, 0, MERCHANT_CART.z);
    scene.add(cart);
    pop(cart, 0.5);
  } else if (!on && cart) {
    burst(cart.position.x, 1, cart.position.z, 0xf2c230, 14, { speed: 3, up: 3 });
    scene.remove(cart);
    cart = null;
    merchantModel = null;
  }
}

function merchantOffers(): void {
  const w = G.wavesCleared + 1;
  const offers = [
    {
      name: 'Perk Scroll', icon: '📜', cost: 120 + w * 45, desc: 'Learn one extra perk',
      buy: () => {
        G.pendingPerks++;
        emit('levelUp', G.level);
      },
    },
    {
      name: 'Fury Elixir', icon: '🧪', cost: 60 + w * 25, desc: 'Hero deals +50% damage next wave',
      buy: () => {
        G.buffs.fury = 9999;
        text(hero.x, 3, hero.z, 'Fury!', 'gold big');
      },
    },
    {
      name: 'Treasure Map', icon: '🗺️', cost: 80 + w * 28, desc: 'Reveals three treasure chests',
      buy: () => {
        for (let i = 0; i < 3; i++) spawnChest(Math.round((30 + w * 14) * (0.8 + Math.random() * 0.5)));
        emit('happening', 'map');
      },
    },
    {
      name: 'Tome of Wisdom', icon: '📘', cost: 100 + w * 40, desc: 'Gain a big chunk of hero XP',
      buy: () => gainXp(Math.round(60 + w * 30)),
    },
  ];
  if (w >= 12 && Object.keys(RELICS).some((id) => !hasRelic(id))) {
    offers.push({
      name: 'Ancient Relic', icon: '🏺', cost: 600 + w * 160, desc: 'Choose one of three relics',
      buy: () => {
        G.pendingRelics++;
        emit('levelUp', G.level);
      },
    });
  }
  for (let i = offers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offers[i], offers[j]] = [offers[j], offers[i]];
  }
  setTempOffer('merchant1', offers[0]);
  setTempOffer('merchant2', offers[1]);
}

function startBuild(): void {
  const w = G.wavesCleared;
  G.happening = '';
  if (w < 1) return;
  const events: HappeningInfo[] = [];
  // Chests: usually one, sometimes two, more often later on.
  const n = Math.random() < 0.55 ? (Math.random() < 0.25 + w * 0.004 ? 2 : 1) : 0;
  for (let i = 0; i < n; i++) spawnChest(Math.round((25 + w * 12) * (0.7 + Math.random() * 0.6)));
  if (n) events.push({ title: '🎁 Treasure!', sub: n > 1 ? 'Two chests are hidden nearby' : 'A chest is hidden somewhere nearby' });
  sinceMerchant++;
  if (w >= 4 && (sinceMerchant >= 7 || Math.random() < 0.15)) {
    sinceMerchant = 0;
    G.flags.merchant = true;
    merchantOffers();
    showCart(true);
    Sfx.play('bell');
    events.push({ title: '🛒 A merchant arrives', sub: 'Rare goods by the keep — until the next wave' });
  } else if (w >= 6 && Math.random() < 0.18) {
    G.happening = 'rush';
    events.push({ title: '✨ Gold Rush!', sub: 'Everything sells for 50% more until the next wave' });
  }
  for (const e of events) emit('happening', e);
}

function startWave(): void {
  G.happening = '';
  if (G.flags.merchant) {
    G.flags.merchant = false;
    showCart(false);
  }
}

export function initHappenings(): void {
  on('happening', (arg) => {
    if (arg === 'build') startBuild();
    else if (arg === 'wave') startWave();
  });
}

export function updateHappenings(dt: number): void {
  for (let i = chests.length - 1; i >= 0; i--) {
    const c = chests[i];
    c.age += dt;
    c.m.position.y = Math.abs(Math.sin(G.time * 3 + i)) * 0.12;
    c.m.rotation.y += dt * 0.6;
    if (Math.random() < dt * 3) burst(c.x, 0.9, c.z, 0xffe27a, 1, { glow: true, speed: 0.6, up: 1.2, life: 0.8 });
    if (hero.alive && Math.hypot(hero.x - c.x, hero.z - c.z) < 1.5) {
      chests.splice(i, 1);
      scene.remove(c.m);
      dropCoins(c.x, c.z, c.value);
      gainXp(Math.round(c.value * 0.15));
      G.stats.chests++;
      burst(c.x, 0.8, c.z, 0xffd54a, 26, { glow: true, speed: 5, up: 6, life: 0.9 });
      ring(c.x, c.z, 0xffd54a, 3, 0.5);
      text(c.x, 2.2, c.z, `Treasure! +${c.value}`, 'gold big', 1.6);
      Sfx.play('chest');
    } else if (c.age > 600) {
      chests.splice(i, 1);
      scene.remove(c.m);
    }
  }
  if (merchantModel) merchantModel.anim(dt, false, 0, Math.sin(G.time * 1.3) > 0.97 ? 0.5 : 1);
}

/** Nearest unopened chest (for the objective marker). */
export function nearestChest(): { x: number; z: number } | null {
  let best: Chest | null = null;
  let bd = Infinity;
  for (const c of chests) {
    const d = Math.hypot(c.x - hero.x, c.z - hero.z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
