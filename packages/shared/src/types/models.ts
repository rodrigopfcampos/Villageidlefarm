// Tipos de domínio compartilhados entre cliente, mock e servidor.
// Regras: moeda é sempre número INTEIRO; tempos de produção em segundos do "relógio da fazenda" (farm clock);
// instantes reais (serverNow etc.) em milissegundos Unix (UTC) vindos do servidor.

/** Id legível do catálogo, ex.: "seed_carrot", "crop_carrot", "prod_egg". */
export type ItemId = string;
/** Id de cultura, ex.: "crop_carrot" (igual ao item colhido). */
export type CropId = string;
/** Tipo de animal, ex.: "animal_chicken". */
export type AnimalType = string;
/** Id do canteiro vindo do layout do Tiled (fonte da verdade), ex.: "plot_01". */
export type PlotSlotId = string;
/** UUID gerado pelo cliente para cada mutação (idempotência). */
export type RequestId = string;
/** Instante real em ms Unix (UTC), sempre vindo do servidor. */
export type EpochMs = number;
/** Segundos no relógio da fazenda (farm_clock_s). */
export type FarmClockSeconds = number;

export type ItemKind = 'seed' | 'crop' | 'animal_product' | 'decor' | 'skin' | 'card' | 'currency';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Habitat = 'coop' | 'barn' | 'pond';

export interface ItemDef {
  id: ItemId;
  kind: ItemKind;
  rarity: Rarity;
  /** Preço de referência (inteiro). A loja NPC VENDE ao jogador por este preço quando `shopBuyable`. */
  basePrice: number;
  /** Quanto a loja NPC PAGA por unidade (inteiro) ou null se a loja não compra. */
  sellPrice: number | null;
  /** Se a loja NPC vende este item ao jogador. */
  shopBuyable: boolean;
  /** Pode ir ao mercado entre jogadores. */
  tradable: boolean;
  minPrice: number;
  maxPrice: number;
  stackable: boolean;
  /** Quadro no atlas, ex.: "icon/carrot" (atlas_icons). */
  spriteKey: string;
}

export interface CropDef {
  cropId: CropId;
  seedItemId: ItemId;
  yieldItemId: ItemId;
  growSeconds: number;
  yieldMin: number;
  yieldMax: number;
  xp: number;
  unlockLevel: number;
}

export interface AnimalDef {
  animalType: AnimalType;
  buyPrice: number;
  productItemId: ItemId;
  produceSeconds: number;
  maxStock: number;
  habitat: Habitat;
  xp: number;
  unlockLevel: number;
}

/** Definição de canteiro (vem do layout do Tiled; vira seed de `plot_slots`). */
export interface PlotSlotDef {
  slotId: PlotSlotId;
  unlockCost: number;
  unlockLevel: number;
  startsUnlocked: boolean;
}

export interface PlotState {
  slotId: PlotSlotId;
  unlocked: boolean;
  cropId: CropId | null;
  /** farm clock em que foi plantado (null se vazio). */
  plantedFc: FarmClockSeconds | null;
  /** farm clock em que fica pronto (null se vazio). */
  readyFc: FarmClockSeconds | null;
}

export interface AnimalState {
  id: string;
  animalType: AnimalType;
  name: string;
  lastCollectFc: FarmClockSeconds;
}

/** Quantidade ABSOLUTA atual de um item no inventário (0 = removido). */
export interface InventoryEntry {
  itemId: ItemId;
  qty: number;
}

export interface Wallet {
  coins: number;
  gems: number;
}

export interface ProgressState {
  level: number;
  xp: number;
}

export interface Profile {
  id: string;
  nickname: string;
  avatar: string;
  timezone: string;
  level: number;
  xp: number;
}

export interface FarmSnapshot {
  farmId: string;
  ownerId: string;
  farmClock: FarmClockSeconds;
  expansionLevel: number;
  visitsOpen: boolean;
  plots: PlotState[];
  animals: AnimalState[];
  unlockedLots: string[];
}

export interface OfflineReport {
  /** Segundos reais desde a última sincronização do relógio. */
  realSeconds: number;
  /** Segundos efetivamente creditados (máx. 28800). */
  creditedSeconds: number;
  capped: boolean;
}

export interface ServerTime {
  serverNow: EpochMs;
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';

export interface WorldState {
  serverNow: EpochMs;
  timezone: string;
  localHour: number;
  phase: DayPhase;
  weather: WeatherKind;
  nightEventActive: boolean;
  /** Fim do evento em ms Unix, ou null se não ativo. */
  eventEndsAt: EpochMs | null;
}

export type ListingStatus = 'active' | 'sold' | 'cancelled' | 'expired';

export interface MarketListing {
  id: string;
  sellerId: string;
  sellerNickname?: string;
  itemId: ItemId;
  instanceId: string | null;
  qtyTotal: number;
  qtyLeft: number;
  priceEach: number;
  status: ListingStatus;
  createdAt: EpochMs;
  expiresAt: EpochMs;
}

export interface MarketTrade {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  itemId: ItemId;
  qty: number;
  priceEach: number;
  fee: number;
  createdAt: EpochMs;
}

export interface PricePoint {
  /** Início do intervalo (ms Unix). */
  t: EpochMs;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  volume: number;
}

export interface PublicProfile {
  id: string;
  nickname: string;
  avatar: string;
  level: number;
}

/** Visão pública de outra fazenda: sem inventário e sem carteira. */
export interface PublicFarmSnapshot {
  farmId: string;
  owner: PublicProfile;
  timezone: string;
  farmClock: FarmClockSeconds;
  expansionLevel: number;
  plots: PlotState[];
  animals: AnimalState[];
  unlockedLots: string[];
  likedToday: boolean;
  helpedToday: boolean;
}
