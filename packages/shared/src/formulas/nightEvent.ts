// Regras puras do horário local e do evento noturno (19h–21h no fuso do perfil).
// Só o servidor decide; o cliente usa para desenhar (céu, aviso de início/fim).

import { NIGHT_EVENT } from '../types/api';
import type { DayPhase, EpochMs } from '../types/models';

export interface LocalTime {
  /** "2026-01-31" no fuso informado. */
  date: string;
  h: number;
  m: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function localTime(epochMs: EpochMs, tz: string): LocalTime {
  const parts = formatter(tz).formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    h: Number(get('hour')) % 24,
    m: Number(get('minute')),
    s: Number(get('second')),
  };
}

/** Fase do dia pela hora local (o agente Tempo pode refinar os horários). */
export function phaseForHour(h: number): DayPhase {
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}

export function isNightEventHour(h: number): boolean {
  return h >= NIGHT_EVENT.startHour && h < NIGHT_EVENT.endHour;
}

/** ms até a próxima virada de hora local (funciona com fusos de meia hora). */
function msToNextLocalHour(epochMs: EpochMs, tz: string): number {
  const { m, s } = localTime(epochMs, tz);
  return (3600 - m * 60 - s) * 1000 - (((epochMs % 1000) + 1000) % 1000);
}

/** Fim do evento de hoje (ms Unix) se ele está ativo agora, senão null. */
export function nightEventEndsAt(epochMs: EpochMs, tz: string): EpochMs | null {
  const { h } = localTime(epochMs, tz);
  if (!isNightEventHour(h)) return null;
  return epochMs + msToNextLocalHour(epochMs, tz) + (NIGHT_EVENT.endHour - h - 1) * 3_600_000;
}

/**
 * Segundos de [t0, t1] (ms Unix) que caem dentro do evento, agrupados por data local.
 * Percorre o intervalo hora a hora (o servidor só chama com intervalos curtos de presença).
 */
export function nightEventSecondsByDate(t0: EpochMs, t1: EpochMs, tz: string): Map<string, number> {
  const out = new Map<string, number>();
  let t = t0;
  while (t < t1) {
    const next = Math.min(t1, t + Math.max(1000, msToNextLocalHour(t, tz)));
    const lt = localTime(t, tz);
    if (isNightEventHour(lt.h)) out.set(lt.date, (out.get(lt.date) ?? 0) + (next - t) / 1000);
    t = next;
  }
  return out;
}
