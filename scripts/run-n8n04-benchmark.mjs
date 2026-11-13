// Authorized final-checksum benchmark only; no broad regression, personal env or resume path.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { withAcceptanceRuntime, lookupFinishedJob } from "./n8n04-runtime.mjs";
import { parseN8nOutput } from "./n8n-output.mjs";
import { model, providerAccounting, selectBenchmarkCases, authorityFailure, plannedModelRequests } from "./n8n04-benchmark-guard.mjs";
import { clarificationModel, clarificationText, needsClarification } from "./n8n04-clarification.mjs";
import { humanRequested, humanRuleModel } from "./n8n04-handoff.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
assert.equal(process.argv.length, 3, "A new budget-confirmed preflight file is required; never reuse the stopped run grant");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const preflightFile = process.argv[2];
assert.match(preflightFile, /^\.local\/automation\/[a-z0-9-]+\/preflight\.json$/);
const preflight = await json(preflightFile);
assert.equal(preflight.authorization.status, "NEW_RUN_BUDGET_CONFIRMED");
assert(Number.isInteger(preflight.authorization.priorRequestAttempts) && preflight.authorization.priorRequestAttempts >= 0);
assert.equal(preflight.authorization.maxRequestsPerCase, 2);
assert.equal(preflight.authorization.maxCostUsd, 0);
assert.equal(preflight.authorization.retries, 0);
assert.equal(preflight.authorization.probeRequests, 0);
assert.equal(preflight.authorization.paidFallback, false);
assert(Number.isInteger(preflight.authorization.maxRequests) && preflight.authorization.maxRequests > 0 && preflight.authorization.maxRequests <= 20);
assert(Number.isInteger(preflight.authorization.totalAuthorizedRequests) && preflight.authorization.priorRequestAttempts + preflight.authorization.maxRequests <= preflight.authorization.totalAuthorizedRequests);
assert.equal(preflight.status, "PREFLIGHT_PASS_INFERENCE_PENDING");
if (preflight.authorization.dailyLimit === 50) {
  assert.equal(preflight.authorization.utcDate, new Date().toISOString().slice(0, 10), "Grant is from another UTC day");
  assert(Number.isInteger(preflight.authorization.dailyAttemptsBefore) && preflight.authorization.dailyAttemptsBefore >= 0);
  assert(preflight.authorization.dailyAttemptsBefore + preflight.authorization.maxRequests <= 50, "UTC daily attempt cap");
  assert(preflight.authorization.maxRequests <= preflight.authorization.quotaRemainingBefore, "Live free quota cap");
}
const directory = `.local/automation/n8n04-model-benchmark-${randomBytes(6).toString("hex")}`;
await mkdir(directory, { recursive: true });
const corpus = await json("workflows/n8n/chat-benchmark.json");
const tests = selectBenchmarkCases(corpus, preflight.caseIds);
const receipt = { checkedAt: new Date().toISOString(), timezone: "Asia/Saigon", status: "NOT_STARTED", authorization: preflight.authorization, selectedCaseIds: tests.map(row => row.id), preflightFile, preflightSha256: sha(await readFile(preflightFile)), cases: corpus.map(c => ({ ...c, selected: tests.some(row => row.id === c.id), status: "SKIP", reason: "Not yet executed", actual: null })), fixtures: [], ...providerAccounting({ requests: [] }), credentialRead: false, humanReviewPending: true, pilotAccepted: false, customerRollout: "BLOCKED" };
const evidenceFile = "workflows/n8n/chat-hardening-evidence.json";
const evidenceBefore = await readFile(evidenceFile);
await writeFile(`${directory}/evidence-before.json`, evidenceBefore, { flag: "wx" });
const save = () => writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
let guardStateFile;
try {
  const baseline = await json(evidenceFile);
  let priorAttempts = 0, prior;
  const seen = new Map();
  for (const entry of Object.values(baseline)) {
    const attempts = entry?.newProviderRequestAttempts ?? entry?.providerRequestAttempts;
    if (!entry?.rawReceipt) continue;
    assert(Number.isInteger(attempts) && attempts >= 0, "Prior request attempt count is unknown");
    for (const ref of [entry.rawReceipt, entry.receipt].filter(Boolean)) {
      assert(preflight.receiptChecks.some(bound => bound.file === ref.file && bound.sha256 === ref.sha256), "All prior spent request receipts must remain bound");
      assert.equal(sha(await readFile(ref.file)), ref.sha256, ref.file);
    }
    const raw = await json(entry.rawReceipt.file);
    assert.equal(raw.providerRequestAttempts ?? raw.providerRequests, attempts, "Prior raw receipt attempt count mismatch");
    if (seen.has(entry.rawReceipt.file)) { assert.deepEqual(seen.get(entry.rawReceipt.file), [entry.rawReceipt.sha256, attempts]); continue; }
    if (entry.priorRequestAttempts !== undefined) assert.equal(entry.priorRequestAttempts, priorAttempts);
    priorAttempts += attempts;
    if (entry.cumulativeProviderRequestAttempts !== undefined) assert.equal(entry.cumulativeProviderRequestAttempts, priorAttempts);
    seen.set(entry.rawReceipt.file, [entry.rawReceipt.sha256, attempts]);
    if (entry.sourceChecks) prior = entry;
  }
  assert(prior && seen.size, "Verified provider history is required");
  assert.equal(preflight.authorization.priorRequestAttempts, priorAttempts);
  receipt.boundPriorRequestAttempts = priorAttempts;
  receipt.plannedModelRequests = plannedModelRequests(tests);
  if (!preflight.syntheticOnly) assert(receipt.plannedModelRequests <= preflight.authorization.maxRequests, "Insufficient budget for selected functional cases; stop before any inference");
  const allowedChanges = new Set(["scripts/run-n8n04-benchmark.mjs", "scripts/n8n04-benchmark-guard.mjs", "scripts/n8n04-benchmark-guard.test.mjs", "scripts/build-chat-workflows.mjs", "scripts/accept-n8n04.mjs", "scripts/n8n04-fixture.mjs", "scripts/n8n04-acceptance-cases.mjs", "scripts/n8n04-workflow.test.mjs", "scripts/n8n04-clarification.mjs", "workflows/n8n/wf-02.json", "workflows/n8n/chat-manifest.json", "packages/contracts/src/machine.ts", "packages/auth/src/index.ts", "services/identity/src/machine.ts", "services/class-schedule/src/app.ts", "scripts/n8n04-runtime.mjs", "scripts/test-chat-faults.mjs", "services/conversation/src/workflow.test.ts", "scripts/test-automation.mjs", "scripts/test-chat-browser.mjs"]);
  for (const [file, expected] of Object.entries(prior.sourceChecks)) {
    assert(Object.hasOwn(preflight.sourceChecks, file), file);
    if (preflight.sourceChecks[file] !== expected) {
      assert(allowedChanges.has(file) || ["workflows/n8n/wf-01.json", "workflows/n8n/wf-03.json", "scripts/prepare-authorized-n8n04.mjs", "scripts/n8n04-price-filter.mjs", "scripts/n8n04-price-filter.test.mjs", "services/conversation/src/privacy.ts", "services/conversation/src/privacy.test.ts", "scripts/n8n04-model.mjs", "scripts/test-n8n03-command.mjs", "scripts/n8n04-runtime.test.mjs", "services/automation-bridge/src/auth.ts", "services/automation-bridge/src/machine.test.ts"].includes(file), `Unreviewed source change: ${file}`);
      assert.deepEqual(preflight.sourceChanges?.[file], { beforeSha256: expected, sha256: preflight.sourceChecks[file] }, file);
    }
  }
  for (const file of ["scripts/run-n8n04-benchmark.mjs", "scripts/n8n04-benchmark-guard.mjs", "scripts/n8n04-benchmark-guard.test.mjs"]) assert.equal(preflight.sourceChecks[file], sha(await readFile(file)), file);
  for (const [file, expected] of Object.entries(preflight.sourceChecks)) assert.equal(sha(await readFile(file)), expected, file);
  for (const ref of preflight.receiptChecks) assert.equal(sha(await readFile(ref.file)), ref.sha256, ref.file);
  await writeFile(path.join(path.dirname(preflightFile), "benchmark-started.json"), JSON.stringify({ preflightSha256: receipt.preflightSha256, receipt: `${directory}/receipt.json`, startedAt: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 });
  // Repeat only read-only Engine diagnostics; never start Desktop or existing projects.
  receipt.commands = [];
  try {
    for (const args of [["context", "show"], ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], ["version", "--format", "{{.Server.Version}}"]]) {
      const stdout = execFileSync("docker", args, { encoding: "utf8", timeout: 15000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
      receipt.commands.push({ command: "docker " + args.join(" "), status: "PASS", stdout });
    }
  } catch { receipt.status = "SKIP_ENGINE_UNAVAILABLE"; throw new Error("Local Docker Engine unavailable; no runtime started"); }
  await withAcceptanceRuntime(async h => {
    const workflows = ["WF-01", "WF-02", "WF-03"];
    const scopes = ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize", "automation:read"];
    const worker = await h.iamCall("/internal/iam/principals", { id: "chat-worker", workflows, grants: [{ audience: "automation-bridge", scopes }, { audience: "catalog", scopes: ["catalog:read"] }, { audience: "class-schedule", scopes: ["classes:read"] }] }, h.operator.accessToken);
    const source = await h.iamCall("/internal/iam/principals", { id: "channel-source", workflows: ["WF-02"], grants: [{ audience: "conversation", scopes: ["channel:context"] }] }, h.operator.accessToken);
    const branch = randomUUID();
    const db = new pg.Pool({ connectionString: h.domainUrls.conversation }), classesDb = new pg.Pool({ connectionString: h.domainUrls["class-schedule"] });
    const call = async (port, route, token, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", connection: "close", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      assert(response.ok, `Local API ${route}: ${response.status}`); return (await response.json()).data;
    };
    const chat = (route, token, body) => call(h.chatPort, route, token, body);
    const traceRefs = [];
    const importFile = (file, kind = "workflow") => { h.compose("cp", path.resolve(file), "n8n:/home/node/.n8n/smoke/benchmark.json"); h.cli(`import:${kind}`, "--input=/home/node/.n8n/smoke/benchmark.json"); };
    async function execute(wf, id) {
      const output = h.cli("execute", `--id=N8N04${wf.replaceAll("-", "")}`, "--rawOutput");
      const file = path.join(h.directory, `${id}-${wf}-execution-private.json`);
      await writeFile(file, output, { mode: 0o600 });
      const result = parseN8nOutput(output).data.resultData;
      assert.equal(result.error, undefined, `${id} ${wf} execution error; see private trace`);
      let job = result.runData.Result?.[0]?.data?.main?.[0]?.[0]?.json?.data;
      const reconciled = !job;
      if (!job) job = await lookupFinishedJob(h, worker, wf, result.runData.Job?.[0]?.data?.main?.[0]?.[0]?.json);
      assert.equal(job?.status, "DONE", `${id} ${wf} must finish exactly once; no retry`);
      const executionId = h.sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='N8N04${wf.replaceAll("-", "")}' ORDER BY id::bigint DESC LIMIT 1`);
      const ref = { file, sha256: sha(output), jobId: job.jobId, executionId, workflowId: wf, status: job.status, eventId: job.eventId, conversationId: job.entity.id, resultReconciledByLookup: reconciled };
      traceRefs.push(ref); return { result, ref };
    }
    try {
      await h.startService("conversation", { DATABASE_URL: h.domainUrls.conversation, PORT: String(h.chatPort), HOST: "0.0.0.0", CHAT_BRANCH_ID: branch, AUTOMATION_BRIDGE_URL: `http://127.0.0.1:${h.bridgePort}`, CHANNEL_CLIENT_ID: "channel-source", CHANNEL_CLIENT_SECRET: source.clientSecret, AI_FREE_MODEL_READY: "true", CHAT_PROVIDER_DATA_POLICY: "synthetic-only" });
      for (const [pool, table] of [[db, "conversations"], [classesDb, "classes"]]) assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 0);
      const policyText = "DEMO: Chính sách hoàn tiền/chuyển lớp chưa công bố; cần tư vấn viên. Chat chỉ tư vấn, không giữ chỗ hay tạo đơn.";
      const course = await call(h.catalogPort, "/api/v1/courses", h.operator.accessToken, { code: "N8N04-DEMO-EXCEL", name: "DEMO — Excel cơ bản", description: "Dữ liệu kiểm thử tổng hợp", goal: "Học hàm Excel cơ bản và xử lý bảng tính", level: "beginner", deliveryModes: ["online"], branchIds: [branch], priceVnd: 100000, status: "active", policyText });
      const offer = await call(h.catalogPort, "/api/v1/packages", h.operator.accessToken, { courseId: course.id, code: "N8N04-DEMO-ONE", name: "DEMO — Excel online một buổi", sessionCount: 1, priceVnd: 100000, status: "active", policyText });
      const classId = randomUUID(), start = new Date(Date.now() + 14 * 86400000), end = new Date(start.getTime() + 3600000), closes = new Date(Date.now() + 10 * 86400000);
      await classesDb.query("INSERT INTO classes(id,code,name,course_id,package_id,branch_id,mode,capacity,minimum_size,registration_closes_at,decision_at,status,session_count) VALUES($1,$2,$3,$4,$5,$6,'online',10,1,$7,$8,'OPEN',1)", [classId, "N8N04-DEMO-CLASS", "DEMO — Excel online", course.id, offer.id, branch, closes, new Date(Date.now() + 11 * 86400000)]);
      await classesDb.query("INSERT INTO sessions(id,class_id,starts_at,ends_at) VALUES($1,$2,$3,$4)", [randomUUID(), classId, start, end]);
      const canonical = Object.fromEntries(await Promise.all(workflows.map(async wf => [wf, await json(`workflows/n8n/${wf.toLowerCase()}.json`)])));
      const nodes = canonical["WF-02"][0].nodes;
      const node = name => nodes.find(n => n.name === name);
      const systemPrompt = new Function("$json", node("Prompt").parameters.jsCode)({ data: { providerAllowed: true, modelReady: true, messages: [] } })[0].json.messages[0].content;
      const planner = new Function("$json", `return (${node("Model tool request").parameters.jsonBody.slice(3, -2)});`)({ messages: [] });
      const answer = new Function("$", `return (${node("Model answer").parameters.jsonBody.slice(3, -2)});`)(name => ({ first: () => ({ json: name === "Prompt" ? { messages: [] } : name === "Tool allowlist" ? { assistant: { tool_calls: [{ id: "offline" }] } } : { data: {} } }) }));
      const fields = (item, keys) => Object.fromEntries(keys.map(k => [k, item[k]]));
      const toolData = { courses: [fields(course, ["id", "name", "goal", "level", "deliveryModes", "policyText", "policyVersion"])], packages: [fields(offer, ["id", "courseId", "name", "sessionCount", "priceVnd", "policyText", "policyVersion"])], classSnapshot: { id: classId, name: "DEMO — Excel online", courseId: course.id, packageId: offer.id, mode: "online", registrationClosesAt: closes.toISOString(), status: "OPEN", version: 1, sessions: [{ startsAt: start.toISOString(), endsAt: end.toISOString() }], available: 10 }, notice: "Availability snapshot only; Class sellable=true is disabled. No hold/sale guarantee." };
      const seedFile = path.join(h.directory, "synthetic-corpus.json");
      await writeFile(seedFile, JSON.stringify({ branch, toolData, benchmark: tests }, null, 2) + "\n", { mode: 0o600 });
      receipt.corpus = { file: seedFile, sha256: sha(await readFile(seedFile)), synthetic: true, customerData: false };
      assert.equal(h.sql("SELECT count(*) FROM workflow_entity"), "0"); assert.equal(h.sql("SELECT count(*) FROM credentials_entity"), "0");
      receipt.emptyDbBeforeImport = { workflowCount: 0, credentialCount: 0, conversationsBeforeSeed: 0, classesBeforeSeed: 0 };
      h.compose("exec", "-T", "n8n", "mkdir", "-p", "/home/node/.n8n/smoke");
      const guardPort = await h.freePort(), capability = randomBytes(32).toString("hex");
      const guardFile = path.join(h.directory, "benchmark-guard-private.json");
      await writeFile(guardFile, JSON.stringify({ authorization: "NEW_RUN_BUDGET_CONFIRMED", maxRequests: preflight.authorization.maxRequests, utcDate: preflight.authorization.utcDate, port: guardPort, capability, cases: tests, systemPrompt, plannerTools: planner.tools, answerTools: answer.tools, toolData }), { mode: 0o600 });
      guardStateFile = path.join(h.directory, "provider-ledger-private.json");
      const guardControl = async (route, body) => {
        // Docker CLI blocks this process between calls; do not retain an idle socket across it.
        const response = await fetch(`http://127.0.0.1:${guardPort}${route}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${capability}`, "content-type": "application/json", connection: "close" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(2000) });
        receipt.guardControls ??= []; receipt.guardControls.push({ route, status: response.status });
        assert(response.ok, `Local benchmark guard control ${route}: ${response.status}`); return response.json();
      };
      const fd = openSync(path.join(h.directory, "benchmark-guard-private.log"), "w");
      const guardProcess = spawn(process.execPath, ["scripts/n8n04-benchmark-guard.mjs", guardFile], { cwd: h.root, windowsHide: true, env: {}, stdio: ["ignore", fd, fd] });
      closeSync(fd); h.children.push(guardProcess);
      for (let i = 0; ; i++) { try { await guardControl("/state"); break; } catch { assert(i < 50, "Guard did not start; inspect private log"); await new Promise(r => setTimeout(r, 100)); } }
      receipt.credentialRead = true;
      const credentials = workflows.map(wf => ({ id: `N8N04${wf}Machine`, name: `${wf}-machine-client`, type: "httpCustomAuth", data: { json: JSON.stringify({ body: { clientId: "chat-worker", clientSecret: worker.clientSecret } }) } }));
      credentials.push({ id: "N8N04BenchmarkGuard", name: "benchmark-local-capability", type: "httpHeaderAuth", data: { name: "Authorization", value: `Bearer ${capability}` } });
      const credentialsFile = path.join(h.directory, "benchmark-credentials-private.json");
      await writeFile(credentialsFile, JSON.stringify(credentials), { mode: 0o600 }); importFile(credentialsFile, "credentials");
      async function fixture(wf, id) {
        const original = canonical[wf], copy = structuredClone(original);
        Object.assign(copy[0].settings, { saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true });
        for (const current of copy[0].nodes) {
          if (current.parameters.url) for (const [from, to] of [[4002, h.iamPort], [4006, h.bridgePort], [4007, h.chatPort], [4001, h.catalogPort], [4004, h.classesPort]]) current.parameters.url = current.parameters.url.replaceAll(`:${from}/`, `:${to}/`);
          if (["Model tool request", "Model answer"].includes(current.name)) {
            current.parameters.url = `http://host.docker.internal:${guardPort}/${current.name === "Model answer" ? "answer" : "planner"}/${id}`;
            current.credentials = { httpHeaderAuth: { id: "N8N04BenchmarkGuard", name: "benchmark-local-capability" } };
          }
          if (current.parameters.url) current.parameters.url = current.parameters.url.replaceAll("http://host.docker.internal:", `http://${h.backendHost}:`);
        }
        assert.deepEqual(copy[0].connections, original[0].connections); assert.equal(copy[0].active, false);
        const diff = { nodes: copy[0].nodes.flatMap(n => { const before = original[0].nodes.find(v => v.name === n.name); if (before.parameters.jsCode) assert.equal(n.parameters.jsCode, before.parameters.jsCode); return JSON.stringify(before) === JSON.stringify(n) ? [] : [{ node: n.name, before, after: n }]; }), settings: { before: original[0].settings, after: copy[0].settings } };
        const file = path.join(h.directory, `${id}-${wf}.json`), diffFile = file + ".diff.json";
        await writeFile(file, JSON.stringify(copy, null, 2) + "\n"); await writeFile(diffFile, JSON.stringify(diff, null, 2) + "\n");
        const ref = { workflowId: wf, caseId: id, canonicalSha256: sha(await readFile(`workflows/n8n/${wf.toLowerCase()}.json`)), file, sha256: sha(await readFile(file)), diffFile, diffSha256: sha(await readFile(diffFile)) };
        receipt.fixtures.push(ref); importFile(file); return ref;
      }
      await fixture("WF-01", "routing"); await fixture("WF-03", "handoff");
      for (const row of receipt.cases.filter(row => row.selected)) {
        const guardBefore = await guardControl("/state"); if (guardBefore.stopped) break;
        row.status = "FAIL"; delete row.reason; await save();
        row.fixture = await fixture("WF-02", row.id);
        assert.equal(h.sql("SELECT count(*) FROM workflow_entity WHERE active=true"), "0");
        await guardControl(`/begin/${row.id}`, {});
        const session = await chat("/api/v1/chat/session", "", { consent: true });
        const input = { clientMessageId: randomUUID(), text: row.input };
        await chat("/api/v1/chat/messages", session.token, input);
        // Wait for the exact synthetic event; do not poll/retry n8n after a model call.
        const waitJob = async wf => { for (let i = 0; ; i++) { const { rows } = await h.pool.query("SELECT id FROM automation_jobs WHERE workflow_id=$1 AND entity->>'id'=$2 AND status='PENDING'", [wf, session.conversationId]); if (rows.length) return; assert(i < 80, "Synthetic job not received"); await new Promise(r => setTimeout(r, 100)); } };
        await waitJob("WF-01"); row.routing = (await execute("WF-01", row.id)).ref;
        await waitJob("WF-02"); const execution = await execute("WF-02", row.id); row.execution = execution.ref;
        const run = execution.result.runData, value = name => run[name]?.[0]?.data?.main?.[0]?.[0]?.json;
        const deniedAuthority = authorityFailure(run);
        if (deniedAuthority) { row.authorityFailure = deniedAuthority; await guardControl("/stop", { reason: "AUTHORITY_DENIED" }); }
        row.actual = await chat("/api/v1/chat/history", session.token);
        assert.equal(row.execution.conversationId, session.conversationId);
        assert(!value("Submit draft")?.error && value("Submit draft")?.data, "Draft denied");
        const draft = value("Selected draft"), job = value("Job");
        if (!deniedAuthority && draft.errorCode === "TOOL_ERROR") await guardControl("/stop", { reason: "TOOL_FAILURE" });
        const clarification = !!run["Clarification answer"];
        const human = !!run["Explicit handoff"];
        assert.equal(human, humanRequested([{ sender: "GUEST", text: row.input }]));
        assert.equal(clarification, needsClarification([{ sender: "GUEST", text: row.input }]));
        row.responseKind = human ? "EXPLICIT_HANDOFF_RULE" : clarification ? "CLARIFICATION_TEMPLATE" : "MODEL";
        row.sourcePolicyFooterAdded = !clarification && !draft.errorCode && draft.text !== value("Model answer")?.choices?.[0]?.message?.content;
        assert.equal(draft.model, human ? humanRuleModel : clarification ? clarificationModel : model); assert.equal(draft.jobId, row.execution.jobId); assert.equal(draft.leaseToken, job.leaseToken);
        const jobDb = (await h.pool.query("SELECT status,attempt,entity FROM automation_jobs WHERE id=$1", [row.execution.jobId])).rows[0];
        assert.equal(jobDb.status, "DONE"); assert.equal(jobDb.attempt, 1); assert.equal(jobDb.entity.id, session.conversationId);
        const messages = (await db.query("SELECT conversation_id,sender,text,model,delivery FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at,id", [session.conversationId])).rows;
        const audit = (await db.query("SELECT action FROM conversation_audit WHERE conversation_id=$1", [session.conversationId])).rows.map(v => v.action);
        const events = Number((await db.query("SELECT count(*) FROM event_outbox WHERE event->>'type'='conversation.handoff_requested' AND event->>'entityId'=$1", [session.conversationId])).rows[0].count);
        if (row.actual.mode === "HUMAN") { assert.equal(messages.length, 1); assert.equal(events, 1); assert.equal(audit.filter(v => v === row.actual.errorCode).length, 1); await waitJob("WF-03"); row.handoff = (await execute("WF-03", row.id)).ref; }
        else {
          assert.equal(messages.length, 2); assert.equal(messages.filter(m => m.sender === "AI" && m.delivery === "DELIVERED").length, 1); assert.equal(events, 0); assert(run["Recheck turn"]);
          if (clarification) { assert(!run["Model tool request"] && !run["Model answer"]); assert.equal(draft.text, clarificationText); }
          else assert(run["Model answer"]);
        }
        await chat("/api/v1/chat/messages", session.token, input);
        assert.equal(Number((await db.query("SELECT count(*) FROM chat_messages WHERE conversation_id=$1", [session.conversationId])).rows[0].count), messages.length);
        const token = value("Renew token").data.accessToken;
        const replay = await fetch(`http://127.0.0.1:${h.chatPort}/internal/conversations/draft`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(draft) });
        assert.equal(replay.status, 409);
        row.dbOutcomes = { conversationId: session.conversationId, messages, audit, handoffEvents: events, jobStatus: jobDb.status, attempt: jobDb.attempt, draftReplayStatus: replay.status, duplicateInboundNoEffect: true };
        row.toolCalls = ["Catalog courses", "Catalog packages", "Class list"].filter(n => run[n]);
        row.provider = (await guardControl("/state")).requests.filter(r => r.caseId === row.id);
        Object.assign(row, providerAccounting({ requests: row.provider }));
        row.modelCalled = row.modelInferenceObserved;
        const state = await guardControl("/state"); receipt.providerRequests = state.requests.length; receipt.guardStopped = state.stopped;
        const valid = human ? row.provider.length === 0 && row.actual.mode === "HUMAN" && draft.errorCode === "HANDOFF" : clarification ? row.provider.length === 0 && row.actual.mode === "AI" && !draft.errorCode : row.provider.length > 0 && row.provider.every(r => r.valid === true) && !row.costUnknown && row.costUsd === 0;
        row.review = "PENDING"; row.status = state.stopped || !valid ? "FAIL" : "NEEDS_REVIEW";
        if (row.status === "FAIL") row.reason = state.stopped ?? "PROVIDER_EVIDENCE_INCOMPLETE";
        Object.assign(receipt, providerAccounting(state)); await save();
        console.log(JSON.stringify({ case: row.id, status: row.status, mode: row.actual.mode, providerRequests: row.provider.length, guardStopped: state.stopped }));
        if (row.status === "FAIL") break;
      }
      if (!receipt.guardStopped && receipt.cases.filter(row => row.selected).every(row => row.status === "NEEDS_REVIEW")) {
        const modelAnswer = receipt.cases.find(row => row.responseKind === "MODEL" && row.actual?.mode === "AI");
        if (modelAnswer) {
          const identityDb = new pg.Pool({ connectionString: h.identityDb });
          try {
            const { hashPassword } = await import("../services/identity/dist/password.js");
            await identityDb.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,'staff-a@n8n04.test','DEMO browser staff',$2,'admissions',$3)", [randomUUID(), await hashPassword("N8N04-synthetic-password"), [branch]]);
          } finally { await identityDb.end(); }
          const { chatBrowser } = await import("./test-chat-browser.mjs");
          receipt.browser = await chatBrowser({ ...h, realAiConversation: modelAnswer.actual.id });
        }
      }
    } finally {
      receipt.traces = traceRefs;
      if (guardStateFile) {
        try {
          const state = await json(guardStateFile);
          Object.assign(receipt, providerAccounting(state)); receipt.guardStopped = state.stopped;
          receipt.providerLedger = { file: guardStateFile, sha256: sha(await readFile(guardStateFile)) };
          for (const row of receipt.cases.filter(c => c.status !== "SKIP")) {
            row.provider = state.requests.filter(r => r.caseId === row.id);
            Object.assign(row, providerAccounting({ requests: row.provider })); row.modelCalled = row.modelInferenceObserved;
          }
        } catch { receipt.providerAccountingUnavailable = true; receipt.costUnknown = true; receipt.costUsd = null; receipt.providerRequests = null; receipt.providerRequestAttempts = null; }
      }
      await db.end(); await classesDb.end(); await save();
    }
  }, receipt);
  receipt.status = receipt.guardStopped ? "STOPPED_BY_APPROVED_GUARD" : receipt.cases.some(c => c.status === "FAIL") ? "BENCHMARK_STOPPED_INCOMPLETE_PROVIDER_EVIDENCE" : "EXECUTED_QUALITY_REVIEW_PENDING";
} catch (error) { if (receipt.status !== "SKIP_ENGINE_UNAVAILABLE") receipt.status = "BENCHMARK_STOPPED"; receipt.error = "Benchmark stopped; inspect private traces and guard ledger"; receipt.failureLocation = String(error.stack).match(/scripts[\\/][\w.-]+\.mjs:\d+:\d+/)?.[0] ?? null; process.exitCode = 1; }
finally {
  for (const row of receipt.cases.filter(c => c.status === "SKIP")) row.reason = !row.selected ? "Not selected in this new grant; still required for ticket acceptance; no provider request made" : receipt.status === "SKIP_ENGINE_UNAVAILABLE" ? "Docker Engine unavailable; no runtime started" : "Run stopped before this case; no provider request made";
  receipt.summary = { passed: receipt.cases.filter(c => c.status === "PASS").length, failed: receipt.cases.filter(c => c.status === "FAIL").length, skipped: receipt.cases.filter(c => c.status === "SKIP").length, reviewPending: receipt.cases.filter(c => c.status === "NEEDS_REVIEW").length };
  receipt.finishedAt = new Date().toISOString();
  receipt.cumulativeProviderRequestAttempts = receipt.boundPriorRequestAttempts === undefined || receipt.providerRequestAttempts === null ? null : receipt.boundPriorRequestAttempts + receipt.providerRequestAttempts;
  try {
    assert.equal(sha(await readFile(evidenceFile)), sha(evidenceBefore), "Public evidence changed during benchmark");
    for (const [file, expected] of Object.entries(preflight.sourceChecks)) assert.equal(sha(await readFile(file)), expected, file);
    receipt.finalIntegrity = "PASS";
  } catch { receipt.finalIntegrity = "FAIL"; receipt.status = "BENCHMARK_STOPPED_SOURCE_INTEGRITY"; process.exitCode = 1; }
  await save();
  if (preflight.authorization.dailyLimit === 50 && !preflight.syntheticOnly && receipt.boundPriorRequestAttempts !== undefined) {
    const index = await json(evidenceFile);
    index[`authorizedBenchmark${directory.split("-").at(-1)}`] = { checkedAt: receipt.finishedAt, priorRequestAttempts: receipt.boundPriorRequestAttempts, newProviderRequestAttempts: receipt.providerRequestAttempts, cumulativeProviderRequestAttempts: receipt.cumulativeProviderRequestAttempts, sourceChecks: preflight.sourceChecks, rawReceipt: { file: `${directory}/receipt.json`, sha256: sha(await readFile(`${directory}/receipt.json`)) }, status: receipt.status, summary: receipt.summary, review: "PENDING", syntheticOnly: false };
    await writeFile(evidenceFile, JSON.stringify(index, null, 2) + "\n");
  }
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, providerRequests: receipt.providerRequests, receipt: `${directory}/receipt.json` }));
}
