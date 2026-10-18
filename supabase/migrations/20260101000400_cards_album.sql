-- Cartas de buff e álbum (CONTRACTS §5).
-- Ativar: 1 vaga (2 com VIP); mesmo buff não acumula; Adubo é instantâneo e não ocupa vaga.
-- Carta usada vira 1 unidade do item card_* (cópia no álbum).

create or replace function public.card_activate(instance_id text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  c public.card_instances;
  d public.card_defs;
  v_touched jsonb := '[]'::jsonb;
  v_active_buffs jsonb := null;
  v_slots int;
  v_now timestamptz := private.now();
  v_inv bigint;
  res jsonb;
begin
  perform private.claim_request(v_uid, request_id, 'card_activate');
  s := private.sync_farm(v_uid);
  select * into c from public.card_instances x
   where x.id = private.try_uuid(card_activate.instance_id) and x.owner_id = v_uid for no key update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'carta';
  end if;
  if c.status <> 'unused' then
    raise exception 'CARD_ALREADY_USED';
  end if;
  select * into d from public.card_defs x where x.id = c.card_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'carta def';
  end if;
  if d.instant or d.duration_seconds <= 0 then
    -- Adubo: avança na hora todos os canteiros em crescimento
    v_touched := private.advance_growing_plots(s.farm_id, s.farm_clock, d.magnitude::bigint);
  else
    if exists (select 1 from public.buff_windows w
                where w.player_id = v_uid and w.ends_fc > s.farm_clock and w.buff = d.buff) then
      raise exception 'BUFF_ALREADY_ACTIVE';
    end if;
    v_slots := case when (select p.vip from public.profiles p where p.id = v_uid)
                    then private.cfg_num('economy', 'CARD_SLOTS_VIP')
                    else private.cfg_num('economy', 'CARD_SLOTS') end;
    if (select count(*) from public.buff_windows w where w.player_id = v_uid and w.ends_fc > s.farm_clock) >= v_slots then
      raise exception 'CARD_SLOT_FULL';
    end if;
    insert into public.buff_windows (player_id, instance_id, card_id, buff, rarity, magnitude, started_fc, ends_fc,
                                     started_at, ends_at)
    values (v_uid, c.id, d.id, d.buff, d.rarity, d.magnitude, s.farm_clock, s.farm_clock + d.duration_seconds,
            v_now, v_now + make_interval(secs => d.duration_seconds));
    v_active_buffs := private.active_buffs_json(v_uid, s.farm_clock);
  end if;
  update public.card_instances x set status = 'used', used_at = v_now where x.id = c.id returning * into c;
  -- entra no álbum para sempre + 1 cópia (item card_*) que pode ir para a Steam
  insert into public.album_entries as a (player_id, card_id, copies, first_at)
  values (v_uid, d.id, 1, v_now)
  on conflict (player_id, card_id) do update set copies = a.copies + 1;
  v_inv := private.add_item(v_uid, d.id, 1, request_id);
  perform private.ledger_note(v_uid, request_id, jsonb_build_object('cardInstanceId', c.id, 'cardId', d.id));
  res := private.base_json(s) || jsonb_build_object(
    'cards', jsonb_build_array(private.card_json(c)),
    'inventoryChanges', jsonb_build_array(jsonb_build_object('itemId', d.id, 'qty', v_inv)));
  if v_active_buffs is not null then
    res := res || jsonb_build_object('activeBuffs', v_active_buffs);
  end if;
  if jsonb_array_length(v_touched) > 0 then
    res := res || jsonb_build_object('plots', v_touched);
  end if;
  perform private.touch_interaction(v_uid);
  return private.with_synced(res, s.touched);
end
$$;

-- Álbum: 1 espaço por carta do catálogo; cheio se a carta já foi usada alguma vez (permanente: retirar
-- a cópia para a Steam não esvazia); linha completa → bônus permanente. Leitura pura.
create or replace function public.album_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_pct numeric := (private.cfg('cards') -> 'album' ->> 'lineBonusPercent')::numeric;
begin
  return jsonb_build_object(
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('cardId', d.id, 'buff', d.buff, 'rarity', d.rarity,
                                                           'copies', coalesce(a.copies, 0)) order by d.sort_order), '[]'::jsonb)
                from public.card_defs d
                left join public.album_entries a on a.player_id = v_uid and a.card_id = d.id),
    'completedLines', (select coalesce(jsonb_agg(c.buff), '[]'::jsonb) from private.album_completed(v_uid) c),
    'bonusPercent', (select coalesce(jsonb_object_agg(c.buff, v_pct), '{}'::jsonb) from private.album_completed(v_uid) c));
end
$$;

revoke all on function public.card_activate(text, text), public.album_get() from public, anon, authenticated;
grant execute on function public.card_activate(text, text), public.album_get() to authenticated;
