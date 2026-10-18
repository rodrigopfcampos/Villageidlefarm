import { describe, expect, it } from 'vitest';
import { ApiError, ECONOMY, type ErrorCode } from '@vif/shared';
import { FakeClock, MockApi } from '../src/net/mockApi';

let n = 0;
const rid = () => `req-${++n}`;

function setup(opts: ConstructorParameters<typeof MockApi>[0] = {}) {
  const clock = new FakeClock();
  const api = new MockApi({ clock, ...opts });
  return { clock, api };
}

async function expectCode(p: Promise<unknown>, code: ErrorCode) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('MockApi: núcleo', () => {
  it('bootstrap devolve conta nova com kit inicial e 4 canteiros liberados', async () => {
    const { api } = setup();
    const b = await api.bootstrap();
    expect(b.wallet.coins).toBe(100);
    expect(b.inventory).toEqual([{ itemId: 'seed_carrot', qty: 5 }]);
    expect(b.farm.plots.filter((p) => p.unlocked)).toHaveLength(4);
    expect(b.farm.farmClock).toBe(0);
    expect(b.offlineReport).toEqual({ realSeconds: 0, creditedSeconds: 0, capped: false });
  });

  it('plantar consome a semente e marca readyFc = plantado + growSeconds', async () => {
    const { api, clock } = setup();
    clock.advanceSeconds(10);
    const r = await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
    expect(r.farmClock).toBe(10);
    expect(r.plots).toEqual([
      { slotId: 'plot_01', unlocked: true, cropId: 'crop_carrot', plantedFc: 10, readyFc: 130 },
    ]);
    expect(r.inventoryChanges).toEqual([{ itemId: 'seed_carrot', qty: 4 }]);
  });

  it('colher antes da hora = NOT_READY; na hora certa colhe e dá xp', async () => {
    const { api, clock } = setup();
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
    clock.advanceSeconds(119);
    await expectCode(api.harvest({ slotId: 'plot_01', requestId: rid() }), 'NOT_READY');
    clock.advanceSeconds(1);
    const r = await api.harvest({ slotId: 'plot_01', requestId: rid() });
    expect(r.plots?.[0]).toMatchObject({ cropId: null, readyFc: null });
    const got = r.gained?.[0];
    expect(got?.itemId).toBe('crop_carrot');
    expect(got!.qty).toBeGreaterThanOrEqual(1);
    expect(got!.qty).toBeLessThanOrEqual(2);
    expect(r.xp).toEqual({ level: 1, xp: 3 });
  });

  it('erros de canteiro: vazio, bloqueado, ocupado, inexistente, item que não é semente', async () => {
    const { api } = setup();
    await expectCode(api.harvest({ slotId: 'plot_01', requestId: rid() }), 'SLOT_EMPTY');
    await expectCode(
      api.plant({ slotId: 'plot_05', seedItemId: 'seed_carrot', requestId: rid() }),
      'SLOT_LOCKED',
    );
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
    await expectCode(
      api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() }),
      'SLOT_OCCUPIED',
    );
    await expectCode(
      api.plant({ slotId: 'nao_existe', seedItemId: 'seed_carrot', requestId: rid() }),
      'NOT_FOUND',
    );
    await expectCode(
      api.plant({ slotId: 'plot_02', seedItemId: 'crop_carrot', requestId: rid() }),
      'INVALID_INPUT',
    );
    await expectCode(
      api.plant({ slotId: 'plot_02', seedItemId: 'seed_potato', requestId: rid() }),
      'INSUFFICIENT_ITEMS',
    );
  });

  it('30 h offline creditam exatamente 28800 s', async () => {
    const { api, clock } = setup();
    await api.bootstrap();
    clock.advanceSeconds(30 * 3600);
    const b = await api.bootstrap();
    expect(b.offlineReport).toEqual({
      realSeconds: 108_000,
      creditedSeconds: ECONOMY.OFFLINE_CAP_SECONDS,
      capped: true,
    });
    expect(b.farm.farmClock).toBe(28_800);
    // e o relógio continua normal depois
    clock.advanceSeconds(60);
    expect((await api.heartbeat()).farmClock).toBe(28_860);
  });

  it('online (heartbeats) o crédito é contínuo e não perde frações de segundo', async () => {
    const { api, clock } = setup();
    for (let i = 0; i < 10; i++) {
      clock.advanceMs(1500);
      await api.heartbeat();
    }
    expect((await api.heartbeat()).farmClock).toBe(15);
  });

  it('morango não fica pronto antes da hora mesmo com o aparelho adiantado (só o relógio do servidor conta)', async () => {
    const { api, clock } = setup({ starter: { coins: 1000, items: [] } });
    await api.shopBuy({ itemId: 'seed_strawberry', qty: 1, requestId: rid() });
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    clock.advanceSeconds(3599);
    await expectCode(api.harvest({ slotId: 'plot_01', requestId: rid() }), 'NOT_READY');
    clock.advanceSeconds(1);
    await expect(api.harvest({ slotId: 'plot_01', requestId: rid() })).resolves.toBeTruthy();
  });

  it('request_id repetido não duplica nada (DUPLICATE_REQUEST, estado igual)', async () => {
    const { api } = setup();
    const id = rid();
    await api.shopBuy({ itemId: 'seed_carrot', qty: 2, requestId: id });
    const before = api.inspect();
    await expectCode(
      api.shopBuy({ itemId: 'seed_carrot', qty: 2, requestId: id }),
      'DUPLICATE_REQUEST',
    );
    await expectCode(
      api.shopSell({ itemId: 'seed_carrot', qty: 1, requestId: id }),
      'DUPLICATE_REQUEST',
    );
    expect(api.inspect()).toEqual(before);
    expect(before.coins).toBe(80);
    expect(before.inventory.seed_carrot).toBe(7);
  });

  it('pedido que falhou não consome o request_id e não muda nada', async () => {
    const { api } = setup();
    const id = rid();
    const before = api.inspect();
    await expectCode(
      api.shopBuy({ itemId: 'seed_strawberry', qty: 5, requestId: id }),
      'INSUFFICIENT_FUNDS',
    );
    expect(api.inspect()).toEqual(before);
    await expect(
      api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: id }),
    ).resolves.toBeTruthy();
  });

  it('saldo e inventário nunca ficam negativos', async () => {
    const { api } = setup();
    await expectCode(
      api.shopBuy({ itemId: 'seed_carrot', qty: 11, requestId: rid() }),
      'INSUFFICIENT_FUNDS',
    );
    await expectCode(
      api.shopSell({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
      'INSUFFICIENT_ITEMS',
    );
    await expectCode(
      api.shopSell({ itemId: 'crop_carrot', qty: -5, requestId: rid() }),
      'INVALID_INPUT',
    );
    await expectCode(
      api.shopBuy({ itemId: 'seed_carrot', qty: 1.5, requestId: rid() }),
      'INVALID_INPUT',
    );
    await expectCode(api.unlockSlot({ slotId: 'plot_05', requestId: rid() }), 'LEVEL_TOO_LOW');

    // sequência aleatória (determinística) de compras e vendas
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const ids = ['seed_carrot', 'seed_potato', 'seed_strawberry', 'crop_carrot'];
    for (let i = 0; i < 300; i++) {
      const itemId = ids[Math.floor(rnd() * ids.length)]!;
      const qty = 1 + Math.floor(rnd() * 12);
      const op = rnd() < 0.5 ? api.shopBuy.bind(api) : api.shopSell.bind(api);
      await op({ itemId, qty, requestId: rid() }).catch((e: unknown) => {
        expect(e).toBeInstanceOf(ApiError);
      });
      const s = api.inspect();
      expect(s.coins).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(s.coins)).toBe(true);
      for (const q of Object.values(s.inventory)) expect(q).toBeGreaterThan(0);
    }
  });

  it('loja: NOT_FOR_SALE para o que a loja não vende/compra; venda credita sellPrice', async () => {
    const { api, clock } = setup();
    await expectCode(
      api.shopBuy({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
      'NOT_FOR_SALE',
    );
    await expectCode(
      api.shopSell({ itemId: 'seed_carrot', qty: 1, requestId: rid() }),
      'NOT_FOR_SALE',
    );
    await expectCode(api.shopBuy({ itemId: 'nada', qty: 1, requestId: rid() }), 'NOT_FOUND');
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
    clock.advanceSeconds(120);
    const h = await api.harvest({ slotId: 'plot_01', requestId: rid() });
    const qty = h.gained![0]!.qty;
    const r = await api.shopSell({ itemId: 'crop_carrot', qty, requestId: rid() });
    expect(r.wallet?.coins).toBe(100 + 15 * qty);
    expect(r.inventoryChanges).toEqual([{ itemId: 'crop_carrot', qty: 0 }]);
  });

  it('harvest_all colhe só o que está pronto', async () => {
    const { api, clock } = setup({
      starter: {
        coins: 0,
        items: [
          { itemId: 'seed_carrot', qty: 2 },
          { itemId: 'seed_potato', qty: 1 },
        ],
      },
    });
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
    await api.plant({ slotId: 'plot_02', seedItemId: 'seed_carrot', requestId: rid() });
    await api.plant({ slotId: 'plot_03', seedItemId: 'seed_potato', requestId: rid() });
    clock.advanceSeconds(120);
    const r = await api.harvestAll({ requestId: rid() });
    expect(r.plots?.map((p) => p.slotId)).toEqual(['plot_01', 'plot_02']);
    expect(r.xp?.xp).toBe(6);
    const empty = await api.harvestAll({ requestId: rid() });
    expect(empty.plots).toBeUndefined();
  });

  it('unlock_slot cobra moedas e respeita nível', async () => {
    const { api } = setup({
      starter: { coins: 1000, items: [] },
      slots: [
        { slotId: 'a', unlockCost: 0, unlockLevel: 1, startsUnlocked: true },
        { slotId: 'b', unlockCost: 300, unlockLevel: 1, startsUnlocked: false },
      ],
    });
    const r = await api.unlockSlot({ slotId: 'b', requestId: rid() });
    expect(r.wallet?.coins).toBe(700);
    expect(r.plots?.[0]?.unlocked).toBe(true);
    await expectCode(api.unlockSlot({ slotId: 'b', requestId: rid() }), 'ALREADY_UNLOCKED');
  });

  it('animais: produção limitada a max_stock', async () => {
    const { api, clock } = setup({ starter: { coins: 5000, items: [] } });
    // sobe de nível plantando? mais simples: catálogo próprio sem exigência de nível
    const custom = new MockApi({
      clock,
      starter: { coins: 5000, items: [] },
      catalog: {
        items: [
          {
            id: 'prod_egg',
            kind: 'animal_product',
            rarity: 'common',
            basePrice: 1,
            sellPrice: 1,
            shopBuyable: false,
            tradable: true,
            minPrice: 1,
            maxPrice: 5,
            stackable: true,
            spriteKey: 'icon/egg',
          },
        ],
        crops: [],
        animals: [
          {
            animalType: 'animal_chicken',
            buyPrice: 300,
            productItemId: 'prod_egg',
            produceSeconds: 100,
            maxStock: 3,
            habitat: 'coop',
            xp: 1,
            unlockLevel: 1,
          },
        ],
      },
    });
    await expectCode(
      api.buyAnimal({ animalType: 'animal_chicken', requestId: rid() }),
      'LEVEL_TOO_LOW',
    );
    const bought = await custom.buyAnimal({ animalType: 'animal_chicken', requestId: rid() });
    const id = bought.animals![0]!.id;
    await expectCode(
      custom.collectAnimal({ animalId: id, requestId: rid() }),
      'NOTHING_TO_COLLECT',
    );
    clock.advanceSeconds(250);
    const c1 = await custom.collectAnimal({ animalId: id, requestId: rid() });
    expect(c1.gained).toEqual([{ itemId: 'prod_egg', qty: 2 }]);
    expect(c1.animals![0]!.lastCollectFc).toBe(200);
    clock.advanceSeconds(10_000);
    const c2 = await custom.collectAnimal({ animalId: id, requestId: rid() });
    expect(c2.gained).toEqual([{ itemId: 'prod_egg', qty: 3 }]);
  });

  it('grupos Mercado/Visitas lançam NOT_IMPLEMENTED; world state funciona', async () => {
    const { api, clock } = setup({ timezone: 'UTC' });
    await expectCode(api.marketSearch(), 'NOT_IMPLEMENTED');
    await expectCode(api.visitGetFarm(), 'NOT_IMPLEMENTED');
    clock.set(Date.UTC(2026, 0, 1, 19, 30, 0));
    const w = await api.getWorldState();
    expect(w).toMatchObject({ localHour: 19, phase: 'night', nightEventActive: true });
    expect(w.eventEndsAt).toBe(Date.UTC(2026, 0, 1, 21, 0, 0));
    clock.set(Date.UTC(2026, 0, 1, 21, 0, 0));
    expect((await api.getWorldState()).nightEventActive).toBe(false);
  });

  it('o chamador não consegue alterar o estado interno pelo objeto retornado', async () => {
    const { api } = setup();
    const b = await api.bootstrap();
    b.wallet.coins = 999_999;
    b.farm.plots[0]!.unlocked = false;
    const again = await api.bootstrap();
    expect(again.wallet.coins).toBe(100);
    expect(again.farm.plots[0]!.unlocked).toBe(true);
  });
});
