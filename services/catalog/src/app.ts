import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { createLogger } from "@spacex/logger";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function createApp(service: string, registerRoutes?: (app: express.Express) => void) {
  const app = express();
  const logger = createLogger(service);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const incoming = req.get("x-correlation-id");
    const correlationId = incoming && /^[a-zA-Z0-9_-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    res.locals.correlationId = correlationId;
    res.set("x-correlation-id", correlationId);
    res.on("finish", () => logger.info("http.request", {
      correlationId, method: req.method, status: res.statusCode,
    }));
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", service }));
  registerRoutes?.(app);
  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Resource not found")));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const correlationId = res.locals.correlationId as string;
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid input",
        details: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }, correlationId });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message }, correlationId });
      return;
    }
    const parserError = error as { type?: string } | null;
    if (parserError?.type === "entity.parse.failed" || parserError?.type === "entity.too.large") {
      const tooLarge = parserError.type === "entity.too.large";
      res.status(tooLarge ? 413 : 400).json({ error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", message: tooLarge ? "Body exceeds 100kb" : "Invalid JSON body",
      }, correlationId });
      return;
    }
    logger.error("http.unhandled_error", { correlationId, errorName: error instanceof Error ? error.name : "Unknown" });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, correlationId });
  };
  app.use(errorHandler);
  return app;
}
