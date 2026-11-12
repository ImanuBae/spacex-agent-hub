// Offline preparation only. This file has no runtime, credential or provider execution path.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
assert.equal(process.argv.length, 2, "Usage: node scripts/prepare-n8n04-benchmark.mjs (offline only)");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const directory = `.local/automation/n8n04-benchmark-preparation-${randomBytes(6).toString("hex")}`;
await mkdir(directory, { recursive: true });
const receipt = {
  checkedAt: new Date().toISOString(), timezone: "Asia/Saigon", status: "PREPARATION_FAILED",
  providerAuthorization: "NOT_GRANTED", modelInference: false, providerRequests: 0, costUsd: 0,
  credentialRead: false, personalEnvRead: false, dockerChecked: false, runtimeStarted: false,
  workflowImported: false, workflowActivated: false, pilotAccepted: false, humanReviewPending: true,
  project: null, fixtures: [], sourceChecks: {}, receiptChecks: [], cases: [],
  summary: { passed: 0, failed: 0, skipped: 10 },
};
try {
  const evidenceFile = "workflows/n8n/chat-hardening-evidence.json";
  const evidenceBytes = await readFile(evidenceFile), evidence = JSON.parse(evidenceBytes);
  await writeFile(`${directory}/evidence-before.json`, evidenceBytes, { flag: "wx" });
  for (const file of ["docs/ban-giao-n8n-04.md", "docs/review-n8n-04-hardening.md"])
    await writeFile(`${directory}/${path.basename(file)}.before`, await readFile(file), { flag: "wx" });
  receipt.evidenceBeforeSha256 = sha(evidenceBytes);
  const latest = evidence.focusedChecksumAcceptanceRuntime20261110;
  assert.equal(latest.status, "SYNTHETIC_RUNTIME_PASS");
  assert.deepEqual([latest.executionSummary.passed, latest.executionSummary.failed, latest.executionSummary.skipped], [13, 0, 0]);
  for (const [file, oldHash] of Object.entries({ ...evidence.technicalRun.artifacts, ...evidence.technicalRun.extraArtifacts })) {
    assert(file === "services/conversation/.env.example" || (/^(scripts|services|packages|apps|infra|workflows)\//.test(file) && /\.(ts|tsx|mjs|json|sql|yml)$/.test(file) && !file.includes("\\") && file.split("/").every(part => part && part !== "." && part !== ".." && !part.startsWith("."))), file);
    const actual = sha(await readFile(file));
    assert.equal(actual, evidence.finalReview.currentSourceAgainstTechnicalRun.changedArtifacts[file]?.currentSha256 ?? oldHash, file);
    receipt.sourceChecks[file] = actual;
  }
  for (const [file, expected] of Object.entries(latest.harnessArtifacts)) {
    assert(/^(scripts|infra)\/.+\.(mjs|yml|sql)$/.test(file) && !file.split("/").includes(".."), file);
    assert.equal(sha(await readFile(file)), expected, file);
    receipt.sourceChecks[file] = expected;
  }
  for (const ref of [latest.runtimeReceipt, latest.runtimeEvidence, latest.privateReceipt, latest.preflightReceipt, latest.verification]) {
    assert.match(ref.file, /^\.local\/automation\/[a-z0-9-]+\/[a-z0-9-]+\.json$/);
    assert.equal(sha(await readFile(ref.file)), ref.sha256, ref.file);
    receipt.receiptChecks.push(ref);
  }
  const manifestBytes = await readFile("workflows/n8n/chat-manifest.json"), manifest = JSON.parse(manifestBytes);
  assert.equal(sha(manifestBytes), "1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a");
  assert.equal(manifest.paidFallback, false);
  receipt.canonicalHashes = {};
  for (const workflow of manifest.workflows) {
    assert.match(workflow.file, /^workflows\/n8n\/wf-0[123]\.json$/);
    const bytes = await readFile(workflow.file), data = JSON.parse(bytes)[0];
    assert.equal(sha(bytes), workflow.sha256); assert.equal(data.active, false);
    receipt.canonicalHashes[workflow.file] = workflow.sha256;
    if (workflow.workflowId !== "WF-02") continue;
    assert.equal(workflow.sha256, "885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068");
    for (const node of data.nodes.filter(n => ["Model tool request", "Model answer"].includes(n.name))) {
      assert.equal(node.parameters.url, "https://openrouter.ai/api/v1/chat/completions");
      assert(node.parameters.jsonBody.includes(manifest.model));
      assert(!node.retryOnFail);
    }
  }
  receipt.manifestSha256 = sha(manifestBytes);
  const benchmarkFile = "workflows/n8n/chat-benchmark.json", benchmarkBytes = await readFile(benchmarkFile), cases = JSON.parse(benchmarkBytes);
  assert.equal(cases.length, 10);
  assert.deepEqual(cases.map(c => c.id), Array.from({ length: 10 }, (_, i) => `VI-${String(i + 1).padStart(2, "0")}`));
  assert(cases.every(c => typeof c.input === "string" && c.input.trim() && typeof c.expected === "string" && c.expected.trim()));
  receipt.benchmark = { file: benchmarkFile, sha256: sha(benchmarkBytes) };
  receipt.cases = cases.map(c => ({ ...c, status: "SKIP", reason: "Provider authorization not granted", actual: null, jobId: null, executionId: null, traceSha256: null, providerRequests: 0, usage: null, dbOutcomes: null }));
  receipt.proposal = {
    status: "PROPOSED_NOT_AUTHORIZED", provider: "OpenRouter", endpoint: "https://openrouter.ai/api/v1/chat/completions", model: manifest.model,
    credentialPath: ".local/credentials/openrouter.key", credentialPathSource: "Existing Conversation runbook; file existence/content not checked",
    corpus: { benchmark: receipt.benchmark, conversations: "Ten new sessions, one prompt per session; no historical output or customer/staff data", catalog: { course: "DEMO — Excel cơ bản", goal: "Học hàm Excel cơ bản và xử lý bảng tính", mode: "online", level: "beginner", package: "DEMO — Excel online một buổi", sessions: 1, priceVnd: 100000, policy: "DEMO: Chính sách hoàn tiền/chuyển lớp chưa công bố; cần tư vấn viên. Chat chỉ tư vấn, không giữ chỗ hay tạo đơn." }, classes: "One synthetic OPEN online class, capacity 10, no holds, one UTC session in the future; record exact fixture/seed hash before any provider call", traces: "Private local artifacts only; public evidence contains sanitized summaries, refs and hashes" },
    budget: { maximumProviderRequests: 20, maximumRequestsPerCase: 2, maximumCostUsd: 0, paidFallback: false, retries: 0, probeRequests: 0, historicalResume: false },
    stopConditions: ["Authorization or approved corpus/hash mismatch", "Request cap reached: reject before forwarding", "429/quota, timeout, network/provider error or malformed response", "Missing/invalid usage.cost, usage.cost > 0 or cumulative cost > 0", "Unexpected provider/model or redirect", "Unauthorized tool/URL/data, secret exposure, isolation/lease/binding failure"],
    implementationGate: "A narrow live runner and request-budget enforcement must be implemented/reviewed and checked offline after explicit authorization, before reading the key or starting runtime. This preparation script cannot execute inference.",
  };
  receipt.preparationScriptSha256 = sha(await readFile("scripts/prepare-n8n04-benchmark.mjs"));
  receipt.status = "PREPARATION_PASS_PROVIDER_AUTHORIZATION_REQUIRED";
} catch (error) {
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  const file = `${directory}/receipt.json`;
  await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, benchmark: receipt.summary, providerRequests: 0, receipt: file, sha256: sha(await readFile(file)) }));
}
