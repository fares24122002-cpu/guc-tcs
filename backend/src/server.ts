import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { createAdminClient, createAnonClient } from "./lib/supabase.js";
import { SupabaseAuthGateway, SupabaseProfileStore } from "./services/supabase.js";
import { Repo, supabaseRpc } from "./services/repo.js";
import { SupabasePhotoStorage } from "./services/storage.js";

const env = loadEnv();
const admin = createAdminClient(env);
const app = createApp(env, {
  auth: new SupabaseAuthGateway(admin, createAnonClient(env)),
  store: new SupabaseProfileStore(admin),
  repo: new Repo(supabaseRpc(admin)),
  storage: new SupabasePhotoStorage(admin, env.SUPABASE_PHOTO_BUCKET),
  sounds: new SupabasePhotoStorage(admin, "giveaway-sounds"),
});

const server = app.listen(env.PORT, () => {
  console.log(`GUC TCS API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
