// Geometria pura (sem Phaser): interseção de retângulos e polígonos do layout do Tiled.

import type { Point, Rect, Shape } from '@vif/shared';

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

export function pointInPolygon(p: Point, pts: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function shapeBounds(s: Shape): Rect {
  if (s.kind === 'rect') return { x: s.x, y: s.y, width: s.width, height: s.height };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** O retângulo encosta (com área) na forma? */
export function rectIntersectsShape(r: Rect, s: Shape): boolean {
  if (s.kind === 'rect') return rectsOverlap(r, s);
  if (!rectsOverlap(r, shapeBounds(s))) return false;
  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  if (corners.some((c) => pointInPolygon(c, s.points))) return true;
  if (s.points.some((p) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height)) {
    return true;
  }
  for (let i = 0; i < s.points.length; i++) {
    const a = s.points[i]!;
    const b = s.points[(i + 1) % s.points.length]!;
    for (let k = 0; k < 4; k++) {
      if (segmentsIntersect(a, b, corners[k]!, corners[(k + 1) % 4]!)) return true;
    }
  }
  return false;
}
