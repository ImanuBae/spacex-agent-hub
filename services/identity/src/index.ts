import pg from "pg";
import { readFile } from "node:fs/promises";
import { loadConfig } from "@spacex/config";
import { authConfig } from "@spacex/auth";
import { createLogger } from "@spacex/logger";
import { createIdentityApp } from "./app.js";
const config = loadConfig({ ...process.env, SERVICE_NAME: "identity", PORT: process.env.PORT ?? "4002" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const logger = createLogger("identity");
pool.on("error", error => logger.error("database.idle_error", { errorName: error.name }));
const machines = process.env.IAM_MACHINE_PRIVATE_KEY_FILE ? {
  privateKey: await readFile(process.env.IAM_MACHINE_PRIVATE_KEY_FILE, "utf8"),
  issuer: process.env.IAM_MACHINE_ISSUER ?? "spacex-machine-identity",
  bridgeUrl: process.env.AUTOMATION_BRIDGE_URL ?? "http://127.0.0.1:4006",
  channelUrl: process.env.CONVERSATION_URL,
} : undefined;
const server = createIdentityApp(pool, authConfig(), process.env.ORG_URL ?? "http://127.0.0.1:4003", machines).listen(config.PORT, config.HOST);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.close(() => { void pool.end().then(() => process.exit(0)); }); setTimeout(() => process.exit(1), 10000).unref(); });
