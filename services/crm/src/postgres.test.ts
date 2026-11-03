import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createIdentityApp } from "../../identity/src/app.js";
import { hashPassword } from "../../identity/src/password.js";
import { createOrgApp } from "../../org/src/app.js";
import { createGatewayApp } from "../../gateway/src/app.js";
import { createCrmApp } from "./app.js";
import type { AuthConfig } from "@spacex/auth";

const databaseUrl = process.env.CRM_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CRM_TEST_DATABASE_URL required; no skipped DB acceptance");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const names = ["identity", "org", "catalog", "crm"].map(s => `crm_test_${randomUUID().replaceAll("-", "")}_${s}`);
const a = "10000000-0000-4000-8000-000000000002", b = "10000000-0000-4000-8000-000000000003";
const password = "CRM-test-only-password-2026";
const auth: AuthConfig = { secret: "crm-test-only-secret-at-least-32-bytes", issuer: "crm-test", audience: "crm-test", identityUrl: "" };
const pools: pg.Pool[] = [], servers: Server[] = [];
let admin: pg.Pool, crm: pg.Pool, iam: pg.Pool, gateway: string, direct: string, courseId: string;
let center: string, director: string, staff: string, second: string, outsider: string, teacher: string, accountant: string;
let staffId: string, secondId: string;
let sequence = 0;
async function listen(app: ReturnType<typeof createCrmApp>) {
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function call(path: string, method = "GET", body?: unknown, token = staff, base = gateway, key?: string) {
  const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function person(kind = "CONTACT", overrides: object = {}, token = staff) {
  sequence++;
  const input = { branchId: a, kind, fullName: `DEMO · Hồ sơ ${sequence}`, phone: `+8490${String(sequence).padStart(7, "0")}`, ...overrides };
  const result = await call("crm/people", "POST", input, token, gateway, randomUUID());
  expect(result.status, JSON.stringify(result.body)).toBe(201); return result.body.data;
}
const consent = (id: string, status = "GRANTED", purpose = "ADMISSIONS", token = staff) => call(`crm/people/${id}/consents`, "POST", { purpose, status, statementVersion: "DEMO-v1", statementText: "DEMO · Đồng ý lưu thông tin để tư vấn khóa học; không bao gồm marketing.", method: "WRITTEN" }, token, gateway, randomUUID());
async function lead(contactId: string, overrides: object = {}, token = staff, key = randomUUID()) {
  return call("crm/leads", "POST", { branchId: a, contactId, source: "PHONE", courseId, ...overrides }, token, gateway, key);
}

describe("CRM integrated with real IAM/Org/Catalog/Gateway/PostgreSQL", () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    for (const name of names) {
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(databaseUrl!); url.pathname = `/${name}`;
      pools.push(new pg.Pool({ connectionString: url.toString() }));
    }
    [iam, , , crm] = pools;
    await iam.query(await readFile(`${root}/services/identity/migrations/0001.sql`, "utf8"));
    await pools[1].query(await readFile(`${root}/services/org/migrations/0001.sql`, "utf8"));
    await pools[1].query("INSERT INTO branches(id,code,name,kind) VALUES($1,'CRM-A','DEMO Branch A','branch'),($2,'CRM-B','DEMO Branch B','branch')", [a, b]);
    const crmUrl = new URL(databaseUrl!); crmUrl.pathname = `/${names[3]}`;
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/migrate.ts"], { cwd: `${root}/services/crm`, env: { ...process.env, DATABASE_URL: crmUrl.toString() }, stdio: "pipe" });
    expect((await crm.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(1);
    const catalogUrl = new URL(databaseUrl!); catalogUrl.pathname = `/${names[2]}`; process.env.DATABASE_URL = catalogUrl.toString();
    execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/db/migrate.ts"], { cwd: `${root}/services/catalog`, env: process.env, stdio: "pipe" });
    const { createApp } = await import("../../catalog/src/app.js"), { registerCatalogRoutes } = await import("../../catalog/src/routes.js");
    const orgUrl = await listen(createOrgApp(pools[1], auth));
    auth.identityUrl = await listen(createIdentityApp(iam, auth, orgUrl));
    const catalog = await listen(createApp("catalog", app => registerCatalogRoutes(app, auth)));
    direct = await listen(createCrmApp(crm, auth, { orgUrl, catalogUrl: catalog }));
    gateway = await listen(createGatewayApp(auth, { org: orgUrl, catalog, crm: direct }));
    const hash = await hashPassword(password), tokens: string[] = [], accountIds: string[] = [];
    for (const [i, [role, branches]] of ([ ["center_director", []], ["branch_director", [a]], ["admissions", [a]], ["admissions", [a]], ["admissions", [b]], ["teacher", [a]], ["accountant", [a]] ] as const).entries()) {
      const id = randomUUID(), email = `user-${i}@crm.test`; accountIds.push(id);
      await iam.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,$3,$4,$5,$6)", [id, email, `DEMO · Staff ${i}`, hash, role, branches]);
      tokens.push((await call("auth/login", "POST", { email, password }, "")).body.data.accessToken);
    }
    [center, director, staff, second, outsider, teacher, accountant] = tokens; staffId = accountIds[2]; secondId = accountIds[3];
    courseId = (await call("courses", "POST", { code: "CRM-DEMO", name: "DEMO · Tin học văn phòng", goal: "Excel cho công việc", level: "beginner", deliveryModes: ["online"], priceVnd: 600000, status: "active" }, center)).body.data.id;
  }, 60000);
  afterAll(async () => {
    for (const server of servers.reverse()) await new Promise<void>(resolve => server.close(() => resolve()));
    if (servers.length) await (await import("../../catalog/src/db/client.js")).pool.end();
    for (const pool of pools) await pool.end();
    if (admin) { for (const name of names) { if (!/^crm_test_[a-f0-9]{32}_(identity|org|catalog|crm)$/.test(name)) throw new Error("Unsafe test database"); await admin.query(`DROP DATABASE IF EXISTS ${name}`); } await admin.end(); }
  });
  it("protects direct and Gateway calls; enforces role/branch on reads and writes", async () => {
    const p = await person();
    for (const base of [gateway, direct]) {
      expect((await call("crm/people", "GET", undefined, "", base)).status).toBe(401);
      for (const token of [teacher, accountant]) expect((await call("crm/people", "GET", undefined, token, base)).status).toBe(403);
      expect((await call(`crm/people/${p.id}`, "GET", undefined, outsider, base)).status).toBe(403);
      expect((await call(`crm/people?branchId=${a}`, "GET", undefined, outsider, base)).status).toBe(403);
      expect((await call(`crm/people/${p.id}`, "PUT", { version: p.version, input: { ...p, branchId: b } }, outsider, base)).status).not.toBe(200);
    }
    expect((await call("crm/people", "GET", undefined, outsider)).body.data).toHaveLength(0);
  });
  it("creates separate profiles; idempotent concurrent retries do not merge unverified duplicates", async () => {
    const input = { branchId: a, kind: "CONTACT", fullName: "DEMO · Trùng số", phone: "090 123 4567", notes: "Private CRM note" }, key = randomUUID();
    const results = await Promise.all([call("crm/people", "POST", input, staff, gateway, key), call("crm/people", "POST", input, staff, gateway, key)]);
    expect(results.map(r => r.status)).toEqual([201, 201]); expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect(results[0].body.data.phone).toBe("+84901234567");
    const duplicate = await person("CONTACT", { phone: "+84901234567" });
    expect(duplicate.id).not.toBe(results[0].body.data.id);
    const detail = await call(`crm/people/${results[0].body.data.id}`);
    expect(detail.body.data.duplicates.map((p: { id: string }) => p.id)).toContain(duplicate.id);
    expect((await call("crm/people", "POST", { ...input, fullName: "Changed" }, staff, gateway, key)).body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const summary = await call(`crm/people?search=${encodeURIComponent(input.fullName)}`);
    expect(summary.body.data[0].phone).not.toBe("+84901234567"); expect(detail.body.data.person.notes).toBe("Private CRM note");
  });
  it("requires explicit admissions consent and never grants marketing automatically", async () => {
    const p = await person();
    expect((await lead(p.id)).body.error.code).toBe("CONSENT_REQUIRED");
    expect((await consent(p.id)).status).toBe(201);
    expect((await lead(p.id)).status).toBe(201);
    const detail = (await call(`crm/people/${p.id}`)).body.data;
    expect(detail.consents.map((c: { purpose: string }) => c.purpose)).toEqual(["ADMISSIONS"]);
    await consent(p.id, "REVOKED");
    expect((await lead(p.id, { courseId: null })).body.error.code).toBe("CONSENT_REQUIRED");
  });
  it("enforces versioned edits, immutable kind/branch and server-owned fields", async () => {
    const p = await person(), input = { branchId: a, kind: p.kind, fullName: "DEMO · Đã sửa", phone: p.phone, email: "", notes: "" };
    expect((await call(`crm/people/${p.id}`, "PUT", { version: 1, input })).status).toBe(200);
    expect((await call(`crm/people/${p.id}`, "PUT", { version: 1, input })).body.error.code).toBe("STALE_VERSION");
    expect((await call(`crm/people/${p.id}`, "PUT", { version: 2, input: { ...input, kind: "LEARNER" } })).body.error.code).toBe("IMMUTABLE_REFERENCE");
    expect((await call("crm/people", "POST", { ...input, actorId: staffId }, staff, gateway, randomUUID())).status).toBe(400);
    expect((await call("crm/people", "POST", input, staff)).status).toBe(400);
  });
  it("keeps lead ownership atomic and rejects inactive/wrong-scope assignees", async () => {
    const p = await person(); await consent(p.id);
    const created = await lead(p.id, { ownerId: null }, center); expect(created.status).toBe(201);
    const claims = await Promise.all([call(`crm/leads/${created.body.data.id}/claim`, "POST", { version: 1 }, staff), call(`crm/leads/${created.body.data.id}/claim`, "POST", { version: 1 }, second)]);
    expect(claims.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = claims[0].status === 200 ? staff : second, loser = winner === staff ? second : staff;
    const record = claims.find(r => r.status === 200)!.body.data;
    expect((await call(`crm/leads/${record.id}`, "PUT", { version: record.version, stage: "CONTACTED", ownerId: record.ownerId, notes: "Follow up" }, loser)).status).toBe(403);
    expect((await call(`crm/leads/${record.id}`, "PUT", { version: record.version, stage: "CONTACTED", ownerId: record.ownerId, notes: "Follow up" }, winner)).status).toBe(200);
    expect((await lead(p.id, { courseId: null, ownerId: randomUUID() }, center)).body.error.code).toBe("INVALID_OWNER");
    await iam.query("UPDATE accounts SET active=false WHERE id=$1", [secondId]);
    expect((await lead(p.id, { courseId: null, ownerId: secondId }, center)).body.error.code).toBe("INVALID_OWNER");
    await iam.query("UPDATE accounts SET active=true WHERE id=$1", [secondId]);
    expect((await call(`assignees?branchId=${a}`, "GET", undefined, outsider)).status).toBe(403);
    const list = await call(`assignees?branchId=${a}`);
    expect(JSON.stringify(list.body)).not.toMatch(/password_hash|email|refresh/);
  });
  it("deduplicates active leads and disallows forged registration or invalid course references", async () => {
    const p = await person(); await consent(p.id); const key = randomUUID();
    const results = await Promise.all([lead(p.id, {}, staff, key), lead(p.id, {}, staff, key)]);
    expect(results.map(r => r.status)).toEqual([201, 201]); expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect((await lead(p.id)).body.error.code).toBe("DUPLICATE_RECORD");
    expect((await lead(p.id, { stage: "ENROLLED" })).status).toBe(400);
    expect((await lead(p.id, { courseId: randomUUID() })).body.error.code).toBe("INVALID_REFERENCE");
  });
  it("requires verified contact/payer relationships before linking a learner", async () => {
    const contact = await person(), learner = await person("LEARNER", { phone: "" }); await consent(contact.id);
    expect((await lead(contact.id, { learnerId: learner.id })).body.error.code).toBe("RELATIONSHIP_UNVERIFIED");
    const link = await call("crm/relationships", "POST", { fromPersonId: contact.id, learnerId: learner.id, kind: "PARENT" }, staff, gateway, randomUUID());
    expect(link.status).toBe(201);
    expect((await call(`crm/relationships/${link.body.data.id}/decision`, "POST", { version: 1, status: "VERIFIED", evidenceRef: "DEMO-VERIFY-01" }, staff)).status).toBe(403);
    expect((await call(`crm/relationships/${link.body.data.id}/decision`, "POST", { version: 1, status: "VERIFIED", evidenceRef: "DEMO-VERIFY-01" }, director)).status).toBe(200);
    expect((await lead(contact.id, { learnerId: learner.id })).status).toBe(201);
    const foreign = await person("LEARNER", { branchId: b, phone: "" }, outsider);
    expect((await call("crm/relationships", "POST", { fromPersonId: contact.id, learnerId: foreign.id, kind: "OTHER" }, center, gateway, randomUUID())).body.error.code).toBe("INVALID_RELATIONSHIP");
  });
  it("filters and paginates within scope; audits reads without logging search or personal values", async () => {
    const p = await person("CONTACT", { fullName: "DEMO · PII unique", phone: "+84999888777" });
    const response = await call(`crm/people?search=${encodeURIComponent(p.fullName)}&pageSize=1&page=1`);
    expect(response.body.data).toHaveLength(1); expect(response.body.pagination.total).toBe(1);
    await call(`crm/people/${p.id}`);
    const audits = await crm.query("SELECT action FROM crm_audit WHERE target_id=$1", [p.id]);
    expect(audits.rows.some(r => r.action === "crm.person.read")).toBe(true);
    const events = await crm.query("SELECT event::text AS event FROM event_outbox WHERE event->'payload'->>'targetId'=$1", [p.id]);
    expect(JSON.stringify(events.rows)).not.toContain(p.fullName); expect(JSON.stringify(events.rows)).not.toContain(p.phone);
    await expect(crm.query("DELETE FROM crm_audit")).rejects.toThrow("CRM audit is append only");
  });
  it("verifies erasure before anonymizing and tracks all downstream tasks instead of false completion", async () => {
    const p = await person("CONTACT", { notes: "DEMO private note to erase" }); await consent(p.id); const createdLead = await lead(p.id);
    const request = await call("crm/erasure-requests", "POST", { personId: p.id, reason: "SUBJECT_REQUEST" }, staff, gateway, randomUUID());
    expect(request.status).toBe(201); const id = request.body.data.id;
    expect((await call(`crm/erasure-requests/${id}/anonymize`, "POST", { version: 1 }, director)).body.error.code).toBe("VERIFICATION_REQUIRED");
    expect((await call(`crm/erasure-requests/${id}/decision`, "POST", { version: 1, decision: "VERIFIED", method: "REGISTERED_CONTACT_CALLBACK", evidenceRef: "DEMO-IDENTITY-CHECK" }, staff)).status).toBe(403);
    const verified = await call(`crm/erasure-requests/${id}/decision`, "POST", { version: 1, decision: "VERIFIED", method: "REGISTERED_CONTACT_CALLBACK", evidenceRef: "DEMO-IDENTITY-CHECK" }, director);
    expect(verified.status).toBe(200);
    expect((await consent(p.id)).body.error.code).toBe("PRIVACY_LOCKED");
    const erased = await call(`crm/erasure-requests/${id}/anonymize`, "POST", { version: verified.body.data.version }, director);
    expect(erased.status).toBe(200); expect(erased.body.data.status).toBe("PROCESSING");
    expect(erased.body.data.tasks.find((t: { service: string }) => t.service === "CRM").status).toBe("DONE");
    expect(erased.body.data.tasks.filter((t: { status: string }) => t.status === "PENDING")).toHaveLength(5);
    const detail = (await call(`crm/people/${p.id}`)).body.data;
    expect(detail.person).toMatchObject({ fullName: "Đã ẩn danh", phone: "", email: "", notes: "", status: "ERASED" });
    expect(detail.consents[0].status).toBe("REVOKED");
    expect((await lead(p.id, { courseId: null })).body.error.code).toBe("PERSON_ERASED");
    expect((await crm.query("SELECT stage,notes FROM crm_leads WHERE id=$1", [createdLead.body.data.id])).rows[0]).toEqual({ stage: "LOST", notes: "" });
    await expect(crm.query("DELETE FROM crm_erasure_tombstones WHERE person_id=$1", [p.id])).rejects.toThrow("append only");
    for (const task of erased.body.data.tasks.filter((t: { service: string }) => t.service !== "CRM")) {
      const result = await call(`crm/erasure-requests/${id}/tasks/${task.service}`, "POST", { version: task.version, status: "NOT_APPLICABLE", evidenceRef: "DEMO-REVIEW-NO-DOWNSTREAM-DATA" }, director);
      expect(result.status).toBe(200);
    }
    const requests = await call("crm/erasure-requests");
    expect(requests.body.data.find((r: { id: string }) => r.id === id).status).toBe("COMPLETED");
  });
  it("keeps outbox writes atomic with business failures", async () => {
    const before = Number((await crm.query("SELECT count(*) FROM event_outbox")).rows[0].count);
    const p = await person();
    const afterPerson = Number((await crm.query("SELECT count(*) FROM event_outbox")).rows[0].count); expect(afterPerson).toBe(before + 1);
    expect((await lead(p.id)).status).toBe(409);
    expect(Number((await crm.query("SELECT count(*) FROM event_outbox")).rows[0].count)).toBe(afterPerson);
  });
});
