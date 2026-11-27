import type { Target } from './state';

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Small deterministic RNG so the forest looks the same on every load. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distToBox(x: number, z: number, bx: number, bz: number, hw: number, hd: number): number {
  const dx = Math.max(Math.abs(x - bx) - hw, 0);
  const dz = Math.max(Math.abs(z - bz) - hd, 0);
  return Math.hypot(dx, dz);
}

/** Point on a target closest to (x, z): the unit centre or the nearest point on a structure box. */
export function aimPoint(x: number, z: number, t: Target): [number, number] {
  if (!t.isStruct) return [t.x, t.z];
  return [clamp(x, t.x - t.hw, t.x + t.hw), clamp(z, t.z - t.hd, t.z + t.hd)];
}

/** Surface-to-surface distance from a circle (x, z, r) to a target. */
export function surfDist(x: number, z: number, r: number, t: Target): number {
  if (t.isStruct) return distToBox(x, z, t.x, t.z, t.hw, t.hd) - r;
  return Math.hypot(t.x - x, t.z - z) - t.r - r;
}

export function fmtTime(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
