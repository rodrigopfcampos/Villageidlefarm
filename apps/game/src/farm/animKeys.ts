// Animações do personagem a partir dos quadros do atlas (puro).
// Nomes: "<personagem>/<ação>_<direção>_<n>"; direções down | up | side (side olha para a DIREITA;
// para a esquerda espelhamos). Quadros "*_left_*" são ignorados: usamos sempre side + flipX.

export type Facing = 'down' | 'up' | 'left' | 'right';
export type CharAction = 'idle' | 'walk' | 'water' | 'plant' | 'harvest';
type ArtDir = 'down' | 'up' | 'side';

const FRAME_RE = /^([a-z_]+)\/([a-z]+)_(down|up|side)_(\d+)$/;

/** Agrupa quadros de um personagem em "<ação>_<dir>" -> quadros ordenados por número. */
export function collectAnimFrames(frames: readonly string[], character: string): Map<string, string[]> {
  const groups = new Map<string, { n: number; f: string }[]>();
  for (const f of frames) {
    const m = FRAME_RE.exec(f);
    if (!m || m[1] !== character) continue;
    const key = `${m[2]}_${m[3]}`;
    const list = groups.get(key) ?? [];
    list.push({ n: Number(m[4]), f });
    groups.set(key, list);
  }
  const out = new Map<string, string[]>();
  for (const [k, list] of groups) out.set(k, list.sort((a, b) => a.n - b.n).map((x) => x.f));
  return out;
}

/** Alternativas por ação quando falta arte (o fazendeiro não tem plantar/colher). */
const ACTION_FALLBACK: Record<CharAction, readonly string[]> = {
  idle: ['idle', 'walk'],
  walk: ['walk', 'idle'],
  water: ['water', 'hoe', 'idle'],
  plant: ['plant', 'hoe', 'water', 'idle'],
  harvest: ['harvest', 'hoe', 'plant', 'idle'],
};

const DIR_FALLBACK: Record<Facing, readonly ArtDir[]> = {
  down: ['down', 'side', 'up'],
  up: ['up', 'side', 'down'],
  left: ['side', 'down', 'up'],
  right: ['side', 'down', 'up'],
};

export interface ResolvedAnim {
  /** "<ação>_<dir>" existente em `available`. */
  key: string;
  flipX: boolean;
}

/** Escolhe a melhor animação disponível para a ação e direção (espelha o lado quando preciso). */
export function resolveAnim(
  available: ReadonlySet<string>,
  action: CharAction,
  facing: Facing,
): ResolvedAnim | null {
  for (const a of ACTION_FALLBACK[action]) {
    for (const d of DIR_FALLBACK[facing]) {
      const key = `${a}_${d}`;
      if (available.has(key)) return { key, flipX: d === 'side' && facing === 'left' };
    }
  }
  const any = [...available][0];
  return any ? { key: any, flipX: false } : null;
}

/** Direção pelo vetor de movimento (mantém a anterior se parado). */
export function facingFrom(dx: number, dy: number, prev: Facing): Facing {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
  if (Math.abs(dx) > Math.abs(dy) * 1.1) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
