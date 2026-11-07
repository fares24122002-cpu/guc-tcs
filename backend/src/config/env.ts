import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .min(1, "CORS_ORIGINS is required")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter(Boolean),
    ),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_PHOTO_BUCKET: z.string().min(1).default("participant-photos"),
  // Staff sign in with a username; Supabase needs an email, so we derive one. Mail is never sent.
  STAFF_EMAIL_DOMAIN: z.string().min(3).default("staff.guc-tcs.test"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // Per signed-in user (staff share venue Wi-Fi, so per-IP limits would punish everyone at once).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  // Coarse per-IP flood guard; deliberately high because all staff share one IP.
  RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(1500),
});

export type Env = z.infer<typeof schema>;

/** Parse and validate environment variables. Throws a readable error on failure. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
