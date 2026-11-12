import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { filterPriceOffers } from "./n8n04-price-filter.mjs";
import { modelId as model, responseModelId, providerName, providerSlug, temperature, providerTimeoutMs } from "./n8n04-model.mjs";
export { model };

export function selectBenchmarkCases(corpus, ids = corpus.map(row => row.id)) {
  assert(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, "Unique nonempty case selection required");
  assert(ids.every(id => corpus.some(row => row.id === id)), "Unknown corpus case");
  const selected = corpus.filter(row => ids.includes(row.id));
  assert.deepEqual(selected.map(row => row.id), ids, "Keep corpus order and expected results");
  return selected;
}

export const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a, b) => assert.deepEqual(a, b);
const errorNames = new Set(["Error", "TypeError", "TimeoutError", "AbortError", "SyntaxError", "AssertionError", "AggregateError"]);
const dnsCodes = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const tlsCodes = new Set(["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_SSL_WRONG_VERSION_NUMBER"]);
const connectionCodes = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const timeoutCodes = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const stopCodes = new Set(["QUOTA", "PROVIDER_ERROR", "MALFORMED_RESPONSE", "MODEL_MISMATCH", "PROVIDER_MISMATCH", "COST_MISSING_OR_INVALID", "COST_NONZERO", "REASONING_NOT_DISABLED", "PROVIDER_TIMEOUT", "PROVIDER_DNS_ERROR", "PROVIDER_TLS_ERROR", "PROVIDER_CONNECTION_ERROR", "PROVIDER_TRANSPORT_ERROR", "PROVIDER_BODY_READ_ERROR", "PROVIDER_NON_JSON", "PROVIDER_RESPONSE_SECRET_DENIED", "PROVIDER_RECORD_ERROR"]);
const safeError = error => ({ errorName: errorNames.has(error?.name) ? error.name : null, causeCode: [dnsCodes, tlsCodes, connectionCodes].some(codes => codes.has(error?.cause?.code)) ? error.cause.code : null });

// The endpoint stays fixed; tests inject fetch and rewrite it to loopback, never a live URL.
export async function sendProvider(body, { key, capability, observe, fetchImpl = fetch, timeoutMs = providerTimeoutMs, record = async () => {} }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const started = performance.now(), elapsed = () => Math.round(performance.now() - started);
  let phase = "request";
  try {
    const response = await fetchImpl(endpoint, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal });
    phase = "record";
    await observe({ phase: "body", httpStatus: response.status, httpError: response.status !== 200, transportHeadersElapsedMs: elapsed() });
    phase = "body";
    const bodyStarted = elapsed(), chunks = [];
    let bodyBytesReceived = 0, bodyChunksReceived = 0, firstBodyByteElapsedMs = null, lastBodyByteElapsedMs = null, bodyComplete = false;
    try {
      for await (const chunk of response.body ?? []) {
        if (!chunk.byteLength) continue;
        firstBodyByteElapsedMs ??= elapsed(); lastBodyByteElapsedMs = elapsed();
        bodyBytesReceived += chunk.byteLength; bodyChunksReceived++; chunks.push(chunk);
      }
      bodyComplete = true;
    } finally {
      const bodyEndElapsedMs = elapsed();
      // Persist numeric progress once, even on abort; never log chunks or add disk I/O per chunk.
      phase = "record";
      await observe({ bodyBytesReceived, bodyChunksReceived, firstBodyByteElapsedMs, lastBodyByteElapsedMs, bodyComplete, bodyReadStartedElapsedMs: bodyStarted, bodyEndElapsedMs, bodyReadElapsedMs: bodyEndElapsedMs - bodyStarted, bodyIdleElapsedMs: bodyEndElapsedMs - (lastBodyByteElapsedMs ?? bodyStarted) });
      phase = "body";
    }
    const text = Buffer.concat(chunks).toString("utf8");
    phase = "secret_check";
    // Check raw and decoded text, including escaped secrets, before recording any response.
    if ([key, capability].some(secret => secret && text.includes(secret))) throw new Error("PROVIDER_RESPONSE_SECRET_DENIED");
    phase = "json";
    const result = JSON.parse(text);
    phase = "secret_check";
    if ([key, capability].some(secret => secret && JSON.stringify(result).includes(secret))) throw new Error("PROVIDER_RESPONSE_SECRET_DENIED");
    const usage = result?.usage == null ? null : Object.fromEntries(["cost", "prompt_tokens", "completion_tokens", "total_tokens"].filter(field => typeof result.usage[field] === "number" && Number.isFinite(result.usage[field])).map(field => [field, result.usage[field]]));
    const reasoningTokens = result?.usage?.completion_tokens_details?.reasoning_tokens;
    if (usage && Number.isInteger(reasoningTokens) && reasoningTokens >= 0) usage.reasoning_tokens = reasoningTokens;
    phase = "record";
    await observe({ phase, responseObserved: true, usage, inferenceObserved: response.status === 200 && !!result?.choices?.[0]?.message });
    await record({ endpoint, request: body, status: response.status, response: result });
    return { status: response.status, body: result };
  } catch (error) {
    const diagnostic = safeError(error);
    const timedOut = ["request", "body"].includes(phase) && (signal.aborted || diagnostic.errorName === "TimeoutError" || timeoutCodes.has(diagnostic.causeCode));
    const code = error.message === "PROVIDER_RESPONSE_SECRET_DENIED" ? error.message : timedOut ? "PROVIDER_TIMEOUT" : phase === "json" ? "PROVIDER_NON_JSON" : phase === "body" ? "PROVIDER_BODY_READ_ERROR" : phase === "record" ? "PROVIDER_RECORD_ERROR" : dnsCodes.has(diagnostic.causeCode) ? "PROVIDER_DNS_ERROR" : tlsCodes.has(diagnostic.causeCode) ? "PROVIDER_TLS_ERROR" : connectionCodes.has(diagnostic.causeCode) ? "PROVIDER_CONNECTION_ERROR" : "PROVIDER_TRANSPORT_ERROR";
    throw Object.assign(new Error(code), { diagnostic, failurePhase: phase });
  }
}

export function providerAccounting(state) {
  const costs = state.requests.map(r => r.usage?.cost);
  const known = costs.filter(c => typeof c === "number" && Number.isFinite(c) && c >= 0);
  const reportedCostUsd = known.reduce((sum, c) => sum + c, 0);
  const modelInferenceObserved = state.requests.some(r => r.inferenceObserved);
  return { providerRequests: state.requests.length, providerRequestAttempts: state.requests.length, providerHeadersObserved: state.requests.filter(r => r.httpStatus != null).length, providerResponsesObserved: state.requests.filter(r => r.responseObserved).length, modelInference: modelInferenceObserved, modelInferenceObserved, modelInferenceOccurred: modelInferenceObserved ? true : null, usageReports: state.requests.filter(r => r.usage != null).length, reportedCostUsd, costUsd: known.length === costs.length ? reportedCostUsd : null, costUnknown: known.length !== costs.length, actualCostUsd: null };
}

// One sequential local runner; reserve requests before forwarding and never retry them.
export function benchmarkGuard(config, send, persist = async () => {}) {
  assert(Number.isInteger(config.maxRequests) && config.maxRequests > 0 && config.maxRequests <= 20, "REQUEST_BUDGET_REQUIRED");
  const state = { requests: [], stopped: null, activeCase: null, costUsd: 0, reportedCostUsd: 0 };
  let busy = false, nextCase = 0;
  const stop = code => { state.stopped ??= code; };
  async function begin(id) {
    assert(!state.stopped && !busy && config.cases[nextCase]?.id === id, "CASE_ORDER_DENIED");
    state.activeCase = id; nextCase++; await persist(state);
  }
  async function request(id, stage, body) {
    const started = performance.now();
    const row = { caseId: id, stage, startedAt: new Date().toISOString(), forwarded: false, inferenceObserved: false, httpStatus: null, responseObserved: false, phase: "request_validation", transportHeadersElapsedMs: null, bodyBytesReceived: 0, bodyChunksReceived: 0, firstBodyByteElapsedMs: null, lastBodyByteElapsedMs: null, bodyComplete: false, bodyReadStartedElapsedMs: null, bodyReadElapsedMs: null, bodyIdleElapsedMs: null };
    const observe = async fields => {
      Object.assign(row, fields, { elapsedMs: Math.round(performance.now() - started) });
      if (fields.httpStatus != null) row.headersElapsedMs = row.elapsedMs;
      Object.assign(state, providerAccounting(state));
      await persist(state);
    };
    try {
      assert(!state.stopped && !busy && id === state.activeCase, "GUARD_CLOSED");
      if (config.utcDate) assert.equal(config.utcDate, new Date().toISOString().slice(0, 10), "UTC_DAY_CHANGED");
      assert(["planner", "answer"].includes(stage), "STAGE_DENIED");
      assert(state.requests.length < config.maxRequests, "REQUEST_CAP");
      const prior = state.requests.filter(r => r.caseId === id);
      assert(prior.length < 2 && !prior.some(r => r.stage === stage), "CASE_CAP_OR_RETRY");
      assert(stage === "planner" ? prior.length === 0 : prior.length === 1 && prior[0].stage === "planner" && prior[0].valid, "STAGE_ORDER");
      same(Object.keys(body).sort(), ["max_tokens", "messages", "model", "provider", "reasoning", "temperature", "tool_choice", "tools"]);
      assert.equal(body.model, model); assert.equal(body.max_tokens, stage === "planner" ? 500 : 400);
      assert.equal(body.temperature, temperature);
      same(body.reasoning, { enabled: false });
      same(body.provider, { only: [providerSlug], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } });
      same(body.tools, config[stage === "planner" ? "plannerTools" : "answerTools"]);
      same(body.tool_choice, stage === "planner" ? { type: "function", function: { name: "select_chat_action" } } : "none");
      const test = config.cases.find(c => c.id === id);
      same(body.messages.slice(0, 2), [{ role: "system", content: config.systemPrompt }, { role: "user", content: test.input }]);
      assert.equal(body.messages.length, stage === "planner" ? 2 : 4);
      if (stage === "answer") {
        same(body.messages[2], prior[0].assistant);
        const tool = body.messages[3];
        same(Object.keys(tool).sort(), ["content", "role", "tool_call_id"]);
        assert.equal(tool.role, "tool"); assert.equal(tool.tool_call_id, prior[0].assistant.tool_calls[0].id);
        const data = JSON.parse(tool.content);
        const expected = filterPriceOffers({ courses: config.toolData.courses, packages: config.toolData.packages, classes: [config.toolData.classSnapshot], notice: config.toolData.notice }, [{ sender: "GUEST", text: test.input }]);
        same(Object.keys(data).sort(), Object.keys(expected).sort());
        same(data.courses, expected.courses); same(data.packages, expected.packages);
        assert.equal(data.notice, expected.notice);
        same(data.priceConstraint, expected.priceConstraint);
        assert.equal(data.classes.length, expected.classes.length);
        for (const row of data.classes) {
          const { serverTime, ...snapshot } = row;
          assert(Number.isFinite(Date.parse(serverTime)) && Math.abs(Date.now() - Date.parse(serverTime)) < 60000);
          same(snapshot, config.toolData.classSnapshot);
        }
      }
      busy = true;
      row.sequence = state.requests.length + 1; row.forwarded = true; row.requestSha256 = sha(body);
      const forwardedBody = body;
      row.forwardedRequestSha256 = sha(forwardedBody);
      row.phase = "reserve";
      state.requests.push(row); await observe({});
      row.phase = "request";
      const response = await send(forwardedBody, observe);
      row.phase = "response_validation"; row.responseObserved = true;
      row.httpStatus = response.status; row.usage ??= response.body?.usage ?? null; row.responseSha256 = sha(response.body);
      row.inferenceObserved = response.status === 200 && !!response.body?.choices?.[0]?.message;
      const cost = response.body?.usage?.cost;
      if (response.status !== 200 || response.body?.error) throw new Error(response.status === 429 ? "QUOTA" : "PROVIDER_ERROR");
      if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) throw new Error("MALFORMED_RESPONSE");
      if (response.body.model !== responseModelId) throw new Error("MODEL_MISMATCH");
      if (!(typeof cost === "number" && Number.isFinite(cost) && cost >= 0)) throw new Error("COST_MISSING_OR_INVALID");
      if (cost !== 0) throw new Error("COST_NONZERO");
      if (response.body.usage?.completion_tokens_details?.reasoning_tokens > 0) throw new Error("REASONING_NOT_DISABLED");
      if (response.body.provider !== providerName) throw new Error("PROVIDER_MISMATCH");
      const assistant = response.body.choices?.[0]?.message;
      assert(assistant && typeof assistant === "object", "MALFORMED_RESPONSE");
      if (stage === "planner") {
        const calls = assistant.tool_calls;
        assert(Array.isArray(calls) && calls.length === 1 && typeof calls[0]?.id === "string", "TOOL_DENIED");
        assert.equal(calls[0]?.function?.name, "select_chat_action", "TOOL_DENIED");
        const args = JSON.parse(calls[0].function.arguments);
        assert(["read_catalog_classes", "request_handoff"].includes(args?.action), "TOOL_DENIED");
        same(Object.keys(args), ["action"]);
        row.assistant = assistant;
      } else assert(typeof assistant.content === "string" && assistant.content.trim() && assistant.content.trim().length <= 4000, "MALFORMED_RESPONSE");
      row.valid = true; row.phase = "complete"; row.finishedAt = new Date().toISOString(); await observe({});
      return response;
    } catch (error) {
      const code = error.code === "ERR_ASSERTION" ? "REQUEST_OR_RESPONSE_DENIED" : stopCodes.has(error.message) ? error.message : "GUARD_FAILURE";
      stop(code); row.valid = false; row.stopCode = code;
      Object.assign(row, error.diagnostic ?? safeError(error));
      row.failurePhase = error.failurePhase ?? row.phase;
      row.finishedAt = new Date().toISOString(); await observe({});
      if (!row.forwarded) state.lastRejection = { stopCode: code, failurePhase: row.failurePhase, errorName: row.errorName, causeCode: row.causeCode, elapsedMs: row.elapsedMs };
      return { status: 502, body: { error: { code: "BENCHMARK_GUARD_STOPPED", message: code } } };
    } finally {
      Object.assign(state, providerAccounting(state));
      await persist(state); busy = false;
    }
  }
  return { state, begin, request };
}

async function serve() {
  const configFile = path.resolve(process.argv[2]);
  assert(configFile.startsWith(path.resolve(".local/automation") + path.sep) && path.basename(configFile) === "benchmark-guard-private.json");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  assert.equal(config.authorization, "NEW_RUN_BUDGET_CONFIRMED");
  assert(Number.isInteger(config.maxRequests) && config.maxRequests > 0 && config.maxRequests <= 20, "REQUEST_BUDGET_REQUIRED");
  // Read exactly the credential path approved in this conversation, after runtime/corpus gates.
  const key = (await readFile(path.resolve(".local/credentials/openrouter.key"), "utf8")).trim();
  assert(key && !/[\r\n]/.test(key), "Private credential unavailable");
  const directory = path.dirname(configFile);
  const persist = state => writeFile(path.join(directory, "provider-ledger-private.json"), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  const guard = benchmarkGuard(config, async (body, observe) => {
    const number = guard.state.requests.length;
    return sendProvider(body, { key, capability: config.capability, observe, record: result => writeFile(path.join(directory, `provider-${number}-private.json`), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 }) });
  }, persist);
  await persist(guard.state);
  createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== `Bearer ${config.capability}`) { res.writeHead(403); res.end("{}"); return; }
    try {
      if (req.method === "GET" && req.url === "/state") { res.end(JSON.stringify(guard.state)); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; assert(size <= 100000); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const match = req.url.match(/^\/(begin|planner|answer)\/(VI-\d{2})$/);
      assert(req.method === "POST" && match);
      if (match[1] === "begin") { await guard.begin(match[2]); res.end("{}"); return; }
      const result = await guard.request(match[2], match[1], body);
      res.writeHead(result.status); res.end(JSON.stringify(result.body));
    } catch { res.writeHead(400); res.end('{"error":{"code":"GUARD_DENIED"}}'); }
  }).listen(config.port, "0.0.0.0");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serve();
