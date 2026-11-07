import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import type { Deps } from "../services/ports.js";
import { guards, parse, uuid, withPhotoUrls } from "./common.js";

const settingsSchema = z
  .object({
    draw_type: z.enum(["daily", "global"]).optional(),
    event_day_id: uuid.optional(),
    winner_count: z.number().int().min(1).max(10).optional(),
    exclude_previous_winners: z.boolean().optional(),
    acknowledge_pending_duplicates: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export function drawsRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  router.get(
    "/settings",
    ...g.admin,
    asyncHandler(async (_req, res) => {
      res.json({ settings: await deps.repo.getSettings() });
    }),
  );

  router.put(
    "/settings",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const patch = parse(settingsSchema, req.body);
      res.json({ settings: await deps.repo.updateSettings(req.user!.id, patch) });
    }),
  );

  router.post(
    "/unlock",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const body = parse(z.object({ confirm: z.literal(true) }), req.body, "Confirmation is required.");
      void body;
      res.json({ settings: await deps.repo.unlockSettings(req.user!.id) });
    }),
  );

  router.get(
    "/scopes",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const excl = req.query.exclude_previous !== "false";
      res.json({ scopes: await deps.repo.drawScopeStats(excl) });
    }),
  );

  router.get(
    "/",
    ...g.admin,
    asyncHandler(async (_req, res) => {
      const draws = await deps.repo.listDraws();
      const out = await Promise.all(
        draws.map(async (d) => ({ ...d, winners: await withPhotoUrls(deps.storage, d.winners ?? []) })),
      );
      res.json({ draws: out });
    }),
  );

  return router;
}
