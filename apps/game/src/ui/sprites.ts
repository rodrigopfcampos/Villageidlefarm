// Qual quadro do atlas desenhar para cada coisa do catálogo (com substitutos para artes que faltam).

import { CROPS, ITEMS_BY_ID, type AnimalType, type ItemId } from '@vif/shared';

/** Quadro de cada animal na loja (pose de frente da raça "padrão"). */
const ANIMAL_FRAMES: Record<string, string[]> = {
  animal_chicken: ['chicken_white/pose_0', 'chicken_brown/pose_0', 'chicken/pose_0'],
  animal_duck: ['duck_mallard/pose_0', 'duck_white/pose_0', 'duck/pose_0'],
  animal_cow: ['cow_holstein/pose_0', 'cow_brown/pose_0', 'cow/pose_0'],
  animal_sheep: ['sheep_white/pose_0', 'sheep/pose_0'],
  animal_pig: ['pig_pink/pose_0'],
  animal_goat: ['goat_brown/pose_0'],
  animal_rabbit: ['rabbit_white/pose_0'],
  animal_goose: ['goose_white/pose_0'],
  animal_alpaca: ['alpaca_cream/pose_0'],
  animal_turkey: ['turkey_bronze/pose_0'],
};

/** Candidatos de quadro para um item. Semente sem ícone próprio usa o ícone da cultura. */
export function itemFrames(id: ItemId): string[] {
  const item = ITEMS_BY_ID.get(id);
  const out: string[] = [];
  if (item) out.push(item.spriteKey);
  if (item?.kind === 'seed') {
    const crop = CROPS.find((c) => c.seedItemId === id);
    const yieldItem = crop ? ITEMS_BY_ID.get(crop.yieldItemId) : undefined;
    if (yieldItem) out.push(yieldItem.spriteKey);
  }
  return out;
}

export function animalFrames(type: AnimalType): string[] {
  return ANIMAL_FRAMES[type] ?? [`${type.replace(/^animal_/, '')}/pose_0`];
}

/** Semente sem arte própria (desenhamos o ícone da cultura com uma marca de "semente"). */
export function isSeedFallback(id: ItemId, hasFrame: (f: string) => boolean): boolean {
  const item = ITEMS_BY_ID.get(id);
  return item?.kind === 'seed' && !hasFrame(item.spriteKey);
}
