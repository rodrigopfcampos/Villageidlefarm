// Inventário: grade com ícones e quantidades, filtro por tipo, venda na loja NPC e marca "Steam".

import { useEffect, useState } from 'preact/hooks';
import { ITEMS_BY_ID, type ItemDef, type ItemId, type ItemKind } from '@vif/shared';
import { newRequestId } from '../../core/ids';
import { Button, Coins, Glyph, ItemIcon, Panel, QtyStepper, Tabs } from '../components';
import { useBus, useUi } from '../context';
import { formatInt } from '../format';
import { clampQty, sellCheck } from '../rules';
import { STR, errorMessage, itemName } from '../strings';

type Filter = 'all' | Extract<ItemKind, 'crop' | 'seed' | 'animal_product' | 'card'>;
const FILTERS: Filter[] = ['all', 'crop', 'animal_product', 'seed', 'card'];
const KIND_ORDER: Record<string, number> = { crop: 0, animal_product: 1, seed: 2, card: 3 };

export interface InvEntry {
  itemId: ItemId;
  qty: number;
  def: ItemDef | undefined;
}

/** Itens do inventário ordenados por tipo e nome (função pura, usada também na retirada). */
export function sortedInventory(entries: Iterable<[ItemId, number]>, filter: Filter = 'all'): InvEntry[] {
  const out: InvEntry[] = [];
  for (const [itemId, qty] of entries) {
    if (qty <= 0) continue;
    const def = ITEMS_BY_ID.get(itemId);
    if (filter !== 'all' && def?.kind !== filter) continue;
    out.push({ itemId, qty, def });
  }
  return out.sort(
    (a, b) =>
      (KIND_ORDER[a.def?.kind ?? ''] ?? 9) - (KIND_ORDER[b.def?.kind ?? ''] ?? 9) ||
      itemName(a.itemId).localeCompare(itemName(b.itemId), 'pt-BR'),
  );
}

export function InventoryPanel({ initialItem }: { initialItem?: ItemId }) {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['inventory:changed', 'wallet:changed', 'farm:snapshot']);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<ItemId | null>(initialItem ?? null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const items = sortedInventory(store.inventory.entries(), filter);
  const selected = sel ? { itemId: sel, qty: store.qty(sel), def: ITEMS_BY_ID.get(sel) } : null;
  const have = selected?.qty ?? 0;

  useEffect(() => {
    if (sel && store.qty(sel) <= 0) setSel(null);
    setQty((q) => clampQty(q, 1, Math.max(1, have)));
  }, [sel, have, store]);

  const check = selected ? sellCheck(selected.def, qty, have) : null;

  const sell = async () => {
    if (!selected || !check?.ok) return;
    setBusy(true);
    const r = await ui.mutate('shopSell', () =>
      api.shopSell({ itemId: selected.itemId, qty, requestId: newRequestId() }),
    );
    setBusy(false);
    if (r) ui.toast('success', STR.inventory.sold(qty, itemName(selected.itemId), formatInt(check.total)));
  };

  return (
    <Panel title={STR.inventory.title} onClose={ui.close} width={940}>
      <Tabs
        tabs={FILTERS.map((f) => ({ id: f, label: STR.inventory.filters[f] }))}
        active={filter}
        onChange={(f) => setFilter(f)}
      />
      <div class="vif-split">
        <div class="vif-grid" role="list">
          {items.length === 0 && <p class="vif-empty">{STR.inventory.empty}</p>}
          {items.map((e) => (
            <button
              type="button"
              role="listitem"
              key={e.itemId}
              class={`vif-slot ${sel === e.itemId ? 'vif-slot--sel' : ''}`}
              title={itemName(e.itemId)}
              onClick={() => {
                setSel(e.itemId);
                setQty(1);
              }}
            >
              <ItemIcon itemId={e.itemId} box={48} />
              <span class="vif-slot__qty">{formatInt(e.qty)}</span>
              {e.def?.steamExtractable && (
                <span class="vif-slot__steam" title={STR.inventory.steamBadge}>
                  <Glyph name="steam" size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
        <aside class="vif-detail">
          {!selected ? (
            <p class="vif-muted">{STR.inventory.pick}</p>
          ) : (
            <>
              <div class="vif-detail__head">
                <ItemIcon itemId={selected.itemId} box={64} />
                <div>
                  <p class="vif-strong">{itemName(selected.itemId)}</p>
                  <p class="vif-muted">
                    {STR.you_have} {formatInt(have)}
                  </p>
                </div>
              </div>
              {selected.def?.steamExtractable && (
                <p class="vif-tag vif-tag--steam">
                  <Glyph name="steam" size={12} /> {STR.inventory.steamBadge}
                </p>
              )}
              <h3 class="vif-h3">{STR.inventory.sellTitle}</h3>
              {selected.def?.sellPrice == null ? (
                <p class="vif-muted">{STR.inventory.notSellable}</p>
              ) : (
                <>
                  <p>
                    {STR.inventory.sellPrice} <Coins n={selected.def.sellPrice} compact />
                  </p>
                  <QtyStepper value={qty} min={1} max={Math.max(1, have)} onChange={setQty} />
                  <Button
                    variant="gold"
                    disabled={!check?.ok || busy}
                    title={check?.reason ? errorMessage(check.reason) : undefined}
                    onClick={() => void sell()}
                  >
                    {STR.inventory.sellBtn} <Coins n={check?.total ?? 0} compact />
                  </Button>
                </>
              )}
              {selected.def?.steamExtractable && (
                <Button variant="flat" onClick={() => ui.open({ id: 'extraction', itemId: selected.itemId })}>
                  <Glyph name="steam" /> {STR.inventory.toSteam}
                </Button>
              )}
            </>
          )}
        </aside>
      </div>
    </Panel>
  );
}
