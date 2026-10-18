import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/bus';
import { ClientStore } from '../src/core/store';
import { FakeClock, MockApi } from '../src/net/mockApi';

describe('EventBus', () => {
  it('emite, cancela e isola erros de handlers', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.on('wallet:changed', spy);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('wallet:changed', () => {
      throw new Error('x');
    });
    bus.emit('wallet:changed', { coins: 1, gems: 0 });
    expect(spy).toHaveBeenCalledWith({ coins: 1, gems: 0 });
    expect(err).toHaveBeenCalled();
    off();
    bus.emit('wallet:changed', { coins: 2, gems: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('once dispara uma vez', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.once('ui:toast', spy);
    bus.emit('ui:toast', { kind: 'info', text: 'a' });
    bus.emit('ui:toast', { kind: 'info', text: 'b' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('ui:toast')).toBe(0);
  });
});

describe('ClientStore + MockApi', () => {
  async function setup() {
    const clock = new FakeClock();
    const api = new MockApi({ clock });
    const bus = new EventBus();
    let mono = 0;
    const store = new ClientStore(bus, () => mono);
    const events: string[] = [];
    for (const name of [
      'farm:snapshot',
      'plot:updated',
      'inventory:changed',
      'wallet:changed',
      'xp:changed',
    ] as const) {
      bus.on(name, () => events.push(name));
    }
    store.applyBootstrap(await api.bootstrap());
    return { clock, api, bus, store, events, tick: (ms: number) => (mono += ms) };
  }

  it('aplica bootstrap e mutações emitindo eventos', async () => {
    const { api, store, events, clock } = await setup();
    expect(store.wallet.coins).toBe(100);
    expect(store.qty('seed_carrot')).toBe(5);
    store.apply(await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: 'a' }));
    expect(store.qty('seed_carrot')).toBe(4);
    expect(store.plot('plot_01')?.cropId).toBe('crop_carrot');
    clock.advanceSeconds(120);
    store.apply(await api.harvest({ slotId: 'plot_01', requestId: 'b' }));
    expect(store.plot('plot_01')?.cropId).toBeNull();
    expect(store.qty('crop_carrot')).toBeGreaterThan(0);
    expect(store.progress.xp).toBe(1);
    expect(store.progress.accountXp).toBe(1);
    expect(events).toEqual([
      'farm:snapshot',
      'inventory:changed',
      'plot:updated',
      'inventory:changed',
      'plot:updated',
      'xp:changed',
    ]);
  });

  it('quantidade 0 remove o item do inventário', async () => {
    const { api, store } = await setup();
    store.apply(await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: 'x' }));
    expect(store.qty('seed_carrot')).toBe(6);
    store.apply({
      farmClock: 0,
      serverNow: 0,
      inventoryChanges: [{ itemId: 'seed_carrot', qty: 0 }],
    });
    expect(store.inventory.has('seed_carrot')).toBe(false);
  });

  it('otimista: aplica e desfaz', async () => {
    const { store } = await setup();
    const prev = store.plot('plot_01')!;
    const undo = store.optimisticPlot({
      ...prev,
      cropId: 'crop_carrot',
      plantedFc: 0,
      readyFc: 120,
    });
    expect(store.plot('plot_01')?.cropId).toBe('crop_carrot');
    undo();
    expect(store.plot('plot_01')).toEqual(prev);

    const undoItems = store.optimisticItems([{ itemId: 'seed_carrot', delta: -1 }], -10);
    expect(store.qty('seed_carrot')).toBe(4);
    expect(store.wallet.coins).toBe(90);
    undoItems();
    expect(store.qty('seed_carrot')).toBe(5);
    expect(store.wallet.coins).toBe(100);
  });

  it('relógio estimado avança com o tempo local, mas nunca para trás com dados velhos', async () => {
    const { store, tick } = await setup();
    tick(5000);
    expect(store.estimatedFarmClock()).toBe(5);
    store.syncClock(100, 1_000_000_000_000);
    expect(store.estimatedFarmClock()).toBe(100);
    store.syncClock(50, 1); // resposta atrasada
    expect(store.lastFarmClock).toBe(100);
  });
});
