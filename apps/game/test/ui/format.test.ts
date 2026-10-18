import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCompact,
  formatCountdown,
  formatDurationShort,
  formatInt,
  formatMinutesFloor,
} from '../../src/ui/format';

describe('ui/format', () => {
  it('formatDurationShort: tempos das culturas e contagens', () => {
    expect(formatDurationShort(0)).toBe('0s');
    expect(formatDurationShort(45)).toBe('45s');
    expect(formatDurationShort(44.2)).toBe('45s'); // arredonda para cima
    expect(formatDurationShort(120)).toBe('2 min');
    expect(formatDurationShort(90)).toBe('1 min 30s');
    expect(formatDurationShort(600)).toBe('10 min');
    expect(formatDurationShort(3600)).toBe('1h');
    expect(formatDurationShort(5400)).toBe('1h 30min');
    expect(formatDurationShort(28_800)).toBe('8h');
    expect(formatDurationShort(36_000)).toBe('10h');
    expect(formatDurationShort(2 * 86_400 + 4 * 3600)).toBe('2d 4h');
    expect(formatDurationShort(-5)).toBe('0s');
  });

  it('formatCountdown: relógio regressivo', () => {
    expect(formatCountdown(7)).toBe('0:07');
    expect(formatCountdown(272)).toBe('4:32');
    expect(formatCountdown(3909)).toBe('1:05:09');
    expect(formatCountdown(0.2)).toBe('0:01');
    expect(formatCountdown(-1)).toBe('0:00');
  });

  it('números em pt-BR', () => {
    expect(formatInt(1234)).toBe('1.234');
    expect(formatInt(0)).toBe('0');
    expect(formatCompact(9999)).toBe('9.999');
    expect(formatCompact(12_345)).toBe('12,3 mil');
    expect(formatCompact(1_200_000)).toBe('1,2 mi');
  });

  it('relógio e minutos', () => {
    expect(formatClock(7, 5)).toBe('07:05');
    expect(formatClock(19, 0)).toBe('19:00');
    expect(formatMinutesFloor(1799)).toBe('29 min');
    expect(formatMinutesFloor(1800)).toBe('30 min');
  });
});
