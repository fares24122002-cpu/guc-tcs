# Supabase setup (for local development)

> Deploying online? Use `DEPLOYMENT.md` instead. It covers Supabase and the hosts, and creates the admin without a terminal.

Do these once. They need your own Supabase account, so they cannot be done for you.

## 1. Create the project
1. Sign in at https://supabase.com and click **New project**.
2. Name it `guc-tcs`. Pick the region closest to the venue (for Egypt, an EU region such as Frankfurt is usually the lowest latency).
3. Set a strong database password and store it in a password manager. You will not need it in the app.
4. Wait for provisioning to finish (about 2 minutes).

## 2. Copy the API values
The dashboard layout changes over time; if a label below differs, look for the closest match.

**Project URL:** click the green **Connect** button at the top of the project, or open **Project Settings → Data API**. You can also build it from the address bar: `supabase.com/dashboard/project/<ref>` means the URL is `https://<ref>.supabase.co`.

**Keys:** **Project Settings → API Keys**.

| Supabase value | Goes into |
|---|---|
| Project URL | `SUPABASE_URL` in `backend/.env` |
| Publishable key (`sb_publishable_...`), or legacy `anon` key | `SUPABASE_ANON_KEY` in `backend/.env` |
| Secret key (`sb_secret_...`), or legacy `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` |

The service-role key bypasses all security rules. It lives only in `backend/.env` locally and in Render's environment settings in production. Never paste it into the frontend, GitHub, chat messages or screenshots.

## 3. Create the private photo bucket
In **Storage → New bucket**:
- Name: `participant-photos`
- **Public bucket: OFF**
- File size limit: `6 MB`
- Allowed MIME types: `image/jpeg, image/png, image/webp`

(Migration `0004_storage.sql` also creates/locks this bucket and deliberately adds **no** access policies, so only the backend can touch photos. You can create it by hand now or let the migration do it.)

## 4. Authentication settings
In **Authentication → Providers → Email**:
- Keep Email enabled.
- Turn **Confirm email OFF** (staff accounts are created by the admin, with no email link flow).
- In **Authentication → Sign In / Providers**, turn **Allow new users to sign up OFF**. This enforces "no public signup" at the Supabase level too.

## 5. Apply the database migrations
Open **SQL Editor → New query**, then paste and run each file from `database/migrations/` **in order, once each**:

1. `0001_schema.sql`
2. `0002_functions.sql`
3. `0003_rls.sql`
4. `0004_storage.sql`

Each should finish with "Success. No rows returned". If one fails, stop and send me the exact error; do not re-run the ones that already succeeded.

Afterwards, **Table Editor** should show: `profiles`, `event_days` (3 rows), `registrations`, `participant_identities`, `duplicate_candidates`, `giveaway_draws`, `winners`, `presentation_sessions`, `activity_logs`, each marked **RLS enabled**.

## 6. Local environment files
```bash
cp backend/.env.example backend/.env          # fill in the three Supabase values
cp frontend/.env.example frontend/.env.local   # usually no change needed locally
```

## 7. Create the first administrator
The password is read from an environment variable so it never appears as a command argument:

```bash
# macOS / Linux
ADMIN_PASSWORD='choose-a-long-passphrase' npm run create-admin -w backend -- --username yourname --name "Your Name"

# Windows PowerShell
$env:ADMIN_PASSWORD='choose-a-long-passphrase'; npm run create-admin -w backend -- --username yourname --name "Your Name"
```
Use at least 12 characters. Staff accounts are then created by this administrator through the API (the admin screen arrives in Phase 5).

## 8. Run locally
```bash
npm install
npm run dev       # API on :4000, web on :5173
```
Open http://localhost:5173 and sign in with the administrator you just created.

## How usernames work
Supabase Auth needs an email, so each username is mapped to `username@staff.guc-tcs.test` (setting `STAFF_EMAIL_DOMAIN`). No email is ever sent and there is no email confirmation or self-service password reset: the administrator resets passwords. Do not change the domain after accounts exist.

## Free-tier note
The free plan pauses projects after a week of inactivity and has limited storage and egress. Before the event, open the project once to make sure it is active, and check the plan limits against about 750 photos (roughly 375 MB at 500 KB each).
