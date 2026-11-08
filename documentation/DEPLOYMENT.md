# Deploying online (no local setup, no card, free)

Order matters: **Supabase → Vercel API project → Vercel website project → connect them**. Everything is done in your browser.

You will handle three secrets. They are typed only into the hosts' settings pages: never into GitHub, the frontend, or chat.

| Secret | Where you type it |
|---|---|
| Supabase secret / service-role key | Vercel API project → Environment Variables |
| Supabase publishable / anon key | Vercel API project → Environment Variables |
| Admin password | Supabase dashboard (step A5) |

---

## A. Supabase (database, photos, logins)

**A1. Project.** supabase.com → New project → name `guc-tcs`, nearest region, strong database password.

**A2. Auth settings.** Authentication → Providers → Email: keep enabled, turn **Confirm email OFF**. Turn **Allow new users to sign up OFF** (Authentication → Sign In / Providers).

**A3. Migrations.** SQL Editor → New query. Paste and run each file from `database/migrations/` **in order, once each**: `0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_storage.sql`, `0005_features.sql`, `0006_sounds.sql`, `0007_reset.sql`, `0008_presenter.sql`. Each should say "Success". On any error, stop and send me the exact message.
Check: Table Editor shows 9 tables with RLS enabled, and `event_days` has 3 rows. Storage shows a private `participant-photos` bucket.

**A4. Copy three values** (Project Settings → API Keys, and the **Connect** button for the URL; or build it from the address bar: `supabase.com/dashboard/project/<ref>` gives `https://<ref>.supabase.co`):
- Project URL
- Publishable key (or legacy `anon`)
- Secret key (or legacy `service_role`)

**A5. Create your administrator** (no terminal needed).
1. Authentication → Users → **Add user → Create new user**.
2. Email: `yourname@staff.guc-tcs.test` (use the username you want, lowercase, 3-32 letters/numbers/`.`/`_`/`-`). Password: 12+ characters. Tick **Auto Confirm User**.
3. SQL Editor → run (change the three values to match):

```sql
insert into public.profiles (id, full_name, username, role)
select id, 'Your Full Name', 'yourname', 'admin'
from auth.users
where email = 'yourname@staff.guc-tcs.test';
```
It should report 1 row inserted. If it says 0 rows, the email in the `where` does not match the user you created.

You sign in with the **username** (`yourname`), not the email.

---

## B. Vercel project #1: the API (free, no card)

The API runs as a Vercel serverless function, so it needs its own Vercel project, separate from the website.

1. vercel.com → Add New → Project → import `guc-tcs`.
2. Name it `guc-tcs-api`. Settings:
   - **Root Directory:** `backend`
   - **Framework Preset:** Other
   - Leave Build/Install/Output commands alone. They come from `backend/vercel.json`.
3. Environment variables (before the first deploy):

| Key | Value |
|---|---|
| `SUPABASE_URL` | Project URL from A4 |
| `SUPABASE_ANON_KEY` | publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret / service_role key |
| `CORS_ORIGINS` | `https://placeholder.example.com` (replace in step D) |
| `SUPABASE_PHOTO_BUCKET` | `participant-photos` |
| `STAFF_EMAIL_DOMAIN` | The domain of the admin email from A5 (the part after the `@`). It must match exactly. |

   Do **not** set `PORT`.
4. Deploy. Then open `https://<api-project>.vercel.app/api/health`. You should see `{"ok":true,...}`. Copy this address.

**Free-plan limits worth knowing**
- Vercel's free (Hobby) plan is meant for non-commercial use. A university event fits that.
- API requests have a size limit of about 4.5 MB. Photos are compressed to about 500 KB in the browser before upload, so this is fine.
- The API can take a second or two to answer the first request after a quiet period (a "cold start"). It does not go to sleep for a minute like Render's free tier.
- Rate limits are kept in memory per function instance, so they are softer than on a single server. Supabase's own login rate limiting still applies. We will tighten this later if needed.

---

## C. Vercel project #2: the website

1. vercel.com → Add New → Project → import `guc-tcs` **again** (a second project).
2. Name it `guc-tcs`. Settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (auto-detected)
   - Build/Output: defaults (`npm run build` / `dist`)
3. Environment variable:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://<api-project>.vercel.app/api` (the API address from step B, with `/api` at the end) |

4. Deploy. Copy the production address (for example `https://guc-tcs.vercel.app`).

> Neither Vercel project could be tested here without a real Vercel account. If a build fails, send me the exact error and I will adjust the repo.

---

## D. Connect them

1. Vercel → the **API** project → Settings → Environment Variables → set `CORS_ORIGINS` to your website address, with `https://` and **no trailing slash** (for example `https://guc-tcs.vercel.app`). Then **redeploy** the API project (Deployments → ⋯ → Redeploy), because changes only apply to new deployments.
2. If you later add a custom domain, add it too, comma-separated.

---

## E. Check it works

1. Open your Vercel address. You should see the GUC TCS login screen.
2. Sign in with the admin **username** and password from A5. You should land on a page that says "Signed in as ... Administrator".
3. Try a wrong password: you should see "Incorrect username or password."

HTTPS is automatic on Vercel.

### If something fails
| Symptom | Likely cause |
|---|---|
| Login page loads but sign-in says "Cannot reach the server" | `VITE_API_URL` wrong, or `CORS_ORIGINS` does not exactly match the website address. Redeploy the relevant project after changing either. |
| "Incorrect username or password" for the right password | Wrong username (use the username, not the email), or the profile row from A5 was not inserted. |
| API shows an error page or `/api/health` fails | A required environment variable is missing in the API project; Deployments → the latest one → Logs names it. |
| Sign-in works but you see "deactivated" | The profile row exists with `is_active` false. |

Send me the exact message (never a key) and I will fix the code.

---

## Updating later
Push to GitHub and both Vercel projects redeploy automatically. New phases that add database migrations: run the new SQL files in the Supabase SQL editor **before** merging the code that needs them.

---

## Free-plan checklist (Supabase)
- **Pausing:** free Supabase projects pause after about a week without activity. Open the dashboard and make sure the project is active the day before the event, and use the app once.
- **Storage:** the free plan includes about 1 GB of file storage. 750 photos at about 500 KB each is roughly 375 MB.
- **Backups:** the free plan has no automatic backups. Export registrations (Phase 11) at the end of each day.

---

## Lessons from the first deployment
- Every variable listed in step B must exist in the **API** project, or the API crashes at startup. The log names the missing one (Vercel → project → Logs).
- Changing an environment variable only takes effect after a **redeploy**.
- `STAFF_EMAIL_DOMAIN` must equal the domain of the admin's email in Supabase, or sign-in says "Incorrect username or password".
- `CORS_ORIGINS` belongs only to the API project. The website project needs only `VITE_API_URL`.
