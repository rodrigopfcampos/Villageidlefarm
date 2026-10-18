// Gera o SQL do catálogo (supabase/seed.sql) a partir de @vif/shared: itens, culturas, animais, cartas,
// canteiros do layout do Tiled e as constantes de economia. Idempotente (upsert): pode rodar de novo
// sempre que o catálogo mudar. Usado pelo CLI gen-seed.ts e pelos testes de banco.

import {
  BUFF_KINDS,
  CATALOG,
  ECONOMY,
  NIGHT_EVENT,
  RARITIES,
  STARTER_KIT,
  type Catalog,
  type PlotSlotDef,
} from '../../packages/shared/src/index';

export interface SeedInput {
  slots: readonly PlotSlotDef[];
  catalog?: Catalog;
  /** Ponte com a Steam ligada (STEAM_UNAVAILABLE quando false). */
  steamBridgeEnabled?: boolean;
}

function lit(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`número inválido no seed: ${v}`);
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

function json(v: unknown): string {
  return `${lit(JSON.stringify(v))}::jsonb`;
}

function upsert(table: string, key: string, cols: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '';
  const values = rows.map((r) => `  (${r.map(lit).join(', ')})`).join(',\n');
  const keys = key.split(',').map((k) => k.trim());
  const updates = cols
    .filter((c) => !keys.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return (
    `insert into public.${table} (${cols.join(', ')}) values\n${values}\n` +
    `on conflict (${key}) do update set ${updates};\n`
  );
}

export function generateSeedSql(input: SeedInput): string {
  const c = input.catalog ?? CATALOG;
  const cfg = c.cards;
  const instant = new Map(cfg.buffs.map((b) => [b.kind, b.instant]));
  const out: string[] = [
    '-- GERADO por tools/seed/gen-seed.ts a partir de packages/shared (catálogo) e do layout do Tiled.',
    '-- NÃO edite à mão: mude o catálogo/layout e rode `pnpm db:seed`.',
    '',
  ];

  out.push(
    upsert(
      'items',
      'id',
      [
        'id',
        'kind',
        'rarity',
        'base_price',
        'sell_price',
        'shop_buyable',
        'stackable',
        'steam_extractable',
        'sprite_key',
        'sort_order',
      ],
      c.items.map((i, n) => [
        i.id,
        i.kind,
        i.rarity,
        i.basePrice,
        i.sellPrice,
        i.shopBuyable,
        i.stackable,
        i.steamExtractable,
        i.spriteKey,
        n,
      ]),
    ),
  );

  out.push(
    upsert(
      'crop_defs',
      'crop_id',
      [
        'crop_id',
        'seed_item_id',
        'yield_item_id',
        'grow_seconds',
        'yield_min',
        'yield_max',
        'xp',
        'unlock_level',
      ],
      c.crops.map((cr) => [
        cr.cropId,
        cr.seedItemId,
        cr.yieldItemId,
        cr.growSeconds,
        cr.yieldMin,
        cr.yieldMax,
        cr.xp,
        cr.unlockLevel,
      ]),
    ),
  );

  out.push(
    upsert(
      'animal_defs',
      'animal_type',
      [
        'animal_type',
        'buy_price',
        'product_item_id',
        'produce_seconds',
        'max_stock',
        'habitat',
        'xp',
        'unlock_level',
      ],
      c.animals.map((a) => [
        a.animalType,
        a.buyPrice,
        a.productItemId,
        a.produceSeconds,
        a.maxStock,
        a.habitat,
        a.xp,
        a.unlockLevel,
      ]),
    ),
  );

  out.push(
    upsert(
      'card_defs',
      'id',
      [
        'id',
        'buff',
        'rarity',
        'duration_seconds',
        'magnitude',
        'instant',
        'buff_sort',
        'rarity_sort',
        'sort_order',
      ],
      cfg.cards.map((card, n) => [
        card.id,
        card.buff,
        card.rarity,
        card.durationSeconds,
        card.magnitude,
        instant.get(card.buff) ?? false,
        BUFF_KINDS.indexOf(card.buff),
        RARITIES.indexOf(card.rarity),
        n,
      ]),
    ),
  );

  out.push(
    upsert(
      'plot_slots',
      'slot_id',
      ['slot_id', 'unlock_cost', 'unlock_level', 'starts_unlocked', 'sort_order'],
      input.slots.map((s, n) => [s.slotId, s.unlockCost, s.unlockLevel, s.startsUnlocked, n]),
    ),
  );

  const config: [string, unknown][] = [
    ['economy', ECONOMY],
    ['night_event', NIGHT_EVENT],
    ['starter', STARTER_KIT],
    [
      'cards',
      {
        dropChancePerPlotHour: cfg.dropChancePerPlotHour,
        rarityWeights: cfg.rarityWeights,
        durationSeconds: cfg.durationSeconds,
        album: cfg.album,
      },
    ],
    ['steam', { bridgeEnabled: input.steamBridgeEnabled ?? true }],
  ];
  out.push(
    `insert into public.game_config (key, value) values\n` +
      config.map(([k, v]) => `  (${lit(k)}, ${json(v)})`).join(',\n') +
      `\non conflict (key) do update set value = excluded.value;\n`,
  );

  return out.join('\n');
}
