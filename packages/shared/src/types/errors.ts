// Códigos de erro do servidor. O SQL lança com `raise exception '<CODE>'`;
// a API real converte para ApiError com o mesmo `code`.

export const ERROR_CODES = [
  // --- lista da seção 6 do plano ---
  'NOT_AUTHENTICATED',
  'NOT_OWNER',
  'NOT_READY',
  'SLOT_LOCKED',
  'SLOT_OCCUPIED',
  'INSUFFICIENT_FUNDS',
  'INSUFFICIENT_ITEMS',
  'NOT_TRADABLE',
  'PRICE_OUT_OF_RANGE',
  'LISTING_GONE',
  'LISTING_LIMIT',
  'OWN_LISTING',
  'RATE_LIMITED',
  'INVALID_TZ',
  'TZ_CHANGE_TOO_SOON',
  'EVENT_NOT_ACTIVE',
  'ALREADY_CLAIMED',
  'VISIT_LIMIT',
  'DUPLICATE_REQUEST',
  // --- acrescentados pela Fundação (A0) ---
  /** Canteiro vazio ao colher. */
  'SLOT_EMPTY',
  /** Canteiro/lote já liberado. */
  'ALREADY_UNLOCKED',
  /** Nível do jogador abaixo do exigido. */
  'LEVEL_TOO_LOW',
  /** A loja NPC não vende (ou não compra) este item. */
  'NOT_FOR_SALE',
  /** Id inexistente (slot, item, animal, anúncio, jogador). */
  'NOT_FOUND',
  /** Parâmetro inválido (quantidade não inteira, <= 0, acima do limite, item do tipo errado…). */
  'INVALID_INPUT',
  /** Animal ainda sem produção para coletar. */
  'NOTHING_TO_COLLECT',
  /** Recurso ainda não implementado (só cliente/mock). */
  'NOT_IMPLEMENTED',
  /** Falha de rede (só cliente). */
  'NETWORK_ERROR',
  /** Qualquer erro não mapeado. */
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Erro padronizado de qualquer chamada IApi. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * Converte qualquer erro (ex.: mensagem do Postgres "NOT_READY" ou "ERROR: NOT_READY") em ApiError.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  for (const m of msg.matchAll(/\b[A-Z][A-Z_]{2,}\b/g)) {
    if (isErrorCode(m[0])) return new ApiError(m[0], msg);
  }
  return new ApiError('UNKNOWN', msg || 'Erro desconhecido');
}

/** Mensagens curtas em português para a interface (A5 pode refinar). */
export const ERROR_MESSAGES_PT: Record<ErrorCode, string> = {
  NOT_AUTHENTICATED: 'Você precisa entrar de novo.',
  NOT_OWNER: 'Isso não é seu.',
  NOT_READY: 'Ainda não está pronto.',
  SLOT_LOCKED: 'Canteiro bloqueado.',
  SLOT_OCCUPIED: 'O canteiro já está ocupado.',
  INSUFFICIENT_FUNDS: 'Moedas insuficientes.',
  INSUFFICIENT_ITEMS: 'Itens insuficientes.',
  NOT_TRADABLE: 'Este item não pode ser negociado.',
  PRICE_OUT_OF_RANGE: 'Preço fora do permitido.',
  LISTING_GONE: 'O anúncio não está mais disponível.',
  LISTING_LIMIT: 'Limite de anúncios atingido.',
  OWN_LISTING: 'Você não pode comprar o próprio anúncio.',
  RATE_LIMITED: 'Muitas ações seguidas. Espere um pouco.',
  INVALID_TZ: 'Fuso horário inválido.',
  TZ_CHANGE_TOO_SOON: 'O fuso só pode ser trocado a cada 30 dias.',
  EVENT_NOT_ACTIVE: 'O evento não está ativo agora.',
  ALREADY_CLAIMED: 'Você já resgatou hoje.',
  VISIT_LIMIT: 'Você já interagiu com esta fazenda hoje.',
  DUPLICATE_REQUEST: 'Essa ação já foi feita.',
  SLOT_EMPTY: 'O canteiro está vazio.',
  ALREADY_UNLOCKED: 'Já está liberado.',
  LEVEL_TOO_LOW: 'Nível insuficiente.',
  NOT_FOR_SALE: 'A loja não negocia este item.',
  NOT_FOUND: 'Não encontrado.',
  INVALID_INPUT: 'Pedido inválido.',
  NOTHING_TO_COLLECT: 'Nada para coletar ainda.',
  NOT_IMPLEMENTED: 'Ainda não disponível.',
  NETWORK_ERROR: 'Sem conexão. Tente de novo.',
  UNKNOWN: 'Algo deu errado.',
};
