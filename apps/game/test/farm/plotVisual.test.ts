import { describe, expect, it } from 'vitest';
import type { PlotState } from '@vif/shared';
import {
  cropSpriteFor,
  fallbackIconScale,
  plantsInPlot,
  plotVisual,
} from '../../src/farm/plotVisual';

const planted = (plantedFc: number, readyFc: number, cropId = 'crop_carrot'): PlotState => ({
  slotId: 'plot_01',
  unlocked: true,
  cropId,
  plantedFc,
  readyFc,
});

describe('plotVisual (estágio pelo relógio da fazenda)', () => {
  it('bloqueado e vazio', () => {
    expect(plotVisual(undefined, 0).kind).toBe('locked');
    expect(plotVisual({ ...planted(0, 10), unlocked: false }, 0).kind).toBe('locked');
    const empty: PlotState = {
      slotId: 'a',
      unlocked: true,
      cropId: null,
      plantedFc: null,
      readyFc: null,
    };
    expect(plotVisual(empty, 50)).toMatchObject({
      kind: 'empty',
      soil: 'tile/soil_tilled',
      stage: null,
    });
  });

  it('estágios 0..3 conforme o relógio avança', () => {
    const p = planted(1000, 1120); // cenoura: 120 s
    expect(plotVisual(p, 1000)).toMatchObject({
      kind: 'growing',
      stage: 0,
      soil: 'tile/soil_wet',
      remaining: 120,
    });
    expect(plotVisual(p, 1000 + 18).stage).toBe(1); // 15%
    expect(plotVisual(p, 1000 + 60).stage).toBe(2); // 50%
    expect(plotVisual(p, 1119).stage).toBe(2);
    expect(plotVisual(p, 1120)).toMatchObject({ kind: 'ready', stage: 3, remaining: 0 });
    expect(plotVisual(p, 99999).kind).toBe('ready');
  });

  it('readyFc encurtado (evento/Adubo) adianta o estágio', () => {
    const p = planted(0, 3600);
    expect(plotVisual(p, 1800).stage).toBe(2);
    expect(plotVisual({ ...p, readyFc: 1800 }, 1800).kind).toBe('ready');
  });
});

describe('cropSpriteFor', () => {
  const frames = new Set([
    'atlas_crops:crop/carrot_0',
    'atlas_crops:crop/carrot_3',
    'atlas_icons:icon/pumpkin',
  ]);
  const has = (a: string, f: string) => frames.has(`${a}:${f}`);

  it('usa a arte de estágio quando existe', () => {
    expect(cropSpriteFor('crop_carrot', 3, has)).toEqual({
      atlas: 'atlas_crops',
      frame: 'crop/carrot_3',
      fallback: false,
    });
  });

  it('cai para o ícone da colheita quando falta o estágio', () => {
    expect(cropSpriteFor('crop_pumpkin', 1, has)).toEqual({
      atlas: 'atlas_icons',
      frame: 'icon/pumpkin',
      fallback: true,
    });
    expect(cropSpriteFor('crop_watermelon', 1, has)).toBeNull();
    expect(fallbackIconScale(0)).toBeLessThan(fallbackIconScale(3));
  });

  it('canteiros largos ganham mais plantas', () => {
    expect(plantsInPlot(130)).toBe(1);
    expect(plantsInPlot(261)).toBe(2);
    expect(plantsInPlot(2000)).toBe(3);
  });
});
