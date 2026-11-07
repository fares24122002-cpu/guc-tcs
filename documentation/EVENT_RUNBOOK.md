# Event runbook

## Before the event
1. Sign in as admin → **Event days**: set each day's date and target. Leave registration **closed** until the doors open.
2. **Staff**: create one login per media team member (12+ character password). Give each person their own login so the activity log is meaningful.
3. Put the official logo at `frontend/public/logo.png` (push to `main`); until then a "Logo" placeholder is shown.
4. Open **Giveaway** and check the settings: draw type (daily/global), number of winners, "exclude earlier winners".
5. Open `/present` on the projector laptop (signed in as admin) and press **F** for full screen. Click once anywhere to allow sound.

## During registration
- Staff open the site on their phone → **Register**: take photo → name → consent → **Register**. A code like `TCS-00042` confirms it.
- If the same name was already registered the app asks first. Choose **Different person** only if it truly is another person.
- If the network drops, tap **Try again**: the same submission is never saved twice.
- Admin: **Dashboard** shows live counts. **Duplicates** lists names that may be the same person; merge or keep separate.

## The draw
1. **Duplicates**: review everything pending (or consciously tick "draw even if duplicates are unreviewed").
2. **Giveaway**: choose the day (or Global) and number of winners.
3. Projector: press **SHUFFLE**. The server makes the random choice, the 15-second countdown runs, then all winners appear together.
4. The draw is permanent and locked. Reloading or replaying only shows the same winners. **Replay** and **Back to start screen** are on the Giveaway page.
5. For the next draw: Giveaway → **Unlock for a new draw**.
6. A second screen can follow along read-only: Giveaway → **Create read-only screen link** (valid 12 hours).

## After the event
- **Reports**: download registrations and winners as Excel or CSV.
- **Photos**: delete participant photos to free storage. Registrations and winner photos are always kept. You must type `DELETE PHOTOS`.
- Free Supabase projects pause after about a week of inactivity and have no backups. Download the reports before the event ends.
