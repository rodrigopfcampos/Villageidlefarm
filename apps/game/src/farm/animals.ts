// Regras visuais dos animais (puro): raça/poses pelo atlas, cercado pelo habitat, produto pronto.

import type { AnimalDef, AnimalState, FarmClockSeconds, Habitat, LayoutPen, Rect } from '@vif/shared';

/** "animal_chicken" -> "chicken" */
export function speciesOf(animalType: string): string {
  return animalType.replace(/^animal_/, '');
}

export interface Breed {
  breed: string;
  /** Poses paradas (pose_*/idle_*), trocadas de vez em quando. */
  frames: string[];
  /** Ciclo de caminhada, se a arte tiver (walk_*; de lado olhando para a direita). Vazio = pulinho. */
  walk: string[];
}

const ANIMAL_FRAME_RE = /^([a-z]+(?:_[a-z]+)*)\/([a-z]+)(?:_([a-z]+))?_(\d+)$/;

/**
 * Raças disponíveis no atlas para a espécie: entidades "<espécie>_<raça>" (ex.: chicken_brown).
 * Sem nenhuma, usa a própria "<espécie>". Não depende de nomes fixos: lê o que existir em
 * "<entidade>/pose_<n>", "<entidade>/idle[_dir]_<n>" e "<entidade>/walk[_dir]_<n>".
 */
export function breedsFor(species: string, frames: readonly string[]): Breed[] {
  const by = new Map<string, { still: { n: number; f: string }[]; walk: { n: number; f: string; d: string }[] }>();
  for (const f of frames) {
    const m = ANIMAL_FRAME_RE.exec(f);
    if (!m) continue;
    const entity = m[1]!;
    if (entity !== species && !entity.startsWith(`${species}_`)) continue;
    const g = by.get(entity) ?? { still: [], walk: [] };
    const n = Number(m[4]);
    if (m[2] === 'walk') g.walk.push({ n, f, d: m[3] ?? 'side' });
    else if (m[2] === 'pose' || m[2] === 'idle') g.still.push({ n, f });
    by.set(entity, g);
  }
  const toBreed = (breed: string): Breed | null => {
    const g = by.get(breed);
    if (!g) return null;
    // caminhada: prefere a de lado (espelhada para a esquerda)
    const dirs = new Set(g.walk.map((w) => w.d));
    const dir = dirs.has('side') ? 'side' : [...dirs][0];
    const walk = g.walk.filter((w) => w.d === dir).sort((a, b) => a.n - b.n).map((w) => w.f);
    const still = g.still.sort((a, b) => a.n - b.n).map((x) => x.f);
    const framesOut = still.length > 0 ? still : walk.slice(0, 1);
    return framesOut.length > 0 ? { breed, frames: framesOut, walk } : null;
  };
  const breeds = [...by.keys()]
    .filter((k) => k !== species)
    .sort()
    .map(toBreed)
    .filter((b): b is Breed => b !== null);
  if (breeds.length > 0) return breeds;
  const own = toBreed(species);
  return own ? [own] : [];
}

/** Hash estável (FNV-1a) para escolher raça/posição sem aleatoriedade entre recargas. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickBreed(animalId: string, breeds: readonly Breed[]): Breed | null {
  if (breeds.length === 0) return null;
  return breeds[hashString(animalId) % breeds.length]!;
}

/** Cercado do animal: o primeiro com o habitat dele (ou o primeiro cercado). */
export function penFor(habitat: Habitat | undefined, pens: readonly LayoutPen[]): LayoutPen | null {
  return pens.find((p) => p.habitat === habitat) ?? pens[0] ?? null;
}

/** Previsão de produtos prontos (o servidor decide na coleta). */
export function readyProducts(a: AnimalState, def: AnimalDef | undefined, fc: FarmClockSeconds): number {
  if (!def) return 0;
  return Math.max(0, Math.min(Math.floor((fc - a.lastCollectFc) / def.produceSeconds), def.maxStock));
}

/** Ponto aleatório dentro do retângulo, com margem (para os pés do animal). */
export function randomPointIn(r: Rect, margin: number, rnd: () => number): { x: number; y: number } {
  const m = Math.min(margin, r.width / 2, r.height / 2);
  return { x: r.x + m + rnd() * (r.width - 2 * m), y: r.y + m + rnd() * (r.height - 2 * m) };
}
