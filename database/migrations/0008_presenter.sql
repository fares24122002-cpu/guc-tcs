-- 0008_presenter.sql — a login that can only run the presentation screen ("presenter").
-- A presenter may open the projector page and press SHUFFLE. It cannot see registrations, staff,
-- settings or reports, cannot register anyone and cannot change the draw configuration.

alter type public.user_role add value if not exists 'presenter';

-- Written in plpgsql and comparing as text so nothing depends on the new enum value at creation time.
create or replace function public.assert_operator(p_user uuid) returns void language plpgsql stable as $$
begin
  if p_user is null or not exists (
       select 1 from public.profiles where id = p_user and role::text in ('admin', 'presenter') and is_active) then
    raise exception 'admin_required';
  end if;
end $$;

-- Same function as before, except that starting the presentation (SHUFFLE) also accepts a presenter.
create or replace function public.api_presentation_action(p jsonb) returns jsonb language plpgsql as $$
declare
  v_action text := p->>'action'; v_draw uuid := (p->>'draw_id')::uuid; v_at timestamptz := (p->>'at')::timestamptz;
  v_admin uuid := nullif(p->>'admin', '')::uuid; v_changed int := 0; ps public.presentation_sessions;
begin
  if v_action = 'start' then perform public.assert_operator(v_admin);
  elsif v_action <> 'reveal' then perform public.assert_admin(v_admin); end if;
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

-- The official draw itself may also be created by a presenter pressing SHUFFLE (creation is still
-- single-use per scope: a second call retrieves the existing draw).
create or replace function public.finalize_official_draw(
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
  if not exists (select 1 from public.profiles p where p.id = p_admin and p.role::text in ('admin', 'presenter') and p.is_active) then
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

revoke all on function public.assert_operator(uuid) from public, anon, authenticated;
grant execute on function public.assert_operator(uuid) to service_role;
notify pgrst, 'reload schema';
