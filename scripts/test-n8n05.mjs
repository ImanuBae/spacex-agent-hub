/* global fetch, AbortSignal, Buffer */
// Real isolated APIs/DB/broker/n8n. Synthetic records are inputs; no business endpoint is stubbed.
import assert from "node:assert/strict";
import console from "node:console";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { withN8n05Runtime } from "./n8n05-runtime.mjs";
import { runN8n05ApiCases } from "./n8n05-api-cases.mjs";
import { runN8n05WorkflowCases } from "./n8n05-workflow-cases.mjs";
import { runN8n05ReviewCases } from "./n8n05-review-cases.mjs";

const bindings=[
  {eventType:"crm.requested",workflowId:"WF-04"},
  {eventType:"enrollment.requested",workflowId:"WF-05"},
  {eventType:"payment.matched",workflowId:"WF-06"},
  ...["enrollment.deadline","enrollment.cancel_requested","payment.review_required","payment.review_decided"].map(eventType=>({eventType,workflowId:"WF-07"})),
].map(b=>({...b,workflowVersion:1,inputSchemaVersion:1}));
const evidence={authorization:"USER_DELEGATED_N8N05",decision:"NOT_ACCEPTED",providerRequests:0,personalEnvRead:false,keyRead:false,cases:[]};
const sha=b=>createHash("sha256").update(b).digest("hex");
await withN8n05Runtime(async h=>{
  console.log(`PRIVATE_ARTIFACTS ${h.directory}`);
  const secret=()=>randomBytes(32).toString("hex"),password=secret();
  let sequence=0;
  async function request(service,route,method="GET",body,token=h.operator.accessToken,expected=200,key,headers={}){
    const response=await fetch(`${h.urls[service]}${route}`,{method,headers:{"content-type":"application/json",connection:"close",...(token?{authorization:`Bearer ${token}`} :{}),...(key?{"idempotency-key":key}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:"error"});
    const json=await response.json();
    if(expected!==null)assert.equal(response.status,expected,`${service} ${method} ${route}: ${json.error?.code??"unexpected status"}`);
    return {status:response.status,body:json,data:json.data,correlationId:response.headers.get("x-correlation-id"),traceparent:response.headers.get("traceparent")};
  }
  const api=async(service,route,method="GET",body,token,expected=200,key)=> (await request(service,route,method,body,token,expected,key)).data;
  async function test(id,expected,run){
    const row={id,status:"RUNNING",expected,startedAt:new Date().toISOString()};evidence.cases.push(row);await save();
    try{row.actual=await run();row.status="PASS";console.log(`PASS ${id}`);}catch(error){row.status="FAIL";row.error={name:error.name,message:error.message};throw error;}finally{row.finishedAt=new Date().toISOString();await save();}
  }
  async function save(){await writeFile(path.join(h.directory,"acceptance-cases.json"),JSON.stringify(evidence,null,2),{mode:0o600});}
  const branch=(await api("org","/api/v1/branches","POST",{code:"N8N05",name:"DEMO N8N05",kind:"branch",active:true},undefined,201)).id;
  const otherBranch=(await api("org","/api/v1/branches","POST",{code:"N8N05-OTHER",name:"DEMO other branch",kind:"branch",active:true},undefined,201)).id;
  async function account(role,branches=[branch]){
    const email=`n8n05-${role}-${++sequence}@automation.test`;
    const row=await api("identity","/api/v1/accounts","POST",{email,password,name:`DEMO ${role}`,role},undefined,201);
    await api("identity",`/api/v1/accounts/${row.id}/access`,"PUT",{role,branchIds:branches},undefined,200,randomUUID());
    const login=await h.iamCall("/api/v1/auth/login",{email,password});return {...login,email,id:row.id};
  }
  const staff=await account("admissions"),second=await account("admissions"),director=await account("branch_director"),accountant=await account("accountant"),outsider=await account("admissions",[otherBranch]);
  const provision=(id,grants,workflows)=>h.iamCall("/internal/iam/principals",{id,grants,workflows},h.operator.accessToken);
  const sourceEnrollment=await provision(randomUUID(),[{audience:"enrollment",scopes:["automation:source"]}],["WF-07"]);
  const sourcePayment=await provision(randomUUID(),[{audience:"payment",scopes:["automation:source"]}],["WF-06","WF-07"]);
  const sourceChannel=await provision("n8n05-channel",[{audience:"conversation",scopes:["channel:context"]}],["WF-02"]);
  const worker=await provision("n8n05-worker",[{audience:"automation-bridge",scopes:["automation:claim","automation:checkpoint","automation:result","automation:authorize","automation:read"]},{audience:"crm",scopes:["crm:write"]},{audience:"enrollment",scopes:["enrollment:write"]},{audience:"payment",scopes:["payment:write"]},{audience:"class-schedule",scopes:["classes:enroll"]}],["WF-04","WF-05","WF-06","WF-07"]);
  await h.startService("crm");
  await h.startService("conversation",{CHAT_BRANCH_ID:branch,CHANNEL_CLIENT_ID:sourceChannel.id,CHANNEL_CLIENT_SECRET:sourceChannel.clientSecret});
  await h.startService("enrollment",{SOURCE_CLIENT_ID:sourceEnrollment.id,SOURCE_CLIENT_SECRET:sourceEnrollment.clientSecret});
  await h.startService("payment",{SOURCE_CLIENT_ID:sourcePayment.id,SOURCE_CLIENT_SECRET:sourcePayment.clientSecret,REVIEW_OWNER_ID:accountant.id});
  await writeFile(path.join(h.directory,"fixture-credentials-private.json"),JSON.stringify({password,staff,second,director,accountant,outsider,worker,sourceEnrollment,sourcePayment,sourceChannel}),{mode:0o600});

  async function offer({capacity=3,status="OPEN"}={}){
    const tag=`DEMO-${++sequence}`,course=await api("catalog","/api/v1/courses","POST",{code:tag,name:tag,goal:"DEMO local acceptance",level:"beginner",deliveryModes:["online"],branchIds:[branch],priceVnd:100000,status:"active",policyText:"DEMO-N8N05-2026-11-14-v1"},undefined,201);
    const pkg=await api("catalog","/api/v1/packages","POST",{courseId:course.id,code:tag,name:tag,sessionCount:1,priceVnd:100000,status:"active",policyText:"DEMO-N8N05-2026-11-14-v1"},undefined,201);
    const classId=randomUUID(),teacher=randomUUID();
    // Fixture is a valid, labelled Class input; every enrollment/hold/QR/commit below uses the real API.
    await h.pools["class-schedule"].query("INSERT INTO classes(id,code,name,course_id,package_id,branch_id,teacher_id,mode,online_url,capacity,minimum_size,registration_closes_at,decision_at,status,session_count) VALUES($1,$2,$2,$3,$4,$5,$6,'online','https://example.test/demo',$7,0,clock_timestamp()+interval '10 days',clock_timestamp()+interval '11 days',$8,1)",[classId,tag,course.id,pkg.id,branch,teacher,capacity,status]);
    await h.pools["class-schedule"].query("INSERT INTO sessions(id,class_id,teacher_id,starts_at,ends_at) VALUES($1,$2,$3,clock_timestamp()+interval '12 days',clock_timestamp()+interval '12 days 1 hour')",[randomUUID(),classId,teacher]);
    return {classId,packageId:pkg.id,courseId:course.id,course,package:pkg};
  }
  async function customer(){
    const people={};for(const kind of ["CONTACT","LEARNER","PAYER"]){const person=await api("crm","/api/v1/crm/people","POST",{branchId:branch,kind,fullName:`DEMO ${kind} ${++sequence}`,phone:`+8490${String(sequence).padStart(7,"0")}`},staff.accessToken,201,randomUUID());people[kind.toLowerCase()+"Id"]=person.id;}
    await api("crm",`/api/v1/crm/people/${people.contactId}/consents`,"POST",{purpose:"ADMISSIONS",status:"GRANTED",statementVersion:"DEMO-v1",statementText:"DEMO synthetic admissions only",method:"WRITTEN"},staff.accessToken,201,randomUUID());
    for(const fromPersonId of [people.contactId,people.payerId]){const rel=await api("crm","/api/v1/crm/relationships","POST",{fromPersonId,learnerId:people.learnerId,kind:"OTHER"},staff.accessToken,201,randomUUID());const detail=await api("crm",`/api/v1/crm/people/${fromPersonId}`,"GET",undefined,director.accessToken);const version=detail.relationships.find(r=>r.id===rel.id).version;await api("crm",`/api/v1/crm/relationships/${rel.id}/decision`,"POST",{version,status:"VERIFIED",evidenceRef:"DEMO-VERIFIED-REPRESENTATIVE"},director.accessToken);}
    return people;
  }
  async function preview(selection,token=staff.accessToken){return api("enrollment","/api/v1/enrollment-confirmations/preview","POST",selection,token,201,randomUUID());}
  async function confirm(p,token=staff.accessToken){await api("enrollment",`/api/v1/enrollment-confirmations/${p.id}/confirm`,"POST",{accepted:true},token);return(await h.pools.enrollment.query("SELECT * FROM confirmations WHERE id=$1",[p.id])).rows[0];}
  async function machine(workflow){return(await h.iamCall("/internal/iam/machine/token",{clientId:worker.id,clientSecret:worker.clientSecret,audience:"automation-bridge",scopes:["automation:claim","automation:checkpoint","automation:result","automation:authorize","automation:read"],workflows:[workflow],ttlSeconds:300})).accessToken;}
  async function claim(workflow){
    const token=await machine(workflow);let job;
    await h.eventually(async()=>{job=await api("automation-bridge","/internal/automation/jobs/claim","POST",{workflowId:workflow,workflowVersion:1},token);return !!job;},`${workflow} broker event delivery`);
    return {job,token};
  }
  async function authorize(ctx,operation){
    ctx.job=await api("automation-bridge",`/internal/automation/jobs/${ctx.job.jobId}/checkpoint`,"POST",{leaseToken:ctx.job.leaseToken,attempt:ctx.job.attempt,expectedVersion:ctx.job.version,step:operation.replaceAll(".","-"),operation:{name:operation}},ctx.token);
    return(await api("automation-bridge",`/internal/automation/jobs/${ctx.job.jobId}/authorize`,"POST",{leaseToken:ctx.job.leaseToken,attempt:ctx.job.attempt,operation},ctx.token)).accessToken;
  }
  async function finish(ctx){return api("automation-bridge",`/internal/automation/jobs/${ctx.job.jobId}/result`,"POST",{leaseToken:ctx.job.leaseToken,attempt:ctx.job.attempt,expectedVersion:ctx.job.version,step:"complete",outcome:"DONE",resultRef:`enrollment:${ctx.job.entity.id}`},ctx.token);}
  async function step(ctx,operation,service,route,body={},expected=200){const token=await authorize(ctx,operation);return {token,...await request(service,route,"POST",body,token,expected)};}
  async function purchase(selection){
    const p=await preview(selection),s=await confirm(p),ctx=await claim("WF-05"),id=s.enrollment_id;assert.equal(ctx.job.entity.id,id);
    await step(ctx,"enrollment.execute","enrollment",`/internal/enrollment/enrollments/${id}/create`);
    await step(ctx,"classes.enroll","class-schedule",`/internal/classes/enrollments/${id}/hold`);
    await step(ctx,"enrollment.execute","enrollment",`/internal/enrollment/enrollments/${id}/held`);
    const pay=await step(ctx,"payment.execute","payment",`/internal/payment/enrollments/${id}/create`);
    await step(ctx,"enrollment.execute","enrollment",`/internal/enrollment/enrollments/${id}/payment`);
    await finish(ctx);return {id,confirmation:p,source:s,ctx,payment:pay.data};
  }
  async function webhook(payment,{amount=payment.amountDue,reference=payment.reference,transactionId=randomUUID()}={},expected=200){const payload={provider:"SYNTHETIC",account:"DEMO-N8N05",transactionId,reference,amount,currency:"VND"};const signature=createHmac("sha256",h.runtime.SYNTHETIC_PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");return request("payment","/internal/payment/synthetic-webhook","POST",payload,"",expected,undefined,{"x-demo-signature":signature});}

  await test("SETUP","Real IAM/CRM/Enrollment/Payment start against their own migrated PostgreSQL DBs",async()=>({branch,services:[...h.services.keys()],sourceActors:[sourceEnrollment.id,sourcePayment.id],worker:worker.id,adapter:"SYNTHETIC"}));
  await test("API-WF05-HELD","One backend confirmation → immutable Enrollment → one hold → one synthetic QR",async()=>{
    const selection={...await customer(),...await offer()};const selected=Object.fromEntries(["contactId","learnerId","payerId","classId","packageId"].map(k=>[k,selection[k]]));
    const result=await purchase(selected);const current=await api("enrollment",`/api/v1/enrollment-confirmations/${result.confirmation.id}`,"GET",undefined,staff.accessToken);
    assert.equal(current.enrollment.status,"HELD");assert.equal(current.enrollment.paymentRequest.id,result.payment.id);assert.equal(current.enrollment.snapshot.amountDue,100000);
    const png=Buffer.from(current.enrollment.paymentRequest.qrImageDataUrl.split(",")[1],"base64");
    assert.equal(png.subarray(1,4).toString(),"PNG");assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);
    const counts={orders:(await h.pools.enrollment.query("SELECT count(*)::int AS n FROM enrollments WHERE id=$1",[result.id])).rows[0].n,holds:(await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1",[result.id])).rows[0].n,qr:(await h.pools.payment.query("SELECT count(*)::int AS n FROM payment_requests WHERE enrollment_id=$1",[result.id])).rows[0].n};assert.deepEqual(counts,{orders:1,holds:1,qr:1});
    h.firstPurchase=result;return {enrollmentId:result.id,confirmationId:result.confirmation.id,paymentId:result.payment.id,jobId:result.ctx.job.jobId,eventId:result.ctx.job.eventId,correlationId:result.ctx.job.correlationId,operationKeys:result.ctx.job.operationRefs.map(r=>r.operationKey),counts};
  });
  await test("API-WF06-CONFIRMED","Authenticated ledger match → Class COMMITTED → Enrollment CONFIRMED and one confirmed outbox",async()=>{
    const p=h.firstPurchase,m=await webhook(p.payment),ctx=await claim("WF-06");assert.equal(ctx.job.inputRef,m.data.matchRef);
    await step(ctx,"enrollment.execute","enrollment",`/internal/enrollment/enrollments/${p.id}/confirming`);
    await step(ctx,"classes.enroll","class-schedule",`/internal/classes/enrollments/${p.id}/commit`,{matchRef:m.data.matchRef});
    await step(ctx,"enrollment.execute","enrollment",`/internal/enrollment/enrollments/${p.id}/confirm`);await finish(ctx);
    const counts={confirmed:(await h.pools.enrollment.query("SELECT count(*)::int AS n FROM enrollments WHERE id=$1 AND status='CONFIRMED'",[p.id])).rows[0].n,committed:(await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1 AND status='COMMITTED'",[p.id])).rows[0].n,ledger:(await h.pools.payment.query("SELECT count(*)::int AS n FROM payment_ledger WHERE payment_id=$1",[p.payment.id])).rows[0].n,outbox:(await h.pools.enrollment.query("SELECT count(*)::int AS n FROM event_outbox WHERE event->>'type'='enrollment.confirmed' AND event->>'entityId'=$1",[p.id])).rows[0].n};assert.deepEqual(counts,{confirmed:1,committed:1,ledger:1,outbox:1});
    const confirmed=(await h.pools.enrollment.query("SELECT event FROM event_outbox WHERE event->>'type'='enrollment.confirmed' AND event->>'entityId'=$1",[p.id])).rows[0].event;
    const matched=(await h.pools.payment.query("SELECT event FROM event_outbox WHERE id=$1",[confirmed.causationId])).rows[0].event;
    const received=(await h.pools.payment.query("SELECT event FROM event_outbox WHERE id=$1",[matched.causationId])).rows[0].event;
    assert.equal(matched.id,ctx.job.eventId);assert.equal(received.payload.ledgerId,m.data.ledgerId);assert.equal(confirmed.payload.paymentRequestId,p.payment.id);
    for(const event of[received,matched,confirmed])assert.equal(event.correlationId,p.id);
    return{enrollmentId:p.id,matchRef:m.data.matchRef,ledgerId:m.data.ledgerId,jobId:ctx.job.jobId,eventId:ctx.job.eventId,counts,causation:{received:received.id,matched:matched.id,confirmed:confirmed.id}};
  });
  await runN8n05ApiCases({h,evidence,test,request,api,offer,customer,preview,confirm,claim,authorize,finish,step,purchase,webhook,staff,second,director,accountant,outsider,branch,otherBranch,worker});
  await runN8n05ReviewCases({h,evidence,test,request,api,offer,customer,preview,confirm,claim,authorize,finish,step,purchase,webhook,staff,second,director,accountant,outsider,branch,otherBranch,worker,password});
  await runN8n05WorkflowCases({h,evidence,test,request,api,offer,customer,preview,confirm,claim,authorize,finish,step,purchase,webhook,staff,second,director,accountant,outsider,branch,otherBranch,worker,password});
  evidence.decision="NOT_ACCEPTED";evidence.completedAt=new Date().toISOString();await save();
  evidence.sourceHashes={};for(const file of ["services/enrollment/src/app.ts","services/payment/src/app.ts","services/identity/src/machine.ts","services/class-schedule/src/app.ts","services/crm/src/app.ts","services/conversation/src/app.ts","scripts/test-n8n05.mjs"]){evidence.sourceHashes[file]=sha(await readFile(file));}
},evidence,bindings);
