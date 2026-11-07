import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import type { Deps } from "../services/ports.js";
import { guards, parse, uuid } from "./common.js";

const patchSchema = z
  .object({
    registration_open: z.boolean().optional(),
    registration_target: z.number().int().min(1).max(5000).optional(),
    event_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD."), z.literal("")]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export function eventDaysRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  router.get(
    "/",
    ...g.user,
    asyncHandler(async (_req, res) => {
      res.json({ days: await deps.repo.eventDays() });
    }),
  );

  router.patch(
    "/:id",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const id = parse(uuid, req.params.id);
      const patch = parse(patchSchema, req.body);
      const day = await deps.repo.updateEventDay(req.user!.id, id, patch);
      res.json({ day });
    }),
  );

  return router;
}
