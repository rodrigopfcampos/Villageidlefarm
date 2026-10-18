// Quadros dos atlas (ui, icons, cards, animals) como imagens para o DOM.
// O CSS não sabe recortar um pedaço de atlas para border-image, então cada quadro pedido é
// desenhado uma vez num canvas e vira uma data URL (em cache). Nada aqui roda no import:
// os testes (node) podem importar este módulo sem DOM.

import { resolveAssetUrl } from '@vif/shared';
import { loadManifest } from '../core/assets';
import { manifestUrl } from '../core/constants';

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LoadedAtlas {
  img: HTMLImageElement;
  frames: Record<string, FrameRect>;
}

/** Atlas que a interface usa (os outros ficam só com o Phaser). */
export const UI_ATLASES = ['atlas_ui', 'atlas_icons', 'atlas_cards', 'atlas_animals'] as const;

const atlases = new Map<string, LoadedAtlas>();
const frameAtlas = new Map<string, string>();
const urlCache = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let loading: Promise<void> | null = null;

export function atlasVersion(): number {
  return version;
}

export function onAtlasChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  version++;
  for (const fn of [...listeners]) fn();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadOne(key: string, pngUrl: string, jsonUrl: string): Promise<void> {
  try {
    const res = await fetch(jsonUrl, { cache: 'no-cache' });
    if (!res.ok) return;
    const json = (await res.json()) as { frames?: Record<string, { frame?: FrameRect }> };
    if (!json.frames || typeof json.frames !== 'object') return;
    const img = await loadImage(pngUrl);
    if (!img) return;
    const frames: Record<string, FrameRect> = {};
    for (const [name, f] of Object.entries(json.frames)) {
      if (f.frame) frames[name] = f.frame;
      frameAtlas.set(name, key);
    }
    atlases.set(key, { img, frames });
    notify();
  } catch (err) {
    console.warn(`[ui] atlas ${key} não carregou`, err);
  }
}

/** Carrega os atlas da interface (uma vez). Nunca lança: sem atlas, a interface usa cores lisas. */
export function loadUiAtlases(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const loaded = await loadManifest(manifestUrl());
    if (!loaded) return;
    const wanted = new Set<string>(UI_ATLASES);
    await Promise.all(
      loaded.manifest.atlases
        .filter((a) => wanted.has(a.key))
        .map((a) =>
          loadOne(
            a.key,
            resolveAssetUrl(loaded.baseDir, a.png),
            resolveAssetUrl(loaded.baseDir, a.json),
          ),
        ),
    );
  })();
  return loading;
}

export function hasFrame(frame: string): boolean {
  const key = frameAtlas.get(frame);
  return !!key && !!atlases.get(key)?.frames[frame];
}

export function frameSize(frame: string): { w: number; h: number } | null {
  const key = frameAtlas.get(frame);
  const f = key ? atlases.get(key)?.frames[frame] : undefined;
  return f ? { w: f.w, h: f.h } : null;
}

/** Data URL do quadro, ou null se o atlas ainda não carregou / o quadro não existe. */
export function frameUrl(frame: string): string | null {
  const cached = urlCache.get(frame);
  if (cached) return cached;
  const key = frameAtlas.get(frame);
  const atlas = key ? atlases.get(key) : undefined;
  const f = atlas?.frames[frame];
  if (!atlas || !f) return null;
  const canvas = document.createElement('canvas');
  canvas.width = f.w;
  canvas.height = f.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  const url = canvas.toDataURL('image/png');
  urlCache.set(frame, url);
  return url;
}

/** Primeiro quadro existente da lista (substitutos para artes que faltam). */
export function firstFrame(frames: readonly string[]): string | null {
  for (const f of frames) if (hasFrame(f)) return f;
  return null;
}

/** Variáveis CSS com as imagens nine-slice do atlas ui (painel, botões, barras). */
export function applyCssImages(root: HTMLElement): void {
  const vars: Record<string, string> = {
    '--img-panel': 'ui/panel',
    '--img-btn': 'ui/button_normal',
    '--img-btn-hover': 'ui/button_hover',
    '--img-btn-pressed': 'ui/button_pressed',
    '--img-bar-empty': 'ui/bar_empty',
    '--img-bar-green': 'ui/bar_green',
    '--img-bar-gold': 'ui/bar_gold',
  };
  let any = false;
  for (const [name, frame] of Object.entries(vars)) {
    const url = frameUrl(frame);
    if (url) {
      root.style.setProperty(name, `url("${url}")`);
      any = true;
    }
  }
  root.classList.toggle('vif-has-atlas', any);
}
