import { CFG } from './config';
import { G, type Phase } from './state';
import { enemies, soldiers, workers } from './units';
import * as St from './structures';
import { Waves } from './waves';
import { slots, costOf, type Slot } from './pads';
import { hero, capacity } from './hero';
import { nodes, type ResNode } from './world';
import { Save } from './save';
import { Input } from './input';

/**
 * Developer tools.
 *  ?debug              keyboard cheats (C coins, N next wave, K kill all, H heal keep, G god mode, U +1 wave cleared)
 *  ?debug&preset=N     fast-forward N waves with free coins, then play normally
 *  ?autotest           headless bot run; writes a JSON report into the page
 *  ?autotest&honest    the bot only spends coins it earns by gathering, selling and fighting
 */

type StepFn = (dt: number) => void;
const DT = 1 / 30;

export function initDebugKeys(): void {
  Input.onKey((e) => {
    switch (e.code) {
      case 'KeyC':
        G.coins += 500;
        break;
      case 'KeyN':
        if (G.phase === 'build') Waves.startWave();
        break;
      case 'KeyK':
        for (const en of enemies) if (en.alive) en.damage(1e9, 'melee');
        break;
      case 'KeyH':
        St.S.keep.hp = St.S.keep.maxHp;
        break;
      case 'KeyG':
        G.god = !G.god;
        break;
      case 'KeyU':
        G.wavesCleared++;
        break;
    }
  });
}

function stepFor(step: StepFn, seconds: number, each?: () => void): void {
  const n = Math.ceil(seconds / DT);
  for (let i = 0; i < n && G.phase !== 'gameover'; i++) {
    each?.();
    step(DT);
  }
}

/** How eager the bot is to buy a slot (lower = sooner). */
function weight(s: Slot): number {
  if (s.destroyed) return 0.2;
  if (s.id === 'keep') return 0.35;
  if (s.id.startsWith('wall')) return 0.5;
  if (s.id.startsWith('tower') || s.id === 'barracks' || s.id === 'catapult') return 0.6;
  if (s.id === 'lumber' || s.id === 'miners' || s.id === 'quarry' || s.id === 'goldmine') return 0.7;
  return 1;
}

/** Stand on every affordable pad, most useful first. */
function shop(step: StepFn): string[] {
  const bought: string[] = [];
  for (let guard = 0; guard < 80; guard++) {
    if (G.phase !== 'build') break;
    const ok = slots
      .filter((s) => s.visible && s.cooldown <= 0 && costOf(s) - s.paid <= G.coins)
      .sort((a, b) => (costOf(a) - a.paid) * weight(a) - (costOf(b) - b.paid) * weight(b));
    const s: Slot | undefined = ok[0];
    if (!s) break;
    hero.x = s.pad.x;
    hero.z = s.pad.z;
    const before = s.stage + (s.destroyed ? 0.5 : 0);
    for (let k = 0; k < 200 && s.visible; k++) step(DT);
    if (s.stage + (s.destroyed ? 0.5 : 0) !== before) bought.push(s.id);
    hero.x = 0;
    hero.z = 3;
    stepFor(step, 1);
  }
  return bought;
}

function travel(step: StepFn, x: number, z: number): void {
  const d = Math.hypot(x - hero.x, z - hero.z);
  stepFor(step, d / CFG.hero.speed[G.up.boots]);
  hero.x = x;
  hero.z = z;
}

function bestNode(): ResNode | null {
  let best: ResNode | null = null;
  let bs = -Infinity;
  for (const n of nodes) {
    if (n.state !== 'grown') continue;
    const d = Math.hypot(n.x - St.market.drop.x, n.z - St.market.drop.z);
    const s = CFG.res[n.type].value / CFG.res[n.type].hard - d * 0.08;
    if (s > bs) {
      bs = s;
      best = n;
    }
  }
  return best;
}

/** One honest gathering trip: walk to a node, fill the backpack, sell, collect. */
function gatherTrip(step: StepFn): void {
  let guard = 0;
  while (hero.stack.length < capacity() && guard++ < 12 && G.phase === 'build') {
    const n = bestNode();
    if (!n) break;
    travel(step, n.x + n.r + hero.r + 0.2, n.z);
    for (let k = 0; k < 30 * 15 && n.state === 'grown' && hero.stack.length < capacity() && G.phase === 'build'; k++) step(DT);
  }
  if (G.phase !== 'build') return;
  travel(step, St.market.drop.x, St.market.drop.z);
  for (let k = 0; k < 30 * 6 && hero.stack.length; k++) step(DT);
  collect(step);
}

function collect(step: StepFn): void {
  hero.x = St.market.coin.x;
  hero.z = St.market.coin.z;
  for (let k = 0; k < 30 * 5 && St.market.pile > 0; k++) step(DT);
}

function snapshotRow(w: number, waveSecs: number, bought: string[]): Record<string, unknown> {
  return {
    wave: w,
    phase: G.phase,
    waveSecs: Math.round(waveSecs),
    keep: `${Math.round(St.S.keep.hp)}/${St.S.keep.maxHp}`,
    keepLv: G.keepLevel,
    walls: St.S.walls.map((x) => (x ? (x.alive ? x.level : 'x') : '-')).join(''),
    towers: St.S.towers.map((t) => (t.alive ? t.level : 'x')).join(''),
    soldiers: soldiers.filter((s) => s.alive).length,
    workers: workers.length,
    coins: Math.round(G.coins),
    earned: G.stats.earned,
    up: { ...G.up },
    bought: bought.length,
    vis: slots.filter((s) => s.visible).map((s) => `${s.id}:${costOf(s) - s.paid}`).join(' '),
  };
}

/** Fight a wave with the hero parked behind the centre of the wall. */
function fight(step: StepFn): number {
  let t = 0;
  while (G.phase === 'wave' && t < 600) {
    if (hero.alive) {
      hero.x = 0;
      hero.z = CFG.map.wallZ + 1.4;
    }
    step(DT);
    t += DT;
  }
  return t;
}

export function runAutotest(step: StepFn): void {
  const params = new URLSearchParams(location.search);
  const honest = params.has('honest');
  const maxWave = Number(params.get('waves') ?? CFG.totalWaves);
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const t0 = performance.now();
  const checks: Record<string, boolean> = {};
  try {
    G.phase = 'build';
    Waves.startBuild(false);

    // Tutorial path through real mechanics.
    gatherTrip(step);
    checks.sold = !!G.flags.firstSale;
    checks.collected = G.coins > 0;
    for (let i = 0; i < 10 && G.coins < 25; i++) gatherTrip(step);
    shop(step);
    checks.wallBuilt = !!G.flags.firstWall;

    for (let w = 1; w <= maxWave; w++) {
      let bought: string[] = [];
      if (honest) {
        let guard = 0;
        while (G.phase === 'build' && guard++ < 40) {
          if (G.buildTimer < 8 && Waves.timerRunning()) {
            collect(step);
            bought = bought.concat(shop(step));
            break;
          }
          gatherTrip(step);
          bought = bought.concat(shop(step));
        }
        if (G.phase === 'build') {
          hero.x = 0;
          hero.z = 3;
          stepFor(step, G.buildTimer + 0.5);
        }
      } else {
        G.coins += 300 + w * 220;
        bought = shop(step);
        Waves.callEarly();
        if (G.phase === 'build') Waves.startWave();
      }
      const secs = fight(step);
      rows.push(snapshotRow(w, secs, bought));
      const phase = G.phase as Phase;
      if (phase === 'gameover' || phase === 'victory') break;
    }
    const snap = Save.snapshot();
    checks.saveRoundTrip = JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap);
  } catch (e) {
    errors.push(e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  }
  const report = {
    mode: honest ? 'honest' : 'generous',
    result: G.phase,
    wavesCleared: G.wavesCleared,
    simMinutes: Math.round(G.time / 6) / 10,
    realMs: Math.round(performance.now() - t0),
    checks,
    errors,
    rows,
  };
  const pre = document.createElement('pre');
  pre.id = 'autotest-report';
  pre.textContent = JSON.stringify(report, null, 1);
  document.body.appendChild(pre);
  document.title = 'AUTOTEST DONE';
}

/** Fast-forward with free coins (for screenshots and testing late-game content). */
export function runPreset(step: StepFn, waves: number, fightSecs: number): void {
  for (let w = 1; w <= waves; w++) {
    G.coins += 300 + w * 220;
    G.tut = Math.max(G.tut, 3);
    shop(step);
    Waves.startWave();
    fight(step);
    if (G.phase !== 'build') return;
  }
  G.coins += 300;
  shop(step);
  hero.x = 0;
  hero.z = -9;
  if (fightSecs > 0) {
    Waves.startWave();
    stepFor(step, fightSecs, () => {
      hero.x = 0;
      hero.z = CFG.map.wallZ + 1.4;
    });
  }
}
