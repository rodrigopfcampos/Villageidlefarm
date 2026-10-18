import { describe, expect, it } from 'vitest';
import {
  darkness,
  hourOfDay,
  lerpColor,
  lightColor,
  nightEventAt,
  phaseAt,
} from '../../src/time/dayCycle';

describe('ciclo do dia (visual)', () => {
  it('hora local pelo serverNow e fuso', () => {
    // 2026-10-18 23:30 UTC = 20:30 em São Paulo (UTC-3)
    const t = Date.UTC(2026, 9, 18, 23, 30, 0);
    expect(hourOfDay(t, 'America/Sao_Paulo')).toBeCloseTo(20.5, 5);
    expect(hourOfDay(t, 'UTC')).toBeCloseTo(23.5, 5);
  });

  it('fases e evento noturno', () => {
    expect(phaseAt(12)).toBe('day');
    expect(phaseAt(18.2)).toBe('dusk');
    expect(phaseAt(23)).toBe('night');
    expect(nightEventAt(19)).toBe(true);
    expect(nightEventAt(20.99)).toBe(true);
    expect(nightEventAt(21)).toBe(false);
  });

  it('dia sem tinta, noite escura, chuva escurece', () => {
    expect(lightColor(12)).toBe(0xffffff);
    expect(darkness(12)).toBe(0);
    expect(darkness(23)).toBeGreaterThan(0.5);
    expect(lightColor(12, 'rain')).not.toBe(0xffffff);
  });

  it('transição suave', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    const a = darkness(17);
    const b = darkness(18.5);
    const c = darkness(20);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});
