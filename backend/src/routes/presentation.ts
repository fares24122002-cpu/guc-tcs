import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { runOfficialDraw } from "../services/draw.js";
import type { Deps } from "../services/ports.js";
import { createProjectorToken, projectorSecret, verifyProjectorToken } from "../services/projector.js";
import { adminOrProjectorToken, guards, parse, withPhotoUrls } from "./common.js";

export const COUNTDOWN_SECONDS = 15;
const PROJECTOR_TOKEN_TTL_SECONDS = 12 * 3600;

type Phase = "none" | "idle" | "countdown" | "revealed";

export function presentationRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);
  const secret = projectorSecret(env);

  // The projector polls often, so it gets its own (higher) per-IP limit.
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests. Please slow down." },
    }),
  );

  const adminOrToken = adminOrProjectorToken(env, deps);

  async function buildState() {
    let pres = await deps.repo.presentation();
    const now = Date.now();
    let session = pres.session;
    // Server-side timing: once 15 seconds have passed, the reveal is applied (and never earlier).
    if (pres.draw_id && session?.state === "countdown" && session.countdown_started_at) {
      if (now - Date.parse(session.countdown_started_at) >= COUNTDOWN_SECONDS * 1000) {
        await deps.repo.presentationAction({ action: "reveal", draw_id: pres.draw_id, at: new Date(now).toISOString() });
        pres = await deps.repo.presentation();
        session = pres.session;
      }
    }
    const s = pres.settings;
    const phase: Phase = !pres.draw_id || !session ? "none" : session.state;
    const base = {
      phase,
      server_time: new Date().toISOString(),
      countdown_seconds: COUNTDOWN_SECONDS,
      countdown_started_at: phase === "countdown" ? session?.countdown_started_at : null,
      muted: s.muted,
      winner_count: s.winner_count,
      draw_type: s.draw_type,
      day_number: s.day_number,
      draw_id: pres.draw_id,
    };
    if (phase === "revealed" && pres.draw_id) {
      const draw = await deps.repo.getDraw(pres.draw_id);
      const winners = await withPhotoUrls(deps.storage, draw?.winners ?? []);
      return { ...base, winners: winners.map((w) => ({ position: w.position, full_name: w.full_name, reg_number: w.reg_number, photo_url: w.photo_url })) };
    }
    return base;
  }

  router.get(
    "/state",
    adminOrToken,
    asyncHandler(async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await buildState());
    }),
  );

  // Photos only (never names) for the shuffle visuals.
  router.get(
    "/pool",
    adminOrToken,
    asyncHandler(async (req, res) => {
      const limit = parse(z.coerce.number().int().min(1).max(100).default(48), req.query.limit ?? undefined);
      const sample = await deps.repo.shuffleSample(limit);
      const urls = await deps.storage.signedUrls(sample.map((s) => s.photo_path), 900);
      res.setHeader("Cache-Control", "no-store");
      res.json({ photos: sample.map((s) => urls.get(s.photo_path)).filter((u): u is string => Boolean(u)) });
    }),
  );

  // SHUFFLE: runs the official draw if there is none yet (create-or-retrieve), then starts the 15 s countdown.
  router.post(
    "/shuffle",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const admin = req.user!.id;
      const settings = await deps.repo.getSettings();
      let drawId = settings.active_draw_id;
      if (!drawId) drawId = (await runOfficialDraw(deps.repo, admin, settings)).drawId;
      await deps.repo.presentationAction({ action: "start", draw_id: drawId, admin, at: new Date().toISOString() });
      res.json(await buildState());
    }),
  );

  for (const action of ["replay", "reset"] as const) {
    router.post(
      `/${action}`,
      ...g.admin,
      asyncHandler(async (req, res) => {
        const settings = await deps.repo.getSettings();
        if (!settings.active_draw_id) throw new HttpError(409, "There is no active draw.");
        await deps.repo.presentationAction({ action, draw_id: settings.active_draw_id, admin: req.user!.id, at: new Date().toISOString() });
        res.json(await buildState());
      }),
    );
  }

  router.post(
    "/mute",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const body = parse(z.object({ muted: z.boolean() }), req.body);
      await deps.repo.setMuted(req.user!.id, body.muted);
      res.json(await buildState());
    }),
  );

  router.post(
    "/projector-token",
    ...g.admin,
    asyncHandler(async (_req, res) => {
      res.json(createProjectorToken(secret, PROJECTOR_TOKEN_TTL_SECONDS));
    }),
  );

  return router;
}
