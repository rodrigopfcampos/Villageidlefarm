// Fórmulas de PREVISÃO VISUAL no cliente (barras de progresso, estágio da planta).
// Quem decide se está pronto é sempre o servidor (farm_clock_s >= ready_fc).
// O nível (levelForXp) é a mesma regra usada pelo servidor/mock; o cliente só exibe.

import type { FarmClockSeconds, PlotState } from '../types/models';
import { ECONOMY } from '../types/api';
import { PROGRESSION } from '../catalog/index';

/**
 * Estima o relógio da fazenda agora, a partir do último valor recebido do servidor.
 * `elapsedLocalMs` = tempo monotônico local (performance.now) desde que o valor chegou.
 * Limitado ao teto offline para não prever além do que o servidor creditaria.
 */
export function estimateFarmClock(
  lastFarmClock: FarmClockSeconds,
  elapsedLocalMs: number,
): FarmClockSeconds {
  const extra = Math.min(Math.max(0, elapsedLocalMs) / 1000, ECONOMY.OFFLINE_CAP_SECONDS);
  return lastFarmClock + extra;
}

/** Progresso 0..1 de um canteiro (0 se vazio). */
export function growthProgress(plot: PlotState, farmClock: FarmClockSeconds): number {
  if (plot.cropId === null || plot.plantedFc === null || plot.readyFc === null) return 0;
  const total = plot.readyFc - plot.plantedFc;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (farmClock - plot.plantedFc) / total));
}

/** Segundos de fazenda que faltam (0 se pronto ou vazio). */
export function secondsRemaining(plot: PlotState, farmClock: FarmClockSeconds): number {
  if (plot.readyFc === null) return 0;
  return Math.max(0, Math.ceil(plot.readyFc - farmClock));
}

/** Estágio visual: 0 semente, 1 broto, 2 crescendo, 3 pronto. */
export type GrowthStage = 0 | 1 | 2 | 3;

export function growthStage(progress: number): GrowthStage {
  if (progress >= 1) return 3;
  if (progress >= 0.5) return 2;
  if (progress >= 0.15) return 1;
  return 0;
}

/** Previsão: pronto para colher? (o servidor confirma). */
export function looksReady(plot: PlotState, farmClock: FarmClockSeconds): boolean {
  return plot.readyFc !== null && farmClock >= plot.readyFc;
}

/** Nível máximo do lançamento (40). Os níveis 41–50 ficam reservados. */
export const MAX_LEVEL = PROGRESSION.maxLevel;

/**
 * XP para ir do nível L ao L+1: round(100 × 1,06^L × L^1,6) (ECONOMIA.md). Mesma fórmula de
 * tools/balance/economia.py; o teste confere contra catalog/progression.json.
 */
export function xpToNext(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.round(100 * 1.06 ** l * l ** 1.6);
}

const cumulative: number[] = [0, 0]; // cumulative[L] = XP total para atingir L

/** XP total necessário para ATINGIR o nível `level` (nível 1 = 0 xp; 2 = 106; 3 = 447…). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  while (cumulative.length <= l) {
    const prev = cumulative.length - 1;
    cumulative.push(cumulative[prev]! + xpToNext(prev));
  }
  return cumulative[l]!;
}

/** Nível pelo XP total, limitado a MAX_LEVEL. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** Progresso 0..1 dentro do nível atual (1 no nível máximo). */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const start = xpForLevel(level);
  const end = xpForLevel(level + 1);
  return (xp - start) / (end - start);
}

/** "1:05:09", "4:32", "0:07" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
