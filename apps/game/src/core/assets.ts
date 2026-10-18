// Leitura do /assets/manifest.json (escrito pelo agente Assets).
// Se o arquivo não existir (ou o servidor devolver o index.html no lugar), o jogo segue sem assets.

import {
  LayoutError,
  parseLayout,
  parseManifest,
  resolveAssetUrl,
  type AssetManifest,
  type ParseLayoutResult,
} from '@vif/shared';

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface LoadedManifest {
  manifest: AssetManifest;
  /** Pasta do manifest (para resolver os caminhos relativos). */
  baseDir: string;
  warnings: string[];
}

/** Pasta de uma URL ("/assets/manifest.json" -> "/assets/"). */
export function dirOf(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? '';
  return clean.slice(0, clean.lastIndexOf('/') + 1);
}

/** Busca e lê um JSON; null se não existir ou não for JSON. */
async function fetchJson(fetchFn: FetchLike, url: string): Promise<unknown | null> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) return null; // fallback de SPA: arquivo não existe
  try {
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return null;
  }
}

const defaultFetch: FetchLike = (u) => fetch(u, { cache: 'no-cache' });

/** Busca um JSON qualquer; null se ausente ou inválido. Nunca lança. */
export function loadJson(url: string, fetchFn: FetchLike = defaultFetch): Promise<unknown | null> {
  return fetchJson(fetchFn, url);
}

/** Carrega o manifest; devolve null (com aviso no console) se ausente. Nunca lança. */
export async function loadManifest(
  url: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<LoadedManifest | null> {
  const raw = await fetchJson(fetchFn, url);
  if (raw === null) {
    console.warn(`[assets] ${url} não encontrado; o jogo abre sem mapa nem atlas.`);
    return null;
  }
  const { manifest, warnings } = parseManifest(raw);
  for (const w of warnings) console.warn(`[assets] manifest: ${w}`);
  return { manifest, baseDir: dirOf(url), warnings };
}

/** Carrega e interpreta o layout do Tiled; null (com aviso) se ausente ou inválido. */
export async function loadLayout(
  url: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<ParseLayoutResult | null> {
  const raw = await fetchJson(fetchFn, url);
  if (raw === null) {
    console.warn(`[assets] layout ${url} não encontrado; sem colisão nem canteiros.`);
    return null;
  }
  try {
    const result = parseLayout(raw);
    for (const w of result.warnings) console.warn(`[layout] ${w}`);
    return result;
  } catch (err) {
    const msg = err instanceof LayoutError ? err.message : String(err);
    console.warn(`[layout] inválido: ${msg}`);
    return null;
  }
}

/** Lista do que o Phaser deve carregar (chaves de textura fixas para o mapa). */
export const TEXTURE_KEYS = {
  map: 'map',
  overhead: 'map_overhead',
} as const;

export type LoadItem =
  | { type: 'image'; key: string; url: string }
  | { type: 'atlas'; key: string; png: string; json: string };

export function planLoads(loaded: LoadedManifest): LoadItem[] {
  const { manifest, baseDir } = loaded;
  const r = (p: string) => resolveAssetUrl(baseDir, p);
  const items: LoadItem[] = [];
  if (manifest.map) {
    items.push({ type: 'image', key: TEXTURE_KEYS.map, url: r(manifest.map.image) });
    if (manifest.map.overhead) {
      items.push({ type: 'image', key: TEXTURE_KEYS.overhead, url: r(manifest.map.overhead) });
    }
  }
  for (const a of manifest.atlases) {
    items.push({ type: 'atlas', key: a.key, png: r(a.png), json: r(a.json) });
  }
  return items;
}
