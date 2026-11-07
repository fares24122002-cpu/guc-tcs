import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { createAdminClient, createAnonClient } from "./lib/supabase.js";
import { SupabaseAuthGateway, SupabaseProfileStore } from "./services/supabase.js";

const env = loadEnv();
const admin = createAdminClient(env);
const app = createApp(env, {
  auth: new SupabaseAuthGateway(admin, createAnonClient(env)),
  store: new SupabaseProfileStore(admin),
});

const server = app.listen(env.PORT, () => {
  console.log(`GUC TCS API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
