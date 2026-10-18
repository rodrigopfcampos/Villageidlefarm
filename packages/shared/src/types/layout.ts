// Esquema do layout do Tiled (.tmj, JSON) e o parser usado pelo jogo, pela mock e pelo gerador de seed.
//
// Mapa ortogonal, tilewidth = tileheight = 32, 81 x 45 células. Camadas de objetos (nomes exatos):
//   collision   retângulos ou polígonos
//   plots       retângulos; props slotId:string, unlockCost:int, unlockLevel:int, startsUnlocked:bool
//   pens        retângulos; prop habitat: coop|barn|pond
//   spawn       ponto com name "player"
//   locked_lots retângulos; props lotId:string, cost:int
//   npc_points  pontos; prop npc:string
//   overhead    (opcional) retângulos ou polígonos das áreas de telhado/copa
// Camadas podem estar dentro de "group" layers. Coordenadas devolvidas são absolutas, em pixels do mundo.

import type { Habitat, PlotSlotDef } from './models';

export const LAYOUT_LAYERS = {
  collision: 'collision',
  plots: 'plots',
  pens: 'pens',
  spawn: 'spawn',
  lockedLots: 'locked_lots',
  npcPoints: 'npc_points',
  overhead: 'overhead',
} as const;

export const EXPECTED_LAYOUT = {
  tileWidth: 32,
  tileHeight: 32,
  widthTiles: 81,
  heightTiles: 45,
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Shape = ({ kind: 'rect' } & Rect) | { kind: 'polygon'; points: Point[] };

export interface LayoutPlot extends PlotSlotDef {
  rect: Rect;
}

export interface LayoutPen {
  id: string;
  habitat: Habitat;
  rect: Rect;
}

export interface LayoutLockedLot {
  lotId: string;
  cost: number;
  rect: Rect;
}

export interface LayoutNpcPoint extends Point {
  npc: string;
}

export interface FarmLayout {
  tileWidth: number;
  tileHeight: number;
  widthTiles: number;
  heightTiles: number;
  pixelWidth: number;
  pixelHeight: number;
  collision: Shape[];
  plots: LayoutPlot[];
  pens: LayoutPen[];
  spawn: Point;
  lockedLots: LayoutLockedLot[];
  npcPoints: LayoutNpcPoint[];
  overhead: Shape[];
}

export interface ParseLayoutResult {
  layout: FarmLayout;
  /** Problemas não fatais (objeto ignorado, camada ausente…). Mostre no console. */
  warnings: string[];
}

/** Erro fatal: o arquivo não é um mapa Tiled ortogonal utilizável. */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutError';
  }
}

const HABITATS: readonly Habitat[] = ['coop', 'barn', 'pond'];

// ---------- formato bruto do Tiled (só o que usamos) ----------

interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  point?: boolean;
  ellipse?: boolean;
  polygon?: Point[];
  polyline?: Point[];
  properties?: TiledProperty[];
}

interface TiledLayer {
  type: string;
  name: string;
  objects?: TiledObject[];
  layers?: TiledLayer[];
  offsetx?: number;
  offsety?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function prop(obj: TiledObject, name: string): unknown {
  return obj.properties?.find((p) => p.name === name)?.value;
}

function propString(obj: TiledObject, name: string): string | undefined {
  const v = prop(obj, name);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (isFiniteNumber(v)) return String(v);
  return undefined;
}

function propInt(obj: TiledObject, name: string): number | undefined {
  const v = prop(obj, name);
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return isFiniteNumber(n) && Number.isInteger(n) ? n : undefined;
}

function propBool(obj: TiledObject, name: string): boolean | undefined {
  const v = prop(obj, name);
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function describe(layer: string, obj: TiledObject): string {
  return `${layer}#${obj.id ?? '?'}${obj.name ? ` "${obj.name}"` : ''}`;
}

/** Junta camadas de objetos (inclusive dentro de grupos) por nome, somando offsets. */
function collectObjectLayers(
  layers: TiledLayer[],
  out: Map<string, TiledObject[]>,
  ox = 0,
  oy = 0,
): void {
  for (const layer of layers) {
    if (!isRecord(layer)) continue;
    const dx = ox + (isFiniteNumber(layer.offsetx) ? layer.offsetx : 0);
    const dy = oy + (isFiniteNumber(layer.offsety) ? layer.offsety : 0);
    if (layer.type === 'group' && Array.isArray(layer.layers)) {
      collectObjectLayers(layer.layers, out, dx, dy);
    } else if (layer.type === 'objectgroup' && Array.isArray(layer.objects)) {
      const list = out.get(layer.name) ?? [];
      for (const o of layer.objects) {
        if (!isRecord(o) || !isFiniteNumber(o.x) || !isFiniteNumber(o.y)) continue;
        list.push({ ...o, x: o.x + dx, y: o.y + dy });
      }
      out.set(layer.name, list);
    }
  }
}

function asRect(obj: TiledObject): Rect | null {
  if (obj.point || obj.polygon || obj.polyline) return null;
  if (!isFiniteNumber(obj.width) || !isFiniteNumber(obj.height)) return null;
  if (obj.width <= 0 || obj.height <= 0) return null;
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

function asShape(obj: TiledObject, layer: string, warnings: string[]): Shape | null {
  if (obj.rotation) warnings.push(`${describe(layer, obj)}: rotação ignorada`);
  if (Array.isArray(obj.polygon)) {
    const points = obj.polygon
      .filter((p) => isFiniteNumber(p.x) && isFiniteNumber(p.y))
      .map((p) => ({ x: obj.x + p.x, y: obj.y + p.y }));
    if (points.length < 3) {
      warnings.push(`${describe(layer, obj)}: polígono com menos de 3 pontos ignorado`);
      return null;
    }
    return { kind: 'polygon', points };
  }
  const rect = asRect(obj);
  if (!rect) {
    warnings.push(`${describe(layer, obj)}: precisa ser retângulo ou polígono`);
    return null;
  }
  if (obj.ellipse) warnings.push(`${describe(layer, obj)}: elipse tratada como retângulo`);
  return { kind: 'rect', ...rect };
}

/**
 * Lê um .tmj (já convertido de JSON) e devolve o layout normalizado.
 * Lança LayoutError só se o mapa for inutilizável; o resto vira aviso em `warnings`.
 */
export function parseLayout(tmj: unknown): ParseLayoutResult {
  const warnings: string[] = [];
  if (!isRecord(tmj)) throw new LayoutError('Layout não é um objeto JSON');
  if (tmj.orientation !== undefined && tmj.orientation !== 'orthogonal') {
    throw new LayoutError(`Orientação "${String(tmj.orientation)}" não suportada (use orthogonal)`);
  }
  if (tmj.infinite === true) throw new LayoutError('Mapa infinito não suportado');
  const { width, height, tilewidth, tileheight, layers } = tmj;
  if (
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    !isFiniteNumber(tilewidth) ||
    !isFiniteNumber(tileheight)
  ) {
    throw new LayoutError('Faltam width/height/tilewidth/tileheight');
  }
  if (!Array.isArray(layers)) throw new LayoutError('Faltam as camadas (layers)');

  const e = EXPECTED_LAYOUT;
  if (tilewidth !== e.tileWidth || tileheight !== e.tileHeight) {
    warnings.push(`Tile ${tilewidth}x${tileheight}, esperado ${e.tileWidth}x${e.tileHeight}`);
  }
  if (width !== e.widthTiles || height !== e.heightTiles) {
    warnings.push(`Mapa ${width}x${height} células, esperado ${e.widthTiles}x${e.heightTiles}`);
  }

  const byName = new Map<string, TiledObject[]>();
  collectObjectLayers(layers as TiledLayer[], byName);
  const L = LAYOUT_LAYERS;
  for (const required of [L.collision, L.plots, L.pens, L.spawn, L.lockedLots, L.npcPoints]) {
    if (!byName.has(required)) warnings.push(`Camada "${required}" ausente`);
  }
  const objs = (name: string): TiledObject[] => byName.get(name) ?? [];

  // collision / overhead
  const shapes = (name: string): Shape[] =>
    objs(name)
      .map((o) => asShape(o, name, warnings))
      .filter((s): s is Shape => s !== null);
  const collision = shapes(L.collision);
  const overhead = shapes(L.overhead);

  // plots
  const plots: LayoutPlot[] = [];
  const seenSlots = new Set<string>();
  for (const o of objs(L.plots)) {
    const rect = asRect(o);
    const slotId = propString(o, 'slotId');
    if (!rect) {
      warnings.push(`${describe(L.plots, o)}: precisa ser retângulo`);
      continue;
    }
    if (!slotId) {
      warnings.push(`${describe(L.plots, o)}: sem slotId`);
      continue;
    }
    if (seenSlots.has(slotId)) {
      warnings.push(`${describe(L.plots, o)}: slotId "${slotId}" repetido`);
      continue;
    }
    seenSlots.add(slotId);
    const unlockCost = propInt(o, 'unlockCost') ?? 0;
    const unlockLevel = propInt(o, 'unlockLevel') ?? 1;
    if (unlockCost < 0 || unlockLevel < 1) {
      warnings.push(`${describe(L.plots, o)}: unlockCost/unlockLevel inválidos`);
      continue;
    }
    plots.push({
      slotId,
      unlockCost,
      unlockLevel,
      startsUnlocked: propBool(o, 'startsUnlocked') ?? false,
      rect,
    });
  }

  // pens
  const pens: LayoutPen[] = [];
  for (const o of objs(L.pens)) {
    const rect = asRect(o);
    const habitat = propString(o, 'habitat') as Habitat | undefined;
    if (!rect || !habitat || !HABITATS.includes(habitat)) {
      warnings.push(`${describe(L.pens, o)}: precisa ser retângulo com habitat coop|barn|pond`);
      continue;
    }
    pens.push({ id: o.name?.trim() || `pen_${o.id ?? pens.length + 1}`, habitat, rect });
  }

  // locked_lots
  const lockedLots: LayoutLockedLot[] = [];
  const seenLots = new Set<string>();
  for (const o of objs(L.lockedLots)) {
    const rect = asRect(o);
    const lotId = propString(o, 'lotId');
    const cost = propInt(o, 'cost');
    if (!rect || !lotId || cost === undefined || cost < 0 || seenLots.has(lotId)) {
      warnings.push(`${describe(L.lockedLots, o)}: precisa ser retângulo com lotId único e cost`);
      continue;
    }
    seenLots.add(lotId);
    lockedLots.push({ lotId, cost, rect });
  }

  // npc_points
  const npcPoints: LayoutNpcPoint[] = [];
  for (const o of objs(L.npcPoints)) {
    const npc = propString(o, 'npc');
    if (!npc) {
      warnings.push(`${describe(L.npcPoints, o)}: sem propriedade npc`);
      continue;
    }
    npcPoints.push({ npc, x: o.x, y: o.y });
  }

  // spawn
  const pixelWidth = width * tilewidth;
  const pixelHeight = height * tileheight;
  const spawnObjs = objs(L.spawn);
  const spawnObj = spawnObjs.find((o) => o.name === 'player') ?? spawnObjs.find((o) => o.point);
  let spawn: Point;
  if (spawnObj) {
    if (spawnObj.name !== 'player')
      warnings.push('Spawn sem name "player"; usando o primeiro ponto');
    spawn = { x: spawnObj.x, y: spawnObj.y };
  } else {
    warnings.push('Sem ponto de spawn; usando o centro do mapa');
    spawn = { x: pixelWidth / 2, y: pixelHeight / 2 };
  }

  return {
    layout: {
      tileWidth: tilewidth,
      tileHeight: tileheight,
      widthTiles: width,
      heightTiles: height,
      pixelWidth,
      pixelHeight,
      collision,
      plots,
      pens,
      spawn,
      lockedLots,
      npcPoints,
      overhead,
    },
    warnings,
  };
}

/** Definições de canteiro do layout (para a mock e o seed do banco). */
export function layoutPlotSlots(layout: FarmLayout): PlotSlotDef[] {
  return layout.plots.map(({ slotId, unlockCost, unlockLevel, startsUnlocked }) => ({
    slotId,
    unlockCost,
    unlockLevel,
    startsUnlocked,
  }));
}
