-- Tempo e evento noturno (CONTRACTS §7). A presença e a aceleração ×1.5 são aplicadas em
-- private.sync_farm (toda RPC da fazenda); aqui ficam fuso, estado do mundo e a carta garantida.

create or replace function private.phase_for_hour(h int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when h >= 5 and h < 7 then 'dawn'
    when h >= 7 and h < 17 then 'day'
    when h >= 17 and h < 19 then 'dusk'
    else 'night'
  end
$$;

-- Leitura pura (não sincroniza): a presença acumulada vem do último heartbeat/mutação.
create or replace function public.get_world_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_now timestamptz := private.now();
  v_tz text;
  lt timestamp;
  h int;
  v_start int := private.cfg_num('night_event', 'startHour');
  v_end int := private.cfg_num('night_event', 'endHour');
  v_active boolean;
  v_ends timestamptz;
begin
  select p.timezone into v_tz from public.profiles p where p.id = v_uid;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'perfil';
  end if;
  lt := v_now at time zone v_tz;
  h := extract(hour from lt)::int;
  v_active := h >= v_start and h < v_end;
  if v_active then
    v_ends := v_now + (interval '1 hour' - (lt - date_trunc('hour', lt))) + make_interval(hours => v_end - h - 1);
  end if;
  return jsonb_build_object(
    'serverNow', private.ms(v_now),
    'timezone', v_tz,
    'localHour', h,
    'phase', private.phase_for_hour(h),
    'weather', 'clear',
    'nightEvent', jsonb_build_object(
      'active', v_active,
      'speedMult', private.cfg_num('night_event', 'speedMult'),
      'attendanceSeconds', (select coalesce(floor(max(a.seconds)), 0) from public.event_attendance a
                             where a.player_id = v_uid and a.local_date = lt::date),
      'requiredSeconds', private.cfg_num('night_event', 'requiredSeconds'),
      'cardClaimed', exists (select 1 from public.event_claims c
                              where c.player_id = v_uid and c.event_key = 'night' and c.local_date = lt::date),
      'endsAt', case when v_ends is null then null else private.ms(v_ends) end));
end
$$;

-- Fuso validado em pg_timezone_names; 1 troca a cada 30 dias. Devolve o Profile.
create or replace function public.set_timezone(tz text, request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  v_now timestamptz := private.now();
  v_changed timestamptz;
begin
  perform private.claim_request(v_uid, request_id, 'set_timezone');
  s := private.sync_farm(v_uid);
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = set_timezone.tz) then
    raise exception 'INVALID_TZ';
  end if;
  select p.tz_changed_at into v_changed from public.profiles p where p.id = v_uid;
  if v_changed is not null
     and v_now - v_changed < make_interval(days => private.cfg_num('economy', 'TZ_CHANGE_COOLDOWN_DAYS')::int) then
    raise exception 'TZ_CHANGE_TOO_SOON';
  end if;
  update public.profiles p set timezone = set_timezone.tz, tz_changed_at = v_now where p.id = v_uid;
  perform private.ledger_note(v_uid, request_id, jsonb_build_object('timezone', set_timezone.tz));
  perform private.touch_interaction(v_uid);
  return private.profile_json(v_uid);
end
$$;

-- Carta garantida: presença ativa >= 30 min no evento do dia local; 1 por dia local e >= 20 h entre resgates;
-- bloqueada por 24 h depois de trocar o fuso.
create or replace function public.claim_night_event(request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s private.synced;
  v_now timestamptz := private.now();
  p public.profiles;
  v_date date;
  c public.card_instances;
  v_card jsonb;
begin
  perform private.claim_request(v_uid, request_id, 'claim_night_event');
  s := private.sync_farm(v_uid);
  select * into p from public.profiles x where x.id = v_uid;
  if p.tz_changed_at is not null
     and v_now - p.tz_changed_at < make_interval(hours => private.cfg_num('economy', 'EVENT_TZ_LOCK_HOURS')::int) then
    raise exception 'TZ_CHANGE_TOO_SOON';
  end if;
  v_date := (v_now at time zone p.timezone)::date;
  if exists (select 1 from public.event_claims x where x.player_id = v_uid and x.event_key = 'night' and x.local_date = v_date)
     or (p.last_event_claim_at is not null and v_now - p.last_event_claim_at < interval '20 hours') then
    raise exception 'ALREADY_CLAIMED';
  end if;
  if coalesce((select a.seconds from public.event_attendance a where a.player_id = v_uid and a.local_date = v_date), 0)
     < private.cfg_num('night_event', 'requiredSeconds') then
    raise exception 'NOT_ACTIVE';
  end if;
  c := private.roll_card(v_uid, request_id || ':event', 'night_event');
  insert into public.event_claims (player_id, event_key, local_date, card_instance_id, claimed_at)
  values (v_uid, 'night', v_date, c.id, v_now);
  update public.profiles x set last_event_claim_at = v_now where x.id = v_uid;
  perform private.ledger_note(v_uid, request_id, jsonb_build_object('cardInstanceId', c.id, 'localDate', v_date));
  perform private.touch_interaction(v_uid);
  v_card := private.card_json(c);
  return private.with_synced(private.base_json(s) || jsonb_build_object(
    'card', v_card, 'cards', jsonb_build_array(v_card)), s.touched);
end
$$;

revoke all on function public.get_world_state(), public.set_timezone(text, text), public.claim_night_event(text)
  from public, anon, authenticated;
grant execute on function public.get_world_state(), public.set_timezone(text, text), public.claim_night_event(text)
  to authenticated;
revoke all on all functions in schema private from public;
