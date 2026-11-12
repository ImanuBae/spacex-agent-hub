// Read-only baseline and provider metadata; never performs inference or reads personal env.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const directory = `.local/automation/n8n-completion-${randomBytes(6).toString("hex")}`;
await mkdir(directory, { recursive: true });
const index = JSON.parse(await readFile("workflows/n8n/chat-hardening-evidence.json", "utf8"));
const receiptChecks = [], sourceChecks = {}, seen = new Set(), history = [];
let priorRequestAttempts = 0;
for (const entry of Object.values(index)) {
  if (!entry?.rawReceipt) continue;
  const attempts = entry.newProviderRequestAttempts ?? entry.providerRequestAttempts;
  assert(Number.isInteger(attempts) && attempts >= 0);
  for (const ref of [entry.rawReceipt, entry.receipt].filter(Boolean)) {
    assert.match(ref.file, /^\.local\/automation\/[a-z0-9-]+\/[a-z0-9-]+\.json$/);
    assert.equal(sha(await readFile(ref.file)), ref.sha256, ref.file);
    receiptChecks.push(ref);
  }
  const raw = JSON.parse(await readFile(entry.rawReceipt.file, "utf8"));
  assert.equal(raw.providerRequestAttempts ?? raw.providerRequests, attempts);
  if (seen.has(entry.rawReceipt.file)) continue;
  seen.add(entry.rawReceipt.file);
  priorRequestAttempts += attempts;
  history.push({ file: entry.rawReceipt.file, attempts, checkedAt: raw.checkedAt, requests: raw.cases?.flatMap(c => c.provider ?? []).map(r => ({ startedAt: r.startedAt, forwarded: r.forwarded, usage: r.usage })) });
  if (entry.sourceChecks) Object.assign(sourceChecks, entry.sourceChecks);
}
for (const file of Object.keys(sourceChecks)) assert.equal(sha(await readFile(file)), sourceChecks[file], file);
const receipt = { checkedAt: new Date().toISOString(), directory, status: "BASELINE_VERIFIED", priorRequestAttempts, sourceChecks, receiptChecks, history, metadata: [], inferenceAttempts: 0 };
await writeFile(`${directory}/baseline.json`, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
const key = (await readFile(".local/credentials/openrouter.key", "utf8")).trim();
assert(key.length > 20);
for (const route of ["key", "models/nvidia/nemotron-3.5-lightning:free/endpoints", "models"]) {
  const response = await fetch(`https://openrouter.ai/api/v1/${route}`, { headers: route === "key" ? { authorization: `Bearer ${key}` } : {}, redirect: "error", signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  assert(!JSON.stringify(data).includes(key));
  const file = `${directory}/metadata-${receipt.metadata.length + 1}.json`;
  const bytes = JSON.stringify({ checkedAt: new Date().toISOString(), route, httpStatus: response.status, data }, null, 2) + "\n";
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  receipt.metadata.push({ file, sha256: sha(bytes), route, httpStatus: response.status });
  assert(response.ok, `Metadata ${route}: ${response.status}`);
}
await writeFile(`${directory}/baseline.json`, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ directory, priorRequestAttempts, verifiedSourceFiles: Object.keys(sourceChecks).length, verifiedReceipts: receiptChecks.length, metadataGets: receipt.metadata.length, inferenceAttempts: 0 }));
