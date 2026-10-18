import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirOf, loadLayout, loadManifest, planLoads, type FetchLike } from '../src/core/assets';
import { clampZoom, minZoomToCover, scrollForZoomAt } from '../src/core/cameraMath';

const fixturePath = fileURLToPath(
  new URL('../../../packages/shared/test/fixtures/farm_layout.min.tmj', import.meta.url),
);

/** fetch falso: mapa url -> [status, content-type, corpo]. */
function fakeFetch(files: Record<string, [number, string, string]>): FetchLike {
  return async (url) => {
    const f = files[url];
    if (!f) throw new TypeError('network error');
    const [status, type, body] = f;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : null) },
      text: async () => body,
    };
  };
}

const MANIFEST = {
  map: {
    image: 'map/farm.webp',
    overhead: 'map/overhead.png',
    layout: 'map/farm_layout.tmj',
    width: 2576,
    height: 1438,
  },
  atlases: [{ key: 'atlas_icons', png: 'atlas/atlas_icons.png', json: 'atlas/atlas_icons.json' }],
};

describe('manifest (os dois casos da cena)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ausente (404, index.html de SPA, rede fora, JSON quebrado): null com aviso, sem lançar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeFetch({
      '/a/manifest.json': [404, 'text/plain', 'not found'],
      '/b/manifest.json': [200, 'text/html', '<!doctype html>'],
      '/c/manifest.json': [200, 'application/json', '{quebrado'],
    });
    for (const u of [
      '/a/manifest.json',
      '/b/manifest.json',
      '/c/manifest.json',
      '/d/manifest.json',
    ]) {
      await expect(loadManifest(u, f)).resolves.toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('presente: planeja imagem do mapa, overhead e atlas com caminhos resolvidos', async () => {
    const f = fakeFetch({
      './assets/manifest.json': [200, 'application/json', JSON.stringify(MANIFEST)],
    });
    const loaded = await loadManifest('./assets/manifest.json', f);
    expect(loaded?.baseDir).toBe('./assets/');
    expect(planLoads(loaded!)).toEqual([
      { type: 'image', key: 'map_ground', url: './assets/map/farm.webp' },
      { type: 'image', key: 'map_overhead', url: './assets/map/overhead.png' },
      {
        type: 'atlas',
        key: 'atlas_icons',
        png: './assets/atlas/atlas_icons.png',
        json: './assets/atlas/atlas_icons.json',
      },
    ]);
  });

  it('manifest só com atlas (sem mapa) também funciona', async () => {
    const f = fakeFetch({
      '/assets/manifest.json': [
        200,
        'application/json',
        JSON.stringify({ atlases: MANIFEST.atlases }),
      ],
    });
    const loaded = await loadManifest('/assets/manifest.json', f);
    expect(planLoads(loaded!).map((i) => i.key)).toEqual(['atlas_icons']);
  });

  it('layout: lê o .tmj; ausente ou inválido vira null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeFetch({
      '/ok.tmj': [200, 'application/octet-stream', readFileSync(fixturePath, 'utf8')],
      '/iso.tmj': [200, 'application/json', JSON.stringify({ orientation: 'isometric' })],
    });
    const ok = await loadLayout('/ok.tmj', f);
    expect(ok?.layout.plots).toHaveLength(6);
    await expect(loadLayout('/iso.tmj', f)).resolves.toBeNull();
    await expect(loadLayout('/nada.tmj', f)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('dirOf', () => {
    expect(dirOf('/assets/manifest.json?v=1')).toBe('/assets/');
    expect(dirOf('manifest.json')).toBe('');
  });
});

describe('câmera (matemática)', () => {
  it('zoom mínimo cobre a tela em retrato e paisagem', () => {
    expect(minZoomToCover(1920, 1080, 2576, 1438)).toBeCloseTo(0.7511, 3);
    expect(minZoomToCover(390, 844, 2576, 1438)).toBeCloseTo(0.5869, 3);
    expect(clampZoom(0.1, 0.5)).toBe(0.5);
    expect(clampZoom(10, 0.5)).toBe(3);
  });

  it('o ponto sob o cursor fica parado ao dar zoom', () => {
    const view = { w: 800, h: 600 };
    const scroll = { x: 100, y: 50 };
    const screen = { x: 200, y: 450 };
    const worldBefore = {
      x: scroll.x + 400 + (200 - 400) / 1,
      y: scroll.y + 300 + (450 - 300) / 1,
    };
    const s = scrollForZoomAt(scroll, view, screen, 1, 2);
    const worldAfter = { x: s.x + 400 + (200 - 400) / 2, y: s.y + 300 + (450 - 300) / 2 };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });
});
