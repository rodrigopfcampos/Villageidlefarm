// Loja NPC: comprar sementes (com quantidade) e animais (liberados por nível).

import { useState } from 'preact/hooks';
import { ANIMALS, CROPS, ITEMS, ITEMS_BY_ID, type AnimalDef, type ItemDef } from '@vif/shared';
import { newRequestId } from '../../core/ids';
import { Button, Coins, Glyph, ItemIcon, Panel, QtyStepper, Sprite, Tabs } from '../components';
import { useBus, useUi } from '../context';
import { formatDurationShort } from '../format';
import { animalBuyCheck, buyCheck } from '../rules';
import { animalFrames } from '../sprites';
import { STR, animalName, errorMessage, itemName } from '../strings';

type ShopTab = 'seeds' | 'animals';

function seedUnlockLevel(item: ItemDef): number {
  return CROPS.find((c) => c.seedItemId === item.id)?.unlockLevel ?? 1;
}

export function ShopPanel() {
  const ui = useUi();
  useBus(['wallet:changed', 'inventory:changed', 'xp:changed', 'buffs:changed', 'animal:updated']);
  const [tab, setTab] = useState<ShopTab>('seeds');
  return (
    <Panel title={STR.shop.title} onClose={ui.close} width={900}>
      <div class="vif-shop-top">
        <Tabs
          tabs={[
            { id: 'seeds', label: STR.shop.seeds },
            { id: 'animals', label: STR.shop.animals },
          ]}
          active={tab}
          onChange={setTab}
        />
        <span class="vif-chip vif-chip--inline">
          {STR.you_have} <Coins n={ui.s.store.wallet.coins} />
        </span>
      </div>
      <ul class="vif-list">
        {tab === 'seeds'
          ? ITEMS.filter((i) => i.shopBuyable && i.kind === 'seed')
              .sort((a, b) => seedUnlockLevel(a) - seedUnlockLevel(b) || a.basePrice - b.basePrice)
              .map((item) => <SeedRow key={item.id} item={item} />)
          : [...ANIMALS]
              .sort((a, b) => a.unlockLevel - b.unlockLevel)
              .map((def) => <AnimalRow key={def.animalType} def={def} />)}
      </ul>
    </Panel>
  );
}

function SeedRow({ item }: { item: ItemDef }) {
  const ui = useUi();
  const { store, api } = ui.s;
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const unlock = seedUnlockLevel(item);
  const crop = CROPS.find((c) => c.seedItemId === item.id);
  const check = buyCheck(item, qty, {
    coins: store.wallet.coins,
    level: store.progress.level,
    unlockLevel: unlock,
  });
  const locked = check.reason === 'LEVEL_TOO_LOW';
  const unit = item.basePrice;
  const maxAfford = Math.max(1, Math.min(999, Math.floor(store.wallet.coins / Math.max(1, unit))));

  const buy = async () => {
    setBusy(true);
    const r = await ui.mutate('shopBuy', () => api.shopBuy({ itemId: item.id, qty, requestId: newRequestId() }));
    setBusy(false);
    if (r) ui.toast('success', STR.shop.bought(qty, itemName(item.id)));
  };

  return (
    <li class={`vif-row ${locked ? 'vif-row--locked' : ''}`}>
      <ItemIcon itemId={item.id} box={48} />
      <div class="vif-row__main">
        <span class="vif-row__name">{itemName(item.id)}</span>
        <span class="vif-row__meta">
          <Coins n={unit} compact /> {STR.each}
          {crop && (
            <span class="vif-stat">
              <Glyph name="clock" /> {STR.shop.grows(formatDurationShort(crop.growSeconds))}
            </span>
          )}
          <span class="vif-stat vif-muted">
            {STR.you_have} {store.qty(item.id)}
          </span>
        </span>
      </div>
      <div class="vif-row__act vif-row__act--wide">
        {locked ? (
          <span class="vif-lock">
            <Glyph name="lock" /> {STR.shop.locked(unlock)}
          </span>
        ) : (
          <>
            <QtyStepper value={qty} min={1} max={maxAfford} onChange={setQty} />
            <Button
              variant="gold"
              disabled={!check.ok || busy}
              title={check.reason ? errorMessage(check.reason) : undefined}
              onClick={() => void buy()}
            >
              {STR.shop.buyBtn} <Coins n={check.total} compact />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function AnimalRow({ def }: { def: AnimalDef }) {
  const ui = useUi();
  const { store, api } = ui.s;
  const [busy, setBusy] = useState(false);
  const check = animalBuyCheck(def, store.wallet.coins, store.progress.level);
  const locked = check.reason === 'LEVEL_TOO_LOW';
  const owned = [...store.animals.values()].filter((a) => a.animalType === def.animalType).length;
  const product = ITEMS_BY_ID.get(def.productItemId);

  const buy = async () => {
    setBusy(true);
    const r = await ui.mutate('buyAnimal', () =>
      api.buyAnimal({ animalType: def.animalType, requestId: newRequestId() }),
    );
    setBusy(false);
    if (r) ui.toast('success', STR.shop.boughtAnimal(animalName(def.animalType)));
  };

  return (
    <li class={`vif-row ${locked ? 'vif-row--locked' : ''}`}>
      <Sprite frames={animalFrames(def.animalType)} box={56} title={animalName(def.animalType)} />
      <div class="vif-row__main">
        <span class="vif-row__name">{animalName(def.animalType)}</span>
        <span class="vif-row__meta">
          {product && (
            <span class="vif-stat">
              <ItemIcon itemId={product.id} box={20} />
              {STR.shop.produces(itemName(product.id), formatDurationShort(def.produceSeconds))}
            </span>
          )}
          {owned > 0 && (
            <span class="vif-stat vif-muted">
              {STR.you_have} {owned}
            </span>
          )}
        </span>
      </div>
      <div class="vif-row__act">
        {locked ? (
          <span class="vif-lock">
            <Glyph name="lock" /> {STR.shop.locked(def.unlockLevel)}
          </span>
        ) : (
          <Button
            variant="gold"
            disabled={!check.ok || busy}
            title={check.reason ? errorMessage(check.reason) : undefined}
            onClick={() => void buy()}
          >
            {STR.shop.buyBtn} <Coins n={def.buyPrice} compact />
          </Button>
        )}
      </div>
    </li>
  );
}
