// Componentes sem DOM: os componentes puros (sem hooks) são chamados como funções e a árvore
// de vnodes do Preact é inspecionada. Lógica de painéis/atalhos/toasts/textos também aqui.

import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { BUFF_KINDS, CARDS, ERROR_CODES, buildAlbum } from '@vif/shared';
import { Glyph } from '../../src/ui/components';
import { Toasts, pushToast, type ToastItem } from '../../src/ui/Toasts';
import { keyAction } from '../../src/ui/keys';
import { panelFromEvent } from '../../src/ui/App';
import { sortedInventory } from '../../src/ui/panels/InventoryPanel';
import { mergeAlbum, sortCards } from '../../src/ui/panels/CardsPanel';
import { buffName, errorMessage, itemName, animalName, cardName } from '../../src/ui/strings';

type AnyNode = VNode<Record<string, unknown>> | string | number | null | undefined | boolean;

function walk(n: AnyNode | AnyNode[], visit: (v: VNode<Record<string, unknown>>) => void): void {
  if (Array.isArray(n)) return n.forEach((c) => walk(c, visit));
  if (!n || typeof n !== 'object') return;
  visit(n);
  walk(n.props.children as AnyNode | AnyNode[], visit);
}

function textOf(n: AnyNode | AnyNode[]): string {
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n !== 'object') return String(n);
  return textOf(n.props.children as AnyNode | AnyNode[]);
}

describe('ui/components (vnodes)', () => {
  it('Toasts: um botão por toast, com a classe do tipo e o texto', () => {
    const items: ToastItem[] = [
      { id: 1, kind: 'error', text: 'Moedas insuficientes.' },
      { id: 2, kind: 'success', text: 'Plantado!' },
    ];
    const tree = Toasts({ items, onDismiss: () => undefined }) as VNode<Record<string, unknown>>;
    const buttons: VNode<Record<string, unknown>>[] = [];
    walk(tree, (v) => {
      if (v.type === 'button') buttons.push(v);
    });
    expect(buttons).toHaveLength(2);
    expect(String(buttons[0]!.props.class)).toContain('vif-toast--error');
    expect(textOf(buttons[0]!)).toContain('Moedas insuficientes.');
  });

  it('Glyph: SVG 8×8 com pixels nítidos', () => {
    const svg = Glyph({ name: 'lock', size: 16 }) as VNode<Record<string, unknown>>;
    expect(svg.type).toBe('svg');
    expect(svg.props.viewBox).toBe('0 0 8 8');
    expect(svg.props['shape-rendering']).toBe('crispEdges');
    expect((svg.props.children as unknown[]).length).toBeGreaterThan(10);
  });
});

describe('ui/toasts', () => {
  it('não repete o mesmo texto e guarda no máximo 4', () => {
    let l: ToastItem[] = [];
    for (let i = 0; i < 6; i++) l = pushToast(l, { id: i, kind: 'info', text: `t${i}` });
    expect(l.map((t) => t.text)).toEqual(['t2', 't3', 't4', 't5']);
    expect(pushToast(l, { id: 9, kind: 'info', text: 't5' })).toHaveLength(4);
  });
});

describe('ui/keys', () => {
  it('I, C, L e Esc; ignora digitação e modificadores', () => {
    expect(keyAction({ key: 'i' })).toBe('inventory');
    expect(keyAction({ key: 'I' })).toBe('inventory');
    expect(keyAction({ key: 'c' })).toBe('cards');
    expect(keyAction({ key: 'l' })).toBe('shop');
    expect(keyAction({ key: 'Escape' })).toBe('close');
    expect(keyAction({ key: 'd' })).toBeNull(); // D é do layout (Fundação)
    expect(keyAction({ key: 'i', targetTag: 'INPUT' })).toBeNull();
    expect(keyAction({ key: 'Escape', targetTag: 'INPUT' })).toBe('close');
    expect(keyAction({ key: 'c', ctrlKey: true })).toBeNull();
    expect(keyAction({ key: 'i', repeat: true })).toBeNull();
  });
});

describe('ui/App: ui:open-panel', () => {
  it('aceita plant/unlock com slotId (no payload ou em params)', () => {
    expect(panelFromEvent({ panel: 'plant', slotId: 'plot_01' })).toEqual({
      id: 'plant',
      slotId: 'plot_01',
    });
    expect(panelFromEvent({ panel: 'unlock', params: { slotId: 'plot_05' } })).toEqual({
      id: 'unlock',
      slotId: 'plot_05',
    });
    expect(panelFromEvent({ panel: 'plant' })).toBeNull();
    expect(panelFromEvent({ panel: 'inventory' })).toEqual({ id: 'inventory', itemId: undefined });
    expect(panelFromEvent({ panel: 'extraction', params: { itemId: 'crop_carrot' } })).toEqual({
      id: 'extraction',
      itemId: 'crop_carrot',
    });
    expect(panelFromEvent({ panel: 'social' })).toBeNull();
  });
});

describe('ui/panels: dados', () => {
  it('inventário ordenado por tipo e filtrado, sem itens zerados', () => {
    const inv = sortedInventory(
      [
        ['seed_carrot', 5],
        ['crop_potato', 2],
        ['card_gold_common', 1],
        ['crop_carrot', 0],
        ['prod_egg', 3],
      ],
      'all',
    );
    expect(inv.map((e) => e.itemId)).toEqual([
      'crop_potato',
      'prod_egg',
      'seed_carrot',
      'card_gold_common',
    ]);
    expect(
      sortedInventory(
        [
          ['seed_carrot', 5],
          ['crop_potato', 2],
        ],
        'seed',
      ).map((e) => e.itemId),
    ).toEqual(['seed_carrot']);
  });

  it('cartas: raridade maior primeiro', () => {
    const mk = (id: string, cardId: string, t: number) => ({
      id,
      cardId,
      source: 'drop' as const,
      status: 'unused' as const,
      obtainedAt: t,
      usedAt: null,
    });
    const sorted = sortCards([
      mk('a', 'card_gold_common', 1),
      mk('b', 'card_luck_legendary', 2),
      mk('c', 'card_gold_rare', 3),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('álbum permanente: o servidor mantém o espaço mesmo sem cópia no inventário', () => {
    const server = buildAlbum((id) => (id.startsWith('card_gold_') ? 1 : 0));
    const local = buildAlbum(() => 0); // cópias foram para a Steam
    const merged = mergeAlbum(server, local);
    expect(merged.slots.filter((s) => s.copies > 0)).toHaveLength(5);
    expect(merged.completedLines).toEqual(['gold']);
    expect(merged.bonusPercent.gold).toBe(2);
  });
});

describe('ui/strings', () => {
  it('toda ErrorCode tem mensagem amigável', () => {
    for (const code of ERROR_CODES) expect(errorMessage(code).length).toBeGreaterThan(3);
    expect(errorMessage('STEAM_UNAVAILABLE')).toContain('Steam ainda não conectada');
  });

  it('nomes de itens, animais e cartas', () => {
    expect(itemName('crop_carrot')).toBe('Cenoura');
    expect(itemName('seed_watermelon')).toBe('Semente de melancia');
    expect(itemName('crop_artichoke')).toBe('Alcachofra'); // culturas futuras pelo ícone
    expect(itemName('seed_bell_pepper')).toBe('Semente de pimentão');
    expect(itemName('prod_wool')).toBe('Lã');
    expect(itemName('card_gold_rare')).toBe('Carta Ouro (Rara)');
    expect(animalName('animal_alpaca')).toBe('Alpaca');
    expect(cardName('luck', 'legendary')).toBe('Sorte (Lendária)');
    expect(buffName('clear_sky')).toBe('Céu limpo');
    expect(buffName('exploration')).toBe('Exploração');
  });

  it('todo buff e carta do catálogo tem nome', () => {
    for (const b of BUFF_KINDS) expect(buffName(b)).not.toBe('');
    for (const c of CARDS) expect(itemName(c.id)).toMatch(/^Carta /);
  });
});
