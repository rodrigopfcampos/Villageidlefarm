-- Retirada para a Steam e volta (CONTRACTS §8). A concessão real na Steam NÃO está aqui:
-- extraction_request só põe o item em escrow e grava 'pending'. Quem fala com a Steam é a Edge Function
-- supabase/functions/steam-extract (stub), que depois chama extraction_complete com a service role.

create or replace function public.extraction_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.extraction_quota_json(private.require_uid());
end
$$;

create or replace function public.extraction_request(item_id text, qty numeric, request_id text)
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
  v_quota jsonb;
  v_inv bigint;
  v_now timestamptz := private.now();
  e public.extractions;
begin
  perform private.claim_request(v_uid, request_id, 'extraction_request');
  s := private.sync_farm(v_uid);
  if not private.steam_available() then
    raise exception 'STEAM_UNAVAILABLE';
  end if;
  select * into it from public.items x where x.id = extraction_request.item_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'item';
  end if;
  if not it.steam_extractable then
    raise exception 'NOT_EXTRACTABLE';
  end if;
  v_qty := private.require_qty(qty, private.cfg_num('economy', 'EXTRACTION_MAX_QTY'));
  perform private.require_level(v_uid, private.cfg_num('economy', 'EXTRACTION_MIN_LEVEL')::int);
  v_quota := private.extraction_quota_json(v_uid);
  if (v_quota ->> 'used')::int >= (v_quota ->> 'limit')::int then
    raise exception 'EXTRACTION_QUOTA';
  end if;
  -- escrow: sai do jogo na hora; 'failed' devolve
  v_inv := private.add_item(v_uid, it.id, -v_qty, request_id);
  insert into public.extractions (player_id, item_id, qty, status, request_id, created_at, updated_at)
  values (v_uid, it.id, v_qty, 'pending', request_id, v_now, v_now)
  returning * into e;
  perform private.ledger_note(v_uid, request_id, jsonb_build_object('extractionId', e.id));
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'inventoryChanges', jsonb_build_array(jsonb_build_object('itemId', it.id, 'qty', v_inv)),
    'extraction', private.extraction_json(e),
    'quota', private.extraction_quota_json(v_uid)), s.touched);
end
$$;

create or replace function public.extraction_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.extraction_json(e) order by e.created_at desc, e.seq desc), '[]'::jsonb)
    from public.extractions e
   where e.player_id = private.require_uid()
$$;

-- Volta (Steam → jogo). Só aceita ids que o SERVIDOR já conferiu (public.steam_items, preenchida pela Edge
-- Function da Steam) e que sejam do jogador. Consome e credita no jogo.
create or replace function public.steam_return_sync(steam_item_ids text[], request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  v_id text;
  si public.steam_items;
  e public.extractions;
  v_now timestamptz := private.now();
  v_changes jsonb := '{}'::jsonb;
  v_returned jsonb := '[]'::jsonb;
  v_order text[] := '{}';
  v_item text;
  v_list jsonb := '[]'::jsonb;
begin
  perform private.claim_request(v_uid, request_id, 'steam_return_sync');
  s := private.sync_farm(v_uid);
  if not private.steam_available() then
    raise exception 'STEAM_UNAVAILABLE';
  end if;
  if steam_item_ids is null
     or (select count(*) from unnest(steam_item_ids) x) <> (select count(distinct x) from unnest(steam_item_ids) x)
     or array_position(steam_item_ids, null) is not null then
    raise exception 'INVALID_INPUT' using detail = 'steam_item_ids';
  end if;
  foreach v_id in array steam_item_ids loop
    select * into si from public.steam_items x
     where x.steam_item_id = v_id and x.player_id = v_uid and x.status = 'in_steam' for update;
    if not found then
      raise exception 'NOT_FOUND' using detail = 'item Steam';
    end if;
    -- TODO(A6): a Edge Function chama ConsumeItem na Steam antes de liberar este passo.
    update public.steam_items x set status = 'consumed', consumed_at = v_now where x.steam_item_id = v_id;
    v_changes := jsonb_set(v_changes, array[si.item_id],
                           to_jsonb(private.add_item(v_uid, si.item_id, si.qty, request_id)));
    if not (si.item_id = any (v_order)) then
      v_order := v_order || si.item_id;
    end if;
    insert into public.extractions (player_id, item_id, qty, status, steam_item_id, request_id, created_at, updated_at)
    values (v_uid, si.item_id, si.qty, 'returned', v_id, request_id, v_now, v_now)
    returning * into e;
    v_returned := v_returned || jsonb_build_array(private.extraction_json(e));
  end loop;
  foreach v_item in array v_order loop
    v_list := v_list || jsonb_build_array(jsonb_build_object('itemId', v_item, 'qty', (v_changes ->> v_item)::bigint));
  end loop;
  perform private.touch_interaction(v_uid);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'inventoryChanges', v_list, 'returned', v_returned), s.touched);
end
$$;

-- Chamada SÓ pela Edge Function (service role) depois de falar com a Steam:
-- ok = true  → 'granted' com o id do item na Steam (vai para public.steam_items) + aviso extraction_granted;
-- ok = false → 'failed', devolve os itens do escrow + aviso extraction_failed.
-- Idempotente: só muda retirada 'pending'.
create or replace function public.extraction_complete(extraction_id uuid, ok boolean, steam_item_id text default null,
                                                      error_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.extractions;
  v_now timestamptz := private.now();
  v_rid text;
begin
  select * into e from public.extractions x where x.id = extraction_complete.extraction_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'retirada';
  end if;
  if e.status <> 'pending' then
    return private.extraction_json(e);
  end if;
  v_rid := 'extraction:' || e.id::text || ':' || case when ok then 'granted' else 'failed' end;
  insert into public.ledger (player_id, request_id, op, created_at, details)
  values (e.player_id, v_rid, 'extraction_complete', v_now, jsonb_build_object('extractionId', e.id, 'ok', ok));
  if ok then
    if extraction_complete.steam_item_id is null or btrim(extraction_complete.steam_item_id) = '' then
      raise exception 'INVALID_INPUT' using detail = 'steam_item_id';
    end if;
    update public.extractions x
       set status = 'granted', steam_item_id = extraction_complete.steam_item_id, updated_at = v_now
     where x.id = e.id
    returning * into e;
    insert into public.steam_items (steam_item_id, player_id, item_id, qty, created_at)
    values (extraction_complete.steam_item_id, e.player_id, e.item_id, e.qty, v_now);
    insert into public.notifications (user_id, kind, payload, created_at)
    values (e.player_id, 'extraction_granted',
            jsonb_build_object('extractionId', e.id, 'itemId', e.item_id, 'qty', e.qty, 'steamItemId', e.steam_item_id), v_now);
  else
    update public.extractions x
       set status = 'failed', error = extraction_complete.error_message, updated_at = v_now
     where x.id = e.id
    returning * into e;
    perform private.add_item(e.player_id, e.item_id, e.qty, v_rid);
    insert into public.notifications (user_id, kind, payload, created_at)
    values (e.player_id, 'extraction_failed',
            jsonb_build_object('extractionId', e.id, 'itemId', e.item_id, 'qty', e.qty), v_now);
  end if;
  return private.extraction_json(e);
end
$$;

revoke all on function public.extraction_quota(), public.extraction_request(text, numeric, text),
  public.extraction_list(), public.steam_return_sync(text[], text),
  public.extraction_complete(uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.extraction_quota(), public.extraction_request(text, numeric, text),
  public.extraction_list(), public.steam_return_sync(text[], text)
  to authenticated;
grant execute on function public.extraction_complete(uuid, boolean, text, text) to service_role;
