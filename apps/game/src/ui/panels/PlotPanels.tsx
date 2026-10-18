// Painéis do canteiro: Plantar (lista de culturas) e Desbloquear. Abertos pelo A3 com
// bus.emit('ui:open-panel', { panel: 'plant' | 'unlock', slotId }) ao clicar num canteiro.

import { useState } from 'preact/hooks';
import {
  CROPS,
  ITEMS_BY_ID,
  activeMagnitude,
  layoutPlotSlots,
  secondsRemaining,
  looksReady,
  type CropDef,
  type PlotSlotDef,
} from '@vif/shared';
import { newRequestId } from '../../core/ids';
import { DEFAULT_SLOTS } from '../../net/mockApi';
import type { Services } from '../../core/services';
import { Button, Coins, Glyph, ItemIcon, Panel } from '../components';
import { useBus, useUi } from '../context';
import { formatCountdown, formatDurationShort, formatInt } from '../format';
import { cropEconomy, plantOption, plotAccepts, unlockCheck } from '../rules';
import { STR, errorMessage, itemName } from '../strings';

export function slotDefFor(s: Services, slotId: string): PlotSlotDef | undefined {
  const defs = s.layout ? layoutPlotSlots(s.layout) : DEFAULT_SLOTS;
  return defs.find((d) => d.slotId === slotId);
}

/** Desconto do Mercador ativo agora (só para mostrar o preço; o servidor confirma). */
export function merchantDiscount(s: Services): number {
  const fc = s.store.estimatedFarmClock();
  return Math.min(0.9, activeMagnitude(s.store.currentBuffs(), 'merchant', fc));
}

function slotLabel(slotId: string): string {
  const n = /(\d+)$/.exec(slotId)?.[1];
  return n ? String(Number(n)) : slotId;
}

export function PlantPanel({ slotId }: { slotId: string }) {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['wallet:changed', 'inventory:changed', 'plot:updated', 'xp:changed', 'time:tick']);
  const [busy, setBusy] = useState<string | null>(null);
  const plot = store.plot(slotId);
  const accepts = plotAccepts(plot);

  if (plot && !plot.unlocked) return <UnlockPanel slotId={slotId} />;

  const level = store.progress.level;
  const discount = merchantDiscount(ui.s);
  const crops = [...CROPS].sort((a, b) => a.unlockLevel - b.unlockLevel || a.growSeconds - b.growSeconds);

  const plant = async (crop: CropDef, buyFirst: boolean) => {
    if (busy) return;
    setBusy(crop.cropId);
    try {
      if (buyFirst) {
        const bought = await ui.mutate('shopBuy', () =>
          api.shopBuy({ itemId: crop.seedItemId, qty: 1, requestId: newRequestId() }),
        );
        if (!bought) return;
      }
      const r = await ui.mutate('plant', () =>
        api.plant({ slotId, seedItemId: crop.seedItemId, requestId: newRequestId() }),
      );
      if (r) {
        ui.toast('success', STR.plant.planted(itemName(crop.yieldItemId)));
        ui.close();
      }
    } finally {
      setBusy(null);
    }
  };

  const harvest = async () => {
    const r = await ui.mutate('harvest', () => api.harvest({ slotId, requestId: newRequestId() }));
    if (r) {
      ui.toast('success', STR.plant.harvested);
      ui.close();
    }
  };

  const title = (
    <>
      {STR.plant.title} <small class="vif-sub">{STR.plant.slot(slotLabel(slotId))}</small>
    </>
  );

  if (!accepts.ok && plot && plot.cropId) {
    const fc = store.estimatedFarmClock();
    const ready = looksReady(plot, fc);
    return (
      <Panel title={title} onClose={ui.close} width={460}>
        <div class="vif-occupied">
          <ItemIcon itemId={plot.cropId} box={64} />
          <div>
            <p class="vif-strong">{itemName(plot.cropId)}</p>
            <p>{ready ? STR.plant.ready : STR.plant.readyIn(formatCountdown(secondsRemaining(plot, fc)))}</p>
          </div>
          {ready && (
            <Button variant="gold" onClick={() => void harvest()}>
              {STR.plant.harvest}
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={title} onClose={ui.close} width={720}>
      {!accepts.ok && accepts.reason && <p class="vif-warn">{errorMessage(accepts.reason)}</p>}
      <ul class="vif-list">
        {crops.map((crop) => {
          const eco = cropEconomy(crop);
          const seed = ITEMS_BY_ID.get(crop.seedItemId);
          const have = store.qty(crop.seedItemId);
          const opt = plantOption(crop, { level, coins: store.wallet.coins, seedQty: have, merchantDiscount: discount });
          const locked = opt.action === 'locked';
          return (
            <li key={crop.cropId} class={`vif-row ${locked ? 'vif-row--locked' : ''}`}>
              <ItemIcon itemId={crop.yieldItemId} box={48} />
              <div class="vif-row__main">
                <span class="vif-row__name">{itemName(crop.yieldItemId)}</span>
                <span class="vif-row__meta">
                  <span class="vif-stat" title={STR.plant.time}>
                    <Glyph name="clock" />
                    {formatDurationShort(crop.growSeconds)}
                  </span>
                  <span class="vif-stat" title={STR.plant.seed}>
                    {STR.plant.seed} <Coins n={seed?.basePrice ?? 0} compact />
                  </span>
                  <span class="vif-stat vif-stat--profit" title={STR.plant.profit}>
                    {STR.plant.profit} +{formatInt(eco.profit)} · {STR.plant.perHour(formatInt(eco.profitPerHour))}
                  </span>
                </span>
                {!locked && have > 0 && <span class="vif-row__note">{STR.plant.owned(have)}</span>}
              </div>
              <div class="vif-row__act">
                {locked ? (
                  <span class="vif-lock">
                    <Glyph name="lock" /> {STR.plant.lockedLevel(crop.unlockLevel)}
                  </span>
                ) : (
                  <Button
                    variant={opt.action === 'plant' ? 'gold' : 'wood'}
                    disabled={!opt.ok || !accepts.ok || busy !== null}
                    title={opt.reason ? errorMessage(opt.reason) : undefined}
                    onClick={() => void plant(crop, opt.action === 'buy-and-plant')}
                  >
                    {opt.action === 'plant' && STR.plant.plantBtn}
                    {opt.action === 'buy-and-plant' && (
                      <>
                        {STR.plant.buyAndPlant} <Coins n={opt.cost} compact />
                      </>
                    )}
                    {opt.action === 'no-money' && STR.plant.noMoney}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function UnlockPanel({ slotId }: { slotId: string }) {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['wallet:changed', 'plot:updated', 'xp:changed']);
  const [busy, setBusy] = useState(false);
  const plot = store.plot(slotId);
  const def = slotDefFor(ui.s, slotId);
  const check = unlockCheck(def, plot, store.progress.level, store.wallet.coins);

  const unlock = async () => {
    setBusy(true);
    const r = await ui.mutate('unlockSlot', () => api.unlockSlot({ slotId, requestId: newRequestId() }));
    setBusy(false);
    if (r) {
      ui.toast('success', STR.unlock.done);
      ui.open({ id: 'plant', slotId });
    }
  };

  return (
    <Panel
      title={
        <>
          {STR.unlock.title} <small class="vif-sub">{STR.plant.slot(slotLabel(slotId))}</small>
        </>
      }
      onClose={ui.close}
      width={480}
    >
      {plot?.unlocked ? (
        <p>{STR.unlock.already}</p>
      ) : (
        <div class="vif-unlock">
          <p>{STR.unlock.text}</p>
          <dl class="vif-kv">
            <dt>{STR.unlock.cost}</dt>
            <dd>
              <Coins n={def?.unlockCost ?? 0} />
            </dd>
            <dt>{STR.level}</dt>
            <dd class={store.progress.level < (def?.unlockLevel ?? 1) ? 'vif-bad' : 'vif-good'}>
              {def?.unlockLevel ?? 1}
            </dd>
            <dt>{STR.you_have}</dt>
            <dd>
              <Coins n={store.wallet.coins} />
            </dd>
          </dl>
          {check.reason === 'LEVEL_TOO_LOW' && <p class="vif-warn">{STR.unlock.needLevel(def?.unlockLevel ?? 1)}</p>}
          {check.reason === 'INSUFFICIENT_FUNDS' && <p class="vif-warn">{errorMessage('INSUFFICIENT_FUNDS')}</p>}
          <div class="vif-actions">
            <Button variant="flat" onClick={ui.close}>
              {STR.cancel}
            </Button>
            <Button variant="gold" disabled={!check.ok || busy} onClick={() => void unlock()}>
              {STR.unlock.btn} <Coins n={def?.unlockCost ?? 0} compact />
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
