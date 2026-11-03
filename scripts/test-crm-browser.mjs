// Production Portal + four disposable databases + real IAM/Org/Catalog/CRM/Gateway.
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

const databaseUrl = process.env.CRM_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CRM_TEST_DATABASE_URL required for isolated browser acceptance");
const root = process.cwd(), out = ".local/crm-browser";
await mkdir(out, { recursive: true });
const skill = process.env.TASTE_SKILL_ROOT ?? join(process.env.USERPROFILE ?? process.env.HOME, ".agents/skills/design-taste-frontend");
const { Browser, sleep } = await import(pathToFileURL(join(skill, "scripts/lib/cdp.mjs")).href);
const names = ["identity", "org", "catalog", "crm"].map(s => `crm_browser_${randomUUID().replaceAll("-", "")}_${s}`);
const admin = new pg.Pool({ connectionString: databaseUrl }), pools = [], servers = [], children = [];
const password = randomBytes(24).toString("base64url"), branch = "10000000-0000-4000-8000-000000000002";
let browser, portalOrigin;
const accountIds = [randomUUID(), randomUUID(), randomUUID()];
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
    const service = ["identity", "org", "catalog", "crm"][i];
    const env = { ...process.env, DATABASE_URL: url.toString() };
    const migrate = service === "catalog" ? "src/db/migrate.ts" : "src/migrate.ts";
    for (let n = 0; n < 2; n++) execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, migrate], { cwd: `${root}/services/${service}`, env, stdio: "pipe" });
    if (service === "org") execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/seed.ts"], { cwd: `${root}/services/org`, env, stdio: "pipe" });
    pools.push(new pg.Pool({ connectionString: url.toString() }));
    if (service === "catalog") process.env.DATABASE_URL = url.toString();
  }
  checks.push("all migrations run twice without data loss");
  const [{ createIdentityApp }, { createOrgApp }, { createGatewayApp }, { createCrmApp }, catalogApp, catalogRoutes, { hashPassword }] = await Promise.all([
    import("../services/identity/dist/app.js"), import("../services/org/dist/app.js"), import("../services/gateway/dist/app.js"), import("../services/crm/dist/app.js"),
    import("../services/catalog/dist/app.js"), import("../services/catalog/dist/routes.js"), import("../services/identity/dist/password.js"),
  ]);
  const hash = await hashPassword(password), roles = ["center_director", "branch_director", "admissions"];
  for (const [i, role] of roles.entries()) await pools[0].query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,$3,$4,$5,$6)", [accountIds[i], `${role}@crm.test`, `DEMO · ${role}`, hash, role, role === "center_director" ? [] : [branch]]);
  const auth = { secret: randomBytes(48).toString("base64url"), issuer: "stage2-browser", audience: "stage2-browser", identityUrl: "" };
  const orgUrl = await listen(createOrgApp(pools[1], auth));
  auth.identityUrl = await listen(createIdentityApp(pools[0], auth, orgUrl));
  const catalogUrl = await listen(catalogApp.createApp("catalog", app => catalogRoutes.registerCatalogRoutes(app, auth)));
  const classUrl = await listen(createCrmApp(pools[3], auth, { orgUrl, catalogUrl }));
  const gatewayUrl = await listen(createGatewayApp(auth, { org: orgUrl, catalog: catalogUrl, crm: classUrl }));
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
    const status = await page.eval(async input => (await fetch("/api/session/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).status, { email: `${role}@crm.test`, password });
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

  await login("admissions"); await page.goto(`${portalOrigin}/dashboard/leads`);
  await wait(() => document.body.textContent.includes("Chưa có lead phù hợp"));
  await click("Tạo hồ sơ"); await fill("person-branch", branch); await fill("fullName", "DEMO · Khách CRM"); await fill("phone", "0901234567");
  await page.eval(() => document.querySelector('dialog[open] input[type="checkbox"]').click());
  await fill("statementVersion", "DEMO-v1"); await fill("statementText", "DEMO · Đồng ý tư vấn khóa học"); await submitDialog();
  await click("Hồ sơ khách hàng"); await click("Xem hồ sơ");
  await wait(() => document.body.textContent.includes("+84901234567"));
  await click("Sửa hồ sơ"); await fill("notes", "DEMO · Ghi chú được lưu"); await submitDialog();
  await click("Tạo lead tư vấn"); await fill("lead-branch", branch);
  await wait(() => document.getElementById("contactId")?.options.length > 1);
  await fill("contactId", await page.eval(() => document.getElementById("contactId").options[1].value));
  await fill("lead-notes", "DEMO · Nhu cầu Excel"); await submitDialog();
  await click("Lead tư vấn"); await click("Chăm sóc / phân công");
  await wait(() => document.getElementById("lead-notes")?.value === "DEMO · Nhu cầu Excel");
  await fill("stage", "CONTACTED"); await submitDialog();
  await page.goto(`${portalOrigin}/dashboard/leads`);
  await wait(() => document.body.textContent.includes("Đang tư vấn"));
  checks.push("real profile and consent forms, separate lead creation, versioned edit preserves notes, persists on reload");
  await click("Hồ sơ khách hàng"); await click("Xem hồ sơ"); await click("Ghi nhận yêu cầu xóa");
  await page.eval(() => [...document.querySelectorAll('dialog[open]')].at(-1).querySelector('form').requestSubmit());
  await wait(() => document.querySelectorAll('dialog[open]').length === 1);
  await page.eval(() => document.querySelector('dialog[open] [aria-label="Đóng hộp thoại"]').click());
  await click("Yêu cầu xóa"); await click("Xem tiến độ");
  await wait(() => document.body.textContent.includes("Chờ xác minh"));
  assert.equal(await page.eval(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Ghi nhận xác minh')), false);
  await page.eval(() => document.querySelector('dialog[open] [aria-label="Đóng hộp thoại"]').click());
  await login("branch_director"); await page.goto(`${portalOrigin}/dashboard/leads`);
  await click("Yêu cầu xóa"); await click("Xem tiến độ");
  await wait(() => document.body.textContent.includes("Tiến độ từng nơi xử lý"));
  checks.push("erasure request recorded through BFF and visible to branch manager, admissions cannot approve");
  await page.screenshot({ path: `${out}/erasure-detail.jpg`, fullPage: true });
  await page.eval(() => document.querySelector('dialog[open] [aria-label="Đóng hộp thoại"]').click());
  await click("Lead tư vấn"); await wait(() => document.body.textContent.includes("Đang tư vấn"));
  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 }); await sleep(200);
    assert.equal(await page.eval(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No page overflow at ${width}`);
    await page.screenshot({ path: `${out}/leads-${width}.jpg`, fullPage: true });
  }
  checks.push("responsive CRM at 1440/768/390 without document overflow");
  if (process.env.CRM_INSPECT === "1") {
    const inspection = await child([`${root}/scripts/inspect-portal.mjs`, `${portalOrigin}/dashboard/leads`, "--app", "--out", ".local/crm-design/inspection"], { ...process.env, QA_PORTAL_ORIGIN: portalOrigin, QA_EMAIL: "branch_director@crm.test", QA_PASSWORD: password }, "inspector");
    const [code] = await once(inspection, "exit"); assert.equal(code, 0, "Taste inspector passes"); checks.push("taste inspector passes");
  }
  await click("Yêu cầu xóa"); await click("Xem tiến độ"); await click("Ghi nhận xác minh");
  await fill("evidenceRef", "DEMO-VERIFY-001");
  await page.eval(() => [...document.querySelectorAll('dialog[open]')].at(-1).querySelector('form').requestSubmit());
  await wait(() => document.querySelectorAll('dialog[open]').length === 1);
  await click("Ẩn danh trong CRM");
  await page.eval(() => [...document.querySelectorAll('dialog[open]')].at(-1).querySelector('input[type="checkbox"]').click());
  await page.eval(() => [...document.querySelectorAll('dialog[open]')].at(-1).querySelector('form').requestSubmit());
  await wait(() => document.querySelectorAll('dialog[open]').length === 1 && document.body.textContent.includes("Đang xử lý"));
  const profile = (await pools[3].query("SELECT * FROM crm_people")).rows[0];
  assert.equal(profile.status, "ERASED"); assert.equal(profile.phone, ""); assert.equal(profile.notes, "");
  for (const service of ["Hội thoại", "Đăng ký học", "Thanh toán", "Báo cáo / xuất dữ liệu", "Bản sao lưu"]) {
    await click(`Ghi nhận kết quả · ${service}`); await fill("task-status", "NOT_APPLICABLE"); await fill("evidenceRef", "DEMO-CHECK-001");
    await page.eval(() => [...document.querySelectorAll('dialog[open]')].at(-1).querySelector('form').requestSubmit());
    await wait(() => document.querySelectorAll('dialog[open]').length === 1);
  }
  assert.equal((await pools[3].query("SELECT status FROM crm_erasure_requests")).rows[0].status, "COMPLETED");
  checks.push("manager verifies then anonymizes CRM, only completes after recording evidence for every downstream task");
  await page.eval(() => document.querySelector('dialog[open] [aria-label="Đóng hộp thoại"]').click());
  await new Promise(resolve => servers[3].close(resolve));
  await click("Làm mới"); await wait(() => !!document.querySelector('[role="alert"]'));
  assert(await page.eval(() => document.body.textContent.includes("Chưa xác minh")));
  checks.push("real CRM outage shows error instead of fake empty results");
  assert.equal(exceptions.length, 0); checks.push("no uncaught JavaScript exceptions");
  await browser.close(); browser = undefined;
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
    if (!/^crm_browser_[a-f0-9]{32}_(identity|org|catalog|crm)$/.test(name)) throw new Error("Unsafe browser DB cleanup");
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin.end();
}
