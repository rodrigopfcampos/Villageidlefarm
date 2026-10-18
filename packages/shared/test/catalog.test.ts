import { describe, expect, it } from 'vitest';
import {
  CARDS,
  CARDS_BY_ID,
  CARDS_CONFIG,
  CROPS_BY_ID,
  ITEMS,
  ITEMS_BY_ID,
  STARTER_KIT,
  validateCatalog,
} from '../src/catalog/index';
import { ERROR_CODES, ERROR_MESSAGES_PT, ApiError, toApiError } from '../src/types/errors';
import { RPC_NAMES } from '../src/types/api';
import { CLIENT_EVENT_NAMES } from '../src/types/events';
import { RT_CHANNELS } from '../src/types/realtime';
import { parseManifest, resolveAssetUrl } from '../src/types/manifest';
import {
  estimateFarmClock,
  formatDuration,
  growthProgress,
  growthStage,
  levelForXp,
  xpForLevel,
} from '../src/formulas/progress';

describe('catálogo', () => {
  it('é válido', () => {
    expect(validateCatalog()).toEqual([]);
  });

  it('culturas seguem a tabela do BALANCEAMENTO (tempo, semente, venda, margem)', () => {
    const table: [string, number, number, number][] = [
      ['carrot', 120, 4, 6],
      ['potato', 600, 10, 18],
      ['strawberry', 3600, 40, 82],
      ['pumpkin', 14400, 140, 280],
      ['watermelon', 28800, 240, 480],
    ];
    let lastProfitPerHour = Infinity;
    for (const [name, secs, seed, sell] of table) {
      const c = CROPS_BY_ID.get(`crop_${name}`)!;
      expect(c.growSeconds).toBe(secs);
      expect(ITEMS_BY_ID.get(c.seedItemId)).toMatchObject({ kind: 'seed', basePrice: seed });
      expect(ITEMS_BY_ID.get(c.yieldItemId)).toMatchObject({ kind: 'crop', sellPrice: sell });
      expect(sell).toBeGreaterThanOrEqual(seed * 1.5);
      const profitPerHour = ((sell - seed) * 3600) / secs;
      expect(profitPerHour).toBeLessThan(lastProfitPerHour); // cai com a duração
      lastProfitPerHour = profitPerHour;
    }
  });

  it('steamExtractable: colheitas, produtos e cartas sim; sementes não', () => {
    for (const i of ITEMS) {
      const expected = i.kind !== 'seed' && i.kind !== 'currency';
      expect(i.steamExtractable, i.id).toBe(expected);
    }
  });

  it('cartas: 8 buffs × 5 raridades, durações 1h..3h, Adubo instantâneo, arte provisória', () => {
    expect(CARDS).toHaveLength(40);
    expect(CARDS_CONFIG.dropChancePerPlotHour).toBe(0.0125);
    expect(CARDS_CONFIG.provisionalArtMapping).toBe(true);
    expect(CARDS_BY_ID.get('card_gold_common')).toMatchObject({
      durationSeconds: 3600,
      magnitude: 0.5,
      artKey: 'card/art_1',
      iconKey: 'buff/icon_1',
      frameKey: 'card/frame_common',
    });
    expect(CARDS_BY_ID.get('card_luck_legendary')?.durationSeconds).toBe(10800);
    expect(CARDS_BY_ID.get('card_fertilizer_legendary')).toMatchObject({
      durationSeconds: 0,
      magnitude: 5400,
    });
    expect(ITEMS_BY_ID.get('card_merchant_rare')?.kind).toBe('card');
  });

  it('kit inicial só usa itens existentes', () => {
    for (const i of STARTER_KIT.items) expect(ITEMS_BY_ID.has(i.itemId)).toBe(true);
  });

  it('acusa referências quebradas', () => {
    const errs = validateCatalog({
      items: [],
      crops: [
        {
          cropId: 'x',
          seedItemId: 'nada',
          yieldItemId: 'nada',
          growSeconds: 1.5,
          yieldMin: 1,
          yieldMax: 1,
          xp: 1,
          unlockLevel: 1,
        },
      ],
      animals: [],
      cards: { ...CARDS_CONFIG, cards: [] },
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(errs.some((e) => e.includes('falta card_gold_common'))).toBe(true);
  });
});

describe('contratos', () => {
  it('toda ErrorCode tem mensagem', () => {
    for (const c of ERROR_CODES) expect(ERROR_MESSAGES_PT[c]).toBeTruthy();
  });

  it('toApiError reconhece o código vindo do Postgres', () => {
    expect(toApiError(new Error('ERROR: NOT_READY')).code).toBe('NOT_READY');
    expect(toApiError('qualquer coisa').code).toBe('UNKNOWN');
    const e = new ApiError('SLOT_LOCKED');
    expect(toApiError(e)).toBe(e);
  });

  it('RPC_NAMES em snake_case e eventos únicos', () => {
    for (const n of Object.values(RPC_NAMES)) expect(n).toMatch(/^[a-z_]+$/);
    expect(new Set(CLIENT_EVENT_NAMES).size).toBe(CLIENT_EVENT_NAMES.length);
    expect(RT_CHANNELS.user('u1')).toBe('user:u1');
    expect(RT_CHANNELS.farm('f1')).toBe('farm:f1');
  });
});

describe('manifest', () => {
  it('aceita o formato do contrato', () => {
    const { manifest, warnings } = parseManifest({
      map: {
        image: 'map/farm.webp',
        overhead: 'map/overhead.png',
        layout: 'map/farm_layout.tmj',
        width: 2576,
        height: 1438,
      },
      atlases: [
        { key: 'atlas_icons', png: 'atlas/atlas_icons.png', json: 'atlas/atlas_icons.json' },
      ],
    });
    expect(warnings).toEqual([]);
    expect(manifest.map?.width).toBe(2576);
    expect(manifest.atlases).toHaveLength(1);
  });

  it('ignora entradas inválidas sem lançar', () => {
    const { manifest, warnings } = parseManifest({ map: { image: 'x' }, atlases: [{ key: 'a' }] });
    expect(manifest.map).toBeUndefined();
    expect(manifest.atlases).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(parseManifest('<html>').warnings).toHaveLength(1);
  });

  it('resolve caminhos relativos à pasta do manifest', () => {
    expect(resolveAssetUrl('/assets/', 'map/farm.webp')).toBe('/assets/map/farm.webp');
    expect(resolveAssetUrl('/assets', './a.png')).toBe('/assets/a.png');
    expect(resolveAssetUrl('/assets/', '/outro/a.png')).toBe('/outro/a.png');
  });
});

describe('fórmulas (previsão visual)', () => {
  const plot = { slotId: 'p', unlocked: true, cropId: 'crop_carrot', plantedFc: 100, readyFc: 220 };

  it('progresso e estágio', () => {
    expect(growthProgress(plot, 100)).toBe(0);
    expect(growthProgress(plot, 160)).toBe(0.5);
    expect(growthProgress(plot, 999)).toBe(1);
    expect(growthStage(0)).toBe(0);
    expect(growthStage(0.5)).toBe(2);
    expect(growthStage(1)).toBe(3);
  });

  it('estimativa do relógio respeita o teto de 8 h', () => {
    expect(estimateFarmClock(10, 5000)).toBe(15);
    expect(estimateFarmClock(0, 40 * 3600 * 1000)).toBe(28800);
    expect(estimateFarmClock(10, -100)).toBe(10);
  });

  it('níveis', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(150)).toBe(3);
  });

  it('formatDuration', () => {
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(3909)).toBe('1:05:09');
  });
});
