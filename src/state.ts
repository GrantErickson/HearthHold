export type ResType = 'wood' | 'stone' | 'gold';
export type EnemyType = 'raider' | 'runner' | 'brute' | 'archer' | 'shield' | 'chieftain' | 'warlord';
export type DamageKind = 'melee' | 'arrow' | 'splash';
export type Phase = 'menu' | 'build' | 'wave' | 'gameover' | 'victory';

/** Anything enemies or defenders can hit: units (circle) and structures (box). */
export interface Target {
  x: number;
  z: number;
  /** Radius for units; 0 for structures. */
  r: number;
  /** Half extents for structures; 0 for units. */
  hw: number;
  hd: number;
  alive: boolean;
  isStruct: boolean;
  damage(amount: number, kind: DamageKind): void;
}

export interface Upgrades {
  sword: number;
  armor: number;
  boots: number;
  tools: number;
  backpack: number;
}

/** Global mutable game state. Entity lists live in their own modules. */
export const G = {
  phase: 'menu' as Phase,
  paused: false,
  time: 0,
  timeScale: 1,
  coins: 0,
  wavesCleared: 0,
  wave: 0,
  buildTimer: 0,
  buildTotal: 1,
  waveTotal: 0,
  keepLevel: 1,
  endless: false,
  tut: 0,
  up: { sword: 0, armor: 0, boots: 0, tools: 0, backpack: 0 } as Upgrades,
  flags: {} as Record<string, boolean>,
  stats: { kills: 0, earned: 0, built: 0 },
  debug: false,
  god: false,
  autotest: false,
  shake: 0,
};

export function addCoins(n: number): void {
  if (n <= 0) return;
  G.coins += n;
  G.stats.earned += n;
}
