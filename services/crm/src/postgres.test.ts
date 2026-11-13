import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
import { createBridgeApp } from "../../automation-bridge/src/app.js";
import { BridgeStore } from "../../automation-bridge/src/store.js";
import { createConversationApp } from "../../conversation/src/app.js";
import { messagingSchema } from "@spacex/messaging";
import type { AuthConfig } from "@spacex/auth";

const databaseUrl = process.env.CRM_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CRM_TEST_DATABASE_URL required; no skipped DB acceptance");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const names = ["identity", "org", "catalog", "crm", "bridge", "conversation"].map(s => `crm_test_${randomUUID().replaceAll("-", "")}_${s}`);
const a = "10000000-0000-4000-8000-000000000002", b = "10000000-0000-4000-8000-000000000003";
const password = "CRM-test-only-password-2026";
const auth: AuthConfig = { secret: "crm-test-only-secret-at-least-32-bytes", issuer: "crm-test", audience: "crm-test", identityUrl: "" };
const pools: pg.Pool[] = [], servers: Server[] = [];
let admin: pg.Pool, crm: pg.Pool, iam: pg.Pool, gateway: string, direct: string, courseId: string;
let center: string, director: string, staff: string, second: string, outsider: string, teacher: string, accountant: string;
let staffId: string, secondId: string;
let bridge: string, chat: string, machineToken: string, directorRefresh: string, store: BridgeStore;
let sequence = 0;
const observations: object[] = [];
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
async function internal(path: string, body: unknown, token: string, base = auth.identityUrl, method = "POST") {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function command(input: object, token = staff) {
  const request = await call("crm/automation-requests", "POST", input, token, gateway, randomUUID());
  expect(request.status, JSON.stringify(request.body)).toBe(201);
  const event = (await crm.query("SELECT event FROM event_outbox WHERE event->>'type'='crm.requested' AND event->'payload'->>'inputRef'=$1", [request.body.data.id])).rows[0].event;
  await store.ingest(event);
  const claimed = await internal("/internal/automation/jobs/claim", { workflowId: "WF-04", workflowVersion: 1 }, machineToken, bridge);
  expect(claimed.status).toBe(200); const job = claimed.body.data;
  expect(job.inputRef).toBe(request.body.data.id);
  const checkpoint = await internal(`/internal/automation/jobs/${job.jobId}/checkpoint`, { leaseToken: job.leaseToken, attempt: job.attempt, expectedVersion: job.version, step: "crm", operation: { name: "crm.execute" } }, machineToken, bridge);
  expect(checkpoint.status).toBe(200);
  const issued = await internal(`/internal/automation/jobs/${job.jobId}/authorize`, { leaseToken: job.leaseToken, attempt: job.attempt, operation: "crm.execute" }, machineToken, bridge);
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  observations.push({ case: expect.getState().currentTestName, action: (input as { action: string }).action, requestId: job.inputRef, eventId: job.eventId, correlationId: job.correlationId, jobId: job.jobId, operationKey: checkpoint.body.data.operationRefs.find((r: { name: string }) => r.name === "crm.execute").operationKey });
  return { requestId: job.inputRef as string, token: issued.body.data.accessToken as string, job: checkpoint.body.data };
}
async function finish(job: { jobId: string; leaseToken: string; attempt: number; version: number }, outcome = "DONE") {
  const result = await internal(`/internal/automation/jobs/${job.jobId}/result`, { leaseToken: job.leaseToken, attempt: job.attempt, expectedVersion: job.version, step: "crm", outcome, ...(outcome === "DEAD" ? { errorCode: "INPUT_CONFLICT" } : {}) }, machineToken, bridge);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
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
    for (const version of ["0002_machine", "0003_channel", "0004_service"]) await iam.query(await readFile(`${root}/services/identity/migrations/${version}.sql`, "utf8"));
    await pools[1].query(await readFile(`${root}/services/org/migrations/0001.sql`, "utf8"));
    await pools[1].query("INSERT INTO branches(id,code,name,kind) VALUES($1,'CRM-A','DEMO Branch A','branch'),($2,'CRM-B','DEMO Branch B','branch')", [a, b]);
    const crmUrl = new URL(databaseUrl!); crmUrl.pathname = `/${names[3]}`;
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/migrate.ts"], { cwd: `${root}/services/crm`, env: { ...process.env, DATABASE_URL: crmUrl.toString() }, stdio: "pipe" });
    expect((await crm.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(2);
    const catalogUrl = new URL(databaseUrl!); catalogUrl.pathname = `/${names[2]}`; process.env.DATABASE_URL = catalogUrl.toString();
    execFileSync(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, "src/db/migrate.ts"], { cwd: `${root}/services/catalog`, env: process.env, stdio: "pipe" });
    const { createApp } = await import("../../catalog/src/app.js"), { registerCatalogRoutes } = await import("../../catalog/src/routes.js");
    const orgUrl = await listen(createOrgApp(pools[1], auth));
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const authority = { privateKey: keys.privateKey, issuer: "crm-test-machine", bridgeUrl: "" };
    auth.identityUrl = await listen(createIdentityApp(iam, auth, orgUrl, authority));
    await pools[4].query(await readFile(`${root}/services/automation-bridge/migrations/0001.sql`, "utf8")); await pools[4].query(messagingSchema);
    await pools[5].query(await readFile(`${root}/services/conversation/migrations/0001.sql`, "utf8")); await pools[5].query(messagingSchema);
    store = new BridgeStore(pools[4], [{ eventType: "crm.requested", workflowId: "WF-04", workflowVersion: 1, inputSchemaVersion: 1 }]);
    bridge = await listen(createBridgeApp(store, auth, { publicKey: keys.publicKey, issuer: authority.issuer, subjects: { "crm-test-worker": ["WF-04"] } })); authority.bridgeUrl = bridge;
    const catalog = await listen(createApp("catalog", app => registerCatalogRoutes(app, auth)));
    const crmConfig = { orgUrl, catalogUrl: catalog, conversationUrl: "" };
    direct = await listen(createCrmApp(crm, auth, crmConfig));
    chat = await listen(createConversationApp(pools[5], auth, { branchId: a, bridgeUrl: bridge, sourceClientId: "unused-crm-test-channel", sourceClientSecret: "unused-crm-test-secret", crmUrl: direct }));
    crmConfig.conversationUrl = chat;
    gateway = await listen(createGatewayApp(auth, { org: orgUrl, catalog, crm: direct }));
    const hash = await hashPassword(password), tokens: string[] = [], accountIds: string[] = [];
    for (const [i, [role, branches]] of ([ ["center_director", []], ["branch_director", [a]], ["admissions", [a]], ["admissions", [a]], ["admissions", [b]], ["teacher", [a]], ["accountant", [a]] ] as const).entries()) {
      const id = randomUUID(), email = `user-${i}@crm.test`; accountIds.push(id);
      await iam.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,$3,$4,$5,$6)", [id, email, `DEMO · Staff ${i}`, hash, role, branches]);
      const session = (await call("auth/login", "POST", { email, password }, "")).body.data;
      tokens.push(session.accessToken); if (i === 1) directorRefresh = session.refreshToken;
    }
    [center, director, staff, second, outsider, teacher, accountant] = tokens; staffId = accountIds[2]; secondId = accountIds[3];
    const worker = await internal("/internal/iam/principals", { id: "crm-test-worker", grants: [{ audience: "automation-bridge", scopes: ["automation:claim", "automation:read", "automation:checkpoint", "automation:authorize", "automation:result"] }, { audience: "crm", scopes: ["crm:write"] }], workflows: ["WF-04"] }, center);
    expect(worker.status).toBe(201);
    const issued = await internal("/internal/iam/machine/token", { clientId: worker.body.data.id, clientSecret: worker.body.data.clientSecret, audience: "automation-bridge", scopes: ["automation:claim", "automation:read", "automation:checkpoint", "automation:authorize", "automation:result"], workflows: ["WF-04"], ttlSeconds: 300 }, "");
    expect(issued.status).toBe(200); machineToken = issued.body.data.accessToken;
    courseId = (await call("courses", "POST", { code: "CRM-DEMO", name: "DEMO · Tin học văn phòng", goal: "Excel cho công việc", level: "beginner", deliveryModes: ["online"], priceVnd: 600000, status: "active" }, center)).body.data.id;
  }, 60000);
  afterAll(async () => {
    if (process.env.CRM_TEST_EVIDENCE_FILE && crm && store) {
      const requests = (await crm.query("SELECT id,branch_id,actor_id,event_id,context_id,status,result,job_id,payload->>'action' AS action FROM crm_automation_requests ORDER BY created_at,id")).rows;
      const identities = (await crm.query("SELECT id,branch_id,contact_id,source_ref,source_version,version FROM crm_channel_identities ORDER BY id")).rows;
      const merges = (await crm.query("SELECT id,branch_id,source_id,target_id,status,report_hash,job_id,result FROM crm_merge_plans ORDER BY created_at,id")).rows;
      const audit = (await crm.query("SELECT id,action,target_id,branch_id,correlation_id,version FROM crm_audit ORDER BY created_at,id")).rows;
      const outbox = (await crm.query("SELECT id,event->>'type' AS type,status FROM event_outbox ORDER BY created_at,id")).rows;
      const jobs = (await store.pool.query("SELECT id,event_id,workflow_id,workflow_version,status,attempt,correlation_id,input_ref,operation_refs FROM automation_jobs ORDER BY created_at,id")).rows;
      await writeFile(process.env.CRM_TEST_EVIDENCE_FILE, JSON.stringify({ scope: "Synthetic API/PostgreSQL; direct durable-source Bridge ingress, n8n/broker tested separately", observedAt: new Date().toISOString(), observations, requests, identities, merges, audit, outbox, jobs }, null, 2));
    }
    for (const server of servers.reverse()) await new Promise<void>(resolve => server.close(() => resolve()));
    if (servers.length) await (await import("../../catalog/src/db/client.js")).pool.end();
    for (const pool of pools) await pool.end();
    if (admin) { for (const name of names) { if (!/^crm_test_[a-f0-9]{32}_(identity|org|catalog|crm|bridge|conversation)$/.test(name)) throw new Error("Unsafe test database"); await admin.query(`DROP DATABASE IF EXISTS ${name}`); } await admin.end(); }
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
  it("plans explicit profile merges and rejects self approval, wrong branch, wrong report and stale source versions", async () => {
    const source = await person(), target = await person(), input = { sourceId: source.id, targetId: target.id, sourceVersion: source.version, targetVersion: target.version, resolutions: { fullName: "TARGET", phone: "TARGET" } };
    const key = randomUUID(), planned = await call("crm/merge-plans", "POST", input, center, gateway, key);
    expect(planned.status, JSON.stringify(planned.body)).toBe(201);
    expect(planned.body.data.report).toMatchObject({ unresolved: [], blockers: [], consentPolicy: "REQUIRE_NEW_CONSENT_AFTER_MERGE" });
    expect((await call("crm/merge-plans", "POST", input, center, gateway, key)).body.data.id).toBe(planned.body.data.id);
    const id = planned.body.data.id, approval = { reportHash: planned.body.data.reportHash, evidenceRef: "DEMO-VERIFIED-SAME-PERSON" };
    expect((await call(`crm/merge-plans/${id}/approve`, "POST", approval, center)).status).toBe(403);
    expect((await call(`crm/merge-plans/${id}`, "GET", undefined, outsider)).status).toBe(403);
    expect((await call(`crm/merge-plans/${id}/approve`, "POST", { ...approval, reportHash: "0".repeat(64) }, director)).body.error.code).toBe("STALE_APPROVAL");
    const personInput = { branchId: a, kind: source.kind, fullName: "DEMO Changed after merge plan", phone: source.phone, email: "", notes: "" };
    expect((await call(`crm/people/${source.id}`, "PUT", { version: source.version, input: personInput })).status).toBe(200);
    expect((await call(`crm/merge-plans/${id}/approve`, "POST", approval, director)).body.error.code).toBe("STALE_VERSION");
    const foreign = await person("CONTACT", { branchId: b }, outsider);
    expect((await call("crm/merge-plans", "POST", { ...input, sourceId: foreign.id }, center, gateway, randomUUID())).body.error.code).toBe("MERGE_SCOPE");
    expect((await crm.query("SELECT merged_into FROM crm_people WHERE id=ANY($1::uuid[])", [[source.id, target.id]])).rows.every(r => r.merged_into === null)).toBe(true);
  });
  it("reports merge collisions without dropping a lead and accepts independent exact approval", async () => {
    const source = await person(), target = await person(); await consent(source.id); await consent(target.id);
    await lead(source.id); await lead(target.id);
    const input = { sourceId: source.id, targetId: target.id, sourceVersion: 1, targetVersion: 1, resolutions: { fullName: "TARGET", phone: "TARGET" } };
    const planned = await call("crm/merge-plans", "POST", input, center, gateway, randomUUID());
    expect(planned.status).toBe(201); expect(planned.body.data.report.blockers).toEqual(["LEAD_COLLISION"]);
    expect((await call(`crm/merge-plans/${planned.body.data.id}/approve`, "POST", { reportHash: planned.body.data.reportHash, evidenceRef: "DEMO-SAME-PERSON" }, director)).body.error.code).toBe("MERGE_CONFLICT");
    const otherSource = await person(), otherTarget = await person();
    const clean = await call("crm/merge-plans", "POST", { ...input, sourceId: otherSource.id, targetId: otherTarget.id }, center, gateway, randomUUID());
    expect((await call(`crm/merge-plans/${clean.body.data.id}/approve`, "POST", { reportHash: clean.body.data.reportHash, evidenceRef: "DEMO-SAME-PERSON" }, director)).status).toBe(200);
    const rows = (await crm.query("SELECT status,actor_id,approver_id FROM crm_merge_plans WHERE id=$1", [clean.body.data.id])).rows[0];
    expect(rows.status).toBe("APPROVED"); expect(rows.actor_id).not.toBe(rows.approver_id);
    await expect(crm.query("UPDATE crm_merge_plans SET report='{}'::jsonb WHERE id=$1", [clean.body.data.id])).rejects.toThrow("append only");
  });
  it("requires current separate contact/learner/payer authority and never permits a payer to become the learner", async () => {
    const contact = await person(), learner = await person("LEARNER", { phone: "" }), payer = await person("PAYER");
    await consent(contact.id);
    const query = `crm/enrollment-authority?contactId=${contact.id}&learnerId=${learner.id}&payerId=${payer.id}`;
    expect((await call(query)).body.error.code).toBe("RELATIONSHIP_UNVERIFIED");
    for (const fromPersonId of [contact.id, payer.id]) {
      const link = await call("crm/relationships", "POST", { fromPersonId, learnerId: learner.id, kind: "OTHER" }, staff, gateway, randomUUID());
      expect((await call(`crm/relationships/${link.body.data.id}/decision`, "POST", { version: 1, status: "VERIFIED", evidenceRef: "DEMO-REPRESENTATIVE-PROOF" }, director)).status).toBe(200);
    }
    expect((await call(query)).body.data).toMatchObject({ contactId: contact.id, learnerId: learner.id, payerId: payer.id, branchId: a });
    expect((await call(`crm/enrollment-authority?contactId=${contact.id}&learnerId=${payer.id}&payerId=${payer.id}`)).body.error.code).toBe("INVALID_PERSON_KIND");
    await consent(contact.id, "REVOKED");
    expect((await call(query)).body.error.code).toBe("CONSENT_REQUIRED");
    expect((await call(query, "GET", undefined, outsider)).status).toBe(403);
  });
  it("resolves verified web identities exactly once without merging another contact sharing its phone", async () => {
    const existing = await person(), guest = await internal("/api/v1/chat/session", { consent: true }, "", chat);
    expect(guest.status).toBe(201);
    const prepared = await command({ action: "resolve-channel", conversationId: guest.body.data.conversationId, contact: { fullName: "DEMO Chat contact", phone: existing.phone }, createLead: true, consent: { purpose: "ADMISSIONS", status: "GRANTED", statementVersion: "DEMO-WEB-v1", statementText: "DEMO admissions only", method: "WEB_FORM" } });
    const path = `/internal/crm/requests/${prepared.requestId}/execute`;
    expect((await internal(path, { actorId: staffId }, prepared.token, direct)).status).toBe(400);
    const results = await Promise.all([internal(path, {}, prepared.token, direct), internal(path, {}, prepared.token, direct)]);
    expect(results.map(r => r.status)).toEqual([200, 200]); expect(results[0].body.data).toEqual(results[1].body.data);
    const result = results[0].body.data.result;
    expect(result.contactId).not.toBe(existing.id); expect(results[0].body.data.status).toBe("DONE");
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_channel_identities WHERE contact_id=$1", [result.contactId])).rows[0].n).toBe(1);
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [result.contactId])).rows[0].n).toBe(1);
    expect((await crm.query("SELECT purpose FROM crm_consents WHERE person_id=$1", [result.contactId])).rows).toEqual([{ purpose: "ADMISSIONS" }]);
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_audit WHERE target_id=$1 AND action='crm.channel.resolved'", [result.contactId])).rows[0].n).toBe(1);
    await finish(prepared.job);
    expect((await internal(path, {}, prepared.token, direct)).status).toBe(409);
    const lookup = await call(`crm/automation-requests/${prepared.requestId}`); expect(lookup.body.data.result).toEqual(result);
  });
  it("keeps partial identity results and resumes only after current admissions consent without duplicate audit or lead", async () => {
    const guest = await internal("/api/v1/chat/session", { consent: true }, "", chat);
    const prepared = await command({ action: "resolve-channel", conversationId: guest.body.data.conversationId, contact: { fullName: "DEMO No admissions consent", phone: "+84903334444" }, createLead: true });
    const path = `/internal/crm/requests/${prepared.requestId}/execute`, first = await internal(path, {}, prepared.token, direct);
    expect(first.status).toBe(200); expect(first.body.data.status).toBe("PARTIAL"); expect(first.body.data.result.errorCode).toBe("CONSENT_REQUIRED");
    const contactId = first.body.data.result.contactId;
    expect((await internal(path, {}, prepared.token, direct)).body.data).toEqual(first.body.data);
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_audit WHERE target_id=$1 AND action='crm.request.partial'", [prepared.requestId])).rows[0].n).toBe(1);
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [contactId])).rows[0].n).toBe(0);
    await consent(contactId);
    const resumed = await internal(path, {}, prepared.token, direct);
    expect(resumed.status).toBe(200); expect(resumed.body.data.status).toBe("DONE"); expect(resumed.body.data.result.contactId).toBe(contactId);
    expect(resumed.body.data.result.leadId).toBeTruthy();
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_channel_identities WHERE contact_id=$1", [contactId])).rows[0].n).toBe(1);
    await finish(prepared.job);
  });
  it("rechecks revoked channel session and admissions consent before machine writes", async () => {
    const guest = await internal("/api/v1/chat/session", { consent: true }, "", chat);
    const prepared = await command({ action: "resolve-channel", conversationId: guest.body.data.conversationId, contact: { fullName: "DEMO Revoked guest", phone: "+84901112222" }, createLead: false });
    expect((await internal("/api/v1/chat/revoke", {}, guest.body.data.token, chat)).status).toBe(200);
    expect((await internal(`/internal/crm/requests/${prepared.requestId}/execute`, {}, prepared.token, direct)).status).toBe(403);
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_channel_identities WHERE source_ref=$1", [guest.body.data.conversationId])).rows[0].n).toBe(0);
    await finish(prepared.job, "DEAD");
    const contact = await person(); await consent(contact.id);
    const leadRequest = await command({ action: "lead.create", lead: { branchId: a, contactId: contact.id, source: "PHONE" } });
    await consent(contact.id, "REVOKED");
    const denied = await internal(`/internal/crm/requests/${leadRequest.requestId}/execute`, {}, leadRequest.token, direct);
    expect(denied.body.error.code).toBe("CONSENT_REQUIRED");
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [contact.id])).rows[0].n).toBe(0);
    await finish(leadRequest.job, "DEAD");
  });
  it("fences concurrent CRM machine claims and keeps a stale edit from replacing notes", async () => {
    const contact = await person(); await consent(contact.id);
    const created = await lead(contact.id, { ownerId: null }, center), id = created.body.data.id;
    const first = await command({ action: "lead.claim", leadId: id, version: 1 }, staff), secondClaim = await command({ action: "lead.claim", leadId: id, version: 1 }, second);
    const prepared = [first, secondClaim];
    const claims = await Promise.all(prepared.map(p => internal(`/internal/crm/requests/${p.requestId}/execute`, {}, p.token, direct)));
    expect(claims.map(r => r.status).sort()).toEqual([200, 409]);
    for (let i = 0; i < prepared.length; i++) await finish(prepared[i].job, claims[i].status === 200 ? "DONE" : "DEAD");
    const record = (await call(`crm/leads/${id}`)).body.data, winner = record.ownerId === staffId ? staff : second;
    const stale = await command({ action: "lead.update", leadId: id, update: { version: record.version, stage: "CONTACTED", ownerId: record.ownerId, notes: "stale notes" } }, winner);
    expect((await call(`crm/leads/${id}`, "PUT", { version: record.version, stage: "CONTACTED", ownerId: record.ownerId, notes: "latest notes" }, winner)).status).toBe(200);
    expect((await internal(`/internal/crm/requests/${stale.requestId}/execute`, {}, stale.token, direct)).body.error.code).toBe("STALE_VERSION");
    expect((await call(`crm/leads/${id}`)).body.data.notes).toBe("latest notes");
    await finish(stale.job, "DEAD");
  });
  it("executes only one of two approved merges sharing a source and preserves lineage, consent and one result", async () => {
    const source = await person(), targets = [await person(), await person()], prepared: Awaited<ReturnType<typeof command>>[] = [];
    for (const target of targets) {
      const planned = await call("crm/merge-plans", "POST", { sourceId: source.id, targetId: target.id, sourceVersion: 1, targetVersion: 1, resolutions: { fullName: "TARGET", phone: "TARGET" } }, center, gateway, randomUUID());
      expect(planned.status).toBe(201);
      const { id, reportHash } = planned.body.data;
      expect((await call(`crm/merge-plans/${id}/approve`, "POST", { reportHash, evidenceRef: "DEMO-INDEPENDENT-IDENTITY-VERIFICATION" }, director)).status).toBe(200);
      prepared.push(await command({ action: "merge.execute", planId: id, reportHash }, center));
    }
    const results = await Promise.all(prepared.map(p => internal(`/internal/crm/requests/${p.requestId}/execute`, {}, p.token, direct)));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const result = results.find(r => r.status === 200)!.body.data.result;
    const original = (await crm.query("SELECT merged_into,phone,full_name FROM crm_people WHERE id=$1", [source.id])).rows[0];
    expect(original).toMatchObject({ merged_into: result.targetId, phone: source.phone, full_name: source.fullName });
    expect((await crm.query("SELECT purpose,status FROM crm_consents WHERE person_id=$1 ORDER BY purpose", [result.targetId])).rows).toEqual(["ADMISSIONS", "COURSE_NOTICES", "MARKETING"].map(purpose => ({ purpose, status: "REVOKED" })));
    expect((await crm.query("SELECT count(*)::int AS n FROM crm_audit WHERE action='crm.people.merged' AND target_id=ANY($1::uuid[])", [targets.map(r => r.id)])).rows[0].n).toBe(1);
    const winnerIndex = results[0].status === 200 ? 0 : 1;
    expect((await internal(`/internal/crm/requests/${prepared[winnerIndex].requestId}/execute`, {}, prepared[winnerIndex].token, direct)).body.data.result).toEqual(result);
    for (let i = 0; i < prepared.length; i++) await finish(prepared[i].job, results[i].status === 200 ? "DONE" : "DEAD");
  });
  it("rejects a merge when the independent approver session is revoked after token issuance", async () => {
    const source = await person(), target = await person();
    const planned = await call("crm/merge-plans", "POST", { sourceId: source.id, targetId: target.id, sourceVersion: 1, targetVersion: 1, resolutions: { fullName: "TARGET", phone: "TARGET" } }, center, gateway, randomUUID());
    const { id, reportHash } = planned.body.data;
    expect((await call(`crm/merge-plans/${id}/approve`, "POST", { reportHash, evidenceRef: "DEMO-INDEPENDENT-IDENTITY-VERIFICATION" }, director)).status).toBe(200);
    const prepared = await command({ action: "merge.execute", planId: id, reportHash }, center);
    expect((await fetch(`${auth.identityUrl}/api/v1/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: directorRefresh }) })).status).toBe(204);
    expect((await internal(`/internal/crm/requests/${prepared.requestId}/execute`, {}, prepared.token, direct)).status).toBe(403);
    expect((await crm.query("SELECT merged_into FROM crm_people WHERE id=$1", [source.id])).rows[0].merged_into).toBeNull();
    expect((await crm.query("SELECT status FROM crm_merge_plans WHERE id=$1", [id])).rows[0].status).toBe("APPROVED");
    await finish(prepared.job, "DEAD");
  });
});
