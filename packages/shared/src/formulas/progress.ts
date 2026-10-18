// Fórmulas de PREVISÃO VISUAL no cliente (barras de progresso, estágio da planta).
// Quem decide se está pronto é sempre o servidor (farm_clock_s >= ready_fc).
// O nível (levelForXp) é a mesma regra usada pelo servidor/mock; o cliente só exibe.

import type { FarmClockSeconds, PlotState } from '../types/models';
import { ECONOMY } from '../types/api';

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

/** XP total necessário para ATINGIR o nível `level` (nível 1 = 0 xp). 50, 150, 300, 500… */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return (25 * (l - 1) * l) | 0;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** Progresso 0..1 dentro do nível atual. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
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
