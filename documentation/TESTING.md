# Testing

| What | How | Needs |
| --- | --- | --- |
| SQL rules (identities, duplicates, draw, immutability, RLS) | `PGHOST=/tmp PGPORT=5544 PGUSER=postgres ./database/test/run.sh` | local PostgreSQL |
| Backend unit + integration (permissions matrix, uploads, idempotency, draw, presentation timing, cleanup, exports) | `TEST_PG=1 npm test -w backend` | local PostgreSQL (same env vars) |
| Backend without a database | `npm test -w backend` (database tests are skipped) | nothing |
| Browser end-to-end (phone registration with a 4 MB photo, duplicate warning, projector 15 s shuffle, simultaneous reveal, read-only link, reduced motion) | start `npm run e2e:server -w backend`, build and `vite preview` the frontend on 4173, then `node backend/e2e/run.cjs` | local PostgreSQL + Playwright |

Tests never touch Supabase. The database tests build throwaway databases with a minimal stand-in for Supabase's `auth` and `storage` schemas.
