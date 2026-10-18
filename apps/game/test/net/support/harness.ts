// "Mesa de teste" comum à API falsa e ao servidor real: os mesmos cenários rodam contra os dois.
// Cada harness = 1 jogador novo, com relógio falso próprio e ajudas de teste (dar carta, VIP, inspecionar).

import { randomUUID } from 'node:crypto';
import type {
  CardInstance,
  IApi,
  InventoryEntry,
  ItemId,
  PlotSlotDef,
  PlotState,
} from '@vif/shared';
import { SupabaseApi } from '../../../src/net/api';
import { DEFAULT_SLOTS, FakeClock, MockApi } from '../../../src/net/mockApi';
import { pgRpcClient, type TestDb } from './db';

export interface HarnessOptions {
  /** Instante inicial do relógio falso (ms Unix). */
  start?: number;
  timezone?: string;
  starter?: { coins: number; gems?: number; items: readonly InventoryEntry[] };
  /** XP de fazenda inicial (500 = nível 5). */
  xp?: number;
  vip?: boolean;
  slots?: PlotSlotDef[];
  steamAvailable?: boolean;
}

export interface Inspect {
  coins: number;
  inventory: Record<string, number>;
  farmClock: number;
  level: number;
  xp: number;
  plots: PlotState[];
}

export interface Harness {
  kind: 'mock' | 'server';
  api: IApi;
  clock: FakeClock;
  /** request_id novo (UUID). */
  rid(): string;
  grantCard(cardId: ItemId): Promise<CardInstance>;
  setVip(vip: boolean): Promise<void>;
  setSteamAvailable(available: boolean): void;
  /** Item que apareceu no inventário Steam do jogador (ex.: comprado no mercado da Steam). */
  mockSteamGrant(itemId: ItemId, qty?: number): Promise<string>;
  inspect(): Promise<Inspect>;
  /** Id do jogador (servidor) — só para testes do servidor. */
  playerId: string;
}

export type HarnessFactory = (opts?: HarnessOptions) => Promise<Harness>;

export const DEFAULT_START = Date.UTC(2026, 0, 1, 12, 0, 0);

function counterUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

// ---------------------------------------------------------------------
// API falsa
// ---------------------------------------------------------------------

export const mockHarness: HarnessFactory = async (opts = {}) => {
  const clock = new FakeClock(opts.start ?? DEFAULT_START);
  const api = new MockApi({
    clock,
    timezone: opts.timezone,
    starter: opts.starter,
    xp: opts.xp,
    vip: opts.vip,
    slots: opts.slots,
    steamAvailable: opts.steamAvailable,
  });
  let n = 0;
  return {
    kind: 'mock',
    api,
    clock,
    playerId: 'mock-player',
    rid: () => counterUuid(++n),
    grantCard: async (id) => api.grantCard(id),
    setVip: async (v) => api.setVip(v),
    setSteamAvailable: (v) => api.setSteamAvailable(v),
    mockSteamGrant: async (id, qty) => api.mockSteamGrant(id, qty),
    inspect: async () => {
      const s = api.inspect();
      return {
        coins: s.coins,
        inventory: s.inventory,
        farmClock: s.farmClock,
        level: s.level,
        xp: s.xp,
        plots: s.plots,
      };
    },
  };
};

// ---------------------------------------------------------------------
// Servidor real (Postgres com as migrations)
// ---------------------------------------------------------------------

export function serverHarness(db: TestDb): HarnessFactory {
  let steamSeq = 0;
  return async (opts = {}) => {
    const clock = new FakeClock(opts.start ?? DEFAULT_START);
    const uid = randomUUID();
    let steamAvailable = opts.steamAvailable ?? true;
    const slots = opts.slots && opts.slots.length > 0 ? opts.slots : [...DEFAULT_SLOTS];

    const c = await db.admin.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('vif.fake_now', $1, true)`, [
        new Date(clock.now()).toISOString(),
      ]);
      // cadastro (o gatilho cria perfil, carteira, fazenda, canteiros e kit inicial)
      await c.query(
        `insert into auth.users (id, aud, role, raw_user_meta_data) values ($1, 'authenticated', 'authenticated', $2)`,
        [uid, JSON.stringify({ timezone: opts.timezone ?? 'America/Sao_Paulo' })],
      );
      // canteiros do teste: define os slots e deixa o jogador só com eles
      for (const [i, s] of slots.entries()) {
        await c.query(
          `insert into public.plot_slots (slot_id, unlock_cost, unlock_level, starts_unlocked, sort_order)
           values ($1, $2, $3, $4, $5)
           on conflict (slot_id) do update set unlock_cost = excluded.unlock_cost,
             unlock_level = excluded.unlock_level, starts_unlocked = excluded.starts_unlocked,
             sort_order = excluded.sort_order`,
          [s.slotId, s.unlockCost, s.unlockLevel, s.startsUnlocked, i],
        );
      }
      const farm = (await c.query(`select id from public.farms where owner_id = $1`, [uid])).rows[0]
        .id as string;
      await c.query(`delete from public.plots where farm_id = $1 and not (slot_id = any($2))`, [
        farm,
        slots.map((s) => s.slotId),
      ]);
      for (const s of slots) {
        await c.query(
          `insert into public.plots (farm_id, slot_id, unlocked) values ($1, $2, $3)
           on conflict (farm_id, slot_id) do update set unlocked = excluded.unlocked`,
          [farm, s.slotId, s.startsUnlocked],
        );
      }
      if (opts.starter) {
        await c.query(`update public.wallets set coins = $2, gems = $3 where player_id = $1`, [
          uid,
          opts.starter.coins,
          opts.starter.gems ?? 0,
        ]);
        await c.query(`delete from public.inventory where player_id = $1`, [uid]);
        for (const it of opts.starter.items) {
          if (it.qty > 0) {
            await c.query(
              `insert into public.inventory (player_id, item_id, qty) values ($1, $2, $3)`,
              [uid, it.itemId, it.qty],
            );
          }
        }
      }
      if (opts.xp) {
        await c.query(
          `update public.profiles set xp = $2, level = private.level_for_xp($2) where id = $1`,
          [uid, opts.xp],
        );
      }
      if (opts.vip) await c.query(`update public.profiles set vip = true where id = $1`, [uid]);
      await c.query('commit');
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }

    const api = new SupabaseApi(
      pgRpcClient(db.admin, () => ({ uid, nowMs: clock.now(), steamAvailable })),
    );
    let n = 0;
    return {
      kind: 'server',
      api,
      clock,
      playerId: uid,
      rid: () => counterUuid(++n),
      async grantCard(cardId) {
        const r = await db.admin.query(
          `with c as (
             insert into public.card_instances (owner_id, card_id, source, status, obtained_at)
             values ($1, $2, 'system', 'unused', $3) returning *)
           select private.card_json(c) as card from c`,
          [uid, cardId, new Date(clock.now()).toISOString()],
        );
        return r.rows[0].card as CardInstance;
      },
      async setVip(vip) {
        await db.admin.query(`update public.profiles set vip = $2 where id = $1`, [uid, vip]);
      },
      setSteamAvailable(v) {
        steamAvailable = v;
      },
      async mockSteamGrant(itemId, qty = 1) {
        const id = `test-steam-${uid.slice(0, 8)}-${++steamSeq}`;
        await db.admin.query(
          `insert into public.steam_items (steam_item_id, player_id, item_id, qty) values ($1, $2, $3, $4)`,
          [id, uid, itemId, qty],
        );
        return id;
      },
      async inspect() {
        const r = await db.admin.query(
          `select w.coins, f.farm_clock_s as farm_clock, p.level, p.xp, f.id as farm_id,
                  (select coalesce(jsonb_object_agg(i.item_id, i.qty), '{}'::jsonb)
                     from public.inventory i where i.player_id = p.id and i.qty > 0) as inventory,
                  private.plots_json(f.id) as plots
             from public.profiles p
             join public.wallets w on w.player_id = p.id
             join public.farms f on f.owner_id = p.id
            where p.id = $1`,
          [uid],
        );
        const row = r.rows[0];
        return {
          coins: row.coins,
          inventory: row.inventory,
          farmClock: row.farm_clock,
          level: row.level,
          xp: row.xp,
          plots: row.plots,
        };
      },
    };
  };
}
