import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { bootstrapAdmin } from "../src/services/bootstrap.js";
import { DOMAIN, makeWorld, type World } from "./fakes.js";

const baseEnv = {
  NODE_ENV: "test",
  CORS_ORIGINS: "https://app.example.com",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STAFF_EMAIL_DOMAIN: DOMAIN,
};

function setup(overrides: Record<string, string> = {}) {
  const world = makeWorld();
  const env = loadEnv({ ...baseEnv, ...overrides } as NodeJS.ProcessEnv);
  return { world, app: createApp(env, world.deps) };
}

async function login(app: Express, username: string, password: string) {
  return request(app).post("/api/auth/login").send({ username, password });
}

describe("login", () => {
  let world: World;
  let app: Express;
  beforeEach(async () => {
    ({ world, app } = setup());
    await world.seed("admin", "admin-password-123", "admin");
    await world.seed("sara", "sara-password-123", "staff");
    await world.seed("gone", "gone-password-123", "staff", false);
  });

  it("signs in with username + password and returns a session and the role", async () => {
    const res = await login(app, "Sara", "sara-password-123"); // username is case-insensitive
    expect(res.status).toBe(200);
    expect(res.body.session.access_token).toBeTruthy();
    expect(res.body.user).toMatchObject({ username: "sara", role: "staff" });
    expect(res.body.user.password).toBeUndefined();
  });

  it("gives the same generic error for a wrong password and an unknown user", async () => {
    const wrong = await login(app, "sara", "nope-nope-nope");
    const unknown = await login(app, "nobody", "nope-nope-nope");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("refuses deactivated accounts even with the right password, and issues no usable session", async () => {
    const res = await login(app, "gone", "gone-password-123");
    expect(res.status).toBe(403);
    expect(res.body.session).toBeUndefined();
    expect([...world.auth.tokens.values()]).not.toContain([...world.store.profiles.values()].find((p) => p.username === "gone")!.id);
  });

  it("validates the request body", async () => {
    expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
    expect((await request(app).post("/api/auth/login").send({ username: "a", password: "x" })).status).toBe(400);
  });

  it("throttles repeated failures for one username, but not other usernames or successful logins", async () => {
    for (let i = 0; i < 10; i++) expect((await login(app, "sara", "bad-password-1")).status).toBe(401);
    expect((await login(app, "sara", "bad-password-1")).status).toBe(429);
    expect((await login(app, "sara", "sara-password-123")).status).toBe(429); // locked for the window
    expect((await login(app, "admin", "admin-password-123")).status).toBe(200); // others unaffected
  });

  it("records a login in the audit log", async () => {
    await login(app, "sara", "sara-password-123");
    expect(world.store.logs.some((l) => l.action === "auth.login")).toBe(true);
  });
});

describe("sessions", () => {
  it("requires a valid token", async () => {
    const { world, app } = setup();
    await world.seed("sara", "sara-password-123", "staff");
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer garbage")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Basic abc")).status).toBe(401);
    const { body } = await login(app, "sara", "sara-password-123");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.session.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("sara");
  });

  it("logout invalidates the token", async () => {
    const { world, app } = setup();
    await world.seed("sara", "sara-password-123", "staff");
    const { body } = await login(app, "sara", "sara-password-123");
    const auth = { Authorization: `Bearer ${body.session.access_token}` };
    expect((await request(app).post("/api/auth/logout").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set(auth)).status).toBe(401);
  });

  it("refreshes a session, and refuses to refresh a deactivated account", async () => {
    const { world, app } = setup();
    const sara = await world.seed("sara", "sara-password-123", "staff");
    const first = await login(app, "sara", "sara-password-123");
    const refreshed = await request(app).post("/api/auth/refresh").send({ refresh_token: first.body.session.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.session.access_token).not.toBe(first.body.session.access_token);

    await world.store.update(sara.id, { is_active: false });
    const blocked = await request(app).post("/api/auth/refresh").send({ refresh_token: refreshed.body.session.refresh_token });
    expect(blocked.status).toBe(403);
    expect((await request(app).post("/api/auth/refresh").send({ refresh_token: "rt_unknown_token_value" })).status).toBe(401);
  });

  it("cuts off a user's existing session the moment they are deactivated", async () => {
    const { world, app } = setup();
    const sara = await world.seed("sara", "sara-password-123", "staff");
    const { body } = await login(app, "sara", "sara-password-123");
    const auth = { Authorization: `Bearer ${body.session.access_token}` };
    expect((await request(app).get("/api/auth/me").set(auth)).status).toBe(200);
    await world.store.update(sara.id, { is_active: false });
    expect((await request(app).get("/api/auth/me").set(auth)).status).toBe(403);
  });

  it("uses the CURRENT role from the database, not anything in the token", async () => {
    const { world, app } = setup();
    const boss = await world.seed("boss", "boss-password-123", "admin");
    await world.seed("other", "other-password-1", "admin");
    const { body } = await login(app, "boss", "boss-password-123");
    const auth = { Authorization: `Bearer ${body.session.access_token}` };
    expect((await request(app).get("/api/staff").set(auth)).status).toBe(200);
    world.store.profiles.set(boss.id, { ...boss, role: "staff" }); // demoted after login
    expect((await request(app).get("/api/staff").set(auth)).status).toBe(403);
  });
});

describe("staff management permissions", () => {
  let world: World;
  let app: Express;
  let adminAuth: { Authorization: string };
  let staffAuth: { Authorization: string };

  beforeEach(async () => {
    ({ world, app } = setup());
    await world.seed("admin", "admin-password-123", "admin");
    await world.seed("sara", "sara-password-123", "staff");
    adminAuth = { Authorization: `Bearer ${(await login(app, "admin", "admin-password-123")).body.session.access_token}` };
    staffAuth = { Authorization: `Bearer ${(await login(app, "sara", "sara-password-123")).body.session.access_token}` };
  });

  it("blocks every staff-management route for media staff and for anonymous callers", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const headers of [staffAuth, {}]) {
      const expected = Object.keys(headers).length ? 403 : 401;
      expect((await request(app).get("/api/staff").set(headers)).status).toBe(expected);
      expect((await request(app).post("/api/staff").set(headers).send({ full_name: "X Y", username: "xyz", password: "long-password-1" })).status).toBe(expected);
      expect((await request(app).patch(`/api/staff/${id}`).set(headers).send({ is_active: false })).status).toBe(expected);
    }
  });

  it("lets an admin create a media-staff account that can then log in", async () => {
    const res = await request(app).post("/api/staff").set(adminAuth).send({ full_name: "Omar Ali", username: "Omar", password: "omar-password-1" });
    expect(res.status).toBe(201);
    expect(res.body.staff).toMatchObject({ username: "omar", role: "staff", is_active: true });
    expect(JSON.stringify(res.body)).not.toContain("omar-password-1");
    expect((await login(app, "omar", "omar-password-1")).status).toBe(200);
  });

  it("ignores any attempt to create an administrator through the API", async () => {
    const res = await request(app).post("/api/staff").set(adminAuth).send({ full_name: "Evil Admin", username: "evil", password: "evil-password-1", role: "admin" });
    expect(res.status).toBe(201);
    expect(res.body.staff.role).toBe("staff");
  });

  it("validates input and rejects duplicate usernames", async () => {
    const post = (body: object) => request(app).post("/api/staff").set(adminAuth).send(body);
    expect((await post({ full_name: "Omar Ali", username: "omar", password: "short" })).status).toBe(400);
    expect((await post({ full_name: "Omar Ali", username: "bad name!", password: "long-password-1" })).status).toBe(400);
    expect((await post({ full_name: "O", username: "omar", password: "long-password-1" })).status).toBe(400);
    expect((await post({ full_name: "Sara Two", username: "sara", password: "long-password-1" })).status).toBe(409);
  });

  it("rolls back the login if the profile cannot be saved", async () => {
    world.store.failNextInsert = true;
    const before = world.auth.users.size;
    const res = await request(app).post("/api/staff").set(adminAuth).send({ full_name: "Omar Ali", username: "omar", password: "omar-password-1" });
    expect(res.status).toBe(500);
    expect(world.auth.users.size).toBe(before);
    expect((await login(app, "omar", "omar-password-1")).status).toBe(401);
  });

  it("deactivates and reactivates staff, and cuts off a signed-in device immediately", async () => {
    const sara = [...world.store.profiles.values()].find((p) => p.username === "sara")!;
    const off = await request(app).patch(`/api/staff/${sara.id}`).set(adminAuth).send({ is_active: false });
    expect(off.status).toBe(200);
    expect(off.body.staff.is_active).toBe(false);
    expect((await request(app).get("/api/auth/me").set(staffAuth)).status).toBe(403);
    expect((await login(app, "sara", "sara-password-123")).status).toBe(403);
    await request(app).patch(`/api/staff/${sara.id}`).set(adminAuth).send({ is_active: true });
    expect((await login(app, "sara", "sara-password-123")).status).toBe(200);
  });

  it("edits names and resets passwords without logging the password", async () => {
    const sara = [...world.store.profiles.values()].find((p) => p.username === "sara")!;
    const res = await request(app).patch(`/api/staff/${sara.id}`).set(adminAuth).send({ full_name: "Sara Mahmoud", password: "brand-new-password" });
    expect(res.status).toBe(200);
    expect(res.body.staff.full_name).toBe("Sara Mahmoud");
    expect((await login(app, "sara", "sara-password-123")).status).toBe(401);
    expect((await login(app, "sara", "brand-new-password")).status).toBe(200);
    expect(JSON.stringify(world.store.logs)).not.toContain("brand-new-password");
    expect(world.store.logs.map((l) => l.action)).toEqual(expect.arrayContaining(["staff.renamed", "staff.password_reset"]));
  });

  it("protects administrators: no self-changes, no editing other admins, no empty or malformed updates", async () => {
    const other = await world.seed("admin2", "admin2-password-1", "admin");
    const me = [...world.store.profiles.values()].find((p) => p.username === "admin")!;
    expect((await request(app).patch(`/api/staff/${me.id}`).set(adminAuth).send({ is_active: false })).status).toBe(400);
    expect((await request(app).patch(`/api/staff/${other.id}`).set(adminAuth).send({ is_active: false })).status).toBe(403);
    expect((await request(app).patch(`/api/staff/${other.id}`).set(adminAuth).send({ password: "hijack-password-1" })).status).toBe(403);
    expect((await request(app).patch("/api/staff/not-a-uuid").set(adminAuth).send({ is_active: false })).status).toBe(400);
    const sara = [...world.store.profiles.values()].find((p) => p.username === "sara")!;
    expect((await request(app).patch(`/api/staff/${sara.id}`).set(adminAuth).send({})).status).toBe(400);
    expect((await request(app).patch("/api/staff/00000000-0000-4000-8000-0000000000ff").set(adminAuth).send({ is_active: false })).status).toBe(404);
  });

  it("audits staff changes with the acting admin", async () => {
    await request(app).post("/api/staff").set(adminAuth).send({ full_name: "Omar Ali", username: "omar", password: "omar-password-1" });
    const admin = [...world.store.profiles.values()].find((p) => p.username === "admin")!;
    const entry = world.store.logs.find((l) => l.action === "staff.created");
    expect(entry?.userId).toBe(admin.id);
  });
});

describe("per-user rate limiting", () => {
  it("limits one user without affecting others on the same IP", async () => {
    const { world, app } = setup({ RATE_LIMIT_MAX: "3" });
    await world.seed("admin", "admin-password-123", "admin");
    await world.seed("admin2", "admin2-password-1", "admin");
    const a = { Authorization: `Bearer ${(await login(app, "admin", "admin-password-123")).body.session.access_token}` };
    const b = { Authorization: `Bearer ${(await login(app, "admin2", "admin2-password-1")).body.session.access_token}` };
    for (let i = 0; i < 3; i++) expect((await request(app).get("/api/staff").set(a)).status).toBe(200);
    expect((await request(app).get("/api/staff").set(a)).status).toBe(429);
    expect((await request(app).get("/api/staff").set(b)).status).toBe(200);
  });
});

describe("administrator bootstrap", () => {
  const opts = { username: "Fares", fullName: "Fares Admin", password: "a-very-long-passphrase", emailDomain: DOMAIN };

  it("creates an admin who can sign in over the API", async () => {
    const { world, app } = setup();
    const profile = await bootstrapAdmin(world.deps, opts);
    expect(profile).toMatchObject({ username: "fares", role: "admin", is_active: true });
    const res = await login(app, "fares", "a-very-long-passphrase");
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("admin");
  });

  it("rejects weak input and refuses duplicates", async () => {
    const world = makeWorld();
    await expect(bootstrapAdmin(world.deps, { ...opts, password: "short" })).rejects.toThrow(/12 characters/);
    await expect(bootstrapAdmin(world.deps, { ...opts, username: "x" })).rejects.toThrow(/Username/);
    await bootstrapAdmin(world.deps, opts);
    await expect(bootstrapAdmin(world.deps, opts)).rejects.toThrow(/already taken/);
  });

  it("rolls back the login when the profile cannot be saved", async () => {
    const world = makeWorld();
    world.store.failNextInsert = true;
    await expect(bootstrapAdmin(world.deps, opts)).rejects.toThrow();
    expect(world.auth.users.size).toBe(0);
  });
});
