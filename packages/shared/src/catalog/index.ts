// Catálogo: fonte única de balanceamento (vira seed do banco via tools/seed).
// GERADO por tools/balance/gen_catalog.py a partir de tools/balance/economia.py (docs/ECONOMIA.md):
// não edite os JSON à mão. `validateCatalog()` (rodado nos testes) confere referências e inteiros.

import itemsJson from './items.json';
import cropsJson from './crops.json';
import animalsJson from './animals.json';
import cardsJson from './cards.json';
import progressionJson from './progression.json';
import vehiclesJson from './vehicles.json';
import destinationsJson from './destinations.json';
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
  type DestinationDef,
  type DestinationId,
  type ItemDef,
  type ItemId,
  type PlotSlotDef,
  type Rarity,
  type VehicleDef,
  type VehicleId,
} from '../types/models';

export interface CardsConfig {
  /** Mapeamento arte ↔ buff confirmado em ECONOMIA.md (false = definitivo). */
  provisionalArtMapping: boolean;
  /** Chance de carta por hora de cultivo de 1 canteiro (0.0125 = 1,25%). */
  dropChancePerPlotHour: number;
  rarityWeights: Record<Rarity, number>;
  durationSeconds: Record<Rarity, number>;
  album: { slots: number; lineBonusPercent: number };
  buffs: BuffDef[];
  cards: CardDef[];
}

export interface PlotProgression {
  /** Posição do canteiro na ordem do layout (0 = primeiro). */
  index: number;
  unlockLevel: number;
  /** 0 para os 4 iniciais; depois `150 × 1,32^(n−4)` arredondado à dezena. */
  unlockCost: number;
  startsUnlocked: boolean;
}

export interface ProgressionConfig {
  /** Nível máximo do lançamento (40). */
  maxLevel: number;
  /** Níveis reservados para conteúdo futuro (até 50). */
  reservedMaxLevel: number;
  /** xpToNext[L-1] = XP para ir do nível L ao L+1 = round(100 × 1,06^L × L^1,6). */
  xpToNext: number[];
  plots: PlotProgression[];
  explorationUnlockLevel: number;
  tripsPerDay: { level: number; trips: number }[];
  tripsPerDayVipBonus: number;
}

export const CARDS_CONFIG = cardsJson as unknown as CardsConfig;
export const CARDS = CARDS_CONFIG.cards as readonly CardDef[];
export const BUFFS = CARDS_CONFIG.buffs as readonly BuffDef[];
export const PROGRESSION = progressionJson as unknown as ProgressionConfig;
export const VEHICLES = vehiclesJson as unknown as readonly VehicleDef[];
export const DESTINATIONS = destinationsJson as unknown as readonly DestinationDef[];

/** Cada carta também é um item (kind "card"): a cópia de uma carta usada pode ir à Steam. */
const CARD_ITEMS: ItemDef[] = CARDS.map((c) => ({
  id: c.id,
  kind: 'card',
  name: `Carta ${c.name}`,
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
export const VEHICLES_BY_ID: ReadonlyMap<VehicleId, VehicleDef> = new Map(
  VEHICLES.map((v) => [v.id, v]),
);
export const DESTINATIONS_BY_ID: ReadonlyMap<DestinationId, DestinationDef> = new Map(
  DESTINATIONS.map((d) => [d.id, d]),
);

export const cardId = (buff: BuffKind, rarity: Rarity): ItemId => `card_${buff}_${rarity}`;

/** Nome exibido de um item (pt-BR); cai no id se não existir. */
export const itemName = (id: ItemId): string => ITEMS_BY_ID.get(id)?.name ?? id;

/** O que toda conta nova recebe (gatilho de cadastro no servidor e mock). */
export const STARTER_KIT = {
  coins: 100,
  gems: 0,
  items: [{ itemId: 'seed_carrot', qty: 5 }],
} as const;

/**
 * Aplica a progressão de canteiros (nível e custo por posição) aos canteiros do layout, na ordem
 * do layout. O layout do Tiled só define POSIÇÃO e `slotId`; nível e custo vêm do catálogo.
 * Canteiros além da tabela ficam no último nível/custo da tabela.
 */
export function withPlotProgression(slots: readonly PlotSlotDef[]): PlotSlotDef[] {
  const table = PROGRESSION.plots;
  return slots.map((s, i) => {
    const p = table[Math.min(i, table.length - 1)]!;
    return {
      slotId: s.slotId,
      unlockLevel: p.unlockLevel,
      unlockCost: p.unlockCost,
      startsUnlocked: p.startsUnlocked,
    };
  });
}

/** 20 canteiros "plot_01".."plot_20" com a progressão do catálogo (mock e testes). */
export const DEFAULT_PLOT_SLOTS: readonly PlotSlotDef[] = withPlotProgression(
  PROGRESSION.plots.map((p) => ({
    slotId: `plot_${String(p.index + 1).padStart(2, '0')}`,
    unlockCost: 0,
    unlockLevel: 1,
    startsUnlocked: false,
  })),
);

export interface Catalog {
  items: readonly ItemDef[];
  crops: readonly CropDef[];
  animals: readonly AnimalDef[];
  cards: CardsConfig;
  vehicles?: readonly VehicleDef[];
  destinations?: readonly DestinationDef[];
}

export const CATALOG: Catalog = {
  items: ITEMS,
  crops: CROPS,
  animals: ANIMALS,
  cards: CARDS_CONFIG,
  vehicles: VEHICLES,
  destinations: DESTINATIONS,
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
    if (!i.name) errs.push(`${i.id}: sem nome`);
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
  // exploração
  for (const v of c.vehicles ?? []) {
    if (!isNonNegInt(v.price) || !isPosInt(v.capacity) || !isPosInt(v.tripCost)) {
      errs.push(`${v.id}: preço/capacidade/custo`);
    }
    if (v.upgradeCosts.length !== v.maxUpgrades || !v.upgradeCosts.every(isPosInt)) {
      errs.push(`${v.id}: upgradeCosts`);
    }
  }
  for (const d of c.destinations ?? []) {
    const total = d.outcomes.reduce((s, o) => s + o.chance, 0);
    if (Math.abs(total - 1) > 1e-9) errs.push(`${d.id}: chances somam ${total}`);
  }
  return errs;
}
