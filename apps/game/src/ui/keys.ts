// Atalhos de teclado: I inventário, C cartas, L loja, Esc fecha. Puro, testável.

export type KeyAction = 'inventory' | 'cards' | 'shop' | 'close';

export const HOTKEYS: Record<string, KeyAction> = {
  i: 'inventory',
  c: 'cards',
  l: 'shop',
  escape: 'close',
};

export interface KeyInfo {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  /** tagName do alvo (INPUT, TEXTAREA…) */
  targetTag?: string;
  targetEditable?: boolean;
}

/** Qual ação a tecla dispara (null = deixa passar para o jogo). Digitação em campos é ignorada. */
export function keyAction(e: KeyInfo): KeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return null;
  const k = e.key.toLowerCase();
  const typing =
    e.targetEditable ||
    e.targetTag === 'INPUT' ||
    e.targetTag === 'TEXTAREA' ||
    e.targetTag === 'SELECT';
  if (typing && k !== 'escape') return null;
  return HOTKEYS[k] ?? null;
}
