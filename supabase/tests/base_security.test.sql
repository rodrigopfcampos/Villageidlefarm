-- pgTAP (roda com `supabase test db`): regras de segurança do esquema base (A2).
-- Os cenários de jogo (relógio, cartas, evento, retirada, concorrência) estão na suíte Vitest
-- apps/game/test/net/*.test.ts, que roda contra este mesmo banco na CI.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- 1) RLS ligado em todas as tabelas de public/private
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'RLS ligado em todas as tabelas'
);

-- 2) search_path vazio em toda função security definer
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='], false)),
  0,
  'search_path vazio em toda função security definer'
);

-- 3) nenhum INSERT/UPDATE/DELETE/TRUNCATE para anon/authenticated
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')),
  0,
  'cliente não escreve direto em nenhuma tabela'
);

-- 4) jogador de teste
insert into auth.users (id, aud, role, raw_user_meta_data)
values ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', '{"timezone":"UTC"}');

select is(
  (select coins::int from public.wallets where player_id = '22222222-2222-4222-8222-222222222222'),
  100,
  'gatilho de cadastro cria a carteira com o kit inicial'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select throws_ok(
  $$update public.wallets set coins = 999999 where player_id = '22222222-2222-4222-8222-222222222222'$$,
  '42501', null,
  'update direto em wallets falha para authenticated'
);

select throws_ok(
  $$insert into public.inventory (player_id, item_id, qty) values ('22222222-2222-4222-8222-222222222222', 'crop_watermelon', 99)$$,
  '42501', null,
  'insert direto em inventory falha para authenticated'
);

select is(
  (public.bootstrap() -> 'wallet' ->> 'coins')::int,
  100,
  'bootstrap pela RPC funciona e o saldo não mudou'
);

select throws_ok(
  $$select public.harvest('plot_01', 'pgtap-1')$$,
  'P0001', 'SLOT_EMPTY',
  'colher canteiro vazio = SLOT_EMPTY'
);

reset role;
select throws_ok(
  $$update public.wallets set coins = -1 where player_id = '22222222-2222-4222-8222-222222222222'$$,
  '23514', null,
  'saldo nunca negativo (check)'
);

select * from finish();
rollback;
