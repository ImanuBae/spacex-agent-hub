import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { importPKCS8, SignJWT } from "jose";
import { connectBroker } from "@spacex/messaging";
import { type AutomationJob, type EventEnvelope } from "@spacex/contracts";
import { createIdentityApp } from "../../identity/src/app.js";
import { hashPassword } from "../../identity/src/password.js";
import { createGatewayApp } from "../../gateway/src/app.js";
import { BridgeStore, consumer } from "./store.js";
import { createBridgeApp } from "./app.js";

for (const key of ["AUTOMATION_TEST_DATABASE_URL", "AUTOMATION_TEST_IDENTITY_URL", "RABBITMQ_TEST_URL", "AUTOMATION_TEST_RUNTIME_ENV", "AUTOMATION_TEST_PRIVATE_KEY_FILE"])
  if (!process.env[key]) throw new Error(`${key} required; integration tests must not skip`);
const pool = new pg.Pool({ connectionString: process.env.AUTOMATION_TEST_DATABASE_URL });
const iam = new pg.Pool({ connectionString: process.env.AUTOMATION_TEST_IDENTITY_URL });
const binding = { eventType: "automation.test.requested", workflowId: "bridge-smoke", workflowVersion: 1, inputSchemaVersion: 1 as const };
const store = new BridgeStore(pool, [binding]);
const auth = { secret: "automation-test-only-identity-secret-32-bytes", issuer: "automation-test-identity", audience: "automation-test-services", identityUrl: "" };
let runtime: ChildProcess, runtimeEnv: NodeJS.ProcessEnv, direct: string, gateway: string;
let broker: Awaited<ReturnType<typeof connectBroker>>, key: Awaited<ReturnType<typeof importPKCS8>>;
let workerA: string, workerB: string, center: string, staff: string, centerId: string;
const secrets = new Map<string, string>();
const servers: Server[] = [];
const base = "/internal/automation/jobs";
async function eventually(check: () => Promise<boolean>, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error("Timed out waiting for integration state");
}
async function start() {
  runtime = spawn(process.execPath, ["dist/index.js"], { cwd: new URL("../", import.meta.url), env: runtimeEnv, stdio: "ignore", windowsHide: true });
  await eventually(async () => { try { return (await fetch(`${direct}/ready`)).ok; } catch { return false; } });
  // Publisher confirms would fail before the durable subscription exists.
  await eventually(async () => { try { await broker.publish(event("automation.test.ready")); return true; } catch { return false; } });
}
async function stop() {
  if (!runtime || runtime.exitCode !== null) return;
  await new Promise<void>(resolve => { runtime.once("exit", () => resolve()); runtime.kill("SIGKILL"); });
}
async function listen(app: ReturnType<typeof createIdentityApp>) {
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function event(type = binding.eventType, correlationId = randomUUID(), entityId = randomUUID()): EventEnvelope {
  return { id: randomUUID(), type, version: 1, correlationId, entityId, occurredAt: new Date().toISOString(),
    payload: { entity: { type: "smoke", id: entityId }, contextRef: "smoke:verified-context", inputRef: "smoke:synthetic-input" } };
}
async function machineToken(sub = "worker-a", overrides: Record<string, unknown> = {}, audience = "automation-bridge") {
  if (secrets.has(sub) && !Object.keys(overrides).length && audience === "automation-bridge") {
    const response = await call("/internal/iam/machine/token", { clientId: sub, clientSecret: secrets.get(sub), audience,
      scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:read"], workflows: [binding.workflowId] }, "", auth.identityUrl);
    expect(response.status).toBe(200); return response.body.data.accessToken as string;
  }
  return new SignJWT({ kind: "machine", credentialVersion: 1, scope: "automation:claim automation:checkpoint automation:result automation:read", workflows: [binding.workflowId], ...overrides })
    .setProtectedHeader({ alg: "RS256" }).setSubject(sub).setIssuer("automation-test-authority").setAudience(audience)
    .setJti(randomUUID()).setIssuedAt().setExpirationTime("5m").sign(key);
}
async function call(path: string, body?: unknown, token = workerA, url = direct) {
  const response = await fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const fence = (job: AutomationJob) => ({ leaseToken: job.leaseToken!, attempt: job.attempt, expectedVersion: job.version, step: job.step });
async function claim(token = workerA, workflowVersion = 1): Promise<AutomationJob | null> {
  const r = await call(`${base}/claim`, { workflowId: binding.workflowId, workflowVersion }, token);
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data;
}
async function submit(job: AutomationJob, extra: object, token = workerA) {
  return call(`${base}/${job.jobId}/result`, { ...fence(job), outcome: "DONE", ...extra }, token);
}
async function enqueue(e = event()) {
  await broker.publish(e);
  await eventually(async () => !!(await pool.query("SELECT 1 FROM automation_jobs WHERE event_id=$1", [e.id])).rowCount);
  return e;
}
async function done(job: AutomationJob, token = workerA) { expect((await submit(job, {}, token)).status).toBe(200); }

describe("N8N-02 real PostgreSQL/RabbitMQ/IAM and Bridge process", () => {
  beforeAll(async () => {
    key = await importPKCS8(await readFile(process.env.AUTOMATION_TEST_PRIVATE_KEY_FILE!, "utf8"), "RS256");
    auth.identityUrl = await listen(createIdentityApp(iam, auth, "http://127.0.0.1:1", {
      privateKey: await readFile(process.env.AUTOMATION_TEST_PRIVATE_KEY_FILE!, "utf8"), issuer: "automation-test-authority", bridgeUrl: "http://127.0.0.1:1",
    }));
    gateway = await listen(createGatewayApp(auth, { org: "http://127.0.0.1:1", catalog: "http://127.0.0.1:1" }));
    const tokens: string[] = [], password = "automation-test-password-only", hash = await hashPassword(password);
    for (const role of ["center_director", "admissions"]) {
      const id = randomUUID(); if (role === "center_director") centerId = id;
      await iam.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,'Synthetic operator',$3,$4,$5)", [id, `${role}@automation.test`, hash, role, role === "admissions" ? [randomUUID()] : []]);
      const login = await call("/api/v1/auth/login", { email: `${role}@automation.test`, password }, "", auth.identityUrl);
      expect(login.status).toBe(200); tokens.push(login.body.data.accessToken);
    }
    [center, staff] = tokens;
    for (const id of ["worker-a", "worker-b"]) {
      const created = await call("/internal/iam/principals", { id, workflows: [binding.workflowId], grants: [{ audience: "automation-bridge", scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:read"] }] }, center, auth.identityUrl);
      expect(created.status).toBe(201); secrets.set(id, created.body.data.clientSecret);
    }
    [workerA, workerB] = await Promise.all([machineToken(), machineToken("worker-b")]);
    runtimeEnv = { ...process.env, ...JSON.parse(await readFile(process.env.AUTOMATION_TEST_RUNTIME_ENV!, "utf8")),
      AUTH_SECRET: auth.secret, AUTH_ISSUER: auth.issuer, AUTH_AUDIENCE: auth.audience, IDENTITY_URL: auth.identityUrl };
    direct = `http://127.0.0.1:${runtimeEnv.PORT}`;
    broker = await connectBroker(process.env.RABBITMQ_TEST_URL!, () => undefined);
    await start();
  }, 60000);
  afterAll(async () => {
    await stop(); await broker?.close();
    for (const server of servers.reverse()) await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end(); await iam.end();
  });

  it("deduplicates redelivery and rolls back both inbox/job on failed creation; pins deployed version", async () => {
    const e = event(); await Promise.all([store.ingest(e), store.ingest(e)]);
    await broker.publish(e); await broker.publish(e);
    await eventually(async () => (await pool.query("SELECT status FROM event_inbox WHERE consumer=$1 AND id=$2", [consumer, e.id])).rows[0]?.status === "DONE");
    expect((await pool.query("SELECT * FROM automation_jobs WHERE event_id=$1", [e.id])).rows).toHaveLength(1);
    await new BridgeStore(pool, [{ ...binding, workflowVersion: 2 }]).ingest(e);
    expect((await pool.query("SELECT workflow_version FROM automation_jobs WHERE event_id=$1", [e.id])).rows[0].workflow_version).toBe(1);
    await expect(store.ingest({ ...e, payload: { changed: true } })).rejects.toThrow("different content");
    const invalid = { ...event(), payload: { invalid: true } };
    await expect(store.ingest(invalid)).rejects.toThrow();
    expect((await pool.query("SELECT 1 FROM event_inbox WHERE id=$1", [invalid.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM automation_jobs WHERE event_id=$1", [invalid.id])).rowCount).toBe(0);
    expect(await claim(workerA, 2)).toBeNull();
    await done((await claim())!);
  });
  it("two workers racing one job get exactly one lease; owner and version fence writes", async () => {
    await enqueue();
    const jobs = await Promise.all([claim(workerA), claim(workerB)]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
    const index = jobs.findIndex(Boolean), job = jobs[index]!, token = index === 0 ? workerA : workerB;
    const wrong = index === 0 ? workerB : workerA;
    expect((await call(`${base}/${job.jobId}/checkpoint`, { ...fence(job), operation: { name: "smoke" } }, wrong)).status).toBe(409);
    const cp = await call(`${base}/${job.jobId}/checkpoint`, { ...fence(job), step: "intent", operation: { name: "smoke" } }, token);
    expect(cp.status).toBe(200);
    expect(cp.body.data.operationRefs[0].operationKey).toBe(`automation:${job.jobId}:smoke`);
    expect((await submit(job, {}, token)).status).toBe(409);
    expect((await call(`${base}/${job.jobId}`, undefined, token)).body.data.leaseToken).toBeUndefined();
    await done(cp.body.data, token);
    expect((await submit(cp.body.data, {}, token)).status).toBe(409);
  });
  it("limits active leases to two across concurrent workers", async () => {
    await Promise.all([enqueue(), enqueue(), enqueue()]);
    const jobs = await Promise.all([claim(), claim(workerB), claim()]);
    expect(jobs.filter(Boolean)).toHaveLength(2);
    for (let i = 0; i < jobs.length; i++) if (jobs[i]) await done(jobs[i]!, i === 1 ? workerB : workerA);
    await done((await claim())!);
  });
  it("expired worker cannot checkpoint/result, even before recovery; new attempt rejects old token", async () => {
    await enqueue(); const job = (await claim())!;
    await pool.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.jobId]);
    expect((await call(`${base}/${job.jobId}/checkpoint`, fence(job))).status).toBe(409);
    expect((await submit(job, {})).status).toBe(409);
    await store.maintain();
    const retry = await store.row(pool, job.jobId); expect(retry.status).toBe("RETRY"); expect(retry.failure_count).toBe(1);
    expect(await claim()).toBeNull();
    await pool.query("UPDATE automation_jobs SET next_attempt_at=clock_timestamp() WHERE id=$1", [job.jobId]);
    const next = (await claim())!; expect(next.attempt).toBe(job.attempt + 1);
    expect((await submit(job, {})).status).toBe(409); await done(next);
  });
  it("SIGKILL/restart preserves checkpoint/key and recovers expired lease from durable DB", async () => {
    await enqueue(); const initial = (await claim())!;
    const cp = (await call(`${base}/${initial.jobId}/checkpoint`, { ...fence(initial), step: "intent", operation: { name: "smoke", operationId: "operation:synthetic" } })).body.data as AutomationJob;
    expect((await call(`${base}/${cp.jobId}/checkpoint`, { ...fence(cp), operation: { name: "smoke", operationId: "operation:different" } })).status).toBe(409);
    await stop();
    await pool.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [cp.jobId]);
    await start();
    await eventually(async () => (await store.row(pool, cp.jobId)).status === "RETRY");
    const retained = (await call(`${base}/${cp.jobId}`)).body.data;
    expect(retained.step).toBe("intent"); expect(retained.operationRefs).toEqual(cp.operationRefs);
    await pool.query("UPDATE automation_jobs SET next_attempt_at=clock_timestamp() WHERE id=$1", [cp.jobId]);
    const next = (await claim())!;
    expect(next.jobId).toBe(cp.jobId); expect(next.operationRefs).toEqual(cp.operationRefs); expect(next.attempt).toBe(cp.attempt + 1);
    expect((await submit(cp, {})).status).toBe(409); await done(next);
  });
  it("early durable event wakes WAITING once; wrong entity/correlation cannot wake; deadline survives restart", async () => {
    const e = await enqueue(), job = (await claim())!;
    const early = event("automation.test.approved", e.correlationId, e.entityId);
    await broker.publish(early);
    await eventually(async () => !!(await pool.query("SELECT 1 FROM event_inbox WHERE id=$1 AND status='DONE'", [early.id])).rowCount);
    const wait = { outcome: "WAITING", waitFor: { type: early.type, entityId: e.entityId }, deadlineAt: new Date(Date.now() + 60000).toISOString() };
    const result = await submit(job, wait); expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("PENDING"); expect(result.body.data.wakeEventId).toBe(early.id);
    const resumed = (await claim())!; expect(resumed.failureCount).toBe(0);
    expect((await submit(resumed, wait)).body.data.status).toBe("WAITING");
    await store.ingest(event(early.type, e.correlationId)); await store.ingest(event(early.type, randomUUID(), e.entityId));
    expect((await store.row(pool, job.jobId)).status).toBe("WAITING");
    await stop();
    await pool.query("UPDATE automation_jobs SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.jobId]);
    await start();
    await eventually(async () => (await store.row(pool, job.jobId)).status === "PENDING");
    const timed = (await claim())!; expect(timed.wakeReason).toBe("DEADLINE"); expect(timed.failureCount).toBe(0); await done(timed);
  });
  it("event concurrent with WAITING registration is never lost", async () => {
    const e = await enqueue(), job = (await claim())!, signal = event("automation.test.approved", e.correlationId, e.entityId);
    await Promise.all([broker.publish(signal), submit(job, { outcome: "WAITING", waitFor: { type: signal.type, entityId: e.entityId }, deadlineAt: new Date(Date.now() + 60000).toISOString() })]);
    await eventually(async () => (await store.row(pool, job.jobId)).status === "PENDING");
    expect((await claim())!.wakeEventId).toBe(signal.id);
    const row = await store.row(pool, job.jobId); await done({ ...job, ...{ leaseToken: row.lease_token!, attempt: row.attempt, version: row.version } });
  });
  it("honors Retry-After, caps technical failures at eight, and retains operation keys through retries", async () => {
    await enqueue(); let job = (await claim())!;
    job = (await call(`${base}/${job.jobId}/checkpoint`, { ...fence(job), operation: { name: "smoke" } })).body.data;
    const key = job.operationRefs[0].operationKey;
    for (let failure = 1; failure <= 8; failure++) {
      const result = await submit(job, { outcome: "RETRY", errorCode: "UPSTREAM_UNAVAILABLE", retryAfterSeconds: 120 });
      expect(result.status).toBe(200); expect(result.body.data.failureCount).toBe(failure);
      expect(result.body.data.operationRefs[0].operationKey).toBe(key);
      if (failure === 8) { expect(result.body.data.status).toBe("DEAD"); expect(result.body.data.nextAttemptAt).toBeUndefined(); }
      else {
        expect(Date.parse(result.body.data.nextAttemptAt) - Date.now()).toBeGreaterThan(118000);
        expect(await claim()).toBeNull();
        await pool.query("UPDATE automation_jobs SET next_attempt_at=clock_timestamp() WHERE id=$1", [job.jobId]);
        job = (await claim())!;
      }
    }
    expect(await claim()).toBeNull();
    expect((await pool.query("SELECT 1 FROM automation_audit WHERE job_id=$1 AND action='DEAD'", [job.jobId])).rowCount).toBe(1);
  });
  it("replay uses live IAM role/session, mandatory reason and CAS; preserves ID/version/key with audit", async () => {
    const dead = (await pool.query("SELECT id FROM automation_jobs WHERE status='DEAD'")).rows[0];
    const old = (await call(`${base}/${dead.id}`)).body.data as AutomationJob;
    const path = `/api/v1/automation/jobs/${old.jobId}/replay`, input = { expectedVersion: old.version, reason: "Synthetic operator recovery after verified failure" };
    expect((await call(path, input, "")).status).toBe(401);
    expect((await call(path, input, workerA)).status).toBe(401);
    expect((await call(path, input, staff)).status).toBe(403);
    expect((await call(path, { expectedVersion: old.version }, center)).status).toBe(400);
    await iam.query("UPDATE accounts SET role='admissions' WHERE id=$1", [centerId]);
    expect((await call(path, input, center)).status).toBe(401);
    await iam.query("UPDATE accounts SET role='center_director' WHERE id=$1", [centerId]);
    const result = await call(path, input, center); expect(result.status).toBe(200);
    expect(result.body.data.jobId).toBe(old.jobId); expect(result.body.data.workflowVersion).toBe(old.workflowVersion);
    expect(result.body.data.operationRefs).toEqual(old.operationRefs); expect(result.body.data.attempt).toBe(old.attempt);
    expect((await call(path, input, center)).status).toBe(409);
    const audit = (await pool.query("SELECT * FROM automation_audit WHERE job_id=$1 AND action='REPLAY'", [old.jobId])).rows;
    expect(audit).toHaveLength(1); expect(audit[0].actor_id).toBe(centerId); expect(audit[0].reason).toBe(input.reason);
    const next = (await claim())!; expect(next.attempt).toBe(old.attempt + 1); expect(next.failureCount).toBe(0);
    await done(next);
    await iam.query("UPDATE sessions SET revoked_at=now() WHERE account_id=$1", [centerId]);
    expect((await call(path, { ...input, expectedVersion: next.version }, center)).status).toBe(401);
  });
  it("rejects missing/wrong audience/scope/workflow/expired machine tokens and public Gateway forwarding", async () => {
    const input = { workflowId: binding.workflowId, workflowVersion: 1 };
    for (const token of ["", staff, await machineToken("worker-a", {}, "catalog"), await machineToken("unknown"), await machineToken("constructor")])
      expect([401, 403]).toContain((await call(`${base}/claim`, input, token)).status);
    expect((await call(`${base}/claim`, input, await machineToken("worker-a", { scope: "automation:read" }))).status).toBe(403);
    expect((await call(`${base}/claim`, input, await machineToken("worker-a", { workflows: ["other"] }))).status).toBe(403);
    const long = await new SignJWT({ scope: "automation:claim", workflows: [binding.workflowId] }).setProtectedHeader({ alg: "RS256" })
      .setSubject("worker-a").setIssuer("automation-test-authority").setAudience("automation-bridge").setIssuedAt().setExpirationTime("1h").sign(key);
    expect((await call(`${base}/claim`, input, long)).status).toBe(401);
    const expired = await new SignJWT({ scope: "automation:claim", workflows: [binding.workflowId] }).setProtectedHeader({ alg: "RS256" })
      .setSubject("worker-a").setIssuer("automation-test-authority").setAudience("automation-bridge").setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime("-1s").sign(key);
    expect((await call(`${base}/claim`, input, expired)).status).toBe(401);
    expect((await call(`${base}/claim`, input, workerA, gateway)).status).toBe(404);
    expect((await call("/api/v1/automation/jobs/claim", input, staff, gateway)).status).toBe(404);
    const unconfigured = await listen(createBridgeApp(store, auth));
    expect((await call(`${base}/claim`, input, workerA, unconfigured)).status).toBe(503);
  });
  it("runtime DB role cannot read IAM/n8n DB or create databases", async () => {
    const role = (await pool.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
    expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    await expect(pool.query("SELECT * FROM accounts")).rejects.toThrow();
    await expect(pool.query("CREATE DATABASE automation_forbidden")).rejects.toThrow();
  });
});
