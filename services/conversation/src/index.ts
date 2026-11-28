import pg from "pg";
import { authConfig } from "@spacex/auth";
import { connectBroker, dispatchOutbox } from "@spacex/messaging";
import { createConversationApp } from "./app.js";
import { restoreConversationExclusions } from "./erasure.js";
import { createLocalAdvisor } from "./local-advisor.js";
const required = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} required`); return v; };
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), connectionTimeoutMillis: 5000 });
if (process.env.WF12_RESTORE_EXCLUSIONS) await restoreConversationExclusions(pool,process.env.WF12_RESTORE_EXCLUSIONS,process.env.WF12_RESTORE_EXCLUSIONS_SHA256);
const model = process.env.NODE_ENV !== "production" && process.env.CHAT_LOCAL_MODEL;
const shutdown = new AbortController();
const server = createConversationApp(pool, authConfig(), {
  branchId: required("CHAT_BRANCH_ID"), bridgeUrl: required("AUTOMATION_BRIDGE_URL"),
  sourceClientId: required("CHANNEL_CLIENT_ID"), sourceClientSecret: required("CHANNEL_CLIENT_SECRET"),
  modelReady: process.env.AI_FREE_MODEL_READY === "true",
  syntheticProviderPilot: process.env.CHAT_PROVIDER_DATA_POLICY === "synthetic-only",
  crmUrl: process.env.CRM_URL,
  localAI: model ? {
    model, signal: shutdown.signal,
    reply: createLocalAdvisor(model, process.env.CATALOG_URL ?? "http://127.0.0.1:4001", process.env.CLASS_URL ?? "http://127.0.0.1:4004"),
  } : undefined,
}).listen(Number(process.env.PORT ?? 4007), process.env.HOST ?? "127.0.0.1");
let broker: Awaited<ReturnType<typeof connectBroker>> | undefined, working = false;
async function tick() {
  if (working) return; working = true;
  try {
    if (broker && !broker.connected) {
      const disconnected = broker;
      broker = undefined;
      await disconnected.close().catch(() => undefined);
    }
    broker ??= await connectBroker(required("RABBITMQ_URL"), () => undefined);
    await dispatchOutbox(pool, e => broker!.publish(e));
  } catch { console.error("conversation.outbox_unavailable"); }
  finally { working = false; }
}
void tick(); const timer = setInterval(() => void tick(), 1000); timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  shutdown.abort();
  clearInterval(timer); server.close(() => { void (async () => {
    while (working) await new Promise(r => setTimeout(r, 20)); await broker?.close().catch(() => undefined); await pool.end(); process.exit(0);
  })(); }); setTimeout(() => process.exit(1), 10000).unref();
});
