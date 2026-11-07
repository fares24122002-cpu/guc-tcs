-- 0001_schema.sql — core tables, constraints, indexes and integrity triggers.
-- Run once, in order, on a fresh Supabase project (SQL editor or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'staff');
create type public.draw_type as enum ('daily', 'global');
create type public.draw_status as enum ('completed');
create type public.presentation_state as enum ('idle', 'countdown', 'revealed');
create type public.identity_status as enum ('unique', 'merged');
create type public.candidate_status as enum ('pending', 'confirmed_same', 'confirmed_different');

-- ---------------------------------------------------------------------------
-- profiles (one per Supabase auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete restrict,
  full_name   text not null check (char_length(btrim(full_name)) between 2 and 120),
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  role        public.user_role not null default 'staff',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- event_days (exactly three days supported)
-- ---------------------------------------------------------------------------
create table public.event_days (
  id                  uuid primary key default gen_random_uuid(),
  day_number          smallint not null unique check (day_number between 1 and 3),
  event_date          date,
  registration_open   boolean not null default false,
  registration_target integer not null default 250 check (registration_target > 0),
  created_at          timestamptz not null default now()
);

insert into public.event_days (day_number) values (1), (2), (3);

-- ---------------------------------------------------------------------------
-- participant_identities / registrations (circular FK, resolved with a deferred constraint)
-- ---------------------------------------------------------------------------
create table public.participant_identities (
  id                        uuid primary key default gen_random_uuid(),
  canonical_registration_id uuid not null,
  duplicate_status          public.identity_status not null default 'unique',
  created_at                timestamptz not null default now()
);

create table public.registrations (
  id                      uuid primary key default gen_random_uuid(),
  reg_number              bigint generated always as identity unique,
  full_name               text not null check (char_length(btrim(full_name)) between 2 and 120),
  name_normalized         text generated always as (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))) stored,
  photo_path              text,
  photo_deleted_at        timestamptz,
  event_day_id            uuid not null references public.event_days (id) on delete restrict,
  registered_by           uuid not null references public.profiles (id) on delete restrict,
  eligibility_identity_id uuid not null references public.participant_identities (id) on delete restrict,
  consent                 boolean not null check (consent = true),
  idempotency_key         uuid not null unique,
  created_at              timestamptz not null default now(),
  -- A registration always has a photo, until cleanup removes it (then it is stamped as deleted).
  constraint photo_present_or_deleted check ((photo_path is not null) <> (photo_deleted_at is not null))
);

alter table public.participant_identities
  add constraint identities_canonical_fk
  foreign key (canonical_registration_id) references public.registrations (id)
  on delete restrict deferrable initially deferred;

create index registrations_event_day_idx on public.registrations (event_day_id);
create index registrations_name_idx      on public.registrations (name_normalized);
create index registrations_staff_idx     on public.registrations (registered_by);
create index registrations_created_idx   on public.registrations (created_at desc);
create index registrations_identity_idx  on public.registrations (eligibility_identity_id);

-- Duplicate review queue (populated automatically; reviewed by an administrator).
create table public.duplicate_candidates (
  id             uuid primary key default gen_random_uuid(),
  registration_a uuid not null references public.registrations (id) on delete restrict,
  registration_b uuid not null references public.registrations (id) on delete restrict,
  status         public.candidate_status not null default 'pending',
  reviewed_by    uuid references public.profiles (id) on delete restrict,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  check (registration_a <> registration_b),
  unique (registration_a, registration_b)
);
create index duplicate_candidates_status_idx on public.duplicate_candidates (status);

-- ---------------------------------------------------------------------------
-- Draws, winners, presentation, audit log
-- ---------------------------------------------------------------------------
create table public.giveaway_draws (
  id                     uuid primary key default gen_random_uuid(),
  event_day_id           uuid references public.event_days (id) on delete restrict,
  draw_type              public.draw_type not null,
  winner_count           smallint not null default 5 check (winner_count between 1 and 20),
  eligible_entry_count   integer not null check (eligible_entry_count >= winner_count),
  exclude_previous_winners boolean not null default true,
  created_by             uuid not null references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  status                 public.draw_status not null default 'completed',
  -- Daily draws belong to one day; global draws to none.
  check ((draw_type = 'daily') = (event_day_id is not null))
);
-- One official draw per scope, enforced by the database.
create unique index one_daily_draw_per_day on public.giveaway_draws (event_day_id) where draw_type = 'daily';
create unique index one_global_draw        on public.giveaway_draws ((true))        where draw_type = 'global';

create table public.winners (
  id                      uuid primary key default gen_random_uuid(),
  draw_id                 uuid not null references public.giveaway_draws (id) on delete restrict,
  registration_id         uuid not null references public.registrations (id) on delete restrict,
  participant_identity_id uuid not null references public.participant_identities (id) on delete restrict,
  winner_position         smallint not null check (winner_position between 1 and 20),
  created_at              timestamptz not null default now(),
  unique (draw_id, participant_identity_id),   -- one person can win once per draw
  unique (draw_id, winner_position),
  unique (draw_id, registration_id)
);
create index winners_identity_idx on public.winners (participant_identity_id);

create table public.presentation_sessions (
  id                   uuid primary key default gen_random_uuid(),
  draw_id              uuid not null unique references public.giveaway_draws (id) on delete restrict,
  presentation_state   public.presentation_state not null default 'idle',
  countdown_started_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.activity_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete restrict,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Every new registration gets its own eligibility identity (merged later by an admin).
create function public.registrations_before_insert() returns trigger
language plpgsql as $$
declare v_identity uuid;
begin
  insert into public.participant_identities (canonical_registration_id, duplicate_status)
  values (new.id, 'unique')
  returning id into v_identity;
  new.eligibility_identity_id := v_identity;
  return new;
end $$;
create trigger registrations_before_insert before insert on public.registrations
  for each row execute function public.registrations_before_insert();

-- Flag same-name registrations for review. Never merges anything automatically.
create function public.registrations_after_insert() returns trigger
language plpgsql as $$
begin
  insert into public.duplicate_candidates (registration_a, registration_b)
  select r.id, new.id from public.registrations r
  where r.name_normalized = new.name_normalized and r.id <> new.id
  on conflict do nothing;
  return new;
end $$;
create trigger registrations_after_insert after insert on public.registrations
  for each row execute function public.registrations_after_insert();

-- Registrations are permanent. Only photo cleanup and identity merging may touch them.
create function public.registrations_guard() returns trigger
language plpgsql as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'registrations cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.reg_number is distinct from old.reg_number
     or new.full_name is distinct from old.full_name
     or new.event_day_id is distinct from old.event_day_id
     or new.registered_by is distinct from old.registered_by
     or new.consent is distinct from old.consent
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'registration core fields are immutable';
  end if;
  if old.photo_path is null and new.photo_path is not null then
    raise exception 'a deleted photo cannot be restored';
  end if;
  return new;
end $$;
create trigger registrations_guard_row before update or delete on public.registrations
  for each row execute function public.registrations_guard();
create trigger registrations_guard_truncate before truncate on public.registrations
  for each statement execute function public.registrations_guard();

-- Official draw results and the audit log are write-once.
create function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: records are immutable', tg_op, tg_table_name;
end $$;

create trigger giveaway_draws_immutable before update or delete on public.giveaway_draws
  for each row execute function public.forbid_change();
create trigger giveaway_draws_no_truncate before truncate on public.giveaway_draws
  for each statement execute function public.forbid_change();
create trigger winners_immutable before update or delete on public.winners
  for each row execute function public.forbid_change();
create trigger winners_no_truncate before truncate on public.winners
  for each statement execute function public.forbid_change();
create trigger activity_logs_immutable before update or delete on public.activity_logs
  for each row execute function public.forbid_change();
create trigger activity_logs_no_truncate before truncate on public.activity_logs
  for each statement execute function public.forbid_change();

-- Profiles are never deleted, and the last active administrator cannot be removed.
create function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('guc_tcs_admin_guard'));
  if tg_op = 'DELETE' then
    raise exception 'profiles cannot be deleted; deactivate the account instead';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable';
  end if;
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    if not exists (select 1 from public.profiles p
                   where p.id <> old.id and p.role = 'admin' and p.is_active) then
      raise exception 'cannot deactivate or demote the last active administrator';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update or delete on public.profiles
  for each row execute function public.profiles_guard();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger presentation_sessions_touch before update on public.presentation_sessions
  for each row execute function public.touch_updated_at();
