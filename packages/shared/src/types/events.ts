// Eventos internos do cliente (event bus em apps/game/src/core/bus.ts).
// Mapa nome -> tipo do payload. Para adicionar um evento, peça à Fundação (A0).

import type { ApiError } from './errors';
import type { BootstrapResult } from './api';
import type {
  ActiveBuff,
  AnimalState,
  CardInstance,
  DayPhase,
  EpochMs,
  Extraction,
  FarmClockSeconds,
  InventoryEntry,
  ItemId,
  PlotSlotId,
  PlotState,
  ProgressState,
  PublicProfile,
  TripState,
  VehicleId,
  VehicleState,
  Wallet,
  WeatherKind,
} from './models';
import type { NotificationRow } from './realtime';

export type PanelId =
  | 'inventory'
  | 'shop'
  | 'cards'
  | 'album'
  | 'extraction'
  | 'plant'
  | 'unlock'
  | 'explore'
  | 'social'
  | 'settings'
  | 'offline-report';

/** Parâmetros dos painéis. `plant`/`unlock` exigem `slotId`. */
export type PanelParams = {
  slotId?: PlotSlotId;
  itemId?: ItemId;
  vehicleId?: VehicleId;
};

export type OpenPanelPayload =
  | { panel: 'plant' | 'unlock'; params: PanelParams & { slotId: PlotSlotId } }
  | { panel: Exclude<PanelId, 'plant' | 'unlock'>; params?: PanelParams };

/** Ação do jogador no mundo (para animação, som e tutorial). */
export type FarmActionKind = 'harvest' | 'collect' | 'plant' | 'water';
export interface FarmActionPayload {
  kind: FarmActionKind;
  slotId?: PlotSlotId;
  animalId?: string;
}
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ClientEvents {
  'farm:snapshot': BootstrapResult;
  'plot:updated': PlotState;
  'animal:updated': AnimalState;
  /** Itens cuja quantidade mudou (quantidade absoluta). Itens `card_*` = cópias no álbum. */
  'inventory:changed': { changes: InventoryEntry[]; gained?: InventoryEntry[] };
  'wallet:changed': Wallet & { bonusCoins?: number };
  'xp:changed': ProgressState & { leveledUp: boolean };
  /** Cartas novas/alteradas (drop, uso). `dropped` = só as recém-ganhas. */
  'cards:changed': { changed: CardInstance[]; dropped: CardInstance[] };
  /** Lista completa de buffs em vigor. */
  'buffs:changed': { active: ActiveBuff[] };
  /** Disparado ~1x por segundo com o relógio estimado (só visual). */
  'time:tick': { serverNow: EpochMs; farmClock: FarmClockSeconds };
  'time:phase': { phase: DayPhase; localHour: number };
  'weather:changed': { weather: WeatherKind };
  'event:night-start': { endsAt: EpochMs };
  'event:night-end': Record<string, never>;
  'ui:open-panel': OpenPanelPayload;
  'farm:action': FarmActionPayload;
  /** Exploração mudou (despacho, volta, recolha, compra, conserto, melhoria). */
  'explore:changed': { vehicle?: VehicleState; trip?: TripState; tripsToday?: number };
  'ui:toast': { kind: ToastKind; text: string };
  'api:error': { error: ApiError; op: string };
  'extraction:changed': { extraction: Extraction };
  /** Notificação vinda do canal Realtime user:{uid}. */
  'notify:received': NotificationRow;
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
  'cards:changed',
  'buffs:changed',
  'time:tick',
  'time:phase',
  'weather:changed',
  'event:night-start',
  'event:night-end',
  'ui:open-panel',
  'farm:action',
  'explore:changed',
  'ui:toast',
  'api:error',
  'extraction:changed',
  'notify:received',
  'visit:presence',
  'debug:toggle-layout',
] as const satisfies readonly ClientEventName[];
