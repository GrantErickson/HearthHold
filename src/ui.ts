import * as THREE from 'three';
import { scene } from './engine';
import { G } from './state';
import { CFG } from './config';
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
import type { Objective } from './tutorial';

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
}

type ScreenId = 'menu' | 'pause' | 'over' | 'win' | 'fatal';

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
let marker: THREE.Group | null = null;
let pointer: THREE.Group | null = null;
let lastCoins = 0;
const bannerQueue: { title: string; sub: string; cls: string }[] = [];
let bannerT = 0;
let toastT = 0;
let confirmNew = false;

function showBanner(): void {
  const b = bannerQueue.shift();
  if (!b) return;
  const el = els.banner;
  setText(els.bannerTitle, b.title);
  setText(els.bannerSub, b.sub);
  el.className = 'show ' + b.cls;
  bannerT = 2.6;
}

function fmtStats(): string {
  const s = G.stats;
  return `Raiders defeated: ${s.kills.toLocaleString()} · Coins earned: ${s.earned.toLocaleString()} · Things built: ${s.built}`;
}

export const UI = {
  init(h: UIHandlers): void {
    const ids = [
      'hud', 'coinPill', 'coinVal', 'carryPill', 'carryVal', 'hpPill', 'hpBar', 'objective', 'objText', 'waveCard', 'waveTitle',
      'waveSub', 'waveBar', 'callBtn', 'keepCard', 'keepBar', 'bossCard', 'bossName', 'bossBar', 'pauseBtn', 'muteBtn', 'banner',
      'bannerTitle', 'bannerSub', 'toast', 'btnContinue', 'btnPlay', 'btnHow', 'how', 'btnResume', 'btnRestart', 'btnMenu',
      'btnMute2', 'overTitle', 'overStats', 'btnRetry', 'btnNew2', 'winStats', 'btnEndless', 'btnNew3', 'fatalMsg',
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
    click('callBtn', () => Waves.callEarly());

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
      const boss = n >= 20 && n % 10 === 0 ? 'The Warlord himself is coming!' : n >= 10 && n % 5 === 0 ? 'A Chieftain leads the attack!' : 'Raiders incoming from the north!';
      UI.banner(`Wave ${n}`, boss, 'red');
    });
    on('waveClear', (info) => {
      const i = info as WaveClearInfo;
      UI.banner(`Wave ${i.wave} cleared!`, `+${i.bonus} coins · repairs done`, 'gold');
    });
    on('structureLost', () => UI.toast('A defense fell — rebuild it at half price'));
    UI.refreshSound();
    UI.refreshMenu();
  },

  refreshMenu(): void {
    const d = Save.read();
    els.btnContinue.hidden = !d;
    if (d) setText(els.btnContinue, `Continue — Wave ${d.wavesCleared + 1}`);
    setText(els.btnPlay, d ? 'New game' : 'Play');
  },

  refreshSound(): void {
    const m = Sfx.isMuted();
    setText(els.muteBtn, m ? '🔇' : '🔊');
    setText(els.btnMute2, m ? 'Sound: off' : 'Sound: on');
  },

  showScreen(id: ScreenId | null): void {
    for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.hidden = s.id !== id;
  },

  enterGame(): void {
    UI.showScreen(null);
    els.hud.hidden = false;
    lastCoins = G.coins;
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

  banner(title: string, sub: string, cls = ''): void {
    bannerQueue.push({ title, sub, cls });
    if (bannerT <= 0) showBanner();
  },

  toast(msg: string): void {
    setText(els.toast, msg);
    els.toast.classList.add('show');
    toastT = 2.6;
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

    if (G.phase === 'build') {
      const next = G.wavesCleared + 1;
      setText(els.waveTitle, G.endless ? `Wave ${next}` : `Wave ${next} of ${CFG.totalWaves}`);
      const running = Waves.timerRunning();
      setText(els.waveSub, running ? `Raiders arrive in ${fmtTime(G.buildTimer)}` : 'Raiders are gathering…');
      setWidth(els.waveBar, running ? 1 - G.buildTimer / G.buildTotal : 0);
      els.callBtn.hidden = !running;
      if (running) setText(els.callBtn, `Call now +${Waves.earlyBonus()}`);
    } else if (G.phase === 'wave') {
      setText(els.waveTitle, `Wave ${G.wave}`);
      const rem = Waves.remaining();
      setText(els.waveSub, `${rem} raider${rem === 1 ? '' : 's'} left`);
      setWidth(els.waveBar, 1 - rem / Math.max(1, G.waveTotal));
      els.callBtn.hidden = true;
    }
    els.waveCard.classList.toggle('fighting', G.phase === 'wave');

    const kr = S.keep.hp / S.keep.maxHp;
    setWidth(els.keepBar, kr);
    els.keepCard.classList.toggle('danger', kr < 0.35);

    const b = Units.boss();
    els.bossCard.hidden = !b;
    if (b) {
      setText(els.bossName, b.d.name);
      setWidth(els.bossBar, b.hp / b.maxHp);
    }

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
