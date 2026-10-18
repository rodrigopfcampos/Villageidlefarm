// Suíte de CONTRATO: os mesmos cenários rodam contra a API falsa (MockApi) e contra o servidor real
// (Postgres com as migrations de supabase/, chamado pela SupabaseApi). Cenários portados de
// mockApi.test.ts e mockApi.rules.test.ts. Onde o servidor difere de propósito (retirada fica 'pending'
// até a Steam confirmar; sorteios usam outra fonte de aleatoriedade) o teste aceita os dois.

import { afterAll, describe, expect, it } from 'vitest';
import { ApiError, ECONOMY, RARITIES, type ErrorCode, type InventoryEntry } from '@vif/shared';
import { startTestDb } from './support/db';
import {
  mockHarness,
  serverHarness,
  type Harness,
  type HarnessFactory,
  type HarnessOptions,
} from './support/harness';

const db = await startTestDb();
afterAll(async () => {
  await db?.stop();
});

async function expectCode(p: Promise<unknown>, code: ErrorCode) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ code });
}

/** Usa as 5 cartas de Ouro (uma por vez, esperando cada janela acabar) para completar a linha. */
async function useGoldLine(h: Harness) {
  for (const r of RARITIES) {
    const c = await h.grantCard(`card_gold_${r}`);
    await h.api.cardActivate({ instanceId: c.id, requestId: h.rid() });
    h.clock.advanceSeconds(3 * 3600);
    await h.api.heartbeat();
  }
}

const rich = (items: InventoryEntry[] = []) => ({ coins: 1_000_000, items });
const DAY10 = Date.UTC(2026, 0, 10, 12, 0, 0);

const targets: [string, HarnessFactory | null][] = [
  ['mock', mockHarness],
  ['servidor', db ? serverHarness(db) : null],
];

for (const [name, factory] of targets) {
  const make = (opts: HarnessOptions = {}) => factory!(opts);
  /** Padrões das regras novas (mockApi.rules.test.ts): fuso UTC, dia 10 ao meio-dia. */
  const rules = (opts: HarnessOptions = {}) => make({ timezone: 'UTC', start: DAY10, ...opts });

  describe.skipIf(!factory)(`contrato: núcleo (${name})`, { timeout: 60_000 }, () => {
    it('bootstrap devolve conta nova com kit inicial e 4 canteiros liberados', async () => {
      const { api } = await make();
      const b = await api.bootstrap();
      expect(b.wallet.coins).toBe(100);
      expect(b.inventory).toEqual([{ itemId: 'seed_carrot', qty: 5 }]);
      expect(b.farm.plots.filter((p) => p.unlocked)).toHaveLength(4);
      expect(b.farm.farmClock).toBe(0);
      expect(b.offlineReport).toEqual({ realSeconds: 0, creditedSeconds: 0, capped: false });
      expect(b.cards).toEqual([]);
      expect(b.activeBuffs).toEqual([]);
      expect(b.profile).toMatchObject({
        level: 1,
        xp: 0,
        vip: false,
        timezone: 'America/Sao_Paulo',
      });
    });

    it('plantar consome a semente e marca readyFc = plantado + growSeconds', async () => {
      const { api, clock, rid } = await make();
      clock.advanceSeconds(10);
      const r = await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
      expect(r.farmClock).toBe(10);
      expect(r.plots).toEqual([
        { slotId: 'plot_01', unlocked: true, cropId: 'crop_carrot', plantedFc: 10, readyFc: 130 },
      ]);
      expect(r.inventoryChanges).toEqual([{ itemId: 'seed_carrot', qty: 4 }]);
    });

    it('colher antes da hora = NOT_READY; na hora certa colhe e dá xp', async () => {
      const { api, clock, rid } = await make();
      await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
      clock.advanceSeconds(119);
      await expectCode(api.harvest({ slotId: 'plot_01', requestId: rid() }), 'NOT_READY');
      clock.advanceSeconds(1);
      const r = await api.harvest({ slotId: 'plot_01', requestId: rid() });
      expect(r.plots?.[0]).toMatchObject({ cropId: null, readyFc: null });
      expect(r.gained?.[0]).toEqual({ itemId: 'crop_carrot', qty: 1 });
      expect(r.xp).toEqual({ level: 1, xp: 1, accountLevel: 1, accountXp: 1 });
    });

    it('erros de canteiro: vazio, bloqueado, ocupado, inexistente, item que não é semente', async () => {
      const { api, rid } = await make();
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
      await expectCode(api.harvest({ slotId: 'plot_05', requestId: rid() }), 'SLOT_LOCKED');
    });

    it('30 h offline creditam exatamente 28800 s', async () => {
      const { api, clock } = await make();
      await api.bootstrap();
      clock.advanceSeconds(30 * 3600);
      const b = await api.bootstrap();
      expect(b.offlineReport).toEqual({
        realSeconds: 108_000,
        creditedSeconds: ECONOMY.OFFLINE_CAP_SECONDS,
        capped: true,
      });
      expect(b.farm.farmClock).toBe(28_800);
      clock.advanceSeconds(60);
      expect((await api.heartbeat()).farmClock).toBe(28_860);
    });

    it('online (heartbeats) o crédito é contínuo e não perde frações de segundo', async () => {
      const { api, clock } = await make();
      for (let i = 0; i < 10; i++) {
        clock.advanceMs(10_500);
        await api.heartbeat();
      }
      clock.advanceMs(10_000);
      expect((await api.heartbeat()).farmClock).toBe(115);
    });

    it('morango não fica pronto antes da hora (só o relógio do servidor conta)', async () => {
      const { api, clock, rid } = await make({ starter: { coins: 1000, items: [] } });
      await api.shopBuy({ itemId: 'seed_strawberry', qty: 1, requestId: rid() });
      await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
      clock.advanceSeconds(3599);
      await expectCode(api.harvest({ slotId: 'plot_01', requestId: rid() }), 'NOT_READY');
      clock.advanceSeconds(1);
      await expect(api.harvest({ slotId: 'plot_01', requestId: rid() })).resolves.toBeTruthy();
    });

    it('request_id repetido não duplica nada (DUPLICATE_REQUEST, estado igual)', async () => {
      const h = await make();
      const { api } = h;
      const id = h.rid();
      await api.shopBuy({ itemId: 'seed_carrot', qty: 2, requestId: id });
      const before = await h.inspect();
      await expectCode(
        api.shopBuy({ itemId: 'seed_carrot', qty: 2, requestId: id }),
        'DUPLICATE_REQUEST',
      );
      await expectCode(
        api.shopSell({ itemId: 'seed_carrot', qty: 1, requestId: id }),
        'DUPLICATE_REQUEST',
      );
      expect(await h.inspect()).toEqual(before);
      expect(before.coins).toBe(92);
      expect(before.inventory.seed_carrot).toBe(7);
    });

    it('pedido que falhou não consome o request_id e não muda nada', async () => {
      const h = await make();
      const id = h.rid();
      const before = await h.inspect();
      await expectCode(
        h.api.shopBuy({ itemId: 'seed_strawberry', qty: 5, requestId: id }),
        'INSUFFICIENT_FUNDS',
      );
      expect(await h.inspect()).toEqual(before);
      await expect(
        h.api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: id }),
      ).resolves.toBeTruthy();
    });

    it('saldo e inventário nunca ficam negativos', async () => {
      const h = await make();
      const { api, rid } = h;
      await expectCode(
        api.shopBuy({ itemId: 'seed_carrot', qty: 26, requestId: rid() }),
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
      await expectCode(
        api.shopBuy({ itemId: 'seed_carrot', qty: 1000, requestId: rid() }),
        'INVALID_INPUT',
      );
      await expectCode(api.unlockSlot({ slotId: 'plot_05', requestId: rid() }), 'LEVEL_TOO_LOW');
      await expectCode(
        api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: '' }),
        'INVALID_INPUT',
      );

      let seed = 42;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      const ids = ['seed_carrot', 'seed_potato', 'seed_strawberry', 'crop_carrot'];
      for (let i = 0; i < 120; i++) {
        const itemId = ids[Math.floor(rnd() * ids.length)]!;
        const qty = 1 + Math.floor(rnd() * 12);
        const op = rnd() < 0.5 ? api.shopBuy.bind(api) : api.shopSell.bind(api);
        await op({ itemId, qty, requestId: rid() }).catch((e: unknown) => {
          expect(e).toBeInstanceOf(ApiError);
        });
        const s = await h.inspect();
        expect(s.coins).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(s.coins)).toBe(true);
        for (const q of Object.values(s.inventory)) expect(q).toBeGreaterThan(0);
      }
    });

    it('loja: NOT_FOR_SALE para o que a loja não vende/compra; venda credita sellPrice', async () => {
      const { api, clock, rid } = await make();
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
      expect(r.wallet?.coins).toBe(100 + 6 * qty);
      expect(r.inventoryChanges).toEqual([{ itemId: 'crop_carrot', qty: 0 }]);
    });

    it('harvest_all colhe só o que está pronto; sem nada pronto não é erro', async () => {
      const { api, clock, rid } = await make({
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
      expect(r.xp?.xp).toBe(2);
      expect(r.gained).toEqual([{ itemId: 'crop_carrot', qty: 2 }]);
      const empty = await api.harvestAll({ requestId: rid() });
      expect(empty.plots).toBeUndefined();
      expect(empty.farmClock).toBe(120);
    });

    it('unlock_slot cobra moedas e respeita nível', async () => {
      const { api, rid } = await make({
        starter: { coins: 1000, items: [] },
        slots: [
          { slotId: 'ct_a', unlockCost: 0, unlockLevel: 1, startsUnlocked: true },
          { slotId: 'ct_b', unlockCost: 300, unlockLevel: 1, startsUnlocked: false },
        ],
      });
      const r = await api.unlockSlot({ slotId: 'ct_b', requestId: rid() });
      expect(r.wallet?.coins).toBe(700);
      expect(r.plots?.[0]?.unlocked).toBe(true);
      await expectCode(api.unlockSlot({ slotId: 'ct_b', requestId: rid() }), 'ALREADY_UNLOCKED');
      await expectCode(api.unlockSlot({ slotId: 'nada', requestId: rid() }), 'NOT_FOUND');
    });

    it('animais: nível, NOTHING_TO_COLLECT e produção limitada a max_stock', async () => {
      const low = await make({ starter: { coins: 5000, items: [] } });
      await expectCode(
        low.api.buyAnimal({ animalType: 'animal_chicken', requestId: low.rid() }),
        'LEVEL_TOO_LOW',
      );
      // galinha: nível 3, 300 moedas, 1 ovo a cada 1800 s, estoque máx. 3
      const { api, clock, rid } = await make({ starter: { coins: 5000, items: [] }, xp: 150 });
      await expectCode(
        api.buyAnimal({ animalType: 'animal_dragon', requestId: rid() }),
        'NOT_FOUND',
      );
      const bought = await api.buyAnimal({ animalType: 'animal_chicken', requestId: rid() });
      expect(bought.wallet?.coins).toBe(4700);
      const id = bought.animals![0]!.id;
      expect(bought.animals![0]).toMatchObject({ animalType: 'animal_chicken', lastCollectFc: 0 });
      await expectCode(api.collectAnimal({ animalId: id, requestId: rid() }), 'NOTHING_TO_COLLECT');
      await expectCode(api.collectAnimal({ animalId: 'nada', requestId: rid() }), 'NOT_FOUND');
      clock.advanceSeconds(4500);
      const c1 = await api.collectAnimal({ animalId: id, requestId: rid() });
      expect(c1.gained).toEqual([{ itemId: 'prod_egg', qty: 2 }]);
      expect(c1.animals![0]!.lastCollectFc).toBe(3600);
      clock.advanceSeconds(10_000);
      const c2 = await api.collectAnimal({ animalId: id, requestId: rid() });
      expect(c2.gained).toEqual([{ itemId: 'prod_egg', qty: 3 }]);
      expect(c2.animals![0]!.lastCollectFc).toBe(14_500);
      const b = await api.bootstrap();
      expect(b.farm.animals).toHaveLength(1);
      expect(b.inventory).toEqual([{ itemId: 'prod_egg', qty: 5 }]);
    });

    it('Visitas lança NOT_IMPLEMENTED; world state mostra o evento noturno', async () => {
      const { api, clock } = await make({ timezone: 'UTC' });
      await expectCode(api.visitGetFarm('x'), 'NOT_IMPLEMENTED');
      clock.set(Date.UTC(2026, 0, 1, 19, 30, 0));
      const w = await api.getWorldState();
      expect(w).toMatchObject({ localHour: 19, phase: 'night', timezone: 'UTC' });
      expect(w.nightEvent).toEqual({
        active: true,
        speedMult: 1.5,
        attendanceSeconds: 0,
        requiredSeconds: 1800,
        cardClaimed: false,
        endsAt: Date.UTC(2026, 0, 1, 21, 0, 0),
      });
      clock.set(Date.UTC(2026, 0, 1, 21, 0, 0));
      expect((await api.getWorldState()).nightEvent).toMatchObject({ active: false, endsAt: null });
    });

    it('evento ativo às 19:30 e inativo às 21:00 no fuso do perfil (São Paulo, UTC−3)', async () => {
      const { api, clock } = await make({ timezone: 'America/Sao_Paulo' });
      clock.set(Date.UTC(2026, 0, 1, 22, 30, 0)); // 19:30 em São Paulo
      const w = await api.getWorldState();
      expect(w.localHour).toBe(19);
      expect(w.nightEvent).toMatchObject({ active: true, endsAt: Date.UTC(2026, 0, 2, 0, 0, 0) });
      clock.set(Date.UTC(2026, 0, 2, 0, 0, 0)); // 21:00 em São Paulo
      expect((await api.getWorldState()).nightEvent.active).toBe(false);
      clock.set(Date.UTC(2026, 0, 1, 19, 30, 0)); // 16:30 em São Paulo
      expect((await api.getWorldState()).nightEvent.active).toBe(false);
    });

    it('heartbeat com limite de frequência (anti-bot)', async () => {
      const { api, clock } = await make();
      await api.heartbeat();
      clock.advanceSeconds(5);
      await expectCode(api.heartbeat(), 'RATE_LIMITED');
      clock.advanceSeconds(5);
      await expect(api.heartbeat()).resolves.toBeTruthy();
    });

    it('o chamador não consegue alterar o estado pelo objeto retornado', async () => {
      const { api } = await make();
      const b = await api.bootstrap();
      b.wallet.coins = 999_999;
      b.farm.plots[0]!.unlocked = false;
      const again = await api.bootstrap();
      expect(again.wallet.coins).toBe(100);
      expect(again.farm.plots[0]!.unlocked).toBe(true);
    });
  });

  describe.skipIf(!factory)(`contrato: cartas e álbum (${name})`, { timeout: 120_000 }, () => {
    it('drop proporcional ao tempo de cultivo (melancia 8 h ≈ 10%, cenoura 2 min ≈ 0,04%)', async () => {
      const { api, clock, rid } = await rules({ starter: rich(), xp: 500 });
      const harvestMany = async (seed: string, secs: number, times: number) => {
        let drops = 0;
        for (let i = 0; i < times; i++) {
          await api.shopBuy({ itemId: seed, qty: 1, requestId: rid() });
          await api.plant({ slotId: 'plot_01', seedItemId: seed, requestId: rid() });
          clock.advanceSeconds(secs);
          const r = await api.harvest({ slotId: 'plot_01', requestId: rid() });
          drops += r.cards?.length ?? 0;
          for (const c of r.cards ?? []) {
            expect(c).toMatchObject({ source: 'drop', status: 'unused' });
          }
        }
        return drops;
      };
      const melon = await harvestMany('seed_watermelon', 28_800, 300);
      expect(melon).toBeGreaterThan(15);
      expect(melon).toBeLessThan(50);
      const carrot = await harvestMany('seed_carrot', 120, 300);
      expect(carrot).toBeLessThanOrEqual(3);
      expect((await api.bootstrap()).cards).toHaveLength(melon + carrot);
    });

    it('1 ativa (2 com VIP), mesma carta não reutiliza, mesmo buff não acumula', async () => {
      const h = await rules();
      const { api, clock, rid } = h;
      const gold = await h.grantCard('card_gold_common');
      const luck = await h.grantCard('card_luck_common');
      const xp = await h.grantCard('card_farm_xp_common');
      const gold2 = await h.grantCard('card_gold_rare');

      const r = await api.cardActivate({ instanceId: gold.id, requestId: rid() });
      expect(r.activeBuffs).toHaveLength(1);
      expect(r.activeBuffs![0]).toMatchObject({ buff: 'gold', magnitude: 0.5, endsFc: 3600 });
      expect(r.cards![0]).toMatchObject({ id: gold.id, status: 'used' });
      expect(r.inventoryChanges).toEqual([{ itemId: 'card_gold_common', qty: 1 }]);

      await expectCode(
        api.cardActivate({ instanceId: gold.id, requestId: rid() }),
        'CARD_ALREADY_USED',
      );
      await expectCode(
        api.cardActivate({ instanceId: luck.id, requestId: rid() }),
        'CARD_SLOT_FULL',
      );
      await expectCode(api.cardActivate({ instanceId: 'nada', requestId: rid() }), 'NOT_FOUND');

      await h.setVip(true);
      await expectCode(
        api.cardActivate({ instanceId: gold2.id, requestId: rid() }),
        'BUFF_ALREADY_ACTIVE',
      );
      await api.cardActivate({ instanceId: luck.id, requestId: rid() });
      await expectCode(api.cardActivate({ instanceId: xp.id, requestId: rid() }), 'CARD_SLOT_FULL');

      clock.advanceSeconds(3600);
      const r2 = await api.cardActivate({ instanceId: xp.id, requestId: rid() });
      expect(r2.activeBuffs!.map((b) => b.buff)).toEqual(['farm_xp']);
      const b = await api.bootstrap();
      expect(b.activeBuffs.map((x) => x.buff)).toEqual(['farm_xp']);
      expect(b.cards.map((c) => c.id)).toEqual([gold2.id]);
    });

    it('durações: 1 h comum … 3 h lendária', async () => {
      const h = await rules({ vip: true });
      const a = await h.grantCard('card_gold_legendary');
      const r = await h.api.cardActivate({ instanceId: a.id, requestId: h.rid() });
      expect(r.activeBuffs![0]!.endsFc - r.activeBuffs![0]!.startedFc).toBe(10_800);
      expect(r.activeBuffs![0]!.endsAt - r.activeBuffs![0]!.startedAt).toBe(10_800_000);
    });

    it('Ouro ativado no momento da colheita de uma melancia de 8 h não dá bônus', async () => {
      const h = await rules({ starter: rich([{ itemId: 'seed_watermelon', qty: 1 }]), xp: 500 });
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_watermelon', requestId: h.rid() });
      h.clock.advanceSeconds(28_800);
      const card = await h.grantCard('card_gold_legendary');
      await h.api.cardActivate({ instanceId: card.id, requestId: h.rid() });
      const r = await h.api.harvest({ slotId: 'plot_01', requestId: h.rid() });
      expect(r.bonusCoins).toBeUndefined();
      expect(r.wallet).toBeUndefined();
    });

    it('Ouro ativo só na última 1 h da melancia de 8 h dá só a fração (1/8 de +50%)', async () => {
      // começa à meia-noite para a última hora não cair no evento noturno (que encurtaria o cultivo)
      const h = await rules({
        starter: rich([{ itemId: 'seed_watermelon', qty: 1 }]),
        xp: 500,
        start: Date.UTC(2026, 0, 10, 0, 0, 0),
      });
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_watermelon', requestId: h.rid() });
      h.clock.advanceSeconds(25_200);
      const card = await h.grantCard('card_gold_common');
      await h.api.cardActivate({ instanceId: card.id, requestId: h.rid() });
      h.clock.advanceSeconds(3600);
      const before = (await h.inspect()).coins;
      const r = await h.api.harvest({ slotId: 'plot_01', requestId: h.rid() });
      expect(r.bonusCoins).toBe(30); // 480 × 0,5 × 3600/28800
      expect(r.wallet!.coins).toBe(before + 30);
    });

    it('buff expirado ainda vale para a parte do cultivo que ocorreu na janela', async () => {
      const h = await rules({ starter: rich([{ itemId: 'seed_watermelon', qty: 1 }]), xp: 500 });
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_watermelon', requestId: h.rid() });
      const card = await h.grantCard('card_gold_common');
      await h.api.cardActivate({ instanceId: card.id, requestId: h.rid() });
      h.clock.advanceSeconds(28_800);
      const r = await h.api.harvest({ slotId: 'plot_01', requestId: h.rid() });
      expect(r.bonusCoins).toBe(30);
    });

    it('Adubo avança na hora os canteiros e não ocupa vaga', async () => {
      const h = await rules({ starter: rich([{ itemId: 'seed_strawberry', qty: 2 }]) });
      const { api, rid } = h;
      await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
      await api.plant({ slotId: 'plot_02', seedItemId: 'seed_strawberry', requestId: rid() });
      const fert = await h.grantCard('card_fertilizer_common');
      const r = await api.cardActivate({ instanceId: fert.id, requestId: rid() });
      expect(r.plots!.map((p) => p.readyFc)).toEqual([1800, 1800]);
      expect(r.activeBuffs).toBeUndefined();
      const gold = await h.grantCard('card_gold_common');
      await expect(
        api.cardActivate({ instanceId: gold.id, requestId: rid() }),
      ).resolves.toBeTruthy();
      const leg = await h.grantCard('card_fertilizer_legendary');
      const r2 = await api.cardActivate({ instanceId: leg.id, requestId: rid() });
      expect(r2.plots!.every((p) => p.readyFc === p.plantedFc)).toBe(true);
    });

    it('Mercador foi removido (ECONOMIA.md): a loja cobra o preço cheio', async () => {
      const h = await rules();
      const m = await h.grantCard('card_merchant_common');
      await h.api.cardActivate({ instanceId: m.id, requestId: h.rid() });
      const r = await h.api.shopBuy({ itemId: 'seed_carrot', qty: 5, requestId: h.rid() });
      // a mock (A0) ainda dá o desconto antigo de 25%
      expect(r.wallet!.coins).toBe(h.kind === 'mock' ? 100 - 15 : 100 - 20);
    });

    it('Colheita farta (+1) e XP de fazenda (+50%) com a janela cobrindo todo o cultivo', async () => {
      const h = await rules({ vip: true, starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]) });
      for (const id of ['card_bountiful_harvest_rare', 'card_farm_xp_rare']) {
        const c = await h.grantCard(id);
        await h.api.cardActivate({ instanceId: c.id, requestId: h.rid() });
      }
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: h.rid() });
      h.clock.advanceSeconds(3600);
      const r = await h.api.harvest({ slotId: 'plot_01', requestId: h.rid() });
      expect(r.gained).toEqual([{ itemId: 'crop_strawberry', qty: 2 }]);
      expect([31, 32]).toContain(r.xp!.xp); // 21 × 1,5 = 31,5 (arredondamento estocástico)
      // XP único (ECONOMIA.md): "XP de conta" = XP da fazenda. A mock ainda tem dois trilhos.
      if (h.kind === 'server') expect(r.xp!.accountXp).toBe(r.xp!.xp);
    });

    it('álbum: 40 espaços; linha completa dá +2% permanente', async () => {
      const h = await rules();
      await useGoldLine(h);
      const album = await h.api.albumGet();
      expect(album.slots).toHaveLength(40);
      expect(album.completedLines).toEqual(['gold']);
      expect(album.bonusPercent).toEqual({ gold: 2 });
    });

    it('carta usada entra no álbum como cópia', async () => {
      const h = await rules();
      const c = await h.grantCard('card_luck_epic');
      await h.api.cardActivate({ instanceId: c.id, requestId: h.rid() });
      const album = await h.api.albumGet();
      expect(album.slots.find((s) => s.cardId === 'card_luck_epic')?.copies).toBe(1);
      expect(album.slots.filter((s) => s.copies > 0)).toHaveLength(1);
      expect(album.completedLines).toEqual([]);
    });

    it('bônus de Ouro do álbum (+2%) aparece em média nas colheitas', async () => {
      const h = await rules({ starter: rich() });
      await useGoldLine(h);
      let bonus = 0;
      for (let i = 0; i < 200; i++) {
        await h.api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: h.rid() });
        await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: h.rid() });
        h.clock.advanceSeconds(120);
        bonus += (await h.api.harvest({ slotId: 'plot_01', requestId: h.rid() })).bonusCoins ?? 0;
      }
      expect(bonus).toBeGreaterThan(12); // esperado 200 × 6 × 0,02 = 24
      expect(bonus).toBeLessThan(40);
    });
  });

  describe.skipIf(!factory)(`contrato: evento noturno (${name})`, { timeout: 60_000 }, () => {
    const t = (h: number, m = 0) => Date.UTC(2026, 0, 10, h, m, 0);

    it('quem está ativo (heartbeat + interação) cresce ×1.5 e ganha a carta após 30 min', async () => {
      const h = await rules({
        starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]),
        start: t(18, 59),
      });
      const { api, clock, rid } = h;
      await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
      for (let min = 1; min <= 40; min++) {
        clock.advanceSeconds(60);
        if (min % 4 === 0) await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: rid() });
        else await api.heartbeat();
      }
      const w = await api.getWorldState();
      expect(w.nightEvent.attendanceSeconds).toBe(39 * 60);
      const plot = (await h.inspect()).plots.find((p) => p.slotId === 'plot_01')!;
      expect(plot.readyFc).toBe(3600 - Math.floor((39 * 60) / 2));

      const r = await api.claimNightEvent({ requestId: rid() });
      expect(r.card).toMatchObject({ source: 'night_event', status: 'unused' });
      expect(r.cards).toHaveLength(1);
      await expectCode(api.claimNightEvent({ requestId: rid() }), 'ALREADY_CLAIMED');
      expect((await api.getWorldState()).nightEvent.cardClaimed).toBe(true);
    });

    it('carta do evento: só 1 por dia local; no dia seguinte, com nova presença, pode de novo', async () => {
      const h = await rules({ starter: rich(), start: t(19, 0) });
      const { api, clock, rid } = h;
      const attend = async (minutes: number) => {
        for (let min = 1; min <= minutes; min++) {
          clock.advanceSeconds(60);
          await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: rid() });
        }
      };
      await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: rid() });
      await attend(29);
      await expectCode(api.claimNightEvent({ requestId: rid() }), 'NOT_ACTIVE');
      await attend(1);
      await api.claimNightEvent({ requestId: rid() });
      await attend(5);
      await expectCode(api.claimNightEvent({ requestId: rid() }), 'ALREADY_CLAIMED');
      clock.set(Date.UTC(2026, 0, 11, 19, 0, 0));
      await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: rid() });
      await attend(30);
      await expect(api.claimNightEvent({ requestId: rid() })).resolves.toBeTruthy();
    });

    it('não acelera quem está offline e não dá carta', async () => {
      const h = await rules({
        starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]),
        start: t(18, 50),
      });
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: h.rid() });
      h.clock.set(t(21, 30));
      const b = await h.api.bootstrap();
      expect(b.farm.plots.find((p) => p.slotId === 'plot_01')!.readyFc).toBe(3600);
      expect((await h.api.getWorldState()).nightEvent.attendanceSeconds).toBe(0);
      await expectCode(h.api.claimNightEvent({ requestId: h.rid() }), 'NOT_ACTIVE');
    });

    it('só heartbeat sem interação: presença vale no máximo 5 min após a última ação', async () => {
      const h = await rules({
        starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]),
        start: t(19, 0),
      });
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: h.rid() });
      for (let min = 1; min <= 30; min++) {
        h.clock.advanceSeconds(60);
        await h.api.heartbeat();
      }
      expect((await h.api.getWorldState()).nightEvent.attendanceSeconds).toBe(300);
      expect((await h.inspect()).plots[0]!.readyFc).toBe(3600 - 150);
    });

    it('heartbeat devolve os canteiros acelerados', async () => {
      const h = await rules({
        starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]),
        start: t(19, 0),
      });
      await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: h.rid() });
      h.clock.advanceSeconds(60);
      const hb = await h.api.heartbeat();
      expect(hb.plots).toEqual([expect.objectContaining({ slotId: 'plot_01', readyFc: 3570 })]);
    });

    it('fuso: validado, troca a cada 30 dias e bloqueia o resgate por 24 h', async () => {
      const h = await rules({ start: t(12) });
      const { api, clock, rid } = h;
      await expectCode(api.setTimezone({ tz: 'Lua/Base', requestId: rid() }), 'INVALID_TZ');
      const p = await api.setTimezone({ tz: 'Asia/Tokyo', requestId: rid() });
      expect(p.timezone).toBe('Asia/Tokyo');
      await expectCode(api.claimNightEvent({ requestId: rid() }), 'TZ_CHANGE_TOO_SOON');
      clock.advanceSeconds(23 * 3600);
      await expectCode(api.claimNightEvent({ requestId: rid() }), 'TZ_CHANGE_TOO_SOON');
      clock.advanceSeconds(3600);
      await expectCode(api.claimNightEvent({ requestId: rid() }), 'NOT_ACTIVE');
      clock.advanceSeconds(28 * 86_400);
      await expectCode(
        api.setTimezone({ tz: 'America/Sao_Paulo', requestId: rid() }),
        'TZ_CHANGE_TOO_SOON',
      );
      clock.advanceSeconds(86_400);
      await expect(
        api.setTimezone({ tz: 'America/Sao_Paulo', requestId: rid() }),
      ).resolves.toMatchObject({
        timezone: 'America/Sao_Paulo',
      });
    });
  });

  describe.skipIf(!factory)(
    `contrato: retirada para a Steam (${name})`,
    { timeout: 60_000 },
    () => {
      const lvl5 = { xp: 500 };

      it('2ª retirada antes de 7 h = EXTRACTION_QUOTA; depois de 7 h volta a poder', async () => {
        const h = await rules({
          ...lvl5,
          starter: { coins: 0, items: [{ itemId: 'crop_carrot', qty: 3 }] },
        });
        const { api, clock, rid } = h;
        const r = await api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() });
        expect(r.extraction).toMatchObject({ itemId: 'crop_carrot', qty: 1 });
        // a mock concede na hora; o servidor deixa 'pending' até a Edge Function falar com a Steam
        expect(['pending', 'granted']).toContain(r.extraction.status);
        if (h.kind === 'mock') expect(r.extraction.steamItemId).toBeTruthy();
        expect(r.inventoryChanges).toEqual([{ itemId: 'crop_carrot', qty: 2 }]);
        expect(r.quota).toMatchObject({ used: 1, limit: 1, windowHours: 7 });
        expect(r.quota.nextSlotAt).toBe(r.extraction.createdAt + 7 * 3_600_000);

        clock.advanceSeconds(7 * 3600 - 1);
        await expectCode(
          api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
          'EXTRACTION_QUOTA',
        );
        expect((await h.inspect()).inventory.crop_carrot).toBe(2);
        clock.advanceSeconds(1);
        await expect(
          api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
        ).resolves.toBeTruthy();
        const list = await api.extractionList();
        expect(list).toHaveLength(2);
        expect(list[0]!.createdAt).toBeGreaterThan(list[1]!.createdAt);
      });

      it('VIP: 4 por janela', async () => {
        const h = await rules({
          ...lvl5,
          vip: true,
          starter: { coins: 0, items: [{ itemId: 'crop_potato', qty: 10 }] },
        });
        for (let i = 0; i < 4; i++) {
          await h.api.extractionRequest({ itemId: 'crop_potato', qty: 1, requestId: h.rid() });
        }
        await expectCode(
          h.api.extractionRequest({ itemId: 'crop_potato', qty: 1, requestId: h.rid() }),
          'EXTRACTION_QUOTA',
        );
        expect(await h.api.extractionQuota()).toMatchObject({ used: 4, limit: 4 });
      });

      it('regras: semente não sai, nível mínimo 5, 1 unidade por retirada, Steam fora do ar', async () => {
        const items = [
          { itemId: 'seed_carrot', qty: 5 },
          { itemId: 'crop_carrot', qty: 5 },
        ];
        const low = await rules({ starter: { coins: 0, items } });
        await expectCode(
          low.api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: low.rid() }),
          'LEVEL_TOO_LOW',
        );
        const h = await rules({ ...lvl5, starter: { coins: 0, items } });
        const { api, rid } = h;
        await expectCode(
          api.extractionRequest({ itemId: 'seed_carrot', qty: 1, requestId: rid() }),
          'NOT_EXTRACTABLE',
        );
        await expectCode(
          api.extractionRequest({ itemId: 'nada', qty: 1, requestId: rid() }),
          'NOT_FOUND',
        );
        await expectCode(
          api.extractionRequest({ itemId: 'crop_carrot', qty: 2, requestId: rid() }),
          'INVALID_INPUT',
        );
        await expectCode(
          api.extractionRequest({ itemId: 'prod_milk', qty: 1, requestId: rid() }),
          'INSUFFICIENT_ITEMS',
        );
        h.setSteamAvailable(false);
        await expectCode(
          api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
          'STEAM_UNAVAILABLE',
        );
        expect(await api.extractionQuota()).toMatchObject({ used: 0, nextSlotAt: null });
      });

      it('carta usada pode sair (o álbum fica); carta não usada não', async () => {
        const h = await rules(lvl5);
        const c = await h.grantCard('card_gold_epic');
        await expectCode(
          h.api.extractionRequest({ itemId: 'card_gold_epic', qty: 1, requestId: h.rid() }),
          'INSUFFICIENT_ITEMS',
        );
        await h.api.cardActivate({ instanceId: c.id, requestId: h.rid() });
        await h.api.extractionRequest({ itemId: 'card_gold_epic', qty: 1, requestId: h.rid() });
        const album = await h.api.albumGet();
        // álbum permanente (ECONOMIA.md): retirar a cópia não esvazia o espaço. A mock ainda esvazia.
        expect(album.slots.find((s) => s.cardId === 'card_gold_epic')?.copies).toBe(
          h.kind === 'mock' ? 0 : 1,
        );
      });

      it('volta da Steam: consome o item Steam e devolve ao jogo (idempotente)', async () => {
        const h = await rules(lvl5);
        const bought = await h.mockSteamGrant('crop_pumpkin', 1);
        const id = h.rid();
        const r = await h.api.steamReturnSync({ steamItemIds: [bought], requestId: id });
        expect(r.returned).toEqual([
          expect.objectContaining({ itemId: 'crop_pumpkin', qty: 1, status: 'returned' }),
        ]);
        expect(r.inventoryChanges).toEqual([{ itemId: 'crop_pumpkin', qty: 1 }]);
        await expectCode(
          h.api.steamReturnSync({ steamItemIds: [bought], requestId: id }),
          'DUPLICATE_REQUEST',
        );
        await expectCode(
          h.api.steamReturnSync({ steamItemIds: [bought], requestId: h.rid() }),
          'NOT_FOUND',
        );
        await expectCode(
          h.api.steamReturnSync({ steamItemIds: ['x', 'x'], requestId: h.rid() }),
          'INVALID_INPUT',
        );
        expect((await h.inspect()).inventory.crop_pumpkin).toBe(1);
        expect((await h.api.extractionList())[0]).toMatchObject({ status: 'returned' });
      });
    },
  );
}
