// HUD: moedas, nível + XP, relógio local, evento noturno, cartas ativas, VIP e a barra de botões.

import { BUFFS_BY_KIND, CARDS_BY_ID, localTime } from '@vif/shared';
import { newRequestId } from '../core/ids';
import { Bar, Button, Coins, Sprite } from './components';
import { useBus, useUi } from './context';
import { formatClock, formatCountdown, formatDurationShort, formatMinutesFloor } from './format';
import { buffRemaining, nightEventView, xpView } from './rules';
import { BUFF_NAMES, RARITY_NAMES, STR, cardName } from './strings';

export function Hud() {
  const ui = useUi();
  const { store } = ui.s;
  useBus(['time:tick', 'wallet:changed', 'xp:changed', 'buffs:changed', 'farm:snapshot']);

  const profile = store.profile;
  const serverNow = store.estimatedServerNow();
  const fc = store.estimatedFarmClock();
  const tz = ui.world?.timezone ?? profile?.timezone ?? 'UTC';
  const lt = localTime(serverNow, tz);
  const xp = xpView(store.progress.level, store.progress.xp);
  const night = nightEventView(ui.world?.nightEvent ?? null, serverNow, tz);
  const buffs = store.currentBuffs();

  const claim = async () => {
    const r = await ui.mutate('claimNightEvent', () =>
      ui.s.api.claimNightEvent({ requestId: newRequestId() }),
    );
    if (r) {
      const def = CARDS_BY_ID.get(r.card.cardId);
      if (def) ui.toast('success', STR.eventCardClaimed(cardName(def.buff, def.rarity)));
      ui.refreshWorld();
    }
  };

  return (
    <div class="vif-hud">
      <div class="vif-hud__left vif-chip-group">
        <div class="vif-chip vif-chip--coins" title={STR.coins}>
          <Coins n={store.wallet.coins} />
        </div>
        <div class="vif-chip vif-chip--level" title={STR.hud.xpTitle(xp.into, xp.span)}>
          <span class="vif-level-star">
            <Sprite frames={['ui/xp_star']} box={30} />
            <span class="vif-level-star__n">{xp.level}</span>
          </span>
          <span class="vif-level-info">
            <span class="vif-level-info__label">
              {STR.level} {xp.level}
              {profile?.vip && (
                <span class="vif-vip" title={STR.hud.vipTitle}>
                  <Sprite frames={['ui/vip_crown']} box={20} />
                  {STR.vip}
                </span>
              )}
            </span>
            <Bar value={xp.progress} label={`${xp.into} / ${xp.span}`} />
          </span>
        </div>
      </div>

      <div class="vif-hud__center vif-chip-group">
        <div class="vif-chip vif-chip--clock" title={STR.hud.clock}>
          <span class="vif-clock">{formatClock(lt.h, lt.m)}</span>
        </div>
        <div
          class={`vif-chip vif-chip--night ${night.active ? 'vif-chip--night-on' : ''}`}
          title={`${STR.hud.nightTitle}: ${STR.hud.nightSpeed}`}
        >
          <Sprite frames={['ui/night_event']} box={30} />
          <span class="vif-night">
            <span class="vif-night__title">
              {night.active ? STR.hud.nightActive : STR.hud.nightNext}
              <span class="vif-night__time">
                {night.active
                  ? STR.hud.nightEndsIn(formatCountdown(night.seconds))
                  : STR.hud.nightStartsIn(formatCountdown(night.seconds))}
              </span>
            </span>
            {night.claimed ? (
              <span class="vif-night__status vif-night__status--done">✓ {STR.hud.cardClaimed}</span>
            ) : night.claimable ? (
              <Button small variant="gold" onClick={() => void claim()}>
                {STR.hud.claimCard}
              </Button>
            ) : (
              <Bar
                kind="gold"
                value={night.progress}
                label={STR.hud.attendance(
                  formatMinutesFloor(ui.world?.nightEvent.attendanceSeconds ?? 0),
                  formatMinutesFloor(ui.world?.nightEvent.requiredSeconds ?? 1800),
                )}
              />
            )}
          </span>
        </div>
      </div>

      <div class="vif-hud__right vif-chip-group">
        <div class="vif-chip vif-chip--buffs" title={STR.hud.buffsTitle}>
          {buffs.length === 0 ? (
            <span class="vif-buffs__none">{STR.hud.noBuffs}</span>
          ) : (
            buffs.map((b) => {
              const def = BUFFS_BY_KIND.get(b.buff);
              const left = buffRemaining(b, fc);
              return (
                <button
                  type="button"
                  key={b.instanceId}
                  class={`vif-buff vif-buff--${b.rarity}`}
                  title={`${BUFF_NAMES[b.buff]} (${RARITY_NAMES[b.rarity]}) — ${STR.cards.remaining(formatDurationShort(left))}`}
                  onClick={() => ui.open({ id: 'cards' })}
                >
                  <Sprite frames={[def?.iconKey ?? '']} box={28} fallback={BUFF_NAMES[b.buff].slice(0, 2)} />
                  <span class="vif-buff__time">{formatCountdown(left)}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function Toolbar() {
  const ui = useUi();
  useBus(['cards:changed', 'farm:snapshot']);
  const nCards = ui.s.store.cards.size;
  const item = (id: Parameters<typeof ui.toggle>[0], label: string, key?: string, badge?: number) => (
    <Button
      class={`vif-tool ${ui.panel?.id === id ? 'vif-tool--on' : ''}`}
      onClick={() => ui.toggle(id)}
      hotkey={key}
      title={key ? `${label} ${STR.keyHint(key)}` : label}
    >
      {label}
      {badge ? <span class="vif-badge">{badge}</span> : null}
    </Button>
  );
  return (
    <nav class="vif-toolbar">
      {item('inventory', STR.toolbar.inventory, 'I')}
      {item('shop', STR.toolbar.shop, 'L')}
      {item('cards', STR.toolbar.cards, 'C', nCards)}
      {item('album', STR.toolbar.album)}
      {item('extraction', STR.toolbar.steam)}
    </nav>
  );
}
