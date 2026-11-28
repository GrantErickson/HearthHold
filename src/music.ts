/**
 * The score: adaptive music, synthesized like the sound effects (no audio files).
 *
 * - Menu: the HearthHold theme on flute and harp.
 * - Build phase: a village tune (lute, flute, frame drum). In the last seconds
 *   of the countdown, timpani, a snare roll and a cymbal swell lead into the horn.
 * - Waves: battle music in the minor. Its layers follow the danger on the field:
 *   drums and bass first, then a string ostinato, brass, choir and tremolo
 *   strings as enemies close in and the keep takes damage. When the hero leads
 *   a sally, the brass takes up the battle theme over a snare march.
 * - Bosses get their own theme (Phrygian, choir, heavier drums).
 * - A fanfare when a wave is cleared, hits when a boss or a camp falls, a lament
 *   on defeat and a march for the final victory.
 * - Each act plays in its own key. Pausing or losing the hero muffles the music.
 *
 * Notes are scheduled a little ahead on the audio clock (`Score.update`), so the
 * music keeps time when frames drop. The same Score renders offline for tests
 * (`renderScore`).
 */
import { musicHost, makeNoise, makeImpulse } from './audio';
import { on } from './events';

export type Scene = 'title' | 'build' | 'battle' | 'defeat' | 'victory' | 'silent';

/** What the game tells the music every frame. */
export interface MusicState {
  scene: Scene;
  /** 0–1, from threats.ts. */
  danger: number;
  boss: boolean;
  sally: boolean;
  heroDown: boolean;
  paused: boolean;
  /** Real seconds until the next wave (Infinity while the timer isn't running). */
  countdown: number;
  act: number;
}

const IDLE: MusicState = { scene: 'silent', danger: 0, boss: false, sally: false, heroDown: false, paused: false, countdown: Infinity, act: 1 };

type Sec = 'title' | 'build' | 'battle' | 'boss' | 'clear' | 'defeat' | 'victory' | 'silent';
type Mode = 'major' | 'minor' | 'phrygian';
const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

// ───────────────────────────── Harmony ─────────────────────────────

type Q = 'M' | 'm' | '7';
/** A chord: root in semitones above the key note, and its quality. */
interface Chord {
  r: number;
  q: Q;
}
const QUAL: Record<Q, number[]> = { M: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10] };
const ch = (r: number, q: Q = 'M'): Chord => ({ r, q });
const K = {
  I: ch(0), iii: ch(4, 'm'), IV: ch(5), V: ch(7), V7: ch(7, '7'), vi: ch(9, 'm'),
  i: ch(0, 'm'), bII: ch(1), III: ch(3), iv: ch(5, 'm'), VI: ch(8), VII: ch(10),
};
/** One or two chords per bar (two = half a bar each). */
type Prog = Chord[][];
const P_A: Prog = [[K.I], [K.vi], [K.IV], [K.V]];
const P_B: Prog = [[K.I], [K.iii], [K.IV, K.V7], [K.I]];
const P_C: Prog = [[K.vi], [K.IV], [K.I], [K.V]];
const P_BATTLE: Prog = [[K.i], [K.VI], [K.III], [K.VII], [K.i], [K.iv], [K.VI], [K.V]];
const P_BOSS: Prog = [[K.i], [K.bII], [K.VII], [K.i], [K.i], [K.bII], [K.iv], [K.V]];
const P_LAMENT: Prog = [[K.i], [K.VI], [K.iv], [K.V]];

// ───────────────────────────── Tunes ─────────────────────────────

/** Melody note: scale degree (0 = key note, 7 = an octave up), start and length in 16ths, optional sharp. */
type N = [deg: number, at: number, len: number, acc?: number];

/** The HearthHold theme: a question (A), its answer (B) and a lift (C), four bars each. */
const THEME_A: N[] = [
  [0, 0, 6], [4, 6, 2], [4, 8, 4], [5, 12, 2], [4, 14, 2],
  [2, 16, 8], [1, 24, 4], [0, 28, 4],
  [3, 32, 6], [4, 38, 2], [5, 40, 4], [7, 44, 4],
  [6, 48, 12], [4, 60, 4],
];
const THEME_B: N[] = [
  [0, 0, 6], [4, 6, 2], [4, 8, 4], [5, 12, 2], [4, 14, 2],
  [2, 16, 8], [3, 24, 4], [4, 28, 4],
  [5, 32, 4], [4, 36, 4], [3, 40, 4], [1, 44, 4],
  [0, 48, 16],
];
const THEME_C: N[] = [
  [5, 0, 6], [6, 6, 2], [7, 8, 4], [5, 12, 4],
  [3, 16, 6], [4, 22, 2], [5, 24, 8],
  [4, 32, 6], [2, 38, 2], [4, 40, 4], [7, 44, 4],
  [8, 48, 8], [6, 56, 4], [4, 60, 4],
];
/** The theme in the minor, for battle (eight bars over P_BATTLE). */
const BATTLE: N[] = [
  [0, 0, 6], [4, 6, 2], [4, 8, 4], [5, 12, 2], [4, 14, 2],
  [2, 16, 8], [3, 24, 4], [5, 28, 4],
  [4, 32, 6], [2, 38, 2], [4, 40, 4], [6, 44, 4],
  [6, 48, 8], [4, 56, 4], [1, 60, 4],
  [0, 64, 6], [4, 70, 2], [4, 72, 4], [5, 76, 2], [4, 78, 2],
  [5, 80, 8], [3, 88, 4], [4, 92, 4],
  [5, 96, 4], [7, 100, 4], [9, 104, 4], [7, 108, 4],
  [6, 112, 8, 1], [4, 120, 8],
];
/** The boss: a low, circling figure around the flat second. */
const BOSS: N[] = [
  [0, 0, 4], [0, 4, 4], [1, 8, 4], [0, 12, 4],
  [1, 16, 12], [-1, 28, 4],
  [-1, 32, 8], [-4, 40, 8],
  [0, 48, 16],
  [0, 64, 4], [0, 68, 4], [1, 72, 4], [0, 76, 4],
  [1, 80, 8], [3, 88, 8],
  [5, 96, 8], [3, 104, 8],
  [4, 112, 8], [6, 120, 8, 1],
];
/** Theme A in the minor, slow, for the fallen keep. */
const LAMENT: N[] = THEME_A.map((n): N => (n[0] === 6 ? [6, n[1], n[2], 1] : n));
const FANFARE: N[] = [[0, 0, 2], [0, 2, 1], [0, 3, 1], [4, 4, 4], [7, 8, 8]];

/** Key note per act (MIDI): D, E, F, B, C. The menu is in D, the final victory in C. */
const ACT_KEY = [62, 64, 65, 59, 60];
const TITLE_KEY = 62;
const VICTORY_KEY = 60;

/** Lute picking order over a four-note chord. */
const ARP = [0, 2, 1, 2, 3, 2, 1, 2];
/** String ostinato over five chord tones, one per 16th. */
const OST = [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 1, 4, 3, 2, 1];
/** Battle bass by 8th note: root, octave and fifth. */
const BASS8 = [0, 0, 12, 0, 0, 0, 12, 7];

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** `n` chord tones going up from `lo`. */
function tones(key: number, c: Chord, lo: number, n: number): number[] {
  const pcs = QUAL[c.q].map((x) => mod(key + c.r + x, 12));
  const out: number[] = [];
  for (let m = lo; out.length < n && m < lo + 48; m++) if (pcs.includes(mod(m, 12))) out.push(m);
  return out;
}

/** A voicing of `c` inside lo–hi that moves as little as possible from `prev`. */
function voiceLead(prev: number[], key: number, c: Chord, lo: number, hi: number, n: number): number[] {
  let best: number[] = [];
  let bestCost = Infinity;
  for (let start = lo; start < lo + 12; start++) {
    const v = tones(key, c, start, n);
    if (v[0] !== start || v[v.length - 1] > hi) continue;
    const cost = prev.length ? v.reduce((a, m, j) => a + Math.abs(m - (prev[j] ?? m)), 0) : Math.abs(start - lo - 4);
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return best.length ? best : tones(key, c, lo, n);
}

// ───────────────────────────── Plucked strings ─────────────────────────────

interface PluckSample {
  m: number;
  /** The sample's real pitch. */
  f: number;
  buf: AudioBuffer;
}

/** Karplus–Strong: a burst of soft noise through a decaying delay line tuned to the note. */
function pluckSample(ctx: BaseAudioContext, m: number): PluckSample {
  const sr = ctx.sampleRate;
  const N = Math.max(2, Math.round(sr / mtof(m) - 0.5));
  const f = sr / (N + 0.5);
  const t60 = Math.min(3, Math.max(0.6, 1.8 * Math.pow(262 / f, 0.4)));
  const len = Math.floor(sr * Math.min(2.6, t60 + 0.3));
  const damp = Math.pow(0.001, 1 / (f * t60));
  const d = new Float32Array(len);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    lp += (Math.random() * 2 - 1 - lp) * 0.55;
    d[i] = lp;
    mean += lp;
  }
  mean /= N;
  for (let i = 0; i < N; i++) d[i] -= mean;
  // Pluck a fifth of the way along the string.
  const pick = Math.max(1, Math.round(N * 0.2));
  for (let i = N - 1; i >= pick; i--) d[i] -= d[i - pick] * 0.6;
  d[N] = damp * d[0];
  for (let n = N + 1; n < len; n++) d[n] = damp * 0.5 * (d[n - N] + d[n - N - 1]);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const fade = Math.floor(sr * 0.03);
  for (let i = 0; i < len; i++) d[i] *= (0.9 / (peak || 1)) * Math.min(1, (len - i) / fade);
  const buf = ctx.createBuffer(1, len, sr);
  buf.getChannelData(0).set(d);
  return { m, f, buf };
}

// ───────────────────────────── The score ─────────────────────────────

const LOOKAHEAD = 0.3;
const LAYERS = ['pad', 'pluck', 'flute', 'bassS', 'bassH', 'str', 'brass', 'lead', 'choir', 'bell', 'drums', 'folk', 'trem'] as const;
type LayerName = (typeof LAYERS)[number];
/** Mix level, reverb send, echo send. */
const MIX: Record<LayerName, [number, number, number]> = {
  pad: [0.36, 0.35, 0],
  pluck: [0.8, 0.3, 0.12],
  flute: [0.62, 0.4, 0.2],
  bassS: [0.55, 0.05, 0],
  bassH: [0.5, 0.05, 0],
  str: [0.55, 0.25, 0],
  brass: [0.5, 0.3, 0],
  lead: [1, 0.35, 0.1],
  choir: [0.36, 0.5, 0],
  bell: [0.32, 0.5, 0.25],
  drums: [0.85, 0.3, 0],
  folk: [0.7, 0.2, 0],
  trem: [0.45, 0.35, 0],
};

interface Layer {
  bus: GainNode;
  level: number;
  /** Gain last sent to the bus. */
  set: number;
}
type Drum = 'taiko' | 'low' | 'tom' | 'click' | 'snare' | 'crash' | 'timp' | 'frame' | 'shaker';
type Accent = 'boss' | 'camp';

export class Score {
  readonly ctx: BaseAudioContext;
  sec: Sec = 'silent';
  /** Only these layers are heard (offline tests). */
  solo: LayerName[] | null = null;
  private mix: GainNode;
  private lpf: BiquadFilterNode;
  private echo: GainNode;
  private L = {} as Record<LayerName, Layer>;
  private white: AudioBuffer;
  private plucks: PluckSample[] = [];
  private pend: { sec: Sec; beat: boolean } | null = null;
  private step = 0;
  private nextT = 0;
  private bpm = 96;
  /** Seconds per 16th. */
  private sd = 60 / 96 / 4;
  private key = TITLE_KEY;
  private st: MusicState = IDLE;
  private dangerS = 0;
  private prevPad: number[] = [];
  private prevChoir: number[] = [];
  private leadOn = false;
  private swell = false;
  private accent: Accent | null = null;
  private clearNext = false;
  private muf = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode, verb: AudioNode | null) {
    this.ctx = ctx;
    this.white = makeNoise(ctx, 'white');
    this.mix = ctx.createGain();
    this.lpf = ctx.createBiquadFilter();
    this.lpf.type = 'lowpass';
    this.lpf.frequency.value = 18000;
    this.mix.connect(this.lpf);
    this.lpf.connect(out);
    // A soft echo for the flute and bells.
    this.echo = ctx.createGain();
    const dl = ctx.createDelay(1);
    dl.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.echo.connect(dl);
    dl.connect(dlp);
    dlp.connect(fb);
    fb.connect(dl);
    dlp.connect(this.mix);
    const lp = (f: number, q = 0.7): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = 'lowpass';
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const chains: Partial<Record<LayerName, [AudioNode, AudioNode]>> = {};
    for (const [n, f, q] of [['pad', 1700, 0.5], ['pluck', 4200, 0.7], ['bassS', 900, 0.7], ['bassH', 520, 2.5], ['str', 2400, 0.7], ['trem', 3800, 0.7]] as const) {
      const b = lp(f, q);
      chains[n] = [b, b];
    }
    chains.choir = this.formants();
    for (const n of LAYERS) {
      const bus = ctx.createGain();
      bus.gain.value = 0;
      let node: AudioNode = bus;
      const chain = chains[n];
      if (chain) {
        bus.connect(chain[0]);
        node = chain[1];
      }
      node.connect(this.mix);
      const [, wet, echo] = MIX[n];
      if (verb && wet) {
        const s = ctx.createGain();
        s.gain.value = wet;
        node.connect(s);
        s.connect(verb);
      }
      if (echo) {
        const s = ctx.createGain();
        s.gain.value = echo;
        node.connect(s);
        s.connect(this.echo);
      }
      this.L[n] = { bus, level: 0, set: 0 };
    }
    for (let m = 45; m <= 93; m += 6) this.plucks.push(pluckSample(ctx, m));
  }

  /** Vowel "ah": three formant band-passes plus a little body. */
  private formants(): [AudioNode, AudioNode] {
    const c = this.ctx;
    const input = c.createGain();
    const output = c.createGain();
    for (const [f, q, g] of [[700, 4, 3], [1150, 5, 1.8], [2700, 7, 1]] as const) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gn = c.createGain();
      gn.gain.value = g;
      input.connect(bp);
      bp.connect(gn);
      gn.connect(output);
    }
    const body = c.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 500;
    const bg = c.createGain();
    bg.gain.value = 0.35;
    input.connect(body);
    body.connect(bg);
    bg.connect(output);
    return [input, output];
  }

  /** For the debug console: section, tempo, key, bar. */
  info(): string {
    return `${this.sec} ${this.bpm}bpm key ${this.key} bar ${Math.floor(this.step / 16)} danger ${this.dangerS.toFixed(2)}`;
  }

  /** Something happened that the music should mark. */
  cue(kind: 'clear' | Accent): void {
    if (kind === 'clear') this.clearNext = true;
    else this.accent = kind;
  }

  private want(): Sec {
    const s = this.st.scene;
    if (s === 'battle') return this.st.boss ? 'boss' : 'battle';
    return s;
  }

  update(dt: number, st: MusicState, now: number): void {
    this.st = st;
    this.dangerS += (st.danger - this.dangerS) * Math.min(1, dt * (st.danger > this.dangerS ? 0.8 : 0.35));

    // What should be playing. Fights start on the next beat; calmer changes wait for the bar.
    if (this.clearNext) {
      this.clearNext = false;
      if (this.sec === 'battle' || this.sec === 'boss') this.pend = { sec: 'clear', beat: true };
    }
    if (this.sec !== 'clear' && this.pend?.sec !== 'clear') {
      const w = this.want();
      if (w === this.sec) this.pend = null;
      else if (this.pend?.sec !== w) {
        const beat = this.sec === 'silent' || this.sec === 'title' || w === 'battle' || w === 'defeat' || w === 'victory' || (w === 'boss' && this.sec !== 'battle');
        this.pend = { sec: w, beat };
      }
    }

    // Layers fade in fast and out slowly.
    const T = this.targets();
    for (const n of LAYERS) {
      const l = this.L[n];
      const tg = this.solo && !this.solo.includes(n) ? 0 : T[n];
      l.level += (tg - l.level) * Math.min(1, dt * (tg > l.level ? 6 : 1));
      const g = l.level * MIX[n][0];
      if (Math.abs(g - l.set) > 0.002 || (g === 0 && l.set !== 0)) {
        l.bus.gain.setTargetAtTime(g, now, 0.04);
        l.set = g;
      }
    }

    // Muffled while paused or while the hero is down.
    const fight = this.sec === 'build' || this.sec === 'battle' || this.sec === 'boss';
    const muf = st.paused ? 2 : st.heroDown && fight ? 1 : 0;
    if (muf !== this.muf) {
      this.muf = muf;
      this.lpf.frequency.setTargetAtTime([18000, 900, 650][muf], now, 0.25);
      this.mix.gain.setTargetAtTime([1, 0.7, 0.5][muf], now, 0.25);
    }

    if (this.nextT < now) this.nextT = now + 0.05;
    while (this.nextT < now + LOOKAHEAD) {
      this.tick(this.nextT);
      this.nextT += this.sd;
    }
  }

  private targets(): Record<LayerName, number> {
    const T = { pad: 0, pluck: 0, flute: 0, bassS: 0, bassH: 0, str: 0, brass: 0, lead: 0, choir: 0, bell: 0, drums: 0, folk: 0, trem: 0 };
    const L = this.dangerS;
    switch (this.sec) {
      case 'title':
        return { ...T, pad: 1, pluck: 1, flute: 1, bassS: 1, bell: 1 };
      case 'build':
        return { ...T, pad: 1, pluck: 1, flute: 1, bassS: 1, bell: 1, folk: 1, drums: 1 };
      case 'battle':
      case 'boss': {
        const boss = this.sec === 'boss';
        return {
          ...T, pad: 1, bassH: 1, drums: 1, lead: 1, bell: 1,
          str: boss || L > 0.3 ? 1 : 0,
          brass: boss || L > 0.5 ? 1 : 0,
          choir: boss || L > this.choirAt() ? 1 : 0,
          trem: L > (boss ? 0.6 : 0.78) ? 1 : 0,
        };
      }
      case 'clear':
        return { ...T, pad: 1, bassH: 1, drums: 1, lead: 1, brass: 1, bell: 1 };
      case 'victory':
        return { ...T, pad: 1, pluck: 1, flute: 1, bassS: 1, drums: 1, lead: 1, bell: 1 };
      case 'defeat':
        return { ...T, pad: 1, choir: 1, flute: 1, bassS: 1, drums: 1 };
      default:
        return T;
    }
  }

  /** The dead sing earlier. */
  private choirAt(): number {
    return this.st.act === 3 || this.st.act === 5 ? 0.4 : 0.7;
  }

  private baseBpm(sec: Sec): number {
    const L = this.dangerS;
    switch (sec) {
      case 'title': return 72;
      case 'battle': return Math.round(108 + L * 20 + (this.st.act >= 5 ? 6 : 0));
      case 'boss': return Math.round(126 + L * 10);
      case 'clear': return 100;
      case 'victory': return 104;
      case 'defeat': return 58;
      default: return 96;
    }
  }

  private enter(sec: Sec, t: number): void {
    const from = this.sec;
    this.sec = sec;
    this.step = 0;
    this.pend = null;
    this.prevPad = [];
    this.prevChoir = [];
    this.key = sec === 'title' ? TITLE_KEY : sec === 'victory' ? VICTORY_KEY : ACT_KEY[Math.max(0, Math.min(4, this.st.act - 1))];
    if (sec === 'build') this.swell = false;
    if (sec === 'boss' || (sec === 'battle' && from !== 'boss')) {
      this.hit('crash', t, 0.8);
      this.hit('low', t, 1);
      this.hit('taiko', t, 0.8);
    }
    if (sec === 'victory') this.hit('crash', t, 0.7);
  }

  private tick(t: number): void {
    if (this.sec === 'clear' && this.step >= 16 && !this.pend) this.pend = { sec: this.want(), beat: false };
    if (this.pend && this.step % (this.pend.beat ? 4 : 16) === 0) this.enter(this.pend.sec, t);
    const s = this.step % 16;
    const bar = Math.floor(this.step / 16);
    if (s === 0) {
      this.bpm = this.baseBpm(this.sec);
      this.sd = 60 / this.bpm / 4;
    }
    if (this.accent && s % 4 === 0 && (this.sec === 'battle' || this.sec === 'boss')) this.playAccent(t);
    switch (this.sec) {
      case 'title': this.sTitle(t, bar, s); break;
      case 'build': this.sBuild(t, bar, s); break;
      case 'battle': this.sBattle(t, bar, s, false); break;
      case 'boss': this.sBattle(t, bar, s, true); break;
      case 'clear': this.sClear(t, s); break;
      case 'victory': this.sVictory(t, bar, s); break;
      case 'defeat': this.sDefeat(t, bar, s); break;
      default: break;
    }
    this.step++;
  }

  // ───────────── Sections ─────────────

  private sTitle(t: number, bar: number, s: number): void {
    // Sixteen bars: the harp alone, then the flute plays A, B and C.
    const cyc = bar % 16;
    const ph = cyc >> 2;
    const pb = cyc & 3;
    const cs = [P_A, P_A, P_B, P_C][ph][pb];
    const c = this.at(cs, s);
    if (s === 0 || (s === 8 && cs.length > 1)) {
      const len = cs.length > 1 ? 8 : 16;
      this.padChord(c, t, len, 0.7);
      this.bassS(this.bassOf(c), t, len * this.sd, 0.6);
    }
    if (s % 2 === 0) this.pluck(tones(this.key, c, 50, 6)[[0, 1, 2, 3, 4, 5, 4, 3][s >> 1]], t, s === 0 ? 0.7 : 0.5);
    if (ph > 0) this.mel([THEME_A, THEME_A, THEME_B, THEME_C][ph], pb * 16 + s, t, 'flute', 'major', 12, 0.75);
    if (ph === 3 && s % 8 === 4) this.bell(tones(this.key, c, 79, 3)[(s >> 3) + 1], t, 0.45);
  }

  private sBuild(t: number, bar: number, s: number): void {
    const st = this.st;
    const cyc = bar % 16;
    const ph = cyc >> 2;
    const pb = cyc & 3;
    // Each time round: the flute, then the lute, then the flute with bells.
    const round = Math.floor(bar / 16) % 3;
    const cs = [P_A, P_B, P_C, P_A][ph][pb];
    const c = this.at(cs, s);
    // 0 → 1 over the last ten seconds of the countdown.
    const cd = clamp01(1 - st.countdown / 10);
    this.harmony(cs, s, t, 0.6, cd > 0.5);
    if (s % 2 === 0) this.pluck(tones(this.key, c, 55, 4)[ARP[s >> 1]], t, s % 8 === 0 ? 0.7 : 0.5);
    // Frame drum and shaker.
    if (s === 0) this.hit('frame', t, 0.7, 'folk');
    if (s === 6 || s === 10) this.hit('frame', t, 0.35, 'folk');
    if (s === 8) this.hit('frame', t, 0.55, 'folk');
    if (s % 4 === 2) this.hit('shaker', t, 0.6, 'folk');
    if (ph < 3) {
      const tune = [THEME_A, THEME_B, THEME_C][ph];
      const pos = pb * 16 + s;
      if (round === 1) {
        if (ph < 2) this.mel(tune, pos, t, 'pluck', 'major', 12, 0.75);
      } else this.mel(tune, pos, t, 'flute', 'major', 12, 0.7);
      if (round === 2 && ph === 2 && s % 4 === 0) this.bell(tones(this.key, c, 81, 3)[(s >> 2) % 3], t, 0.3);
    } else if (s % 8 === 0) this.bell(tones(this.key, c, 76, 3)[s === 0 ? 2 : 1], t, 0.4);
    if (st.act === 4 && ph < 3 && s % 8 === 4) this.bell(tones(this.key, c, 84, 2)[s >> 3], t, 0.25);
    // The countdown: timpani, then a snare roll and a cymbal swell into the horn.
    if (cd > 0) {
      if (s === 0 || (cd > 0.4 && s % 4 === 0)) this.hit('timp', t, 0.4 + 0.6 * cd);
      if (cd > 0.75 && s >= 8) this.hit('snare', t, 0.15 + 0.55 * cd * ((s - 8) / 8));
    }
    if (!this.swell && st.countdown < 2.4 && st.countdown > 0.6) {
      this.swell = true;
      this.swellTo(t, st.countdown);
    }
  }

  private sBattle(t: number, bar: number, s: number, boss: boolean): void {
    const st = this.st;
    const L = this.dangerS;
    const pb = bar & 7;
    const c = (boss ? P_BOSS : P_BATTLE)[pb][0];
    const sd = this.sd;
    if (s === 0) {
      this.padChord(c, t, 16, 0.55 + 0.3 * L, 48, 64);
      if (boss || L > this.choirAt()) this.choirChord(c, t, 16, 0.55 + 0.4 * L);
      if (L > (boss ? 0.6 : 0.78)) for (const m of tones(this.key, c, 69, 2)) this.trem(m, t, 16 * sd, 0.7);
      // The battle theme: as the wave opens, for a sally or a boss, and every other eight bars when it's tense.
      this.leadOn = boss || st.sally || bar < 8 || (L > 0.45 && Math.floor(bar / 8) % 2 === 1);
    }

    // Drums.
    const v = Math.min(1, 0.45 + L * 0.7);
    if (boss) {
      if (s % 4 === 0) this.hit(s === 0 ? 'low' : 'taiko', t, v);
      if (s === 6 || s === 14) this.hit('taiko', t, v * 0.7);
      if (s % 2 === 0) this.hit('click', t, v * 0.45);
      if (bar % 2 === 1 && s >= 12) this.hit('tom', t, v * (0.5 + (s - 12) * 0.15));
    } else {
      if (s === 0 || s === 8) this.hit(s === 0 && L > 0.5 ? 'low' : 'taiko', t, v);
      if (L > 0.28 && (s === 6 || s === 11 || s === 14)) this.hit('tom', t, v * 0.8);
      if (L > 0.5 && (s === 3 || s === 10)) this.hit('taiko', t, v * 0.75);
      if (L > 0.55 && s % 2 === 0) this.hit('click', t, v * 0.5);
      if (L > 0.72 && bar % 2 === 1 && s >= 12) this.hit('tom', t, v * (0.5 + (s - 12) * 0.15));
      // Following the hero out: a march.
      if (st.sally) {
        if (s === 4 || s === 12) this.hit('snare', t, 0.7);
        if (s === 14 || s === 15) this.hit('snare', t, 0.35);
      }
    }

    // Bass: driving 8ths, galloping when it's tense.
    const root = this.bassOf(c);
    const gallop = boss || L > 0.6;
    if (gallop ? s % 4 !== 1 : s % 2 === 0) this.bassH(root + BASS8[s >> 1], t, (gallop ? 0.9 : 1.8) * sd, s % 8 === 0 ? 0.9 : 0.7);

    // String ostinato.
    if (boss || L > 0.3) {
      const fast = boss || L > 0.55;
      if (fast || s % 2 === 0) this.stac(tones(this.key, c, 50, 5)[OST[s]], t, s % 4 === 0 ? 0.9 : 0.65);
    }

    // Brass stabs, kept low under the tune.
    if (boss || L > 0.5) {
      const len = s === 0 ? 6 : s === 10 ? 2 : s === 12 ? 4 : 0;
      if (len && !(this.leadOn && s !== 0)) for (const m of tones(this.key, c, 48, 3)) this.brass(m, t, len * sd * 0.9, 0.55 + 0.4 * L);
    }

    if (this.leadOn) {
      const pos = pb * 16 + s;
      if (boss) {
        this.mel(BOSS, pos, t, 'lead', 'phrygian', -12, 0.95);
        this.mel(BOSS, pos, t, 'lead', 'phrygian', 0, 0.5);
      } else this.mel(BATTLE, pos, t, 'lead', 'minor', 0, st.sally ? 0.95 : 0.8);
    }

    // The Frozen North glitters.
    if (st.act === 4 && s % 4 === 2) this.bell(tones(this.key, c, 79, 3)[(s >> 2) % 3], t, 0.3);
  }

  private sClear(t: number, s: number): void {
    const c = K.I;
    if (s === 0) {
      this.hit('crash', t, 0.9);
      this.hit('low', t, 0.9);
      this.hit('taiko', t, 0.7);
      for (const m of tones(this.key, c, 55, 3)) this.brass(m, t, 12 * this.sd, 0.85);
      this.padChord(c, t, 16, 0.7);
      this.bassH(this.bassOf(c), t, 8 * this.sd, 0.9);
    }
    this.mel(FANFARE, s, t, 'lead', 'major', 0, 0.95);
    if (s >= 8 && s % 2 === 0) this.bell(tones(this.key, c, 74, 4)[((s - 8) >> 1) % 4], t, 0.45);
    if (s === 8) this.hit('taiko', t, 0.6);
    if (s === 12) this.hit('timp', t, 0.6);
  }

  private sVictory(t: number, bar: number, s: number): void {
    const cyc = bar % 16;
    const ph = cyc >> 2;
    const pb = cyc & 3;
    const cs = [P_A, P_B, P_C, P_B][ph][pb];
    const c = this.at(cs, s);
    this.harmony(cs, s, t, 0.7, false);
    if (s % 2 === 0) this.pluck(tones(this.key, c, 55, 4)[ARP[s >> 1]], t, s % 8 === 0 ? 0.7 : 0.5);
    // A march.
    if (s === 0) this.hit('taiko', t, 0.8);
    if (s === 8) this.hit('taiko', t, 0.6);
    if (s === 4 || s === 12) this.hit('snare', t, 0.55);
    if (pb === 3 && s >= 12) this.hit('snare', t, 0.3 + (s - 12) * 0.1);
    if (cyc === 0 && s === 0) this.hit('crash', t, 0.7);
    const pos = pb * 16 + s;
    if (ph === 2) {
      this.mel(THEME_C, pos, t, 'flute', 'major', 12, 0.8);
      if (s % 8 === 4) this.bell(tones(this.key, c, 79, 3)[(s >> 3) + 1], t, 0.4);
    } else this.mel(ph === 0 ? THEME_A : THEME_B, pos, t, 'lead', 'major', 0, 0.85);
  }

  private sDefeat(t: number, bar: number, s: number): void {
    // A bar of quiet, then the theme in the minor, then four bars of chords.
    if (bar === 0) {
      if (s === 0) this.hit('timp', t, 0.9);
      if (s === 8) this.padChord(K.i, t, 8, 0.5);
      return;
    }
    const cyc = (bar - 1) % 8;
    const pb = cyc & 3;
    const c = P_LAMENT[pb][0];
    if (s === 0) {
      this.padChord(c, t, 16, 0.6);
      this.choirChord(c, t, 16, 0.55);
      this.bassS(this.bassOf(c), t, 16 * this.sd, 0.55);
    }
    if (cyc < 4) this.mel(LAMENT, pb * 16 + s, t, 'flute', 'minor', 12, 0.65);
  }

  private playAccent(t: number): void {
    const a = this.accent;
    this.accent = null;
    if (a === 'boss') {
      this.hit('crash', t, 1);
      this.hit('low', t, 1);
      this.hit('taiko', t, 0.8);
      // A major chord: the tide turns.
      for (const m of tones(this.key, K.I, 55, 3)) this.brass(m, t, 8 * this.sd, 0.9, 'lead');
    } else if (a === 'camp') {
      this.hit('crash', t, 0.6);
      this.hit('taiko', t, 0.8);
    }
  }

  // ───────────── Helpers ─────────────

  private at(cs: Chord[], s: number): Chord {
    return cs.length > 1 && s >= 8 ? cs[1] : cs[0];
  }

  private bassOf(c: Chord): number {
    return 36 + mod(this.key + c.r - 36, 12);
  }

  private deg(mode: Mode, d: number, acc: number): number {
    return this.key + 12 * Math.floor(d / 7) + SCALES[mode][mod(d, 7)] + acc;
  }

  /** Pad chord at each chord change; bass on 1 and 3, or driving 8ths. */
  private harmony(cs: Chord[], s: number, t: number, padVel: number, drive: boolean): void {
    const c = this.at(cs, s);
    if (s === 0 || (s === 8 && cs.length > 1)) this.padChord(c, t, cs.length > 1 ? 8 : 16, padVel);
    const root = this.bassOf(c);
    if (drive) {
      if (s % 2 === 0) this.bassS(s % 8 === 4 ? root + 12 : root, t, 1.7 * this.sd, s % 4 === 0 ? 0.8 : 0.6);
    } else if (s === 0) this.bassS(root, t, 7 * this.sd, 0.85);
    else if (s === 8) this.bassS(cs.length > 1 ? root : root + 7, t, 6 * this.sd, 0.65);
  }

  /** Play every note of `ph` that starts at `pos`. */
  private mel(ph: N[], pos: number, t: number, inst: 'flute' | 'lead' | 'pluck' | 'bell', mode: Mode, oct: number, vel: number): void {
    for (const n of ph) {
      if (n[1] !== pos) continue;
      const m = this.deg(mode, n[0], n[3] ?? 0) + oct;
      const dur = n[2] * this.sd;
      const v = vel * (pos % 16 === 0 ? 1 : 0.85);
      if (inst === 'flute') this.flute(m, t, dur * 0.97, v);
      else if (inst === 'lead') this.brass(m, t, dur * 0.92, v, 'lead');
      else if (inst === 'pluck') this.pluck(m, t, v, Math.max(dur, 0.6));
      else this.bell(m, t, v);
    }
  }

  private padChord(c: Chord, t: number, steps: number, vel: number, lo = 52, hi = 72): void {
    const v = voiceLead(this.prevPad, this.key, c, lo, hi, 4);
    this.prevPad = v;
    for (const m of v) this.pad(m, t, steps * this.sd, vel);
  }

  private choirChord(c: Chord, t: number, steps: number, vel: number): void {
    const v = voiceLead(this.prevChoir, this.key, c, 57, 76, 3);
    this.prevChoir = v;
    for (const m of v) this.choir(m, t, steps * this.sd, vel);
  }

  // ───────────── Instruments ─────────────

  private osc(type: OscillatorType, f: number, t: number, end: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    o.start(t);
    o.stop(end);
    return o;
  }

  /** Attack to `peak`, decay toward `sus`×peak, release after `hold`. */
  private env(t: number, a: number, peak: number, hold: number, rel: number, sus = 1, decay = 0.2): GainNode {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (sus < 1) p.setTargetAtTime(peak * sus, t + a, decay);
    p.setTargetAtTime(0, t + Math.max(a, hold), rel / 5);
    return g;
  }

  /** Vibrato on `params`, fading in after `delay`. */
  private vib(t: number, end: number, rate: number, depth: number, delay: number, params: AudioParam[]): void {
    const lfo = this.osc('sine', rate, t, end);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(depth, t + delay);
    lfo.connect(g);
    for (const p of params) g.connect(p);
  }

  private to(g: AudioNode, layer: LayerName): void {
    g.connect(this.L[layer].bus);
  }

  /** Warm strings: two detuned saws, slow in and out. */
  private pad(m: number, t: number, dur: number, vel: number): void {
    const f = mtof(m);
    const end = t + dur + 1.4;
    const g = this.env(t, 0.45, vel * 0.13, dur, 1.2);
    for (const d of [-8, 8]) this.osc('sawtooth', f, t, end, d).connect(g);
    this.to(g, 'pad');
  }

  private pluck(m: number, t: number, vel: number, len = 2): void {
    let b = this.plucks[0];
    for (const p of this.plucks) if (Math.abs(p.m - m) < Math.abs(b.m - m)) b = p;
    const rate = mtof(m) / b.f;
    const src = this.ctx.createBufferSource();
    src.buffer = b.buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vel * 0.9, t);
    g.gain.setTargetAtTime(0, t + len, 0.08);
    src.connect(g);
    this.to(g, 'pluck');
    src.start(t);
    src.stop(t + Math.min(len + 0.5, b.buf.duration / rate));
  }

  /** Sine and triangle with a breath at the start and vibrato that grows. */
  private flute(m: number, t: number, dur: number, vel: number): void {
    const f = mtof(m);
    const end = t + dur + 0.4;
    const g = this.env(t, 0.06, vel * 0.2, dur, 0.25, 0.85, 0.15);
    const o = this.osc('sine', f, t, end);
    const o2 = this.osc('triangle', f, t, end);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.35;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    if (dur > 0.3) this.vib(t, end, 5.2, f * 0.006, Math.min(0.5, dur), [o.frequency, o2.frequency]);
    this.to(g, 'flute');
    this.nz(t, 0.1, 0.05 * vel, 'bandpass', f * 2, 1.2, 'flute', undefined, 0.02);
  }

  /** Two saws through a low-pass that opens with the attack: louder is brighter. */
  private brass(m: number, t: number, dur: number, vel: number, layer: 'brass' | 'lead' = 'brass'): void {
    const c = this.ctx;
    const f = mtof(m);
    const end = t + dur + 0.5;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 1.4;
    const fp = filt.frequency;
    fp.setValueAtTime(f * 1.2, t);
    fp.linearRampToValueAtTime(Math.min(7000, f * (3 + 6 * vel)), t + 0.06);
    fp.setTargetAtTime(Math.min(5000, f * (2 + 3 * vel)), t + 0.06, 0.2);
    fp.setTargetAtTime(f, t + dur, 0.08);
    const g = this.env(t, 0.035, 0.14 * vel, dur, 0.22, 0.75, 0.25);
    const oscs = [-6, 6].map((d) => this.osc('sawtooth', f, t, end, d));
    for (const o of oscs) o.connect(filt);
    if (layer === 'lead' && dur > 0.35) this.vib(t, end, 5.5, f * 0.004, 0.3, oscs.map((o) => o.frequency));
    filt.connect(g);
    this.to(g, layer);
  }

  /** A short bowed note for the ostinato. */
  private stac(m: number, t: number, vel: number): void {
    const f = mtof(m);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.008);
    g.gain.setTargetAtTime(0, t + 0.01, 0.05);
    for (const d of [-5, 7]) this.osc('sawtooth', f, t, t + 0.3, d).connect(g);
    this.to(g, 'str');
  }

  private bassS(m: number, t: number, dur: number, vel: number): void {
    const f = mtof(m);
    const end = t + dur + 0.4;
    const g = this.env(t, 0.01, vel * 0.32, dur, 0.15, 0.55, 0.25);
    this.osc('triangle', f, t, end).connect(g);
    const s = this.ctx.createGain();
    s.gain.value = 0.5;
    this.osc('sine', f, t, end).connect(s);
    s.connect(g);
    this.to(g, 'bassS');
  }

  private bassH(m: number, t: number, dur: number, vel: number): void {
    const f = mtof(m);
    const end = t + dur + 0.2;
    const g = this.env(t, 0.005, vel * 0.3, dur, 0.06, 0.5, 0.12);
    this.osc('sawtooth', f, t, end).connect(g);
    const s = this.ctx.createGain();
    s.gain.value = 0.6;
    this.osc('sine', f, t, end).connect(s);
    s.connect(g);
    this.to(g, 'bassH');
  }

  private choir(m: number, t: number, dur: number, vel: number): void {
    const f = mtof(m);
    const end = t + dur + 1.2;
    const g = this.env(t, 0.4, vel * 0.11, dur, 0.9);
    const oscs = [-9, 9].map((d) => this.osc('sawtooth', f, t, end, d));
    for (const o of oscs) o.connect(g);
    this.vib(t, end, 4.6, f * 0.005, 0.5, oscs.map((o) => o.frequency));
    this.to(g, 'choir');
  }

  /** Celesta-like FM bell. */
  private bell(m: number, t: number, vel: number): void {
    const c = this.ctx;
    const f = mtof(m);
    const end = t + 1.8;
    const car = this.osc('sine', f, t, end);
    const md = this.osc('sine', f * 4, t, end);
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * 1.4, t);
    mg.gain.setTargetAtTime(0, t, 0.25);
    md.connect(mg);
    mg.connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.01, 0.4);
    car.connect(g);
    this.to(g, 'bell');
  }

  /** Strings bowed fast: a held note with its volume shaking. */
  private trem(m: number, t: number, dur: number, vel: number): void {
    const c = this.ctx;
    const f = mtof(m);
    const end = t + dur + 0.6;
    const g = this.env(t, 0.3, vel * 0.08, dur, 0.5);
    const am = c.createGain();
    am.gain.value = 0.55;
    const lfo = this.osc('sine', 12, t, end);
    const lg = c.createGain();
    lg.gain.value = 0.45;
    lfo.connect(lg);
    lg.connect(am.gain);
    for (const d of [-4, 4]) this.osc('sawtooth', f, t, end, d).connect(am);
    am.connect(g);
    this.to(g, 'trem');
  }

  private thump(t: number, f0: number, f1: number, dur: number, vol: number, layer: LayerName, type: OscillatorType = 'sine'): void {
    const o = this.osc(type, f0, t, t + dur + 0.1);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.004, dur / 4);
    o.connect(g);
    this.to(g, layer);
  }

  private nz(t: number, dur: number, vol: number, type: BiquadFilterType, f: number, q: number, layer: LayerName, f2?: number, attack = 0.002): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.white;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, t);
    if (f2) filt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0, t + attack, dur / 4);
    src.connect(filt);
    filt.connect(g);
    this.to(g, layer);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  }

  private hit(kind: Drum, t: number, vel: number, layer: LayerName = 'drums'): void {
    switch (kind) {
      case 'taiko':
        this.thump(t, 82, 44, 0.45, 0.55 * vel, layer);
        this.nz(t, 0.09, 0.28 * vel, 'lowpass', 700, 0.7, layer, 200);
        break;
      case 'low':
        this.thump(t, 58, 34, 0.6, 0.6 * vel, layer);
        this.nz(t, 0.12, 0.2 * vel, 'lowpass', 300, 0.7, layer);
        break;
      case 'tom':
        this.thump(t, 150, 95, 0.22, 0.3 * vel, layer);
        this.nz(t, 0.05, 0.14 * vel, 'bandpass', 900, 1.2, layer);
        break;
      case 'click':
        this.nz(t, 0.03, 0.12 * vel, 'highpass', 3500, 0.7, layer);
        break;
      case 'snare':
        this.thump(t, 200, 165, 0.1, 0.14 * vel, layer, 'triangle');
        this.nz(t, 0.14, 0.28 * vel, 'bandpass', 2400, 0.6, layer);
        break;
      case 'crash':
        this.nz(t, 1.6, 0.2 * vel, 'highpass', 4200, 0.5, layer);
        this.nz(t, 0.7, 0.09 * vel, 'bandpass', 7500, 1.5, layer);
        break;
      case 'timp': {
        const f = mtof(this.key - 24);
        this.thump(t, f * 1.04, f, 1.1, 0.5 * vel, layer);
        this.thump(t, f * 1.5 * 1.03, f * 1.5, 0.6, 0.15 * vel, layer);
        this.nz(t, 0.06, 0.12 * vel, 'lowpass', 500, 0.7, layer);
        break;
      }
      case 'frame':
        this.thump(t, 130, 80, 0.22, 0.3 * vel, layer);
        this.nz(t, 0.05, 0.1 * vel, 'bandpass', 700, 1, layer);
        break;
      case 'shaker':
        this.nz(t, 0.06, 0.06 * vel, 'bandpass', 6500, 1.5, layer, undefined, 0.015);
        break;
    }
  }

  /** A reversed-cymbal swell that peaks `dur` seconds after `t`. */
  private swellTo(t: number, dur: number): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 2500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    src.connect(filt);
    filt.connect(g);
    this.to(g, 'drums');
    src.start(t);
    src.stop(t + dur + 0.1);
  }
}

// ───────────────────────────── Game hook-up ─────────────────────────────

let score: Score | null = null;

export const Music = {
  /** Every frame, with the game's state. */
  update(dt: number, st: MusicState): void {
    const h = musicHost();
    if (!h) return;
    try {
      score ??= new Score(h.ctx, h.out, h.verb);
      score.update(dt, st, h.ctx.currentTime);
    } catch (e) {
      // Music must never break the game.
      if (import.meta.env.DEV) console.warn('music', e);
    }
  },
  info(): string {
    return score ? score.info() : 'off';
  },
};

on('waveClear', () => score?.cue('clear'));
on('bossKilled', () => score?.cue('boss'));
on('threat', (a) => {
  if ((a as { kind?: string } | undefined)?.kind === 'campDown') score?.cue('camp');
});

/** Offline render for tests: `script` changes the state (and cues) at given times. */
export async function renderScore(
  secs: number,
  script: { at: number; st?: Partial<MusicState>; cue?: 'clear' | Accent }[],
  solo: LayerName[] | null = null,
  sr = 44100,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  const master = ctx.createGain();
  master.gain.value = 0.62;
  comp.connect(master);
  master.connect(ctx.destination);
  const bus = ctx.createGain();
  bus.gain.value = 0.5;
  bus.connect(comp);
  const verb = ctx.createConvolver();
  verb.buffer = makeImpulse(ctx);
  const vIn = ctx.createGain();
  const vOut = ctx.createGain();
  vOut.gain.value = 0.55;
  vIn.connect(verb);
  verb.connect(vOut);
  vOut.connect(comp);
  const sc = new Score(ctx, bus, vIn);
  sc.solo = solo;
  let st: MusicState = { ...IDLE };
  let k = 0;
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) {
    while (k < script.length && script[k].at <= t) {
      st = { ...st, ...script[k].st };
      const cue = script[k].cue;
      if (cue) sc.cue(cue);
      k++;
    }
    sc.update(dt, st, t);
  }
  return ctx.startRendering();
}
