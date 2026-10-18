// Regras de HABILITAÇÃO de botões e números exibidos (puro, testável).
// Só PREVÊ o que o servidor vai dizer, para desabilitar botões e explicar o motivo.
// Quem decide é sempre o servidor: se a previsão errar, o erro volta pelo api:error.

import {
  ECONOMY,
  ITEMS_BY_ID,
  NIGHT_EVENT,
  localTime,
  xpForLevel,
  type ActiveBuff,
  type AnimalDef,
  type CardDef,
  type CropDef,
  type ErrorCode,
  type ExtractionQuota,
  type ItemDef,
  type NightEventState,
  type OfflineReport,
  type PlotSlotDef,
  type PlotState,
} from '@vif/shared';

export interface Check {
  ok: boolean;
  /** Código do motivo (mesmos códigos do servidor), quando bloqueado. */
  reason: ErrorCode | null;
}

const OK: Check = { ok: true, reason: null };
const no = (reason: ErrorCode): Check => ({ ok: false, reason });

/** Limita a quantidade a [min, max] e a inteiro. NaN vira min. */
export function clampQty(q: number, min: number, max: number): number {
  if (!Number.isFinite(q)) return min;
  return Math.min(Math.max(Math.floor(q), min), Math.max(min, max));
}

/** Preço de compra na loja NPC (inteiro). */
export function shopPrice(item: ItemDef, qty: number): number {
  return item.basePrice * qty;
}

// ---------- plantar ----------

export interface CropEconomy {
  seedPrice: number;
  sellValue: number;
  /** Lucro por colheita (venda média − semente). */
  profit: number;
  /** Lucro por hora de canteiro (arredondado). */
  profitPerHour: number;
}

export function cropEconomy(crop: CropDef): CropEconomy {
  const seed = ITEMS_BY_ID.get(crop.seedItemId);
  const yieldItem = ITEMS_BY_ID.get(crop.yieldItemId);
  const seedP = seed?.basePrice ?? 0;
  const avgYield = (crop.yieldMin + crop.yieldMax) / 2;
  const sellValue = Math.round((yieldItem?.sellPrice ?? 0) * avgYield);
  const profit = sellValue - seedP;
  const profitPerHour = Math.round(profit / (crop.growSeconds / 3600));
  return { seedPrice: seedP, sellValue, profit, profitPerHour };
}

/** Quantas culturas bloqueadas mostrar (as próximas); o resto vira "+N a partir do nível X". */
export const LOCKED_PREVIEW = 3;

/**
 * Culturas do catálogo para o painel Plantar: todas as liberadas (as mais novas primeiro, que
 * rendem mais) e só as próximas `LOCKED_PREVIEW` bloqueadas. O catálogo pode ter dezenas.
 */
export function plantableCrops(
  crops: readonly CropDef[],
  level: number,
  lockedPreview = LOCKED_PREVIEW,
): { visible: CropDef[]; hidden: CropDef[] } {
  const sorted = [...crops].sort(
    (a, b) => a.unlockLevel - b.unlockLevel || a.growSeconds - b.growSeconds,
  );
  const unlocked = sorted.filter((c) => c.unlockLevel <= level).reverse();
  const locked = sorted.filter((c) => c.unlockLevel > level);
  return {
    visible: [...unlocked, ...locked.slice(0, lockedPreview)],
    hidden: locked.slice(lockedPreview),
  };
}

export type PlantAction = 'plant' | 'buy-and-plant' | 'locked' | 'no-money';

export interface PlantOption extends Check {
  action: PlantAction;
  /** Moedas que serão gastas (0 se já tem a semente). */
  cost: number;
}

/**
 * O que o botão de uma cultura faz no painel Plantar:
 * nível baixo → bloqueado; tem semente → planta; senão compra 1 e planta (se tiver moedas).
 */
export function plantOption(
  crop: CropDef,
  ctx: { level: number; coins: number; seedQty: number },
): PlantOption {
  if (ctx.level < crop.unlockLevel) {
    return { action: 'locked', cost: 0, ok: false, reason: 'LEVEL_TOO_LOW' };
  }
  if (ctx.seedQty > 0) return { action: 'plant', cost: 0, ok: true, reason: null };
  const seed = ITEMS_BY_ID.get(crop.seedItemId);
  if (!seed || !seed.shopBuyable) {
    return { action: 'no-money', cost: 0, ok: false, reason: 'INSUFFICIENT_ITEMS' };
  }
  const cost = shopPrice(seed, 1);
  if (ctx.coins < cost)
    return { action: 'no-money', cost, ok: false, reason: 'INSUFFICIENT_FUNDS' };
  return { action: 'buy-and-plant', cost, ok: true, reason: null };
}

/** Canteiro pode receber semente? (mesma ordem do servidor: bloqueado → ocupado). */
export function plotAccepts(plot: PlotState | undefined): Check {
  if (!plot) return no('NOT_FOUND');
  if (!plot.unlocked) return no('SLOT_LOCKED');
  if (plot.cropId !== null) return no('SLOT_OCCUPIED');
  return OK;
}

// ---------- desbloquear canteiro ----------

export function unlockCheck(
  def: PlotSlotDef | undefined,
  plot: PlotState | undefined,
  level: number,
  coins: number,
): Check {
  if (!def || !plot) return no('NOT_FOUND');
  if (plot.unlocked) return no('ALREADY_UNLOCKED');
  if (level < def.unlockLevel) return no('LEVEL_TOO_LOW');
  if (coins < def.unlockCost) return no('INSUFFICIENT_FUNDS');
  return OK;
}

// ---------- loja ----------

export function buyCheck(
  item: ItemDef | undefined,
  qty: number,
  ctx: { coins: number; level: number; unlockLevel?: number },
): Check & { total: number } {
  if (!item) return { ...no('NOT_FOUND'), total: 0 };
  if (!item.shopBuyable) return { ...no('NOT_FOR_SALE'), total: 0 };
  if (!Number.isInteger(qty) || qty <= 0 || qty > ECONOMY.SHOP_MAX_QTY) {
    return { ...no('INVALID_INPUT'), total: 0 };
  }
  const total = shopPrice(item, qty);
  if (ctx.unlockLevel !== undefined && ctx.level < ctx.unlockLevel) {
    return { ...no('LEVEL_TOO_LOW'), total };
  }
  if (ctx.coins < total) return { ...no('INSUFFICIENT_FUNDS'), total };
  return { ...OK, total };
}

export function sellCheck(
  item: ItemDef | undefined,
  qty: number,
  have: number,
): Check & { total: number } {
  if (!item) return { ...no('NOT_FOUND'), total: 0 };
  if (item.sellPrice === null) return { ...no('NOT_FOR_SALE'), total: 0 };
  if (!Number.isInteger(qty) || qty <= 0 || qty > ECONOMY.SHOP_MAX_QTY) {
    return { ...no('INVALID_INPUT'), total: 0 };
  }
  const total = item.sellPrice * qty;
  if (have < qty) return { ...no('INSUFFICIENT_ITEMS'), total };
  return { ...OK, total };
}

export function animalBuyCheck(def: AnimalDef, coins: number, level: number): Check {
  if (level < def.unlockLevel) return no('LEVEL_TOO_LOW');
  if (coins < def.buyPrice) return no('INSUFFICIENT_FUNDS');
  return OK;
}

// ---------- cartas ----------

export function cardSlots(vip: boolean): number {
  return vip ? ECONOMY.CARD_SLOTS_VIP : ECONOMY.CARD_SLOTS;
}

/**
 * Pode ativar esta carta agora? Mesma ordem do servidor depois de achar a carta:
 * BUFF_ALREADY_ACTIVE → CARD_SLOT_FULL. Adubo (instantâneo) não ocupa vaga.
 * `active` = buffs ainda em vigor (store.currentBuffs()).
 */
export function cardActivateCheck(
  card: CardDef,
  active: readonly ActiveBuff[],
  vip: boolean,
): Check {
  if (card.durationSeconds <= 0) return OK;
  if (active.some((b) => b.buff === card.buff)) return no('BUFF_ALREADY_ACTIVE');
  if (active.length >= cardSlots(vip)) return no('CARD_SLOT_FULL');
  return OK;
}

/** Segundos (relógio da fazenda) que faltam para um buff acabar. */
export function buffRemaining(buff: ActiveBuff, farmClock: number): number {
  return Math.max(0, buff.endsFc - farmClock);
}

// ---------- retirada para a Steam ----------

export function extractionCheck(
  item: ItemDef | undefined,
  ctx: { have: number; level: number; quota: ExtractionQuota | null; steamUnavailable?: boolean },
): Check {
  if (ctx.steamUnavailable) return no('STEAM_UNAVAILABLE');
  if (!item) return no('NOT_FOUND');
  if (!item.steamExtractable) return no('NOT_EXTRACTABLE');
  if (ctx.level < ECONOMY.EXTRACTION_MIN_LEVEL) return no('LEVEL_TOO_LOW');
  if (ctx.quota && ctx.quota.used >= ctx.quota.limit) return no('EXTRACTION_QUOTA');
  if (ctx.have < 1) return no('INSUFFICIENT_ITEMS');
  return OK;
}

/** Segundos até abrir a próxima vaga de envio (0 se já há vaga). */
export function nextSlotSeconds(quota: ExtractionQuota | null, serverNow: number): number {
  if (!quota || quota.nextSlotAt === null || quota.used < quota.limit) return 0;
  return Math.max(0, (quota.nextSlotAt - serverNow) / 1000);
}

// ---------- evento noturno ----------

export interface NightEventView {
  active: boolean;
  /** Segundos até acabar (ativo) ou até começar (inativo). */
  seconds: number;
  /** 0..1 da presença necessária para a carta. */
  progress: number;
  claimable: boolean;
  claimed: boolean;
}

/** Segundos até a próxima 19:00 local (0 se já está no evento). */
export function secondsUntilEvent(serverNow: number, timeZone: string): number {
  const { h, m, s } = localTime(serverNow, timeZone);
  if (h >= NIGHT_EVENT.startHour && h < NIGHT_EVENT.endHour) return 0;
  const nowS = h * 3600 + m * 60 + s;
  const startS = NIGHT_EVENT.startHour * 3600;
  return (startS - nowS + 86_400) % 86_400;
}

export function nightEventView(
  ev: NightEventState | null,
  serverNow: number,
  timeZone: string,
): NightEventView {
  const required = ev?.requiredSeconds ?? NIGHT_EVENT.requiredSeconds;
  const attendance = ev?.attendanceSeconds ?? 0;
  const claimed = ev?.cardClaimed ?? false;
  const active = !!ev?.active && ev.endsAt !== null && ev.endsAt > serverNow;
  const seconds = active
    ? Math.max(0, ((ev?.endsAt ?? serverNow) - serverNow) / 1000)
    : secondsUntilEvent(serverNow, timeZone);
  return {
    active,
    seconds,
    progress: required > 0 ? Math.min(1, attendance / required) : 1,
    claimable: !claimed && attendance >= required,
    claimed,
  };
}

// ---------- offline ----------

/** Mostra a tela "enquanto você esteve fora" se ficou fora pelo menos 1 minuto. */
export function shouldShowOfflineReport(r: OfflineReport | null | undefined): boolean {
  return !!r && r.realSeconds >= 60;
}

// ---------- XP ----------

export interface XpView {
  level: number;
  into: number;
  span: number;
  progress: number;
}

/** Barra de XP do nível atual (o nível vem do servidor; aqui só a fração para desenhar). */
export function xpView(level: number, xp: number): XpView {
  const start = xpForLevel(level);
  const end = xpForLevel(level + 1);
  const span = Math.max(1, end - start);
  const into = Math.min(span, Math.max(0, xp - start));
  return { level, into, span, progress: into / span };
}
