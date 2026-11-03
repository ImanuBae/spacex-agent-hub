import { randomUUID } from "node:crypto";
import amqp from "amqplib";
import { expect, it } from "vitest";
import { connectBroker } from "./index.js";

// Opt-in: run against a disposable/local RabbitMQ, never a production broker.
it.skipIf(!process.env.RABBITMQ_TEST_URL)("delivers confirmed events and dead-letters failed handlers", async () => {
  const url = process.env.RABBITMQ_TEST_URL!;
  const errors: Error[] = [];
  const broker = await connectBroker(url, error => errors.push(error));
  const raw = await amqp.connect(url);
  const channel = await raw.createChannel();
  const suffix = randomUUID();
  const queue = `test.lead.${suffix}`;
  const type = `test.${suffix}`;
  const correlationId = randomUUID();
  let cancel: (() => Promise<unknown>) | undefined;
  let fail = true, delivered = false;
  try {
    cancel = await broker.subscribe(queue, type, async event => {
      expect(event.correlationId).toBe(correlationId);
      if (fail) throw new Error("Simulated business failure");
      delivered = true;
    });
    const event = { id: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), correlationId, payload: {} };
    await expect(broker.publish({ ...event, id: randomUUID(), type: `unroutable.${randomUUID()}` })).rejects.toThrow("no bound durable destination");
    await broker.publish(event);
    let dead: amqp.GetMessage | false = false;
    const deadline = Date.now() + 5000;
    while (!dead && Date.now() < deadline) {
      dead = await channel.get(`${queue}.dead`, { noAck: false });
      if (!dead) await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(dead).not.toBe(false);
    if (dead) expect(JSON.parse(dead.content.toString()).id).toBe(event.id);
    expect(errors.map(error => error.message)).toContain("Simulated business failure");
    expect((await channel.checkQueue(queue)).messageCount).toBe(0);
    if (dead) channel.nack(dead, false, true);
    fail = false;
    const audit: string[] = [];
    expect(await broker.replayDeadLetters(queue, 10, async e => { audit.push(`intent:${e.id}`); }, async e => { audit.push(`confirmed:${e.id}`); })).toEqual({ replayed: 1, invalid: 0 });
    for (let i = 0; i < 100 && !delivered; i++) await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered).toBe(true);
    expect(audit).toEqual([`intent:${event.id}`, `confirmed:${event.id}`]);
    channel.sendToQueue(`${queue}.dead`, Buffer.from("invalid-json-evidence"), { persistent: true });
    await channel.checkQueue(`${queue}.dead`);
    expect(await broker.replayDeadLetters(queue, 10)).toEqual({ replayed: 0, invalid: 1 });
    const retained = await channel.get(`${queue}.dead`, { noAck: true });
    expect(retained && retained.content.toString()).toBe("invalid-json-evidence");
  } finally {
    if (cancel) await cancel();
    await channel.deleteQueue(queue);
    await channel.deleteQueue(`${queue}.dead`);
    await broker.close();
    await channel.close();
    await raw.close();
  }
}, 15000);
