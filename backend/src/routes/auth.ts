import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler, requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { publicUser, staffEmail, type Deps } from "../services/ports.js";

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(32),
  password: z.string().min(1).max(200),
});
const refreshSchema = z.object({ refresh_token: z.string().min(10).max(2000) });

const BAD_CREDENTIALS = "Incorrect username or password.";

export function authRouter(env: Env, deps: Deps): Router {
  const router = Router();

  // Brute-force protection. Keyed by username (targeted guessing) and, more loosely, by IP (spraying).
  // Successful logins do not count, so legitimate staff are not locked out by their own typos.
  const limiterOptions = {
    windowMs: 15 * 60_000,
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many login attempts. Please try again in 15 minutes." },
  };
  const byUsername = rateLimit({
    ...limiterOptions,
    limit: 10,
    keyGenerator: (req) => `login-user:${String((req.body as { username?: unknown } | undefined)?.username ?? "").toLowerCase().slice(0, 64)}`,
  });
  const byIp = rateLimit({ ...limiterOptions, limit: 300 }); // shared venue Wi-Fi: keep generous

  router.post(
    "/login",
    byIp,
    byUsername,
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Enter your username and password.");
      const { username, password } = parsed.data;

      const result = await deps.auth.signIn(staffEmail(username, env.STAFF_EMAIL_DOMAIN), password);
      if (!result) throw new HttpError(401, BAD_CREDENTIALS);

      const profile = await deps.store.getById(result.userId);
      if (!profile) throw new HttpError(401, BAD_CREDENTIALS);
      if (!profile.is_active) {
        await deps.auth.signOut(result.session.access_token);
        throw new HttpError(403, "This account is deactivated. Contact an administrator.");
      }

      await deps.store.log(profile.id, "auth.login", {});
      res.json({ session: result.session, user: publicUser(profile) });
    }),
  );

  router.post(
    "/refresh",
    byIp,
    asyncHandler(async (req, res) => {
      const parsed = refreshSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid request.");
      const result = await deps.auth.refresh(parsed.data.refresh_token);
      if (!result) throw new HttpError(401, "Session expired. Please sign in again.");
      const profile = await deps.store.getById(result.userId);
      if (!profile) throw new HttpError(401, "Session expired. Please sign in again.");
      if (!profile.is_active) {
        await deps.auth.signOut(result.session.access_token);
        throw new HttpError(403, "This account is deactivated. Contact an administrator.");
      }
      res.json({ session: result.session, user: publicUser(profile) });
    }),
  );

  router.post(
    "/logout",
    requireAuth(deps),
    asyncHandler(async (req, res) => {
      await deps.auth.signOut(req.accessToken!);
      res.json({ ok: true });
    }),
  );

  router.get("/me", requireAuth(deps), (req, res) => {
    res.json({ user: publicUser(req.user!) });
  });

  return router;
}
