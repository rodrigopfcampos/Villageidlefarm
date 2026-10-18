// Contexto da interface: serviços do jogo, painel aberto, estado do mundo e ações comuns.

import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type {
  ClientEventName,
  ItemId,
  MutationResult,
  PlotSlotId,
  ToastKind,
  WorldState,
} from '@vif/shared';
import { bus } from '../core/bus';
import type { Services } from '../core/services';
import { onAtlasChange } from './atlas';

/** Painéis da interface. 'plant'/'unlock' vêm do clique no canteiro (A3). */
export type UiPanelId =
  | 'inventory'
  | 'shop'
  | 'cards'
  | 'album'
  | 'extraction'
  | 'plant'
  | 'unlock'
  | 'offline-report';

export interface OpenPanel {
  id: UiPanelId;
  slotId?: PlotSlotId;
  itemId?: ItemId;
}

export interface UiApi {
  s: Services;
  panel: OpenPanel | null;
  open(p: OpenPanel): void;
  toggle(id: UiPanelId): void;
  close(): void;
  world: WorldState | null;
  refreshWorld(): void;
  /** A última tentativa de falar com a Steam deu STEAM_UNAVAILABLE. */
  steamUnavailable: boolean;
  toast(kind: ToastKind, text: string): void;
  /** Chama uma mutação; aplica o resultado no store. Erros viram api:error (toast). */
  mutate<T extends MutationResult>(op: string, call: () => Promise<T>): Promise<T | null>;
}

export const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('useUi fora do UiContext');
  return ui;
}

/** Re-renderiza o componente quando algum destes eventos do bus acontece. */
export function useBus(names: readonly ClientEventName[]): void {
  const [, setV] = useState(0);
  const key = names.join('|');
  useEffect(() => {
    const offs = names.map((n) => bus.on(n, () => setV((v) => v + 1)));
    return () => offs.forEach((off) => off());
  }, [key]); // a lista de nomes é estável pela chave
}

/** Re-renderiza quando um atlas termina de carregar. */
export function useAtlas(): void {
  const [, setV] = useState(0);
  useEffect(() => onAtlasChange(() => setV((v) => v + 1)), []);
}

/** Altura da janela (re-renderiza ao redimensionar). */
export function useWindowHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 1080 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}
