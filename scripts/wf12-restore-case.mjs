/* global performance, URL */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withN8n06Runtime } from "./n8n06-runtime.mjs";
import { parseN8nOutput } from "./n8n-output.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const active = h => Number(h.sql('SELECT count(*) FROM workflow_entity WHERE active OR "activeVersionId" IS NOT NULL'));
const workflowInventory = h => h.sql("SELECT row_to_json(w)::text FROM (SELECT id,name,nodes,connections,settings FROM workflow_entity ORDER BY id) w");
const credentialInventory = h => h.sql("SELECT id FROM credentials_entity ORDER BY id");
const queueList = h => h.compose("exec", "-T", "rabbitmq", "rabbitmqctl", "-q", "list_queues", "name", "messages_ready", "messages_unacknowledged")
  .trim().split(/\r?\n/).filter(line => line.includes("\t") && !line.startsWith("name\t")).map(line => {
    const [name, ready, unacked] = line.split("\t"); return { name, ready:Number(ready), unacked:Number(unacked) };
  }).sort((a,b) => a.name.localeCompare(b.name));
const row = async (pool, sql, value) => (await pool.query(sql, [value])).rows[0];

async function state(h, jobId, ids) {
  const job = await row(h.pool, "SELECT id,event_id,version,status,step,attempt,operation_refs FROM automation_jobs WHERE id=$1", jobId);
  const payment = await row(h.pools.payment, "SELECT a.status,a.receipt_id AS receipt_ref,a.amount_delta::int FROM payment_adjustments a WHERE a.id=$1", ids.adjustmentId);
  const amounts = await row(h.pools.payment, "SELECT count(*)::int AS count,coalesce(sum(amount),0)::int AS amount FROM payment_ledger WHERE payment_id=$1", ids.paymentId);
  const receipts = (await h.pools.payment.query("SELECT id,direction,amount::int FROM synthetic_payment_executions WHERE adjustment_id=$1 ORDER BY id", [ids.adjustmentId])).rows;
  const seats = (await h.pools["class-schedule"].query("SELECT id,class_id,status FROM holds WHERE enrollment_id=$1 ORDER BY id", [ids.enrollmentId])).rows;
  const outbox = Object.fromEntries(await Promise.all(Object.entries(h.pools).map(async ([service, pool]) => {
    if (!(await pool.query("SELECT to_regclass('event_outbox') AS table_name")).rows[0].table_name) return [service, []];
    const result = await pool.query("SELECT status,count(*)::int AS count FROM event_outbox GROUP BY status ORDER BY status");
    return [service, result.rows];
  })));
  const wakeups = (await h.pool.query("SELECT event_id FROM automation_wakeups WHERE job_id=$1 ORDER BY event_id", [jobId])).rows;
  const inbox = await row(h.pool, "SELECT status FROM event_inbox WHERE consumer='automation.bridge.v1' AND id=$1", job.event_id);
  return { job, payment, amounts, receipts, seats, outbox, wakeups, inbox };
}

export async function restoreIncident(source, unknown, ids, queueReplay) {
  const jobId = unknown.jobId, started = performance.now();
  source.compose("stop", "--timeout", "5", "n8n");
  assert.equal(source.compose("ps", "--status", "running", "-q", "n8n").trim(), "");
  const workflowIds = source.sql("SELECT id FROM workflow_entity ORDER BY id").split(/\r?\n/);
  for (const id of workflowIds) {
    assert.match(id, /^N8N06LocalWF(08|09|10)$/);
    source.cli("unpublish:workflow", "--id=" + id);
  }
  assert.equal(active(source), 0);
  await queueReplay();
  for (const child of [...source.services.values()].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    assert(child.kill("SIGTERM"));
    await exited;
  }
  const queues = queueList(source);
  assert(queues.some(queue => queue.name === "spacex.automation.bridge.v1"));
  assert(queues.every(queue => queue.ready === 0 && queue.unacked === 0), "This drill requires a drained broker");
  const before = await state(source, jobId, ids);
  assert.equal(before.job.status, "PENDING");
  assert.equal(before.inbox.status, "DONE");
  assert.equal(before.receipts.length, 1);
  assert(before.seats.length > 0);
  const inventory = workflowInventory(source), credentials = credentialInventory(source);
  assert(workflowIds.length === 3 && credentials.split(/\r?\n/).length === 3);
  const directory = path.join(source.directory, "backup-private");
  await mkdir(directory);
  const hashes = {};
  async function save(file, data) {
    assert(data.length > 0);
    await writeFile(path.join(directory,file), data, { flag:"wx", mode:0o600 });
    hashes[file] = sha(data);
  }
  const dump = (service, role, database) => source.compose("exec", "-T", service, "pg_dump", "-U", role, "-d", database, "--no-owner", "--no-acl", "--format=p");
  await save("broker-topology.json", JSON.stringify(queues));
  await save("n8n.sql", dump("postgres", "n8n_admin", "n8n"));
  for (const [service, url] of Object.entries(source.domainUrls)) {
    const database = new URL(url).pathname.slice(1);
    assert.match(database, /^n8n06_[a-z_]+$/);
    await save(service + ".sql", dump("bridge-db", "automation_test_admin", database));
  }
  const encryptionKey = (await readFile(source.envFile,"utf8")).match(/^N8N_ENCRYPTION_KEY=([a-f0-9]{64})$/m)?.[1];
  assert(encryptionKey, "Synthetic source n8n encryption key missing");
  await save("n8n-encryption-key-private", encryptionKey);
  const operator = JSON.parse(await readFile(path.join(source.directory,"operator-private.json"),"utf8"));
  const serviceOverrides = {};
  const allowlist = {
    conversation: ["CHAT_BRANCH_ID","CHANNEL_CLIENT_ID","CHANNEL_CLIENT_SECRET"],
    enrollment: ["SOURCE_CLIENT_ID","SOURCE_CLIENT_SECRET"],
    payment: ["SOURCE_CLIENT_ID","SOURCE_CLIENT_SECRET","REVIEW_OWNER_ID"],
    notification: ["SOURCE_CLIENT_ID","SOURCE_CLIENT_SECRET","NOTIFICATION_OWNER_ID"],
  };
  const files = await readdir(source.directory);
  for (const [service, keys] of Object.entries(allowlist)) {
    const filesForService = files.filter(name => new RegExp(`^service-${service}-[0-9]+-private\\.json$`).test(name)).sort();
    const config = JSON.parse(await readFile(path.join(source.directory,filesForService.at(-1)),"utf8"));
    serviceOverrides[service] = Object.fromEntries(keys.map(key => { assert(config[key]); return [key, config[key]]; }));
  }
  await save("service-config-private.json", JSON.stringify({ operator, serviceOverrides, bindings:JSON.parse(source.runtime.AUTOMATION_BINDINGS) }));
  for (const file of ["infra/n8n/compose.yml", "infra/automation/compose.test.yml", "infra/n8n/init.sql", "workflows/n8n/adjustment-manifest.json"]) {
    await save(path.basename(file), await readFile(file));
  }
  const graphs = files.filter(file => /^WF-(08|09|10)-binding-\d+-private\.json$/.test(file));
  for (const graph of graphs) await save(graph, await readFile(path.join(source.directory,graph)));
  const backupMs = Math.round(performance.now() - started);

  const targetEvidence = { scope:"WF12_RESTORE_TARGET", providerRequests:0 };
  const restoreStarted = performance.now();
  let proof;
  await withN8n06Runtime(async target => {
    assert.notEqual(target.project, source.project);
    assert.equal(active(target),0);
    assert.equal(workflowInventory(target),inventory);
    assert.equal(credentialInventory(target),credentials);
    assert.deepEqual(await state(target, jobId, ids), before);

    for (const service of ["org","catalog","class-schedule","automation-bridge","crm","conversation","enrollment","payment","notification"]) {
      await target.startService(service, serviceOverrides[service]);
    }
    await target.eventually(() => JSON.stringify(queueList(target)) === JSON.stringify(queues), "Restored drained broker topology");
    const originMap = new Map(Object.keys(source.ports).map(service => [`http://${source.backendHost}:${source.ports[service]}/`, `http://${target.backendHost}:${target.ports[service]}/`]));
    for (const [oldPort, newPort] of Object.keys(source.ports).map(service => [source.ports[service],target.ports[service]])) assert.notEqual(oldPort,newPort);
    const folder = "/home/node/.n8n/wf12-restore";
    target.compose("exec","-T","n8n","mkdir","-p",folder);
    const install = async workflow => {
      const name = workflow.id + ".json";
      assert.match(name, /^\w+\.json$/);
      const file = path.join(target.directory,name);
      await writeFile(file, JSON.stringify([workflow]), { flag:"wx", mode:0o600 });
      target.compose("cp",file,"n8n:" + folder + "/" + name);
      target.cli("import:workflow","--input=" + folder + "/" + name);
    };
    let wf09;
    for (const graph of graphs) {
      const bytes = await readFile(path.join(directory,graph),"utf8");
      assert.equal(sha(bytes),hashes[graph]);
      const [workflow] = JSON.parse(bytes.replace(/http:\/\/[0-9.]+:\d+\//g, origin => originMap.get(origin) ?? origin));
      Object.assign(workflow, { active:false, versionId:randomUUID() });
      assert.equal(workflow.nodes.length, JSON.parse(bytes)[0].nodes.length);
      await install(workflow);
      if (workflow.id === "N8N06LocalWF09") wf09 = workflow;
    }
    assert(wf09, "Restored WF-09 graph missing");
    assert.equal(active(target), 0);
    const tokenProbe = {
      ...wf09, id:"WF12RestoreCredentialProbe", name:"WF-12 restore credential probe", versionId:randomUUID(),
      nodes:wf09.nodes.filter(n => ["Manual","Machine token"].includes(n.name)), connections:{ Manual:wf09.connections.Manual },
      settings:{ ...wf09.settings, saveDataSuccessExecution:"none", saveDataErrorExecution:"none", saveManualExecutions:false },
    };
    await install(tokenProbe);
    const execute = id => parseN8nOutput(target.cli("execute","--id=" + id,"--rawOutput")).data.resultData;
    const probe = execute(tokenProbe.id);
    assert(!probe.error && typeof probe.runData["Machine token"][0].data.main[0][0].json.data?.accessToken === "string", "Restored n8n credential must mint a fresh IAM token");
    const verifiedMs = Math.round(performance.now() - restoreStarted);
    const run = execute(wf09.id);
    assert(!run.error, "Restored WF-09 execution failed");
    assert.equal(run.runData.Job[0].data.main[0][0].json.jobId,jobId);
    const after = await state(target, jobId, ids);
    assert.equal(after.job.status,"DONE");
    assert.equal(after.job.id,before.job.id);
    assert.deepEqual(after.job.operation_refs.map(op => op.operationKey).sort(),before.job.operation_refs.map(op => op.operationKey).sort());
    assert.equal(after.payment.status,"EXECUTED");
    assert.equal(after.payment.receipt_ref,before.receipts[0].id);
    assert.deepEqual(after.receipts,before.receipts);
    assert.deepEqual(after.amounts,before.amounts);
    assert.deepEqual(after.seats,before.seats);
    assert.equal(active(target),0);
    proof = { targetProject:target.project, verifiedMs, completedMs:Math.round(performance.now()-restoreStarted),
      workflows:workflowIds, workflowInventorySha256:sha(inventory), credentialCount:3, credentialProbe:"IAM_TOKEN_MINTED", triggerCount:0,
      before:{ jobId, status:before.job.status, attempt:before.job.attempt, paymentStatus:before.payment.status, amounts:before.amounts, receipts:before.receipts, seats:before.seats },
      after:{ status:after.job.status, attempt:after.job.attempt, paymentStatus:after.payment.status, amounts:after.amounts, receipts:after.receipts, seats:after.seats },
      operationKeys:after.job.operation_refs.map(op => op.operationKey), queues, outboxBefore:before.outbox, wakeups:before.wakeups.length };
    targetEvidence.restore = proof;
  }, targetEvidence, JSON.parse(source.runtime.AUTOMATION_BINDINGS), {
    provenanceFile:"docs/runbook-wf12.md", args:["--case=WF12-RESTORE"], restore:{ directory, hashes, operator, sourcePorts:Object.values(source.ports) },
  });
  return { ...proof, backupMs, backupHashes:hashes, sourceProject:source.project, targetCleanup:targetEvidence.cleanup.projectDown };
}
