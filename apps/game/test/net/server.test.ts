// Testes só do servidor (Postgres com as migrations): segurança (RLS, privilégios, search_path),
// ledger/idempotência, concorrência, cadastro, catálogo e o fluxo da Steam (pending → granted/failed).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CATALOG, ECONOMY, RARITIES, levelForXp, type ErrorCode } from '@vif/shared';
import { SupabaseApi, type RpcResponse } from '../../src/net/api';
import { pgRpcClient, startTestDb, type TestDb } from './support/db';
import { serverHarness } from './support/harness';

const db = await startTestDb();
afterAll(async () => {
  await db?.stop();
});

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** Roda SQL como um papel do cliente (authenticated/anon), com o JWT do jogador. */
async function asRole(
  d: TestDb,
  role: 'authenticated' | 'anon',
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[] } | { error: { code?: string; message: string } }> {
  const c = await d.admin.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role } : { role }),
    ]);
    await c.query(`set local role ${role}`);
    const r = await c.query(sql, params);
    await c.query('rollback');
    return { rows: r.rows };
  } catch (err) {
    await c.query('rollback').catch(() => undefined);
    const e = err as { code?: string; message: string };
    return { error: { code: e.code, message: e.message } };
  } finally {
    c.release();
  }
}

/** Códigos dos pedidos que falharam (com a mensagem quando não for um código conhecido). */
function rejectedCodes(results: PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((r) => {
    if (r.status !== 'rejected') return [];
    const e = r.reason as { code: string; message: string };
    return [e.code === 'UNKNOWN' ? `UNKNOWN: ${e.message}` : e.code];
  });
}

function codeOf(r: RpcResponse): ErrorCode | 'OK' {
  if (!r.error) return 'OK';
  const m = r.error.message.match(/\b[A-Z][A-Z_]{2,}\b/);
  return (m?.[0] ?? 'UNKNOWN') as ErrorCode;
}

describe.skipIf(!db)('servidor: segurança', () => {
  const d = db!;
  const make = serverHarness(d);

  it('RLS ligado em TODAS as tabelas de public e private', async () => {
    const r = await d.admin.query(
      `select n.nspname || '.' || c.relname as t, c.relrowsecurity as rls
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(20);
    expect(r.rows.filter((x) => !x.rls).map((x) => x.t)).toEqual([]);
  });

  it('toda função security definer (e toda função nossa) tem search_path vazio', async () => {
    const r = await d.admin.query(
      `select n.nspname || '.' || p.proname as f, p.prosecdef as definer, p.proconfig as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')`,
    );
    const definers = r.rows.filter((x) => x.definer);
    expect(definers.length).toBeGreaterThanOrEqual(20);
    const bad = r.rows.filter(
      (x) =>
        !((x.cfg as string[] | null) ?? []).some(
          (c) => c === 'search_path=""' || c === 'search_path=',
        ),
    );
    expect(bad.map((x) => x.f)).toEqual([]);
  });

  it('anon/authenticated não têm INSERT/UPDATE/DELETE/TRUNCATE em nenhuma tabela', async () => {
    const r = await d.admin.query(
      `select c.relname as t, r.rolname as role
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('anon'), ('authenticated')) as r(rolname)
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and has_table_privilege(r.rolname, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')`,
    );
    expect(r.rows).toEqual([]);
  });

  it('update/insert/delete direto em wallets e inventory falha para authenticated', async () => {
    const h = await make();
    for (const sql of [
      `update public.wallets set coins = 999999 where player_id = '${h.playerId}'`,
      `insert into public.wallets (player_id, coins) values ('${h.playerId}', 5)`,
      `update public.inventory set qty = 999 where player_id = '${h.playerId}'`,
      `insert into public.inventory (player_id, item_id, qty) values ('${h.playerId}', 'crop_watermelon', 99)`,
      `delete from public.inventory where player_id = '${h.playerId}'`,
      `update public.profiles set vip = true, xp = 99999 where id = '${h.playerId}'`,
      `update public.plots set ready_fc = 0`,
      `insert into public.ledger (player_id, request_id, op) values ('${h.playerId}', 'x', 'hack')`,
    ]) {
      const r = await asRole(d, 'authenticated', h.playerId, sql);
      expect(r, sql).toMatchObject({ error: { code: '42501' } });
    }
    expect((await h.inspect()).coins).toBe(100);
  });

  it('RLS: cada jogador só lê o que é dele; anon não lê dados de jogador', async () => {
    const a = await make();
    const b = await make();
    const r = await asRole(d, 'authenticated', a.playerId, `select player_id from public.wallets`);
    expect(r).toEqual({ rows: [{ player_id: a.playerId }] });
    const inv = await asRole(
      d,
      'authenticated',
      a.playerId,
      `select * from public.inventory where player_id = $1`,
      [b.playerId],
    );
    expect(inv).toEqual({ rows: [] });
    expect(await asRole(d, 'anon', null, `select * from public.wallets`)).toMatchObject({
      error: { code: '42501' },
    });
    const cat = await asRole(d, 'anon', null, `select count(*)::int as n from public.items`);
    expect(cat).toEqual({ rows: [{ n: CATALOG.items.length }] });
  });

  it('RPCs: anon só pode get_server_time; funções internas e extraction_complete ficam fechadas', async () => {
    const h = await make();
    const anon = pgRpcClient(d.admin, () => ({ uid: null, role: 'anon' }));
    expect(codeOf(await anon.rpc('bootstrap'))).toBe('UNKNOWN'); // permission denied (42501)
    expect((await anon.rpc('bootstrap')).error?.code).toBe('42501');
    expect((await anon.rpc('get_server_time')).error).toBeNull();
    const user = pgRpcClient(d.admin, () => ({ uid: h.playerId }));
    const fake = '00000000-0000-4000-8000-000000000000';
    const r = await user.rpc('extraction_complete', {
      extraction_id: fake,
      ok: true,
      steam_item_id: 'x',
    });
    expect(r.error?.code).toBe('42501');
    const priv = await asRole(
      d,
      'authenticated',
      h.playerId,
      `select private.add_coins($1, 1000, 'x')`,
      [h.playerId],
    );
    expect(priv).toMatchObject({ error: { code: '42501' } });
    // authenticated sem "sub" no JWT
    const nobody = pgRpcClient(d.admin, () => ({ uid: null }));
    expect(codeOf(await nobody.rpc('bootstrap'))).toBe('NOT_AUTHENTICATED');
  });

  it('checks do banco: moedas e quantidades nunca negativas, mesmo para o superusuário', async () => {
    const h = await make();
    await expect(
      d.admin.query(`update public.wallets set coins = -1 where player_id = $1`, [h.playerId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      d.admin.query(`update public.inventory set qty = -1 where player_id = $1`, [h.playerId]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe.skipIf(!db)('servidor: ledger e idempotência', () => {
  const d = db!;
  const make = serverHarness(d);

  it('cada mutação grava 1 linha no ledger com os deltas; falha não grava; repetido não duplica', async () => {
    const h = await make();
    const id = h.rid();
    await h.api.shopBuy({ itemId: 'seed_carrot', qty: 3, requestId: id });
    await expect(
      h.api.shopBuy({ itemId: 'seed_carrot', qty: 3, requestId: id }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_REQUEST',
    });
    const failId = h.rid();
    await expect(
      h.api.shopBuy({ itemId: 'seed_watermelon', qty: 5, requestId: failId }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    const rows = (
      await d.admin.query(
        `select request_id, op, delta_coins, delta_items from public.ledger where player_id = $1 order by id`,
        [h.playerId],
      )
    ).rows;
    expect(rows).toEqual([
      { request_id: id, op: 'shop_buy', delta_coins: -12, delta_items: { seed_carrot: 3 } },
    ]);
  });

  it('20 pedidos simultâneos com o MESMO request_id: 1 sucesso, 19 DUPLICATE_REQUEST', async () => {
    const h = await make({ starter: { coins: 1000, items: [] } });
    const id = h.rid();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        h.api.shopBuy({ itemId: 'seed_carrot', qty: 1, requestId: id }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const codes = rejectedCodes(results);
    expect(new Set(codes)).toEqual(new Set(['DUPLICATE_REQUEST']));
    expect((await h.inspect()).coins).toBe(996);
  });
});

describe.skipIf(!db)('servidor: concorrência', { timeout: 30_000 }, () => {
  const d = db!;
  const make = serverHarness(d);

  it('20 colheitas simultâneas do mesmo canteiro: exatamente 1 sucesso', async () => {
    const h = await make();
    await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: h.rid() });
    h.clock.advanceSeconds(120);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => h.api.harvest({ slotId: 'plot_01', requestId: h.rid() })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const codes = rejectedCodes(results);
    expect(new Set(codes)).toEqual(new Set(['SLOT_EMPTY']));
    const s = await h.inspect();
    expect(s.inventory.crop_carrot).toBe(1);
    expect(s.xp).toBe(1);
  });

  it('20 ativações simultâneas da mesma carta: exatamente 1 sucesso', async () => {
    const h = await make();
    const card = await h.grantCard('card_gold_common');
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        h.api.cardActivate({ instanceId: card.id, requestId: h.rid() }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const codes = rejectedCodes(results);
    expect(new Set(codes)).toEqual(new Set(['CARD_ALREADY_USED']));
    expect((await h.inspect()).inventory.card_gold_common).toBe(1);
    const w = await d.admin.query(
      `select count(*)::int as n from public.buff_windows where player_id = $1`,
      [h.playerId],
    );
    expect(w.rows[0].n).toBe(1);
  });

  it('20 ativações simultâneas de cartas diferentes (sem VIP): só 1 ocupa a vaga', async () => {
    const h = await make();
    const kinds = [
      'gold',
      'luck',
      'farm_xp',
      'account_xp',
      'animals',
      'merchant',
      'bountiful_harvest',
    ];
    const cards = await Promise.all(
      Array.from({ length: 20 }, (_, i) => h.grantCard(`card_${kinds[i % kinds.length]}_common`)),
    );
    const results = await Promise.allSettled(
      cards.map((c) => h.api.cardActivate({ instanceId: c.id, requestId: h.rid() })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('20 retiradas simultâneas (VIP, limite 4): exatamente 4 saem e o inventário bate', async () => {
    const h = await make({
      xp: 500,
      vip: true,
      starter: { coins: 0, items: [{ itemId: 'crop_potato', qty: 10 }] },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        h.api.extractionRequest({ itemId: 'crop_potato', qty: 1, requestId: h.rid() }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
      ECONOMY.EXTRACTION_LIMIT_VIP,
    );
    expect((await h.inspect()).inventory.crop_potato).toBe(6);
  });
});

describe.skipIf(!db)('servidor: Steam (stub)', () => {
  const d = db!;
  const make = serverHarness(d);

  async function complete(id: string, ok: boolean, steamItemId?: string) {
    const svc = pgRpcClient(d.admin, () => ({ uid: null, role: 'service_role' }));
    return svc.rpc('extraction_complete', {
      extraction_id: id,
      ok,
      steam_item_id: steamItemId ?? null,
      error_message: ok ? null : 'steam recusou',
    });
  }

  it('retirada fica pending (escrow); granted cria o item Steam e o aviso; dá para trazer de volta', async () => {
    const h = await make({
      xp: 500,
      starter: { coins: 0, items: [{ itemId: 'crop_carrot', qty: 2 }] },
    });
    const r = await h.api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: h.rid() });
    expect(r.extraction.status).toBe('pending');
    expect(r.extraction.steamItemId).toBeUndefined();
    const g = await complete(r.extraction.id, true, 'steam-777');
    expect(g.error).toBeNull();
    expect(g.data).toMatchObject({ status: 'granted', steamItemId: 'steam-777' });
    // repetir não muda nada (idempotente)
    expect((await complete(r.extraction.id, false)).data).toMatchObject({ status: 'granted' });
    const n = await d.admin.query(
      `select kind, payload from public.notifications where user_id = $1`,
      [h.playerId],
    );
    expect(n.rows).toEqual([
      {
        kind: 'extraction_granted',
        payload: {
          extractionId: r.extraction.id,
          itemId: 'crop_carrot',
          qty: 1,
          steamItemId: 'steam-777',
        },
      },
    ]);
    const back = await h.api.steamReturnSync({ steamItemIds: ['steam-777'], requestId: h.rid() });
    expect(back.inventoryChanges).toEqual([{ itemId: 'crop_carrot', qty: 2 }]);
  });

  it('failed devolve o item do escrow e libera a cota', async () => {
    const h = await make({
      xp: 500,
      starter: { coins: 0, items: [{ itemId: 'crop_carrot', qty: 1 }] },
    });
    const r = await h.api.extractionRequest({ itemId: 'crop_carrot', qty: 1, requestId: h.rid() });
    expect((await h.inspect()).inventory.crop_carrot).toBeUndefined();
    expect((await complete(r.extraction.id, false)).data).toMatchObject({ status: 'failed' });
    expect((await h.inspect()).inventory.crop_carrot).toBe(1);
    expect(await h.api.extractionQuota()).toMatchObject({ used: 0, nextSlotAt: null });
  });

  it('a volta não aceita item Steam de outro jogador', async () => {
    const a = await make();
    const b = await make();
    const id = await a.mockSteamGrant('crop_pumpkin');
    await expect(
      b.api.steamReturnSync({ steamItemIds: [id], requestId: b.rid() }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe.skipIf(!db)('servidor: regras de ECONOMIA.md', () => {
  const d = db!;
  const make = serverHarness(d);

  it('álbum permanente: retirar a cópia para a Steam não tira o card nem o bônus da linha', async () => {
    const h = await make({ xp: 500, timezone: 'UTC' });
    for (const r of RARITIES) {
      const c = await h.grantCard(`card_gold_${r}`);
      await h.api.cardActivate({ instanceId: c.id, requestId: h.rid() });
      h.clock.advanceSeconds(3 * 3600);
      await h.api.heartbeat();
    }
    await h.api.extractionRequest({ itemId: 'card_gold_rare', qty: 1, requestId: h.rid() });
    expect((await h.inspect()).inventory.card_gold_rare).toBeUndefined();
    const album = await h.api.albumGet();
    expect(album.completedLines).toEqual(['gold']);
    expect(album.slots.find((s) => s.cardId === 'card_gold_rare')?.copies).toBe(1);
  });

  it('XP único: accountXp/accountLevel repetem o XP da fazenda', async () => {
    const h = await make({ xp: 140 });
    const c = await h.grantCard('card_account_xp_common');
    await h.api.cardActivate({ instanceId: c.id, requestId: h.rid() });
    await h.api.plant({ slotId: 'plot_01', seedItemId: 'seed_carrot', requestId: h.rid() });
    h.clock.advanceSeconds(120);
    const r = await h.api.harvest({ slotId: 'plot_01', requestId: h.rid() });
    expect(r.xp).toMatchObject({ accountXp: r.xp!.xp, accountLevel: r.xp!.level });
    expect([141, 142]).toContain(r.xp!.xp); // carta de "XP de conta" vale para o XP único
  });

  it('a curva de nível vem do seed (game_config.levels), igual a @vif/shared', async () => {
    for (const xp of [0, 49, 50, 149, 150, 500, 12_345]) {
      const r = await d.admin.query(`select private.level_for_xp($1) as l`, [xp]);
      expect(r.rows[0].l, String(xp)).toBe(levelForXp(xp));
    }
  });

  it('buffs novos (ex.: clear_sky) entram só como dados do catálogo', async () => {
    const c = await d.admin.connect();
    try {
      await c.query('begin');
      await c.query(
        `insert into public.items (id, kind, rarity, base_price, steam_extractable) values ('card_clear_sky_common', 'card', 'common', 0, true);
         insert into public.card_defs (id, buff, rarity, duration_seconds, magnitude, instant, buff_sort, rarity_sort, sort_order)
         values ('card_clear_sky_common', 'clear_sky', 'common', 3600, 0.5, false, 99, 0, 99)`,
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe.skipIf(!db)('servidor: cadastro e catálogo', () => {
  const d = db!;

  it('o gatilho de cadastro cria perfil, carteira, fazenda, canteiros e kit; fuso inválido vira padrão', async () => {
    const uid = '11111111-1111-4111-8111-111111111111';
    await d.admin.query(`delete from auth.users where id = $1`, [uid]);
    await d.admin.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [
      uid,
      JSON.stringify({ timezone: 'Lua/Base', nickname: 'Zé' }),
    ]);
    const api = new SupabaseApi(pgRpcClient(d.admin, () => ({ uid })));
    const b = await api.bootstrap();
    expect(b.profile).toMatchObject({ nickname: 'Zé', timezone: 'America/Sao_Paulo', level: 1 });
    expect(b.wallet).toEqual({ coins: 100, gems: 0 });
    expect(b.inventory).toEqual([{ itemId: 'seed_carrot', qty: 5 }]);
    const slots = await d.admin.query(`select count(*)::int as n from public.plot_slots`);
    expect(b.farm.plots).toHaveLength(slots.rows[0].n);
    await d.admin.query(`delete from auth.users where id = $1`, [uid]);
  });

  it('o catálogo no banco é o de @vif/shared (seed gerado)', async () => {
    const items = await d.admin.query(
      `select id, base_price, sell_price, steam_extractable from public.items`,
    );
    expect(items.rows).toHaveLength(CATALOG.items.length);
    for (const i of CATALOG.items) {
      expect(items.rows.find((r) => r.id === i.id)).toEqual({
        id: i.id,
        base_price: i.basePrice,
        sell_price: i.sellPrice,
        steam_extractable: i.steamExtractable,
      });
    }
    const cards = await d.admin.query(`select count(*)::int as n from public.card_defs`);
    expect(cards.rows[0].n).toBe(40);
    const crops = await d.admin.query(
      `select crop_id, grow_seconds from public.crop_defs order by grow_seconds`,
    );
    expect(crops.rows.map((r) => r.grow_seconds)).toEqual(
      [...CATALOG.crops].map((c) => c.growSeconds).sort((a, b) => a - b),
    );
  });

  it('o seed.sql gerado bate com o catálogo atual (rode `pnpm db:seed` se falhar)', async () => {
    const committed = readFileSync(join(repoRoot, 'supabase/seed.sql'), 'utf8');
    for (const i of CATALOG.items) expect(committed).toContain(`'${i.id}'`);
  });
});

// pgTAP (supabase/tests/*.test.sql): roda na CI com `supabase test db`. Localmente, só se houver o
// código do pgTAP (VIF_PGTAP_SQL=/caminho/para/pgtap.sql.in).
const pgtapSource = process.env.VIF_PGTAP_SQL;
describe.skipIf(!db || !pgtapSource || db.external)('servidor: pgTAP (local)', () => {
  it('supabase/tests/*.test.sql passam', async () => {
    const d = db!;
    const src = readFileSync(pgtapSource!, 'utf8')
      .replace(/__OS__/g, 'linux')
      .replace(/__VERSION__/g, '1.33');
    await d.admin.query(`create schema if not exists extensions`);
    await d.admin.query(`set search_path = extensions, public; ${src}; reset search_path;`);
    // como no Supabase: o schema extensions é visível para os papéis do cliente
    await d.admin.query(
      `grant usage on schema extensions to anon, authenticated, service_role;
       grant execute on all functions in schema extensions to anon, authenticated, service_role;`,
    );
    const dir = join(repoRoot, 'supabase/tests');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.sql'))) {
      const sql = readFileSync(join(dir, f), 'utf8').replace(
        /create extension[^;]*pgtap[^;]*;/i,
        '',
      );
      const c = await d.admin.connect();
      try {
        await c.query('set search_path = public, extensions');
        const res = (await c.query(sql)) as unknown as { rows: Record<string, string>[] }[];
        const lines = res.flatMap((r) => (r.rows ?? []).flatMap((row) => Object.values(row)));
        const out = lines.join('\n');
        expect(out, f).not.toMatch(/^not ok/m);
        expect(out, f).toMatch(/^ok \d+/m);
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset search_path').catch(() => undefined);
        c.release();
      }
    }
  });
});
