# Database

SQL migrations for Supabase PostgreSQL live in `migrations/`, numbered in order (`0001_...sql`).
They are added from Phase 2 onward. Apply them with the Supabase SQL editor or the Supabase CLI
(`supabase db push`); see `documentation/SUPABASE_SETUP.md`.

Rules for every migration: idempotent where practical, RLS enabled on every table, and critical
uniqueness enforced in the database, not only in application code.
