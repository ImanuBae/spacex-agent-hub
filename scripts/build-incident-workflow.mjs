/* global process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const id = "N8N07LocalWF12Incidents", workflowId = "WF-12";
const credential = { id: id + "Machine", name: "WF-12-incident-machine" };
const options = { timeout: 10000, redirect: { redirect: { followRedirects: false } } };
const nodes = [
  { name: "Manual", type: "manualTrigger", typeVersion: 1, parameters: {} },
  { name: "Poll", type: "scheduleTrigger", typeVersion: 1.2, parameters: { rule: { interval: [{ field: "seconds", secondsInterval: 30 }] } } },
  { name: "Incident token", type: "httpRequest", typeVersion: 4.2, parameters: {
    url: "http://host.docker.internal:4002/internal/iam/machine/token", method: "POST",
    authentication: "genericCredentialType", genericAuthType: "httpCustomAuth",
    sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ audience: "automation-bridge", scopes: ["automation:incidents"], workflows: [workflowId], ttlSeconds: 60 }), options,
  }, credentials: { httpCustomAuth: credential } },
  { name: "Record incident alerts", type: "httpRequest", typeVersion: 4.2, parameters: {
    url: "http://host.docker.internal:4006/internal/automation/incidents/alert", method: "POST", sendHeaders: true,
    headerParameters: { parameters: [{ name: "Authorization", value: "={{ 'Bearer ' + $json.data.accessToken }}" }] }, options,
  } },
].map((node, index) => ({ ...node, id: node.name.replaceAll(" ", "-"), type: "n8n-nodes-base." + node.type, position: [index < 2 ? 0 : (index - 1) * 240, index === 0 ? 80 : 240] }));
const edge = node => ({ main: [[{ node, type: "main", index: 0 }]] });
const connections = { Manual: edge("Incident token"), Poll: edge("Incident token"), "Incident token": edge("Record incident alerts") };
const file = "workflows/n8n/wf-12-incidents.json";
const graph = JSON.stringify([{ id, name: "WF-12 Incident alerts", active: false, nodes, connections,
  settings: { executionOrder: "v1", timezone: "Asia/Saigon", executionTimeout: 30, saveDataErrorExecution: "none", saveDataSuccessExecution: "none", saveManualExecutions: false },
  pinData: {}, tags: [] }], null, 2) + "\n";
const manifest = { id, workflowId, workflowVersion: 1, canonicalActive: false, file, sha256: createHash("sha256").update(graph).digest("hex"), credentialId: credential.id, credential: credential.name };
for (const [name, bytes] of [[file, graph], ["workflows/n8n/incident-manifest.json", JSON.stringify(manifest, null, 2) + "\n"]]) {
  if (process.argv.includes("--check")) assert.equal(await readFile(name, "utf8"), bytes, name + " drift");
  else await writeFile(name, bytes);
}

const erasureId = "N8N07LocalWF12Erasure", erasureFile = "workflows/n8n/wf-12-erasure.json";
const erasureCredential = { id:erasureId+"Machine", name:"WF-12-erasure-machine" };
const [erasure] = JSON.parse(graph);
Object.assign(erasure, { id:erasureId, name:"WF-12 Verified erasure" });
const [, , erasureToken, erasureProcess] = erasure.nodes;
erasureToken.credentials.httpCustomAuth = erasureCredential;
erasureToken.parameters.jsonBody = JSON.stringify({ audience:"crm", scopes:["erasure:process"], workflows:[workflowId], ttlSeconds:60 });
erasureProcess.parameters.url = "http://host.docker.internal:4005/internal/crm/erasure/process";
Object.assign(erasureProcess.parameters,{sendBody:true,specifyBody:"json",jsonBody:"{}"});
erasureToken.name = "Erasure token";
erasureProcess.name = "Process verified erasure";
Object.assign(erasure, { connections:{ Manual:edge(erasureToken.name), Poll:edge(erasureToken.name), [erasureToken.name]:edge(erasureProcess.name) } });
const erasureGraph = JSON.stringify([erasure],null,2)+"\n";
const erasureManifest = { id:erasureId, workflowId, workflowVersion:1, canonicalActive:false, file:erasureFile,
  sha256:createHash("sha256").update(erasureGraph).digest("hex"), credentialId:erasureCredential.id, credential:erasureCredential.name };
for (const [name, bytes] of [[erasureFile,erasureGraph],["workflows/n8n/erasure-manifest.json",JSON.stringify(erasureManifest,null,2)+"\n"]]) {
  if (process.argv.includes("--check")) assert.equal(await readFile(name,"utf8"),bytes,name+" drift");
  else await writeFile(name,bytes);
}
