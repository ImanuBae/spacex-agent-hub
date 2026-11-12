import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { cases, fixtureWorkflow, modelId, answer, acceptedAnswer, budgetAnswer, acceptedBudgetAnswer, policySources, clarificationModel, clarificationText, humanRuleModel } from "./n8n04-fixture.mjs";
import { parseN8nOutput } from "./n8n-output.mjs";
import { lookupFinishedJob } from "./n8n04-runtime.mjs";

export async function runAcceptance(h, receipt) {
  const workflows = ["WF-01", "WF-02", "WF-03"], scopes = ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize", "automation:read"];
  const principal = await h.iamCall("/internal/iam/principals", { id: "chat-worker", workflows, grants: [{ audience: "automation-bridge", scopes }, { audience: "catalog", scopes: ["catalog:read"] }, { audience: "class-schedule", scopes: ["classes:read"] }] }, h.operator.accessToken);
  const source = await h.iamCall("/internal/iam/principals", { id: "channel-source", workflows: ["WF-02"], grants: [{ audience: "conversation", scopes: ["channel:context"] }] }, h.operator.accessToken);
  const branch = randomUUID(), blocked = await h.freePort(), fixture = await h.freePort();
  const ports = { host: h.backendHost, iam: h.iamPort, bridge: h.bridgePort, chat: h.chatPort, catalog: h.catalogPort, classes: h.classesPort, blocked, fixture };
  const catalog = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${h.catalogPort}${route}`, { method: "POST", headers: { authorization: `Bearer ${h.operator.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert(response.ok, "Synthetic policy source seed must succeed"); return (await response.json()).data;
  };
  const course = await catalog("/api/v1/courses", { code: "N8N04-POLICY-COURSE", name: policySources.courses[0].name, goal: "Kiểm thử tổng hợp", level: "beginner", deliveryModes: ["online"], branchIds: [branch], priceVnd: 100000, status: "active", policyText: "DEMO: Chính sách chưa công bố; cần tư vấn viên." });
  const offer = await catalog("/api/v1/packages", { code: "N8N04-POLICY-PACKAGE", courseId: course.id, name: policySources.packages[0].name, sessionCount: 1, priceVnd: 100000, status: "active", policyText: "DEMO: Chính sách chưa công bố; cần tư vấn viên." });
  assert.equal(course.policyVersion, 1); assert.equal(offer.policyVersion, 1);
  for (const [port, policy] of [[h.chatPort, "synthetic-only"], [blocked, "blocked"]]) await h.startService("conversation", { DATABASE_URL: h.domainUrls.conversation, PORT: String(port), HOST: "0.0.0.0", CHAT_BRANCH_ID: branch, AUTOMATION_BRIDGE_URL: `http://127.0.0.1:${h.bridgePort}`, CHANNEL_CLIENT_ID: "channel-source", CHANNEL_CLIENT_SECRET: source.clientSecret, AI_FREE_MODEL_READY: "true", CHAT_PROVIDER_DATA_POLICY: policy });
  const child = spawn(process.execPath, ["scripts/n8n04-fixture.mjs", String(fixture)], { cwd: h.root, windowsHide: true, stdio: "ignore", env: {} }); h.children.push(child);
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${fixture}/ready`)).ok) break; } catch { /* process starting */ } assert(i < 50); await new Promise(r => setTimeout(r, 100)); }
  const db = new pg.Pool({ connectionString: h.domainUrls.conversation });
  async function request(route, token, body) {
    const response = await fetch(`http://127.0.0.1:${h.chatPort}${route}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert(response.ok, `${route}: ${response.status}`); return (await response.json()).data;
  }
  function importFile(file, kind = "workflow") { h.compose("cp", file, "n8n:/home/node/.n8n/smoke/acceptance.json"); h.cli(`import:${kind}`, "--input=/home/node/.n8n/smoke/acceptance.json"); }
  async function execute(wf, label) {
    for (let poll = 0; poll < 20; poll++) {
      const output = h.cli("execute", `--id=N8N04${wf.replaceAll("-", "")}`, "--rawOutput");
      const result = parseN8nOutput(output).data.resultData;
      await writeFile(path.join(h.directory, `${label}-${wf}-${poll}-execution.json`), output, { mode: 0o600 });
      assert.equal(result.error, undefined);
      let job = result.runData.Result?.[0]?.data?.main?.[0]?.[0]?.json?.data;
      const reconciled = !job;
      if (!job) job = await lookupFinishedJob(h, principal, wf, result.runData.Job?.[0]?.data?.main?.[0]?.[0]?.json);
      if (job) {
        assert.equal(job.status, "DONE");
        const executionId = h.sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='N8N04${wf.replaceAll("-", "")}' ORDER BY id::bigint DESC LIMIT 1`); assert(executionId);
        return { result, jobId: job.jobId, executionId, resultReconciledByLookup: reconciled };
      }
      assert(!result.runData["Model tool request"] && !result.runData["Model answer"], "never retry after model execution");
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`No ${wf} job`);
  }
  try {
    assert.equal(h.sql("SELECT count(*) FROM workflow_entity"), "0");
    assert.equal(h.sql("SELECT count(*) FROM credentials_entity"), "0");
    h.compose("exec", "-T", "n8n", "mkdir", "-p", "/home/node/.n8n/smoke");
    const credentialFile = path.join(h.directory, "machine-credentials.json");
    await writeFile(credentialFile, JSON.stringify(workflows.map(wf => ({ id: `N8N04${wf}Machine`, name: `${wf}-machine-client`, type: "httpCustomAuth", data: { json: JSON.stringify({ body: { clientId: "chat-worker", clientSecret: principal.clientSecret } }) } }))), { mode: 0o600 });
    importFile(credentialFile, "credentials");
    const canonical = Object.fromEntries(await Promise.all(workflows.map(async wf => [wf, JSON.parse(await readFile(`workflows/n8n/${wf.toLowerCase()}.json`, "utf8"))])));
    for (const wf of ["WF-01", "WF-03"]) {
      const { workflow } = fixtureWorkflow(canonical[wf], cases[1], ports);
      const file = path.join(h.directory, `${wf}.json`); await writeFile(file, JSON.stringify(workflow)); importFile(file);
    }
    for (const test of cases) {
      const row = receipt.acceptance.find(c => c.name === test.name);
      row.status = "FAIL";
      const transformed = fixtureWorkflow(canonical["WF-02"], test, ports);
      const bytes = JSON.stringify(transformed.workflow, null, 2) + "\n", file = path.join(h.directory, `${test.name}.json`);
      await writeFile(file, bytes); await writeFile(file + ".diff.json", JSON.stringify(transformed, null, 2)); importFile(file);
      row.fixtureSha256 = createHash("sha256").update(bytes).digest("hex"); row.fixtureDiff = file + ".diff.json";
      assert.equal(h.sql("SELECT count(*) FROM workflow_entity WHERE active=true"), "0");
      const outboundBefore = Number((await db.query("SELECT count(*) FROM chat_messages WHERE direction='OUT'")).rows[0].count);
      const session = await request("/api/v1/chat/session", "", { consent: true });
      const input = { clientMessageId: randomUUID(), text: test.input ?? `DEMO synthetic ${test.name}` };
      await request("/api/v1/chat/messages", session.token, input);
      row.routing = await execute("WF-01", test.name); delete row.routing.result;
      const execution = await execute("WF-02", test.name); Object.assign(row, { jobId: execution.jobId, executionId: execution.executionId, conversationId: session.conversationId });
      const run = execution.result.runData, submitted = run["Submit draft"]?.[0]?.data?.main?.[0]?.[0]?.json;
      assert(submitted && !submitted.error, "draft must succeed, including metadata cases (no 400)");
      const draft = run["Selected draft"][0].data.main[0][0].json;
      assert.equal(draft.errorCode, test.errorCode);
      const expectedModel = test.kind === "human" ? humanRuleModel : test.kind === "clarification" ? clarificationModel : modelId;
      const expectedAnswer = test.kind === "clarification" ? clarificationText : test.kind === "budget" ? acceptedBudgetAnswer : acceptedAnswer;
      if (test.kind !== "gate") assert.equal(draft.model, expectedModel);
      if (test.kind === "gate") {
        const forced = run["Fixture readiness true"][0].data.main[0][0].json;
        assert.equal(forced.data.modelReady, true); assert.equal(forced.data.providerAllowed, false);
        assert(!run["Model tool request"] && !run["Model answer"]);
      }
      if (test.kind === "tool") assert(!run["Model answer"]);
      if (test.kind === "human") assert(run["Explicit handoff"] && !run["Model tool request"] && !run["Model answer"] && !run.Sources);
      if (!test.errorCode && test.kind !== "clarification") { assert.equal(run["Model answer"][0].data.main[0][0].json.choices[0].message.content, test.kind === "budget" ? budgetAnswer : answer); assert.equal(draft.text, expectedAnswer); }
      if (test.kind === "budget") {
        const projected = run.Sources[0].data.main[0][0].json.data;
        assert.deepEqual(projected.priceConstraint, { currency: "VND", maxExclusiveVnd: 100000 });
        assert.deepEqual(projected.packages, []); assert.deepEqual(projected.courses, []); assert.deepEqual(projected.classes, []);
      }
      if (!test.errorCode) { assert(run["Recheck turn"]); if (test.kind === "clarification") assert(run["Clarification answer"] && !run["Model tool request"] && !run["Model answer"]); else assert(run["Model answer"]); }
      const state = await request("/api/v1/chat/history", session.token);
      assert.equal(state.mode, test.errorCode ? "HUMAN" : "AI"); assert.equal(state.errorCode, test.errorCode ?? null);
      assert.equal(state.messages.length, test.errorCode ? 1 : 2);
      const token = run["Renew token"][0].data.main[0][0].json.data.accessToken;
      const replay = await fetch(`http://127.0.0.1:${h.chatPort}/internal/conversations/draft`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(draft) });
      assert.equal(replay.status, 409, "completed job cannot apply its draft again");
      if (test.errorCode) { row.handoff = await execute("WF-03", test.name); delete row.handoff.result; }
      await request("/api/v1/chat/messages", session.token, input);
      const rows = (await db.query("SELECT conversation_id,sender,text,model,delivery FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at,id", [session.conversationId])).rows;
      assert.equal(rows.length, test.errorCode ? 1 : 2);
      if (!test.errorCode) { const outbound = rows.filter(r => r.sender === "AI"); assert.equal(outbound.length, 1); assert.equal(outbound[0].text, expectedAnswer); assert.equal(outbound[0].model, expectedModel); assert.equal(outbound[0].delivery, "DELIVERED"); }
      const audit = (await db.query("SELECT action FROM conversation_audit WHERE conversation_id=$1", [session.conversationId])).rows.map(r => r.action);
      assert.equal(audit.filter(a => a === test.errorCode).length, test.errorCode ? 1 : 0);
      const handoffEvents = Number((await db.query("SELECT count(*) FROM event_outbox WHERE event->>'type'='conversation.handoff_requested' AND event->>'entityId'=$1", [session.conversationId])).rows[0].count);
      assert.equal(handoffEvents, test.errorCode ? 1 : 0);
      assert.equal(Number((await db.query("SELECT count(*) FROM chat_messages WHERE direction='OUT'")).rows[0].count), outboundBefore + (test.errorCode ? 0 : 1), "no output in another conversation");
      const job = (await h.pool.query("SELECT status,entity,attempt FROM automation_jobs WHERE id=$1", [execution.jobId])).rows[0];
      assert.equal(job.status, "DONE"); assert.equal(job.attempt, 1); assert.equal(job.entity.id, session.conversationId);
      const requests = (await (await fetch(`http://127.0.0.1:${fixture}/requests`)).json()).filter(r => r.name === test.name);
      assert(requests.every(r => !r.authorizationPresent));
      assert.equal(requests.filter(r => r.stage === "planner").length, ["gate", "clarification", "human"].includes(test.kind) ? 0 : 1);
      assert.equal(requests.filter(r => r.stage === "answer").length, ["answer", "quota", "budget"].includes(test.kind) ? 1 : 0);
      row.requestCounts = Object.fromEntries(["planner", "answer", "tool"].map(stage => [stage, requests.filter(r => r.stage === stage).length]));
      row.dbOutcomes = { mode: state.mode, errorCode: state.errorCode, messages: rows, audit, handoffEvents, jobStatus: job.status, jobAttempt: job.attempt, draftAccepted: true, draftReplayStatus: replay.status };
      row.status = "PASS"; delete row.reason;
      h.check(test.name);
    }
  } finally {
    try {
      receipt.fixtureRequests = await (await fetch(`http://127.0.0.1:${fixture}/requests`)).json();
      for (const row of receipt.acceptance.filter(r => r.status !== "SKIP")) row.requestCounts = Object.fromEntries(["planner", "answer", "tool"].map(stage => [stage, receipt.fixtureRequests.filter(r => r.name === row.name && r.stage === stage).length]));
    } finally { await db.end(); }
  }
}
