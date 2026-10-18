// Contrato com o agente Assets (A1): apps/game/public/assets/manifest.json.
// Caminhos relativos à pasta do manifest (/assets/). Atlas no formato JSON Hash do Phaser.
// Nome de quadro: "<entidade>/<pose>_<n>", ex.: "cow/pose_0", "icon/carrot", "farmer_m/idle_down_0".

export const ATLAS_CATEGORIES = [
  'icons',
  'cards',
  'animals',
  'characters',
  'pets',
  'vehicles',
] as const;
export type AtlasCategory = (typeof ATLAS_CATEGORIES)[number];

export interface ManifestMap {
  image: string;
  overhead?: string;
  layout?: string;
  width: number;
  height: number;
}

export interface ManifestAtlas {
  /** "atlas_<categoria>", ex.: "atlas_icons". */
  key: string;
  png: string;
  json: string;
}

export interface AssetManifest {
  map?: ManifestMap;
  atlases: ManifestAtlas[];
}

export interface ParseManifestResult {
  manifest: AssetManifest;
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Valida o manifest. Nunca lança: entradas inválidas viram aviso e são ignoradas. */
export function parseManifest(raw: unknown): ParseManifestResult {
  const warnings: string[] = [];
  const manifest: AssetManifest = { atlases: [] };
  if (!isRecord(raw)) {
    warnings.push('manifest.json não é um objeto');
    return { manifest, warnings };
  }
  if (raw.map !== undefined) {
    const m = raw.map;
    const image = isRecord(m) ? str(m.image) : undefined;
    const width = isRecord(m) ? m.width : undefined;
    const height = isRecord(m) ? m.height : undefined;
    if (
      isRecord(m) &&
      image &&
      typeof width === 'number' &&
      typeof height === 'number' &&
      width > 0 &&
      height > 0
    ) {
      manifest.map = {
        image,
        overhead: str(m.overhead),
        layout: str(m.layout),
        width,
        height,
      };
    } else {
      warnings.push('manifest.map inválido (precisa de image, width e height)');
    }
  }
  if (Array.isArray(raw.atlases)) {
    const keys = new Set<string>();
    for (const a of raw.atlases) {
      const key = isRecord(a) ? str(a.key) : undefined;
      const png = isRecord(a) ? str(a.png) : undefined;
      const json = isRecord(a) ? str(a.json) : undefined;
      if (!key || !png || !json || keys.has(key)) {
        warnings.push(`atlas inválido ou repetido: ${JSON.stringify(a)}`);
        continue;
      }
      keys.add(key);
      manifest.atlases.push({ key, png, json });
    }
  } else if (raw.atlases !== undefined) {
    warnings.push('manifest.atlases não é uma lista');
  }
  return { manifest, warnings };
}

/** Resolve um caminho do manifest contra a URL da pasta do manifest (ex.: "/assets/"). */
export function resolveAssetUrl(baseDir: string, path: string): string {
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith('/')) return path;
  return baseDir.replace(/\/?$/, '/') + path.replace(/^\.\//, '');
}
