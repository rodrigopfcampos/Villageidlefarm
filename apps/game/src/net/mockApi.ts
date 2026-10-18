// API FALSA em memória que imita o servidor (contrato IApi de @vif/shared).
// Regras iguais às do Postgres (PLANO-FASE0 §4 + DECISOES.md + BALANCEAMENTO.md):
// - relógio da fazenda: no início de toda chamada da fazenda, credita min(tempo real, 28800 s);
// - moedas e quantidades inteiras, nunca negativas;
// - request_id: cada mutação bem-sucedida grava o id; repetir lança DUPLICATE_REQUEST e não muda nada;
// - erro no meio da mutação desfaz tudo (como a transação do banco);
// - cartas: drop proporcional ao cultivo, efeito só sobre o produzido dentro da janela, álbum;
// - evento noturno: ×1.5 no cultivo só com presença (heartbeat + interação), carta após 30 min;
// - retirada para a Steam: janela deslizante de 7 h (1 normal / 4 VIP), sem Steam de verdade.
// O relógio é injetável (FakeClock) para testes.

import {
  ApiError,
  CARDS_BY_ID,
  CATALOG,
  CROPS_BY_SEED,
  DEFAULT_PLOT_SLOTS,
  DESTINATIONS_BY_ID,
  VEHICLES,
  VEHICLES_BY_ID,
  AVATARS,
  PROGRESSION,
  ECONOMY,
  NIGHT_EVENT,
  STARTER_KIT,
  activeMagnitude,
  albumBonus,
  buildAlbum,
  cargoValue,
  nextLocalMidnight,
  outcomeOdds,
  pickOutcome,
  repairCost,
  tripDurationMs,
  tripPayout,
  tripsPerDay,
  vehicleCapacity,
  cardDropChance,
  cardId,
  isValidTimeZone,
  levelForXp,
  localTime,
  nightEventEndsAt,
  nightEventSecondsByDate,
  phaseForHour,
  proratedBonus,
  rollBuff,
  rollRarity,
  stochasticRound,
  unitFromSeed,
  type ActiveBuff,
  type Album,
  type AnimalDef,
  type AnimalState,
  type BootstrapResult,
  type CargoEntry,
  type ExploreCollectParams,
  type ExploreDispatchParams,
  type ExploreResult,
  type ExploreState,
  type ProfileSetAvatarParams,
  type TripState,
  type VehicleId,
  type VehicleParams,
  type VehicleState,
  type BuffKind,
  type BuffWindow,
  type BuyAnimalParams,
  type CardActivateParams,
  type CardDef,
  type CardInstance,
  type CardSource,
  type Catalog,
  type ClaimNightEventParams,
  type ClaimNightEventResult,
  type CollectAnimalParams,
  type CropDef,
  type EpochMs,
  type Extraction,
  type ExtractionQuota,
  type ExtractionRequestParams,
  type ExtractionResult,
  type HarvestAllParams,
  type HarvestParams,
  type HeartbeatResult,
  type IApi,
  type InventoryEntry,
  type ItemDef,
  type ItemId,
  type MutationResult,
  type OfflineReport,
  type Page,
  type PlantParams,
  type PlotSlotDef,
  type PlotState,
  type Profile,
  type ProgressState,
  type PublicFarmSnapshot,
  type Rarity,
  type ServerTime,
  type SetTimezoneParams,
  type ShopTradeParams,
  type SteamReturnResult,
  type SteamReturnSyncParams,
  type UnlockSlotParams,
  type VisitCandidate,
  type WorldState,
} from '@vif/shared';

// ---------- relógio ----------

export interface Clock {
  /** ms Unix do "servidor". */
  now(): EpochMs;
}

export const systemClock: Clock = {
  // eslint-disable-next-line no-restricted-properties -- este é o relógio do "servidor" falso
  now: () => Date.now(),
};

export class FakeClock implements Clock {
  constructor(private t: EpochMs = Date.UTC(2026, 0, 1, 12, 0, 0)) {}
  now(): EpochMs {
    return this.t;
  }
  set(t: EpochMs): void {
    this.t = t;
  }
  advanceMs(ms: number): void {
    this.t += ms;
  }
  advanceSeconds(s: number): void {
    this.t += s * 1000;
  }
}

// ---------- opções ----------

export interface MockApiOptions {
  clock?: Clock;
  /** Canteiros (normalmente do layout: layoutPlotSlots). */
  slots?: PlotSlotDef[];
  catalog?: Catalog;
  starter?: { coins: number; gems?: number; items: readonly InventoryEntry[] };
  /** XP de fazenda inicial (testes: ex. 500 = nível 5). */
  xp?: number;
  /** Atraso artificial em ms para simular rede (0 = imediato). */
  latencyMs?: number;
  timezone?: string;
  nickname?: string;
  /** VIP (2 cartas ativas, 4 retiradas por janela). */
  vip?: boolean;
  /** false simula a ponte Steam fora do ar (STEAM_UNAVAILABLE). */
  steamAvailable?: boolean;
  /** Álbum inicial (testes): vezes que cada carta já foi usada. */
  albumUses?: Record<ItemId, number>;
}

/** 20 canteiros com a progressão do catálogo (nível e custo por posição; 4 iniciais). */
export const DEFAULT_SLOTS: readonly PlotSlotDef[] = DEFAULT_PLOT_SLOTS;

// ---------- estado interno (equivale às tabelas) ----------

interface BuffRecord extends BuffWindow {
  instanceId: string;
  cardId: ItemId;
  rarity: Rarity;
  startedAt: EpochMs;
  endsAt: EpochMs;
}

interface State {
  profile: Profile;
  tzChangedAt: EpochMs | null;
  coins: number;
  gems: number;
  inventory: Map<ItemId, number>;
  farmClock: number;
  clockSyncedAt: EpochMs;
  /** Instante real da última sincronização (para medir presença sem contar duas vezes). */
  lastSyncAt: EpochMs;
  lastHeartbeatAt: EpochMs | null;
  /** Última mutação bem-sucedida (= interação real do jogador). */
  lastInteractionAt: EpochMs | null;
  plots: Map<string, PlotState>;
  animals: Map<string, AnimalState>;
  nextId: number;
  cards: Map<string, CardInstance>;
  /** Álbum PERMANENTE: vezes que cada carta foi usada (nunca diminui). */
  albumUses: Map<ItemId, number>;
  vehicles: Map<VehicleId, VehicleInternal>;
  trips: Map<string, TripInternal>;
  /** Viagens despachadas por data local do perfil. */
  tripsByDate: Map<string, number>;
  /** Histórico de janelas de buff (inclui expiradas: colheitas longas ainda as consultam). */
  buffs: BuffRecord[];
  /** Presença no evento por data local. */
  attendance: Map<string, number>;
  eventClaims: Set<string>;
  lastEventClaimAt: EpochMs | null;
  extractions: Extraction[];
  steamInventory: Map<string, { itemId: ItemId; qty: number }>;
  usedRequestIds: Set<string>;
}

interface VehicleInternal {
  owned: boolean;
  condition: number;
  upgrades: number;
  activeTripId: string | null;
}

/** Viagem com o resultado OCULTO (sorteado no despacho; o cliente só vê depois do collect). */
interface TripInternal extends Omit<TripState, 'status' | 'result'> {
  collected: boolean;
  hidden: { outcome: TripState['destinationId'] extends never ? never : string; mult: number; coins: number; cardWon: boolean };
  result?: TripState['result'];
}

const PLAYER_ID = 'mock-player';
const FARM_ID = 'mock-farm';
const HOUR_MS = 3_600_000;
const BUFF_HISTORY_LIMIT = 64;

function fail(code: ApiError['code'], message?: string): never {
  throw new ApiError(code, message);
}

export class MockApi implements IApi {
  private readonly clock: Clock;
  private readonly latencyMs: number;
  private readonly items: Map<ItemId, ItemDef>;
  private readonly crops: Map<string, CropDef>;
  private readonly cropsBySeed: Map<ItemId, CropDef>;
  private readonly animalDefs: Map<string, AnimalDef>;
  private readonly cardDefs: Map<ItemId, CardDef>;
  private readonly slotDefs: Map<string, PlotSlotDef>;
  private steamAvailable: boolean;
  private s: State;
  /** Canteiros mexidos pela sincronização (evento) durante a chamada atual. */
  private syncTouched = new Map<string, PlotState>();

  constructor(opts: MockApiOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.latencyMs = opts.latencyMs ?? 0;
    this.steamAvailable = opts.steamAvailable ?? true;
    const catalog = opts.catalog ?? CATALOG;
    this.items = new Map(catalog.items.map((i) => [i.id, i]));
    this.crops = new Map(catalog.crops.map((c) => [c.cropId, c]));
    this.cropsBySeed = opts.catalog
      ? new Map(catalog.crops.map((c) => [c.seedItemId, c]))
      : new Map(CROPS_BY_SEED);
    this.animalDefs = new Map(catalog.animals.map((a) => [a.animalType, a]));
    this.cardDefs = opts.catalog
      ? new Map(catalog.cards.cards.map((c) => [c.id, c]))
      : new Map(CARDS_BY_ID);
    const slots = opts.slots && opts.slots.length > 0 ? opts.slots : DEFAULT_SLOTS;
    this.slotDefs = new Map(slots.map((d) => [d.slotId, d]));

    // "Gatilho de cadastro": perfil, carteira, fazenda, canteiros iniciais e sementes iniciais.
    const starter = opts.starter ?? STARTER_KIT;
    const now = this.clock.now();
    const xp = opts.xp ?? 0;
    this.s = {
      profile: {
        id: PLAYER_ID,
        nickname: opts.nickname ?? 'Fazendeiro',
        avatar: 'farmer_m',
        timezone: opts.timezone ?? 'America/Sao_Paulo',
        vip: opts.vip ?? false,
        level: levelForXp(xp),
        xp,
      },
      tzChangedAt: null,
      coins: starter.coins,
      gems: starter.gems ?? 0,
      inventory: new Map(starter.items.filter((i) => i.qty > 0).map((i) => [i.itemId, i.qty])),
      farmClock: 0,
      clockSyncedAt: now,
      lastSyncAt: now,
      lastHeartbeatAt: null,
      lastInteractionAt: null,
      plots: new Map(
        [...this.slotDefs.values()].map((d) => [
          d.slotId,
          {
            slotId: d.slotId,
            unlocked: d.startsUnlocked,
            cropId: null,
            plantedFc: null,
            readyFc: null,
          },
        ]),
      ),
      animals: new Map(),
      nextId: 1,
      cards: new Map(),
      albumUses: new Map(Object.entries(opts.albumUses ?? {}).filter(([, n]) => n > 0)),
      // carroça: grátis, vem com a exploração (bloqueada por nível até o 3)
      vehicles: new Map(
        VEHICLES.map((v) => [
          v.id,
          { owned: v.price === 0, condition: 100, upgrades: 0, activeTripId: null },
        ]),
      ),
      trips: new Map(),
      tripsByDate: new Map(),
      buffs: [],
      attendance: new Map(),
      eventClaims: new Set(),
      lastEventClaimAt: null,
      extractions: [],
      steamInventory: new Map(),
      usedRequestIds: new Set(),
    };
  }

  // ================= infraestrutura =================

  /** Simula a rede: atraso opcional e cópia profunda (o chamador nunca toca no estado interno). */
  private async respond<T>(fn: () => T): Promise<T> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    return structuredClone(fn());
  }

  /**
   * sync_farm_clock: credita o tempo real decorrido (máx. 8 h) e aplica o evento noturno.
   * Presença: só conta de [última sync, min(agora, última interação + 5 min)] — quem está offline
   * ou só manda heartbeat sem interagir não acelera e não acumula presença.
   */
  private syncClock(): OfflineReport {
    const now = this.clock.now();

    // 1) evento noturno (antes de mover o relógio)
    const from = this.s.lastSyncAt;
    const presenceEnd =
      this.s.lastInteractionAt === null
        ? from
        : Math.min(now, this.s.lastInteractionAt + NIGHT_EVENT.presenceWindowSeconds * 1000);
    if (presenceEnd > from) {
      const byDate = nightEventSecondsByDate(from, presenceEnd, this.s.profile.timezone);
      let eventSeconds = 0;
      for (const [date, secs] of byDate) {
        this.s.attendance.set(date, (this.s.attendance.get(date) ?? 0) + secs);
        eventSeconds += secs;
      }
      const extra = Math.floor(eventSeconds * (NIGHT_EVENT.speedMult - 1));
      if (extra > 0) this.advanceGrowingPlots(extra, this.syncTouched);
    }
    this.s.lastSyncAt = Math.max(this.s.lastSyncAt, now);

    // 2) relógio da fazenda
    const elapsedMs = Math.max(0, now - this.s.clockSyncedAt);
    const realSeconds = Math.floor(elapsedMs / 1000);
    const cap = ECONOMY.OFFLINE_CAP_SECONDS;
    if (realSeconds >= cap) {
      this.s.farmClock += cap;
      this.s.clockSyncedAt = now;
      return { realSeconds, creditedSeconds: cap, capped: realSeconds > cap };
    }
    this.s.farmClock += realSeconds;
    // Guarda a fração de segundo para não perder tempo em heartbeats frequentes.
    this.s.clockSyncedAt += realSeconds * 1000;
    return { realSeconds, creditedSeconds: realSeconds, capped: false };
  }

  /** Antecipa `readyFc` dos canteiros em crescimento (evento noturno e Adubo). */
  private advanceGrowingPlots(seconds: number, touched: Map<string, PlotState>): void {
    for (const plot of this.s.plots.values()) {
      if (plot.cropId === null || plot.readyFc === null || plot.plantedFc === null) continue;
      if (plot.readyFc <= this.s.farmClock) continue; // já pronto
      plot.readyFc = Math.max(plot.plantedFc, plot.readyFc - seconds);
      touched.set(plot.slotId, plot);
    }
  }

  /** Executa uma mutação como transação: valida request_id, sincroniza, desfaz tudo se falhar. */
  private mutate<T>(
    requestId: string,
    fn: (base: Pick<MutationResult, 'farmClock' | 'serverNow'>) => T,
  ): Promise<T> {
    return this.respond(() => {
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        fail('INVALID_INPUT', 'requestId');
      }
      if (this.s.usedRequestIds.has(requestId)) fail('DUPLICATE_REQUEST');
      const backup = structuredClone(this.s);
      this.syncTouched = new Map();
      try {
        this.syncClock();
        const result = fn({ farmClock: this.s.farmClock, serverNow: this.clock.now() });
        this.s.usedRequestIds.add(requestId);
        this.s.lastInteractionAt = this.clock.now();
        return this.withSyncedPlots(result);
      } catch (err) {
        this.s = backup;
        throw err;
      }
    });
  }

  /** Inclui no resultado os canteiros que o evento acelerou durante a sincronização. */
  private withSyncedPlots<T>(result: T): T {
    if (this.syncTouched.size === 0 || typeof result !== 'object' || result === null) {
      return result;
    }
    const r = result as { plots?: PlotState[] };
    const own = new Set((r.plots ?? []).map((p) => p.slotId));
    const extra = [...this.syncTouched.values()].filter((p) => !own.has(p.slotId));
    if (extra.length > 0) r.plots = [...(r.plots ?? []), ...extra.map((p) => ({ ...p }))];
    return result;
  }

  private now(): EpochMs {
    return this.clock.now();
  }

  private newId(prefix: string): string {
    return `${prefix}_${this.s.nextId++}`;
  }

  private wallet() {
    return { coins: this.s.coins, gems: this.s.gems };
  }

  private progress(): ProgressState {
    const { level, xp } = this.s.profile;
    return { level, xp };
  }

  private qty(itemId: ItemId): number {
    return this.s.inventory.get(itemId) ?? 0;
  }

  private addItem(itemId: ItemId, delta: number): InventoryEntry {
    const next = this.qty(itemId) + delta;
    if (!Number.isInteger(next) || next < 0) fail('INSUFFICIENT_ITEMS');
    if (next === 0) this.s.inventory.delete(itemId);
    else this.s.inventory.set(itemId, next);
    return { itemId, qty: next };
  }

  private addCoins(delta: number): void {
    const next = this.s.coins + delta;
    if (!Number.isInteger(next)) fail('INVALID_INPUT', 'moeda não inteira');
    if (next < 0) fail('INSUFFICIENT_FUNDS');
    this.s.coins = next;
  }

  private addXp(xp: number): ProgressState {
    const p = this.s.profile;
    p.xp += xp;
    p.level = levelForXp(p.xp);
    return this.progress();
  }

  private requireLevel(level: number): void {
    if (this.s.profile.level < level) fail('LEVEL_TOO_LOW');
  }

  private requireQty(qty: number, max: number = ECONOMY.SHOP_MAX_QTY): void {
    if (!Number.isInteger(qty) || qty < 1 || qty > max) fail('INVALID_INPUT', 'qty');
  }

  private getPlot(slotId: string): PlotState {
    const plot = this.s.plots.get(slotId);
    if (!plot) fail('NOT_FOUND', `slot ${slotId}`);
    return plot;
  }

  // ================= cartas =================

  private album(): Album {
    return buildAlbum((id) => this.s.albumUses.get(id) ?? 0);
  }

  /** Bônus total (carta prorrateada + álbum) sobre uma produção em [start, end]. */
  private bonus(buff: BuffKind, start: number, end: number, album: Album): number {
    return proratedBonus(this.s.buffs, buff, start, end) + albumBonus(album, buff);
  }

  private activeBuffs(): ActiveBuff[] {
    const fc = this.s.farmClock;
    return this.s.buffs
      .filter((b) => b.endsFc > fc)
      .map((b) => ({
        instanceId: b.instanceId,
        cardId: b.cardId,
        buff: b.buff,
        rarity: b.rarity,
        magnitude: b.magnitude,
        startedFc: b.startedFc,
        endsFc: b.endsFc,
        startedAt: b.startedAt,
        endsAt: b.endsAt,
      }));
  }

  private createCard(def: CardDef, source: CardSource): CardInstance {
    const card: CardInstance = {
      id: this.newId('cardinst'),
      cardId: def.id,
      source,
      status: 'unused',
      obtainedAt: this.now(),
      usedAt: null,
    };
    this.s.cards.set(card.id, card);
    return card;
  }

  /** Sorteia uma carta (buff uniforme, raridade 55/27/12/5/1). */
  private rollCard(seed: string, source: CardSource): CardInstance {
    const buff = rollBuff(unitFromSeed(`${seed}:buff`));
    const rarity = rollRarity(unitFromSeed(`${seed}:rarity`));
    const def = this.cardDefs.get(cardId(buff, rarity));
    if (!def) fail('NOT_FOUND', `carta ${cardId(buff, rarity)}`);
    return this.createCard(def, source);
  }

  // ================= colheita =================

  private harvestPlot(plot: PlotState, seed: string, album: Album) {
    if (!plot.unlocked) fail('SLOT_LOCKED');
    if (plot.cropId === null || plot.readyFc === null || plot.plantedFc === null) {
      fail('SLOT_EMPTY');
    }
    if (this.s.farmClock < plot.readyFc) fail('NOT_READY');
    const crop = this.crops.get(plot.cropId);
    if (!crop) fail('NOT_FOUND', `crop ${plot.cropId}`);
    // A produção ocorreu em [plantedFc, readyFc]; buffs valem só na parte dentro da janela.
    const start = plot.plantedFc;
    const end = plot.readyFc;
    const u = (k: string) => unitFromSeed(`${seed}:${plot.slotId}:${k}`);
    const span = crop.yieldMax - crop.yieldMin + 1;
    const baseQty = crop.yieldMin + Math.floor(u('yield') * span);
    const qty =
      baseQty + stochasticRound(this.bonus('bountiful', start, end, album), u('bh'));
    const sell = this.items.get(crop.yieldItemId)?.sellPrice ?? 0;
    const bonusCoins = stochasticRound(
      sell * qty * this.bonus('gold', start, end, album),
      u('gold'),
    );
    const xp = stochasticRound(crop.xp * (1 + this.bonus('xp', start, end, album)), u('fx'));
    const chance = cardDropChance(crop.growSeconds, this.bonus('lucky', start, end, album));
    const card = u('drop') < chance ? this.rollCard(`${seed}:${plot.slotId}`, 'drop') : null;
    plot.cropId = null;
    plot.plantedFc = null;
    plot.readyFc = null;
    return { itemId: crop.yieldItemId, qty, xp, bonusCoins, card };
  }

  // ================= Núcleo =================

  bootstrap(): Promise<BootstrapResult> {
    return this.respond(() => {
      const offlineReport = this.syncClock();
      return {
        profile: { ...this.s.profile },
        wallet: this.wallet(),
        inventory: [...this.s.inventory].map(([itemId, qty]) => ({ itemId, qty })),
        farm: {
          farmId: FARM_ID,
          ownerId: PLAYER_ID,
          farmClock: this.s.farmClock,
          expansionLevel: 0,
          visitsOpen: true,
          plots: [...this.s.plots.values()],
          animals: [...this.s.animals.values()],
          unlockedLots: [],
        },
        cards: [...this.s.cards.values()].filter((c) => c.status === 'unused'),
        activeBuffs: this.activeBuffs(),
        offlineReport,
        serverNow: this.now(),
      };
    });
  }

  heartbeat(): Promise<HeartbeatResult> {
    return this.respond(() => {
      const now = this.now();
      const last = this.s.lastHeartbeatAt;
      if (last !== null && now - last < ECONOMY.HEARTBEAT_MIN_INTERVAL_MS) fail('RATE_LIMITED');
      this.s.lastHeartbeatAt = now;
      this.syncTouched = new Map();
      const { creditedSeconds } = this.syncClock();
      const plots = [...this.syncTouched.values()].map((p) => ({ ...p }));
      return {
        farmClock: this.s.farmClock,
        serverNow: now,
        creditedSeconds,
        ...(plots.length > 0 ? { plots } : {}),
      };
    });
  }

  getServerTime(): Promise<ServerTime> {
    return this.respond(() => ({ serverNow: this.now() }));
  }

  plant(p: PlantParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const plot = this.getPlot(p.slotId);
      if (!plot.unlocked) fail('SLOT_LOCKED');
      if (plot.cropId !== null) fail('SLOT_OCCUPIED');
      const crop = this.cropsBySeed.get(p.seedItemId);
      if (!crop) fail('INVALID_INPUT', `${p.seedItemId} não é semente`);
      this.requireLevel(crop.unlockLevel);
      const inv = this.addItem(p.seedItemId, -1);
      // Álbum: linha de Adubo completa encurta o cultivo em 2% (get_modifiers no servidor).
      const fert = albumBonus(this.album(), 'fertilizer');
      plot.cropId = crop.cropId;
      plot.plantedFc = this.s.farmClock;
      plot.readyFc = this.s.farmClock + Math.round(crop.growSeconds * (1 - fert));
      return { ...base, plots: [{ ...plot }], inventoryChanges: [inv] };
    });
  }

  private harvestResult(
    base: Pick<MutationResult, 'farmClock' | 'serverNow'>,
    harvested: ReturnType<MockApi['harvestPlot']>[],
    plots: PlotState[],
  ): MutationResult {
    if (harvested.length === 0) return { ...base };
    const gained = new Map<ItemId, number>();
    let xp = 0;
    let bonusCoins = 0;
    const cards: CardInstance[] = [];
    for (const h of harvested) {
      gained.set(h.itemId, (gained.get(h.itemId) ?? 0) + h.qty);
      xp += h.xp;
      bonusCoins += h.bonusCoins;
      if (h.card) cards.push({ ...h.card });
    }
    const inventoryChanges = [...gained].map(([itemId, qty]) => this.addItem(itemId, qty));
    if (bonusCoins > 0) this.addCoins(bonusCoins);
    return {
      ...base,
      plots,
      inventoryChanges,
      gained: [...gained].map(([itemId, qty]) => ({ itemId, qty })),
      xp: this.addXp(xp),
      ...(bonusCoins > 0 ? { wallet: this.wallet(), bonusCoins } : {}),
      ...(cards.length > 0 ? { cards } : {}),
    };
  }

  harvest(p: HarvestParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const plot = this.getPlot(p.slotId);
      const h = this.harvestPlot(plot, p.requestId, this.album());
      return this.harvestResult(base, [h], [{ ...plot }]);
    });
  }

  harvestAll(p: HarvestAllParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const album = this.album();
      const plots: PlotState[] = [];
      const harvested: ReturnType<MockApi['harvestPlot']>[] = [];
      for (const plot of this.s.plots.values()) {
        if (!plot.unlocked || plot.readyFc === null || this.s.farmClock < plot.readyFc) continue;
        harvested.push(this.harvestPlot(plot, p.requestId, album));
        plots.push({ ...plot });
      }
      return this.harvestResult(base, harvested, plots);
    });
  }

  unlockSlot(p: UnlockSlotParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const plot = this.getPlot(p.slotId);
      const def = this.slotDefs.get(p.slotId)!;
      if (plot.unlocked) fail('ALREADY_UNLOCKED');
      this.requireLevel(def.unlockLevel);
      this.addCoins(-def.unlockCost);
      plot.unlocked = true;
      return { ...base, wallet: this.wallet(), plots: [{ ...plot }] };
    });
  }

  buyAnimal(p: BuyAnimalParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const def = this.animalDefs.get(p.animalType);
      if (!def) fail('NOT_FOUND', `animal ${p.animalType}`);
      this.requireLevel(def.unlockLevel);
      this.addCoins(-def.buyPrice);
      const animal: AnimalState = {
        id: this.newId('animal'),
        animalType: def.animalType,
        name: def.animalType.replace(/^animal_/, ''),
        lastCollectFc: this.s.farmClock,
      };
      this.s.animals.set(animal.id, animal);
      return { ...base, wallet: this.wallet(), animals: [{ ...animal }] };
    });
  }

  collectAnimal(p: CollectAnimalParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const animal = this.s.animals.get(p.animalId);
      if (!animal) fail('NOT_FOUND', `animal ${p.animalId}`);
      const def = this.animalDefs.get(animal.animalType);
      if (!def) fail('NOT_FOUND', `animal def ${animal.animalType}`);
      const produced = Math.floor((this.s.farmClock - animal.lastCollectFc) / def.produceSeconds);
      const n = Math.min(produced, def.maxStock);
      if (n <= 0) fail('NOTHING_TO_COLLECT');
      const start = animal.lastCollectFc;
      const end = start + n * def.produceSeconds;
      const album = this.album();
      const u = (k: string) => unitFromSeed(`${p.requestId}:${animal.id}:${k}`);
      const qty = n + stochasticRound(n * this.bonus('animals', start, end, album), u('an'));
      const sell = this.items.get(def.productItemId)?.sellPrice ?? 0;
      const bonusCoins = stochasticRound(
        sell * qty * this.bonus('gold', start, end, album),
        u('g'),
      );
      // XP por unidade produzida (= lucro/2), com o buff de XP prorrateado
      const xp = stochasticRound(def.xp * n * (1 + this.bonus('xp', start, end, album)), u('fx'));
      animal.lastCollectFc = n >= def.maxStock ? this.s.farmClock : end;
      const inv = this.addItem(def.productItemId, qty);
      if (bonusCoins > 0) this.addCoins(bonusCoins);
      return {
        ...base,
        animals: [{ ...animal }],
        inventoryChanges: [inv],
        gained: [{ itemId: def.productItemId, qty }],
        xp: this.addXp(xp),
        ...(bonusCoins > 0 ? { wallet: this.wallet(), bonusCoins } : {}),
      };
    });
  }

  shopBuy(p: ShopTradeParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const item = this.items.get(p.itemId);
      if (!item) fail('NOT_FOUND', `item ${p.itemId}`);
      if (!item.shopBuyable) fail('NOT_FOR_SALE');
      this.requireQty(p.qty);
      this.addCoins(-item.basePrice * p.qty);
      const inv = this.addItem(item.id, p.qty);
      return { ...base, wallet: this.wallet(), inventoryChanges: [inv] };
    });
  }

  shopSell(p: ShopTradeParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const item = this.items.get(p.itemId);
      if (!item) fail('NOT_FOUND', `item ${p.itemId}`);
      if (item.sellPrice === null) fail('NOT_FOR_SALE');
      this.requireQty(p.qty);
      const inv = this.addItem(item.id, -p.qty);
      this.addCoins(item.sellPrice * p.qty);
      return { ...base, wallet: this.wallet(), inventoryChanges: [inv] };
    });
  }

  // ================= Cartas =================

  cardActivate(p: CardActivateParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const inst = this.s.cards.get(p.instanceId);
      if (!inst) fail('NOT_FOUND', `carta ${p.instanceId}`);
      if (inst.status !== 'unused') fail('CARD_ALREADY_USED');
      const def = this.cardDefs.get(inst.cardId);
      if (!def) fail('NOT_FOUND', `carta ${inst.cardId}`);
      const touched = new Map<string, PlotState>();
      let activeBuffs: ActiveBuff[] | undefined;
      if (def.durationSeconds <= 0) {
        // Adubo: avança na hora todos os canteiros em crescimento.
        this.advanceGrowingPlots(def.magnitude, touched);
      } else {
        const active = this.activeBuffs();
        if (active.some((b) => b.buff === def.buff)) fail('BUFF_ALREADY_ACTIVE');
        const slots = this.s.profile.vip ? ECONOMY.CARD_SLOTS_VIP : ECONOMY.CARD_SLOTS;
        if (active.length >= slots) fail('CARD_SLOT_FULL');
        const now = this.now();
        this.s.buffs.push({
          instanceId: inst.id,
          cardId: def.id,
          buff: def.buff,
          rarity: def.rarity,
          magnitude: def.magnitude,
          startedFc: this.s.farmClock,
          endsFc: this.s.farmClock + def.durationSeconds,
          startedAt: now,
          endsAt: now + def.durationSeconds * 1000,
        });
        if (this.s.buffs.length > BUFF_HISTORY_LIMIT) this.s.buffs.shift();
        activeBuffs = this.activeBuffs();
      }
      inst.status = 'used';
      inst.usedAt = this.now();
      // álbum para sempre (+1 uso) e 1 cópia (item card_*) que pode ir para a Steam
      const uses = (this.s.albumUses.get(def.id) ?? 0) + 1;
      this.s.albumUses.set(def.id, uses);
      const inv = this.addItem(def.id, 1);
      return {
        ...base,
        cards: [{ ...inst }],
        inventoryChanges: [inv],
        album: [{ cardId: def.id, buff: def.buff, rarity: def.rarity, copies: uses }],
        ...(activeBuffs ? { activeBuffs } : {}),
        ...(touched.size > 0 ? { plots: [...touched.values()].map((x) => ({ ...x })) } : {}),
      };
    });
  }

  albumGet(): Promise<Album> {
    return this.respond(() => this.album());
  }

  // ================= Tempo e evento =================

  getWorldState(): Promise<WorldState> {
    // Não sincroniza (leitura pura): a presença acumulada vem do último heartbeat/mutação.
    return this.respond(() => {
      const serverNow = this.now();
      const tz = this.s.profile.timezone;
      const lt = localTime(serverNow, tz);
      const endsAt = nightEventEndsAt(serverNow, tz);
      return {
        serverNow,
        timezone: tz,
        localHour: lt.h,
        phase: phaseForHour(lt.h),
        weather: 'clear',
        nightEvent: {
          active: endsAt !== null,
          speedMult: NIGHT_EVENT.speedMult,
          attendanceSeconds: Math.floor(this.s.attendance.get(lt.date) ?? 0),
          requiredSeconds: NIGHT_EVENT.requiredSeconds,
          cardClaimed: this.s.eventClaims.has(lt.date),
          endsAt,
        },
      };
    });
  }

  setTimezone(p: SetTimezoneParams): Promise<Profile> {
    return this.mutate(p.requestId, () => {
      if (typeof p.tz !== 'string' || !isValidTimeZone(p.tz)) fail('INVALID_TZ');
      const now = this.now();
      const cooldown = ECONOMY.TZ_CHANGE_COOLDOWN_DAYS * 24 * HOUR_MS;
      if (this.s.tzChangedAt !== null && now - this.s.tzChangedAt < cooldown) {
        fail('TZ_CHANGE_TOO_SOON');
      }
      this.s.profile.timezone = p.tz;
      this.s.tzChangedAt = now;
      return { ...this.s.profile };
    });
  }

  claimNightEvent(p: ClaimNightEventParams): Promise<ClaimNightEventResult> {
    return this.mutate(p.requestId, (base) => {
      const now = this.now();
      if (
        this.s.tzChangedAt !== null &&
        now - this.s.tzChangedAt < ECONOMY.EVENT_TZ_LOCK_HOURS * HOUR_MS
      ) {
        fail('TZ_CHANGE_TOO_SOON');
      }
      const date = localTime(now, this.s.profile.timezone).date;
      const recent =
        this.s.lastEventClaimAt !== null && now - this.s.lastEventClaimAt < 20 * HOUR_MS;
      if (this.s.eventClaims.has(date) || recent) fail('ALREADY_CLAIMED');
      if ((this.s.attendance.get(date) ?? 0) < NIGHT_EVENT.requiredSeconds) fail('NOT_ACTIVE');
      const card = this.rollCard(`${p.requestId}:event`, 'night_event');
      this.s.eventClaims.add(date);
      this.s.lastEventClaimAt = now;
      return { ...base, card: { ...card }, cards: [{ ...card }] };
    });
  }

  // ================= Steam: retirada e volta =================

  private quota(): ExtractionQuota {
    const now = this.now();
    const windowMs = ECONOMY.EXTRACTION_WINDOW_HOURS * HOUR_MS;
    const limit = this.s.profile.vip ? ECONOMY.EXTRACTION_LIMIT_VIP : ECONOMY.EXTRACTION_LIMIT;
    const counted = this.s.extractions
      .filter(
        (e) => (e.status === 'pending' || e.status === 'granted') && e.createdAt > now - windowMs,
      )
      .map((e) => e.createdAt)
      .sort((a, b) => a - b);
    const used = counted.length;
    // Próxima vaga: quando a retirada mais antiga que excede o limite sai da janela.
    const nextSlotAt = used >= limit ? counted[used - limit]! + windowMs : null;
    return { used, limit, windowHours: ECONOMY.EXTRACTION_WINDOW_HOURS, nextSlotAt };
  }

  extractionQuota(): Promise<ExtractionQuota> {
    return this.respond(() => this.quota());
  }

  extractionRequest(p: ExtractionRequestParams): Promise<ExtractionResult> {
    return this.mutate(p.requestId, (base) => {
      if (!this.steamAvailable) fail('STEAM_UNAVAILABLE');
      const item = this.items.get(p.itemId);
      if (!item) fail('NOT_FOUND', `item ${p.itemId}`);
      if (!item.steamExtractable) fail('NOT_EXTRACTABLE');
      this.requireQty(p.qty, ECONOMY.EXTRACTION_MAX_QTY);
      this.requireLevel(ECONOMY.EXTRACTION_MIN_LEVEL);
      if (this.quota().used >= this.quota().limit) fail('EXTRACTION_QUOTA');
      const inv = this.addItem(item.id, -p.qty); // escrow: sai do jogo na hora
      // Sem Steam de verdade: concede na hora com um id falso.
      const steamItemId = `mock-steam-${this.s.nextId++}`;
      const extraction: Extraction = {
        id: this.newId('extraction'),
        itemId: item.id,
        qty: p.qty,
        status: 'granted',
        steamItemId,
        createdAt: this.now(),
      };
      this.s.extractions.push(extraction);
      this.s.steamInventory.set(steamItemId, { itemId: item.id, qty: p.qty });
      return {
        ...base,
        inventoryChanges: [inv],
        extraction: { ...extraction },
        quota: this.quota(),
      };
    });
  }

  extractionList(): Promise<Extraction[]> {
    return this.respond(() => [...this.s.extractions].reverse());
  }

  steamReturnSync(p: SteamReturnSyncParams): Promise<SteamReturnResult> {
    return this.mutate(p.requestId, (base) => {
      if (!this.steamAvailable) fail('STEAM_UNAVAILABLE');
      const ids = p.steamItemIds;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('INVALID_INPUT');
      const changes = new Map<ItemId, InventoryEntry>();
      const returned: Extraction[] = [];
      for (const steamItemId of ids) {
        const entry = this.s.steamInventory.get(steamItemId);
        if (!entry) fail('NOT_FOUND', `item Steam ${steamItemId}`);
        this.s.steamInventory.delete(steamItemId); // ConsumeItem na Steam
        changes.set(entry.itemId, this.addItem(entry.itemId, entry.qty));
        const rec: Extraction = {
          id: this.newId('extraction'),
          itemId: entry.itemId,
          qty: entry.qty,
          status: 'returned',
          steamItemId,
          createdAt: this.now(),
        };
        this.s.extractions.push(rec);
        returned.push({ ...rec });
      }
      return { ...base, inventoryChanges: [...changes.values()], returned };
    });
  }

  // ================= Visitas: ainda não =================

  visitListCandidates(): Promise<Page<VisitCandidate>> {
    return this.notImplemented('visitListCandidates');
  }
  visitGetFarm(): Promise<PublicFarmSnapshot> {
    return this.notImplemented('visitGetFarm');
  }
  visitInteract(): Promise<MutationResult> {
    return this.notImplemented('visitInteract');
  }

  private notImplemented(op: string): Promise<never> {
    return Promise.reject(new ApiError('NOT_IMPLEMENTED', `${op} ainda não existe na mock`));
  }

  // ================= só para testes / depuração =================

  /** Liga/desliga VIP (no servidor real vem de entitlements). */
  setVip(vip: boolean): void {
    this.s.profile.vip = vip;
  }

  setSteamAvailable(available: boolean): void {
    this.steamAvailable = available;
  }

  /** Dá uma carta não usada (como se tivesse caído). */
  grantCard(id: ItemId, source: CardSource = 'system'): CardInstance {
    const def = this.cardDefs.get(id);
    if (!def) throw new Error(`carta ${id} não existe`);
    return structuredClone(this.createCard(def, source));
  }

  /** Simula um item comprado no mercado da Steam (aparece no inventário Steam do jogador). */
  mockSteamGrant(itemId: ItemId, qty = 1): string {
    const steamItemId = `mock-steam-${this.s.nextId++}`;
    this.s.steamInventory.set(steamItemId, { itemId, qty });
    return steamItemId;
  }

  /** Cópia do estado interno (equivalente a olhar as tabelas). */
  inspect() {
    return structuredClone({
      coins: this.s.coins,
      inventory: Object.fromEntries(this.s.inventory),
      farmClock: this.s.farmClock,
      ...this.progress(),
      plots: [...this.s.plots.values()],
      cards: [...this.s.cards.values()],
      attendance: Object.fromEntries(this.s.attendance),
      steamInventory: Object.fromEntries(this.s.steamInventory),
    });
  }
}
