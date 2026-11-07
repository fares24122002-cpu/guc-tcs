import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { makeWorld } from "./fakes.js";

const env = loadEnv({
  NODE_ENV: "test",
  CORS_ORIGINS: "https://allowed.example.com/",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
} as NodeJS.ProcessEnv);

const app = createApp(env, makeWorld().deps);

describe("env validation", () => {
  it("rejects missing secrets with a readable message", () => {
    expect(() => loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toThrow(/SUPABASE_URL/);
  });
  it("normalises CORS origins", () => {
    expect(env.CORS_ORIGINS).toEqual(["https://allowed.example.com"]);
  });
});

describe("API baseline", () => {
  it("serves /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("sets secure headers and hides x-powered-by", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("allows listed origins and withholds CORS for others", async () => {
    const ok = await request(app).get("/api/health").set("Origin", "https://allowed.example.com");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://allowed.example.com");
    const bad = await request(app).get("/api/health").set("Origin", "https://evil.example.com");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
