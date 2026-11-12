import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { parseN8nOutput } from "./n8n-output.mjs";

// Called only by the fresh-project automation harness; no personal .env or existing DBs.
export async function testChat(h) {
  const { directory, pool: bridge, domainUrls, iamCall, operator, startService, runtime, chatPort, bridgePort, iamPort, catalogPort, classesPort, compose, cli, sql, check } = h;
  const chatUrl=`http://127.0.0.1:${chatPort}`, bridgeUrl=`http://127.0.0.1:${bridgePort}`;
  const db = new pg.Pool({connectionString:domainUrls.conversation}), iam = new pg.Pool({connectionString:h.identityDb});
  const checks=[], executions=[];
  const pass=name=>{checks.push(name);check(`N8N-04 ${name}`);};
  const scopes=["automation:claim","automation:checkpoint","automation:result","automation:authorize","automation:read"], workflows=["WF-01","WF-02","WF-03"];
  const modelKey=process.env.N8N04_MODEL_KEY_FILE ? (await readFile(process.env.N8N04_MODEL_KEY_FILE,"utf8")).trim() : undefined;
  const fixture=JSON.parse(await readFile(path.join(directory,"machine-receipt.json"),"utf8")),branch=fixture.branchA;
  async function call(base,route,token,body,method=body===undefined?"GET":"POST") {
    const res=await fetch(base+route,{method,headers:{"content-type":"application/json",connection:"close",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,...await res.json()};
  }
  const chat=(route,token,body)=>call(chatUrl,route,token,body);
  const principal=await iamCall("/internal/iam/principals",{id:"chat-worker",workflows,grants:[{audience:"automation-bridge",scopes},{audience:"catalog",scopes:["catalog:read"]},{audience:"class-schedule",scopes:["classes:read"]}]},operator.accessToken);
  const source=await iamCall("/internal/iam/principals",{id:"channel-source",workflows:["WF-02"],grants:[{audience:"conversation",scopes:["channel:context"]}]},operator.accessToken);
  const getToken=async(ttlSeconds=60)=>(await iamCall("/internal/iam/machine/token",{clientId:"chat-worker",clientSecret:principal.clientSecret,audience:"automation-bridge",scopes,workflows,ttlSeconds})).accessToken;
  let worker=await getToken();
  const proof=j=>({jobId:j.jobId,leaseToken:j.leaseToken,attempt:j.attempt});
  const fence=j=>({leaseToken:j.leaseToken,attempt:j.attempt,expectedVersion:j.version,step:"chat"});
  async function intent(j,name) {
    const r=await call(bridgeUrl,`/internal/automation/jobs/${j.jobId}/checkpoint`,worker,{...fence(j),operation:{name}});assert.equal(r.status,200);return r.data;
  }
  async function claim(workflowId) {
    for(let n=0;n<60;n++) { const r=await call(bridgeUrl,"/internal/automation/jobs/claim",worker,{workflowId,workflowVersion:1});assert.equal(r.status,200);if(r.data)return r.data;await new Promise(r=>setTimeout(r,100)); }
    throw new Error(`No ${workflowId} job`);
  }
  async function done(j) { const r=await call(bridgeUrl,`/internal/automation/jobs/${j.jobId}/result`,worker,{...fence(j),outcome:"DONE"});assert.equal(r.status,200); }
  async function start(text="Tôi muốn tìm khóa học online") {
    const s=await chat("/api/v1/chat/session","",{consent:true});assert.equal(s.status,201);
    const input={clientMessageId:randomUUID(),text};const r=await chat("/api/v1/chat/messages",s.data.token,input);assert.equal(r.status,201);return {...s.data,input};
  }
  async function aiJob(s) {
    let route=await intent(await claim("WF-01"),"conversation.route");
    const r=await chat("/internal/conversations/route",worker,proof(route));assert.equal(r.status,200);await done(route);
    let j=await intent(await claim("WF-02"),"conversation.send");assert.equal(j.entity.id,s.conversationId);
    const turn=await chat("/internal/conversations/turn",worker,proof(j));assert.equal(turn.status,200);return j;
  }
  async function staff(name,branchIds) {
    const {hashPassword}=await import("../services/identity/dist/password.js");const id=randomUUID(),password="N8N04-synthetic-password";
    await iam.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,'DEMO N8N04',$3,'admissions',$4)",[id,`${name}@n8n04.test`,await hashPassword(password),branchIds]);
    const result=await iamCall("/api/v1/auth/login",{email:`${name}@n8n04.test`,password});return {...result,id};
  }
  try {
    const policy="DEMO: Chính sách hoàn tiền/chuyển lớp chưa công bố; cần tư vấn viên. Chat chỉ tư vấn, không giữ chỗ hay tạo đơn.";
    const course=await call(`http://127.0.0.1:${catalogPort}`,`/api/v1/courses/${fixture.courseA}`,operator.accessToken,{code:"N8N04-DEMO-EXCEL",name:"DEMO — Excel cơ bản",description:"Dữ liệu kiểm thử tổng hợp",goal:"Học hàm Excel cơ bản và xử lý bảng tính",level:"beginner",deliveryModes:["online"],branchIds:[branch],priceVnd:100000,status:"active",policyText:policy},"PUT");assert.equal(course.status,200);
    const offer=await call(`http://127.0.0.1:${catalogPort}`,`/api/v1/packages/${fixture.packageA}`,operator.accessToken,{courseId:fixture.courseA,code:"N8N04-DEMO-ONE",name:"DEMO — Excel online một buổi",sessionCount:1,priceVnd:100000,status:"active",policyText:policy},"PUT");assert.equal(offer.status,200);
    await startService("conversation",{DATABASE_URL:domainUrls.conversation,PORT:String(chatPort),HOST:"0.0.0.0",CHAT_BRANCH_ID:branch,AUTOMATION_BRIDGE_URL:bridgeUrl,CHANNEL_CLIENT_ID:"channel-source",CHANNEL_CLIENT_SECRET:source.clientSecret,AI_FREE_MODEL_READY:String(!!modelKey),CHAT_PROVIDER_DATA_POLICY:"synthetic-only"});
    const staffA=await staff("staff-a",[branch]),staffB=await staff("staff-b",[branch]),foreign=await staff("foreign",[randomUUID()]);
    const s=await start("Tôi cần khóa online, demo@example.test, 0901234567");
    const duplicate=await Promise.all([chat("/api/v1/chat/messages",s.token,s.input),chat("/api/v1/chat/messages",s.token,s.input)]);assert(duplicate.every(v=>v.status===201));
    assert.equal((await db.query("SELECT count(*)::int n FROM chat_messages WHERE conversation_id=$1",[s.conversationId])).rows[0].n,1);
    assert.equal((await chat("/api/v1/chat/messages",s.token,{...s.input,text:"different"})).status,409);
    assert.equal((await chat("/api/v1/chat/history",s.token)).data.messages.length,1);
    pass("durable guest session/history, concurrent inbound dedup and payload conflict");
    const other=await chat("/api/v1/chat/session","",{consent:true});
    assert.equal((await chat("/api/v1/chat/history",other.data.token)).data.messages.length,0);
    assert.equal((await chat(`/api/v1/conversations/${s.conversationId}`,other.data.token)).status,401);
    assert.equal((await chat(`/api/v1/conversations/${s.conversationId}`,foreign.accessToken)).status,403);
    assert.equal((await chat("/api/v1/conversations",foreign.accessToken)).data.length,0);
    assert.equal((await chat("/api/v1/chat/messages",s.token,{...s.input,branchId:branch})).status,400);
    pass("two guests, foreign branch staff and client-forged context denied");
    let j=await aiJob(s);
    const turn=await chat("/internal/conversations/turn",worker,proof(j));assert(!JSON.stringify(turn).includes("demo@example.test"));assert(!JSON.stringify(turn).includes("0901234567"));
    let blockedChatPort;
    for (const [environment, policy] of [["test", "blocked"], ["production", "synthetic-only"]]) {
      const blockedPort=await h.freePort();blockedChatPort=blockedPort;
      await startService("conversation",{DATABASE_URL:domainUrls.conversation,PORT:String(blockedPort),NODE_ENV:environment,CHAT_BRANCH_ID:branch,AUTOMATION_BRIDGE_URL:bridgeUrl,CHANNEL_CLIENT_ID:"channel-source",CHANNEL_CLIENT_SECRET:source.clientSecret,AI_FREE_MODEL_READY:"true",CHAT_PROVIDER_DATA_POLICY:policy});
      const closed=await call(`http://127.0.0.1:${blockedPort}`,"/internal/conversations/turn",worker,proof(j));
      assert.equal(closed.status,200);assert.deepEqual(closed.data.messages,[]);assert.equal(closed.data.providerAllowed,false);assert.equal(closed.data.modelReady,false);assert.equal(closed.data.errorCode,"DATA_POLICY_BLOCKED");
      const rejected=await call(`http://127.0.0.1:${blockedPort}`,"/internal/conversations/draft",worker,{...proof(j),text:"SYNTHETIC blocked draft",sources:[{api:"catalog.courses",readAt:new Date().toISOString()}],model:"test-fixture"});
      assert.equal(rejected.status,403);assert.equal(rejected.error.code,"DATA_POLICY_BLOCKED");
    }
    pass("provider gate with key ready: default blocked and production synthetic flag return no prose and deny successful drafts");
    j=await intent(j,"catalog.read");
    let authz=await call(bridgeUrl,`/internal/automation/jobs/${j.jobId}/authorize`,worker,{...proof(j),jobId:undefined,operation:"catalog.read"});
    assert.equal(authz.status,200);const catalogToken=authz.data.accessToken;
    const courses=await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/courses",catalogToken);
    assert.equal(courses.status,200);assert(courses.data.length);assert(courses.data.every(r=>!('branchIds'in r)&&!('priceVnd'in r)&&!('createdAt'in r)));
    const packages=await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/packages",catalogToken);assert.equal(packages.status,200);
    j=await intent(j,"classes.read");
    authz=await call(bridgeUrl,`/internal/automation/jobs/${j.jobId}/authorize`,worker,{leaseToken:j.leaseToken,attempt:j.attempt,operation:"classes.read"});assert.equal(authz.status,200);
    const classes=await call(`http://127.0.0.1:${classesPort}`,"/api/v1/classes?status=OPEN",authz.data.accessToken);
    assert.equal(classes.status,200);assert(classes.data.length);assert(classes.data.every(r=>!('teacherId'in r)&&!('onlineUrl'in r)&&!('roomId'in r)&&!('missingConditions'in r)));
    assert.equal((await call(`http://127.0.0.1:${classesPort}`,"/api/v1/classes?sellable=true",authz.data.accessToken)).status,403);
    assert.equal((await call(`http://127.0.0.1:${classesPort}`,"/api/v1/classes?status=DRAFT",authz.data.accessToken)).status,403);
    pass("guest IAM source context, minimized context, real Catalog/Class projections and sellable fail-closed");
    const v=(await chat(`/api/v1/conversations/${s.conversationId}`,staffA.accessToken)).data.version;
    const race=await Promise.all([chat(`/api/v1/conversations/${s.conversationId}/mode`,staffA.accessToken,{expectedVersion:v,mode:"HUMAN"}),chat(`/api/v1/conversations/${s.conversationId}/mode`,staffB.accessToken,{expectedVersion:v,mode:"HUMAN"})]);
    assert.equal(race.filter(r=>r.status===200).length,1);assert(race.some(r=>[403,409].includes(r.status)));
    const owner=race[0].status===200?staffA:staffB,loser=owner===staffA?staffB:staffA;
    assert.equal((await chat(`/api/v1/conversations/${s.conversationId}`,loser.accessToken)).status,403);
    const draft={...proof(j),text:"SYNTHETIC TEST DRAFT — NOT AI EVIDENCE",sources:[{api:"catalog.courses",readAt:new Date().toISOString()}],model:"test-fixture"};
    assert.equal((await chat("/internal/conversations/draft",worker,draft)).status,409);
    assert.equal((await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/courses",catalogToken)).status,403);
    const owned=(await chat(`/api/v1/conversations/${s.conversationId}`,owner.accessToken)).data;
    const reply={clientMessageId:randomUUID(),text:"Tư vấn viên đã tiếp nhận yêu cầu.",expectedVersion:owned.version};
    assert.equal((await chat(`/api/v1/conversations/${s.conversationId}/messages`,owner.accessToken,reply)).status,201);
    assert.equal((await chat(`/api/v1/conversations/${s.conversationId}/messages`,owner.accessToken,reply)).status,201);
    assert.equal((await chat("/api/v1/chat/history",s.token)).data.messages.filter(m=>m.sender==='STAFF').length,1);
    assert.equal((await chat("/api/v1/chat/messages",s.token,{clientMessageId:reply.clientMessageId,text:reply.text})).status,409);
    pass("concurrent takeover CAS, ownership, late AI blocked, staff outbound dedup and cross-sender dedup conflict");
    await done(j);
    await chat(`/api/v1/conversations/${s.conversationId}/mode`,owner.accessToken,{expectedVersion:owned.version,mode:"AI"});
    j=await aiJob(s);
    const resumedTurn=await chat("/internal/conversations/turn",worker,proof(j));
    assert(resumedTurn.data.messages.every(m=>m.sender!=="STAFF"));assert(!JSON.stringify(resumedTurn.data.messages).includes(reply.text));
    pass("human reply is excluded from model context after release to AI");
    await bridge.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[j.jobId]);
    assert.equal((await chat("/internal/conversations/draft",worker,{...draft,...proof(j)})).status,409);
    await bridge.query("UPDATE automation_jobs SET status='RETRY',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp(),version=version+1 WHERE id=$1",[j.jobId]);
    const newer=await intent(await claim("WF-02"),"conversation.send");assert(newer.attempt>j.attempt);
    assert.equal((await chat("/internal/conversations/turn",worker,proof(j))).status,409);
    await done(newer);
    pass("expired lease and old attempt blocked at Conversation boundary");
    const revoked=await chat("/api/v1/chat/revoke",s.token,{});assert.equal(revoked.status,200);
    assert.equal((await chat("/api/v1/chat/history",s.token)).status,401);
    assert([401,403].includes((await call(runtime.IDENTITY_URL,"/internal/iam/channel-delegations",worker,{contextRef:j.contextRef})).status));
    pass("guest revocation blocks reconnect and context minting");
    const revokedTurn=await start("DEMO revocation after domain token issuance");
    let revokedJob=await aiJob(revokedTurn);revokedJob=await intent(revokedJob,"catalog.read");
    const revokedAuth=await call(bridgeUrl,`/internal/automation/jobs/${revokedJob.jobId}/authorize`,worker,{leaseToken:revokedJob.leaseToken,attempt:revokedJob.attempt,operation:"catalog.read"});assert.equal(revokedAuth.status,200);
    await chat("/api/v1/chat/revoke",revokedTurn.token,{});
    assert.equal((await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/courses",revokedAuth.data.accessToken)).status,403);
    assert.equal((await chat("/internal/conversations/turn",worker,proof(revokedJob))).status,403);
    assert.equal((await chat("/internal/conversations/draft",worker,{...draft,...proof(revokedJob)})).status,403);await done(revokedJob);
    pass("guest revoke invalidates already-issued Catalog token, turn and draft");
    const fencedTurn=await start("DEMO handoff lease expiry while blocked on conversation lock"),fencedJob=await aiJob(fencedTurn);
    const blocker=await db.connect();
    try {
      await blocker.query("BEGIN");await blocker.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE",[fencedTurn.conversationId]);
      const pending=chat("/internal/conversations/draft",worker,{...proof(fencedJob),text:"SYNTHETIC error",sources:[],model:"test-fixture",errorCode:"TIMEOUT"});
      let waiting=false;
      for(let n=0;n<60;n++){waiting=(await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM conversations%' ")).rowCount>0;if(waiting)break;await new Promise(r=>setTimeout(r,50));}
      assert(waiting,"draft reached conversation lock after its first lease proof");
      await bridge.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[fencedJob.jobId]);
      await blocker.query("COMMIT");assert.equal((await pending).status,409);
      assert.equal((await chat("/api/v1/chat/history",fencedTurn.token)).data.mode,"AI");
    } finally {await blocker.query("ROLLBACK");blocker.release();}
    const recoveredFence=await intent(await claim("WF-02"),"conversation.send");assert.equal(recoveredFence.jobId,fencedJob.jobId);assert(recoveredFence.attempt>fencedJob.attempt);await done(recoveredFence);
    pass("handoff rechecks expired lease after waiting on conversation lock; no HUMAN transition");
    for(const errorCode of ["TIMEOUT","QUOTA","TOOL_ERROR"]) {
      const failing=await start(`DEMO ${errorCode} guard fixture`);let job=await aiJob(failing);
      const result=await chat("/internal/conversations/draft",worker,{...proof(job),text:"Synthetic failure only",sources:[],model:"test-fixture-not-live-model",errorCode});
      assert.equal(result.status,200);const state=(await chat("/api/v1/chat/history",failing.token)).data;
      assert.equal(state.mode,"HUMAN");assert.equal(state.errorCode,errorCode);assert.equal(state.messages.length,1);
      assert.equal((await chat("/internal/conversations/draft",worker,{...proof(job),text:"Synthetic failure only",sources:[],model:"test-fixture-not-live-model",errorCode})).status,409);
      await done(job);
    }
    pass("synthetic timeout/quota/tool-error guard fixtures hand off once without fabricated replies");
    const queued=await start("DEMO late queued draft guard fixture");let queuedJob=await aiJob(queued);
    const queuedDraft={...proof(queuedJob),text:"SYNTHETIC guard fixture; never model evidence",sources:[{api:"catalog.courses",readAt:new Date().toISOString()}],model:"test-fixture-not-live-model"};
    await bridge.query("UPDATE automation_jobs SET context_ref=$2 WHERE id=$1",[queuedJob.jobId,fencedJob.contextRef]);
    assert.equal((await chat("/internal/conversations/turn",worker,proof(queuedJob))).status,403);
    assert.equal((await chat("/internal/conversations/draft",worker,queuedDraft)).status,403);
    await bridge.query("UPDATE automation_jobs SET context_ref=$2 WHERE id=$1",[queuedJob.jobId,queuedJob.contextRef]);
    for(const column of ['input_ref','event_id']){
      const old=column==='input_ref'?queuedJob.inputRef:queuedJob.eventId;
      await bridge.query(`UPDATE automation_jobs SET ${column}=$2 WHERE id=$1`,[queuedJob.jobId,randomUUID()]);
      assert.equal((await chat("/internal/conversations/draft",worker,queuedDraft)).status,403);
      await bridge.query(`UPDATE automation_jobs SET ${column}=$2 WHERE id=$1`,[queuedJob.jobId,old]);
    }
    pass("turn/draft reject a live foreign context and mismatched input/event bindings");
    assert.equal((await chat("/internal/conversations/draft",worker,queuedDraft)).status,200);
    assert.equal((await chat("/internal/conversations/draft",worker,queuedDraft)).status,200);
    const queuedState=(await chat(`/api/v1/conversations/${queued.conversationId}`,staffA.accessToken)).data;
    assert.equal(queuedState.messages.filter(m=>m.sender==='AI').length,1);
    assert.equal((await chat(`/api/v1/conversations/${queued.conversationId}/mode`,staffA.accessToken,{expectedVersion:queuedState.version,mode:"HUMAN"})).status,200);
    assert.equal((await chat("/api/v1/chat/history",queued.token)).data.messages.filter(m=>m.sender==='AI').length,0);
    await done(queuedJob);
    pass("queued draft dedup and cancellation before guest delivery on takeover (synthetic guard fixture)");
    // Import/export/execute real n8n. Missing model key is a tested handoff, never model success.
    const credentials=[];
    if(modelKey) credentials.push({id:"N8N04FreeModel",name:"llm-free-demo",type:"httpHeaderAuth",data:{name:"Authorization",value:`Bearer ${modelKey}`}});
    for(const wf of workflows) credentials.push({id:`N8N04${wf}Machine`,name:`${wf}-machine-client`,type:"httpCustomAuth",data:{json:JSON.stringify({body:{clientId:"chat-worker",clientSecret:principal.clientSecret}})}});
    const credentialFile=path.join(directory,"chat-credentials-private.json");await writeFile(credentialFile,JSON.stringify(credentials),{mode:0o600});
    compose("cp",credentialFile,"n8n:/home/node/.n8n/smoke/chat-credentials.json");
    try { cli("import:credentials","--input=/home/node/.n8n/smoke/chat-credentials.json"); } finally { compose("exec","-T","n8n","rm","-f","/home/node/.n8n/smoke/chat-credentials.json"); }
    for(const wf of workflows) {
      const data=JSON.parse(await readFile(`workflows/n8n/${wf.toLowerCase()}.json`,"utf8"));
      // Test executions retain private traces; canonical workflows keep production execution data disabled.
      Object.assign(data[0].settings,{saveDataSuccessExecution:"all",saveDataErrorExecution:"all",saveManualExecutions:true});
      for(const n of data[0].nodes) if(n.parameters.url) for(const [from,to] of [[4002,iamPort],[4006,bridgePort],[4007,chatPort],[4001,catalogPort],[4004,classesPort]]) n.parameters.url=n.parameters.url.replaceAll(`:${from}/`, `:${to}/`);
      const file=path.join(directory,`${wf}.json`);await writeFile(file,JSON.stringify(data));compose("cp",file,`n8n:/home/node/.n8n/smoke/${wf}.json`);cli("import:workflow",`--input=/home/node/.n8n/smoke/${wf}.json`);
    }
    async function execute(wf) {
      for(let poll=0;poll<3;poll++) {
      const output=cli("execute",`--id=N8N04${wf.replaceAll('-','')}`,"--rawOutput");await writeFile(path.join(directory,`${wf}-execution-private.json`),output,{mode:0o600});
      const result=parseN8nOutput(output).data.resultData;
      assert.equal(result.error,undefined,`${wf}: ${JSON.stringify(result.error)}`);
      const claim=result.runData.Claim?.[0]?.data?.main?.[0]?.[0]?.json;
      if(!claim?.data&&(!claim?.error||['ECONNABORTED','ETIMEDOUT','ECONNRESET','ENOTFOUND','UPSTREAM_UNAVAILABLE','IDENTITY_UNAVAILABLE'].includes(claim.error.code))) {
        assert(!result.runData['Model tool request'],"poll recovery must never repeat a model call");
        await writeFile(path.join(directory,`${wf}-empty-poll-${Date.now()}-private.json`),output,{mode:0o600});
        if(poll<2){await new Promise(r=>setTimeout(r,1500));continue;}
      }
      const returned=result.runData.Result?.[0]?.data?.main?.[0]?.[0]?.json;assert.equal(returned?.data?.status,"DONE",`${wf} durable result`);
      const executionId=sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='N8N04${wf.replaceAll('-','')}' ORDER BY execution_entity.id::bigint DESC LIMIT 1`);
      await writeFile(path.join(directory,`${wf}-${returned.data.jobId}-execution-private.json`),output,{mode:0o600});
      assert(!executions.some(e=>e.executionId===executionId),"each n8n execution has a distinct retained receipt");
      executions.push({workflowId:wf,executionId,jobId:returned.data.jobId,status:"DONE",modelCalled:!!result.runData['Model tool request']?.[0]?.data?.main?.[0]?.[0]?.json?.model});return result;
      }
    }
    // Remove only synthetic pending jobs from earlier race tests so manual executions target this fixture.
    await bridge.query("UPDATE automation_jobs SET status='DONE' WHERE workflow_id=ANY($1) AND status IN ('PENDING','RETRY')",[workflows]);
    if(!modelKey) {
      const live=await start("Tôi muốn tìm khóa tiếng Việt online");await new Promise(r=>setTimeout(r,1500));
      await execute("WF-01");await new Promise(r=>setTimeout(r,1500));
      const result=await execute("WF-02");
      assert(result.runData['Missing key']);assert(!result.runData['Model tool request']);
      const state=(await chat("/api/v1/chat/history",live.token)).data;assert.equal(state.mode,"HUMAN");assert.equal(state.errorCode,"MISSING_KEY");assert.equal(state.messages.length,1);
      await new Promise(r=>setTimeout(r,1500));await execute("WF-03");
      pass("real n8n WF-01/02/03 clean import, per-execution IAM token acquisition, missing-key handoff, durable DONE");
    }
    const gated=await start("DEMO blocked provider egress even with a configured key");await new Promise(r=>setTimeout(r,1500));await execute("WF-01");await new Promise(r=>setTimeout(r,1500));
    const gatedCopy=JSON.parse(await readFile(path.join(directory,"WF-02.json"),"utf8"));
    for(const node of gatedCopy[0].nodes)if(["Turn","Submit draft"].includes(node.name))node.parameters.url=node.parameters.url.replace(`:${chatPort}/`, `:${blockedChatPort}/`);
    const gatedFile=path.join(directory,"WF-02-gated.json");await writeFile(gatedFile,JSON.stringify(gatedCopy));
    compose("cp",gatedFile,"n8n:/home/node/.n8n/smoke/gated.json");cli("import:workflow","--input=/home/node/.n8n/smoke/gated.json");
    try {
      const result=await execute("WF-02");assert(!result.runData["Model tool request"]);assert(!result.runData["Model answer"]);
      const state=(await chat("/api/v1/chat/history",gated.token)).data;assert.equal(state.mode,"HUMAN");assert.equal(state.errorCode,"DATA_POLICY_BLOCKED");assert.equal(state.messages.length,1);
    } finally {cli("import:workflow","--input=/home/node/.n8n/smoke/WF-02.json");}
    await new Promise(r=>setTimeout(r,1500));await execute("WF-03");
    pass("real n8n honors backend data-policy block with model-ready flag set; no model node runs, durable HUMAN/DATA_POLICY_BLOCKED");
    const benchmark=[],testCases=JSON.parse(await readFile("workflows/n8n/chat-benchmark.json","utf8"));
    if(modelKey&&process.env.N8N04_BENCHMARK_RESUME_FILE) {
      const previousFile=path.resolve(process.env.N8N04_BENCHMARK_RESUME_FILE),previous=JSON.parse(await readFile(previousFile,"utf8")),receipt=JSON.parse(await readFile(path.join(path.dirname(previousFile),"evidence.json"),"utf8"));
      for(const file of ['wf-01.json','wf-02.json','wf-03.json'])assert.equal(createHash('sha256').update(await readFile(`workflows/n8n/${file}`)).digest('hex'),receipt.artifacts[`workflows/n8n/${file}`],"resume requires exactly the same canonical workflows");
      assert.equal(new Set(previous.map(c=>c.id)).size,previous.length);
      for(const c of previous){assert(testCases.some(t=>t.id===c.id&&t.input===c.input),"resume case must match the benchmark");assert(c.modelCalled&&c.execution?.jobId,"resume needs real model/job evidence");benchmark.push({...c,sourceProject:path.basename(path.dirname(previousFile))});}
    }
    if(modelKey) for(const testCase of testCases.filter(c=>!benchmark.some(done=>done.id===c.id))) {
      const s=await start(testCase.input);await new Promise(r=>setTimeout(r,1500));await execute("WF-01");await new Promise(r=>setTimeout(r,1500));
      const r=await execute("WF-02"),state=(await chat("/api/v1/chat/history",s.token)).data;
      benchmark.push({...testCase,sourceProject:path.basename(directory),model:r.runData['Model answer']?.[0]?.data?.main?.[0]?.[0]?.json?.model??r.runData['Model tool request']?.[0]?.data?.main?.[0]?.[0]?.json?.model,modelCalled:!!r.runData['Model tool request']?.[0]?.data?.main?.[0]?.[0]?.json?.model,toolCalls:['Catalog courses','Catalog packages','Class list'].filter(n=>r.runData[n]),execution:executions.at(-1),actual:state,review:"PENDING"});
      await writeFile(path.join(directory,"benchmark-private.json"),JSON.stringify(benchmark,null,2),{mode:0o600});
    }
    worker=await getToken(1);await new Promise(r=>setTimeout(r,1200));
    assert.equal((await call(bridgeUrl,"/internal/automation/jobs/claim",worker,{workflowId:"WF-02",workflowVersion:1})).status,401);
    worker=await getToken();assert.equal((await call(bridgeUrl,"/internal/automation/jobs/claim",worker,{workflowId:"WF-02",workflowVersion:1})).status,200);
    pass("short-lived machine token expires and is reacquired through real IAM");
    const {chatBrowser}=await import("./test-chat-browser.mjs");
    const browser=await chatBrowser(h);
    worker=await getToken();
    await bridge.query("UPDATE automation_jobs SET status='DONE' WHERE workflow_id=ANY($1) AND status IN ('PENDING','RETRY')",[workflows]);
    const {testChatFaults}=await import("./test-chat-faults.mjs");
    const faults=await testChatFaults(h);
    worker=await getToken();
    const sourceTest=await start("DEMO source credential revocation fixture");let sourceJob=await aiJob(sourceTest);sourceJob=await intent(sourceJob,"catalog.read");
    const sourceAuth=await call(bridgeUrl,`/internal/automation/jobs/${sourceJob.jobId}/authorize`,worker,{leaseToken:sourceJob.leaseToken,attempt:sourceJob.attempt,operation:"catalog.read"});assert.equal(sourceAuth.status,200);
    assert.equal((await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/courses",sourceAuth.data.accessToken)).status,200);
    const operatorNow=await iamCall("/api/v1/auth/refresh",{refreshToken:operator.refreshToken});
    await iamCall("/internal/iam/principals/channel-source/rotate",{},operatorNow.accessToken);
    assert([401,403].includes((await chat("/internal/conversations/draft",worker,{...draft,...proof(sourceJob)})).status));
    assert.equal((await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/courses",sourceAuth.data.accessToken)).status,403);
    await iamCall("/internal/iam/principals/channel-source/revoke",{},operatorNow.accessToken);
    assert([401,403].includes((await chat("/internal/conversations/draft",worker,{...draft,...proof(sourceJob)})).status));
    assert([401,403].includes((await call(`http://127.0.0.1:${catalogPort}`,"/api/v1/courses",sourceAuth.data.accessToken)).status));
    await done(sourceJob);
    pass("source rotation/revocation invalidate already-issued domain tokens and successful drafts");
    return {status:"PARTIAL",checks,executions,modelBenchmark:modelKey?{status:"NEEDS_REVIEW",cases:benchmark}:{status:"BLOCKED",reason:"No supplied free-model credential",executed:0,passed:0},browser,faults,branchId:branch};
  } finally { await db.end();await iam.end(); }
}
