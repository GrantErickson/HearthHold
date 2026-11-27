/** Tiny event bus so modules can react to each other without import cycles at load time. */
export type GameEvent =
  | 'keepDestroyed'
  | 'purchase'
  | 'unlock'
  | 'waveStart'
  | 'waveClear'
  | 'victory'
  | 'structureLost'
  | 'levelUp'
  | 'statsChanged'
  | 'bossKilled'
  | 'actStart'
  | 'happening'
  /** Something the hero should deal with: { kind, ... } (see threats.ts). */
  | 'threat';

type Handler = (arg?: unknown) => void;
const handlers = new Map<GameEvent, Handler[]>();

export function on(ev: GameEvent, h: Handler): void {
  const list = handlers.get(ev) ?? [];
  list.push(h);
  handlers.set(ev, list);
}

export function emit(ev: GameEvent, arg?: unknown): void {
  const list = handlers.get(ev);
  if (list) for (const h of list) h(arg);
}
