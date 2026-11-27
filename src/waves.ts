import {
  CFG, ACTS, MODS, buildTime, callEarlyBonus, composition, eliteChance, rollMod, spawnInterval, spawnSpread, waveClearBonus,
  AFFIXES, AFFIX_FROM, isBossWave, bossName, type SpawnSpec,
} from './config';
import { G, actOf, addCoins } from './state';
import { enemies, Units } from './units';
import { repairAll } from './structures';
import { collectAllDrops } from './fx';
import { Proj } from './projectiles';
import { Sfx } from './audio';
import { emit } from './events';
import { Save } from './save';
import { Stat, hasRelic, gainXp } from './progress';

let queue: SpawnSpec[] = [];
let spawnT = 0;

export interface WaveClearInfo {
  wave: number;
  bonus: number;
}

const AFFIX_IDS = Object.keys(AFFIXES);

function clearWave(): void {
  const w = G.wave;
  G.wavesCleared = w;
  const bonus = Math.round(waveClearBonus(w) * Stat.waveBonusMul());
  addCoins(bonus);
  gainXp(Math.round(10 + w * 4));
  repairAll();
  collectAllDrops();
  Proj.clear();
  G.buffs.fury = 0;
  G.mod = '';
  // Bosses every 10 waves leave a relic behind.
  if (w % 10 === 0) G.pendingRelics++;
  emit('waveClear', { wave: w, bonus } satisfies WaveClearInfo);
  if (w >= CFG.totalWaves && !G.endless) {
    G.endless = true;
    G.phase = 'victory';
    Save.write();
    emit('victory');
  } else {
    Waves.startBuild();
    if (actOf(w + 1) !== actOf(w) && w < CFG.totalWaves) emit('actStart', actOf(w + 1));
  }
}

export const Waves = {
  /** Countdown to the next wave. Writes the checkpoint. */
  startBuild(save = true): void {
    G.phase = 'build';
    const next = G.wavesCleared + 1;
    G.buildTimer = G.buildTotal = buildTime(next, hasRelic('hourglass'));
    G.nextMod = rollMod(next);
    emit('happening', 'build');
    if (save) Save.write();
  },

  startWave(): void {
    const w = G.wavesCleared + 1;
    G.wave = w;
    G.phase = 'wave';
    G.mod = G.nextMod;
    G.nextMod = '';
    queue = composition(w, G.mod);
    G.waveTotal = queue.length;
    spawnT = 0.3;
    Sfx.play('horn');
    emit('happening', 'wave');
    emit('waveStart', w);
  },

  /** Bonus for starting the wave before the countdown ends. */
  earlyBonus(): number {
    return callEarlyBonus(G.buildTimer, G.wavesCleared + 1);
  },

  callEarly(): void {
    if (G.phase !== 'build' || !Waves.timerRunning()) return;
    addCoins(Waves.earlyBonus());
    Waves.startWave();
  },

  /** The first countdown waits until the tutorial reaches the build step. */
  timerRunning(): boolean {
    return G.wavesCleared > 0 || G.tut >= 3;
  },

  remaining(): number {
    return queue.length + Units.aliveCount();
  },

  actName(w: number): string {
    return ACTS[actOf(w) - 1].name;
  },

  /** Short description of what the next wave brings. */
  preview(next: number): string {
    const parts: string[] = [];
    if (isBossWave(next)) parts.push(next % 10 === 0 ? `👑 ${bossName(next)}` : '⭐ Champions');
    const m = MODS[G.nextMod];
    if (m) parts.push(`${m.icon} ${m.name}`);
    return parts.join(' · ');
  },

  update(dt: number): void {
    if (G.phase === 'build') {
      if (Waves.timerRunning()) G.buildTimer -= dt;
      if (G.buildTimer <= 0) Waves.startWave();
    } else if (G.phase === 'wave') {
      if (queue.length) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = spawnInterval(G.wave) / (MODS[G.mod]?.count ?? 1);
          const spec = queue.shift()!;
          const def = CFG.enemies[spec.type];
          const big = def.boss || spec.champion;
          const spread = big ? 4 : MODS[G.mod]?.wide ? 26 : spawnSpread(G.wave);
          const ec = eliteChance(G.wave) * (MODS[G.mod]?.elite ?? 1);
          const ids = AFFIX_IDS.filter((a) => G.wave >= (AFFIX_FROM[a] ?? 0));
          const affix = !big && Math.random() < ec ? ids[Math.floor(Math.random() * ids.length)] : null;
          Units.spawnEnemy(spec.type, (Math.random() * 2 - 1) * spread, CFG.map.spawnZ + Math.random() * 1.5, G.wave, { champion: spec.champion, affix });
        }
      } else if (!enemies.some((e) => e.hostile)) {
        clearWave();
      }
    }
  },
};
