// Runtime secrets and test artifacts stay in ignored .local; existing .env files are never read or written.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseN8nOutput } from "./n8n-output.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const command = process.argv[2];
assert(["init", "smoke"].includes(command), "Usage: node scripts/n8n-local.mjs init|smoke");

async function init(directory, port) {
  await mkdir(directory, { recursive: true });
  const envFile = path.join(directory, "runtime.env");
  try {
    await writeFile(envFile, [
      `N8N_POSTGRES_ADMIN_PASSWORD=${randomBytes(32).toString("hex")}`,
      `N8N_DB_PASSWORD=${randomBytes(32).toString("hex")}`,
      `N8N_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
      `N8N_LOCAL_PORT=${port}`,
      "",
    ].join("\n"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return envFile;
}

if (command === "init") {
  console.log(`Secrets ready (existing file preserved): ${await init(".local/n8n", 5678)}`);
} else {
  // Every smoke gets a new project and volumes; no import can overwrite a user's workflow IDs.
  const project = `space-agent-n8n-smoke-${randomBytes(6).toString("hex")}`;
  const directory = path.join(".local/n8n", project);
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port: availablePort } = server.address();
      server.close(() => resolve(availablePort));
    });
  });
  const envFile = await init(directory, port);
  const composeArgs = ["compose", "--env-file", envFile, "-p", project, "-f", "infra/n8n/compose.yml"];
  function compose(...args) {
    try {
      return execFileSync("docker", [...composeArgs, ...args], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      // Docker/CLI errors are local-only: they may include configuration values.
      const log = `${directory}/failure.log`;
      writeFileSync(log, `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { mode: 0o600 });
      throw new Error(`Docker command failed (${args[0]}). Private details: ${log}`);
    }
  }
  const cli = (...args) => compose("run", "--rm", "-T", "--no-deps", "n8n", ...args);
  const evidence = {
    project, startedAt: new Date().toISOString(), checks: [], status: "FAIL",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    artifacts: {},
  };
  for (const file of ["infra/n8n/compose.yml", "infra/n8n/init.sql", "scripts/n8n-local.mjs", "workflows/n8n/runtime-smoke.json"]) {
    evidence.artifacts[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  const check = (name) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
  try {
    // Pull images beforehand so slow downloads cannot outlive the test command on Windows.
    compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240");
    const response = await fetch(`http://127.0.0.1:${port}/healthz/readiness`);
    assert.equal(response.status, 200);
    evidence.n8nVersion = cli("--version").trim();
    assert.equal(evidence.n8nVersion, "2.46.4");
    evidence.postgresVersion = compose("exec", "-T", "postgres", "postgres", "--version").trim();
    assert.match(evidence.postgresVersion, /PostgreSQL\) 17\.7\b/);
    check("fresh PostgreSQL + n8n healthy; pinned runtime version");

    const sql = (query) => compose("exec", "-T", "postgres", "psql", "-U", "n8n_admin", "-d", "n8n", "-Atc", query).trim();
    assert.equal(sql("SELECT count(*) FROM workflow_entity"), "0");
    assert.equal(sql("SELECT count(*) FROM credentials_entity"), "0");
    assert.equal(sql("SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='n8n'"), "f");
    check("empty instance; dedicated runtime role is not superuser");

    compose("exec", "-T", "n8n", "mkdir", "-p", "/home/node/.n8n/smoke");
    compose("cp", "workflows/n8n/runtime-smoke.json", "n8n:/home/node/.n8n/smoke/runtime-smoke.json");
    cli("import:workflow", "--input=/home/node/.n8n/smoke/runtime-smoke.json");
    compose("exec", "-T", "n8n", "node", "-e", `
      const fs = require('node:fs');
      fs.writeFileSync('/home/node/.n8n/smoke/credential.json', JSON.stringify([{
        id: 'N8N01Postgres', name: 'runtime-smoke-postgres', type: 'postgres',
        data: {host:'postgres', database:'n8n', user:'n8n', password:process.env.DB_POSTGRESDB_PASSWORD, port:5432, ssl:'disable', sshTunnel:false}
      }]), {mode:0o600});
    `);
    try { cli("import:credentials", "--input=/home/node/.n8n/smoke/credential.json"); }
    finally { compose("exec", "-T", "n8n", "rm", "-f", "/home/node/.n8n/smoke/credential.json"); }
    const encrypted = sql("SELECT data FROM credentials_entity WHERE id='N8N01Postgres'");
    assert(encrypted.length > 30 && !encrypted.includes('"password"'));
    const execute = (id = "N8N01Smoke") => {
      const output = cli("execute", `--id=${id}`, "--rawOutput");
      const result = parseN8nOutput(output);
      assert.equal(result.data.resultData.lastNodeExecuted, "Credential query");
      assert.equal(result.data.resultData.error, undefined);
      const row = result.data.resultData.runData["Credential query"][0].data.main[0][0].json;
      assert.deepEqual(row, { marker: "N8N-01", db_user: "n8n" });
      const executionId = sql(`SELECT id::text FROM execution_entity WHERE "workflowId"='${id}' ORDER BY execution_entity.id::bigint DESC LIMIT 1`);
      assert(executionId, "Execution receipt missing from database");
      return { workflowId: id, executionId, row };
    };
    evidence.beforeRestart = execute();
    check("workflow import and real PostgreSQL credential query");

    cli("export:workflow", "--id=N8N01Smoke", "--pretty", "--output=/home/node/.n8n/smoke/runtime-export.json");
    compose("cp", "n8n:/home/node/.n8n/smoke/runtime-export.json", `${directory}/export.json`);
    const exportedBytes = await readFile(`${directory}/export.json`);
    const [exported] = JSON.parse(exportedBytes);
    evidence.exportSha256 = createHash("sha256").update(exportedBytes).digest("hex");
    assert.equal(exported.id, "N8N01Smoke");
    assert.equal(exported.nodes.length, 2);
    // A second ID verifies importing the actual export without overwriting the first workflow.
    exported.id = "N8N01Roundtrip";
    exported.name = "N8N-01 export roundtrip";
    await writeFile(`${directory}/roundtrip.json`, JSON.stringify([exported]));
    compose("cp", `${directory}/roundtrip.json`, "n8n:/home/node/.n8n/smoke/roundtrip.json");
    cli("import:workflow", "--input=/home/node/.n8n/smoke/roundtrip.json");
    assert.equal(sql("SELECT count(*) FROM workflow_entity"), "2");
    evidence.roundtripExecution = execute("N8N01Roundtrip");
    check("actual exported JSON reimported under a new ID");

    compose("restart", "postgres", "n8n");
    compose("up", "-d", "--wait", "--wait-timeout", "240");
    assert.equal(sql("SELECT count(*) FROM workflow_entity"), "2");
    assert.equal(sql("SELECT data FROM credentials_entity WHERE id='N8N01Postgres'"), encrypted);
    evidence.afterRestart = execute();
    check("restart both services preserves workflows and decrypts credential for real query");

    compose("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "240");
    assert.equal(sql("SELECT count(*) FROM workflow_entity"), "2");
    evidence.afterRecreate = execute();
    check("container recreation preserves volumes, workflows and usable credential");
    evidence.images = compose("images", "--format", "json").trim();
    evidence.status = "PASS";
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2) + "\n");
    // Keep volumes and secrets for inspection. Never use down -v.
    compose("down");
    console.log(`Evidence: ${directory}/evidence.json (test volumes retained)`);
  }
}
