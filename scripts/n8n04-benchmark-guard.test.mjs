import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { benchmarkGuard, endpoint, model, providerAccounting, sendProvider, selectBenchmarkCases, authorityFailure, plannedModelRequests } from "./n8n04-benchmark-guard.mjs";

import { providerSlug, providerName, responseModelId } from "./n8n04-model.mjs";
import { readFile } from "node:fs/promises";
test("admission reserves two calls per functional case and zero for declared deterministic branches", async () => {
  const corpus = JSON.parse(await readFile("workflows/n8n/chat-benchmark.json", "utf8"));
  assert.equal(plannedModelRequests(corpus), 16);
  assert.equal(plannedModelRequests(selectBenchmarkCases(corpus, ["VI-01","VI-06","VI-10"])), 2);
  assert.equal(plannedModelRequests(selectBenchmarkCases(corpus, ["VI-01","VI-10"])), 0);
});
test("a new grant selects original corpus rows without changing expectations, duplicates or order", () => {
  const corpus = [{ id: "VI-01", expected: "original" }, { id: "VI-02", expected: "unchanged" }];
  assert.deepEqual(selectBenchmarkCases(corpus), corpus);
  assert.equal(selectBenchmarkCases(corpus, ["VI-02"])[0], corpus[1]);
  for (const ids of [[], ["VI-03"], ["VI-01", "VI-01"], ["VI-02", "VI-01"]]) assert.throws(() => selectBenchmarkCases(corpus, ids));
});
const assistant = { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "select_chat_action", arguments: '{"action":"read_catalog_classes"}' } }] };
const config = { maxRequests: 20, cases: Array.from({ length: 11 }, (_, i) => ({ id: `VI-${String(i + 1).padStart(2, "0")}`, input: "Synthetic input" })), systemPrompt: "Synthetic prompt", plannerTools: [], answerTools: [], toolData: { courses: [], packages: [], notice: "synthetic", classSnapshot: { id: "synthetic" } } };
const planner = { model, temperature: 0, max_tokens: 500, reasoning: { enabled: false }, provider: { only: [providerSlug], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } }, messages: [{ role: "system", content: config.systemPrompt }, { role: "user", content: "Synthetic input" }], tools: [], tool_choice: { type: "function", function: { name: "select_chat_action" } } };
const answer = { ...planner, max_tokens: 400, tool_choice: "none", messages: [...planner.messages, assistant, { role: "tool", tool_call_id: "a", content: JSON.stringify({ courses: [], packages: [], notice: "synthetic", classes: [{ id: "synthetic", serverTime: new Date().toISOString() }] }) }] };
const result = () => ({ model: responseModelId, provider: providerName, usage: { cost: 0 }, choices: [{ message: structuredClone(assistant) }] });
const send = async body => {
  assert.deepEqual(body.provider, planner.provider); assert.deepEqual(body.reasoning, { enabled: false });
  return { status: 200, body: body.max_tokens === 500 ? result() : { ...result(), choices: [{ message: { role: "assistant", content: "Synthetic answer" } }] } };
};
const key = "synthetic-provider-secret", capability = "synthetic-local-capability";

test("a source authority rejection closes the batch without forwarding another inference", async () => {
  const output = code => [{ data: { main: [[{ json: { error: { code } } }]] } }];
  assert.deepEqual(authorityFailure({ "Catalog courses": output("AUTHORIZATION_DENIED") }), { node: "Catalog courses", code: "AUTHORIZATION_DENIED" });
  assert.deepEqual(authorityFailure({ "Turn": output("IDENTITY_UNAVAILABLE") }), { node: "Turn", code: "IDENTITY_UNAVAILABLE" });
  assert.equal(authorityFailure({ "Class list": output("TOOL_ERROR") }), null);
  let sends = 0, saved;
  const guard = benchmarkGuard(config, async () => { sends++; return send(planner); }, async state => { saved = structuredClone(state); });
  await guard.begin("VI-01"); await guard.abort("AUTHORITY_DENIED");
  assert.equal(saved.stopped, "AUTHORITY_DENIED");
  assert.equal((await guard.request("VI-01", "planner", planner)).status, 502);
  assert.equal(sends, 0); assert.equal(guard.state.requests.length, 0);
  const toolGuard = benchmarkGuard(config, async () => { sends++; return send(planner); });
  await toolGuard.begin("VI-01"); await toolGuard.abort("TOOL_FAILURE");
  assert.equal((await toolGuard.request("VI-01", "planner", planner)).status, 502);
  assert.equal(toolGuard.state.stopped, "TOOL_FAILURE"); assert.equal(sends, 0);
});

async function attempt(fetchImpl, options = {}, persist) {
  let records = 0;
  const guard = benchmarkGuard(config, (body, observe) => sendProvider(body, { key, capability, observe, fetchImpl, record: async () => { records++; }, ...options }), persist);
  await guard.begin("VI-01");
  const response = await guard.request("VI-01", "planner", planner);
  return { guard, row: guard.state.requests[0], response, records };
}

// All real sockets go to loopback. DNS/TLS failures use mocks; no credential file is read.
async function localServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const localUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run((url, options) => {
      assert.equal(url, endpoint); assert.equal(options.redirect, "error");
      return fetch(localUrl, options);
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("20-request cap, two stages per case and zero-price routing", async () => {
  let sent = 0;
  const guard = benchmarkGuard(config, body => { sent++; return send(body); });
  for (const c of config.cases.slice(0, 10)) {
    await guard.begin(c.id);
    assert.equal((await guard.request(c.id, "planner", planner)).status, 200);
    assert.equal((await guard.request(c.id, "answer", answer)).status, 200);
  }
  await guard.begin("VI-11"); assert.equal((await guard.request("VI-11", "planner", planner)).status, 502);
  assert.equal(sent, 20); assert.equal(guard.state.lastRejection.failurePhase, "request_validation");
  assert.deepEqual([guard.state.providerRequestAttempts, guard.state.usageReports, guard.state.costUnknown], [20, 20, false]);
});

test("19 remaining requests are not silently reset to 20", async () => {
  let sent = 0;
  const guard = benchmarkGuard({ ...config, maxRequests: 19 }, body => { sent++; return send(body); });
  for (const c of config.cases.slice(0, 10)) {
    await guard.begin(c.id); await guard.request(c.id, "planner", planner); await guard.request(c.id, "answer", answer);
  }
  assert.equal(sent, 19); assert(guard.state.stopped);
  for (const maxRequests of [undefined, 0, 21, -1, 1.5]) assert.throws(() => benchmarkGuard({ ...config, maxRequests }, send));
});
test("a grant from another UTC day cannot forward any inference", async () => {
  let sent = 0;
  const guard = benchmarkGuard({ ...config, utcDate: "2000-01-01" }, body => { sent++; return send(body); });
  await guard.begin("VI-01");
  assert.equal((await guard.request("VI-01", "planner", planner)).status, 502);
  assert.equal(sent, 0); assert.equal(guard.state.requests.length, 0);
});
test("the answer guard accepts a strict empty-price projection and rejects the equal-price offer before forwarding", async () => {
  const limited = { ...config, cases: [{ id: "VI-01", input: "khóa dưới 100 nghìn" }], toolData: { courses: [{ id: "c" }], packages: [{ id: "p", courseId: "c", priceVnd: 100000 }], notice: "snapshot", classSnapshot: { id: "class", courseId: "c", packageId: "p" } } };
  const request = { ...planner, messages: [planner.messages[0], { role: "user", content: limited.cases[0].input }] };
  for (const tampered of [false, true]) {
    let sent = 0;
    const guard = benchmarkGuard(limited, body => { sent++; return send(body); });
    await guard.begin("VI-01"); await guard.request("VI-01", "planner", request);
    const projection = { courses: [], packages: tampered ? limited.toolData.packages : [], classes: [], notice: "snapshot", priceConstraint: { currency: "VND", maxExclusiveVnd: 100000 } };
    const body = { ...answer, messages: [...request.messages, assistant, { role: "tool", tool_call_id: "a", content: JSON.stringify(projection) }] };
    assert.equal((await guard.request("VI-01", "answer", body)).status, tampered ? 502 : 200);
    assert.equal(sent, tampered ? 1 : 2);
  }
});

test("quota, HTTP, cost, model and response validation stop the next send", async t => {
  const cases = [
    ["quota", { status: 429, body: { error: {} } }, "QUOTA"],
    ["HTTP 503", { status: 503, body: { error: {} } }, "PROVIDER_ERROR"],
    ["provider error in HTTP 200", { status: 200, body: { error: {} } }, "PROVIDER_ERROR"],
    ...[null, [], "text"].map(body => [`malformed ${JSON.stringify(body)}`, { status: 200, body }, "MALFORMED_RESPONSE"]),
    ["missing usage", { status: 200, body: { model: responseModelId, choices: [{ message: assistant }] } }, "COST_MISSING_OR_INVALID"],
    ...[undefined, null, "0", -1, NaN, Infinity].map(cost => [`invalid cost ${String(cost)}`, { status: 200, body: { ...result(), usage: { cost } } }, "COST_MISSING_OR_INVALID"]),
    ["nonzero", { status: 200, body: { ...result(), usage: { cost: 0.01 } } }, "COST_NONZERO"],
    ["model", { status: 200, body: { ...result(), model: "other-model" } }, "MODEL_MISMATCH"],
    ["request ID is not the pinned response ID", { status: 200, body: { ...result(), model } }, "MODEL_MISMATCH"],
    ["provider", { status: 200, body: { ...result(), provider: "other-provider" } }, "PROVIDER_MISMATCH"],
    ["no message", { status: 200, body: { ...result(), choices: [] } }, "REQUEST_OR_RESPONSE_DENIED"],
    ["tool", { status: 200, body: { ...result(), choices: [{ message: { tool_calls: [null] } }] } }, "REQUEST_OR_RESPONSE_DENIED"],
  ];
  for (const [name, response, code] of cases) await t.test(name, async () => {
    let n = 0; const guard = benchmarkGuard(config, async () => { n++; return response; }); await guard.begin("VI-01");
    assert.equal((await guard.request("VI-01", "planner", planner)).status, 502);
    assert.equal(guard.state.stopped, code); assert.equal(guard.state.requests[0].failurePhase, "response_validation");
    assert.equal((await guard.request("VI-01", "answer", answer)).status, 502); assert.equal(n, 1);
    if (name === "nonzero") assert.equal(guard.state.costUsd, 0.01);
    if (name.startsWith("invalid")) assert.equal(guard.state.costUnknown, true);
  });
});

test("foreign model/endpoint/body/corpus and invalid order never forward", async () => {
  for (const body of [{ ...planner, model: "other-model" }, { ...planner, endpoint: "https://other.invalid" }, { ...planner, reasoning: { enabled: true } }, { ...planner, provider: { ...planner.provider, allow_fallbacks: true } }, { ...planner, messages: [{ role: "user", content: "Other customer" }] }, { ...planner, tools: [{ url: "http://other.invalid" }] }]) {
    let n = 0; const guard = benchmarkGuard(config, async () => { n++; }); await guard.begin("VI-01");
    assert.equal((await guard.request("VI-01", "planner", body)).status, 502); assert.equal(n, 0);
  }
  const guard = benchmarkGuard(config, () => assert.fail("answer before planner forwarded")); await guard.begin("VI-01");
  assert.equal((await guard.request("VI-01", "answer", answer)).status, 502);
});

test("duplicate/retry and foreign tool data stop before forwarding", async () => {
  for (const stage of ["planner", "answer"]) {
    let n = 0; const guard = benchmarkGuard(config, body => { n++; return send(body); }); await guard.begin("VI-01");
    await guard.request("VI-01", "planner", planner);
    if (stage === "answer") await guard.request("VI-01", "answer", answer);
    assert.equal((await guard.request("VI-01", stage, stage === "planner" ? planner : answer)).status, 502);
    assert.equal(n, stage === "planner" ? 1 : 2);
  }
  let n = 0; const guard = benchmarkGuard(config, body => { n++; return send(body); }); await guard.begin("VI-01"); await guard.request("VI-01", "planner", planner);
  const other = structuredClone(answer); other.messages[3].content = JSON.stringify({ courses: [{ name: "Other customer" }], packages: [], notice: "synthetic", classes: [] });
  assert.equal((await guard.request("VI-01", "answer", other)).status, 502); assert.equal(n, 1);
});

test("DNS, TLS, connection and unknown errors retain only allowed name/cause codes", async t => {
  for (const [causeCode, expected] of [["ENOTFOUND", "PROVIDER_DNS_ERROR"], ["EAI_AGAIN", "PROVIDER_DNS_ERROR"], ["ERR_TLS_CERT_ALTNAME_INVALID", "PROVIDER_TLS_ERROR"], ["CERT_HAS_EXPIRED", "PROVIDER_TLS_ERROR"], ["ECONNREFUSED", "PROVIDER_CONNECTION_ERROR"], ["ECONNRESET", "PROVIDER_CONNECTION_ERROR"], ["UND_ERR_CONNECT_TIMEOUT", "PROVIDER_TIMEOUT"], [key, "PROVIDER_TRANSPORT_ERROR"]]) await t.test(causeCode === key ? "untrusted cause" : causeCode, async () => {
    const { guard, row, records } = await attempt(async () => { throw new TypeError(`Authorization Bearer ${key}`, { cause: { code: causeCode, message: capability } }); });
    assert.equal(guard.state.stopped, expected); assert.equal(row.errorName, "TypeError");
    assert.equal(row.causeCode, causeCode === key ? null : causeCode); assert.equal(row.failurePhase, "request");
    assert.equal(row.httpStatus, null); assert.equal(row.inferenceObserved, false);
    assert.equal(guard.state.costUsd, null); assert.equal(guard.state.reportedCostUsd, 0); assert.equal(records, 0);
    for (const secret of [key, capability, "Authorization"]) assert(!JSON.stringify(guard.state).includes(secret));
  });
  const { row } = await attempt(async () => { throw Object.assign(new Error(key), { name: capability, cause: { code: key } }); });
  assert.equal(row.errorName, null); assert.equal(row.causeCode, null);
  const guard = benchmarkGuard(config, async () => { throw new Error("PRIVATE_SECRET"); }); await guard.begin("VI-01");
  await guard.request("VI-01", "planner", planner);
  assert.equal(guard.state.stopped, "GUARD_FAILURE"); assert(!JSON.stringify(guard.state).includes("PRIVATE_SECRET"));
});

test("HTTP headers persist before reading body, including 429/503 HTML", async () => {
  for (const status of [200, 429, 503]) {
    let persisted = false;
    const { guard, row } = await attempt(async () => ({ status, get body() { assert(persisted); return new Response("<html>not JSON</html>").body; } }), {}, state => { if (state.requests[0]?.httpStatus === status && state.requests[0]?.phase === "body") persisted = true; });
    assert.equal(guard.state.stopped, "PROVIDER_NON_JSON"); assert.equal(row.failurePhase, "json");
    assert.equal(row.httpStatus, status); assert.equal(row.httpError, status !== 200); assert.equal(row.errorName, "SyntaxError");
    assert.equal(row.responseObserved, false); assert.equal(guard.state.costUnknown, true);
    assert.equal(row.bodyComplete, true); assert.equal(row.bodyBytesReceived, Buffer.byteLength("<html>not JSON</html>"));
  }
});

test("secret rejection precedes record/log: raw, escaped and non-JSON echoes", async () => {
  for (const secret of [key, capability]) for (const text of [JSON.stringify({ ...result(), echo: secret }), JSON.stringify({ echo: secret }).replaceAll(secret[0], `\\u${secret.charCodeAt(0).toString(16).padStart(4, "0")}`), `not JSON ${secret}`]) {
    const { guard, row, records } = await attempt(async () => new Response(text));
    assert.equal(guard.state.stopped, "PROVIDER_RESPONSE_SECRET_DENIED"); assert.equal(row.failurePhase, "secret_check");
    assert.equal(row.httpStatus, 200); assert.equal(records, 0);
    assert(!JSON.stringify(guard.state).includes(secret)); assert.equal(guard.state.costUnknown, true);
  }
});

test("timeout before headers keeps status unknown", async () => {
  await localServer((_req, res) => { const timer = setTimeout(() => res.end("{}"), 1000); res.on("close", () => clearTimeout(timer)); }, async fetchImpl => {
    const { guard, row } = await attempt(fetchImpl, { timeoutMs: 150 });
    assert.equal(guard.state.stopped, "PROVIDER_TIMEOUT"); assert.equal(row.failurePhase, "request"); assert.equal(row.httpStatus, null);
    assert.equal(row.errorName, "TimeoutError"); assert(row.elapsedMs >= 100); assert.equal(guard.state.costUnknown, true);
    assert.equal(row.transportHeadersElapsedMs, null); assert.equal(row.firstBodyByteElapsedMs, null); assert.equal(row.bodyBytesReceived, 0); assert.equal(row.bodyComplete, false);
  });
});

test("headers arrive but slow body times out with HTTP status retained", async () => {
  await localServer((_req, res) => { res.writeHead(200, { "x-generation-id": "gen-incomplete-body", "x-request-id": "req-incomplete-body", "content-type": "application/json" }); res.flushHeaders(); const timer = setTimeout(() => res.end("{}"), 1000); res.on("close", () => clearTimeout(timer)); }, async fetchImpl => {
    const { guard, row } = await attempt(fetchImpl, { timeoutMs: 150 });
    assert.equal(guard.state.stopped, "PROVIDER_TIMEOUT"); assert.equal(row.failurePhase, "body"); assert.equal(row.httpStatus, 200);
    assert(["AbortError", "TimeoutError"].includes(row.errorName)); assert(row.headersElapsedMs < row.elapsedMs);
    assert.equal(guard.state.providerHeadersObserved, 1); assert.equal(guard.state.providerResponsesObserved, 0); assert.equal(guard.state.modelInferenceObserved, false); assert.equal(guard.state.costUnknown, true);
    assert.equal(row.bodyBytesReceived, 0); assert.equal(row.firstBodyByteElapsedMs, null); assert.equal(row.bodyComplete, false); assert(row.bodyIdleElapsedMs >= 80);
    assert.equal(row.responseIds["x-generation-id"], "gen-incomplete-body"); assert.equal(row.responseIds["x-request-id"], "req-incomplete-body");
    assert.equal(row.responseContentType, "application/json"); assert(row.wire.requestEvents.some(e => e.event === "requestBodyWritten"));
    assert.equal(row.wire.connectionBinding, "REQUEST_SOCKET"); assert.equal(row.wire.observerErrors, 0);
  });
});

test("partial body records only byte classes, never heartbeat or response content", async () => {
  for (const prefix of [" \n \n", ": OPENROUTER PROCESSING\n\n"]) await localServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write(prefix);
    const timer = setTimeout(() => res.end("{}"), 1000); res.on("close", () => clearTimeout(timer));
  }, async fetchImpl => {
    const { guard, row } = await attempt(fetchImpl, { timeoutMs: 150 });
    assert.equal(guard.state.stopped, "PROVIDER_TIMEOUT"); assert.equal(row.bodyBytesReceived, Buffer.byteLength(prefix));
    assert.equal(row.firstNonWhitespaceKind, prefix.startsWith(":") ? "COMMENT_PREFIX" : null);
    assert.equal(row.bodyWhitespaceBytes, 4);
    assert(!JSON.stringify(row).includes("OPENROUTER PROCESSING")); assert.equal(row.responseContentType, "text/event-stream");
    assert.equal(guard.state.costUsd, null);
  });
});

test("interrupted response is body-read error, distinct from invalid JSON", async () => {
  await localServer((_req, res) => { res.writeHead(200, { "content-length": "10000" }); res.write('{"model":'); const timer = setTimeout(() => res.destroy(), 40); res.on("close", () => clearTimeout(timer)); }, async fetchImpl => {
    const { guard, row } = await attempt(fetchImpl);
    assert.equal(guard.state.stopped, "PROVIDER_BODY_READ_ERROR"); assert.equal(row.failurePhase, "body"); assert.equal(row.httpStatus, 200);
    assert.equal(row.errorName, "TypeError"); assert.equal(row.causeCode, "UND_ERR_SOCKET"); assert.equal(guard.state.costUsd, null);
    assert(row.bodyBytesReceived > 0); assert(row.firstBodyByteElapsedMs !== null); assert.equal(row.bodyComplete, false);
  });
});

test('body stalls after its first byte: progress is numeric-only and cost stays unknown', async () => {
  const prefix = '{"model":';
  await localServer((_req, res) => { res.writeHead(200); res.write(prefix); const timer = setTimeout(() => res.end('{}'), 1000); res.on('close', () => clearTimeout(timer)); }, async fetchImpl => {
    const { guard, row, records } = await attempt(fetchImpl, { timeoutMs: 150 });
    assert.equal(guard.state.stopped, 'PROVIDER_TIMEOUT'); assert.equal(row.failurePhase, 'body'); assert.equal(row.httpStatus, 200);
    assert.equal(row.bodyBytesReceived, Buffer.byteLength(prefix)); assert(row.bodyChunksReceived >= 1);
    assert(row.bodyReadStartedElapsedMs >= row.transportHeadersElapsedMs); assert(row.firstBodyByteElapsedMs >= row.bodyReadStartedElapsedMs); assert(row.lastBodyByteElapsedMs >= row.firstBodyByteElapsedMs);
    assert(row.bodyIdleElapsedMs >= 80); assert.equal(row.bodyComplete, false); assert.equal(guard.state.costUsd, null); assert.equal(records, 0);
    assert(!JSON.stringify(row).includes(prefix));
  });
});

test('successful chunked UTF-8 response measures body progress and still parses the complete JSON', async () => {
  const data = Buffer.from(JSON.stringify({ ...result(), echo: 'Tiếng Việt' }));
  const split = data.indexOf(Buffer.from('ế')) + 1;
  await localServer((_req, res) => { res.writeHead(200); res.write(data.subarray(0, split)); const timer = setTimeout(() => res.end(data.subarray(split)), 60); res.on('close', () => clearTimeout(timer)); }, async fetchImpl => {
    const { row, response, records } = await attempt(fetchImpl);
    assert.equal(response.status, 200); assert.equal(row.valid, true); assert.equal(row.bodyComplete, true); assert.equal(records, 1);
    assert.equal(row.bodyBytesReceived, data.length); assert(row.bodyChunksReceived >= 2);
    assert(row.lastBodyByteElapsedMs > row.firstBodyByteElapsedMs); assert(row.bodyReadElapsedMs >= 40);
    assert.equal(row.usage.cost, 0); assert.equal(row.responseObserved, true);
  });
});

test('progress persistence failures are record errors rather than provider body timeouts', async () => {
  for (const when of ['headers', 'body']) {
    let failed = false;
    const { guard, row, records } = await attempt(async () => new Response(JSON.stringify(result())), {}, state => {
      const current = state.requests[0];
      if (!failed && current && (when === 'headers' ? current.httpStatus === 200 && current.phase === 'body' : current.bodyComplete)) {
        failed = true; throw new Error(key);
      }
    });
    assert.equal(guard.state.stopped, 'PROVIDER_RECORD_ERROR'); assert.equal(row.failurePhase, 'record');
    assert.equal(row.httpStatus, 200); assert.equal(row.bodyComplete, when === 'body'); assert.equal(records, 0);
    assert.equal(guard.state.costUnknown, true); assert(!JSON.stringify(guard.state).includes(key));
  }
});

test("redirect cannot reach its target", async () => {
  let requests = 0;
  await localServer((_req, res) => { requests++; res.writeHead(302, { location: "/target" }); res.end(); }, async fetchImpl => {
    const { guard } = await attempt(fetchImpl); assert.equal(guard.state.stopped, "PROVIDER_TRANSPORT_ERROR"); assert.equal(requests, 1);
  });
});

test("local success and record failure separate observed usage from actual billing", async () => {
  await localServer((_req, res) => res.end(JSON.stringify(result())), async fetchImpl => {
    const { guard, row, response, records } = await attempt(fetchImpl);
    assert.equal(response.status, 200); assert.equal(records, 1); assert(row.valid); assert.equal(row.phase, "complete");
    assert.equal(guard.state.modelInferenceObserved, true); assert.equal(guard.state.costUnknown, false); assert.equal(guard.state.costUsd, 0); assert.equal(guard.state.actualCostUsd, null);
  });
  const { guard, row } = await attempt(async () => new Response(JSON.stringify(result())), { record: async () => { throw new Error(key); } });
  assert.equal(guard.state.stopped, "PROVIDER_RECORD_ERROR"); assert.equal(row.failurePhase, "record");
  const accounting = providerAccounting(guard.state);
  assert.deepEqual([accounting.providerRequestAttempts, accounting.providerResponsesObserved, accounting.usageReports, accounting.modelInferenceObserved, accounting.costUnknown, accounting.actualCostUsd], [1, 1, 1, true, false, null]);
  assert(!JSON.stringify(guard.state).includes(key));
});

test("runner rejects missing, historical and pending grants before any side effect", () => {
  const confirmed = { status: "NEW_RUN_BUDGET_CONFIRMED", priorRequestAttempts: 12, maxRequests: 11, totalAuthorizedRequests: 23, maxRequestsPerCase: 2, maxCostUsd: 0, retries: 0, probeRequests: 0, paidFallback: false };
  for (const authorization of [null, { status: "GRANTED" }, { status: "PENDING_BUDGET_CONFIRMATION" }, { ...confirmed, totalAuthorizedRequests: 21 }, { ...confirmed, maxRequests: 21 }]) {
    const preflightFile = ".local/automation/n8n04-offline-denied/preflight.json";
    const preload = `
      import fs from 'node:fs/promises';
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const denied = () => { process.stderr.write('OFFLINE_SIDE_EFFECT_DENIED'); throw new Error('OFFLINE_SIDE_EFFECT_DENIED'); };
      const read = fs.readFile;
      fs.readFile = (file, ...args) => file === '${preflightFile}' ? Promise.resolve(${JSON.stringify(JSON.stringify({ authorization }))}) : /\.(mjs|cjs|js)$|package\.json$/.test(String(file)) ? read(file, ...args) : denied();
      fs.mkdir = fs.writeFile = cp.execFileSync = cp.spawn = globalThis.fetch = denied;
      syncBuiltinESMExports();
    `;
    const child = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, "scripts/run-n8n04-benchmark.mjs", ...(authorization ? [preflightFile] : [])], { encoding: "utf8", env: {}, windowsHide: true, timeout: 5000 });
    assert.equal(child.error, undefined); assert.notEqual(child.status, 0);
    assert.match(child.stderr, authorization?.status === "NEW_RUN_BUDGET_CONFIRMED" ? /totalAuthorizedRequests|maxRequests/ : authorization ? /NEW_RUN_BUDGET_CONFIRMED/ : /new budget-confirmed preflight/);
    assert(!child.stderr.includes("OFFLINE_SIDE_EFFECT_DENIED"));
  }
});

test("reasoning usage is numeric-only and an ignored disable instruction stops the next request", async () => {
  for (const tokens of [0, 10, 'invalid']) {
    const response = { ...result(), usage: { cost: 0, completion_tokens_details: { reasoning_tokens: tokens } } };
    const { guard, row } = await attempt(async () => new Response(JSON.stringify(response)));
    assert.equal(row.usage.reasoning_tokens, typeof tokens === 'number' ? tokens : undefined);
    assert(!JSON.stringify(row.usage).includes(key));
    if (tokens === 10) {
      assert.equal(guard.state.stopped, 'REASONING_NOT_DISABLED');
      assert.equal((await guard.request('VI-01', 'answer', answer)).status, 502);
      assert.equal(guard.state.requests.length, 1);
    }
  }
});

test("runner sums twelve prior attempts without double counting and rejects incomplete history (all I/O mocked)", async t => {
  for (const mode of ["engine", "reused", "source-race", "prior-undercount", "missing-latest-receipt", "raw-count-mismatch", "cumulative-mismatch", "duplicate-history", "unknown-history", "case-budget"]) await t.test(mode, () => {
    const preload = `
      import fs from 'node:fs/promises';
      import cp from 'node:child_process';
      import { createHash } from 'node:crypto';
      import { syncBuiltinESMExports } from 'node:module';
      const read = fs.readFile, hash = b => createHash('sha256').update(b).digest('hex');
      const sourceChecks = {};
      for (const file of ['scripts/run-n8n04-benchmark.mjs', 'scripts/n8n04-benchmark-guard.mjs', 'scripts/n8n04-benchmark-guard.test.mjs']) sourceChecks[file] = hash(await read(file));
      const raw = JSON.stringify({ providerRequests: 1 }), latest = JSON.stringify({ providerRequestAttempts: 2 }), final = JSON.stringify({ providerRequestAttempts: '${mode}' === 'raw-count-mismatch' ? 8 : 9 });
      const ref = { file: '.local/automation/n8n04-offline-denied/old.json', sha256: hash(raw) };
      const recent = { file: '.local/automation/n8n04-offline-denied/recent.json', sha256: hash(latest) };
      const session = { file: '.local/automation/n8n04-offline-denied/session.json', sha256: hash('{}') };
      const finalRef = { file: '.local/automation/n8n04-offline-denied/final.json', sha256: hash(final) };
      const last = { priorRequestAttempts: 3, newProviderRequestAttempts: '${mode}' === 'unknown-history' ? null : 9, cumulativeProviderRequestAttempts: '${mode}' === 'cumulative-mismatch' ? 11 : 12, sourceChecks, rawReceipt: finalRef };
      const evidence = JSON.stringify({ first: { providerRequestAttempts: 1, rawReceipt: ref }, second: { priorRequestAttempts: 1, newProviderRequestAttempts: 2, cumulativeProviderRequestAttempts: 3, sourceChecks, rawReceipt: recent, receipt: session }, last, ...('${mode}' === 'duplicate-history' ? { duplicate: last } : {}) });
      const preflight = { status: 'PREFLIGHT_PASS_INFERENCE_PENDING', authorization: { status: 'NEW_RUN_BUDGET_CONFIRMED', priorRequestAttempts: '${mode}' === 'prior-undercount' ? 3 : 12, maxRequests: 11, totalAuthorizedRequests: 23, maxRequestsPerCase: 2, maxCostUsd: 0, retries: 0, probeRequests: 0, paidFallback: false }, sourceChecks, receiptChecks: '${mode}' === 'missing-latest-receipt' ? [ref, recent, session] : [ref, recent, session, finalRef] };
      if ('${mode}' === 'case-budget') { preflight.authorization.maxRequests = 1; preflight.authorization.totalAuthorizedRequests = 13; }
      let engine = false;
      const denied = () => { process.stderr.write('OFFLINE_SIDE_EFFECT_DENIED'); throw new Error('OFFLINE_SIDE_EFFECT_DENIED'); };
      fs.readFile = (file, ...args) => {
        if (file === '.local/automation/n8n04-offline-denied/preflight.json') return Promise.resolve(JSON.stringify(preflight));
        if (file === 'workflows/n8n/chat-hardening-evidence.json') return Promise.resolve(evidence);
        if (file === 'workflows/n8n/chat-benchmark.json') return Promise.resolve('[{"id":"VI-01","input":"synthetic","expected":"original"}]');
        if (file === ref.file) return Promise.resolve(raw);
        if (file === recent.file) return Promise.resolve(latest);
        if (file === session.file) return Promise.resolve('{}');
        if (file === finalRef.file) return Promise.resolve(final);
        if (engine && '${mode}' === 'source-race' && Object.hasOwn(sourceChecks, file)) return Promise.resolve('changed');
        return /\.(mjs|cjs|js)$|package\.json$/.test(String(file)) ? read(file, ...args) : denied();
      };
      fs.mkdir = async () => {};
      fs.writeFile = async (file, body, options) => {
        if (file.endsWith('/benchmark-started.json') || file.endsWith('\\\\benchmark-started.json')) {
          if (options.flag !== 'wx') denied();
          if ('${mode}' === 'reused') throw Object.assign(new Error('already claimed'), { code: 'EEXIST' });
        }
        if (file.endsWith('/receipt.json')) process.stdout.write('MOCK_RECEIPT ' + JSON.stringify(JSON.parse(body)) + '\\n');
      };
      cp.execFileSync = () => { if (!['engine', 'source-race', 'duplicate-history'].includes('${mode}')) denied(); engine = true; throw new Error('MOCK_ENGINE_UNAVAILABLE'); };
      cp.spawn = globalThis.fetch = denied;
      syncBuiltinESMExports();
    `;
    const child = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, "scripts/run-n8n04-benchmark.mjs", ".local/automation/n8n04-offline-denied/preflight.json"], { encoding: "utf8", env: {}, windowsHide: true, timeout: 5000 });
    assert.equal(child.error, undefined); assert.equal(child.status, 1); assert(!child.stderr.includes("OFFLINE_SIDE_EFFECT_DENIED"));
    const receipt = JSON.parse(child.stdout.split("\n").find(line => line.startsWith("MOCK_RECEIPT ")).slice(13));
    assert.equal(receipt.status, ["engine", "duplicate-history"].includes(mode) ? "SKIP_ENGINE_UNAVAILABLE" : mode === "source-race" ? "BENCHMARK_STOPPED_SOURCE_INTEGRITY" : "BENCHMARK_STOPPED");
    assert.equal(receipt.finalIntegrity, mode === "source-race" ? "FAIL" : "PASS");
    assert.equal(receipt.providerRequestAttempts, 0); assert.equal(receipt.credentialRead, false);
    assert.equal(receipt.cumulativeProviderRequestAttempts, ["engine", "reused", "source-race", "duplicate-history", "case-budget"].includes(mode) ? 12 : null);
  });
});
