// Always creates a fresh Docker project; never reads .env or connects to an existing DB/runtime.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { writeFileSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import { connectBroker } from "@spacex/messaging";
import { parseN8nOutput } from "./n8n-output.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)); process.chdir(root);
const project = `space-agent-automation-test-${randomBytes(6).toString("hex")}`;
const directory = path.join(root, ".local", "automation", project); await mkdir(directory, { recursive: true });
if (process.platform === "win32") {
  const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding:"utf8" }).match(/S-1-[\d-]+/)?.[0];
  assert(sid, "Current artifact owner required");
  execFileSync("icacls", [directory,"/inheritance:r","/grant:r",`*${sid}:(OI)(CI)F`, "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"], {encoding:"utf8"});
}
const secret = () => randomBytes(32).toString("hex");
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
const envFile = path.join(directory, "runtime.env"), bridgePassword = secret(), identityPassword = secret();
const bridgePort = await freePort(), n8nPort = await freePort(), brokerPassword = secret();
await writeFile(envFile, [
  `N8N_POSTGRES_ADMIN_PASSWORD=${secret()}`, `N8N_DB_PASSWORD=${secret()}`, `N8N_ENCRYPTION_KEY=${secret()}`,
  `N8N_LOCAL_PORT=${n8nPort}`, `AUTOMATION_TEST_ADMIN_PASSWORD=${secret()}`, `AUTOMATION_TEST_BROKER_PASSWORD=${brokerPassword}`, "",
].join("\n"), { mode: 0o600 });
const composeArgs = ["compose", "--env-file", envFile, "-p", project, "-f", "infra/n8n/compose.yml", "-f", "infra/automation/compose.test.yml"];
function compose(...args) {
  try { return execFileSync("docker", [...composeArgs, ...args], { encoding: "utf8", timeout: 300000, maxBuffer: 15 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) {
    writeFileSync(path.join(directory, "docker-failure.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { mode: 0o600 });
    throw new Error(`Docker ${args[0]} failed; private log in ${directory}`);
  }
}
const cli = (...args) => compose("run", "--rm", "-T", "--no-deps", "n8n", ...args);
const sql = query => compose("exec", "-T", "postgres", "psql", "-U", "n8n_admin", "-d", "n8n", "-Atc", query).trim();
const evidence = { project, startedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), status: "FAIL", checks: [], artifacts: {} };
const envPaths = [".env", ...["identity", "catalog", "class-schedule", "crm", "org", "gateway", "automation-bridge", "conversation"].map(s => `services/${s}/.env`), "apps/admin-portal/.env", "apps/admin-portal/.env.local"];
async function personalEnvMetadata() {
  const result={};for(const file of envPaths) try {const info=await stat(file);result[file]={size:info.size,mtimeMs:info.mtimeMs};}catch(e){if(e.code!=="ENOENT")throw e;}return result;
}
const envBefore=await personalEnvMetadata();
function existingRuntime() {
  const ids=execFileSync("docker",["ps","-a","--filter","label=com.docker.compose.project=space-agent-n8n","--format","{{.ID}}"],{encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);
  return ids.length ? JSON.parse(execFileSync("docker",["inspect",...ids],{encoding:"utf8"})).map(r=>({name:r.Name,startedAt:r.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name)) : [];
}
const runtimeBefore=existingRuntime();
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function runNode(args, env = process.env, cwd = root, log = "node.log") {
  const fd = openSync(path.join(directory, log), "w");
  try {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", fd, fd], windowsHide: true });
    const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    assert.equal(status, 0, `Node command failed; private log: ${path.join(directory, log)}`);
  } finally { closeSync(fd); }
}
async function eventually(check) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Timed out waiting for isolated runtime");
}
let child, pool, broker;
const children = [];
try {
  // Existing images are reused; image downloads can be performed explicitly before this harness.
  compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240");
  evidence.runtime = {
    node: process.version,
    docker: execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim(),
    compose: execFileSync("docker", ["compose", "version", "--short"], { encoding: "utf8" }).trim(),
    postgres: compose("exec", "-T", "bridge-db", "postgres", "--version").trim(),
    rabbitmq: compose("exec", "-T", "rabbitmq", "rabbitmqctl", "version").trim(),
    images: JSON.parse(compose("images", "--format", "json")),
  };
  const port = service => Number(compose("port", service, service === "rabbitmq" ? "5672" : "5432").trim().split(":").at(-1));
  compose("exec", "-T", "bridge-db", "psql", "-U", "automation_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `
    CREATE ROLE bridge_test LOGIN PASSWORD '${bridgePassword}';
    CREATE ROLE identity_test LOGIN PASSWORD '${identityPassword}';`);
  for (const [name, role] of [["automation_bridge_test", "bridge_test"], ["automation_identity_test", "identity_test"]])
    compose("exec", "-T", "bridge-db", "createdb", "-U", "automation_test_admin", "-O", role, name);
  compose("exec", "-T", "bridge-db", "psql", "-U", "automation_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `
    REVOKE CONNECT ON DATABASE automation_identity_test FROM PUBLIC;
    REVOKE CONNECT ON DATABASE automation_bridge_test FROM PUBLIC;`);
  const dbUrl = `postgresql://bridge_test:${bridgePassword}@127.0.0.1:${port("bridge-db")}/automation_bridge_test`;
  const identityUrl = `postgresql://identity_test:${identityPassword}@127.0.0.1:${port("bridge-db")}/automation_identity_test`;
  const domainUrls = {};
  for (const service of ["catalog", "class-schedule", ...(process.env.N8N04_TEST === "1" ? ["conversation"] : [])]) {
    const name = service === "catalog" ? "automation_catalog_test" : service === "conversation" ? "automation_conversation_test" : "automation_classes_test", password = secret();
    compose("exec", "-T", "bridge-db", "psql", "-U", "automation_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
    compose("exec", "-T", "bridge-db", "createdb", "-U", "automation_test_admin", "-O", name, name);
    compose("exec", "-T", "bridge-db", "psql", "-U", "automation_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
    domainUrls[service] = `postgresql://${name}:${password}@127.0.0.1:${port("bridge-db")}/${name}`;
  }
  const rabbitUrl = `amqp://automation_test:${brokerPassword}@127.0.0.1:${port("rabbitmq")}`;
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const keyFile = path.join(directory, "authority-private.pem"), publicFile = path.join(directory, "authority-public.pem");
  await writeFile(keyFile, await exportPKCS8(privateKey), { mode: 0o600 });
  await writeFile(publicFile, await exportSPKI(publicKey));
  const runtime = {
    DATABASE_URL: dbUrl, RABBITMQ_URL: rabbitUrl, NODE_ENV: "test", PORT: String(bridgePort), HOST: "127.0.0.1",
    AUTOMATION_MACHINE_PUBLIC_KEY_FILE: publicFile, AUTOMATION_MACHINE_ISSUER: "automation-test-authority",
    AUTOMATION_MACHINE_SUBJECTS: JSON.stringify({ "worker-a": ["bridge-smoke"], "worker-b": ["bridge-smoke"], "n8n-smoke": ["bridge-smoke"], "chat-worker": ["WF-01", "WF-02", "WF-03"] }),
    AUTOMATION_BINDINGS: JSON.stringify([{ eventType: "automation.test.requested", workflowId: "bridge-smoke", workflowVersion: 1, inputSchemaVersion: 1 }, ...(process.env.N8N04_TEST === "1" ? JSON.parse(await readFile("workflows/n8n/chat-manifest.json", "utf8")).bindings : [])]),
    AUTOMATION_EVENT_PATTERNS: JSON.stringify(["automation.test.#", ...(process.env.N8N04_TEST === "1" ? ["channel.#", "conversation.#"] : [])]),
    AUTH_SECRET: secret(), AUTH_ISSUER: "automation-test-identity", AUTH_AUDIENCE: "automation-test-services", IDENTITY_URL: "http://127.0.0.1:1",
  };
  const runtimeFile = path.join(directory, "bridge-env.json"); await writeFile(runtimeFile, JSON.stringify(runtime), { mode: 0o600 });
  const serviceDir = path.join(root, "services", "automation-bridge");
  for (let i = 0; i < 2; i++) await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/migrate.ts"], { ...process.env, ...runtime }, serviceDir, `migration-${i}.log`);
  for (const [service, url] of [["identity", identityUrl], ...Object.entries(domainUrls)]) {
    for (let i = 0; i < 2; i++) await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), service === "catalog" ? "src/db/migrate.ts" : "src/migrate.ts"],
      { ...process.env, DATABASE_URL: url }, path.join(root, "services", service), `${service}-migration-${i}.log`);
  }
  pool = new pg.Pool({ connectionString: dbUrl });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 1);
  const denied = new URL(identityUrl); denied.username = "bridge_test"; denied.password = bridgePassword;
  const other = new pg.Pool({ connectionString: denied.toString() });
  try { await assert.rejects(other.query("SELECT 1")); } finally { await other.end(); }
  check("isolated Bridge DB/role, separate IAM and n8n DB, repeatable versioned migration");
  await runNode([path.join(root, "node_modules/vitest/vitest.mjs"), "run", "src/postgres.test.ts", "--reporter=json", `--outputFile=${path.join(directory, "vitest.json")}`], {
    ...process.env, AUTOMATION_TEST_DATABASE_URL: dbUrl, AUTOMATION_TEST_IDENTITY_URL: identityUrl,
    RABBITMQ_TEST_URL: rabbitUrl, AUTOMATION_TEST_RUNTIME_ENV: runtimeFile, AUTOMATION_TEST_PRIVATE_KEY_FILE: keyFile,
  }, serviceDir, "integration.log");
  const tests = JSON.parse(await readFile(path.join(directory, "vitest.json"), "utf8"));
  assert.equal(tests.numFailedTests, 0); assert(tests.numPassedTests >= 11);
  evidence.integration = { passed: tests.numPassedTests, failed: tests.numFailedTests, tests: tests.testResults.flatMap(r => r.assertionResults.map(a => ({ name: a.title, status: a.status }))) };
  check(`${tests.numPassedTests} real DB/broker/IAM/process integration tests`);
  await runNode([path.join(root, "node_modules/vitest/vitest.mjs"), "run", "src/machine.test.ts", "--reporter=default", "--reporter=json", `--outputFile=${path.join(directory, "machine-vitest.json")}`], {
    ...process.env, AUTOMATION_TEST_DATABASE_URL: dbUrl, AUTOMATION_TEST_IDENTITY_URL: identityUrl,
    AUTOMATION_TEST_CATALOG_URL: domainUrls.catalog, AUTOMATION_TEST_CLASSES_URL: domainUrls["class-schedule"],
    AUTOMATION_TEST_RUNTIME_ENV: runtimeFile, AUTOMATION_TEST_PRIVATE_KEY_FILE: keyFile, AUTOMATION_TEST_RECEIPT: path.join(directory, "machine-receipt.json"),
  }, serviceDir, "machine-integration.log");
  const machineTests = JSON.parse(await readFile(path.join(directory, "machine-vitest.json"), "utf8"));
  assert.equal(machineTests.numFailedTests, 0); assert(machineTests.numPassedTests >= 10);
  evidence.machine = { passed: machineTests.numPassedTests, failed: machineTests.numFailedTests,
    tests: machineTests.testResults.flatMap(r => r.assertionResults.map(a => ({ name: a.title, status: a.status }))),
    receipt: JSON.parse(await readFile(path.join(directory, "machine-receipt.json"), "utf8")) };
  check(`${machineTests.numPassedTests} N8N-03 real IAM/delegation/lease/Catalog/Class tests`);

  const iamPort = await freePort(), catalogPort = await freePort(), classesPort = await freePort(), chatPort = await freePort();
  runtime.IDENTITY_URL = `http://127.0.0.1:${iamPort}`;
  const adminPassword = secret();
  await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/seed.ts"], {
    ...process.env, DATABASE_URL: identityUrl, SEED_ADMIN_EMAIL: "smoke-operator@automation.test", SEED_ADMIN_PASSWORD: adminPassword,
  }, path.join(root, "services/identity"), "smoke-seed.log");
  async function startService(service, extra) {
    const fd = openSync(path.join(directory, `smoke-${service}-${extra.PORT}.log`), "w");
    const processChild = spawn(process.execPath, ["dist/index.js"], { cwd: path.join(root, "services", service), env: { ...process.env, ...runtime, ...extra }, stdio: ["ignore", fd, fd], windowsHide: true });
    closeSync(fd); children.push(processChild);
    await eventually(async () => { try { return (await fetch(`http://127.0.0.1:${extra.PORT}/health`)).ok; } catch { return false; } });
  }
  await startService("identity", { DATABASE_URL: identityUrl, PORT: String(iamPort), HOST: "0.0.0.0", IAM_MACHINE_PRIVATE_KEY_FILE: keyFile, IAM_MACHINE_ISSUER: runtime.AUTOMATION_MACHINE_ISSUER, AUTOMATION_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`, CONVERSATION_URL: `http://127.0.0.1:${chatPort}` });
  await startService("catalog", { DATABASE_URL: domainUrls.catalog, PORT: String(catalogPort), HOST: "0.0.0.0", SERVICE_NAME: "catalog", RABBITMQ_URL: "" });
  await startService("class-schedule", { DATABASE_URL: domainUrls["class-schedule"], PORT: String(classesPort), HOST: "0.0.0.0", RABBITMQ_URL: "" });
  async function iamCall(route, body, token = "") {
    const response = await fetch(`${runtime.IDENTITY_URL}${route}`, { method: "POST", headers: { "content-type": "application/json", connection: "close", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert(response.ok, `IAM smoke ${route}: ${response.status}`); return (await response.json()).data;
  }
  const operator = await iamCall("/api/v1/auth/login", { email: "smoke-operator@automation.test", password: adminPassword });
  const machine = await iamCall("/internal/iam/principals", { id: "n8n-smoke", workflows: ["bridge-smoke"], grants: [
    { audience: "automation-bridge", scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize"] },
    { audience: "catalog", scopes: ["catalog:read"] }, { audience: "class-schedule", scopes: ["classes:read"] },
  ] }, operator.accessToken);

  // Only this synthetic test process binds to Docker's host interface; production defaults to loopback.
  const fd = openSync(path.join(directory, "smoke-bridge.log"), "w");
  child = spawn(process.execPath, ["dist/index.js"], { cwd: serviceDir, env: { ...process.env, ...runtime, HOST: "0.0.0.0" }, stdio: ["ignore", fd, fd], windowsHide: true }); closeSync(fd);
  await eventually(async () => { try { return (await fetch(`http://127.0.0.1:${bridgePort}/ready`)).ok; } catch { return false; } });
  broker = await connectBroker(rabbitUrl, () => undefined);
  const eventId = randomUUID(), correlationId = randomUUID();
  await eventually(async () => { try {
    await broker.publish({ id: eventId, type: "automation.test.requested", version: 1, occurredAt: new Date(0).toISOString(), correlationId,
      entityId: "n8n-smoke", payload: { entity: { type: "smoke", id: "n8n-smoke" }, contextRef: "smoke:verified-context", inputRef: "smoke:synthetic-input" } }); return true;
  } catch { return false; } });
  await eventually(async () => !!(await pool.query("SELECT 1 FROM automation_jobs WHERE event_id=$1", [eventId])).rowCount);
  const workflow = JSON.parse(await readFile("workflows/n8n/bridge-smoke.json", "utf8"));
  for (const node of workflow[0].nodes) if (node.parameters.url) node.parameters.url = node.parameters.url.replace(":4006/", `:${bridgePort}/`);
  const workflowFile = path.join(directory, "bridge-smoke.json"); await writeFile(workflowFile, JSON.stringify(workflow));
  compose("exec", "-T", "n8n", "mkdir", "-p", "/home/node/.n8n/smoke");
  compose("cp", workflowFile, "n8n:/home/node/.n8n/smoke/bridge-smoke.json");
  cli("import:workflow", "--input=/home/node/.n8n/smoke/bridge-smoke.json");
  const { accessToken: token } = await iamCall("/internal/iam/machine/token", { clientId: "n8n-smoke", clientSecret: machine.clientSecret, audience: "automation-bridge", scopes: ["automation:claim", "automation:checkpoint", "automation:result", "automation:authorize"], workflows: ["bridge-smoke"] });
  const credentialFile = path.join(directory, "credential.json");
  await writeFile(credentialFile, JSON.stringify([{ id: "N8N02BridgeMachine", name: "bridge-smoke-machine", type: "httpHeaderAuth", data: { name: "Authorization", value: `Bearer ${token}` } }]), { mode: 0o600 });
  compose("cp", credentialFile, "n8n:/home/node/.n8n/smoke/credential.json");
  try { cli("import:credentials", "--input=/home/node/.n8n/smoke/credential.json"); }
  finally { compose("exec", "-T", "n8n", "rm", "-f", "/home/node/.n8n/smoke/credential.json"); }
  const output = cli("execute", "--id=N8N02BridgeSmoke", "--rawOutput");
  // Full execution includes lease credentials; keep it only in ignored private test artifacts.
  await writeFile(path.join(directory, "execution-private.json"), output, { mode: 0o600 });
  const result = parseN8nOutput(output);
  assert.equal(result.data.resultData.error, undefined);
  assert.equal(result.data.resultData.lastNodeExecuted, "Bridge result");
  const returned = result.data.resultData.runData["Bridge result"][0].data.main[0][0].json.data;
  assert.equal(returned.status, "DONE"); assert.equal(returned.resultRef, "smoke:N8N-02");
  const job = (await pool.query("SELECT * FROM automation_jobs WHERE event_id=$1", [eventId])).rows[0];
  assert.equal(job.id, returned.jobId); assert.equal(job.status, "DONE"); assert.equal(job.attempt, 1);
  assert.equal(job.operation_refs[0].operationKey, `automation:${job.id}:smoke`);
  const actions = (await pool.query("SELECT action FROM automation_audit WHERE job_id=$1 ORDER BY created_at,id", [job.id])).rows.map(r => r.action);
  assert.deepEqual(actions, ["CLAIM", "CHECKPOINT", "DONE"]);
  evidence.smoke = { workflowId: "N8N02BridgeSmoke", workflowVersion: 1, executionId: sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='N8N02BridgeSmoke' ORDER BY execution_entity.id::bigint DESC LIMIT 1`), jobId: job.id, eventId, correlationId, operationKey: job.operation_refs[0].operationKey, actions, result: returned.status };
  assert(evidence.smoke.executionId);
  evidence.n8nVersion = cli("--version").trim(); assert.equal(evidence.n8nVersion, "2.46.4");
  check("real n8n imported HTTP workflow claim → checkpoint → result; durable DONE and execution receipt");
  const readEventId = randomUUID(), readEntity = { type: "smoke", id: "n8n03-read" };
  const { contextRef } = await iamCall("/internal/iam/delegations", { eventId: readEventId, workflowId: "bridge-smoke", workflowVersion: 1,
    branchId: evidence.machine.receipt.branchA, entity: readEntity, inputRef: "smoke:n8n03-input", operations: ["catalog.read", "classes.read"] }, operator.accessToken);
  await broker.publish({ id: readEventId, type: "automation.test.requested", version: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(),
    entityId: readEntity.id, payload: { entity: readEntity, contextRef, inputRef: "smoke:n8n03-input" } });
  await eventually(async () => !!(await pool.query("SELECT 1 FROM automation_jobs WHERE event_id=$1", [readEventId])).rowCount);
  const readWorkflow = JSON.parse(await readFile("workflows/n8n/iam-read-smoke.json", "utf8"));
  for (const node of readWorkflow[0].nodes) if (node.parameters.url)
    node.parameters.url = node.parameters.url.replace(":4006/", `:${bridgePort}/`).replace(":4001/", `:${catalogPort}/`).replace(":4004/", `:${classesPort}/`);
  const readWorkflowFile = path.join(directory, "iam-read-smoke.json"); await writeFile(readWorkflowFile, JSON.stringify(readWorkflow));
  compose("cp", readWorkflowFile, "n8n:/home/node/.n8n/smoke/iam-read-smoke.json");
  cli("import:workflow", "--input=/home/node/.n8n/smoke/iam-read-smoke.json");
  const readOutput = cli("execute", "--id=N8N03IamReadSmoke", "--rawOutput");
  await writeFile(path.join(directory, "read-execution-private.json"), readOutput, { mode: 0o600 });
  const readResult = parseN8nOutput(readOutput).data.resultData;
  assert.equal(readResult.error, undefined); assert.equal(readResult.lastNodeExecuted, "Read result");
  const runData = readResult.runData;
  assert(runData["Catalog courses"][0].data.main[0][0].json.data.length > 0);
  const classRows = runData["Class list"][0].data.main[0][0].json.data;
  assert(classRows.length > 0); assert(classRows.every(r => r.branchId === evidence.machine.receipt.branchA));
  const readJob = (await pool.query("SELECT id,status FROM automation_jobs WHERE event_id=$1", [readEventId])).rows[0]; assert.equal(readJob.status, "DONE");
  evidence.readSmoke = { workflowId: "N8N03IamReadSmoke", jobId: readJob.id, eventId: readEventId,
    executionId: sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='N8N03IamReadSmoke' ORDER BY execution_entity.id::bigint DESC LIMIT 1`), result: readJob.status,
    courses: runData["Catalog courses"][0].data.main[0][0].json.data.length, classes: classRows.length, authority: "IAM HTTP RS256 issuer + live introspection" };
  assert(evidence.readSmoke.executionId); check("real n8n -> Bridge -> IAM -> Catalog/Class read smoke");
  if (process.env.N8N04_TEST === "1") {
    const { testChat } = await import("./test-chat.mjs");
    evidence.chat = await testChat({ root, directory, pool, domainUrls, identityDb: identityUrl, iamCall, operator, startService, runtime,
      bridgePort, iamPort, catalogPort, classesPort, chatPort, compose, cli, sql, runNode, freePort, children, check });
  }
  evidence.status = "PASS";
} finally {
  if (child && child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once("exit", resolve); child.kill("SIGKILL"); });
  for (const processChild of children.reverse()) if (processChild.exitCode === null && processChild.signalCode === null) await new Promise(resolve => { processChild.once("exit", resolve); processChild.kill("SIGKILL"); });
  await broker?.close(); await pool?.end();
  evidence.finishedAt = new Date().toISOString();
  evidence.artifacts["scripts/n8n-output.mjs"] = createHash("sha256").update(await readFile("scripts/n8n-output.mjs")).digest("hex");
  const envAfter=await personalEnvMetadata(),runtimeAfter=existingRuntime();
  evidence.preservation={personalEnvCount:Object.keys(envBefore).length,envUnchanged:JSON.stringify(envBefore)===JSON.stringify(envAfter),personalEnvContentRead:false,envCheck:"size-and-mtime-only; not content integrity",runtimeUnchanged:JSON.stringify(runtimeBefore)===JSON.stringify(runtimeAfter),runtimeBefore,runtimeAfter,note:"Existing runtime timestamps are the harness baseline; no personal env content is read."};
  if(!evidence.preservation.envUnchanged||!evidence.preservation.runtimeUnchanged)evidence.status="FAIL";
  for (const file of ["infra/automation/compose.test.yml", "scripts/test-automation.mjs", "workflows/n8n/bridge-smoke.json", "services/automation-bridge/src/store.ts", "services/automation-bridge/src/app.ts", "services/automation-bridge/src/auth.ts", "services/automation-bridge/src/index.ts", "services/automation-bridge/src/postgres.test.ts", "services/automation-bridge/migrations/0001.sql", "packages/contracts/src/automation.ts", "packages/contracts/src/events.ts", "packages/messaging/src/postgres.ts"])
    evidence.artifacts[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  for (const file of ["packages/contracts/src/machine.ts", "packages/auth/src/index.ts", "services/identity/src/machine.ts", "services/identity/src/app.ts", "services/identity/src/index.ts", "services/identity/src/migrate.ts", "services/identity/migrations/0002_machine.sql", "services/catalog/src/routes.ts", "services/class-schedule/src/app.ts", "services/automation-bridge/src/machine.test.ts", "workflows/n8n/iam-read-smoke.json"])
    evidence.artifacts[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  if(process.env.N8N04_TEST==="1") {
    for(const folder of ["services/conversation/src","services/conversation/migrations","apps/admin-portal/app/chat","apps/admin-portal/app/api/chat/[action]"])
      for(const entry of await readdir(folder,{withFileTypes:true})) if(entry.isFile()) {const file=`${folder}/${entry.name}`;evidence.artifacts[file]=createHash("sha256").update(await readFile(file)).digest("hex");}
    for(const file of ["services/identity/migrations/0003_channel.sql","packages/contracts/src/conversation.ts","services/gateway/src/app.ts","services/gateway/src/index.ts","apps/admin-portal/app/api/v1/[...path]/route.ts","apps/admin-portal/app/dashboard/mailbox/page.tsx","apps/admin-portal/app/dashboard/layout.tsx","apps/admin-portal/lib/services/conversations.ts","scripts/build-chat-workflows.mjs","scripts/test-chat.mjs","scripts/test-chat-browser.mjs","workflows/n8n/wf-01.json","workflows/n8n/wf-02.json","workflows/n8n/wf-03.json","workflows/n8n/chat-manifest.json","workflows/n8n/chat-benchmark.json"])
      evidence.artifacts[file]=createHash("sha256").update(await readFile(file)).digest("hex");
  }
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  compose("down"); // No -v: retain only this fresh test project's volumes for inspection.
  const volumes=execFileSync("docker",["volume","ls","--filter",`label=com.docker.compose.project=${project}`,"--format","{{.Name}}"],{encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);
  evidence.retainedVolumes=volumes.map(name=>({name,kib:Number(execFileSync("docker",["run","--rm","--network","none","--mount",`type=volume,source=${name},target=/data,readonly`,"postgres:17.7-alpine@sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2","du","-sk","/data"],{encoding:"utf8"}).trim().split(/\s+/)[0])}));
  async function bytes(folder) {let total=0;for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);total+=entry.isDirectory()?await bytes(file):(await stat(file)).size;}return total;}
  evidence.privateArtifactsBytes=await bytes(directory);
  await writeFile(path.join(directory,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  assert(evidence.preservation.envUnchanged&&evidence.preservation.runtimeUnchanged,"personal environment and existing runtime preservation");
  console.log(`Evidence: ${path.join(directory, "evidence.json")} (test volumes retained)`);
}
