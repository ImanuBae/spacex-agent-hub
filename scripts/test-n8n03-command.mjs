import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { connectBroker, dispatchOutbox } from "@spacex/messaging";
import { withAcceptanceRuntime } from "./n8n04-runtime.mjs";
import { parseN8nOutput } from "./n8n-output.mjs";

const evidence = { ticket: "N8N-03", scope: "synthetic-local-class-cancellation", tests: [], providerRequests: 0 };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await withAcceptanceRuntime(async h => {
  for (const file of ["packages/contracts/src/machine.ts", "packages/auth/src/index.ts", "services/identity/src/machine.ts", "services/class-schedule/src/app.ts", "services/class-schedule/src/migrate.ts", "services/class-schedule/migrations/0005_automation.sql", "scripts/test-n8n03-command.mjs", "scripts/n8n04-runtime.mjs", "scripts/build-iam-command-workflow.mjs", "workflows/n8n/iam-command-smoke.json", "workflows/n8n/iam-command-manifest.json"]) evidence.artifacts[file] = sha(await readFile(file));
  const db = new pg.Pool({ connectionString: h.domainUrls["class-schedule"] }), iam = new pg.Pool({ connectionString: h.identityDb });
  const broker = await connectBroker(h.runtime.RABBITMQ_URL);
  const branch = randomUUID(), otherBranch = randomUUID();
  const call = async (port, route, token, body, expected = 200, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result.data;
  };
  const api = (route, token, body, expected, port = h.classesPort) => call(port, route, token, body, expected);
  const worker = await h.iamCall("/internal/iam/principals", { id: "chat-worker", workflows: ["WF-CLASS-CANCEL"], grants: [{ audience: "automation-bridge", scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize"] }, { audience: "class-schedule", scopes: ["classes:cancel"] }] }, h.operator.accessToken);
  const machine = (await h.iamCall("/internal/iam/machine/token", { clientId: worker.id, clientSecret: worker.clientSecret, audience: "automation-bridge", scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize"], workflows: ["WF-CLASS-CANCEL"] })).accessToken;
  async function actor(label, branches = [branch]) {
    const id = randomUUID(), email = `${label}-${id}@automation.test`;
    // Copy only a generated test password hash, then use the real login API for each actor/session.
    await iam.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) SELECT $1,$2,$3,password_hash,'branch_director',$4 FROM accounts WHERE id=$5", [id, email, `DEMO ${label}`, branches, h.operator.user.id]);
    // The generated admin password stays in the runtime harness; expose it only to its login callback.
    const session = await h.loginFixture(email);
    return { id, token: session.accessToken, sid: JSON.parse(Buffer.from(session.accessToken.split(".")[1], "base64url")).sid };
  }
  try {
    const owner = await actor("confirming"), approver = await actor("approving"), foreign = await actor("foreign", [otherBranch]);
    async function prepare({ approve = true, committed = false } = {}) {
      const classId = randomUUID(), payload = { version: 1, status: "CANCELLED", reason: "DEMO — hủy lớp theo xác nhận và phê duyệt riêng" };
      await db.query("INSERT INTO classes(id,code,name,course_id,package_id,branch_id,mode,capacity,minimum_size,registration_closes_at,decision_at,status,session_count) VALUES($1,$2,'DEMO cancellation',$3,$4,$5,'online',10,0,clock_timestamp()+interval '10 days',clock_timestamp()+interval '11 days','OPEN',1)", [classId, classId, randomUUID(), randomUUID(), branch]);
      await db.query("INSERT INTO sessions(id,class_id,starts_at,ends_at) VALUES($1,$2,clock_timestamp()+interval '12 days',clock_timestamp()+interval '12 days 1 hour')", [randomUUID(), classId]);
      if (committed) await db.query("INSERT INTO holds(id,class_id,package_id,learner_id,enrollment_id,actor_id,status,expires_at,operation_key,request_payload) SELECT $1,id,package_id,$2,$3,$4,'COMMITTED',clock_timestamp()+interval '1 day',$5,'{}' FROM classes WHERE id=$6", [randomUUID(), randomUUID(), randomUUID(), owner.id, randomUUID(), classId]);
      const request = await api(`/api/v1/classes/${classId}/cancellation-requests`, owner.token, payload, 201);
      if (approve) await api(`/api/v1/class-cancellation-requests/${request.id}/approve`, approver.token, {});
      return { id: request.id, classId, payload };
    }
    async function claim(record) {
      await dispatchOutbox(db, event => broker.publish(event));
      for (let i = 0; ; i++) { const job = (await h.pool.query("SELECT id FROM automation_jobs WHERE input_ref=$1", [record.id])).rows[0]; if (job) break; assert(i < 100, "Approved source event did not reach Bridge"); await new Promise(r => setTimeout(r, 100)); }
      const job = await call(h.bridgePort, "/internal/automation/jobs/claim", machine, { workflowId: "WF-CLASS-CANCEL", workflowVersion: 1 });
      assert.equal(job.inputRef, record.id);
      const fence = { leaseToken: job.leaseToken, attempt: job.attempt, operation: "classes.cancel" };
      const checkpoint = await call(h.bridgePort, `/internal/automation/jobs/${job.jobId}/checkpoint`, machine, { leaseToken: job.leaseToken, attempt: job.attempt, expectedVersion: job.version, step: "cancel", operation: { name: "classes.cancel" } });
      const authorization = await call(h.bridgePort, `/internal/automation/jobs/${job.jobId}/authorize`, machine, fence);
      return { ...record, job, checkpoint, fence, token: authorization.accessToken };
    }
    const execute = (r, expected = 200, payload = r.payload, port) => api(`/internal/classes/cancellations/${r.id}/execute`, r.token, payload, expected, port);
    async function finish(r, outcome = "DEAD") {
      await call(h.bridgePort, `/internal/automation/jobs/${r.job.jobId}/result`, machine, { leaseToken: r.job.leaseToken, attempt: r.job.attempt, expectedVersion: r.checkpoint.version, step: "cancel", outcome, ...(outcome === "DEAD" ? { errorCode: "COMMAND_DENIED" } : {}) });
    }
    async function check(name, work) { await work(); evidence.tests.push({ name, status: "PASS" }); console.log(`PASS ${name}`); }
    async function unchanged(r) {
      const row = (await db.query("SELECT status,version FROM classes WHERE id=$1", [r.classId])).rows[0]; assert.deepEqual(row, { status: "OPEN", version: 1 });
      assert.equal(Number((await db.query("SELECT count(*) FROM class_audit WHERE action='class.cancelled' AND target_id=$1", [r.classId])).rows[0].count), 0);
      assert.equal((await db.query("SELECT consumed_at FROM class_cancellation_requests WHERE id=$1", [r.id])).rows[0].consumed_at, null);
    }
    await check("source confirmation, separate approval, no self-approval or cross-branch approval", async () => {
      const r = await prepare({ approve: false });
      await api(`/api/v1/class-cancellation-requests/${r.id}/approve`, owner.token, {}, 403);
      await api(`/api/v1/class-cancellation-requests/${r.id}/approve`, foreign.token, {}, 403);
      await unchanged(r);
      await api(`/api/v1/class-cancellation-requests/${r.id}/revoke`, owner.token, {});
    });
    await check("raw machine cannot execute; command requires an explicit checkpoint intent", async () => {
      const r = await prepare();
      await api(`/internal/classes/cancellations/${r.id}/execute`, machine, r.payload, 401);
      await dispatchOutbox(db, event => broker.publish(event));
      let job;
      for (let i = 0; ; i++) { job = await call(h.bridgePort, "/internal/automation/jobs/claim", machine, { workflowId: "WF-CLASS-CANCEL", workflowVersion: 1 }); if (job) break; assert(i < 100); await new Promise(r => setTimeout(r, 100)); }
      await call(h.bridgePort, `/internal/automation/jobs/${job.jobId}/authorize`, machine, { leaseToken: job.leaseToken, attempt: job.attempt, operation: "classes.cancel" }, 403);
      await call(h.bridgePort, `/internal/automation/jobs/${job.jobId}/result`, machine, { leaseToken: job.leaseToken, attempt: job.attempt, expectedVersion: job.version, step: "cancel", outcome: "DEAD", errorCode: "COMMAND_DENIED" });
      await unchanged(r);
    });
    await check("concurrent execution consumes once with one state change/audit/outbox; lookup and replay", async () => {
      const r = await claim(await prepare());
      const results = await Promise.all([execute(r), execute(r)]); assert(results.every(v => v.status === "CANCELLED" && v.version === 2));
      const lookup = await api(`/internal/classes/cancellations/${r.id}`, r.token); assert(lookup.consumedAt); assert.equal(lookup.result.id, r.classId);
      const counts = (await db.query("SELECT (SELECT count(*) FROM class_audit WHERE action='class.cancelled' AND target_id=$1::uuid)::int AS audit,(SELECT count(*) FROM event_outbox WHERE event->>'type'='class.cancelled' AND event->'payload'->>'targetId'=$1::text)::int AS outbox,(SELECT count(*) FROM class_status_changes WHERE class_id=$1::uuid)::int AS transitions", [r.classId])).rows[0];
      assert.deepEqual(counts, { audit: 1, outbox: 1, transitions: 1 });
      await finish(r, "DONE"); await execute(r, 409);
      evidence.effect = { classId: r.classId, requestId: r.id, jobId: r.job.jobId, counts, operationLookup: true, concurrentResults: 2 };
    });
    for (const [name, mutate, expected] of [
      ["changed payload", async r => { r.payload.reason += " tampered"; }, 403],
      ["expired confirmation", r => db.query("UPDATE class_cancellation_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [r.id]), 409],
      ["revoked confirmation", r => api(`/api/v1/class-cancellation-requests/${r.id}/revoke`, owner.token, {}), 409],
      ["missing approval", r => db.query("UPDATE class_cancellation_requests SET approver_id=NULL,approver_session_id=NULL WHERE id=$1", [r.id]), 409],
      ["stale resource version", r => db.query("UPDATE classes SET version=2 WHERE id=$1", [r.classId]), 409],
      ["different resource", r => h.pool.query("UPDATE automation_jobs SET entity=jsonb_set(entity,'{id}',to_jsonb($2::text)) WHERE id=$1", [r.job.jobId, randomUUID()]), 403],
      ["different source branch", r => db.query("UPDATE class_cancellation_requests SET branch_id=$2 WHERE id=$1", [r.id, otherBranch]), 403],
      ["different workflow version", r => h.pool.query("UPDATE automation_jobs SET workflow_version=2 WHERE id=$1", [r.job.jobId]), 403],
      ["expired lease", r => h.pool.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [r.job.jobId]), 409],
      ["old attempt", r => h.pool.query("UPDATE automation_jobs SET attempt=attempt+1 WHERE id=$1", [r.job.jobId]), 409],
    ]) await check(name, async () => {
      const r = await claim(await prepare()); await mutate(r); await execute(r, expected);
      if (name === "stale resource version") await db.query("UPDATE classes SET version=1 WHERE id=$1", [r.classId]);
      await unchanged(r);
      if (["different resource", "different workflow version", "expired lease", "old attempt"].includes(name)) await h.pool.query("UPDATE automation_jobs SET status='DEAD',lease_token=NULL,lease_expires_at=NULL WHERE id=$1", [r.job.jobId]);
      else await finish(r);
    });
    await check("committed-seat business invariant rolls back consumption and effects", async () => { const r = await claim(await prepare({ committed: true })); await execute(r, 409); await unchanged(r); await finish(r); });
    await check("approver live session revocation blocks command", async () => { const r = await claim(await prepare()); await iam.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [approver.sid]); await execute(r, 403); await unchanged(r); await finish(r); await iam.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [approver.sid]); });
    await check("actor live branch removal blocks issued token", async () => { const r = await claim(await prepare()); await iam.query("UPDATE accounts SET branch_ids='{}' WHERE id=$1", [owner.id]); await execute(r, 403); await unchanged(r); await finish(r); await iam.query("UPDATE accounts SET branch_ids=$2 WHERE id=$1", [owner.id, [branch]]); });
    await check("revocation during resource lock wait is checked again before commit", async () => {
      const r = await claim(await prepare()), lock = await db.connect(); let pending;
      try {
        await lock.query("BEGIN"); await lock.query("SELECT id FROM classes WHERE id=$1 FOR UPDATE", [r.classId]);
        pending = execute(r, 403);
        for (let i = 0; ; i++) { if ((await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM classes WHERE id=%'")).rowCount) break; assert(i < 50, "Execution did not wait for the resource lock"); await new Promise(r => setTimeout(r, 20)); }
        await iam.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [owner.sid]);
        await lock.query("COMMIT"); await pending;
        await unchanged(r); await finish(r);
      } finally { await lock.query("ROLLBACK"); lock.release(); await iam.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [owner.sid]); }
    });
    await check("IAM dependency unavailable cannot consume or mutate", async () => {
      const port = await h.freePort(); await h.startService("class-schedule", { DATABASE_URL: h.domainUrls["class-schedule"], PORT: String(port), IDENTITY_URL: "http://127.0.0.1:1", RABBITMQ_URL: "" });
      const r = await claim(await prepare()); await execute(r, 503, r.payload, port); await unchanged(r); await finish(r);
    });
    await check("real n8n source event -> claim -> intent -> IAM -> source/execute/lookup -> DONE", async () => {
      const r = await prepare(); await dispatchOutbox(db, event => broker.publish(event));
      for (let i = 0; ; i++) { if ((await h.pool.query("SELECT id FROM automation_jobs WHERE input_ref=$1", [r.id])).rowCount) break; assert(i < 100); await new Promise(r => setTimeout(r, 100)); }
      const canonicalFile = "workflows/n8n/iam-command-smoke.json", source = await readFile(canonicalFile), workflow = JSON.parse(source), original = structuredClone(workflow);
      for (const node of workflow[0].nodes) if (node.parameters.url) for (const [from, to] of [[4002, h.iamPort], [4006, h.bridgePort], [4004, h.classesPort]]) node.parameters.url = node.parameters.url.replaceAll(`:${from}/`, `:${to}/`);
      for (const node of workflow[0].nodes) if (node.parameters.url) node.parameters.url = node.parameters.url.replaceAll("http://host.docker.internal:", `http://${h.backendHost}:`);
      Object.assign(workflow[0].settings, { saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true });
      const credentials = [{ id: "N8N03CancelMachine", name: "N8N03-cancel-machine", type: "httpCustomAuth", data: { json: JSON.stringify({ body: { clientId: worker.id, clientSecret: worker.clientSecret } }) } }];
      h.compose("exec", "-T", "n8n", "mkdir", "-p", "/home/node/.n8n/smoke");
      for (const [kind, value] of [["credentials", credentials], ["workflow", workflow]]) { const file = path.join(h.directory, `command-${kind}-private.json`); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); h.compose("cp", file, "n8n:/home/node/.n8n/smoke/command.json"); h.cli(`import:${kind}`, "--input=/home/node/.n8n/smoke/command.json"); }
      const output = h.cli("execute", "--id=N8N03CommandSmoke", "--rawOutput");
      const trace = path.join(h.directory, "command-execution-private.json"); await writeFile(trace, output, { mode: 0o600 });
      const result = parseN8nOutput(output).data.resultData; assert.equal(result.error, undefined);
      const done = result.runData.Result[0].data.main[0][0].json.data; assert.equal(done.status, "DONE");
      const lookup = await api(`/api/v1/class-cancellation-requests/${r.id}`, owner.token); assert.equal(lookup.result.status, "CANCELLED");
      assert.deepEqual(workflow[0].connections, original[0].connections); assert.equal(workflow[0].active, false);
      evidence.n8n = { canonicalFile, canonicalSha256: sha(source), fixtureSha256: sha(JSON.stringify(workflow)), trace, traceSha256: sha(output), executionId: h.sql("SELECT id::text FROM execution_entity WHERE \"workflowId\"='N8N03CommandSmoke' ORDER BY id::bigint DESC LIMIT 1"), jobId: done.jobId, requestId: r.id, operationLookup: true, activated: false };
    });
    evidence.summary = { passed: evidence.tests.length, failed: 0, skipped: 0 };
    for (const [file, expected] of Object.entries(evidence.artifacts)) assert.equal(sha(await readFile(file)), expected, file);
  } finally { await broker.close(); await db.end(); await iam.end(); }
}, evidence, [{ eventType: "class.cancellation_approved", workflowId: "WF-CLASS-CANCEL", workflowVersion: 1, inputSchemaVersion: 1 }]);
console.log(JSON.stringify({ status: evidence.status, summary: evidence.summary, project: evidence.project }));
