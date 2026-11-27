import './style.css';
import * as THREE from 'three';
import { scene, camera, engine } from './engine';
import { G } from './state';
import { CFG } from './config';
import { World } from './world';
import { Env } from './env';
import * as St from './structures';
import { initSlots, reservedRects, makeStaticPad, updatePads, refreshPads, redrawPadText } from './pads';
import { heroInit, heroUpdate, hero, maxHp } from './hero';
import { Units } from './units';
import { Proj } from './projectiles';
import { Waves } from './waves';
import { updateFX, updateTexts, burst, clearTexts, renderFX, warmFX, fxSampleMaterials } from './fx';
import { Mat, ensureEmit } from './models';
import { UI } from './ui';
import { Save } from './save';
import { updateTutorial, type Objective } from './tutorial';
import { Input } from './input';
import { Sfx } from './audio';
import { on, emit } from './events';
import { updateAbilities, resetAbilities, type AbilityId } from './abilities';
import { initHappenings, updateHappenings } from './happenings';
import { pendingChoices } from './progress';
import { initDebugKeys, runAutotest, runPreset } from './debug';

const BOOT_KEY = 'hearthold-boot';
const SPEED_KEY = 'hearthold-speed';
const MAX_STEP = 1 / 30;
let objective: Objective | null = null;
const focus = new THREE.Vector3(0, 0, 2.5);
let last = performance.now();
let zoomWant = 1;
let zoom = 1;
let autoPickT = -1;

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
  updateAbilities(dt);
  updateHappenings(dt);
  updateFX(dt);
  objective = updateTutorial();
}

function updateCamera(dt: number): void {
  const aspect = engine.w / engine.h;
  const base = aspect < 0.7 ? 1.55 : aspect < 1.1 ? 1.25 : 1;
  zoom += (zoomWant - zoom) * Math.min(1, dt * 8);
  const z = base * zoom;
  if (G.phase === 'menu') {
    const a = G.time * 0.06;
    camera.position.set(Math.sin(a) * 30 * base, 24 * base, 4 + Math.cos(a) * 30 * base);
    camera.lookAt(0, 0, 0);
    Env.focus(0, 0);
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
  camera.position.set(focus.x + sx, 24 * z, lz + 12 * z + sz);
  camera.lookAt(focus.x + sx, 0, lz + sz);
  Env.focus(focus.x, lz - 3);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  let simDt = rdt;
  if (G.phase === 'menu') {
    G.time += rdt;
    World.update(rdt, G.time);
  } else if (!G.paused) {
    // Sub-step so that 3× speed stays as stable as 1×.
    simDt = rdt * G.timeScale * (G.phase === 'gameover' ? 1 : G.speed);
    const n = Math.max(1, Math.ceil(simDt / MAX_STEP));
    for (let i = 0; i < n; i++) step(simDt / n);
  } else simDt = 0;
  if (autoPickT > 0 && !G.paused) {
    autoPickT -= rdt;
    if (autoPickT <= 0 && G.phase === 'build' && pendingChoices() > 0) UI.openChoices();
  }
  Env.update(simDt, G.time);
  updateCamera(rdt);
  renderFX();
  Sfx.listener.x = hero.x;
  Sfx.listener.z = hero.z;
  updateTexts(rdt);
  UI.update(rdt, objective);
  engine.renderer?.render(scene, camera);
}

/**
 * Compile every material variant up front. Otherwise the first hit flash, burn,
 * frost or ghost effect compiles its shader mid-battle and the game hitches.
 */
function warmUp(renderer: THREE.WebGLRenderer): void {
  warmFX();
  const g = new THREE.Group();
  const geo = ensureEmit(new THREE.BoxGeometry(0.01, 0.01, 0.01));
  const mats: THREE.Material[] = [Mat.vc, Mat.foliage, Mat.grass, Mat.unit, Mat.flash, Mat.flashSoft, Mat.chill, Mat.burn, Mat.spirit, Mat.frozen, ...fxSampleMaterials()];
  for (const m of mats) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    const im = new THREE.InstancedMesh(geo, m, 1);
    g.add(im);
  }
  g.position.set(0, -50, 0);
  scene.add(g);
  const done = () => scene.remove(g);
  renderer.compileAsync(scene, camera).then(done, () => {
    try {
      renderer.compile(scene, camera);
    } catch {
      /* ignore */
    }
    done();
  });
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
  if (!G.debug) emit('actStart', 1);
}

function startContinue(): void {
  const d = Save.read();
  if (!d) {
    startNew();
    return;
  }
  Save.restore(d);
  hero.hp = maxHp();
  Waves.startBuild();
  UI.enterGame();
  if (pendingChoices() > 0) autoPickT = 1.2;
}

function toggleMute(): void {
  Sfx.setMuted(!Sfx.isMuted());
  UI.refreshSound();
}

function setSpeed(s: number): void {
  G.speed = s;
  try {
    localStorage.setItem(SPEED_KEY, String(s));
  } catch {
    /* ignore */
  }
  UI.refreshSpeed();
}

function cycleSpeed(dir: number): void {
  const list = CFG.speeds;
  const i = list.indexOf(G.speed);
  let j = i + dir;
  if (dir > 0 && j >= list.length) j = 0;
  j = Math.max(0, Math.min(list.length - 1, j));
  setSpeed(list[j]);
  Sfx.play('click');
}

const ABILITY_KEYS: Record<string, AbilityId> = { KeyQ: 'whirlwind', KeyE: 'warcry', KeyR: 'meteor', KeyF: 'bastion' };

function boot(): void {
  const params = new URLSearchParams(location.search);
  G.debug = params.has('debug');
  G.autotest = params.has('autotest');
  try {
    const sp = Number(localStorage.getItem(SPEED_KEY));
    if (CFG.speeds.includes(sp)) G.speed = sp;
  } catch {
    /* ignore */
  }
  if (G.autotest) G.speed = 1;

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
  renderer.shadowMap.type = touch ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  document.getElementById('game')!.appendChild(renderer.domElement);
  engine.renderer = renderer;
  resize();
  window.addEventListener('resize', resize);

  initSlots();
  Env.init(touch);
  World.init(reservedRects(), touch);
  St.initBase();
  makeStaticPad(St.market.drop.x, St.market.drop.z, 'sell', 'Market', 'Drop wood, stone, gold & crystal here');
  makeStaticPad(St.market.coin.x, St.market.coin.z, 'coins', 'Coins', 'Stand here to collect');
  heroInit();
  initHappenings();
  refreshPads(true);
  if (!G.autotest) warmUp(renderer);

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
    cycleSpeed,
  });
  Input.init(renderer.domElement);
  Input.onKey((e) => {
    if (e.repeat) return;
    if (UI.choosing) {
      if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') UI.pick(Number(e.code.slice(5)) - 1);
      else if (e.code === 'Escape' || e.code === 'KeyL') UI.closeChoices();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (G.paused && inGame()) resume();
      else pause();
    } else if (e.code === 'KeyM') toggleMute();
    else if (G.paused) return;
    else if (e.code === 'KeyL') UI.openChoices();
    else if (e.code === 'BracketRight' || e.code === 'Equal' || e.code === 'NumpadAdd') cycleSpeed(1);
    else if (e.code === 'BracketLeft' || e.code === 'Minus' || e.code === 'NumpadSubtract') cycleSpeed(-1);
    else if (e.code === 'Space' || e.code === 'Enter') Waves.callEarly();
    else if (ABILITY_KEYS[e.code] && inGame()) UI.useAbility(ABILITY_KEYS[e.code]);
  });
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomWant = Math.max(0.7, Math.min(1.6, zoomWant * (e.deltaY > 0 ? 1.08 : 0.93)));
    },
    { passive: false },
  );
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
  on('waveClear', () => {
    resetAbilities();
    if (pendingChoices() > 0) autoPickT = 3;
  });

  if (G.autotest) {
    UI.showScreen(null);
    runAutotest(step);
    return;
  }
  if (G.debug) {
    initDebugKeys();
    window.addEventListener('error', (e) => UI.toast(`Error: ${e.message}`));
    (window as unknown as { HH: unknown }).HH = { G, hero, St, Units, Waves, engine };
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
