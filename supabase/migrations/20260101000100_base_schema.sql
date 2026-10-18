-- Village Idle Farm — esquema base (A2 Servidor).
-- Regras (docs/CONTRACTS.md, docs/DECISOES.md):
-- * RLS ligado em TODAS as tabelas; o cliente (anon/authenticated) só LÊ, e só o que é dele.
-- * Toda escrita passa por RPC `security definer` com `set search_path = ''` (migrations seguintes).
-- * Moedas e quantidades inteiras com check >= 0; ledger com request_id único por jogador.
-- * Tempos de produção no relógio da fazenda (farm_clock_s, segundos); instantes reais em timestamptz.

create schema if not exists private;
revoke all on schema private from public;
comment on schema private is 'Funções internas do servidor. Nunca exposto pela API.';

-- =====================================================================
-- Catálogo (leitura pública; escrito só pelo seed gerado por tools/seed)
-- =====================================================================

create table public.items (
  id text primary key,
  kind text not null check (kind in ('seed', 'crop', 'animal_product', 'decor', 'skin', 'card', 'currency')),
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  base_price bigint not null check (base_price >= 0),
  sell_price bigint check (sell_price >= 0),
  shop_buyable boolean not null default false,
  stackable boolean not null default true,
  steam_extractable boolean not null default false,
  sprite_key text not null default '',
  sort_order int not null default 0,
  -- loja nunca paga mais do que cobra (moeda infinita) e semente/moeda nunca sai para a Steam
  check (not shop_buyable or sell_price is null or sell_price <= base_price),
  check (not (steam_extractable and kind in ('seed', 'currency')))
);

create table public.crop_defs (
  crop_id text primary key references public.items (id),
  seed_item_id text not null unique references public.items (id),
  yield_item_id text not null references public.items (id),
  grow_seconds bigint not null check (grow_seconds > 0),
  yield_min int not null check (yield_min > 0),
  yield_max int not null check (yield_max >= yield_min),
  xp int not null check (xp >= 0),
  unlock_level int not null check (unlock_level >= 1)
);

create table public.animal_defs (
  animal_type text primary key,
  buy_price bigint not null check (buy_price > 0),
  product_item_id text not null references public.items (id),
  produce_seconds bigint not null check (produce_seconds > 0),
  max_stock int not null check (max_stock > 0),
  habitat text not null check (habitat in ('coop', 'barn', 'pond')),
  xp int not null check (xp >= 0),
  unlock_level int not null check (unlock_level >= 1)
);

-- 8 buffs × 5 raridades; cada carta também é um item (kind 'card' = cópia no álbum).
create table public.card_defs (
  id text primary key references public.items (id),
  -- sem lista fixa: buffs novos (ex.: clear_sky, exploration) entram só pelo seed do catálogo
  buff text not null,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  -- 0 = instantânea (Adubo): não ocupa vaga
  duration_seconds bigint not null check (duration_seconds >= 0),
  magnitude numeric not null check (magnitude > 0),
  instant boolean not null,
  buff_sort int not null,
  rarity_sort int not null,
  sort_order int not null,
  unique (buff, rarity)
);

-- Canteiros do layout do Tiled (fonte da verdade dos slotId).
create table public.plot_slots (
  slot_id text primary key,
  unlock_cost bigint not null check (unlock_cost >= 0),
  unlock_level int not null check (unlock_level >= 1),
  starts_unlocked boolean not null default false,
  sort_order int not null default 0
);

-- Constantes de economia (ECONOMY, NIGHT_EVENT, STARTER_KIT, cartas) vindas de @vif/shared pelo seed.
create table public.game_config (
  key text primary key,
  value jsonb not null
);

-- =====================================================================
-- Dados do jogador
-- =====================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  avatar text not null default 'farmer_m',
  timezone text not null,
  tz_changed_at timestamptz,
  -- VIP: microtransação Steam (fase de monetização). Só o servidor muda.
  vip boolean not null default false,
  -- XP único (docs/ECONOMIA.md): "XP de conta" é o mesmo XP da fazenda
  level int not null default 1 check (level >= 1),
  xp bigint not null default 0 check (xp >= 0),
  last_heartbeat_at timestamptz,
  -- última mutação bem-sucedida = interação real (presença no evento, anti-bot)
  last_interaction_at timestamptz,
  last_event_claim_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.wallets (
  player_id uuid primary key references public.profiles (id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  gems bigint not null default 0 check (gems >= 0)
);

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  farm_clock_s bigint not null default 0 check (farm_clock_s >= 0),
  clock_synced_at timestamptz not null,
  -- instante real da última sincronização (presença no evento sem contar duas vezes)
  last_sync_at timestamptz not null,
  expansion_level int not null default 0,
  visits_open boolean not null default true
);

create table public.plots (
  farm_id uuid not null references public.farms (id) on delete cascade,
  slot_id text not null references public.plot_slots (slot_id),
  unlocked boolean not null default false,
  crop_id text references public.crop_defs (crop_id),
  planted_fc bigint,
  ready_fc bigint,
  primary key (farm_id, slot_id),
  check ((crop_id is null) = (planted_fc is null) and (crop_id is null) = (ready_fc is null)),
  check (ready_fc is null or ready_fc >= planted_fc)
);

create table public.animals (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  farm_id uuid not null references public.farms (id) on delete cascade,
  animal_type text not null references public.animal_defs (animal_type),
  name text not null,
  last_collect_fc bigint not null check (last_collect_fc >= 0),
  created_at timestamptz not null default now()
);
create index animals_farm_idx on public.animals (farm_id, seq);

create table public.inventory (
  player_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.items (id),
  qty bigint not null check (qty >= 0),
  primary key (player_id, item_id)
);

-- Cartas ganhas (únicas). Usada → vira 1 unidade do item card_* (cópia no álbum).
create table public.card_instances (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  card_id text not null references public.card_defs (id),
  source text not null check (source in ('drop', 'night_event', 'system')),
  status text not null default 'unused' check (status in ('unused', 'used')),
  obtained_at timestamptz not null,
  used_at timestamptz,
  check ((status = 'used') = (used_at is not null))
);
create index card_instances_owner_idx on public.card_instances (owner_id, status, seq);

-- Álbum PERMANENTE (docs/ECONOMIA.md): toda carta usada entra aqui para sempre. Retirar a cópia
-- (item card_*) para a Steam não tira o card nem o bônus da linha.
create table public.album_entries (
  player_id uuid not null references public.profiles (id) on delete cascade,
  card_id text not null references public.card_defs (id),
  -- quantas vezes a carta foi usada (nunca diminui)
  copies bigint not null default 1 check (copies >= 1),
  first_at timestamptz not null,
  primary key (player_id, card_id)
);

-- Histórico de janelas de buff (inclui expiradas: colheitas longas ainda consultam).
create table public.buff_windows (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.profiles (id) on delete cascade,
  instance_id uuid not null unique references public.card_instances (id) on delete cascade,
  card_id text not null references public.card_defs (id),
  buff text not null,
  rarity text not null,
  magnitude numeric not null,
  started_fc bigint not null,
  ends_fc bigint not null check (ends_fc > started_fc),
  started_at timestamptz not null,
  ends_at timestamptz not null
);
create index buff_windows_player_idx on public.buff_windows (player_id, buff, ends_fc);

-- Ledger: 1 linha por mutação bem-sucedida. unique(player_id, request_id) = idempotência.
-- Só recebe inserções (ninguém fora das RPCs escreve; as RPCs só somam deltas na própria linha).
create table public.ledger (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  op text not null,
  delta_coins bigint not null default 0,
  -- { "<itemId>": delta, ... }
  delta_items jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (player_id, request_id)
);

-- Presença ativa no evento noturno por data LOCAL do jogador (segundos, com fração).
create table public.event_attendance (
  player_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  seconds numeric not null default 0 check (seconds >= 0),
  primary key (player_id, local_date)
);

create table public.event_claims (
  player_id uuid not null references public.profiles (id) on delete cascade,
  event_key text not null,
  local_date date not null,
  card_instance_id uuid references public.card_instances (id) on delete set null,
  claimed_at timestamptz not null,
  primary key (player_id, event_key, local_date)
);

-- Retiradas para a Steam (pending/granted/failed) e voltas (returned).
create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  player_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.items (id),
  qty bigint not null check (qty > 0),
  status text not null check (status in ('pending', 'granted', 'failed', 'returned')),
  steam_item_id text,
  request_id text,
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index extractions_player_idx on public.extractions (player_id, created_at);

-- Espelho do inventário Steam conferido pelo SERVIDOR (preenchido pela Edge Function da Steam).
-- A volta (steam_return_sync) só aceita ids que estejam aqui como 'in_steam' e sejam do jogador.
create table public.steam_items (
  steam_item_id text primary key,
  player_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.items (id),
  qty bigint not null check (qty > 0),
  status text not null default 'in_steam' check (status in ('in_steam', 'consumed')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index steam_items_player_idx on public.steam_items (player_id, status);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('extraction_granted', 'extraction_failed', 'steam_returned', 'visit_like', 'visit_help', 'system')),
  payload jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at);

-- =====================================================================
-- RLS: ligado em todas as tabelas. Só SELECT; escrita só pelas RPCs.
-- =====================================================================

alter table public.items enable row level security;
alter table public.crop_defs enable row level security;
alter table public.animal_defs enable row level security;
alter table public.card_defs enable row level security;
alter table public.plot_slots enable row level security;
alter table public.game_config enable row level security;
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.farms enable row level security;
alter table public.plots enable row level security;
alter table public.animals enable row level security;
alter table public.inventory enable row level security;
alter table public.card_instances enable row level security;
alter table public.album_entries enable row level security;
alter table public.buff_windows enable row level security;
alter table public.ledger enable row level security;
alter table public.event_attendance enable row level security;
alter table public.event_claims enable row level security;
alter table public.extractions enable row level security;
alter table public.steam_items enable row level security;
alter table public.notifications enable row level security;

-- catálogo: todos leem
create policy catalog_read on public.items for select to anon, authenticated using (true);
create policy catalog_read on public.crop_defs for select to anon, authenticated using (true);
create policy catalog_read on public.animal_defs for select to anon, authenticated using (true);
create policy catalog_read on public.card_defs for select to anon, authenticated using (true);
create policy catalog_read on public.plot_slots for select to anon, authenticated using (true);
create policy catalog_read on public.game_config for select to anon, authenticated using (true);

-- dados do jogador: só o dono lê
create policy own_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy own_read on public.wallets for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.farms for select to authenticated using (owner_id = (select auth.uid()));
create policy own_read on public.plots for select to authenticated
  using (farm_id in (select f.id from public.farms f where f.owner_id = (select auth.uid())));
create policy own_read on public.animals for select to authenticated
  using (farm_id in (select f.id from public.farms f where f.owner_id = (select auth.uid())));
create policy own_read on public.inventory for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.card_instances for select to authenticated using (owner_id = (select auth.uid()));
create policy own_read on public.album_entries for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.buff_windows for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.ledger for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.event_attendance for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.event_claims for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.extractions for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.steam_items for select to authenticated using (player_id = (select auth.uid()));
create policy own_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));

-- Privilégios: o Supabase dá ALL em tabelas novas para anon/authenticated por padrão. Tiramos tudo
-- e devolvemos só SELECT (a RLS acima filtra as linhas).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.items, public.crop_defs, public.animal_defs, public.card_defs, public.plot_slots,
  public.game_config to anon, authenticated;
grant select on public.profiles, public.wallets, public.farms, public.plots, public.animals, public.inventory,
  public.card_instances, public.album_entries, public.buff_windows, public.ledger, public.event_attendance, public.event_claims,
  public.extractions, public.steam_items, public.notifications to authenticated;

-- Realtime (canal user:{uid}): avisos de retirada/volta. A publicação existe em todo projeto Supabase.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
