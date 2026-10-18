// Eventos internos do cliente (event bus em apps/game/src/core/bus.ts).
// Mapa nome -> tipo do payload. Para adicionar um evento, peça à Fundação (A0).

import type { ApiError } from './errors';
import type { BootstrapResult } from './api';
import type {
  AnimalState,
  DayPhase,
  EpochMs,
  FarmClockSeconds,
  InventoryEntry,
  MarketListing,
  PlotState,
  ProgressState,
  PublicProfile,
  Wallet,
  WeatherKind,
} from './models';

export type PanelId = 'inventory' | 'shop' | 'market' | 'social' | 'settings' | 'offline-report';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ClientEvents {
  'farm:snapshot': BootstrapResult;
  'plot:updated': PlotState;
  'animal:updated': AnimalState;
  /** Itens cuja quantidade mudou (quantidade absoluta). */
  'inventory:changed': { changes: InventoryEntry[]; gained?: InventoryEntry[] };
  'wallet:changed': Wallet;
  'xp:changed': ProgressState & { leveledUp: boolean };
  /** Disparado ~1x por segundo com o relógio estimado (só visual). */
  'time:tick': { serverNow: EpochMs; farmClock: FarmClockSeconds };
  'time:phase': { phase: DayPhase; localHour: number };
  'weather:changed': { weather: WeatherKind };
  'event:night-start': { endsAt: EpochMs };
  'event:night-end': Record<string, never>;
  'ui:open-panel': { panel: PanelId; params?: Record<string, unknown> };
  'ui:toast': { kind: ToastKind; text: string };
  'api:error': { error: ApiError; op: string };
  'market:listing-changed': { listing: MarketListing };
  'notify:sold': { listingId: string; itemId: string; qty: number; coins: number };
  'visit:presence': { farmId: string; visitors: PublicProfile[] };
  /** Ferramenta de desenvolvimento: liga/desliga a sobreposição do layout. */
  'debug:toggle-layout': { visible?: boolean };
}

export type ClientEventName = keyof ClientEvents;

export const CLIENT_EVENT_NAMES = [
  'farm:snapshot',
  'plot:updated',
  'animal:updated',
  'inventory:changed',
  'wallet:changed',
  'xp:changed',
  'time:tick',
  'time:phase',
  'weather:changed',
  'event:night-start',
  'event:night-end',
  'ui:open-panel',
  'ui:toast',
  'api:error',
  'market:listing-changed',
  'notify:sold',
  'visit:presence',
  'debug:toggle-layout',
] as const satisfies readonly ClientEventName[];
