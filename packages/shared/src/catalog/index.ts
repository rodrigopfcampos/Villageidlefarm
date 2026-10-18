// Catálogo: fonte única de balanceamento (vira seed do banco via tools/seed).
// Edite os JSON; `validateCatalog()` (rodado nos testes) confere as referências e os inteiros.
// Culturas: tabela de docs/BALANCEAMENTO.md (margem 50%, lucro/h cai com a duração).

import itemsJson from './items.json';
import cropsJson from './crops.json';
import animalsJson from './animals.json';
import cardsJson from './cards.json';
import {
  BUFF_KINDS,
  RARITIES,
  type AnimalDef,
  type AnimalType,
  type BuffDef,
  type BuffKind,
  type CardDef,
  type CropDef,
  type CropId,
  type ItemDef,
  type ItemId,
  type Rarity,
} from '../types/models';

export interface CardsConfig {
  /** O mapeamento arte ↔ buff ainda é PROVISÓRIO (DECISOES.md). */
  provisionalArtMapping: boolean;
  /** Chance de carta por hora de cultivo de 1 canteiro (0.0125 = 1,25%). */
  dropChancePerPlotHour: number;
  rarityWeights: Record<Rarity, number>;
  durationSeconds: Record<Rarity, number>;
  album: { slots: number; lineBonusPercent: number };
  buffs: BuffDef[];
  cards: CardDef[];
}

export const CARDS_CONFIG = cardsJson as unknown as CardsConfig;
export const CARDS = CARDS_CONFIG.cards as readonly CardDef[];
export const BUFFS = CARDS_CONFIG.buffs as readonly BuffDef[];

/** Cada carta também é um item (kind "card"): a carta usada = 1 cópia no álbum, pode ir à Steam. */
const CARD_ITEMS: ItemDef[] = CARDS.map((c) => ({
  id: c.id,
  kind: 'card',
  rarity: c.rarity,
  basePrice: 0,
  sellPrice: null,
  shopBuyable: false,
  stackable: true,
  steamExtractable: true,
  spriteKey: c.artKey,
}));

export const ITEMS = [
  ...(itemsJson as unknown as readonly ItemDef[]),
  ...CARD_ITEMS,
] as readonly ItemDef[];
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
export const CARDS_BY_ID: ReadonlyMap<ItemId, CardDef> = new Map(CARDS.map((c) => [c.id, c]));
export const BUFFS_BY_KIND: ReadonlyMap<BuffKind, BuffDef> = new Map(BUFFS.map((b) => [b.kind, b]));

export const cardId = (buff: BuffKind, rarity: Rarity): ItemId => `card_${buff}_${rarity}`;

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
  cards: CardsConfig;
}

export const CATALOG: Catalog = {
  items: ITEMS,
  crops: CROPS,
  animals: ANIMALS,
  cards: CARDS_CONFIG,
};

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
    if (i.shopBuyable && i.sellPrice !== null && i.sellPrice > i.basePrice) {
      errs.push(`${i.id}: loja pagaria mais do que cobra (moeda infinita)`);
    }
    if ((i.kind === 'seed' || i.kind === 'currency') && i.steamExtractable) {
      errs.push(`${i.id}: sementes e moedas não podem sair para a Steam`);
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
  // cartas: 8 buffs × 5 raridades, ids coerentes, pesos somando 100
  const cfg = c.cards;
  const seen = new Set<string>();
  for (const card of cfg.cards) {
    if (card.id !== cardId(card.buff, card.rarity)) errs.push(`${card.id}: id fora do padrão`);
    if (seen.has(card.id)) errs.push(`${card.id}: carta repetida`);
    seen.add(card.id);
    const buff = cfg.buffs.find((b) => b.kind === card.buff);
    if (!buff) errs.push(`${card.id}: buff ${card.buff} não existe`);
    else if (!buff.instant && card.durationSeconds !== cfg.durationSeconds[card.rarity]) {
      errs.push(`${card.id}: duração diferente da tabela por raridade`);
    }
    if (!(card.magnitude > 0)) errs.push(`${card.id}: magnitude`);
  }
  for (const b of BUFF_KINDS) {
    for (const r of RARITIES) if (!seen.has(cardId(b, r))) errs.push(`falta ${cardId(b, r)}`);
  }
  if (cfg.cards.length !== cfg.album.slots) errs.push('álbum: slots ≠ número de cartas');
  const totalWeight = RARITIES.reduce((s, r) => s + (cfg.rarityWeights[r] ?? 0), 0);
  if (totalWeight !== 100) errs.push(`pesos de raridade somam ${totalWeight}, esperado 100`);
  return errs;
}
