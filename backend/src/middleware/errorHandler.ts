import type { ErrorRequestHandler, RequestHandler } from "express";

/** Error with an HTTP status and a message that is safe to show to clients. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Extra fields merged into the JSON body (for example a machine-readable `code`). */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found." });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ...err.extra, error: err.message });
    return;
  }
  const e = err as { type?: string; code?: string };
  if (e.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }
  if (e.type === "entity.too.large" || e.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "The upload is too large (photos can be at most 6 MB)." });
    return;
  }
  if (e.code === "LIMIT_UNEXPECTED_FILE" || e.code === "LIMIT_FILE_COUNT" || e.code === "LIMIT_FIELD_COUNT") {
    res.status(400).json({ error: "Invalid upload." });
    return;
  }
  // Never leak internal details to clients.
  (req as { log?: { error: (e: unknown) => void } }).log?.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};
