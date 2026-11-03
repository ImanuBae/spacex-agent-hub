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
