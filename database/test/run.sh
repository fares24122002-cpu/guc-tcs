#!/usr/bin/env bash
# Runs the migrations + assertions against a THROWAWAY local PostgreSQL (never Supabase).
# Usage: PGHOST=/tmp PGPORT=5544 PGUSER=postgres ./database/test/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DB="guc_tcs_test"
case "${PGHOST:-}" in
  *supabase*) echo "Refusing to run tests against Supabase." >&2; exit 1;;
esac

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in test/00_supabase_stub.sql migrations/0001_schema.sql migrations/0002_functions.sql \
         migrations/0003_rls.sql migrations/0004_storage.sql test/99_tests.sql; do
  echo ">> $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
