import { Router } from "express";

export function healthRouter(): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "guc-tcs-api", time: new Date().toISOString() });
  });
  return router;
}
