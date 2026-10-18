// Regras das decisões do dono (DECISOES.md / BALANCEAMENTO.md): cartas, álbum, evento noturno e
// retirada para a Steam. Esta suíte deve passar também contra a API real (A2).

import { describe, expect, it } from 'vitest';
import { ApiError, CARDS, RARITIES, type ErrorCode, type InventoryEntry } from '@vif/shared';
import { FakeClock, MockApi, type MockApiOptions } from '../src/net/mockApi';

let n = 0;
const rid = () => `rule-${++n}`;

function setup(opts: MockApiOptions = {}, start = Date.UTC(2026, 0, 10, 12, 0, 0)) {
  const clock = new FakeClock(start);
  const api = new MockApi({ clock, timezone: 'UTC', ...opts });
  return { clock, api };
}

async function expectCode(p: Promise<unknown>, code: ErrorCode) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ code });
}

const rich = (items: InventoryEntry[] = []) => ({ coins: 1_000_000, items });

describe('cartas: drop', () => {
  it('chance proporcional ao tempo de cultivo (melancia 8 h ≈ 10%, cenoura 2 min ≈ 0,04%)', async () => {
    const { api, clock } = setup({ starter: rich(), xp: 500 });
    const harvestMany = async (seed: string, secs: number, times: number) => {
      let drops = 0;
      for (let i = 0; i < times; i++) {
        await api.shopBuy({ itemId: seed, qty: 1, requestId: rid() });
        await api.plant({ slotId: 'plot_01', seedItemId: seed, requestId: rid() });
        clock.advanceSeconds(secs);
        const r = await api.harvest({ slotId: 'plot_01', requestId: rid() });
        drops += r.cards?.length ?? 0;
        for (const c of r.cards ?? [])
          expect(c).toMatchObject({ source: 'drop', status: 'unused' });
      }
      return drops;
    };
    const melon = await harvestMany('seed_watermelon', 28_800, 300);
    expect(melon).toBeGreaterThan(15);
    expect(melon).toBeLessThan(50);
    const carrot = await harvestMany('seed_carrot', 120, 300);
    expect(carrot).toBeLessThanOrEqual(3);
  });
});

describe('cartas: ativação', () => {
  it('1 ativa (2 com VIP), mesma carta não reutiliza, mesmo buff não acumula', async () => {
    const { api, clock } = setup();
    const gold = api.grantCard('card_gold_common');
    const luck = api.grantCard('card_luck_common');
    const xp = api.grantCard('card_farm_xp_common');
    const gold2 = api.grantCard('card_gold_rare');

    const r = await api.cardActivate({ instanceId: gold.id, requestId: rid() });
    expect(r.activeBuffs).toHaveLength(1);
    expect(r.activeBuffs![0]).toMatchObject({ buff: 'gold', magnitude: 0.5, endsFc: 3600 });
    expect(r.cards![0]).toMatchObject({ id: gold.id, status: 'used' });
    expect(r.inventoryChanges).toEqual([{ itemId: 'card_gold_common', qty: 1 }]); // cópia no álbum

    await expectCode(
      api.cardActivate({ instanceId: gold.id, requestId: rid() }),
      'CARD_ALREADY_USED',
    );
    await expectCode(api.cardActivate({ instanceId: luck.id, requestId: rid() }), 'CARD_SLOT_FULL');
    await expectCode(api.cardActivate({ instanceId: 'nada', requestId: rid() }), 'NOT_FOUND');

    api.setVip(true);
    await expectCode(
      api.cardActivate({ instanceId: gold2.id, requestId: rid() }),
      'BUFF_ALREADY_ACTIVE',
    );
    await api.cardActivate({ instanceId: luck.id, requestId: rid() });
    await expectCode(api.cardActivate({ instanceId: xp.id, requestId: rid() }), 'CARD_SLOT_FULL');

    clock.advanceSeconds(3600); // as duas comuns (1 h) expiram
    const r2 = await api.cardActivate({ instanceId: xp.id, requestId: rid() });
    expect(r2.activeBuffs!.map((b) => b.buff)).toEqual(['farm_xp']);
  });

  it('durações: 1 h comum … 3 h lendária', async () => {
    const { api } = setup({ vip: true });
    const a = api.grantCard('card_gold_legendary');
    const r = await api.cardActivate({ instanceId: a.id, requestId: rid() });
    expect(r.activeBuffs![0]!.endsFc - r.activeBuffs![0]!.startedFc).toBe(10_800);
  });

  it('Ouro ativado no momento da colheita de uma melancia de 8 h não dá bônus', async () => {
    const { api, clock } = setup({
      starter: rich([{ itemId: 'seed_watermelon', qty: 1 }]),
      xp: 500,
    });
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_watermelon', requestId: rid() });
    clock.advanceSeconds(28_800);
    const card = api.grantCard('card_gold_legendary');
    await api.cardActivate({ instanceId: card.id, requestId: rid() });
    const h = await api.harvest({ slotId: 'plot_01', requestId: rid() });
    expect(h.bonusCoins).toBeUndefined();
  });

  it('Ouro ativo só na última 1 h da melancia de 8 h dá bônus proporcional (1/8 de +50%)', async () => {
    // começa à meia-noite para a última hora não cair no evento noturno (que encurtaria o cultivo)
    const { api, clock } = setup(
      { starter: rich([{ itemId: 'seed_watermelon', qty: 1 }]), xp: 500 },
      Date.UTC(2026, 0, 10, 0, 0, 0),
    );
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_watermelon', requestId: rid() });
    clock.advanceSeconds(25_200);
    const card = api.grantCard('card_gold_common');
    await api.cardActivate({ instanceId: card.id, requestId: rid() });
    clock.advanceSeconds(3600);
    const before = api.inspect().coins;
    const h = await api.harvest({ slotId: 'plot_01', requestId: rid() });
    expect(h.bonusCoins).toBe(30); // 480 × 0,5 × 3600/28800
    expect(h.wallet!.coins).toBe(before + 30);
  });

  it('buff expirado ainda vale para a parte do cultivo que ocorreu na janela', async () => {
    const { api, clock } = setup({
      starter: rich([{ itemId: 'seed_watermelon', qty: 1 }]),
      xp: 500,
    });
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_watermelon', requestId: rid() });
    const card = api.grantCard('card_gold_common');
    await api.cardActivate({ instanceId: card.id, requestId: rid() }); // fc 0–3600
    clock.advanceSeconds(28_800);
    const h = await api.harvest({ slotId: 'plot_01', requestId: rid() });
    expect(h.bonusCoins).toBe(30);
  });

  it('Adubo avança na hora os canteiros e não ocupa vaga', async () => {
    const { api } = setup({ starter: rich([{ itemId: 'seed_strawberry', qty: 2 }]) });
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    await api.plant({ slotId: 'plot_02', seedItemId: 'seed_strawberry', requestId: rid() });
    const fert = api.grantCard('card_fertilizer_common');
    const r = await api.cardActivate({ instanceId: fert.id, requestId: rid() });
    expect(r.plots!.map((p) => p.readyFc)).toEqual([1800, 1800]);
    expect(r.activeBuffs).toBeUndefined();
    const gold = api.grantCard('card_gold_common');
    await expect(api.cardActivate({ instanceId: gold.id, requestId: rid() })).resolves.toBeTruthy();
    const leg = api.grantCard('card_fertilizer_legendary');
    const r2 = await api.cardActivate({ instanceId: leg.id, requestId: rid() });
    expect(r2.plots!.every((p) => p.readyFc === p.plantedFc)).toBe(true); // nunca antes do plantio
  });

  it('Mercador: −25% nas sementes enquanto ativo (arredonda para cima)', async () => {
    const { api, clock } = setup();
    const m = api.grantCard('card_merchant_common');
    await api.cardActivate({ instanceId: m.id, requestId: rid() });
    const r = await api.shopBuy({ itemId: 'seed_carrot', qty: 5, requestId: rid() });
    expect(r.wallet!.coins).toBe(100 - 15); // ceil(20 × 0,75)
    clock.advanceSeconds(3600);
    const r2 = await api.shopBuy({ itemId: 'seed_carrot', qty: 5, requestId: rid() });
    expect(r2.wallet!.coins).toBe(85 - 20);
  });

  it('Colheita farta (+1) e XP de fazenda (+50%) com a janela cobrindo todo o cultivo', async () => {
    const { api, clock } = setup({
      vip: true,
      starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]),
    });
    for (const id of ['card_bountiful_harvest_rare', 'card_farm_xp_rare']) {
      await api.cardActivate({ instanceId: api.grantCard(id).id, requestId: rid() });
    }
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    clock.advanceSeconds(3600);
    const h = await api.harvest({ slotId: 'plot_01', requestId: rid() });
    expect(h.gained).toEqual([{ itemId: 'crop_strawberry', qty: 2 }]);
    expect(h.xp).toMatchObject({ xp: 32, accountXp: 21 }); // 21 × 1,5 → 31,5 (arred. estocástico)
  });
});

describe('álbum', () => {
  it('40 espaços; linha completa dá +2% permanente do buff da linha', async () => {
    const goldCards = CARDS.filter((c) => c.buff === 'gold').map((c) => ({ itemId: c.id, qty: 1 }));
    const { api } = setup({ starter: { coins: 0, items: goldCards } });
    const album = await api.albumGet();
    expect(album.slots).toHaveLength(40);
    expect(album.completedLines).toEqual(['gold']);
    expect(album.bonusPercent).toEqual({ gold: 2 });
  });

  it('carta usada entra no álbum como cópia', async () => {
    const { api } = setup();
    const c = api.grantCard('card_luck_epic');
    await api.cardActivate({ instanceId: c.id, requestId: rid() });
    const album = await api.albumGet();
    expect(album.slots.find((s) => s.cardId === 'card_luck_epic')?.copies).toBe(1);
    expect(album.slots.filter((s) => s.copies > 0)).toHaveLength(1);
  });

  it('bônus de Ouro do álbum (+2%) aparece em média nas colheitas', async () => {
    const goldCards = RARITIES.map((r) => ({ itemId: `card_gold_${r}`, qty: 1 }));
    const { api, clock } = setup({ starter: rich([...goldCards]) });
    let bonus = 0;
    for (let i = 0; i < 200; i++) {
      await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: rid() });
      await api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: rid() });
      clock.advanceSeconds(120);
      bonus += (await api.harvest({ slotId: 'plot_01', requestId: rid() })).bonusCoins ?? 0;
    }
    expect(bonus).toBeGreaterThan(12); // esperado 200 × 6 × 0,02 = 24
    expect(bonus).toBeLessThan(40);
  });
});

describe('evento noturno', () => {
  const t = (h: number, m = 0) => Date.UTC(2026, 0, 10, h, m, 0); // fuso UTC

  it('quem está ativo (heartbeat + interação) cresce ×1.5 e ganha a carta após 30 min', async () => {
    const { api, clock } = setup(
      { starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]) },
      t(18, 59),
    );
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    for (let min = 1; min <= 40; min++) {
      clock.advanceSeconds(60);
      if (min % 4 === 0) await api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: rid() });
      else await api.heartbeat();
    }
    const w = await api.getWorldState();
    expect(w.nightEvent.attendanceSeconds).toBe(39 * 60);
    const plot = api.inspect().plots.find((p) => p.slotId === 'plot_01')!;
    expect(plot.readyFc).toBe(3600 - Math.floor((39 * 60) / 2));

    const r = await api.claimNightEvent({ requestId: rid() });
    expect(r.card).toMatchObject({ source: 'night_event', status: 'unused' });
    expect(r.cards).toHaveLength(1);
    await expectCode(api.claimNightEvent({ requestId: rid() }), 'ALREADY_CLAIMED');
    expect((await api.getWorldState()).nightEvent.cardClaimed).toBe(true);
  });

  it('não acelera quem está offline e não dá carta', async () => {
    const { api, clock } = setup(
      { starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]) },
      t(18, 50),
    );
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    clock.set(t(21, 30)); // ficou fora durante todo o evento
    const b = await api.bootstrap();
    expect(b.farm.plots.find((p) => p.slotId === 'plot_01')!.readyFc).toBe(3600);
    expect((await api.getWorldState()).nightEvent.attendanceSeconds).toBe(0);
    await expectCode(api.claimNightEvent({ requestId: rid() }), 'NOT_ACTIVE');
  });

  it('só heartbeat sem interação: presença vale no máximo 5 min após a última ação', async () => {
    const { api, clock } = setup(
      { starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]) },
      t(19, 0),
    );
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    for (let min = 1; min <= 30; min++) {
      clock.advanceSeconds(60);
      await api.heartbeat();
    }
    expect((await api.getWorldState()).nightEvent.attendanceSeconds).toBe(300);
    expect(api.inspect().plots[0]!.readyFc).toBe(3600 - 150);
  });

  it('heartbeat devolve os canteiros acelerados', async () => {
    const { api, clock } = setup(
      { starter: rich([{ itemId: 'seed_strawberry', qty: 1 }]) },
      t(19, 0),
    );
    await api.plant({ slotId: 'plot_01', seedItemId: 'seed_strawberry', requestId: rid() });
    clock.advanceSeconds(60);
    const hb = await api.heartbeat();
    expect(hb.plots).toEqual([expect.objectContaining({ slotId: 'plot_01', readyFc: 3570 })]);
  });

  it('fuso: troca a cada 30 dias e bloqueia o resgate por 24 h', async () => {
    const { api, clock } = setup({}, t(12));
    await expectCode(api.setTimezone({ tz: 'Lua/Base', requestId: rid() }), 'INVALID_TZ');
    const p = await api.setTimezone({ tz: 'Asia/Tokyo', requestId: rid() });
    expect(p.timezone).toBe('Asia/Tokyo');
    await expectCode(api.claimNightEvent({ requestId: rid() }), 'TZ_CHANGE_TOO_SOON');
    clock.advanceSeconds(29 * 86_400);
    await expectCode(
      api.setTimezone({ tz: 'America/Sao_Paulo', requestId: rid() }),
      'TZ_CHANGE_TOO_SOON',
    );
  });
});

describe('retirada para a Steam', () => {
  const lvl5 = { xp: 500 };

  it('2ª retirada antes de 7 h falha com EXTRACTION_QUOTA; depois de 7 h volta a poder', async () => {
    const { api, clock } = setup({
      ...lvl5,
      starter: { coins: 0, items: [{ itemId: 'crop_carrot', qty: 3 }] },
    });
    const r = await api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() });
    expect(r.extraction).toMatchObject({ itemId: 'crop_carrot', qty: 1, status: 'granted' });
    expect(r.extraction.steamItemId).toBeTruthy();
    expect(r.inventoryChanges).toEqual([{ itemId: 'crop_carrot', qty: 2 }]);
    expect(r.quota).toMatchObject({ used: 1, limit: 1, windowHours: 7 });
    expect(r.quota.nextSlotAt).toBe(r.extraction.createdAt + 7 * 3_600_000);

    clock.advanceSeconds(7 * 3600 - 1);
    await expectCode(
      api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
      'EXTRACTION_QUOTA',
    );
    expect(api.inspect().inventory.crop_carrot).toBe(2); // nada saiu
    clock.advanceSeconds(1);
    await expect(
      api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
    ).resolves.toBeTruthy();
    expect(await api.extractionList()).toHaveLength(2);
  });

  it('VIP: 4 por janela', async () => {
    const { api } = setup({
      ...lvl5,
      vip: true,
      starter: { coins: 0, items: [{ itemId: 'crop_potato', qty: 10 }] },
    });
    for (let i = 0; i < 4; i++) {
      await api.extractionRequest({ itemId: 'crop_potato', qty: 1, requestId: rid() });
    }
    await expectCode(
      api.extractionRequest({ itemId: 'crop_potato', qty: 1, requestId: rid() }),
      'EXTRACTION_QUOTA',
    );
    expect(await api.extractionQuota()).toMatchObject({ used: 4, limit: 4 });
  });

  it('regras: semente não sai, nível mínimo 5, 1 unidade por retirada, Steam fora do ar', async () => {
    const items = [
      { itemId: 'seed_carrot', qty: 5 },
      { itemId: 'crop_carrot', qty: 5 },
    ];
    const low = setup({ starter: { coins: 0, items } }).api;
    await expectCode(
      low.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
      'LEVEL_TOO_LOW',
    );
    const { api } = setup({ ...lvl5, starter: { coins: 0, items } });
    await expectCode(
      api.extractionRequest({ itemId: 'seed_carrot', qty: 1, requestId: rid() }),
      'NOT_EXTRACTABLE',
    );
    await expectCode(
      api.extractionRequest({ itemId: 'crop_carrot', qty: 2, requestId: rid() }),
      'INVALID_INPUT',
    );
    await expectCode(
      api.extractionRequest({ itemId: 'prod_milk', qty: 1, requestId: rid() }),
      'INSUFFICIENT_ITEMS',
    );
    api.setSteamAvailable(false);
    await expectCode(
      api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: rid() }),
      'STEAM_UNAVAILABLE',
    );
  });

  it('carta usada pode sair (e some do álbum); carta não usada não', async () => {
    const { api } = setup(lvl5);
    const c = api.grantCard('card_gold_epic');
    await expectCode(
      api.extractionRequest({ itemId: 'card_gold_epic', qty: 1, requestId: rid() }),
      'INSUFFICIENT_ITEMS',
    );
    await api.cardActivate({ instanceId: c.id, requestId: rid() });
    await api.extractionRequest({ itemId: 'card_gold_epic', qty: 1, requestId: rid() });
    const album = await api.albumGet();
    expect(album.slots.find((s) => s.cardId === 'card_gold_epic')?.copies).toBe(0);
  });

  it('volta da Steam: consome o item Steam e devolve ao jogo (idempotente)', async () => {
    const { api } = setup(lvl5);
    const bought = api.mockSteamGrant('crop_pumpkin', 1); // comprado no mercado da Steam
    const id = rid();
    const r = await api.steamReturnSync({ steamItemIds: [bought], requestId: id });
    expect(r.returned).toEqual([
      expect.objectContaining({ itemId: 'crop_pumpkin', qty: 1, status: 'returned' }),
    ]);
    expect(r.inventoryChanges).toEqual([{ itemId: 'crop_pumpkin', qty: 1 }]);
    await expectCode(
      api.steamReturnSync({ steamItemIds: [bought], requestId: id }),
      'DUPLICATE_REQUEST',
    );
    await expectCode(
      api.steamReturnSync({ steamItemIds: [bought], requestId: rid() }),
      'NOT_FOUND',
    );
    expect(api.inspect().inventory.crop_pumpkin).toBe(1);
  });
});
