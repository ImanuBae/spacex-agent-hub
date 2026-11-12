import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { clarificationModel, clarificationText } from "./n8n04-clarification.mjs";
export { humanRuleModel } from "./n8n04-handoff.mjs";
export { modelId } from "./n8n04-model.mjs";
export { clarificationModel, clarificationText };

export const answer = "Gói kiểm policy có giá 100.000 VND.";
export const policySources = { courses: [{ name: "DEMO — Khóa kiểm policy", policyVersion: 1 }], packages: [{ name: "DEMO — Gói kiểm policy", policyVersion: 1 }] };
export const acceptedAnswer = "Gói kiểm policy có giá 100.000 VND.\n\nChính sách: Khóa DEMO — Khóa kiểm policy — phiên bản 1; Gói DEMO — Gói kiểm policy — phiên bản 1.";
export const budgetAnswer = "Không có gói học nào có giá dưới 100.000 VND trong dữ liệu hiện hành.";
export const acceptedBudgetAnswer = budgetAnswer + acceptedAnswer.slice(answer.length);
export const cases = [
  { name: "gate_closed_readiness_true_no_model", kind: "gate", errorCode: "DATA_POLICY_BLOCKED" },
  { name: "fixture_success_correct_conversation_no_duplicate", kind: "answer" },
  { name: "quota_human_once", kind: "quota", errorCode: "QUOTA" },
  { name: "timeout_human_once", kind: "timeout", errorCode: "TIMEOUT" },
  { name: "tool_error_human_once_zero_answer", kind: "tool", errorCode: "TOOL_ERROR" },
  ...["object", "empty", "151_characters", "missing"].flatMap(metadata =>
    ["answer", "quota"].map(kind => ({ name: `metadata_${metadata}_${kind}_no_draft_400`, metadata, kind, ...(kind === "quota" ? { errorCode: "QUOTA" } : {}) }))),
  { name: "clarification_first_turn_no_model", kind: "clarification", input: "Mình chưa biết nên học gì, tư vấn giúp mình nhé." },
  { name: "strict_price_empty_offers_no_recommendation", kind: "budget", input: "Tôi muốn học khóa dưới 100 nghìn, đừng đưa ra gói đắt hơn." },
  { name: "explicit_human_rule_no_model", kind: "human", input: "Tôi muốn nói chuyện với nhân viên thay vì AI.", errorCode: "HANDOFF" },
];

export function responseFor(test, stage) {
  const metadata = { object: {}, empty: "", "151_characters": "x".repeat(151) };
  const model = test.metadata === "missing" ? {} : { model: test.metadata ? metadata[test.metadata] : "fixture-not-inference" };
  if (stage === "answer" && test.kind === "quota") return { status: 429, body: { ...model, error: { code: 429, message: "SYNTHETIC quota" } } };
  if (stage === "tool") return { status: 503, body: { error: { code: "UPSTREAM_UNAVAILABLE" } } };
  return { status: 200, body: { ...model, choices: [{ message: stage === "planner"
    ? { role: "assistant", content: null, tool_calls: [{ id: "fixture-only", type: "function", function: { name: "select_chat_action", arguments: '{"action":"read_catalog_classes"}' } }] }
    : { role: "assistant", content: test.kind === "budget" ? budgetAnswer : answer } }] } };
}

// No credential input, forwarding, or external HTTP client exists in this server.
export function fixtureServer() {
  const requests = [];
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/requests") { res.end(JSON.stringify(requests)); return; }
    if (req.url === "/ready") { res.end("{}"); return; }
    const [, name, stage] = req.url.split("/");
    const test = cases.find(c => c.name === name);
    if (!test || !["planner", "answer", "tool"].includes(stage)) { res.writeHead(404); res.end("{}"); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ name, stage, authorizationPresent: !!req.headers.authorization, body: body ? JSON.parse(body) : null });
    if (req.headers.authorization) { res.writeHead(400); res.end("{}"); return; }
    if (test.kind === "timeout" && stage === "planner") { setTimeout(() => res.end("{}"), 20000).unref(); return; }
    const response = responseFor(test, stage); res.writeHead(response.status); res.end(JSON.stringify(response.body));
  });
  return server;
}

export function fixtureWorkflow(canonical, test, ports) {
  const workflow = structuredClone(canonical);
  assert.equal(workflow[0].active, false);
  Object.assign(workflow[0].settings, { saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true });
  const diff = [];
  for (const node of workflow[0].nodes) {
    const before = structuredClone(node);
    if (node.parameters.url) for (const [from, to] of [[4002, ports.iam], [4006, ports.bridge], [4007, test.kind === "gate" ? ports.blocked : ports.chat], [4001, ports.catalog], [4004, ports.classes]]) {
      node.parameters.url = node.parameters.url.replaceAll(`:${from}/`, `:${to}/`);
    }
    if (["Model tool request", "Model answer"].includes(node.name)) {
      node.parameters.url = `http://host.docker.internal:${ports.fixture}/${test.name}/${node.name === "Model answer" ? "answer" : "planner"}`;
      node.parameters.authentication = "none"; delete node.parameters.genericAuthType; delete node.credentials;
      node.parameters.sendHeaders = false; delete node.parameters.headerParameters;
    }
    if (test.kind === "tool" && node.name === "Class list") {
      node.parameters.url = `http://host.docker.internal:${ports.fixture}/${test.name}/tool`;
      node.parameters.sendHeaders = false; delete node.parameters.headerParameters;
    }
    if (node.parameters.url && ports.host) node.parameters.url = node.parameters.url.replaceAll("http://host.docker.internal:", `http://${ports.host}:`);
    if (JSON.stringify(before) !== JSON.stringify(node)) diff.push({ node: node.name, before, after: node });
  }
  // Backend masks readiness when blocked. Force only that bit after the real /turn proof.
  if (test.kind === "gate") {
    const node = { id: "FixtureReadiness", name: "Fixture readiness true", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: "if($json.data?.providerAllowed!==false) throw new Error('Expected closed backend policy'); return [{json:{...$json,data:{...$json.data,modelReady:true}}}];" } };
    workflow[0].nodes.push(node); diff.push({ node: node.name, before: null, after: node });
    workflow[0].connections.Turn.main[0][0].node = node.name;
    workflow[0].connections[node.name] = { main: [[{ node: "Model ready", type: "main", index: 0 }]] };
  }
  for (const node of workflow[0].nodes.filter(n => n.type === "n8n-nodes-base.httpRequest")) {
    const url = node.parameters.url;
    assert(!/https:|openrouter/i.test(url));
    assert(url.includes(`http://${ports.host ?? "host.docker.internal"}:`));
  }
  for (const node of workflow[0].nodes.filter(n => ["Model tool request", "Model answer"].includes(n.name))) {
    assert.equal(node.parameters.authentication, "none"); assert(!node.credentials); assert.equal(node.parameters.sendHeaders, false);
  }
  return { workflow, diff, settingsDiff: { before: canonical[0].settings, after: workflow[0].settings }, connectionsDiff: { before: canonical[0].connections, after: workflow[0].connections } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]); assert(port > 0 && port < 65536);
  fixtureServer().listen(port, "0.0.0.0");
}
