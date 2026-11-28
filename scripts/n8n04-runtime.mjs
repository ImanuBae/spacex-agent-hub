// Focused setup reuses existing Compose, generated secrets, migrations and service bootstrap.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeFileSync, openSync, closeSync } from "node:fs";
import { createServer, isIPv4 } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";

import { verifyIsolation, acceptanceOverlay } from "./n8n04-isolation.mjs";
const hostEnv = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "COMSPEC", "PATHEXT", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
export async function lookupFinishedJob(h, client, workflowId, claimed) {
  if (!claimed?.jobId) return null;
  const { accessToken } = await h.iamCall("/internal/iam/machine/token", { clientId: client.id, clientSecret: client.clientSecret, audience: "automation-bridge", scopes: ["automation:read"], workflows: [workflowId], ttlSeconds: 60 });
  const response = await fetch(`http://127.0.0.1:${h.bridgePort}/internal/automation/jobs/${claimed.jobId}`, { headers: { authorization: `Bearer ${accessToken}`, connection: "close" }, redirect: "error", signal: AbortSignal.timeout(5000) });
  assert(response.ok, "Lost result requires an authoritative job lookup");
  const { data: job } = await response.json();
  assert(job.jobId === claimed.jobId && job.eventId === claimed.eventId && job.workflowId === workflowId && job.workflowVersion === claimed.workflowVersion && job.inputRef === claimed.inputRef && job.contextRef === claimed.contextRef && job.entity?.id === claimed.entity?.id, "Lookup cannot substitute another operation");
  return job.status === "DONE" ? job : null;
}
export async function withAcceptanceRuntime(run, record, bindings) {
assert(!process.env.DOCKER_HOST || /^(npipe:\/\/|unix:\/\/)/.test(process.env.DOCKER_HOST), "Local Docker Engine required");
const endpoint=execFileSync("docker",["context","inspect","--format","{{.Endpoints.docker.Host}}"],{env:hostEnv,encoding:"utf8"}).trim();
assert(/^(npipe:\/\/|unix:\/\/)/.test(endpoint), "Local Docker context required");
const root = fileURLToPath(new URL("../", import.meta.url)); process.chdir(root);
const project = `space-agent-n8n04-acceptance-${randomBytes(6).toString("hex")}`;
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
const overlay=path.join(directory,"compose.acceptance.json");
await writeFile(overlay,JSON.stringify(acceptanceOverlay));
const composeArgs = ["compose", "--env-file", envFile, "-p", project, "-f", "infra/n8n/compose.yml", "-f", "infra/automation/compose.test.yml", "-f", overlay];
function compose(...args) {
  try { return execFileSync("docker", [...composeArgs, ...args], { env: hostEnv, encoding: "utf8", timeout: 300000, maxBuffer: 15 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) {
    writeFileSync(path.join(directory, "docker-failure.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { mode: 0o600 });
    throw new Error(`Docker ${args[0]} failed; private log in ${directory}`);
  }
}
const cli = (...args) => compose("run", "--rm", "-T", "--no-deps", "n8n", ...args);
const sql = query => compose("exec", "-T", "postgres", "psql", "-U", "n8n_admin", "-d", "n8n", "-Atc", query).trim();
const evidence = record; Object.assign(evidence, { project, startedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), status: "FAIL", checks: [], artifacts: {} });
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function runNode(args, env = hostEnv, cwd = root, log = "node.log") {
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
let pool; const children=[];
try {
  // Existing images are reused; image downloads can be performed explicitly before this harness.
  evidence.isolation = verifyIsolation(project, compose, hostEnv);
  compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240");
  evidence.actualIsolation = verifyIsolation(project, compose, hostEnv, true);
  const backendHost = compose("exec", "-T", "n8n", "node", "-e", "require('node:dns').lookup('host.docker.internal',{family:4},(error,address)=>{if(error)throw error;process.stdout.write(address);})").trim();
  assert(isIPv4(backendHost) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(backendHost), "Private Docker host address required");
  evidence.backendHost = backendHost;
  assert.equal(sql("SELECT count(*) FROM workflow_entity"),"0");
  assert.equal(sql("SELECT count(*) FROM credentials_entity"),"0");
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
  for (const service of ["catalog", "class-schedule", "conversation"]) {
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
    AUTOMATION_MACHINE_SUBJECTS: JSON.stringify({ "chat-worker": bindings ? bindings.map(b=>b.workflowId) : ["WF-01", "WF-02", "WF-03"] }),
    AUTOMATION_BINDINGS: JSON.stringify(bindings ?? JSON.parse(await readFile("workflows/n8n/chat-manifest.json", "utf8")).bindings),
    AUTOMATION_EVENT_PATTERNS: JSON.stringify(["channel.#", "conversation.#", ...(bindings?.map(b=>b.eventType) ?? [])]),
    AUTH_SECRET: secret(), AUTH_ISSUER: "automation-test-identity", AUTH_AUDIENCE: "automation-test-services", IDENTITY_URL: "http://127.0.0.1:1",
  };
  const serviceDir = path.join(root, "services", "automation-bridge");
  await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/migrate.ts"], { ...hostEnv, ...runtime }, serviceDir, "migration.log");
  for (const [service, url] of [["identity", identityUrl], ...Object.entries(domainUrls)]) {
    await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), service === "catalog" ? "src/db/migrate.ts" : "src/migrate.ts"],
      { ...hostEnv, DATABASE_URL: url }, path.join(root, "services", service), `${service}-migration.log`);
  }
  pool = new pg.Pool({ connectionString: dbUrl });
  assert.deepEqual((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map(row => row.version), ["0001", "0002"]);
  const denied = new URL(identityUrl); denied.username = "bridge_test"; denied.password = bridgePassword;
  const other = new pg.Pool({ connectionString: denied.toString() });
  try { await assert.rejects(other.query("SELECT 1")); } finally { await other.end(); }
  check("isolated Bridge DB/role, separate IAM/domain/n8n DB; fresh migrations only");
  const iamPort = await freePort(), catalogPort = await freePort(), classesPort = await freePort(), chatPort = await freePort();
  runtime.IDENTITY_URL = `http://127.0.0.1:${iamPort}`;
  const adminPassword = secret();
  await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/seed.ts"], {
    ...hostEnv, DATABASE_URL: identityUrl, SEED_ADMIN_EMAIL: "smoke-operator@automation.test", SEED_ADMIN_PASSWORD: adminPassword,
  }, path.join(root, "services/identity"), "smoke-seed.log");
  async function startService(service, extra) {
    const fd = openSync(path.join(directory, `smoke-${service}-${extra.PORT}.log`), "w");
    const processChild = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/index.ts"], { cwd: path.join(root, "services", service), env: { ...hostEnv, ...runtime, ...extra }, stdio: ["ignore", fd, fd], windowsHide: true });
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

  await startService("automation-bridge", { PORT:String(bridgePort), HOST:"0.0.0.0" });
  const loginFixture = email => iamCall("/api/v1/auth/login", { email, password: adminPassword });
  await run({root,directory,pool,domainUrls,identityDb:identityUrl,iamCall,operator,loginFixture,startService,runtime,backendHost,bridgePort,iamPort,catalogPort,classesPort,chatPort,compose,cli,sql,runNode,freePort,children,check});
  evidence.status="PASS";
} finally {
  for (const child of children.reverse()) if(child.exitCode===null && child.signalCode===null) await new Promise(resolve=>{child.once("exit",resolve);child.kill("SIGKILL");});
  await pool?.end();
  evidence.finishedAt=new Date().toISOString();
  await writeFile(path.join(directory,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  if(evidence.isolation) compose("down"); // Keep test volumes; never prune.
}
}
