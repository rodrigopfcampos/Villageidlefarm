import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LayoutError, layoutPlotSlots, parseLayout } from '../src/types/layout';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/farm_layout.min.tmj', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

const clone = (): Record<string, unknown> => structuredClone(fixture);

describe('parseLayout', () => {
  it('lê o layout de exemplo sem avisos', () => {
    const { layout, warnings } = parseLayout(fixture);
    expect(warnings).toEqual([]);
    expect(layout.tileWidth).toBe(32);
    expect(layout.widthTiles).toBe(81);
    expect(layout.heightTiles).toBe(45);
    expect(layout.pixelWidth).toBe(2592);
    expect(layout.pixelHeight).toBe(1440);
    expect(layout.plots).toHaveLength(6);
    expect(layout.plots.filter((p) => p.startsUnlocked)).toHaveLength(4);
    expect(layout.plots[4]).toMatchObject({ slotId: 'plot_05', unlockCost: 200, unlockLevel: 2 });
    expect(layout.spawn).toEqual({ x: 1100, y: 900 });
    expect(layout.lockedLots.map((l) => l.lotId)).toEqual(['lot_east', 'lot_south']);
    expect(layout.npcPoints).toEqual([{ npc: 'shopkeeper', x: 700, y: 600 }]);
    expect(layout.overhead).toHaveLength(1);
  });

  it('acha camadas dentro de grupos (pens) e converte polígono para coordenadas absolutas', () => {
    const { layout } = parseLayout(fixture);
    expect(layout.pens.map((p) => p.habitat)).toEqual(['coop', 'barn', 'pond']);
    const pond = layout.collision.find((s) => s.kind === 'polygon');
    expect(pond).toBeDefined();
    if (pond?.kind === 'polygon') {
      expect(pond.points[0]).toEqual({ x: 1600, y: 1000 });
      expect(pond.points[2]).toEqual({ x: 1856, y: 1064 });
    }
  });

  it('layoutPlotSlots devolve só as definições', () => {
    const slots = layoutPlotSlots(parseLayout(fixture).layout);
    expect(slots[0]).toEqual({
      slotId: 'plot_01',
      unlockCost: 0,
      unlockLevel: 1,
      startsUnlocked: true,
    });
  });

  it('ignora plots sem slotId ou repetidos, com aviso', () => {
    const tmj = clone();
    const layers = tmj.layers as { name: string; objects?: Record<string, unknown>[] }[];
    const plots = layers.find((l) => l.name === 'plots')!.objects!;
    plots.push({ ...plots[0], id: 900 }); // slotId repetido
    plots.push({ id: 901, x: 0, y: 0, width: 32, height: 32 }); // sem slotId
    const { layout, warnings } = parseLayout(tmj);
    expect(layout.plots).toHaveLength(6);
    expect(warnings.some((w) => w.includes('repetido'))).toBe(true);
    expect(warnings.some((w) => w.includes('sem slotId'))).toBe(true);
  });

  it('aceita camadas ausentes com aviso e spawn no centro', () => {
    const tmj = { width: 81, height: 45, tilewidth: 32, tileheight: 32, layers: [] };
    const { layout, warnings } = parseLayout(tmj);
    expect(layout.plots).toEqual([]);
    expect(layout.spawn).toEqual({ x: 1296, y: 720 });
    expect(warnings.some((w) => w.includes('"collision" ausente'))).toBe(true);
  });

  it('converte propriedades em texto ("200", "true")', () => {
    const tmj = {
      width: 81,
      height: 45,
      tilewidth: 32,
      tileheight: 32,
      layers: [
        {
          type: 'objectgroup',
          name: 'plots',
          objects: [
            {
              id: 1,
              x: 10,
              y: 20,
              width: 32,
              height: 32,
              properties: [
                { name: 'slotId', value: 'a' },
                { name: 'unlockCost', value: '200' },
                { name: 'startsUnlocked', value: 'true' },
              ],
            },
          ],
        },
      ],
    };
    const p = parseLayout(tmj).layout.plots[0];
    expect(p).toMatchObject({ slotId: 'a', unlockCost: 200, unlockLevel: 1, startsUnlocked: true });
  });

  it('lança LayoutError para mapa inutilizável', () => {
    expect(() => parseLayout(null)).toThrow(LayoutError);
    expect(() => parseLayout({ width: 1 })).toThrow(LayoutError);
    expect(() => parseLayout({ ...clone(), orientation: 'isometric' })).toThrow(LayoutError);
    expect(() => parseLayout({ ...clone(), infinite: true })).toThrow(LayoutError);
  });
});
