import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { parseN8nOutput } from "./n8n-output.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { browserAcceptance } from "./n8n06-portal.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const file = "workflows/n8n/adjustment-manifest.json";
const collection = "/home/node/.n8n/n8n06";
const uuid = /^[a-f0-9-]{36}$/;
const apiBase = "/api/v1";

export async function runN8n06Cases(t) {
  const { h, evidence, test: record, api, request, offer, customer, purchase, webhook, claim, step, finish, staff, director, accountant, otherDirector, adjustmentWorker, branch, password } = t;
  let actorsChecked = 0;
  async function test(id, expected, run) {
    return record(id, expected, async () => {
      if (Date.now() - actorsChecked > 180000) {
        const operator = JSON.parse(await readFile(path.join(h.directory,"operator-private.json"),"utf8"));
        Object.assign(h.operator,await h.iamCall("/api/v1/auth/login",operator));
        for (const actor of [staff,t.second,director,accountant,t.outsider,otherDirector]) {
          Object.assign(actor,await h.iamCall("/api/v1/auth/login",{email:actor.email,password}));
        }
        actorsChecked = Date.now();
      }
      return run();
    });
  }
  const manifest = JSON.parse(await readFile(file, "utf8"));
  const records = new Map(manifest.workflows.map(w => [w.workflowId, w]));
  const report = evidence.n8n06 = { canonicalActive: false, manifests: { [file]: sha(await readFile(file)) }, installs: [], executions: [] };
  const mapping = { 4002: h.iamPort, 4004: h.classesPort, 4006: h.bridgePort, 4008: h.enrollmentPort, 4009: h.paymentPort, 4010: h.ports.notification };
  let sequence = 0;
  const save = (name, bytes) => writeFile(path.join(h.directory, name), bytes, { mode: 0o600, flag: "wx" });
  h.compose("exec", "-T", "n8n", "mkdir", "-p", collection);
  const credsFile = "workflow-credentials-private.json";
  await save(credsFile, JSON.stringify(manifest.workflows.map(w => ({ id: w.credentialId, name: w.credential, type: "httpCustomAuth", data: { json: JSON.stringify({ body: { clientId: adjustmentWorker.id, clientSecret: adjustmentWorker.clientSecret } }) } }))));
  h.compose("cp", path.join(h.directory, credsFile), "n8n:"+collection+"/"+credsFile);
  await save("workflow-credentials-import-private.log", h.cli("import:credentials", "--input="+collection+"/"+credsFile));

  async function install(wf, overrides = {}) {
    const rec = records.get(wf), canonical = await readFile(rec.file, "utf8");
    assert.equal(sha(canonical), rec.sha256);
    let bound = canonical;
    for (const [old, port] of Object.entries({ ...mapping, ...overrides })) {
      assert(Number.isSafeInteger(port) && port >= 1 && port <= 65535);
      bound = bound.replaceAll("http://host.docker.internal:"+old+"/", "http://"+h.backendHost+":"+port+"/");
    }
    const parsed = JSON.parse(bound), [workflow] = parsed;
    assert.equal(workflow.active, false);
    assert.equal(workflow.id, rec.id);
    assert.deepEqual(workflow.connections, JSON.parse(canonical)[0].connections);
    workflow.versionId = randomUUID();
    Object.assign(workflow.settings, { saveDataErrorExecution: "all", saveDataSuccessExecution: "all", saveManualExecutions: true });
    const name = wf+"-binding-"+(++sequence)+"-private.json", bytes = JSON.stringify(parsed);
    await save(name, bytes);
    h.compose("cp", path.join(h.directory, name), "n8n:"+collection+"/"+name);
    await save(wf+"-import-"+sequence+"-private.log", h.cli("import:workflow", "--input="+collection+"/"+name));
    report.installs.push({ wf, workflowId: rec.id, canonicalSha256: rec.sha256, binding: name, sha256: sha(bytes), versionId: workflow.versionId, overrides: Object.keys(overrides) });
  }
  async function publish(wf) { await save(wf+"-publish-"+(++sequence)+"-private.log", h.cli("publish:workflow", "--id="+records.get(wf).id)); }
  async function start() {
    h.compose("up", "-d", "--no-deps", "--pull", "never", "n8n");
    await h.eventually(async () => { try { return (await fetch("http://127.0.0.1:"+h.n8nPort+"/healthz/readiness", { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, "owned n8n restarted");
  }
  const stop = () => h.compose("stop", "--timeout", "5", "n8n");
  const importWorkflows = async () => {
    for (const rec of records.values()) await install(rec.workflowId);
    for (const rec of records.values()) assert.equal(h.sql("SELECT active::text FROM workflow_entity WHERE id='"+rec.id+"'"), "false");
    return { installations: report.installs.map(x => ({ wf: x.wf, sha256: x.canonicalSha256, versionId: x.versionId })) };
  };
  if (t.selected && !t.selected.has("WF08-WF10-IMPORT")) await importWorkflows();
  else await test("WF08-WF10-IMPORT", "All three canonical inactive workflows import into the fresh project with dedicated credentials", importWorkflows);
  const readJob = async id => (await h.pool.query("SELECT * FROM automation_jobs WHERE id=$1", [id])).rows[0];
  async function jobFor(wf, id) {
    let job;
    await h.eventually(async () => {
      job = (await h.pool.query("SELECT * FROM automation_jobs WHERE workflow_id=$1 AND entity->>'id'=$2 ORDER BY created_at DESC LIMIT 1", [wf, id])).rows[0];
      return !!job;
    }, wf+" durable job for "+id);
    return job;
  }
  async function executionFor(wf, job, prefix, raw) {
    assert(uuid.test(job.id));
    const name = wf+"-"+prefix+"-"+(++sequence)+"-execution-private.json", record = records.get(wf);
    const query = "SELECT json_build_object('id',e.id,'status',e.status,'data',d.data)::text FROM execution_entity e JOIN execution_data d ON d.\"executionId\"=e.id WHERE e.\"workflowId\"='"+record.id+"' AND d.data LIKE '%"+job.id+"%' ORDER BY e.id::bigint DESC LIMIT 1";
    let result;
    await h.eventually(() => { result=h.sql(query); return !!result; }, wf+" execution trace committed");
    const saved = JSON.parse(result);
    await save(name, raw ?? result);
    const proof = { workflowId:wf, executionId:saved.id, jobId:job.id, eventId:job.event_id, correlationId:job.correlation_id, attempt:job.attempt, status:job.status,
      resultRef:job.result_ref, errorCode:job.error_code, operationKeys:job.operation_refs.map(r=>r.operationKey), trace:name, traceSha256:sha(raw??result) };
    report.executions.push(proof);
    return proof;
  }
  async function manual(wf, id, expected = "DONE") {
    const before = await jobFor(wf, id);
    const raw = h.cli("execute", "--id="+records.get(wf).id, "--rawOutput");
    assert.equal(parseN8nOutput(raw).data.resultData.error, undefined, "n8n manual execution error");
    assert(raw.includes(before.id), "Manual execution must process expected source job");
    const after = await readJob(before.id);
    assert.equal(after.status, expected, JSON.stringify({ status:after.status, code:after.error_code, step:after.step }));
    return executionFor(wf, after, "manual", raw);
  }
  async function waitDone(wf, id, expected = "DONE") {
    const first = await jobFor(wf, id);
    let job;
    await h.eventually(async () => {
      job = await readJob(first.id);
      if (job.status === expected) return true;
      assert(!["DONE","DEAD"].includes(job.status), JSON.stringify({ wf, actual:job.status, expected, code:job.error_code, step:job.step, id:job.id }));
      return false;
    }, wf+" reaches "+expected);
    return executionFor(wf, job, expected.toLowerCase());
  }
  async function student(learnerId, { consent = true, branchId = branch } = {}) {
    const email = "learner-"+randomUUID()+"@automation.test";
    const person = await api("crm", apiBase+"/crm/people/"+learnerId);
    const p = person.person ?? person;
    await api("crm", apiBase+"/crm/people/"+learnerId, "PUT", { version:p.version, input:{ branchId, kind:p.kind, fullName:p.fullName, phone:p.phone, email, notes:p.notes } }, undefined, 200);
    if (consent) await api("crm", apiBase+"/crm/people/"+learnerId+"/consents", "POST", {
      purpose:"COURSE_NOTICES", status:"GRANTED", statementVersion:"DEMO-v1", statementText:"DEMO nhận thông báo lớp", method:"WRITTEN",
    }, undefined, 201, randomUUID());
    const identity = await api("identity", apiBase+"/learner-identities", "POST", { learnerId, branchId, email, name:"DEMO Learner" }, undefined, 201);
    const challengeSessionId = randomUUID(), purpose = "STUDENT_LOGIN";
    const challenge = await api("identity", apiBase+"/auth/otp/request", "POST", { email, challengeSessionId, purpose }, "", 201);
    const message = (await h.pools.notification.query("SELECT body FROM notification_mailbox WHERE intent_id=$1", [challenge.deliveryRef])).rows[0];
    const code = message?.body.match(/\b\d{6}\b/)?.[0];
    assert(code, "Private local mailbox contains OTP message");
    const session = await api("identity", apiBase+"/auth/otp/verify", "POST", { code, challengeId:challenge.challengeId, challengeSessionId, purpose }, "", 200);
    return { ...session, id: identity.accountId ?? session.user.id, email, learnerId, branchId };
  }
  async function confirmed({ capacity = 3, amount = 100000, mapped = true, existingOffer } = {}) {
    const people = await customer(), chosen = existingOffer ?? await offer({ capacity });
    const selection = { ...people, classId: chosen.classId, packageId: chosen.packageId };
    const learner = mapped ? await student(people.learnerId) : null;
    const order = await purchase(selection);
    const money = await webhook(order.payment,{ amount });
    const ctx = await claim("WF-06");
    assert.equal(ctx.job.entity.id, order.id);
    await step(ctx,"enrollment.execute","enrollment","/internal/enrollment/enrollments/"+order.id+"/confirming");
    await step(ctx,"classes.enroll","class-schedule","/internal/classes/enrollments/"+order.id+"/commit",{ matchRef:money.data.matchRef });
    await step(ctx,"enrollment.execute","enrollment","/internal/enrollment/enrollments/"+order.id+"/confirm");
    await finish(ctx);
    const record = await api("enrollment",apiBase+"/enrollments/"+order.id,"GET",undefined,staff.accessToken);
    assert.equal(record.status,"CONFIRMED");
    return { id:order.id,enrollmentId:order.id,selection,payment:order.payment,record,student:learner,offer:chosen };
  }
  async function adjustment(source, { type="TRANSFER", target, amount, refundMode, actor=type==="REFUND"?accountant:staff, classChangeId }={}) {
    const current = await api("enrollment",apiBase+"/student/enrollments/"+source.id,"GET",undefined,source.student.accessToken);
    const opened = await api("enrollment",apiBase+"/adjustments","POST",{
      enrollmentId:source.id,type,version:current.currentEntitlement.version,reason:"DEMO backend validated adjustment",
      ...(target?{targetClassId:target.classId,packageId:target.packageId}:{}),...(amount?{amount,refundMode}:{}),...(classChangeId?{classChangeId}:{}),
    },actor.accessToken,201,randomUUID());
    const approved = await api("enrollment",apiBase+"/adjustments/"+opened.id+"/approve","POST",{version:opened.version},director.accessToken);
    return api("enrollment",apiBase+"/adjustments/"+opened.id+"/choice","POST",{version:approved.version,accepted:true},source.student.accessToken);
  }

  await test("WF08-MANUAL-CANCEL", "Independently approved empty class cancels through manual n8n execution and keeps session history", async () => {
    const cls = await offer();
    const before = await api("class-schedule",apiBase+"/classes/"+cls.classId,"GET",undefined,director.accessToken);
    const plan = await api("class-schedule",apiBase+"/class-changes","POST",{classId:cls.classId,classVersion:before.version,kind:"CANCEL",reason:"DEMO synthetic schedule cancellation"},director.accessToken,201,randomUUID());
    const approved = await request("class-schedule",apiBase+"/class-changes/"+plan.id+"/decision","POST",{version:plan.version,status:"APPROVED",reason:"DEMO reviewed empty class"},h.operator.accessToken,200);
    const trace = await manual("WF-08",plan.id);
    const after = await api("class-schedule",apiBase+"/classes/"+cls.classId,"GET",undefined,director.accessToken);
    const sessions = (await h.pools["class-schedule"].query("SELECT count(*)::int AS count, count(*) FILTER(WHERE active)::int AS active FROM sessions WHERE class_id=$1",[cls.classId])).rows[0];
    assert.equal(after.status,"CANCELLED"); assert.deepEqual(sessions,{ count:1,active:0 });
    return { ...trace,classId:cls.classId,before:before.status,after:after.status,sessions,approvalCorrelation:approved.correlationId };
  });
  for (const wf of records.keys()) await publish(wf);
  stop(); await start();
  report.activatedInProject = h.project;
  const helpers = { ...t, test, jobFor, manual, waitDone, student, confirmed, adjustment };

  async function interruptAfterCommit({ wf, domain, canonicalPort, collection, action, trigger, inspect }) {
    const port = await h.freePort();
    let blocked, id;
    const proxy = createServer(async (req,res) => {
      const requested = req.url ?? "";
      const relative = requested.startsWith(collection+"/") ? requested.slice(collection.length+1).split("/") : [];
      const cron = wf === "WF-10" && req.method === "POST" && requested === "/internal/notification/deadlines";
      if ((!cron && (!uuid.test(relative[0] ?? "") || relative.length > 2 || !["GET","POST"].includes(req.method))) || !req.headers.authorization) { res.writeHead(403).end(); return; }
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 4096) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const source = await fetch(h.urls[domain]+requested,{ method:req.method, headers:{ authorization:req.headers.authorization,"content-type":"application/json", "x-correlation-id":req.headers["x-correlation-id"] ?? randomUUID() },
          body:req.method==="POST"?Buffer.concat(chunks):undefined, signal:AbortSignal.timeout(15000), redirect:"error" });
        const body = await source.arrayBuffer();
        if (req.method==="POST" && relative[0]===id && relative[1]===action && source.ok) { blocked = { status:source.status }; return; }
        res.writeHead(source.status,{ "content-type":"application/json" }).end(Buffer.from(body));
      } catch { if (!res.destroyed) res.writeHead(503).end(); }
    });
    await new Promise((resolve,reject)=>{proxy.once("error",reject);proxy.listen(port,"0.0.0.0",resolve);});
    try {
      stop(); await install(wf,{ [canonicalPort]:port }); await publish(wf);
      const source = await trigger(); id = source.id;
      await start();
      await h.eventually(()=>!!blocked,wf+" real domain commit before response");
      h.compose("kill","-s","SIGKILL","n8n");
      assert.equal(h.compose("ps","--status","running","-q","n8n").trim(),"");
      const interrupted = await jobFor(wf,id);
      assert.equal(interrupted.status,"RUNNING");
      const businessAtKill = await inspect(source,"before");
      await install(wf); await publish(wf); await start();
      const remaining = new Date(interrupted.lease_expires_at).getTime() - Date.now();
      assert(remaining <= 65000,"Unexpected original lease duration");
      if (remaining > 0) await delay(remaining + 200);
      const recovered = await waitDone(wf,id);
      assert.equal(recovered.jobId,interrupted.id); assert(recovered.attempt > interrupted.attempt);
      return { atKill:{ jobId:interrupted.id,attempt:interrupted.attempt,step:interrupted.step,business:businessAtKill }, recovered, businessAfter:await inspect(source,"after") };
    } finally { proxy.closeAllConnections(); await new Promise(resolve=>proxy.close(resolve)); }
  }

  await test("WF09-TRANSFER", "Automatic n8n commits a distinct target seat before releasing the original, with unchanged registration snapshot", async () => {
    const old = await confirmed(), target = await offer(), requested = await adjustment(old,{target});
    const trace = await waitDone("WF-09",requested.id);
    const result = await api("enrollment",apiBase+"/adjustments/"+requested.id,"GET",undefined,director.accessToken);
    assert.equal(result.status,"EXECUTED");
    const seats = (await h.pools["class-schedule"].query("SELECT enrollment_id,class_id,status FROM holds WHERE enrollment_id=ANY($1::uuid[]) ORDER BY class_id",[[old.id,result.targetSeatId]])).rows;
    assert(seats.some(s=>s.enrollment_id===old.id && s.status==="CANCELLED"));
    assert(seats.some(s=>s.enrollment_id!==old.id && s.class_id===target.classId && s.status==="COMMITTED"));
    const live = await api("enrollment",apiBase+"/student/enrollments/"+old.id,"GET",undefined,old.student.accessToken);
    assert.equal(live.currentEntitlement.classId,target.classId);
    assert.equal(live.snapshot.classId,old.selection.classId);
    return {...trace,seats,registrationClassId:live.snapshot.classId,effectiveClassId:live.currentEntitlement.classId};
  });

  await test("WF09-SIGKILL-AFTER-COMMIT", "Killing n8n after the new seat commits and before the response leaves the old seat intact until forward recovery", async () => {
    const source = await confirmed(), target = await offer();
    return interruptAfterCommit({ wf:"WF-09", domain:"class-schedule", canonicalPort:4004, collection:"/internal/classes/adjustments", action:"commit-target",
      trigger:()=>adjustment(source,{target}),
      inspect:async (adjust,when)=>{
        const rows = (await h.pools["class-schedule"].query("SELECT enrollment_id,status FROM holds WHERE enrollment_id=ANY($1::uuid[])",[[source.id,adjust.targetSeatId]])).rows;
        assert.equal(rows.length,2);
        assert.equal(rows.find(r=>r.enrollment_id===source.id)?.status,when==="before"?"COMMITTED":"CANCELLED");
        assert.equal(rows.find(r=>r.enrollment_id===adjust.targetSeatId)?.status,"COMMITTED");
        const current = await api("enrollment",apiBase+"/student/enrollments/"+source.id,"GET",undefined,source.student.accessToken);
        assert.equal(current.currentEntitlement.classId,when==="before"?source.selection.classId:target.classId);
        return { seats:rows, effectiveClassId:current.currentEntitlement.classId };
      },
    });
  });
  await test("WF10-SIGKILL-AFTER-MAIL", "A physical n8n kill after local mailbox commit recovers the existing receipt and never writes a duplicate message", async () => {
    const source = await confirmed({mapped:false});
    let original;
    await h.eventually(async()=>{ original=(await h.pools.notification.query("SELECT id FROM notification_intents WHERE enrollment_id=$1 AND template='ENROLLMENT_CONFIRMED'",[source.id])).rows[0]; return !!original; });
    await waitDone("WF-10",original.id);
    await student(source.selection.learnerId);
    const cls=await api("class-schedule",apiBase+"/classes/"+source.selection.classId,"GET",undefined,director.accessToken);
    return interruptAfterCommit({ wf:"WF-10",domain:"notification",canonicalPort:4010,collection:"/internal/notification/intents",action:"send",
      trigger:()=>api("notification",apiBase+"/notifications","POST",{enrollmentId:source.id,template:"REMINDER",sourceVersion:cls.version,dueAt:new Date().toISOString()},staff.accessToken,201),
      inspect:async (intent)=>{
        const receipts=(await h.pools.notification.query("SELECT id,adapter FROM notification_mailbox WHERE intent_id=$1",[intent.id])).rows;
        const messages=(await h.pools.notification.query("SELECT id FROM notification_portal_messages WHERE intent_id=$1",[intent.id])).rows;
        assert.equal(receipts.length,1);assert.equal(messages.length,1);assert.equal(receipts[0].adapter,"SYNTHETIC_LOCAL_MAILBOX");
        return { receipts,messages };
      },
    });
  });

  await test("WF10-COMMAND-FENCE", "A WF10 command applies to exactly one intent and the current attempt, and cannot send again after DONE", async () => {
    stop();
    try {
      const source = await confirmed();
      let intent;
      await h.eventually(async()=>{
        intent=(await h.pools.notification.query("SELECT id FROM notification_intents WHERE enrollment_id=$1 AND template='ENROLLMENT_CONFIRMED'",[source.id])).rows[0];
        return !!intent;
      });
      const scopes=["automation:claim","automation:checkpoint","automation:result","automation:authorize","automation:read"];
      const {accessToken}=await h.iamCall("/internal/iam/machine/token",{
        clientId:adjustmentWorker.id,clientSecret:adjustmentWorker.clientSecret,audience:"automation-bridge",scopes,workflows:["WF-10"],ttlSeconds:180,
      });
      const queue="/internal/automation/jobs";
      await api("notification","/internal/notification/deadlines","POST",{},accessToken);
      const pending=await jobFor("WF-10",intent.id);
      assert.equal(await api("automation-bridge",queue+"/claim","POST",{workflowId:"WF-10",workflowVersion:2},accessToken),null);
      const job=await api("automation-bridge",queue+"/claim","POST",{workflowId:"WF-10",workflowVersion:1},accessToken);
      assert.equal(job.jobId,pending.id);
      const path=queue+"/"+job.jobId, fence={leaseToken:job.leaseToken,attempt:job.attempt}, operation="notification.deliver";
      const checkpoint=await api("automation-bridge",path+"/checkpoint","POST",{...fence,expectedVersion:job.version,step:"deliver-intent",operation:{name:operation}},accessToken);
      const wrongAttempt=await request("automation-bridge",path+"/authorize","POST",{...fence,attempt:job.attempt+1,operation},accessToken,null);
      assert([403,409].includes(wrongAttempt.status));
      const command=(await api("automation-bridge",path+"/authorize","POST",{...fence,operation},accessToken)).accessToken;
      const intents="/internal/notification/intents/", send=intents+intent.id+"/send";
      await request("notification",intents+randomUUID(),"GET",undefined,command,403);
      await request("notification",send,"POST",{recipientRef:randomUUID()},command,400);
      const delivered=await api("notification",send,"POST",{},command);
      assert.equal(delivered.status,"SENT");
      await api("automation-bridge",path+"/result","POST",{...fence,expectedVersion:checkpoint.version,step:"result",outcome:"DONE",resultRef:"notification:"+intent.id},accessToken);
      const afterDone=await request("notification",send,"POST",{},command,null);
      assert([401,403,409].includes(afterDone.status));
      const counts=(await h.pools.notification.query(`SELECT (SELECT count(*)::int FROM notification_mailbox WHERE intent_id=$1) AS mail,
        (SELECT count(*)::int FROM notification_portal_messages WHERE intent_id=$1) AS portal`,[intent.id])).rows[0];
      assert.deepEqual(counts,{mail:1,portal:1});
      return {jobId:job.jobId,eventId:job.eventId,operationKeys:checkpoint.operationRefs.map(ref=>ref.operationKey),intentId:intent.id,counts,wrongAttempt:wrongAttempt.status,afterDone:afterDone.status};
    } finally { await start(); }
  });
  const module = await import("./n8n06-notification-cases.mjs"); await module.runN8n06NotificationCases(helpers);
  const classCases = await import("./n8n06-class-cases.mjs"); await classCases.runN8n06ClassCases(helpers);
  const adjustmentCases = await import("./n8n06-adjustment-cases.mjs"); await adjustmentCases.runN8n06AdjustmentCases(helpers);
  await test("N8N06-BROWSER", "Real Student Portal OTP, guarded schedule and invoice download plus staff queue at 1440/768/390", ()=>browserAcceptance(helpers));
}
