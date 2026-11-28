// N8N-06 gets a new local project, private artifacts and one database/role per service.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { writeFileSync, openSync, closeSync, readdirSync, existsSync } from "node:fs";
import { createServer, createConnection, isIPv4 } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import { acceptanceOverlay } from "./n8n04-isolation.mjs";

const hostEnv = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "COMSPEC", "PATHEXT", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
const secret = () => randomBytes(32).toString("hex");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

async function privateDirectory(directory) {
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory);
  if (process.platform !== "win32") { await chmod(directory, 0o700); return { mode: "0700" }; }
  const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { env: hostEnv, encoding: "utf8" }).match(/S-1-[\d-]+/)?.[0];
  assert(sid, "Current Windows user SID required");
  execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"], { env: hostEnv, encoding: "utf8" });
  return { allowedSids: [sid, "S-1-5-32-544", "S-1-5-18"] };
}

function verifyPrivateAcl(directory, acl) {
  if (process.platform !== "win32") return { status: "PASS", mode: "0700" };
  const items = [directory, ...readdirSync(path.toNamespacedPath(directory), { recursive: true }).map(relative => path.join(directory, relative))];
  const nativePaths = items.map(item => path.toNamespacedPath(item));
  const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    $allowed=$env:N8N06_ALLOWED_SIDS -split ';'
    [Console]::InputEncoding=[System.Text.Encoding]::UTF8
    [array]$items=[Console]::In.ReadToEnd() | ConvertFrom-Json
    $unexpected=0
    foreach($item in $items){
      foreach($entry in (Get-Acl -LiteralPath $item).Access){
        $entrySid=$entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if($entry.AccessControlType -eq 'Allow' -and $allowed -notcontains $entrySid){$unexpected++}
      }
    }
    @{items=$items.Count;unexpected=$unexpected}|ConvertTo-Json -Compress
  `], { env: { ...hostEnv, N8N06_ALLOWED_SIDS: acl.allowedSids.join(";") }, input: JSON.stringify(nativePaths), encoding: "utf8", windowsHide: true });
  const actual = JSON.parse(output);
  assert.equal(actual.items, items.length, "Private-artifact ACL enumeration was incomplete");
  assert.equal(actual.unexpected, 0, "Unexpected private-artifact ACL grant");
  return { status: "PASS", ...actual };
}

// Same mount/resource checks as the historical N8N-04 helper, bound to the new project namespace.
function verifyIsolation(project, compose, running = false) {
  assert.match(project, /^space-agent-n8n0[67]-acceptance-[a-f0-9]{12}$/);
  const docker = (...args) => execFileSync("docker", args, { env: hostEnv, encoding: "utf8" }).trim();
  const config = JSON.parse(compose("config", "--format", "json"));
  assert.equal(config.name, project);
  assert.deepEqual(Object.keys(config.services).sort(), ["bridge-db", "n8n", "postgres", "rabbitmq"]);
  for (const definitions of [config.volumes, config.networks]) for (const definition of Object.values(definitions)) {
    assert(!definition.external); assert(definition.name.startsWith(project + "_"));
  }
  for (const service of Object.values(config.services)) {
    assert.equal(service.restart, "no");
    assert(!service.container_name && !service.network_mode && !service.privileged);
    assert(service.image.includes("@sha256:"));
    for (const port of service.ports ?? []) assert.equal(port.host_ip, "127.0.0.1");
    for (const mount of service.volumes ?? []) {
      if (mount.type === "bind") {
        assert.equal(path.resolve(mount.source), path.resolve("infra/n8n/init.sql")); assert.equal(mount.read_only, true);
      } else { assert.equal(mount.type, "volume"); assert(config.volumes[mount.source]); }
    }
    for (const network of Object.keys(service.networks)) assert(config.networks[network]);
  }
  const ids = docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`).split(/\s+/).filter(Boolean);
  if (!running) {
    assert.equal(ids.length, 0, "Project already exists");
    for (const [type, definitions] of [["volume", config.volumes], ["network", config.networks]]) {
      const names = docker(type, "ls", "--format", "{{.Name}}").split(/\r?\n/);
      for (const definition of Object.values(definitions)) assert(!names.includes(definition.name), "Resource already exists");
    }
  } else {
    assert.equal(ids.length, 4);
    const seen = new Set();
    for (const container of JSON.parse(docker("inspect", ...ids))) {
      assert.equal(container.Config.Labels["com.docker.compose.project"], project);
      const name = container.Config.Labels["com.docker.compose.service"], service = config.services[name];
      assert(service && !seen.has(name), "Unknown or duplicate service"); seen.add(name);
      assert.deepEqual(Object.keys(container.NetworkSettings.Networks).sort(), Object.keys(service.networks).map(n => config.networks[n].name).sort());
      const ordered = rows => rows.map(row => JSON.stringify(row)).sort();
      assert.deepEqual(ordered(container.Mounts.map(m => [m.Type, m.Type === "volume" ? m.Name : "init.sql", m.Destination, m.RW])),
        ordered((service.volumes ?? []).map(m => [m.type, m.type === "volume" ? config.volumes[m.source].name : "init.sql", m.target, !m.read_only])));
      for (const mount of container.Mounts) if (mount.Type === "bind") {
        const normalized = mount.Source.replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([a-z])\//i, "$1:/");
        assert.equal(path.resolve(normalized).toLowerCase(), path.resolve("infra/n8n/init.sql").toLowerCase());
      }
    }
  }
  return { status: "PASS", project, stage: running ? "actual-mounts-before-import" : "resolved-config-and-resource-absence", volumes: Object.values(config.volumes).map(v => v.name), networks: Object.values(config.networks).map(n => n.name) };
}

export async function withN8n06Runtime(run, record, bindings, { provenanceFile, args, reporting = false, operations = false, erasure = false, restore, selfRegistration = false }) {
  assert(Array.isArray(bindings) && bindings.length && bindings.every(b => /^WF-0[4-9]$|^WF-10$/.test(b.workflowId) || reporting && b.workflowId === "WF-11"), "Explicit reviewed workflow bindings required");
  assert(!process.env.DOCKER_HOST || /^(npipe:\/\/|unix:\/\/)/.test(process.env.DOCKER_HOST), "Local Docker Engine required");
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { env: hostEnv, encoding: "utf8" }).trim();
  assert(/^(npipe:\/\/|unix:\/\/)/.test(endpoint), "Local Docker context required");
  const root = fileURLToPath(new URL("../", import.meta.url)); process.chdir(root);
  const project = `space-agent-n8n0${reporting || operations || restore ? 7 : 6}-acceptance-${randomBytes(6).toString("hex")}`;
  const directory = path.join(root, ".local", "automation", project), acl = await privateDirectory(directory);
  const evidence = record;
  Object.assign(evidence, { project, startedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), status: "FAIL", runtimeChecks: [], artifacts: { ...record.artifacts }, services: [], acl });
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(f =>
    existsSync(f) && (["package.json", "package-lock.json", "turbo.json"].includes(f) || /^(services|packages|scripts|workflows|infra|apps)\//.test(f) && /\.(ts|tsx|sql|mjs|cjs|json|yml|css)$/.test(f)));
  const sourceHashes = Object.fromEntries(await Promise.all([...new Set(paths)].map(async file => [file, sha(await readFile(file))])));
  const provenance = {
    authorization: record.authorization,
    provenanceFile,
    provenanceSha256: sha(await readFile(provenanceFile)),
    args,
  };
  await writeFile(path.join(directory,"preflight.json"),JSON.stringify({...provenance,createdAt:evidence.startedAt,policyVersion:"DEMO-N8N06-2026-11-16-v1",syntheticOnly:true,budgetUsd:0,inferenceAllowed:false,sourceHashes},null,2),{flag:"wx",mode:0o600});
  await writeFile(path.join(directory,"run-marker.json"),JSON.stringify({project,status:"RUNNING",resumeAllowed:false}),{flag:"wx",mode:0o600});
  const children = [], services = new Map(), pools = {}, domainUrls = {}, allocated = new Set();
  async function freePort() {
    for (;;) {
      const port = await new Promise((resolve, reject) => {
        const server = createServer(); server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { const available = server.address().port; server.close(() => resolve(available)); });
      });
      if (!allocated.has(port) && !restore?.sourcePorts.includes(port)) { allocated.add(port); return port; }
    }
  }
  const ports = {};
  const domainServices = ["automation-bridge", "identity", "org", "catalog", "class-schedule", "conversation", "crm", "enrollment", "payment", "notification"];
  if (reporting) domainServices.push("reporting");
  for (const name of [...domainServices, "n8n"]) ports[name] = await freePort();
  const urls = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]));
  const envFile = path.join(directory, "runtime.env"), brokerPassword = secret();
  const encryptionKey = restore ? (await readFile(path.join(restore.directory,"n8n-encryption-key-private"), "utf8")).trim() : secret();
  assert.match(encryptionKey, /^[a-f0-9]{64}$/);
  if (restore) assert.equal(sha(encryptionKey), restore.hashes["n8n-encryption-key-private"], "Backup key digest mismatch");
  await writeFile(envFile, [`N8N_POSTGRES_ADMIN_PASSWORD=${secret()}`, `N8N_DB_PASSWORD=${secret()}`, `N8N_ENCRYPTION_KEY=${encryptionKey}`, `N8N_LOCAL_PORT=${ports.n8n}`, `AUTOMATION_TEST_ADMIN_PASSWORD=${secret()}`, `AUTOMATION_TEST_BROKER_PASSWORD=${brokerPassword}`, ""].join("\n"), { mode: 0o600 });
  const overlay = path.join(directory, "compose.acceptance.json");
  await writeFile(overlay, JSON.stringify(acceptanceOverlay));
  const composeArgs = ["compose", "--env-file", envFile, "-p", project, "-f", "infra/n8n/compose.yml", "-f", "infra/automation/compose.test.yml", "-f", overlay];
  let dockerFailure = 0;
  function compose(...args) {
    try { return execFileSync("docker", [...composeArgs, ...args], { env: hostEnv, encoding: "utf8", timeout: 300000, maxBuffer: 15 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) {
      writeFileSync(path.join(directory, `docker-failure-${++dockerFailure}.log`), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { mode: 0o600 });
      throw new Error(`Docker ${args[0]} failed; inspect private artifacts in ${directory}`);
    }
  }
  const cli = (...args) => compose("run", "--rm", "-T", "--no-deps", "n8n", ...args);
  const sql = query => compose("exec", "-T", "postgres", "psql", "-U", "n8n_admin", "-d", "n8n", "-v", "ON_ERROR_STOP=1", "-Atc", query).trim();
  async function restoreDb(service, file, role, database = role) {
    const input = path.join(restore.directory, file + ".sql");
    assert.equal(sha(await readFile(input)), restore.hashes[file + ".sql"], "Backup digest mismatch");
    compose("cp", input, service + ":/tmp/snapshot.sql");
    compose("exec", "-T", service, "psql", "-X", "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "/tmp/snapshot.sql");
  }
  const check = name => { evidence.runtimeChecks.push(name); console.log(`PASS ${name}`); };
  async function runNode(args, env = hostEnv, cwd = root, log = "node.log") {
    const fd = openSync(path.join(directory, log), "wx");
    try {
      const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", fd, fd], windowsHide: true }); children.push(child);
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      assert.equal(code, 0, `Node command failed; private log: ${path.join(directory, log)}`);
    } finally { closeSync(fd); }
  }
  async function eventually(probe, description = "Isolated runtime readiness") {
    const end = Date.now() + 30000;
    while (Date.now() < end) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`${description} timed out`);
  }
  let completed = false;
  try {
    for (const file of ["scripts/n8n06-runtime.mjs", "scripts/n8n04-isolation.mjs", "infra/n8n/compose.yml", "infra/n8n/init.sql", "infra/automation/compose.test.yml"]) evidence.artifacts[file] = sha(await readFile(file));
    evidence.isolation = verifyIsolation(project, compose);
    if (restore) {
      compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240", "postgres", "bridge-db", "rabbitmq");
      assert.equal(sql("SELECT to_regclass('workflow_entity')"), "");
      await restoreDb("postgres", "n8n", "n8n");
      assert.equal(sql('SELECT count(*) FROM workflow_entity WHERE active OR "activeVersionId" IS NOT NULL'), "0");
      check("Clean target n8n DB restored with all workflow triggers disabled");
    }
    compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240");
    evidence.actualIsolation = verifyIsolation(project, compose, true);
    const backendHost = compose("exec", "-T", "n8n", "node", "-e", "require('node:dns').lookup('host.docker.internal',{family:4},(error,address)=>{if(error)throw error;process.stdout.write(address);})").trim();
    assert(isIPv4(backendHost) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(backendHost), "Private Docker host address required");
    if (!restore) {
      assert.equal(sql("SELECT count(*) FROM workflow_entity"), "0");
      assert.equal(sql("SELECT count(*) FROM credentials_entity"), "0");
    }
    evidence.backendHost = backendHost;
    evidence.runtime = { node: process.version, docker: execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { env: hostEnv, encoding: "utf8" }).trim(), compose: execFileSync("docker", ["compose", "version", "--short"], { env: hostEnv, encoding: "utf8" }).trim(), postgres: compose("exec", "-T", "bridge-db", "postgres", "--version").trim(), rabbitmq: compose("exec", "-T", "rabbitmq", "rabbitmqctl", "version").trim(), images: JSON.parse(compose("images", "--format", "json")) };
    const dbPort = Number(compose("port", "bridge-db", "5432").trim().split(":").at(-1));
    const rabbitPort = Number(compose("port", "rabbitmq", "5672").trim().split(":").at(-1));
    evidence.databases = [];
    function createDatabase(service) {
      assert.match(service,/^[a-z][a-z-]{0,30}$/);
      assert(!Object.hasOwn(domainUrls,service),"Database key already allocated");
      const name = `n8n06_${service.replaceAll("-", "_")}`, password = secret();
      compose("exec", "-T", "bridge-db", "psql", "-U", "automation_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
      compose("exec", "-T", "bridge-db", "createdb", "-U", "automation_test_admin", "-O", name, name);
      compose("exec", "-T", "bridge-db", "psql", "-U", "automation_test_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
      domainUrls[service] = `postgresql://${name}:${password}@127.0.0.1:${dbPort}/${name}`;
      pools[service] = new pg.Pool({ connectionString: domainUrls[service], connectionTimeoutMillis: 5000 });
      evidence.databases.push({ service, database: name, role: name, privateConnectionFile: "database-urls-private.json" });
      return pools[service];
    }
    for (const service of domainServices) {
      createDatabase(service);
      if (restore) {
        const { database, role } = evidence.databases.at(-1);
        await restoreDb("bridge-db", service, role, database);
      }
      for (const pass of [1, 2]) await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), service === "catalog" ? "src/db/migrate.ts" : "src/migrate.ts"], { ...hostEnv, DATABASE_URL: domainUrls[service] }, path.join(root, "services", service), `${service}-migration-${pass}.log`);
    }
    await writeFile(path.join(directory, "database-urls-private.json"), JSON.stringify(domainUrls, null, 2), { mode: 0o600 });
    const bridgeRole = new URL(domainUrls["automation-bridge"]);
    for (const service of Object.keys(domainUrls).filter(name => name !== "automation-bridge")) {
      const denied = new URL(domainUrls[service]); denied.username = bridgeRole.username; denied.password = bridgeRole.password;
      const other = new pg.Pool({ connectionString: denied.toString(), connectionTimeoutMillis: 5000 });
      try { await assert.rejects(other.query("SELECT 1")); } finally { await other.end(); }
    }
    evidence.migrations = {};
    for (const [service, pool] of Object.entries(pools)) if ((await pool.query("SELECT to_regclass('schema_migrations') AS t")).rows[0].t)
      evidence.migrations[service] = (await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map(row => row.version);
    check("Fresh separate service databases/roles, repeatable migrations and denied Bridge cross-database access");
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const keyFile = path.join(directory, "authority-private.pem"), publicFile = path.join(directory, "authority-public.pem");
    await writeFile(keyFile, await exportPKCS8(privateKey), { mode: 0o600 }); await writeFile(publicFile, await exportSPKI(publicKey));
    const runtime = {
      DATABASE_URL: domainUrls["automation-bridge"], RABBITMQ_URL: `amqp://automation_test:${brokerPassword}@127.0.0.1:${rabbitPort}`, NODE_ENV: "test", HOST: "0.0.0.0",
      AUTOMATION_MACHINE_PUBLIC_KEY_FILE: publicFile, AUTOMATION_MACHINE_ISSUER: "n8n06-test-authority", AUTOMATION_BRIDGE_URL: urls["automation-bridge"],
      AUTOMATION_MACHINE_SUBJECTS: JSON.stringify({ "n8n06-worker": ["WF-04", "WF-05", "WF-06", "WF-07"], "n8n06-adjustment-worker": ["WF-08", "WF-09", "WF-10"], ...(reporting ? { "n8n07-reporting-worker": ["WF-11"] } : {}), ...(operations ? { "n8n07-incident-worker": ["WF-12"] } : {}) }),
      AUTOMATION_BINDINGS: JSON.stringify(bindings), AUTOMATION_EVENT_PATTERNS: JSON.stringify([...new Set([...bindings.map(b => b.eventType), "payment.adjustment_authorized", "enrollment.class_change_resolution"])]),
      AUTH_SECRET: secret(), AUTH_ISSUER: "n8n06-test-identity", AUTH_AUDIENCE: "n8n06-test-services", IDENTITY_URL: urls.identity,
      ORG_URL: urls.org, CATALOG_URL: urls.catalog, CLASS_URL: urls["class-schedule"], CONVERSATION_URL: urls.conversation, CRM_URL: urls.crm, ENROLLMENT_URL: urls.enrollment, PAYMENT_URL: urls.payment, NOTIFICATION_URL: urls.notification, IAM_NOTIFICATION_SECRET: secret(), NOTIFICATION_ADAPTER: "synthetic",
      AI_FREE_MODEL_READY: "false", CHAT_PROVIDER_DATA_POLICY: "blocked", PAYMENT_ADAPTER: "synthetic", SYNTHETIC_PAYMENT_WEBHOOK_SECRET: secret(),
      ...(reporting ? { REPORTING_URL: urls.reporting, REPORTING_EVENTS_ENABLED: "true" } : {}),
      ...(erasure ? { WF12_ERASURE_TEST:"true", WF12_BACKUP_REGISTRY:path.join(directory,"backup-registry.json") } : {}),
    };
    const checkout = selfRegistration && { crm: secret(), iam: secret(), payment: secret(), sePaySecret: secret(), account: "0000000000" };
    const fixture = restore?.operator ?? { email: "n8n06-operator@automation.test", password: secret() };
    const { email: operatorEmail, password: adminPassword } = fixture;
    if (!restore) await runNode([path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/seed.ts"], { ...hostEnv, DATABASE_URL: domainUrls.identity, SEED_ADMIN_EMAIL: operatorEmail, SEED_ADMIN_PASSWORD: adminPassword }, path.join(root, "services/identity"), "operator-seed.log");
    await writeFile(path.join(directory, "operator-private.json"), JSON.stringify({ email: operatorEmail, password: adminPassword }), { mode: 0o600 });
    async function startService(service, extra = {}) {
      assert(Object.hasOwn(domainUrls, service) || service === "gateway", "Only this runtime's backend services may start");
      const previous = services.get(service); assert(!previous || previous.exitCode !== null || previous.signalCode !== null, `${service} is already running`);
      const registrationEnv = checkout ? {
        crm: { ENROLLMENT_CRM_SECRET: checkout.crm },
        identity: { ENROLLMENT_IAM_SECRET: checkout.iam },
        enrollment: { ENROLLMENT_CRM_SECRET: checkout.crm, ENROLLMENT_IAM_SECRET: checkout.iam, ENROLLMENT_PAYMENT_SECRET: checkout.payment, PAYMENT_ADAPTER: "sepay" },
        payment: { ENROLLMENT_PAYMENT_SECRET: checkout.payment, PAYMENT_ADAPTER: "sepay", SEPAY_MB_ACCOUNT: checkout.account, SEPAY_WEBHOOK_SECRET: checkout.sePaySecret },
      }[service] : undefined;
      const env = { ...hostEnv, ...runtime, ...registrationEnv, DATABASE_URL: domainUrls[service], PORT: String(ports[service]), ...extra };
      const ordinal = evidence.services.filter(s => s.service === service).length + 1;
      const log = `service-${service}-${ordinal}.log`, fd = openSync(path.join(directory, log), "wx");
      let child;
      // Run the service in the tracked Node PID so crash/cleanup cannot orphan a tsx CLI child.
      try { child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: path.join(root, "services", service), env, stdio: ["ignore", fd, fd], windowsHide: true }); }
      finally { closeSync(fd); }
      children.push(child); services.set(service, child);
      await writeFile(path.join(directory, `service-${service}-${ordinal}-private.json`), JSON.stringify(env, null, 2), { mode: 0o600 });
      evidence.services.push({ service, port: Number(env.PORT), pid: child.pid, log, startedAt: new Date().toISOString() });
      let spawnError; child.once("error", error => { spawnError = error; });
      await eventually(async () => {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`${service} exited before readiness; inspect ${log}`);
        try { return (await fetch(`http://127.0.0.1:${env.PORT}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
      }, `${service} readiness`);
      return child;
    }
    async function iamCall(route, body, token = "") {
      const response = await fetch(`${urls.identity}${route}`, { method: "POST", headers: { "content-type": "application/json", connection: "close", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: "error" });
      assert(response.ok, `IAM ${route}: ${response.status}`); return (await response.json()).data;
    }
    await startService("identity", { IAM_MACHINE_PRIVATE_KEY_FILE: keyFile, IAM_MACHINE_ISSUER: runtime.AUTOMATION_MACHINE_ISSUER });
    const operator = await iamCall("/api/v1/auth/login", { email: operatorEmail, password: adminPassword });
    if (!restore) for (const service of ["org", "catalog", "class-schedule", "automation-bridge"]) await startService(service);
    const loginFixture = email => iamCall("/api/v1/auth/login", { email, password: adminPassword });
    await run({ root, directory, project, envFile, ports, urls, pool: pools["automation-bridge"], pools, domainUrls, identityDb: domainUrls.identity, iamCall, operator, loginFixture, startService, runtime, checkout, backendHost, bridgePort: ports["automation-bridge"], iamPort: ports.identity, orgPort: ports.org, catalogPort: ports.catalog, classesPort: ports["class-schedule"], chatPort: ports.conversation, crmPort: ports.crm, enrollmentPort: ports.enrollment, paymentPort: ports.payment, n8nPort: ports.n8n, compose, cli, sql, runNode, freePort, eventually, children, services, check, createDatabase, hostEnv });
    await writeFile(path.join(directory, "database-urls-private.json"), JSON.stringify(domainUrls, null, 2), { mode: 0o600 });
    completed = true; evidence.status = "PASS";
    for(const [file,expected] of Object.entries({...sourceHashes,[provenanceFile]:provenance.provenanceSha256}))assert.equal(sha(await readFile(file)),expected,`Source changed during acceptance: ${file}`);
  } catch (error) { evidence.status = "FAIL"; evidence.failure = { name: error.name, message: error.message }; throw error; }
  finally {
    const cleanupErrors = [];
    for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) {
      try { await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); child.kill("SIGKILL"); }); }
      catch { cleanupErrors.push("Owned backend process cleanup failed"); }
    }
    for (const pool of Object.values(pools)) try { await pool.end(); } catch { cleanupErrors.push("Owned database pool cleanup failed"); }
    if (evidence.isolation) {
      try { await writeFile(path.join(directory,"docker-private.log"),compose("logs","--no-color"),{mode:0o600}); }
      catch { cleanupErrors.push("Owned Docker logs could not be retained"); }
      try {
        compose("down", "--remove-orphans", "--timeout", "10");
        const remaining = execFileSync("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { env: hostEnv, encoding: "utf8" }).trim();
        assert.equal(remaining, "");
        const remainingNetworks = execFileSync("docker", ["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], { env: hostEnv, encoding: "utf8" }).trim();
        assert.equal(remainingNetworks, "");
        const volumes = JSON.parse(execFileSync("docker", ["volume", "inspect", ...evidence.isolation.volumes], { env: hostEnv, encoding: "utf8" }));
        assert.deepEqual(volumes.map(v=>v.Name).sort(), [...evidence.isolation.volumes].sort());
        assert(volumes.every(v=>v.Labels?.["com.docker.compose.project"]===project));
        const openPorts = [];
        for (const port of allocated) if (await new Promise(resolve => {
          const socket = createConnection({host:"127.0.0.1",port});
          socket.once("connect", () => { socket.destroy(); resolve(true); });
          socket.once("error", () => { socket.destroy(); resolve(false); });
          socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
        })) openPorts.push(port);
        assert.deepEqual(openPorts, [], "Test runtime port is still open");
        evidence.cleanup = { remainingContainers: 0, remainingNetworks: 0, checkedPorts: [...allocated], openPorts, volumesRetained: evidence.isolation.volumes, projectDown: true };
      } catch { cleanupErrors.push("Owned Docker project cleanup failed"); }
    }
    if (cleanupErrors.length) evidence.status = "FAIL";
    evidence.cleanupErrors = cleanupErrors; evidence.finishedAt = new Date().toISOString();
    try { evidence.aclVerification = verifyPrivateAcl(directory, acl); }
    catch { cleanupErrors.push("Private-artifact ACL verification failed"); evidence.status = "FAIL"; }
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    await writeFile(path.join(directory,"run-marker.json"),JSON.stringify({project,status:evidence.status,finishedAt:evidence.finishedAt,resumeAllowed:false}),{mode:0o600});
    if (completed && cleanupErrors.length) throw new Error(`Runtime cleanup failed; inspect private evidence in ${directory}`);
  }
}
