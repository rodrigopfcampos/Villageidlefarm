// Ciclo do dia (puro, só visual): hora local pelo serverNow + fuso, cor da iluminação por fase.
// Nunca use Date.now() aqui: a hora vem do relógio do servidor (store.estimatedServerNow()).

import {
  isNightEventHour,
  localTime,
  phaseForHour,
  type DayPhase,
  type EpochMs,
  type WeatherKind,
} from '@vif/shared';

/** Hora local fracionária (0..24) no fuso do perfil. */
export function hourOfDay(serverNow: EpochMs, tz: string): number {
  const t = localTime(serverNow, tz);
  return t.h + t.m / 60 + t.s / 3600;
}

export function phaseAt(hour: number): DayPhase {
  return phaseForHour(Math.floor(((hour % 24) + 24) % 24));
}

export function nightEventAt(hour: number): boolean {
  return isNightEventHour(Math.floor(((hour % 24) + 24) % 24));
}

/** Quadros-chave da cor multiplicada sobre o mundo (0xffffff = sem tinta). */
const KEYS: readonly [number, number][] = [
  [0, 0x4d5894],
  [4.5, 0x4d5894],
  [6, 0xd8a8a8], // amanhecer rosado
  [7.5, 0xffffff],
  [16.5, 0xffffff],
  [18, 0xffb47a], // fim de tarde alaranjado
  [19.25, 0x7a76b8], // anoitecer
  [21, 0x5562a0],
  [24, 0x4d5894],
];

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** Multiplica duas cores (como o modo MULTIPLY). */
export function multiplyColor(a: number, b: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round((ch(a, s) * ch(b, s)) / 255);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

const WEATHER_TINT: Record<WeatherKind, number> = {
  clear: 0xffffff,
  cloudy: 0xd8dce4,
  rain: 0xaab4c4,
  storm: 0x8890a4,
  snow: 0xe4ecf4,
};

/** Cor da iluminação (MULTIPLY) para a hora e o clima. Interpolação suave entre fases. */
export function lightColor(hour: number, weather: WeatherKind = 'clear'): number {
  const h = ((hour % 24) + 24) % 24;
  let color = KEYS[0]![1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [h0, c0] = KEYS[i]!;
    const [h1, c1] = KEYS[i + 1]!;
    if (h >= h0 && h <= h1) {
      color = lerpColor(c0, c1, (h - h0) / (h1 - h0));
      break;
    }
  }
  return multiplyColor(color, WEATHER_TINT[weather] ?? 0xffffff);
}

/** 0 de dia, 1 de noite (para lanterna/vagalumes). */
export function darkness(hour: number): number {
  const c = lightColor(hour);
  const lum = (((c >> 16) & 0xff) * 0.3 + ((c >> 8) & 0xff) * 0.59 + (c & 0xff) * 0.11) / 255;
  return Math.min(1, Math.max(0, (1 - lum) / 0.55));
}
