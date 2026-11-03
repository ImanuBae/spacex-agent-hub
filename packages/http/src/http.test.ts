import { afterAll, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./index.js";

let server: Server;
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
it("propagates a valid trace, replaces invalid contexts and counts route patterns without IDs", async () => {
  const app = createApp("http-test", app => app.get("/objects/:id", (_req, res) => res.json({ ok: true })));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const traceId = "1234567890abcdef1234567890abcdef";
  const valid = await fetch(`${url}/objects/private-id?password=never-log`, { headers: { traceparent: `00-${traceId}-1234567890abcdef-01` } });
  expect(valid.headers.get("traceparent")).toMatch(new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`));
  const invalid = await fetch(`${url}/objects/other`, { headers: { traceparent: "00-00000000000000000000000000000000-0000000000000000-01" } });
  expect(invalid.headers.get("traceparent")).not.toContain("00000000000000000000000000000000");
  expect(app.locals.httpMetrics()).toEqual([expect.objectContaining({ route: "GET /objects/:id", count: 2, errors: 0 })]);
});
