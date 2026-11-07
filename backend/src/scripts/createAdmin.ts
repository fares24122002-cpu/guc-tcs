/**
 * Create the first (or an additional) administrator.
 *
 *   ADMIN_PASSWORD='a-long-passphrase' npm run create-admin -w backend -- --username fares --name "Fares"
 *
 * The password is read from the ADMIN_PASSWORD environment variable so it never lands in shell history
 * as a command-line argument or in process listings.
 */
import { loadEnv } from "../config/env.js";
import { createAdminClient, createAnonClient } from "../lib/supabase.js";
import { SupabaseAuthGateway, SupabaseProfileStore } from "../services/supabase.js";
import { bootstrapAdmin } from "../services/bootstrap.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const username = arg("username");
const fullName = arg("name");
const password = process.env.ADMIN_PASSWORD;

if (!username || !fullName || !password) {
  console.error(
    'Usage: ADMIN_PASSWORD="12+ character password" npm run create-admin -w backend -- --username <username> --name "<Full Name>"',
  );
  process.exit(1);
}

try {
  const env = loadEnv();
  const admin = createAdminClient(env);
  const profile = await bootstrapAdmin(
    { auth: new SupabaseAuthGateway(admin, createAnonClient(env)), store: new SupabaseProfileStore(admin) },
    { username, fullName, password, emailDomain: env.STAFF_EMAIL_DOMAIN },
  );
  console.log(`Administrator "${profile.username}" created. You can now sign in.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
