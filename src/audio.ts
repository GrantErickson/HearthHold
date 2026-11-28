/**
 * Synthesized sound (no audio files): layered effects through a small mixing
 * desk (stereo pan, distance muffling, a shared reverb and a limiter), plus
 * procedural war drums whose intensity follows the danger on the field.
 */
export type SfxName =
  | 'chop' | 'mine' | 'pickup' | 'drop' | 'coin' | 'pay' | 'build' | 'unlock' | 'swing' | 'hit'
  | 'arrow' | 'boom' | 'die' | 'hurt' | 'horn' | 'win' | 'lose' | 'click' | 'deny' | 'crumble'
  | 'zap' | 'freeze' | 'fire' | 'levelup' | 'whoosh' | 'explode' | 'roar' | 'chest' | 'bell' | 'heal'
  | 'thunk' | 'stab' | 'magic' | 'relic' | 'warcry' | 'act'
  | 'cannon' | 'crit' | 'clang' | 'shatter' | 'ward' | 'rumble' | 'burrow' | 'alarm' | 'stomp'
  | 'heartbeat' | 'steal' | 'slam' | 'warn' | 'launch' | 'bigexplode' | 'grapple' | 'wardrum' | 'rally';

const MUTE_KEY = 'hearthold-muted';
const MUSIC_KEY = 'hearthold-music';
const MASTER_VOL = 0.62;
const MUSIC_VOL = 0.5;
const MAX_VOICES = 44;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let reverbIn: GainNode | null = null;
let white: AudioBuffer | null = null;
let brown: AudioBuffer | null = null;
let muted = false;
let musicOn = true;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
  musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
} catch {
  /* storage blocked: default to sound on */
}

const lastPlayed: Partial<Record<SfxName, number>> = {};
const minGap: Partial<Record<SfxName, number>> = {
  pay: 55, coin: 55, chop: 70, mine: 70, arrow: 55, hit: 45, swing: 70, drop: 40, pickup: 35, die: 45, hurt: 140, crumble: 220,
  zap: 70, freeze: 90, fire: 80, explode: 80, thunk: 70, stab: 110, magic: 80, heal: 200, boom: 60, cannon: 90, clang: 70,
  ward: 70, stomp: 110, crit: 60, launch: 90, warn: 200, steal: 300, grapple: 150, bigexplode: 150, slam: 200, heartbeat: 300,
  wardrum: 120, rally: 600,
};
/** Never dropped by the voice limit. */
const PRIORITY = new Set<SfxName>(['explode', 'bigexplode', 'horn', 'roar', 'alarm', 'shatter', 'win', 'lose', 'levelup', 'relic', 'act', 'rumble', 'burrow', 'steal', 'slam', 'crit', 'rally']);
let voiceEnds: number[] = [];

function makeNoise(c: AudioContext, kind: 'white' | 'brown'): AudioBuffer {
  const len = Math.floor(c.sampleRate * 2.5);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return b;
}

/** A short, dark hall: decaying stereo noise, low-passed as it fades. */
function makeImpulse(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 2.2);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / c.sampleRate;
      const k = 0.55 - 0.45 * Math.min(1, t / 1.6);
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.exp(-t * 3.1) * (t < 0.012 ? t / 0.012 : 1);
    }
  }
  return b;
}

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const c = (ctx = new AC());
    master = c.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(master);
    master.connect(c.destination);
    sfxBus = c.createGain();
    sfxBus.connect(comp);
    musicBus = c.createGain();
    musicBus.gain.value = musicOn ? MUSIC_VOL : 0;
    musicBus.connect(comp);
    const verb = c.createConvolver();
    verb.buffer = makeImpulse(c);
    reverbIn = c.createGain();
    reverbIn.gain.value = 1;
    const verbOut = c.createGain();
    verbOut.gain.value = 0.55;
    reverbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(comp);
    white = makeNoise(c, 'white');
    brown = makeNoise(c, 'brown');
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// ───────────────────────────── Voices ─────────────────────────────

interface Voice {
  c: AudioContext;
  /** Start time. */
  t: number;
  out: AudioNode;
  /** Random pitch multiplier so repeats don't sound robotic. */
  p: number;
  end: number;
}

interface VoiceOpts {
  pan?: number;
  /** Reverb send, 0–1. */
  wet?: number;
  /** Low-pass cutoff for distant sounds (0 = none). */
  muffle?: number;
  /** Pitch variation (fraction). */
  vary?: number;
}

function voice(c: AudioContext, o: VoiceOpts): Voice {
  const input = c.createGain();
  let node: AudioNode = input;
  if (o.muffle) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.muffle;
    node.connect(lp);
    node = lp;
  }
  if (o.pan && c.createStereoPanner) {
    const pn = c.createStereoPanner();
    pn.pan.value = Math.max(-1, Math.min(1, o.pan));
    node.connect(pn);
    node = pn;
  }
  node.connect(sfxBus!);
  if (o.wet && reverbIn) {
    const send = c.createGain();
    send.gain.value = o.wet;
    node.connect(send);
    send.connect(reverbIn);
  }
  const vary = o.vary ?? 0.06;
  return { c, t: c.currentTime + 0.005, out: input, p: 1 + (Math.random() * 2 - 1) * vary, end: 0 };
}

interface ToneOpts {
  /** Frequency at the end (exponential glide). */
  to?: number;
  delay?: number;
  attack?: number;
  /** Vibrato depth in Hz and rate. */
  vib?: number;
  vibRate?: number;
  /** Route through a low-pass filter at this cutoff. */
  lp?: number;
  q?: number;
  /** Ignore the voice's random pitch. */
  exact?: boolean;
}

function tone(V: Voice, freq: number, dur: number, type: OscillatorType, vol: number, o: ToneOpts = {}): void {
  const c = V.c;
  const t = V.t + (o.delay ?? 0);
  const pm = o.exact ? 1 : V.p;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(10, freq * pm), t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.to * pm), t + dur);
  const a = o.attack ?? 0.006;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
  let src: AudioNode = osc;
  if (o.vib) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = o.vibRate ?? 6;
    lg.gain.value = o.vib;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  if (o.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    f.Q.value = o.q ?? 0.7;
    src.connect(f);
    src = f;
  }
  src.connect(g);
  g.connect(V.out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  V.end = Math.max(V.end, t + dur);
}

interface NoiseOpts {
  type?: BiquadFilterType;
  /** Filter frequency, and where it sweeps to. */
  f?: number;
  f2?: number;
  q?: number;
  delay?: number;
  attack?: number;
  brown?: boolean;
  /** Soft clipping for crunch. */
  drive?: number;
}

const curves = new Map<number, Float32Array>();
function driveCurve(k: number): Float32Array {
  let c = curves.get(k);
  if (!c) {
    c = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      c[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    curves.set(k, c);
  }
  return c;
}

function noise(V: Voice, dur: number, vol: number, o: NoiseOpts = {}): void {
  const c = V.c;
  const buf = o.brown ? brown : white;
  if (!buf) return;
  const t = V.t + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  const f0 = (o.f ?? 1000) * V.p;
  f.frequency.setValueAtTime(f0, t);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2 * V.p), t + dur);
  f.Q.value = o.q ?? 0.8;
  const g = c.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
  src.connect(f);
  let n: AudioNode = f;
  if (o.drive) {
    const ws = c.createWaveShaper();
    ws.curve = driveCurve(o.drive) as Float32Array<ArrayBuffer>;
    n.connect(ws);
    n = ws;
  }
  n.connect(g);
  g.connect(V.out);
  const off = Math.random() * Math.max(0, buf.duration - dur - 0.1);
  src.start(t, off, dur + 0.05);
  V.end = Math.max(V.end, t + dur);
}

/** Inharmonic metal partials (bells, clangs, armour). */
function metal(V: Voice, base: number, dur: number, vol: number, delay = 0): void {
  const ratios = [1, 1.48, 2.02, 2.74, 3.43];
  ratios.forEach((r, i) => tone(V, base * r, dur * (1 - i * 0.12), i % 2 ? 'sine' : 'triangle', vol * (1 - i * 0.16), { delay }));
}

/** Thump at the bottom of every impact. */
function thump(V: Voice, from: number, to: number, dur: number, vol: number, delay = 0): void {
  tone(V, from, dur, 'sine', vol, { to, delay, attack: 0.003 });
}

// ───────────────────────────── Sound designs ─────────────────────────────

type Def = { wet?: number; vary?: number; play: (V: Voice, v: number) => void };

const defs: Record<SfxName, Def> = {
  chop: { wet: 0.05, play: (V, v) => { noise(V, 0.06, 0.4 * v, { f: 1600, q: 1.2 }); thump(V, 210, 90, 0.09, 0.32 * v); noise(V, 0.03, 0.18 * v, { type: 'highpass', f: 4000 }); } },
  mine: { wet: 0.08, play: (V, v) => { tone(V, 2300, 0.07, 'triangle', 0.09 * v); tone(V, 3420, 0.05, 'sine', 0.06 * v); noise(V, 0.06, 0.24 * v, { type: 'highpass', f: 3800 }); thump(V, 160, 80, 0.06, 0.15 * v); } },
  pickup: { play: (V, v) => tone(V, 540, 0.09, 'sine', 0.17 * v, { to: 960 }) },
  drop: { play: (V, v) => tone(V, 380, 0.07, 'triangle', 0.17 * v, { to: 220 }) },
  coin: { wet: 0.12, vary: 0.02, play: (V, v) => { tone(V, 1568, 0.09, 'sine', 0.08 * v); tone(V, 2093, 0.2, 'sine', 0.08 * v, { delay: 0.045 }); tone(V, 4186, 0.08, 'sine', 0.02 * v, { delay: 0.045 }); } },
  pay: { vary: 0.03, play: (V, v) => tone(V, 1250, 0.045, 'sine', 0.06 * v) },
  build: {
    wet: 0.2, vary: 0,
    play: (V, v) => {
      for (let i = 0; i < 3; i++) { noise(V, 0.05, 0.3 * v, { f: 1300, q: 1.4, delay: i * 0.07 }); thump(V, 180, 90, 0.06, 0.18 * v, i * 0.07); }
      [523, 659, 784, 1047].forEach((f, i) => { tone(V, f, 0.22, 'triangle', 0.16 * v, { delay: 0.2 + i * 0.065 }); tone(V, f * 2, 0.16, 'sine', 0.04 * v, { delay: 0.2 + i * 0.065 }); });
    },
  },
  unlock: { wet: 0.25, vary: 0, play: (V, v) => { tone(V, 880, 0.16, 'sine', 0.16 * v); tone(V, 1320, 0.3, 'sine', 0.13 * v, { delay: 0.1 }); tone(V, 2640, 0.25, 'sine', 0.03 * v, { delay: 0.1 }); } },
  swing: { play: (V, v) => noise(V, 0.13, 0.16 * v, { f: 700, f2: 3200, q: 1.6, attack: 0.04 }) },
  hit: {
    wet: 0.06,
    play: (V, v) => {
      noise(V, 0.09, 0.14 * v, { f: 900, f2: 2600, q: 1.4, attack: 0.02 });
      noise(V, 0.07, 0.42 * v, { type: 'lowpass', f: 1100, f2: 300, delay: 0.035, drive: 2 });
      thump(V, 170, 55, 0.11, 0.3 * v, 0.035);
      noise(V, 0.025, 0.2 * v, { type: 'highpass', f: 3000, delay: 0.035 });
    },
  },
  crit: {
    wet: 0.22,
    play: (V, v) => {
      noise(V, 0.08, 0.6 * v, { type: 'lowpass', f: 1600, f2: 250, drive: 3 });
      thump(V, 140, 38, 0.22, 0.5 * v);
      noise(V, 0.04, 0.35 * v, { type: 'highpass', f: 2500 });
      metal(V, 1240, 0.35, 0.05 * v, 0.01);
    },
  },
  clang: { wet: 0.18, play: (V, v) => { noise(V, 0.03, 0.3 * v, { type: 'highpass', f: 2500 }); metal(V, 980, 0.32, 0.06 * v); thump(V, 140, 80, 0.06, 0.15 * v); } },
  arrow: { vary: 0.1, play: (V, v) => { tone(V, 620, 0.06, 'triangle', 0.09 * v, { to: 330 }); noise(V, 0.11, 0.07 * v, { type: 'highpass', f: 4500, attack: 0.02 }); } },
  thunk: { wet: 0.06, play: (V, v) => { thump(V, 190, 90, 0.1, 0.22 * v); noise(V, 0.06, 0.3 * v, { f: 900, q: 1.2 }); } },
  stab: { wet: 0.08, play: (V, v) => { noise(V, 0.08, 0.28 * v, { f: 2400, f2: 1200, q: 1.5 }); thump(V, 200, 80, 0.08, 0.2 * v); tone(V, 440, 0.06, 'square', 0.03 * v, { to: 200 }); } },
  boom: {
    wet: 0.25,
    play: (V, v) => {
      noise(V, 0.45, 0.55 * v, { type: 'lowpass', f: 1400, f2: 120, drive: 2.5 });
      thump(V, 120, 34, 0.4, 0.5 * v);
      for (let i = 0; i < 4; i++) noise(V, 0.04, 0.12 * v, { f: 600 + Math.random() * 1400, q: 2, delay: 0.08 + Math.random() * 0.3 });
    },
  },
  cannon: {
    wet: 0.35,
    play: (V, v) => {
      noise(V, 0.05, 0.6 * v, { type: 'highpass', f: 1800 });
      noise(V, 0.5, 0.7 * v, { type: 'lowpass', f: 2600, f2: 160, drive: 3 });
      thump(V, 95, 30, 0.5, 0.6 * v);
      noise(V, 0.9, 0.12 * v, { type: 'lowpass', f: 300, brown: true, delay: 0.05, attack: 0.05 });
    },
  },
  explode: {
    wet: 0.35,
    play: (V, v) => {
      noise(V, 0.04, 0.55 * v, { type: 'highpass', f: 2200 });
      noise(V, 0.7, 0.8 * v, { type: 'lowpass', f: 2200, f2: 140, drive: 3.5 });
      thump(V, 100, 28, 0.6, 0.65 * v);
      noise(V, 1.3, 0.3 * v, { type: 'lowpass', f: 220, brown: true, attack: 0.06, delay: 0.04 });
      for (let i = 0; i < 6; i++) noise(V, 0.03, 0.12 * v, { f: 800 + Math.random() * 2600, q: 3, delay: 0.12 + Math.random() * 0.6 });
    },
  },
  bigexplode: {
    wet: 0.5, vary: 0.04,
    play: (V, v) => {
      noise(V, 0.06, 0.7 * v, { type: 'highpass', f: 1800 });
      noise(V, 1.1, 0.9 * v, { type: 'lowpass', f: 2600, f2: 90, drive: 4 });
      thump(V, 80, 22, 1.0, 0.8 * v);
      thump(V, 140, 40, 0.3, 0.4 * v, 0.02);
      noise(V, 2.2, 0.45 * v, { type: 'lowpass', f: 180, brown: true, attack: 0.1, delay: 0.05 });
      for (let i = 0; i < 10; i++) noise(V, 0.04, 0.12 * v, { f: 600 + Math.random() * 3000, q: 3, delay: 0.15 + Math.random() * 1.1 });
    },
  },
  slam: {
    wet: 0.4,
    play: (V, v) => {
      noise(V, 0.6, 0.8 * v, { type: 'lowpass', f: 900, f2: 90, drive: 3 });
      thump(V, 70, 25, 0.7, 0.75 * v);
      noise(V, 1.2, 0.35 * v, { type: 'lowpass', f: 160, brown: true, attack: 0.05 });
      for (let i = 0; i < 6; i++) noise(V, 0.05, 0.14 * v, { f: 300 + Math.random() * 1200, q: 2, delay: 0.1 + Math.random() * 0.5 });
    },
  },
  crumble: {
    wet: 0.3,
    play: (V, v) => {
      noise(V, 0.9, 0.35 * v, { type: 'lowpass', f: 600, f2: 150, brown: true, attack: 0.03 });
      thump(V, 90, 35, 0.4, 0.35 * v);
      for (let i = 0; i < 10; i++) noise(V, 0.05 + Math.random() * 0.05, 0.2 * v, { f: 300 + Math.random() * 1500, q: 2.5, delay: Math.random() * 0.8 });
    },
  },
  die: { wet: 0.05, vary: 0.12, play: (V, v) => { tone(V, 620, 0.13, 'sine', 0.1 * v, { to: 150 }); noise(V, 0.16, 0.16 * v, { f: 1400, f2: 400, q: 0.9, delay: 0.04 }); } },
  hurt: { play: (V, v) => { tone(V, 230, 0.14, 'sawtooth', 0.12 * v, { to: 140, lp: 900 }); thump(V, 150, 60, 0.1, 0.25 * v); noise(V, 0.06, 0.18 * v, { type: 'lowpass', f: 800 }); } },
  horn: {
    wet: 0.45, vary: 0,
    play: (V, v) => {
      for (const [f, g] of [[110, 0.14], [110.7, 0.12], [164.8, 0.09], [220, 0.05]] as [number, number][]) tone(V, f, 1.5, 'sawtooth', g * v, { attack: 0.25, lp: 750, vib: 1.5, vibRate: 5 });
      tone(V, 220, 0.6, 'sawtooth', 0.05 * v, { attack: 0.15, lp: 900, delay: 0.9 });
      thump(V, 80, 40, 0.5, 0.45 * v);
      noise(V, 0.4, 0.2 * v, { type: 'lowpass', f: 400 });
    },
  },
  win: { wet: 0.35, vary: 0, play: (V, v) => [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(V, f, 0.45, 'triangle', 0.17 * v, { delay: i * 0.13 }); tone(V, f * 2, 0.3, 'sine', 0.04 * v, { delay: i * 0.13 }); }) },
  lose: { wet: 0.45, vary: 0, play: (V, v) => [392, 330, 262, 196].forEach((f, i) => tone(V, f, 0.6, 'sawtooth', 0.1 * v, { delay: i * 0.24, lp: 1100, vib: 3 })) },
  click: { vary: 0, play: (V, v) => tone(V, 720, 0.05, 'sine', 0.12 * v) },
  deny: { vary: 0, play: (V, v) => { tone(V, 180, 0.15, 'square', 0.06 * v, { to: 140, lp: 1200 }); } },
  zap: {
    wet: 0.15,
    play: (V, v) => {
      tone(V, 1900, 0.11, 'sawtooth', 0.05 * v, { to: 260, lp: 4000 });
      noise(V, 0.1, 0.22 * v, { f: 5200, q: 3 });
      for (let i = 0; i < 3; i++) noise(V, 0.02, 0.15 * v, { type: 'highpass', f: 3000, delay: 0.03 + i * 0.03 });
    },
  },
  freeze: {
    wet: 0.35,
    play: (V, v) => {
      for (let i = 0; i < 5; i++) tone(V, 2400 + Math.random() * 2400, 0.18, 'sine', 0.04 * v, { delay: i * 0.035 });
      noise(V, 0.35, 0.12 * v, { type: 'highpass', f: 5000, attack: 0.08 });
      tone(V, 1200, 0.3, 'sine', 0.05 * v, { to: 2200 });
    },
  },
  fire: { wet: 0.15, play: (V, v) => { noise(V, 0.4, 0.4 * v, { type: 'lowpass', f: 250, f2: 2200, attack: 0.06 }); thump(V, 90, 140, 0.3, 0.12 * v); noise(V, 0.25, 0.08 * v, { type: 'highpass', f: 3000, delay: 0.1 }); } },
  levelup: { wet: 0.35, vary: 0, play: (V, v) => [659, 784, 988, 1319, 1568].forEach((f, i) => { tone(V, f, 0.3, 'triangle', 0.15 * v, { delay: i * 0.07 }); tone(V, f * 2, 0.2, 'sine', 0.035 * v, { delay: i * 0.07 }); }) },
  whoosh: { wet: 0.1, play: (V, v) => { noise(V, 0.32, 0.3 * v, { f: 400, f2: 2600, q: 1.3, attack: 0.08 }); noise(V, 0.25, 0.14 * v, { f: 2600, f2: 700, q: 1.2, delay: 0.1 }); } },
  roar: {
    wet: 0.4, vary: 0.08,
    play: (V, v) => {
      tone(V, 105, 1.1, 'sawtooth', 0.22 * v, { to: 72, attack: 0.12, vib: 9, vibRate: 7, lp: 900, q: 4 });
      tone(V, 78, 1.1, 'sawtooth', 0.16 * v, { to: 55, attack: 0.15, vib: 6, vibRate: 5.5, lp: 600, q: 3 });
      noise(V, 1.0, 0.3 * v, { f: 520, f2: 300, q: 2.5, attack: 0.1, drive: 2 });
      noise(V, 0.9, 0.2 * v, { type: 'lowpass', f: 300, brown: true, attack: 0.12 });
    },
  },
  chest: { wet: 0.3, vary: 0, play: (V, v) => { tone(V, 392, 0.1, 'triangle', 0.15 * v); [784, 988, 1175, 1568].forEach((f, i) => tone(V, f, 0.25, 'sine', 0.12 * v, { delay: 0.1 + i * 0.06 })); } },
  bell: { wet: 0.5, vary: 0, play: (V, v) => { metal(V, 880, 1.2, 0.07 * v); metal(V, 880, 1.0, 0.05 * v, 0.4); } },
  alarm: {
    wet: 0.5, vary: 0,
    play: (V, v) => {
      for (let i = 0; i < 4; i++) {
        metal(V, i % 2 ? 740 : 820, 0.55, 0.075 * v, i * 0.28);
        noise(V, 0.02, 0.2 * v, { type: 'highpass', f: 3000, delay: i * 0.28 });
      }
    },
  },
  heal: { wet: 0.35, vary: 0, play: (V, v) => [523, 784, 1046, 1568].forEach((f, i) => tone(V, f, 0.4, 'sine', 0.09 * v, { to: f * 1.03, delay: i * 0.05 })) },
  magic: { wet: 0.25, play: (V, v) => { tone(V, 900, 0.28, 'sine', 0.07 * v, { to: 450, vib: 30, vibRate: 18 }); tone(V, 1350, 0.22, 'triangle', 0.035 * v, { to: 700 }); noise(V, 0.15, 0.05 * v, { type: 'highpass', f: 5000 }); } },
  relic: { wet: 0.5, vary: 0, play: (V, v) => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { tone(V, f, 0.5, 'sine', 0.12 * v, { delay: i * 0.07 }); tone(V, f * 1.5, 0.3, 'sine', 0.03 * v, { delay: i * 0.07 }); }) },
  warcry: {
    wet: 0.35,
    play: (V, v) => {
      tone(V, 146, 0.8, 'sawtooth', 0.15 * v, { to: 175, attack: 0.08, lp: 1100, vib: 5 });
      tone(V, 220, 0.8, 'sawtooth', 0.1 * v, { to: 262, attack: 0.08, lp: 1300, vib: 5 });
      noise(V, 0.6, 0.12 * v, { f: 900, q: 1.5, attack: 0.1 });
      thump(V, 90, 45, 0.4, 0.4 * v);
    },
  },
  act: {
    wet: 0.5, vary: 0,
    play: (V, v) => {
      tone(V, 98, 1.8, 'sawtooth', 0.13 * v, { attack: 0.3, lp: 700 });
      tone(V, 147, 1.8, 'sawtooth', 0.1 * v, { attack: 0.3, lp: 800 });
      tone(V, 196, 1.3, 'triangle', 0.1 * v, { delay: 0.6, attack: 0.1 });
      tone(V, 294, 1.1, 'triangle', 0.08 * v, { delay: 1.0, attack: 0.1 });
      thump(V, 70, 35, 0.6, 0.5 * v);
      thump(V, 70, 35, 0.6, 0.45 * v, 0.6);
    },
  },
  shatter: {
    wet: 0.4,
    play: (V, v) => {
      noise(V, 0.3, 0.35 * v, { type: 'highpass', f: 3500 });
      thump(V, 160, 50, 0.2, 0.35 * v);
      for (let i = 0; i < 9; i++) tone(V, 2200 + Math.random() * 4200, 0.12 + Math.random() * 0.2, 'sine', 0.05 * v, { delay: Math.random() * 0.25, exact: true });
    },
  },
  ward: { wet: 0.2, vary: 0.1, play: (V, v) => { tone(V, 3200, 0.1, 'sine', 0.06 * v, { to: 2500 }); tone(V, 4700, 0.06, 'sine', 0.03 * v); } },
  rumble: {
    wet: 0.3,
    play: (V, v) => {
      noise(V, 2.4, 0.6 * v, { type: 'lowpass', f: 90, f2: 160, brown: true, attack: 1.2 });
      for (let i = 0; i < 6; i++) thump(V, 60, 32, 0.25, 0.22 * v, 0.6 + i * 0.3 + Math.random() * 0.1);
      for (let i = 0; i < 6; i++) noise(V, 0.05, 0.1 * v, { f: 300 + Math.random() * 700, q: 2, delay: 0.8 + Math.random() * 1.5 });
    },
  },
  burrow: {
    wet: 0.35,
    play: (V, v) => {
      noise(V, 0.6, 0.7 * v, { type: 'lowpass', f: 1200, f2: 120, drive: 2.5 });
      thump(V, 90, 30, 0.5, 0.6 * v);
      for (let i = 0; i < 8; i++) noise(V, 0.05, 0.16 * v, { f: 300 + Math.random() * 1400, q: 2, delay: 0.1 + Math.random() * 0.6 });
    },
  },
  stomp: { wet: 0.2, vary: 0.05, play: (V, v) => { thump(V, 75, 32, 0.28, 0.45 * v); noise(V, 0.2, 0.2 * v, { type: 'lowpass', f: 260, brown: true }); } },
  heartbeat: { vary: 0, play: (V, v) => { thump(V, 62, 40, 0.13, 0.5 * v); thump(V, 58, 38, 0.13, 0.38 * v, 0.19); } },
  steal: {
    wet: 0.15, vary: 0.03,
    play: (V, v) => {
      [2093, 1568, 1319].forEach((f, i) => tone(V, f, 0.1, 'sine', 0.07 * v, { delay: i * 0.05 }));
      tone(V, 820, 0.07, 'square', 0.04 * v, { to: 640, lp: 2500, delay: 0.2 });
      tone(V, 860, 0.07, 'square', 0.04 * v, { to: 660, lp: 2500, delay: 0.3 });
    },
  },
  warn: { wet: 0.2, play: (V, v) => { tone(V, 320, 0.5, 'sawtooth', 0.05 * v, { to: 760, lp: 1600, vib: 14, vibRate: 11 }); } },
  launch: { vary: 0.15, play: (V, v) => tone(V, 320, 0.22, 'sine', 0.09 * v, { to: 1150 }) },
  grapple: { wet: 0.1, play: (V, v) => { noise(V, 0.2, 0.1 * v, { f: 2000, f2: 900, q: 1.4, attack: 0.05 }); metal(V, 1500, 0.12, 0.03 * v, 0.16); } },
  /** The enemy camp's big war drum. */
  wardrum: {
    wet: 0.35, vary: 0.03,
    play: (V, v) => {
      thump(V, 96, 40, 0.5, 0.62 * v);
      noise(V, 0.3, 0.26 * v, { type: 'lowpass', f: 320, brown: true });
      noise(V, 0.05, 0.12 * v, { f: 900, q: 1.2 });
    },
  },
  /** A rallying horn call: the garrison follows the hero out. */
  rally: {
    wet: 0.4, vary: 0,
    play: (V, v) => {
      for (const [f, d, del] of [[196, 0.2, 0], [196, 0.16, 0.22], [294, 0.75, 0.42]] as [number, number, number][]) {
        tone(V, f, d, 'sawtooth', 0.09 * v, { attack: 0.03, lp: 1400, delay: del, vib: 1.5, vibRate: 5 });
        tone(V, f * 2, d, 'sawtooth', 0.03 * v, { attack: 0.03, lp: 2200, delay: del });
      }
      thump(V, 90, 50, 0.2, 0.2 * v);
    },
  },
};

// ───────────────────────────── War drums ─────────────────────────────

/** Procedural battle drums: intensity 0 = silence, 1 = all-out. */
const music = {
  level: 0,
  target: 0,
  next: 0,
  step: 0,
  drone: null as { gain: GainNode; oscs: OscillatorNode[] } | null,
};

function startDrone(c: AudioContext): void {
  if (music.drone || !musicBus) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 240;
  lp.Q.value = 1.2;
  lp.connect(gain);
  gain.connect(musicBus);
  const oscs: OscillatorNode[] = [];
  for (const f of [55, 55.35, 82.4, 41.2]) {
    const o = c.createOscillator();
    o.type = f < 50 ? 'sine' : 'sawtooth';
    o.frequency.value = f;
    o.connect(lp);
    o.start();
    oscs.push(o);
  }
  music.drone = { gain, oscs };
}

function drum(c: AudioContext, t: number, kind: 'taiko' | 'tom' | 'low' | 'click', vol: number): void {
  if (!musicBus) return;
  const V: Voice = { c, t, out: musicBus, p: 1 + (Math.random() - 0.5) * 0.03, end: 0 };
  if (kind === 'taiko') {
    tone(V, 82, 0.45, 'sine', 0.55 * vol, { to: 44, attack: 0.004 });
    noise(V, 0.09, 0.28 * vol, { type: 'lowpass', f: 700, f2: 200 });
  } else if (kind === 'low') {
    tone(V, 58, 0.6, 'sine', 0.6 * vol, { to: 34, attack: 0.004 });
    noise(V, 0.12, 0.2 * vol, { type: 'lowpass', f: 300 });
  } else if (kind === 'tom') {
    tone(V, 150, 0.22, 'sine', 0.3 * vol, { to: 95, attack: 0.003 });
    noise(V, 0.05, 0.14 * vol, { f: 900, q: 1.2 });
  } else {
    noise(V, 0.03, 0.12 * vol, { type: 'highpass', f: 3500 });
  }
}

/** Low pulsing string line for the tensest moments (A minor). */
const OSTINATO = [55, 55, 65.4, 55, 82.4, 55, 73.4, 65.4];

function scheduleStep(c: AudioContext, s: number, t: number): void {
  const L = music.level;
  if (L < 0.04) return;
  const i = s % 16;
  const bar = Math.floor(s / 16);
  const v = Math.min(1, 0.45 + L * 0.7);
  if (i === 0 || i === 8) drum(c, t, i === 0 && L > 0.5 ? 'low' : 'taiko', v);
  if (L > 0.28 && (i === 6 || i === 11 || i === 14)) drum(c, t, 'tom', v * 0.8);
  if (L > 0.5 && (i === 3 || i === 10)) drum(c, t, 'taiko', v * 0.75);
  if (L > 0.55 && i % 2 === 0) drum(c, t, 'click', v * 0.5);
  if (L > 0.72 && bar % 2 === 1 && i >= 12) drum(c, t, 'tom', v * (0.5 + (i - 12) * 0.15));
  if (L > 0.6 && i % 2 === 0 && musicBus) {
    const V: Voice = { c, t, out: musicBus, p: 1, end: 0 };
    tone(V, OSTINATO[(i / 2) % 8] * 2, 0.22, 'sawtooth', 0.05 * (L - 0.45), { lp: 520, q: 2, attack: 0.01 });
  }
}

function updateMusic(dt: number, intensity: number, active: boolean): void {
  const c = ctx;
  if (!c || c.state !== 'running') return;
  music.target = active ? intensity : 0;
  const k = music.target > music.level ? 0.6 : 0.25;
  music.level += (music.target - music.level) * Math.min(1, dt * k);
  if (music.level > 0.02) startDrone(c);
  if (music.drone) music.drone.gain.gain.setTargetAtTime(active ? Math.max(0, music.level - 0.08) * 0.09 : 0, c.currentTime, 0.4);
  if (!active) return;
  const bpm = 88 + music.level * 26;
  const sixteenth = 60 / bpm / 4;
  if (music.next < c.currentTime) music.next = c.currentTime + 0.05;
  while (music.next < c.currentTime + 0.18) {
    scheduleStep(c, music.step, music.next);
    music.next += sixteenth;
    music.step++;
  }
}

// ───────────────────────────── API ─────────────────────────────

function play(name: SfxName, vol: number, o: VoiceOpts): void {
  if (muted) return;
  // Only make sounds once a user gesture has started the audio context.
  // Scheduling nodes on a suspended context just piles them up (and stalls the game).
  if (!ctx || ctx.state !== 'running') return;
  const now = performance.now();
  const gap = minGap[name] ?? 0;
  const last = lastPlayed[name] ?? -1e9;
  if (now - last < gap) return;
  const ct = ctx.currentTime;
  if (voiceEnds.length > MAX_VOICES) voiceEnds = voiceEnds.filter((e) => e > ct);
  if (voiceEnds.length > MAX_VOICES && !PRIORITY.has(name)) return;
  lastPlayed[name] = now;
  try {
    const d = defs[name];
    const V = voice(ctx, { ...o, wet: (d.wet ?? 0) + (o.wet ?? 0), vary: d.vary ?? o.vary });
    d.play(V, vol);
    voiceEnds.push(V.end);
  } catch (e) {
    // Audio glitches must never break the game.
    if (import.meta.env.DEV) console.warn('sfx', name, e);
  }
}

export const Sfx = {
  /** Position of the listener (the hero), used by `at`. */
  listener: { x: 0, z: 0 },
  play(name: SfxName, vol = 1): void {
    play(name, vol, {});
  },
  /** Positional: louder close by, panned left/right, muffled and wetter far away. */
  at(name: SfxName, x: number, z: number, vol = 1): void {
    const dx = x - this.listener.x;
    const d = Math.hypot(dx, z - this.listener.z);
    const v = d < 10 ? 1 : Math.max(0, 1 - (d - 10) / 34);
    if (v * vol < 0.05) return;
    play(name, v * vol, {
      pan: Math.max(-0.8, Math.min(0.8, dx / 20)),
      muffle: d > 16 ? Math.max(700, 6000 - (d - 16) * 160) : 0,
      wet: d > 14 ? Math.min(0.3, (d - 14) * 0.012) : 0,
    });
  },
  /** Called every frame: drives the war drums. */
  update(dt: number, intensity: number, active: boolean): void {
    if (muted || !musicOn) return;
    updateMusic(dt, intensity, active);
  },
  unlock(): void {
    ensure();
  },
  /** Silence everything while the page or app is in the background. */
  setActive(on: boolean): void {
    if (!ctx) return;
    if (on && ctx.state === 'suspended') void ctx.resume();
    else if (!on && ctx.state === 'running') void ctx.suspend();
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
    if (master) master.gain.value = m ? 0 : MASTER_VOL;
  },
  musicOn(): boolean {
    return musicOn;
  },
  setMusic(on: boolean): void {
    musicOn = on;
    try {
      localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (musicBus && ctx) musicBus.gain.setTargetAtTime(on ? MUSIC_VOL : 0, ctx.currentTime, 0.1);
    if (!on && music.drone && ctx) music.drone.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
  },
};
