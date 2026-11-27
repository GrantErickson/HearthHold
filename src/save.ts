import { G } from './state';
import { slots, getSlot, refreshPads } from './pads';
import * as St from './structures';
import { Units } from './units';

const KEY = 'hearthold-save-v1';

export interface SaveData {
  v: 1;
  wavesCleared: number;
  coins: number;
  endless: boolean;
  tut: number;
  flags: Record<string, boolean>;
  stats: { kills: number; earned: number; built: number };
  /** [slot id, stage, destroyed (0/1), partial payment] */
  slots: [string, number, number, number][];
  marketPile: number;
}

export const Save = {
  snapshot(): SaveData {
    return {
      v: 1,
      wavesCleared: G.wavesCleared,
      coins: G.coins,
      endless: G.endless,
      tut: G.tut,
      flags: { ...G.flags },
      stats: { ...G.stats },
      slots: slots.map((s) => [s.id, s.stage, s.destroyed ? 1 : 0, s.paid]),
      marketPile: St.market.pile,
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
      return d && d.v === 1 && Array.isArray(d.slots) ? d : null;
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
    for (const [id, stage, destroyed, paid] of d.slots) {
      const s = getSlot(id);
      if (!s) continue;
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
    G.stats = { ...d.stats };
    St.market.pile = d.marketPile || 0;
    Units.fillSoldiers();
    refreshPads(true);
  },
};
