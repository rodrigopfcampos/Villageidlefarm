import { describe, expect, it } from 'vitest';
import {
  buildAlbum,
  cardDropChance,
  proratedBonus,
  rollRarity,
  stochasticRound,
  type BuffWindow,
} from '../src/formulas/buffs';
import { localTime, nightEventEndsAt, nightEventSecondsByDate } from '../src/formulas/nightEvent';
import { unitFromSeed } from '../src/formulas/random';
import { CARDS } from '../src/catalog/index';

describe('buffs', () => {
  const gold: BuffWindow = { buff: 'gold', magnitude: 0.5, startedFc: 25_200, endsFc: 28_800 };

  it('bônus é proporcional à parte da produção dentro da janela', () => {
    expect(proratedBonus([gold], 'gold', 0, 28_800)).toBeCloseTo(0.5 / 8);
    expect(proratedBonus([gold], 'gold', 25_200, 28_800)).toBeCloseTo(0.5);
    expect(proratedBonus([gold], 'gold', 0, 25_200)).toBe(0);
    expect(proratedBonus([gold], 'farm_xp', 0, 28_800)).toBe(0);
  });

  it('arredondamento estocástico mantém a média', () => {
    let sum = 0;
    for (let i = 0; i < 10_000; i++) sum += stochasticRound(0.3, unitFromSeed(`s${i}`));
    expect(sum / 10_000).toBeGreaterThan(0.27);
    expect(sum / 10_000).toBeLessThan(0.33);
    expect(stochasticRound(2, 0.99)).toBe(2);
  });

  it('chance de carta: 1,25% por hora-canteiro, Sorte dobra', () => {
    expect(cardDropChance(3600, 0)).toBeCloseTo(0.0125);
    expect(cardDropChance(28_800, 0)).toBeCloseTo(0.1);
    expect(cardDropChance(28_800, 1)).toBeCloseTo(0.2);
    expect(cardDropChance(120, 0)).toBeCloseTo(0.0125 / 30);
  });

  it('raridades seguem 55/27/12/5/1', () => {
    const count: Record<string, number> = {};
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const r = rollRarity(unitFromSeed(`r${i}`));
      count[r] = (count[r] ?? 0) + 1;
    }
    expect(count.common! / n).toBeCloseTo(0.55, 1);
    expect(count.legendary! / n).toBeCloseTo(0.01, 2);
  });

  it('álbum: linha completa dá +2% do buff da linha', () => {
    const goldIds = CARDS.filter((c) => c.buff === 'gold').map((c) => c.id);
    const album = buildAlbum((id) => (goldIds.includes(id) ? 1 : id === 'card_luck_rare' ? 3 : 0));
    expect(album.slots).toHaveLength(40);
    expect(album.completedLines).toEqual(['gold']);
    expect(album.bonusPercent).toEqual({ gold: 2 });
    expect(album.slots.find((s) => s.cardId === 'card_luck_rare')?.copies).toBe(3);
  });
});

describe('evento noturno (horário local)', () => {
  const tz = 'America/Sao_Paulo'; // UTC-3
  const at = (h: number, m = 0) => Date.UTC(2026, 0, 10, h + 3, m); // h = hora local

  it('localTime e fim do evento', () => {
    expect(localTime(at(19, 30), tz)).toMatchObject({ date: '2026-01-10', h: 19, m: 30 });
    expect(nightEventEndsAt(at(19, 30), tz)).toBe(at(21));
    expect(nightEventEndsAt(at(20, 59), tz)).toBe(at(21));
    expect(nightEventEndsAt(at(21), tz)).toBeNull();
    expect(nightEventEndsAt(at(18, 59), tz)).toBeNull();
  });

  it('conta só os segundos dentro de 19h–21h', () => {
    const m = nightEventSecondsByDate(at(18, 50), at(19, 5), tz);
    expect(m.get('2026-01-10')).toBe(300);
    expect(nightEventSecondsByDate(at(20, 58), at(21, 3), tz).get('2026-01-10')).toBe(120);
    expect(nightEventSecondsByDate(at(12), at(13), tz).size).toBe(0);
  });
});
