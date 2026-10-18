// Formatação de números e tempos para a interface (puro, testável).

import { LOCALE } from './strings';

const intFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** 1234 → "1.234" */
export function formatInt(n: number): string {
  return intFmt.format(Math.round(n));
}

/** 1234567 → "1,2 mi"; 12345 → "12,3 mil"; abaixo de 10 mil, número inteiro. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return formatInt(n);
  const f = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
  if (abs < 1_000_000) return `${f.format(n / 1000)} mil`;
  return `${f.format(n / 1_000_000)} mi`;
}

/**
 * Duração legível e curta: "45s", "2 min", "1h 30min", "3h", "2d 4h".
 * Arredonda para cima nos segundos (nunca mostra "0s" para algo que ainda falta).
 */
export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return sec > 0 && m < 10 ? `${m} min ${sec}s` : `${m} min`;
}

/** Contagem regressiva estilo relógio: "1:05:09", "4:32", "0:07". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "07:05" */
export function formatClock(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutos inteiros: 1799 s → "29 min" (arredonda para baixo: presença ainda não completa). */
export function formatMinutesFloor(seconds: number): string {
  return `${Math.floor(Math.max(0, seconds) / 60)} min`;
}

/** Data e hora curtas a partir de ms Unix no fuso do jogador: "18/10 14:32". */
export function formatDateTime(epochMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(epochMs))
      .replace(',', '');
  } catch {
    return new Date(epochMs).toISOString().slice(5, 16).replace('T', ' ');
  }
}
