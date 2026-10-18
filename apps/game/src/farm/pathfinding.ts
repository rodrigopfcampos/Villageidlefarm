// Colisão e caminho em grade (puro, testável sem Phaser).
// O jogador ocupa só a "caixa dos pés" (FootBox) na base do sprite; é ela que bate na colisão do .tmj.

import type { Point, Rect, Shape } from '@vif/shared';
import { rectIntersectsShape, shapeBounds } from './geometry';

export interface FootBox {
  w: number;
  h: number;
}

export const PLAYER_FOOT: FootBox = { w: 22, h: 10 };

/** Caixa dos pés com o ponto (x, y) no meio da borda de baixo. */
export function footRect(x: number, y: number, foot: FootBox): Rect {
  return { x: x - foot.w / 2, y: y - foot.h, width: foot.w, height: foot.h };
}

/** Lista de formas com a caixa de cada uma (filtro rápido). */
export interface Collider {
  shapes: readonly Shape[];
  bounds: readonly Rect[];
  width: number;
  height: number;
}

export function makeCollider(shapes: readonly Shape[], width: number, height: number): Collider {
  return { shapes, bounds: shapes.map(shapeBounds), width, height };
}

/** A caixa dos pés em (x, y) bate em alguma colisão ou sai do mapa? */
export function collidesAt(c: Collider, x: number, y: number, foot: FootBox): boolean {
  const r = footRect(x, y, foot);
  if (r.x < 0 || r.y < 0 || r.x + r.width > c.width || r.y + r.height > c.height) return true;
  for (let i = 0; i < c.shapes.length; i++) {
    const b = c.bounds[i]!;
    if (r.x >= b.x + b.width || r.x + r.width <= b.x || r.y >= b.y + b.height) continue;
    if (r.y + r.height <= b.y) continue;
    if (rectIntersectsShape(r, c.shapes[i]!)) return true;
  }
  return false;
}

/**
 * Move (x, y) por (dx, dy) deslizando nas paredes: tenta o movimento inteiro, depois cada eixo.
 */
export function slideMove(
  c: Collider,
  x: number,
  y: number,
  dx: number,
  dy: number,
  foot: FootBox,
): Point {
  if (!collidesAt(c, x + dx, y + dy, foot)) return { x: x + dx, y: y + dy };
  if (dx !== 0 && !collidesAt(c, x + dx, y, foot)) return { x: x + dx, y };
  if (dy !== 0 && !collidesAt(c, x, y + dy, foot)) return { x, y: y + dy };
  return { x, y };
}

// ---------------- grade ----------------

export interface WalkGrid {
  cell: number;
  cols: number;
  rows: number;
  /** 1 = bloqueada. */
  blocked: Uint8Array;
}

export interface Cell {
  cx: number;
  cy: number;
}

export function buildWalkGrid(c: Collider, cell: number, foot: FootBox): WalkGrid {
  const cols = Math.ceil(c.width / cell);
  const rows = Math.ceil(c.height / cell);
  const blocked = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cell + cell / 2;
      const y = cy * cell + cell / 2 + foot.h / 2;
      blocked[cy * cols + cx] = collidesAt(c, x, y, foot) ? 1 : 0;
    }
  }
  return { cell, cols, rows, blocked };
}

/** Ponto dos pés que representa a célula (o mesmo usado para testar a colisão). */
export function cellCenter(g: WalkGrid, cx: number, cy: number, foot: FootBox = PLAYER_FOOT): Point {
  return { x: cx * g.cell + g.cell / 2, y: cy * g.cell + g.cell / 2 + foot.h / 2 };
}

export function cellOf(g: WalkGrid, x: number, y: number, foot: FootBox = PLAYER_FOOT): Cell {
  return {
    cx: Math.min(g.cols - 1, Math.max(0, Math.floor(x / g.cell))),
    cy: Math.min(g.rows - 1, Math.max(0, Math.floor((y - foot.h / 2) / g.cell))),
  };
}

export function isFree(g: WalkGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows && g.blocked[cy * g.cols + cx] === 0;
}

/** Célula livre mais próxima (anéis crescentes), ou null. */
export function nearestFreeCell(g: WalkGrid, cx: number, cy: number, maxRadius = 40): Cell | null {
  if (isFree(g, cx, cy)) return { cx, cy };
  for (let r = 1; r <= maxRadius; r++) {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isFree(g, cx + dx, cy + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { cx: cx + dx, cy: cy + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// Fila de prioridade (heap binário) de índices de célula.
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* em 8 direções (sem cortar quinas). Devolve as células do caminho (sem a inicial),
 * ou null se não houver caminho. Se o destino estiver bloqueado, usa a célula livre mais próxima.
 */
export function findPathCells(g: WalkGrid, start: Cell, goal: Cell, maxNodes = 60_000): Cell[] | null {
  const s = isFree(g, start.cx, start.cy) ? start : nearestFreeCell(g, start.cx, start.cy, 6);
  const t = nearestFreeCell(g, goal.cx, goal.cy);
  if (!s || !t) return null;
  const sIdx = s.cy * g.cols + s.cx;
  const tIdx = t.cy * g.cols + t.cx;
  if (sIdx === tIdx) return [];
  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (i: number) => {
    const dx = Math.abs((i % g.cols) - t.cx);
    const dy = Math.abs(Math.floor(i / g.cols) - t.cy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new MinHeap();
  gScore[sIdx] = 0;
  open.push(sIdx, h(sIdx));
  let visited = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === tIdx) break;
    closed[cur] = 1;
    if (++visited > maxNodes) return null;
    const cx = cur % g.cols;
    const cy = Math.floor(cur / g.cols);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isFree(g, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isFree(g, cx + dx, cy) || !isFree(g, cx, cy + dy))) continue;
      const ni = ny * g.cols + nx;
      if (closed[ni]) continue;
      const ng = gScore[cur]! + cost;
      if (ng < gScore[ni]!) {
        gScore[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
  }
  if (came[tIdx] === -1) return null;
  const out: Cell[] = [];
  for (let i = tIdx; i !== sIdx; i = came[i]!) {
    out.push({ cx: i % g.cols, cy: Math.floor(i / g.cols) });
  }
  return out.reverse();
}

/** A linha reta entre dois pontos (pés) passa só por células livres? */
export function lineIsFree(g: WalkGrid, a: Point, b: Point, foot: FootBox = PLAYER_FOOT): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / (g.cell / 3)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = cellOf(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, foot);
    if (!isFree(g, c.cx, c.cy)) return false;
  }
  return true;
}

/** Remove pontos intermediários quando há linha livre (caminho mais natural). */
export function smoothPath(g: WalkGrid, start: Point, pts: readonly Point[]): Point[] {
  if (pts.length <= 1) return [...pts];
  const out: Point[] = [];
  let anchor = start;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineIsFree(g, anchor, pts[j]!)) j--;
    out.push(pts[j]!);
    anchor = pts[j]!;
    i = j + 1;
  }
  return out;
}

/**
 * Caminho em pontos do mundo de `from` até `to` (pés do jogador). O último ponto é `to` quando ele
 * está livre; senão o centro da célula livre mais próxima. null = sem caminho.
 */
export function findPath(
  g: WalkGrid,
  from: Point,
  to: Point,
  isFreeAt?: (p: Point) => boolean,
): Point[] | null {
  const cells = findPathCells(g, cellOf(g, from.x, from.y), cellOf(g, to.x, to.y));
  if (!cells) return null;
  const pts = cells.map((c) => cellCenter(g, c.cx, c.cy));
  const goalCell = cellOf(g, to.x, to.y);
  const last = cells[cells.length - 1];
  const reachedGoalCell = last
    ? last.cx === goalCell.cx && last.cy === goalCell.cy
    : isFree(g, goalCell.cx, goalCell.cy);
  if (reachedGoalCell && (!isFreeAt || isFreeAt(to))) {
    if (pts.length > 0) pts[pts.length - 1] = { x: to.x, y: to.y };
    else pts.push({ x: to.x, y: to.y });
  }
  return smoothPath(g, from, pts);
}
