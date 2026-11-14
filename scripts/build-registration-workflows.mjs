// Canonical imports stay inactive; deployment supplies machine credentials and service addresses.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const base = Object.fromEntries(Object.entries({ iam: 4002, bridge: 4006, crm: 4005, classes: 4004, enrollment: 4008, payment: 4009 }).map(([name, port]) => [name, `http://host.docker.internal:${port}`]));
const artifacts = [];
const businessErrors = ["SOLD_OUT", "CLASS_CHANGED", "NOT_OPEN", "HOLD_EXPIRED", "INVALID_ENROLLMENT_STATE", "REGISTRATION_CLOSED", "CLASS_INCOMPLETE", "DUPLICATE_LEARNER", "QUOTE_CHANGED", "HOLD_REQUIRED", "CONFIRMATION_EXPIRED", "RECONFIRM_REQUIRED", "ENROLLMENT_NOT_CREATED", "HOLD_LIMIT", "PAYMENT_REQUEST_REQUIRED"];
const noSeatErrors = ["SOLD_OUT", "CLASS_CHANGED", "NOT_OPEN", "HOLD_EXPIRED", "INVALID_ENROLLMENT_STATE", "REGISTRATION_CLOSED", "CLASS_INCOMPLETE", "DUPLICATE_LEARNER", "HOLD_REQUIRED"];

for (const wf of ["WF-04", "WF-05", "WF-06", "WF-07"]) {
  const nodes = [], connections = {}, checkpoints = [], steps = [];
  const job = "$('Job').first().json";
  const machineToken = "$('Machine token').first().json.data.accessToken";
  const credential = `${wf}-machine-client`, credentialId = `N8N05${wf.replaceAll("-", "")}Machine`;
  const add = (name, type, parameters, extra = {}) => {
    assert(!nodes.some(node => node.name === name), `Duplicate node ${name}`);
    nodes.push({ id: name.replaceAll(" ", ""), name, type: `n8n-nodes-base.${type}`, typeVersion: type === "httpRequest" ? 4.2 : type === "code" || type === "if" ? 2 : 1, position: [nodes.length * 220, 200], parameters, ...extra });
    return name;
  };
  const link = (from, to, output = 0) => {
    connections[from] ??= { main: [] }; connections[from].main[output] ??= [];
    connections[from].main[output].push({ node: to, type: "main", index: 0 });
  };
  const code = (name, jsCode) => add(name, "code", { jsCode });
  const branch = (name, expression) => add(name, "if", { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: `={{ ${expression} }}`, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } });
  const http = (name, url, body, token = machineToken) => add(name, "httpRequest", {
    method: body === undefined ? "GET" : "POST", url,
    sendHeaders: true, headerParameters: { parameters: [{ name: "Authorization", value: `={{ 'Bearer ' + ${token} }}` }, { name: "Connection", value: "close" }, ...(url.includes(job) ? [{ name: "x-correlation-id", value: `={{ ${job}.correlationId }}` }] : [])] },
    ...(body === undefined ? {} : { sendBody: true, specifyBody: "json", jsonBody: `={{ ${body} }}` }),
    options: { timeout: 5000, redirect: { redirect: { followRedirects: false } }, response: { response: { neverError: true } } },
  }, { onError: "continueRegularOutput" });
  const bridgeUrl = action => `={{ '${base.bridge}/internal/automation/jobs/' + ${job}.jobId + '/${action}' }}`;
  // The successful checkpoint with the greatest version is the current fence, including compensation branches.
  const versionCode = () => `let version=${job}.version;for(const name of ${JSON.stringify(checkpoints)}){if($(name).isExecuted){const value=$(name).first().json.data?.version;if(Number.isSafeInteger(value))version=Math.max(version,value);}}`;
  const fence = `leaseToken:${job}.leaseToken,attempt:${job}.attempt`;

  add("Manual", "manualTrigger", {});
  add("Poll", "scheduleTrigger", { rule: { interval: [{ field: "seconds", secondsInterval: 5 }] } });
  add("Machine token", "httpRequest", {
    method: "POST", url: `${base.iam}/internal/iam/machine/token`, authentication: "genericCredentialType", genericAuthType: "httpCustomAuth",
    sendBody: true, specifyBody: "json", jsonBody: JSON.stringify({ audience: "automation-bridge", scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize", "automation:read"], workflows: [wf], ttlSeconds: 60 }),
    options: { timeout: 5000, redirect: { redirect: { followRedirects: false } }, response: { response: { neverError: true } } },
  }, { credentials: { httpCustomAuth: { id: credentialId, name: credential } }, onError: "continueRegularOutput" });
  link("Manual", "Machine token"); link("Poll", "Machine token");
  branch("Machine ready", "typeof $json.data?.accessToken === 'string' && !$json.error"); link("Machine token", "Machine ready");
  let entry = "Machine ready";
  if (wf === "WF-07") {
    for (const [name, domain, route] of [["Enrollment deadlines", "enrollment", "deadlines"], ["Review deadlines", "payment", "review-deadlines"]]) {
      http(name, `${base[domain]}/internal/${domain}/${route}`, "{}"); link(entry, name);
      branch(`${name} ready`, "$json.data !== undefined && !$json.error"); link(name, `${name} ready`); entry = `${name} ready`;
    }
  }
  http("Claim", `${base.bridge}/internal/automation/jobs/claim`, JSON.stringify({ workflowId: wf, workflowVersion: 1 })); link(entry, "Claim");
  code("Job", `const job=$json.data;return job&&job.workflowId==='${wf}'&&job.workflowVersion===1&&job.leaseToken&&job.entity?.id&&job.inputRef?[{json:job}]:[];`); link("Claim", "Job");

  function step(name, domain, action, { skip = "false", body = "{}", missing = false, errors = [], failure = "Retry", operation = domain === "classes" ? "classes.enroll" : `${domain}.execute` } = {}) {
    const intent = `${name} intent`, authorize = `${name} authorize`, lookup = `${name} lookup`, mutate = `${name} mutate`, next = `${name} complete`;
    // Prepare the fence in Code so all branches use the latest successful checkpoint.
    code(`${name} fence`, `${versionCode()}return [{json:{${fence},expectedVersion:version,step:'${name.replaceAll(" ", "-").toLowerCase()}',operation:{name:'${operation}'} }}];`);
    http(intent, bridgeUrl("checkpoint"), "$json"); checkpoints.push(intent); link(`${name} fence`, intent);
    branch(`${name} intent ready`, "Number.isSafeInteger($json.data?.version) && !$json.error"); link(intent, `${name} intent ready`); link(`${name} intent ready`, "Retry", 1);
    http(authorize, bridgeUrl("authorize"), `{${fence},operation:'${operation}'}`); link(`${name} intent ready`, authorize);
    branch(`${name} authorized`, "typeof $json.data?.accessToken === 'string' && !$json.error"); link(authorize, `${name} authorized`); link(`${name} authorized`, "Retry", 1);
    const token = `$('${authorize}').first().json.data.accessToken`;
    const path = domain === "crm" ? `${base.crm}/internal/crm/requests/` : `${base[domain]}/internal/${domain}/enrollments/`;
    const resource = domain === "crm" ? `${job}.inputRef` : `${job}.entity.id`;
    http(lookup, `={{ '${path}' + ${resource} }}`, undefined, token); link(`${name} authorized`, lookup);
    branch(`${name} lookup ready`, `(!$json.error && Object.prototype.hasOwnProperty.call($json,'data'))${missing ? " || $json.error?.code === 'NOT_FOUND'" : ""}`); link(lookup, `${name} lookup ready`); link(`${name} lookup ready`, "Retry", 1);
    code(next, "return [{json:$json}];");
    if (action === null) {
      link(`${name} lookup ready`, next); steps.push({ name, domain, action, operation, lookup });
      return { start: `${name} fence`, end: next, lookup };
    }
    branch(`${name} needed`, `!(${skip})`); link(`${name} lookup ready`, `${name} needed`); link(`${name} needed`, next, 1);
    http(mutate, `={{ '${path}' + ${resource} + '/${action}' }}`, body, token); link(`${name} needed`, mutate);
    branch(`${name} saved`, "!$json.error && Object.prototype.hasOwnProperty.call($json,'data')"); link(mutate, `${name} saved`); link(`${name} saved`, next);
    if (errors.length) {
      branch(`${name} business rejection`, `${JSON.stringify(errors)}.includes($json.error?.code)`); link(`${name} saved`, `${name} business rejection`, 1);
      link(`${name} business rejection`, failure); link(`${name} business rejection`, "Retry", 1);
    } else link(`${name} saved`, "Retry", 1);
    steps.push({ name, domain, action, operation, lookup, mutate });
    return { start: `${name} fence`, end: next, lookup, mutate };
  }
  const connect = (from, step, output = 0) => { link(from, step.start, output); return step.end; };
  const released = "$json.data?.hold == null || ['CANCELLED','EXPIRED'].includes($json.data.hold.status)";
  const releaseOptions = { skip: released };

  if (wf === "WF-04") {
    const execute = step("CRM execute", "crm", "execute", { skip: "$json.data?.status === 'DONE'", errors: ["CONSENT_REQUIRED", "STALE_VERSION", "SOURCE_CHANGED", "OPERATION_CONFLICT", "FORBIDDEN"], failure: "Dead" });
    connect("Job", execute);
    branch("CRM durable", "['DONE','PARTIAL'].includes($json.data?.status)"); link(execute.end, "CRM durable"); link("CRM durable", "Done"); link("CRM durable", "Retry", 1);
  }
  if (wf === "WF-05") {
    const create = step("Enrollment create", "enrollment", "create", { missing: true, skip: "!!$json.data", errors: businessErrors, failure: "Dead" });
    connect("Job", create);
    branch("Enrollment already durable", "['NEEDS_CONFIRMATION','CANCELLED','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING','CONFIRMING','CONFIRMED'].includes($json.data?.status)"); link(create.end, "Enrollment already durable"); link("Enrollment already durable", "Done");
    const hold = step("Class hold", "classes", "hold", { skip: "$json.data?.committed === true || ($json.data?.hold?.status === 'HELD' && Date.parse($json.data.hold.expiresAt) > Date.parse($json.data.hold.serverTime))", errors: businessErrors, failure: "Close failed payment fence" });
    let previous = connect("Enrollment already durable", hold, 1);
    previous = connect(previous, step("Enrollment held", "enrollment", "held", { skip: "$json.data?.status !== 'PENDING_HOLD'", errors: businessErrors, failure: "Close failed payment fence" }));
    previous = connect(previous, step("Payment create", "payment", "create", { skip: "!!$json.data", errors: businessErrors, failure: "Close failed payment fence" }));
    previous = connect(previous, step("Enrollment payment", "enrollment", "payment", { skip: "!!$json.data?.paymentRequestId", errors: businessErrors, failure: "Close failed payment fence" }));
    link(previous, "Done");
    const close = step("Close failed payment", "payment", "close", { skip: "!$json.data || ['CANCELLED','EXPIRED'].includes($json.data.status)", body: "{reason:'FAILED'}" });
    previous = connect(close.end, step("Enrollment failed", "enrollment", "failed", { skip: "$json.data?.releaseAuthorized === true" }));
    branch("Failed release authorized", "$json.data?.releaseAuthorized === true"); link(previous, "Failed release authorized"); link("Failed release authorized", "Done", 1);
    previous = connect("Failed release authorized", step("Release failed hold", "classes", "release", releaseOptions)); link(previous, "Done");
  }
  if (wf === "WF-06") {
    let previous = connect("Job", step("Enrollment confirming", "enrollment", "confirming", { skip: "['CONFIRMING','CONFIRMED'].includes($json.data?.status)" }));
    branch("Already confirmed", "$json.data?.status === 'CONFIRMED'"); link(previous, "Already confirmed"); link("Already confirmed", "Done");
    previous = connect("Already confirmed", step("Class commit", "classes", "commit", { skip: "$json.data?.committed === true && $json.data?.hold?.status === 'COMMITTED'", body: `{matchRef:${job}.inputRef}`, errors: noSeatErrors, failure: "Payment no seat fence" }), 1);
    previous = connect(previous, step("Enrollment confirm", "enrollment", "confirm", { skip: "$json.data?.status === 'CONFIRMED'" })); link(previous, "Done");
    const review = step("Payment no seat", "payment", "exception", { skip: "$json.data?.reviews?.some(review => review.reason === 'NO_SEAT') === true", body: "{reason:'NO_SEAT'}" });
    previous = connect(review.end, step("Enrollment exception", "enrollment", "exception", { skip: "$json.data?.releaseAuthorized === true" }));
    branch("Exception release authorized", "$json.data?.releaseAuthorized === true"); link(previous, "Exception release authorized"); link("Exception release authorized", "Retry", 1);
    previous = connect("Exception release authorized", step("Release exception hold", "classes", "release", releaseOptions)); link(previous, "Done");
  }
  if (wf === "WF-07") {
    const state = step("Enrollment inspect", "enrollment", null);
    let previous = connect("Job", state);
    const cancellation = `$('${state.lookup}').first().json.data.cancelRequested === true`;
    previous = connect(previous, step("Payment close", "payment", "close", { skip: "!$json.data || ['CANCELLED','EXPIRED'].includes($json.data.status)", body: `{reason:(${cancellation})?'CANCEL':'EXPIRE'}` }));
    branch("Cancellation requested", cancellation); link(previous, "Cancellation requested");
    const cancel = step("Enrollment cancel", "enrollment", "cancel", { skip: "$json.data?.releaseAuthorized === true" });
    const reconcile = step("Enrollment reconcile", "enrollment", "reconcile", { skip: "$json.data?.releaseAuthorized === true" });
    connect("Cancellation requested", cancel); connect("Cancellation requested", reconcile, 1);
    branch("Release authorized", "$json.data?.releaseAuthorized === true"); link(cancel.end, "Release authorized"); link(reconcile.end, "Release authorized"); link("Release authorized", "Done", 1);
    previous = connect("Release authorized", step("Class release", "classes", "release", releaseOptions)); link(previous, "Done");
  }

  for (const [name, outcome] of [["Done", "DONE"], ["Retry", "RETRY"], ...(wf === "WF-04" || wf === "WF-05" ? [["Dead", "DEAD"]] : [])]) {
    const ref = wf === "WF-04" ? `'crm-request:'+${job}.inputRef` : `'enrollment:'+${job}.entity.id`;
    code(name, `${versionCode()}return [{json:{${fence},expectedVersion:version,step:'complete',outcome:'${outcome}',resultRef:${ref}${outcome === "RETRY" ? ",errorCode:'UPSTREAM_UNAVAILABLE',retryAfterSeconds:5" : outcome === "DEAD" ? ",errorCode:'BUSINESS_REJECTED'" : ""} }}];`);
    link(name, "Result");
  }
  http("Result", bridgeUrl("result"), "$json");
  const workflow = { id: `N8N05${wf.replaceAll("-", "")}`, name: `${wf} registration v1`, active: false, nodes, connections,
    settings: { executionOrder: "v1", executionTimeout: 55, saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false },
    versionId: `00000000-0000-4000-8000-00000000000${wf.at(-1)}` };

  validate(workflow, steps);
  verifyBranches(workflow);
  const file = `workflows/n8n/${wf.toLowerCase()}.json`;
  await writeFile(file, JSON.stringify([workflow], null, 2) + "\n");
  artifacts.push({ workflowId: wf, version: 1, id: workflow.id, file, sha256: createHash("sha256").update(await readFile(file)).digest("hex"), credential, credentialId, nodes: nodes.length });
}

const bindings = [{ eventType: "crm.requested", workflowId: "WF-04" }, { eventType: "enrollment.requested", workflowId: "WF-05" }, { eventType: "payment.matched", workflowId: "WF-06" }, ...["enrollment.deadline", "enrollment.cancel_requested", "payment.review_required", "payment.review_decided"].map(eventType => ({ eventType, workflowId: "WF-07" }))].map(binding => ({ ...binding, workflowVersion: 1, inputSchemaVersion: 1 }));
await writeFile("workflows/n8n/registration-manifest.json", JSON.stringify({ status: "IMPLEMENTED_NOT_ACCEPTED", syntheticOnly: true, paidFallback: false, canonicalActive: false, workflows: artifacts, bindings }, null, 2) + "\n");
console.log(JSON.stringify({ validated: artifacts.map(({ workflowId, nodes }) => ({ workflowId, nodes })), bindings: bindings.length }));

function validate(workflow, steps) {
  const names = new Set(workflow.nodes.map(node => node.name));
  assert.equal(names.size, workflow.nodes.length);
  assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length);
  assert.equal(workflow.active, false);
  const reachable = new Set(), visiting = new Set();
  function visit(name) {
    assert(names.has(name), `Dangling node ${name}`);
    assert(!visiting.has(name), `Workflow cycle at ${name}`);
    if (reachable.has(name)) return;
    reachable.add(name); visiting.add(name);
    for (const output of workflow.connections[name]?.main ?? []) for (const edge of output ?? []) visit(edge.node);
    visiting.delete(name);
  }
  visit("Manual"); visit("Poll"); assert.equal(reachable.size, names.size, `${workflow.id}: unreachable node`);
  for (const node of workflow.nodes) {
    assert(["manualTrigger", "scheduleTrigger", "httpRequest", "code", "if"].some(type => node.type === `n8n-nodes-base.${type}`));
    assert(!node.retryOnFail, "No blind node retries");
    if (node.type.endsWith("code")) new Function("$", "$json", node.parameters.jsCode);
    if (node.type.endsWith("if")) {
      const expression = node.parameters.conditions.conditions[0].leftValue.slice(3, -2);
      new Function("$", "$json", `return (${expression});`);
    }
    if (node.type.endsWith("httpRequest")) {
      assert.equal(node.parameters.options.timeout, 5000);
      assert.equal(node.parameters.options.redirect.redirect.followRedirects, false);
      assert.equal(node.parameters.options.response.response.neverError, true);
      assert.equal(node.onError, "continueRegularOutput");
      assert.match(node.parameters.url, /http:\/\/host\.docker\.internal:(4002|4004|4005|4006|4008|4009)\//);
    }
    for (const match of JSON.stringify(node.parameters).matchAll(/\$\('([^']+)'\)/g)) assert(names.has(match[1]), `Unknown expression node ${match[1]}`);
  }
  for (const step of steps) {
    const lookup = workflow.nodes.find(node => node.name === step.lookup), mutate = workflow.nodes.find(node => node.name === step.mutate);
    assert.equal(lookup.parameters.method, "GET");
    assert(["crm.execute", "enrollment.execute", "payment.execute", "classes.enroll"].includes(step.operation));
    assert.equal(workflow.connections[`${step.name} authorized`].main[0][0].node, step.lookup);
    if (step.action !== null) {
      assert.equal(mutate.parameters.method, "POST");
      assert.equal(workflow.connections[`${step.name} needed`].main[0][0].node, step.mutate);
    }
  }
  // Code retains the latest successful fence even if a later checkpoint fails or a compensation path runs.
  const finish = workflow.nodes.find(node => node.name === "Retry");
  const fake = name => ({ isExecuted: name === "Job" || name.endsWith(" intent"), first: () => ({ json: name === "Job" ? { version: 2, leaseToken: "lease", attempt: 1, inputRef: "request", entity: { id: "enrollment" } } : { data: { version: name === `${steps.at(-1).name} intent` ? 20 : 3 } } }) });
  const result = new Function("$", "$json", finish.parameters.jsCode)(fake, {});
  assert.equal(result[0].json.expectedVersion, 20); assert.equal(result[0].json.outcome, "RETRY");
}

// Exercise the exported Code/IF expressions and graph against HTTP outcomes, without replacing runtime acceptance.
function verifyBranches(workflow) {
  function run(responses = {}) {
    const executed = new Map(), requests = [], nodes = new Map(workflow.nodes.map(node => [node.name, node]));
    const job = { jobId: "00000000-0000-4000-8000-000000000001", workflowId: workflow.name.slice(0, 5), workflowVersion: 1, leaseToken: "00000000-0000-4000-8000-000000000002", attempt: 1, version: 2, entity: { id: "enrollment" }, inputRef: "request", correlationId: "correlation" };
    let version = job.version, result;
    const $ = name => ({ isExecuted: executed.has(name), first: () => ({ json: executed.get(name) }) });
    const evaluate = (expression, current) => typeof expression === "string" && expression.startsWith("={{") ? new Function("$", "$json", `return (${expression.slice(3, -2)});`)($, current) : expression;
    let name = "Manual", current = {};
    while (name) {
      const node = nodes.get(name); let output = 0;
      if (node.type.endsWith("code")) {
        const rows = new Function("$", "$json", node.parameters.jsCode)($, current);
        if (!rows.length) break; current = rows[0].json;
      } else if (node.type.endsWith("if")) output = evaluate(node.parameters.conditions.conditions[0].leftValue, current) ? 0 : 1;
      else if (node.type.endsWith("httpRequest")) {
        const body = evaluate(node.parameters.jsonBody, current), url = evaluate(node.parameters.url, current);
        requests.push({ name, method: node.parameters.method, url, body });
        if (name === "Result") result = body;
        if (Object.hasOwn(responses, name)) current = responses[name];
        else if (name === "Machine token" || name.endsWith(" authorize")) current = { data: { accessToken: "test-token" } };
        else if (name === "Claim") current = { data: job };
        else if (name.endsWith(" intent")) { assert.equal(body.expectedVersion, version); current = { data: { version: ++version } }; }
        else current = { data: {} };
      }
      executed.set(name, current);
      const edges = workflow.connections[name]?.main[output] ?? [];
      assert(edges.length <= 1, "Static workflow must follow one branch"); name = edges[0]?.node;
    }
    if (result) assert.equal(result.expectedVersion, version);
    return { result, requests, mutated: requests.filter(request => request.name.endsWith(" mutate")).map(request => request.name) };
  }
  assert.equal(run({ Claim: { data: null } }).result, undefined, "Empty claim stops without effects");
  const broken = { error: { message: "socket timed out" } };
  if (workflow.id.endsWith("WF04")) {
    const partial = run({ "CRM execute mutate": { data: { status: "PARTIAL", result: { errorCode: "CONSENT_REQUIRED" } } } });
    assert.equal(partial.result.outcome, "DONE"); assert.equal(partial.result.resultRef, "crm-request:request");
    assert.equal(run({ "CRM execute mutate": broken }).result.outcome, "RETRY");
  }
  if (workflow.id.endsWith("WF05")) {
    const purchase = { "Enrollment create lookup": { error: { code: "NOT_FOUND" } }, "Enrollment create mutate": { data: { status: "PENDING_HOLD" } }, "Enrollment held lookup": { data: { status: "PENDING_HOLD" } }, "Payment create lookup": { data: null } };
    const happy = run(purchase);
    assert.equal(happy.result.outcome, "DONE"); assert.deepEqual(happy.mutated, ["Enrollment create mutate", "Class hold mutate", "Enrollment held mutate", "Payment create mutate", "Enrollment payment mutate"]);
    const unknown = run({ ...purchase, "Payment create mutate": broken });
    assert.equal(unknown.result.outcome, "RETRY"); assert(!unknown.mutated.includes("Close failed payment mutate")); assert(!unknown.mutated.includes("Release failed hold mutate"));
    const recovered = run({ ...purchase, "Payment create lookup": { data: { id: "durable-payment" } } });
    assert.equal(recovered.result.outcome, "DONE"); assert(!recovered.mutated.includes("Payment create mutate"));
    const refused = run({ ...purchase, "Class hold mutate": { error: { code: "SOLD_OUT" } }, "Enrollment failed mutate": { data: { status: "CANCELLED", releaseAuthorized: true } } });
    assert.equal(refused.result.outcome, "DONE"); assert(refused.mutated.includes("Close failed payment mutate")); assert(refused.mutated.includes("Enrollment failed mutate"));
  }
  if (workflow.id.endsWith("WF06")) {
    const unknown = run({ "Class commit mutate": broken });
    assert.equal(unknown.result.outcome, "RETRY"); assert(!unknown.mutated.includes("Payment no seat mutate"));
    const recovered = run({ "Class commit lookup": { data: { committed: true, hold: { status: "COMMITTED" } } } });
    assert.equal(recovered.result.outcome, "DONE"); assert(!recovered.mutated.includes("Class commit mutate")); assert(recovered.mutated.includes("Enrollment confirm mutate"));
    const refused = run({ "Class commit mutate": { error: { code: "SOLD_OUT" } }, "Enrollment exception mutate": { data: { releaseAuthorized: true } } });
    assert.equal(refused.result.outcome, "DONE"); assert(refused.mutated.includes("Payment no seat mutate")); assert(refused.mutated.includes("Enrollment exception mutate"));
  }
  if (workflow.id.endsWith("WF07")) {
    const matched = run({ "Enrollment reconcile mutate": { data: { status: "CONFIRMING", releaseAuthorized: false } } });
    assert.equal(matched.result.outcome, "DONE"); assert(!matched.mutated.includes("Class release mutate"));
    const cancel = run({ "Enrollment inspect lookup": { data: { cancelRequested: true } }, "Enrollment cancel mutate": { data: { status: "CANCELLED", releaseAuthorized: true } }, "Class release lookup": { data: { hold: { status: "HELD" } } } });
    assert.equal(cancel.result.outcome, "DONE"); assert.equal(cancel.requests.find(request => request.name === "Payment close mutate").body.reason, "CANCEL"); assert(cancel.mutated.includes("Class release mutate"));
    const unknown = run({ "Payment close mutate": broken });
    assert.equal(unknown.result.outcome, "RETRY"); assert(!unknown.mutated.includes("Class release mutate"));
  }
}
