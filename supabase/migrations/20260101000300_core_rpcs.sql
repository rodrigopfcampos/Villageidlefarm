-- RPCs do núcleo (CONTRACTS §9). Todas security definer + search_path vazio.
-- Padrão de toda mutação: uid → request_id (DUPLICATE_REQUEST) → sync da fazenda (trava) → validações na
-- ordem do CONTRACTS §6 → efeitos → last_interaction_at. Qualquer erro desfaz a transação inteira.

-- ---------------------------------------------------------------------
-- leitura / sincronização
-- ---------------------------------------------------------------------

create or replace function public.bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  v_farm public.farms;
begin
  -- conta criada antes do gatilho existir: cria agora
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    perform private.provision_player(v_uid, coalesce((select u.raw_user_meta_data from auth.users u where u.id = v_uid), '{}'::jsonb));
  end if;
  s := private.sync_farm(v_uid);
  select * into v_farm from public.farms where id = s.farm_id;
  return jsonb_build_object(
    'profile', private.profile_json(v_uid),
    'wallet', private.wallet_json(v_uid),
    'inventory', (select coalesce(jsonb_agg(jsonb_build_object('itemId', i.item_id, 'qty', i.qty) order by it.sort_order, i.item_id), '[]'::jsonb)
                    from public.inventory i join public.items it on it.id = i.item_id
                   where i.player_id = v_uid and i.qty > 0),
    'farm', jsonb_build_object(
      'farmId', v_farm.id, 'ownerId', v_farm.owner_id, 'farmClock', s.farm_clock,
      'expansionLevel', v_farm.expansion_level, 'visitsOpen', v_farm.visits_open,
      'plots', private.plots_json(v_farm.id),
      'animals', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'animalType', a.animal_type, 'name', a.name,
                                                               'lastCollectFc', a.last_collect_fc) order by a.seq), '[]'::jsonb)
                    from public.animals a where a.farm_id = v_farm.id),
      'unlockedLots', '[]'::jsonb),
    'cards', (select coalesce(jsonb_agg(private.card_json(c) order by c.seq), '[]'::jsonb)
                from public.card_instances c where c.owner_id = v_uid and c.status = 'unused'),
    'activeBuffs', private.active_buffs_json(v_uid, s.farm_clock),
    'offlineReport', jsonb_build_object('realSeconds', s.real_seconds, 'creditedSeconds', s.credited_seconds,
                                        'capped', s.capped),
    'serverNow', private.ms(private.now()));
end
$$;

-- Sinal de vida: no máximo 1 a cada 10 s (RATE_LIMITED). Sincroniza o relógio; NÃO conta como interação.
create or replace function public.heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_now timestamptz := private.now();
  v_last timestamptz;
  s private.synced;
  res jsonb;
begin
  perform 1 from public.farms f where f.owner_id = v_uid for no key update; -- mesma ordem de travas
  select p.last_heartbeat_at into v_last from public.profiles p where p.id = v_uid for no key update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'perfil';
  end if;
  if v_last is not null
     and v_now - v_last < make_interval(secs => private.cfg_num('economy', 'HEARTBEAT_MIN_INTERVAL_MS') / 1000) then
    raise exception 'RATE_LIMITED';
  end if;
  update public.profiles set last_heartbeat_at = v_now where id = v_uid;
  s := private.sync_farm(v_uid);
  res := jsonb_build_object('farmClock', s.farm_clock, 'serverNow', private.ms(v_now),
                            'creditedSeconds', s.credited_seconds);
  if jsonb_array_length(s.touched) > 0 then
    res := res || jsonb_build_object('plots', s.touched);
  end if;
  return res;
end
$$;

create or replace function public.get_server_time()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('serverNow', private.ms(private.now()))
$$;

-- ---------------------------------------------------------------------
-- canteiros
-- ---------------------------------------------------------------------

create or replace function public.plant(slot_id text, seed_item_id text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  p public.plots;
  c public.crop_defs;
  v_qty bigint;
begin
  perform private.claim_request(v_uid, request_id, 'plant');
  s := private.sync_farm(v_uid);
  select * into p from public.plots x where x.farm_id = s.farm_id and x.slot_id = plant.slot_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'slot';
  end if;
  if not p.unlocked then
    raise exception 'SLOT_LOCKED';
  end if;
  if p.crop_id is not null then
    raise exception 'SLOT_OCCUPIED';
  end if;
  select * into c from public.crop_defs d where d.seed_item_id = plant.seed_item_id;
  if not found then
    raise exception 'INVALID_INPUT' using detail = 'não é semente';
  end if;
  perform private.require_level(v_uid, c.unlock_level);
  v_qty := private.add_item(v_uid, c.seed_item_id, -1, request_id);
  -- álbum: linha de Adubo completa encurta o cultivo em 2%
  update public.plots x
     set crop_id = c.crop_id,
         planted_fc = s.farm_clock,
         ready_fc = s.farm_clock + round(c.grow_seconds * (1 - private.album_bonus(v_uid, 'fertilizer')))::bigint
   where x.farm_id = s.farm_id and x.slot_id = plant.slot_id
  returning * into p;
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'plots', jsonb_build_array(private.plot_json(p)),
    'inventoryChanges', jsonb_build_array(jsonb_build_object('itemId', c.seed_item_id, 'qty', v_qty))), s.touched);
end
$$;

create or replace function public.harvest(slot_id text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  h jsonb;
  res jsonb;
begin
  perform private.claim_request(v_uid, request_id, 'harvest');
  s := private.sync_farm(v_uid);
  h := private.harvest_plot(v_uid, s.farm_id, s.farm_clock, slot_id, request_id);
  res := private.harvest_result(v_uid, request_id, private.base_json(s), jsonb_build_array(h));
  perform private.touch_interaction(v_uid);
  return private.with_synced(res, s.touched);
end
$$;

-- Colhe tudo o que está pronto. Nada pronto NÃO é erro.
create or replace function public.harvest_all(request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  v_harvested jsonb := '[]'::jsonb;
  r record;
  res jsonb;
begin
  perform private.claim_request(v_uid, request_id, 'harvest_all');
  s := private.sync_farm(v_uid);
  for r in
    select p.slot_id from public.plots p join public.plot_slots ps on ps.slot_id = p.slot_id
     where p.farm_id = s.farm_id and p.unlocked and p.ready_fc is not null and p.ready_fc <= s.farm_clock
     order by ps.sort_order, p.slot_id
  loop
    v_harvested := v_harvested || jsonb_build_array(
      private.harvest_plot(v_uid, s.farm_id, s.farm_clock, r.slot_id, request_id));
  end loop;
  res := private.harvest_result(v_uid, request_id, private.base_json(s), v_harvested);
  perform private.touch_interaction(v_uid);
  return private.with_synced(res, s.touched);
end
$$;

create or replace function public.unlock_slot(slot_id text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  p public.plots;
  d public.plot_slots;
begin
  perform private.claim_request(v_uid, request_id, 'unlock_slot');
  s := private.sync_farm(v_uid);
  select * into p from public.plots x where x.farm_id = s.farm_id and x.slot_id = unlock_slot.slot_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'slot';
  end if;
  select * into d from public.plot_slots x where x.slot_id = unlock_slot.slot_id;
  if p.unlocked then
    raise exception 'ALREADY_UNLOCKED';
  end if;
  perform private.require_level(v_uid, d.unlock_level);
  perform private.add_coins(v_uid, -d.unlock_cost, request_id);
  update public.plots x set unlocked = true
   where x.farm_id = s.farm_id and x.slot_id = unlock_slot.slot_id
  returning * into p;
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'wallet', private.wallet_json(v_uid), 'plots', jsonb_build_array(private.plot_json(p))), s.touched);
end
$$;

-- ---------------------------------------------------------------------
-- animais
-- ---------------------------------------------------------------------

create or replace function public.buy_animal(animal_type text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  d public.animal_defs;
  a public.animals;
begin
  perform private.claim_request(v_uid, request_id, 'buy_animal');
  s := private.sync_farm(v_uid);
  select * into d from public.animal_defs x where x.animal_type = buy_animal.animal_type;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'animal';
  end if;
  perform private.require_level(v_uid, d.unlock_level);
  perform private.add_coins(v_uid, -d.buy_price, request_id);
  insert into public.animals (farm_id, animal_type, name, last_collect_fc, created_at)
  values (s.farm_id, d.animal_type, regexp_replace(d.animal_type, '^animal_', ''), s.farm_clock, private.now())
  returning * into a;
  perform private.ledger_note(v_uid, request_id, jsonb_build_object('animalId', a.id));
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'wallet', private.wallet_json(v_uid),
    'animals', jsonb_build_array(jsonb_build_object('id', a.id, 'animalType', a.animal_type, 'name', a.name,
                                                    'lastCollectFc', a.last_collect_fc))), s.touched);
end
$$;

create or replace function public.collect_animal(animal_id text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  a public.animals;
  d public.animal_defs;
  n bigint;
  v_start bigint;
  v_end bigint;
  v_qty bigint;
  v_sell bigint;
  v_bonus_coins bigint;
  v_farm_xp bigint;
  v_acc_xp bigint;
  v_inv bigint;
  v_key text;
  res jsonb;
begin
  perform private.claim_request(v_uid, request_id, 'collect_animal');
  s := private.sync_farm(v_uid);
  select * into a from public.animals x
   where x.id = private.try_uuid(collect_animal.animal_id) and x.farm_id = s.farm_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'animal';
  end if;
  select * into d from public.animal_defs x where x.animal_type = a.animal_type;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'animal def';
  end if;
  n := least(floor((s.farm_clock - a.last_collect_fc)::numeric / d.produce_seconds)::bigint, d.max_stock);
  if n <= 0 then
    raise exception 'NOTHING_TO_COLLECT';
  end if;
  v_start := a.last_collect_fc;
  v_end := v_start + n * d.produce_seconds;
  v_key := request_id || ':' || a.id::text || ':';
  v_qty := n + private.sround(n * private.bonus(v_uid, 'animals', v_start, v_end), private.unit(v_key || 'an'));
  select coalesce(i.sell_price, 0) into v_sell from public.items i where i.id = d.product_item_id;
  v_bonus_coins := private.sround(v_sell * v_qty * private.bonus(v_uid, 'gold', v_start, v_end), private.unit(v_key || 'g'));
  v_farm_xp := private.sround(d.xp * (1 + private.bonus(v_uid, 'farm_xp', v_start, v_end)), private.unit(v_key || 'fx'));
  v_acc_xp := private.sround(d.xp * (1 + private.bonus(v_uid, 'account_xp', v_start, v_end)), private.unit(v_key || 'ax'));
  update public.animals x
     set last_collect_fc = case when n >= d.max_stock then s.farm_clock else v_end end
   where x.id = a.id
  returning * into a;
  v_inv := private.add_item(v_uid, d.product_item_id, v_qty, request_id);
  if v_bonus_coins > 0 then
    perform private.add_coins(v_uid, v_bonus_coins, request_id);
  end if;
  res := private.base_json(s) || jsonb_build_object(
    'animals', jsonb_build_array(jsonb_build_object('id', a.id, 'animalType', a.animal_type, 'name', a.name,
                                                    'lastCollectFc', a.last_collect_fc)),
    'inventoryChanges', jsonb_build_array(jsonb_build_object('itemId', d.product_item_id, 'qty', v_inv)),
    'gained', jsonb_build_array(jsonb_build_object('itemId', d.product_item_id, 'qty', v_qty)),
    'xp', private.add_xp(v_uid, v_farm_xp, v_acc_xp));
  if v_bonus_coins > 0 then
    res := res || jsonb_build_object('wallet', private.wallet_json(v_uid), 'bonusCoins', v_bonus_coins);
  end if;
  perform private.touch_interaction(v_uid);
  return private.with_synced(res, s.touched);
end
$$;

-- ---------------------------------------------------------------------
-- loja NPC
-- ---------------------------------------------------------------------

create or replace function public.shop_buy(item_id text, qty numeric, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  it public.items;
  v_qty bigint;
  v_discount numeric := 0;
  v_inv bigint;
begin
  perform private.claim_request(v_uid, request_id, 'shop_buy');
  s := private.sync_farm(v_uid);
  select * into it from public.items x where x.id = shop_buy.item_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'item';
  end if;
  if not it.shop_buyable then
    raise exception 'NOT_FOR_SALE';
  end if;
  v_qty := private.require_qty(qty, private.cfg_num('economy', 'SHOP_MAX_QTY'));
  -- Mercador: desconto em sementes enquanto a carta está ativa (+ álbum), arredonda para cima
  if it.kind = 'seed' then
    v_discount := least(0.9, private.active_magnitude(v_uid, 'merchant', s.farm_clock)
                             + private.album_bonus(v_uid, 'merchant'));
  end if;
  perform private.add_coins(v_uid, -ceil(it.base_price * v_qty * (1 - v_discount))::bigint, request_id);
  v_inv := private.add_item(v_uid, it.id, v_qty, request_id);
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'wallet', private.wallet_json(v_uid),
    'inventoryChanges', jsonb_build_array(jsonb_build_object('itemId', it.id, 'qty', v_inv))), s.touched);
end
$$;

create or replace function public.shop_sell(item_id text, qty numeric, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  it public.items;
  v_qty bigint;
  v_inv bigint;
begin
  perform private.claim_request(v_uid, request_id, 'shop_sell');
  s := private.sync_farm(v_uid);
  select * into it from public.items x where x.id = shop_sell.item_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'item';
  end if;
  if it.sell_price is null then
    raise exception 'NOT_FOR_SALE';
  end if;
  v_qty := private.require_qty(qty, private.cfg_num('economy', 'SHOP_MAX_QTY'));
  v_inv := private.add_item(v_uid, it.id, -v_qty, request_id);
  perform private.add_coins(v_uid, it.sell_price * v_qty, request_id);
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'wallet', private.wallet_json(v_uid),
    'inventoryChanges', jsonb_build_array(jsonb_build_object('itemId', it.id, 'qty', v_inv))), s.touched);
end
$$;

-- Execução: só jogadores logados (get_server_time também para anon).
revoke all on function public.bootstrap(), public.heartbeat(), public.get_server_time(),
  public.plant(text, text, text), public.harvest(text, text), public.harvest_all(text),
  public.unlock_slot(text, text), public.buy_animal(text, text), public.collect_animal(text, text),
  public.shop_buy(text, numeric, text), public.shop_sell(text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap(), public.heartbeat(), public.get_server_time(),
  public.plant(text, text, text), public.harvest(text, text), public.harvest_all(text),
  public.unlock_slot(text, text), public.buy_animal(text, text), public.collect_animal(text, text),
  public.shop_buy(text, numeric, text), public.shop_sell(text, numeric, text)
  to authenticated;
grant execute on function public.get_server_time() to anon;
