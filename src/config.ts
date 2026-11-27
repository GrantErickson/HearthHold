import { actOf, type EnemyType, type ResType } from './state';

export type ModelKind = 'human' | 'wolf' | 'mammoth' | 'ram' | 'trebuchet' | 'bat' | 'drake' | 'dragon';

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
  xp: number;
  /** Threat points used to build a wave. */
  cost: number;
  r: number;
  scale: number;
  model: ModelKind;
  wallMul?: number;
  ranged?: boolean;
  /** Ranged attack is a magic bolt rather than an arrow. */
  magic?: boolean;
  arrowResist?: number;
  splashResist?: number;
  /** Flat damage reduction per hit (scales with the wave). */
  armor?: number;
  boss?: boolean;
  /** Never slides sideways looking for a gap in the wall. */
  noGap?: boolean;
  summon?: { type: EnemyType; n: number; every: number };
  flying?: boolean;
  /** Passes through walls; physical damage halved. */
  ethereal?: boolean;
  undead?: boolean;
  /** Only attacks structures. */
  siege?: boolean;
  /** Runs at a structure and explodes. */
  bomb?: { dmg: number; radius: number };
  heal?: { frac: number; radius: number; every: number };
  enrage?: boolean;
  /** Fraction of max HP regenerated per second. */
  regen?: number;
  slam?: { dmg: number; radius: number; every: number; stun: number };
  /** Freezes nearby towers. */
  nova?: { radius: number; every: number; dur: number };
  /** Lobs boulders at structures from range. */
  lob?: { dmg: number; range: number; every: number; splash: number };
  /** Fire breath on structures in reach. */
  breath?: boolean;
  slowOnHit?: number;
  slowImmune?: boolean;
  lifesteal?: number;
  /** Periodic damage-absorbing shield as a fraction of max HP. */
  shield?: { frac: number; every: number };
  /** Rushes the wall at triple speed when close. */
  charge?: boolean;
  /** Prefers towers over everything else. */
  hunter?: boolean;
  /** Climbs over standing walls instead of battering them. */
  climber?: boolean;
  /** Ignores fighting: runs for the treasury, grabs coins and flees. */
  thief?: boolean;
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

const E = (d: Omit<EnemyDef, 'model'> & { model?: ModelKind }): EnemyDef => ({ model: 'human', ...d });

/** All balance numbers live here. Pad costs and unlocks live in pads.ts. */
export const CFG = {
  map: {
    minX: -29.5,
    maxX: 29.5,
    minZ: -64,
    maxZ: 39.5,
    wallZ: -20,
    wallHalf: 0.6,
    segCount: 6,
    segWidth: 10,
    segStart: -30,
    spawnZ: -62,
  },
  totalWaves: 100,
  speeds: [1, 1.5, 2, 3],
  hero: {
    hp: [100, 150, 220, 320, 450, 600, 800, 1050, 1400],
    dmg: [12, 18, 26, 38, 54, 75, 100, 135, 180, 240, 320],
    speed: [6, 7, 8, 9.2, 10.2, 11.2],
    cap: [8, 14, 22, 32, 45, 55, 66],
    harvest: [0.45, 0.36, 0.28, 0.21, 0.16, 0.12],
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
    crystal: { value: 38, units: 3, regrow: 55, hard: 3, icon: '💎', name: 'Crystal', color: 0x7fe3ff },
  } as Record<ResType, ResDef>,
  market: { interval: [0.2, 0.12, 0.07, 0.05, 0.035], valueMul: [1, 1.2, 1.4, 1.6, 1.8] },
  worker: { speed: 3.4, cap: 4, harvest: 1.0 },
  tower: {
    range: [12, 13, 14, 15, 16],
    dmg: [10, 18, 28, 42, 60],
    interval: [1.0, 0.85, 0.7, 0.6, 0.5],
    shots: [1, 1, 2, 2, 3],
    hp: [300, 500, 800, 1200, 1800],
  },
  catapult: { range: [18, 20, 24], minRange: 4, dmg: [45, 80, 150], interval: [3.2, 2.6, 2.2], splash: [3, 3, 3.6], hp: [600, 900, 1400] },
  keep: {
    hp: [600, 1000, 1600, 2500, 3800, 5500, 8000, 12000],
    range: [10, 10, 10, 11, 12, 13, 14, 15],
    dmg: [0, 0, 12, 20, 32, 50, 75, 110],
    interval: 0.8,
    shots: [0, 0, 1, 2, 2, 3, 3, 4],
  },
  wall: {
    hp: [300, 700, 1400, 2600, 4200, 6500],
    names: ['Palisade', 'Stone Wall', 'Fortified Wall', 'Iron Wall', 'Runic Wall', 'Adamant Wall'],
    /** Fraction of melee damage reflected at attackers. */
    thorns: [0, 0, 0, 0, 0.2, 0.35],
  },
  soldier: {
    hp: [90, 120, 150, 190, 260, 350],
    dmg: [9, 12, 15, 19, 26, 35],
    cap: [2, 4, 6, 8, 10, 12],
    speed: 4.2,
    range: 1.3,
    interval: 0.8,
    train: 6,
    engage: 7.5,
    r: 0.4,
  },
  /** Archers stand on stone walls (level 2+): extra range from the height, and melee can't reach them. */
  ranger: { hp: [70, 95, 125, 170], dmg: [8, 12, 18, 26], cap: [2, 3, 4, 6], range: 9, wallRange: 3, interval: 1.1, train: 7, r: 0.38 },
  frost: { range: [10, 11, 12], aura: [6, 7, 8], dmg: [8, 14, 22], slow: [0.3, 0.4, 0.5], interval: [1.2, 1.1, 1.0], hp: [500, 800, 1200] },
  mage: { range: [13, 14, 15, 16], dmg: [30, 55, 90, 140], jumps: [3, 4, 5, 6], interval: [1.6, 1.4, 1.2, 1.0], hp: [500, 800, 1200, 1700] },
  ballista: { range: [22, 24, 26, 28], dmg: [60, 110, 180, 280], interval: [2.4, 2.1, 1.8, 1.5], hp: [600, 900, 1300, 1800] },
  fire: { range: [12, 13, 14, 15], dmg: [40, 70, 110, 170], splash: [2.4, 2.6, 2.8, 3], burn: [6, 10, 16, 25], interval: [2.0, 1.8, 1.6, 1.4], hp: [500, 800, 1200, 1700] },
  spire: { range: [9, 10, 11], heal: [8, 14, 22], repair: [0.005, 0.01, 0.015], smite: [50, 90, 150], interval: 2.5, hp: [700, 1000, 1500] },
  /** Counter-siege: long range, hunts siege engines and ranged enemies first. */
  cannon: { range: [30, 32, 34, 36], minRange: 6, dmg: [150, 270, 450, 700], interval: [3.0, 2.6, 2.2, 1.8], splash: [2.4, 2.7, 3.0, 3.4], hp: [900, 1300, 1800, 2500] },
  /** Griffin riders: fly anywhere, dive on siege, ranged, flying and straggling enemies. */
  aerie: { count: [2, 3, 4, 5], dmg: [55, 100, 170, 280], interval: 1.6, speed: 12, hp: [1000, 1500, 2100, 2800] },
  /** A friendly dragon that strafes the densest enemies with fire. */
  roost: { dmg: [70, 120, 200], burn: [25, 45, 80], breath: [1.6, 2.0, 2.5], cooldown: [6.5, 5.5, 4.5], width: 2.8, hp: [1800, 2600, 3600] },
  spikes: { dmg: [8, 15, 25, 40], interval: 0.6, radius: 2.2 },
  tar: { slow: [0.35, 0.45, 0.55], burn: [0, 0, 15], radius: 2.3 },
  ability: {
    whirlwind: { level: 2, cd: 10, mult: 2.5, radius: 3.4 },
    warcry: { level: 5, cd: 32, dur: 8, haste: 1.4 },
    meteor: { level: 10, cd: 40, mult: 8, radius: 4.2, range: 22 },
    bastion: { level: 16, cd: 60, repair: 0.3 },
  },
  enemies: {
    raider: E({ name: 'Raider', hp: 30, speed: 2.4, dmg: 5, interval: 1.0, range: 0.5, coins: 3, xp: 2, cost: 1, r: 0.45, scale: 1 }),
    runner: E({ name: 'Runner', hp: 20, speed: 4.2, dmg: 4, interval: 0.8, range: 0.5, coins: 3, xp: 2, cost: 1, r: 0.4, scale: 0.9 }),
    brute: E({ name: 'Brute', hp: 160, speed: 1.6, dmg: 18, wallMul: 2, interval: 1.6, range: 0.6, coins: 12, xp: 8, cost: 5, r: 0.65, scale: 1.4, noGap: true }),
    archer: E({ name: 'Archer', hp: 26, speed: 2.2, dmg: 7, interval: 1.6, range: 5.5, ranged: true, coins: 5, xp: 3, cost: 1.6, r: 0.42, scale: 1 }),
    shield: E({ name: 'Shieldbearer', hp: 100, speed: 2.0, dmg: 10, interval: 1.2, range: 0.5, coins: 8, xp: 5, cost: 3.5, r: 0.5, scale: 1.1, arrowResist: 0.5 }),
    wolf: E({ name: 'Wolf', model: 'wolf', hp: 26, speed: 5.0, dmg: 6, interval: 0.7, range: 0.5, coins: 3, xp: 2, cost: 1.1, r: 0.45, scale: 1 }),
    sapper: E({ name: 'Sapper', hp: 40, speed: 3.0, dmg: 0, interval: 1, range: 0.4, coins: 6, xp: 4, cost: 3, r: 0.45, scale: 1, siege: true, bomb: { dmg: 160, radius: 3 } }),
    shaman: E({ name: 'Shaman', hp: 60, speed: 2.0, dmg: 6, interval: 1.8, range: 7, ranged: true, magic: true, coins: 10, xp: 6, cost: 4, r: 0.45, scale: 1, heal: { frac: 0.12, radius: 6, every: 3 } }),
    berserker: E({ name: 'Berserker', hp: 90, speed: 2.6, dmg: 12, interval: 1.0, range: 0.5, coins: 8, xp: 5, cost: 3, r: 0.5, scale: 1.15, enrage: true }),
    ram: E({ name: 'Battering Ram', model: 'ram', hp: 420, speed: 1.2, dmg: 60, wallMul: 2.5, interval: 2.2, range: 0.4, coins: 25, xp: 14, cost: 10, r: 1.0, scale: 1, siege: true, noGap: true, arrowResist: 0.4, slowImmune: true }),
    skeleton: E({ name: 'Skeleton', hp: 22, speed: 2.6, dmg: 5, interval: 1.0, range: 0.5, coins: 2, xp: 1, cost: 0.7, r: 0.42, scale: 1, undead: true }),
    necro: E({ name: 'Necromancer', hp: 80, speed: 1.8, dmg: 9, interval: 1.8, range: 7, ranged: true, magic: true, coins: 14, xp: 8, cost: 6, r: 0.45, scale: 1.05, undead: true, summon: { type: 'skeleton', n: 2, every: 7 } }),
    wraith: E({ name: 'Wraith', hp: 70, speed: 2.2, dmg: 10, interval: 1.1, range: 0.5, coins: 9, xp: 6, cost: 4, r: 0.45, scale: 1.1, undead: true, ethereal: true }),
    bat: E({ name: 'Giant Bat', model: 'bat', hp: 18, speed: 4.6, dmg: 4, interval: 0.8, range: 0.5, coins: 2, xp: 2, cost: 1, r: 0.4, scale: 1, flying: true }),
    golem: E({ name: 'Bone Golem', hp: 520, speed: 1.1, dmg: 30, wallMul: 2, interval: 1.8, range: 0.7, coins: 30, xp: 16, cost: 12, r: 1.0, scale: 1.8, noGap: true, splashResist: 0.5, slowImmune: true, undead: true }),
    frostmage: E({ name: 'Frost Mage', hp: 55, speed: 2.0, dmg: 8, interval: 1.7, range: 7, ranged: true, magic: true, coins: 10, xp: 6, cost: 4, r: 0.45, scale: 1, slowOnHit: 0.4 }),
    icewolf: E({ name: 'Ice Wolf', model: 'wolf', hp: 40, speed: 5.2, dmg: 8, interval: 0.7, range: 0.5, coins: 4, xp: 3, cost: 1.5, r: 0.48, scale: 1.1, slowOnHit: 0.25 }),
    giant: E({ name: 'Frost Giant', hp: 700, speed: 1.3, dmg: 40, wallMul: 2, interval: 1.9, range: 0.8, coins: 40, xp: 20, cost: 15, r: 1.1, scale: 2.1, noGap: true, lob: { dmg: 60, range: 11, every: 5, splash: 2 } }),
    knight: E({ name: 'Dark Knight', hp: 220, speed: 2.0, dmg: 20, wallMul: 1.5, interval: 1.2, range: 0.6, coins: 16, xp: 10, cost: 6, r: 0.55, scale: 1.2, armor: 6 }),
    trebuchet: E({ name: 'Trebuchet', model: 'trebuchet', hp: 380, speed: 1.0, dmg: 0, interval: 4.5, range: 13, coins: 35, xp: 18, cost: 12, r: 1.2, scale: 1, siege: true, noGap: true, arrowResist: 0.5, slowImmune: true, lob: { dmg: 90, range: 13, every: 4.5, splash: 2.2 }, ranged: true }),
    thief: E({ name: 'Goblin Thief', hp: 45, speed: 4.1, dmg: 0, interval: 1, range: 0.6, coins: 14, xp: 6, cost: 2.5, r: 0.4, scale: 0.85, climber: true, thief: true }),
    scaler: E({ name: 'Wall Scaler', hp: 95, speed: 2.9, dmg: 14, interval: 1.0, range: 0.5, coins: 10, xp: 6, cost: 3, r: 0.45, scale: 1.05, climber: true, hunter: true }),
    drake: E({ name: 'Fire Drake', model: 'drake', hp: 120, speed: 3.0, dmg: 14, interval: 1.3, range: 4.5, coins: 14, xp: 9, cost: 5, r: 0.7, scale: 1.1, flying: true, breath: true, hunter: true }),

    chieftain: E({ name: 'Chieftain', hp: 900, speed: 1.9, dmg: 35, wallMul: 1.5, interval: 1.4, range: 0.8, coins: 80, xp: 60, cost: 0, r: 0.85, scale: 1.6, boss: true, noGap: true, enrage: true }),
    warlord: E({ name: 'Warlord', hp: 5000, speed: 1.7, dmg: 60, wallMul: 2, interval: 1.8, range: 1.0, coins: 300, xp: 250, cost: 0, r: 1.1, scale: 2.2, boss: true, noGap: true, enrage: true, summon: { type: 'raider', n: 3, every: 10 } }),
    trollking: E({ name: 'Troll King', hp: 6000, speed: 1.6, dmg: 70, wallMul: 2, interval: 1.8, range: 1.1, coins: 400, xp: 350, cost: 0, r: 1.25, scale: 2.5, boss: true, noGap: true, regen: 0.008, slam: { dmg: 40, radius: 4.5, every: 7, stun: 1.5 } }),
    mammoth: E({ name: 'Great Mammoth', model: 'mammoth', hp: 8000, speed: 1.5, dmg: 90, wallMul: 4, interval: 2.0, range: 0.8, coins: 500, xp: 450, cost: 0, r: 1.8, scale: 1, boss: true, noGap: true, charge: true, slowImmune: true, slam: { dmg: 50, radius: 5, every: 6, stun: 1 } }),
    lich: E({ name: 'The Lich', hp: 6500, speed: 1.5, dmg: 40, interval: 1.6, range: 6, ranged: true, magic: true, coins: 600, xp: 550, cost: 0, r: 0.9, scale: 1.9, boss: true, noGap: true, undead: true, summon: { type: 'skeleton', n: 4, every: 8 }, shield: { frac: 0.1, every: 14 } }),
    wraithqueen: E({ name: 'Wraith Queen', hp: 7000, speed: 1.8, dmg: 60, interval: 1.4, range: 1.0, coins: 700, xp: 650, cost: 0, r: 0.9, scale: 2.0, boss: true, undead: true, ethereal: true, lifesteal: 0.5, summon: { type: 'wraith', n: 2, every: 10 } }),
    jarl: E({ name: 'Frost Jarl', hp: 8000, speed: 1.4, dmg: 90, wallMul: 2, interval: 2.0, range: 1.2, coins: 800, xp: 750, cost: 0, r: 1.4, scale: 2.8, boss: true, noGap: true, slowImmune: true, nova: { radius: 12, every: 10, dur: 3 }, lob: { dmg: 80, range: 12, every: 6, splash: 2.4 }, slam: { dmg: 60, radius: 4.5, every: 9, stun: 1.5 } }),
    witch: E({ name: 'Winter Witch', hp: 7000, speed: 1.7, dmg: 45, interval: 1.4, range: 6, ranged: true, magic: true, slowOnHit: 0.5, coins: 900, xp: 850, cost: 0, r: 0.8, scale: 1.8, boss: true, noGap: true, nova: { radius: 11, every: 12, dur: 3 }, summon: { type: 'icewolf', n: 3, every: 9 }, shield: { frac: 0.1, every: 16 } }),
    dragon: E({ name: 'The Red Dragon', model: 'dragon', hp: 9000, speed: 2.0, dmg: 80, interval: 2.8, range: 5, coins: 1200, xp: 1000, cost: 0, r: 1.6, scale: 1, boss: true, flying: true, breath: true, hunter: true, enrage: true, summon: { type: 'drake', n: 2, every: 15 } }),
    dreadking: E({ name: 'The Dread King', hp: 12000, speed: 1.6, dmg: 110, wallMul: 2.5, interval: 1.8, range: 1.3, coins: 2000, xp: 1500, cost: 0, r: 1.4, scale: 2.7, boss: true, noGap: true, armor: 8, enrage: true, slowImmune: true, summon: { type: 'knight', n: 2, every: 12 }, slam: { dmg: 80, radius: 5, every: 8, stun: 1.5 }, shield: { frac: 0.08, every: 18 }, nova: { radius: 10, every: 14, dur: 2.5 } }),
  } as Record<EnemyType, EnemyDef>,
};

// ───────────────────────────── Acts ─────────────────────────────

export interface ActDef {
  name: string;
  sub: string;
  /** [type, weight, first wave] */
  roster: [EnemyType, number, number][];
}

export const ACTS: ActDef[] = [
  { name: 'The Raider Clans', sub: 'Hold the valley against the northern clans', roster: [] },
  {
    name: 'The Beast Tribes', sub: 'Wolves, berserkers and siege rams pour from the hills',
    roster: [['raider', 3, 21], ['runner', 1.5, 21], ['brute', 1, 21], ['archer', 1.5, 21], ['shield', 1, 21], ['wolf', 3, 21], ['berserker', 2, 22], ['sapper', 1.2, 23], ['shaman', 0.8, 24], ['ram', 0.5, 27]],
  },
  {
    name: 'The Restless Dead', sub: 'Something stirs in the old barrows',
    roster: [['raider', 1, 41], ['brute', 0.6, 41], ['archer', 1, 41], ['shield', 0.8, 41], ['wolf', 1, 41], ['berserker', 0.8, 41], ['sapper', 0.6, 41], ['shaman', 0.4, 41], ['ram', 0.4, 41], ['skeleton', 4, 41], ['necro', 0.8, 42], ['bat', 2, 43], ['wraith', 1.5, 44], ['golem', 0.4, 47]],
  },
  {
    name: 'The Frozen North', sub: 'Winter comes, and the giants with it',
    roster: [['wolf', 1, 61], ['berserker', 1, 61], ['shield', 0.8, 61], ['ram', 0.4, 61], ['skeleton', 1.5, 61], ['wraith', 0.8, 61], ['bat', 1, 61], ['golem', 0.4, 61], ['necro', 0.4, 61], ['archer', 1, 61], ['sapper', 0.6, 61], ['icewolf', 3, 61], ['frostmage', 1.2, 62], ['giant', 0.5, 64], ['scaler', 1.1, 63], ['thief', 0.35, 66]],
  },
  {
    name: 'The Dark Legion', sub: 'The Dread King marches on Hearthold',
    roster: [['knight', 2.5, 81], ['drake', 1, 82], ['trebuchet', 0.4, 84], ['icewolf', 1, 81], ['berserker', 1, 81], ['shield', 0.8, 81], ['giant', 0.4, 81], ['golem', 0.4, 81], ['wraith', 0.8, 81], ['necro', 0.4, 81], ['frostmage', 0.6, 81], ['skeleton', 1.5, 81], ['bat', 1, 81], ['sapper', 0.8, 81], ['archer', 1, 81], ['ram', 0.4, 81], ['shaman', 0.5, 81], ['scaler', 1.4, 81], ['thief', 0.45, 81]],
  },
];

/** Boss for waves that end in 0. */
const BOSSES: Record<number, EnemyType> = {
  10: 'chieftain', 20: 'warlord', 30: 'trollking', 40: 'mammoth', 50: 'lich',
  60: 'wraithqueen', 70: 'jarl', 80: 'witch', 90: 'dragon', 100: 'dreadking',
};
/** Champion (mini-boss) for waves that end in 5. */
const CHAMPIONS: Record<number, EnemyType[]> = {
  15: ['chieftain', 'chieftain'], 25: ['berserker'], 35: ['ram', 'shaman'], 45: ['golem'], 55: ['necro', 'golem'],
  65: ['giant'], 75: ['frostmage', 'giant'], 85: ['knight', 'knight'], 95: ['knight', 'drake', 'giant'],
};

export const isBossWave = (w: number): boolean => w % 5 === 0 && w >= 10;
export const bossName = (w: number): string => {
  if (w % 10 === 0) return CFG.enemies[bossOf(w)].name;
  return 'Champions';
};
function bossOf(w: number): EnemyType {
  if (BOSSES[w]) return BOSSES[w];
  // Endless: cycle through the bosses.
  const list = Object.values(BOSSES);
  return list[(Math.floor(w / 10) - 1) % list.length];
}

// ───────────────────────────── Wave modifiers ─────────────────────────────

export interface ModDef {
  name: string;
  icon: string;
  desc: string;
  hp?: number;
  coins?: number;
  count?: number;
  speed?: number;
  armor?: number;
  elite?: number;
  wide?: boolean;
  siege?: boolean;
  from: number;
}

export const MODS: Record<string, ModDef> = {
  bloodmoon: { name: 'Blood Moon', icon: '🌕', desc: 'Enemies +30% HP, coins +60%', hp: 1.3, coins: 1.6, from: 6 },
  swarm: { name: 'Swarm', icon: '🐜', desc: '+60% enemies, each one weaker', count: 1.6, hp: 0.62, from: 6 },
  swift: { name: 'Forced March', icon: '💨', desc: 'Enemies move 30% faster', speed: 1.3, from: 8 },
  golden: { name: 'Golden Horde', icon: '💰', desc: 'Double coins from kills', coins: 2, from: 6 },
  wide: { name: 'Wide Front', icon: '🌫️', desc: 'They attack along the whole wall', wide: true, from: 7 },
  siege: { name: 'Siege Train', icon: '🪓', desc: 'Extra rams and sappers', siege: true, from: 24 },
  iron: { name: 'Iron Horde', icon: '⛓️', desc: 'Every enemy wears armor', armor: 4, hp: 1.1, from: 30 },
  elite: { name: "Champions' Muster", icon: '⭐', desc: 'Many more elite enemies', elite: 3, from: 30 },
};

export function rollMod(w: number): string {
  if (w < 6 || w % 10 === 0 || Math.random() > 0.38) return '';
  const ok = Object.entries(MODS).filter(([, m]) => w >= m.from);
  return ok[Math.floor(Math.random() * ok.length)]?.[0] ?? '';
}

// ───────────────────────────── Elites ─────────────────────────────

export interface AffixDef {
  name: string;
  color: number;
}
export const AFFIXES: Record<string, AffixDef> = {
  armored: { name: 'Armored', color: 0xc0c8d0 },
  swift: { name: 'Swift', color: 0x5fe0ff },
  regen: { name: 'Regenerating', color: 0x6fe36f },
  shielded: { name: 'Shielded', color: 0x7f9bff },
  vampiric: { name: 'Vampiric', color: 0xff4060 },
  explosive: { name: 'Explosive', color: 0xff9a2a },
  warded: { name: 'Warded', color: 0xb98aff },
};
/** Affixes that need a later wave before they can roll. */
export const AFFIX_FROM: Record<string, number> = { warded: 45 };

// ───────────────────────────── Enemy camps ─────────────────────────────

export type CampKind = 'drums' | 'workshop' | 'warren' | 'totem';
export interface CampDef {
  name: string;
  icon: string;
  /** What it does while it stands (HUD). */
  desc: string;
  from: number;
}
/** War camps pitched on the far field from Act II. Only the hero and his soldiers can tear them down. */
export const CAMPS: Record<CampKind, CampDef> = {
  drums: { name: 'War Drums', icon: '🥁', desc: 'enemies faster and stronger', from: 21 },
  workshop: { name: 'Siege Workshop', icon: '🪓', desc: 'builds battering rams', from: 24 },
  warren: { name: 'Goblin Warren', icon: '💰', desc: 'sends thieves for your coins', from: 30 },
  totem: { name: 'Shaman Totem', icon: '🗿', desc: 'enemies regenerate', from: 35 },
};
export const CAMP = {
  /** × hpScale(wave). */
  hp: 420,
  r: 2.0,
  /** Seconds to raise a new camp (no effect until it's up). */
  build: 6,
  /** Guards per camp by act (I–V). */
  guards: [0, 3, 4, 5, 6],
  /** Coins for razing one, × the wave clear bonus. */
  coins: 0.5,
  drums: { speed: 1.25, dmg: 1.2 },
  totem: { regen: 0.015 },
  /** Rams (later trebuchets) per wave, and seconds between them. */
  workshop: { n: 3, every: 20 },
  warren: { n: 3, every: 18 },
};
/** New camps pitched at the start of wave `w`, and how many may stand at once. */
export function campPlan(w: number): { add: number; cap: number } {
  if (w < 21 || w % 10 === 0) return { add: 0, cap: 0 };
  if (w <= 40) return { add: w % 2 ? 1 : 0, cap: 2 };
  if (w <= 60) return { add: 1, cap: 3 };
  return { add: w % 3 === 0 ? 2 : 1, cap: 4 };
}

export const eliteChance = (w: number): number => (w < 25 ? 0 : Math.min(0.3, 0.04 + (w - 25) * 0.0035));

// ───────────────────────────── Progression ─────────────────────────────

export const xpForLevel = (lv: number): number => Math.round(12 * Math.pow(lv, 1.6) + 8);
export const xpScale = (w: number): number => 1 + 0.03 * (w - 1);

export interface PerkDef {
  name: string;
  icon: string;
  desc: string;
  max: number;
  /** Hero level needed before it can be offered. */
  min?: number;
}

export const PERKS: Record<string, PerkDef> = {
  blade: { name: 'Sharpened Blade', icon: '🗡️', desc: '+12% hero damage', max: 10 },
  vitality: { name: 'Vitality', icon: '❤️', desc: '+15% hero max HP', max: 10 },
  fleet: { name: 'Fleet Foot', icon: '👟', desc: '+6% move speed', max: 5 },
  pockets: { name: 'Deep Pockets', icon: '🎒', desc: '+3 backpack space', max: 5 },
  nimble: { name: 'Nimble Hands', icon: '🪓', desc: '+10% gathering speed', max: 5 },
  bounty: { name: 'Bountiful', icon: '🍀', desc: '15% chance to gather double', max: 4 },
  haggler: { name: 'Haggler', icon: '⚖️', desc: '+5% sell value', max: 5 },
  magnet: { name: 'Magnetism', icon: '🧲', desc: '+40% coin pickup range', max: 3 },
  crit: { name: 'Critical Strike', icon: '💥', desc: '+6% chance to hit for double', max: 5 },
  leech: { name: 'Lifesteal', icon: '🩸', desc: 'Heal 4% of hero damage dealt', max: 5 },
  cleave: { name: 'Wide Swings', icon: '🌀', desc: '+15% cleave damage and reach', max: 4 },
  bulwark: { name: 'Bulwark', icon: '🧱', desc: 'Walls and towers +8% HP', max: 5 },
  eagle: { name: 'Eagle Eye', icon: '🦅', desc: 'Towers +5% damage', max: 5 },
  drillmaster: { name: 'Drillmaster', icon: '🎖️', desc: 'Soldiers +10% damage and HP', max: 5 },
  quick: { name: 'Quick Draw', icon: '⚡', desc: 'Hero attacks 8% faster', max: 5 },
  wind: { name: 'Second Wind', icon: '🌬️', desc: 'Faster health regeneration', max: 3 },
  tax: { name: 'Tax Collector', icon: '🪙', desc: '+10% wave bonus, +1 coin per kill', max: 5 },
  focus: { name: 'Battle Focus', icon: '🧘', desc: 'Abilities recharge 10% faster', max: 3, min: 3 },
  foreman: { name: 'Foreman', icon: '📯', desc: 'Workers move 10% faster', max: 5 },
  thorns: { name: 'Spiked Mail', icon: '🌵', desc: 'Reflect 20% of melee damage', max: 3 },
};

export const RELICS: Record<string, PerkDef> = {
  crown: { name: "Chieftain's Crown", icon: '👑', desc: '+25% coins from every kill', max: 1 },
  banner: { name: "Warlord's Banner", icon: '🚩', desc: 'Soldiers and rangers +35% damage and HP', max: 1 },
  heart: { name: 'Troll Heart', icon: '💚', desc: 'Triple hero regeneration, +20% max HP', max: 1 },
  tusk: { name: 'Mammoth Tusk', icon: '🦣', desc: 'Walls +30% HP', max: 1 },
  phylactery: { name: 'Lich Phylactery', icon: '🔮', desc: 'Mage, fire, frost and holy towers +25% damage', max: 1 },
  veil: { name: 'Wraith Veil', icon: '👻', desc: 'Hero dodges 20% of attacks', max: 1 },
  frostcrown: { name: 'Frost Crown', icon: '❄️', desc: 'All enemies move 10% slower', max: 1 },
  shard: { name: 'Star Shard', icon: '☄️', desc: 'Meteor recharges 40% faster and hits 50% harder', max: 1 },
  quiver: { name: 'Endless Quiver', icon: '🏹', desc: 'Archer towers fire one more arrow', max: 1 },
  anvil: { name: 'Dwarven Anvil', icon: '⚒️', desc: 'Hero damage +30%', max: 1 },
  hourglass: { name: 'Hourglass', icon: '⏳', desc: '+15 s to prepare before each wave', max: 1 },
  coffer: { name: 'Royal Coffer', icon: '💰', desc: 'Wave clear bonus doubled', max: 1 },
  lantern: { name: 'Lantern of Dawn', icon: '🏮', desc: 'Keep arrows +50%, holy and fire damage +40%', max: 1 },
  league: { name: 'Seven-League Boots', icon: '🥾', desc: 'Hero +20% speed, workers +25% speed', max: 1 },
};

// ───────────────────────────── Wave formulas ─────────────────────────────

/** Seconds of build time before `nextWave` starts. */
export function buildTime(nextWave: number, hourglass: boolean): number {
  const extra = hourglass ? 15 : 0;
  if (nextWave === 1) return 90;
  // Late game: everything worth building is bought fast, so keep the rhythm brisk.
  if (nextWave % 5 === 0) return (nextWave >= 70 ? 52 : nextWave >= 40 ? 58 : 60) + extra;
  return (nextWave >= 70 ? 40 : nextWave >= 40 ? 45 : 45) + extra;
}

export const callEarlyBonus = (remaining: number, nextWave: number): number =>
  Math.max(1, Math.round(remaining * (0.6 + nextWave * 0.12)));
export const waveClearBonus = (w: number): number => Math.round(15 + w * 8 + (w > 20 ? 0.12 * (w - 20) ** 2 : 0));
export const spawnSpread = (w: number): number => Math.min(26, 4 + w * 3);
export const spawnInterval = (w: number): number => Math.max(w > 40 ? 0.16 : 0.22, 1.15 - w * 0.04);
/** Later acts march faster, so less of each wave is spent watching them walk. */
export const marchScale = (w: number): number => 1 + Math.min(0.2, Math.max(0, w - 40) * 0.004);
export const hpScale = (w: number): number => 1 + 0.12 * (w - 1) + (w > 20 ? 0.0045 * (w - 20) ** 2 : 0);
export const bossScale = (w: number): number => 1 + 0.05 * (w - 1) + (w > 20 ? 0.0018 * (w - 20) ** 2 : 0);
export const dmgScale = (w: number): number => 1 + 0.06 * (w - 1) + (w > 20 ? 0.015 * (w - 20) : 0);
export const coinScale = (w: number): number => 1 + 0.04 * (w - 1);

export interface SpawnSpec {
  type: EnemyType;
  champion?: boolean;
}

function shuffle<T>(list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

/** Enemy list for a wave, in spawn order. */
export function composition(w: number, mod = ''): SpawnSpec[] {
  const types: EnemyType[] = [];
  const add = (t: EnemyType, n: number) => {
    for (let i = 0; i < n; i++) types.push(t);
  };
  const m = MODS[mod];
  const countMul = m?.count ?? 1;
  if (w <= 20) {
    add('raider', Math.round((3 + w * 1.5) * countMul));
    if (w >= 4) add('runner', Math.round((w - 3) * 0.9 * countMul));
    if (w >= 6) add('brute', Math.floor(((w - 4) / 2) * countMul));
    if (w >= 9) add('archer', Math.round((w - 7) * 0.7 * countMul));
    if (w >= 12) add('shield', Math.round((w - 10) * 0.8 * countMul));
  } else {
    const roster = ACTS[actOf(w) - 1].roster.filter(([, , first]) => w >= first);
    const total = roster.reduce((s, [, wt]) => s + wt, 0);
    let budget = (130 + 4.5 * (w - 20)) * countMul;
    const cap = Math.round(95 * Math.min(1.4, countMul));
    while (budget > 0 && types.length < cap) {
      let r = Math.random() * total;
      let pick = roster[0][0];
      for (const [t, wt] of roster) {
        r -= wt;
        if (r <= 0) {
          pick = t;
          break;
        }
      }
      types.push(pick);
      budget -= CFG.enemies[pick].cost;
    }
  }
  if (m?.siege) {
    add('sapper', 3 + Math.floor(w / 15));
    add('ram', 1 + Math.floor(w / 30));
    if (w >= 84) add('trebuchet', 1);
  }
  shuffle(types);
  const list: SpawnSpec[] = types.map((type) => ({ type }));
  const bosses: SpawnSpec[] = [];
  if (w % 10 === 0 && w >= 10) {
    bosses.push({ type: bossOf(w) });
    if (w > 100) bosses.push({ type: bossOf(w - 10) });
  } else if (w % 5 === 0 && w >= 15) {
    const champs = CHAMPIONS[w] ?? CHAMPIONS[95];
    for (const t of champs) bosses.push({ type: t, champion: t !== 'chieftain' });
  }
  bosses.forEach((b, i) => list.splice(Math.floor(list.length * (0.35 + i * 0.15)), 0, b));
  return list;
}

export const RES_ORDER: ResType[] = ['wood', 'stone', 'gold', 'crystal'];
