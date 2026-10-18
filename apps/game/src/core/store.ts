// Estado do cliente. Só muda por: applyBootstrap (snapshot inteiro), apply (MutationResult),
// syncClock (heartbeat/get_server_time) e atualizações otimistas com reversão.
// Cada mudança dispara o evento correspondente no bus.

import {
  estimateFarmClock,
  type AnimalState,
  type BootstrapResult,
  type EpochMs,
  type FarmClockSeconds,
  type FarmSnapshot,
  type ItemId,
  type MutationResult,
  type OfflineReport,
  type PlotSlotId,
  type PlotState,
  type Profile,
  type ProgressState,
  type Wallet,
} from '@vif/shared';
import type { EventBus } from './bus';

export type FarmInfo = Omit<FarmSnapshot, 'plots' | 'animals' | 'farmClock'>;

/** Relógio monotônico local, só para interpolar animações (nunca para decidir valor). */
export type MonotonicClock = () => number;

const defaultMono: MonotonicClock = () => performance.now();

export class ClientStore {
  profile: Profile | null = null;
  farm: FarmInfo | null = null;
  wallet: Wallet = { coins: 0, gems: 0 };
  progress: ProgressState = { level: 1, xp: 0 };
  offlineReport: OfflineReport | null = null;
  readonly inventory = new Map<ItemId, number>();
  readonly plots = new Map<PlotSlotId, PlotState>();
  readonly animals = new Map<string, AnimalState>();

  private farmClock: FarmClockSeconds = 0;
  private serverNow: EpochMs = 0;
  private receivedAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly mono: MonotonicClock = defaultMono,
  ) {}

  get ready(): boolean {
    return this.profile !== null;
  }

  // ---------- leitura ----------

  qty(itemId: ItemId): number {
    return this.inventory.get(itemId) ?? 0;
  }

  plot(slotId: PlotSlotId): PlotState | undefined {
    return this.plots.get(slotId);
  }

  /** Relógio da fazenda estimado agora (só para barras e animação). */
  estimatedFarmClock(): FarmClockSeconds {
    return estimateFarmClock(this.farmClock, this.mono() - this.receivedAt);
  }

  /** Hora do servidor estimada agora (ms Unix). */
  estimatedServerNow(): EpochMs {
    return this.serverNow + Math.max(0, this.mono() - this.receivedAt);
  }

  /** Último valor confirmado pelo servidor. */
  get lastFarmClock(): FarmClockSeconds {
    return this.farmClock;
  }

  // ---------- escrita ----------

  applyBootstrap(b: BootstrapResult): void {
    const { plots, animals, farmClock, ...farm } = b.farm;
    this.profile = b.profile;
    this.farm = farm;
    this.wallet = { ...b.wallet };
    this.progress = { level: b.profile.level, xp: b.profile.xp };
    this.offlineReport = b.offlineReport;
    this.inventory.clear();
    for (const e of b.inventory) if (e.qty > 0) this.inventory.set(e.itemId, e.qty);
    this.plots.clear();
    for (const p of plots) this.plots.set(p.slotId, { ...p });
    this.animals.clear();
    for (const a of animals) this.animals.set(a.id, { ...a });
    this.farmClock = farmClock;
    this.serverNow = b.serverNow;
    this.receivedAt = this.mono();
    this.bus.emit('farm:snapshot', b);
  }

  /** Aplica o resultado de uma mutação confirmada pelo servidor. */
  apply(r: MutationResult): void {
    this.syncClock(r.farmClock, r.serverNow);
    if (r.wallet) {
      this.wallet = { ...r.wallet };
      this.bus.emit('wallet:changed', this.wallet);
    }
    if (r.inventoryChanges && r.inventoryChanges.length > 0) {
      for (const e of r.inventoryChanges) {
        if (e.qty > 0) this.inventory.set(e.itemId, e.qty);
        else this.inventory.delete(e.itemId);
      }
      this.bus.emit('inventory:changed', { changes: r.inventoryChanges, gained: r.gained });
    }
    for (const p of r.plots ?? []) {
      this.plots.set(p.slotId, { ...p });
      this.bus.emit('plot:updated', p);
    }
    for (const a of r.animals ?? []) {
      this.animals.set(a.id, { ...a });
      this.bus.emit('animal:updated', a);
    }
    if (r.xp) {
      const leveledUp = r.xp.level > this.progress.level;
      this.progress = { ...r.xp };
      if (this.profile) this.profile = { ...this.profile, ...r.xp };
      this.bus.emit('xp:changed', { ...this.progress, leveledUp });
    }
  }

  /** Atualiza o relógio com valores do servidor (nunca anda para trás). */
  syncClock(farmClock: FarmClockSeconds, serverNow: EpochMs): void {
    if (farmClock >= this.farmClock || serverNow >= this.serverNow) {
      this.farmClock = Math.max(this.farmClock, farmClock);
      this.serverNow = Math.max(this.serverNow, serverNow);
      this.receivedAt = this.mono();
    }
  }

  /**
   * Atualização otimista de um canteiro (antes da resposta do servidor).
   * Retorna uma função que desfaz a mudança (chame se a API der erro).
   */
  optimisticPlot(next: PlotState): () => void {
    const prev = this.plots.get(next.slotId);
    this.plots.set(next.slotId, { ...next });
    this.bus.emit('plot:updated', next);
    return () => {
      if (prev) {
        this.plots.set(prev.slotId, prev);
        this.bus.emit('plot:updated', prev);
      }
    };
  }

  /** Atualização otimista de inventário/moedas. Retorna a função que desfaz. */
  optimisticItems(deltas: { itemId: ItemId; delta: number }[], coinsDelta = 0): () => void {
    const prevWallet = { ...this.wallet };
    const prevQty = deltas.map((d) => ({ itemId: d.itemId, qty: this.qty(d.itemId) }));
    const changes = deltas.map((d) => ({
      itemId: d.itemId,
      qty: Math.max(0, this.qty(d.itemId) + d.delta),
    }));
    this.apply({
      farmClock: this.farmClock,
      serverNow: this.serverNow,
      inventoryChanges: changes,
      wallet: coinsDelta
        ? { ...this.wallet, coins: Math.max(0, this.wallet.coins + coinsDelta) }
        : undefined,
    });
    return () =>
      this.apply({
        farmClock: this.farmClock,
        serverNow: this.serverNow,
        inventoryChanges: prevQty,
        wallet: coinsDelta ? prevWallet : undefined,
      });
  }

  /** Emite `time:tick` periodicamente (só visual). */
  startTicking(intervalMs = 1000): void {
    this.stopTicking();
    this.tickTimer = setInterval(() => {
      this.bus.emit('time:tick', {
        serverNow: this.estimatedServerNow(),
        farmClock: this.estimatedFarmClock(),
      });
    }, intervalMs);
  }

  stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }
}
