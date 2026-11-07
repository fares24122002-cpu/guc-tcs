-- 0004_storage.sql — private photo bucket.
-- No storage.objects policies are created on purpose: with RLS on and no policy, anon and
-- authenticated users can neither list, read nor write photos. Only the backend (service role)
-- touches objects, and it hands the browser short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('participant-photos', 'participant-photos', false, 6291456,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
