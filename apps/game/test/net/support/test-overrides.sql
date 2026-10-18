-- SÓ PARA TESTES (local e CI). Troca 3 funções internas por versões controláveis por transação:
--   vif.fake_now          → relógio falso (o FakeClock do teste)
--   vif.steam_available   → simula a ponte Steam fora do ar
--   private.unit(seed)    → sorteio determinístico (hash da semente) para os testes não oscilarem
-- Em produção essas funções são now(), a configuração do jogo e random().

create or replace function private.now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('vif.fake_now', true), '')::timestamptz, pg_catalog.now())
$$;

create or replace function private.steam_available()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('vif.steam_available', true), '')::boolean,
                  (private.cfg('steam') ->> 'bridgeEnabled')::boolean, false)
$$;

create or replace function private.unit(p_seed text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select ('x' || substr(md5(p_seed), 1, 8))::bit(32)::bigint / 4294967296.0
$$;

revoke all on function private.now(), private.steam_available(), private.unit(text) from public;
