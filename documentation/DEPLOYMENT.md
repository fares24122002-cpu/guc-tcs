# Deploying online (no local setup needed)

Order matters: **Supabase → Render (backend) → Vercel (frontend) → connect them**. Everything is done in your browser.

You will handle three secrets. They are typed only into the hosts' settings pages: never into GitHub, the frontend, or chat.

| Secret | Where you type it |
|---|---|
| Supabase secret / service-role key | Render → Environment |
| Supabase publishable / anon key | Render → Environment |
| Admin password | Supabase dashboard (step A5) |

---

## A. Supabase (database, photos, logins)

**A1. Project.** supabase.com → New project → name `guc-tcs`, nearest region, strong database password.

**A2. Auth settings.** Authentication → Providers → Email: keep enabled, turn **Confirm email OFF**. Turn **Allow new users to sign up OFF** (Authentication → Sign In / Providers).

**A3. Migrations.** SQL Editor → New query. Paste and run each file from `database/migrations/` **in order, once each**: `0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_storage.sql`. Each should say "Success". On any error, stop and send me the exact message.
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

## B. Render (backend API)

1. render.com → New → **Web Service** → connect GitHub → pick `guc-tcs`.
2. Settings:
   - **Root Directory:** leave empty (repo root)
   - **Runtime:** Node
   - **Build Command:** `npm install --include=dev && npm run build -w backend`
   - **Start Command:** `npm run start -w backend`
   - **Health Check Path:** `/api/health`
   - **Instance type:** see the note below.
3. Environment variables (Environment tab):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | Project URL from A4 |
| `SUPABASE_ANON_KEY` | publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret / service_role key |
| `CORS_ORIGINS` | `https://placeholder.example.com` (you will replace this in step D) |
| `SUPABASE_PHOTO_BUCKET` | `participant-photos` |
| `STAFF_EMAIL_DOMAIN` | `staff.guc-tcs.test` |

   Do **not** set `PORT`; Render provides it.
4. Deploy. When it finishes, open `https://<your-service>.onrender.com/api/health`. You should see `{"ok":true,...}`. Copy this service URL.

**Instance type note.** Render's free instances go to sleep after inactivity and take about a minute to wake. That is fine for testing, but **use a paid instance during the three event days** so registration queues and the live draw never wait on a cold start.

---

## C. Vercel (website)

1. vercel.com → Add New → Project → import `guc-tcs`.
2. Settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (auto-detected)
   - Build/Output: defaults (`npm run build` / `dist`)
3. Environment variable:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://<your-service>.onrender.com/api` (note the `/api` at the end) |

4. Deploy. Copy the production address (for example `https://guc-tcs.vercel.app`).

> If the Vercel build fails because it cannot find workspace packages, tell me the exact error. I will adjust the repo layout. This particular setup could not be tested without a real Vercel account.

---

## D. Connect them

1. Render → your service → Environment → set `CORS_ORIGINS` to your exact Vercel address, with `https://` and **no trailing slash** (for example `https://guc-tcs.vercel.app`). Save; Render redeploys.
2. If you later add a custom domain, add it too, comma-separated.

---

## E. Check it works

1. Open your Vercel address. You should see the GUC TCS login screen.
2. Sign in with the admin **username** and password from A5. You should land on a page that says "Signed in as ... Administrator".
3. Try a wrong password: you should see "Incorrect username or password."

HTTPS is automatic on both Vercel and Render.

### If something fails
| Symptom | Likely cause |
|---|---|
| Login page loads but sign-in says "Cannot reach the server" | `VITE_API_URL` wrong, or `CORS_ORIGINS` does not exactly match the Vercel address. Redeploy Vercel after changing `VITE_API_URL`. |
| "Incorrect username or password" for the right password | Wrong username (use the username, not the email), or the profile row from A5 was not inserted. |
| Render deploy fails at start | A required environment variable is missing; the log names it. |
| Sign-in works but you see "deactivated" | The profile row exists with `is_active` false. |

Send me the exact message (never a key) and I will fix the code.

---

## Updating later
Push to GitHub and both hosts redeploy automatically. New phases that add database migrations: run the new SQL files in the Supabase SQL editor **before** merging the code that needs them.
