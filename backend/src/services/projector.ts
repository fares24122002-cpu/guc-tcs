import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env.js";

/** Server-only secret, derived from the service-role key so no extra setting is needed. */
export function projectorSecret(env: Env): string {
  return createHash("sha256").update(`guc-tcs-projector:${env.SUPABASE_SERVICE_ROLE_KEY}`).digest("hex");
}

function sign(secret: string, exp: number): string {
  return createHmac("sha256", secret).update(`projector.${exp}`).digest("hex");
}

/** A read-only, expiring token that lets a second screen follow the presentation. */
export function createProjectorToken(secret: string, ttlSeconds: number, nowMs = Date.now()): { token: string; expires_at: string } {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return { token: `${exp}.${sign(secret, exp)}`, expires_at: new Date(exp * 1000).toISOString() };
}

export function verifyProjectorToken(secret: string, token: string | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const match = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp * 1000 < nowMs) return false;
  const expected = Buffer.from(sign(secret, exp), "hex");
  const given = Buffer.from(match[2] as string, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
