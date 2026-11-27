import * as THREE from 'three';
import { scene } from './engine';
import { G, actOf } from './state';
import { U } from './models';
import { glowTex, softTex } from './fx';

/**
 * Lighting, sky colour, day/night, act seasons and weather.
 * Build phases are daytime; waves are fought at dusk/night.
 */

interface Palette {
  bg: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  sun: THREE.Color;
  sunI: number;
}

const pal = (bg: number, hs: number, hg: number, hi: number, sun: number, si: number): Palette => ({
  bg: new THREE.Color(bg), hemiSky: new THREE.Color(hs), hemiGround: new THREE.Color(hg), hemiI: hi, sun: new THREE.Color(sun), sunI: si,
});

const DAY: Palette[] = [
  pal(0x9fd3f0, 0xe2f3ff, 0x5d7a3a, 1.9, 0xfff0d8, 2.3),
  pal(0xe8c9a0, 0xfff0dc, 0x6a5a30, 1.8, 0xffe2bc, 2.3),
  pal(0x8fa0a0, 0xc8d4d0, 0x4a5040, 1.7, 0xe0e8dc, 1.9),
  pal(0xd4e2ee, 0xeef6ff, 0x8a98a8, 1.85, 0xf4f8ff, 2.0),
  pal(0xa66050, 0xffd8c8, 0x4a2a20, 1.7, 0xffc8a8, 2.1),
];
const NIGHT: Palette[] = [
  pal(0x1d2b4a, 0x6a80b0, 0x1c2a1c, 1.0, 0xa8bce8, 0.7),
  pal(0x2a2038, 0x7a6e98, 0x2a2018, 1.0, 0xb8b0e0, 0.65),
  pal(0x142420, 0x6a8a80, 0x101810, 0.95, 0xa8c8bc, 0.55),
  pal(0x1a2a48, 0x8aa4d8, 0x3a4a6a, 1.1, 0xc0d4f4, 0.85),
  pal(0x2a0d10, 0x8a5a56, 0x200a08, 1.0, 0xd89a88, 0.6),
];
const BLOOD = pal(0x3a0a0e, 0xa86060, 0x2a0808, 1.0, 0xe08070, 0.75);

const SEASON = [
  new THREE.Vector4(1, 0.5, 0.15, 0),
  new THREE.Vector4(1.0, 0.45, 0.12, 0.75),
  new THREE.Vector4(0.55, 0.55, 0.4, 0.55),
  new THREE.Vector4(0.7, 0.85, 0.82, 0.35),
  new THREE.Vector4(0.45, 0.3, 0.2, 0.6),
];
const SNOW = [0, 0, 0, 0.85, 0];
const FOG: [number, number][] = [[55, 110], [55, 110], [38, 95], [48, 105], [45, 100]];

type Weather = 'fireflies' | 'leaves' | 'ash' | 'snow' | 'embers';
const WEATHER: Weather[] = ['fireflies', 'leaves', 'ash', 'snow', 'embers'];

let hemi: THREE.HemisphereLight;
let sun: THREE.DirectionalLight;
const cur = pal(0x9fd3f0, 0xe2f3ff, 0x5d7a3a, 1.9, 0xfff0d8, 2.3);
let night = 0;
let fogNear = 55;
let fogFar = 110;
const season = new THREE.Vector4(1, 0.5, 0.15, 0);
let snow = 0;

interface Glow {
  s: THREE.Sprite;
  base: number;
  size: number;
  nightOnly: boolean;
  ph: number;
}
const glows: Glow[] = [];
export interface PLight {
  l: THREE.PointLight;
  base: number;
  always: boolean;
}
const lights: PLight[] = [];

// Weather particles
const W_N = 700;
const W_BOX = { x: 28, y: 18, z: 22 };
let wPoints: THREE.Points | null = null;
let wMat: THREE.PointsMaterial | null = null;
let wAdd: THREE.PointsMaterial | null = null;
let wKind: Weather | null = null;
let wAmount = 0;
const wPos = new Float32Array(W_N * 3);
const wVel = new Float32Array(W_N * 3);
const focus = { x: 0, z: 0 };

function seedWeather(): void {
  for (let i = 0; i < W_N; i++) {
    wPos[i * 3] = (Math.random() - 0.5) * 2 * W_BOX.x;
    wPos[i * 3 + 1] = Math.random() * W_BOX.y;
    wPos[i * 3 + 2] = (Math.random() - 0.5) * 2 * W_BOX.z;
    wVel[i * 3] = Math.random() * Math.PI * 2;
    wVel[i * 3 + 1] = 0.6 + Math.random() * 0.8;
    wVel[i * 3 + 2] = Math.random();
  }
}

function setWeather(k: Weather): void {
  if (!wPoints || !wMat || !wAdd) return;
  wKind = k;
  const add = k === 'embers' || k === 'fireflies';
  wPoints.material = add ? wAdd : wMat;
  const m = wPoints.material as THREE.PointsMaterial;
  const conf: Record<Weather, [number, number]> = {
    fireflies: [0xd8ff7a, 0.32],
    leaves: [0xd8803a, 0.34],
    ash: [0xa8a89a, 0.2],
    snow: [0xffffff, 0.24],
    embers: [0xff8a3a, 0.22],
  };
  m.color.setHex(conf[k][0]);
  m.size = conf[k][1];
  seedWeather();
}

function updateWeather(dt: number, time: number, act: number): void {
  if (!wPoints) return;
  const want = WEATHER[act - 1];
  const strength = want === 'fireflies' ? night : want === 'leaves' ? 0.8 : 1;
  if (want !== wKind) {
    wAmount = Math.max(0, wAmount - dt);
    if (wAmount <= 0) setWeather(want);
  } else wAmount += (strength - wAmount) * Math.min(1, dt * 0.8);
  const m = wPoints.material as THREE.PointsMaterial;
  m.opacity = Math.min(1, wAmount);
  wPoints.visible = m.opacity > 0.02;
  if (!wPoints.visible) return;
  wPoints.position.set(focus.x, 0, focus.z);
  for (let i = 0; i < W_N; i++) {
    const o = i * 3;
    const ph = wVel[o];
    const sp = wVel[o + 1];
    let x = wPos[o], y = wPos[o + 1], z = wPos[o + 2];
    switch (wKind) {
      case 'fireflies':
        x += Math.sin(time * 0.7 + ph) * dt * 0.8;
        z += Math.cos(time * 0.6 + ph * 1.3) * dt * 0.8;
        y = 0.4 + (wVel[o + 2] * 2.2) + Math.sin(time * 1.3 + ph) * 0.3;
        break;
      case 'leaves':
        y -= sp * 1.2 * dt;
        x += (Math.sin(time * 1.5 + ph) * 1.4 + 0.6) * dt;
        z += Math.cos(time * 1.1 + ph) * 0.6 * dt;
        break;
      case 'ash':
        y -= sp * 0.45 * dt;
        x += (Math.sin(time * 0.4 + ph) * 0.5 + 0.3) * dt;
        break;
      case 'snow':
        y -= sp * 1.8 * dt;
        x += (Math.sin(time * 0.9 + ph) * 0.7 + 0.4) * dt;
        z += Math.cos(time * 0.7 + ph) * 0.4 * dt;
        break;
      case 'embers':
        y += sp * 1.3 * dt;
        x += Math.sin(time * 2 + ph) * 0.6 * dt;
        z += Math.cos(time * 1.7 + ph) * 0.6 * dt;
        break;
    }
    if (y < 0) y += W_BOX.y;
    if (y > W_BOX.y) y -= W_BOX.y;
    if (x > W_BOX.x) x -= 2 * W_BOX.x;
    if (x < -W_BOX.x) x += 2 * W_BOX.x;
    if (z > W_BOX.z) z -= 2 * W_BOX.z;
    if (z < -W_BOX.z) z += 2 * W_BOX.z;
    wPos[o] = x;
    wPos[o + 1] = y;
    wPos[o + 2] = z;
  }
  (wPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

function lerpPal(out: Palette, a: Palette, b: Palette, t: number, k: number): void {
  const tmp = new THREE.Color();
  out.bg.lerp(tmp.copy(a.bg).lerp(b.bg, t), k);
  out.hemiSky.lerp(tmp.copy(a.hemiSky).lerp(b.hemiSky, t), k);
  out.hemiGround.lerp(tmp.copy(a.hemiGround).lerp(b.hemiGround, t), k);
  out.sun.lerp(tmp.copy(a.sun).lerp(b.sun, t), k);
  out.hemiI += (a.hemiI + (b.hemiI - a.hemiI) * t - out.hemiI) * k;
  out.sunI += (a.sunI + (b.sunI - a.sunI) * t - out.sunI) * k;
}

export const Env = {
  /** Current night amount 0..1 (read by the UI for the vignette). */
  night: 0,

  init(lowSpec: boolean): void {
    scene.background = cur.bg.clone();
    scene.fog = new THREE.Fog(cur.bg.getHex(), fogNear, fogFar);
    hemi = new THREE.HemisphereLight(cur.hemiSky, cur.hemiGround, cur.hemiI);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(cur.sun, cur.sunI);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(lowSpec ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -32;
    sc.right = 32;
    sc.top = 32;
    sc.bottom = -32;
    sc.near = 1;
    sc.far = 100;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
    wMat = new THREE.PointsMaterial({ map: softTex, size: 0.25, transparent: true, depthWrite: false, opacity: 0, fog: true });
    wAdd = new THREE.PointsMaterial({ map: glowTex, size: 0.25, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false });
    wPoints = new THREE.Points(geo, wMat);
    wPoints.frustumCulled = false;
    wPoints.renderOrder = 15;
    scene.add(wPoints);
    seedWeather();
  },

  /** A glowing halo (torch, lamp, campfire). */
  addGlow(x: number, y: number, z: number, color: number, size: number, nightOnly = false): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 }));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.renderOrder = 12;
    scene.add(s);
    glows.push({ s, base: 1, size, nightOnly, ph: Math.random() * 10 });
  },

  /** A real point light; `always` ones also burn during the day (campfires). */
  addLight(x: number, y: number, z: number, color: number, intensity: number, dist: number, always: boolean): PLight {
    // Lights are never added or hidden after start-up: changing the light count recompiles every shader.
    const l = new THREE.PointLight(color, always ? intensity : 0, dist, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
    const p = { l, base: intensity, always };
    lights.push(p);
    return p;
  },

  /** Keep the shadow frustum centred on what the camera sees. */
  focus(x: number, z: number): void {
    focus.x = x;
    focus.z = z;
    if (!sun) return;
    const n = night;
    sun.position.set(x + 14 - n * 22, 30 - n * 6, z + 10);
    sun.target.position.set(x, 0, z);
  },

  update(dt: number, time: number): void {
    if (!hemi) return;
    U.uTime.value = time;
    U.uWind.value = 1 + Math.sin(time * 0.13) * 0.35 + Math.sin(time * 0.37) * 0.15;
    const act = G.phase === 'menu' ? 1 : actOf(G.phase === 'wave' || G.phase === 'gameover' ? Math.max(1, G.wave) : G.wavesCleared + 1);
    const fighting = G.phase === 'wave' || G.phase === 'gameover';
    const blood = fighting && G.mod === 'bloodmoon';
    const target = fighting ? (blood ? 1 : 0.8) : 0;
    night += Math.sign(target - night) * Math.min(Math.abs(target - night), dt / 3.5);
    Env.night = night;
    U.uNight.value = night;
    const k = 1 - Math.exp(-dt * 1.6);
    lerpPal(cur, DAY[act - 1], blood ? BLOOD : NIGHT[act - 1], night, Math.min(1, k * 3));
    (scene.background as THREE.Color).copy(cur.bg);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(cur.bg);
    fogNear += (FOG[act - 1][0] - fogNear) * k;
    fogFar += (FOG[act - 1][1] - fogFar) * k;
    fog.near = fogNear;
    fog.far = fogFar;
    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGround);
    hemi.intensity = cur.hemiI;
    sun.color.copy(cur.sun);
    sun.intensity = cur.sunI;
    season.lerp(SEASON[act - 1], k);
    U.uSeason.value.copy(season);
    snow += (SNOW[act - 1] - snow) * k;
    U.uSnow.value = snow;

    for (const g of glows) {
      const fl = 0.85 + Math.sin(time * 9 + g.ph) * 0.08 + Math.sin(time * 17 + g.ph * 2) * 0.07;
      const lvl = g.nightOnly ? night : 0.25 + night * 0.75;
      g.s.material.opacity = lvl * fl;
      g.s.visible = lvl > 0.02;
      g.s.scale.setScalar(g.size * (0.9 + fl * 0.15));
    }
    for (const p of lights) {
      const fl = 0.9 + Math.sin(time * 11 + p.base) * 0.1;
      p.l.intensity = p.base * (p.always ? 1 : night) * fl;
    }
    updateWeather(dt, time, act);
  },
};
