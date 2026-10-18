// Constantes do cliente compartilhadas entre cenas.

import type { FarmLayout } from '@vif/shared';
import type { LoadedManifest } from './assets';

export const SCENE_KEYS = {
  boot: 'Boot',
  farm: 'Farm',
} as const;

/** Camadas de desenho (depth do Phaser). Entidades usam DEPTH.entities + y para ordenar. */
export const DEPTH = {
  map: 0,
  ground: 10,
  entities: 100,
  overhead: 5_000,
  debug: 10_000,
} as const;

/** Dados que o Boot passa para a FarmScene. */
export interface FarmSceneData {
  loaded: LoadedManifest | null;
  layout: FarmLayout | null;
}

/** URL do manifest. Em `pnpm dev`, `?dev-assets` usa a prévia em /__dev/ (ver vite.config.ts). */
export function manifestUrl(): string {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('dev-assets')) {
    return '/__dev/manifest.json';
  }
  return `${import.meta.env.BASE_URL}assets/manifest.json`;
}
