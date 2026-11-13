// Focused Class service checks: upstream authority responses are synthetic inputs, not end-to-end acceptance.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import pg from "pg";
import { createApp, HttpError } from "@spacex/http";
import { messagingSchema } from "@spacex/messaging";
import { createClassApp } from "../dist/app.js";

if (!process.env.CLASS_SEAT_TEST_DATABASE_URL || !process.env.CLASS_SEAT_TEST_REPORT)
  throw new Error("Dedicated empty CLASS_SEAT_TEST_DATABASE_URL and private CLASS_SEAT_TEST_REPORT required");
const pool = new pg.Pool({ connectionString: process.env.CLASS_SEAT_TEST_DATABASE_URL });
const report = { scope: "Class/PostgreSQL with labelled synthetic upstream authority inputs", startedAt: new Date().toISOString(), status: "FAIL", checks: [] };
const sources = new Map(), matches = new Map(), tokens = new Map(), servers = [];
const branchId = randomUUID(), courseId = randomUUID(), packageId = randomUUID(), actorId = randomUUID();
const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
async function listen(app) {
  const server = app.listen(0, "127.0.0.1"); servers.push(server); await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
function tokenFor(id, operation = "classes.enroll", extra = {}) {
  const token = randomUUID();
  const audience = operation === "classes.enroll" ? "class-schedule" : operation === "payment.execute" ? "payment" : "enrollment";
  tokens.set(token, { calls: 0, audience, scope: operation === "classes.enroll" ? "classes:enroll" : `${audience}:write`,
    user: { sub: actorId, sid: randomUUID(), role: "admissions", branchIds: [branchId], exp: Math.floor(Date.now() / 1000) + 300,
      delegation: { branchId, jobId: randomUUID(), operation, inputRef: randomUUID(), entity: { type: "enrollment", id }, ...extra } } });
  return token;
}
async function newClass(status = "OPEN", capacity = 1) {
  const id = randomUUID();
  await pool.query(`INSERT INTO classes(id,code,name,course_id,package_id,branch_id,teacher_id,mode,online_url,capacity,minimum_size,registration_closes_at,decision_at,status,session_count)
    VALUES($1,$2,'DEMO seat authority',$3,$4,$5,$6,'online','https://example.test/demo',$7,0,clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',$8,1)`,
  [id, id, courseId, packageId, branchId, randomUUID(), capacity, status]);
  await pool.query("INSERT INTO sessions(id,class_id,starts_at,ends_at) VALUES($1,$2,clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour')", [randomUUID(), id]);
  return id;
}
function enrollment(classId) {
  const id = randomUUID();
  sources.set(id, { id, branchId, classId, classVersion: 1, packageId, learnerId: randomUUID(), state: "PENDING_HOLD", quoteCurrent: true, quote: { packageId, courseId } });
  return { id, token: tokenFor(id), source: sources.get(id) };
}
let base;
async function call(e, action, body = {}, token = e.token) {
  const response = await fetch(`${base}/internal/classes/enrollments/${e.id}${action ? `/${action}` : ""}`, {
    method: action === undefined || action?.endsWith("-authority") ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: action === undefined || action?.endsWith("-authority") ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
function matched(e, eligible = true, late = false) {
  const matchRef = randomUUID();
  matches.set(matchRef, { id: matchRef, enrollmentId: e.id, eligible, late });
  Object.assign(e.source, { state: "CONFIRMING", matchRef });
  return matchRef;
}
async function counts(id) {
  return (await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='COMMITTED')::int AS committed,
    count(*) FILTER(WHERE status='HELD' AND expires_at>clock_timestamp())::int AS held FROM holds WHERE class_id=$1`, [id])).rows[0];
}
try {
  assert.equal((await pool.query("SELECT to_regclass('classes') AS existing")).rows[0].existing, null, "Fresh dedicated DB required");
  await pool.query("BEGIN");
  for (const migration of ["0001", "0002_teacher_time", "0003_messaging", "0004_lifecycle", "0005_automation", "0006_enrollment"])
    await pool.query(migration === "0003_messaging" ? messagingSchema : await readFile(new URL(`../migrations/${migration}.sql`, import.meta.url), "utf8"));
  await pool.query("COMMIT");
  const authority = await listen(createApp("synthetic-seat-input", app => {
    app.post("/internal/iam/commands/introspect", (req, res) => {
      const t = tokens.get(req.get("authorization")?.replace(/^Bearer /, ""));
      if (!t || ++t.calls >= (t.revokeAt ?? Infinity)) throw new HttpError(403, "REVOKED", "Synthetic revoked authority");
      if (req.body.audience !== t.audience || req.body.scope !== t.scope) throw new HttpError(403, "WRONG_SCOPE", "Synthetic wrong scope");
      res.json({ data: t.user });
    });
    app.get("/internal/enrollment/enrollments/:id/seat-authority", (req, res) => {
      const data = sources.get(req.params.id);
      if (!data) throw new HttpError(404, "NOT_FOUND", "Synthetic source missing");
      data.reads = (data.reads ?? 0) + 1;
      if (data.cancelAt === data.reads) data.state = "CANCELLED";
      res.json({ data });
    });
    app.get("/internal/payment/matches/:id/seat-authority", (req, res) => {
      const data = matches.get(req.params.id);
      if (!data) throw new HttpError(404, "NOT_FOUND", "Synthetic match missing");
      res.json({ data });
    });
  }));
  base = await listen(createClassApp(pool, { secret: "class-seat-tests-unused-human-secret-32bytes", issuer: "class-seat", audience: "class-seat", identityUrl: authority },
    { orgUrl: authority, catalogUrl: authority, demo: false, ttlSeconds: 1200, enrollmentUrl: authority, paymentUrl: authority }));

  const closed = enrollment(await newClass("PLANNED"));
  assert.equal((await call(closed, "hold")).status, 409);
  const changed = enrollment(await newClass()); changed.source.quoteCurrent = false;
  assert.equal((await call(changed, "hold")).body.error.code, "QUOTE_CHANGED");
  assert.equal((await counts(changed.source.classId)).total, 0);
  const staleClass = enrollment(await newClass()); staleClass.source.classVersion = 2;
  assert.equal((await call(staleClass, "hold")).body.error.code, "CLASS_CHANGED");
  assert.equal((await counts(staleClass.source.classId)).total, 0);
  check("Class not OPEN, stale class version and changed quote create no hold or QR authority");

  const last = await newClass(), a = enrollment(last), b = enrollment(last);
  const race = await Promise.all([call(a, "hold"), call(b, "hold")]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  const winner = race[0].status === 200 ? a : b;
  const original = race.find(r => r.status === 200).body.data;
  assert.deepEqual((await call(winner, "hold")).body.data, original);
  assert.deepEqual(await counts(last), { total: 1, committed: 0, held: 1 });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM class_audit WHERE target_id=$1 AND action='hold.created'", [original.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM event_outbox WHERE event->'payload'->>'targetId'=$1 AND event->>'type'='hold.created'", [original.id])).rows[0].n, 1);
  check("Concurrent last-seat holds and duplicate request have one durable hold/audit/outbox");

  let ref = matched(winner, false);
  assert.equal((await call(winner, "commit", { matchRef: ref })).status, 403);
  assert.equal((await counts(last)).committed, 0);
  ref = matched(winner);
  const committed = await call(winner, "commit", { matchRef: ref }); assert.equal(committed.status, 200);
  assert.equal(committed.body.data.id, original.id); assert.equal(committed.body.data.status, "COMMITTED");
  assert.deepEqual((await call(winner, "commit", { matchRef: ref })).body, committed.body);
  assert.equal((await call(winner, "commit", { matchRef: randomUUID() })).body.error.code, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(await counts(last), { total: 1, committed: 1, held: 0 });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM class_audit WHERE target_id=$1 AND action='hold.committed'", [original.id])).rows[0].n, 1);
  const enToken = tokenFor(winner.id, "enrollment.execute");
  assert.equal((await call(winner, "enrollment-authority", {}, enToken)).body.data.committed, true);
  assert.equal((await call(winner, "enrollment-authority")).status, 403);
  assert.equal((await call(winner, "payment-authority", {}, tokenFor(winner.id, "payment.execute"))).body.data.committed, true);
  assert.equal((await call(winner, "payment-authority", {}, enToken)).status, 403);
  check("Verified match commits once; lost-response replay, payload conflict and Enrollment readback preserve one effect");

  const expired = enrollment(await newClass());
  const expiredHold = (await call(expired, "hold")).body.data;
  await pool.query("UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expiredHold.id]);
  assert.equal((await call(expired)).body.data.hold.status, "EXPIRED");
  ref = matched(expired);
  assert.equal((await call(expired, "commit", { matchRef: ref })).status, 409);
  matches.get(ref).late = true;
  const lateCommit = await call(expired, "commit", { matchRef: ref });
  assert.equal(lateCommit.status, 200); assert.equal(lateCommit.body.data.id, expiredHold.id);
  assert.deepEqual(await counts(expired.source.classId), { total: 1, committed: 1, held: 0 });
  check("Expiry blocks commit without worker; eligible late payment atomically reuses the original seat record");

  const full = await newClass(), late = enrollment(full), other = enrollment(full);
  await call(late, "hold");
  await pool.query("UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE enrollment_id=$1", [late.id]);
  assert.equal((await call(other, "hold")).status, 200);
  ref = matched(late, true, true);
  assert.equal((await call(late, "commit", { matchRef: ref })).body.error.code, "SOLD_OUT");
  assert.deepEqual(await counts(full), { total: 2, committed: 0, held: 1 });
  check("Late payment cannot oversell a seat taken after expiry");

  const cancelled = enrollment(await newClass()); cancelled.source.cancelAt = 3;
  assert.equal((await call(cancelled, "hold")).body.error.code, "ENROLLMENT_CHANGED");
  assert.equal((await counts(cancelled.source.classId)).total, 0);
  const revoked = enrollment(await newClass()); tokens.get(revoked.token).revokeAt = 3;
  assert.equal((await call(revoked, "hold")).status, 403);
  assert.equal((await counts(revoked.source.classId)).total, 0);
  check("Cancellation or revocation after resource lock rolls back seat/result/audit/outbox");

  const isolated = enrollment(await newClass());
  assert.equal((await call(isolated, "hold", {}, tokenFor(randomUUID()))).status, 403);
  assert.equal((await call(isolated, "hold", { actorId })).status, 400);
  assert.equal((await call(isolated, "hold", {}, tokenFor(isolated.id, "classes.enroll", { branchId: randomUUID() }))).status, 403);
  const teacher = tokenFor(isolated.id); tokens.get(teacher).user.role = "teacher";
  assert.equal((await call(isolated, "hold", {}, teacher)).status, 403);
  const unscopedService = tokenFor(isolated.id); tokens.get(unscopedService).user.role = "ai_agent";
  assert.equal((await call(isolated, "hold", {}, unscopedService)).status, 403);
  assert.equal((await counts(isolated.source.classId)).total, 0);
  check("Forged payload, cross-customer, cross-branch, teacher and unscoped service effects are rejected");

  const cancelRace = enrollment(await newClass());
  await call(cancelRace, "hold"); ref = matched(cancelRace); cancelRace.source.releaseAuthorized = true;
  const results = await Promise.all([call(cancelRace, "commit", { matchRef: ref }), call(cancelRace, "release", {}, tokenFor(cancelRace.id))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await counts(cancelRace.source.classId)).total, 1);
  assert((await counts(cancelRace.source.classId)).committed <= 1);
  check("Commit versus release serializes on the class and never creates a second seat");

  report.status = "PASS";
  report.outcomes = (await pool.query("SELECT action,count(*)::int AS n FROM class_enrollment_operations GROUP BY action ORDER BY action")).rows;
  report.seats = (await pool.query("SELECT status,count(*)::int AS n FROM holds GROUP BY status ORDER BY status")).rows;
  report.operationIds = (await pool.query("SELECT operation_key,enrollment_id,action FROM class_enrollment_operations ORDER BY created_at")).rows;
} catch (error) {
  report.error = { name: error.name, message: error.message };
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(process.env.CLASS_SEAT_TEST_REPORT, JSON.stringify(report, null, 2));
  for (const server of servers.reverse()) await new Promise(resolve => server.close(resolve));
  await pool.end();
}
