// Inactive synthetic smoke. Runtime bindings and credentials are supplied only by the isolated harness.
import { createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
const nodes = [{ id: "Manual", name: "Manual", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0], parameters: {} }], connections = {};
function http(name, url, body, token = "$('Token').first().json.data.accessToken") {
  const prior = nodes.at(-1).name;
  nodes.push({ id: name, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [nodes.length * 230, 0], parameters: {
    method: body === undefined ? "GET" : "POST", url,
    sendHeaders: true, headerParameters: { parameters: [{ name: "Authorization", value: `={{ 'Bearer ' + ${token} }}` }] },
    ...(body === undefined ? {} : { sendBody: true, specifyBody: "json", jsonBody: `={{ ${body} }}` }), options: { timeout: 5000, redirect: { redirect: { followRedirects: false } } },
  } });
  connections[prior] = { main: [[{ node: name, type: "main", index: 0 }]] };
}
http("Token", "http://host.docker.internal:4002/internal/iam/machine/token", "{audience:'automation-bridge',scopes:['automation:claim','automation:checkpoint','automation:result','automation:authorize'],workflows:['WF-CLASS-CANCEL'],ttlSeconds:60}");
Object.assign(nodes.at(-1).parameters, { authentication: "genericCredentialType", genericAuthType: "httpCustomAuth", sendHeaders: false });
delete nodes.at(-1).parameters.headerParameters;
nodes.at(-1).credentials = { httpCustomAuth: { id: "N8N03CancelMachine", name: "N8N03-cancel-machine" } };
http("Claim", "http://host.docker.internal:4006/internal/automation/jobs/claim", "{workflowId:'WF-CLASS-CANCEL',workflowVersion:1}");
const job = "$('Claim').first().json.data";
http("Intent", `={{ 'http://host.docker.internal:4006/internal/automation/jobs/' + ${job}.jobId + '/checkpoint' }}`, `{leaseToken:${job}.leaseToken,attempt:${job}.attempt,expectedVersion:${job}.version,step:'cancel',operation:{name:'classes.cancel'} }`);
http("Authorize", `={{ 'http://host.docker.internal:4006/internal/automation/jobs/' + ${job}.jobId + '/authorize' }}`, `{leaseToken:${job}.leaseToken,attempt:${job}.attempt,operation:'classes.cancel'}`);
const commandToken = "$('Authorize').first().json.data.accessToken";
const sourceUrl = `={{ 'http://host.docker.internal:4004/internal/classes/cancellations/' + ${job}.inputRef }}`;
http("Source", sourceUrl, undefined, commandToken);
http("Execute", `={{ 'http://host.docker.internal:4004/internal/classes/cancellations/' + ${job}.inputRef + '/execute' }}`, "$('Source').first().json.data.payload", commandToken);
http("Lookup", sourceUrl, undefined, commandToken);
http("Result", `={{ 'http://host.docker.internal:4006/internal/automation/jobs/' + ${job}.jobId + '/result' }}`, `{leaseToken:${job}.leaseToken,attempt:${job}.attempt,expectedVersion:$('Intent').first().json.data.version,step:'cancel',outcome:'DONE',resultRef:'class-cancellation:'+${job}.inputRef}`);
const workflow = [{ id: "N8N03CommandSmoke", name: "N8N-03 approved class cancellation (synthetic)", active: false, nodes, connections, settings: { executionOrder: "v1", executionTimeout: 55, saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false } }];
const file = "workflows/n8n/iam-command-smoke.json";
await writeFile(file, JSON.stringify(workflow, null, 2) + "\n");
await writeFile("workflows/n8n/iam-command-manifest.json", JSON.stringify({ workflowId: "WF-CLASS-CANCEL", workflowVersion: 1, eventType: "class.cancellation_approved", operation: "classes.cancel", file, sha256: createHash("sha256").update(await readFile(file)).digest("hex"), active: false }, null, 2) + "\n");
