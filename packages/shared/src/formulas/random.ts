// Aleatório determinístico a partir de uma semente (ex.: request_id + slot).
// Repetir o mesmo pedido dá o mesmo resultado; útil na mock e nos testes.
// O servidor pode usar random() do Postgres: o resultado fica gravado no ledger de qualquer jeito.

/** Hash FNV-1a 32 bits. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mistura final (melhora a distribuição dos bits altos)
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Número em [0, 1) derivado da semente. */
export function unitFromSeed(seed: string): number {
  return hash32(seed) / 4_294_967_296;
}
