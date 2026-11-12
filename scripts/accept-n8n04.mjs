// Credential-free final-checksum delta only. Never import the broad regression/provider harness.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationDraft } from "@spacex/contracts";
import { cases, fixtureWorkflow, fixtureServer, modelId, clarificationModel, clarificationText, acceptedAnswer, acceptedBudgetAnswer, policySources } from "./n8n04-fixture.mjs";
import { verifyIsolation, acceptanceOverlay } from "./n8n04-isolation.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2), reviewedFile = args.find(arg => arg !== "--offline");
assert(args.length <= 2 && args.filter(arg => arg === "--offline").length <= 1, "Usage: node scripts/accept-n8n04.mjs [reviewed-preflight.json] [--offline]");
if (reviewedFile) assert.match(reviewedFile, /^\.local\/automation\/[a-z0-9-]+\/acceptance-preflight\.json$/);
const reviewed = reviewedFile ? JSON.parse(await readFile(reviewedFile, "utf8")) : null;
if (reviewed) assert.equal(reviewed.authorization, "USER_DELEGATED_N8N04");
const sha = value => createHash("sha256").update(value).digest("hex");
const directory = path.join(".local/automation", `n8n04-focused-${randomBytes(6).toString("hex")}`);
await mkdir(directory, { recursive: true });
const old = JSON.parse(await readFile("workflows/n8n/chat-hardening-evidence.json", "utf8"));
const receipt = {
  checkedAt: new Date().toISOString(), timezone: "Asia/Saigon", status: "FAIL", modelInference: false, providerRequests: 0,
  keyRead: false, personalEnvRead: false, workflowActivated: false, pilotAccepted: false, humanReviewPending: true,
  sourceIntegrity: {}, commands: [], offline: { status: "FAIL", cases: [] },
  acceptance: cases.map(c => ({ name: c.name, status: "SKIP", reason: "Runtime not started", jobId: null, executionId: null, requestCounts: null, dbOutcomes: null })),
};
function diagnostic(args) {
  try { const stdout = execFileSync("docker", args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }).trim(); const row = { command: "docker " + args.join(" "), status: "PASS", stdout }; receipt.commands.push(row); return row; }
  catch (e) { const row = { command: "docker " + args.join(" "), status: "FAIL", exitCode: e.status, stderr: String(e.stderr ?? e.message).trim() }; receipt.commands.push(row); return row; }
}
try {
  const hashes = reviewed?.sourceChecks ?? { ...old.technicalRun.artifacts, ...old.technicalRun.extraArtifacts };
  const changed = old.finalReview.currentSourceAgainstTechnicalRun.changedArtifacts;
  let matched = 0;
  for (const [file, hash] of Object.entries(hashes)) {
    assert(file === "services/conversation/.env.example" || (/^(scripts|services|packages|apps|infra|workflows)\//.test(file) && /\.(ts|tsx|mjs|json|sql|yml)$/.test(file) && !file.includes("\\") && file.split("/").every(part => part && part !== "." && part !== ".." && !part.startsWith("."))), `Only repository source artifacts may be hashed: ${file}`);
    const current = sha(await readFile(file));
    if (current === hash) matched++;
    else assert.equal(current, reviewed ? hash : changed[file]?.currentSha256, `unreviewed source delta: ${file}`);
  }
  const manifest = JSON.parse(await readFile("workflows/n8n/chat-manifest.json", "utf8"));
  for (const wf of manifest.workflows) { assert(/^workflows\/n8n\/wf-0[123]\.json$/.test(wf.file)); const bytes = await readFile(wf.file); assert.equal(sha(bytes), wf.sha256); assert.equal(JSON.parse(bytes)[0].active, false); }
  const canonical = JSON.parse(await readFile("workflows/n8n/wf-02.json", "utf8"));
  const canonicalHash = sha(await readFile("workflows/n8n/wf-02.json"));
  assert.equal(canonicalHash, reviewed?.sourceChecks["workflows/n8n/wf-02.json"] ?? "885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068");
  receipt.sourceIntegrity = { status: "PASS", matched, total: Object.keys(hashes).length, wf02Sha256: canonicalHash, manifestSha256: sha(await readFile("workflows/n8n/chat-manifest.json")) };
  const ports = { iam: 41002, bridge: 41006, chat: 41007, blocked: 41008, catalog: 41001, classes: 41004, fixture: 41009 };
  receipt.offline.routingFixtures = [];
  for (const wf of ["wf-01", "wf-03"]) {
    const source = await readFile(`workflows/n8n/${wf}.json`), transformed = fixtureWorkflow(JSON.parse(source), cases[1], ports);
    const file = path.join(directory, wf + ".json"), bytes = JSON.stringify(transformed.workflow, null, 2) + "\n";
    await writeFile(file, bytes); await writeFile(file + ".diff.json", JSON.stringify({ nodes: transformed.diff, settings: transformed.settingsDiff, connections: transformed.connectionsDiff }, null, 2) + "\n");
    assert.deepEqual(transformed.workflow[0].connections, JSON.parse(source)[0].connections);
    receipt.offline.routingFixtures.push({ workflow: wf, canonicalSha256: sha(source), fixtureSha256: sha(bytes), fixtureFile: file, diffFile: file + ".diff.json", runtimeProven: false });
  }
  const server = fixtureServer(); await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const test of cases) {
      const transformed = fixtureWorkflow(canonical, test, ports);
      const bytes = JSON.stringify(transformed.workflow, null, 2) + "\n";
      const file = path.join(directory, test.name + ".json");
      await writeFile(file, bytes); await writeFile(file + ".diff.json", JSON.stringify({ nodes: transformed.diff, settings: transformed.settingsDiff, connections: transformed.connectionsDiff }, null, 2) + "\n");
      if (test.kind !== "gate") assert.deepEqual(transformed.workflow[0].connections, canonical[0].connections);
      for (const node of canonical[0].nodes) if (node.parameters.jsCode) assert.equal(node.parameters.jsCode, transformed.workflow[0].nodes.find(n => n.name === node.name).parameters.jsCode);
      const node = name => transformed.workflow[0].nodes.find(n => n.name === name);
      const run = (name, input, lookup) => new Function("$json", "$", node(name).parameters.jsCode)(input, lookup)[0].json;
      const condition = (name, input) => new Function("$json", `return (${node(name).parameters.conditions.conditions[0].leftValue.slice(3, -2)});`)(input);
      let draft;
      if (test.kind === "gate") {
        const forced = run("Fixture readiness true", { data: { modelReady: false, providerAllowed: false } });
        assert.equal(forced.data.modelReady, true); assert.equal(forced.data.providerAllowed, false);
        for (const name of ["Model ready", "Provider still allowed"]) assert.equal(condition(name, { data: { modelReady: true, providerAllowed: false } }), false);
        assert.throws(() => run("Prompt", { data: { modelReady: true, providerAllowed: false } }), /Provider export denied/);
        draft = run("Missing key", { data: { modelReady: true, providerAllowed: false, errorCode: "DATA_POLICY_BLOCKED" } }, () => ({ first: () => ({ json: { jobId: "00000000-0000-4000-8000-000000000001", leaseToken: "00000000-0000-4000-8000-000000000002", attempt: 1 } }) }));
      } else if (test.kind === "human") {
        const decision = run("Human request decision", {data:{messages:[{sender:"GUEST",text:test.input}]}});
        assert.equal(condition("Human requested", decision), true);
        draft = run("Explicit handoff", {}, () => ({first:()=>({json:{jobId:"00000000-0000-4000-8000-000000000001",leaseToken:"00000000-0000-4000-8000-000000000002",attempt:1}})}));
      } else if (test.kind === "clarification") {
        const decision = run("Clarification decision", { data: { providerAllowed: true, modelReady: true, messages: [{ sender: "GUEST", text: test.input }] } });
        assert.equal(condition("Needs clarification", decision), true);
        const allow = run("Tool allowlist", run("Clarification tool plan", {})); assert.equal(allow.allowed, true);
        const sources = run("Sources", {}, () => ({ first: () => ({ json: { data: [] } }) }));
        const lookup = name => ({ isExecuted: true, first: () => ({ json: name === "Job" ? { startedAt: Date.now(), jobId: "00000000-0000-4000-8000-000000000001", leaseToken: "00000000-0000-4000-8000-000000000002", attempt: 1 } : name === "Clarification decision" ? decision : name === "Sources" ? sources : allow }) });
        draft = run("Draft", run("Clarification answer", {}), lookup);
        assert.equal(draft.text, clarificationText); assert.equal(draft.model, clarificationModel); assert.equal(draft.sources.length, 3);
      } else {
        const post = async stage => {
          const response = await fetch(`${base}/${test.name}/${stage}`, { method: "POST", body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "DEMO synthetic" }] }), signal: AbortSignal.timeout(test.kind === "timeout" ? 100 : 3000) });
          assert.equal(response.status, stage === "tool" ? 503 : stage === "answer" && test.kind === "quota" ? 429 : 200);
          return response.json();
        };
        let planner;
        if (test.kind === "timeout") { await assert.rejects(post("planner"), e => e.name === "TimeoutError"); planner = { error: "request timed out" }; }
        else planner = await post("planner");
        const allow = run("Tool allowlist", planner);
        let response = allow;
        if (test.kind === "tool") {
          const failed = await post("tool");
          response = run("Sources", {}, name => ({ first: () => ({ json: name === "Class list" ? failed : { data: [] } }) }));
          assert.equal(condition("Sources ready", response), false);
          assert.equal(transformed.workflow[0].connections["Sources ready"].main[1][0].node, "Draft");
        } else if (test.kind !== "timeout") {
          response = await post("answer");
          if (test.metadata === "missing") assert.equal(Object.hasOwn(response, "model"), false);
          if (test.metadata === "object") assert.deepEqual(response.model, {});
          if (test.metadata === "empty") assert.equal(response.model, "");
          if (test.metadata === "151_characters") assert.equal(response.model.length, 151);
        }
        const lookup = name => ({ isExecuted: true, first: () => ({ json: name === "Job" ? { startedAt: Date.now(), jobId: "00000000-0000-4000-8000-000000000001", leaseToken: "00000000-0000-4000-8000-000000000002", attempt: 1 } : name === "Sources" ? (test.kind === "tool" ? response : { data: policySources, sources: [{ api: "catalog.courses", readAt: new Date().toISOString() }] }) : allow }) });
        draft = run("Draft", response, lookup); assert.equal(draft.model, modelId);
        if (!test.errorCode) assert.equal(draft.text, test.kind === "budget" ? acceptedBudgetAnswer : acceptedAnswer);
      }
      assert(ConversationDraft.safeParse(draft).success, "real draft contract accepts synthetic output");
      assert.equal(draft.errorCode, test.errorCode);
      receipt.offline.cases.push({ name: test.name, status: "PASS", fixtureSha256: sha(bytes), fixtureFile: file, diffFile: file + ".diff.json", draftContract: "PASS", runtimeProven: false });
    }
    receipt.offline.requests = await (await fetch(base + "/requests")).json();
    assert(receipt.offline.requests.every(r => !r.authorizationPresent));
    assert.equal(receipt.offline.requests.length, 25);
    for (const row of receipt.offline.cases) row.requestCounts = Object.fromEntries(["planner", "answer", "tool"].map(stage => [stage, receipt.offline.requests.filter(r => r.name === row.name && r.stage === stage).length]));
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  // Exercise isolation rejection without Docker, including external volumes and writable host mounts.
  const project = "space-agent-n8n04-acceptance-0123456789ab";
  const config = { name: project, services: Object.fromEntries(["bridge-db", "n8n", "postgres", "rabbitmq"].map(name => [name, { image: "fixture@sha256:abc", restart: "no", networks: { default: null } }])), volumes: { data: { name: project + "_data" } }, networks: { default: { name: project + "_default" } } };
  const verify = c => verifyIsolation(project, () => JSON.stringify(c), {}, false, () => "");
  assert.equal(verify(config).status, "PASS");
  for (const mutate of [c => { c.volumes.data.external = true; }, c => { c.networks.default.name = "old-network"; }, c => { c.services.n8n.volumes = [{ type: "bind", source: ".", read_only: false }]; }, c => { c.services.n8n.ports = [{ host_ip: "0.0.0.0" }]; }]) { const invalid = structuredClone(config); mutate(invalid); assert.throws(() => verify(invalid)); }
  config.services.n8n.volumes = [{ type: "volume", source: "data", target: "/home/node/.n8n" }];
  const containers = Object.keys(config.services).map(name => ({ Config: { Labels: { "com.docker.compose.project": project, "com.docker.compose.service": name } }, NetworkSettings: { Networks: { [project + "_default"]: {} } }, Mounts: name === "n8n" ? [{ Type: "volume", Name: project + "_data", Destination: "/home/node/.n8n", RW: true }] : [] }));
  const actual = rows => verifyIsolation(project, () => JSON.stringify(config), {}, true, command => command === "ps" ? "a b c d" : JSON.stringify(rows));
  assert.equal(actual(containers).status, "PASS");
  const foreign = structuredClone(containers); foreign[1].Mounts[0].Name = "old-volume"; assert.throws(() => actual(foreign));
  const swapped = structuredClone(containers); swapped[0].Mounts = swapped[1].Mounts; swapped[1].Mounts = []; assert.throws(() => actual(swapped));
  const missing = structuredClone(containers); missing[1].Mounts = []; assert.throws(() => actual(missing));
  const duplicate = structuredClone(containers); duplicate[0].Config.Labels["com.docker.compose.service"] = "n8n"; assert.throws(() => actual(duplicate));
  receipt.offline.isolationSelfChecks = { passed: 10, failed: 0, runtimeProven: false };
  const envFile = path.join(directory, "compose-fixture.env"), overlay = path.join(directory, "compose-fixture.json");
  await writeFile(envFile, ["N8N_POSTGRES_ADMIN_PASSWORD=synthetic", "N8N_DB_PASSWORD=synthetic", "N8N_ENCRYPTION_KEY=synthetic", "N8N_LOCAL_PORT=41000", "AUTOMATION_TEST_ADMIN_PASSWORD=synthetic", "AUTOMATION_TEST_BROKER_PASSWORD=synthetic"].join("\n"));
  await writeFile(overlay, JSON.stringify(acceptanceOverlay));
  const osEnv = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "COMSPEC", "PATHEXT"].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  const resolved = execFileSync("docker", ["compose", "--env-file", envFile, "-p", project, "-f", "infra/n8n/compose.yml", "-f", "infra/automation/compose.test.yml", "-f", overlay, "config", "--format", "json"], { env: osEnv, encoding: "utf8", timeout: 15000 });
  const resolvedConfig = JSON.parse(resolved);
  verifyIsolation(project, () => resolved, {}, false, () => "");
  receipt.offline.composeConfig = { status: "PASS", resourceAbsenceMocked: true, actualIsolationProven: false, services: Object.keys(resolvedConfig.services), volumes: Object.values(resolvedConfig.volumes).map(v => v.name), networks: Object.values(resolvedConfig.networks).map(n => n.name), command: `docker compose --env-file ${envFile} -p ${project} -f infra/n8n/compose.yml -f infra/automation/compose.test.yml -f ${overlay} config --format json` };
  receipt.harnessArtifacts = {};
  for (const file of ["scripts/accept-n8n04.mjs", "scripts/n8n04-fixture.mjs", "scripts/n8n04-isolation.mjs", "scripts/n8n04-runtime.mjs", "scripts/n8n04-acceptance-cases.mjs", "scripts/n8n-output.mjs", "infra/n8n/compose.yml", "infra/n8n/init.sql", "infra/automation/compose.test.yml"]) receipt.harnessArtifacts[file] = sha(await readFile(file));
  receipt.offline.status = "PASS";
  diagnostic(["context", "show"]); diagnostic(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  const engine = diagnostic(["version", "--format", "{{.Server.Version}}"]);
  if (args.includes("--offline") || engine.status === "FAIL") {
    receipt.status = engine.status === "FAIL" ? "OFFLINE_PASS_RUNTIME_SKIP_DOCKER_UNAVAILABLE" : "OFFLINE_PASS_RUNTIME_SKIP_REQUESTED";
    for (const row of receipt.acceptance) row.reason = engine.status === "FAIL" ? "Docker Engine unavailable; offline harness passed" : "Offline-only invocation";
  } else {
    const { withAcceptanceRuntime } = await import("./n8n04-runtime.mjs");
    const { runAcceptance } = await import("./n8n04-acceptance-cases.mjs");
    await withAcceptanceRuntime(h => runAcceptance(h, receipt), receipt);
  }
} catch (e) { receipt.error = e.message; process.exitCode = 1; }
finally {
  receipt.summary = { passed: receipt.acceptance.filter(c => c.status === "PASS").length, failed: receipt.acceptance.filter(c => c.status === "FAIL").length, skipped: receipt.acceptance.filter(c => c.status === "SKIP").length };
  receipt.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ status: receipt.status, offline: receipt.offline.status, runtime: receipt.summary, receipt: path.join(directory, "receipt.json") }));
}
