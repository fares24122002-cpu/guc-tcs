/** Test-only server: real Express app on a throwaway PostgreSQL database with in-memory auth and storage. */
import { createServer } from "node:http";
import { loadEnv } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { Repo } from "../src/services/repo.js";
import { createTestDb, PgAuth, PgProfileStore, pgRpc } from "../test/harness.js";
import { DOMAIN } from "../test/fakes.js";
import type { PhotoStorage } from "../src/services/storage.js";

const port = Number(process.env.E2E_PORT ?? 4100);
const env = loadEnv({
  NODE_ENV: "test", CORS_ORIGINS: process.env.E2E_ORIGIN ?? "http://localhost:4173",
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "b",
  STAFF_EMAIL_DOMAIN: DOMAIN, RATE_LIMIT_MAX: "100000", RATE_LIMIT_IP_MAX: "100000",
} as NodeJS.ProcessEnv);

const files = new Map<string, { data: Buffer; type: string }>();
const base = `http://localhost:${port}`;
const storage: PhotoStorage = {
  async upload(p, d, t) { files.set(p, { data: d, type: t }); },
  async remove(paths) { paths.forEach((p) => files.delete(p)); return { removed: paths, failed: [] }; },
  async signedUrls(paths) { return new Map(paths.filter((p) => files.has(p)).map((p) => [p, `${base}/files/${p}`])); },
  async usage() { return { bytes: [...files.values()].reduce((n, f) => n + f.data.length, 0), objects: files.size }; },
};

const db = await createTestDb("guc_tcs_e2e");
const auth = new PgAuth(db.pool);
const store = new PgProfileStore(db.pool);
for (const [u, role] of [["boss", "admin"], ["anna", "staff"]] as const) {
  const id = await auth.createUser(`${u}@${DOMAIN}`, "e2e-password-123");
  await store.insert({ id, full_name: `${u[0]!.toUpperCase()}${u.slice(1)} Tester`, username: u, role });
}
await db.pool.query("update public.event_days set registration_open = true");

const app = createApp(env, { auth, store, repo: new Repo(pgRpc(db.pool)), storage });
const server = createServer((req, res) => {
  const m = /^\/files\/(.+)$/.exec(req.url ?? "");
  if (m) {
    const f = files.get(decodeURIComponent(m[1]!.split("?")[0]!));
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!f) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", f.type);
    return res.end(f.data);
  }
  app(req, res);
});
server.listen(port, () => console.log(`E2E API ready on ${port}`));
process.on("SIGTERM", () => void db.drop().finally(() => process.exit(0)));
