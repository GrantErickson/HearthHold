import { G, type Upgrades, type Research } from './state';
import { slots, getSlot, refreshPads } from './pads';
import * as St from './structures';
import { Units } from './units';
import { emit } from './events';
import { campsSave, campsRestore } from './camps';
import type { CampKind } from './config';

const KEY = 'hearthold-save-v2';

export interface SaveData {
  v: 2;
  wavesCleared: number;
  coins: number;
  endless: boolean;
  tut: number;
  flags: Record<string, boolean>;
  stats: typeof G.stats;
  /** [slot id, stage, destroyed (0/1), partial payment] */
  slots: [string, number, number, number][];
  marketPile: number;
  level: number;
  xp: number;
  perks: Record<string, number>;
  relics: string[];
  pendingPerks: number;
  pendingRelics: number;
  up: Upgrades;
  research: Research;
  /** Enemy camps still standing: [kind, x, z, hp fraction, wave]. */
  camps?: [CampKind, number, number, number, number][];
}

export const Save = {
  snapshot(): SaveData {
    const flags = { ...G.flags };
    delete flags.merchant;
    return {
      v: 2,
      wavesCleared: G.wavesCleared,
      coins: Math.floor(G.coins),
      endless: G.endless,
      tut: G.tut,
      flags,
      stats: { ...G.stats },
      slots: slots.filter((s) => !s.temp).map((s) => [s.id, s.stage, s.destroyed ? 1 : 0, s.paid]),
      marketPile: St.market.pile,
      level: G.level,
      xp: Math.floor(G.xp),
      perks: { ...G.perks },
      relics: [...G.relics],
      pendingPerks: G.pendingPerks,
      pendingRelics: G.pendingRelics,
      up: { ...G.up },
      research: { ...G.research },
      camps: campsSave(),
    };
  },

  write(): void {
    if (G.autotest) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(Save.snapshot()));
    } catch {
      /* storage full or blocked: the game keeps running without a checkpoint */
    }
  },

  read(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d && d.v === 2 && Array.isArray(d.slots) ? d : null;
    } catch {
      return null;
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },

  /** Rebuild the village by replaying every purchase in the checkpoint. */
  restore(d: SaveData): void {
    G.flags = { ...d.flags };
    // Progression first so HP multipliers are right when structures are built.
    G.level = d.level || 1;
    G.xp = d.xp || 0;
    G.perks = { ...(d.perks ?? {}) };
    G.relics = [...(d.relics ?? [])];
    G.pendingPerks = d.pendingPerks || 0;
    G.pendingRelics = d.pendingRelics || 0;
    for (const [id, stage, destroyed, paid] of d.slots) {
      const s = getSlot(id);
      if (!s || s.temp) continue;
      const n = Math.min(stage, s.stages.length);
      for (let i = 0; i < n; i++) {
        s.stage = i + 1;
        s.stages[i].buy(s);
      }
      s.stage = n;
      s.paid = paid || 0;
      if (destroyed && s.struct) St.ruin(s.struct);
    }
    G.wavesCleared = d.wavesCleared;
    G.coins = d.coins;
    G.endless = d.endless;
    G.tut = d.tut;
    G.flags = { ...G.flags, ...d.flags };
    G.stats = { ...G.stats, ...d.stats };
    St.market.pile = d.marketPile || 0;
    campsRestore(d.camps);
    emit('statsChanged');
    St.repairAll();
    Units.fillSoldiers();
    refreshPads(true);
  },
};
