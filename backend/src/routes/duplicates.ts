import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import type { Deps } from "../services/ports.js";
import { guards, parse, uuid, withPhotoUrls } from "./common.js";

const listSchema = z.object({
  status: z.enum(["pending", "confirmed_same", "confirmed_different"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function duplicatesRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  router.get(
    "/",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const q = parse(listSchema, req.query);
      const result = await deps.repo.duplicates(q);
      const rows = await Promise.all(
        result.rows.map(async (row) => {
          const [a, b] = await withPhotoUrls(deps.storage, [row.a ?? {}, row.b ?? {}] as { photo_path?: string | null }[]);
          return { ...row, a, b };
        }),
      );
      res.json({ total: result.total, items: rows });
    }),
  );

  router.post(
    "/flag",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const body = parse(z.object({ registration_a: uuid, registration_b: uuid }), req.body);
      res.status(201).json(await deps.repo.flagDuplicate(req.user!.id, body.registration_a, body.registration_b));
    }),
  );

  router.post(
    "/:id/resolve",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const id = parse(uuid, req.params.id);
      const body = parse(z.object({ decision: z.enum(["same", "different"]) }), req.body);
      res.json(await deps.repo.resolveDuplicate(req.user!.id, id, body.decision));
    }),
  );

  return router;
}
