import { CFG } from './config';
import { G, actOf, type Phase } from './state';
import { enemies, soldiers, rangers, workers, Units } from './units';
import * as St from './structures';
import { Waves } from './waves';
import { slots, costOf, refreshPads, type Slot } from './pads';
import { hero, capacity, maxHp } from './hero';
import { nodes, type ResNode } from './world';
import { Save } from './save';
import { Input } from './input';
import { currentOffer, takeChoice, pendingChoices, Stat, gainXp } from './progress';
import { ABILITIES, blocked, cast } from './abilities';
import { chestList } from './happenings';
import { on, emit } from './events';
import { UI } from './ui';
import { tunnels } from './threats';
import type { Enemy } from './units';

/**
 * Developer tools.
 *  ?debug              keyboard cheats (C coins, N next wave, K kill all, H heal keep, G god mode, U +1 wave cleared,
 *                      X +XP, J skip 10 waves) and the "skip ahead" panel on the main menu
 *  ?wave=N             (dev server or ?debug) start at wave N with a base built from a typical run's income;
 *                      &base=strong doubles that income, &base=coins builds nothing, &god starts in god mode
 *  ?debug&preset=N     fast-forward N waves with free coins, then play normally
 *  ?autotest           headless bot run; writes a JSON report into the page
 *  ?autotest&honest    the bot only spends coins it earns by gathering, selling and fighting
 *  &waves=N            stop the bot after N waves; &from=N skips ahead with a generous preset first
 */

type StepFn = (dt: number) => void;
const DT = 1 / 30;

let keysOn = false;

export function initDebugKeys(): void {
  if (keysOn) return;
  keysOn = true;
  Input.onKey((e) => {
    if (!G.debug || G.paused || (G.phase !== 'build' && G.phase !== 'wave')) return;
    switch (e.code) {
      case 'KeyC':
        G.coins += 500 + G.wavesCleared * 300;
        break;
      case 'KeyN':
        if (G.phase === 'build') Waves.startWave();
        break;
      case 'KeyK':
        for (const en of enemies) if (en.alive) en.damage(1e9, 'magic');
        break;
      case 'KeyH':
        St.S.keep.hp = St.S.keep.maxHp;
        break;
      case 'KeyG':
        G.god = !G.god;
        UI.toast(G.god ? 'God mode on: the keep and hero cannot die' : 'God mode off');
        break;
      case 'KeyU':
        G.wavesCleared++;
        break;
      case 'KeyX':
        gainXp(500);
        break;
      case 'KeyJ':
        if (G.phase === 'build') skipAhead(10);
        else UI.toast('Skip ahead works between waves (press K to end this one)');
        break;
    }
    refreshDevBar();
  });
  refreshDevBar();
}

/** The small key reminder shown in the corner while cheats are on. */
export function refreshDevBar(): void {
  const el = document.getElementById('devbar');
  if (!el) return;
  el.hidden = !G.debug;
  el.textContent = `TEST · J +10 waves · N start wave · K kill all · C coins · H heal keep · X +XP · G god ${G.god ? 'ON' : 'off'}`;
  el.classList.toggle('god', G.god);
}

// ───────────────────────────── Skip ahead ─────────────────────────────

export type JumpBase = 'fair' | 'strong' | 'coins';
export const JUMP_BASES: JumpBase[] = ['fair', 'strong', 'coins'];
let jumpBase: JumpBase = 'fair';

/** Total coins the honest autotest bot had earned by the end of each wave (average of two winning runs). */
const EARNED: [number, number][] = [
  [0, 0], [1, 300], [5, 1700], [10, 6800], [20, 43000], [30, 117000], [40, 240000], [50, 400000],
  [60, 615000], [70, 865000], [80, 1140000], [90, 1530000], [100, 1960000],
];

function earnedBy(w: number): number {
  if (w <= 0) return 0;
  for (let i = 1; i < EARNED.length; i++) {
    const [w1, e1] = EARNED[i];
    if (w > w1) continue;
    const [w0, e0] = EARNED[i - 1];
    return e0 + ((e1 - e0) * (w - w0)) / (w1 - w0);
  }
  // Endless: keep the last decade's pace.
  const [wl, el] = EARNED[EARNED.length - 1];
  const [wp, ep] = EARNED[EARNED.length - 2];
  return el + ((el - ep) / (wl - wp)) * (w - wl);
}

/** Hero level the honest bot reached by the start of wave w. */
const levelAt = (w: number): number => Math.max(1, Math.round(1 + 0.64 * (w - 1)));

/** Complete a pad purchase immediately, the same way loading a save does. */
function buyNow(s: Slot): void {
  G.coins -= costOf(s) - s.paid;
  if (s.destroyed) {
    s.destroyed = false;
    s.rebuild?.(s);
  } else {
    const st = s.stages[s.stage];
    s.stage++;
    st.buy(s);
  }
  s.paid = 0;
  s.acc = 0;
  G.stats.built++;
}

/** Buy everything affordable in the bot's priority order, without walking to the pads. */
function spendNow(): void {
  for (let guard = 0; guard < 400; guard++) {
    refreshPads(true);
    let best: Slot | null = null;
    let bestScore = Infinity;
    for (const s of slots) {
      if (!s.visible || s.temp) continue;
      const rem = costOf(s) - s.paid;
      if (rem > G.coins) continue;
      const score = rem * weight(s);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) break;
    buyNow(best);
  }
}

/**
 * Fast-forward the village to the build phase before wave `target`: grant the income, hero levels, perks and relics
 * a typical run would have by then and spend the coins wave by wave. Nothing is fought, so nothing is damaged.
 */
export function jumpTo(target: number, base: JumpBase = jumpBase): void {
  jumpBase = base;
  const from = G.wavesCleared;
  const to = Math.max(from, Math.floor(target) - 1);
  const mul = base === 'strong' ? 2 : 1;

  // Progression first, so structures get the right HP multipliers.
  const lv = levelAt(to + 1);
  if (lv > G.level) {
    G.pendingPerks += lv - G.level;
    G.level = lv;
    G.xp = 0;
  }
  G.pendingRelics += Math.floor(to / 10) - Math.floor(from / 10);
  pickAll();

  G.tut = Math.max(G.tut, 6);
  G.flags.firstSale = G.flags.firstCollect = true;
  for (let w = from + 1; w <= to; w++) {
    G.wavesCleared = w;
    const income = Math.round((earnedBy(w) - earnedBy(w - 1)) * mul);
    G.coins += income;
    G.stats.earned += income;
    if (base !== 'coins') spendNow();
  }
  if (to >= CFG.totalWaves) G.endless = true;

  emit('statsChanged');
  St.repairAll();
  Units.fillSoldiers();
  refreshPads(true);
  hero.hp = maxHp();
}

/** In-game skip: jump `n` waves ahead from the current build phase. */
function skipAhead(n: number): void {
  const fromAct = actOf(G.wavesCleared + 1);
  jumpTo(G.wavesCleared + 1 + n);
  Waves.startBuild();
  const next = G.wavesCleared + 1;
  if (actOf(next) !== fromAct) emit('actStart', actOf(next));
  UI.toast(`Skipped to wave ${next}`);
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
  if (s.temp) return 3;
  if (s.id === 'keep') return 0.3;
  if (s.id.startsWith('wall')) return 0.5;
  if (s.id.startsWith('tower') || s.id === 'barracks' || s.id === 'catapult' || s.id === 'range') return 0.6;
  if (['ballista', 'frost', 'mage', 'fire', 'spire', 'cannon1', 'cannon2', 'aerie', 'roost'].includes(s.id)) return 0.55;
  if (s.id.startsWith('spikes') || s.id.startsWith('tar')) return 0.75;
  if (['lumber', 'miners', 'quarry', 'goldmine', 'crystal', 'marketup'].includes(s.id)) return 0.7;
  if (s.id.startsWith('r_') || s.id === 'academy') return 0.8;
  return 1;
}

/** Stand on every affordable pad, most useful first. */
function shop(step: StepFn): string[] {
  const bought: string[] = [];
  for (let guard = 0; guard < 120; guard++) {
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

function pickAll(): void {
  for (let i = 0; i < 300 && pendingChoices() > 0; i++) {
    const o = currentOffer();
    if (!o?.length) break;
    takeChoice(o[Math.floor(Math.random() * o.length)]);
  }
}

function travel(step: StepFn, x: number, z: number): void {
  const d = Math.hypot(x - hero.x, z - hero.z);
  stepFor(step, d / Stat.heroSpeed());
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
  const timeLeft = () => !Waves.timerRunning() || G.buildTimer > 14;
  while (hero.stack.length < capacity() && guard++ < 12 && G.phase === 'build' && timeLeft()) {
    const n = bestNode();
    if (!n) break;
    travel(step, n.x + n.r + hero.r + 0.2, n.z);
    for (let k = 0; k < 30 * 15 && n.state === 'grown' && hero.stack.length < capacity() && G.phase === 'build' && timeLeft(); k++) step(DT);
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

function grabChests(step: StepFn): void {
  for (const c of [...chestList()]) {
    if (G.phase !== 'build') return;
    travel(step, c.x, c.z);
    step(DT);
  }
}

function snapshotRow(w: number, waveSecs: number, bought: string[]): Record<string, unknown> {
  return {
    wave: w,
    phase: G.phase,
    mod: G.mod || undefined,
    waveSecs: Math.round(waveSecs),
    minKeep: Math.round(fightStats.minKeep * 100),
    lost: fightStats.lost,
    tunnels: fightStats.tunnels || undefined,
    stolen: fightStats.stolen || undefined,
    escaped: fightStats.escaped || undefined,
    wards: fightStats.wards || undefined,
    deaths: fightStats.heroDeaths || undefined,
    keep: `${Math.round(St.S.keep.hp)}/${St.S.keep.maxHp}`,
    keepLv: G.keepLevel,
    lvl: G.level,
    walls: St.S.walls.map((x) => (x ? (x.alive ? x.level : 'x') : '-')).join(''),
    towers: St.S.towers.map((t) => (t.alive ? t.level : 'x')).join(''),
    special: St.S.special.map((t) => `${t.kind[0]}${t.alive ? t.level : 'x'}`).join(''),
    army: `${soldiers.filter((s) => s.alive).length}+${rangers.filter((s) => s.alive).length}`,
    workers: workers.length,
    coins: Math.round(G.coins),
    earned: G.stats.earned,
    up: Object.values(G.up).join(''),
    res: Object.values(G.research).join(''),
    relics: G.relics.length,
    bought: bought.length,
    vis: slots.filter((s) => s.visible).map((s) => `${s.id}:${costOf(s) - s.paid}`).join(' '),
  };
}

const stuck: Record<string, unknown>[] = [];
const passive = new URLSearchParams(location.search).has('passive');
const fightStats = { minKeep: 1, lost: 0, stolen: 0, escaped: 0, wards: 0, heroDeaths: 0, tunnels: 0 };
on('structureLost', () => fightStats.lost++);
on('threat', (a) => {
  const t = a as { kind: string; amount?: number };
  if (t.kind === 'stolen') fightStats.stolen += t.amount ?? 0;
  if (t.kind === 'escaped') fightStats.escaped += t.amount ?? 0;
  if (t.kind === 'ward') fightStats.wards++;
});

/** What needs the hero most: wards only it can break, thieves, enemies inside the walls, a tunnel about to open. */
function botGoal(t: number): { x: number; z: number } | null {
  const W = CFG.map.wallZ;
  let best: Enemy | null = null;
  let bs = -Infinity;
  for (const e of enemies) {
    if (!e.alive || e.flyH > 4 || e.emergeT > 0) continue;
    let s: number;
    if (e.wardHits > 0) s = 100 + (e.isBoss ? 50 : 0);
    else if (e.d.thief) s = 80 + (e.loot > 0 ? 20 : 0);
    else if (e.z > W + 0.8) s = 60 + (e.d.bomb ? 15 : 0);
    else if (e.vulnT > 0) s = 55;
    else continue;
    s -= Math.hypot(e.x - hero.x, e.z - hero.z) * 0.5;
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  if (best) return { x: best.x, z: best.z };
  const tn = tunnels.find((x) => x.state === 'warn');
  if (tn) return { x: tn.x, z: tn.z + 2 };
  // Like a player, go out after stragglers once the main push is over.
  const left = enemies.filter((e) => e.alive);
  const far = t > 45 && left.length <= 4 && left.length > 0 ? left.find((e) => e.z < W - 3 && e.flyH < 4) : undefined;
  if (far) return { x: far.x, z: far.z };
  return null;
}

/** Walk the hero toward a point at its real speed (no teleporting). */
function botWalk(x: number, z: number, near: number): void {
  if (!hero.alive || hero.stunT > 0) return;
  const dx = x - hero.x;
  const dz = z - hero.z;
  const L = Math.hypot(dx, dz);
  if (L <= near) return;
  let nx = dx / L;
  let nz = dz / L;
  [nx, nz] = St.steer(hero.x, hero.z, nx, nz, hero.r);
  const step = Math.min(L - near, Stat.heroSpeed() * (hero.slowT > 0 ? 1 - hero.slowAmt : 1) * DT);
  hero.x += nx * step;
  hero.z += nz * step;
  St.pushOut(hero, hero.r);
}

/** Fight a wave: hold the centre of the wall, run to whatever needs the hero, use abilities. */
function fight(step: StepFn): number {
  let t = 0;
  fightStats.minKeep = 1;
  fightStats.lost = fightStats.stolen = fightStats.escaped = fightStats.wards = fightStats.heroDeaths = 0;
  fightStats.tunnels = tunnels.length;
  let wasAlive = hero.alive;
  while (G.phase === 'wave' && t < 600) {
    fightStats.minKeep = Math.min(fightStats.minKeep, St.S.keep.hp / St.S.keep.maxHp);
    if (wasAlive && !hero.alive) fightStats.heroDeaths++;
    wasAlive = hero.alive;
    if (hero.alive) {
      // ?passive: the old habit of parking behind the wall and letting the defenses work.
      const goal = passive ? null : botGoal(t);
      if (goal) botWalk(goal.x, goal.z, 1.4);
      else botWalk(0, CFG.map.wallZ + 1.4, 0.3);
      for (const a of ABILITIES) if (!blocked(a)) cast(a);
    }
    step(DT);
    t += DT;
  }
  if (G.phase === 'wave') {
    for (const e of enemies) {
      if (!e.alive) continue;
      stuck.push({ wave: G.wave, type: e.type, x: +e.x.toFixed(1), z: +e.z.toFixed(1), hp: Math.round(e.hp), max: e.maxHp, tgt: e.target ? (e.target.isStruct ? (e.target as St.Structure).id : 'unit') : null });
    }
    // Clear the wave so the run can continue.
    for (const e of enemies) if (e.alive) e.damage(1e12, 'magic');
    for (let i = 0; i < 60 && G.phase === 'wave'; i++) step(DT);
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
      pickAll();
      if (honest) {
        collect(step);
        bought = bought.concat(shop(step));
        grabChests(step);
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
        G.coins += 300 + w * 220 + w * w * 9;
        grabChests(step);
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
    mode: (honest ? 'honest' : 'generous') + (passive ? ' passive' : ''),
    result: G.phase,
    wavesCleared: G.wavesCleared,
    level: G.level,
    perks: G.perks,
    relics: G.relics,
    simMinutes: Math.round(G.time / 6) / 10,
    realMs: Math.round(performance.now() - t0),
    checks,
    errors,
    stuck: stuck.slice(0, 40),
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
    G.coins += 300 + w * 220 + w * w * 9;
    G.tut = Math.max(G.tut, 3);
    pickAll();
    shop(step);
    Waves.startWave();
    fight(step);
    if (G.phase !== 'build') return;
  }
  pickAll();
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
