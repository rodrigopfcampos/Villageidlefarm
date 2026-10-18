import { describe, expect, it } from 'vitest';
import type { Shape } from '@vif/shared';
import {
  PLAYER_FOOT,
  buildWalkGrid,
  cellOf,
  collidesAt,
  findPath,
  isFree,
  lineIsFree,
  makeCollider,
  nearestFreeCell,
  slideMove,
} from '../../src/farm/pathfinding';
import { rectIntersectsShape } from '../../src/farm/geometry';

// Mundo 320x320 com uma parede vertical no meio (x 150..170), aberta embaixo (y > 260).
const wall: Shape = { kind: 'rect', x: 150, y: 0, width: 20, height: 260 };
const collider = makeCollider([wall], 320, 320);
const grid = buildWalkGrid(collider, 16, PLAYER_FOOT);

function pathCrossesWall(pts: { x: number; y: number }[], from: { x: number; y: number }): boolean {
  let prev = from;
  for (const p of pts) {
    if (!lineIsFree(grid, prev, p)) return true;
    prev = p;
  }
  return false;
}

describe('colisão', () => {
  it('bate na parede e nas bordas', () => {
    expect(collidesAt(collider, 160, 100, PLAYER_FOOT)).toBe(true);
    expect(collidesAt(collider, 60, 100, PLAYER_FOOT)).toBe(false);
    expect(collidesAt(collider, 5, 100, PLAYER_FOOT)).toBe(true); // fora do mapa
  });

  it('desliza na parede', () => {
    const p = slideMove(collider, 130, 100, 20, 10, PLAYER_FOOT);
    expect(p.x).toBe(130);
    expect(p.y).toBe(110);
  });

  it('polígono', () => {
    const tri: Shape = {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    };
    expect(rectIntersectsShape({ x: 10, y: 10, width: 5, height: 5 }, tri)).toBe(true);
    expect(rectIntersectsShape({ x: 80, y: 80, width: 5, height: 5 }, tri)).toBe(false);
  });
});

describe('pathfinding em grade', () => {
  it('contorna a parede pelo vão de baixo', () => {
    const from = { x: 60, y: 60 };
    const to = { x: 260, y: 60 };
    const path = findPath(grid, from, to)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual(to);
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(260);
    expect(pathCrossesWall(path, from)).toBe(false);
  });

  it('linha livre vira um passo só (suavização)', () => {
    const path = findPath(grid, { x: 40, y: 40 }, { x: 120, y: 200 })!;
    expect(path).toEqual([{ x: 120, y: 200 }]);
  });

  it('destino bloqueado vai para a célula livre mais próxima', () => {
    const path = findPath(grid, { x: 60, y: 100 }, { x: 160, y: 100 })!;
    const last = path[path.length - 1]!;
    const c = cellOf(grid, last.x, last.y);
    expect(isFree(grid, c.cx, c.cy)).toBe(true);
    expect(Math.abs(last.x - 160)).toBeLessThan(40);
  });

  it('sem caminho devolve null', () => {
    const closed = makeCollider([{ kind: 'rect', x: 150, y: 0, width: 20, height: 320 }], 320, 320);
    const g = buildWalkGrid(closed, 16, PLAYER_FOOT);
    expect(findPath(g, { x: 60, y: 60 }, { x: 260, y: 60 })).toBeNull();
  });

  it('nearestFreeCell acha vizinho livre', () => {
    const c = cellOf(grid, 160, 100);
    expect(isFree(grid, c.cx, c.cy)).toBe(false);
    const n = nearestFreeCell(grid, c.cx, c.cy)!;
    expect(isFree(grid, n.cx, n.cy)).toBe(true);
  });
});
