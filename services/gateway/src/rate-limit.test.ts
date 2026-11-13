import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken, type AuthConfig } from "@spacex/auth";
import { createGatewayApp } from "./app.js";

const servers: Server[] = [];
afterAll(async () => { for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve())); });
it("limits auth by socket address despite forged headers and isolates verified actor budgets", async () => {
  const config: AuthConfig = { secret: "gateway-test-secret-at-least-32-bytes", issuer: "gateway-test", audience: "gateway-test", identityUrl: "" };
  const identity = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/auth/introspect") {
      const claims = await verifyAccessToken(req.headers.authorization!.slice(7), config);
      res.end(JSON.stringify({ data: claims }));
    } else res.end(JSON.stringify({ data: [] }));
  });
  servers.push(identity);
  await new Promise<void>(resolve => identity.listen(0, "127.0.0.1", resolve));
  config.identityUrl = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
  const gateway = createGatewayApp(config, { catalog: config.identityUrl, org: config.identityUrl }).listen(0, "127.0.0.1");
  servers.push(gateway);
  await new Promise<void>(resolve => gateway.once("listening", resolve));
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  for (let i = 0; i < 61; i++) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "x-forwarded-for": `192.0.2.${i}` } });
    expect(response.status).toBe(i < 60 ? 200 : 429); await response.text();
  }
  const token = await signAccessToken({ id: randomUUID(), role: "center_director", branchIds: [] }, randomUUID(), config);
  for (let i = 0; i < 301; i++) {
    const response = await fetch(`${base}/api/v1/courses`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(i < 300 ? 200 : 429); await response.text();
  }
  const other = await signAccessToken({ id: randomUUID(), role: "center_director", branchIds: [] }, randomUUID(), config);
  expect((await fetch(`${base}/api/v1/courses`, { headers: { authorization: `Bearer ${other}` } })).status).toBe(200);
}, 15000);

it("forwards only reviewed enrollment/payment routes with a live session and keeps internal commands private", async () => {
  const config: AuthConfig = { secret: "gateway-enrollment-secret-at-least-32-bytes", issuer: "enrollment-test", audience: "enrollment-test", identityUrl: "" };
  const upstream = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/auth/introspect") {
      res.end(JSON.stringify({ data: await verifyAccessToken(req.headers.authorization!.slice(7), config) }));
    } else {
      const body: Buffer[] = []; for await (const chunk of req) body.push(chunk);
      res.end(JSON.stringify({ data: { path: req.url, key: req.headers["idempotency-key"], actor: req.headers["x-actor-id"], body: Buffer.concat(body).toString() } }));
    }
  });
  servers.push(upstream); await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  config.identityUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const gateway = createGatewayApp(config, { catalog: config.identityUrl, org: config.identityUrl, enrollment: config.identityUrl, payment: config.identityUrl }).listen(0, "127.0.0.1");
  servers.push(gateway); await new Promise<void>(resolve => gateway.once("listening", resolve));
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  expect((await fetch(`${base}/api/v1/enrollments`)).status).toBe(401);
  const token = await signAccessToken({ id: randomUUID(), role: "admissions", branchIds: [randomUUID()] }, randomUUID(), config);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID(), "x-actor-id": randomUUID() };
  const result = await fetch(`${base}/api/v1/enrollment-confirmations/preview`, { method: "POST", headers, body: JSON.stringify({ learnerId: randomUUID() }) });
  expect(result.status).toBe(200);
  const forwarded = (await result.json()).data;
  expect(forwarded).toMatchObject({ path: "/api/v1/enrollment-confirmations/preview", key: headers["idempotency-key"] });
  expect(forwarded.actor).toBeUndefined();
  for (const path of ["enrollments", `enrollments/${randomUUID()}`, `enrollment-confirmations/${randomUUID()}`, `payment-requests/${randomUUID()}`]) {
    expect((await fetch(`${base}/api/v1/${path}`, { headers })).status).toBe(200);
  }
  for (const path of ["/internal/classes/enrollments/commit", "/api/v1/payment-requests/webhook", `/api/v1/enrollments/${randomUUID()}/confirm`, "/api/v1/enrollment-confirmations/execute"]) {
    const response = await fetch(`${base}${path}`, { method: "POST", headers, body: "{}" });
    expect(response.status).toBe(404);
  }
});
