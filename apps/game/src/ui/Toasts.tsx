// Mensagens curtas no topo da tela (erros da API com texto amigável, sucesso, avisos).

import type { ToastKind } from '@vif/shared';
import { Glyph } from './components';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export const TOAST_MS = 3800;
export const TOAST_MAX = 4;

/** Acrescenta um toast (sem repetir o mesmo texto que já está na tela). Puro, testável. */
export function pushToast(
  list: readonly ToastItem[],
  next: ToastItem,
  max = TOAST_MAX,
): ToastItem[] {
  if (list.some((t) => t.text === next.text && t.kind === next.kind)) return [...list];
  return [...list, next].slice(-max);
}

const GLYPH: Record<ToastKind, string> = {
  info: 'arrow',
  success: 'check',
  warning: 'warn',
  error: 'warn',
};

export function Toasts({
  items,
  onDismiss,
}: {
  items: readonly ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div class="vif-toasts" aria-live="polite">
      {items.map((t) => (
        <button
          type="button"
          key={t.id}
          class={`vif-toast vif-toast--${t.kind}`}
          onClick={() => onDismiss(t.id)}
        >
          <Glyph name={GLYPH[t.kind]} />
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
