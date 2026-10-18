import { describe, expect, it } from 'vitest';
import {
  buildingDepth,
  drawOrder,
  entityDepth,
  isBehindOverhead,
  isGroundDecor,
  overheadRect,
  parseBuildings,
  type BuildingDef,
} from '../../src/farm/buildings';
import { DEPTH } from '../../src/core/constants';

const house: BuildingDef = {
  name: 'house',
  sprite: 'building/house',
  rect: { x: 200, y: 159, width: 400, height: 386 },
  overheadSplitY: 236,
};
const pier: BuildingDef = { ...house, name: 'pier', sprite: 'building/pier', overheadSplitY: 0 };

describe('ordenação por profundidade (y)', () => {
  it('quem está mais embaixo fica na frente', () => {
    expect(entityDepth(500)).toBeGreaterThan(entityDepth(400));
    expect(entityDepth(1438)).toBeLessThan(DEPTH.overhead);
  });

  it('jogador atrás da casa fica por baixo; na frente, por cima', () => {
    const base = buildingDepth(house); // base em y = 545
    expect(entityDepth(500)).toBeLessThan(base);
    expect(entityDepth(560)).toBeGreaterThan(base);
    const order = drawOrder([
      { id: 'player-front', depth: entityDepth(560) },
      { id: 'house', depth: base },
      { id: 'player-behind', depth: entityDepth(500) },
    ]).map((x) => x.id);
    expect(order).toEqual(['player-behind', 'house', 'player-front']);
  });

  it('decoração sem telhado (píer) vai no chão, por baixo de todos', () => {
    expect(isGroundDecor(pier)).toBe(true);
    expect(buildingDepth(pier)).toBeLessThan(entityDepth(0));
    expect(overheadRect(pier)).toBeNull();
  });

  it('telhado semitransparente só quando o jogador está atrás e encostando', () => {
    expect(overheadRect(house)).toEqual({ x: 200, y: 159, width: 400, height: 236 });
    const body = (x: number, feet: number) => ({ x: x - 18, y: feet - 66, width: 36, height: 66 });
    expect(isBehindOverhead(house, body(400, 420), 420)).toBe(true);
    expect(isBehindOverhead(house, body(400, 600), 600)).toBe(false); // na frente
    expect(isBehindOverhead(house, body(900, 420), 420)).toBe(false); // longe
  });
});

describe('parseBuildings', () => {
  it('lê a camada buildings (inclusive em grupo) e ignora objetos inválidos', () => {
    const tmj = {
      layers: [
        {
          type: 'group',
          name: 'g',
          offsetx: 10,
          layers: [
            {
              type: 'objectgroup',
              name: 'buildings',
              objects: [
                {
                  name: 'oak_1',
                  x: 0,
                  y: 0,
                  width: 204,
                  height: 268,
                  properties: [
                    { name: 'sprite', value: 'tree/oak' },
                    { name: 'overheadSplitY', value: 242 },
                  ],
                },
                { name: 'bad', x: 0, y: 0, width: 10, height: 10 },
              ],
            },
          ],
        },
        { type: 'objectgroup', name: 'collision', objects: [] },
      ],
    };
    const b = parseBuildings(tmj);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ name: 'oak_1', sprite: 'tree/oak', overheadSplitY: 242 });
    expect(b[0]!.rect.x).toBe(10);
    expect(parseBuildings(null)).toEqual([]);
  });
});
