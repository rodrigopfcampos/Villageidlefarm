// API FALSA em memória que imita o servidor (contrato IApi de @vif/shared).
// Regras iguais às do Postgres (seção 4 do plano):
// - relógio da fazenda: no início de toda chamada da fazenda, credita min(tempo real, 28800 s);
// - moedas e quantidades inteiras, nunca negativas;
// - request_id: cada mutação bem-sucedida grava o id; repetir lança DUPLICATE_REQUEST e não muda nada;
// - erro no meio da mutação desfaz tudo (como a transação do banco).
// O relógio é injetável (FakeClock) para testes.

import {
  ANIMALS_BY_TYPE,
  ApiError,
  CATALOG,
  ECONOMY,
  STARTER_KIT,
  levelForXp,
  type AnimalDef,
  type AnimalState,
  type BootstrapResult,
  type BuyAnimalParams,
  type CollectAnimalParams,
  type HarvestAllParams,
  type HarvestParams,
  type ShopTradeParams,
  type UnlockSlotParams,
  type Catalog,
  type ClaimNightEventResult,
  type CropDef,
  type DayPhase,
  type EpochMs,
  type HeartbeatResult,
  type IApi,
  type InventoryEntry,
  type ItemDef,
  type ItemId,
  type MarketBuyResult,
  type MarketListing,
  type MarketListingResult,
  type MutationResult,
  type OfflineReport,
  type Page,
  type PlantParams,
  type PlotSlotDef,
  type PlotState,
  type PricePoint,
  type Profile,
  type PublicFarmSnapshot,
  type ServerTime,
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
  /** Atraso artificial em ms para simular rede (0 = imediato). */
  latencyMs?: number;
  timezone?: string;
  nickname?: string;
}

export const DEFAULT_SLOTS: readonly PlotSlotDef[] = [
  { slotId: 'plot_01', unlockCost: 0, unlockLevel: 1, startsUnlocked: true },
  { slotId: 'plot_02', unlockCost: 0, unlockLevel: 1, startsUnlocked: true },
  { slotId: 'plot_03', unlockCost: 0, unlockLevel: 1, startsUnlocked: true },
  { slotId: 'plot_04', unlockCost: 0, unlockLevel: 1, startsUnlocked: true },
  { slotId: 'plot_05', unlockCost: 200, unlockLevel: 2, startsUnlocked: false },
  { slotId: 'plot_06', unlockCost: 500, unlockLevel: 3, startsUnlocked: false },
];

// ---------- estado interno (equivale às tabelas) ----------

interface State {
  profile: Profile;
  coins: number;
  gems: number;
  inventory: Map<ItemId, number>;
  farmClock: number;
  clockSyncedAt: EpochMs;
  plots: Map<string, PlotState>;
  animals: Map<string, AnimalState>;
  nextAnimalId: number;
  usedRequestIds: Set<string>;
}

const PLAYER_ID = 'mock-player';
const FARM_ID = 'mock-farm';

function fail(code: ApiError['code'], message?: string): never {
  throw new ApiError(code, message);
}

/** Hash FNV-1a 32 bits (rendimento determinístico por request_id, como faria o servidor). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function localTimeParts(epochMs: EpochMs, tz: string): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

/** Fase do dia pela hora local (provisório; o agente Tempo define a regra final). */
export function phaseForHour(h: number): DayPhase {
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}

export class MockApi implements IApi {
  private readonly clock: Clock;
  private readonly latencyMs: number;
  private readonly items: Map<ItemId, ItemDef>;
  private readonly crops: Map<string, CropDef>;
  private readonly cropsBySeed: Map<ItemId, CropDef>;
  private readonly animalDefs: Map<string, AnimalDef>;
  private readonly slotDefs: Map<string, PlotSlotDef>;
  private s: State;

  constructor(opts: MockApiOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.latencyMs = opts.latencyMs ?? 0;
    const catalog = opts.catalog ?? CATALOG;
    this.items = new Map(catalog.items.map((i) => [i.id, i]));
    this.crops = new Map(catalog.crops.map((c) => [c.cropId, c]));
    this.cropsBySeed = new Map(catalog.crops.map((c) => [c.seedItemId, c]));
    this.animalDefs = opts.catalog
      ? new Map(catalog.animals.map((a) => [a.animalType, a]))
      : new Map(ANIMALS_BY_TYPE);
    const slots = opts.slots && opts.slots.length > 0 ? opts.slots : DEFAULT_SLOTS;
    this.slotDefs = new Map(slots.map((d) => [d.slotId, d]));

    // "Gatilho de cadastro": perfil, carteira, fazenda, canteiros iniciais e sementes iniciais.
    const starter = opts.starter ?? STARTER_KIT;
    const now = this.clock.now();
    this.s = {
      profile: {
        id: PLAYER_ID,
        nickname: opts.nickname ?? 'Fazendeiro',
        avatar: 'farmer_m',
        timezone: opts.timezone ?? 'America/Sao_Paulo',
        level: 1,
        xp: 0,
      },
      coins: starter.coins,
      gems: starter.gems ?? 0,
      inventory: new Map(starter.items.filter((i) => i.qty > 0).map((i) => [i.itemId, i.qty])),
      farmClock: 0,
      clockSyncedAt: now,
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
      nextAnimalId: 1,
      usedRequestIds: new Set(),
    };
  }

  // ---------- infraestrutura ----------

  /** Simula a rede: atraso opcional e cópia profunda (o chamador nunca toca no estado interno). */
  private async respond<T>(fn: () => T): Promise<T> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    return structuredClone(fn());
  }

  /** sync_farm_clock: credita o tempo real decorrido, limitado a 8 h. */
  private syncClock(): OfflineReport {
    const now = this.clock.now();
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

  /** Executa uma mutação como transação: valida request_id, sincroniza, desfaz tudo se falhar. */
  private mutate<T extends MutationResult>(
    requestId: string,
    fn: (base: Pick<MutationResult, 'farmClock' | 'serverNow'>) => T,
  ): Promise<T> {
    return this.respond(() => {
      if (typeof requestId !== 'string' || requestId.trim() === '')
        fail('INVALID_INPUT', 'requestId');
      if (this.s.usedRequestIds.has(requestId)) fail('DUPLICATE_REQUEST');
      const backup = structuredClone(this.s);
      try {
        this.syncClock();
        const result = fn({ farmClock: this.s.farmClock, serverNow: this.clock.now() });
        this.s.usedRequestIds.add(requestId);
        return result;
      } catch (err) {
        this.s = backup;
        throw err;
      }
    });
  }

  private wallet() {
    return { coins: this.s.coins, gems: this.s.gems };
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

  private addXp(xp: number) {
    this.s.profile.xp += xp;
    this.s.profile.level = levelForXp(this.s.profile.xp);
    return { level: this.s.profile.level, xp: this.s.profile.xp };
  }

  private requireLevel(level: number): void {
    if (this.s.profile.level < level) fail('LEVEL_TOO_LOW');
  }

  private requireQty(qty: number): void {
    if (!Number.isInteger(qty) || qty < 1 || qty > ECONOMY.SHOP_MAX_QTY)
      fail('INVALID_INPUT', 'qty');
  }

  private getPlot(slotId: string): PlotState {
    const plot = this.s.plots.get(slotId);
    if (!plot) fail('NOT_FOUND', `slot ${slotId}`);
    return plot;
  }

  private harvestPlot(plot: PlotState, seed: string) {
    if (!plot.unlocked) fail('SLOT_LOCKED');
    if (plot.cropId === null || plot.readyFc === null) fail('SLOT_EMPTY');
    if (this.s.farmClock < plot.readyFc) fail('NOT_READY');
    const crop = this.crops.get(plot.cropId);
    if (!crop) fail('NOT_FOUND', `crop ${plot.cropId}`);
    const span = crop.yieldMax - crop.yieldMin + 1;
    const qty = crop.yieldMin + (hash32(`${seed}:${plot.slotId}`) % span);
    plot.cropId = null;
    plot.plantedFc = null;
    plot.readyFc = null;
    return { itemId: crop.yieldItemId, qty, xp: crop.xp };
  }

  // ---------- Núcleo ----------

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
        offlineReport,
        serverNow: this.clock.now(),
      };
    });
  }

  heartbeat(): Promise<HeartbeatResult> {
    return this.respond(() => {
      const { creditedSeconds } = this.syncClock();
      return { farmClock: this.s.farmClock, serverNow: this.clock.now(), creditedSeconds };
    });
  }

  getServerTime(): Promise<ServerTime> {
    return this.respond(() => ({ serverNow: this.clock.now() }));
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
      plot.cropId = crop.cropId;
      plot.plantedFc = this.s.farmClock;
      plot.readyFc = this.s.farmClock + crop.growSeconds; // × get_modifiers() = 1.0 por enquanto
      return { ...base, plots: [{ ...plot }], inventoryChanges: [inv] };
    });
  }

  harvest(p: HarvestParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const plot = this.getPlot(p.slotId);
      const got = this.harvestPlot(plot, p.requestId);
      const inv = this.addItem(got.itemId, got.qty);
      return {
        ...base,
        plots: [{ ...plot }],
        inventoryChanges: [inv],
        gained: [{ itemId: got.itemId, qty: got.qty }],
        xp: this.addXp(got.xp),
      };
    });
  }

  harvestAll(p: HarvestAllParams): Promise<MutationResult> {
    return this.mutate(p.requestId, (base) => {
      const plots: PlotState[] = [];
      const gained = new Map<ItemId, number>();
      let xp = 0;
      for (const plot of this.s.plots.values()) {
        if (!plot.unlocked || plot.readyFc === null || this.s.farmClock < plot.readyFc) continue;
        const got = this.harvestPlot(plot, p.requestId);
        gained.set(got.itemId, (gained.get(got.itemId) ?? 0) + got.qty);
        xp += got.xp;
        plots.push({ ...plot });
      }
      if (plots.length === 0) return { ...base };
      const inventoryChanges = [...gained].map(([itemId, qty]) => this.addItem(itemId, qty));
      return {
        ...base,
        plots,
        inventoryChanges,
        gained: [...gained].map(([itemId, qty]) => ({ itemId, qty })),
        xp: this.addXp(xp),
      };
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
        id: `animal_${this.s.nextAnimalId++}`,
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
      animal.lastCollectFc =
        n >= def.maxStock ? this.s.farmClock : animal.lastCollectFc + n * def.produceSeconds;
      const inv = this.addItem(def.productItemId, n);
      return {
        ...base,
        animals: [{ ...animal }],
        inventoryChanges: [inv],
        gained: [{ itemId: def.productItemId, qty: n }],
        xp: this.addXp(def.xp),
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

  // ---------- Tempo (só get_world_state, provisório) ----------

  getWorldState(): Promise<WorldState> {
    return this.respond(() => {
      const serverNow = this.clock.now();
      const tz = this.s.profile.timezone;
      const { h, m, s } = localTimeParts(serverNow, tz);
      const active = h === 19 || h === 20;
      const msTo21 = ((21 - h) * 3600 - m * 60 - s) * 1000 - (serverNow % 1000);
      return {
        serverNow,
        timezone: tz,
        localHour: h,
        phase: phaseForHour(h),
        weather: 'clear',
        nightEventActive: active,
        eventEndsAt: active ? serverNow + msTo21 : null,
      };
    });
  }

  setTimezone(): Promise<Profile> {
    return this.notImplemented('setTimezone');
  }
  claimNightEvent(): Promise<ClaimNightEventResult> {
    return this.notImplemented('claimNightEvent');
  }

  // ---------- Mercado e Visitas: ainda não ----------

  marketCreateListing(): Promise<MarketListingResult> {
    return this.notImplemented('marketCreateListing');
  }
  marketBuy(): Promise<MarketBuyResult> {
    return this.notImplemented('marketBuy');
  }
  marketCancel(): Promise<MarketListingResult> {
    return this.notImplemented('marketCancel');
  }
  marketSearch(): Promise<Page<MarketListing>> {
    return this.notImplemented('marketSearch');
  }
  marketMyListings(): Promise<MarketListing[]> {
    return this.notImplemented('marketMyListings');
  }
  marketPriceHistory(): Promise<PricePoint[]> {
    return this.notImplemented('marketPriceHistory');
  }
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

  // ---------- só para testes / depuração ----------

  /** Cópia do estado interno (equivalente a olhar as tabelas). */
  inspect(): {
    coins: number;
    inventory: Record<string, number>;
    farmClock: number;
    level: number;
    xp: number;
    plots: PlotState[];
  } {
    return structuredClone({
      coins: this.s.coins,
      inventory: Object.fromEntries(this.s.inventory),
      farmClock: this.s.farmClock,
      level: this.s.profile.level,
      xp: this.s.profile.xp,
      plots: [...this.s.plots.values()],
    });
  }
}
