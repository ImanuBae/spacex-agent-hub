import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2).filter(arg => arg !== "--ai-demo");
const turbo = "node_modules/turbo/bin/turbo";
const excludeTemplate = "--filter=!@spacex/service-template";
const model = "qwen3:1.7b";
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function online(port, host = "127.0.0.1") {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function prepare() {
  const services = readdirSync("services").filter(name => existsSync(`services/${name}/package.json`));
  const missing = services.filter(name => !existsSync(`services/${name}/.env`));
  if (missing.length) throw new Error(`Thiếu cấu hình dev: ${missing.map(name => `services/${name}/.env`).join(", ")}. Xem README.md.`);
  const configs = new Map(services.map(name => [name, parseEnv(readFileSync(`services/${name}/.env`, "utf8"))]));
  const infraFile = existsSync("infra/.env") ? "infra/.env" : "infra/.env.example";
  const infra = { ...parseEnv(readFileSync(infraFile, "utf8")), ...process.env };
  const compose = (...args) => run("docker", ["compose", "--env-file", infraFile, "-f", "infra/docker-compose.yml", ...args]);
  const dbPort = Number(infra.POSTGRES_PORT || 5432);
  const brokerPort = Number(infra.RABBITMQ_PORT || 5672);
  const pg = new Map(), rabbit = new Map();
  const brokerUsers = ["automation-bridge", "class-schedule", "conversation", "crm", "enrollment", "notification", "payment"];
  for (const [name, env] of configs) {
    if (env.DATABASE_URL) pg.set(name, new URL(env.DATABASE_URL));
    if (env.RABBITMQ_URL && brokerUsers.includes(name)) rabbit.set(name, new URL(env.RABBITMQ_URL));
  }
  const composeServices = ["redis"];
  const localDependencies = [];
  for (const [deps, service, defaultPort, composePort] of [[pg, "postgres", 5432, dbPort], [rabbit, "rabbitmq", 5672, brokerPort]]) {
    for (const [name, { hostname, port }] of deps) {
      if (!loopback.has(hostname)) continue;
      const host = hostname === "[::1]" ? "::1" : hostname;
      const target = Number(port || defaultPort);
      if (target === composePort && !await online(target, host)) composeServices.push(service);
      localDependencies.push({ name, service, host, target });
    }
  }
  const manageOllama = !await online(11434);
  if (manageOllama) composeServices.push("ollama");
  compose("up", "-d", "--wait", "--wait-timeout", "120", ...new Set(composeServices));
  for (const { name, service, host, target } of localDependencies) {
    if (!await online(target, host)) throw new Error(`${name}: chưa kết nối được ${service} tại ${host}:${target}. Kiểm tra hạ tầng và .env của service.`);
  }

  if (!existsSync(".local/n8n/runtime.env")) run(process.execPath, ["scripts/n8n-local.mjs", "init"]);
  run("docker", ["compose", "--env-file", ".local/n8n/runtime.env", "-p", "space-agent-n8n", "-f", "infra/n8n/compose.yml", "up", "-d", "--wait", "--wait-timeout", "240"]);

  const tags = await fetch("http://127.0.0.1:11434/api/tags", { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!tags.ok) throw new Error("Không đọc được danh sách model từ Ollama tại cổng 11434.");
  if (!(await tags.json()).models.some(entry => entry.name === model)) {
    console.log(`Đang tải model chat ${model} cho Ollama…`);
    if (manageOllama) compose("exec", "-T", "ollama", "ollama", "pull", model);
    else {
      const response = await fetch("http://127.0.0.1:11434/api/pull", {
        method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false }),
      });
      if (!response.ok || (await response.json()).status !== "success") throw new Error(`Ollama không tải được model ${model}.`);
    }
  }

  run(process.execPath, [turbo, "run", "build", "--filter=./services/*"]);
  const localWorkspaces = [...pg].filter(([, url]) => loopback.has(url.hostname)).map(([name]) => `--workspace=services/${name}`);
  if (localWorkspaces.length) {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    run(process.execPath, [process.env.npm_execpath, "run", "db:migrate", "--if-present", ...localWorkspaces], { env });
  }
  console.log(`Chat AI chạy local với ${model}.`);
}

try {
  if (!args.some(arg => /^(--help|-h|--dry(?:-run)?|--graph)(=|$)/.test(arg))) await prepare();
  run(process.execPath, [turbo, "run", "dev", "--concurrency=16", excludeTemplate, ...args], {
    env: { ...process.env, CHAT_LOCAL_MODEL: model },
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
