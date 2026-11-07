#!/usr/bin/env bash
# Runs all migrations + assertions against THROWAWAY local PostgreSQL databases (never Supabase).
# Usage: PGHOST=/tmp PGPORT=5544 PGUSER=postgres ./database/test/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

case "${PGHOST:-}" in
  *supabase*) echo "Refusing to run tests against Supabase." >&2; exit 1;;
esac

fresh() { # fresh <db>: new database with the Supabase stub and every migration applied
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $1" -c "create database $1"
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f test/00_supabase_stub.sql
  for f in migrations/*.sql; do echo ">> $1: $f"; psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$f"; done
}

fresh guc_tcs_test
echo ">> test/99_tests.sql"; psql -v ON_ERROR_STOP=1 -q -d guc_tcs_test -f test/99_tests.sql

fresh guc_tcs_test_api
echo ">> test/98_api_tests.sql"; psql -v ON_ERROR_STOP=1 -q -d guc_tcs_test_api -f test/98_api_tests.sql
