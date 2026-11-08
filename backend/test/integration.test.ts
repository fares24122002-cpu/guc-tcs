import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type pg from "pg";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { Repo } from "../src/services/repo.js";
import { createProjectorToken, projectorSecret } from "../src/services/projector.js";
import { DOMAIN, MemoryStorage } from "./fakes.js";
import { createTestDb, JPEG, PgAuth, PgProfileStore, pgConfigured, pgRpc } from "./harness.js";

const env = loadEnv({
  NODE_ENV: "test",
  CORS_ORIGINS: "https://app.example.com",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STAFF_EMAIL_DOMAIN: DOMAIN,
  RATE_LIMIT_MAX: "100000",
  RATE_LIMIT_IP_MAX: "100000",
} as NodeJS.ProcessEnv);

describe.skipIf(!pgConfigured)("giveaway system against a real PostgreSQL database", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let app: Express;
  let storage: MemoryStorage;
  let sounds: MemoryStorage;
  let auth: PgAuth;
  let admin: string, staff: string, staff2: string;
  let adminId: string;
  let days: { id: string; day_number: number }[];

  const get = (t: string, url: string) => request(app).get(url).set("Authorization", `Bearer ${t}`);
  const post = (t: string, url: string, body: object = {}) => request(app).post(url).set("Authorization", `Bearer ${t}`).send(body);

  async function token(username: string, role: "admin" | "staff") {
    const id = await auth.createUser(`${username}@${DOMAIN}`, "pw-pw-pw-pw-12");
    await new PgProfileStore(pool).insert({ id, full_name: `${username} Person`, username, role });
    const s = await auth.signIn(`${username}@${DOMAIN}`, "pw-pw-pw-pw-12");
    return { id, t: s!.session.access_token };
  }

  const register = (t: string, name: string, dayId: string, extra: Record<string, string> = {}, buf: Buffer = JPEG()) => {
    const r = request(app)
      .post("/api/registrations")
      .set("Authorization", `Bearer ${t}`)
      .field("full_name", name)
      .field("event_day_id", dayId)
      .field("idempotency_key", extra.idempotency_key ?? crypto.randomUUID())
      .field("consent", extra.consent ?? "true");
    if (extra.allow_duplicate) r.field("allow_duplicate", extra.allow_duplicate);
    return r.attach("photo", buf, { filename: "p.jpg", contentType: "image/jpeg" });
  };

  beforeAll(async () => {
    const db = await createTestDb("guc_tcs_it");
    pool = db.pool;
    drop = db.drop;
    storage = new MemoryStorage();
    sounds = new MemoryStorage();
    auth = new PgAuth(pool);
    app = createApp(env, { auth, store: new PgProfileStore(pool), repo: new Repo(pgRpc(pool)), storage, sounds });
    const a = await token("boss", "admin");
    admin = a.t;
    adminId = a.id;
    staff = (await token("anna", "staff")).t;
    staff2 = (await token("omar", "staff")).t;
    days = (await get(admin, "/api/event-days")).body.days;
    expect(days.every((d: { registration_open: boolean }) => d.registration_open === false)).toBe(true);
    for (const d of days) await request(app).patch(`/api/event-days/${d.id}`).set("Authorization", `Bearer ${admin}`).send({ registration_open: true }).expect(200);
  });
  afterAll(async () => {
    await drop?.();
  });

  describe("permissions", () => {
    const adminOnly: [string, string][] = [
      ["get", "/api/admin/dashboard"], ["get", "/api/admin/activity"], ["get", "/api/admin/system"],
      ["get", "/api/duplicates"], ["get", "/api/draws"], ["get", "/api/draws/settings"], ["put", "/api/draws/settings"],
      ["post", "/api/draws/unlock"], ["get", "/api/cleanup"], ["post", "/api/cleanup"], ["get", "/api/reset"], ["post", "/api/reset"],
      ["get", "/api/exports/registrations.csv"], ["get", "/api/exports/winners.xlsx"],
      ["post", "/api/presentation/shuffle"], ["post", "/api/presentation/replay"], ["post", "/api/presentation/reset"],
      ["post", "/api/presentation/mute"], ["post", "/api/presentation/projector-token"],
      ["get", "/api/staff"],
    ];
    it.each(adminOnly)("%s %s needs sign-in and the admin role", async (method, url) => {
      const anon = await (request(app) as any)[method](url).send({});
      expect(anon.status).toBe(401);
      const s = await (request(app) as any)[method](url).set("Authorization", `Bearer ${staff}`).send({});
      expect(s.status).toBe(403);
    });
    it("staff cannot change event days", async () => {
      const r = await request(app).patch(`/api/event-days/${days[0]!.id}`).set("Authorization", `Bearer ${staff}`).send({ registration_open: false });
      expect(r.status).toBe(403);
    });
    it("presentation reads reject missing or bad projector tokens and staff", async () => {
      expect((await request(app).get("/api/presentation/state")).status).toBe(401);
      expect((await request(app).get("/api/presentation/state?t=bogus")).status).toBe(401);
      expect((await get(staff, "/api/presentation/state")).status).toBe(403);
      expect((await request(app).get("/api/presentation/pool")).status).toBe(401);
    });
    it("deactivated staff are locked out immediately", async () => {
      const u = await token("gone", "staff");
      expect((await get(u.t, "/api/registrations/summary")).status).toBe(200);
      await pool.query("update public.profiles set is_active = false where id = $1", [u.id]);
      expect((await get(u.t, "/api/registrations/summary")).status).toBe(403);
    });
  });

  describe("registration", () => {
    it("stores a photo and returns the registration with a signed photo URL", async () => {
      const r = await register(staff, "Mona Hassan", days[0]!.id);
      expect(r.status).toBe(201);
      expect(r.body.registration.code).toMatch(/^TCS-\d{5}$/);
      expect(r.body.registration.photo_url).toContain("https://files.test/event-day-1/");
      expect(storage.files.size).toBe(1);
    });
    it("is safe to retry: the same key never creates a second record or a second file", async () => {
      const key = crypto.randomUUID();
      const a = await register(staff, "Retry Person", days[0]!.id, { idempotency_key: key });
      const files = storage.files.size;
      const b = await register(staff, "Retry Person", days[0]!.id, { idempotency_key: key });
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.body.already_saved).toBe(true);
      expect(b.body.registration.id).toBe(a.body.registration.id);
      expect(storage.files.size).toBe(files);
      const other = await register(staff2, "Someone Else", days[0]!.id, { idempotency_key: key });
      expect(other.status).toBe(409);
    });
    it("rejects non-images, spoofed content types, oversize files, missing photo and missing consent", async () => {
      const fake = await register(staff, "Fake Image", days[0]!.id, {}, Buffer.from("<html>not an image at all</html>"));
      expect(fake.status).toBe(400);
      const big = await register(staff, "Big Image", days[0]!.id, {}, JPEG(6 * 1024 * 1024 + 10));
      expect(big.status).toBe(413);
      const noPhoto = await request(app).post("/api/registrations").set("Authorization", `Bearer ${staff}`)
        .field("full_name", "No Photo").field("event_day_id", days[0]!.id).field("idempotency_key", crypto.randomUUID()).field("consent", "true");
      expect(noPhoto.status).toBe(400);
      const noConsent = await register(staff, "No Consent", days[0]!.id, { consent: "false" });
      expect(noConsent.status).toBe(400);
      const before = storage.files.size;
      await register(staff, "x", days[0]!.id);
      expect(storage.files.size).toBe(before);
    });
    it("warns about an existing name instead of silently blocking, and allows it when confirmed", async () => {
      const dup = await register(staff2, "  mona   HASSAN ", days[1]!.id);
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe("possible_duplicate");
      const ok = await register(staff2, "mona hassan", days[1]!.id, { allow_duplicate: "true" });
      expect(ok.status).toBe(201);
    });
    it("refuses registrations on a closed day and leaves no orphan photo", async () => {
      await request(app).patch(`/api/event-days/${days[2]!.id}`).set("Authorization", `Bearer ${admin}`).send({ registration_open: false }).expect(200);
      const before = storage.files.size;
      const r = await register(staff, "Late Person", days[2]!.id);
      expect(r.status).toBe(409);
      expect(storage.files.size).toBe(before);
      await request(app).patch(`/api/event-days/${days[2]!.id}`).set("Authorization", `Bearer ${admin}`).send({ registration_open: true }).expect(200);
    });
    it("staff only see their own registrations; admins see all", async () => {
      const mine = await get(staff2, "/api/registrations?limit=200");
      expect(mine.status).toBe(200);
      expect(mine.body.registrations.every((x: { registered_by: string }) => x.registered_by !== undefined)).toBe(true);
      const names = mine.body.registrations.map((x: { full_name: string }) => x.full_name);
      expect(names).not.toContain("Retry Person");
      const all = await get(admin, "/api/registrations?limit=200");
      expect(all.body.total).toBeGreaterThan(mine.body.total);
      const someone = all.body.registrations.find((x: { full_name: string }) => x.full_name === "Retry Person");
      expect((await get(staff2, `/api/registrations/${someone.id}`)).status).toBe(404);
      expect((await get(admin, `/api/registrations/${someone.id}`)).status).toBe(200);
    });
    it("search treats wildcard characters literally", async () => {
      const r = await get(admin, `/api/registrations?q=${encodeURIComponent("%")}`);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(0);
    });
  });

  describe("duplicates", () => {
    it("lists the pending possible duplicate and merging keeps one person per identity", async () => {
      const list = await get(admin, "/api/duplicates?status=pending");
      expect(list.status).toBe(200);
      expect(list.body.total).toBeGreaterThan(0);
      const item = list.body.items[0];
      const r = await post(admin, `/api/duplicates/${item.id}/resolve`, { decision: "same" });
      expect(r.status).toBe(200);
      expect((await post(admin, `/api/duplicates/${item.id}/resolve`, { decision: "same" })).status).toBe(409);
      expect((await post(admin, `/api/duplicates/${item.id}/resolve`, { decision: "maybe" })).status).toBe(400);
    });
  });

  describe("giveaway, presentation and immutability", () => {
    let drawId: string;
    let winners: { full_name: string; reg_number: number }[];

    beforeAll(async () => {
      for (let i = 0; i < 14; i++) await register(staff, `Participant Number${String.fromCharCode(65 + i)} Test`, days[0]!.id).expect(201);
    });

    it("blocks the draw until pending duplicates are reviewed or acknowledged", async () => {
      await pool.query("select 1");
      await request(app).put("/api/draws/settings").set("Authorization", `Bearer ${admin}`).send({ draw_type: "daily", event_day_id: days[0]!.id, winner_count: 5 }).expect(200);
      // create a fresh pending duplicate on day 1
      await register(staff, "Participant NumberA Test", days[0]!.id, { allow_duplicate: "true" }).expect(201);
      const r = await post(admin, "/api/presentation/shuffle");
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/duplicate/i);
      await request(app).put("/api/draws/settings").set("Authorization", `Bearer ${admin}`).send({ acknowledge_pending_duplicates: true }).expect(200);
    });

    it("SHUFFLE draws, starts the countdown and shows no winners before 15 seconds", async () => {
      const r = await post(admin, "/api/presentation/shuffle");
      expect(r.status).toBe(200);
      expect(r.body.phase).toBe("countdown");
      expect(r.body.countdown_seconds).toBe(15);
      expect(r.body.winners).toBeUndefined();
      drawId = r.body.draw_id;
      const again = await get(admin, "/api/presentation/state");
      expect(again.body.phase).toBe("countdown");
      expect(again.body.winners).toBeUndefined();
      expect(JSON.stringify(again.body)).not.toMatch(/Participant Number/);
    });

    it("a second SHUFFLE click during the countdown changes nothing", async () => {
      const first = (await get(admin, "/api/presentation/state")).body.countdown_started_at;
      const r = await post(admin, "/api/presentation/shuffle");
      expect(r.body.countdown_started_at).toBe(first);
      expect(r.body.draw_id).toBe(drawId);
    });

    it("reveals five unique winners only after 15 server seconds, readable via projector token", async () => {
      await pool.query("update public.presentation_sessions set countdown_started_at = now() - interval '14 seconds' where draw_id = $1", [drawId]);
      expect((await get(admin, "/api/presentation/state")).body.phase).toBe("countdown");
      await pool.query("update public.presentation_sessions set countdown_started_at = now() - interval '16 seconds' where draw_id = $1", [drawId]);
      const { token: pt } = createProjectorToken(projectorSecret(env), 600);
      const s = await request(app).get(`/api/presentation/state?t=${pt}`);
      expect(s.status).toBe(200);
      expect(s.body.phase).toBe("revealed");
      expect(s.body.winners).toHaveLength(5);
      winners = s.body.winners;
      expect(new Set(winners.map((w) => w.full_name.toLowerCase())).size).toBe(5);
      expect(s.body.winners.every((w: { photo_url: string }) => w.photo_url.startsWith("https://files.test/"))).toBe(true);
      const pool_ = await request(app).get(`/api/presentation/pool?t=${pt}`);
      expect(pool_.status).toBe(200);
      expect(JSON.stringify(pool_.body)).not.toMatch(/full_name/);
    });

    it("the projector token is read-only", async () => {
      const { token: pt } = createProjectorToken(projectorSecret(env), 600);
      for (const url of ["/api/presentation/shuffle", "/api/presentation/replay", "/api/presentation/reset", "/api/presentation/mute"]) {
        expect((await request(app).post(`${url}?t=${pt}`).send({ muted: true })).status).toBe(401);
      }
      expect((await request(app).get(`/api/draws?t=${pt}`)).status).toBe(401);
    });

    it("replay shows the same winners and never redraws", async () => {
      const r = await post(admin, "/api/presentation/replay");
      expect(r.body.phase).toBe("countdown");
      expect(r.body.draw_id).toBe(drawId);
      await pool.query("update public.presentation_sessions set countdown_started_at = now() - interval '16 seconds' where draw_id = $1", [drawId]);
      const s = await get(admin, "/api/presentation/state");
      expect(s.body.winners.map((w: { reg_number: number }) => w.reg_number)).toEqual(winners.map((w) => w.reg_number));
      const draws = await get(admin, "/api/draws");
      expect(draws.body.draws).toHaveLength(1);
    });

    it("is locked once drawn: settings cannot change and a new SHUFFLE after reset reuses the draw", async () => {
      const put = await request(app).put("/api/draws/settings").set("Authorization", `Bearer ${admin}`).send({ winner_count: 3 });
      expect(put.status).toBe(409);
      await post(admin, "/api/presentation/reset").then((r) => expect(r.body.phase).toBe("idle"));
      const r = await post(admin, "/api/presentation/shuffle");
      expect(r.body.draw_id).toBe(drawId);
      expect((await get(admin, "/api/draws")).body.draws).toHaveLength(1);
    });

    it("winners and draws cannot be changed or deleted, even by the database owner", async () => {
      for (const q of ["update public.winners set winner_position = 9", "delete from public.winners", "update public.giveaway_draws set winner_count = 1", "delete from public.giveaway_draws", "delete from public.registrations", "update public.activity_logs set action = 'x'"]) {
        await expect(pool.query(q)).rejects.toThrow();
      }
    });

    it("mute is stored on the server and visible to the projector", async () => {
      await post(admin, "/api/presentation/mute", { muted: true }).then((r) => expect(r.body.muted).toBe(true));
      const { token: pt } = createProjectorToken(projectorSecret(env), 600);
      expect((await request(app).get(`/api/presentation/state?t=${pt}`)).body.muted).toBe(true);
      await post(admin, "/api/presentation/mute", { muted: false });
    });

    it("excludes earlier winners from a later draw and unlock requires explicit confirmation", async () => {
      expect((await post(admin, "/api/draws/unlock", {})).status).toBe(400);
      // Merge the same-name registrations so an earlier winner cannot win again under a second registration.
      const pending = (await get(admin, "/api/duplicates?status=pending")).body.items;
      for (const item of pending) await post(admin, `/api/duplicates/${item.id}/resolve`, { decision: "same" }).expect(200);
      await post(admin, "/api/draws/unlock", { confirm: true }).then((r) => expect(r.status).toBe(200));
      await request(app).put("/api/draws/settings").set("Authorization", `Bearer ${admin}`).send({ draw_type: "global", winner_count: 5 }).expect(200);
      await post(admin, "/api/presentation/shuffle").expect(200);
      const draws = (await get(admin, "/api/draws")).body.draws;
      expect(draws).toHaveLength(2);
      const names1 = new Set(draws[0].winners.map((w: { full_name: string }) => w.full_name.toLowerCase()));
      for (const w of draws[1].winners) expect(names1.has(w.full_name.toLowerCase())).toBe(false);
    });
  });

  describe("custom sounds", () => {
    const mp3 = (n = 2000) => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(n, 7)]);
    const put = (t: string, kind: string, buf: Buffer, name = "boom.mp3") =>
      request(app).put(`/api/sounds/${kind}`).set("Authorization", `Bearer ${t}`).attach("file", buf, { filename: name, contentType: "audio/mpeg" });

    it("only admins can upload or remove; staff and anonymous are refused", async () => {
      expect((await put(staff, "countdown", mp3())).status).toBe(403);
      expect((await request(app).put("/api/sounds/countdown").attach("file", mp3(), "x.mp3")).status).toBe(401);
      expect((await request(app).delete("/api/sounds/countdown")).status).toBe(401);
      expect((await request(app).delete("/api/sounds/countdown").set("Authorization", `Bearer ${staff}`)).status).toBe(403);
    });
    it("rejects non-audio files, other kinds and files over 4 MB", async () => {
      expect((await put(admin, "countdown", Buffer.from("<html>definitely not audio</html>"), "evil.mp3")).status).toBe(400);
      expect((await put(admin, "fanfare", mp3())).status).toBe(400);
      expect((await put(admin, "countdown", mp3(4 * 1024 * 1024 + 10))).status).toBe(413);
      expect(sounds.files.size).toBe(0);
    });
    it("stores a sound, replaces it (old file removed) and the projector token can read it", async () => {
      const a = await put(admin, "countdown", mp3(), "my countdown.mp3");
      expect(a.status).toBe(201);
      expect(a.body.sounds.countdown.name).toBe("my countdown.mp3");
      expect(a.body.sounds.winners).toBeNull();
      expect(sounds.files.size).toBe(1);
      const b = await put(admin, "countdown", mp3(3000), "second.mp3");
      expect(b.status).toBe(201);
      expect(sounds.files.size).toBe(1);
      await put(admin, "winners", mp3(), "win.mp3").expect(201);
      const { token: pt } = createProjectorToken(projectorSecret(env), 600);
      const read = await request(app).get(`/api/sounds?t=${pt}`);
      expect(read.status).toBe(200);
      expect(read.body.sounds.countdown.url).toContain("https://files.test/countdown/");
      expect(read.body.sounds.winners.name).toBe("win.mp3");
      expect((await request(app).get("/api/sounds")).status).toBe(401);
      expect((await request(app).get("/api/sounds?t=bad")).status).toBe(401);
      expect((await request(app).put(`/api/sounds/winners?t=${pt}`).attach("file", mp3(), "x.mp3")).status).toBe(401);
    });
    it("removing a sound deletes the file and falls back to the built-in sound", async () => {
      const r = await request(app).delete("/api/sounds/countdown").set("Authorization", `Bearer ${admin}`);
      expect(r.status).toBe(200);
      expect(r.body.sounds.countdown).toBeNull();
      expect(sounds.files.size).toBe(1);
      await request(app).delete("/api/sounds/winners").set("Authorization", `Bearer ${admin}`).expect(200);
      expect(sounds.files.size).toBe(0);
    });
  });

  describe("photo cleanup", () => {
    it("requires the confirmation phrase, a matching count, and never deletes winner photos or registrations", async () => {
      const regsBefore = (await pool.query("select count(*)::int n from public.registrations")).rows[0].n;
      const winnerPaths = (await pool.query("select r.photo_path from public.winners w join public.registrations r on r.id = w.registration_id")).rows.map((r) => r.photo_path);
      expect(winnerPaths.length).toBe(10);
      const preview = (await get(admin, `/api/cleanup?event_day_id=${days[0]!.id}`)).body.preview;
      expect(Number(preview.protected_winner_photos)).toBeGreaterThan(0);

      expect((await post(admin, "/api/cleanup", { event_day_id: days[0]!.id })).status).toBe(400);
      expect((await post(admin, "/api/cleanup", { event_day_id: days[0]!.id, confirm: "yes" })).status).toBe(400);
      const wrongCount = await post(admin, "/api/cleanup", { event_day_id: days[0]!.id, confirm: "DELETE PHOTOS", expected_count: 1, acknowledge_early: true });
      expect(wrongCount.status).toBe(409);
      expect(wrongCount.body.code).toBe("count_changed");

      let last: { done: boolean; deleted: number };
      let guard = 0;
      let first = true;
      do {
        const r = await post(admin, "/api/cleanup", {
          event_day_id: days[0]!.id, confirm: "DELETE PHOTOS", acknowledge_early: true,
          ...(first ? { expected_count: Number(preview.photos_to_delete) } : {}),
        });
        expect(r.status).toBe(200);
        last = r.body;
        first = false;
      } while (!last.done && ++guard < 10);
      expect(last.done).toBe(true);

      for (const p of winnerPaths) expect(storage.files.has(p)).toBe(true);
      expect((await pool.query("select count(*)::int n from public.registrations")).rows[0].n).toBe(regsBefore);
      const left = (await pool.query("select count(*)::int n from public.registrations where event_day_id = $1 and photo_path is not null", [days[0]!.id])).rows[0].n;
      expect(left).toBeLessThanOrEqual(10);
      const logs = (await get(admin, "/api/admin/activity?action=cleanup")).body.logs;
      expect(logs.length).toBeGreaterThan(0);
    });
    it("asks for acknowledgement when a draw has not happened yet", async () => {
      const r = await post(admin, "/api/cleanup", { event_day_id: days[1]!.id, confirm: "DELETE PHOTOS" });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("draw_pending");
    });
  });

  describe("exports, dashboard, logs", () => {
    it("exports CSV and Excel and neutralises formula injection in names", async () => {
      await register(staff, "=HYPERLINK(\"http://evil\",\"x\")", days[1]!.id).expect(201);
      const csv = await get(admin, "/api/exports/registrations.csv");
      expect(csv.status).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.text).toContain("'=HYPERLINK");
      expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
      const x = await get(admin, "/api/exports/winners.xlsx").buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(x.status).toBe(200);
      expect(x.headers["content-type"]).toContain("spreadsheetml");
      expect((x.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    });
    it("dashboard, system status and activity log work", async () => {
      const d = await get(admin, "/api/admin/dashboard");
      expect(d.body.days).toHaveLength(3);
      expect(d.body.totals.winners).toBe(10);
      const s = await get(admin, "/api/admin/system");
      expect(s.body.database).toBe("ok");
      expect(s.body.storage.objects).toBeGreaterThan(0);
      const a = await get(admin, "/api/admin/activity?limit=5");
      expect(a.body.logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(a.body)).not.toMatch(/password|token/i);
    });
    it("exports are not cacheable and carry attachment headers", async () => {
      const r = await get(admin, "/api/exports/registrations.csv");
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["content-disposition"]).toContain("attachment");
      void adminId;
    });
  });

  describe("deleting all audience data (runs last: it wipes the data)", () => {
    const reset = (t: string, body: object) => request(app).post("/api/reset").set("Authorization", `Bearer ${t}`).send(body);
    const previewOf = async () => (await get(admin, "/api/reset")).body.preview;
    const dbCount = async (table: string) => (await pool.query(`select count(*)::int n from public.${table}`)).rows[0].n as number;

    it("refuses without the typed phrase, without a choice, with a stale count, and for staff", async () => {
      const p = await previewOf();
      expect((await reset(admin, { include_winners: false, expected_count: 1 })).status).toBe(400);
      expect((await reset(admin, { confirm: "yes", include_winners: false, expected_count: 1 })).status).toBe(400);
      expect((await reset(admin, { confirm: "DELETE ALL DATA", expected_count: 1 })).status).toBe(400);
      const stale = await reset(admin, { confirm: "DELETE ALL DATA", include_winners: true, expected_count: p.registrations + 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("count_changed");
      expect((await reset(staff, { confirm: "DELETE ALL DATA", include_winners: true, expected_count: p.registrations })).status).toBe(403);
      expect(await dbCount("registrations")).toBe(p.registrations);
    });

    it("keeps the winners (people, photos, draw history) and deletes everyone else", async () => {
      const p = await previewOf();
      expect(p.winner_registrations).toBe(10);
      const winnerRows = (await pool.query("select r.id, r.photo_path, r.reg_number from public.winners w join public.registrations r on r.id = w.registration_id")).rows;
      const drawsBefore = await dbCount("giveaway_draws");
      const r = await reset(admin, { confirm: "DELETE ALL DATA", include_winners: false, expected_count: p.registrations - p.winner_registrations });
      expect(r.status).toBe(200);
      expect(r.body.registrations_kept).toBe(10);
      expect(r.body.registrations_deleted).toBe(p.registrations - 10);
      expect(r.body.photos_failed).toBe(0);
      expect(await dbCount("registrations")).toBe(10);
      expect(await dbCount("winners")).toBe(10);
      expect(await dbCount("giveaway_draws")).toBe(drawsBefore);
      expect(await dbCount("participant_identities")).toBe(10);
      const left = (await pool.query("select id from public.registrations")).rows.map((x) => x.id).sort();
      expect(left).toEqual(winnerRows.map((x) => x.id).sort());
      for (const w of winnerRows) if (w.photo_path) expect(storage.files.has(w.photo_path)).toBe(true);
      expect(storage.files.size).toBeLessThanOrEqual(10);
      // protection is back on
      await expect(pool.query("delete from public.registrations")).rejects.toThrow();
      await expect(pool.query("delete from public.winners")).rejects.toThrow();
      // the winners page still works and the log recorded the reset
      expect((await get(admin, "/api/draws")).body.draws.length).toBe(drawsBefore);
      expect((await get(admin, "/api/admin/activity?action=data")).body.logs.length).toBeGreaterThan(0);
      // numbering continues after the kept winners
      const next = await register(staff, "Fresh Person After Reset", days[0]!.id);
      expect(next.status).toBe(201);
      expect(next.body.registration.reg_number).toBeGreaterThan(Math.max(...winnerRows.map((x) => Number(x.reg_number))));
    });

    it("deletes everything including winners and draws, restarts numbering and unlocks the giveaway", async () => {
      const p = await previewOf();
      const r = await reset(admin, { confirm: "DELETE ALL DATA", include_winners: true, expected_count: p.registrations });
      expect(r.status).toBe(200);
      expect(r.body.registrations_kept).toBe(0);
      expect(r.body.winners_deleted).toBe(10);
      expect(r.body.draws_deleted).toBe(2);
      for (const t of ["registrations", "winners", "giveaway_draws", "participant_identities", "duplicate_candidates", "presentation_sessions"]) expect(await dbCount(t)).toBe(0);
      expect(storage.files.size).toBe(0);
      const settings = (await get(admin, "/api/draws/settings")).body.settings;
      expect(settings.locked).toBe(false);
      expect((await get(admin, "/api/presentation/state")).body.phase).toBe("none");
      // staff accounts and event days survive; the system is usable again from number 1
      expect(await dbCount("profiles")).toBeGreaterThan(2);
      const again = await register(staff, "Brand New Start", days[0]!.id);
      expect(again.status).toBe(201);
      expect(again.body.registration.reg_number).toBe(1);
      await expect(pool.query("delete from public.registrations")).rejects.toThrow();
    });
  });
});
