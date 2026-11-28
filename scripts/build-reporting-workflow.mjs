import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { argv } from "node:process";

const id = "N8N07LocalWF11", workflowId = "WF-11", credentialId = id + "Machine";
const credential = { id: credentialId, name: "WF-11-N8N07-machine" };
const nodes = [], connections = {};
const url = (port, route) => `http://host.docker.internal:${port}${route}`;
function node(name, type, parameters, extra = {}) {
  nodes.push({ name, id: name.replaceAll(" ", "-"), type: "n8n-nodes-base." + type,
    typeVersion: { httpRequest: 4.2, code: 2, scheduleTrigger: 1.2 }[type] ?? 1,
    position: [200 * nodes.length, 240], parameters, ...extra });
  return name;
}
function link(from, to) {
  (connections[from] ??= { main: [[]] }).main[0].push({ node: to, type: "main", index: 0 });
}
const value = name => `$('${name}').first().json`;
const tokenValue = name => `${value(name)}.data?.accessToken`;
const settings = { timeout: 15000, redirect: { redirect: { followRedirects: false } } };
function token(name, audience, scopes, keepGoing = false) {
  return node(name, "httpRequest", {
    url: url(4002, "/internal/iam/machine/token"), method: "POST", authentication: "genericCredentialType", genericAuthType: "httpCustomAuth",
    sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ audience, scopes, workflows: [workflowId], ttlSeconds: 120 }), options: settings,
  }, { credentials: { httpCustomAuth: credential }, ...(keepGoing ? { onError: "continueRegularOutput" } : {}) });
}
function post(name, address, body, tokenName, fullResponse = false, keepGoing = false) {
  return node(name, "httpRequest", {
    method: "POST", url: address, sendHeaders: true,
    headerParameters: { parameters: [{ name: "Authorization", value: `={{ 'Bearer ' + ${tokenValue(tokenName)} }}` }] },
    sendBody: true, specifyBody: "json", jsonBody: body,
    options: { ...settings, ...(fullResponse ? { response: { response: { neverError: true, fullResponse: true } } } : {}) },
  }, keepGoing ? { onError: "continueRegularOutput" } : {});
}
const manual = node("Manual", "manualTrigger", {});
const poll = node("Poll", "scheduleTrigger", { rule: { interval: [{ field: "seconds", secondsInterval: 5 }] } });
const cron = node("Daily close", "scheduleTrigger", { rule: { interval: [{ field: "cronExpression", expression: "15 2 * * *" }] } });
const bridgeToken = token("Bridge token", "automation-bridge", ["automation:claim", "automation:result"]);
link(manual, bridgeToken); link(poll, bridgeToken);
const claim = post("Claim", url(4006, "/internal/automation/jobs/claim"), JSON.stringify({ workflowId, workflowVersion: 1 }), bridgeToken);
link(bridgeToken, claim);
const jobNode = node("Job", "code", { jsCode: `const job=$json.data;
return job?.workflowId==='WF-11'&&job.workflowVersion===1&&job.entity?.type==='reporting-day'&&job.entity.id===job.inputRef&&job.leaseToken?[{json:job}]:[];` });
link(claim, jobNode);
const job = value(jobNode);
const reportToken = token("Reporting token", "reporting", ["reporting:project"], true);
link(jobNode, reportToken);
const project = post("Project", url(4011, "/internal/reporting/project"), `={{ { day:${job}.inputRef,eventId:${job}.eventId } }}`, reportToken, true, true);
link(reportToken, project);
const resultBody = node("Result payload", "code", { jsCode: `
const job=${job}, receipt=$json.body?.data, token=${tokenValue(reportToken)};
const ok=$json.statusCode===200&&typeof receipt?.resultRef==='string';
const retry=!token||!$json.statusCode||$json.statusCode>=500||$json.statusCode===429;
return [{json:{leaseToken:job.leaseToken,attempt:job.attempt,expectedVersion:job.version,step:'report-projected',
  ...(ok?{outcome:'DONE',resultRef:receipt.resultRef}:retry?{outcome:'RETRY',errorCode:'UPSTREAM_UNAVAILABLE'}:{outcome:'DEAD',errorCode:'REPORT_PROJECTION_REJECTED'})}}];` });
link(project, resultBody);
link(resultBody, post("Result", `={{ '${url(4006, "/internal/automation/jobs/")}' + ${job}.jobId + '/result' }}`, "={{ $json }}", bridgeToken));
const cronToken = token("Daily reporting token", "reporting", ["reporting:project"]);
link(cron, cronToken);
link(cronToken, post("Rebuild previous day", url(4011, "/internal/reporting/rebuild"), "{}", cronToken));

for (const n of nodes.filter(n => n.type.endsWith(".code"))) new Function("$", "$json", n.parameters.jsCode);
const file = "workflows/n8n/wf-11.json";
const graph = JSON.stringify([{ id, name: "N8N07 WF-11 Reporting", active: false, nodes, connections,
  settings: { executionOrder: "v1", timezone: "Asia/Saigon", executionTimeout: 50, saveDataErrorExecution: "none", saveDataSuccessExecution: "none", saveManualExecutions: false },
  pinData: {}, tags: [] }], null, 2) + "\n";
const manifest = JSON.stringify({ version: 1, canonicalActive: false, syntheticOnly: true,
  id, workflowId, workflowVersion: 1, inputSchemaVersion: 1, eventType: "reporting.refresh_requested",
  file, sha256: createHash("sha256").update(graph).digest("hex"), credentialId, credential: credential.name }, null, 2) + "\n";
for (const [name, bytes] of [[file, graph], ["workflows/n8n/reporting-manifest.json", manifest]]) {
  if (argv.includes("--check")) assert.equal(await readFile(name, "utf8"), bytes, name + " drift");
  else await writeFile(name, bytes);
}
