import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { HttpError } from "./errorHandler.js";
import type { Deps, Role } from "../services/ports.js";

/** Express 4 does not catch rejected promises; forward them to the error handler. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Verifies the access token with Supabase, then loads the profile on EVERY request.
 * The role and active flag are never trusted from the token, so deactivating an account
 * (or changing a role) takes effect on the very next request.
 */
export function requireAuth(deps: Deps): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, "Sign in required.");
    const userId = await deps.auth.verifyToken(token);
    if (!userId) throw new HttpError(401, "Session expired. Please sign in again.");
    const profile = await deps.store.getById(userId);
    if (!profile) throw new HttpError(401, "Session expired. Please sign in again.");
    if (!profile.is_active) throw new HttpError(403, "This account is deactivated. Contact an administrator.");
    req.user = profile;
    req.accessToken = token;
    next();
  });
}

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "Sign in required."));
    if (req.user.role !== role) return next(new HttpError(403, "You do not have permission to do that."));
    next();
  };
}

/** Per-user rate limit. Must run after requireAuth. */
export function userRateLimit(windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?.id ?? "anonymous"}`,
    message: { error: "Too many requests. Please slow down." },
  });
}
