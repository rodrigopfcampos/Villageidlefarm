// Regras puras da exploração (viagens de venda, docs/ECONOMIA.md). A mock usa estas funções;
// o SQL do servidor deve reproduzir a mesma lógica. Mesma conta de tools/balance/economia.py (trip()).

import { ITEMS_BY_ID, PROGRESSION } from '../catalog/index';
import { localTime } from './nightEvent';
import type {
  CargoEntry,
  DestinationDef,
  EpochMs,
  ItemDef,
  ItemId,
  TripOutcomeDef,
  VehicleDef,
} from '../types/models';

export interface OutcomeOdds {
  outcome: TripOutcomeDef;
  /** Chance efetiva (somam 1). */
  chance: number;
}

export interface OddsModifiers {
  /** Risco do veículo (multiplica os resultados ruins). */
  risk: number;
  /** Condição 0..100 (abaixo de 50, ruins ×1,5). */
  condition: number;
  /** Redução dos ruins por Céu limpo (0.5 = metade), já somada ao bônus do álbum. */
  clearSky?: number;
}

/** Condição abaixo disto deixa os resultados ruins ×1,5. */
export const LOW_CONDITION = 50;
export const LOW_CONDITION_BAD_MULT = 1.5;

/**
 * Chances efetivas de cada resultado: os ruins (mult < 1) são multiplicados por
 * risco × (1,5 se condição < 50) × (1 − Céu limpo); os bons dividem o resto na proporção da tabela.
 */
export function outcomeOdds(dest: DestinationDef, mod: OddsModifiers): OutcomeOdds[] {
  const badMult =
    mod.risk *
    (mod.condition < LOW_CONDITION ? LOW_CONDITION_BAD_MULT : 1) *
    (1 - Math.min(1, Math.max(0, mod.clearSky ?? 0)));
  const isBad = (o: TripOutcomeDef) => o.mult < 1;
  const badRaw = dest.outcomes.map((o) => (isBad(o) ? o.chance * badMult : 0));
  const badSum = badRaw.reduce((s, p) => s + p, 0);
  const scale = badSum > 1 ? 1 / badSum : 1;
  const good = 1 - badSum * scale;
  const goodBase = dest.outcomes.filter((o) => !isBad(o)).reduce((s, o) => s + o.chance, 0);
  return dest.outcomes.map((o, i) => ({
    outcome: o,
    chance: isBad(o) ? badRaw[i]! * scale : goodBase > 0 ? (o.chance / goodBase) * good : 0,
  }));
}

/** Sorteia o resultado. `u` em [0, 1). */
export function pickOutcome(odds: readonly OutcomeOdds[], u: number): TripOutcomeDef {
  let acc = 0;
  for (const o of odds) {
    acc += o.chance;
    if (u < acc) return o.outcome;
  }
  return odds[odds.length - 1]!.outcome;
}

/** Capacidade atual (valor de loja) = base × 1,25^melhorias, arredondada para baixo. */
export function vehicleCapacity(v: VehicleDef, upgrades: number): number {
  return Math.floor(v.capacity * v.upgradeCapacityMult ** Math.max(0, upgrades));
}

/** Custo para consertar até 100: ceil(pontos faltando × custo por ponto). */
export function repairCost(v: VehicleDef, condition: number): number {
  return Math.ceil(Math.max(0, 100 - condition) * v.repairCostPerPoint);
}

/** Duração da viagem em ms = horas do destino ÷ velocidade do veículo. */
export function tripDurationMs(dest: DestinationDef, v: VehicleDef): number {
  return Math.round((dest.hours / v.speed) * 3_600_000);
}

/** Viagens por dia: 2/3/4 nos níveis 1/20/35, +1 com VIP. */
export function tripsPerDay(level: number, vip: boolean): number {
  let trips = 0;
  for (const t of PROGRESSION.tripsPerDay) if (level >= t.level) trips = t.trips;
  return trips + (vip ? PROGRESSION.tripsPerDayVipBonus : 0);
}

/**
 * Valor de loja da carga (Σ sellPrice × qty). Lança se algum item não tiver preço de loja
 * (semente, carta) — o chamador converte em INVALID_INPUT/NOT_FOR_SALE.
 */
export function cargoValue(
  cargo: readonly CargoEntry[],
  items: ReadonlyMap<ItemId, ItemDef> = ITEMS_BY_ID,
): number {
  let total = 0;
  for (const c of cargo) {
    const price = items.get(c.itemId)?.sellPrice;
    if (price === null || price === undefined) throw new Error(`sem preço de loja: ${c.itemId}`);
    total += price * c.qty;
  }
  return total;
}

/**
 * Moedas pagas no collect. Perda total/roubo: valor × mult (0 / 50%). Venda (mult ≥ 1): o lucro
 * acima do preço da loja ganha +Exploração (0.5 = +50%).
 */
export function tripPayout(value: number, mult: number, explorationBonus = 0): number {
  if (mult <= 1) return Math.round(value * mult);
  return Math.round(value + value * (mult - 1) * (1 + Math.max(0, explorationBonus)));
}

/** Próxima meia-noite local (ms Unix) no fuso informado: quando as viagens do dia voltam. */
export function nextLocalMidnight(epochMs: EpochMs, tz: string): EpochMs {
  const { h, m, s } = localTime(epochMs, tz);
  const msOfSecond = ((epochMs % 1000) + 1000) % 1000;
  return epochMs + ((24 - h) * 3600 - m * 60 - s) * 1000 - msOfSecond;
}
