// Peças visuais reutilizáveis: painel nine-slice, botão, barra, sprite, carta, quantidade, abas.

import type { ComponentChildren, JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { CARDS_BY_ID, type ItemId } from '@vif/shared';
import { CARD_ART_SLOT } from '@vif/shared/generated/assetKeys';
import { firstFrame, frameSize, frameUrl, hasFrame } from './atlas';
import { formatInt } from './format';
import { itemFrames, isSeedFallback } from './sprites';
import { RARITY_NAMES, STR, buffName, itemName } from './strings';
import { useAtlas } from './context';

// ---------- sprite ----------

export interface SpriteProps {
  /** Candidatos (usa o primeiro que existir). */
  frames: readonly string[];
  /** Cabe numa caixa de `box` px (mantém a proporção). */
  box: number;
  title?: string;
  class?: string;
  /** Texto curto mostrado se nenhum quadro existir. */
  fallback?: string;
}

export function Sprite({ frames, box, title, class: cls, fallback }: SpriteProps) {
  useAtlas();
  const frame = firstFrame(frames);
  const url = frame ? frameUrl(frame) : null;
  const size = frame ? frameSize(frame) : null;
  if (!url || !size) {
    return (
      <span
        class={`vif-sprite vif-sprite--missing ${cls ?? ''}`}
        style={{ width: box, height: box }}
        title={title}
      >
        {fallback ?? ''}
      </span>
    );
  }
  const k = box / Math.max(size.w, size.h);
  return (
    <span class={`vif-sprite ${cls ?? ''}`} style={{ width: box, height: box }} title={title}>
      <img
        src={url}
        alt={title ?? ''}
        width={Math.round(size.w * k)}
        height={Math.round(size.h * k)}
        draggable={false}
      />
    </span>
  );
}

/** Ícone de item do inventário (carta usada vira mini carta; semente sem arte ganha um saquinho). */
export function ItemIcon({ itemId, box }: { itemId: ItemId; box: number }) {
  useAtlas();
  const card = CARDS_BY_ID.get(itemId);
  if (card) return <CardView cardId={itemId} height={box} showName={false} />;
  const seedMark = isSeedFallback(itemId, hasFrame);
  return (
    <span class="vif-itemicon" style={{ width: box, height: box }}>
      <Sprite
        frames={itemFrames(itemId)}
        box={box}
        title={itemName(itemId)}
        fallback={itemName(itemId).slice(0, 2)}
      />
      {seedMark && <span class="vif-seedmark">{STR.plant.seed}</span>}
    </span>
  );
}

/** Moeda + valor. */
export function Coins({ n, compact }: { n: number; compact?: boolean }) {
  return (
    <span class={`vif-coins ${compact ? 'vif-coins--compact' : ''}`}>
      <Sprite frames={['ui/coin']} box={compact ? 16 : 20} />
      <span>{formatInt(n)}</span>
    </span>
  );
}

// ---------- botão ----------

export interface ButtonProps {
  children: ComponentChildren;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: 'wood' | 'gold' | 'flat' | 'danger';
  small?: boolean;
  class?: string;
  /** Mostra a tecla de atalho (só visual). */
  hotkey?: string;
  ariaLabel?: string;
}

export function Button(p: ButtonProps) {
  return (
    <button
      type="button"
      class={`vif-btn vif-btn--${p.variant ?? 'wood'} ${p.small ? 'vif-btn--small' : ''} ${p.class ?? ''}`}
      disabled={p.disabled}
      title={p.title}
      aria-label={p.ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        if (!p.disabled) p.onClick?.();
      }}
    >
      <span class="vif-btn__label">{p.children}</span>
      {p.hotkey && <span class="vif-btn__key">{p.hotkey}</span>}
    </button>
  );
}

// ---------- barra ----------

export function Bar({
  value,
  kind = 'green',
  label,
}: {
  value: number;
  kind?: 'green' | 'gold';
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span
      class="vif-bar"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        class={`vif-bar__fill vif-bar__fill--${kind}`}
        style={{ width: `${pct}%`, display: pct <= 0 ? 'none' : undefined }}
      />
      {label && <span class="vif-bar__label">{label}</span>}
    </span>
  );
}

// ---------- painel ----------

export interface PanelProps {
  title: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  /** Largura máxima em px (o painel encolhe em janelas pequenas). */
  width?: number;
  class?: string;
  /** Sem fundo escurecido (painéis pequenos ao lado do canteiro). */
  noBackdrop?: boolean;
}

export function Panel({
  title,
  onClose,
  children,
  width = 860,
  class: cls,
  noBackdrop,
}: PanelProps) {
  // Foco no painel para o Esc e leitores de tela.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);
  const stop = (e: JSX.TargetedMouseEvent<HTMLElement>) => e.stopPropagation();
  return (
    <div class={`vif-backdrop ${noBackdrop ? 'vif-backdrop--clear' : ''}`} onClick={onClose}>
      <section
        class={`vif-panel ${cls ?? ''}`}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        role="dialog"
        aria-modal="true"
        onClick={stop}
        onWheel={(e) => e.stopPropagation()}
      >
        <header class="vif-panel__head">
          <h2 class="vif-panel__title">{title}</h2>
          <button
            type="button"
            class="vif-close"
            onClick={onClose}
            title={`${STR.close} (Esc)`}
            aria-label={STR.close}
          >
            ×
          </button>
        </header>
        <div class="vif-panel__body">{children}</div>
      </section>
    </div>
  );
}

// ---------- abas ----------

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: T; label: ComponentChildren; hotkey?: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div class="vif-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          class={`vif-tab ${t.id === active ? 'vif-tab--on' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.hotkey && <span class="vif-btn__key">{t.hotkey}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- quantidade ----------

export function QtyStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) =>
    onChange(Math.min(Math.max(Math.floor(v) || min, min), Math.max(min, max)));
  return (
    <div class="vif-qty" aria-label={STR.qty}>
      <Button
        small
        variant="flat"
        onClick={() => set(value - 1)}
        disabled={value <= min}
        ariaLabel="−1"
      >
        −
      </Button>
      <input
        class="vif-qty__input"
        type="number"
        min={min}
        max={max}
        value={value}
        onInput={(e) => set(Number((e.target as HTMLInputElement).value))}
      />
      <Button
        small
        variant="flat"
        onClick={() => set(value + 1)}
        disabled={value >= max}
        ariaLabel="+1"
      >
        +
      </Button>
      <Button small variant="flat" onClick={() => set(max)} disabled={value >= max}>
        {STR.max}
      </Button>
    </div>
  );
}

// ---------- carta ----------

const FRAME_W = 215;
const FRAME_H = 311;
const ART_W = 132;
const ART_H = 192;

export interface CardViewProps {
  cardId: ItemId;
  /** Altura em px (a largura segue a proporção da moldura). */
  height: number;
  /** Espaço vazio do álbum: silhueta escura. */
  silhouette?: boolean;
  showName?: boolean;
  selected?: boolean;
  onClick?: () => void;
  title?: string;
  badge?: ComponentChildren;
}

/** Carta: arte ATRÁS da moldura da raridade, centrada no CARD_ART_SLOT; nome na faixa de baixo. */
export function CardView({
  cardId,
  height,
  silhouette,
  showName = true,
  selected,
  onClick,
  title,
  badge,
}: CardViewProps) {
  useAtlas();
  const def = CARDS_BY_ID.get(cardId);
  const k = height / FRAME_H;
  const w = Math.round(FRAME_W * k);
  if (!def) return <span class="vif-card" style={{ width: w, height }} />;
  const slot = CARD_ART_SLOT[def.frameKey as keyof typeof CARD_ART_SLOT];
  const frame = frameUrl(def.frameKey);
  const art = frameUrl(def.artKey);
  const cx = slot?.cx ?? FRAME_W / 2;
  const cy = slot?.cy ?? FRAME_H / 2;
  const name = buffName(def.buff);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      class={`vif-card vif-card--${def.rarity} ${silhouette ? 'vif-card--empty' : ''} ${selected ? 'vif-card--sel' : ''} ${onClick ? 'vif-card--click' : ''}`}
      style={{ width: w, height }}
      title={title ?? `${name} (${RARITY_NAMES[def.rarity]})`}
      onClick={onClick}
    >
      {art && (
        <img
          class="vif-card__art"
          src={art}
          alt=""
          draggable={false}
          style={{
            left: (cx - ART_W / 2) * k,
            top: (cy - ART_H / 2) * k,
            width: ART_W * k,
            height: ART_H * k,
          }}
        />
      )}
      {frame ? (
        <img
          class="vif-card__frame"
          src={frame}
          alt=""
          draggable={false}
          style={{ width: w, height }}
        />
      ) : (
        <span class="vif-card__noframe" />
      )}
      {showName && !silhouette && (
        <span
          class="vif-card__name"
          style={{
            fontSize: Math.max(
              9,
              Math.round(Math.min(height * 0.068, (w * 1.45) / Math.max(6, name.length))),
            ),
          }}
        >
          {name}
        </span>
      )}
      {badge}
    </Tag>
  );
}

// ---------- glifos pixel (SVG 8x8, sem depender de emoji/fonte) ----------

const GLYPHS: Record<string, string> = {
  // cada string: linhas de 8 colunas; '#' = pixel aceso
  lock: '..###...|.#...#..|.#...#..|#######.|###.###.|###.###.|#######.|........',
  clock: '..####..|.#....#.|#...#..#|#...#..#|#..##..#|#......#|.#....#.|..####..',
  check: '........|.......#|......##|#....##.|##..##..|.####...|..##....|........',
  steam: '..####..|.#....#.|#..##..#|#.#..#.#|#.#..#.#|#..##..#|.#....#.|..####..',
  warn: '...##...|...##...|..####..|..#..#..|.##..##.|.######.|##.##.##|########',
  arrow: '...#....|...##...|########|#########|########|...##...|...#....|........',
};

export function Glyph({ name, size = 14 }: { name: keyof typeof GLYPHS | string; size?: number }) {
  const rows = (GLYPHS[name] ?? '').split('|');
  const rects: JSX.Element[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '#' && x < 8)
        rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }),
  );
  return (
    <svg
      class={`vif-glyph vif-glyph--${name}`}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shape-rendering="crispEdges"
      aria-hidden="true"
      fill="currentColor"
    >
      {rects}
    </svg>
  );
}
