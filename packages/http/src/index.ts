import { randomUUID, randomBytes } from "node:crypto";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";
import { createLogger } from "@spacex/logger";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function createApp(service: string, routes: (app: Express) => void) {
  const app = express();
  const logger = createLogger(service);
  const requests = new Map<string, { count: number; errors: number; totalDurationMs: number }>();
  app.locals.httpMetrics = () => [...requests].map(([route, values]) => ({ route, ...values }));
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const started = performance.now();
    const incomingTrace = req.get("traceparent");
    const validTrace = incomingTrace?.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/);
    const traceId = validTrace && !/^0+$/.test(validTrace[1]) && !/^0+$/.test(validTrace[2]) ? validTrace[1] : randomBytes(16).toString("hex");
    const spanId = randomBytes(8).toString("hex");
    res.locals.traceparent = `00-${traceId}-${spanId}-01`;
    res.set("traceparent", res.locals.traceparent);
    const incoming = req.get("x-correlation-id");
    const correlationId = incoming && /^[a-zA-Z0-9_-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    res.locals.correlationId = correlationId;
    res.set("x-correlation-id", correlationId);
    res.set("cache-control", "no-store");
    res.on("finish", () => {
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      // Only registered route patterns; never query strings, credentials or IDs.
      const route = `${req.method} ${res.locals.routePattern ?? (typeof req.route?.path === "string" ? req.route.path : "unmatched")}`;
      const metric = requests.get(route) ?? { count: 0, errors: 0, totalDurationMs: 0 };
      metric.count++; metric.errors += Number(res.statusCode >= 500); metric.totalDurationMs += durationMs;
      if (requests.size < 500 || requests.has(route)) requests.set(route, metric);
      const log = res.statusCode >= 500 ? logger.error : logger.info;
      log("http.request", { correlationId, traceId, spanId, parentSpanId: validTrace?.[2], route, status: res.statusCode, durationMs });
    });
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", service }));
  routes(app);
  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Resource not found")));
  const handler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const correlationId = res.locals.correlationId;
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid input", details: error.issues.map(i => ({ path: i.path.join("."), message: i.message })) }, correlationId });
      return;
    }
    if (error instanceof HttpError) {
      if (error.status === 429) res.set("retry-after", "60");
      res.status(error.status).json({ error: { code: error.code, message: error.message }, correlationId });
      return;
    }
    const parserError = error as { type?: string; code?: string } | null;
    if (parserError?.type === "entity.parse.failed" || parserError?.type === "entity.too.large") {
      const large = parserError.type === "entity.too.large";
      res.status(large ? 413 : 400).json({ error: { code: large ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", message: large ? "Body exceeds 100kb" : "Invalid JSON body" }, correlationId });
      return;
    }
    if (["23505", "23503", "23514"].includes(parserError?.code ?? "")) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Conflicting or referenced data" }, correlationId });
      return;
    }
    logger.error("http.unhandled_error", { correlationId, errorName: error instanceof Error ? error.name : "Unknown" });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, correlationId });
  };
  app.use(handler);
  return app;
}
