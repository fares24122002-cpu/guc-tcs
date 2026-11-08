import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import type { Deps } from "../services/ports.js";
import { guards, parse, removePhotos, uuid } from "./common.js";

export const CLEANUP_BATCH = 100;
export const CLEANUP_CONFIRM_PHRASE = "DELETE PHOTOS";

const bodySchema = z.object({
  event_day_id: uuid.optional(),
  confirm: z.literal(CLEANUP_CONFIRM_PHRASE, { errorMap: () => ({ message: `Type ${CLEANUP_CONFIRM_PHRASE} to confirm.` }) }),
  /** Number shown in the preview; the first call is refused if it no longer matches. */
  expected_count: z.number().int().min(0).optional(),
  /** Accept deleting photos before the relevant draw has been held. */
  acknowledge_early: z.boolean().optional(),
});

/**
 * Deletes photo files only. Registrations are never deleted, and photos of winners are never touched.
 * Works in batches so each request stays well within serverless time limits; the caller repeats until `remaining` is 0.
 */
export function cleanupRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  router.get(
    "/",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const day = req.query.event_day_id ? parse(uuid, req.query.event_day_id) : undefined;
      res.json({ preview: await deps.repo.cleanupPreview(day), batch_size: CLEANUP_BATCH, confirm_phrase: CLEANUP_CONFIRM_PHRASE });
    }),
  );

  router.post(
    "/",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const admin = req.user!.id;
      const body = parse(bodySchema, req.body);
      const preview = await deps.repo.cleanupPreview(body.event_day_id);

      const drawMissing = body.event_day_id ? !preview.daily_draw_done || !preview.global_draw_done : !preview.global_draw_done;
      if (drawMissing && !body.acknowledge_early) {
        throw new HttpError(409, "Photos are still needed for the draw presentations. Confirm that you want to delete them anyway.", {
          code: "draw_pending",
        });
      }
      if (body.expected_count !== undefined && body.expected_count !== Number(preview.photos_to_delete)) {
        throw new HttpError(409, "The number of photos changed since the preview. Review it again.", {
          code: "count_changed",
          photos_to_delete: Number(preview.photos_to_delete),
        });
      }

      const batch = await deps.repo.cleanupCandidates(body.event_day_id ?? "", CLEANUP_BATCH);
      const { removed, failed } = await removePhotos(deps.storage, batch.map((b) => b.photo_path));
      const removedSet = new Set(removed);
      const ids = batch.filter((b) => removedSet.has(b.photo_path)).map((b) => b.id);
      const marked = ids.length ? await deps.repo.markPhotosDeleted(admin, ids) : { updated: 0 };
      await deps.repo.logCleanup(admin, {
        event_day_id: body.event_day_id ?? null,
        deleted: marked.updated,
        failed: failed.length,
      });

      const after = await deps.repo.cleanupPreview(body.event_day_id);
      res.json({
        deleted: marked.updated,
        failed: failed.length,
        remaining: Number(after.photos_to_delete),
        protected_winner_photos: Number(after.protected_winner_photos),
        done: Number(after.photos_to_delete) === 0,
      });
    }),
  );

  return router;
}
