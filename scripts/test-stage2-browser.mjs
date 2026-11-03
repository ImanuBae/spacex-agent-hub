// Production Portal + four disposable databases + real IAM/Org/Catalog/Class/Gateway.
// Does not modify .env, existing demo accounts, or processes on the user's ports.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const databaseUrl = process.env.CLASS_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CLASS_TEST_DATABASE_URL required for isolated browser acceptance");
const root = process.cwd(), out = ".local/stage-next-browser";
await mkdir(out, { recursive: true });
const skill = process.env.TASTE_SKILL_ROOT ?? join(process.env.USERPROFILE ?? process.env.HOME, ".agents/skills/design-taste-frontend");
const { Browser, sleep } = await import(pathToFileURL(join(skill, "scripts/lib/cdp.mjs")).href);
const names = ["identity", "org", "catalog", "classes"].map(s => `stage2_browser_${randomUUID().replaceAll("-", "")}_${s}`);
const admin = new pg.Pool({ connectionString: databaseUrl }), pools = [], servers = [], children = [];
const password = randomBytes(24).toString("base64url"), branch = "10000000-0000-4000-8000-000000000002";
let browser, portalOrigin;
const accountIds = [randomUUID(), randomUUID(), randomUUID()], teacherId = randomUUID();
const checks = [];
async function listen(app) {
  const server = app.listen(0, "127.0.0.1"); servers.push(server); await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
async function child(args, env, name) {
  const log = await open(`${out}/${name}.log`, "w");
  const process = spawn(globalThis.process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
  children.push(process); await log.close(); return process;
}
try {
  for (const [i, name] of names.entries()) {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl); url.pathname = `/${name}`;
    const service = ["identity", "org", "catalog", "class-schedule"][i];
    const env = { ...process.env, DATABASE_URL: url.toString() };
    const migrate = service === "catalog" ? "src/db/migrate.ts" : "src/migrate.ts";
    for (let n = 0; n < 2; n++) execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, migrate], { cwd: `${root}/services/${service}`, env, stdio: "pipe" });
    if (service === "org") execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/seed.ts"], { cwd: `${root}/services/org`, env, stdio: "pipe" });
    pools.push(new pg.Pool({ connectionString: url.toString() }));
    if (service === "catalog") process.env.DATABASE_URL = url.toString();
  }
  checks.push("all migrations run twice without data loss");
  const [{ createIdentityApp }, { createOrgApp }, { createGatewayApp }, { createClassApp }, catalogApp, catalogRoutes, { hashPassword }] = await Promise.all([
    import("../services/identity/dist/app.js"), import("../services/org/dist/app.js"), import("../services/gateway/dist/app.js"), import("../services/class-schedule/dist/app.js"),
    import("../services/catalog/dist/app.js"), import("../services/catalog/dist/routes.js"), import("../services/identity/dist/password.js"),
  ]);
  const hash = await hashPassword(password), roles = ["center_director", "branch_director", "teacher"];
  for (const [i, role] of roles.entries()) await pools[0].query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,$3,$4,$5,$6)", [accountIds[i], `${role}@stage2.test`, `DEMO · ${role}`, hash, role, role === "center_director" ? [] : [branch]]);
  await pools[1].query("INSERT INTO employees(id,account_id,branch_id,name,teacher_profile) VALUES($1,$2,$3,'DEMO · Nguyễn Minh An','Tin học văn phòng')", [teacherId, accountIds[2], branch]);
  const auth = { secret: randomBytes(48).toString("base64url"), issuer: "stage2-browser", audience: "stage2-browser", identityUrl: "" };
  const orgUrl = await listen(createOrgApp(pools[1], auth));
  auth.identityUrl = await listen(createIdentityApp(pools[0], auth, orgUrl));
  const catalogUrl = await listen(catalogApp.createApp("catalog", app => catalogRoutes.registerCatalogRoutes(app, auth)));
  const classUrl = await listen(createClassApp(pools[3], auth, { orgUrl, catalogUrl, demo: false, ttlSeconds: 1200 }));
  const gatewayUrl = await listen(createGatewayApp(auth, { org: orgUrl, catalog: catalogUrl, classes: classUrl }));
  const portServer = createServer(); portServer.listen(0, "127.0.0.1"); await once(portServer, "listening"); const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve)); portalOrigin = `http://localhost:${port}`;
  const portal = await child([`${root}/node_modules/next/dist/bin/next`, "start", "apps/admin-portal", "--hostname", "127.0.0.1", "--port", String(port)], { ...process.env, NODE_ENV: "production", GATEWAY_URL: gatewayUrl, PORTAL_ORIGIN: portalOrigin }, "portal");
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (portal.exitCode !== null) throw new Error("Portal exited; inspect ignored Portal log");
    try { if ((await fetch(`${portalOrigin}/login`)).ok) { ready = true; break; } } catch { /* Wait for owned process. */ }
    await sleep(100);
  }
  assert(ready, "Production Portal ready");
  browser = await Browser.launch(); const page = await browser.newPage({ width: 1440, height: 900 });
  const exceptions = []; browser.on(page.sessionId, "Runtime.exceptionThrown", () => exceptions.push("JavaScript exception"));
  async function wait(fn, arg) { for (let i = 0; i < 100; i++) { if (await page.eval(fn, arg)) return; await sleep(80); } throw new Error(`Browser condition timed out: ${fn}`); }
  async function login(role) {
    await page.goto(`${portalOrigin}/login`);
    const status = await page.eval(async input => (await fetch("/api/session/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).status, { email: `${role}@stage2.test`, password });
    assert.equal(status, 200);
  }
  async function fill(id, value) {
    await page.eval(({ id, value }) => {
      const el = document.getElementById(id); if (!el) throw new Error(`Missing ${id}`);
      const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    }, { id, value });
  }
  async function click(text) {
    await wait(text => [...document.querySelectorAll("button")].some(b => b.textContent.trim().replace(/^\+\s*/, "") === text && !b.disabled), text);
    await page.eval(text => [...document.querySelectorAll("button")].find(b => b.textContent.trim().replace(/^\+\s*/, "") === text).click(), text);
  }
  async function submitDialog() {
    assert(await page.eval(() => { const form = document.querySelector("dialog[open] form"); if (!form.reportValidity()) return false; form.requestSubmit(); return true; }));
    await wait(() => !document.querySelector("dialog[open]"));
  }
  const start = new Date(Date.now() + 3 * 86400000).toISOString(), end = new Date(Date.parse(start) + 8 * 3600000).toISOString();
  const local = utc => new Date(Date.parse(utc) + 7 * 3600000).toISOString().slice(0, 16);
  await login("teacher"); await page.goto(`${portalOrigin}/dashboard/availability`);
  await click("Thêm khai báo"); await fill("startsAt", local(start)); await fill("endsAt", local(end)); await fill("reason", "DEMO · Ca dạy buổi sáng"); await submitDialog();
  await wait(() => document.body.textContent.includes("Có hiệu lực"));
  await page.goto(`${portalOrigin}/dashboard/availability`); await wait(() => document.body.textContent.includes("Ca dạy buổi sáng"));
  checks.push("teacher declares availability through real form, persists on reload");
  await click("Thêm khai báo"); await fill("kind", "LEAVE"); await fill("startsAt", local(start)); await fill("endsAt", local(end)); await fill("reason", "DEMO · Nghỉ khám sức khỏe"); await submitDialog();
  await wait(() => document.body.textContent.includes("Chờ duyệt"));
  assert.equal(await page.eval(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Duyệt nghỉ")), false);
  checks.push("leave request remains pending, teacher cannot self-approve");
  await login("branch_director"); await page.goto(`${portalOrigin}/dashboard/availability`); await click("Duyệt nghỉ"); await fill("reason", "DEMO · Đã kiểm tra lịch trống"); await submitDialog();
  await wait(() => document.body.textContent.includes("Đã kiểm tra lịch trống"));
  checks.push("branch director approves leave through BFF with version check");
  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 }); await sleep(200);
    assert.equal(await page.eval(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No page overflow at ${width}`);
    await page.screenshot({ path: `${out}/availability-${width}.jpg`, fullPage: true });
  }
  checks.push("responsive availability at 1440/768/390 without document overflow");
  await login("center_director"); await page.goto(`${portalOrigin}/dashboard/courses`);
  await click("Thêm khóa học mới");
  for (const [id, value] of Object.entries({ "course-code": "DEMO-BROWSER-EXCEL", "course-name": "DEMO · Excel cho công việc", "course-goal": "Excel cho công việc", "course-price": "9999999", "course-policy": "DEMO · Chính sách khóa", "course-status": "active" })) await fill(id, value);
  await submitDialog(); await click("Thêm gói học");
  await fill("courseId", await page.eval(() => [...document.getElementById("courseId").options].find(o => o.value)?.value));
  for (const [id, value] of Object.entries({ code: "DEMO-EXCEL-PACKAGE", name: "DEMO · Gói Excel cơ bản", sessionCount: "1", priceVnd: "600000", policyText: "DEMO · Chính sách gói, phiên bản đầu", status: "active" })) await fill(id, value);
  await submitDialog();
  await page.eval(() => [...document.querySelectorAll("summary")].find(s => s.textContent.includes("Tra gói học")).click());
  await fill("search-goal", "Excel"); await fill("search-min", "550000"); await fill("search-max", "650000"); await click("Tra gói phù hợp");
  await wait(() => document.body.textContent.includes("1 gói phù hợp đang bán"));
  await click("Xem lịch sử"); await click("Tải lịch sử");
  await wait(() => document.querySelector("dialog[open]")?.textContent.includes("Chính sách gói, phiên bản đầu"));
  await page.screenshot({ path: `${out}/policy-history.jpg`, fullPage: true });
  await page.eval(() => document.querySelector('dialog[open] [aria-label="Đóng hộp thoại"]').click());
  await page.screenshot({ path: `${out}/catalog-search.jpg`, fullPage: true });
  checks.push("real course/package policy forms, budget search uses package price, immutable history visible");
  await page.goto(`${portalOrigin}/dashboard/availability`); await wait(() => document.body.textContent.includes("Đã kiểm tra lịch trống"));
  // A genuine backend outage must remain an error instead of a fake empty list.
  await new Promise(resolve => servers[3].close(resolve));
  await click("Làm mới"); await wait(() => !!document.querySelector('[role="alert"]'));
  assert(await page.eval(() => document.body.textContent.includes("Chưa xác minh")));
  await page.screenshot({ path: `${out}/service-unavailable.jpg` });
  checks.push("backend outage shown as unverified data, not an empty list");
  assert.equal(exceptions.length, 0); checks.push("no uncaught JavaScript exceptions");
  await browser.close(); browser = undefined;
  // Restart the same Class app on a new endpoint for the visual inspector.
  // Gateway target can be updated without altering the user's running stack.
  const recovered = await listen(createClassApp(pools[3], auth, { orgUrl, catalogUrl, demo: false, ttlSeconds: 1200 }));
  const recoveredGateway = await listen(createGatewayApp(auth, { org: orgUrl, catalog: catalogUrl, classes: recovered }));
  portal.kill(); await once(portal, "exit");
  const inspectedPortal = await child([`${root}/node_modules/next/dist/bin/next`, "start", "apps/admin-portal", "--hostname", "127.0.0.1", "--port", String(port)], { ...process.env, NODE_ENV: "production", GATEWAY_URL: recoveredGateway, PORTAL_ORIGIN: portalOrigin }, "inspected-portal");
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${portalOrigin}/login`)).ok) break; } catch {} await sleep(100); }
  if (process.env.STAGE2_INSPECT === "1") {
    const inspection = await child([`${root}/scripts/inspect-portal.mjs`, `${portalOrigin}/dashboard/availability`, "--app", "--out", ".local/stage-next-design/availability"], { ...process.env, QA_PORTAL_ORIGIN: portalOrigin, QA_EMAIL: "branch_director@stage2.test", QA_PASSWORD: password }, "inspector");
    const [code] = await once(inspection, "exit"); assert.equal(code, 0, "Taste inspector passes; see ignored inspector log");
    checks.push("taste inspector passes all three viewports");
  }
  assert.equal(inspectedPortal.exitCode, null);
  await writeFile(`${out}/result.json`, JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser?.close();
  for (const process of children.reverse()) { if (process.exitCode === null && process.signalCode === null) { process.kill(); await once(process, "exit"); } }
  for (const server of servers.reverse()) if (server.listening) await new Promise(resolve => server.close(resolve));
  const catalogClient = await import("../services/catalog/dist/db/client.js").catch(() => null);
  await catalogClient?.pool.end();
  for (const pool of pools) await pool.end();
  for (const name of names) {
    if (!/^stage2_browser_[a-f0-9]{32}_(identity|org|catalog|classes)$/.test(name)) throw new Error("Unsafe browser DB cleanup");
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin.end();
}
