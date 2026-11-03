import { authenticate, type AuthConfig } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";

export function createGatewayApp(config: AuthConfig, targets: { catalog: string; org: string; classes?: string; crm?: string }) {
  // Single-instance limit, keyed by verified actor or socket IP. Never trust
  // client-supplied forwarding headers. Multi-replica hosting needs shared storage.
  const windows = new Map<string, { start: number; count: number }>();
  function limit(key: string, maximum: number) {
    const now = Date.now(), previous = windows.get(key);
    const value = previous && now - previous.start < 60000 ? previous : { start: now, count: 0 };
    value.count++;
    if (!windows.has(key) && windows.size >= 10000) {
      for (const [id, window] of windows) if (now - window.start >= 60000) windows.delete(id);
      if (windows.size >= 10000) throw new HttpError(503, "RATE_LIMIT_CAPACITY", "Retry shortly");
    }
    windows.set(key, value);
    if (value.count > maximum) throw new HttpError(429, "RATE_LIMITED", "Too many requests; retry after one minute");
  }
  return createApp("gateway", app => {
    app.use("/api/v1", async (req, res, next) => {
      const path = req.originalUrl.split("?")[0];
      const publicAuth = req.method === "POST" && ["/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout"].includes(path);
      if (publicAuth) { limit(`auth:${req.socket.remoteAddress}`, 60); next(); return; }
      await authenticate(config)(req, res, next);
    });
    app.use("/api/v1", async (req, res) => {
      if (res.locals.principal?.sub) limit(`actor:${res.locals.principal.sub}`, 300);
      const path = req.originalUrl.split("?")[0];
      const target = /^\/api\/v1\/(auth|accounts|assignees)(\/|$)/.test(path) ? config.identityUrl
        : /^\/api\/v1\/(courses|packages)(\/|$)/.test(path) ? targets.catalog
        : /^\/api\/v1\/(branches|departments|employees|teachers|access-sync)(\/|$)/.test(path) ? targets.org
        : /^\/api\/v1\/(classes|rooms|holds|hold-fixtures|teacher-time|operations)(\/|$)/.test(path) ? targets.classes
        : /^\/api\/v1\/crm(\/|$)/.test(path) ? targets.crm : undefined;
      if (!target) throw new HttpError(404, "NOT_FOUND", "Unknown API route");
      res.locals.routePattern = `/api/v1/${path.split("/")[3]}/*`;
      const headers: Record<string, string> = { "x-correlation-id": res.locals.correlationId, traceparent: res.locals.traceparent };
      for (const name of ["authorization", "idempotency-key", "content-type"]) {
        const value = req.get(name); if (value) headers[name] = value;
      }
      let response: Response;
      try {
        response = await fetch(`${target}${req.originalUrl}`, { method: req.method, headers, redirect: "error", body: ["GET", "HEAD"].includes(req.method) || req.body === undefined ? undefined : JSON.stringify(req.body), signal: AbortSignal.timeout(10000) });
      } catch { throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "Service unavailable"); }
      res.status(response.status);
      res.set("content-type", response.headers.get("content-type") ?? "application/json");
      res.send(Buffer.from(await response.arrayBuffer()));
    });
  });
}
