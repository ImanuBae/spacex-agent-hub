import pg from "pg";
import { loadConfig } from "@spacex/config";
import { authConfig } from "@spacex/auth";
import { createLogger } from "@spacex/logger";
import { createClassApp, expireHolds } from "./app.js";
import { connectBroker, dispatchOutbox, receiveEvent, processInbox } from "@spacex/messaging";
const config = loadConfig({
  ...process.env,
  SERVICE_NAME: "class-schedule",
  PORT: process.env.PORT ?? "4004",
});
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const logger = createLogger("class-schedule"),
  demo =
    process.env.APP_ENV === "demo" && process.env.CLASS_DEMO_ENABLED === "true";
pool.on("error", (error) =>
  logger.error("database.idle_error", { errorName: error.name }),
);
const server = createClassApp(pool, authConfig(), {
  orgUrl: process.env.ORG_URL ?? "http://127.0.0.1:4003",
  catalogUrl: process.env.CATALOG_URL ?? "http://127.0.0.1:4001",
  demo,
  ttlSeconds: demo
    ? Number(process.env.CLASS_DEMO_HOLD_TTL_SECONDS ?? 1200)
    : 1200,
  enrollmentSecret: process.env.ENROLLMENT_SERVICE_SECRET,
  messagingEnabled: !!process.env.RABBITMQ_URL,
}).listen(config.PORT, config.HOST);
let working = false;
async function sweep() {
  if (working) return;
  working = true;
  try {
    const expired = await expireHolds(pool);
    logger.info("holds.expiry_sweep", { expired });
  } catch (error) {
    logger.error("holds.expiry_failed", {
      errorName: error instanceof Error ? error.name : "Unknown",
    });
  } finally {
    working = false;
  }
}
void sweep();
const timer = setInterval(() => void sweep(), 5000);
timer.unref();
let broker: Awaited<ReturnType<typeof connectBroker>> | undefined;
let publishing = false, stopping = false;
async function publishEvents() {
  if (publishing || stopping || !process.env.RABBITMQ_URL) return;
  publishing = true;
  try {
    if (broker && !broker.connected) {
      const old = broker; broker = undefined;
      await old.close().catch(() => undefined);
    }
    if (!broker) {
      const connected = await connectBroker(process.env.RABBITMQ_URL, () => {
        logger.error("messaging.broker_error");
      });
      try {
        // Declare durable bindings before the first outbox publish.
        await connected.subscribe("spacex.class-schedule.operations.v1", ["class.*", "hold.*", "room.*", "teacher-time.#", "operations.*"],
          event => receiveEvent(pool, "class.operations.v1", event));
        broker = connected;
      } catch (error) { await connected.close().catch(() => undefined); throw error; }
    }
    const current = broker;
    const sent = await dispatchOutbox(pool, event => current.publish(event));
    const processed = await processInbox(pool, "class.operations.v1", async (client, event) => {
      const payload = event.payload as { targetId: string };
      await client.query("INSERT INTO class_event_receipts(event_id,event_type,target_id,occurred_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [event.id, event.type, payload.targetId, event.occurredAt]);
    });
    logger.info("messaging.outbox_dispatch", { sent, processed });
    const { rows } = await pool.query("SELECT count(*) FILTER(WHERE status='DEAD')::int AS dead,count(*) FILTER(WHERE status='PENDING' AND created_at<clock_timestamp()-interval '5 minutes')::int AS delayed FROM (SELECT status,created_at FROM event_outbox UNION ALL SELECT status,created_at FROM event_inbox) events");
    if (rows[0].dead || rows[0].delayed) logger.error("messaging.backlog_alert", rows[0]);
  } catch (error) {
    logger.error("messaging.dispatch_failed", { errorName: error instanceof Error ? error.name : "Unknown" });
    const old = broker;
    broker = undefined;
    await old?.close().catch(() => undefined);
  } finally { publishing = false; }
}
void publishEvents();
const publishTimer = setInterval(() => void publishEvents(), 2000);
publishTimer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopping = true;
    clearInterval(timer);
    clearInterval(publishTimer);
    server.close(() => {
      void (async () => {
        while (publishing || working) await new Promise(resolve => setTimeout(resolve, 50));
        await broker?.close().catch(() => undefined);
        await pool.end();
        process.exit(0);
      })();
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
