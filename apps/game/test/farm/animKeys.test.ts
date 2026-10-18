import { describe, expect, it } from 'vitest';
import { collectAnimFrames, facingFrom, resolveAnim } from '../../src/farm/animKeys';
import { breedsFor, pickBreed, readyProducts } from '../../src/farm/animals';
import { ANIMALS_BY_TYPE } from '@vif/shared';

describe('animações do personagem', () => {
  const frames = [
    'farmer_m/walk_side_1',
    'farmer_m/walk_side_0',
    'farmer_m/walk_left_0',
    'farmer_m/idle_down_0',
    'farmer_m/water_side_0',
    'farmer_f/plant_side_0',
  ];
  const groups = collectAnimFrames(frames, 'farmer_m');
  const avail = new Set(groups.keys());

  it('agrupa e ordena por número (ignora *_left)', () => {
    expect(groups.get('walk_side')).toEqual(['farmer_m/walk_side_0', 'farmer_m/walk_side_1']);
    expect(avail.has('walk_left')).toBe(false);
    expect(avail.has('plant_side')).toBe(false);
  });

  it('espelha o lado para a esquerda', () => {
    expect(resolveAnim(avail, 'walk', 'left')).toEqual({ key: 'walk_side', flipX: true });
    expect(resolveAnim(avail, 'walk', 'right')).toEqual({ key: 'walk_side', flipX: false });
  });

  it('usa alternativas quando falta arte', () => {
    expect(resolveAnim(avail, 'walk', 'up')).toEqual({ key: 'walk_side', flipX: false });
    expect(resolveAnim(avail, 'plant', 'down')).toEqual({ key: 'water_side', flipX: false });
    expect(resolveAnim(avail, 'idle', 'left')).toEqual({ key: 'idle_down', flipX: false });
    expect(resolveAnim(new Set(), 'idle', 'down')).toBeNull();
  });

  it('direção pelo vetor', () => {
    expect(facingFrom(1, 0, 'down')).toBe('right');
    expect(facingFrom(-1, 0.2, 'down')).toBe('left');
    expect(facingFrom(0, -1, 'down')).toBe('up');
    expect(facingFrom(0, 0, 'left')).toBe('left');
  });
});

describe('animais', () => {
  const frames = [
    'chicken/idle_0',
    'chicken_brown/pose_1',
    'chicken_brown/pose_0',
    'chicken_white/pose_0',
    'cow_holstein/walk_side_0',
    'cow_holstein/walk_side_1',
    'cow_holstein/pose_0',
    'chickenfoo/pose_0',
  ];
  it('raças pelo atlas, sem nomes fixos', () => {
    const b = breedsFor('chicken', frames);
    expect(b.map((x) => x.breed)).toEqual(['chicken_brown', 'chicken_white']);
    expect(b[0]!.frames).toEqual(['chicken_brown/pose_0', 'chicken_brown/pose_1']);
    expect(b[0]!.walk).toEqual([]);
    const cow = breedsFor('cow', frames);
    expect(cow[0]!.walk).toEqual(['cow_holstein/walk_side_0', 'cow_holstein/walk_side_1']);
    expect(breedsFor('duck', ['duck/idle_0'])[0]!.frames).toEqual(['duck/idle_0']);
    expect(breedsFor('goat', frames)).toEqual([]);
  });

  it('raça estável por id', () => {
    const b = breedsFor('chicken', frames);
    expect(pickBreed('animal_7', b)).toBe(pickBreed('animal_7', b));
  });

  it('produto pronto pelo relógio, limitado ao estoque', () => {
    const def = ANIMALS_BY_TYPE.get('animal_chicken')!;
    const a = { id: 'a', animalType: 'animal_chicken', name: 'g', lastCollectFc: 100 };
    expect(readyProducts(a, def, 100 + def.produceSeconds - 1)).toBe(0);
    expect(readyProducts(a, def, 100 + def.produceSeconds)).toBe(1);
    expect(readyProducts(a, def, 100 + def.produceSeconds * 99)).toBe(def.maxStock);
  });
});
