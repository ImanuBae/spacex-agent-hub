import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { parseN8nOutput } from "./n8n-output.mjs";

export async function chatBrowser(h) {
  let aiConversation=h.realAiConversation,handoffExecution;
  if(process.env.N8N04_MODEL_KEY_FILE) {
    const fixtureDb=new pg.Pool({connectionString:h.domainUrls.conversation});
    try { aiConversation=(await fixtureDb.query("SELECT conversation_id FROM chat_messages WHERE sender='AI' AND delivery='DELIVERED' AND model NOT LIKE 'test-fixture%' ORDER BY created_at DESC LIMIT 1")).rows[0]?.conversation_id; }
    finally { await fixtureDb.end(); }
    assert(aiConversation,"at least one real model answer must reach a guest before browser acceptance");
    const output=h.cli("execute","--id=N8N04WF03","--rawOutput");
    await writeFile(path.join(h.directory,"WF-03-live-handoff-execution-private.json"),output,{mode:0o600});
    const result=parseN8nOutput(output).data.resultData;
    assert.equal(result.error,undefined);
    const job=result.runData.Result?.[0]?.data?.main?.[0]?.[0]?.json?.data;
    assert.equal(job?.status,"DONE");assert.equal(job.workflowId,"WF-03");
    assert.equal(result.runData.Conversation[0].data.main[0][0].json.data.mode,"HUMAN");
    handoffExecution={jobId:job.jobId,executionId:h.sql('SELECT id::text FROM execution_entity WHERE "workflowId"=\'N8N04WF03\' ORDER BY execution_entity.id::bigint DESC LIMIT 1'),status:"DONE"};
    h.check("N8N-04 real WF-03 observes handoff from live model evaluation");
  }
  const port=await h.freePort(),gatewayPort=await h.freePort(),origin=`http://localhost:${port}`;
  await h.startService("gateway",{PORT:String(gatewayPort),CATALOG_URL:`http://127.0.0.1:${h.catalogPort}`,CLASS_URL:`http://127.0.0.1:${h.classesPort}`,CONVERSATION_URL:`http://127.0.0.1:${h.chatPort}`});
  const log=await open(path.join(h.directory,"chat-portal.log"),"w");
  const child=spawn(process.execPath,[path.join(h.root,"node_modules/next/dist/bin/next"),"start","apps/admin-portal","--hostname","127.0.0.1","--port",String(port)],{
    cwd:h.root,env:{...process.env,NODE_ENV:"production",GATEWAY_URL:`http://127.0.0.1:${gatewayPort}`,PORTAL_ORIGIN:origin,NEXT_PUBLIC_ENABLE_MOCK:"false"},stdio:["ignore",log.fd,log.fd],windowsHide:true});h.children.push(child);await log.close();
  let ready=false;
  for(let n=0;n<100;n++){try{if((await fetch(origin+"/chat")).ok){ready=true;break;}}catch{/* owned process starting */} await new Promise(r=>setTimeout(r,100));}
  assert(ready,"production Portal ready");
  const cli=path.join(process.env.APPDATA,"npm/node_modules/@playwright/cli/playwright-cli.js"),session=`n8n04-${port}`;
  await h.runNode([cli,`-s=${session}`,"open",origin+"/chat","--browser=msedge"],process.env,h.root,"chat-browser-open.log");
  const script=path.join(h.directory,"chat-browser-private.js");
  await writeFile(script,`async page => {
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const must=(v,m)=>{if(!v)throw new Error(m)};
    await page.getByRole('button',{name:'Bắt đầu tư vấn',exact:true}).click();
    await page.getByLabel('Tin nhắn',{exact:true}).waitFor();
    await page.getByLabel('Tin nhắn',{exact:true}).fill('DEMO browser — cần tìm lớp online');
    await page.getByRole('button',{name:'Gửi',exact:true}).click();
    await page.getByText('DEMO browser — cần tìm lớp online',{exact:true}).waitFor();
    await page.reload();await page.getByText('DEMO browser — cần tìm lớp online',{exact:true}).waitFor();
    const history=await page.evaluate(async()=>await(await fetch('/api/chat/history')).json());
    must(history.data.messages.length===1,'reload kept one durable message');
    must(!await page.evaluate(()=>document.cookie.includes('hub_guest')),'guest cookie HttpOnly');
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:900});
      must(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'guest horizontal overflow '+width);
      await page.screenshot({path:${JSON.stringify(h.directory.replaceAll('\\','/'))}+'/chat-'+width+'.png',fullPage:true});
    }
    const guestId=history.data.id;
    await page.goto(${JSON.stringify(origin)}+'/login');
    const logged=await page.evaluate(async()=>{const r=await fetch('/api/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'staff-a@n8n04.test',password:'N8N04-synthetic-password'})});return r.status;});
    must(logged===200,'real IAM Portal login');
    await page.goto(${JSON.stringify(origin)}+'/dashboard/mailbox');
    await page.getByRole('button').filter({hasText:guestId.slice(0,8)}).click();
    await page.getByText('DEMO browser — cần tìm lớp online',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Tiếp quản',exact:true}).click();
    await page.getByText('Người xử lý:',{exact:false}).waitFor();
    await page.getByLabel('Trả lời khách',{exact:true}).fill('DEMO browser — tư vấn viên đã nhận');
    await page.getByRole('button',{name:'Gửi',exact:true}).click();
    await page.getByText('DEMO browser — tư vấn viên đã nhận',{exact:true}).waitFor();
    for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});must(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'inbox overflow '+width);await page.screenshot({path:${JSON.stringify(h.directory.replaceAll('\\','/'))}+'/inbox-'+width+'.png',fullPage:true});}
    await page.getByRole('button',{name:'Trả lại AI',exact:true}).click();
    await page.getByRole('status').filter({hasText:'AI hỗ trợ'}).waitFor();
    await page.goto(${JSON.stringify(origin)}+'/chat');
    await page.getByText('DEMO browser — tư vấn viên đã nhận',{exact:true}).waitFor();
    await page.reload();await page.getByText('DEMO browser — tư vấn viên đã nhận',{exact:true}).waitFor();
    ${aiConversation ? `await page.goto(${JSON.stringify(origin)}+'/dashboard/mailbox');
    await page.getByRole('button').filter({hasText:${JSON.stringify(aiConversation.slice(0,8))}}).click();
    await page.getByRole('list',{name:'Lịch sử hội thoại'}).locator('li').filter({hasText:'Trợ lý AI'}).first().waitFor();
    await page.getByText('Nguồn: catalog.courses',{exact:false}).first().waitFor();
    await page.getByText('Nguồn: classes.list',{exact:false}).first().waitFor();
    await page.screenshot({path:${JSON.stringify(h.directory.replaceAll('\\','/'))}+'/real-ai-inbox.png',fullPage:true});` : ""}
    must(errors.length===0,'browser JavaScript exceptions');
    return {passed:['send/reload/reconnect','HttpOnly guest session','staff login/takeover/reply/release','guest receives staff outbound','desktop/tablet/mobile no overflow'],errors};
  }`,{mode:0o600});
  try {
    await h.runNode([cli,`-s=${session}`,"run-code",`--filename=${script}`],process.env,h.root,"chat-browser-result.log");
    const result=await readFile(path.join(h.directory,"chat-browser-result.log"),"utf8");
    assert(!/### Error|TimeoutError|Error:/.test(result),"browser assertions; inspect chat-browser-result.log");
    assert(result.includes("guest receives staff outbound"),"browser completed all assertions");
    h.check("N8N-04 real production Portal browser send/reconnect/takeover/release, 1440/768/390px");
    return {status:"PASS",widths:[1440,768,390],checks:aiConversation?6:5,realModelAnswerRendered:!!aiConversation,handoffExecution};
  } finally { await h.runNode([cli,`-s=${session}`,"close"],process.env,h.root,"chat-browser-close.log"); }
}
