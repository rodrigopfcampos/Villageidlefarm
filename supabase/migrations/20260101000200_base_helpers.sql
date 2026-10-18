-- Funções internas (schema private). Não são chamadas pelo cliente: só pelas RPCs security definer.
-- Todas com `set search_path = ''` (nomes sempre qualificados).

-- ---------------------------------------------------------------------
-- relógio, configuração, aleatório
-- ---------------------------------------------------------------------

-- Agora do servidor. Os testes substituem esta função por um relógio falso; em produção é now().
create or replace function private.now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select pg_catalog.now()
$$;

create or replace function private.ms(p_t timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select floor(extract(epoch from p_t) * 1000)::bigint
$$;

create or replace function private.cfg(p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select c.value from public.game_config c where c.key = p_key
$$;

create or replace function private.cfg_num(p_key text, p_field text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v numeric;
begin
  v := (private.cfg(p_key) ->> p_field)::numeric;
  if v is null then
    raise exception 'CONFIG_MISSING %.%', p_key, p_field;
  end if;
  return v;
end
$$;

-- Número em [0, 1). Em produção é random() (a semente é ignorada: o cliente escolhe o request_id e
-- não pode prever o sorteio). Os testes trocam por um hash determinístico da semente.
create or replace function private.unit(p_seed text)
returns double precision
language sql
volatile
set search_path = ''
as $$
  select random()
$$;

-- Arredondamento estocástico: 2,3 → 2 (70%) ou 3 (30%); a média é exata.
create or replace function private.sround(p_x numeric, p_u double precision)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select (floor(p_x) + case when p_u < (p_x - floor(p_x)) then 1 else 0 end)::bigint
$$;

-- Nível a partir do XP: xpForLevel(L) = 25 × (L−1) × L (igual a @vif/shared levelForXp).
create or replace function private.level_for_xp(p_xp bigint)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  l int := greatest(1, floor((1 + sqrt(1 + 4 * greatest(p_xp, 0) / 25.0)) / 2)::int);
begin
  while 25::bigint * l * (l + 1) <= p_xp loop
    l := l + 1;
  end loop;
  while l > 1 and 25::bigint * (l - 1) * l > p_xp loop
    l := l - 1;
  end loop;
  return l;
end
$$;

-- Ponte com a Steam ligada? (game_config.steam.bridgeEnabled). Os testes podem forçar por transação.
create or replace function private.steam_available()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((private.cfg('steam') ->> 'bridgeEnabled')::boolean, false)
$$;

-- Remove chaves com null no primeiro nível (o cliente espera campo ausente, não null).
create or replace function private.compact(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(p) e
  where e.value <> 'null'::jsonb
$$;

-- ---------------------------------------------------------------------
-- identidade, request_id, ledger
-- ---------------------------------------------------------------------

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  return v;
end
$$;

-- Grava o request_id no ledger. Repetido → DUPLICATE_REQUEST. Se a RPC falhar depois, a transação
-- desfaz esta linha e o id pode ser usado de novo.
create or replace function private.claim_request(p_uid uuid, p_request_id text, p_op text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_request_id is null or btrim(p_request_id) = '' or char_length(p_request_id) > 100 then
    raise exception 'INVALID_INPUT' using detail = 'request_id';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_uid) then
    raise exception 'NOT_FOUND' using detail = 'perfil';
  end if;
  insert into public.ledger (player_id, request_id, op, created_at)
  values (p_uid, p_request_id, p_op, private.now())
  on conflict (player_id, request_id) do nothing;
  if not found then
    raise exception 'DUPLICATE_REQUEST';
  end if;
end
$$;

create or replace function private.ledger_note(p_uid uuid, p_request_id text, p_details jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.ledger l
     set details = l.details || p_details
   where l.player_id = p_uid and l.request_id = p_request_id
$$;

-- Toda mutação bem-sucedida = interação real do jogador.
create or replace function private.touch_interaction(p_uid uuid)
returns void
language sql
set search_path = ''
as $$
  update public.profiles set last_interaction_at = private.now() where id = p_uid
$$;

-- ---------------------------------------------------------------------
-- carteira, inventário, XP (sempre inteiros, nunca negativos, deltas no ledger)
-- ---------------------------------------------------------------------

create or replace function private.add_coins(p_uid uuid, p_delta bigint, p_request_id text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  update public.wallets w
     set coins = w.coins + p_delta
   where w.player_id = p_uid and w.coins + p_delta >= 0
  returning w.coins into v;
  if not found then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;
  update public.ledger l
     set delta_coins = l.delta_coins + p_delta
   where l.player_id = p_uid and l.request_id = p_request_id;
  return v;
end
$$;

-- Soma `p_delta` ao item e devolve a quantidade ABSOLUTA nova (0 = sumiu do inventário).
create or replace function private.add_item(p_uid uuid, p_item text, p_delta bigint, p_request_id text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  if p_delta > 0 then
    insert into public.inventory as i (player_id, item_id, qty)
    values (p_uid, p_item, p_delta)
    on conflict (player_id, item_id) do update set qty = i.qty + excluded.qty
    returning i.qty into v;
  elsif p_delta < 0 then
    update public.inventory i
       set qty = i.qty + p_delta
     where i.player_id = p_uid and i.item_id = p_item and i.qty + p_delta >= 0
    returning i.qty into v;
    if not found then
      raise exception 'INSUFFICIENT_ITEMS';
    end if;
    if v = 0 then
      delete from public.inventory i where i.player_id = p_uid and i.item_id = p_item;
    end if;
  else
    select coalesce(max(i.qty), 0) into v from public.inventory i
     where i.player_id = p_uid and i.item_id = p_item;
    return v;
  end if;
  update public.ledger l
     set delta_items = jsonb_set(l.delta_items, array[p_item],
                                 to_jsonb(coalesce((l.delta_items ->> p_item)::bigint, 0) + p_delta))
   where l.player_id = p_uid and l.request_id = p_request_id;
  return v;
end
$$;

create or replace function private.item_qty(p_uid uuid, p_item text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(max(i.qty), 0) from public.inventory i where i.player_id = p_uid and i.item_id = p_item
$$;

create or replace function private.wallet_json(p_uid uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('coins', w.coins, 'gems', w.gems) from public.wallets w where w.player_id = p_uid
$$;

create or replace function private.progress_json(p_uid uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('level', p.level, 'xp', p.xp, 'accountLevel', p.account_level, 'accountXp', p.account_xp)
  from public.profiles p where p.id = p_uid
$$;

create or replace function private.profile_json(p_uid uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'avatar', p.avatar, 'timezone', p.timezone, 'vip', p.vip,
    'level', p.level, 'xp', p.xp, 'accountLevel', p.account_level, 'accountXp', p.account_xp)
  from public.profiles p where p.id = p_uid
$$;

create or replace function private.add_xp(p_uid uuid, p_farm_xp bigint, p_account_xp bigint)
returns jsonb
language sql
set search_path = ''
as $$
  update public.profiles p
     set xp = p.xp + p_farm_xp,
         level = private.level_for_xp(p.xp + p_farm_xp),
         account_xp = p.account_xp + p_account_xp,
         account_level = private.level_for_xp(p.account_xp + p_account_xp)
   where p.id = p_uid;
  select private.progress_json(p_uid);
$$;

create or replace function private.require_level(p_uid uuid, p_level int)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select p.level from public.profiles p where p.id = p_uid) < p_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;
end
$$;

-- Quantidade inteira em [1, max]; senão INVALID_INPUT.
create or replace function private.require_qty(p_qty numeric, p_max numeric)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_qty is null or p_qty <> trunc(p_qty) or p_qty < 1 or p_qty > p_max then
    raise exception 'INVALID_INPUT' using detail = 'qty';
  end if;
  return p_qty::bigint;
end
$$;

-- uuid a partir de texto; texto inválido vira null (o chamador lança NOT_FOUND).
create or replace function private.try_uuid(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end
$$;

-- ---------------------------------------------------------------------
-- canteiros
-- ---------------------------------------------------------------------

create or replace function private.plot_json(p public.plots)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('slotId', p.slot_id, 'unlocked', p.unlocked, 'cropId', p.crop_id,
                            'plantedFc', p.planted_fc, 'readyFc', p.ready_fc)
$$;

create or replace function private.plots_json(p_farm uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.plot_json(p) order by s.sort_order, p.slot_id), '[]'::jsonb)
  from public.plots p join public.plot_slots s on s.slot_id = p.slot_id
  where p.farm_id = p_farm
$$;

-- Antecipa ready_fc dos canteiros ainda em crescimento (evento noturno e Adubo), nunca antes do plantio.
-- Devolve os canteiros mexidos.
create or replace function private.advance_growing_plots(p_farm uuid, p_farm_clock bigint, p_seconds bigint)
returns jsonb
language sql
set search_path = ''
as $$
  with upd as (
    update public.plots p
       set ready_fc = greatest(p.planted_fc, p.ready_fc - p_seconds)
     where p.farm_id = p_farm and p.crop_id is not null and p.ready_fc > p_farm_clock
    returning p.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('slotId', u.slot_id, 'unlocked', u.unlocked, 'cropId', u.crop_id,
                                               'plantedFc', u.planted_fc, 'readyFc', u.ready_fc)
                            order by s.sort_order, u.slot_id), '[]'::jsonb)
  from upd u join public.plot_slots s on s.slot_id = u.slot_id
$$;

-- Junta ao resultado os canteiros que a sincronização (evento) acelerou e que a ação não devolveu.
create or replace function private.with_synced(p_result jsonb, p_touched jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_touched is null or jsonb_array_length(p_touched) = 0 then p_result
    else (
      with own as (
        select e ->> 'slotId' as slot_id from jsonb_array_elements(coalesce(p_result -> 'plots', '[]'::jsonb)) e
      ),
      extra as (
        select coalesce(jsonb_agg(t), '[]'::jsonb) as a
        from jsonb_array_elements(p_touched) t
        where (t ->> 'slotId') not in (select o.slot_id from own o)
      )
      select case
        when jsonb_array_length(x.a) = 0 then p_result
        else p_result || jsonb_build_object('plots', coalesce(p_result -> 'plots', '[]'::jsonb) || x.a)
      end
      from extra x
    )
  end
$$;

-- ---------------------------------------------------------------------
-- evento noturno: segundos de [t0, t1] dentro de 19h–21h locais, por data local
-- ---------------------------------------------------------------------

create or replace function private.event_segments(p_t0 timestamptz, p_t1 timestamptz, p_tz text)
returns table (local_date date, seconds numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start int := private.cfg_num('night_event', 'startHour');
  v_end int := private.cfg_num('night_event', 'endHour');
  t timestamptz := p_t0;
  nxt timestamptz;
  lt timestamp;
begin
  while t < p_t1 loop
    lt := t at time zone p_tz;
    -- próxima virada de hora LOCAL (funciona com fusos de meia hora), no mínimo 1 s
    nxt := t + greatest(interval '1 second', interval '1 hour' - (lt - date_trunc('hour', lt)));
    nxt := least(p_t1, nxt);
    if extract(hour from lt) >= v_start and extract(hour from lt) < v_end then
      local_date := lt::date;
      seconds := extract(epoch from (nxt - t));
      return next;
    end if;
    t := nxt;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- sync_farm_clock (CONTRACTS §2): trava a fazenda, aplica o evento e credita o relógio (máx. 8 h)
-- ---------------------------------------------------------------------

create type private.synced as (
  farm_id uuid,
  farm_clock bigint,
  real_seconds bigint,
  credited_seconds bigint,
  capped boolean,
  touched jsonb
);

create or replace function private.sync_farm(p_uid uuid)
returns private.synced
language plpgsql
set search_path = ''
as $$
declare
  f public.farms%rowtype;
  v_now timestamptz := private.now();
  v_tz text;
  v_last_interaction timestamptz;
  v_presence_end timestamptz;
  v_event_seconds numeric := 0;
  v_extra bigint;
  v_cap bigint := private.cfg_num('economy', 'OFFLINE_CAP_SECONDS');
  v_real bigint;
  r record;
  res private.synced;
begin
  -- Ordem de travas em toda RPC: fazenda → perfil → resto. "no key update" não briga com as travas
  -- KEY SHARE que as FKs (ledger → profiles) pegam antes, e mesmo assim serializa as RPCs do jogador.
  select * into f from public.farms where owner_id = p_uid for no key update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'fazenda';
  end if;
  select p.timezone, p.last_interaction_at into v_tz, v_last_interaction
    from public.profiles p where p.id = p_uid for no key update;
  res.touched := '[]'::jsonb;

  -- 1) evento noturno: presença em [last_sync_at, min(now, última interação + 5 min)]
  if v_last_interaction is not null then
    v_presence_end := least(v_now, v_last_interaction
                                   + make_interval(secs => private.cfg_num('night_event', 'presenceWindowSeconds')));
    if v_presence_end > f.last_sync_at then
      for r in
        select s.local_date, sum(s.seconds) as seconds
          from private.event_segments(f.last_sync_at, v_presence_end, v_tz) s
         group by s.local_date
      loop
        insert into public.event_attendance as a (player_id, local_date, seconds)
        values (p_uid, r.local_date, r.seconds)
        on conflict (player_id, local_date) do update set seconds = a.seconds + excluded.seconds;
        v_event_seconds := v_event_seconds + r.seconds;
      end loop;
      v_extra := floor(v_event_seconds * (private.cfg_num('night_event', 'speedMult') - 1));
      if v_extra > 0 then
        res.touched := private.advance_growing_plots(f.id, f.farm_clock_s, v_extra);
      end if;
    end if;
  end if;

  -- 2) crédito do relógio (guarda a fração de segundo; offline limitado a 28800 s)
  v_real := greatest(0, floor(extract(epoch from (v_now - f.clock_synced_at))))::bigint;
  if v_real >= v_cap then
    update public.farms
       set farm_clock_s = farm_clock_s + v_cap, clock_synced_at = v_now,
           last_sync_at = greatest(last_sync_at, v_now)
     where id = f.id;
    res.credited_seconds := v_cap;
    res.capped := v_real > v_cap;
  else
    update public.farms
       set farm_clock_s = farm_clock_s + v_real,
           clock_synced_at = clock_synced_at + make_interval(secs => v_real),
           last_sync_at = greatest(last_sync_at, v_now)
     where id = f.id;
    res.credited_seconds := v_real;
    res.capped := false;
  end if;
  res.farm_id := f.id;
  res.farm_clock := f.farm_clock_s + res.credited_seconds;
  res.real_seconds := v_real;
  return res;
end
$$;

create or replace function private.base_json(s private.synced)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('farmClock', s.farm_clock, 'serverNow', private.ms(private.now()))
$$;

-- ---------------------------------------------------------------------
-- cartas e buffs (CONTRACTS §5): o efeito vale só para o que foi PRODUZIDO na janela
-- ---------------------------------------------------------------------

-- Buffs cuja linha do álbum (5 raridades) está completa.
create or replace function private.album_completed(p_uid uuid)
returns table (buff text)
language sql
stable
set search_path = ''
as $$
  select d.buff
    from public.card_defs d
    left join public.inventory i on i.player_id = p_uid and i.item_id = d.id
   group by d.buff, d.buff_sort
  having bool_and(coalesce(i.qty, 0) > 0)
   order by d.buff_sort
$$;

-- Bônus permanente do álbum como fração (0.02 = +2%).
create or replace function private.album_bonus(p_uid uuid, p_buff text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from private.album_completed(p_uid) c where c.buff = p_buff)
      then (private.cfg('cards') -> 'album' ->> 'lineBonusPercent')::numeric / 100
    else 0
  end
$$;

-- Σ magnitude × (parte de [p_start, p_end] dentro de cada janela) / duração da produção.
create or replace function private.prorated_bonus(p_uid uuid, p_buff text, p_start bigint, p_end bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_end - p_start <= 0 then 0
    else coalesce(sum(w.magnitude * greatest(0, least(p_end, w.ends_fc) - greatest(p_start, w.started_fc))), 0)
         / (p_end - p_start)
  end
  from public.buff_windows w
  where w.player_id = p_uid and w.buff = p_buff and w.ends_fc > p_start and w.started_fc < p_end
$$;

create or replace function private.bonus(p_uid uuid, p_buff text, p_start bigint, p_end bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  select private.prorated_bonus(p_uid, p_buff, p_start, p_end) + private.album_bonus(p_uid, p_buff)
$$;

-- Buff em vigor no instante p_fc (Mercador vale no instante da compra).
create or replace function private.active_magnitude(p_uid uuid, p_buff text, p_fc bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(w.magnitude), 0)
    from public.buff_windows w
   where w.player_id = p_uid and w.buff = p_buff and w.started_fc <= p_fc and p_fc < w.ends_fc
$$;

create or replace function private.active_buffs_json(p_uid uuid, p_fc bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'instanceId', w.instance_id, 'cardId', w.card_id, 'buff', w.buff, 'rarity', w.rarity,
           'magnitude', w.magnitude, 'startedFc', w.started_fc, 'endsFc', w.ends_fc,
           'startedAt', private.ms(w.started_at), 'endsAt', private.ms(w.ends_at)) order by w.id), '[]'::jsonb)
    from public.buff_windows w
   where w.player_id = p_uid and w.ends_fc > p_fc
$$;

create or replace function private.card_json(c public.card_instances)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'cardId', c.card_id, 'source', c.source, 'status', c.status,
                            'obtainedAt', private.ms(c.obtained_at),
                            'usedAt', case when c.used_at is null then null else private.ms(c.used_at) end)
$$;

-- Sorteia uma carta: buff uniforme entre os 8; raridade pelos pesos 55/27/12/5/1.
create or replace function private.roll_card(p_uid uuid, p_seed text, p_source text)
returns public.card_instances
language plpgsql
set search_path = ''
as $$
declare
  v_buffs text[];
  v_buff text;
  v_weights jsonb := private.cfg('cards') -> 'rarityWeights';
  v_total numeric := 0;
  v_x numeric;
  v_rarity text := 'common';
  r record;
  c public.card_instances;
begin
  select array_agg(x.buff order by x.buff_sort) into v_buffs
    from (select distinct d.buff, d.buff_sort from public.card_defs d) x;
  v_buff := v_buffs[1 + least(array_length(v_buffs, 1) - 1, floor(private.unit(p_seed || ':buff') * array_length(v_buffs, 1))::int)];
  for r in select distinct d.rarity, d.rarity_sort from public.card_defs d order by d.rarity_sort loop
    v_total := v_total + coalesce((v_weights ->> r.rarity)::numeric, 0);
  end loop;
  v_x := private.unit(p_seed || ':rarity')::numeric * v_total;
  for r in select distinct d.rarity, d.rarity_sort from public.card_defs d order by d.rarity_sort loop
    v_x := v_x - coalesce((v_weights ->> r.rarity)::numeric, 0);
    if v_x < 0 then
      v_rarity := r.rarity;
      exit;
    end if;
  end loop;
  insert into public.card_instances (owner_id, card_id, source, status, obtained_at)
  select p_uid, d.id, p_source, 'unused', private.now()
    from public.card_defs d where d.buff = v_buff and d.rarity = v_rarity
  returning * into c;
  if c.id is null then
    raise exception 'NOT_FOUND' using detail = 'carta ' || v_buff || '/' || v_rarity;
  end if;
  return c;
end
$$;

-- ---------------------------------------------------------------------
-- colheita de 1 canteiro (CONTRACTS §5): bônus prorrateados + álbum, drop de carta
-- ---------------------------------------------------------------------

create or replace function private.harvest_plot(p_uid uuid, p_farm uuid, p_farm_clock bigint, p_slot text, p_seed text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  p public.plots;
  c public.crop_defs;
  v_sell bigint;
  v_base bigint;
  v_qty bigint;
  v_bonus_coins bigint;
  v_farm_xp bigint;
  v_acc_xp bigint;
  v_chance numeric;
  v_card public.card_instances;
  v_card_json jsonb := null;
  v_key text := p_seed || ':' || p_slot || ':';
begin
  select * into p from public.plots where farm_id = p_farm and slot_id = p_slot for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'slot ' || p_slot;
  end if;
  if not p.unlocked then
    raise exception 'SLOT_LOCKED';
  end if;
  if p.crop_id is null then
    raise exception 'SLOT_EMPTY';
  end if;
  if p_farm_clock < p.ready_fc then
    raise exception 'NOT_READY';
  end if;
  select * into c from public.crop_defs where crop_id = p.crop_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'crop ' || p.crop_id;
  end if;
  -- a produção ocorreu em [planted_fc, ready_fc]
  v_base := c.yield_min + floor(private.unit(v_key || 'yield') * (c.yield_max - c.yield_min + 1))::bigint;
  v_qty := v_base + private.sround(private.bonus(p_uid, 'bountiful_harvest', p.planted_fc, p.ready_fc),
                                   private.unit(v_key || 'bh'));
  select coalesce(i.sell_price, 0) into v_sell from public.items i where i.id = c.yield_item_id;
  v_bonus_coins := private.sround(v_sell * v_qty * private.bonus(p_uid, 'gold', p.planted_fc, p.ready_fc),
                                  private.unit(v_key || 'gold'));
  v_farm_xp := private.sround(c.xp * (1 + private.bonus(p_uid, 'farm_xp', p.planted_fc, p.ready_fc)),
                              private.unit(v_key || 'fx'));
  v_acc_xp := private.sround(c.xp * (1 + private.bonus(p_uid, 'account_xp', p.planted_fc, p.ready_fc)),
                             private.unit(v_key || 'ax'));
  -- drop: 1,25% por hora-canteiro de cultivo NOMINAL × (1 + Sorte), máx. 1
  v_chance := least(1, (c.grow_seconds / 3600.0) * (private.cfg('cards') ->> 'dropChancePerPlotHour')::numeric
                       * (1 + greatest(0, private.bonus(p_uid, 'luck', p.planted_fc, p.ready_fc))));
  if private.unit(v_key || 'drop') < v_chance then
    v_card := private.roll_card(p_uid, p_seed || ':' || p_slot, 'drop');
    v_card_json := private.card_json(v_card);
  end if;
  update public.plots
     set crop_id = null, planted_fc = null, ready_fc = null
   where farm_id = p_farm and slot_id = p_slot
  returning * into p;
  return jsonb_build_object('itemId', c.yield_item_id, 'qty', v_qty, 'farmXp', v_farm_xp, 'accXp', v_acc_xp,
                            'bonusCoins', v_bonus_coins, 'card', v_card_json, 'plot', private.plot_json(p));
end
$$;

-- Junta várias colheitas num MutationResult (inventário, moedas extras, XP, cartas).
create or replace function private.harvest_result(p_uid uuid, p_request_id text, p_base jsonb, p_harvested jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_items text[] := '{}';
  v_item text;
  v_gained jsonb := '{}'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_gained_list jsonb := '[]'::jsonb;
  v_plots jsonb := '[]'::jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_farm_xp bigint := 0;
  v_acc_xp bigint := 0;
  v_bonus bigint := 0;
  h jsonb;
  res jsonb;
begin
  if p_harvested is null or jsonb_array_length(p_harvested) = 0 then
    return p_base;
  end if;
  for h in select e from jsonb_array_elements(p_harvested) e loop
    v_item := h ->> 'itemId';
    if not (v_item = any (v_items)) then
      v_items := v_items || v_item;
    end if;
    v_gained := jsonb_set(v_gained, array[v_item], to_jsonb(coalesce((v_gained ->> v_item)::bigint, 0) + (h ->> 'qty')::bigint));
    v_farm_xp := v_farm_xp + (h ->> 'farmXp')::bigint;
    v_acc_xp := v_acc_xp + (h ->> 'accXp')::bigint;
    v_bonus := v_bonus + (h ->> 'bonusCoins')::bigint;
    v_plots := v_plots || jsonb_build_array(h -> 'plot');
    if jsonb_typeof(h -> 'card') = 'object' then
      v_cards := v_cards || jsonb_build_array(h -> 'card');
    end if;
  end loop;
  foreach v_item in array v_items loop
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'itemId', v_item, 'qty', private.add_item(p_uid, v_item, (v_gained ->> v_item)::bigint, p_request_id)));
    v_gained_list := v_gained_list || jsonb_build_array(jsonb_build_object('itemId', v_item, 'qty', (v_gained ->> v_item)::bigint));
  end loop;
  if v_bonus > 0 then
    perform private.add_coins(p_uid, v_bonus, p_request_id);
  end if;
  res := p_base || jsonb_build_object(
    'plots', v_plots, 'inventoryChanges', v_changes, 'gained', v_gained_list,
    'xp', private.add_xp(p_uid, v_farm_xp, v_acc_xp));
  if v_bonus > 0 then
    res := res || jsonb_build_object('wallet', private.wallet_json(p_uid), 'bonusCoins', v_bonus);
  end if;
  if jsonb_array_length(v_cards) > 0 then
    res := res || jsonb_build_object('cards', v_cards);
  end if;
  return res;
end
$$;

-- ---------------------------------------------------------------------
-- Steam: cota de retirada (janela deslizante de 7 h; contam pending + granted)
-- ---------------------------------------------------------------------

create or replace function private.extraction_quota_json(p_uid uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_now timestamptz := private.now();
  v_hours numeric := private.cfg_num('economy', 'EXTRACTION_WINDOW_HOURS');
  v_window interval := make_interval(hours => v_hours::int);
  v_vip boolean;
  v_limit int;
  v_used int;
  v_next timestamptz;
begin
  select p.vip into v_vip from public.profiles p where p.id = p_uid;
  v_limit := case when v_vip then private.cfg_num('economy', 'EXTRACTION_LIMIT_VIP')
                  else private.cfg_num('economy', 'EXTRACTION_LIMIT') end;
  select count(*) into v_used from public.extractions e
   where e.player_id = p_uid and e.status in ('pending', 'granted') and e.created_at > v_now - v_window;
  if v_used >= v_limit then
    -- a próxima vaga abre quando a retirada mais antiga que excede o limite sai da janela
    select e.created_at + v_window into v_next from public.extractions e
     where e.player_id = p_uid and e.status in ('pending', 'granted') and e.created_at > v_now - v_window
     order by e.created_at, e.seq
     offset (v_used - v_limit) limit 1;
  end if;
  return jsonb_build_object('used', v_used, 'limit', v_limit, 'windowHours', v_hours,
                            'nextSlotAt', case when v_next is null then null else private.ms(v_next) end);
end
$$;

create or replace function private.extraction_json(e public.extractions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.compact(jsonb_build_object('id', e.id, 'itemId', e.item_id, 'qty', e.qty, 'status', e.status,
                                            'steamItemId', e.steam_item_id, 'createdAt', private.ms(e.created_at)))
$$;

-- ---------------------------------------------------------------------
-- cadastro: perfil, carteira, fazenda, canteiros e kit inicial
-- ---------------------------------------------------------------------

create or replace function private.provision_player(p_uid uuid, p_meta jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := private.now();
  v_tz text := p_meta ->> 'timezone';
  v_nick text := left(coalesce(nullif(btrim(p_meta ->> 'nickname'), ''), 'Fazendeiro'), 32);
  v_starter jsonb := private.cfg('starter');
  v_farm uuid;
begin
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_tz) then
    v_tz := 'America/Sao_Paulo';
  end if;
  insert into public.profiles (id, nickname, avatar, timezone, created_at)
  values (p_uid, v_nick, 'farmer_m', v_tz, v_now)
  on conflict (id) do nothing;
  if not found then
    return; -- já existe
  end if;
  insert into public.wallets (player_id, coins, gems)
  values (p_uid, coalesce((v_starter ->> 'coins')::bigint, 0), coalesce((v_starter ->> 'gems')::bigint, 0));
  insert into public.farms (owner_id, farm_clock_s, clock_synced_at, last_sync_at)
  values (p_uid, 0, v_now, v_now)
  returning id into v_farm;
  insert into public.plots (farm_id, slot_id, unlocked)
  select v_farm, s.slot_id, s.starts_unlocked from public.plot_slots s;
  insert into public.inventory (player_id, item_id, qty)
  select p_uid, x ->> 'itemId', (x ->> 'qty')::bigint
    from jsonb_array_elements(coalesce(v_starter -> 'items', '[]'::jsonb)) x
   where (x ->> 'qty')::bigint > 0;
end
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_player(new.id, coalesce(new.raw_user_meta_data, '{}'::jsonb));
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

revoke all on all functions in schema private from public;
