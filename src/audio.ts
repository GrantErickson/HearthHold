/** Synthesized sound effects (no audio files). */
export type SfxName =
  | 'chop' | 'mine' | 'pickup' | 'drop' | 'coin' | 'pay' | 'build' | 'unlock' | 'swing' | 'hit'
  | 'arrow' | 'boom' | 'die' | 'hurt' | 'horn' | 'win' | 'lose' | 'click' | 'deny' | 'crumble'
  | 'zap' | 'freeze' | 'fire' | 'levelup' | 'whoosh' | 'explode' | 'roar' | 'chest' | 'bell' | 'heal'
  | 'thunk' | 'stab' | 'magic' | 'relic' | 'warcry' | 'act';

const MUTE_KEY = 'hearthold-muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage blocked: default to sound on */
}

const lastPlayed: Partial<Record<SfxName, number>> = {};
const minGap: Partial<Record<SfxName, number>> = {
  pay: 55, coin: 55, chop: 70, mine: 70, arrow: 60, hit: 45, swing: 70, drop: 40, pickup: 35, die: 50, hurt: 120, crumble: 200,
  zap: 70, freeze: 90, fire: 80, explode: 90, thunk: 80, stab: 120, magic: 90, heal: 200, boom: 60,
};

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(dur: number, vol: number, freq: number, delay = 0, q = 0.9): void {
  if (!ctx || !master) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, vol), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.03);
}

const defs: Record<SfxName, (v: number) => void> = {
  chop: (v) => { noise(0.09, 0.35 * v, 1500); tone(150, 0.09, 'triangle', 0.3 * v, -60); },
  mine: (v) => { tone(1100, 0.07, 'square', 0.07 * v); noise(0.08, 0.25 * v, 3200, 0, 2); },
  pickup: (v) => tone(520, 0.07, 'sine', 0.16 * v, 260),
  drop: (v) => tone(340, 0.06, 'triangle', 0.16 * v, -120),
  coin: (v) => { tone(1320, 0.06, 'square', 0.05 * v); tone(1760, 0.12, 'square', 0.05 * v, 0, 0.05); },
  pay: (v) => tone(980, 0.04, 'square', 0.04 * v),
  build: (v) => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.2 * v, 0, i * 0.07)),
  unlock: (v) => { tone(880, 0.12, 'sine', 0.16 * v); tone(1320, 0.18, 'sine', 0.13 * v, 0, 0.1); },
  swing: (v) => noise(0.08, 0.14 * v, 4200),
  hit: (v) => { tone(190, 0.08, 'square', 0.1 * v, -90); noise(0.06, 0.18 * v, 1100); },
  arrow: (v) => noise(0.13, 0.08 * v, 6500, 0, 1.5),
  boom: (v) => { noise(0.4, 0.4 * v, 420); tone(70, 0.35, 'sine', 0.35 * v, -35); },
  crumble: (v) => { noise(0.6, 0.35 * v, 300); noise(0.4, 0.2 * v, 900, 0.1); },
  die: (v) => tone(320, 0.22, 'sawtooth', 0.08 * v, -220),
  hurt: (v) => tone(240, 0.14, 'sawtooth', 0.14 * v, -130),
  horn: (v) => { tone(110, 1.1, 'sawtooth', 0.16 * v); tone(165, 1.1, 'sawtooth', 0.1 * v); tone(220, 0.6, 'triangle', 0.08 * v, 0, 0.5); },
  win: (v) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.32, 'triangle', 0.18 * v, 0, i * 0.13)),
  lose: (v) => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 'sawtooth', 0.1 * v, -10, i * 0.22)),
  click: (v) => tone(700, 0.05, 'sine', 0.12 * v),
  deny: (v) => tone(180, 0.15, 'square', 0.07 * v, -40),
  zap: (v) => { noise(0.12, 0.22 * v, 5200, 0, 3); tone(1800, 0.1, 'sawtooth', 0.05 * v, -1200); },
  freeze: (v) => { tone(1600, 0.25, 'sine', 0.08 * v, 600); noise(0.2, 0.08 * v, 7000, 0, 4); },
  fire: (v) => { noise(0.3, 0.18 * v, 700, 0, 0.7); tone(120, 0.2, 'triangle', 0.08 * v, 60); },
  levelup: (v) => [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.17 * v, 0, i * 0.08)),
  whoosh: (v) => { noise(0.28, 0.25 * v, 1800, 0, 0.6); noise(0.2, 0.12 * v, 3600, 0.08, 0.8); },
  explode: (v) => { noise(0.55, 0.45 * v, 260); tone(55, 0.5, 'sine', 0.4 * v, -25); noise(0.25, 0.2 * v, 1500, 0.02); },
  roar: (v) => { tone(90, 0.9, 'sawtooth', 0.18 * v, -40); tone(67, 0.9, 'sawtooth', 0.12 * v, -20); noise(0.8, 0.15 * v, 400, 0, 0.5); },
  chest: (v) => { tone(392, 0.1, 'triangle', 0.15 * v); [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.2, 'sine', 0.12 * v, 0, 0.1 + i * 0.06)); },
  bell: (v) => { tone(1046, 0.8, 'sine', 0.14 * v); tone(1568, 0.6, 'sine', 0.07 * v); tone(1046, 0.8, 'sine', 0.1 * v, 0, 0.35); },
  heal: (v) => [523, 784, 1046].forEach((f, i) => tone(f, 0.3, 'sine', 0.1 * v, 30, i * 0.05)),
  thunk: (v) => { tone(140, 0.12, 'square', 0.12 * v, -80); noise(0.1, 0.25 * v, 900); },
  stab: (v) => { noise(0.07, 0.25 * v, 2600, 0, 1.4); tone(420, 0.06, 'square', 0.05 * v, -200); },
  magic: (v) => { tone(880, 0.25, 'sine', 0.07 * v, -440); tone(1320, 0.2, 'triangle', 0.04 * v, -600); },
  relic: (v) => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.4, 'sine', 0.12 * v, 0, i * 0.07)),
  warcry: (v) => { tone(146, 0.7, 'sawtooth', 0.16 * v, 40); tone(220, 0.7, 'sawtooth', 0.1 * v, 60); noise(0.5, 0.12 * v, 900); },
  act: (v) => { tone(98, 1.6, 'sawtooth', 0.14 * v); tone(147, 1.6, 'sawtooth', 0.1 * v); tone(196, 1.2, 'triangle', 0.1 * v, 0, 0.6); tone(294, 1.0, 'triangle', 0.08 * v, 0, 1.0); },
};

export const Sfx = {
  /** Position of the listener (the hero), used by `at`. */
  listener: { x: 0, z: 0 },
  play(name: SfxName, vol = 1): void {
    if (muted) return;
    // Only make sounds once a user gesture has started the audio context.
    // Scheduling nodes on a suspended context just piles them up (and stalls the game).
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    const gap = minGap[name] ?? 0;
    const last = lastPlayed[name] ?? -1e9;
    if (now - last < gap) return;
    lastPlayed[name] = now;
    try {
      defs[name](vol);
    } catch {
      /* audio glitches must never break the game */
    }
  },
  /** Play with volume falling off by distance from the listener. */
  at(name: SfxName, x: number, z: number, vol = 1): void {
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    const v = d < 9 ? 1 : Math.max(0, 1 - (d - 9) / 24);
    if (v > 0.06) this.play(name, v * vol);
  },
  unlock(): void {
    ensure();
  },
  isMuted(): boolean {
    return muted;
  },
  setMuted(m: boolean): void {
    muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (master) master.gain.value = m ? 0 : 0.55;
  },
};
