import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import type { Deps } from "../services/ports.js";
import { guards, parse, removePhotos } from "./common.js";

export const RESET_CONFIRM_PHRASE = "DELETE ALL DATA";

const bodySchema = z.object({
  confirm: z.literal(RESET_CONFIRM_PHRASE, { errorMap: () => ({ message: `Type ${RESET_CONFIRM_PHRASE} to confirm.` }) }),
  /** true: delete everything including winners and draws. false: delete everyone except winners. */
  include_winners: z.boolean({ errorMap: () => ({ message: "Choose whether winners are deleted too." }) }),
  /** The number of registrations the admin saw in the preview; refused if it changed since. */
  expected_count: z.number().int().min(0),
});

/**
 * The one deliberate way to erase audience data (for example test registrations before the real event).
 * Administrator only, needs a typed confirmation, and is recorded in the activity log.
 */
export function resetRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  router.get(
    "/",
    ...g.admin,
    asyncHandler(async (_req, res) => {
      res.json({ preview: await deps.repo.resetPreview(), confirm_phrase: RESET_CONFIRM_PHRASE });
    }),
  );

  router.post(
    "/",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const body = parse(bodySchema, req.body);
      const preview = await deps.repo.resetPreview();
      const toDelete = body.include_winners ? preview.registrations : preview.registrations - preview.winner_registrations;
      if (body.expected_count !== toDelete) {
        throw new HttpError(409, "The data changed since you opened this page. Review the numbers again.", { code: "count_changed", registrations_to_delete: toDelete });
      }

      const result = await deps.repo.resetData(req.user!.id, body.include_winners);

      // The database part is done and cannot be undone; now remove the photo files.
      let removed = 0;
      let failed = 0;
      const paths = result.photo_paths ?? [];
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const r = await removePhotos(deps.storage, chunk).catch(() => ({ removed: [] as string[], failed: chunk }));
        removed += r.removed.length;
        failed += r.failed.length;
      }
      res.json({
        registrations_deleted: result.registrations_before - result.registrations_kept,
        registrations_kept: result.registrations_kept,
        winners_deleted: result.winners_deleted,
        draws_deleted: result.draws_deleted,
        photos_removed: removed,
        photos_failed: failed,
      });
    }),
  );

  return router;
}
