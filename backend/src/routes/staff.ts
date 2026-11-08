import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler, requireAuth, requireRole, userRateLimit } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { publicUser, staffEmail, type Deps } from "../services/ports.js";

const password = z.string().min(10, "Password must be at least 10 characters.").max(72);

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "Username: 3-32 characters, letters, numbers, dot, dash or underscore."),
  password,
  /** "staff" registers participants; "presenter" can only run the projector screen. */
  role: z.enum(["staff", "presenter"]).default("staff"),
});

const updateSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120).optional(),
    is_active: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

const idSchema = z.string().uuid();

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request.";
}

/** Administrator-only staff management. Admin accounts are never created or edited through the API. */
export function staffRouter(env: Env, deps: Deps): Router {
  const router = Router();
  router.use(requireAuth(deps), requireRole("admin"), userRateLimit(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX));

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const all = await deps.store.list();
      res.json({ staff: all.map((p) => ({ ...publicUser(p), is_active: p.is_active, created_at: p.created_at })) });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
      const { full_name, username, password: pw, role } = parsed.data;

      const id = await deps.auth.createUser(staffEmail(username, env.STAFF_EMAIL_DOMAIN), pw);
      try {
        const profile = await deps.store.insert({ id, full_name, username, role });
        await deps.store.log(req.user!.id, "staff.created", { staff_id: id, username, role });
        res.status(201).json({ staff: { ...publicUser(profile), is_active: profile.is_active, created_at: profile.created_at } });
      } catch (err) {
        // Never leave a login without a profile.
        await deps.auth.deleteUser(id).catch(() => undefined);
        throw err;
      }
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) throw new HttpError(400, "Invalid account id.");
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
      const { full_name, is_active, password: pw } = parsed.data;

      if (id.data === req.user!.id) throw new HttpError(400, "You cannot change your own account here.");
      const target = await deps.store.getById(id.data);
      if (!target) throw new HttpError(404, "Account not found.");
      if (target.role === "admin") throw new HttpError(403, "Administrator accounts cannot be changed here.");

      let profile = target;
      if (full_name !== undefined || is_active !== undefined) {
        const patch: { full_name?: string; is_active?: boolean } = {};
        if (full_name !== undefined) patch.full_name = full_name;
        if (is_active !== undefined) patch.is_active = is_active;
        profile = await deps.store.update(target.id, patch);
      }
      if (pw !== undefined) await deps.auth.setPassword(target.id, pw);

      const actor = req.user!.id;
      if (full_name !== undefined) await deps.store.log(actor, "staff.renamed", { staff_id: target.id });
      if (is_active !== undefined) {
        await deps.store.log(actor, is_active ? "staff.activated" : "staff.deactivated", { staff_id: target.id });
      }
      if (pw !== undefined) await deps.store.log(actor, "staff.password_reset", { staff_id: target.id }); // never log the password

      res.json({ staff: { ...publicUser(profile), is_active: profile.is_active, created_at: profile.created_at } });
    }),
  );

  return router;
}
