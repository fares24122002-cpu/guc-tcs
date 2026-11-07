-- 0005_features.sql — giveaway settings and the jsonb API functions the backend calls.
-- Run once, after 0001-0004. Every function takes one jsonb argument `p` and returns jsonb, so the
-- backend uses one uniform, testable calling convention. Only the service role may execute them.

-- ---------------------------------------------------------------------------
-- Giveaway settings (single row) — scope, rules, mute flag, and the active draw
-- ---------------------------------------------------------------------------
create table public.giveaway_settings (
  id                             smallint primary key default 1 check (id = 1),
  draw_type                      public.draw_type not null default 'daily',
  event_day_id                   uuid references public.event_days (id) on delete restrict,
  winner_count                   smallint not null default 5 check (winner_count between 1 and 10),
  exclude_previous_winners       boolean not null default true,
  acknowledge_pending_duplicates boolean not null default false,
  muted                          boolean not null default false,
  active_draw_id                 uuid references public.giveaway_draws (id) on delete restrict,
  updated_at                     timestamptz not null default now(),
  check ((draw_type = 'daily') = (event_day_id is not null))
);
insert into public.giveaway_settings (id, draw_type, event_day_id)
select 1, 'daily', id from public.event_days where day_number = 1;
alter table public.giveaway_settings enable row level security;
create trigger giveaway_settings_touch before update on public.giveaway_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.assert_admin(p_admin uuid) returns void language plpgsql stable as $$
begin
  if p_admin is null or not exists (
       select 1 from public.profiles where id = p_admin and role = 'admin' and is_active) then
    raise exception 'admin_required';
  end if;
end $$;

create function public.log_activity(p_user uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql as $$
  insert into public.activity_logs (user_id, action, details)
  values (p_user, p_action, coalesce(p_details, '{}'::jsonb));
$$;

create function public.reg_brief(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'reg_number', r.reg_number, 'full_name', r.full_name,
    'photo_path', r.photo_path, 'photo_deleted_at', r.photo_deleted_at,
    'event_day_id', r.event_day_id, 'day_number', d.day_number,
    'registered_by', r.registered_by, 'staff_name', pr.full_name,
    'identity_id', r.eligibility_identity_id, 'created_at', r.created_at)
  from public.registrations r
  join public.event_days d on d.id = r.event_day_id
  join public.profiles pr on pr.id = r.registered_by
  where r.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Event days
-- ---------------------------------------------------------------------------
create function public.api_event_days(p jsonb default '{}'::jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'day_number', d.day_number, 'event_date', d.event_date,
      'registration_open', d.registration_open, 'registration_target', d.registration_target,
      'registrations', (select count(*) from public.registrations r where r.event_day_id = d.id))
    order by d.day_number), '[]'::jsonb)
  from public.event_days d
$$;

create function public.api_update_event_day(p jsonb) returns jsonb language plpgsql as $$
declare v_old public.event_days; v_new public.event_days; v_admin uuid := (p->>'admin')::uuid;
begin
  perform public.assert_admin(v_admin);
  select * into v_old from public.event_days where id = (p->>'id')::uuid for update;
  if not found then raise exception 'event_day_not_found'; end if;
  update public.event_days set
    registration_open   = coalesce((p->>'registration_open')::boolean, registration_open),
    registration_target = coalesce((p->>'registration_target')::int, registration_target),
    event_date          = case when p ? 'event_date' then nullif(p->>'event_date', '')::date else event_date end
  where id = v_old.id returning * into v_new;
  if v_new.registration_open is distinct from v_old.registration_open then
    perform public.log_activity(v_admin,
      case when v_new.registration_open then 'eventday.opened' else 'eventday.closed' end,
      jsonb_build_object('day_number', v_new.day_number));
  end if;
  if v_new.registration_target is distinct from v_old.registration_target
     or v_new.event_date is distinct from v_old.event_date then
    perform public.log_activity(v_admin, 'eventday.updated',
      jsonb_build_object('day_number', v_new.day_number, 'target', v_new.registration_target, 'date', v_new.event_date));
  end if;
  return to_jsonb(v_new);
end $$;

-- ---------------------------------------------------------------------------
-- Registrations
-- ---------------------------------------------------------------------------
create function public.api_create_registration(p jsonb) returns jsonb language plpgsql as $$
declare v_id uuid; v_row public.registrations; v_day smallint;
begin
  v_id := public.create_registration(
    (p->>'idempotency_key')::uuid, p->>'full_name', p->>'photo_path',
    (p->>'event_day_id')::uuid, (p->>'registered_by')::uuid, coalesce((p->>'consent')::boolean, false));
  select * into v_row from public.registrations where id = v_id;
  select day_number into v_day from public.event_days where id = v_row.event_day_id;
  return jsonb_build_object(
    'id', v_row.id, 'reg_number', v_row.reg_number, 'full_name', v_row.full_name,
    'photo_path', v_row.photo_path, 'event_day_id', v_row.event_day_id, 'day_number', v_day,
    'created_at', v_row.created_at,
    'possible_duplicates', (select count(*) from public.duplicate_candidates c
        where (c.registration_a = v_row.id or c.registration_b = v_row.id) and c.status = 'pending'));
end $$;

-- Look up a registration by its retry key, so a retried request returns the saved record.
create function public.api_registration_by_key(p jsonb) returns jsonb language sql stable as $$
  select public.reg_brief(r.id) from public.registrations r where r.idempotency_key = (p->>'key')::uuid
$$;

create function public.api_check_name(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', coalesce(sum(x.c), 0),
    'by_day', coalesce(jsonb_agg(jsonb_build_object('day_number', x.day_number, 'count', x.c) order by x.day_number), '[]'::jsonb))
  from (
    select d.day_number, count(*) as c
    from public.registrations r join public.event_days d on d.id = r.event_day_id
    where r.name_normalized = lower(regexp_replace(btrim(coalesce(p->>'name', '')), '\s+', ' ', 'g'))
    group by d.day_number) x
$$;

create function public.api_my_summary(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', count(*),
    'today', count(*) filter (where r.created_at >= (date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')))
  from public.registrations r where r.registered_by = (p->>'viewer')::uuid
$$;

create function public.api_list_registrations(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_limit  int  := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200);
  v_offset int  := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_viewer uuid := (p->>'viewer')::uuid;
  v_admin  boolean := coalesce(p->>'role', '') = 'admin';
  v_q      text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_pat    text;
  v_staff  uuid := nullif(p->>'registered_by', '')::uuid;
  v_day    uuid := nullif(p->>'event_day_id', '')::uuid;
  v_from   timestamptz := nullif(p->>'from', '')::timestamptz;
  v_to     timestamptz := nullif(p->>'to', '')::timestamptz;
  v_photo  text := nullif(p->>'photo', '');
  v_result jsonb;
begin
  if not v_admin then v_staff := v_viewer; end if;
  if v_q is not null then
    v_pat := '%' || replace(replace(replace(lower(regexp_replace(v_q, '\s+', ' ', 'g')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with f as (
    select r.*, d.day_number, pr.full_name as staff_name
    from public.registrations r
    join public.event_days d on d.id = r.event_day_id
    join public.profiles pr on pr.id = r.registered_by
    where (v_pat is null or r.name_normalized like v_pat escape '\')
      and (v_staff is null or r.registered_by = v_staff)
      and (v_day is null or r.event_day_id = v_day)
      and (v_from is null or r.created_at >= v_from)
      and (v_to is null or r.created_at < v_to)
      and (v_photo is null
           or (v_photo = 'present' and r.photo_path is not null)
           or (v_photo = 'deleted' and r.photo_deleted_at is not null))
  ), c as (select count(*) as n from f),
  page as (select * from f order by created_at desc, reg_number desc limit v_limit offset v_offset)
  select jsonb_build_object(
    'total', (select n from c),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', page.id, 'reg_number', page.reg_number, 'full_name', page.full_name,
        'photo_path', page.photo_path, 'photo_deleted_at', page.photo_deleted_at,
        'event_day_id', page.event_day_id, 'day_number', page.day_number,
        'registered_by', page.registered_by, 'staff_name', page.staff_name,
        'created_at', page.created_at,
        'is_winner', exists (select 1 from public.winners w where w.registration_id = page.id),
        'duplicate_pending', exists (select 1 from public.duplicate_candidates dc
            where (dc.registration_a = page.id or dc.registration_b = page.id) and dc.status = 'pending'))
      order by page.created_at desc, page.reg_number desc) from page), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

create function public.api_get_registration(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_id uuid := (p->>'id')::uuid; v_viewer uuid := (p->>'viewer')::uuid;
  v_admin boolean := coalesce(p->>'role', '') = 'admin';
  v_reg public.registrations; v_brief jsonb;
begin
  select * into v_reg from public.registrations where id = v_id;
  if not found then return null; end if;
  if not v_admin and v_reg.registered_by <> v_viewer then return null; end if;
  v_brief := public.reg_brief(v_id);
  return v_brief || jsonb_build_object(
    'consent', v_reg.consent,
    'winner_of', coalesce((select jsonb_agg(jsonb_build_object('draw_id', w.draw_id, 'position', w.winner_position))
        from public.winners w where w.participant_identity_id = v_reg.eligibility_identity_id), '[]'::jsonb),
    'same_person_registrations', case when v_admin then coalesce((
        select jsonb_agg(public.reg_brief(o.id)) from public.registrations o
        where o.eligibility_identity_id = v_reg.eligibility_identity_id and o.id <> v_id), '[]'::jsonb) else '[]'::jsonb end,
    'same_name_registrations', case when v_admin then coalesce((
        select jsonb_agg(public.reg_brief(o.id)) from public.registrations o
        where o.name_normalized = v_reg.name_normalized and o.id <> v_id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------------------
-- Duplicate review
-- ---------------------------------------------------------------------------
create function public.api_duplicates(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_status text := nullif(p->>'status', '');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
begin
  return jsonb_build_object(
    'total', (select count(*) from public.duplicate_candidates c where v_status is null or c.status::text = v_status),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'created_at', c.created_at, 'reviewed_at', c.reviewed_at,
        'a', public.reg_brief(c.registration_a), 'b', public.reg_brief(c.registration_b),
        'same_identity', (select ra.eligibility_identity_id = rb.eligibility_identity_id
            from public.registrations ra, public.registrations rb
            where ra.id = c.registration_a and rb.id = c.registration_b)) order by c.created_at, c.id)
      from (select * from public.duplicate_candidates cc
            where v_status is null or cc.status::text = v_status
            order by cc.created_at, cc.id limit v_limit offset v_offset) c), '[]'::jsonb));
end $$;

create function public.api_resolve_duplicate(p jsonb) returns jsonb language plpgsql as $$
declare
  v_admin uuid := (p->>'admin')::uuid; v_decision text := p->>'decision';
  c public.duplicate_candidates; v_ia uuid; v_ib uuid; v_wa boolean; v_wb boolean; v_keep uuid; v_drop uuid;
begin
  perform public.assert_admin(v_admin);
  if v_decision not in ('same', 'different') then raise exception 'invalid_decision'; end if;
  perform pg_advisory_xact_lock(hashtext('guc_tcs_duplicates'));
  select * into c from public.duplicate_candidates where id = (p->>'id')::uuid for update;
  if not found then raise exception 'candidate_not_found'; end if;
  if c.status <> 'pending' then raise exception 'already_resolved'; end if;

  if v_decision = 'same' then
    select eligibility_identity_id into v_ia from public.registrations where id = c.registration_a;
    select eligibility_identity_id into v_ib from public.registrations where id = c.registration_b;
    if v_ia <> v_ib then
      v_wa := exists (select 1 from public.winners where participant_identity_id = v_ia);
      v_wb := exists (select 1 from public.winners where participant_identity_id = v_ib);
      if v_wa and v_wb then raise exception 'both_identities_have_won'; end if;
      v_keep := case when v_wb then v_ib when v_wa then v_ia
                     else (select id from public.participant_identities where id in (v_ia, v_ib) order by created_at, id limit 1) end;
      v_drop := case when v_keep = v_ia then v_ib else v_ia end;
      update public.registrations set eligibility_identity_id = v_keep where eligibility_identity_id = v_drop;
      delete from public.participant_identities where id = v_drop;
      update public.participant_identities set duplicate_status = 'merged' where id = v_keep;
    end if;
    update public.duplicate_candidates set status = 'confirmed_same', reviewed_by = v_admin, reviewed_at = now() where id = c.id;
  else
    update public.duplicate_candidates set status = 'confirmed_different', reviewed_by = v_admin, reviewed_at = now() where id = c.id;
  end if;
  perform public.log_activity(v_admin, 'duplicate.' || v_decision,
    jsonb_build_object('candidate_id', c.id, 'registration_a', c.registration_a, 'registration_b', c.registration_b));
  return jsonb_build_object('id', c.id, 'decision', v_decision);
end $$;

create function public.api_add_duplicate_candidate(p jsonb) returns jsonb language plpgsql as $$
declare v_admin uuid := (p->>'admin')::uuid; v_a uuid := (p->>'registration_a')::uuid; v_b uuid := (p->>'registration_b')::uuid; v_id uuid;
begin
  perform public.assert_admin(v_admin);
  if v_a = v_b then raise exception 'invalid_pair'; end if;
  if not exists (select 1 from public.registrations where id = v_a) or not exists (select 1 from public.registrations where id = v_b) then
    raise exception 'registration_not_found';
  end if;
  select id into v_id from public.duplicate_candidates
   where (registration_a = v_a and registration_b = v_b) or (registration_a = v_b and registration_b = v_a);
  if v_id is null then
    insert into public.duplicate_candidates (registration_a, registration_b) values (v_a, v_b) returning id into v_id;
  end if;
  perform public.log_activity(v_admin, 'duplicate.flagged', jsonb_build_object('candidate_id', v_id));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard / system / logs / exports
-- ---------------------------------------------------------------------------
create function public.api_dashboard(p jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'day_number', d.day_number, 'event_date', d.event_date,
        'registration_open', d.registration_open, 'registration_target', d.registration_target,
        'registrations', (select count(*) from public.registrations r where r.event_day_id = d.id),
        'unique_people', (select count(distinct r.eligibility_identity_id) from public.registrations r where r.event_day_id = d.id),
        'photos_present', (select count(*) from public.registrations r where r.event_day_id = d.id and r.photo_path is not null),
        'photos_deleted', (select count(*) from public.registrations r where r.event_day_id = d.id and r.photo_deleted_at is not null),
        'draw_done', exists (select 1 from public.giveaway_draws g where g.draw_type = 'daily' and g.event_day_id = d.id))
      order by d.day_number), '[]'::jsonb) from public.event_days d),
    'totals', jsonb_build_object(
      'registrations', (select count(*) from public.registrations),
      'unique_people', (select count(distinct eligibility_identity_id) from public.registrations),
      'winners', (select count(*) from public.winners),
      'draws', (select count(*) from public.giveaway_draws),
      'active_staff', (select count(*) from public.profiles where role = 'staff' and is_active),
      'pending_duplicates', (select count(*) from public.duplicate_candidates where status = 'pending'),
      'global_draw_done', exists (select 1 from public.giveaway_draws where draw_type = 'global')),
    'recent_registrations', (select coalesce(jsonb_agg(public.reg_brief(x.id) order by x.created_at desc, x.reg_number desc), '[]'::jsonb)
        from (select id, created_at, reg_number from public.registrations order by created_at desc, reg_number desc limit 8) x),
    'staff_activity', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.full_name, 'registrations', s.n) order by s.n desc), '[]'::jsonb)
        from (select pr.id, pr.full_name, count(r.id) as n from public.profiles pr
              left join public.registrations r on r.registered_by = pr.id
              where pr.is_active group by pr.id, pr.full_name order by count(r.id) desc limit 10) s),
    'recent_activity', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'details', a.details, 'created_at', a.created_at, 'user_name', pr.full_name) order by a.id desc), '[]'::jsonb)
        from (select * from public.activity_logs order by id desc limit 8) a left join public.profiles pr on pr.id = a.user_id))
$$;

create function public.api_activity_logs(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'details', a.details, 'created_at', a.created_at,
      'user_id', a.user_id, 'user_name', pr.full_name) order by a.id desc), '[]'::jsonb)
  from (select * from public.activity_logs
        where (nullif(p->>'before', '') is null or id < (p->>'before')::bigint)
          and (nullif(p->>'action', '') is null or action like (p->>'action') || '%')
        order by id desc limit least(greatest(coalesce((p->>'limit')::int, 50), 1), 200)) a
  left join public.profiles pr on pr.id = a.user_id
$$;

create function public.api_system_status(p jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'database', 'ok',
    'event_days', (select count(*) from public.event_days),
    'days_open', (select count(*) from public.event_days where registration_open),
    'registrations', (select count(*) from public.registrations),
    'active_staff', (select count(*) from public.profiles where role = 'staff' and is_active),
    'admins', (select count(*) from public.profiles where role = 'admin' and is_active),
    'pending_duplicates', (select count(*) from public.duplicate_candidates where status = 'pending'),
    'draws', (select count(*) from public.giveaway_draws))
$$;

create function public.api_export_registrations(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'reg_number', r.reg_number, 'full_name', r.full_name, 'day_number', d.day_number,
      'staff', pr.full_name, 'registered_at', r.created_at,
      'photo', case when r.photo_path is not null then 'present' else 'deleted' end,
      'winner', exists (select 1 from public.winners w where w.registration_id = r.id),
      'person_id', r.eligibility_identity_id) order by r.reg_number), '[]'::jsonb)
  from public.registrations r
  join public.event_days d on d.id = r.event_day_id
  join public.profiles pr on pr.id = r.registered_by
  where nullif(p->>'event_day_id', '') is null or r.event_day_id = (p->>'event_day_id')::uuid
$$;

create function public.api_export_winners(p jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'draw_scope', case when g.draw_type = 'global' then 'Global' else 'Day ' || d.day_number end,
      'position', w.winner_position, 'full_name', r.full_name, 'reg_number', r.reg_number,
      'drawn_at', g.created_at, 'eligible_entries', g.eligible_entry_count) order by g.created_at, w.winner_position), '[]'::jsonb)
  from public.winners w
  join public.giveaway_draws g on g.id = w.draw_id
  join public.registrations r on r.id = w.registration_id
  left join public.event_days d on d.id = g.event_day_id
$$;

-- ---------------------------------------------------------------------------
-- Giveaway configuration and the official draw
-- ---------------------------------------------------------------------------
create function public.api_get_settings(p jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select to_jsonb(s) || jsonb_build_object(
    'day_number', (select day_number from public.event_days where id = s.event_day_id),
    'locked', s.active_draw_id is not null)
  from public.giveaway_settings s where s.id = 1
$$;

create function public.api_update_settings(p jsonb) returns jsonb language plpgsql as $$
declare v_admin uuid := (p->>'admin')::uuid; s public.giveaway_settings;
begin
  perform public.assert_admin(v_admin);
  select * into s from public.giveaway_settings where id = 1 for update;
  if s.active_draw_id is not null then raise exception 'settings_locked'; end if;
  update public.giveaway_settings set
    draw_type = coalesce((p->>'draw_type')::public.draw_type, draw_type),
    event_day_id = case when coalesce(p->>'draw_type', draw_type::text) = 'global' then null
                        else coalesce(nullif(p->>'event_day_id', '')::uuid, event_day_id) end,
    winner_count = coalesce((p->>'winner_count')::smallint, winner_count),
    exclude_previous_winners = coalesce((p->>'exclude_previous_winners')::boolean, exclude_previous_winners),
    acknowledge_pending_duplicates = coalesce((p->>'acknowledge_pending_duplicates')::boolean, acknowledge_pending_duplicates)
  where id = 1;
  perform public.log_activity(v_admin, 'giveaway.configured', p - 'admin');
  return public.api_get_settings();
end $$;

create function public.api_unlock_settings(p jsonb) returns jsonb language plpgsql as $$
declare v_admin uuid := (p->>'admin')::uuid;
begin
  perform public.assert_admin(v_admin);
  update public.giveaway_settings set active_draw_id = null where id = 1;
  perform public.log_activity(v_admin, 'giveaway.unlocked', '{}'::jsonb);
  return public.api_get_settings();
end $$;

create function public.api_set_muted(p jsonb) returns jsonb language plpgsql as $$
begin
  perform public.assert_admin((p->>'admin')::uuid);
  update public.giveaway_settings set muted = coalesce((p->>'muted')::boolean, false) where id = 1;
  return public.api_get_settings();
end $$;

create function public.api_draw_scope_stats(p jsonb) returns jsonb language plpgsql stable as $$
declare v_excl boolean := coalesce((p->>'exclude_previous')::boolean, true); v_out jsonb;
begin
  select coalesce(jsonb_agg(row order by ord), '[]'::jsonb) into v_out from (
    select d.day_number as ord, jsonb_build_object(
      'key', 'day-' || d.day_number, 'draw_type', 'daily', 'event_day_id', d.id, 'day_number', d.day_number,
      'eligible_people', (select count(distinct pool.identity_id) from public.get_draw_pool('daily', d.id, v_excl) pool),
      'registrations_with_photo', (select count(*) from public.registrations r where r.event_day_id = d.id and r.photo_path is not null),
      'pending_duplicates', (select count(*) from public.duplicate_candidates c
          join public.registrations ra on ra.id = c.registration_a join public.registrations rb on rb.id = c.registration_b
          where c.status = 'pending' and (ra.event_day_id = d.id or rb.event_day_id = d.id)),
      'draw_id', (select g.id from public.giveaway_draws g where g.draw_type = 'daily' and g.event_day_id = d.id)) as row
    from public.event_days d
    union all
    select 4, jsonb_build_object(
      'key', 'global', 'draw_type', 'global', 'event_day_id', null, 'day_number', null,
      'eligible_people', (select count(distinct pool.identity_id) from public.get_draw_pool('global', null, v_excl) pool),
      'registrations_with_photo', (select count(*) from public.registrations r where r.photo_path is not null),
      'pending_duplicates', (select count(*) from public.duplicate_candidates where status = 'pending'),
      'draw_id', (select g.id from public.giveaway_draws g where g.draw_type = 'global'))
  ) x;
  return v_out;
end $$;

create function public.api_draw_pool(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('identity_id', pool.identity_id, 'registration_id', pool.registration_id)), '[]'::jsonb)
  from public.get_draw_pool((p->>'draw_type')::public.draw_type, nullif(p->>'event_day_id', '')::uuid,
                            coalesce((p->>'exclude_previous')::boolean, true)) pool
$$;

create function public.api_finalize_draw(p jsonb) returns jsonb language plpgsql as $$
declare
  v_type public.draw_type := (p->>'draw_type')::public.draw_type; v_day uuid := nullif(p->>'event_day_id', '')::uuid;
  v_existing boolean; v_draw uuid;
begin
  select exists (select 1 from public.giveaway_draws g where g.draw_type = v_type and g.event_day_id is not distinct from v_day) into v_existing;
  v_draw := public.finalize_official_draw(
    (p->>'admin')::uuid, v_type, v_day, coalesce((p->>'exclude_previous')::boolean, true),
    (select array_agg(x::uuid) from jsonb_array_elements_text(p->'identity_ids') x),
    (select array_agg(x::uuid) from jsonb_array_elements_text(p->'registration_ids') x));
  update public.giveaway_settings set active_draw_id = v_draw where id = 1;
  return jsonb_build_object('draw_id', v_draw, 'created', not v_existing);
end $$;

create function public.draw_json(p_draw uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', g.id, 'draw_type', g.draw_type, 'event_day_id', g.event_day_id, 'day_number', d.day_number,
    'winner_count', g.winner_count, 'eligible_entry_count', g.eligible_entry_count,
    'exclude_previous_winners', g.exclude_previous_winners, 'created_at', g.created_at, 'status', g.status,
    'created_by_name', pr.full_name,
    'winners', coalesce((select jsonb_agg(jsonb_build_object(
          'position', w.winner_position, 'registration_id', r.id, 'reg_number', r.reg_number,
          'full_name', r.full_name, 'photo_path', r.photo_path, 'day_number', rd.day_number)
        order by w.winner_position)
      from public.winners w join public.registrations r on r.id = w.registration_id
      join public.event_days rd on rd.id = r.event_day_id where w.draw_id = g.id), '[]'::jsonb))
  from public.giveaway_draws g
  left join public.event_days d on d.id = g.event_day_id
  join public.profiles pr on pr.id = g.created_by
  where g.id = p_draw
$$;

create function public.api_get_draw(p jsonb) returns jsonb language sql stable as $$
  select public.draw_json((p->>'draw_id')::uuid) || jsonb_build_object(
    'session', (select jsonb_build_object('state', s.presentation_state, 'countdown_started_at', s.countdown_started_at)
                from public.presentation_sessions s where s.draw_id = (p->>'draw_id')::uuid))
$$;

create function public.api_list_draws(p jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(public.draw_json(g.id) order by g.created_at desc), '[]'::jsonb) from public.giveaway_draws g
$$;

-- ---------------------------------------------------------------------------
-- Presentation state machine (idle -> countdown -> revealed). Time comes from the API server.
-- ---------------------------------------------------------------------------
create function public.api_presentation(p jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'settings', public.api_get_settings(),
    'draw_id', s.active_draw_id,
    'session', (select jsonb_build_object('state', ps.presentation_state, 'countdown_started_at', ps.countdown_started_at)
                from public.presentation_sessions ps where ps.draw_id = s.active_draw_id))
  from public.giveaway_settings s where s.id = 1
$$;

create function public.api_presentation_action(p jsonb) returns jsonb language plpgsql as $$
declare
  v_action text := p->>'action'; v_draw uuid := (p->>'draw_id')::uuid; v_at timestamptz := (p->>'at')::timestamptz;
  v_admin uuid := nullif(p->>'admin', '')::uuid; v_changed int := 0; ps public.presentation_sessions;
begin
  if v_action <> 'reveal' then perform public.assert_admin(v_admin); end if;
  if v_action = 'start' then
    update public.presentation_sessions set presentation_state = 'countdown', countdown_started_at = v_at
      where draw_id = v_draw and presentation_state = 'idle';
  elsif v_action = 'replay' then
    update public.presentation_sessions set presentation_state = 'countdown', countdown_started_at = v_at
      where draw_id = v_draw and presentation_state = 'revealed';
  elsif v_action = 'reset' then
    update public.presentation_sessions set presentation_state = 'idle', countdown_started_at = null
      where draw_id = v_draw and presentation_state in ('countdown', 'revealed');
  elsif v_action = 'reveal' then
    update public.presentation_sessions set presentation_state = 'revealed'
      where draw_id = v_draw and presentation_state = 'countdown'
        and v_at >= countdown_started_at + interval '15 seconds';
  else
    raise exception 'invalid_action';
  end if;
  get diagnostics v_changed = row_count;
  if v_changed > 0 and v_action <> 'reveal' then
    perform public.log_activity(v_admin, 'presentation.' || v_action, jsonb_build_object('draw_id', v_draw));
  end if;
  select * into ps from public.presentation_sessions where draw_id = v_draw;
  if not found then raise exception 'draw_not_found'; end if;
  return jsonb_build_object('state', ps.presentation_state, 'countdown_started_at', ps.countdown_started_at, 'changed', v_changed > 0);
end $$;

-- A random sample of eligible photos for the shuffle visuals (visual only; never decides winners).
create function public.api_shuffle_sample(p jsonb) returns jsonb language plpgsql volatile as $$
declare s public.giveaway_settings; v_limit int := least(greatest(coalesce((p->>'limit')::int, 48), 1), 100);
begin
  select * into s from public.giveaway_settings where id = 1;
  return coalesce((select jsonb_agg(jsonb_build_object('registration_id', y.id, 'photo_path', y.photo_path)) from (
    select x.id, x.photo_path from (
      select distinct on (r.eligibility_identity_id) r.id, r.photo_path
      from public.registrations r
      where r.photo_path is not null
        and (s.draw_type = 'global' or r.event_day_id = s.event_day_id)
      order by r.eligibility_identity_id, random()) x
    order by random() limit v_limit) y), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Photo cleanup (registrations are never deleted; winner photos are never removed)
-- ---------------------------------------------------------------------------
create function public.api_cleanup_preview(p jsonb) returns jsonb language sql stable as $$
  with scope as (
    select r.* from public.registrations r
    where nullif(p->>'event_day_id', '') is null or r.event_day_id = (p->>'event_day_id')::uuid)
  select jsonb_build_object(
    'event_day_id', nullif(p->>'event_day_id', ''),
    'day_number', (select day_number from public.event_days where id = nullif(p->>'event_day_id', '')::uuid),
    'photos_to_delete', (select count(*) from scope s where s.photo_path is not null
        and not exists (select 1 from public.winners w where w.registration_id = s.id)),
    'protected_winner_photos', (select count(*) from scope s where s.photo_path is not null
        and exists (select 1 from public.winners w where w.registration_id = s.id)),
    'already_deleted', (select count(*) from scope s where s.photo_deleted_at is not null),
    'global_draw_done', exists (select 1 from public.giveaway_draws where draw_type = 'global'),
    'daily_draw_done', case when nullif(p->>'event_day_id', '') is null then null
        else exists (select 1 from public.giveaway_draws where draw_type = 'daily' and event_day_id = (p->>'event_day_id')::uuid) end)
$$;

create function public.api_cleanup_candidates(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'photo_path', x.photo_path) order by x.id), '[]'::jsonb)
  from (select r.id, r.photo_path from public.registrations r
        where r.photo_path is not null
          and (nullif(p->>'event_day_id', '') is null or r.event_day_id = (p->>'event_day_id')::uuid)
          and not exists (select 1 from public.winners w where w.registration_id = r.id)
        order by r.id limit least(greatest(coalesce((p->>'limit')::int, 100), 1), 500)) x
$$;

create function public.api_mark_photos_deleted(p jsonb) returns jsonb language plpgsql as $$
declare v_admin uuid := (p->>'admin')::uuid; v_ids uuid[]; v_n int;
begin
  perform public.assert_admin(v_admin);
  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(p->'ids') x;
  update public.registrations set photo_path = null, photo_deleted_at = now()
  where id = any(v_ids) and photo_path is not null
    and not exists (select 1 from public.winners w where w.registration_id = registrations.id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end $$;

create function public.api_log_cleanup(p jsonb) returns jsonb language plpgsql as $$
begin
  perform public.assert_admin((p->>'admin')::uuid);
  perform public.log_activity((p->>'admin')::uuid, 'cleanup.executed', p - 'admin');
  return '{}'::jsonb;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: backend (service role) only
-- ---------------------------------------------------------------------------
revoke all on public.giveaway_settings from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_role_name(), public.is_admin(), public.is_staff_or_admin() to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

notify pgrst, 'reload schema';
