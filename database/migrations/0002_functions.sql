-- 0002_functions.sql — transaction-safe operations. Callable only by the backend (service_role).

-- Create a registration atomically. Safe to retry: the same idempotency key returns the same row.
create function public.create_registration(
  p_idempotency_key uuid,
  p_full_name       text,
  p_photo_path      text,
  p_event_day_id    uuid,
  p_registered_by   uuid,
  p_consent         boolean
) returns uuid
language plpgsql as $$
declare
  v_id   uuid;
  v_open boolean;
begin
  select r.id into v_id from public.registrations r where r.idempotency_key = p_idempotency_key;
  if found then return v_id; end if;

  select d.registration_open into v_open from public.event_days d where d.id = p_event_day_id;
  if not found then raise exception 'event_day_not_found'; end if;
  if not v_open then raise exception 'registration_closed'; end if;

  if not exists (select 1 from public.profiles p where p.id = p_registered_by and p.is_active) then
    raise exception 'staff_not_active';
  end if;

  begin
    insert into public.registrations
      (idempotency_key, full_name, photo_path, event_day_id, registered_by, consent, eligibility_identity_id)
    values
      (p_idempotency_key, btrim(p_full_name), p_photo_path, p_event_day_id, p_registered_by, p_consent,
       '00000000-0000-0000-0000-000000000000')  -- replaced by the BEFORE INSERT trigger
    returning id into v_id;
  exception when unique_violation then
    -- Concurrent double submit: return the winner of the race.
    select r.id into v_id from public.registrations r where r.idempotency_key = p_idempotency_key;
    if v_id is null then raise; end if;
  end;
  return v_id;
end $$;

-- The eligible pool for a draw: one row per (identity, registration with a photo).
-- The backend picks winners from this with Node's crypto RNG.
create function public.get_draw_pool(
  p_type             public.draw_type,
  p_event_day_id     uuid,
  p_exclude_previous boolean
) returns table (identity_id uuid, registration_id uuid)
language sql stable as $$
  select r.eligibility_identity_id, r.id
  from public.registrations r
  where r.photo_path is not null
    and (p_type = 'global' or r.event_day_id = p_event_day_id)
    and (not p_exclude_previous or not exists (
          select 1 from public.winners w where w.participant_identity_id = r.eligibility_identity_id))
$$;

-- Persist an official draw atomically. Re-validates everything the backend chose, takes a
-- per-scope lock, and returns the existing draw if one is already completed (create-or-retrieve).
create function public.finalize_official_draw(
  p_admin            uuid,
  p_type             public.draw_type,
  p_event_day_id     uuid,
  p_exclude_previous boolean,
  p_identity_ids     uuid[],
  p_registration_ids uuid[]
) returns uuid
language plpgsql as $$
declare
  v_scope    text := case when p_type = 'global' then 'draw:global' else 'draw:' || p_event_day_id::text end;
  v_existing uuid;
  v_count    int  := coalesce(array_length(p_identity_ids, 1), 0);
  v_eligible int;
  v_matched  int;
  v_draw     uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = p_admin and p.role = 'admin' and p.is_active) then
    raise exception 'admin_required';
  end if;
  if (p_type = 'daily') <> (p_event_day_id is not null) then
    raise exception 'invalid_scope';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_scope));

  select g.id into v_existing from public.giveaway_draws g
  where g.draw_type = p_type and g.event_day_id is not distinct from p_event_day_id;
  if found then return v_existing; end if;

  if v_count < 1 or v_count <> coalesce(array_length(p_registration_ids, 1), 0) then
    raise exception 'invalid_selection';
  end if;
  if (select count(distinct x) from unnest(p_identity_ids) x) <> v_count then
    raise exception 'duplicate_identity_in_selection';
  end if;

  select count(distinct pool.identity_id) into v_eligible
  from public.get_draw_pool(p_type, p_event_day_id, p_exclude_previous) pool;
  if v_eligible < v_count then raise exception 'not_enough_eligible'; end if;

  select count(*) into v_matched
  from unnest(p_identity_ids, p_registration_ids) as s(identity_id, registration_id)
  join public.get_draw_pool(p_type, p_event_day_id, p_exclude_previous) pool
    on pool.identity_id = s.identity_id and pool.registration_id = s.registration_id;
  if v_matched <> v_count then raise exception 'selection_not_in_pool'; end if;

  insert into public.giveaway_draws
    (event_day_id, draw_type, winner_count, eligible_entry_count, exclude_previous_winners, created_by)
  values
    (p_event_day_id, p_type, v_count, v_eligible, p_exclude_previous, p_admin)
  returning id into v_draw;

  insert into public.winners (draw_id, registration_id, participant_identity_id, winner_position)
  select v_draw, s.registration_id, s.identity_id, s.pos
  from unnest(p_identity_ids, p_registration_ids) with ordinality as s(identity_id, registration_id, pos);

  insert into public.presentation_sessions (draw_id) values (v_draw);

  insert into public.activity_logs (user_id, action, details)
  values (p_admin, 'draw.completed',
          jsonb_build_object('draw_id', v_draw, 'type', p_type, 'event_day_id', p_event_day_id,
                             'eligible', v_eligible, 'winners', v_count));
  return v_draw;
end $$;
