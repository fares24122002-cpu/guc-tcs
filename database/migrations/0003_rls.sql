-- 0003_rls.sql — Row Level Security and privileges.
-- The backend uses the service-role key (bypasses RLS) and enforces roles itself. These policies are a
-- second line of defence: if the anon key or a user token is ever used against the database directly,
-- almost nothing is readable and nothing is writable.

create function public.current_role_name() returns public.user_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create function public.is_staff_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_name() is not null
$$;

alter table public.profiles               enable row level security;
alter table public.event_days             enable row level security;
alter table public.participant_identities enable row level security;
alter table public.registrations          enable row level security;
alter table public.duplicate_candidates   enable row level security;
alter table public.giveaway_draws         enable row level security;
alter table public.winners                enable row level security;
alter table public.presentation_sessions  enable row level security;
alter table public.activity_logs          enable row level security;

-- Read-only policies. No INSERT/UPDATE/DELETE policy exists for anyone but the service role.
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

create policy event_days_select on public.event_days
  for select to authenticated using (public.is_staff_or_admin());

create policy registrations_select on public.registrations
  for select to authenticated
  using (public.is_admin() or (public.is_staff_or_admin() and registered_by = auth.uid()));

-- Privileges: strip everything, then grant the minimum.
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on public.profiles, public.event_days, public.registrations to authenticated;
grant execute on function public.current_role_name(), public.is_admin(), public.is_staff_or_admin() to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
