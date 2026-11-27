import * as THREE from 'three';
import { CFG } from './config';
import { G, actOf, type EnemyType } from './state';
import { enemies, Units, type Enemy } from './units';
import * as St from './structures';
import { hero } from './hero';
import { burst, ring, text, erupt, shakeAt, warnCircle, dust } from './fx';
import { Sfx } from './audio';
import { on } from './events';
import { camera, engine } from './engine';
import { UI } from './ui';
import { clamp } from './util';

/**
 * Late-game pressure that the walls can't handle on their own:
 *  - tunnel ambushes that burst up inside the walls (telegraphed first),
 *  - the danger level that drives the war drums and the red vignette,
 *  - alarms (breaches, enemies inside, thieves) and off-screen threat arrows.
 */

const MAP = CFG.map;
const W = MAP.wallZ;
/** Seconds of rumbling before a tunnel breaks open. */
export const TUNNEL_WARN = 3.4;

export interface Tunnel {
  x: number;
  z: number;
  /** Seconds into the wave when the rumbling starts. */
  at: number;
  t: number;
  state: 'wait' | 'warn' | 'done';
  types: EnemyType[];
  fxT: number;
  undead: boolean;
}

export const tunnels: Tunnel[] = [];
let waveT = 0;
let insideAlerted = false;
let breachT = 0;
let heartT = 0;

export const Danger = {
  /** 0 = calm, 1 = all-out (war drums, vignette). */
  level: 0,
  /** Enemies inside the walls right now. */
  inside: 0,
};

/** How many tunnel ambushes a wave gets. */
function tunnelCount(w: number): number {
  if (w < 25) return 0;
  if (w < 45) return Math.random() < 0.45 ? 1 : 0;
  if (w < 70) return 1 + (Math.random() < 0.35 ? 1 : 0);
  return 2 + (Math.random() < 0.25 ? 1 : 0);
}

/** Who comes up out of the tunnel, by act. */
export function tunnelParty(w: number): EnemyType[] {
  const act = actOf(w);
  const extra = Math.floor(Math.max(0, w - 25) / 20);
  const list: EnemyType[] = [];
  const add = (t: EnemyType, n: number) => {
    for (let i = 0; i < n; i++) list.push(t);
  };
  if (act <= 2) {
    add('wolf', 2 + extra);
    add('berserker', 1);
  } else if (act === 3) {
    add('skeleton', 3 + extra * 2);
    add('necro', 1);
  } else if (act === 4) {
    add('icewolf', 2 + extra);
    add('frostmage', 1);
  } else {
    add('berserker', 1);
    add('knight', 1);
    add('sapper', w >= 90 ? 2 : 1);
    add('scaler', 1 + Math.floor(extra / 2));
  }
  if (w >= 30) add('thief', w >= 70 ? 2 : 1);
  return list;
}

/** A spot inside the walls, clear of buildings, preferably a run away from the hero. */
function tunnelSpot(): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  let bs = -Infinity;
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * 2 - 1) * 23;
    const z = -13 + Math.random() * 21;
    let blocked = false;
    for (const c of St.colliders) {
      if (Math.abs(x - c.x) < c.hw + 1.8 && Math.abs(z - c.z) < c.hd + 1.8) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const dh = Math.hypot(x - hero.x, z - hero.z);
    let s = -Math.abs(dh - 14);
    for (const t of tunnels) if (t.state !== 'done' && Math.hypot(t.x - x, t.z - z) < 8) s -= 20;
    s += Math.random() * 3;
    if (s > bs) {
      bs = s;
      best = { x, z };
    }
  }
  return best;
}

function planTunnels(w: number): void {
  tunnels.length = 0;
  const n = tunnelCount(w);
  let at = 11 + Math.random() * 8;
  for (let i = 0; i < n; i++) {
    tunnels.push({ x: 0, z: 0, at, t: 0, state: 'wait', types: tunnelParty(w), fxT: 0, undead: actOf(w) === 3 });
    at += 15 + Math.random() * 9;
  }
}

function startWarning(t: Tunnel): void {
  const p = tunnelSpot();
  t.x = p.x;
  t.z = p.z;
  t.state = 'warn';
  t.t = 0;
  warnCircle(t.x, t.z, 2.4, TUNNEL_WARN, undefined, t.undead ? 0x7dff9a : 0xff8a2a);
  text(t.x, 2.2, t.z, t.undead ? 'The ground stirs…' : 'Something is digging!', 'red', 2);
  Sfx.at('rumble', t.x, t.z, 1.2);
  Sfx.play('warn', 0.6);
  if (!G.autotest) {
    if (!G.flags.tipTunnel) {
      G.flags.tipTunnel = true;
      UI.banner(t.undead ? 'The dead are rising!' : 'Tunnelers!', 'Enemies are breaking in behind the wall. Get there!', 'red', 3);
    } else UI.toast(t.undead ? '⚠️ The dead are rising inside the walls!' : '⚠️ Tunnelers are breaking in. Get there!');
  }
}

function breakOpen(t: Tunnel): void {
  t.state = 'done';
  // The tunnel warning already said it; don't also cry "enemies inside".
  insideAlerted = true;
  erupt(t.x, t.z, 2.2, t.undead ? 0x4a5a3a : 0x7a5a3a);
  if (t.undead) burst(t.x, 1, t.z, 0x7dff9a, 20, { glow: true, speed: 4, up: 6 });
  Sfx.at('burrow', t.x, t.z, 1.2);
  shakeAt(t.x, t.z, 0.45, 0.8);
  const n = t.types.length;
  t.types.forEach((type, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const r = 0.6 + Math.random() * 1.4;
    const e = Units.spawnEnemy(type, t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, Math.max(1, G.wave));
    e.emergeT = 0.45 + i * 0.12 + Math.random() * 0.15;
    e.facing = a;
  });
}

function updateTunnels(dt: number): void {
  for (const t of tunnels) {
    if (t.state === 'wait') {
      if (waveT >= t.at) startWarning(t);
      continue;
    }
    if (t.state !== 'warn') continue;
    t.t += dt;
    t.fxT -= dt;
    if (t.fxT <= 0 && !G.autotest) {
      t.fxT = 0.22;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.8;
      dust(t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, 0.5 + (t.t / TUNNEL_WARN) * 0.8, t.undead ? 0x9aa88a : 0xb89a72);
      burst(t.x + Math.cos(a) * r, 0.2, t.z + Math.sin(a) * r, 0x7a6a5a, 2, { speed: 1.5, up: 4, size: 0.12, life: 0.5 });
      if (Math.random() < 0.3) ring(t.x, t.z, t.undead ? 0x7dff9a : 0xff8a2a, 2.6, 0.5);
      if (t.t > TUNNEL_WARN * 0.5) shakeAt(t.x, t.z, 0.03, 0.25);
    }
    if (t.t >= TUNNEL_WARN) breakOpen(t);
  }
}

// ───────────────────────────── Danger level ─────────────────────────────

function updateDanger(dt: number): void {
  let prox = 0;
  let inside = 0;
  let boss = false;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.z > W + 0.8 || e.climbT > 0) inside++;
    const p = clamp((e.z - MAP.spawnZ) / (W - MAP.spawnZ), 0, 1);
    prox += p * p * (e.isBoss ? 6 : 1);
    if (e.isBoss) boss = true;
  }
  Danger.inside = inside;
  const wave = G.phase === 'wave';
  const kr = St.S.keep ? St.S.keep.hp / St.S.keep.maxHp : 1;
  let lvl = wave ? 0.2 : 0;
  if (wave) {
    lvl += 0.3 * Math.min(1, prox / 30);
    lvl += 0.3 * Math.min(1, inside / 5);
    lvl += boss ? 0.15 : 0;
    lvl += 0.35 * (1 - kr);
    if (tunnels.some((t) => t.state === 'warn')) lvl += 0.15;
  }
  Danger.level = clamp(lvl, 0, 1);

  if (!wave || G.autotest) return;
  if (inside >= 3 && !insideAlerted) {
    insideAlerted = true;
    Sfx.play('alarm', 0.7);
    UI.toast('⚔️ Enemies inside the walls!');
  }
  // The keep's heartbeat quickens as it weakens.
  if (kr < 0.35) {
    heartT -= dt;
    if (heartT <= 0) {
      heartT = 0.45 + kr * 1.6;
      Sfx.play('heartbeat', 0.8);
    }
  }
  if (breachT > 0) breachT -= dt;
}

export function updateThreats(dt: number): void {
  if (G.phase === 'wave') {
    waveT += dt;
    updateTunnels(dt);
  }
  updateDanger(dt);
}

on('waveStart', (w) => {
  waveT = 0;
  insideAlerted = false;
  planTunnels(w as number);
});
on('waveClear', () => {
  tunnels.length = 0;
});

on('threat', (arg) => {
  if (G.autotest) return;
  const a = arg as { kind: string; amount?: number; e?: Enemy };
  switch (a.kind) {
    case 'breach':
      if (breachT > 0) return;
      breachT = 8;
      Sfx.play('alarm', 0.8);
      UI.toast('🧱 The wall is breached!');
      break;
    case 'stolen':
      if (!G.flags.tipThief) {
        G.flags.tipThief = true;
        UI.banner('Thief!', `A goblin grabbed ${a.amount} coins. Catch it before it escapes!`, 'red', 3);
      } else if ((a.amount ?? 0) > 0) UI.toast(`💰 A thief grabbed ${a.amount} coins. Catch it!`);
      break;
    case 'escaped':
      UI.toast(`💸 A thief got away with ${a.amount} coins`);
      break;
    case 'ward':
      if (a.e?.isBoss) UI.banner(`${a.e.title} raises a ward!`, 'Towers can’t hurt it. Only your hero can break it!', 'red', 2.8);
      else if (!G.flags.tipWard) {
        G.flags.tipWard = true;
        UI.toast('🔮 Warded enemies shrug off towers. Strike them yourself!');
      }
      break;
  }
});

// ───────────────────────────── Threat arrows ─────────────────────────────

interface Marker {
  x: number;
  z: number;
  y: number;
  icon: string;
  cls: string;
}

let layer: HTMLElement | null = null;
const pool: { el: HTMLDivElement; icon: HTMLSpanElement; arrow: HTMLElement; shown: boolean; key: string }[] = [];
const _p = new THREE.Vector3();
const _markers: Marker[] = [];

function collect(): Marker[] {
  const out = _markers;
  out.length = 0;
  for (const t of tunnels) if (t.state === 'warn') out.push({ x: t.x, z: t.z, y: 0.5, icon: '⚠️', cls: 'warn' });
  let insideN = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.d.thief) out.push({ x: e.x, z: e.z, y: 1, icon: '💰', cls: e.loot > 0 ? 'loot' : 'thief' });
    else if (e.wardHits > 0) out.push({ x: e.x, z: e.z, y: 1.5 * e.scale, icon: '🔮', cls: 'ward' });
    else if (e.isBoss) out.push({ x: e.x, z: e.z, y: 2 * e.scale, icon: '👑', cls: 'boss' });
    else if (e.z > W + 0.8 && insideN < 3) {
      insideN++;
      out.push({ x: e.x, z: e.z, y: 1, icon: '⚔️', cls: 'inside' });
    }
    if (out.length >= 8) break;
  }
  return out;
}

/** Called every frame after the camera moved: arrows at the screen edge point at threats out of view. */
export function renderThreats(): void {
  if (G.autotest) return;
  if (!layer) layer = document.getElementById('threats');
  if (!layer) return;
  const list = G.phase === 'wave' ? collect() : [];
  const w = engine.w;
  const h = engine.h;
  const pad = 34;
  let used = 0;
  for (const m of list) {
    _p.set(m.x, m.y, m.z).project(camera);
    let sx = _p.x;
    let sy = _p.y;
    if (_p.z > 1) {
      sx = -sx;
      sy = -sy;
    }
    const on = _p.z <= 1 && Math.abs(sx) < 0.94 && Math.abs(sy) < 0.9;
    if (on) continue;
    // Clamp to the screen edge along the ray from the centre.
    const k = Math.max(Math.abs(sx) / 0.94, Math.abs(sy) / 0.86, 1e-6);
    const ex = sx / k;
    const ey = sy / k;
    const px = clamp((ex * 0.5 + 0.5) * w, pad, w - pad);
    let py = clamp((-ey * 0.5 + 0.5) * h, 110, h - 120);
    // Keep clear of the wave card at the top centre.
    if (py < 250 && Math.abs(px - w / 2) < 220) py = 250;
    let slot = pool[used];
    if (!slot) {
      const el = document.createElement('div');
      el.className = 'threat';
      const arrow = document.createElement('i');
      const icon = document.createElement('span');
      el.append(arrow, icon);
      layer.appendChild(el);
      slot = { el, icon, arrow, shown: false, key: '' };
      pool.push(slot);
    }
    used++;
    const key = m.icon + m.cls;
    if (slot.key !== key) {
      slot.key = key;
      slot.icon.textContent = m.icon;
      slot.el.className = 'threat ' + m.cls;
    }
    const ang = Math.atan2(-ey, ex);
    slot.el.style.transform = `translate(${px.toFixed(0)}px, ${py.toFixed(0)}px)`;
    slot.arrow.style.transform = `rotate(${ang.toFixed(2)}rad)`;
    if (!slot.shown) {
      slot.shown = true;
      slot.el.hidden = false;
    }
  }
  for (let i = used; i < pool.length; i++) {
    if (pool[i].shown) {
      pool[i].shown = false;
      pool[i].el.hidden = true;
    }
  }
}
