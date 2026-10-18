// Interface IApi: implementada por net/mockApi.ts (memória) e net/api.ts (Supabase, agente A2).
// Toda chamada que mexe em valor recebe `requestId` (UUID gerado no cliente).
// Erros: sempre ApiError (ver errors.ts).
// Não existe mercado interno (DECISOES.md): o comércio é no mercado da Steam via retirada/volta.

import type {
  ActiveBuff,
  Album,
  AnimalState,
  AnimalType,
  CardInstance,
  EpochMs,
  Extraction,
  ExtractionQuota,
  FarmClockSeconds,
  FarmSnapshot,
  InventoryEntry,
  ItemId,
  OfflineReport,
  PlotSlotId,
  PlotState,
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
 *   Inclui itens de carta usada (`card_*`) = cópias no álbum.
 * - `plots` / `animals`: estado completo das entidades que mudaram.
 * - `xp`: níveis e xp totais depois da ação.
 * - `gained`: o que entrou no inventário nesta ação (deltas positivos), só para efeitos visuais.
 * - `bonusCoins`: moedas extras de buffs (carta de Ouro, álbum) já somadas em `wallet`.
 * - `cards`: cartas novas ou que mudaram (drop, uso).
 * - `activeBuffs`: lista COMPLETA de buffs em vigor, quando mudou.
 */
export interface MutationResult {
  wallet?: Wallet;
  inventoryChanges?: InventoryEntry[];
  plots?: PlotState[];
  animals?: AnimalState[];
  xp?: ProgressState;
  gained?: InventoryEntry[];
  bonusCoins?: number;
  cards?: CardInstance[];
  activeBuffs?: ActiveBuff[];
  farmClock: FarmClockSeconds;
  serverNow: EpochMs;
}

export interface BootstrapResult {
  profile: Profile;
  wallet: Wallet;
  inventory: InventoryEntry[];
  farm: FarmSnapshot;
  /** Cartas ainda não usadas. */
  cards: CardInstance[];
  activeBuffs: ActiveBuff[];
  offlineReport: OfflineReport;
  serverNow: EpochMs;
}

export interface HeartbeatResult {
  farmClock: FarmClockSeconds;
  serverNow: EpochMs;
  /** Crédito aplicado nesta sincronização (útil para depuração). */
  creditedSeconds: number;
  /** Canteiros que o evento noturno acelerou nesta sincronização. */
  plots?: PlotState[];
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

export interface CardActivateParams extends Mutation {
  instanceId: string;
}

export interface ExtractionRequestParams extends Mutation {
  itemId: ItemId;
  qty: number;
}
export interface SteamReturnSyncParams extends Mutation {
  /** Itens do inventário Steam (lidos no cliente pelo Steamworks) que o jogador quer trazer de volta. */
  steamItemIds: string[];
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

export interface ClaimNightEventResult extends MutationResult {
  /** A carta garantida (também vem em `cards`). */
  card: CardInstance;
}
export interface ExtractionResult extends MutationResult {
  extraction: Extraction;
  quota: ExtractionQuota;
}
export interface SteamReturnResult extends MutationResult {
  returned: Extraction[];
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

  // Cartas
  cardActivate(p: CardActivateParams): Promise<MutationResult>;
  albumGet(): Promise<Album>;

  // Tempo e evento noturno
  getWorldState(): Promise<WorldState>;
  setTimezone(p: SetTimezoneParams): Promise<Profile>;
  claimNightEvent(p: ClaimNightEventParams): Promise<ClaimNightEventResult>;

  // Steam (retirada e volta)
  extractionQuota(): Promise<ExtractionQuota>;
  extractionRequest(p: ExtractionRequestParams): Promise<ExtractionResult>;
  extractionList(): Promise<Extraction[]>;
  steamReturnSync(p: SteamReturnSyncParams): Promise<SteamReturnResult>;

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
  cardActivate: 'card_activate',
  albumGet: 'album_get',
  getWorldState: 'get_world_state',
  setTimezone: 'set_timezone',
  claimNightEvent: 'claim_night_event',
  extractionQuota: 'extraction_quota',
  extractionRequest: 'extraction_request',
  extractionList: 'extraction_list',
  steamReturnSync: 'steam_return_sync',
  visitListCandidates: 'visit_list_candidates',
  visitGetFarm: 'visit_get_farm',
  visitInteract: 'visit_interact',
} as const satisfies Record<keyof IApi, string>;

/** Limites de economia usados pela mock e pelo servidor. */
export const ECONOMY = {
  /** Crédito máximo de produção offline (8 h). */
  OFFLINE_CAP_SECONDS: 28_800,
  /** Intervalo do heartbeat com o jogo aberto (fora do evento). */
  HEARTBEAT_INTERVAL_MS: 5 * 60_000,
  /** Intervalo do heartbeat durante o evento noturno. */
  EVENT_HEARTBEAT_INTERVAL_MS: 60_000,
  /** Heartbeats mais frequentes que isto recebem RATE_LIMITED. */
  HEARTBEAT_MIN_INTERVAL_MS: 10_000,
  /** Quantidade máxima por compra/venda na loja NPC. */
  SHOP_MAX_QTY: 999,
  /** Cartas com duração ativas ao mesmo tempo. */
  CARD_SLOTS: 1,
  CARD_SLOTS_VIP: 2,
  /** Retiradas para a Steam por janela deslizante. */
  EXTRACTION_LIMIT: 1,
  EXTRACTION_LIMIT_VIP: 4,
  EXTRACTION_WINDOW_HOURS: 7,
  /** Nível de fazenda mínimo para retirar (PROVISÓRIO: sugestão de DECISOES.md). */
  EXTRACTION_MIN_LEVEL: 5,
  /** Unidades por retirada (PROVISÓRIO: "1 unidade ou uma pilha?" está pendente). */
  EXTRACTION_MAX_QTY: 1,
  /** Troca de fuso: 1 vez a cada 30 dias; resgate do evento bloqueado por 24 h após trocar. */
  TZ_CHANGE_COOLDOWN_DAYS: 30,
  EVENT_TZ_LOCK_HOURS: 24,
} as const;

/** Regras do evento noturno (DECISOES.md / BALANCEAMENTO.md). */
export const NIGHT_EVENT = {
  startHour: 19,
  endHour: 21,
  speedMult: 1.5,
  /** Presença ativa necessária para a carta garantida (30 min). */
  requiredSeconds: 1800,
  /** Depois da última interação, a presença vale por no máximo 5 min (sem interação = inativo). */
  presenceWindowSeconds: 300,
} as const;
