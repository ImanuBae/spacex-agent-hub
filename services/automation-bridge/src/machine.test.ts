import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair, importPKCS8, SignJWT, decodeJwt } from "jose";
import pg from "pg";
import { type AutomationJob } from "@spacex/contracts";
import { createIdentityApp } from "../../identity/src/app.js";
import { hashPassword } from "../../identity/src/password.js";
import { createClassApp } from "../../class-schedule/src/app.js";
import { createGatewayApp } from "../../gateway/src/app.js";
import { BridgeStore } from "./store.js";

for (const name of ["AUTOMATION_TEST_DATABASE_URL", "AUTOMATION_TEST_IDENTITY_URL", "AUTOMATION_TEST_CATALOG_URL", "AUTOMATION_TEST_CLASSES_URL", "AUTOMATION_TEST_RUNTIME_ENV", "AUTOMATION_TEST_PRIVATE_KEY_FILE", "AUTOMATION_TEST_RECEIPT"])
  if (!process.env[name]) throw new Error(`${name} required; N8N-03 tests must not skip`);
const bridge = new pg.Pool({ connectionString: process.env.AUTOMATION_TEST_DATABASE_URL });
const iam = new pg.Pool({ connectionString: process.env.AUTOMATION_TEST_IDENTITY_URL });
const catalog = new pg.Pool({ connectionString: process.env.AUTOMATION_TEST_CATALOG_URL });
const classes = new pg.Pool({ connectionString: process.env.AUTOMATION_TEST_CLASSES_URL });
const binding = { eventType: "automation.read.requested", workflowId: "read-smoke", workflowVersion: 1, inputSchemaVersion: 1 as const };
const store = new BridgeStore(bridge, [binding]), servers: Server[] = [];
const auth = { secret: "n8n03-synthetic-user-secret-at-least-32-bytes", issuer: "n8n03-test", audience: "n8n03-human", identityUrl: "" };
const branchA = randomUUID(), branchB = randomUUID(), password = "n8n03-synthetic-password-only";
const courseA = randomUUID(), courseB = randomUUID(), packageA = randomUUID(), packageB = randomUUID();
const ownClass = randomUUID(), otherClass = randomUUID(), crossClass = randomUUID();
const scopes = ["automation:claim", "automation:checkpoint", "automation:result", "automation:read", "automation:authorize"];
const grants = [{ audience: "automation-bridge", scopes }, { audience: "catalog", scopes: ["catalog:read"] }, { audience: "class-schedule", scopes: ["classes:read"] }];
let worker: string, workerSecret: string, admin: string, staff: string, teacher: string, staffRefresh: string;
let staffId: string, teacherId: string, direct: string, catalogUrl: string, classesUrl: string, gateway: string;
let runtime: ChildProcess;
let privateKey: Awaited<ReturnType<typeof importPKCS8>>;
const revocations: { kind: string; milliseconds: number; status: number }[] = [];
async function listen(app: ReturnType<typeof createIdentityApp>) {
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(r => server.once("listening", r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function call(base: string, path: string, token = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
const iamCall = (path: string, token = "", body?: unknown) => call(auth.identityUrl, path, token, body);
const jobCall = (job: AutomationJob, action: string, body: unknown, token = worker) => call(direct, `/internal/automation/jobs/${job.jobId}/${action}`, token, body);
const fence = (job: AutomationJob) => ({ leaseToken: job.leaseToken!, attempt: job.attempt, expectedVersion: job.version, step: "read" });
const command = (job: AutomationJob, operation = "catalog.read") => ({ leaseToken: job.leaseToken!, attempt: job.attempt, operation });
async function login(role: string) { return (await iamCall("/api/v1/auth/login", "", { email: `${role}@n8n03.test`, password })).body.data; }
async function token(id = "read-worker", secret = workerSecret, extra: object = {}) {
  return iamCall("/internal/iam/machine/token", "", { clientId: id, clientSecret: secret, audience: "automation-bridge", scopes, workflows: [binding.workflowId], ...extra });
}
async function createJob(user = staff, extra: object = {}, eventExtra: object = {}) {
  const eventId = randomUUID(), entity = { type: "read-request", id: randomUUID() }, inputRef = `read:${randomUUID()}`;
  const context = await iamCall("/internal/iam/delegations", user, { eventId, entity, inputRef, workflowId: binding.workflowId, workflowVersion: 1, branchId: branchA, operations: ["catalog.read", "classes.read"], ...extra });
  expect(context.status).toBe(201);
  await store.ingest({ id: eventId, type: binding.eventType, version: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(), entityId: (eventExtra as { entity?: { id: string } }).entity?.id ?? entity.id,
    payload: { entity, inputRef, contextRef: context.body.data.contextRef, ...eventExtra } });
  const response = await call(direct, "/internal/automation/jobs/claim", worker, { workflowId: binding.workflowId, workflowVersion: 1 });
  expect(response.status).toBe(200); expect(response.body.data).toBeTruthy(); return response.body.data as AutomationJob;
}
async function authorize(job: AutomationJob, operation = "catalog.read") {
  const checkpoint = await jobCall(job, "checkpoint", { ...fence(job), operation: { name: operation } });
  expect(checkpoint.status).toBe(200);
  const response = await jobCall(checkpoint.body.data, "authorize", command(job, operation));
  expect(response.status).toBe(200); return response.body.data.accessToken as string;
}
async function measured(kind: string, revoke: () => Promise<unknown>, probe: () => Promise<{ status: number }>) {
  await revoke(); const start = performance.now(), result = await probe();
  expect([401, 403, 409]).toContain(result.status);
  revocations.push({ kind, milliseconds: Math.round((performance.now() - start) * 100) / 100, status: result.status });
}

describe("N8N-03 IAM machine authority and delegated real Catalog/Class reads", () => {
  beforeAll(async () => {
    const runtimeEnv = JSON.parse(await readFile(process.env.AUTOMATION_TEST_RUNTIME_ENV!, "utf8"));
    direct = `http://127.0.0.1:${runtimeEnv.PORT}`;
    const pem = await readFile(process.env.AUTOMATION_TEST_PRIVATE_KEY_FILE!, "utf8"); privateKey = await importPKCS8(pem, "RS256");
    auth.identityUrl = await listen(createIdentityApp(iam, auth, "http://127.0.0.1:1", { privateKey: pem, issuer: runtimeEnv.AUTOMATION_MACHINE_ISSUER, bridgeUrl: direct }));
    const hash = await hashPassword(password);
    for (const role of ["center_director", "admissions", "teacher"]) {
      const id = randomUUID();
      await iam.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,'N8N03 synthetic fixture',$3,$4,$5)", [id, `${role}@n8n03.test`, hash, role, role === "center_director" ? [] : [branchA]]);
      if (role === "admissions") staffId = id; if (role === "teacher") teacherId = id;
    }
    admin = (await login("center_director")).accessToken;
    const session = await login("admissions"); staff = session.accessToken; staffRefresh = session.refreshToken;
    teacher = (await login("teacher")).accessToken;
    const created = await iamCall("/internal/iam/principals", admin, { id: "read-worker", workflows: [binding.workflowId], grants });
    expect(created.status).toBe(201); workerSecret = created.body.data.clientSecret; worker = (await token()).body.data.accessToken;
    runtime = spawn(process.execPath, ["dist/index.js"], { cwd: new URL("../", import.meta.url), env: { ...process.env, ...runtimeEnv,
      AUTH_SECRET: auth.secret, AUTH_ISSUER: auth.issuer, AUTH_AUDIENCE: auth.audience, IDENTITY_URL: auth.identityUrl,
      AUTOMATION_BINDINGS: JSON.stringify([binding]), AUTOMATION_MACHINE_SUBJECTS: JSON.stringify({ "read-worker": [binding.workflowId], "limited-worker": [binding.workflowId] }),
    }, stdio: "ignore", windowsHide: true });
    const end = Date.now() + 15000;
    while (true) { try { if ((await fetch(`${direct}/ready`)).ok) break; } catch { /* process starting */ }
      if (Date.now() > end) throw new Error("Bridge not ready"); await new Promise(r => setTimeout(r, 50)); }
    process.env.DATABASE_URL = process.env.AUTOMATION_TEST_CATALOG_URL;
    const { createApp } = await import("../../catalog/src/app.js"), { registerCatalogRoutes } = await import("../../catalog/src/routes.js");
    catalogUrl = await listen(createApp("catalog", app => registerCatalogRoutes(app, auth)));
    classesUrl = await listen(createClassApp(classes, auth, { orgUrl: "http://127.0.0.1:1", catalogUrl, demo: false, ttlSeconds: 1200 }));
    gateway = await listen(createGatewayApp(auth, { catalog: catalogUrl, classes: classesUrl, org: "http://127.0.0.1:1" }));
    for (const [id, pkg, branch] of [[courseA, packageA, branchA], [courseB, packageB, branchB]]) {
      await catalog.query("INSERT INTO courses(id,code,name,goal,level,delivery_modes,branch_ids,price_vnd,status) VALUES($1::uuid,$1::text,'N8N03 synthetic course','Read acceptance','beginner',ARRAY['online'],$2,100000,'active')", [id, [branch]]);
      await catalog.query("INSERT INTO course_packages(id,course_id,code,name,session_count,price_vnd,status) VALUES($1::uuid,$2,$1::text,'N8N03 synthetic package',1,100000,'active')", [pkg, id]);
    }
    for (const [id, branch, account] of [[ownClass, branchA, teacherId], [otherClass, branchA, randomUUID()], [crossClass, branchB, teacherId]])
      await classes.query("INSERT INTO classes(id,code,name,course_id,package_id,branch_id,teacher_account_id,mode,online_url,capacity,minimum_size,registration_closes_at,decision_at,status,session_count) VALUES($1::uuid,$1::text,'N8N03 synthetic class',$2,$3,$4,$5,'online','https://example.test/n8n03',10,1,now()+interval '10 days',now()+interval '11 days','OPEN',1)", [id, courseA, packageA, branch, account]);
  }, 30000);
  afterEach(async () => {
    await bridge.query("UPDATE automation_jobs SET status='DONE',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE workflow_id=$1 AND status='RUNNING'", [binding.workflowId]);
  });
  afterAll(async () => {
    if (runtime && runtime.exitCode === null) await new Promise<void>(r => { runtime.once("exit", () => r()); runtime.kill("SIGKILL"); });
    for (const server of servers.reverse()) await new Promise<void>(r => server.close(() => r()));
    if (catalogUrl) { const { pool } = await import("../../catalog/src/db/client.js"); await pool.end(); }
    await Promise.all([bridge.end(), iam.end(), catalog.end(), classes.end()]);
    await writeFile(process.env.AUTOMATION_TEST_RECEIPT!, JSON.stringify({ branchA, branchB, courseA, packageA, ownClass, revocations,
      mechanism: "No authorization cache; next request rechecks IAM DB and Bridge DB. In-flight reads are not cancelled." }, null, 2));
  });
  it("IAM issues real bounded tokens; correct job/audience/scope reads Catalog and Class", async () => {
    const job = await createJob(), catalogToken = await authorize(job);
    const claims = decodeJwt(catalogToken); expect(claims.aud).toBe("catalog"); expect(Number(claims.exp) - Number(claims.iat)).toBe(30);
    const courses = await call(catalogUrl, "/api/v1/courses", catalogToken); expect(courses.status).toBe(200); expect(courses.body.data.map((r: { id: string }) => r.id)).toEqual([courseA]);
    expect((await call(catalogUrl, "/api/v1/packages", catalogToken)).body.data.map((r: { id: string }) => r.id)).toEqual([packageA]);
    expect((await call(catalogUrl, `/api/v1/packages/${packageA}/quote`, catalogToken)).body.data.priceVnd).toBe(100000);
    expect((await call(catalogUrl, "/api/v1/courses", catalogToken, {}, "POST")).status).toBe(403);
    expect((await call(catalogUrl, `/api/v1/courses/${courseA}/history`, catalogToken)).status).toBe(403);
    const current = await store.row(bridge, job.jobId), classToken = await authorize({ ...job, version: current.version }, "classes.read");
    const rows = await call(classesUrl, "/api/v1/classes", classToken); expect(rows.status).toBe(200); expect(rows.body.data).toHaveLength(2); expect(rows.body.data.every((r: { branchId: string }) => r.branchId === branchA)).toBe(true);
    expect((await call(classesUrl, "/api/v1/holds", classToken, {})).status).toBe(403);
    expect((await call(classesUrl, "/api/v1/classes?sellable=true", classToken)).status).toBe(403);
  });
  it("rejects signature/audience/scope/expiry, raw domain token and scope escalation", async () => {
    const job = await createJob(), accessToken = await authorize(job), claims = decodeJwt(accessToken);
    expect((await call(classesUrl, "/api/v1/classes", accessToken)).status).toBe(401);
    const wrongKey = (await generateKeyPair("RS256")).privateKey;
    const forged = await new SignJWT({ ...claims }).setProtectedHeader({ alg: "RS256" }).sign(wrongKey);
    expect((await call(catalogUrl, "/api/v1/courses", forged)).status).toBe(401);
    const expired = await new SignJWT({ ...claims, iat: Math.floor(Date.now()/1000)-31, exp: Math.floor(Date.now()/1000)-1 }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    expect((await call(catalogUrl, "/api/v1/courses", expired)).status).toBe(401);
    const wrongScope = await new SignJWT({ ...claims, scope: "classes:read" }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    expect((await call(catalogUrl, "/api/v1/courses", wrongScope)).status).toBe(403);
    for (const extra of [{ audience: "catalog", scopes: ["catalog:read"] }, { workflows: ["wf-other"] }, { scopes: ["catalog:write"] }, { ttlSeconds: 301 }, { actorId: "director" }])
      expect([400, 403]).toContain((await token("read-worker", workerSecret, extra)).status);
    expect((await call(catalogUrl, "/api/v1/courses", worker)).status).toBe(401);
    const short = (await token("read-worker", workerSecret, { ttlSeconds: 1 })).body.data.accessToken;
    await new Promise(r => setTimeout(r, 1100));
    expect((await call(direct, "/internal/automation/jobs/claim", short, { workflowId: binding.workflowId, workflowVersion: 1 })).status).toBe(401);
  });
  it("accepts one-second issuance jitter while keeping absolute expiry and future-iat limits", async () => {
    const job = await createJob(), commandToken = await authorize(job);
    const mint = (token: string, offset: number, lifetime: number) => {
      const iat = Math.floor(Date.now() / 1000) + offset;
      return new SignJWT({ ...decodeJwt(token), iat, exp: iat + lifetime }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    };
    const route = `/internal/automation/jobs/${job.jobId}`;
    expect((await call(direct, route, await mint(worker, 1, 60))).status).toBe(200);
    expect((await call(catalogUrl, "/api/v1/courses", await mint(commandToken, 1, 30))).status).toBe(200);
    expect((await call(direct, route, await mint(worker, 5, 60))).status).toBe(401);
    expect((await call(catalogUrl, "/api/v1/courses", await mint(commandToken, 5, 30))).status).toBe(401);
    expect((await call(direct, route, await mint(worker, -30, 30))).status).toBe(401);
    expect((await call(catalogUrl, "/api/v1/courses", await mint(commandToken, -30, 30))).status).toBe(401);
  });
  it("rejects self-declared actor/role/branch/context and uncheckpointed operations", async () => {
    expect((await iamCall("/internal/iam/delegations", worker, {})).status).toBe(401);
    expect((await iamCall("/internal/iam/delegations", staff, { eventId: randomUUID(), entity: { type: "read", id: "test" }, inputRef: "test", workflowId: binding.workflowId, workflowVersion: 1, branchId: branchB, operations: ["catalog.read"] })).status).toBe(403);
    const job = await createJob();
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
    for (const extra of [{ actorId: "director" }, { role: "center_director" }, { branchId: branchB }, { contextRef: randomUUID() }])
      expect((await jobCall(job, "authorize", { ...command(job), ...extra })).status).toBe(400);
    const accessToken = await authorize(job);
    for (const query of [`branchId=${branchB}`, "actorId=director", "role=center_director", `contextRef=${randomUUID()}`])
      expect((await call(catalogUrl, `/api/v1/courses?${query}`, accessToken)).status).toBe(403);
    expect((await call(catalogUrl, `/api/v1/packages/${packageB}/quote`, accessToken)).status).toBe(403);
    expect((await call(catalogUrl, "/api/v1/courses?status=draft", accessToken)).status).toBe(403);
  });
  it("binds immutable context to event, workflow version, entity and input refs", async () => {
    for (const extra of [{ contextRef: randomUUID() }, { inputRef: "forged:input" }, { entity: { type: "read-request", id: "forged" } }]) {
      const job = await createJob(staff, {}, extra);
      const cp = await jobCall(job, "checkpoint", { ...fence(job), operation: { name: "catalog.read" } }); expect(cp.status).toBe(200);
      expect([400, 403]).toContain((await jobCall(job, "authorize", command(job))).status);
      await jobCall(cp.body.data, "result", { ...fence(cp.body.data), outcome: "DONE" });
    }
    const job = await createJob(staff, { workflowVersion: 2 });
    const cp = await jobCall(job, "checkpoint", { ...fence(job), operation: { name: "catalog.read" } }); expect(cp.status).toBe(200);
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
  });
  it("checks current branch/teacher ownership in Class and restricts director delegation to one branch", async () => {
    const job = await createJob(teacher), accessToken = await authorize(job, "classes.read");
    const result = await call(classesUrl, "/api/v1/classes", accessToken); expect(result.status).toBe(200); expect(result.body.data.map((r: { id: string }) => r.id)).toEqual([ownClass]);
    for (const id of [otherClass, crossClass]) expect((await call(classesUrl, `/api/v1/classes/${id}`, accessToken)).status).toBe(403);
    await classes.query("UPDATE classes SET teacher_account_id=$2 WHERE id=$1", [ownClass, randomUUID()]);
    expect((await call(classesUrl, `/api/v1/classes/${ownClass}`, accessToken)).status).toBe(403);
    await classes.query("UPDATE classes SET teacher_account_id=$2 WHERE id=$1", [ownClass, teacherId]);
    const directorJob = await createJob(admin), directorToken = await authorize(directorJob, "classes.read");
    expect((await call(classesUrl, `/api/v1/classes/${crossClass}`, directorToken)).status).toBe(403);
  });
  it("fences authorization issuance and consumption after expiry, reclaim and completion", async () => {
    const job = await createJob(), accessToken = await authorize(job);
    await bridge.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.jobId]);
    expect((await jobCall(job, "authorize", command(job))).status).toBe(409);
    expect((await call(catalogUrl, "/api/v1/courses", accessToken)).status).toBe(409);
    await store.maintain(); await bridge.query("UPDATE automation_jobs SET next_attempt_at=clock_timestamp() WHERE id=$1", [job.jobId]);
    const next = (await call(direct, "/internal/automation/jobs/claim", worker, { workflowId: binding.workflowId, workflowVersion: 1 })).body.data as AutomationJob;
    expect(next.attempt).toBe(job.attempt+1); expect((await jobCall(job, "authorize", command(job))).status).toBe(409);
    expect((await call(catalogUrl, "/api/v1/courses", accessToken)).status).toBe(409);
    const currentToken = await authorize(next), row = await store.row(bridge, next.jobId);
    expect((await jobCall(next, "result", { ...fence({ ...next, version: row.version }), outcome: "DONE" })).status).toBe(200);
    expect((await call(catalogUrl, "/api/v1/courses", currentToken)).status).toBe(409);
  });
  it("enforces machine grants and rotates credentials without retaining old tokens", async () => {
    const created = await iamCall("/internal/iam/principals", admin, { id: "limited-worker", workflows: [binding.workflowId], grants: [{ audience: "automation-bridge", scopes: ["automation:read"] }] });
    expect(created.status).toBe(201);
    expect((await token("limited-worker", created.body.data.clientSecret)).status).toBe(403);
    const job = await createJob(), accessToken = await authorize(job), oldSecret = workerSecret;
    await measured("machine credential rotation", async () => {
      const rotated = await iamCall("/internal/iam/principals/read-worker/rotate", admin, {}); expect(rotated.status).toBe(200); workerSecret = rotated.body.data.clientSecret;
    }, () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await token("read-worker", oldSecret)).status).toBe(401);
    worker = (await token()).body.data.accessToken;
    expect((await jobCall(job, "authorize", command(job))).status).toBe(200);
  });
  it("fails closed if IAM or the configured lease authority is unavailable", async () => {
    const job = await createJob(), accessToken = await authorize(job);
    const unavailableIam = await listen(createClassApp(classes, { ...auth, identityUrl: "http://127.0.0.1:1" }, { orgUrl: "http://127.0.0.1:1", catalogUrl, demo: false, ttlSeconds: 1200 }));
    expect((await call(unavailableIam, "/api/v1/classes", accessToken)).status).toBe(503);
    const unavailableBridge = await listen(createIdentityApp(iam, auth, "http://127.0.0.1:1", { privateKey: await readFile(process.env.AUTOMATION_TEST_PRIVATE_KEY_FILE!, "utf8"), issuer: "automation-test-authority", bridgeUrl: "http://127.0.0.1:1" }));
    expect((await call(unavailableBridge, "/internal/iam/commands/token", worker, { jobId: job.jobId, ...command(job) })).status).toBe(503);
  });
  it("revokes context, account permission and initiating session on the next request", async () => {
    let job = await createJob(), accessToken = await authorize(job);
    await measured("delegation revocation", async () => expect((await iamCall(`/internal/iam/delegations/${job.contextRef}/revoke`, staff, {})).status).toBe(200), () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
    await jobCall(job, "result", { ...fence({ ...job, version: (await store.row(bridge, job.jobId)).version }), outcome: "DONE" });
    job = await createJob(); accessToken = await authorize(job);
    await measured("account permission removal", async () => {
      // The existing access API revokes sessions; direct DB removal additionally proves live branch checks.
      await iam.query("UPDATE accounts SET branch_ids='{}' WHERE id=$1", [staffId]);
    }, () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
    await iam.query("UPDATE accounts SET branch_ids=$2 WHERE id=$1", [staffId, [branchA]]);
    await measured("initiator session logout", async () => expect((await iamCall("/api/v1/auth/logout", "", { refreshToken: staffRefresh })).status).toBe(204), () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
    const session = await login("admissions"); staff = session.accessToken; staffRefresh = session.refreshToken;
  });
  it("honors existing IAM access/status administration revocation without an Org bypass", async () => {
    let job = await createJob(), accessToken = await authorize(job);
    await measured("existing IAM access-change API", async () => {
      const response = await fetch(`${auth.identityUrl}/api/v1/accounts/${staffId}/access`, { method: "PUT", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ role: "center_director", branchIds: [] }) });
      expect(response.status).toBe(200);
    }, () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
    await iam.query("UPDATE accounts SET role='admissions',branch_ids=$2 WHERE id=$1", [staffId, [branchA]]);
    let session = await login("admissions"); staff = session.accessToken; staffRefresh = session.refreshToken;
    await jobCall(job, "result", { ...fence({ ...job, version: (await store.row(bridge, job.jobId)).version }), outcome: "DONE" });
    job = await createJob(); accessToken = await authorize(job);
    await measured("existing IAM account-disable API", async () => expect((await call(auth.identityUrl, `/api/v1/accounts/${staffId}/status`, admin, { active: false }, "PUT")).status).toBe(200), () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await call(auth.identityUrl, `/api/v1/accounts/${staffId}/status`, admin, { active: true }, "PUT")).status).toBe(200);
    expect((await jobCall(job, "authorize", command(job))).status).toBe(403);
    session = await login("admissions"); staff = session.accessToken; staffRefresh = session.refreshToken;
  });
  it("rejects inactive principals immediately for Bridge, minting and already-issued domain tokens", async () => {
    const job = await createJob(), accessToken = await authorize(job);
    await measured("machine principal revocation", async () => expect((await iamCall("/internal/iam/principals/read-worker/revoke", admin, {})).status).toBe(200), () => call(catalogUrl, "/api/v1/courses", accessToken));
    expect((await jobCall(job, "authorize", command(job))).status).toBe(401);
    expect((await token()).status).toBe(401);
  });
  it("keeps missing approvals, business writes, unconfigured authority and public internal routes closed", async () => {
    for (const path of ["/internal/iam/machine/token", "/internal/iam/principals", "/internal/automation/jobs/claim", "/api/v1/automation/jobs/claim"])
      expect((await call(gateway, path, admin, {})).status).toBe(404);
    const unconfigured = await listen(createIdentityApp(iam, auth, "http://127.0.0.1:1"));
    expect((await call(unconfigured, "/internal/iam/machine/token", "", {})).status).toBe(503);
    expect((await iamCall("/internal/iam/delegations", admin, { eventId: randomUUID(), workflowId: binding.workflowId, workflowVersion: 1, entity: { type: "read", id: "test" }, inputRef: "test", branchId: branchA, operations: ["enrollment.create"], approvalRef: "fake" })).status).toBe(400);
  });
});
