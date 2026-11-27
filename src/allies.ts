import { scene } from './engine';
import { CFG } from './config';
import { G } from './state';
import { S, type Structure } from './structures';
import { enemies, type Enemy } from './units';
import { griffinModel, allyDragonModel, updateLook, ROOST_PERCH, type UnitModel } from './models';
import { impact, fire, puff, spark, dust, burst } from './fx';
import { Sfx } from './audio';
import { Stat } from './progress';
import { angleLerp, clamp } from './util';

/**
 * Flying allies: griffin riders from the Aerie and the dragon from the Roost.
 * They can reach anywhere on the field, so siege engines, archers and
 * stragglers that sit out of tower range get dealt with without the hero.
 */

const WZ = CFG.map.wallZ;
const CRUISE = 6.5;

interface Griffin {
  m: UnitModel;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  target: Enemy | null;
  retarget: number;
  cd: number;
  /** Dive progress 0..1, or -1 when cruising. */
  dive: number;
  struck: boolean;
  slot: number;
}

interface Dragon {
  m: UnitModel;
  x: number;
  y: number;
  z: number;
  facing: number;
  orbit: number;
  state: 'perch' | 'fly' | 'approach' | 'strafe';
  t: number;
  cd: number;
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  tickT: number;
  fxT: number;
}

const griffins: Griffin[] = [];
let dragon: Dragon | null = null;

const findSpecial = (kind: string): Structure | undefined => S.special.find((t) => t.kind === kind && t.alive);

function fighting(): boolean {
  return G.phase === 'wave' && enemies.some((e) => e.alive);
}

function steer(u: { x: number; z: number; vx: number; vz: number }, tx: number, tz: number, speed: number, dt: number, accel = 3): void {
  const dx = tx - u.x;
  const dz = tz - u.z;
  const L = Math.hypot(dx, dz);
  const want = L < 0.5 ? 0 : speed * Math.min(1, L / 3);
  const wx = L > 0.001 ? (dx / L) * want : 0;
  const wz = L > 0.001 ? (dz / L) * want : 0;
  const k = Math.min(1, dt * accel);
  u.vx += (wx - u.vx) * k;
  u.vz += (wz - u.vz) * k;
  u.x += u.vx * dt;
  u.z += u.vz * dt;
}

// ───────────────────────────── Griffins ─────────────────────────────

function griffinTarget(g: Griffin): Enemy | null {
  let best: Enemy | null = null;
  let bs = -Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = e.d;
    let sc = 0;
    if (d.siege || d.lob) sc += 1000;
    else if (d.ranged) sc += 500;
    if (e.flying) sc += 350;
    if (e.isBoss || e.champion) sc += 200;
    // Stragglers beyond the archers' reach.
    sc += Math.max(0, WZ - 6 - e.z) * 10;
    for (const o of griffins) if (o !== g && o.target === e) sc -= 600;
    sc -= Math.hypot(e.x - g.x, e.z - g.z) * 4;
    if (sc > bs) {
      bs = sc;
      best = e;
    }
  }
  return best;
}

function perchOf(a: Structure, slot: number, n: number): [number, number, number] {
  const ang = (slot / Math.max(1, n)) * Math.PI * 2 + 0.6;
  return [a.x + Math.cos(ang) * 0.9, a.top - 0.2, a.z + Math.sin(ang) * 0.75];
}

function syncGriffins(a: Structure | undefined): void {
  const want = a ? CFG.aerie.count[clamp(a.level - 1, 0, CFG.aerie.count.length - 1)] : 0;
  while (griffins.length > want) {
    const g = griffins.pop()!;
    puff(g.x, g.y, g.z, 0xf4eee0, { n: 5, size: 0.3 });
    scene.remove(g.m.group);
  }
  while (a && griffins.length < want) {
    const slot = griffins.length;
    const [x, y, z] = perchOf(a, slot, want);
    const m = griffinModel();
    scene.add(m.group);
    griffins.push({ m, x, y, z, vx: 0, vz: 0, facing: Math.PI, target: null, retarget: 0, cd: Math.random(), dive: -1, struck: false, slot });
  }
}

function updateGriffins(dt: number): void {
  const a = findSpecial('aerie');
  syncGriffins(a);
  if (!a) return;
  const L = clamp(a.level - 1, 0, CFG.aerie.dmg.length - 1);
  const war = fighting();
  for (const g of griffins) {
    g.cd -= dt * Stat.haste();
    g.retarget -= dt;
    let moving = true;
    let swing = 1;
    if (!war) {
      // Fly home and settle on the nest.
      g.target = null;
      g.dive = -1;
      const [px, py, pz] = perchOf(a, g.slot, griffins.length);
      steer(g, px, pz, CFG.aerie.speed * 0.7, dt);
      const near = Math.hypot(px - g.x, pz - g.z);
      g.y += ((near < 1.5 ? py : CRUISE + 1) - g.y) * Math.min(1, dt * 3);
      if (near < 0.6) {
        moving = false;
        g.facing = angleLerp(g.facing, Math.PI, Math.min(1, dt * 4));
      }
    } else {
      if (!g.target || !g.target.alive || g.retarget <= 0) {
        g.target = griffinTarget(g);
        g.retarget = 1.5;
      }
      const t = g.target;
      if (g.dive >= 0 && t) {
        // Swoop: drop onto the target, strike, climb away.
        g.dive += dt / 0.6;
        const low = (t.flying ? t.aimY : 0.9) + 0.4;
        g.y = CRUISE - (CRUISE - low) * Math.sin(Math.min(1, g.dive) * Math.PI);
        steer(g, t.x, t.z, CFG.aerie.speed * 1.4, dt, 6);
        swing = g.dive;
        if (!g.struck && g.dive >= 0.5) {
          g.struck = true;
          const dmg = CFG.aerie.dmg[L] * Stat.towerDmg();
          t.damage(dmg, 'pierce');
          impact(t.x, t.aimY + 0.2, t.z, 0xfff4d0, true);
          if (!t.flying) dust(t.x, t.z, 0.9);
          Sfx.at('stab', t.x, t.z, 0.6);
        }
        if (g.dive >= 1) {
          g.dive = -1;
          g.cd = CFG.aerie.interval;
          g.retarget = 0;
        }
      } else if (t) {
        // Close in at cruising height, then dive.
        const ox = Math.cos(G.time * 1.3 + g.slot * 2) * 2.2;
        const oz = Math.sin(G.time * 1.3 + g.slot * 2) * 2.2;
        steer(g, t.x + (g.cd > 0 ? ox : 0), t.z + (g.cd > 0 ? oz : 0), CFG.aerie.speed, dt);
        g.y += (CRUISE - g.y) * Math.min(1, dt * 2);
        if (g.cd <= 0 && Math.hypot(t.x - g.x, t.z - g.z) < 3.2) {
          g.dive = 0;
          g.struck = false;
          Sfx.at('whoosh', g.x, g.z, 0.5);
        }
      } else {
        // Patrol above the wall.
        const ang = G.time * 0.5 + g.slot * 1.8;
        steer(g, Math.cos(ang) * 10, WZ - 4 + Math.sin(ang) * 5, CFG.aerie.speed * 0.6, dt);
        g.y += (CRUISE - g.y) * Math.min(1, dt * 2);
      }
    }
    if (moving && Math.hypot(g.vx, g.vz) > 0.3) g.facing = angleLerp(g.facing, Math.atan2(g.vx, g.vz), Math.min(1, dt * 6));
    g.m.group.position.set(g.x, g.y, g.z);
    g.m.group.rotation.y = g.facing;
    g.m.group.rotation.z = clamp(-(g.vx * Math.cos(g.facing) - g.vz * Math.sin(g.facing)) * 0.04, -0.5, 0.5);
    g.m.anim(dt, moving, 1, swing);
    updateLook(g.m, dt, null, G.time);
  }
}

// ───────────────────────────── Dragon ─────────────────────────────

/** The enemy with the most company (siege engines count extra). */
function strafeTarget(): Enemy | null {
  let best: Enemy | null = null;
  let bs = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    let n = e.d.siege || e.d.lob ? 3 : 0;
    for (const o of enemies) if (o.alive && (o.x - e.x) ** 2 + (o.z - e.z) ** 2 < 12) n++;
    if (n > bs) {
      bs = n;
      best = e;
    }
  }
  return best;
}

function updateDragon(dt: number): void {
  const r = findSpecial('roost');
  if (!r) {
    if (dragon) {
      puff(dragon.x, dragon.y, dragon.z, 0xe8e0d0, { n: 8, size: 0.6 });
      scene.remove(dragon.m.group);
      dragon = null;
    }
    return;
  }
  const px = r.x;
  const py = ROOST_PERCH + 0.75;
  const pz = r.z;
  if (!dragon) {
    const m = allyDragonModel();
    scene.add(m.group);
    dragon = { m, x: px, y: py, z: pz, facing: Math.PI, orbit: 0, state: 'perch', t: 0, cd: 1.5, sx: 0, sz: 0, ex: 0, ez: 0, tickT: 0, fxT: 0 };
  }
  const d = dragon;
  const L = clamp(r.level - 1, 0, CFG.roost.dmg.length - 1);
  const war = fighting();
  let tx = d.x;
  let tz = d.z;
  let ty = d.y;
  let speed = 11;
  if (!war && d.state !== 'perch') {
    // Head home.
    tx = px;
    tz = pz;
    const near = Math.hypot(px - d.x, pz - d.z);
    ty = near < 2 ? py : 8;
    if (near < 0.4 && Math.abs(d.y - py) < 0.3) d.state = 'perch';
  } else if (!war) {
    d.facing = angleLerp(d.facing, Math.PI, Math.min(1, dt * 2));
    d.m.group.position.set(px, py + Math.sin(G.time * 1.5) * 0.04, pz);
    d.m.group.rotation.set(0, d.facing, 0);
    d.m.anim(dt * 0.25, false, 0, 1);
    updateLook(d.m, dt, null, G.time);
    return;
  } else {
    if (d.state === 'perch') {
      d.state = 'fly';
      Sfx.at('roar', d.x, d.z, 0.6);
    }
    d.cd -= dt * Stat.haste();
    if (d.state === 'fly') {
      d.orbit += dt * 0.45;
      tx = Math.cos(d.orbit) * 15;
      tz = WZ - 14 + Math.sin(d.orbit) * 9;
      ty = 9;
      if (d.cd <= 0) {
        const e = strafeTarget();
        if (e) {
          // Line up a run that passes straight over the crowd.
          let dx = e.x - d.x;
          let dz = e.z - d.z;
          const L2 = Math.hypot(dx, dz) || 1;
          dx /= L2;
          dz /= L2;
          d.sx = e.x - dx * 7;
          d.sz = e.z - dz * 7;
          d.ex = e.x + dx * 7;
          d.ez = e.z + dz * 7;
          d.state = 'approach';
        } else d.cd = 1;
      }
    }
    if (d.state === 'approach') {
      tx = d.sx;
      tz = d.sz;
      ty = 6;
      speed = 16;
      if (Math.hypot(d.sx - d.x, d.sz - d.z) < 1.5) {
        d.state = 'strafe';
        d.t = 0;
        Sfx.at('roar', d.x, d.z, 0.9);
      }
    }
    if (d.state === 'strafe') {
      const dur = CFG.roost.breath[L];
      d.t += dt / dur;
      const k = Math.min(1, d.t);
      tx = d.sx + (d.ex - d.sx) * k;
      tz = d.sz + (d.ez - d.sz) * k;
      ty = 5;
      d.x = tx;
      d.z = tz;
      // Fire lands a few units ahead of the dragon's snout.
      const fx = Math.sin(d.facing);
      const fz = Math.cos(d.facing);
      const gx = d.x + fx * 3.2;
      const gz = d.z + fz * 3.2;
      d.fxT -= dt;
      if (d.fxT <= 0) {
        d.fxT = 0.05;
        const mx = d.x + fx * 2.4;
        const mz = d.z + fz * 2.4;
        const my = d.y + 0.6;
        for (let i = 1; i <= 3; i++) {
          const s = i / 3;
          fire(mx + (gx - mx) * s, my + (0.4 - my) * s, mz + (gz - mz) * s, { n: 1, spread: 0.2 + s * 0.6, size: 0.3 + s * 0.35, life: 0.35, up: 0.8, out: 0.6 });
        }
        if (Math.random() < 0.4) puff(gx, 0.6, gz, 0x3a322e, { n: 1, spread: 0.6, size: 0.5, life: 0.9, up: 1.2, grow: 0.6 });
      }
      d.tickT -= dt;
      if (d.tickT <= 0) {
        d.tickT = 0.2;
        const mul = Stat.magicDmg();
        const W = CFG.roost.width;
        for (const e of enemies) {
          if (!e.alive || Math.hypot(e.x - gx, e.z - gz) > W + e.r) continue;
          e.damage(CFG.roost.dmg[L] * mul * 0.2, 'fire');
          e.burn(CFG.roost.burn[L] * mul * 0.2, 3);
        }
        Sfx.at('fire', gx, gz, 0.5);
      }
      if (d.t >= 1) {
        d.state = 'fly';
        d.cd = CFG.roost.cooldown[L];
        spark(d.x, d.y + 1, d.z, 0x7fffd4, 1.4, 0.4);
      }
    }
  }
  // Fly.
  if (d.state !== 'strafe') {
    const dx = tx - d.x;
    const dz = tz - d.z;
    const Ld = Math.hypot(dx, dz);
    const step = Math.min(Ld, speed * dt);
    if (Ld > 0.01) {
      d.x += (dx / Ld) * step;
      d.z += (dz / Ld) * step;
      d.facing = angleLerp(d.facing, Math.atan2(dx, dz), Math.min(1, dt * 3));
    }
  } else {
    d.facing = angleLerp(d.facing, Math.atan2(d.ex - d.sx, d.ez - d.sz), Math.min(1, dt * 6));
  }
  d.y += (ty - d.y) * Math.min(1, dt * 2.5);
  d.m.group.position.set(d.x, d.y, d.z);
  d.m.group.rotation.set(d.state === 'strafe' ? 0.12 : 0, d.facing, 0);
  d.m.anim(dt, true, 1, 1);
  updateLook(d.m, dt, null, G.time);
  if (d.state === 'strafe' && Math.random() < dt * 6) burst(d.x, d.y + 0.4, d.z, 0xffc04a, 1, { glow: true, speed: 1, up: 1, life: 0.4 });
}

/** Debug snapshot of the flying allies. */
export function alliesInfo(): string {
  const g = griffins.map((x) => `${x.x.toFixed(0)},${x.y.toFixed(1)},${x.z.toFixed(0)}${x.dive >= 0 ? 'D' : ''}${x.target ? '*' : ''}`).join(' ');
  return `griffins[${g}] dragon[${dragon ? `${dragon.state} ${dragon.x.toFixed(0)},${dragon.y.toFixed(1)},${dragon.z.toFixed(0)}` : '-'}]`;
}

export function updateAllies(dt: number): void {
  updateGriffins(dt);
  updateDragon(dt);
}
