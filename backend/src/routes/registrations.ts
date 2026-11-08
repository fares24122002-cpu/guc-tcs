import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { detectImage, thumbPath } from "../services/image.js";
import type { Deps } from "../services/ports.js";
import { boolish, guards, parse, uuid, withPhotoUrls } from "./common.js";

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 12 },
});

const fieldsSchema = z.object({
  full_name: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2, "Enter the participant's full name.").max(120, "That name is too long.")),
  event_day_id: uuid,
  idempotency_key: uuid,
  consent: boolish.refine((v) => v === true, { message: "Photography and participation consent is required." }),
  allow_duplicate: boolish.optional(),
});

const listSchema = z.object({
  q: z.string().max(120).optional(),
  event_day_id: uuid.optional(),
  registered_by: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  photo: z.enum(["present", "deleted"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registrationsRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  // Register a participant. Safe to retry: the same idempotency key never creates a second record.
  router.post(
    "/",
    ...g.user,
    upload.fields([{ name: "photo", maxCount: 1 }, { name: "thumb", maxCount: 1 }]),
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const fields = parse(fieldsSchema, req.body);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const file = files?.photo?.[0];
      const thumb = files?.thumb?.[0];
      if (!file || file.size === 0) throw new HttpError(400, "A photograph is required.");
      const image = detectImage(file.buffer);
      if (!image) throw new HttpError(400, "The photo must be a JPEG, PNG or WebP image.");

      // A retry of an already-saved registration just returns it: no second upload, no duplicate warning.
      const saved = await deps.repo.registrationByKey(fields.idempotency_key);
      if (saved) {
        if (saved.registered_by !== user.id) throw new HttpError(409, "This submission key was already used.");
        const [row] = await withPhotoUrls(deps.storage, [saved]);
        res.status(200).json({
          registration: { ...saved, code: `TCS-${String(saved.reg_number).padStart(5, "0")}`, photo_url: row?.photo_url ?? null },
          already_saved: true,
        });
        return;
      }

      const days = await deps.repo.eventDays();
      const day = days.find((d) => d.id === fields.event_day_id);
      if (!day) throw new HttpError(404, "Event day not found.");
      if (!day.registration_open) throw new HttpError(409, "Registration is closed for this day.");

      // Possible duplicate person: warn first, never block silently.
      if (!fields.allow_duplicate) {
        const check = await deps.repo.checkName(fields.full_name);
        if (check.total > 0) {
          throw new HttpError(409, `Someone named "${fields.full_name}" is already registered.`, {
            code: "possible_duplicate",
            matches: check.by_day,
          });
        }
      }

      const path = `event-day-${day.day_number}/${randomUUID()}.${image.ext}`;
      try {
        await deps.storage.upload(path, file.buffer, image.mime);
        // The small preview is optional: a missing or broken one never blocks a registration.
        if (thumb && thumb.size <= 150 * 1024 && detectImage(thumb.buffer)?.mime === "image/jpeg") {
          await deps.storage.upload(thumbPath(path), thumb.buffer, "image/jpeg").catch(() => undefined);
        }
      } catch (err) {
        console.error(err);
        throw new HttpError(502, "The photo could not be uploaded. Please try again.");
      }

      try {
        const reg = await deps.repo.createRegistration({
          idempotency_key: fields.idempotency_key,
          full_name: fields.full_name,
          photo_path: path,
          event_day_id: fields.event_day_id,
          registered_by: user.id,
          consent: true,
        });
        if (reg.photo_path !== path) {
          // A concurrent retry with the same key saved first; discard this extra upload.
          await deps.storage.remove([path, thumbPath(path)]).catch(() => undefined);
        }
        const [row] = await withPhotoUrls(deps.storage, [reg as { photo_path: string | null }]);
        res.status(201).json({
          registration: { ...reg, code: `TCS-${String(reg.reg_number).padStart(5, "0")}`, photo_url: row?.photo_url ?? null },
        });
      } catch (err) {
        // Never leave a photo behind without a registration.
        await deps.storage.remove([path, thumbPath(path)]).catch(() => undefined);
        throw err;
      }
    }),
  );

  router.get(
    "/summary",
    ...g.user,
    asyncHandler(async (req, res) => {
      res.json(await deps.repo.mySummary(req.user!.id));
    }),
  );

  router.get(
    "/check-name",
    ...g.user,
    asyncHandler(async (req, res) => {
      const name = parse(z.string().trim().min(2).max(120), req.query.name, "Enter a name to check.");
      res.json(await deps.repo.checkName(name));
    }),
  );

  router.get(
    "/",
    ...g.user,
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const q = parse(listSchema, req.query);
      const result = await deps.repo.listRegistrations({
        ...q,
        viewer: user.id,
        role: user.role,
        registered_by: user.role === "admin" ? (q.registered_by ?? "") : "",
      });
      res.json({ total: result.total, registrations: await withPhotoUrls(deps.storage, result.rows) });
    }),
  );

  router.get(
    "/:id",
    ...g.user,
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const id = parse(uuid, req.params.id);
      const reg = await deps.repo.getRegistration(id, user.id, user.role);
      if (!reg) throw new HttpError(404, "Registration not found.");
      const [withUrl] = await withPhotoUrls(deps.storage, [reg as { photo_path: string | null }]);
      const others = await withPhotoUrls(deps.storage, (reg.same_person_registrations ?? []) as { photo_path: string | null }[]);
      res.json({ registration: { ...reg, photo_url: withUrl?.photo_url ?? null, same_person_registrations: others } });
    }),
  );

  return router;
}
