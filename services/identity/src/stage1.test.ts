import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { createIdentityApp } from "./app.js";
import { createOrgApp } from "../../org/src/app.js";
import { createGatewayApp } from "../../gateway/src/app.js";
import { verifyAccessToken, signAccessToken, type AuthConfig } from "@spacex/auth";
import { createApp as sharedApp } from "@spacex/http";

const databaseUrl = process.env.STAGE1_TEST_DATABASE_URL;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const names = ["identity", "org", "catalog"].map(s => `stage1_${randomUUID().replaceAll("-", "")}_${s}`);
const servers: Server[] = [], pools: pg.Pool[] = [];
const branchA = "10000000-0000-4000-8000-000000000002";
const branchB = "10000000-0000-4000-8000-000000000003";
const password = "Stage1-test-password-2026";
const config: AuthConfig = { secret: "test-only-stage1-secret-at-least-32-bytes", issuer: "stage1-test", audience: "stage1-api", identityUrl: "" };

describe.skipIf(!databaseUrl)("stage 1 integration (PostgreSQL)", () => {
  let admin: pg.Pool, iam: pg.Pool, org: pg.Pool;
  let identityUrl: string, orgUrl: string, gatewayUrl: string, catalogUrl: string;
  let director: { accessToken: string; refreshToken: string; user: { id: string } };
  let staff: { id: string }, employee: { id: string }, department: { id: string };
  async function listen(app: ReturnType<typeof createIdentityApp>) {
    const server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    servers.push(server); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  async function call(path: string, options: { base?: string; token?: string; method?: string; body?: unknown; key?: string } = {}) {
    const response = await fetch(`${options.base ?? gatewayUrl}${path}`, { method: options.method ?? "GET", headers: { "content-type": "application/json", ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.key ? { "idempotency-key": options.key } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  const login = (email = "director@spacex.test") => call("/api/v1/auth/login", { method: "POST", body: { email, password } });
  const access = (role = "admissions", branchIds = [branchA], key = randomUUID()) => call(`/api/v1/employees/${employee.id}/access`, { method: "PUT", token: director.accessToken, key, body: { role, branchIds } });
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    for (const name of names) {
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(databaseUrl!); url.pathname = `/${name}`;
      pools.push(new pg.Pool({ connectionString: url.toString() }));
    }
    [iam, org] = pools;
    function command(service: string, script: string, index: number, extra = {}) {
      const url = new URL(databaseUrl!); url.pathname = `/${names[index]}`;
      execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, `src/${script}.ts`], { cwd: `${root}/services/${service}`, env: { ...process.env, DATABASE_URL: url.toString(), ...extra }, stdio: "pipe" });
    }
    for (let i = 0; i < 2; i++) {
      command("identity", "migrate", 0); command("org", "migrate", 1); command("org", "seed", 1);
      command("identity", "seed", 0, { SEED_ADMIN_EMAIL: "director@spacex.test", SEED_ADMIN_PASSWORD: password });
    }
    expect(Number((await org.query("SELECT count(*) FROM branches")).rows[0].count)).toBe(6);
    expect(Number((await iam.query("SELECT count(*) FROM accounts")).rows[0].count)).toBe(1);
    const url = new URL(databaseUrl!); url.pathname = `/${names[2]}`; process.env.DATABASE_URL = url.toString();
    execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/db/migrate.ts"], { cwd: `${root}/services/catalog`, env: { ...process.env }, stdio: "pipe" });
    const { createApp } = await import("../../catalog/src/app.js");
    const { registerCatalogRoutes } = await import("../../catalog/src/routes.js");
    catalogUrl = await listen(createApp("catalog", app => registerCatalogRoutes(app, config)));
    orgUrl = await listen(createOrgApp(org, config));
    identityUrl = await listen(createIdentityApp(iam, config, orgUrl)); config.identityUrl = identityUrl;
    gatewayUrl = await listen(createGatewayApp(config, { org: orgUrl, catalog: catalogUrl }));
    director = (await login()).body.data; expect(director.accessToken).toBeTruthy();
    department = (await call("/api/v1/departments", { method: "POST", token: director.accessToken, body: { name: "Tuyển sinh", branchId: branchA } })).body.data;
    staff = (await call("/api/v1/accounts", { method: "POST", token: director.accessToken, body: { email: "staff@spacex.test", password, name: "Nhân viên" } })).body.data;
    employee = (await call("/api/v1/employees", { method: "POST", token: director.accessToken, body: { accountId: staff.id, branchId: branchA, departmentId: department.id, name: "Nhân viên" } })).body.data;
    expect((await access()).status).toBe(200);
  }, 60000);
  afterAll(async () => {
    for (const server of servers.reverse()) await new Promise<void>(resolve => server.close(() => resolve()));
    if (servers.length) { const { pool } = await import("../../catalog/src/db/client.js"); await pool.end(); }
    for (const pool of pools) await pool.end();
    if (admin) {
      for (const name of names) { if (!/^stage1_[a-f0-9]{32}_(identity|org|catalog)$/.test(name)) throw new Error("Unsafe test DB name"); await admin.query(`DROP DATABASE IF EXISTS ${name}`); }
      await admin.end();
    }
  });
  it("signs role/branch claims and never exposes password hashes", async () => {
    const result = await login("staff@spacex.test"); expect(result.status).toBe(200);
    expect(await verifyAccessToken(result.body.data.accessToken, config)).toMatchObject({ sub: staff.id, role: "admissions", branchIds: [branchA] });
    expect(JSON.stringify(result.body)).not.toContain("password_hash");
    expect((await call("/api/v1/auth/login", { method: "POST", body: { email: "staff@spacex.test", password: "wrong" } })).status).toBe(401);
  });
  it("protects direct Catalog calls as well as Gateway and allows only center-director writes", async () => {
    const token = (await login("staff@spacex.test")).body.data.accessToken;
    for (const base of [gatewayUrl, catalogUrl]) {
      expect((await call("/api/v1/courses", { base })).status).toBe(401);
      expect((await call("/api/v1/courses", { base, token, method: "POST", body: {} })).status).toBe(403);
    }
    const course = { code: "STAGE1", name: "Test", goal: "Test", level: "beginner", deliveryModes: ["online"], priceVnd: 1200000 };
    expect((await call("/api/v1/courses", { token: director.accessToken, method: "POST", body: course })).status).toBe(201);
    expect((await call("/api/v1/courses", { token })).body.data).toHaveLength(1);
  });
  it("filters branch scope and denies cross-branch or staff-management access", async () => {
    const token = (await login("staff@spacex.test")).body.data.accessToken;
    expect((await call("/api/v1/branches", { token })).body.data.map((b: { id: string }) => b.id)).toEqual([branchA]);
    for (const base of [gatewayUrl, orgUrl]) expect((await call(`/api/v1/branches/${branchB}`, { base, token })).status).toBe(403);
    expect((await call("/api/v1/accounts", { token })).status).toBe(403);
    expect((await call("/api/v1/employees", { token })).status).toBe(403);
    expect((await call("/api/v1/employees", { token: director.accessToken, method: "POST", body: { accountId: randomUUID(), branchId: branchA, name: "Missing" } })).status).toBe(409);
    expect((await call("/api/v1/departments", { token: director.accessToken, method: "POST", body: { branchId: branchA, name: "Tuyển sinh" } })).status).toBe(409);
  });
  it("applies access changes idempotently and immediately revokes existing sessions", async () => {
    const old = (await login("staff@spacex.test")).body.data; const key = randomUUID();
    expect((await access("teacher", [branchA], key)).body.data.status).toBe("applied");
    expect((await access("teacher", [branchA], key)).status).toBe(200);
    expect((await access("accountant", [branchA], key)).status).toBe(409);
    expect((await call("/api/v1/auth/me", { token: old.accessToken })).status).toBe(401);
    expect((await call("/api/v1/auth/refresh", { method: "POST", body: { refreshToken: old.refreshToken } })).status).toBe(401);
    const fresh = (await login("staff@spacex.test")).body.data;
    expect(fresh.user.role).toBe("teacher");
    expect((await call("/api/v1/employees", { token: fresh.accessToken })).body.data.map((e: { id: string }) => e.id)).toEqual([employee.id]);
    await access();
  });
  it("rotates refresh tokens once; logout revokes access at the service", async () => {
    const old = (await login("staff@spacex.test")).body.data;
    const refreshed = await call("/api/v1/auth/refresh", { method: "POST", body: { refreshToken: old.refreshToken } }); expect(refreshed.status).toBe(200);
    expect((await call("/api/v1/auth/me", { token: old.accessToken })).status).toBe(401);
    expect((await call("/api/v1/auth/refresh", { method: "POST", body: { refreshToken: old.refreshToken } })).status).toBe(401);
    expect((await call("/api/v1/auth/logout", { method: "POST", body: { refreshToken: refreshed.body.data.refreshToken } })).status).toBe(204);
    expect((await call("/api/v1/courses", { token: refreshed.body.data.accessToken, base: catalogUrl })).status).toBe(401);
    const expired = await signAccessToken({ id: staff.id, role: "admissions", branchIds: [branchA] }, randomUUID(), config, -1);
    expect((await call("/api/v1/courses", { token: expired })).status).toBe(401);
  });
  it("locking an account revokes sessions and prevents login", async () => {
    const old = (await login("staff@spacex.test")).body.data;
    expect((await call(`/api/v1/accounts/${staff.id}/status`, { token: director.accessToken, method: "PUT", body: { active: false } })).status).toBe(200);
    expect((await call("/api/v1/auth/me", { token: old.accessToken })).status).toBe(401);
    expect((await login("staff@spacex.test")).status).toBe(401);
    await call(`/api/v1/accounts/${staff.id}/status`, { token: director.accessToken, method: "PUT", body: { active: true } });
  });
  it("prevents self-lock, self-demotion and spoofed branches; persists audit", async () => {
    expect((await call(`/api/v1/accounts/${director.user.id}/status`, { token: director.accessToken, method: "PUT", body: { active: false } })).status).toBe(403);
    expect((await call(`/api/v1/accounts/${director.user.id}/access`, { token: director.accessToken, method: "PUT", key: randomUUID(), body: { role: "teacher", branchIds: [branchA] } })).status).toBe(403);
    expect((await access("teacher", [randomUUID()])).status).toBe(400);
    expect((await access("teacher", [branchA, randomUUID()])).status).toBe(409);
    expect(Number((await iam.query("SELECT count(*) FROM identity_audit")).rows[0].count)).toBeGreaterThan(0);
    expect(Number((await org.query("SELECT count(*) FROM org_audit")).rows[0].count)).toBeGreaterThan(0);
  });
  it("enforces the staff role matrix at direct service boundaries", async () => {
    for (const role of ["branch_director", "admissions", "accountant", "teacher"]) {
      await access(role);
      const token = (await login("staff@spacex.test")).body.data.accessToken;
      expect((await call("/api/v1/courses", { base: catalogUrl, token })).status).toBe(role === "accountant" ? 403 : 200);
      expect((await call("/api/v1/courses", { base: catalogUrl, token, method: "POST", body: {} })).status).toBe(403);
      expect((await call(`/api/v1/branches/${branchB}`, { base: orgUrl, token })).status).toBe(403);
    }
    await access();
  });
  it("locks repeated bad passwords and allows recovery after the lock expires", async () => {
    for (let i = 0; i < 5; i++) await call("/api/v1/auth/login", { method: "POST", body: { email: "staff@spacex.test", password: "wrong" } });
    expect((await login("staff@spacex.test")).status).toBe(401);
    await iam.query("UPDATE accounts SET locked_until=now()-interval '1 second' WHERE id=$1", [staff.id]);
    expect((await login("staff@spacex.test")).status).toBe(200);
  });
  it("allows only one concurrent refresh and logout with an old family token revokes the rotated session", async () => {
    const old = (await login("staff@spacex.test")).body.data;
    const results = await Promise.all([1, 2].map(() => call("/api/v1/auth/refresh", { method: "POST", body: { refreshToken: old.refreshToken } })));
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    const fresh = results.find(r => r.status === 200)!.body.data;
    await call("/api/v1/auth/logout", { method: "POST", body: { refreshToken: old.refreshToken } });
    expect((await call("/api/v1/auth/me", { token: fresh.accessToken })).status).toBe(401);
  });
  it("keeps access pending when IAM fails and retries the same operation after recovery", async () => {
    let unavailable = true;
    const proxy = await listen(sharedApp("iam-test-proxy", app => app.use(async (req, res) => {
      if (req.method === "PUT" && unavailable) { res.status(503).json({ error: { code: "UNAVAILABLE" } }); return; }
      const response = await fetch(`${identityUrl}${req.originalUrl}`, { method: req.method, headers: { authorization: req.get("authorization") ?? "", "content-type": "application/json", "idempotency-key": req.get("idempotency-key") ?? "" }, body: ["GET", "HEAD"].includes(req.method) || req.body === undefined ? undefined : JSON.stringify(req.body) });
      res.status(response.status).type("json").send(await response.text());
    })));
    const alternateOrg = await listen(createOrgApp(org, { ...config, identityUrl: proxy }));
    const key = randomUUID();
    const options = { base: alternateOrg, method: "PUT", token: director.accessToken, key, body: { role: "teacher", branchIds: [branchA] } };
    const path = `/api/v1/employees/${employee.id}/access`;
    expect((await call(path, options)).body.data.status).toBe("pending");
    expect((await org.query("SELECT status FROM access_sync WHERE id=$1", [key])).rows[0].status).toBe("pending");
    expect((await iam.query("SELECT role FROM accounts WHERE id=$1", [staff.id])).rows[0].role).toBe("admissions");
    unavailable = false;
    expect((await call(path, options)).body.data.status).toBe("applied");
    expect((await iam.query("SELECT role FROM accounts WHERE id=$1", [staff.id])).rows[0].role).toBe("teacher");
    await access();
  });
  it("fails closed if IAM is unavailable and reports upstream outages without leaking details", async () => {
    const { createApp } = await import("../../catalog/src/app.js");
    const { registerCatalogRoutes } = await import("../../catalog/src/routes.js");
    const blocked = await listen(createApp("catalog-failclosed", app => registerCatalogRoutes(app, { ...config, identityUrl: "http://127.0.0.1:1" })));
    expect((await call("/api/v1/courses", { base: blocked, token: director.accessToken })).status).toBe(503);
    const gateway = await listen(createGatewayApp(config, { org: orgUrl, catalog: "http://127.0.0.1:1" }));
    const result = await call("/api/v1/courses", { base: gateway, token: director.accessToken });
    expect(result.status).toBe(502); expect(JSON.stringify(result.body)).not.toContain("stage1_test");
  });
  it.skipIf(process.env.STAGE1_PORTAL_TEST !== "1")("runs the real Portal BFF with HttpOnly cookies, refresh, CSRF, forbidden writes and logout", async () => {
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [`${root}/node_modules/next/dist/bin/next`, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: `${root}/apps/admin-portal`, env: { ...process.env, NODE_ENV: "production", GATEWAY_URL: gatewayUrl, PORTAL_ORIGIN: origin }, stdio: "pipe", windowsHide: true });
    let output = "";
    child.stdout.on("data", data => { output = (output + data).slice(-10000); });
    child.stderr.on("data", data => { output = (output + data).slice(-10000); });
    const cookies = new Map<string, string>();
    async function browser(path: string, method = "GET", data?: unknown, foreignOrigin?: string) {
      const response = await fetch(`${origin}${path}`, { method, headers: { origin: foreignOrigin ?? origin, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
      for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(";"); const index = pair.indexOf("="); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
      return response;
    }
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error(`Portal exited: ${output}`);
        try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* wait for server startup */ }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw new Error(`Portal startup timed out: ${output}`);
      expect((await browser("/api/v1/courses")).status).toBe(401);
      expect((await browser("/api/session/login", "POST", { email: "director@spacex.test", password }, "https://foreign.example")).status).toBe(403);
      const loggedIn = await browser("/api/session/login", "POST", { email: "director@spacex.test", password });
      expect(loggedIn.status).toBe(200);
      const body = await loggedIn.json(); expect(body.data.role).toBe("center_director"); expect(body.data.accessToken).toBeUndefined();
      expect(loggedIn.headers.getSetCookie().every(c => /httponly/i.test(c) && /samesite=strict/i.test(c) && /secure/i.test(c))).toBe(true);
      expect((await browser("/api/v1/branches")).status).toBe(200);
      cookies.delete("hub_access");
      expect((await browser("/api/session/me")).status).toBe(200);
      expect(cookies.get("hub_access")).toBeTruthy();
      expect((await browser("/api/session/logout", "POST")).status).toBe(204);
      if (process.env.STAGE1_BROWSER_PATH) {
        const { chromium } = await import("playwright-core");
        const instance = await chromium.launch({ executablePath: process.env.STAGE1_BROWSER_PATH, headless: true });
        try {
          const page = await instance.newPage({ viewport: { width: 1440, height: 900 } });
          const pageErrors: string[] = [];
          page.on("pageerror", error => pageErrors.push(error.message));
          await page.goto(`${origin}/login`);
          await page.getByLabel("Email", { exact: true }).fill("director@spacex.test");
          await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
          await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
          await page.waitForURL("**/dashboard/overview");
          await page.getByRole("link", { name: "Tổ chức", exact: true }).click();
          await page.getByRole("heading", { name: "Tổ chức và tài khoản nhân viên" }).waitFor();
          const email = `browser-${randomUUID()}@spacex.test`;
          await page.getByLabel("Tên tài khoản", { exact: true }).fill("Browser staff");
          await page.getByLabel("Email tài khoản", { exact: true }).fill(email);
          await page.getByLabel("Mật khẩu cấp mới", { exact: true }).fill(password);
          await page.getByRole("button", { name: "Cấp tài khoản", exact: true }).click();
          await page.getByRole("cell", { name: email, exact: true }).waitFor();
          await page.getByLabel("Tài khoản nhân sự", { exact: true }).selectOption({ label: email });
          await page.getByLabel("Chi nhánh nhân sự", { exact: true }).selectOption(branchA);
          await page.getByLabel("Chức danh", { exact: true }).fill("Tuyển sinh");
          await page.getByRole("button", { name: "Thêm nhân sự", exact: true }).click();
          await page.getByLabel("Nhân sự gán quyền", { exact: true }).selectOption({ label: "Browser staff" });
          await page.getByLabel("Vai trò cấp", { exact: true }).selectOption("admissions");
          await page.getByLabel("Quận 1", { exact: true }).check();
          await page.getByRole("button", { name: "Gán quyền", exact: true }).click();
          await page.getByText("Đã gán quyền; phiên cũ đã bị thu hồi.", { exact: true }).waitFor();
          await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
          await page.waitForURL("**/login");
          await page.getByLabel("Email", { exact: true }).fill(email);
          await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
          await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
          await page.waitForURL("**/dashboard/mailbox");
          expect(await page.getByRole("link", { name: "Tài chính", exact: true }).count()).toBe(0);
          expect(await page.getByRole("combobox").count()).toBe(0);
          await page.getByRole("link", { name: "Xem khóa học", exact: true }).click();
          await page.getByRole("button", { name: /Thêm khóa học mới/ }).waitFor();
          expect(await page.getByRole("button", { name: /Thêm khóa học mới/ }).isDisabled()).toBe(true);
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole("button", { name: "Mở menu", exact: true }).click();
          await page.getByRole("link", { name: "Xem khóa học", exact: true }).click();
          await mkdir(`${root}/.local`, { recursive: true });
          await page.screenshot({ path: `${root}/.local/stage1-mobile.png`, fullPage: true });
          await page.goto(`${origin}/dashboard/organization`);
          await page.getByText("Bạn không có quyền truy cập trang này. Chọn chức năng được cấp trong menu.", { exact: true }).waitFor();
          const account = (await iam.query("SELECT id FROM accounts WHERE email=$1", [email])).rows[0];
          await call(`/api/v1/accounts/${account.id}/status`, { method: "PUT", token: director.accessToken, body: { active: false } });
          await page.reload(); await page.waitForURL("**/login");
          expect(pageErrors).toEqual([]);
        } finally { await instance.close(); }
      }
      expect((await browser("/api/session/me")).status).toBe(401);
      expect((await browser("/api/session/login", "POST", { email: "staff@spacex.test", password })).status).toBe(200);
      expect((await browser("/api/v1/courses", "POST", {})).status).toBe(403);
      expect((await browser("/api/v1/courses")).status).toBe(200);
      expect((await browser("/api/session/logout", "POST")).status).toBe(204);
    } finally {
      child.kill();
      await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
    }
  }, 60000);
});
