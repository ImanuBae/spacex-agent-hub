import pg from "pg";
import { loadConfig } from "@spacex/config";
import { authConfig } from "@spacex/auth";
import { createLogger } from "@spacex/logger";
import { connectBroker, dispatchOutbox, receiveEvent, processInbox } from "@spacex/messaging";
import { createCrmApp } from "./app.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const config = loadConfig({ ...process.env, SERVICE_NAME: "crm", PORT: process.env.PORT ?? "4005" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const logger = createLogger("crm");
pool.on("error", error => logger.error("database.idle_error", { errorName: error.name }));
const server = createCrmApp(pool, authConfig(), { orgUrl: process.env.ORG_URL ?? "http://127.0.0.1:4003", catalogUrl: process.env.CATALOG_URL ?? "http://127.0.0.1:4001" }).listen(config.PORT, config.HOST);
let broker: Awaited<ReturnType<typeof connectBroker>> | undefined;
let working = false, stopping = false;
async function dispatch() {
  if (working || stopping || !process.env.RABBITMQ_URL) return;
  working = true;
  try {
    if (broker && !broker.connected) { const old = broker; broker = undefined; await old.close().catch(() => undefined); }
    if (!broker) {
      const connected = await connectBroker(process.env.RABBITMQ_URL, () => logger.error("messaging.broker_error"));
      try {
        await connected.subscribe("spacex.crm.operations.v1", "crm.#", event => receiveEvent(pool, "crm.operations.v1", event));
        broker = connected;
      } catch (error) { await connected.close().catch(() => undefined); throw error; }
    }
    const current = broker;
    const sent = await dispatchOutbox(pool, event => current.publish(event));
    const processed = await processInbox(pool, "crm.operations.v1", async (c, event) => {
      await c.query("INSERT INTO crm_event_receipts(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING", [event.id, event.type]);
    });
    if (sent || processed) logger.info("messaging.dispatched", { sent, processed });
    const { rows } = await pool.query("SELECT count(*) FILTER(WHERE status='DEAD')::int AS dead,count(*) FILTER(WHERE status='PENDING' AND created_at<clock_timestamp()-interval '5 minutes')::int AS delayed FROM (SELECT status,created_at FROM event_outbox UNION ALL SELECT status,created_at FROM event_inbox) events");
    if (rows[0].dead || rows[0].delayed) logger.error("messaging.backlog_alert", rows[0]);
  } catch (error) {
    logger.error("messaging.dispatch_failed", { errorName: error instanceof Error ? error.name : "Unknown" });
    const old = broker; broker = undefined; await old?.close().catch(() => undefined);
  } finally { working = false; }
}
void dispatch(); const timer = setInterval(() => void dispatch(), 2000); timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopping = true; clearInterval(timer);
  server.close(() => { void (async () => {
    while (working) await new Promise(resolve => setTimeout(resolve, 50));
    await broker?.close().catch(() => undefined); await pool.end(); process.exit(0);
  })(); });
  setTimeout(() => process.exit(1), 10000).unref();
});
