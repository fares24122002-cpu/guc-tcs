# Design decisions

| # | Decision | Status |
|---|---|---|
| 1 | Built from scratch; the earlier MongoDB/Cloudinary MVP is not reused. | Confirmed |
| 2 | Photos are kept until the global draw is finished, then cleaned up with admin confirmation. This resolves the conflict between daily cleanup and a global draw. | Default, awaiting confirmation |
| 3 | Past winners are excluded from later draws, with an admin toggle. | Default, awaiting confirmation |
| 4 | Use a paid Render instance during the 3 event days so the API never sleeps. | Recommended |
| 5 | Logo is a placeholder until the official GUC TCS file is provided. | Open |
| 6 | The browser never talks to Supabase directly. All access goes through the backend API. | Confirmed (architecture) |
| 7 | Rate limiting is per authenticated user, because staff share venue Wi-Fi. | Done in Phase 2 |
| 8 | One official draw per scope (one per event day, one global), enforced by unique indexes. A "new draw" means a different scope. Completed draws and winners are immutable (database triggers). | Confirmed (architecture) |
| 9 | Admin accounts are created only by the command-line script, never over HTTP. The API can only create and edit media staff. | Confirmed |
| 10 | Role and active status are re-read from the database on every request; deactivation takes effect immediately. | Confirmed |
| 11 | Registrations can never be deleted or renamed. Only photo cleanup and duplicate merging may change them. | Confirmed |
| 12 | Same-name registrations are queued for review and never merged automatically. | Confirmed |
