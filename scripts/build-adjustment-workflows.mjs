import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const target = { iam: 4002, classes: 4004, bridge: 4006, enrollment: 4008, payment: 4009, notification: 4010 };
const url = (service, path) => `http://host.docker.internal:${target[service]}${path}`;
const scopes = ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize", "automation:read"];
const specifications = {
  "WF-08": { type: "class-change", event: "class.change.approved" },
  "WF-09": { type: "adjustment", event: "adjustment.ready" },
  "WF-10": { type: "notification", event: "notification.requested" },
};
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = { version: 1, canonicalActive: false, generator: "scripts/build-adjustment-workflows.mjs", workflows: [] };

for (const [workflowId, spec] of Object.entries(specifications)) {
  const id = `N8N06Local${workflowId.replace("-", "")}`;
  const credentialId = `${id}Machine`, credential = `${workflowId}-N8N06-machine`;
  const nodes = [], connections = {}, checkpoints = [];
  const add = (name, type, parameters, extra = {}) => {
    assert(!nodes.some(node => node.name === name), `Duplicate node ${name}`);
    nodes.push({ id: name.replaceAll(" ", "-"), name, type: `n8n-nodes-base.${type}`,
      typeVersion: { httpRequest: 4.2, if: 2, code: 2 }[type] ?? 1, position: [nodes.length * 220, 200], parameters, ...extra });
    return name;
  };
  const link = (from, to, output = 0) => {
    const edges = (connections[from] ??= { main: [] }).main;
    while (edges.length <= output) edges.push([]);
    assert.equal(edges[output].length, 0, `Duplicate branch ${from}`);
    edges[output].push({ node: to, type: "main", index: 0 });
  };
  const j = name => `$('${name}').first().json`;
  const job = j("Job"), machine = `${j("Machine token")}.data.accessToken`;
  const fence = `leaseToken:${job}.leaseToken,attempt:${job}.attempt`;
  const code = (name, jsCode) => add(name, "code", { jsCode });
  const branch = (name, expression) => add(name, "if", { conditions: { options: { typeValidation: "strict" },
    conditions: [{ leftValue: `={{ !!(${expression}) }}`, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } });
  const options = { timeout: 10000, redirect: { redirect: { followRedirects: false } }, response: { response: { neverError: true } } };
  const http = (name, address, body, token = machine) => add(name, "httpRequest", {
    method: body === undefined ? "GET" : "POST", url: address, sendHeaders: true,
    headerParameters: { parameters: [{ name: "Authorization", value: `={{ 'Bearer ' + ${token} }}` },
      { name: "Connection", value: "close" }, ...(address.includes(job) ? [{ name: "x-correlation-id", value: `={{ ${job}.correlationId }}` }] : [])] },
    ...(body === undefined ? {} : { sendBody: true, specifyBody: "json", jsonBody: `={{ ${body} }}` }), options,
  }, { onError: "continueRegularOutput" });
  const bridge = action => `={{ '${url("bridge", "/internal/automation/jobs/")}' + ${job}.jobId + '/${action}' }}`;
  const resource = (service, collection, action = "") => `={{ '${url(service, collection + "/")}' + ${job}.entity.id + '${action && "/" + action}' }}`;
  const version = () => `let version=${job}.version;for(const name of ${JSON.stringify(checkpoints)}){if($(name).isExecuted){const v=$(name).first().json.data?.version;if(Number.isSafeInteger(v))version=Math.max(version,v);}}`;

  add("Manual", "manualTrigger", {});
  add("Poll", "scheduleTrigger", { rule: { interval: [{ field: "seconds", secondsInterval: 5 }] } });
  add("Machine token", "httpRequest", { method: "POST", url: url("iam", "/internal/iam/machine/token"), authentication: "genericCredentialType", genericAuthType: "httpCustomAuth",
    sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ audience: "automation-bridge", scopes, workflows: [workflowId], ttlSeconds: 180 }), options },
  { credentials: { httpCustomAuth: { id: credentialId, name: credential } }, onError: "continueRegularOutput" });
  link("Manual", "Machine token"); link("Poll", "Machine token");
  branch("Machine ready", "typeof $json.data?.accessToken === 'string'"); link("Machine token", "Machine ready");
  let entry = "Machine ready";
  if (workflowId === "WF-09" || workflowId === "WF-10") {
    const domain = workflowId === "WF-09" ? "enrollment" : "notification";
    const deadlines = workflowId === "WF-09" ? "adjustment-deadlines" : "deadlines";
    link(entry, http("Queue due work", url(domain, `/internal/${domain}/${deadlines}`), "{}"));
    entry = "Queue due work";
  }
  link(entry, http("Claim", url("bridge", "/internal/automation/jobs/claim"), JSON.stringify({ workflowId, workflowVersion: 1 })));
  link("Claim", code("Job", `const job=$json.data;return job?.workflowId==='${workflowId}'&&job.workflowVersion===1&&job.entity?.type==='${spec.type}'&&job.entity.id===job.inputRef&&/^[a-f0-9-]{36}$/.test(job.entity.id)&&job.leaseToken?[{json:job}]:[];`));

  function step(from, name, service, collection, operation, action, skip = "false", fromOutput = 0, rejected = {}) {
    const fenceNode = code(`${name} fence`, `${version()}return [{json:{${fence},expectedVersion:version,step:'${name.toLowerCase().replaceAll(" ", "-")}',operation:{name:'${operation}'}}}];`);
    link(from, fenceNode, fromOutput);
    const intent = http(`${name} intent`, bridge("checkpoint"), "$json"); checkpoints.push(intent); link(fenceNode, intent);
    link(intent, branch(`${name} intent saved`, "Number.isSafeInteger($json.data?.version)"));
    link(`${name} intent saved`, "Classify failure", 1);
    const authorization = http(`${name} authorize`, bridge("authorize"), `{${fence},operation:'${operation}'}`);
    link(`${name} intent saved`, authorization);
    link(authorization, branch(`${name} authorized`, "typeof $json.data?.accessToken === 'string'"));
    link(`${name} authorized`, "Classify failure", 1);
    const token = `${j(authorization)}.data.accessToken`;
    const lookup = http(`${name} lookup`, resource(service, collection), undefined, token);
    link(`${name} authorized`, lookup);
    const found = branch(`${name} loaded`, "$json.data !== undefined && !$json.error"); link(lookup, found);
    link(found, "Classify failure", 1);
    if (!action) return found;
    const done = code(`${name} result`, "return [{json:$json}];");
    const needed = branch(`${name} needed`, `!(${skip})`); link(found, needed); link(needed, done, 1);
    const change = http(`${name} mutate`, resource(service, collection, action), "{}", token); link(needed, change);
    const saved = branch(`${name} saved`, "$json.data !== undefined && !$json.error"); link(change, saved); link(saved, done);
    let previous = saved;
    for (const [to, errors] of Object.entries(rejected)) {
      const expected = branch(`${name} ${to}`, `${JSON.stringify(errors)}.includes($json.error?.code)`);
      link(previous, expected, 1); link(expected, to); previous = expected;
    }
    link(previous, "Classify failure", 1);
    return done;
  }

  const terminal = "['EXECUTED','FAILED','REVOKED','EXPIRED'].includes($json.data?.status)";
  const classes = (from, name, action, skip, edge = 0, rejected) => step(from, name, "classes", "/internal/classes/adjustments", "classes.adjust", action, skip, edge, rejected);
  const enrollment = (from, name, action, skip, edge = 0, rejected) => step(from, name, "enrollment", "/internal/enrollment/adjustments", "enrollment.adjust", action, skip, edge, rejected);
  const payment = (from, name, action, skip, edge = 0, rejected) => step(from, name, "payment", "/internal/payment/adjustments", "payment.refund", action, skip, edge, rejected);
  const wait = (name, type) => code(name, `const date=$json.data?.deadlineAt;if(!date||new Date(date)<=new Date())return [{json:{outcome:'DEAD',errorCode:'DEADLINE_EXPIRED'}}];return [{json:{outcome:'WAITING',waitFor:{type:'${type}',entityId:${job}.entity.id},deadlineAt:new Date(date).toISOString()}}];`);

  if (workflowId === "WF-08") {
    const apply = step("Job", "Apply class plan", "classes", "/internal/classes/changes", "classes.change", "apply", "['EXECUTED','REVOKED','REJECTED','EXPIRED'].includes($json.data?.status)");
    const pending = branch("Class plan waiting", "$json.data?.status==='WAITING'"); link(apply, pending);
    link(pending, wait("Wait for class resolution", "enrollment.class_change_resolution")); link("Wait for class resolution", "Result payload");
    link(pending, "Done", 1);
  } else if (workflowId === "WF-10") {
    const send = step("Job", "Deliver intent", "notification", "/internal/notification/intents", "notification.deliver", "send", "['SENT','SUPERSEDED','FAILED','UNKNOWN'].includes($json.data?.status)");
    const known = branch("Delivery known", "$json.data?.status!=='UNKNOWN'"); link(send, known); link(known, "Done");
    link(known, code("Delivery unresolved", "return [{json:{outcome:'DEAD',errorCode:'DELIVERY_UNKNOWN'}}];"), 1); link("Delivery unresolved", "Result payload");
  } else {
    const seatRejections = ["SOLD_OUT", "TARGET_UNAVAILABLE", "CLASS_CHANGED", "NOT_OPEN", "HOLD_EXPIRED", "TARGET_HOLD_EXPIRED", "TARGET_HOLD_REQUIRED", "TARGET_CHANGED", "DUPLICATE_LEARNER", "CLASS_CHANGE_STALE", "CLASS_INCOMPLETE", "REGISTRATION_CLOSED"];
    const rejectedPlan = { "Fail target": ["QUOTE_CHANGED", "CLASS_CHANGE_NOT_CURRENT", "STALE_ENTITLEMENT", "CONSENT_REQUIRED", "SUSPENSION_EXPIRED", "TARGET_HOLD_REQUIRED"] };
    const prepare = enrollment("Job", "Prepare adjustment", "prepare", `${terminal} || ['PREPARED','COMMITTING','TARGET_COMMITTED','APPLIED'].includes($json.data?.status)`, 0, rejectedPlan);
    const finished = branch("Adjustment terminal", terminal); link(prepare, finished);
    const revoked = branch("Adjustment needs cleanup", "['FAILED','REVOKED','EXPIRED'].includes($json.data?.status) && !!$json.data?.target"); link(finished, revoked);
    link(revoked, "Compensation entry"); link(revoked, "Done", 1);
    const needsTarget = branch("Needs target seat", "['TRANSFER','RESUME','WAITLIST'].includes($json.data?.type) && ['PREPARED','COMMITTING'].includes($json.data?.status)"); link(finished, needsTarget, 1);
    const held = classes(needsTarget, "Hold target seat", "hold-target", "['HELD','COMMITTED'].includes($json.data?.targetHold?.status)", 0,
      { "Fail target": seatRejections });
    const reserve = payment(held, "Settle before target commit", "settle", "['RESERVED','EXECUTED'].includes($json.data?.status)", 0, { "Fail target": seatRejections });
    const paid = branch("Target payment ready", "['RESERVED','EXECUTED'].includes($json.data?.status)"); link(reserve, paid);
    link(paid, "Check payment waiting", 1);
    const beginCommit = enrollment(paid, "Fence target commit", "begin-target-commit", "$json.data?.status==='COMMITTING'", 0, rejectedPlan);
    const commit = classes(beginCommit, "Commit target seat", "commit-target", "$json.data?.targetHold?.status==='COMMITTED'", 0,
      { "Fail target": seatRejections });
    const committed = enrollment(commit, "Record target commit", "target-committed", "['TARGET_COMMITTED','APPLIED','EXECUTED'].includes($json.data?.status)");
    const needsRefund = branch("Needs refund reservation", "$json.data?.type==='REFUND' && $json.data?.status==='PREPARED'"); link(needsTarget, needsRefund, 1);
    const reservation = payment(needsRefund, "Reserve refund cap", "settle", "$json.data?.reserved===true || $json.data?.status==='EXECUTED'");
    const reserved = branch("Refund reserved", "$json.data?.reserved===true || ['RESERVED','EXECUTED'].includes($json.data?.status)"); link(reservation, reserved);
    link(reserved, "Check payment waiting", 1);
    code("Apply entry", "return [{json:$json}];"); link(committed, "Apply entry"); link(needsRefund, "Apply entry", 1); link(reserved, "Apply entry");
    const applied = enrollment("Apply entry", "Apply entitlement", "apply", "['APPLIED','EXECUTED'].includes($json.data?.status)");
    const shouldRelease = branch("Needs source release", "!($json.data?.type==='REFUND' && $json.data?.refundMode==='EXCESS')"); link(applied, shouldRelease);
    const released = classes(shouldRelease, "Release source seat", "release-source", "!['HELD','COMMITTED'].includes($json.data?.sourceHold?.status)");
    const sourceReleased = enrollment(released, "Record source release", "source-released", "$json.data?.sourceReleased===true");
    const needsSettlement = branch("Needs final settlement", `${j(applied)}.data?.type!=='SUSPEND'`); link(sourceReleased, needsSettlement); link(shouldRelease, needsSettlement, 1);
    const settle = payment(needsSettlement, "Settle final amount", "settle", "$json.data?.status==='EXECUTED'");
    const settled = branch("Final payment ready", "$json.data?.status==='EXECUTED'"); link(settle, settled); link(settled, "Check payment waiting", 1);
    code("Complete entry", "return [{json:$json}];"); link(settled, "Complete entry"); link(needsSettlement, "Complete entry", 1);
    link(enrollment("Complete entry", "Complete adjustment", "complete", "$json.data?.status==='EXECUTED'"), "Done");
    branch("Check payment waiting", "$json.data?.status==='WAITING'");
    link("Check payment waiting", wait("Wait for accounting", "payment.adjustment_authorized")); link("Wait for accounting", "Result payload");
    const capFailed = branch("Refund exceeds cap", "$json.data?.errorCode==='REFUND_CAP_EXCEEDED'");
    link("Check payment waiting", capFailed, 1); link(capFailed, "Fail target");
    link(capFailed, code("Payment unresolved", "return [{json:{outcome:'DEAD',errorCode:$json.data?.status==='UNKNOWN'?'PAYMENT_UNKNOWN':'PAYMENT_DENIED'}}];"), 1); link("Payment unresolved", "Result payload");
    code("Fail target", "return [{json:$json}];");
    const failed = enrollment("Fail target", "Mark target failure", "fail", terminal);
    const hasTarget = branch("Failed target exists", "!!$json.data?.target"); link(failed, hasTarget);
    link(hasTarget, "Compensation entry"); link(hasTarget, "Done", 1);
    code("Compensation entry", "return [{json:$json}];");
    const release = classes("Compensation entry", "Release failed target", "release-target", "$json.data?.targetHold?.status!=='HELD'");
    link(payment(release, "Reverse failed target charge", "compensate", "$json.data?.status==='REVOKED'"), "Done");
  }
  code("Done", `return [{json:{outcome:'DONE',resultRef:'${spec.type}:'+${job}.entity.id}}];`); link("Done", "Result payload");
  code("Classify failure", `
const error=$json.error;
const code=typeof error?.code==='string'?error.code:'';
const timeout=['ECONNABORTED','ETIMEDOUT','ADAPTER_TIMEOUT'].includes(code);
const network=['ECONNRESET','ECONNREFUSED','EPIPE','ENETUNREACH','EAI_AGAIN'].includes(code);
const retryCodes=['DEPENDENCY_UNAVAILABLE','SOURCE_UNAVAILABLE','UPSTREAM_UNAVAILABLE','IDENTITY_UNAVAILABLE','RATE_LIMITED','RETRY_OPERATION'];
if(timeout||network||!code||retryCodes.includes(code))return [{json:{outcome:'RETRY',errorCode:timeout?'TIMEOUT':network?'NETWORK_ERROR':code==='RATE_LIMITED'?code:'UPSTREAM_UNAVAILABLE'}}];
return [{json:{outcome:'DEAD',errorCode:/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'DOMAIN_DENIED'}}];`);
  link("Classify failure", "Result payload");
  code("Result payload", `${version()}return [{json:{${fence},expectedVersion:version,step:'result',...$json}}];`);
  link("Result payload", http("Result", bridge("result"), "$json"));

  const nodeNames = new Set(nodes.map(n => n.name));
  for (const [from, edges] of Object.entries(connections)) {
    assert(nodeNames.has(from)); for (const edge of edges.main.flat()) assert(nodeNames.has(edge.node), edge.node);
  }
  for (const node of nodes.filter(n => n.type.endsWith(".code"))) new Function("$", "$json", node.parameters.jsCode);
  const file = `workflows/n8n/${workflowId.toLowerCase()}.json`;
  const bytes = JSON.stringify([{ id, name: `N8N06 ${workflowId}`, active: false, nodes, connections,
    settings: { executionOrder: "v1", executionTimeout: 55, saveDataErrorExecution: "none", saveDataSuccessExecution: "none", saveManualExecutions: false }, pinData: {}, tags: [] }], null, 2) + "\n";
  manifest.workflows.push({ id, workflowId, workflowVersion: 1, inputSchemaVersion: 1, eventType: spec.event, file, sha256: sha(bytes), credentialId, credential });
  if (process.argv.includes("--check")) assert.equal(await readFile(file, "utf8"), bytes, `${file} drift`);
  else await writeFile(file, bytes);
}
const file = "workflows/n8n/adjustment-manifest.json", bytes = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) assert.equal(await readFile(file, "utf8"), bytes, `${file} drift`);
else await writeFile(file, bytes);
