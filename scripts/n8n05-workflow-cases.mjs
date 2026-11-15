/* global fetch, AbortSignal, structuredClone, process, Buffer */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, open } from "node:fs/promises";
import path from "node:path";
import { parseN8nOutput } from "./n8n-output.mjs";
import { enrollmentBrowser } from "./test-n8n05-browser.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex");
export async function runN8n05WorkflowCases(t){
  const {h,evidence,test,api,offer,customer,preview,confirm,webhook,staff,director,branch,worker,password}=t;
  const operatorFixture=JSON.parse(await readFile(path.join(h.directory,"operator-private.json"),"utf8"));
  Object.assign(h.operator,await h.iamCall("/api/v1/auth/login",operatorFixture));
  for(const actor of [staff,director])Object.assign(actor,await h.iamCall("/api/v1/auth/login",{email:actor.email,password}));
  const manifest=JSON.parse(await readFile("workflows/n8n/registration-manifest.json","utf8"));
  const records=new Map(manifest.workflows.map(w=>[w.workflowId,w]));
  const canonical=new Map();let ordinal=0;
  for(const w of manifest.workflows){const bytes=await readFile(w.file);assert.equal(sha(bytes),w.sha256);const data=JSON.parse(bytes);assert.equal(data[0].active,false);canonical.set(w.workflowId,data);}
  const mappings={4002:h.iamPort,4004:h.classesPort,4005:h.crmPort,4006:h.bridgePort,4008:h.enrollmentPort,4009:h.paymentPort};
  h.compose("exec","-T","n8n","mkdir","-p","/home/node/.n8n/registration");
  const credentials=manifest.workflows.map(w=>({id:w.credentialId,name:w.credential,type:"httpCustomAuth",data:{json:JSON.stringify({body:{clientId:worker.id,clientSecret:worker.clientSecret}})}}));
  const credentialFile=path.join(h.directory,"registration-credentials-private.json");await writeFile(credentialFile,JSON.stringify(credentials),{mode:0o600});
  h.compose("cp",credentialFile,"n8n:/home/node/.n8n/registration/credentials.json");
  await writeFile(path.join(h.directory,"registration-credential-import.log"),h.cli("import:credentials","--input=/home/node/.n8n/registration/credentials.json"),{mode:0o600});
  async function install(wf,overrides={}){
    const record=records.get(wf),copy=structuredClone(canonical.get(wf));
    let text=JSON.stringify(copy);
    for(const [from,to]of Object.entries({...mappings,...overrides}))text=text.replaceAll(`http://host.docker.internal:${from}/`,`http://${h.backendHost}:${to}/`);
    const transformed=JSON.parse(text);transformed[0].versionId=randomUUID();Object.assign(transformed[0].settings,{saveDataSuccessExecution:"all",saveDataErrorExecution:"all",saveManualExecutions:true});
    assert.deepEqual(transformed[0].connections,copy[0].connections);
    const filename=`${wf}-binding-${++ordinal}-private.json`,file=path.join(h.directory,filename);
    const bytes=JSON.stringify(transformed,null,2);await writeFile(file,bytes,{mode:0o600});
    h.compose("cp",file,`n8n:/home/node/.n8n/registration/${filename}`);
    await writeFile(path.join(h.directory,`${wf}-import-${ordinal}.log`),h.cli("import:workflow",`--input=/home/node/.n8n/registration/${filename}`),{mode:0o600});
    return {workflowId:wf,id:record.id,canonicalSha256:record.sha256,bindingFile:filename,bindingSha256:sha(bytes),internalVersionId:transformed[0].versionId,endpointOverrides:Object.keys(overrides)};
  }
  const installations=[];for(const wf of records.keys())installations.push(await install(wf));
  evidence.n8n={installations,canonicalActive:false,testActivated:[],executions:[]};
  async function jobFor(wf,id){let row;await h.eventually(async()=>{row=(await h.pool.query("SELECT * FROM automation_jobs WHERE workflow_id=$1 AND entity->>'id'=$2 ORDER BY created_at DESC LIMIT 1",[wf,id])).rows[0];return !!row;},`${wf} durable broker job`);return row;}
  async function manual(wf,entityId){
    const before=await jobFor(wf,entityId),record=records.get(wf),output=h.cli("execute",`--id=${record.id}`,"--rawOutput");
    const filename=`${wf}-manual-${++ordinal}-execution-private.json`;await writeFile(path.join(h.directory,filename),output,{mode:0o600});
    const parsed=parseN8nOutput(output).data.resultData;assert.equal(parsed.error,undefined,`${wf} execution error; inspect private trace`);
    const after=(await h.pool.query("SELECT * FROM automation_jobs WHERE id=$1",[before.id])).rows[0];assert.equal(after.status,"DONE",`${wf} must finish the expected job`);
    assert(output.includes(before.id),"Execution must bind the source job");
    const executionId=h.sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='${record.id}' ORDER BY id::bigint DESC LIMIT 1`);
    const result={workflowId:wf,jobId:after.id,eventId:after.event_id,correlationId:after.correlation_id,executionId,attempt:after.attempt,trace:filename,traceSha256:sha(output),operationKeys:after.operation_refs.map(r=>r.operationKey)};evidence.n8n.executions.push(result);return result;
  }
  async function selection(){const c=await customer(),o=await offer();return {...c,classId:o.classId,packageId:o.packageId};}
  async function newRequest(){const selected=await selection(),p=await preview(selected),s=await confirm(p);return {id:s.enrollment_id,confirmation:p,selected};}
  async function current(p){return api("enrollment",`/api/v1/enrollment-confirmations/${p.confirmation.id}`,"GET",undefined,staff.accessToken);}
  async function outcome(id){const e=(await h.pools.enrollment.query("SELECT id,status,version,hold_id,payment_id FROM enrollments WHERE id=$1",[id])).rows[0];const seats=(await h.pools["class-schedule"].query("SELECT id,status FROM holds WHERE enrollment_id=$1",[id])).rows;const ledger=(await h.pools.payment.query("SELECT count(*)::int AS n,COALESCE(sum(l.amount),0)::bigint AS total FROM payment_ledger l JOIN payment_requests p ON p.id=l.payment_id WHERE p.enrollment_id=$1",[id])).rows[0];const outbox=(await h.pools.enrollment.query("SELECT count(*)::int AS n FROM event_outbox WHERE event->>'type'='enrollment.confirmed' AND event->>'entityId'=$1",[id])).rows[0].n;return {enrollment:e,seats,ledger:{count:ledger.n,total:Number(ledger.total)},confirmedEvents:outbox};}
  let manualPurchase;
  await test("N8N-WF04-VERIFIED-CRM","Imported n8n consumes backend CRM source request through live IAM/Bridge, writes one lead/result/audit/outbox",async()=>{
    const c=await customer();const req=await api("crm","/api/v1/crm/automation-requests","POST",{action:"lead.create",lead:{branchId:branch,...c,source:"WEB_CHAT"}},staff.accessToken,201,randomUUID());
    const execution=await manual("WF-04",req.id),r=await api("crm",`/api/v1/crm/automation-requests/${req.id}`,"GET",undefined,staff.accessToken);assert.equal(r.status,"DONE");assert(r.result.leadId);
    assert.equal((await h.pools.crm.query("SELECT count(*)::int AS n FROM crm_leads WHERE id=$1",[r.result.leadId])).rows[0].n,1);return{...execution,requestId:req.id,leadId:r.result.leadId};
  });
  await test("N8N-WF05-HOLD-QR","Imported n8n creates one real Enrollment/hold/QR and finishes without confirming money or seat",async()=>{
    manualPurchase=await newRequest();const execution=await manual("WF-05",manualPurchase.id),r=await current(manualPurchase);
    assert.equal(r.enrollment.status,"HELD");assert(r.enrollment.paymentRequest.qrImageDataUrl?.startsWith("data:image/png;base64,"));manualPurchase.payment=r.enrollment.paymentRequest;
    const actual=await outcome(manualPurchase.id);assert.equal(actual.seats.length,1);assert.equal(actual.seats[0].status,"HELD");assert.equal(actual.ledger.count,0);assert.equal(actual.confirmedEvents,0);return{...execution,...actual};
  });
  await test("N8N-WF06-MATCH-COMMIT-CONFIRM","Real signed synthetic receipt triggers n8n to commit the exact seat before one CONFIRMED event",async()=>{
    const receipt=await webhook(manualPurchase.payment),execution=await manual("WF-06",manualPurchase.id),actual=await outcome(manualPurchase.id);
    assert.equal(actual.enrollment.status,"CONFIRMED");assert.equal(actual.seats[0].status,"COMMITTED");assert.deepEqual(actual.ledger,{count:1,total:100000});assert.equal(actual.confirmedEvents,1);return{...execution,ledgerId:receipt.data.ledgerId,matchRef:receipt.data.matchRef,...actual};
  });
  await test("N8N-WF07-CANCEL","Real cancellation source is consumed by n8n; money is checked before request closure and seat release",async()=>{
    const p=await newRequest();await manual("WF-05",p.id);const r=await current(p);
    await api("enrollment",`/api/v1/enrollments/${p.id}/cancel`,"POST",{version:r.enrollment.version,reason:"DEMO explicit unpaid cancellation"},staff.accessToken,202,randomUUID());
    const execution=await manual("WF-07",p.id),actual=await outcome(p.id);assert.equal(actual.enrollment.status,"CANCELLED");assert.equal(actual.seats[0].status,"CANCELLED");assert.equal(actual.ledger.count,0);return{...execution,...actual};
  });

  async function publish(wf){const rec=records.get(wf);const output=h.cli("publish:workflow",`--id=${rec.id}`);await writeFile(path.join(h.directory,`${wf}-publish-${++ordinal}.log`),output,{mode:0o600});}
  async function startN8n(){h.compose("up","-d","--no-deps","--pull","never","n8n");await h.eventually(async()=>{try{return(await fetch(`http://127.0.0.1:${h.n8nPort}/healthz/readiness`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},"test n8n startup");}
  async function waitDone(wf,id){const first=await jobFor(wf,id);await h.eventually(async()=>{const r=(await h.pool.query("SELECT status FROM automation_jobs WHERE id=$1",[first.id])).rows[0];return r.status==="DONE";},`${wf} automatic completion`);const after=(await h.pool.query("SELECT * FROM automation_jobs WHERE id=$1",[first.id])).rows[0];const record=records.get(wf);const filename=`${wf}-automatic-${++ordinal}-execution-private.json`;const raw=h.sql(`SELECT json_build_object('id',e.id,'status',e.status,'workflowId',e."workflowId",'data',d.data)::text FROM execution_entity e JOIN execution_data d ON d."executionId"=e.id WHERE e."workflowId"='${record.id}' AND d.data LIKE '%${first.id}%' ORDER BY e.id::bigint DESC LIMIT 1`);assert(raw,"Automatic execution retains its source job trace");await writeFile(path.join(h.directory,filename),raw,{mode:0o600});const info=JSON.parse(raw);const result={workflowId:wf,jobId:after.id,eventId:after.event_id,executionId:info.id,attempt:after.attempt,trace:filename,traceSha256:sha(raw),operationKeys:after.operation_refs.map(r=>r.operationKey)};evidence.n8n.executions.push(result);return result;}
  for(const wf of records.keys()){await publish(wf);evidence.n8n.testActivated.push({workflowId:wf,at:new Date().toISOString(),onlyProject:h.project});}
  h.compose("stop","--timeout","5","n8n");await startN8n();
  await test("N8N-AUTOMATIC-TRIGGERS","Published isolated copies poll backend jobs and process source events automatically; canonical files remain inactive",async()=>{
    const p=await newRequest(),held=await waitDone("WF-05",p.id),r=await current(p);assert.equal(r.enrollment.status,"HELD");const money=await webhook(r.enrollment.paymentRequest),confirmed=await waitDone("WF-06",p.id),actual=await outcome(p.id);assert.equal(actual.enrollment.status,"CONFIRMED");assert.equal(actual.confirmedEvents,1);return {held,confirmed,ledgerId:money.data.ledgerId,...actual};
  });

  await test("N8N-BROWSER-CONFIRMATION","Real Portal uses explicit confirmation and reads durable held/QR state after reload at1440/768/390px",async()=>{
    const selected=await selection(),gatewayPort=await h.freePort(),portalPort=await h.freePort(),origin=`http://localhost:${portalPort}`;
    await h.startService("gateway",{PORT:String(gatewayPort),HOST:"127.0.0.1"});
    const fd=await open(path.join(h.directory,"portal-private.log"),"w");
    const env=Object.fromEntries(["PATH","Path","SystemRoot","SYSTEMROOT","TEMP","TMP","APPDATA","LOCALAPPDATA","USERPROFILE","COMSPEC","PATHEXT"].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
    const child=spawn(process.execPath,["--require",path.join(h.root,"scripts/no-personal-env.cjs"),path.join(h.root,"node_modules/next/dist/bin/next"),"start","apps/admin-portal","--hostname","127.0.0.1","--port",String(portalPort)],{cwd:h.root,env:{...env,NODE_ENV:"production",GATEWAY_URL:`http://127.0.0.1:${gatewayPort}`,PORTAL_ORIGIN:origin,NEXT_PUBLIC_ENABLE_MOCK:"false"},stdio:["ignore",fd.fd,fd.fd],windowsHide:true});h.children.push(child);await fd.close();
    await h.eventually(async()=>{try{return(await fetch(origin+"/login")).ok;}catch{return false;}},"Portal production startup");
    return enrollmentBrowser({origin,directory:h.directory,email:staff.email,password,selection:selected,expectedStatus:"HELD",timeoutMs:30000});
  });
  async function faultProxy(domain,action){
    const port=await h.freePort();let target,committed=false,forwardStatus;
    const server=createServer(async(req,res)=>{
      if(!new RegExp(`^/internal/${domain==='class-schedule'?'classes':'payment'}/enrollments/[a-f0-9-]+(?:/(?:hold|commit|release|create|close|exception))?$`).test(req.url??"")){res.writeHead(403).end();return;}
      try{
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>100000){res.writeHead(413).end();return;}chunks.push(chunk);}
        const body=Buffer.concat(chunks);const response=await fetch(h.urls[domain]+req.url,{method:req.method,headers:{authorization:req.headers.authorization??"","content-type":"application/json",connection:"close"},...(req.method==='GET'?{}:{body}),signal:AbortSignal.timeout(10000),redirect:"error"});
        const result=Buffer.from(await response.arrayBuffer());
        if(req.url===`/internal/${domain==='class-schedule'?'classes':'payment'}/enrollments/${target}/${action}`&&response.status===200){committed=true;forwardStatus=response.status;return;}
        res.writeHead(response.status,{"content-type":"application/json"});res.end(result);
      }catch{if(!res.destroyed)res.writeHead(503).end(JSON.stringify({error:{code:"TRANSPORT_FAULT"}}));}
    });await new Promise(resolve=>server.listen(port,"0.0.0.0",resolve));
    return{port,setTarget:id=>{target=id;},observed:()=>committed,status:()=>forwardStatus,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
  }
  await test("N8N-TIMEOUT-AFTER-QR-COMMIT","A real HTTP response timeout after Payment commit schedules lookup/recovery; it never releases the valid hold or creates a second QR",async()=>{
    h.compose("stop","--timeout","5","n8n");
    const proxy=await faultProxy("payment","create");
    try{
      const binding=await install("WF-05",{4009:proxy.port});await publish("WF-05");
      const p=await newRequest();proxy.setTarget(p.id);await startN8n();await h.eventually(proxy.observed,"Real Payment commit observed before dropping response");
      const job=await jobFor("WF-05",p.id);await h.eventually(async()=>(await h.pool.query("SELECT status FROM automation_jobs WHERE id=$1",[job.id])).rows[0].status==="RETRY","n8n records uncertain timeout without compensation");
      h.compose("kill","--signal","SIGKILL","n8n");
      const interrupted=await outcome(p.id);assert.equal(interrupted.enrollment.status,"HELD");assert.equal(interrupted.seats[0].status,"HELD");assert.equal(interrupted.enrollment.payment_id,null);
      assert.equal((await h.pools.payment.query("SELECT count(*)::int AS n FROM payment_requests WHERE enrollment_id=$1",[p.id])).rows[0].n,1);
      await install("WF-05");await publish("WF-05");await startN8n();const recovered=await waitDone("WF-05",p.id);assert(recovered.attempt>=2);
      const result=await outcome(p.id);assert.equal(result.enrollment.status,"HELD");assert(result.enrollment.payment_id);
      const operations=(await h.pools.payment.query("SELECT count(*)::int AS n FROM payment_operations WHERE enrollment_id=$1 AND action='create'",[p.id])).rows[0].n;assert.equal(operations,1);
      const pay=await api("payment",`/api/v1/payment-requests/${result.enrollment.payment_id}`,"GET",undefined,staff.accessToken);await webhook(pay);const confirmed=await waitDone("WF-06",p.id);
      return{binding,forwardedStatus:proxy.status(),interrupted,recovered,confirmed,qrCreateOperations:operations,realResponseTimeout:true};
    }finally{await proxy.close();}
  });
  await test("N8N-KILL-AFTER-CLASS-COMMIT","Killing only test n8n after Class commits leaves no early confirmation; original job/operation recovers the same seat once",async()=>{
    h.compose("stop","--timeout","5","n8n");const proxy=await faultProxy("class-schedule","commit");
    try{
      const binding=await install("WF-06",{4004:proxy.port});await publish("WF-06");const p=await newRequest();proxy.setTarget(p.id);await startN8n();await waitDone("WF-05",p.id);const r=await current(p);const money=await webhook(r.enrollment.paymentRequest);
      await h.eventually(proxy.observed,"Real Class commit observed before crash");h.compose("kill","--signal","SIGKILL","n8n");
      const job=await jobFor("WF-06",p.id),interrupted=await outcome(p.id);assert.equal(interrupted.enrollment.status,"CONFIRMING");assert.equal(interrupted.seats[0].status,"COMMITTED");assert.equal(interrupted.confirmedEvents,0);
      await h.pool.query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '2 seconds' WHERE id=$1 AND status='RUNNING'",[job.id]);
      await install("WF-06");await publish("WF-06");await startN8n();const recovered=await waitDone("WF-06",p.id);assert(recovered.attempt>=2);
      const actual=await outcome(p.id);assert.equal(actual.enrollment.status,"CONFIRMED");assert.equal(actual.seats.length,1);assert.equal(actual.confirmedEvents,1);assert.deepEqual(actual.ledger,{count:1,total:100000});
      const commits=(await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM class_enrollment_operations WHERE enrollment_id=$1 AND action='commit'",[p.id])).rows[0].n;assert.equal(commits,1);
      return{binding,ledgerId:money.data.ledgerId,matchRef:money.data.matchRef,interrupted,recovered,actual,commitOperations:commits,physicalTestContainerKill:true};
    }finally{await proxy.close();}
  });
}
