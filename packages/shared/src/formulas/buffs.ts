// Regras puras de cartas/buffs/álbum. A mock usa estas funções; o SQL deve reproduzir a mesma lógica.
// Princípio (BALANCEAMENTO.md): o efeito vale só para o que é PRODUZIDO dentro da janela da carta.

import { CARDS, CARDS_CONFIG } from '../catalog/index';
import {
  BUFF_KINDS,
  RARITIES,
  type Album,
  type BuffKind,
  type FarmClockSeconds,
  type ItemId,
  type Rarity,
} from '../types/models';

/** Janela de um buff no relógio da fazenda (inclui buffs já expirados, para colheitas longas). */
export interface BuffWindow {
  buff: BuffKind;
  magnitude: number;
  startedFc: FarmClockSeconds;
  endsFc: FarmClockSeconds;
}

export function overlapSeconds(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Bônus efetivo de um buff sobre uma produção que ocorreu em [start, end] (farm clock):
 * soma de magnitude × (parte da produção dentro de cada janela). Ex.: Ouro +50% ativo na
 * última 1 h de uma melancia de 8 h → 0.5 × 1/8 = 0.0625.
 */
export function proratedBonus(
  windows: readonly BuffWindow[],
  buff: BuffKind,
  start: FarmClockSeconds,
  end: FarmClockSeconds,
): number {
  const total = end - start;
  if (total <= 0) return 0;
  let bonus = 0;
  for (const w of windows) {
    if (w.buff !== buff) continue;
    bonus += (w.magnitude * overlapSeconds(start, end, w.startedFc, w.endsFc)) / total;
  }
  return bonus;
}

/** Buff em vigor no instante `fc` (soma das magnitudes; para efeitos instantâneos como Mercador). */
export function activeMagnitude(
  windows: readonly BuffWindow[],
  buff: BuffKind,
  fc: FarmClockSeconds,
): number {
  return windows
    .filter((w) => w.buff === buff && w.startedFc <= fc && fc < w.endsFc)
    .reduce((s, w) => s + w.magnitude, 0);
}

/** Arredondamento estocástico: 2.3 vira 2 (70%) ou 3 (30%). `u` em [0, 1). Mantém a média exata. */
export function stochasticRound(x: number, u: number): number {
  const base = Math.floor(x);
  return base + (u < x - base ? 1 : 0);
}

/**
 * Chance de carta numa colheita: 1,25% por hora-canteiro de cultivo NOMINAL (growSeconds),
 * multiplicada por (1 + Sorte prorrateada + bônus do álbum). Limitada a 1.
 */
export function cardDropChance(growSeconds: number, luckBonus: number): number {
  const base = (growSeconds / 3600) * CARDS_CONFIG.dropChancePerPlotHour;
  return Math.min(1, base * (1 + Math.max(0, luckBonus)));
}

/** Sorteia a raridade pelos pesos (55/27/12/5/1). `u` em [0, 1). */
export function rollRarity(u: number, weights = CARDS_CONFIG.rarityWeights): Rarity {
  const total = RARITIES.reduce((s, r) => s + weights[r], 0);
  let x = u * total;
  for (const r of RARITIES) {
    x -= weights[r];
    if (x < 0) return r;
  }
  return 'common';
}

/** Sorteia o buff (uniforme entre os 8). `u` em [0, 1). */
export function rollBuff(u: number): BuffKind {
  return BUFF_KINDS[Math.min(BUFF_KINDS.length - 1, Math.floor(u * BUFF_KINDS.length))]!;
}

/** Monta o álbum a partir da quantidade de cada item de carta usada no inventário. */
export function buildAlbum(qty: (itemId: ItemId) => number): Album {
  const slots = CARDS.map((c) => ({
    cardId: c.id,
    buff: c.buff,
    rarity: c.rarity,
    copies: Math.max(0, qty(c.id)),
  }));
  const completedLines = BUFF_KINDS.filter((b) =>
    slots.filter((s) => s.buff === b).every((s) => s.copies > 0),
  );
  const bonusPercent: Album['bonusPercent'] = {};
  for (const b of completedLines) bonusPercent[b] = CARDS_CONFIG.album.lineBonusPercent;
  return { slots, completedLines, bonusPercent };
}

/** Bônus permanente do álbum como fração (0.02 = +2%) para um buff. */
export function albumBonus(album: Album, buff: BuffKind): number {
  return (album.bonusPercent[buff] ?? 0) / 100;
}
