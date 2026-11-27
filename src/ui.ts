import * as THREE from 'three';
import { scene } from './engine';
import { G, actOf } from './state';
import { CFG, ACTS, MODS, PERKS, RELICS, isBossWave, bossName } from './config';
import { hero, capacity, maxHp, respawnIn } from './hero';
import { S } from './structures';
import { Units } from './units';
import { Waves, type WaveClearInfo } from './waves';
import { makeMarker, makePointer } from './models';
import { clamp, fmtTime } from './util';
import { Sfx } from './audio';
import { on } from './events';
import { nameOf, type Slot } from './pads';
import { Save } from './save';
import { Env } from './env';
import { currentOffer, takeChoice, pendingChoices, xpRatio, type Choice } from './progress';
import { ABILITIES, ABILITY_INFO, blocked, cast, cooldown, maxCd, unlocked, type AbilityId } from './abilities';
import type { HappeningInfo } from './happenings';
import type { Objective } from './tutorial';
import type { JumpBase } from './debug';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

export interface UIHandlers {
  play(): void;
  cont(): void;
  newGame(): void;
  resume(): void;
  pause(): void;
  retry(): void;
  endless(): void;
  toMenu(): void;
  toggleMute(): void;
  cycleSpeed(dir: number): void;
  /** Test builds only: start at a later wave. */
  jump?(wave: number, base: JumpBase, god: boolean): void;
}

type ScreenId = 'menu' | 'pause' | 'over' | 'win' | 'fatal' | 'choose';

const lastText = new WeakMap<HTMLElement, string>();
function setText(el: HTMLElement, s: string): void {
  if (lastText.get(el) !== s) {
    lastText.set(el, s);
    el.textContent = s;
  }
}
function setWidth(el: HTMLElement, ratio: number): void {
  const v = `${(clamp(ratio, 0, 1) * 100).toFixed(1)}%`;
  if (el.style.width !== v) el.style.width = v;
}

let els: Record<string, HTMLElement> = {};
let handlers: UIHandlers | null = null;
let marker: THREE.Group | null = null;
let pointer: THREE.Group | null = null;
let lastCoins = 0;
const bannerQueue: { title: string; sub: string; cls: string; dur: number }[] = [];
let bannerT = 0;
let toastT = 0;
let confirmNew = false;
let choosing = false;
let screen: ScreenId | null = null;
const abilityEls = new Map<AbilityId, { btn: HTMLButtonElement; cd: HTMLElement; lock: HTMLElement }>();

function showBanner(): void {
  const b = bannerQueue.shift();
  if (!b) return;
  const el = els.banner;
  setText(els.bannerTitle, b.title);
  setText(els.bannerSub, b.sub);
  el.className = 'show ' + b.cls;
  bannerT = b.dur;
}

function fmtStats(): string {
  const s = G.stats;
  return `Enemies defeated: ${s.kills.toLocaleString()} · Bosses slain: ${s.bosses} · Coins earned: ${s.earned.toLocaleString()} · Things built: ${s.built} · Hero level ${G.level}`;
}

function buildAbilities(): void {
  const box = els.abilities;
  box.textContent = '';
  for (const a of ABILITIES) {
    const info = ABILITY_INFO[a];
    const btn = document.createElement('button');
    btn.className = 'ability';
    btn.title = `${info.name} (${info.key}) — ${info.desc}`;
    btn.setAttribute('aria-label', `${info.name}, key ${info.key}`);
    const ico = document.createElement('span');
    ico.className = 'emoji ico';
    ico.textContent = info.icon;
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = info.key;
    const cd = document.createElement('span');
    cd.className = 'cd';
    const lock = document.createElement('span');
    lock.className = 'lock';
    btn.append(ico, cd, key, lock);
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Sfx.unlock();
      UI.useAbility(a);
    });
    box.appendChild(btn);
    abilityEls.set(a, { btn, cd, lock });
  }
}

function heroSheet(): void {
  const el = els.heroSheet;
  el.textContent = '';
  const add = (title: string, items: string[]) => {
    if (!items.length) return;
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = items.join(' · ');
    el.append(h, p);
  };
  add(`Hero level ${G.level}`, Object.entries(G.perks).map(([id, n]) => `${PERKS[id]?.icon ?? ''} ${PERKS[id]?.name ?? id}${n > 1 ? ` ×${n}` : ''}`));
  add('Relics', G.relics.map((id) => `${RELICS[id]?.icon ?? ''} ${RELICS[id]?.name ?? id}`));
  const r = G.research;
  add('Research', (Object.keys(r) as (keyof typeof r)[]).filter((k) => r[k] > 0).map((k) => (k === 'glory' ? `🌟 Glory ${r[k]}` : `${k[0].toUpperCase()}${k.slice(1)} ${r[k]}/5`)));
}

function renderChoices(): void {
  const offer = currentOffer();
  if (!offer) {
    UI.closeChoices();
    return;
  }
  const relic = offer[0].kind === 'relic';
  setText(els.chooseCrest, relic ? '🏺' : '⭐');
  setText(els.chooseTitle, relic ? 'A relic of power!' : `Level ${G.level}!`);
  const left = pendingChoices();
  setText(els.chooseSub, relic ? 'Choose one relic to keep forever' : `Choose a perk${left > 1 ? ` · ${left} to pick` : ''}`);
  const box = els.chooseCards;
  box.textContent = '';
  offer.forEach((c: Choice, i) => {
    const b = document.createElement('button');
    b.className = 'pick' + (relic ? ' relic' : '');
    const ico = document.createElement('div');
    ico.className = 'emoji pick-ico';
    ico.textContent = c.def.icon;
    const name = document.createElement('div');
    name.className = 'pick-name';
    name.textContent = c.def.name;
    const desc = document.createElement('div');
    desc.className = 'pick-desc';
    desc.textContent = c.def.desc;
    const meta = document.createElement('div');
    meta.className = 'pick-meta';
    meta.textContent = relic ? 'Relic' : `${c.stacks}/${c.def.max}  ·  key ${i + 1}`;
    b.append(ico, name, desc, meta);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      UI.pick(i);
    });
    box.appendChild(b);
  });
}

const JUMP_KEY = 'hearthold-jump';
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** The "skip ahead" panel on the main menu (dev server or ?debug only). */
function initJumpPanel(jump: NonNullable<UIHandlers['jump']>): void {
  const input = $<HTMLInputElement>('jumpWave');
  const base = $<HTMLSelectElement>('jumpBase');
  const god = $<HTMLInputElement>('jumpGod');
  const btn = $('btnJump');
  const info = $('jumpInfo');
  const chips = $('jumpChips');
  try {
    const d = JSON.parse(localStorage.getItem(JUMP_KEY) ?? '{}') as { wave?: number; base?: JumpBase; god?: boolean };
    if (d.wave) input.value = String(d.wave);
    if (d.base) base.value = d.base;
    god.checked = !!d.god;
  } catch {
    /* ignore */
  }
  const wave = (): number => clamp(Math.round(Number(input.value) || 2), 2, 150);
  const marks: [string, number][] = [['Act II', 21], ['Act III', 41], ['Act IV', 61], ['Act V', 81]];
  for (let w = 10; w <= 100; w += 10) marks.push([`👑 ${w}`, w]);
  const chipEls: { b: HTMLButtonElement; w: number }[] = [];
  const refresh = (): void => {
    const w = wave();
    setText(btn, `Start at wave ${w}`);
    const act = actOf(w);
    const extra = w % 10 === 0 ? ` · boss: ${bossName(w)}` : isBossWave(w) ? ' · champions' : '';
    setText(info, `${w > CFG.totalWaves ? 'Endless' : `Act ${ROMAN[act - 1]} · ${ACTS[act - 1].name}`}${extra}`);
    for (const c of chipEls) c.b.classList.toggle('on', c.w === w);
  };
  for (const [label, w] of marks) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = w % 10 === 0 ? `Wave ${w}: ${bossName(w)}` : `Wave ${w}: start of Act ${ROMAN[actOf(w) - 1]}`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      input.value = String(w);
      refresh();
    });
    chips.appendChild(b);
    chipEls.push({ b, w });
  }
  const go = (): void => {
    const w = wave();
    try {
      localStorage.setItem(JUMP_KEY, JSON.stringify({ wave: w, base: base.value, god: god.checked }));
    } catch {
      /* ignore */
    }
    Sfx.unlock();
    Sfx.play('click');
    jump(w, base.value as JumpBase, god.checked);
  };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    go();
  });
  refresh();
  $('devPanel').hidden = false;
}

export const UI = {
  init(h: UIHandlers): void {
    handlers = h;
    const ids = [
      'hud', 'coinPill', 'coinVal', 'carryPill', 'carryVal', 'hpPill', 'hpBar', 'lvlPill', 'lvlVal', 'xpBar', 'lvlNew', 'objective', 'objText', 'buffs',
      'waveCard', 'waveAct', 'waveTitle', 'waveSub', 'waveMod', 'waveBar', 'callBtn', 'keepCard', 'keepBar', 'bossCard', 'bossName', 'bossBar', 'bossShield',
      'speedBtn', 'pauseBtn', 'muteBtn', 'abilities', 'banner', 'bannerTitle', 'bannerSub', 'toast', 'btnContinue', 'btnPlay', 'btnHow', 'how', 'btnResume',
      'btnRestart', 'btnMenu', 'btnMute2', 'heroSheet', 'overTitle', 'overStats', 'btnRetry', 'btnNew2', 'winStats', 'btnEndless', 'btnNew3', 'fatalMsg',
      'chooseCrest', 'chooseTitle', 'chooseSub', 'chooseCards', 'btnLater', 'vignette',
    ];
    els = {};
    for (const id of ids) els[id] = $(id);

    const click = (id: string, fn: () => void) =>
      els[id].addEventListener('click', (e) => {
        e.stopPropagation();
        Sfx.unlock();
        Sfx.play('click');
        fn();
      });
    click('btnPlay', () => {
      if (Save.read() && !confirmNew) {
        confirmNew = true;
        setText(els.btnPlay, 'Tap again to erase your save');
        els.btnPlay.classList.add('warn');
        return;
      }
      h.play();
    });
    click('btnContinue', h.cont);
    click('btnHow', () => els.how.toggleAttribute('hidden'));
    click('btnResume', h.resume);
    click('btnRestart', h.retry);
    click('btnMenu', h.toMenu);
    click('btnMute2', h.toggleMute);
    click('btnRetry', h.retry);
    click('btnNew2', h.newGame);
    click('btnEndless', h.endless);
    click('btnNew3', h.newGame);
    click('pauseBtn', h.pause);
    click('muteBtn', h.toggleMute);
    click('speedBtn', () => h.cycleSpeed(1));
    click('callBtn', () => Waves.callEarly());
    click('lvlPill', () => UI.openChoices());
    click('btnLater', () => UI.closeChoices());
    for (const id of ['lvlPill', 'speedBtn', 'pauseBtn', 'muteBtn', 'callBtn']) els[id].addEventListener('pointerdown', (e) => e.stopPropagation());

    buildAbilities();
    marker = makeMarker();
    marker.visible = false;
    pointer = makePointer();
    pointer.visible = false;
    scene.add(marker, pointer);

    on('unlock', (s) => {
      UI.toast(`New: ${nameOf(s as Slot)}`);
      Sfx.play('unlock');
    });
    on('waveStart', (w) => {
      const n = w as number;
      const m = MODS[G.mod];
      let sub = n % 10 === 0 ? `${bossName(n)} leads the attack!` : isBossWave(n) ? 'Champions lead the attack!' : 'Enemies incoming from the north!';
      if (m) sub = `${m.icon} ${m.name} — ${m.desc}`;
      UI.banner(`Wave ${n}`, sub, m?.name === 'Blood Moon' ? 'red blood' : 'red');
    });
    on('waveClear', (info) => {
      const i = info as WaveClearInfo;
      UI.banner(`Wave ${i.wave} cleared!`, `+${i.bonus} coins · repairs done`, 'gold');
    });
    on('actStart', (a) => {
      const act = ACTS[(a as number) - 1];
      UI.banner(`Act ${['I', 'II', 'III', 'IV', 'V'][(a as number) - 1]}: ${act.name}`, act.sub, 'act', 4.2);
      Sfx.play('act');
    });
    on('happening', (arg) => {
      if (arg && typeof arg === 'object') {
        const hp = arg as HappeningInfo;
        UI.banner(hp.title, hp.sub, 'gold', 2.6);
      }
    });
    on('levelUp', () => {
      if (G.autotest) return;
      Sfx.play('levelup');
      UI.toast(`Level ${G.level}! Press L or tap ⭐ to pick a perk`);
      els.lvlPill.classList.remove('bump');
      void els.lvlPill.offsetWidth;
      els.lvlPill.classList.add('bump');
    });
    on('bossKilled', () => {
      if (!G.autotest) UI.toast('A relic fell from the boss — claim it after the wave!');
    });
    on('structureLost', () => UI.toast('A defense fell — rebuild it at half price'));
    UI.refreshSound();
    UI.refreshMenu();
    if (h.jump) initJumpPanel(h.jump);
  },

  refreshMenu(): void {
    const d = Save.read();
    els.btnContinue.hidden = !d;
    if (d) setText(els.btnContinue, `Continue — Wave ${d.wavesCleared + 1} · Lv ${d.level}`);
    setText(els.btnPlay, d ? 'New game' : 'Play');
  },

  refreshSound(): void {
    const m = Sfx.isMuted();
    setText(els.muteBtn, m ? '🔇' : '🔊');
    setText(els.btnMute2, m ? 'Sound: off' : 'Sound: on');
  },

  refreshSpeed(): void {
    setText(els.speedBtn, `${G.speed}×`);
    els.speedBtn.classList.toggle('fast', G.speed > 1);
  },

  showScreen(id: ScreenId | null): void {
    screen = id;
    if (id === 'pause') heroSheet();
    for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.hidden = s.id !== id;
  },

  get screen(): ScreenId | null {
    return screen;
  },

  enterGame(): void {
    UI.showScreen(null);
    els.hud.hidden = false;
    lastCoins = G.coins;
    UI.refreshSpeed();
  },

  showOver(): void {
    setText(els.overTitle, `The keep fell on wave ${G.wave}`);
    setText(els.overStats, fmtStats());
    setText(els.btnRetry, `Retry wave ${G.wavesCleared + 1}`);
    UI.showScreen('over');
  },

  showWin(): void {
    setText(els.winStats, fmtStats());
    UI.showScreen('win');
  },

  fatal(msg: string): void {
    const el = document.getElementById('fatalMsg');
    if (el) el.textContent = msg;
    for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.hidden = s.id !== 'fatal';
  },

  clearBanners(): void {
    bannerQueue.length = 0;
    bannerT = 0;
    els.banner.className = '';
  },

  banner(title: string, sub: string, cls = '', dur = 2.6): void {
    if (G.autotest) return;
    bannerQueue.push({ title, sub, cls, dur });
    if (bannerT <= 0) showBanner();
  },

  toast(msg: string): void {
    if (G.autotest) return;
    setText(els.toast, msg);
    els.toast.classList.add('show');
    toastT = 2.6;
  },

  /** Perk / relic picker. Pauses the game while open. */
  openChoices(): void {
    if (choosing || !pendingChoices() || (G.phase !== 'build' && G.phase !== 'wave')) return;
    if (G.paused && screen !== null) return;
    choosing = true;
    G.paused = true;
    renderChoices();
    UI.showScreen('choose');
  },

  closeChoices(): void {
    if (!choosing) return;
    choosing = false;
    handlers?.resume();
  },

  get choosing(): boolean {
    return choosing;
  },

  pick(i: number): void {
    if (!choosing) return;
    const offer = currentOffer();
    const c = offer?.[i];
    if (!c) return;
    takeChoice(c);
    Sfx.play(c.kind === 'relic' ? 'relic' : 'levelup');
    if (pendingChoices() > 0) renderChoices();
    else UI.closeChoices();
  },

  useAbility(a: AbilityId): void {
    if (G.paused) return;
    const why = blocked(a);
    if (why) {
      if (unlocked(a) && why !== '…') UI.toast(`${ABILITY_INFO[a].name}: ${why}`);
      else if (!unlocked(a)) UI.toast(`${ABILITY_INFO[a].name} unlocks at hero level ${CFG.ability[a].level}`);
      Sfx.play('deny');
      return;
    }
    cast(a);
  },

  update(dt: number, obj: Objective | null): void {
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) {
        els.banner.className = '';
        if (bannerQueue.length) window.setTimeout(showBanner, 250);
      }
    }
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) els.toast.classList.remove('show');
    }
    if (G.phase === 'menu') return;

    const coins = Math.floor(G.coins);
    if (coins > lastCoins) {
      els.coinPill.classList.remove('bump');
      void els.coinPill.offsetWidth;
      els.coinPill.classList.add('bump');
    }
    lastCoins = coins;
    setText(els.coinVal, coins.toLocaleString());

    const cap = capacity();
    setText(els.carryVal, `${hero.stack.length}/${cap}`);
    els.carryPill.classList.toggle('full', hero.stack.length >= cap);
    setWidth(els.hpBar, hero.alive ? hero.hp / maxHp() : 0);
    setText(els.lvlVal, String(G.level));
    setWidth(els.xpBar, xpRatio());
    const pend = pendingChoices();
    els.lvlNew.hidden = pend === 0;
    els.lvlPill.classList.toggle('ready', pend > 0);

    const next = G.wavesCleared + 1;
    const w = G.phase === 'wave' ? G.wave : next;
    setText(els.waveAct, `Act ${['I', 'II', 'III', 'IV', 'V'][actOf(w) - 1]} · ${ACTS[actOf(w) - 1].name}`);
    if (G.phase === 'build') {
      setText(els.waveTitle, G.endless ? `Wave ${next}` : `Wave ${next} of ${CFG.totalWaves}`);
      const running = Waves.timerRunning();
      setText(els.waveSub, running ? `Enemies arrive in ${fmtTime(G.buildTimer)}` : 'Raiders are gathering…');
      setWidth(els.waveBar, running ? 1 - G.buildTimer / G.buildTotal : 0);
      els.callBtn.hidden = !running;
      if (running) setText(els.callBtn, `Call now +${Waves.earlyBonus()}`);
      const pv = Waves.preview(next);
      els.waveMod.hidden = !pv;
      if (pv) setText(els.waveMod, `Next: ${pv}`);
    } else if (G.phase === 'wave') {
      setText(els.waveTitle, G.endless ? `Wave ${G.wave}` : `Wave ${G.wave} of ${CFG.totalWaves}`);
      const rem = Waves.remaining();
      setText(els.waveSub, `${rem} enem${rem === 1 ? 'y' : 'ies'} left`);
      setWidth(els.waveBar, 1 - rem / Math.max(1, G.waveTotal));
      els.callBtn.hidden = true;
      const m = MODS[G.mod];
      els.waveMod.hidden = !m;
      if (m) setText(els.waveMod, `${m.icon} ${m.name}`);
    }
    els.waveCard.classList.toggle('fighting', G.phase === 'wave');

    const kr = S.keep.hp / S.keep.maxHp;
    setWidth(els.keepBar, kr);
    els.keepCard.classList.toggle('danger', kr < 0.35);

    const b = Units.boss();
    els.bossCard.hidden = !b;
    if (b) {
      setText(els.bossName, b.title);
      setWidth(els.bossBar, b.hp / b.maxHp);
      setWidth(els.bossShield, b.shieldHp / b.shieldMax);
    }

    // Buff chips
    const buffs: string[] = [];
    if (G.buffs.warcry > 0) buffs.push(`📣 War Cry ${Math.ceil(G.buffs.warcry)}s`);
    if (G.buffs.fury > 0) buffs.push('🧪 Fury');
    if (G.happening === 'rush') buffs.push('✨ Gold Rush');
    if (G.speed > 1) buffs.push(`⏩ ${G.speed}× speed`);
    setText(els.buffs, buffs.join('   '));
    els.buffs.hidden = !buffs.length;

    for (const a of ABILITIES) {
      const e = abilityEls.get(a);
      if (!e) continue;
      const un = unlocked(a);
      e.btn.classList.toggle('locked', !un);
      const cd = cooldown(a);
      const ratio = un && cd > 0 ? cd / maxCd(a) : 0;
      e.cd.style.setProperty('--p', `${(ratio * 360).toFixed(0)}deg`);
      setText(e.lock, !un ? `Lv ${CFG.ability[a].level}` : cd > 0 ? String(Math.ceil(cd)) : '');
      e.btn.classList.toggle('ready', un && cd <= 0 && G.phase === 'wave' && !blocked(a));
    }

    const danger = G.phase === 'wave' && kr < 0.35 ? 0.5 + Math.sin(G.time * 6) * 0.15 : 0;
    els.vignette.style.opacity = String(Math.max(Env.night * 0.55, danger).toFixed(2));
    els.vignette.classList.toggle('danger', danger > 0);

    const objText = hero.alive ? obj?.text ?? '' : `You fell! Back in ${Math.ceil(respawnIn())}…`;
    setText(els.objText, objText);
    els.objective.hidden = !objText;

    if (marker && pointer) {
      const t = hero.alive ? obj?.target : null;
      if (t) {
        marker.visible = true;
        marker.position.set(t.x, 3.4 + Math.sin(G.time * 4) * 0.3, t.z);
        marker.rotation.y += dt * 2;
        const dx = t.x - hero.x;
        const dz = t.z - hero.z;
        const d = Math.hypot(dx, dz);
        pointer.visible = d > 5;
        if (pointer.visible) {
          pointer.position.set(hero.x + (dx / d) * 1.6, 0, hero.z + (dz / d) * 1.6);
          pointer.rotation.y = Math.atan2(-dz, dx);
        }
      } else {
        marker.visible = false;
        pointer.visible = false;
      }
    }
  },
};
