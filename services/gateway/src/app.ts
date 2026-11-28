import { authenticate, type AuthConfig } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";

export function createGatewayApp(config: AuthConfig, targets: { catalog: string; org: string; classes?: string; crm?: string; conversation?: string; enrollment?: string; payment?: string; notification?: string; reporting?: string; automation?: string }) {
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
  const catalogRoute = (method: string, path: string) => method === "GET" && /^\/api\/v1\/public-offers(\/[a-f0-9-]+)?$/.test(path);
  const checkoutRoute = (method: string, path: string) =>
    method === "GET" && /^\/api\/v1\/public-checkouts\/(classes\/)?[a-f0-9-]+$/.test(path)
    || method === "POST" && /^\/api\/v1\/public-checkouts\/(preview|[a-f0-9-]+\/confirm)$/.test(path);
  return createApp("gateway", app => {
    app.use("/api/v1", async (req, res, next) => {
      const path = req.originalUrl.split("?")[0];
      const publicAuth = req.method === "POST" && /^\/api\/v1\/auth\/(login|refresh|logout|otp\/(request|verify)|checkout-otp\/(request|verify))$/.test(path);
      if (/^\/api\/v1\/chat\/(session|messages|history|revoke)$/.test(path)) { limit(`chat:${req.socket.remoteAddress}`, 300); next(); return; }
      if (publicAuth) { limit(`auth:${req.socket.remoteAddress}`, 60); next(); return; }
      if (catalogRoute(req.method, path) || checkoutRoute(req.method, path)) {
        limit(`checkout:${req.method}:${req.socket.remoteAddress}`, req.method === "GET" ? 600 : 60); next(); return;
      }
      await authenticate(config)(req, res, next);
    });
    app.use("/api/v1", async (req, res) => {
      if (res.locals.principal?.sub) limit(`actor:${res.locals.principal.sub}`, 300);
      const path = req.originalUrl.split("?")[0];
      const enrollmentRoute = req.method === "GET" && /^\/api\/v1\/(enrollments|enrollment-confirmations)(\/[a-zA-Z0-9-]+)?$/.test(path)
        || req.method === "GET" && /^\/api\/v1\/enrollments\/[a-f0-9-]+\/entitlement$/.test(path)
        || req.method === "POST" && (/^\/api\/v1\/enrollment-confirmations\/preview$/.test(path) || /^\/api\/v1\/enrollment-confirmations\/[a-zA-Z0-9-]+\/(confirm|revoke)$/.test(path) || /^\/api\/v1\/enrollments\/[a-zA-Z0-9-]+\/cancel$/.test(path));
      const target = /^\/api\/v1\/(auth|accounts|assignees|learner-identities)(\/|$)/.test(path) ? config.identityUrl
        : catalogRoute(req.method, path) ? targets.catalog
        : checkoutRoute(req.method, path) ? targets.enrollment
        : /^\/api\/v1\/(courses|packages)(\/|$)/.test(path) ? targets.catalog
        : /^\/api\/v1\/(branches|departments|employees|teachers|access-sync)(\/|$)/.test(path) ? targets.org
        : /^\/api\/v1\/(classes|rooms|holds|hold-fixtures|teacher-time|operations|class-changes)(\/|$)/.test(path) ? targets.classes
        : /^\/api\/v1\/crm(\/|$)/.test(path) ? targets.crm
        : enrollmentRoute ? targets.enrollment
        : (req.method === "GET" && /^\/api\/v1\/student\/(class-schedule|class-changes)(\/|$)/.test(path)) ? targets.classes
        : (req.method === "POST" && /^\/api\/v1\/student\/class-changes\/[a-f0-9-]+\/choice$/.test(path)) ? targets.enrollment
        : (/^\/api\/v1\/(adjustments|waitlist)(\/[a-f0-9-]+(\/(approve|revoke|choice|invite|accept|decline))?)?$/.test(path) || /^\/api\/v1\/student\/(enrollments|adjustments|waitlist)(\/[a-f0-9-]+)?$/.test(path)) ? targets.enrollment
        : (/^\/api\/v1\/refunds(\/[a-f0-9-]+(\/execute)?)?$/.test(path) || /^\/api\/v1\/student\/invoices(\/[a-f0-9-]+(\/download)?)?$/.test(path) || req.method === "GET" && path === "/api/v1/student/payments") ? targets.payment
        : req.method === "GET" && /^\/api\/v1\/student\/order-payments\/[a-f0-9-]+$/.test(path) ? targets.payment
        : /^\/api\/v1\/notifications(\/|$)/.test(path) ? targets.notification
        : req.method === "GET" && path === "/api/v1/reports" ? targets.reporting
        : (req.method === "GET" && /^\/api\/v1\/automation\/incidents(\/[a-f0-9-]+)?$/i.test(path)
          || req.method === "POST" && /^\/api\/v1\/automation\/jobs\/[a-f0-9-]+\/replay$/i.test(path)) ? targets.automation
        : req.method === "GET" && /^\/api\/v1\/payment-requests(\/[a-zA-Z0-9-]+)?$/.test(path) ? targets.payment
        : req.method === "GET" && path === "/api/v1/payment-transactions" ? targets.payment
        : (req.method === "GET" && /^\/api\/v1\/payment-reviews(\/[a-zA-Z0-9-]+)?$/.test(path) || req.method === "POST" && /^\/api\/v1\/payment-reviews\/[a-zA-Z0-9-]+\/(decision|approve)$/.test(path)) ? targets.payment
        : /^\/api\/v1\/(chat|conversations)(\/|$)/.test(path) ? targets.conversation : undefined;
      if (!target) throw new HttpError(404, "NOT_FOUND", "Unknown API route");
      res.locals.routePattern = `/api/v1/${path.split("/")[3]}/*`;
      const headers: Record<string, string> = { "x-correlation-id": res.locals.correlationId, traceparent: res.locals.traceparent };
      for (const name of ["authorization", "idempotency-key", "content-type", "x-checkout-key"]) {
        const value = req.get(name); if (value) headers[name] = value;
      }
      let response: Response;
      try {
        response = await fetch(`${target}${req.originalUrl}`, { method: req.method, headers, redirect: "error", body: ["GET", "HEAD"].includes(req.method) || req.body === undefined ? undefined : JSON.stringify(req.body), signal: AbortSignal.timeout(10000) });
      } catch { throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "Service unavailable"); }
      res.status(response.status);
      res.set("content-type", response.headers.get("content-type") ?? "application/json");
      for (const name of ["content-disposition", "cache-control", "x-content-type-options"]) {
        const value = response.headers.get(name); if (value) res.set(name, value);
      }
      res.send(Buffer.from(await response.arrayBuffer()));
    });
  });
}
