import { modelId } from "./n8n04-model.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseN8nOutput } from "./n8n-output.mjs";

// Fault responses are synthetic, never evidence of successful model inference.
export async function testChatFaults(h) {
  const port=await h.freePort(),base=`http://host.docker.internal:${port}`,chat=`http://127.0.0.1:${h.chatPort}`;
  const child=spawn(process.execPath,["--input-type=module","-e",`
    import http from 'node:http';
    const counts={},captures=[];http.createServer(async(req,res)=>{
      if(req.url==='/captures'){res.end(JSON.stringify(captures));return;}
      if(['/planner','/answer'].includes(req.url)){const chunks=[];for await(const chunk of req)chunks.push(chunk);captures.push({path:req.url,authorizationPresent:!!req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())});}
      if(req.url==='/counts'){res.end(JSON.stringify(counts));return;}
      counts[req.url]=(counts[req.url]??0)+1;
      res.setHeader('content-type','application/json');
      if(req.url==='/timeout'){setTimeout(()=>res.end('{}'),8000).unref();return;}
      if(req.url==='/quota'){res.statusCode=429;res.end(JSON.stringify({error:{code:429,message:'SYNTHETIC quota fault'}}));return;}
      if(req.url==='/unavailable'){res.statusCode=503;res.end(JSON.stringify({error:{code:'UPSTREAM_UNAVAILABLE'}}));return;}
      if(req.url==='/answer'){res.end(JSON.stringify({model:'test-fixture-not-inference',choices:[{message:{role:'assistant',content:'SYNTHETIC workflow transport check, not model evidence'}}]}));return;}
      if(req.url==='/planner'){res.end(JSON.stringify({model:'fault-fixture-not-inference',choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'fault-only',type:'function',function:{name:'select_chat_action',arguments:'{"action":"read_catalog_classes"}'}}]}}]}));return;}
      res.end('{}');
    }).listen(${port},'0.0.0.0');
  `],{stdio:"ignore",windowsHide:true});h.children.push(child);
  const original=await readFile(path.join(h.directory,"WF-02.json"),"utf8"),file=path.join(h.directory,"WF-02-faults.json"),results=[];
  async function request(route,token,body) {
    const response=await fetch(chat+route,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json",connection:"close",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    assert(response.ok,`fault fixture ${route}: ${response.status}`);return(await response.json()).data;
  }
  function imported(file) {h.compose("cp",file,"n8n:/home/node/.n8n/smoke/faults.json");h.cli("import:workflow","--input=/home/node/.n8n/smoke/faults.json");}
  function execute(wf,label) {
    const output=h.cli("execute",`--id=N8N04${wf.replaceAll('-','')}`,"--rawOutput");
    return writeFile(path.join(h.directory,`${label}-${wf}-fault-execution-private.json`),output,{mode:0o600}).then(()=>{
      const r=parseN8nOutput(output).data.resultData;assert.equal(r.error,undefined);
      const job=r.runData.Result?.[0]?.data?.main?.[0]?.[0]?.json?.data;assert.equal(job?.status,"DONE");return {jobId:job.jobId,executionId:h.sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='N8N04${wf.replaceAll('-','')}' ORDER BY execution_entity.id::bigint DESC LIMIT 1`)};
    });
  }
  try {
    let ready=false;for(let i=0;i<40;i++){try{if((await fetch(`http://127.0.0.1:${port}/ready`)).ok){ready=true;break;}}catch{/* fixture process starting */}await new Promise(r=>setTimeout(r,100));}assert(ready);
    for(const [label,errorCode] of [["quota","QUOTA"],["timeout","TIMEOUT"],["tool","TOOL_ERROR"],["success",null]]) {
      const workflow=JSON.parse(original);
      for(const node of workflow[0].nodes) {
        // Only readiness is bypassed in this private copy: every model URL/credential is replaced below.
        if(node.name==='Prompt')node.parameters.jsCode=node.parameters.jsCode.replace(' || $json.data?.modelReady!==true','');
        if(['Model ready','Provider still allowed'].includes(node.name))node.parameters.conditions.conditions[0].leftValue="={{ $json.data?.providerAllowed === true }}";
        if(["Model tool request","Model answer"].includes(node.name)) {node.parameters.authentication="none";delete node.credentials;node.parameters.url=base+(['tool','success'].includes(label)?(node.name==='Model tool request'?'/planner':label==='tool'?'/empty':'/answer'):`/${label}`);}
        if(label==='tool'&&node.name==='Class list'){node.parameters.url=base+'/unavailable';node.parameters.sendHeaders=false;}
      }
      assert(workflow[0].nodes.filter(n=>['Model tool request','Model answer'].includes(n.name)).every(n=>n.parameters.url.startsWith(base+'/')&&!n.credentials));
      await writeFile(file,JSON.stringify(workflow));imported(file);
      const session=await request('/api/v1/chat/session','',{consent:true}),message={clientMessageId:randomUUID(),text:`DEMO synthetic ${label} fault, not live AI evidence`};
      await request('/api/v1/chat/messages',session.token,message);await new Promise(r=>setTimeout(r,1500));await execute('WF-01',label);await new Promise(r=>setTimeout(r,1500));
      const execution=await execute('WF-02',label),state=await request('/api/v1/chat/history',session.token);
      if(label==='tool'){const counts=await(await fetch(`http://127.0.0.1:${port}/counts`)).json();assert.equal(counts['/empty']??0,0,'tool failure must not call answer model');}
      assert.equal(state.mode,label==='success'?'AI':'HUMAN');assert.equal(state.errorCode,errorCode);assert.equal(state.messages.length,label==='success'?2:1);
      if(label==='success'){assert.equal(state.messages[1].text,'SYNTHETIC workflow transport check, not model evidence');const counts=await(await fetch(`http://127.0.0.1:${port}/counts`)).json();assert.equal(counts['/answer'],1);}
      await request('/api/v1/chat/messages',session.token,message);assert.equal((await request('/api/v1/chat/history',session.token)).messages.length,label==='success'?2:1);
      let payloadEvidence;
      if(label==='success'){
        const captures=await(await fetch(`http://127.0.0.1:${port}/captures`)).json();
        assert(captures.length>=2);assert(captures.every(c=>!c.authorizationPresent));
        assert(captures.every(c=>c.body.model===modelId));
        const answer=captures.find(c=>c.path==='/answer').body,tool=JSON.parse(answer.messages.at(-1).content);
        assert.deepEqual(Object.keys(tool).sort(),['classes','courses','notice','packages']);
        for(const key of ['leaseToken','clientSecret','ownerId','branchId','sessionId'])assert(!JSON.stringify(captures).includes(`"${key}"`));
        const captured=JSON.stringify(captures,null,2);await writeFile(path.join(h.directory,'provider-payloads-private.json'),captured,{mode:0o600});
        payloadEvidence={target:'local credential-free HTTP fixture, not provider',sha256:createHash('sha256').update(captured).digest('hex'),requests:captures.length,authorizationPresent:false,answerToolKeys:Object.keys(tool).sort()};
      }
      results.push({fault:label,injected:true,modelInference:false,errorCode,mode:state.mode,...execution,...(payloadEvidence?{payloadEvidence}:{})});
      h.check(`N8N-04 real n8n synthetic ${label} response -> durable ${state.mode}/${errorCode}, no duplicate; not model inference`);
    }
    return results;
  } finally {
    imported(path.join(h.directory,"WF-02.json"));
    if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGKILL');});
    h.children.splice(h.children.indexOf(child),1);
  }
}
