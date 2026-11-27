export type ResType = 'wood' | 'stone' | 'gold' | 'crystal';
export type EnemyType =
  | 'raider' | 'runner' | 'brute' | 'archer' | 'shield'
  | 'wolf' | 'sapper' | 'shaman' | 'berserker' | 'ram'
  | 'skeleton' | 'necro' | 'wraith' | 'bat' | 'golem'
  | 'frostmage' | 'giant' | 'icewolf'
  | 'knight' | 'trebuchet' | 'drake' | 'thief' | 'scaler'
  | 'chieftain' | 'warlord' | 'trollking' | 'mammoth' | 'lich'
  | 'wraithqueen' | 'jarl' | 'witch' | 'dragon' | 'dreadking';
/** melee / arrow / splash / pierce are physical (armor applies); magic, fire and holy are not. */
export type DamageKind = 'melee' | 'arrow' | 'splash' | 'pierce' | 'magic' | 'fire' | 'holy';
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
  /** Height that projectiles aim at (flyers are higher up). */
  aimY?: number;
  /** Flying units ignore walls and can't be hit by melee soldiers or traps. */
  flying?: boolean;
  damage(amount: number, kind: DamageKind, src?: unknown): void;
}

export interface Upgrades {
  sword: number;
  armor: number;
  boots: number;
  tools: number;
  backpack: number;
}

export interface Research {
  fletching: number;
  masonry: number;
  drill: number;
  commerce: number;
  alchemy: number;
  logistics: number;
  /** Repeatable late-game sink. */
  glory: number;
}

/** Global mutable game state. Entity lists live in their own modules. */
export const G = {
  phase: 'menu' as Phase,
  paused: false,
  time: 0,
  /** Slow motion on game over. */
  timeScale: 1,
  /** Player-chosen game speed. */
  speed: 1,
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
  research: { fletching: 0, masonry: 0, drill: 0, commerce: 0, alchemy: 0, logistics: 0, glory: 0 } as Research,
  flags: {} as Record<string, boolean>,
  stats: { kills: 0, earned: 0, built: 0, bosses: 0, chests: 0 },
  /** Hero progression. */
  level: 1,
  xp: 0,
  /** Perk id → stacks taken. */
  perks: {} as Record<string, number>,
  relics: [] as string[],
  /** Level-ups not spent yet. */
  pendingPerks: 0,
  pendingRelics: 0,
  /** Modifier rolled for the next wave ('' = none). */
  nextMod: '',
  mod: '',
  /** Build-phase happening: '', 'rush' (gold rush), 'merchant'. */
  happening: '',
  /** Seconds left on temporary buffs. */
  buffs: { warcry: 0, fury: 0 },
  debug: false,
  god: false,
  autotest: false,
  /** Camera trauma (0–1): decays every frame. */
  shake: 0,
  /** Camera punch toward the action (0–1). */
  kick: 0,
  /** Real seconds of near-frozen time left (impact hit-stop). */
  hitStop: 0,
};

export function addCoins(n: number): void {
  if (n <= 0) return;
  G.coins += n;
  G.stats.earned += n;
}

/** 1-based act number for a wave. */
export const actOf = (w: number): number => Math.min(5, Math.max(1, Math.ceil(w / 20)));
