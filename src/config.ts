import type { EnemyType, ResType } from './state';

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  /** Seconds between attacks. */
  interval: number;
  /** Attack reach (surface to surface). */
  range: number;
  coins: number;
  r: number;
  scale: number;
  wallMul?: number;
  ranged?: boolean;
  arrowResist?: number;
  boss?: boolean;
  /** Never slides sideways looking for a gap in the wall. */
  noGap?: boolean;
  /** Seconds between summoning raiders. */
  summon?: number;
}

export interface ResDef {
  value: number;
  units: number;
  regrow: number;
  hard: number;
  icon: string;
  name: string;
  color: number;
}

/** All balance numbers live here. Pad costs and unlocks live in pads.ts. */
export const CFG = {
  map: {
    minX: -29.5,
    maxX: 29.5,
    minZ: -48,
    maxZ: 29.5,
    wallZ: -14,
    wallHalf: 0.6,
    segCount: 6,
    segWidth: 10,
    segStart: -30,
    spawnZ: -47,
  },
  totalWaves: 20,
  hero: {
    hp: [100, 150, 220, 320, 450],
    dmg: [12, 18, 26, 38, 54, 75],
    speed: [6, 7, 8, 9.2],
    cap: [8, 14, 22, 32, 45],
    harvest: [0.45, 0.36, 0.28, 0.21],
    attackRange: 2.0,
    attackCd: 0.55,
    cleave: 0.4,
    harvestRange: 0.8,
    magnet: 3.4,
    regen: 10,
    regenDelay: 3,
    respawn: 4,
    r: 0.45,
  },
  res: {
    wood: { value: 4, units: 5, regrow: 18, hard: 1, icon: '🪵', name: 'Wood', color: 0x8b5a2b },
    stone: { value: 9, units: 4, regrow: 28, hard: 1.5, icon: '🪨', name: 'Stone', color: 0xa3a8ad },
    gold: { value: 22, units: 3, regrow: 40, hard: 2.2, icon: '🔶', name: 'Gold ore', color: 0xf2c230 },
  } as Record<ResType, ResDef>,
  market: { interval: [0.2, 0.12, 0.07], valueMul: [1, 1.25, 1.5] },
  worker: { speed: 3.4, cap: 4, harvest: 1.0 },
  tower: {
    range: [12, 13, 14],
    dmg: [10, 18, 28],
    interval: [1.0, 0.85, 0.7],
    shots: [1, 1, 2],
    hp: [300, 500, 800],
  },
  catapult: { range: [18, 20], minRange: 4, dmg: [45, 80], interval: [3.2, 2.6], splash: 3, hp: [600, 900] },
  keep: { hp: [600, 1000, 1600, 2500], range: 10, dmg: [0, 0, 12, 20], interval: 0.8, shots: [0, 0, 1, 2] },
  wall: { hp: [300, 700, 1400, 2600], names: ['Palisade', 'Stone Wall', 'Fortified Wall', 'Iron Wall'] },
  soldier: {
    hp: [90, 120, 150, 190],
    dmg: [9, 12, 15, 19],
    cap: [2, 4, 6, 8],
    speed: 4.2,
    range: 1.3,
    interval: 0.8,
    train: 6,
    engage: 7.5,
    r: 0.4,
  },
  enemies: {
    raider: { name: 'Raider', hp: 30, speed: 2.4, dmg: 5, interval: 1.0, range: 0.5, coins: 3, r: 0.45, scale: 1 },
    runner: { name: 'Runner', hp: 20, speed: 4.2, dmg: 4, interval: 0.8, range: 0.5, coins: 3, r: 0.4, scale: 0.9 },
    brute: { name: 'Brute', hp: 160, speed: 1.6, dmg: 18, wallMul: 2, interval: 1.6, range: 0.6, coins: 12, r: 0.65, scale: 1.4, noGap: true },
    archer: { name: 'Archer', hp: 26, speed: 2.2, dmg: 7, interval: 1.6, range: 5.5, ranged: true, coins: 5, r: 0.42, scale: 1 },
    shield: { name: 'Shieldbearer', hp: 100, speed: 2.0, dmg: 10, interval: 1.2, range: 0.5, coins: 8, r: 0.5, scale: 1.1, arrowResist: 0.5 },
    chieftain: { name: 'Chieftain', hp: 900, speed: 1.9, dmg: 35, wallMul: 1.5, interval: 1.4, range: 0.8, coins: 80, r: 0.85, scale: 1.6, boss: true, noGap: true },
    warlord: { name: 'Warlord', hp: 5000, speed: 1.7, dmg: 60, wallMul: 2, interval: 1.8, range: 1.0, coins: 300, r: 1.1, scale: 2.2, boss: true, noGap: true, summon: 10 },
  } as Record<EnemyType, EnemyDef>,
};

/** Seconds of build time before `nextWave` starts. */
export function buildTime(nextWave: number): number {
  if (nextWave === 1) return 90;
  if (nextWave % 5 === 0) return 60;
  return 45;
}

export const callEarlyBonus = (remaining: number, nextWave: number): number =>
  Math.max(1, Math.round(remaining * (0.6 + nextWave * 0.12)));
export const waveClearBonus = (w: number): number => 15 + w * 8;
export const spawnSpread = (w: number): number => Math.min(26, 4 + w * 3);
export const spawnInterval = (w: number): number => Math.max(0.3, 1.15 - w * 0.04);
export const hpScale = (w: number): number => 1 + 0.12 * (w - 1) + (w > 20 ? 0.05 * Math.pow(w - 20, 1.5) : 0);
export const bossScale = (w: number): number => 1 + 0.05 * (w - 1) + (w > 20 ? 0.05 * (w - 20) : 0);
export const dmgScale = (w: number): number => 1 + 0.06 * (w - 1);
export const coinScale = (w: number): number => 1 + 0.05 * (w - 1);

/** Enemy list for a wave, in spawn order. */
export function composition(w: number): EnemyType[] {
  const list: EnemyType[] = [];
  const add = (t: EnemyType, n: number) => {
    for (let i = 0; i < n; i++) list.push(t);
  };
  add('raider', Math.round(3 + w * 1.5));
  if (w >= 4) add('runner', Math.round((w - 3) * 0.9));
  if (w >= 6) add('brute', Math.floor((w - 4) / 2));
  if (w >= 9) add('archer', Math.round((w - 7) * 0.7));
  if (w >= 12) add('shield', Math.round((w - 10) * 0.8));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const bosses: EnemyType[] = [];
  if (w >= 20 && w % 10 === 0) bosses.push('warlord');
  else if (w >= 10 && w % 5 === 0) {
    const n = w === 10 ? 1 : w === 15 ? 2 : 1 + Math.floor(w / 15);
    for (let i = 0; i < n; i++) bosses.push('chieftain');
  }
  bosses.forEach((b, i) => list.splice(Math.floor(list.length * (0.35 + i * 0.2)), 0, b));
  return list;
}
