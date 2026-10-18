// Camada "buildings" do .tmj (prédios e árvores) e regras de profundidade (puro).
// O parseLayout do @vif/shared não lê esta camada; lemos aqui direto do JSON do Tiled.
//
// Cada objeto: retângulo do tamanho do sprite; props `sprite` e `overheadSplitY`.
// O sprite fica com a base central no meio da borda de baixo (pivot 0.5, 1).
// overheadSplitY = linha (do topo) acima da qual o sprite é telhado/copa; 0 = nunca cobre (chão).

import type { Rect } from '@vif/shared';
import { DEPTH } from '../core/constants';

export interface BuildingDef {
  name: string;
  sprite: string;
  /** Retângulo do sprite no mundo (topo-esquerda). */
  rect: Rect;
  overheadSplitY: number;
}

interface RawObj {
  name?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  properties?: { name?: unknown; value?: unknown }[];
}
interface RawLayer {
  type?: unknown;
  name?: unknown;
  objects?: RawObj[];
  layers?: RawLayer[];
  offsetx?: unknown;
  offsety?: unknown;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Lê a camada `buildings` (inclusive dentro de grupos). Objetos inválidos são ignorados. */
export function parseBuildings(tmj: unknown): BuildingDef[] {
  const out: BuildingDef[] = [];
  const walk = (layers: unknown, ox: number, oy: number) => {
    if (!Array.isArray(layers)) return;
    for (const l of layers as RawLayer[]) {
      if (!l || typeof l !== 'object') continue;
      const dx = ox + (num(l.offsetx) ?? 0);
      const dy = oy + (num(l.offsety) ?? 0);
      if (l.type === 'group') walk(l.layers, dx, dy);
      if (l.type !== 'objectgroup' || l.name !== 'buildings' || !Array.isArray(l.objects)) continue;
      for (const o of l.objects) {
        const x = num(o.x);
        const y = num(o.y);
        const w = num(o.width);
        const h = num(o.height);
        const props = new Map((o.properties ?? []).map((p) => [p.name, p.value]));
        const sprite = props.get('sprite');
        if (x === null || y === null || !w || !h || typeof sprite !== 'string' || !sprite) continue;
        const split = num(props.get('overheadSplitY')) ?? 0;
        out.push({
          name: typeof o.name === 'string' ? o.name : sprite,
          sprite,
          rect: { x: x + dx, y: y + dy, width: w, height: h },
          overheadSplitY: Math.max(0, Math.min(h, Math.round(split))),
        });
      }
    }
  };
  if (tmj && typeof tmj === 'object') walk((tmj as { layers?: unknown }).layers, 0, 0);
  return out;
}

// ---------------- profundidade ----------------

/** Profundidade de uma entidade pelos pés (y maior = mais na frente). */
export function entityDepth(feetY: number): number {
  return DEPTH.entities + feetY;
}

/** Base (pés) do prédio no mundo. */
export function buildingBaseY(b: BuildingDef): number {
  return b.rect.y + b.rect.height;
}

/** Prédio sem telhado (píer, fileiras de planta): vai no chão, por baixo de tudo. */
export function isGroundDecor(b: BuildingDef): boolean {
  return b.overheadSplitY <= 0;
}

export function buildingDepth(b: BuildingDef): number {
  return isGroundDecor(b) ? DEPTH.ground + 1 : entityDepth(buildingBaseY(b));
}

/** Área do telhado/copa no mundo (parte do sprite acima de overheadSplitY), ou null. */
export function overheadRect(b: BuildingDef): Rect | null {
  if (isGroundDecor(b)) return null;
  return { x: b.rect.x, y: b.rect.y, width: b.rect.width, height: b.overheadSplitY };
}

/**
 * O jogador está escondido atrás do telhado/copa? (pés acima da base do prédio e o corpo
 * encostando na área de cima). Usado para deixar o telhado semitransparente.
 */
export function isBehindOverhead(b: BuildingDef, body: Rect, feetY: number): boolean {
  const top = overheadRect(b);
  if (!top || feetY >= buildingBaseY(b)) return false;
  return (
    body.x < top.x + top.width &&
    body.x + body.width > top.x &&
    body.y < top.y + top.height &&
    body.y + body.height > top.y
  );
}

/** Ordena para desenhar (de trás para frente). Útil para conferir a ordenação nos testes. */
export function drawOrder<T extends { depth: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.depth - b.depth);
}
