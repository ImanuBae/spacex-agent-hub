import { readFile } from "node:fs/promises";
import pg from "pg";
import { z } from "zod";
import { loadConfig } from "@spacex/config";
import { authConfig } from "@spacex/auth";
import { WorkflowBindings } from "@spacex/contracts";
import { createLogger } from "@spacex/logger";
import { connectBroker } from "@spacex/messaging";
import { MachineConfig } from "./auth.js";
import { createBridgeApp } from "./app.js";
import { BridgeStore } from "./store.js";

if (!process.env.DATABASE_URL || !process.env.RABBITMQ_URL) throw new Error("DATABASE_URL and RABBITMQ_URL required");
const config = loadConfig({ ...process.env, SERVICE_NAME: "automation-bridge", PORT: process.env.PORT ?? "4006" });
const bindings = WorkflowBindings.parse(JSON.parse(process.env.AUTOMATION_BINDINGS ?? "[]"));
const patterns = z.array(z.string().regex(/^[a-zA-Z0-9.*#_-]{1,150}$/)).parse(JSON.parse(process.env.AUTOMATION_EVENT_PATTERNS ?? "[]"));
const machines = process.env.AUTOMATION_MACHINE_PUBLIC_KEY_FILE ? MachineConfig.parse({
  publicKey: await readFile(process.env.AUTOMATION_MACHINE_PUBLIC_KEY_FILE, "utf8"),
  issuer: process.env.AUTOMATION_MACHINE_ISSUER,
  subjects: JSON.parse(process.env.AUTOMATION_MACHINE_SUBJECTS ?? "{}"),
}) : undefined;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const logger = createLogger("automation-bridge"), store = new BridgeStore(pool, bindings);
pool.on("error", error => logger.error("database.idle_error", { errorName: error.name }));
const server = createBridgeApp(store, authConfig(), machines).listen(config.PORT, config.HOST);
let broker: Awaited<ReturnType<typeof connectBroker>> | undefined;
let working = false, stopping = false;
async function tick() {
  if (working || stopping) return;
  working = true;
  try {
    await store.maintain();
    if (broker && !broker.connected) { const old = broker; broker = undefined; await old.close().catch(() => undefined); }
    if (!broker) {
      const connected = await connectBroker(process.env.RABBITMQ_URL!, () => logger.error("messaging.broker_error"));
      try {
        // Only explicitly bound event families enter this service; no business workflows enabled by default.
        await connected.subscribe("spacex.automation.bridge.v1", patterns, event => store.ingest(event));
        broker = connected;
      } catch (error) { await connected.close().catch(() => undefined); throw error; }
    }
  } catch (error) {
    logger.error("automation.tick_failed", { errorName: error instanceof Error ? error.name : "Unknown" });
    const old = broker; broker = undefined; await old?.close().catch(() => undefined);
  } finally { working = false; }
}
void tick(); const timer = setInterval(() => void tick(), 1000); timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopping = true; clearInterval(timer);
  server.close(() => { void (async () => {
    while (working) await new Promise(resolve => setTimeout(resolve, 50));
    await broker?.close().catch(() => undefined); await pool.end(); process.exit(0);
  })(); });
  setTimeout(() => process.exit(1), 10000).unref();
});
