import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import amqp from "amqplib";
import type { EventEnvelope } from "@spacex/contracts";
import { messagingSchema, enqueueEvent, receiveEvent, dispatchOutbox, processInbox, replayDeadEvent, connectBroker } from "./index.js";

const url = process.env.MESSAGING_TEST_DATABASE_URL;
const name = `messaging_test_${randomUUID().replaceAll("-", "")}`;
const event = () => ({ id: randomUUID(), type: "test.reliable", version: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(), payload: { targetId: randomUUID() } });
describe.skipIf(!url)("durable messaging (isolated PostgreSQL)", () => {
  let admin: pg.Pool, pool: pg.Pool;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE ${name}`);
    const db = new URL(url!); db.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: db.toString() });
    await pool.query(messagingSchema);
    await pool.query("CREATE TABLE effects(event_id uuid PRIMARY KEY,value int NOT NULL)");
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^messaging_test_[a-f0-9]{32}$/.test(name)) throw new Error("Unsafe test database");
      await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.end();
    }
  });
  async function enqueue(e = event()) {
    const client = await pool.connect();
    try { await client.query("BEGIN"); await enqueueEvent(client, e); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return e;
  }
  it("rolls back the event with business data and rejects ID reuse", async () => {
    const e = event(), client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO effects VALUES($1,1)", [e.id]); await enqueueEvent(client, e);
      await client.query("ROLLBACK");
      expect((await pool.query("SELECT 1 FROM event_outbox WHERE id=$1", [e.id])).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM effects WHERE event_id=$1", [e.id])).rowCount).toBe(0);
      await enqueue(e); await enqueue(e);
      await expect(enqueue({ ...e, payload: { targetId: randomUUID() } })).rejects.toThrow("ID reused");
    } finally { client.release(); }
  });
  it("persists publisher backoff/dead letters and replays the same ID", async () => {
    // Drain preceding test events before this isolated failure scenario.
    await dispatchOutbox(pool, async () => undefined);
    const e = await enqueue();
    await dispatchOutbox(pool, async () => { throw new Error("unavailable"); }, { maxAttempts: 2 });
    expect((await pool.query("SELECT attempts,status FROM event_outbox WHERE id=$1", [e.id])).rows[0]).toEqual({ attempts: 1, status: "PENDING" });
    await pool.query("UPDATE event_outbox SET next_attempt_at=now() WHERE id=$1", [e.id]);
    await dispatchOutbox(pool, async () => { throw new Error("still unavailable"); }, { maxAttempts: 2 });
    expect((await pool.query("SELECT status FROM event_outbox WHERE id=$1", [e.id])).rows[0].status).toBe("DEAD");
    const client = await pool.connect();
    try { expect(await replayDeadEvent(client, e.id)).toBe(true); } finally { client.release(); }
    const sent: string[] = [];
    await dispatchOutbox(pool, async input => { sent.push(input.id); });
    expect(sent).toEqual([e.id]);
  });
  it("rolls back partial handlers, deduplicates deliveries and concurrent workers", async () => {
    const e = event(), consumer = "test.atomic";
    await Promise.all([receiveEvent(pool, consumer, e), receiveEvent(pool, consumer, e)]);
    await processInbox(pool, consumer, async c => {
      await c.query("INSERT INTO effects VALUES($1,1)", [e.id]);
      await c.query("SELECT 1/0");
    }, { maxAttempts: 1 });
    expect((await pool.query("SELECT 1 FROM effects WHERE event_id=$1", [e.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT status FROM event_inbox WHERE id=$1", [e.id])).rows[0].status).toBe("DEAD");
    const client = await pool.connect();
    try { expect(await replayDeadEvent(client, e.id, consumer)).toBe(true); } finally { client.release(); }
    const handler = async (c: pg.PoolClient) => { await c.query("INSERT INTO effects VALUES($1,1)", [e.id]); };
    const counts = await Promise.all([processInbox(pool, consumer, handler), processInbox(pool, consumer, handler)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    await receiveEvent(pool, consumer, e);
    expect(await processInbox(pool, consumer, handler)).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM effects WHERE event_id=$1", [e.id])).rows[0].n).toBe(1);
  });
  it("recovers a publish-success/status-write-failure without a duplicate effect", async () => {
    const e = await enqueue(), consumer = "test.redelivery";
    await dispatchOutbox(pool, async input => { await receiveEvent(pool, consumer, input); throw new Error("simulated crash after broker accepted"); });
    await pool.query("UPDATE event_outbox SET next_attempt_at=now() WHERE id=$1", [e.id]);
    await Promise.all([
      dispatchOutbox(pool, input => receiveEvent(pool, consumer, input)),
      dispatchOutbox(pool, input => receiveEvent(pool, consumer, input)),
    ]);
    expect(await processInbox(pool, consumer, async (c, input) => { await c.query("INSERT INTO effects VALUES($1,1)", [input.id]); })).toBe(1);
    expect((await pool.query("SELECT status FROM event_outbox WHERE id=$1", [e.id])).rows[0].status).toBe("SENT");
  });
  it.skipIf(!process.env.RABBITMQ_TEST_URL)("round-trips outbox → real RabbitMQ → inbox with one SQL effect", async () => {
    const brokerUrl = process.env.RABBITMQ_TEST_URL!, e = await enqueue();
    const queue = `test.reliable.${randomUUID()}`, consumer = queue;
    const broker = await connectBroker(brokerUrl, () => undefined), raw = await amqp.connect(brokerUrl), channel = await raw.createChannel();
    let cancel: (() => Promise<unknown>) | undefined;
    try {
      cancel = await broker.subscribe(queue, e.type, input => receiveEvent(pool, consumer, input));
      await dispatchOutbox(pool, input => broker.publish(input));
      await broker.publish(e); // duplicate transport delivery
      for (let i = 0; i < 100; i++) {
        if ((await pool.query("SELECT 1 FROM event_inbox WHERE consumer=$1 AND id=$2", [consumer, e.id])).rowCount) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      const handler = async (c: pg.PoolClient, input: EventEnvelope) => { await c.query("INSERT INTO effects VALUES($1,1)", [input.id]); };
      expect(await processInbox(pool, consumer, handler)).toBe(1);
      expect(await processInbox(pool, consumer, handler)).toBe(0);
    } finally {
      await cancel?.(); await broker.close();
      await channel.deleteQueue(queue); await channel.deleteQueue(`${queue}.dead`);
      await channel.close(); await raw.close();
    }
  }, 15000);
});
