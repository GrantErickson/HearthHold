import './style.css';
import * as THREE from 'three';
import { scene, camera, engine } from './engine';
import { G } from './state';
import { World } from './world';
import * as St from './structures';
import { initSlots, reservedRects, makeStaticPad, updatePads, refreshPads, redrawPadText } from './pads';
import { heroInit, heroUpdate, hero } from './hero';
import { Units } from './units';
import { Proj } from './projectiles';
import { Waves } from './waves';
import { updateFX, updateTexts, burst, clearTexts } from './fx';
import { UI } from './ui';
import { Save } from './save';
import { updateTutorial, type Objective } from './tutorial';
import { Input } from './input';
import { Sfx } from './audio';
import { on } from './events';
import { initDebugKeys, runAutotest, runPreset } from './debug';

const BOOT_KEY = 'hearthold-boot';
let objective: Objective | null = null;
const focus = new THREE.Vector3(0, 0, 2.5);
let last = performance.now();

/** Advance the simulation by one tick. */
function step(dt: number): void {
  G.time += dt;
  heroUpdate(dt);
  World.update(dt, G.time);
  St.updateStructures(dt);
  Units.update(dt);
  Proj.update(dt);
  updatePads(dt);
  Waves.update(dt);
  updateFX(dt);
  objective = updateTutorial();
}

function updateCamera(dt: number): void {
  const aspect = engine.w / engine.h;
  const zoom = aspect < 0.7 ? 1.55 : aspect < 1.1 ? 1.25 : 1;
  if (G.phase === 'menu') {
    const a = G.time * 0.06;
    camera.position.set(Math.sin(a) * 30 * zoom, 24 * zoom, 4 + Math.cos(a) * 30 * zoom);
    camera.lookAt(0, 0, 0);
    World.focus(0, 0);
    return;
  }
  const k = 1 - Math.exp(-dt * 6);
  focus.x += (hero.x - focus.x) * k;
  focus.z += (hero.z - focus.z) * k;
  let sx = 0;
  let sz = 0;
  if (G.shake > 0) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
    sx = (Math.random() - 0.5) * G.shake * reduce;
    sz = (Math.random() - 0.5) * G.shake * reduce;
    G.shake = Math.max(0, G.shake - dt * 1.6);
  }
  const lz = focus.z - 1.5;
  camera.position.set(focus.x + sx, 24 * zoom, lz + 12 * zoom + sz);
  camera.lookAt(focus.x + sx, 0, lz + sz);
  World.focus(focus.x, lz - 3);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (G.phase === 'menu') {
    G.time += rdt;
    World.update(rdt, G.time);
  } else if (!G.paused) {
    step(rdt * G.timeScale);
  }
  updateCamera(rdt);
  Sfx.listener.x = hero.x;
  Sfx.listener.z = hero.z;
  updateTexts(rdt);
  UI.update(rdt, objective);
  engine.renderer?.render(scene, camera);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  engine.w = w;
  engine.h = h;
  engine.renderer?.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const inGame = () => G.phase === 'build' || G.phase === 'wave';

function pause(): void {
  if (!inGame() || G.paused) return;
  G.paused = true;
  Input.reset();
  UI.showScreen('pause');
}

function resume(): void {
  G.paused = false;
  UI.showScreen(null);
  last = performance.now();
}

function reloadWith(mode: 'new' | 'continue'): void {
  try {
    sessionStorage.setItem(BOOT_KEY, mode);
  } catch {
    /* ignore */
  }
  location.reload();
}

function startNew(): void {
  Save.clear();
  G.phase = 'build';
  Waves.startBuild();
  UI.enterGame();
}

function startContinue(): void {
  const d = Save.read();
  if (!d) {
    startNew();
    return;
  }
  Save.restore(d);
  Waves.startBuild();
  UI.enterGame();
}

function toggleMute(): void {
  Sfx.setMuted(!Sfx.isMuted());
  UI.refreshSound();
}

function boot(): void {
  const params = new URLSearchParams(location.search);
  G.debug = params.has('debug');
  G.autotest = params.has('autotest');

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    UI.fatal('Your browser could not start 3D graphics (WebGL). Try another browser or enable hardware acceleration.');
    return;
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.75 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('game')!.appendChild(renderer.domElement);
  engine.renderer = renderer;
  resize();
  window.addEventListener('resize', resize);

  initSlots();
  World.init(reservedRects(), touch);
  St.initBase();
  makeStaticPad(St.market.drop.x, St.market.drop.z, 'sell', 'Market', 'Drop wood, stone & gold here');
  makeStaticPad(St.market.coin.x, St.market.coin.z, 'coins', 'Coins', 'Stand here to collect');
  heroInit();
  refreshPads(true);

  UI.init({
    play: startNew,
    cont: startContinue,
    newGame: () => {
      Save.clear();
      reloadWith('new');
    },
    resume,
    pause,
    retry: () => reloadWith('continue'),
    endless: () => {
      G.paused = false;
      UI.showScreen(null);
      Waves.startBuild();
    },
    toMenu: () => location.reload(),
    toggleMute,
  });
  Input.init(renderer.domElement);
  Input.onKey((e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (G.paused && inGame()) resume();
      else pause();
    } else if (e.code === 'KeyM') toggleMute();
  });
  const unlockAudio = () => Sfx.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  document.fonts?.load('46px "Lilita One"').then(redrawPadText).catch(() => undefined);

  on('keepDestroyed', () => {
    if (G.phase === 'gameover') return;
    G.phase = 'gameover';
    G.timeScale = 0.35;
    G.shake = 0.9;
    Sfx.play('lose');
    burst(0, 3, 13, 0x9a948a, 40, { speed: 7, up: 7, size: 0.35, life: 1.2 });
    if (G.autotest) return;
    window.setTimeout(() => {
      G.paused = true;
      G.timeScale = 1;
      UI.showOver();
    }, 1800);
  });
  on('victory', () => {
    Sfx.play('win');
    if (G.autotest) return;
    window.setTimeout(() => {
      G.paused = true;
      UI.showWin();
    }, 1500);
  });

  if (G.autotest) {
    UI.showScreen(null);
    runAutotest(step);
    return;
  }
  if (G.debug) {
    initDebugKeys();
    window.addEventListener('error', (e) => UI.toast(`Error: ${e.message}`));
    (window as unknown as { HH: unknown }).HH = { G, hero, St, Units, Waves };
  }

  let mode: string | null = null;
  try {
    mode = sessionStorage.getItem(BOOT_KEY);
    sessionStorage.removeItem(BOOT_KEY);
  } catch {
    /* ignore */
  }
  const preset = Number(params.get('preset') ?? 0);
  if (G.debug && preset > 0) {
    startNew();
    runPreset(step, preset, Number(params.get('fight') ?? 0));
    const at = (params.get('at') ?? '').split(',').map(Number);
    if (at.length === 2 && at.every(Number.isFinite)) {
      hero.x = at[0];
      hero.z = at[1];
      focus.set(hero.x, 0, hero.z);
    }
    clearTexts();
    UI.clearBanners();
  } else if (G.debug && params.has('start')) startNew();
  else if (mode === 'continue' || (G.debug && params.has('continue'))) startContinue();
  else if (mode === 'new') startNew();
  else UI.showScreen('menu');

  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
