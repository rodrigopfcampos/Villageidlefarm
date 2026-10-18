// Estado VISUAL de um canteiro (puro). Quem decide se está pronto é o servidor; aqui só prevemos
// pelo relógio da fazenda estimado (store.estimatedFarmClock()) para desenhar.

import {
  CROPS_BY_ID,
  ITEMS_BY_ID,
  growthProgress,
  growthStage,
  secondsRemaining,
  type FarmClockSeconds,
  type GrowthStage,
  type PlotState,
} from '@vif/shared';

export type PlotKind = 'locked' | 'empty' | 'growing' | 'ready';
export type SoilFrame = 'tile/soil_raw' | 'tile/soil_tilled' | 'tile/soil_wet';

export interface PlotVisual {
  kind: PlotKind;
  soil: SoilFrame;
  /** 0..3 (null sem planta). */
  stage: GrowthStage | null;
  progress: number;
  /** Segundos de fazenda que faltam (0 se pronto/vazio). */
  remaining: number;
  cropId: string | null;
}

export function plotVisual(plot: PlotState | undefined, fc: FarmClockSeconds): PlotVisual {
  if (!plot || !plot.unlocked) {
    return { kind: 'locked', soil: 'tile/soil_raw', stage: null, progress: 0, remaining: 0, cropId: null };
  }
  if (plot.cropId === null || plot.readyFc === null) {
    return { kind: 'empty', soil: 'tile/soil_tilled', stage: null, progress: 0, remaining: 0, cropId: null };
  }
  const progress = growthProgress(plot, fc);
  const stage = growthStage(progress);
  const ready = stage === 3;
  return {
    kind: ready ? 'ready' : 'growing',
    soil: ready ? 'tile/soil_tilled' : 'tile/soil_wet',
    stage,
    progress,
    remaining: secondsRemaining(plot, fc),
    cropId: plot.cropId,
  };
}

/** "crop_carrot" -> "carrot" */
export function cropBaseName(cropId: string): string {
  return cropId.replace(/^crop_/, '');
}

export interface CropSprite {
  atlas: 'atlas_crops' | 'atlas_icons';
  frame: string;
  /** true = não há arte de estágio; usa o ícone da colheita pequeno. */
  fallback: boolean;
}

/**
 * Quadro da planta para o estágio. Sem `crop/<nome>_<estágio>` no atlas, cai para o ícone da colheita
 * (spriteKey do item colhido). `has(atlas, frame)` diz se o quadro existe.
 */
export function cropSpriteFor(
  cropId: string,
  stage: GrowthStage,
  has: (atlas: string, frame: string) => boolean,
): CropSprite | null {
  const frame = `crop/${cropBaseName(cropId)}_${stage}`;
  if (has('atlas_crops', frame)) return { atlas: 'atlas_crops', frame, fallback: false };
  const yieldId = CROPS_BY_ID.get(cropId)?.yieldItemId ?? cropId;
  const icon = ITEMS_BY_ID.get(yieldId)?.spriteKey ?? `icon/${cropBaseName(cropId)}`;
  if (has('atlas_icons', icon)) return { atlas: 'atlas_icons', frame: icon, fallback: true };
  return null;
}

/** Escala do ícone de reserva por estágio (pequeno no início, cresce até pronto). */
export function fallbackIconScale(stage: GrowthStage): number {
  return [0.5, 0.75, 1, 1.25][stage]!;
}

/** Quantas plantas desenhar num canteiro (canteiros largos ganham mais de uma). */
export function plantsInPlot(width: number): number {
  return Math.max(1, Math.min(3, Math.round(width / 130)));
}
