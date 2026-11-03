// Explicit, bounded recovery after the operator fixes the underlying fault.
// Tokens and DB/broker credentials come only from environment, never argv/logs.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { connectBroker } from "../packages/messaging/dist/index.js";
const reason = process.env.REPLAY_REASON?.trim(), limit = Number(process.env.REPLAY_LIMIT ?? 10);
if (!reason || reason.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
  throw new Error("REPLAY_REASON (1–1000 chars) and REPLAY_LIMIT (1–100) required");
for (const name of ["DATABASE_URL", "RABBITMQ_URL", "IDENTITY_URL", "OPERATOR_ACCESS_TOKEN"])
  if (!process.env[name]) throw new Error(`${name} required`);
const identity = await fetch(`${process.env.IDENTITY_URL.replace(/\/$/, "")}/api/v1/auth/introspect`, {
  method: "POST", headers: { authorization: `Bearer ${process.env.OPERATOR_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(5000),
});
if (!identity.ok) throw new Error("Operator session rejected by IAM");
const actor = (await identity.json()).data;
if (actor?.role !== "center_director" || !/^[a-f0-9-]{36}$/i.test(actor.sub ?? "")) throw new Error("Center director permission required");
const queue = "spacex.class-schedule.operations.v1";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let broker;
try {
  broker = await connectBroker(process.env.RABBITMQ_URL, () => console.error("Broker recovery error; inspect connection and queue state"));
  const record = (phase, event) => pool.query(
    "INSERT INTO operation_replays(id,event_id,consumer,reason,actor_id) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), event.id, `broker.${phase}`, reason, actor.sub],
  ).then(() => undefined);
  const result = await broker.replayDeadLetters(queue, limit, event => record("intent", event), event => record("confirmed", event));
  console.log(JSON.stringify({ queue, ...result }));
} finally { await broker?.close(); await pool.end(); }
