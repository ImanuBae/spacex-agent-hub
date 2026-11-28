/* global AbortSignal, fetch */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseN8nOutput } from "./n8n-output.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const erasures = "/api/v1/crm/erasure-requests";
const people = "/api/v1/crm/people";
const summary = value => ({ id:value.id, status:value.status, tasks:value.tasks.map(({service,status,outcomeCode,evidenceRef})=>({service,status,outcomeCode,evidenceRef})) });

export async function erasureAcceptance({ h, api, request, confirmed, branch, director, staff, otherDirector, startConversation }) {
  const registry = h.runtime.WF12_BACKUP_REGISTRY;
  await writeFile(registry,JSON.stringify({ archives:[] }),{ mode:0o600, flag:"wx" });
  const manifest = JSON.parse(await readFile("workflows/n8n/erasure-manifest.json","utf8"));
  const canonical = await readFile(manifest.file,"utf8");
  assert.equal(sha(canonical),manifest.sha256);
  const [workflow] = JSON.parse(canonical.replace(/http:\/\/host\.docker\.internal:(4002|4005)\//g,(_,port) =>
    `http://${h.backendHost}:${port==="4002" ? h.iamPort : h.crmPort}/`));
  assert.equal(workflow.active,false);
  workflow.versionId = randomUUID();
  const folder = "/home/node/.n8n/wf12-erasure";
  h.compose("exec","-T","n8n","mkdir","-p",folder);
  const install = async (name, data, kind) => {
    const file = path.join(h.directory,name);
    await writeFile(file,JSON.stringify(data),{ mode:0o600, flag:"wx" });
    h.compose("cp",file,"n8n:"+folder+"/"+name);
    h.cli(`import:${kind}`,"--input="+folder+"/"+name);
  };
  await install("wf12-erasure-bound.json",[workflow],"workflow");
  await install("wf12-erasure-credential-private.json",[{ id:manifest.credentialId,name:manifest.credential,type:"httpCustomAuth",
    data:{ json:JSON.stringify({body:{clientId:h.erasureWorker.id,clientSecret:h.erasureWorker.clientSecret}}) } }],"credentials");
  assert.equal(h.sql("SELECT active::text FROM workflow_entity WHERE id='"+manifest.id+"'"),"false");
  const executions = [];
  const run = () => {
    const result = parseN8nOutput(h.cli("execute","--id="+manifest.id,"--rawOutput")).data.resultData;
    assert(!result.error,"WF-12 erasure execution failed");
    const outcome = result.runData["Process verified erasure"][0].data.main[0][0].json.data;
    executions.push(outcome);
    return outcome;
  };
  const person = async name => api("crm",people,"POST",{
    branchId:branch,kind:"CONTACT",fullName:name,email:`${randomUUID()}@automation.test`,notes:"DEMO scope fixture",
  },staff.accessToken,201,randomUUID());
  const open = id => api("crm",erasures,"POST",{personId:id,reason:"SUBJECT_REQUEST"},staff.accessToken,201,randomUUID());
  const approve = value => api("crm",`${erasures}/${value.id}/decision`,"POST",{
    version:value.version,decision:"VERIFIED",method:"IN_PERSON_CHECK",evidenceRef:"DEMO-VERIFIED-SUBJECT",
  },director.accessToken);
  const current = id => api("crm",`${erasures}/${id}`);
  const outcome = (value,service) => value.tasks.find(t=>t.service===service);
  const paymentAndSeat = async (order) => ({
    money:(await h.pools.payment.query("SELECT id,amount::int FROM payment_ledger WHERE payment_id=$1",[order.payment.id])).rows,
    seats:(await h.pools["class-schedule"].query("SELECT id,status FROM holds WHERE enrollment_id=$1",[order.id])).rows,
  });
  async function chatFor(contact) {
    const chat = await api("conversation","/api/v1/chat/session","POST",{consent:true},"",201);
    await api("conversation","/api/v1/chat/messages","POST",{clientMessageId:randomUUID(),text:"Synthetic private text for erasure test"},chat.token,201);
    if (contact) {
      await h.pools.conversation.query("UPDATE chat_messages SET created_at=clock_timestamp()-interval '100 days' WHERE conversation_id=$1",[chat.conversationId]);
      const {rows:[{session_id:session}]} = await h.pools.conversation.query("UPDATE conversations SET updated_at=clock_timestamp()-interval '100 days' WHERE id=$1 RETURNING session_id",[chat.conversationId]);
      await h.pools.crm.query(`INSERT INTO crm_channel_identities(id,provider,account_ref,subject_ref,branch_id,contact_id,source_ref,source_version,created_by)
        VALUES($1,'WEB_CHAT',$2,$3,$2,$4,$5,1,$6)`,[randomUUID(),branch,session,contact.id,chat.conversationId,staff.id]);
    }
    return chat;
  }
  const customer = await person("DEMO erasure scoped contact");
  const oldChat = await chatFor(customer), unrelated = await chatFor();
  const pending = await open(customer.id);
  assert.deepEqual(run(),{processed:0});
  assert.equal((await current(pending.id)).status,"PENDING_VERIFICATION");
  const forbidden = await request("crm",`${erasures}/${pending.id}/decision`,"POST",{
    version:pending.version,decision:"VERIFIED",method:"IN_PERSON_CHECK",evidenceRef:"DEMO-WRONG-BRANCH",
  },otherDirector.accessToken,403);
  await approve(pending);
  const failed = h.services.get("conversation"), exited = once(failed,"exit");
  assert(failed.kill("SIGTERM")); await exited;
  assert.deepEqual(run(),{processed:1,completed:false});
  const partial = await current(pending.id);
  assert.equal(partial.status,"PROCESSING");
  assert.equal(outcome(partial,"CONVERSATION").outcomeCode,"SERVICE_UNAVAILABLE");
  assert.equal(outcome(partial,"CRM").status,"DONE");
  const manual = await request("crm",`${erasures}/${pending.id}/tasks/CONVERSATION`,"POST",{
    version:outcome(partial,"CONVERSATION").version,status:"DONE",evidenceRef:"DEMO-UNVERIFIED-CLAIM",
  },director.accessToken,409);
  assert.equal(manual.body.error.code,"SERVICE_PROOF_REQUIRED");
  await startConversation();
  // Advance only the synthetic retry deadline to exercise recovery without waiting one minute.
  await h.pools.crm.query("UPDATE crm_erasure_requests SET retry_at=NULL WHERE id=$1",[pending.id]);
  assert.deepEqual(run(),{processed:1,completed:true});
  const complete = await current(pending.id);
  assert.equal(complete.status,"COMPLETED");
  assert.equal(outcome(complete,"CONVERSATION").outcomeCode,"ANONYMIZED");
  for (const service of ["enrollment","payment","reporting","conversation"]) {
    const {rows:[proof]} = await h.pools[service].query("SELECT evidence_ref,person_id,branch_id,status FROM erasure_proofs WHERE request_id=$1",[pending.id]);
    assert.deepEqual(proof,{evidence_ref:outcome(complete,service.toUpperCase()).evidenceRef,person_id:customer.id,branch_id:branch,status:outcome(complete,service.toUpperCase()).status});
  }
  const {rows:[chat]} = await h.pools.conversation.query("SELECT text,sources,model FROM chat_messages WHERE conversation_id=$1",[oldChat.conversationId]);
  assert.deepEqual(chat,{text:"Đã ẩn danh",sources:[],model:null});
  const revoked = await request("conversation","/api/v1/chat/history","GET",undefined,oldChat.token,401);
  const unaffected = await api("conversation","/api/v1/chat/history","GET",undefined,unrelated.token);
  assert(unaffected.messages.some(m=>m.text==="Synthetic private text for erasure test"));
  assert.equal((await h.pools.crm.query("SELECT count(*)::int AS count FROM crm_erasure_tombstones WHERE request_id=$1",[pending.id])).rows[0].count,1);

  const order = await confirmed();
  const retained = await approve(await open(order.selection.learnerId));
  const financeBefore = await paymentAndSeat(order);
  assert.equal(financeBefore.money.length,1);
  assert.equal(financeBefore.seats[0].status,"COMMITTED");
  assert.deepEqual(run(),{processed:1,completed:false});
  const waiting = await current(retained.id);
  assert.equal(waiting.status,"PROCESSING");
  for (const service of ["ENROLLMENT","PAYMENT"]) {
    assert.equal(outcome(waiting,service).outcomeCode,"RETENTION");
    const {rows:[proof]} = await h.pools[service.toLowerCase()].query("SELECT evidence_ref,status,code FROM erasure_proofs WHERE request_id=$1",[retained.id]);
    assert.deepEqual(proof,{evidence_ref:outcome(waiting,service).evidenceRef,status:"BLOCKED",code:"RETENTION"});
  }
  assert.deepEqual(await paymentAndSeat(order),financeBefore);

  const fromBackup = await person("DEMO data present in older backup");
  const backupChat = await chatFor(fromBackup);
  const restoreRequest = await approve(await open(fromBackup.id));
  const dumps = {};
  for (const service of ["crm","conversation"]) {
    const bytes = h.compose("exec","-T","bridge-db","pg_dump","-U","automation_test_admin","-d","n8n06_"+service,"--no-owner","--no-acl","--format=p");
    const file = path.join(h.directory,service+"-older-backup-private.sql");
    await writeFile(file,bytes,{mode:0o600,flag:"wx"});
    dumps[service] = {file,sha256:sha(bytes)};
  }
  const archive = randomUUID();
  await writeFile(registry,JSON.stringify({archives:[{id:archive,subjects:[fromBackup.id],retainUntil:new Date(Date.now()+7*86400000).toISOString()}]}),{mode:0o600});
  assert.deepEqual(run(),{processed:1,completed:false});
  const after = await current(restoreRequest.id);
  assert.equal(after.status,"PROCESSING");
  assert.equal(outcome(after,"BACKUPS").outcomeCode,"BACKUP_RETENTION");
  assert.equal(outcome(after,"BACKUPS").evidenceRef,archive);
  assert.equal(outcome(after,"CONVERSATION").outcomeCode,"ANONYMIZED");
  const {rows:scopes} = await h.pools.crm.query(`SELECT s.request_id AS "requestId",s.person_id AS "personId",s.branch_id AS "branchId",
    ARRAY(SELECT DISTINCT source_ref FROM crm_channel_identities WHERE contact_id=s.person_id AND branch_id=s.branch_id) AS "conversationIds",
    (e.status='NOT_APPLICABLE' AND e.outcome_code='NO_SCOPED_DATA') AS "noEnrollment"
    FROM crm_erasure_tombstones s JOIN crm_erasure_tasks t ON t.request_id=s.request_id AND t.service='CONVERSATION' AND t.status='DONE'
    JOIN crm_erasure_tasks e ON e.request_id=s.request_id AND e.service='ENROLLMENT' WHERE s.request_id=$1`,[restoreRequest.id]);
  assert.equal(scopes.length,1);
  assert.deepEqual(scopes[0].conversationIds,[backupChat.conversationId]);
  const excluded = JSON.stringify(scopes);
  const exclusionFile = path.join(h.directory,"restore-exclusions-private.json");
  await writeFile(exclusionFile,excluded,{mode:0o600,flag:"wx"});

  const restoredDbs = {};
  for (const [service, dump] of Object.entries(dumps)) {
    assert.equal(sha(await readFile(dump.file)),dump.sha256);
    restoredDbs[service] = h.createDatabase(service+"-erasure-restore");
    const role = `n8n06_${service}_erasure_restore`, temp = `/tmp/${service}-older-backup.sql`;
    h.compose("cp",dump.file,"bridge-db:"+temp);
    h.compose("exec","-T","bridge-db","psql","-X","-U",role,"-d",role,"-v","ON_ERROR_STOP=1","--single-transaction","-f",temp);
  }
  const restored = restoredDbs.crm;
  const {rows:[old]} = await restored.query("SELECT full_name,status FROM crm_people WHERE id=$1",[fromBackup.id]);
  assert.deepEqual(old,{full_name:fromBackup.fullName,status:"ACTIVE"});
  const message = pool => pool.query("SELECT text FROM chat_messages WHERE conversation_id=$1",[backupChat.conversationId]);
  assert.equal((await message(restoredDbs.conversation)).rows[0].text,"Synthetic private text for erasure test");
  for (const service of ["crm","conversation"]) {
    const child = h.services.get(service), exited = once(child,"exit");
    assert(child.kill("SIGTERM")); await exited;
  }
  const port = await h.freePort(), config = {
    HOST:"127.0.0.1",PORT:String(port),DATABASE_URL:h.domainUrls["crm-erasure-restore"],
    WF12_RESTORE_EXCLUSIONS:exclusionFile,WF12_RESTORE_EXCLUSIONS_SHA256:sha(excluded),
  };
  await assert.rejects(h.startService("crm",{...config,WF12_RESTORE_EXCLUSIONS_SHA256:"0".repeat(64)}),/exited before readiness/);
  assert.equal((await restored.query("SELECT status FROM crm_people WHERE id=$1",[fromBackup.id])).rows[0].status,"ACTIVE");
  await h.startService("crm",config);
  const conversationPort = await h.freePort();
  await startConversation({...config,PORT:String(conversationPort),DATABASE_URL:h.domainUrls["conversation-erasure-restore"]});
  const history = await fetch(`http://127.0.0.1:${conversationPort}/api/v1/chat/history`,{
    headers:{authorization:`Bearer ${backupChat.token}`},signal:AbortSignal.timeout(5000),
  });
  assert.equal(history.status,401);
  assert.equal((await message(restoredDbs.conversation)).rows[0].text,"Đã ẩn danh");
  assert.equal((await restoredDbs.conversation.query("SELECT count(*)::int AS count FROM conversation_audit WHERE action='privacy.anonymized' AND conversation_id=$1",[backupChat.conversationId])).rows[0].count,1);
  const response = await fetch(`http://127.0.0.1:${port}${people}/${fromBackup.id}`,{
    headers:{authorization:`Bearer ${h.operator.accessToken}`},signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status,200);
  const restoredPerson = (await response.json()).data.person;
  assert.deepEqual({status:restoredPerson.status,fullName:restoredPerson.fullName,email:restoredPerson.email,phone:restoredPerson.phone,notes:restoredPerson.notes},
    {status:"ERASED",fullName:"Đã ẩn danh",email:"",phone:"",notes:""});
  assert.equal((await restored.query("SELECT count(*)::int AS count FROM crm_audit WHERE action='crm.erasure.restore_applied' AND target_id=$1",[fromBackup.id])).rows[0].count,1);
  assert.equal(h.sql("SELECT active::text FROM workflow_entity WHERE id='"+manifest.id+"'"),"false");
  return { manifest, executions, unauthorizedBranch:forbidden.status, rejectedManualProof:manual.status,
    retry:{before:summary(partial),after:summary(complete),revokedGuest:revoked.status,unrelatedConversationIntact:true},
    retention:{request:summary(waiting),money:financeBefore.money,seats:financeBefore.seats},
    restore:{request:summary(after),backupHashes:Object.fromEntries(Object.entries(dumps).map(([name,dump])=>[name,dump.sha256])),
      exclusionsSha256:sha(excluded),priorStatus:old.status,restoredStatus:restoredPerson.status,restoredChatAccess:history.status,badDigestBlockedStartup:true} };
}
