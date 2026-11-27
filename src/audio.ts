/** Synthesized sound effects (no audio files). */
export type SfxName =
  | 'chop' | 'mine' | 'pickup' | 'drop' | 'coin' | 'pay' | 'build' | 'unlock' | 'swing' | 'hit'
  | 'arrow' | 'boom' | 'die' | 'hurt' | 'horn' | 'win' | 'lose' | 'click' | 'deny' | 'crumble';

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
};

export const Sfx = {
  /** Position of the listener (the hero), used by `at`. */
  listener: { x: 0, z: 0 },
  play(name: SfxName, vol = 1): void {
    if (muted) return;
    if (!ensure()) return;
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
