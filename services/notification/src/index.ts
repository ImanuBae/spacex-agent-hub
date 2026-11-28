import pg from "pg";
import { authConfig } from "@spacex/auth";
import { connectBroker, dispatchOutbox, processInbox, receiveEvent } from "@spacex/messaging";
import { z } from "zod";
import { createNotificationApp, receiveCourseEvent } from "./app.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
if (required("NOTIFICATION_ADAPTER") !== "synthetic") throw new Error("Unknown course notification adapter");
const otpAdapter = z.enum(["synthetic", "resend"]).parse(process.env.NOTIFICATION_OTP_ADAPTER ?? "synthetic");
const ownerId = z.uuid().parse(required("NOTIFICATION_OWNER_ID"));
const config = {
  enrollmentUrl: required("ENROLLMENT_URL"), classUrl: required("CLASS_URL"), crmUrl: required("CRM_URL"),
  sourceClientId: z.uuid().parse(required("SOURCE_CLIENT_ID")), sourceClientSecret: z.string().min(32).parse(required("SOURCE_CLIENT_SECRET")),
  iamNotificationSecret: z.string().min(32).parse(required("IAM_NOTIFICATION_SECRET")), ownerId, testFaults: process.env.NODE_ENV === "test",
  otpEmail: otpAdapter === "resend" ? { apiKey: required("RESEND_API_KEY"), from: required("OTP_EMAIL_FROM") } : undefined,
};
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), connectionTimeoutMillis: 5000 });
pool.on("error", () => console.error("notification.database_unavailable"));
const brokerUrl = required("RABBITMQ_URL"), consumer = "notification.course.v1";
let broker: Awaited<ReturnType<typeof connectBroker>> | undefined;
let stopping = false, running = false;
async function dispatch() {
  if (running || stopping) return;
  running = true;
  try {
    if (broker && !broker.connected) { const old = broker; broker = undefined; await old.close().catch(() => undefined); }
    if (!broker) {
      const connection = await connectBroker(brokerUrl, () => console.error("notification.broker_error"));
      try {
        await connection.subscribe(`spacex.${consumer}`, ["enrollment.confirmed", "enrollment.entitlement_changed", "class.schedule_changed", "class.cancelled"], event => receiveEvent(pool, consumer, event));
        broker = connection;
      } catch (error) { await connection.close().catch(() => undefined); throw error; }
    }
    const connected = broker;
    await processInbox(pool, consumer, (c, event) => receiveCourseEvent(c, event, ownerId));
    await dispatchOutbox(pool, event => connected.publish(event));
  } catch { console.error("notification.dispatch_unavailable"); }
  finally { running = false; }
}
await dispatch();
const server = createNotificationApp(pool, authConfig(), config).listen(Number(process.env.PORT ?? 4010), process.env.HOST ?? "127.0.0.1");
const timer = setInterval(() => void dispatch(), 1000); timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopping = true;
  clearInterval(timer);
  server.close(() => { void (async () => {
    while (running) await new Promise(resolve => setTimeout(resolve, 50));
    await broker?.close().catch(() => undefined);
    await pool.end();
    process.exit(0);
  })(); });
  setTimeout(() => process.exit(1), 10000).unref();
});
