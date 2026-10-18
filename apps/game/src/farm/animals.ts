// Regras visuais dos animais (puro): raça/poses pelo atlas, cercado pelo habitat, produto pronto.

import type { AnimalDef, AnimalState, FarmClockSeconds, Habitat, LayoutPen, Rect } from '@vif/shared';

/** "animal_chicken" -> "chicken" */
export function speciesOf(animalType: string): string {
  return animalType.replace(/^animal_/, '');
}

export interface Breed {
  breed: string;
  frames: string[];
}

/**
 * Raças disponíveis no atlas para a espécie: quadros "<espécie>_<raça>/pose_<n>".
 * Sem nenhuma, usa "<espécie>/idle_0" se existir.
 */
export function breedsFor(species: string, frames: readonly string[]): Breed[] {
  const by = new Map<string, { n: number; f: string }[]>();
  const re = new RegExp(`^(${species}_[a-z]+)/pose_(\\d+)$`);
  for (const f of frames) {
    const m = re.exec(f);
    if (!m) continue;
    const list = by.get(m[1]!) ?? [];
    list.push({ n: Number(m[2]), f });
    by.set(m[1]!, list);
  }
  const out = [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([breed, list]) => ({ breed, frames: list.sort((a, b) => a.n - b.n).map((x) => x.f) }));
  if (out.length === 0) {
    const idle = frames.filter((f) => f.startsWith(`${species}/`));
    if (idle.length > 0) out.push({ breed: species, frames: idle });
  }
  return out;
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
