import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import type { Env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { staffRouter } from "./routes/staff.js";
import type { Deps } from "./services/ports.js";

export function createApp(env: Env, deps: Deps): Express {
  const app = express();
  const logger = pino({ level: env.NODE_ENV === "test" ? "silent" : "info" });

  // Render sits behind a proxy; needed for correct client IPs and HTTPS detection.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(pinoHttp({ logger }));

  // Strict allow-list. Requests with no Origin (curl, health checks) are allowed through.
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: "100kb" }));

  // Coarse per-IP flood guard only. Real limits are per signed-in user (see middleware/auth.ts),
  // because all staff share the venue Wi-Fi and would otherwise share one bucket.
  app.use(
    "/api",
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_IP_MAX,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests. Please slow down." },
    }),
  );

  app.use("/api", healthRouter());
  app.use("/api/auth", authRouter(env, deps));
  app.use("/api/staff", staffRouter(env, deps));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
