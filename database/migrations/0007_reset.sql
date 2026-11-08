-- 0007_reset.sql — administrator-run "delete all audience data" (optionally keeping the winners).
--
-- Registrations, draws and winners are protected by triggers so nothing can be changed by accident.
-- This function is the single, deliberate exception: it runs as the table owner (SECURITY DEFINER),
-- only an active administrator may call it (checked inside), and it is only granted to the backend.
-- Everything happens in one transaction: either all of it is applied or none of it.

create function public.api_reset_preview(p jsonb default '{}') returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'registrations',          (select count(*) from public.registrations),
    'winner_registrations',   (select count(distinct registration_id) from public.winners),
    'draws',                  (select count(*) from public.giveaway_draws),
    'photos',                 (select count(*) from public.registrations where photo_path is not null),
    'winner_photos',          (select count(*) from public.registrations r
                                where r.photo_path is not null and exists (select 1 from public.winners w where w.registration_id = r.id))
  )
$$;

create function public.api_reset_data(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  admin uuid := (p->>'admin')::uuid;
  include_winners boolean := coalesce((p->>'include_winners')::boolean, false);
  paths jsonb;
  n_regs int; n_kept int := 0; n_winners int := 0; n_draws int := 0;
begin
  perform public.assert_admin(admin);

  select count(*) into n_regs from public.registrations;
  alter table public.registrations disable trigger user;
  alter table public.winners disable trigger user;
  alter table public.giveaway_draws disable trigger user;
  -- The identity <-> registration references point at each other with ON DELETE RESTRICT; lift the
  -- one from identities for the duration of this transaction and put it back at the end.
  alter table public.participant_identities drop constraint identities_canonical_fk;

  if include_winners then
    select coalesce(jsonb_agg(photo_path), '[]'::jsonb) into paths from public.registrations where photo_path is not null;
    select count(*) into n_winners from public.winners;
    select count(*) into n_draws from public.giveaway_draws;
    update public.giveaway_settings set active_draw_id = null where id = 1;
    delete from public.presentation_sessions;
    delete from public.winners;
    delete from public.giveaway_draws;
    delete from public.duplicate_candidates;
    delete from public.registrations;
    delete from public.participant_identities;
    alter table public.registrations alter column reg_number restart with 1;
  else
    select coalesce(jsonb_agg(r.photo_path), '[]'::jsonb) into paths
      from public.registrations r
     where r.photo_path is not null
       and not exists (select 1 from public.winners w where w.registration_id = r.id);
    select count(distinct registration_id) into n_kept from public.winners;
    n_winners := (select count(*) from public.winners);
    n_draws := (select count(*) from public.giveaway_draws);
    delete from public.duplicate_candidates d
     where not (exists (select 1 from public.winners w where w.registration_id = d.registration_a)
            and exists (select 1 from public.winners w where w.registration_id = d.registration_b));
    delete from public.registrations r
     where not exists (select 1 from public.winners w where w.registration_id = r.id);
    delete from public.participant_identities i
     where not exists (select 1 from public.registrations r where r.eligibility_identity_id = i.id);
    -- A kept person's canonical registration may have been a deleted one; point it at a kept one.
    update public.participant_identities i
       set canonical_registration_id = (select r.id from public.registrations r
                                         where r.eligibility_identity_id = i.id order by r.created_at limit 1)
     where not exists (select 1 from public.registrations r where r.id = i.canonical_registration_id);
  end if;

  alter table public.participant_identities
    add constraint identities_canonical_fk foreign key (canonical_registration_id)
    references public.registrations (id) on delete restrict deferrable initially deferred;
  alter table public.registrations enable trigger user;
  alter table public.winners enable trigger user;
  alter table public.giveaway_draws enable trigger user;

  perform public.log_activity(admin, 'data.reset', jsonb_build_object(
    'include_winners', include_winners,
    'registrations_before', n_regs,
    'registrations_kept', (select count(*) from public.registrations)));

  return jsonb_build_object(
    'registrations_before', n_regs,
    'registrations_kept', (select count(*) from public.registrations),
    'winners_deleted', case when include_winners then n_winners else 0 end,
    'draws_deleted', case when include_winners then n_draws else 0 end,
    'photo_paths', paths);
end $$;

revoke all on function public.api_reset_preview(jsonb), public.api_reset_data(jsonb) from public, anon, authenticated;
grant execute on function public.api_reset_preview(jsonb), public.api_reset_data(jsonb) to service_role;
notify pgrst, 'reload schema';
