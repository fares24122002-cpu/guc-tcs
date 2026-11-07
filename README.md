# GUC TCS 15th Anniversary Giveaway System

Registration, photo collection, secure five-winner draw and projector presentation for the GUC TCS 15th Anniversary (about 250 participants per day over 3 days).

```
backend/        Node.js + Express + TypeScript REST API
frontend/       React + TypeScript + Vite + Tailwind
database/       Supabase PostgreSQL migrations + tests
documentation/  Setup guide and design decisions
```

## Deploying
Everything can be done online from your browser: see `documentation/DEPLOYMENT.md` (Supabase and Vercel, all free).

## Local development (optional)
See `documentation/SUPABASE_SETUP.md`, then:

```bash
npm install
npm run dev
```

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | API (port 4000) and web app (port 5173) together |
| `npm run typecheck` | TypeScript checks for both apps |
| `npm test` | Backend tests |
| `./database/test/run.sh` | Database tests against a throwaway local PostgreSQL (needs `PGHOST`/`PGPORT`/`PGUSER`) |
| `npm run create-admin -w backend -- --username u --name "N"` | Create an administrator (`ADMIN_PASSWORD` env var) |
| `npm run build` | Production builds |

## Status
Phase 2 of 12 complete (schema, RLS, authentication and roles). See `documentation/DECISIONS.md`.
Secrets live only in `.env` files, which are git-ignored. Never commit them.
