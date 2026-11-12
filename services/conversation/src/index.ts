import pg from "pg";
import { authConfig } from "@spacex/auth";
import { connectBroker, dispatchOutbox } from "@spacex/messaging";
import { createConversationApp } from "./app.js";
const required = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} required`); return v; };
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), connectionTimeoutMillis: 5000 });
const server = createConversationApp(pool, authConfig(), {
  branchId: required("CHAT_BRANCH_ID"), bridgeUrl: required("AUTOMATION_BRIDGE_URL"),
  sourceClientId: required("CHANNEL_CLIENT_ID"), sourceClientSecret: required("CHANNEL_CLIENT_SECRET"),
  modelReady: process.env.AI_FREE_MODEL_READY === "true",
  syntheticProviderPilot: process.env.CHAT_PROVIDER_DATA_POLICY === "synthetic-only",
}).listen(Number(process.env.PORT ?? 4007), process.env.HOST ?? "127.0.0.1");
let broker: Awaited<ReturnType<typeof connectBroker>> | undefined, working = false;
async function tick() {
  if (working) return; working = true;
  try {
    if (broker && !broker.connected) { await broker.close(); broker = undefined; }
    broker ??= await connectBroker(required("RABBITMQ_URL"), () => undefined);
    await dispatchOutbox(pool, e => broker!.publish(e));
  } catch { console.error("conversation.outbox_unavailable"); }
  finally { working = false; }
}
void tick(); const timer = setInterval(() => void tick(), 1000); timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  clearInterval(timer); server.close(() => { void (async () => {
    while (working) await new Promise(r => setTimeout(r, 20)); await broker?.close(); await pool.end(); process.exit(0);
  })(); }); setTimeout(() => process.exit(1), 10000).unref();
});
