// Vercel serverless entry point. Vercel runs `npm run build` first, which compiles src/ to dist/.
// The Express app is itself a (req, res) handler, so it can be exported directly.
import { loadEnv } from "../dist/config/env.js";
import { createApp } from "../dist/app.js";
import { createAdminClient, createAnonClient } from "../dist/lib/supabase.js";
import { SupabaseAuthGateway, SupabaseProfileStore } from "../dist/services/supabase.js";

const env = loadEnv();
const admin = createAdminClient(env);

export default createApp(env, {
  auth: new SupabaseAuthGateway(admin, createAnonClient(env)),
  store: new SupabaseProfileStore(admin),
});
