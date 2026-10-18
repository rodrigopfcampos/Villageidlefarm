// Catálogo: fonte única de balanceamento (vira seed do banco via tools/seed).
// Edite os JSON; `validateCatalog()` (rodado nos testes) confere as referências e os inteiros.

import itemsJson from './items.json';
import cropsJson from './crops.json';
import animalsJson from './animals.json';
import type { AnimalDef, AnimalType, CropDef, CropId, ItemDef, ItemId } from '../types/models';

export const ITEMS = itemsJson as unknown as readonly ItemDef[];
export const CROPS = cropsJson as unknown as readonly CropDef[];
export const ANIMALS = animalsJson as unknown as readonly AnimalDef[];

export const ITEMS_BY_ID: ReadonlyMap<ItemId, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));
export const CROPS_BY_ID: ReadonlyMap<CropId, CropDef> = new Map(CROPS.map((c) => [c.cropId, c]));
export const CROPS_BY_SEED: ReadonlyMap<ItemId, CropDef> = new Map(
  CROPS.map((c) => [c.seedItemId, c]),
);
export const ANIMALS_BY_TYPE: ReadonlyMap<AnimalType, AnimalDef> = new Map(
  ANIMALS.map((a) => [a.animalType, a]),
);

/** O que toda conta nova recebe (gatilho de cadastro no servidor e mock). */
export const STARTER_KIT = {
  coins: 100,
  gems: 0,
  items: [{ itemId: 'seed_carrot', qty: 5 }],
} as const;

export interface Catalog {
  items: readonly ItemDef[];
  crops: readonly CropDef[];
  animals: readonly AnimalDef[];
}

export const CATALOG: Catalog = { items: ITEMS, crops: CROPS, animals: ANIMALS };

const isNonNegInt = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;
const isPosInt = (n: unknown): boolean => Number.isInteger(n) && (n as number) > 0;

/** Lista de problemas do catálogo (vazia = ok). */
export function validateCatalog(c: Catalog = CATALOG): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const i of c.items) {
    if (ids.has(i.id)) errs.push(`item repetido: ${i.id}`);
    ids.add(i.id);
    if (!isNonNegInt(i.basePrice)) errs.push(`${i.id}: basePrice não inteiro`);
    if (i.sellPrice !== null && !isNonNegInt(i.sellPrice)) errs.push(`${i.id}: sellPrice`);
    if (!isNonNegInt(i.minPrice) || !isNonNegInt(i.maxPrice) || i.minPrice > i.maxPrice) {
      errs.push(`${i.id}: minPrice/maxPrice`);
    }
    if (i.shopBuyable && i.sellPrice !== null && i.sellPrice > i.basePrice) {
      errs.push(`${i.id}: loja pagaria mais do que cobra (moeda infinita)`);
    }
  }
  for (const cr of c.crops) {
    if (!ids.has(cr.seedItemId)) errs.push(`${cr.cropId}: semente ${cr.seedItemId} não existe`);
    if (!ids.has(cr.yieldItemId)) errs.push(`${cr.cropId}: produto ${cr.yieldItemId} não existe`);
    if (!isPosInt(cr.growSeconds)) errs.push(`${cr.cropId}: growSeconds`);
    if (!isPosInt(cr.yieldMin) || !isPosInt(cr.yieldMax) || cr.yieldMin > cr.yieldMax) {
      errs.push(`${cr.cropId}: yieldMin/yieldMax`);
    }
    if (!isNonNegInt(cr.xp) || !isPosInt(cr.unlockLevel)) errs.push(`${cr.cropId}: xp/unlockLevel`);
  }
  for (const a of c.animals) {
    if (!ids.has(a.productItemId)) errs.push(`${a.animalType}: produto não existe`);
    if (!isPosInt(a.buyPrice) || !isPosInt(a.produceSeconds) || !isPosInt(a.maxStock)) {
      errs.push(`${a.animalType}: buyPrice/produceSeconds/maxStock`);
    }
  }
  return errs;
}
