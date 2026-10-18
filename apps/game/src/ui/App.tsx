// Raiz da interface DOM: espera o bootstrap, liga o bus (painéis, toasts, erros) e os atalhos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CARDS_BY_ID,
  type MutationResult,
  type PanelId,
  type ToastKind,
  type WorldState,
} from '@vif/shared';
import { bus } from '../core/bus';
import { getServices, run, type Services } from '../core/services';
import { UiContext, type OpenPanel, type UiApi, type UiPanelId } from './context';
import { Hud, Toolbar } from './Hud';
import { keyAction } from './keys';
import { CardsPanel } from './panels/CardsPanel';
import { ExtractionPanel } from './panels/ExtractionPanel';
import { InventoryPanel } from './panels/InventoryPanel';
import { OfflineReportPanel } from './panels/OfflineReport';
import { PlantPanel, UnlockPanel } from './panels/PlotPanels';
import { ShopPanel } from './panels/ShopPanel';
import { shouldShowOfflineReport } from './rules';
import { STR, cardName, errorMessage } from './strings';
import { Toasts, TOAST_MS, pushToast, type ToastItem } from './Toasts';

const WORLD_POLL_MS = 30_000;
/** Ops de fundo: erro de limite não vira toast (o heartbeat tenta de novo sozinho). */
const QUIET_ERRORS: Record<string, string[]> = { heartbeat: ['RATE_LIMITED'] };
const STEAM_OPS = new Set(['extractionRequest', 'steamReturnSync']);

function tryServices(): Services | null {
  try {
    const s = getServices();
    return s.store.ready ? s : null;
  } catch {
    return null;
  }
}

/** Converte o payload do ui:open-panel (inclui 'plant'/'unlock' do A3) num painel da interface. */
export function panelFromEvent(payload: {
  panel: PanelId | string;
  params?: Record<string, unknown>;
  slotId?: unknown;
}): OpenPanel | null {
  const slotRaw = payload.slotId ?? payload.params?.slotId;
  const slotId = typeof slotRaw === 'string' ? slotRaw : undefined;
  const itemRaw = payload.params?.itemId;
  const itemId = typeof itemRaw === 'string' ? itemRaw : undefined;
  switch (payload.panel) {
    case 'plant':
    case 'unlock':
      return slotId ? { id: payload.panel, slotId } : null;
    case 'inventory':
    case 'shop':
    case 'cards':
    case 'album':
    case 'extraction':
    case 'offline-report':
      return { id: payload.panel, itemId };
    default:
      return null; // social/settings: outros agentes
  }
}

export function App() {
  const [services, setServices] = useState<Services | null>(tryServices);
  useEffect(() => {
    const off = bus.on('farm:snapshot', () => setServices(tryServices()));
    return off;
  }, []);
  if (!services) return null;
  return <Root s={services} />;
}

function Root({ s }: { s: Services }) {
  const [panel, setPanel] = useState<OpenPanel | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [steamUnavailable, setSteamUnavailable] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(1);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = toastId.current++;
    setToasts((l) => pushToast(l, { id, kind, text }));
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  const refreshWorld = useCallback(() => {
    void s.api.getWorldState().then(setWorld, () => undefined);
  }, [s]);

  const open = useCallback((p: OpenPanel) => setPanel(p), []);
  const close = useCallback(() => setPanel(null), []);
  const toggle = useCallback(
    (id: UiPanelId) => setPanel((cur) => (cur?.id === id ? null : { id })),
    [],
  );

  const mutate = useCallback(
    async <T extends MutationResult>(op: string, call: () => Promise<T>): Promise<T | null> => {
      const r = await run(op, call);
      if (r) {
        s.store.apply(r);
        if (STEAM_OPS.has(op)) setSteamUnavailable(false);
        // A presença no evento é medida nas mutações: atualiza o indicador.
        if (world?.nightEvent.active) refreshWorld();
      }
      return r;
    },
    [s, world, refreshWorld],
  );

  // Bus → toasts, painéis e estado.
  useEffect(() => {
    const offs = [
      bus.on('api:error', ({ error, op }) => {
        if (QUIET_ERRORS[op]?.includes(error.code)) return;
        if (error.code === 'STEAM_UNAVAILABLE') setSteamUnavailable(true);
        const kind: ToastKind = error.code === 'DUPLICATE_REQUEST' ? 'info' : 'error';
        toast(kind, errorMessage(error.code));
      }),
      bus.on('ui:toast', ({ kind, text }) => toast(kind, text)),
      bus.on('ui:open-panel', (payload) => {
        const p = panelFromEvent(payload);
        if (p) setPanel(p);
      }),
      bus.on('cards:changed', ({ dropped }) => {
        for (const c of dropped) {
          const def = CARDS_BY_ID.get(c.cardId);
          if (def && c.source !== 'night_event') toast('success', STR.cards.newCard(cardName(def.buff, def.rarity)));
        }
      }),
      bus.on('xp:changed', ({ leveledUp, level }) => {
        if (leveledUp) toast('success', STR.levelUp(level));
      }),
      bus.on('event:night-start', () => {
        toast('info', STR.eventStart);
        refreshWorld();
      }),
      bus.on('event:night-end', () => {
        toast('info', STR.eventEnd);
        refreshWorld();
      }),
      bus.on('farm:snapshot', (b) => {
        refreshWorld();
        if (shouldShowOfflineReport(b.offlineReport) && !panelRef.current) {
          setPanel({ id: 'offline-report' });
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [toast, refreshWorld]);

  // Estado do mundo (evento noturno, fuso): ao abrir e a cada 30 s.
  useEffect(() => {
    refreshWorld();
    if (shouldShowOfflineReport(s.store.offlineReport)) setPanel({ id: 'offline-report' });
    const t = setInterval(refreshWorld, WORLD_POLL_MS);
    return () => clearInterval(t);
  }, [s, refreshWorld]);

  // Atalhos: I, C, L, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = keyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        repeat: e.repeat,
        targetTag: target?.tagName,
        targetEditable: target?.isContentEditable,
      });
      if (!action) return;
      if (action === 'close') {
        if (panelRef.current) {
          e.preventDefault();
          setPanel(null);
        }
        return;
      }
      e.preventDefault();
      setPanel((cur) => (cur?.id === action ? null : { id: action }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const api = useMemo<UiApi>(
    () => ({ s, panel, open, toggle, close, world, refreshWorld, steamUnavailable, toast, mutate }),
    [s, panel, open, toggle, close, world, refreshWorld, steamUnavailable, toast, mutate],
  );

  return (
    <UiContext.Provider value={api}>
      <div class="vif-layer">
        <Hud />
        <Toolbar />
        {panel && <PanelView p={panel} />}
        <Toasts items={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
      </div>
    </UiContext.Provider>
  );
}

function PanelView({ p }: { p: OpenPanel }) {
  switch (p.id) {
    case 'inventory':
      return <InventoryPanel initialItem={p.itemId} />;
    case 'shop':
      return <ShopPanel />;
    case 'cards':
      return <CardsPanel initialTab="cards" />;
    case 'album':
      return <CardsPanel initialTab="album" />;
    case 'extraction':
      return <ExtractionPanel initialItem={p.itemId} />;
    case 'plant':
      return p.slotId ? <PlantPanel slotId={p.slotId} /> : null;
    case 'unlock':
      return p.slotId ? <UnlockPanel slotId={p.slotId} /> : null;
    case 'offline-report':
      return <OfflineReportPanel />;
  }
}
