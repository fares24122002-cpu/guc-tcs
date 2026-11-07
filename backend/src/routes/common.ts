import type { RequestHandler } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { requireAuth, requireRole, userRateLimit } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import type { Deps } from "../services/ports.js";
import type { PhotoStorage } from "../services/storage.js";

/** Middleware chains shared by the feature routers. */
export function guards(env: Env, deps: Deps): { user: RequestHandler[]; admin: RequestHandler[] } {
  const limiter = userRateLimit(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX);
  const auth = requireAuth(deps);
  return { user: [auth, limiter], admin: [auth, requireRole("admin"), limiter] };
}

export const PHOTO_TTL_SECONDS = 3600;

/** Adds a short-lived signed `photo_url` to rows that have a `photo_path`. */
export async function withPhotoUrls<T extends { photo_path?: string | null }>(
  storage: PhotoStorage,
  rows: T[],
  ttl = PHOTO_TTL_SECONDS,
): Promise<(T & { photo_url: string | null })[]> {
  const urls = await storage.signedUrls(
    rows.map((r) => r.photo_path).filter((p): p is string => Boolean(p)),
    ttl,
  );
  return rows.map((r) => ({ ...r, photo_url: r.photo_path ? (urls.get(r.photo_path) ?? null) : null }));
}

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, message = "Invalid request."): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? message);
  return result.data;
}

export const uuid = z.string().uuid("Invalid id.");
export const boolish = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);
