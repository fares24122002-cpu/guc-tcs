import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { detectAudio } from "../services/audio.js";
import type { Deps } from "../services/ports.js";
import { adminOrProjectorToken, guards, parse } from "./common.js";

/** Vercel functions accept at most ~4.5 MB per request, so sounds are capped just below that. */
export const MAX_SOUND_BYTES = 4 * 1024 * 1024;
const SOUND_URL_TTL_SECONDS = 6 * 3600;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SOUND_BYTES, files: 1, fields: 4, parts: 6 } });
const kind = z.enum(["countdown", "winners"], { errorMap: () => ({ message: "Unknown sound." }) });

export function soundsRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  async function listWithUrls() {
    const rows = await deps.repo.getSounds();
    const urls = await deps.sounds.signedUrls(rows.map((r) => r.path), SOUND_URL_TTL_SECONDS);
    const out: Record<string, { url: string | null; name: string; size_bytes: number; updated_at: string } | null> = { countdown: null, winners: null };
    for (const r of rows) out[r.kind] = { url: urls.get(r.path) ?? null, name: r.name, size_bytes: r.size_bytes, updated_at: r.updated_at };
    return out;
  }

  // Admin controller and the projector (admin session or read-only token) both read the current sounds.
  router.get(
    "/",
    adminOrProjectorToken(env, deps),
    asyncHandler(async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ sounds: await listWithUrls() });
    }),
  );

  router.put(
    "/:kind",
    ...g.admin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const k = parse(kind, req.params.kind);
      const file = req.file;
      if (!file || file.size === 0) throw new HttpError(400, "Choose an audio file.");
      const audio = detectAudio(file.buffer);
      if (!audio) throw new HttpError(400, "The file must be an MP3, WAV, OGG or M4A audio file.");

      const path = `${k}/${randomUUID()}.${audio.ext}`;
      try {
        await deps.sounds.upload(path, file.buffer, audio.mime);
      } catch (err) {
        console.error(err);
        throw new HttpError(502, "The sound could not be uploaded. Please try again.");
      }
      const original = (file.originalname || `${k}.${audio.ext}`).replace(/[^\w .()-]/g, "_").slice(0, 120);
      try {
        const { previous_path } = await deps.repo.setSound(req.user!.id, { kind: k, path, original_name: original, content_type: audio.mime, size_bytes: file.size });
        if (previous_path) await deps.sounds.remove([previous_path]).catch(() => undefined);
      } catch (err) {
        await deps.sounds.remove([path]).catch(() => undefined);
        throw err;
      }
      res.status(201).json({ sounds: await listWithUrls() });
    }),
  );

  router.delete(
    "/:kind",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const k = parse(kind, req.params.kind);
      const { previous_path } = await deps.repo.clearSound(req.user!.id, k);
      if (previous_path) await deps.sounds.remove([previous_path]).catch(() => undefined);
      res.json({ sounds: await listWithUrls() });
    }),
  );

  return router;
}
