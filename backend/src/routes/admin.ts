import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import type { Deps } from "../services/ports.js";
import { guards, parse } from "./common.js";

export function adminRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  router.get(
    "/dashboard",
    ...g.admin,
    asyncHandler(async (_req, res) => {
      res.json(await deps.repo.dashboard());
    }),
  );

  router.get(
    "/activity",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const q = parse(
        z.object({
          before: z.coerce.number().int().positive().optional(),
          action: z.string().max(60).regex(/^[a-z_.]*$/, "Invalid filter.").optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        req.query,
      );
      res.json({ logs: await deps.repo.activityLogs({ ...q, before: q.before ?? "" }) });
    }),
  );

  router.get(
    "/system",
    ...g.admin,
    asyncHandler(async (_req, res) => {
      const [status, storage] = await Promise.all([deps.repo.systemStatus(), deps.storage.usage()]);
      res.json({
        ...status,
        storage,
        environment: env.NODE_ENV,
        server_time: new Date().toISOString(),
      });
    }),
  );

  return router;
}
