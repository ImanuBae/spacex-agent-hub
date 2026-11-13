// Authorized local grant: fresh metadata, hash-verified history, UTC daily cap and a new one-use marker.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { modelId, responseModelId, providerName, providerSlug, temperature, providerTimeoutMs, modelNodeTimeoutMs, draftBudgetMs } from "./n8n04-model.mjs";
import { selectBenchmarkCases, plannedModelRequests } from "./n8n04-benchmark-guard.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
assert(process.argv.length <= 3, "Optional argument: comma-separated corpus case IDs in original order");
const selectedCases = selectBenchmarkCases(await json("workflows/n8n/chat-benchmark.json"), process.argv[2]?.split(","));
const caseIds = selectedCases.map(row => row.id);
const index = await json("workflows/n8n/chat-hardening-evidence.json"), receipts = [], seen = new Set();
const utcDate = new Date().toISOString().slice(0, 10);
let priorRequestAttempts = 0, dailyAttempts = 0, previous;
for (const entry of Object.values(index)) {
  if (!entry?.rawReceipt) continue;
  for (const ref of [entry.rawReceipt, entry.receipt].filter(Boolean)) {
    assert.match(ref.file, /^\.local\/automation\/[a-z0-9-]+\/[a-z0-9-]+\.json$/);
    assert.equal(sha(await readFile(ref.file)), ref.sha256, ref.file); receipts.push(ref);
  }
  const raw = await json(entry.rawReceipt.file), attempts = entry.newProviderRequestAttempts ?? entry.providerRequestAttempts;
  assert(Number.isInteger(attempts) && attempts >= 0);
  assert.equal(raw.providerRequestAttempts ?? raw.providerRequests, attempts);
  if (seen.has(entry.rawReceipt.file)) continue;
  seen.add(entry.rawReceipt.file); priorRequestAttempts += attempts;
  if (raw.checkedAt?.slice(0, 10) === utcDate) dailyAttempts += attempts;
  if (entry.sourceChecks) previous = entry;
}
assert(previous && dailyAttempts < 50);
const sourceChecks = {}, sourceChanges = {};
for (const file of [...Object.keys(previous.sourceChecks), "services/class-schedule/src/migrate.ts", "services/class-schedule/migrations/0005_automation.sql", "scripts/test-n8n03-command.mjs", "scripts/build-iam-command-workflow.mjs", "workflows/n8n/iam-command-smoke.json", "workflows/n8n/iam-command-manifest.json", "scripts/n8n-completion-preflight.mjs", "scripts/prepare-authorized-n8n04.mjs", "scripts/n8n04-price-filter.mjs", "scripts/n8n04-price-filter.test.mjs", "scripts/n8n04-model.mjs", "scripts/n8n04-runtime.test.mjs", "scripts/n8n04-handoff.mjs", "scripts/n8n04-handoff.test.mjs"]) {
  sourceChecks[file] = sha(await readFile(file));
  if (previous.sourceChecks[file] && previous.sourceChecks[file] !== sourceChecks[file]) sourceChanges[file] = { beforeSha256: previous.sourceChecks[file], sha256: sourceChecks[file] };
}
for (const file of ["scripts/n8n04-wire-trace.mjs", "scripts/n8n04-wire-trace.test.mjs", "scripts/test-n8n04-transport.mjs", "scripts/n8n04-transport-preload.mjs"]) sourceChecks[file] = sha(await readFile(file));
const directory = `.local/automation/n8n04-authorized-${randomBytes(6).toString("hex")}`;
await mkdir(directory, { recursive: true });
const key = (await readFile(".local/credentials/openrouter.key", "utf8")).trim();
const metadata = [];
for (const route of ["key", `models/${modelId}/endpoints`]) {
  const response = await fetch(`https://openrouter.ai/api/v1/${route}`, { headers: route === "key" ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000), redirect: "error" });
  assert(response.ok, `Metadata ${response.status}`);
  const data = await response.json(); assert(!JSON.stringify(data).includes(key));
  const file = `${directory}/metadata-${metadata.length + 1}.json`, bytes = JSON.stringify({ checkedAt: new Date().toISOString(), route, data }, null, 2) + "\n";
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); metadata.push({ file, sha256: sha(bytes), data: data.data });
}
const quota = metadata[0].data.free_model_daily_requests;
assert(Number.isInteger(quota?.remaining) && quota.remaining > 0);
const endpoints = metadata[1].data.endpoints;
assert.equal(metadata[1].data.id, responseModelId, "Pinned canonical response ID must match current official endpoint metadata");
assert.equal(endpoints.length, 1, "Review routing before using a new provider");
assert.equal(endpoints[0].provider_name, providerName);
assert.equal(endpoints[0].tag, providerSlug);
assert(["reasoning", "max_tokens", "temperature", "tools", "tool_choice"].every(p=>endpoints[0].supported_parameters.includes(p)), "Pinned request parameters must be advertised");
assert.equal(Number(endpoints[0].pricing.prompt), 0); assert.equal(Number(endpoints[0].pricing.completion), 0);
assert.equal(endpoints[0].supports_tool_choice.function, true);
const maxRequests = Math.min(20, 50 - dailyAttempts, quota.remaining);
const grant = { status: "PREFLIGHT_PASS_INFERENCE_PENDING", authorization: { status: "NEW_RUN_BUDGET_CONFIRMED", source: "User delegated local N8N-03/04 completion, free-model selection and new batches after reviewed fixes", priorRequestAttempts, maxRequests, totalAuthorizedRequests: priorRequestAttempts + maxRequests, maxRequestsPerCase: 2, maxCostUsd: 0, retries: 0, probeRequests: 0, paidFallback: false, utcDate, dailyLimit: 50, dailyAttemptsBefore: dailyAttempts, quotaRemainingBefore: quota.remaining }, selection: { modelId, providerName, providerSlug, temperature, providerTimeoutMs, modelNodeTimeoutMs, draftBudgetMs }, sourceChecks, sourceChanges, receiptChecks: [...receipts, ...metadata.map(({data,route,...ref})=>ref)], metadata: metadata.map(({data, ...ref}) => ref), checkedAt: new Date().toISOString() };
grant.caseIds = caseIds;
grant.plannedModelRequests = plannedModelRequests(selectedCases);
grant.selection.responseModelId = responseModelId;
await writeFile(`${directory}/preflight.json`, JSON.stringify(grant, null, 2) + "\n", { flag: "wx", mode: 0o600 });
await writeFile(`${directory}/acceptance-preflight.json`, JSON.stringify({ authorization: "USER_DELEGATED_N8N04", sourceChecks }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ directory, priorRequestAttempts, dailyAttempts, maxRequests, plannedModelRequests: grant.plannedModelRequests, quotaRemaining: quota.remaining, metadataGets: metadata.length, inferenceAttempts: 0 }));
