-- 0006_sounds.sql — custom sounds for the projector (one for the countdown, one for the winners reveal).
-- Files live in a private bucket; only the backend (service role) touches them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('giveaway-sounds', 'giveaway-sounds', false, 4194304,
        array['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.giveaway_sounds (
  kind          text primary key check (kind in ('countdown', 'winners')),
  path          text not null,
  original_name text not null,
  content_type  text not null,
  size_bytes    integer not null check (size_bytes > 0),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now()
);
alter table public.giveaway_sounds enable row level security;

create function public.api_get_sounds(p jsonb default '{}') returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'path', path, 'name', original_name, 'content_type', content_type,
           'size_bytes', size_bytes, 'updated_at', updated_at)), '[]'::jsonb)
  from public.giveaway_sounds
$$;

-- Returns the previous file path (if any) so the backend can delete the old file.
create function public.api_set_sound(p jsonb) returns jsonb language plpgsql as $$
declare prev text; admin uuid := (p->>'admin')::uuid; k text := p->>'kind';
begin
  perform public.assert_admin(admin);
  select path into prev from public.giveaway_sounds where kind = k;
  insert into public.giveaway_sounds (kind, path, original_name, content_type, size_bytes, updated_by, updated_at)
  values (k, p->>'path', p->>'original_name', p->>'content_type', (p->>'size_bytes')::int, admin, now())
  on conflict (kind) do update
    set path = excluded.path, original_name = excluded.original_name, content_type = excluded.content_type,
        size_bytes = excluded.size_bytes, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_activity(admin, 'sound.set', jsonb_build_object('kind', k, 'name', p->>'original_name'));
  return jsonb_build_object('previous_path', prev);
end $$;

create function public.api_clear_sound(p jsonb) returns jsonb language plpgsql as $$
declare prev text; admin uuid := (p->>'admin')::uuid; k text := p->>'kind';
begin
  perform public.assert_admin(admin);
  delete from public.giveaway_sounds where kind = k returning path into prev;
  if prev is not null then
    perform public.log_activity(admin, 'sound.removed', jsonb_build_object('kind', k));
  end if;
  return jsonb_build_object('previous_path', prev);
end $$;

revoke all on public.giveaway_sounds from public, anon, authenticated;
revoke all on function public.api_get_sounds(jsonb), public.api_set_sound(jsonb), public.api_clear_sound(jsonb) from public, anon, authenticated;
grant all on public.giveaway_sounds to service_role;
grant execute on function public.api_get_sounds(jsonb), public.api_set_sound(jsonb), public.api_clear_sound(jsonb) to service_role;
notify pgrst, 'reload schema';
