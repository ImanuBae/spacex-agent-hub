import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { startWireTrace, responseDiagnostics } from "./n8n04-wire-trace.mjs";

const directory = process.env.N8N04_DIAGNOSTICS_DIR ?? `.local/automation/n8n04-wire-tests-${randomBytes(6).toString("hex")}`;
assert(path.resolve(directory).startsWith(path.resolve(".local/automation") + path.sep));
await mkdir(directory, { recursive: true });
const observations = [];
async function server(handler, run) {
  const service = createServer(handler); service.listen(0, "127.0.0.1"); await once(service,"listening");
  try { await run(`http://127.0.0.1:${service.address().port}`); }
  finally { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
}
function save(name, wire) {
  assert.equal(wire.observerErrors, 0); observations.push({ name, wire });
}

test("before-headers timeout proves local request write while keeping connection association exact", async () => {
  await server((_req,res) => { const timer=setTimeout(()=>res.end("{}"),1500); res.on("close",()=>clearTimeout(timer)); }, async url => {
    const signal=AbortSignal.timeout(200),trace=startWireTrace({signal});
    await assert.rejects(trace.run(()=>fetch(url,{method:"POST",body:"synthetic",signal})));
    const wire=trace.stop(); save("headers-timeout",wire);
    assert.equal(wire.matchedRequests,1); assert.equal(wire.connectionBinding,"REQUEST_SOCKET");
    assert(wire.requestEvents.some(e=>e.event==="requestBodyWritten"));
    assert(!wire.requestEvents.some(e=>e.event==="responseHeadersReceived"));
    assert(wire.connection.events.some(e=>e.event==="tcpConnected"));
    assert(wire.requestEvents.some(e=>e.event==="clientAbort"));
  });
});

test("body stall and disconnect are distinguished from a missing header response", async () => {
  for(const broken of [false,true]) await server((_req,res)=>{
    res.writeHead(200,{"content-type":"application/json"});res.write('{"id":');
    const timer=setTimeout(()=>broken?res.destroy():res.end("{}"),broken?50:1500);res.on("close",()=>clearTimeout(timer));
  },async url=>{
    const trace=startWireTrace();
    const response=await trace.run(()=>fetch(url,{signal:AbortSignal.timeout(200)}));
    await assert.rejects(response.text());const wire=trace.stop();save(broken?"body-disconnect":"body-timeout",wire);
    assert(wire.requestEvents.some(e=>e.event==="responseHeadersReceived"&&e.statusCode===200));
    assert(!wire.requestEvents.some(e=>e.event==="responseBodyCompleted"));
    if(broken)assert(wire.requestEvents.some(e=>e.event==="requestError"&&e.code==="UND_ERR_SOCKET"));
  });
});

test("connection refusal stays an unconfirmed pool candidate instead of inventing a request socket", async () => {
  let closedUrl; await server((_req,res)=>res.end(),async url=>{closedUrl=url;});
  const trace=startWireTrace();await assert.rejects(trace.run(()=>fetch(closedUrl,{signal:AbortSignal.timeout(1000)})));
  const wire=trace.stop();save("connection-refused",wire);
  assert.equal(wire.connectionBinding,"UNCONFIRMED");assert.equal(wire.connection,null);
  assert(wire.poolEvents.some(e=>e.event==="poolConnectError"&&e.code==="ECONNREFUSED"));
  assert(!wire.requestEvents.some(e=>e.event==="requestBodyWritten"));
});

test("sequential socket reuse retains connection history and does not report it as a new handshake", async () => {
  await server((_req,res)=>res.end("synthetic"),async url=>{
    const first=startWireTrace();await(await first.run(()=>fetch(url))).text();const a=first.stop();save("fresh-socket",a);
    await new Promise(resolve=>setImmediate(resolve));
    const second=startWireTrace();await(await second.run(()=>fetch(url))).text();const b=second.stop();save("reused-socket",b);
    assert.equal(b.connection.id,a.connection.id);assert.equal(b.connection.reused,true);
    assert.equal(b.poolEvents.length,0);assert.deepEqual(b.connection.events,a.connection.events);
    assert(b.requestEvents.some(e=>e.event==="responseBodyCompleted"));
  });
});

test("concurrent requests and unrelated traffic do not get mixed into another request trace", async () => {
  await server((_req,res)=>{res.writeHead(201);res.end("one");},async a=>{
    await server((_req,res)=>{res.writeHead(202);res.end("two");},async b=>{
      const first=startWireTrace(),second=startWireTrace();
      await Promise.all([first.run(async()=>await(await fetch(a)).text()),second.run(async()=>await(await fetch(b)).text()),fetch(a).then(r=>r.text())]);
      const x=first.stop(),y=second.stop();save("concurrent-one",x);save("concurrent-two",y);
      assert.equal(x.matchedRequests,1);assert.equal(y.matchedRequests,1);
      assert.notEqual(x.connection.id,y.connection.id);
      assert.deepEqual(x.requestEvents.filter(e=>e.event==="responseHeadersReceived").map(e=>e.statusCode),[201]);
      assert.deepEqual(y.requestEvents.filter(e=>e.event==="responseHeadersReceived").map(e=>e.statusCode),[202]);
    });
  });
});

test("header IDs survive incomplete body and all unapproved or secret header values are excluded", async () => {
  const secret="synthetic-provider-secret",capability="0123456789abcdef0123456789abcdef";
  await server((_req,res)=>{
    res.writeHead(200,{"x-generation-id":"gen-synthetic-1","x-request-id":"req-synthetic-1","cf-ray":"abcdef0123456789-SIN","content-type":"application/json","authorization":secret});
    res.flushHeaders();const timer=setTimeout(()=>res.end("{}"),1500);res.on("close",()=>clearTimeout(timer));
  },async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(150)});
    const headers=responseDiagnostics(response.headers,[secret,capability]);
    await assert.rejects(response.text());
    assert.equal(headers.responseIds["x-generation-id"],"gen-synthetic-1");
    assert(!JSON.stringify(headers).includes(secret));assert(!JSON.stringify(headers).includes("authorization"));
  });
  for(const value of [secret,"gen-"+secret,capability,"gen-"+capability.toUpperCase(),"Bearer-private","sk-or-v1-private","x".repeat(201),"unsafe%20id"]){
    const safe=responseDiagnostics(new Headers({"x-generation-id":value,"content-type":secret}),[secret,capability]);
    assert.deepEqual(safe.responseIds,{});assert.equal(safe.responseContentType,null);assert(!JSON.stringify(safe).includes(value));
  }
});

test("DNS/TCP/TLS timing uses a trusted test CA and still rejects an untrusted certificate", async () => {
  const cert=path.resolve(directory,"wire-test-cert.pem"),key=path.resolve(directory,"wire-test-key.pem");
  const configFile=path.resolve(directory,"wire-test-openssl.cnf");
  await writeFile(configFile,"[req]\ndistinguished_name=dn\n[dn]\nCN=localhost\n");
  execFileSync(process.env.N8N04_OPENSSL_BIN??"openssl",["req","-config",configFile,"-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore",windowsHide:true});
  const service=httpsServer({key:await readFile(key),cert:await readFile(cert)},(_req,res)=>res.end("synthetic"));
  service.listen(0,"127.0.0.1");await once(service,"listening");
  try{
    for(const trusted of [false,true]){
      const script=`import{setDefaultResultOrder}from'node:dns';import{startWireTrace}from ${JSON.stringify(new URL('./n8n04-wire-trace.mjs',import.meta.url).href)};setDefaultResultOrder('ipv4first');const t=startWireTrace();let ok=false;try{await(await t.run(()=>fetch('https://localhost:${service.address().port}',{signal:AbortSignal.timeout(3000)}))).text();ok=true;}catch{}process.stdout.write(JSON.stringify({ok,wire:t.stop()}));`;
      const child=spawn(process.execPath,["--input-type=module","-e",script],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot,...(trusted?{NODE_EXTRA_CA_CERTS:cert}:{})},stdio:["ignore","pipe","pipe"]});
      let output="",errors="";child.stdout.on("data",b=>output+=b);child.stderr.on("data",b=>errors+=b);
      assert.equal(await new Promise(resolve=>child.once("exit",resolve)),0,errors);
      const result=JSON.parse(output);assert.equal(result.ok,trusted);save(trusted?"trusted-tls":"untrusted-tls",result.wire);
      if(trusted){
        assert.equal(result.wire.connectionBinding,"REQUEST_SOCKET");
        assert(result.wire.connection.events.some(e=>e.event==="dnsLookupCompleted"));
        assert(result.wire.connection.events.some(e=>e.event==="tcpConnected"));
        assert(result.wire.connection.events.some(e=>e.event==="tlsConnected"&&e.authorized));
        assert(result.wire.connection.dns.some(d=>d.completedAtRequestMs>=d.startedAtRequestMs));
        assert.equal(new Set(result.wire.connection.dns.map(d=>d.operationId)).size,result.wire.connection.dns.length);
      }else{
        assert.equal(result.wire.connectionBinding,"UNCONFIRMED");
        assert(result.wire.poolEvents.some(e=>e.event==="poolConnectError"&&e.code==="DEPTH_ZERO_SELF_SIGNED_CERT"));
      }
    }
  }finally{service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}
  await writeFile(path.join(directory,"wire-unit-observations.json"),JSON.stringify({synthetic:true,providerRequests:0,metadataGets:0,observations},null,2)+"\n",{mode:0o600});
});
