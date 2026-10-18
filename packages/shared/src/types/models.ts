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
  /** Nome exibido (pt-BR). */
  name: string;
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
  /** Nome exibido (pt-BR). */
  name: string;
  buyPrice: number;
  productItemId: ItemId;
  produceSeconds: number;
  maxStock: number;
  habitat: Habitat;
  /** XP por UNIDADE coletada (= lucro/2). */
  xp: number;
  unlockLevel: number;
}

// ---------- cartas de buff ----------

/** Ordem = card/art_1..8 e buff/icon_1..8: sol, cesta, ovelha, coruja, ampulheta, chuva, ferradura, engrenagem. */
export type BuffKind =
  | 'gold'
  | 'bountiful'
  | 'animals'
  | 'xp'
  | 'fertilizer'
  | 'clear_sky'
  | 'lucky'
  | 'exploration';

export const BUFF_KINDS: readonly BuffKind[] = [
  'gold',
  'bountiful',
  'animals',
  'xp',
  'fertilizer',
  'clear_sky',
  'lucky',
  'exploration',
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
 * `magnitude` por buff: gold/animals/xp = fração extra (0.5 = +50%); bountiful = unidades extras;
 * lucky = fração extra de chance de carta (1.0 = +100%); fertilizer = segundos de avanço instantâneo;
 * clear_sky = redução da chance de resultado ruim nas viagens (0.5 = metade);
 * exploration = fração extra sobre o lucro acima do preço de loja das viagens (0.5 = +50%) e sem desgaste.
 */
export interface CardDef {
  id: ItemId;
  /** Nome exibido (pt-BR), ex.: "Ouro (Rara)". */
  name: string;
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
  /**
   * Quantas vezes a carta foi usada (nunca diminui). Espaço cheio se >= 1, PARA SEMPRE: retirar a
   * cópia (item `card_*`) para a Steam não esvazia o espaço nem tira o bônus da linha.
   */
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

/** XP único (da fazenda): libera culturas, canteiros, animais, veículos, destinos e retirada. */
export interface ProgressState {
  level: number;
  /** XP total acumulado. */
  xp: number;
}

export type Avatar = 'farmer_m' | 'farmer_f';
export const AVATARS: readonly Avatar[] = ['farmer_m', 'farmer_f'];

export interface Profile extends ProgressState {
  id: string;
  /** Nome exibido (vem da Steam em produção). */
  nickname: string;
  avatar: Avatar;
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

// ---------- exploração (viagens de venda) ----------

export type VehicleId = 'cart' | 'car' | 'pickup' | 'truck';
export type DestinationId = 'village' | 'city' | 'port';
export type TripOutcomeId = 'total_loss' | 'robbery' | 'normal' | 'good' | 'great' | 'jackpot';

export interface VehicleDef {
  id: VehicleId;
  name: string;
  unlockLevel: number;
  /** Preço em ouro (carroça = 0: vem junto com a exploração no nível 3). */
  price: number;
  /** Capacidade base em valor de carga (soma do preço de loja = sellPrice). */
  capacity: number;
  /** Custo fixo em ouro por viagem (ração da carroça ou gasolina). */
  tripCost: number;
  tripCostIcon: string;
  /** Pontos de condição gastos por viagem. */
  wear: number;
  /** Duração = horas do destino ÷ speed. */
  speed: number;
  /** Multiplica a chance dos resultados ruins. */
  risk: number;
  /** Conserto: ceil(pontos × repairCostPerPoint) em ouro (0,4% da capacidade base por ponto). */
  repairCostPerPoint: number;
  /** Custo de cada melhoria (0,5× / 1× / 2× o preço; carroça 500/1000/2000). */
  upgradeCosts: number[];
  /** Cada melhoria multiplica a capacidade por isto (1,25). */
  upgradeCapacityMult: number;
  maxUpgrades: number;
  /** Prefixo do quadro no atlas vehicles, ex.: "vehicle/cart" → "vehicle/cart_down_left_0". */
  spriteKey: string;
}

export interface TripOutcomeDef {
  id: TripOutcomeId;
  name: string;
  /** Chance base (tabela de ECONOMIA.md). */
  chance: number;
  /** Multiplicador sobre o valor de loja da carga (perda total 0, roubo 0,5…). */
  mult: number;
  /** Chance de a viagem também trazer uma carta (ótima/jackpot). */
  cardChance: number;
  iconKey: string;
}

export interface DestinationDef {
  id: DestinationId;
  name: string;
  unlockLevel: number;
  /** Duração de ida e volta com velocidade 1 (carroça/caminhão). */
  hours: number;
  outcomes: TripOutcomeDef[];
  iconKey: string;
}

export interface VehicleState {
  vehicleId: VehicleId;
  owned: boolean;
  /** 0..100. Abaixo de 50, resultados ruins ×1,5; em 0 não sai. */
  condition: number;
  upgrades: number;
  /** Capacidade atual = capacity × 1,25^upgrades (arredondada para baixo). */
  capacity: number;
  /** Viagem em andamento ou voltou e ainda não foi recolhida. */
  activeTripId: string | null;
}

export interface CargoEntry {
  itemId: ItemId;
  qty: number;
}

export type TripStatus = 'traveling' | 'returned' | 'collected';

/** Viagem. O resultado é sorteado no despacho, fica oculto e só aparece depois do collect. */
export interface TripState {
  id: string;
  vehicleId: VehicleId;
  destinationId: DestinationId;
  cargo: CargoEntry[];
  /** Soma do preço de loja da carga. */
  cargoValue: number;
  tripCost: number;
  departAt: EpochMs;
  returnAt: EpochMs;
  status: TripStatus;
  /** Buffs que valiam no despacho (para a interface). */
  clearSky: boolean;
  exploration: boolean;
  /** Só depois do collect. */
  result?: TripResult;
}

export interface TripResult {
  outcome: TripOutcomeId;
  mult: number;
  /** Moedas pagas no collect. */
  coins: number;
  /** Carta ganha (ótima/jackpot), se houver. */
  cardInstanceId?: string;
}

export interface ExploreState {
  /** Nível exigido para explorar (3). */
  unlockLevel: number;
  vehicles: VehicleState[];
  /** Viagens não recolhidas (em andamento ou de volta). */
  trips: TripState[];
  tripsToday: number;
  tripsPerDay: number;
  /** Próxima meia-noite local do perfil (ms Unix), quando as vagas voltam. */
  resetsAt: EpochMs;
}
