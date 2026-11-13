// Full n8n/DB/guard transport checks using a loopback provider and synthetic credential substitution.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parseN8nOutput } from "./n8n-output.mjs";
assert.match(process.argv[2] ?? "", /^\.local\/automation\/[a-z0-9-]+\/preflight\.json$/);
const json = async file => JSON.parse(await readFile(file, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ref = async file => ({ file, sha256: sha(await readFile(file)) });
const template = await json(process.argv[2]), results = [];
const directory = `.local/automation/n8n04-transport-${randomBytes(6).toString("hex")}`;
await mkdir(directory);
try {
  for (const mode of ["headers", "body", "partial", "n8n-first"]) {
    const runDir = `${directory}-${mode}`; await mkdir(runDir);
    await writeFile(`${runDir}/preflight.json`, JSON.stringify({ ...template, syntheticOnly: true, syntheticScenario: mode }, null, 2) + "\n", { flag: "wx" });
    const preload = pathToFileURL(path.resolve("scripts/n8n04-transport-preload.mjs")); preload.searchParams.set("mode", mode);
    let output = "";
    const child = spawn(process.execPath, ["--import", preload.href, "scripts/run-n8n04-benchmark.mjs", `${runDir}/preflight.json`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output += chunk; });
    const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    await writeFile(`${runDir}/run.log`, output, { flag: "wx" });
    const finalLine = output.trim().split(/\r?\n/).findLast(line => line.startsWith("{") && line.includes('"receipt"'));
    assert(finalLine, "Runner must retain a receipt");
    const rawFile = JSON.parse(finalLine).receipt, raw = await json(rawFile);
    const result = { mode, exitCode, rawReceipt: await ref(rawFile), project: raw.project, rawStatus: raw.status, providerCredentialRead: false, newProviderRequests: 0, rawAccountingIsSynthetic: true };
    results.push(result);
    assert.equal(exitCode, 0); assert.equal(raw.guardStopped, "PROVIDER_TIMEOUT");
    assert.equal(raw.boundPriorRequestAttempts, template.authorization.priorRequestAttempts);
    assert.equal(raw.cumulativeProviderRequestAttempts, template.authorization.priorRequestAttempts + 1);
    assert.equal(raw.cases[0].providerRequestAttempts, 0); assert.equal(raw.cases[0].responseKind, "CLARIFICATION_TEMPLATE");
    const row = raw.cases[1], progress = row.provider[0];
    assert.notEqual(raw.cases[0].actual.id, row.actual.id);
    assert.equal(progress.bodyComplete, false); assert.equal(progress.bodyBytesReceived, mode === "partial" ? 9 : 0);
    assert.equal(raw.providerRequestAttempts, 1); assert.equal(raw.providerResponsesObserved, 0);
    assert.equal(raw.costUnknown, true); assert.equal(raw.costUsd, null); assert.equal(raw.actualCostUsd, null);
    assert.equal(row.actual.mode, "HUMAN"); assert.equal(row.actual.errorCode, "TIMEOUT");
    assert.equal(progress.failurePhase, mode === "headers" ? "request" : "body");
    assert.equal(progress.httpStatus, mode === "headers" ? null : 200);
    assert.equal(progress.wire.requestObserved, true); assert.equal(progress.wire.matchedRequests, 1); assert.equal(progress.wire.observerErrors, 0);
    assert.equal(progress.wire.connectionBinding, "REQUEST_SOCKET");
    assert(progress.wire.requestEvents.some(e => e.event === "requestBodyWritten"));
    assert(progress.wire.requestEvents.some(e => e.event === "clientAbort"));
    assert.equal(progress.responseIds["x-generation-id"], mode === "headers" ? undefined : `gen-synthetic-${mode}`);
    assert.equal(progress.firstNonWhitespaceKind, mode === "partial" ? "JSON_OPEN" : null);
    assert.equal(row.dbOutcomes.handoffEvents, 1); assert.equal(row.dbOutcomes.draftReplayStatus, 409); assert.equal(row.dbOutcomes.duplicateInboundNoEffect, true);
    assert.equal(raw.cases.filter(c => c.status === "SKIP").length, 8);
    const transportFile = path.join(path.dirname(raw.providerLedger.file), "synthetic-transport-private.json"), transport = await json(transportFile);
    assert.equal(transport.externalRequests, 0); assert.equal(transport.providerCredentialReads, 0);
    assert.equal(transport.events.filter(e => e.type === "loopback-request").length, 1);
    const trace = parseN8nOutput(await readFile(row.execution.file, "utf8")), modelNode = trace.data.resultData.runData["Model tool request"][0];
    const responseAt = Date.parse(transport.events.find(e => e.type === "guard-http-response").at);
    Object.assign(result, { status: "PASS", transport: await ref(transportFile), syntheticAttempts: 1, httpStatus: progress.httpStatus, failurePhase: progress.failurePhase, responseIds: progress.responseIds, wire: progress.wire, modelNodeExecutionMs: modelNode.executionTime, n8nFinishedBeforeGuardResponse: modelNode.startTime + modelNode.executionTime < responseAt });
    if (mode === "n8n-first") assert.equal(result.n8nFinishedBeforeGuardResponse, true);
    console.log(`PASS synthetic transport ${mode}`);
  }
} finally {
  await writeFile(`${directory}/receipt.json`, JSON.stringify({ status: results.length === 4 && results.every(r => r.status === "PASS") ? "PASS" : "FAIL", providerCredentialRead: false, newProviderRequests: 0, results }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ receipt: `${directory}/receipt.json` }));
}
