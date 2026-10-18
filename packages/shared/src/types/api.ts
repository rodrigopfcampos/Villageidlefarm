// Interface IApi: implementada por net/mockApi.ts (memória) e net/api.ts (Supabase, agente A2).
// Toda chamada que mexe em valor recebe `requestId` (UUID gerado no cliente).
// Erros: sempre ApiError (ver errors.ts).

import type {
  AnimalState,
  AnimalType,
  EpochMs,
  FarmClockSeconds,
  FarmSnapshot,
  InventoryEntry,
  ItemId,
  MarketListing,
  MarketTrade,
  OfflineReport,
  PlotSlotId,
  PlotState,
  PricePoint,
  Profile,
  ProgressState,
  PublicFarmSnapshot,
  PublicProfile,
  RequestId,
  ServerTime,
  Wallet,
  WorldState,
} from './models';

/**
 * Retorno padrão de toda mutação. O cliente aplica no store sem recarregar tudo.
 * - `inventoryChanges`: quantidades ABSOLUTAS novas dos itens que mudaram (qty 0 = sumiu).
 * - `plots` / `animals`: estado completo das entidades que mudaram.
 * - `xp`: nível e xp totais depois da ação.
 * - `gained`: o que entrou no inventário nesta ação (deltas positivos), só para efeitos visuais.
 */
export interface MutationResult {
  wallet?: Wallet;
  inventoryChanges?: InventoryEntry[];
  plots?: PlotState[];
  animals?: AnimalState[];
  xp?: ProgressState;
  gained?: InventoryEntry[];
  farmClock: FarmClockSeconds;
  serverNow: EpochMs;
}

export interface BootstrapResult {
  profile: Profile;
  wallet: Wallet;
  inventory: InventoryEntry[];
  farm: FarmSnapshot;
  offlineReport: OfflineReport;
  serverNow: EpochMs;
}

export interface HeartbeatResult {
  farmClock: FarmClockSeconds;
  serverNow: EpochMs;
  /** Crédito aplicado nesta sincronização (útil para depuração). */
  creditedSeconds: number;
}

// ---------- parâmetros ----------

export interface Mutation {
  requestId: RequestId;
}

export interface PlantParams extends Mutation {
  slotId: PlotSlotId;
  seedItemId: ItemId;
}
export interface HarvestParams extends Mutation {
  slotId: PlotSlotId;
}
export type HarvestAllParams = Mutation;
export interface UnlockSlotParams extends Mutation {
  slotId: PlotSlotId;
}
export interface BuyAnimalParams extends Mutation {
  animalType: AnimalType;
}
export interface CollectAnimalParams extends Mutation {
  animalId: string;
}
export interface ShopTradeParams extends Mutation {
  itemId: ItemId;
  qty: number;
}

export interface SetTimezoneParams extends Mutation {
  tz: string;
}
export type ClaimNightEventParams = Mutation;

export interface MarketCreateListingParams extends Mutation {
  itemId: ItemId;
  qty: number;
  priceEach: number;
}
export interface MarketBuyParams extends Mutation {
  listingId: string;
  qty: number;
}
export interface MarketCancelParams extends Mutation {
  listingId: string;
}
export type MarketSort = 'price_asc' | 'price_desc' | 'newest';
export interface MarketSearchParams {
  itemId?: ItemId;
  sort: MarketSort;
  page: number;
}
export interface Page<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

export type VisitInteractKind = 'like' | 'water';
export interface VisitInteractParams extends Mutation {
  hostId: string;
  kind: VisitInteractKind;
}

export interface MarketListingResult extends MutationResult {
  listing: MarketListing;
}
export interface MarketBuyResult extends MutationResult {
  trade: MarketTrade;
}
export interface ClaimNightEventResult extends MutationResult {
  eventKey: string;
}
export interface VisitCandidate extends PublicProfile {
  farmId: string;
  visitedToday: boolean;
}

// ---------- interface ----------

export interface IApi {
  // Núcleo
  bootstrap(): Promise<BootstrapResult>;
  heartbeat(): Promise<HeartbeatResult>;
  getServerTime(): Promise<ServerTime>;
  plant(p: PlantParams): Promise<MutationResult>;
  harvest(p: HarvestParams): Promise<MutationResult>;
  harvestAll(p: HarvestAllParams): Promise<MutationResult>;
  unlockSlot(p: UnlockSlotParams): Promise<MutationResult>;
  buyAnimal(p: BuyAnimalParams): Promise<MutationResult>;
  collectAnimal(p: CollectAnimalParams): Promise<MutationResult>;
  shopBuy(p: ShopTradeParams): Promise<MutationResult>;
  shopSell(p: ShopTradeParams): Promise<MutationResult>;

  // Tempo
  getWorldState(): Promise<WorldState>;
  setTimezone(p: SetTimezoneParams): Promise<Profile>;
  claimNightEvent(p: ClaimNightEventParams): Promise<ClaimNightEventResult>;

  // Mercado
  marketCreateListing(p: MarketCreateListingParams): Promise<MarketListingResult>;
  marketBuy(p: MarketBuyParams): Promise<MarketBuyResult>;
  marketCancel(p: MarketCancelParams): Promise<MarketListingResult>;
  marketSearch(p: MarketSearchParams): Promise<Page<MarketListing>>;
  marketMyListings(): Promise<MarketListing[]>;
  marketPriceHistory(itemId: ItemId): Promise<PricePoint[]>;

  // Visitas
  visitListCandidates(page: number): Promise<Page<VisitCandidate>>;
  visitGetFarm(hostId: string): Promise<PublicFarmSnapshot>;
  visitInteract(p: VisitInteractParams): Promise<MutationResult>;
}

/** Nome do RPC no Postgres para cada método de IApi (argumentos em snake_case: slot_id, request_id…). */
export const RPC_NAMES = {
  bootstrap: 'bootstrap',
  heartbeat: 'heartbeat',
  getServerTime: 'get_server_time',
  plant: 'plant',
  harvest: 'harvest',
  harvestAll: 'harvest_all',
  unlockSlot: 'unlock_slot',
  buyAnimal: 'buy_animal',
  collectAnimal: 'collect_animal',
  shopBuy: 'shop_buy',
  shopSell: 'shop_sell',
  getWorldState: 'get_world_state',
  setTimezone: 'set_timezone',
  claimNightEvent: 'claim_night_event',
  marketCreateListing: 'market_create_listing',
  marketBuy: 'market_buy',
  marketCancel: 'market_cancel',
  marketSearch: 'market_search',
  marketMyListings: 'market_my_listings',
  marketPriceHistory: 'market_price_history',
  visitListCandidates: 'visit_list_candidates',
  visitGetFarm: 'visit_get_farm',
  visitInteract: 'visit_interact',
} as const satisfies Record<keyof IApi, string>;

/** Limites de economia usados pela mock e pelo servidor. */
export const ECONOMY = {
  /** Crédito máximo de produção offline (8 h). */
  OFFLINE_CAP_SECONDS: 28_800,
  /** Intervalo do heartbeat com o jogo aberto. */
  HEARTBEAT_INTERVAL_MS: 5 * 60_000,
  /** Quantidade máxima por compra/venda na loja NPC. */
  SHOP_MAX_QTY: 999,
  MARKET_FEE_PERCENT: 5,
  MARKET_MAX_ACTIVE_LISTINGS: 20,
  MARKET_LISTING_HOURS: 48,
} as const;
