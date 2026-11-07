import type { ErrorRequestHandler, RequestHandler } from "express";

/** Error with an HTTP status and a message that is safe to show to clients. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found." });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Never leak internal details to clients.
  (req as { log?: { error: (e: unknown) => void } }).log?.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};
