// Tipos de domínio compartilhados entre cliente, mock e servidor.
// Regras: moeda é sempre número INTEIRO; tempos de produção em segundos do "relógio da fazenda" (farm clock);
// instantes reais (serverNow etc.) em milissegundos Unix (UTC) vindos do servidor.
// Decisões do dono (docs/DECISOES.md): Steam PC, sem mercado interno, cartas de buff, evento noturno.

/** Id legível do catálogo, ex.: "seed_carrot", "crop_carrot", "prod_egg", "card_gold_rare". */
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
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
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
  stackable: boolean;
  /** Pode ser retirado para o inventário Steam (cartas usadas, skins, colheitas, produtos). */
  steamExtractable: boolean;
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
  /** XP de fazenda e de conta por colheita. */
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

// ---------- cartas de buff ----------

export type BuffKind =
  | 'gold'
  | 'bountiful_harvest'
  | 'animals'
  | 'account_xp'
  | 'fertilizer'
  | 'farm_xp'
  | 'luck'
  | 'merchant';

export const BUFF_KINDS: readonly BuffKind[] = [
  'gold',
  'bountiful_harvest',
  'animals',
  'account_xp',
  'fertilizer',
  'farm_xp',
  'luck',
  'merchant',
];

export interface BuffDef {
  kind: BuffKind;
  name: string;
  description: string;
  /** Efeito instantâneo (Adubo): não ocupa vaga de carta ativa. */
  instant: boolean;
  artKey: string;
  iconKey: string;
}

/**
 * Uma das 40 cartas (8 buffs × 5 raridades). Também é um ItemId (kind "card"):
 * a carta USADA vira 1 unidade desse item no inventário = cópia no álbum.
 *
 * `magnitude` por buff: gold/animals/farm_xp/account_xp = fração extra (0.5 = +50%);
 * bountiful_harvest = unidades extras; luck = fração extra de chance (1.0 = +100%);
 * merchant = desconto (0.25 = −25%); fertilizer = segundos de avanço instantâneo.
 */
export interface CardDef {
  id: ItemId;
  buff: BuffKind;
  rarity: Rarity;
  /** 0 para cartas instantâneas. */
  durationSeconds: number;
  magnitude: number;
  artKey: string;
  iconKey: string;
  frameKey: string;
}

export type CardSource = 'drop' | 'night_event' | 'system';
export type CardInstanceStatus = 'unused' | 'used';

/** Carta ganha e ainda não usada (única, não empilha, não sai para a Steam). */
export interface CardInstance {
  id: string;
  cardId: ItemId;
  source: CardSource;
  status: CardInstanceStatus;
  obtainedAt: EpochMs;
  usedAt: EpochMs | null;
}

/** Buff em vigor. A janela é medida no relógio da fazenda; `endsAt` é só estimativa para a interface. */
export interface ActiveBuff {
  instanceId: string;
  cardId: ItemId;
  buff: BuffKind;
  rarity: Rarity;
  magnitude: number;
  startedFc: FarmClockSeconds;
  endsFc: FarmClockSeconds;
  startedAt: EpochMs;
  endsAt: EpochMs;
}

export interface AlbumSlot {
  cardId: ItemId;
  buff: BuffKind;
  rarity: Rarity;
  /** Cópias usadas guardadas (= quantidade do item da carta no inventário). Slot cheio se >= 1. */
  copies: number;
}

export interface Album {
  slots: AlbumSlot[];
  /** Buffs cuja linha (5 raridades) está completa. */
  completedLines: BuffKind[];
  /** Bônus permanente em % por buff (só linhas completas aparecem). */
  bonusPercent: Partial<Record<BuffKind, number>>;
}

// ---------- fazenda ----------

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
  /** farm clock em que fica pronto (null se vazio). Diminui com Adubo e com o evento noturno. */
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

/** Dois trilhos de XP: fazenda (libera culturas, canteiros, retirada) e conta. */
export interface ProgressState {
  level: number;
  xp: number;
  accountLevel: number;
  accountXp: number;
}

export interface Profile extends ProgressState {
  id: string;
  /** Nome exibido (vem da Steam em produção). */
  nickname: string;
  avatar: string;
  timezone: string;
  /** VIP ativo (microtransação Steam, fase de monetização). Muda limites de cartas e retirada. */
  vip: boolean;
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

// ---------- tempo e evento ----------

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';

export interface NightEventState {
  /** 19h–21h no horário local do perfil. */
  active: boolean;
  /** Multiplicador de crescimento para quem está presente (1.5). */
  speedMult: number;
  /** Segundos de presença ativa no evento de hoje (data local). */
  attendanceSeconds: number;
  /** Presença necessária para a carta garantida (1800). */
  requiredSeconds: number;
  /** Já resgatou a carta garantida de hoje. */
  cardClaimed: boolean;
  /** Fim do evento de hoje em ms Unix, ou null se não ativo. */
  endsAt: EpochMs | null;
}

export interface WorldState {
  serverNow: EpochMs;
  timezone: string;
  localHour: number;
  phase: DayPhase;
  weather: WeatherKind;
  nightEvent: NightEventState;
}

// ---------- Steam: retirada e volta ----------

export type ExtractionStatus = 'pending' | 'granted' | 'failed' | 'returned';

/**
 * Registro de item que saiu do jogo para a Steam (pending/granted/failed) ou voltou da Steam (returned).
 * Itens saem do inventário do jogo na hora do pedido (escrow); `failed` devolve.
 */
export interface Extraction {
  id: string;
  itemId: ItemId;
  qty: number;
  status: ExtractionStatus;
  /** Id do item no Steam Inventory Service (quando conhecido). */
  steamItemId?: string;
  createdAt: EpochMs;
}

export interface ExtractionQuota {
  /** Retiradas que contam na janela (pending + granted). */
  used: number;
  /** 1 sem VIP, 4 com VIP. */
  limit: number;
  windowHours: number;
  /** Quando abre a próxima vaga (ms Unix) ou null se já há vaga. */
  nextSlotAt: EpochMs | null;
}

// ---------- visitas ----------

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
