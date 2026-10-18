import { describe, expect, it } from 'vitest';
import {
  CARDS_BY_ID,
  CROPS,
  CROPS_BY_ID,
  ITEMS_BY_ID,
  type ActiveBuff,
  type CropDef,
  type ExtractionQuota,
  type PlotState,
} from '@vif/shared';
import {
  animalBuyCheck,
  buyCheck,
  cardActivateCheck,
  cardSlots,
  clampQty,
  cropEconomy,
  extractionCheck,
  nextSlotSeconds,
  nightEventView,
  plantOption,
  plantableCrops,
  plotAccepts,
  secondsUntilEvent,
  sellCheck,
  shouldShowOfflineReport,
  unlockCheck,
  xpView,
} from '../../src/ui/rules';

const carrot = CROPS_BY_ID.get('crop_carrot')!;
const watermelon = CROPS_BY_ID.get('crop_watermelon')!;

function buff(p: Partial<ActiveBuff>): ActiveBuff {
  return {
    instanceId: 'b1',
    cardId: 'card_gold_common',
    buff: 'gold',
    rarity: 'common',
    magnitude: 0.5,
    startedFc: 0,
    endsFc: 3600,
    startedAt: 0,
    endsAt: 3_600_000,
    ...p,
  };
}

describe('ui/rules — plantar', () => {
  it('economia da cultura vem do catálogo (cenoura: semente 4, venda 6, 60/h)', () => {
    expect(cropEconomy(carrot)).toEqual({
      seedPrice: 4,
      sellValue: 6,
      profit: 2,
      profitPerHour: 60,
    });
  });

  it('botão: bloqueado por nível, planta com semente, compra e planta, sem moedas', () => {
    expect(plantOption(watermelon, { level: 1, coins: 9999, seedQty: 0 })).toMatchObject({
      action: 'locked',
      ok: false,
      reason: 'LEVEL_TOO_LOW',
    });
    expect(plantOption(carrot, { level: 1, coins: 0, seedQty: 3 })).toMatchObject({
      action: 'plant',
      ok: true,
      cost: 0,
    });
    expect(plantOption(carrot, { level: 1, coins: 4, seedQty: 0 })).toMatchObject({
      action: 'buy-and-plant',
      ok: true,
      cost: 4,
    });
    expect(plantOption(carrot, { level: 1, coins: 3, seedQty: 0 })).toMatchObject({
      action: 'no-money',
      ok: false,
      reason: 'INSUFFICIENT_FUNDS',
    });
  });

  it('lista vem do catálogo: liberadas (mais novas primeiro) + só as 3 próximas bloqueadas', () => {
    const many: CropDef[] = Array.from({ length: 39 }, (_, i) => ({
      ...carrot,
      cropId: `crop_x${i}`,
      unlockLevel: i + 1,
    }));
    const { visible, hidden } = plantableCrops(many, 10);
    expect(visible.map((c) => c.unlockLevel)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 11, 12, 13]);
    expect(hidden).toHaveLength(26);
    expect(hidden[0]!.unlockLevel).toBe(14);
    // catálogo atual inteiro, nível 1
    const now = plantableCrops(CROPS, 1);
    expect(now.visible.length + now.hidden.length).toBe(CROPS.length);
  });

  it('canteiro: bloqueado → ocupado → livre', () => {
    const p: PlotState = {
      slotId: 'a',
      unlocked: true,
      cropId: null,
      plantedFc: null,
      readyFc: null,
    };
    expect(plotAccepts(undefined).reason).toBe('NOT_FOUND');
    expect(plotAccepts({ ...p, unlocked: false }).reason).toBe('SLOT_LOCKED');
    expect(plotAccepts({ ...p, cropId: 'crop_carrot', plantedFc: 0, readyFc: 120 }).reason).toBe(
      'SLOT_OCCUPIED',
    );
    expect(plotAccepts(p).ok).toBe(true);
  });

  it('desbloquear: mesma ordem do servidor', () => {
    const def = { slotId: 'a', unlockCost: 200, unlockLevel: 2, startsUnlocked: false };
    const plot: PlotState = {
      slotId: 'a',
      unlocked: false,
      cropId: null,
      plantedFc: null,
      readyFc: null,
    };
    expect(unlockCheck(def, { ...plot, unlocked: true }, 9, 9999).reason).toBe('ALREADY_UNLOCKED');
    expect(unlockCheck(def, plot, 1, 9999).reason).toBe('LEVEL_TOO_LOW');
    expect(unlockCheck(def, plot, 2, 199).reason).toBe('INSUFFICIENT_FUNDS');
    expect(unlockCheck(def, plot, 2, 200).ok).toBe(true);
  });
});

describe('ui/rules — loja e inventário', () => {
  it('comprar: total, nível e moedas', () => {
    const seed = ITEMS_BY_ID.get('seed_potato');
    expect(buyCheck(seed, 3, { coins: 30, level: 1 })).toMatchObject({ ok: true, total: 30 });
    expect(buyCheck(seed, 3, { coins: 29, level: 1 }).reason).toBe('INSUFFICIENT_FUNDS');
    expect(buyCheck(seed, 0, { coins: 99, level: 1 }).reason).toBe('INVALID_INPUT');
    expect(buyCheck(ITEMS_BY_ID.get('crop_carrot'), 1, { coins: 99, level: 1 }).reason).toBe(
      'NOT_FOR_SALE',
    );
    expect(
      buyCheck(ITEMS_BY_ID.get('seed_pumpkin'), 1, { coins: 999, level: 1, unlockLevel: 3 }).reason,
    ).toBe('LEVEL_TOO_LOW');
  });

  it('vender: só o que a loja compra e o que você tem', () => {
    const carrotItem = ITEMS_BY_ID.get('crop_carrot');
    expect(sellCheck(carrotItem, 5, 5)).toMatchObject({ ok: true, total: 30 });
    expect(sellCheck(carrotItem, 6, 5).reason).toBe('INSUFFICIENT_ITEMS');
    expect(sellCheck(ITEMS_BY_ID.get('seed_carrot'), 1, 5).reason).toBe('NOT_FOR_SALE');
    expect(sellCheck(ITEMS_BY_ID.get('card_gold_common'), 1, 1).reason).toBe('NOT_FOR_SALE');
  });

  it('animais por nível', () => {
    const cow = { animalType: 'animal_cow', buyPrice: 1200, unlockLevel: 5 } as Parameters<
      typeof animalBuyCheck
    >[0];
    expect(animalBuyCheck(cow, 5000, 4).reason).toBe('LEVEL_TOO_LOW');
    expect(animalBuyCheck(cow, 1199, 5).reason).toBe('INSUFFICIENT_FUNDS');
    expect(animalBuyCheck(cow, 1200, 5).ok).toBe(true);
  });

  it('clampQty', () => {
    expect(clampQty(5, 1, 3)).toBe(3);
    expect(clampQty(0, 1, 3)).toBe(1);
    expect(clampQty(Number.NaN, 1, 3)).toBe(1);
    expect(clampQty(2.7, 1, 9)).toBe(2);
    expect(clampQty(4, 1, 0)).toBe(1);
  });
});

describe('ui/rules — cartas', () => {
  const goldRare = CARDS_BY_ID.get('card_gold_rare')!;
  const luck = CARDS_BY_ID.get('card_luck_common')!;
  const fertilizer = CARDS_BY_ID.get('card_fertilizer_epic')!;

  it('1 vaga sem VIP, 2 com VIP', () => {
    expect(cardSlots(false)).toBe(1);
    expect(cardSlots(true)).toBe(2);
  });

  it('ordem: BUFF_ALREADY_ACTIVE → CARD_SLOT_FULL; instantânea não ocupa vaga', () => {
    expect(cardActivateCheck(goldRare, [], false).ok).toBe(true);
    expect(cardActivateCheck(goldRare, [buff({})], true).reason).toBe('BUFF_ALREADY_ACTIVE');
    expect(cardActivateCheck(luck, [buff({})], false).reason).toBe('CARD_SLOT_FULL');
    expect(cardActivateCheck(luck, [buff({})], true).ok).toBe(true);
    expect(
      cardActivateCheck(luck, [buff({}), buff({ instanceId: 'b2', buff: 'animals' })], true).reason,
    ).toBe('CARD_SLOT_FULL');
    expect(cardActivateCheck(fertilizer, [buff({}), buff({ buff: 'animals' })], false).ok).toBe(
      true,
    );
  });
});

describe('ui/rules — Steam', () => {
  const quota = (used: number, limit: number, nextSlotAt: number | null): ExtractionQuota => ({
    used,
    limit,
    windowHours: 7,
    nextSlotAt,
  });
  const carrotItem = ITEMS_BY_ID.get('crop_carrot');

  it('ordem: STEAM_UNAVAILABLE → NOT_EXTRACTABLE → LEVEL_TOO_LOW → EXTRACTION_QUOTA → itens', () => {
    const ok = { have: 1, level: 5, quota: quota(0, 1, null) };
    expect(extractionCheck(carrotItem, ok).ok).toBe(true);
    expect(extractionCheck(carrotItem, { ...ok, steamUnavailable: true }).reason).toBe(
      'STEAM_UNAVAILABLE',
    );
    expect(extractionCheck(ITEMS_BY_ID.get('seed_carrot'), ok).reason).toBe('NOT_EXTRACTABLE');
    expect(extractionCheck(carrotItem, { ...ok, level: 4 }).reason).toBe('LEVEL_TOO_LOW');
    expect(extractionCheck(carrotItem, { ...ok, quota: quota(1, 1, 5000) }).reason).toBe(
      'EXTRACTION_QUOTA',
    );
    expect(extractionCheck(carrotItem, { ...ok, have: 0 }).reason).toBe('INSUFFICIENT_ITEMS');
    expect(extractionCheck(ITEMS_BY_ID.get('card_gold_common'), ok).ok).toBe(true);
  });

  it('próxima vaga', () => {
    expect(nextSlotSeconds(quota(0, 1, null), 0)).toBe(0);
    expect(nextSlotSeconds(quota(1, 1, 10_000), 4_000)).toBe(6);
    expect(nextSlotSeconds(quota(1, 1, 10_000), 20_000)).toBe(0);
  });
});

describe('ui/rules — evento noturno, offline, XP', () => {
  // 2026-01-01 20:30 em São Paulo (UTC−3) = 23:30 UTC
  const at2030 = Date.UTC(2026, 0, 1, 23, 30, 0);
  const tz = 'America/Sao_Paulo';

  it('contagem até as 19h e dentro do evento', () => {
    expect(secondsUntilEvent(Date.UTC(2026, 0, 1, 21, 0, 0), tz)).toBe(3600); // 18:00 local
    expect(secondsUntilEvent(at2030, tz)).toBe(0);
    expect(secondsUntilEvent(Date.UTC(2026, 0, 2, 0, 0, 0), tz)).toBe(22 * 3600); // 21:00 local
  });

  it('presença, carta resgatável e já ganha', () => {
    const ev = {
      active: true,
      speedMult: 1.5,
      attendanceSeconds: 900,
      requiredSeconds: 1800,
      cardClaimed: false,
      endsAt: at2030 + 1800_000,
    };
    expect(nightEventView(ev, at2030, tz)).toMatchObject({
      active: true,
      seconds: 1800,
      progress: 0.5,
      claimable: false,
    });
    expect(nightEventView({ ...ev, attendanceSeconds: 1800 }, at2030, tz).claimable).toBe(true);
    expect(
      nightEventView({ ...ev, attendanceSeconds: 1800, cardClaimed: true }, at2030, tz),
    ).toMatchObject({
      claimable: false,
      claimed: true,
    });
    expect(nightEventView(null, Date.UTC(2026, 0, 1, 21, 0, 0), tz)).toMatchObject({
      active: false,
      seconds: 3600,
    });
  });

  it('tela offline só depois de 1 minuto fora', () => {
    expect(shouldShowOfflineReport(null)).toBe(false);
    expect(shouldShowOfflineReport({ realSeconds: 30, creditedSeconds: 30, capped: false })).toBe(
      false,
    );
    expect(
      shouldShowOfflineReport({ realSeconds: 36_000, creditedSeconds: 28_800, capped: true }),
    ).toBe(true);
  });

  it('barra de XP do nível atual', () => {
    expect(xpView(5, 700)).toEqual({ level: 5, into: 200, span: 250, progress: 0.8 });
    expect(xpView(1, 0).progress).toBe(0);
  });
});
