import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CourseInput } from "@spacex/contracts";
import { createApp } from "./app.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = createApp("test-service", app => {
    app.post("/courses", (req, res) => res.status(201).json({ data: CourseInput.parse(req.body) }));
    app.get("/failure", async () => { throw new Error("secret database password"); });
  });
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe("service HTTP contract", () => {
  it("serves health and propagates correlation ID", async () => {
    const response = await fetch(`${base}/health`, { headers: { "x-correlation-id": "demo-123" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("demo-123");
    expect(await response.json()).toEqual({ status: "ok", service: "test-service" });
  });
  it("rejects invalid catalog data with field details", async () => {
    const response = await fetch(`${base}/courses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", priceVnd: -1 }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "priceVnd" })]));
    expect(body.correlationId).toBe(response.headers.get("x-correlation-id"));
  });
  it("returns JSON for malformed request bodies", async () => {
    const response = await fetch(`${base}/courses`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });
  it("handles missing routes", async () => {
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });
  it("handles async errors without leaking internals", async () => {
    const response = await fetch(`${base}/failure`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });
});
