// Retirada para a Steam: cota (usado/limite, próxima vaga), escolher item, confirmar (1 unidade),
// histórico com status. Aviso "Steam ainda não conectada" quando vem STEAM_UNAVAILABLE.

import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  CARDS_BY_ID,
  ECONOMY,
  ITEMS_BY_ID,
  type Extraction,
  type ExtractionQuota,
  type ItemId,
} from '@vif/shared';
import { bus } from '../../core/bus';
import { newRequestId } from '../../core/ids';
import { Button, Glyph, ItemIcon, Panel } from '../components';
import { useBus, useUi } from '../context';
import { formatCountdown, formatDateTime, formatInt } from '../format';
import { extractionCheck, nextSlotSeconds } from '../rules';
import { STR, errorMessage, itemName } from '../strings';
import { sortedInventory } from './InventoryPanel';

export function ExtractionPanel({ initialItem }: { initialItem?: ItemId }) {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['inventory:changed', 'time:tick', 'xp:changed', 'farm:snapshot']);
  const [quota, setQuota] = useState<ExtractionQuota | null>(null);
  const [list, setList] = useState<Extraction[]>([]);
  const [sel, setSel] = useState<ItemId | null>(initialItem ?? null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [q, l] = await Promise.all([api.extractionQuota(), api.extractionList()]);
      setQuota(q);
      setList(l);
    } catch {
      /* leitura: sem toast; o painel mostra o que tiver */
    }
  }, [api]);

  useEffect(() => {
    void reload();
    const off = bus.on('extraction:changed', () => void reload());
    return off;
  }, [reload]);

  const serverNow = store.estimatedServerNow();
  const level = store.progress.level;
  const items = sortedInventory(store.inventory.entries()).filter((e) => e.def?.steamExtractable);
  const selItem = sel ? ITEMS_BY_ID.get(sel) : undefined;
  const have = sel ? store.qty(sel) : 0;
  const check = extractionCheck(selItem, { have, level, quota, steamUnavailable: ui.steamUnavailable });
  const waitS = nextSlotSeconds(quota, serverNow);
  const tz = store.profile?.timezone ?? 'UTC';
  const lastCopy = !!sel && CARDS_BY_ID.has(sel) && have === 1;

  const send = async () => {
    if (!sel) return;
    setBusy(true);
    const r = await ui.mutate('extractionRequest', () =>
      api.extractionRequest({ itemId: sel, qty: 1, requestId: newRequestId() }),
    );
    setBusy(false);
    setConfirming(false);
    if (r) {
      setQuota(r.quota);
      bus.emit('extraction:changed', { extraction: r.extraction });
      ui.toast('success', STR.steam.sent(itemName(sel)));
      if (store.qty(sel) <= 0) setSel(null);
    }
    void reload();
  };

  return (
    <Panel
      title={
        <>
          <Glyph name="steam" size={18} /> {STR.steam.title}
        </>
      }
      onClose={ui.close}
      width={980}
    >
      {ui.steamUnavailable && (
        <p class="vif-banner vif-banner--warn" role="alert">
          <Glyph name="warn" /> {STR.steam.unavailable}
        </p>
      )}
      <p class="vif-muted">{STR.steam.intro}</p>
      <div class="vif-quota">
        <span class="vif-strong">
          {quota ? STR.steam.quota(quota.used, quota.limit, quota.windowHours) : STR.loading}
        </span>
        <span class={waitS > 0 ? 'vif-bad' : 'vif-good'}>
          {waitS > 0 ? STR.steam.nextSlot(formatCountdown(waitS)) : STR.steam.slotFree}
        </span>
        {!store.profile?.vip && <span class="vif-muted vif-small">{STR.steam.vipHint}</span>}
        {level < ECONOMY.EXTRACTION_MIN_LEVEL && (
          <span class="vif-warn">{STR.steam.minLevel(ECONOMY.EXTRACTION_MIN_LEVEL)}</span>
        )}
      </div>
      <div class="vif-split">
        <div>
          <h3 class="vif-h3">{STR.steam.pickItem}</h3>
          <div class="vif-grid vif-grid--short">
            {items.length === 0 && <p class="vif-empty">{STR.steam.noItems}</p>}
            {items.map((e) => (
              <button
                type="button"
                key={e.itemId}
                class={`vif-slot ${sel === e.itemId ? 'vif-slot--sel' : ''}`}
                title={itemName(e.itemId)}
                onClick={() => {
                  setSel(e.itemId);
                  setConfirming(false);
                }}
              >
                <ItemIcon itemId={e.itemId} box={48} />
                <span class="vif-slot__qty">{formatInt(e.qty)}</span>
              </button>
            ))}
          </div>
          {sel && (
            <div class="vif-confirm">
              {!confirming ? (
                <>
                  <ItemIcon itemId={sel} box={40} />
                  <span class="vif-strong">{itemName(sel)}</span>
                  {!check.ok && check.reason && <span class="vif-warn">{errorMessage(check.reason)}</span>}
                  <Button variant="gold" disabled={!check.ok} onClick={() => setConfirming(true)}>
                    {STR.steam.send}
                  </Button>
                </>
              ) : (
                <>
                  <span class="vif-confirm__text">
                    <span class="vif-strong">{STR.steam.confirmTitle}</span>
                    <span>{STR.steam.confirmText(itemName(sel))}</span>
                    {lastCopy && (
                      <span class="vif-warn">
                        <Glyph name="warn" /> {STR.steam.lastCopy}
                      </span>
                    )}
                  </span>
                  <Button variant="flat" onClick={() => setConfirming(false)}>
                    {STR.cancel}
                  </Button>
                  <Button variant="gold" disabled={!check.ok || busy} onClick={() => void send()}>
                    {STR.confirm}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <aside class="vif-detail">
          <h3 class="vif-h3">{STR.steam.history}</h3>
          {list.length === 0 ? (
            <p class="vif-muted">{STR.steam.noHistory}</p>
          ) : (
            <ul class="vif-history">
              {list.map((x) => (
                <li key={x.id} class="vif-history__row">
                  <ItemIcon itemId={x.itemId} box={28} />
                  <span class="vif-history__main">
                    <span>
                      {x.qty}× {itemName(x.itemId)}
                    </span>
                    <span class="vif-muted vif-small">{formatDateTime(x.createdAt, tz)}</span>
                  </span>
                  <span class={`vif-pill vif-pill--${x.status}`}>{STR.steam.status[x.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Panel>
  );
}
