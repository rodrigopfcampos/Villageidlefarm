// Cartas (não usadas → ativar) e Álbum (8 buffs × 5 raridades, silhuetas, bônus por linha).

import { useEffect, useState } from 'preact/hooks';
import {
  BUFFS,
  BUFF_KINDS,
  CARDS_BY_ID,
  CARDS_CONFIG,
  RARITIES,
  buildAlbum,
  cardId as makeCardId,
  type Album,
  type CardInstance,
} from '@vif/shared';
import { newRequestId } from '../../core/ids';
import { Bar, Button, CardView, Glyph, Panel, Sprite, Tabs } from '../components';
import { useBus, useUi, useWindowHeight } from '../context';
import { formatCountdown, formatDurationShort } from '../format';
import { buffRemaining, cardActivateCheck, cardSlots } from '../rules';
import { RARITY_NAMES, STR, buffDescription, buffName, cardName, errorMessage } from '../strings';

type Tab = 'cards' | 'album';

const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i])) as Record<string, number>;

/** Ordena cartas: raridade maior primeiro, depois buff, depois mais antiga. */
export function sortCards(cards: Iterable<CardInstance>): CardInstance[] {
  return [...cards].sort((a, b) => {
    const da = CARDS_BY_ID.get(a.cardId);
    const db = CARDS_BY_ID.get(b.cardId);
    return (
      (RARITY_RANK[db?.rarity ?? 'common'] ?? 0) - (RARITY_RANK[da?.rarity ?? 'common'] ?? 0) ||
      BUFF_KINDS.indexOf(da?.buff ?? 'gold') - BUFF_KINDS.indexOf(db?.buff ?? 'gold') ||
      a.obtainedAt - b.obtainedAt
    );
  });
}

export function CardsPanel({ initialTab }: { initialTab: Tab }) {
  const ui = useUi();
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  return (
    <Panel title={STR.cards.title} onClose={ui.close} width={1040} class="vif-panel--cards">
      <Tabs
        tabs={[
          { id: 'cards', label: STR.cards.tabCards, hotkey: 'C' },
          { id: 'album', label: STR.cards.tabAlbum },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'cards' ? <CardsTab /> : <AlbumTab />}
    </Panel>
  );
}

function CardsTab() {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['cards:changed', 'buffs:changed', 'time:tick', 'farm:snapshot']);
  const cards = sortCards(store.cards.values());
  const [sel, setSel] = useState<string | null>(cards[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const selected = sel ? store.cards.get(sel) : undefined;
  const def = selected ? CARDS_BY_ID.get(selected.cardId) : undefined;
  const vip = store.profile?.vip ?? false;
  const active = store.currentBuffs();
  const fc = store.estimatedFarmClock();
  const max = cardSlots(vip);
  const check = def ? cardActivateCheck(def, active, vip) : null;

  useEffect(() => {
    if (!selected && cards[0]) setSel(cards[0].id);
  }, [selected, cards]);

  const activate = async () => {
    if (!selected || !def) return;
    setBusy(true);
    const r = await ui.mutate('cardActivate', () =>
      api.cardActivate({ instanceId: selected.id, requestId: newRequestId() }),
    );
    setBusy(false);
    if (r) {
      ui.toast('success', STR.cards.activated(cardName(def.buff, def.rarity)));
      setSel(null);
    }
  };

  return (
    <div class="vif-split vif-split--cards">
      <div class="vif-cardgrid">
        {cards.length === 0 && <p class="vif-empty">{STR.cards.empty}</p>}
        {cards.map((c) => (
          <CardView key={c.id} cardId={c.cardId} height={176} selected={c.id === sel} onClick={() => setSel(c.id)} />
        ))}
      </div>
      <aside class="vif-detail">
        <div class="vif-slots">
          <span class="vif-strong">{STR.cards.slots(active.length, max)}</span>
          {!vip && <span class="vif-muted vif-small">{STR.cards.slotsVipHint}</span>}
        </div>
        <h3 class="vif-h3">{STR.cards.activeNow}</h3>
        {active.length === 0 ? (
          <p class="vif-muted">{STR.hud.noBuffs}</p>
        ) : (
          <ul class="vif-active">
            {active.map((b) => {
              const left = buffRemaining(b, fc);
              const total = Math.max(1, b.endsFc - b.startedFc);
              const icon = BUFFS.find((x) => x.kind === b.buff)?.iconKey ?? '';
              return (
                <li key={b.instanceId} class="vif-active__row">
                  <Sprite frames={[icon]} box={28} />
                  <span class="vif-active__main">
                    <span>{cardName(b.buff, b.rarity)}</span>
                    <Bar kind="gold" value={left / total} label={STR.cards.remaining(formatCountdown(left))} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <hr class="vif-hr" />
        {!selected || !def ? (
          <p class="vif-muted">{STR.cards.pick}</p>
        ) : (
          <div class="vif-carddetail">
            <p class="vif-strong vif-big">{buffName(def.buff)}</p>
            <p class={`vif-rarity vif-rarity--${def.rarity}`}>{RARITY_NAMES[def.rarity]}</p>
            <p>{buffDescription(def.buff)}</p>
            <dl class="vif-kv">
              <dt>{STR.cards.duration}</dt>
              <dd>{def.durationSeconds > 0 ? formatDurationShort(def.durationSeconds) : STR.cards.instant}</dd>
              <dt>Origem</dt>
              <dd>{STR.cards.source[selected.source] ?? selected.source}</dd>
            </dl>
            <p class="vif-muted vif-small">
              {def.durationSeconds > 0 ? STR.cards.rule : STR.cards.instantNote}
            </p>
            {check && !check.ok && check.reason && (
              <p class="vif-warn">
                <Glyph name="warn" /> {errorMessage(check.reason)}
              </p>
            )}
            <Button variant="gold" disabled={!check?.ok || busy} onClick={() => void activate()}>
              {STR.cards.activate}
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

function AlbumTab() {
  const ui = useUi();
  const { store, api } = ui.s;
  useBus(['inventory:changed', 'farm:snapshot']);
  // O álbum é permanente (retirar para a Steam não esvazia): vale o servidor; o inventário só
  // adianta na hora as cartas que acabaram de ser usadas.
  const local = buildAlbum((id) => store.qty(id));
  const [server, setServer] = useState<Album | null>(null);
  const invVersion = [...store.inventory.entries()].filter(([k]) => k.startsWith('card_')).join();
  useEffect(() => {
    let alive = true;
    void api.albumGet().then(
      (a) => alive && setServer(a),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, invVersion]);
  const album = server ? mergeAlbum(server, local) : local;
  const have = album.slots.filter((s) => s.copies > 0).length;
  const pct = CARDS_CONFIG.album.lineBonusPercent;
  const cardH = useWindowHeight() < 900 ? 74 : 104;

  return (
    <div class="vif-album">
      <p class="vif-muted">
        {STR.cards.albumIntro} <span class="vif-strong">{STR.cards.albumCount(have, album.slots.length)}</span>
      </p>
      <div class="vif-album__legend">
        {RARITIES.map((r) => (
          <span key={r} class={`vif-rarity vif-rarity--${r}`}>
            {RARITY_NAMES[r]}
          </span>
        ))}
      </div>
      <div class="vif-album__grid">
        {BUFF_KINDS.map((b) => {
          const row = RARITIES.map((r) => album.slots.find((s) => s.cardId === makeCardId(b, r)));
          const missing = row.filter((s) => !s || s.copies <= 0).length;
          const done = album.completedLines.includes(b);
          const icon = BUFFS.find((x) => x.kind === b)?.iconKey ?? '';
          return (
            <section key={b} class={`vif-album__line ${done ? 'vif-album__line--done' : ''}`}>
              <header class="vif-album__head">
                <span class="vif-album__buff">
                  <Sprite frames={[icon]} box={24} />
                  {buffName(b)}
                </span>
                {done ? (
                  <span class="vif-album__bonus vif-album__bonus--on">
                    <Glyph name="check" /> {STR.cards.lineDone(album.bonusPercent[b] ?? pct)}
                  </span>
                ) : (
                  <span class="vif-album__bonus vif-muted">
                    {STR.cards.lineDone(pct)} · {STR.cards.lineMissing(missing)}
                  </span>
                )}
              </header>
              <div class="vif-album__cards">
                {row.map((slot, i) => {
                  const r = RARITIES[i]!;
                  const empty = !slot || slot.copies <= 0;
                  return (
                    <CardView
                      key={r}
                      cardId={makeCardId(b, r)}
                      height={cardH}
                      silhouette={empty}
                      showName={false}
                      title={`${cardName(b, r)}${empty ? '' : ` ${STR.cards.copies(slot.copies)}`}`}
                      badge={
                        slot && slot.copies > 1 ? (
                          <span class="vif-card__copies">{STR.cards.copies(slot.copies)}</span>
                        ) : null
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Espaço cheio se o servidor OU o inventário local diz que sim; bônus pelas linhas completas. */
export function mergeAlbum(server: Album, local: Album): Album {
  const localById = new Map(local.slots.map((x) => [x.cardId, x.copies]));
  const slots = server.slots.map((x) => ({ ...x, copies: Math.max(x.copies, localById.get(x.cardId) ?? 0) }));
  const completedLines = BUFF_KINDS.filter((b) => {
    const row = slots.filter((x) => x.buff === b);
    return row.length > 0 && row.every((x) => x.copies > 0);
  });
  const bonusPercent: Album['bonusPercent'] = { ...server.bonusPercent };
  for (const b of completedLines) bonusPercent[b] ??= CARDS_CONFIG.album.lineBonusPercent;
  return { slots, completedLines, bonusPercent };
}
