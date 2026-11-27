import { CFG, buildTime, callEarlyBonus, composition, spawnInterval, spawnSpread, waveClearBonus } from './config';
import { G, addCoins, type EnemyType } from './state';
import { enemies, Units } from './units';
import { repairAll } from './structures';
import { collectAllDrops } from './fx';
import { Sfx } from './audio';
import { emit } from './events';
import { Save } from './save';

let queue: EnemyType[] = [];
let spawnT = 0;

export interface WaveClearInfo {
  wave: number;
  bonus: number;
}

function clearWave(): void {
  const w = G.wave;
  G.wavesCleared = w;
  const bonus = waveClearBonus(w);
  addCoins(bonus);
  repairAll();
  collectAllDrops();
  emit('waveClear', { wave: w, bonus } satisfies WaveClearInfo);
  if (w >= CFG.totalWaves && !G.endless) {
    G.endless = true;
    G.phase = 'victory';
    Save.write();
    emit('victory');
  } else {
    Waves.startBuild();
  }
}

export const Waves = {
  /** Countdown to the next wave. Writes the checkpoint. */
  startBuild(save = true): void {
    G.phase = 'build';
    G.buildTimer = G.buildTotal = buildTime(G.wavesCleared + 1);
    if (save) Save.write();
  },

  startWave(): void {
    const w = G.wavesCleared + 1;
    G.wave = w;
    G.phase = 'wave';
    queue = composition(w);
    G.waveTotal = queue.length;
    spawnT = 0.3;
    Sfx.play('horn');
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

  update(dt: number): void {
    if (G.phase === 'build') {
      if (Waves.timerRunning()) G.buildTimer -= dt;
      if (G.buildTimer <= 0) Waves.startWave();
    } else if (G.phase === 'wave') {
      if (queue.length) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = spawnInterval(G.wave);
          const t = queue.shift()!;
          const spread = CFG.enemies[t].boss ? 4 : spawnSpread(G.wave);
          Units.spawnEnemy(t, (Math.random() * 2 - 1) * spread, CFG.map.spawnZ + Math.random() * 1.5, G.wave);
        }
      } else if (!enemies.some((e) => e.alive)) {
        clearWave();
      }
    }
  },
};
