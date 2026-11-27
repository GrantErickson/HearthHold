import * as THREE from 'three';
import { scene } from './engine';
import { G } from './state';
import { CFG } from './config';
import { Mat, wallGeo, towerGeo, smithGeo, barracksGeo, lumberGeo, lodgeGeo, catBaseGeo } from './models';
import * as St from './structures';
import { Units } from './units';
import { World, MINE_POS, QUARRY_SIGN_POS, type Rect } from './world';
import { hero } from './hero';
import { burst, fly, text } from './fx';
import { Sfx } from './audio';
import { emit } from './events';
import { easeOutBack } from './util';

export interface Req {
  /** Waves cleared. */
  wave?: number;
  keep?: number;
  built?: string[];
  flag?: string;
}

export interface Stage {
  name: string;
  icon: string;
  cost: number;
  req?: Req;
  desc?: string;
  buy: (s: Slot) => void;
}

interface PadView {
  group: THREE.Group;
  fill: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTex: THREE.CanvasTexture;
  faceKey: string;
  labelKey: string;
  anim: number;
  state: 'in' | 'shown' | 'out' | 'hidden';
}

export interface Slot {
  id: string;
  pad: { x: number; z: number };
  stages: Stage[];
  /** Slot ids that must be built before any stage shows. */
  needs?: string[];
  ghost?: { geo: () => THREE.BufferGeometry; x: number; z: number; hw: number; hd: number };
  rebuild?: (s: Slot) => void;
  stage: number;
  paid: number;
  destroyed: boolean;
  visible: boolean;
  acc: number;
  cooldown: number;
  view: PadView | null;
  struct: St.Structure | null;
  ghostMesh: THREE.Mesh | null;
}

type SlotDef = Pick<Slot, 'id' | 'pad' | 'stages'> & Partial<Pick<Slot, 'needs' | 'ghost' | 'rebuild'>>;

export const slots: Slot[] = [];
const byId = new Map<string, Slot>();

function def(d: SlotDef): void {
  const s: Slot = {
    ...d, stage: 0, paid: 0, destroyed: false, visible: false, acc: 0, cooldown: 0, view: null, struct: null, ghostMesh: null,
  };
  slots.push(s);
  byId.set(s.id, s);
}

// ───────────────────────────── Slot definitions ─────────────────────────────

const WZ = CFG.map.wallZ;

function wallSlot(i: number, req0: Req): void {
  const x = St.segCenter(i);
  const mk = (lv: number) => (s: Slot) => St.buildWall(i, lv, s);
  const hp = CFG.wall.hp;
  def({
    id: 'wall' + i,
    pad: { x, z: WZ + 2.8 },
    ghost: { geo: () => wallGeo(1), x, z: WZ, hw: 5, hd: 0.7 },
    stages: [
      { name: 'Palisade', icon: '🪵', cost: 25, req: req0, desc: 'Blocks raiders', buy: mk(1) },
      { name: 'Stone Wall', icon: '🧱', cost: 80, req: { keep: 2 }, desc: `Wall HP ${hp[0]} → ${hp[1]}`, buy: mk(2) },
      { name: 'Fortified Wall', icon: '🧱', cost: 220, req: { keep: 3 }, desc: `Wall HP ${hp[1]} → ${hp[2]}`, buy: mk(3) },
      { name: 'Iron Wall', icon: '🛡️', cost: 480, req: { keep: 4 }, desc: `Wall HP ${hp[2]} → ${hp[3]}`, buy: mk(4) },
    ],
    rebuild: (s) => St.buildWall(i, s.stage, s),
  });
}

function towerSlot(id: string, x: number, cost: number, req0: Req): void {
  const tz = -9;
  const mk = (lv: number) => (s: Slot) => St.buildTower(s, x, tz, lv);
  def({
    id,
    pad: { x, z: -5.4 },
    ghost: { geo: () => towerGeo(1), x, z: tz, hw: 1.3, hd: 1.3 },
    stages: [
      { name: 'Archer Tower', icon: '🏹', cost, req: req0, desc: 'Shoots raiders in range', buy: mk(1) },
      { name: 'Tower Lv 2', icon: '🏹', cost: 160, req: { wave: 3 }, desc: 'Stone tower, more damage', buy: mk(2) },
      { name: 'Tower Lv 3', icon: '🏹', cost: 420, req: { keep: 3 }, desc: 'Fires two arrows at once', buy: mk(3) },
    ],
    rebuild: (s) => St.buildTower(s, x, tz, s.stage),
  });
}

function upgradeSlot(id: string, x: number, z: number, icon: string, name: string, costs: number[], reqs: Req[], desc: (i: number) => string, apply: (lv: number) => void, needs?: string[]): void {
  def({
    id,
    pad: { x, z },
    needs,
    stages: costs.map((cost, i) => ({
      name: costs.length > 1 ? `${name} ${i + 1}/${costs.length}` : name,
      icon,
      cost,
      req: reqs[i],
      desc: desc(i),
      buy: () => apply(i + 1),
    })),
  });
}

/** Must be called once at boot, before the world is generated. */
export function initSlots(): void {
  if (slots.length) return;
  // Walls: center first, then the flanks.
  wallSlot(2, {});
  wallSlot(3, {});
  wallSlot(1, { wave: 1 });
  wallSlot(4, { wave: 1 });
  wallSlot(0, { wave: 3 });
  wallSlot(5, { wave: 3 });

  towerSlot('tower2', -9, 50, { flag: 'firstWall' });
  towerSlot('tower3', 9, 50, { flag: 'firstWall' });
  towerSlot('tower1', -20, 90, { wave: 2 });
  towerSlot('tower4', 20, 90, { wave: 2 });

  def({
    id: 'keep',
    pad: { x: 0, z: 6.0 },
    stages: [
      { name: 'Keep Lv 2', icon: '🏰', cost: 200, req: { wave: 3 }, desc: 'Unlocks stone walls, barracks, quarry', buy: () => St.setKeepLevel(2) },
      { name: 'Keep Lv 3', icon: '🏰', cost: 700, req: { wave: 8 }, desc: 'Keep archers, catapult, gold mine', buy: () => St.setKeepLevel(3) },
      { name: 'Keep Lv 4', icon: '🏰', cost: 1800, req: { wave: 13 }, desc: 'Iron walls, heavy catapult', buy: () => St.setKeepLevel(4) },
    ],
  });

  upgradeSlot('marketup', -13.2, -1, '🏪', 'Market Upgrade', [150, 500], [{ wave: 2 }, { keep: 3 }],
    (i) => (i === 0 ? 'Sells faster, +25% coins' : 'Sells fastest, +50% coins'), (lv) => St.setMarketLevel(lv + 1));
  upgradeSlot('backpack', -13.2, 2.6, '🎒', 'Bigger Backpack', [60, 180, 450, 900], [{ flag: 'firstSale' }, { wave: 2 }, { keep: 2 }, { keep: 3 }],
    (i) => `Carry ${CFG.hero.cap[i]} → ${CFG.hero.cap[i + 1]}`, (lv) => { G.up.backpack = lv; });

  def({
    id: 'blacksmith',
    pad: { x: 9, z: 2.6 },
    ghost: { geo: smithGeo, x: 9, z: -1, hw: 2.1, hd: 1.6 },
    stages: [{ name: 'Blacksmith', icon: '⚒️', cost: 120, req: { wave: 2 }, desc: 'Forge hero upgrades', buy: () => St.placeBuilding('blacksmith', smithGeo(), 9, -1, 2.1, 1.6) }],
  });
  const smith = ['blacksmith'];
  upgradeSlot('sword', 7.4, 2.6, '⚔️', 'Sharper Sword', [80, 200, 450, 900, 1600], [{}, {}, { keep: 2 }, { keep: 3 }, { keep: 4 }],
    (i) => `Damage ${CFG.hero.dmg[i]} → ${CFG.hero.dmg[i + 1]}`, (lv) => { G.up.sword = lv; }, smith);
  upgradeSlot('armor', 10.6, 2.6, '🛡️', 'Armor', [90, 240, 550, 1100], [{}, {}, { keep: 2 }, { keep: 3 }],
    (i) => `Max HP ${CFG.hero.hp[i]} → ${CFG.hero.hp[i + 1]}`, (lv) => { G.up.armor = lv; hero.hp = CFG.hero.hp[lv]; }, smith);
  upgradeSlot('tools', 13.8, 2.6, '⛏️', 'Better Tools', [70, 200, 500], [{}, {}, { keep: 2 }],
    (i) => `Gather ${Math.round((CFG.hero.harvest[i] / CFG.hero.harvest[i + 1] - 1) * 100)}% faster`, (lv) => { G.up.tools = lv; }, smith);
  upgradeSlot('boots', 13.8, -1, '👢', 'Swift Boots', [100, 300, 700], [{}, { keep: 2 }, { keep: 3 }],
    (i) => `Speed ${CFG.hero.speed[i]} → ${CFG.hero.speed[i + 1]}`, (lv) => { G.up.boots = lv; }, smith);

  def({
    id: 'barracks',
    pad: { x: -9, z: 6.0 },
    ghost: { geo: barracksGeo, x: -9, z: 11, hw: 2.4, hd: 2.1 },
    stages: [
      { name: 'Barracks', icon: '🛡️', cost: 250, req: { keep: 2 }, desc: 'Trains 2 soldiers', buy: () => { St.placeBuilding('barracks', barracksGeo(), -9, 11, 2.4, 2.1); St.setBarracksLevel(1); } },
      { name: 'Barracks Lv 2', icon: '🛡️', cost: 300, req: { keep: 2 }, desc: 'Up to 4 tougher soldiers', buy: () => St.setBarracksLevel(2) },
      { name: 'Barracks Lv 3', icon: '🛡️', cost: 700, req: { keep: 3 }, desc: 'Up to 6 soldiers', buy: () => St.setBarracksLevel(3) },
      { name: 'Barracks Lv 4', icon: '🛡️', cost: 1400, req: { keep: 4 }, desc: 'Up to 8 elite soldiers', buy: () => St.setBarracksLevel(4) },
    ],
  });

  def({
    id: 'lumber',
    pad: { x: -11, z: 17.4 },
    ghost: { geo: lumberGeo, x: -11, z: 21.5, hw: 1.8, hd: 1.5 },
    stages: [
      { name: 'Lumber Camp', icon: '🪓', cost: 80, req: { wave: 1 }, desc: 'Lets you hire lumberjacks', buy: () => St.placeBuilding('lumber', lumberGeo(), -11, 21.5, 1.8, 1.5) },
      ...[60, 110, 170, 250].map((cost, i): Stage => ({
        name: `Hire Lumberjack ${i + 1}/4`, icon: '🧔', cost, desc: 'Chops and sells wood for you', buy: () => Units.addWorker('lumber'),
      })),
    ],
  });

  def({
    id: 'quarry',
    pad: { x: 16.2, z: 6.4 },
    stages: [{ name: 'Open Quarry', icon: '⛏️', cost: 120, req: { keep: 2 }, desc: `Stone sells for ${CFG.res.stone.value} coins`, buy: () => World.openArea('stone', !G.autotest) }],
  });

  def({
    id: 'miners',
    pad: { x: 11, z: 17.4 },
    ghost: { geo: lodgeGeo, x: 11, z: 21.5, hw: 1.8, hd: 1.5 },
    stages: [
      { name: "Miners' Lodge", icon: '🏠', cost: 200, req: { built: ['quarry'] }, desc: 'Lets you hire miners', buy: () => St.placeBuilding('miners', lodgeGeo(), 11, 21.5, 1.8, 1.5) },
      ...[120, 200, 300, 450].map((cost, i): Stage => ({
        name: `Hire Miner ${i + 1}/4`, icon: '👷', cost, desc: 'Mines stone and gold for you', buy: () => Units.addWorker('miner'),
      })),
    ],
  });

  def({
    id: 'goldmine',
    pad: { x: 16.4, z: 12.6 },
    stages: [{ name: 'Open Gold Mine', icon: '🔶', cost: 450, req: { keep: 3 }, desc: `Gold ore sells for ${CFG.res.gold.value} coins`, buy: () => World.openArea('gold', !G.autotest) }],
  });

  def({
    id: 'catapult',
    pad: { x: 0, z: -5.2 },
    ghost: { geo: () => catBaseGeo(1), x: 0, z: -8.6, hw: 1.1, hd: 1.4 },
    stages: [
      { name: 'Catapult', icon: '☄️', cost: 900, req: { keep: 3 }, desc: 'Hurls boulders at groups', buy: (s) => St.buildCatapult(s, 1) },
      { name: 'Heavy Catapult', icon: '☄️', cost: 2000, req: { keep: 4 }, desc: 'Bigger boulders, faster', buy: (s) => St.buildCatapult(s, 2) },
    ],
    rebuild: (s) => St.buildCatapult(s, s.stage),
  });
}

/** Areas the world generator must keep clear of trees and rocks. */
export function reservedRects(): Rect[] {
  const r: Rect[] = [];
  for (const s of slots) {
    r.push({ x: s.pad.x, z: s.pad.z, hw: 1.6, hd: 1.6 });
    if (s.ghost) r.push({ x: s.ghost.x, z: s.ghost.z, hw: s.ghost.hw + 0.6, hd: s.ghost.hd + 0.6 });
  }
  r.push({ x: 0, z: 13, hw: 4.2, hd: 4.2 });
  r.push({ x: St.market.x, z: St.market.z, hw: 3, hd: 2.2 });
  r.push({ x: St.market.drop.x, z: St.market.drop.z, hw: 1.6, hd: 1.6 });
  r.push({ x: St.market.coin.x, z: St.market.coin.z, hw: 1.6, hd: 1.6 });
  r.push({ x: MINE_POS.x, z: MINE_POS.z, hw: 4.5, hd: 2.2 });
  r.push({ x: QUARRY_SIGN_POS.x, z: QUARRY_SIGN_POS.z, hw: 1, hd: 1 });
  return r;
}

// ───────────────────────────── Rules ─────────────────────────────

export const getSlot = (id: string): Slot | undefined => byId.get(id);
export const isBuilt = (id: string): boolean => {
  const s = byId.get(id);
  return !!s && s.stage >= 1 && !s.destroyed;
};

function reqMet(req?: Req): boolean {
  if (!req) return true;
  if (req.wave !== undefined && G.wavesCleared < req.wave) return false;
  if (req.keep !== undefined && G.keepLevel < req.keep) return false;
  if (req.flag && !G.flags[req.flag]) return false;
  if (req.built && !req.built.every(isBuilt)) return false;
  return true;
}

function shouldShow(s: Slot): boolean {
  if (s.cooldown > 0) return false;
  if (s.destroyed) return true;
  if (s.stage >= s.stages.length) return false;
  if (s.needs && !s.needs.every(isBuilt)) return false;
  return reqMet(s.stages[s.stage].req);
}

export function costOf(s: Slot): number {
  if (s.destroyed) return Math.ceil(s.stages[s.stage - 1].cost * 0.5);
  return s.stages[s.stage]?.cost ?? 0;
}

export function nameOf(s: Slot): string {
  if (s.destroyed) return `Rebuild ${s.stages[s.stage - 1].name}`;
  return s.stages[s.stage]?.name ?? '';
}

// ───────────────────────────── Pad visuals ─────────────────────────────

const PAD = 2.6;
const INNER = PAD - 0.36;
const baseGeo = new THREE.PlaneGeometry(PAD, PAD).rotateX(-Math.PI / 2);
const fillGeo = new THREE.PlaneGeometry(INNER, INNER).rotateX(-Math.PI / 2).translate(0, 0, -INNER / 2);
const baseMat = new THREE.MeshBasicMaterial({ color: 0x1b2433, transparent: true, opacity: 0.3, depthWrite: false });
const fillMat = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.85, depthWrite: false });
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const TEXT_FONT = '"Lilita One","Trebuchet MS",system-ui,sans-serif';

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawCoin(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.fillStyle = '#c9961f';
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffd54a';
  c.beginPath();
  c.arc(x, y - r * 0.08, r * 0.86, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffe98a';
  c.beginPath();
  c.arc(x, y - r * 0.08, r * 0.55, 0, Math.PI * 2);
  c.fill();
}

export type PadStyle = 'buy' | 'sell' | 'coins' | 'rebuild';

function makeView(x: number, z: number): PadView {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.03;
  base.renderOrder = 1;
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.set(0, 0.04, INNER / 2);
  fill.scale.z = 0.001;
  fill.renderOrder = 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  face.position.y = 0.05;
  face.renderOrder = 3;
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 150;
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false, opacity: 0 }));
  label.scale.set(4.3, 1.26, 1);
  label.position.set(0, 2.5, -0.9);
  label.renderOrder = 40;
  group.add(base, fill, face, label);
  group.visible = false;
  group.scale.setScalar(0.001);
  scene.add(group);
  return { group, fill, canvas, tex, label, labelCanvas, labelTex, faceKey: '', labelKey: '', anim: 0, state: 'hidden' };
}

function drawFace(v: PadView, style: PadStyle, icon: string, cost: number, canAfford: boolean): void {
  const key = `${style}|${icon}|${cost}|${canAfford}`;
  if (key === v.faceKey) return;
  v.faceKey = key;
  const c = v.canvas.getContext('2d')!;
  c.clearRect(0, 0, 256, 256);
  const border = style === 'sell' ? '#a6ef85' : style === 'coins' ? '#ffd54a' : style === 'rebuild' ? '#ff9a76' : '#ffffff';
  c.lineWidth = 12;
  c.strokeStyle = border;
  c.setLineDash([30, 16]);
  roundRect(c, 14, 14, 228, 228, 34);
  c.stroke();
  c.setLineDash([]);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const outline = (txt: string, x: number, y: number, size: number, fill: string) => {
    c.font = `${size}px ${TEXT_FONT}`;
    c.lineWidth = size * 0.18;
    c.strokeStyle = 'rgba(20,24,40,0.75)';
    c.lineJoin = 'round';
    c.strokeText(txt, x, y);
    c.fillStyle = fill;
    c.fillText(txt, x, y);
  };
  if (style === 'sell') {
    outline('SELL', 128, 92, 70, '#ffffff');
    c.fillStyle = '#a6ef85';
    c.beginPath();
    c.moveTo(88, 150);
    c.lineTo(168, 150);
    c.lineTo(128, 205);
    c.closePath();
    c.fill();
  } else if (style === 'coins') {
    drawCoin(c, 128, 118, 58);
    outline('COINS', 128, 205, 44, '#ffe98a');
  } else {
    c.font = `92px ${EMOJI_FONT}`;
    c.fillStyle = '#ffffff';
    c.fillText(icon, 128, 98);
    const txt = String(cost);
    c.font = `64px ${TEXT_FONT}`;
    const w = c.measureText(txt).width;
    const cx = 128 + 22;
    drawCoin(c, cx - w / 2 - 30, 190, 22);
    outline(txt, cx, 192, 64, canAfford ? '#ffffff' : '#ffb4a8');
  }
  v.tex.needsUpdate = true;
}

function drawLabel(v: PadView, name: string, desc: string): void {
  const key = `${name}|${desc}`;
  if (key === v.labelKey) return;
  v.labelKey = key;
  const c = v.labelCanvas.getContext('2d')!;
  c.clearRect(0, 0, 512, 150);
  c.font = `46px ${TEXT_FONT}`;
  const w1 = c.measureText(name).width;
  c.font = `28px ${TEXT_FONT}`;
  const w2 = desc ? c.measureText(desc).width : 0;
  const w = Math.min(500, Math.max(w1, w2) + 44);
  c.fillStyle = 'rgba(20,24,40,0.78)';
  roundRect(c, 256 - w / 2, desc ? 14 : 40, w, desc ? 122 : 70, 26);
  c.fill();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#ffffff';
  c.font = `46px ${TEXT_FONT}`;
  c.fillText(name, 256, desc ? 56 : 76, 480);
  if (desc) {
    c.fillStyle = '#ffd86b';
    c.font = `28px ${TEXT_FONT}`;
    c.fillText(desc, 256, 106, 480);
  }
  v.labelTex.needsUpdate = true;
}

/** Fixed pads (SELL / COINS) that never get bought. */
export function makeStaticPad(x: number, z: number, style: 'sell' | 'coins', name: string, desc: string): void {
  const v = makeView(x, z);
  const sp = { v, draw: () => { drawFace(v, style, '', 0, true); drawLabel(v, name, desc); } };
  sp.draw();
  v.group.visible = true;
  v.group.scale.setScalar(1);
  v.state = 'shown';
  staticPads.push(sp);
}
const staticPads: { v: PadView; draw: () => void }[] = [];

function showView(s: Slot): void {
  if (!s.view) s.view = makeView(s.pad.x, s.pad.z);
  const v = s.view;
  v.group.visible = true;
  v.state = 'in';
  v.anim = 0;
  v.fill.scale.z = 0.001;
  refreshFace(s);
  if (s.ghost && s.stage === 0 && !s.destroyed && !s.ghostMesh) {
    const gm = new THREE.Mesh(s.ghost.geo(), Mat.ghost);
    gm.position.set(s.ghost.x, 0.02, s.ghost.z);
    gm.renderOrder = 4;
    scene.add(gm);
    s.ghostMesh = gm;
  }
}

function hideView(s: Slot): void {
  if (s.view && s.view.state !== 'hidden') {
    s.view.state = 'out';
    s.view.anim = 0;
  }
  if (s.ghostMesh) {
    scene.remove(s.ghostMesh);
    s.ghostMesh = null;
  }
}

function refreshFace(s: Slot): void {
  const v = s.view;
  if (!v) return;
  const cost = costOf(s);
  const remaining = cost - s.paid;
  const icon = s.destroyed ? '🔨' : s.stages[s.stage]?.icon ?? '';
  drawFace(v, s.destroyed ? 'rebuild' : 'buy', icon, remaining, G.coins >= remaining);
  drawLabel(v, nameOf(s), s.destroyed ? 'Half price' : s.stages[s.stage]?.desc ?? '');
  v.fill.scale.z = Math.max(0.001, s.paid / Math.max(1, cost));
}

function animView(v: PadView, dt: number, near: boolean): void {
  if (v.state === 'in') {
    v.anim = Math.min(1, v.anim + dt / 0.45);
    v.group.scale.setScalar(Math.max(0.001, easeOutBack(v.anim)));
    if (v.anim >= 1) v.state = 'shown';
  } else if (v.state === 'out') {
    v.anim = Math.min(1, v.anim + dt / 0.25);
    v.group.scale.setScalar(Math.max(0.001, 1 - v.anim));
    if (v.anim >= 1) {
      v.state = 'hidden';
      v.group.visible = false;
    }
  }
  const mat = v.label.material as THREE.SpriteMaterial;
  const target = near && v.state !== 'out' && v.state !== 'hidden' ? 1 : 0;
  mat.opacity += (target - mat.opacity) * Math.min(1, dt * 8);
  v.label.visible = mat.opacity > 0.02;
}

// ───────────────────────────── Update ─────────────────────────────

let refreshT = 0;
let payFxT = 0;
let lastOn: Slot | null = null;
let denied = false;

export function refreshPads(silent: boolean): void {
  for (const s of slots) {
    const v = shouldShow(s);
    if (v && !s.visible) {
      s.visible = true;
      showView(s);
      if (!silent) {
        if (s.stage === 0 && !s.destroyed) emit('unlock', s);
        else Sfx.play('unlock', 0.4);
      }
    } else if (!v && s.visible) {
      s.visible = false;
      hideView(s);
    }
  }
}

function complete(s: Slot): void {
  let label: string;
  if (s.destroyed) {
    s.destroyed = false;
    s.rebuild?.(s);
    label = 'Rebuilt!';
  } else {
    const st = s.stages[s.stage];
    s.stage++;
    st.buy(s);
    label = st.name.replace(/ \d+\/\d+$/, '');
  }
  s.paid = 0;
  s.acc = 0;
  s.cooldown = 0.8;
  s.visible = false;
  hideView(s);
  G.stats.built++;
  burst(s.pad.x, 0.4, s.pad.z, 0xffd54a, 22, { speed: 5, up: 6, size: 0.16, life: 0.8 });
  burst(s.pad.x, 0.2, s.pad.z, 0xffffff, 12, { speed: 4, up: 2, size: 0.2, life: 0.6 });
  Sfx.play('build');
  text(s.pad.x, 2.6, s.pad.z, label, 'gold big', 1.4);
  emit('purchase', s);
}

function pay(s: Slot, dt: number): void {
  const cost = costOf(s);
  const remaining = cost - s.paid;
  if (remaining <= 0) {
    complete(s);
    return;
  }
  if (G.coins <= 0) {
    if (!denied) {
      denied = true;
      text(hero.x, 2.8, hero.z, 'Need coins!', 'red');
      Sfx.play('deny');
    }
    return;
  }
  const rate = Math.max(30, cost * 1.1);
  s.acc += rate * dt;
  let amt = Math.floor(s.acc);
  if (amt <= 0) return;
  amt = Math.min(amt, remaining, G.coins);
  s.acc = Math.min(1, s.acc - amt);
  G.coins -= amt;
  s.paid += amt;
  payFxT -= dt;
  if (payFxT <= 0) {
    payFxT = 0.05;
    const px = s.pad.x, pz = s.pad.z;
    fly('coin', new THREE.Vector3(hero.x, 1.3, hero.z), () => new THREE.Vector3(px, 0.15, pz), { dur: 0.22, arc: 0.7 });
    Sfx.play('pay');
  }
  if (s.paid >= cost) complete(s);
}

/** The pad the hero is standing on, if any. */
export function padUnderHero(): Slot | null {
  if (!hero.alive) return null;
  let on: Slot | null = null;
  let best = Infinity;
  for (const s of slots) {
    if (!s.visible || s.cooldown > 0) continue;
    const dx = Math.abs(hero.x - s.pad.x);
    const dz = Math.abs(hero.z - s.pad.z);
    if (dx < 1.4 && dz < 1.4 && dx + dz < best) {
      best = dx + dz;
      on = s;
    }
  }
  return on;
}

export function updatePads(dt: number): void {
  refreshT -= dt;
  if (refreshT <= 0) {
    refreshT = 0.25;
    refreshPads(false);
  }
  const on = padUnderHero();
  if (on !== lastOn) {
    denied = false;
    lastOn = on;
  }
  if (on) pay(on, dt);

  for (const s of slots) {
    if (s.cooldown > 0) s.cooldown -= dt;
    if (!s.view) continue;
    if (s.visible) refreshFace(s);
    const near = Math.hypot(hero.x - s.pad.x, hero.z - s.pad.z) < 6.5;
    animView(s.view, dt, near);
  }
  for (const { v } of staticPads) {
    const p = v.group.position;
    animView(v, dt, Math.hypot(hero.x - p.x, hero.z - p.z) < 6.5);
  }
  for (const s of slots) {
    if (s.ghostMesh) (s.ghostMesh.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(G.time * 3) * 0.06;
  }
}

/** Redraw all canvases once the web font has loaded. */
export function redrawPadText(): void {
  for (const sp of staticPads) {
    sp.v.faceKey = '';
    sp.v.labelKey = '';
    sp.draw();
  }
  for (const s of slots) {
    if (s.view) {
      s.view.faceKey = '';
      s.view.labelKey = '';
      if (s.visible) refreshFace(s);
    }
  }
}
