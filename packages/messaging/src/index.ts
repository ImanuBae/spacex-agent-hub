import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import { EventEnvelope } from "@spacex/contracts";
export { messagingSchema, enqueueEvent, receiveEvent, dispatchOutbox, processInbox, replayDeadEvent } from "./postgres.js";

export async function connectBroker(
  url: string,
  onError: (error: Error) => void,
) {
  const connection = await amqp.connect(url, { timeout: 5000 });
  let closing = false, connected = true;
  const disconnected = (error: Error) => { connected = false; onError(error); };
  connection.on("error", disconnected);
  connection.on("close", () => { connected = false; if (!closing) onError(new Error("Broker connection closed")); });
  try {
    const publisher = await connection.createConfirmChannel();
    const consumer = await connection.createChannel();
    publisher.on("error", disconnected);
    consumer.on("error", disconnected);
    const confirmations = new Map<string, boolean>();
    publisher.on("return", message => {
      const attempt = message.properties.headers?.["x-publish-attempt"];
      if (typeof attempt === "string" && confirmations.has(attempt)) confirmations.set(attempt, true);
    });
    const confirm = (send: (attempt: string, callback: (error: unknown) => void) => void) => new Promise<void>((resolve, reject) => {
      const attempt = randomUUID(); confirmations.set(attempt, false);
      const finish = (error: unknown) => {
        const unroutable = confirmations.get(attempt); confirmations.delete(attempt); clearTimeout(timer);
        if (error) reject(error); else if (unroutable) reject(new Error("Event has no bound durable destination")); else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Publish confirmation timeout")), 5000);
      try { send(attempt, finish); } catch (error) { finish(error); }
    });
    const exchange = "spacex.events";
    const deadExchange = "spacex.dead";
    await publisher.assertExchange(exchange, "topic", { durable: true });
    await consumer.assertExchange(deadExchange, "direct", { durable: true });
    await consumer.prefetch(1);
    return {
      get connected() { return connected && !closing; },
      async publish(input: EventEnvelope) {
        const event = EventEnvelope.parse(input);
        await confirm((attempt, callback) => {
          publisher.publish(exchange, event.type, Buffer.from(JSON.stringify(event)), {
            persistent: true, contentType: "application/json", messageId: event.id,
            correlationId: event.correlationId, type: event.type,
            mandatory: true, headers: { "x-publish-attempt": attempt },
          }, callback);
        });
      },
      async subscribe(queue: string, pattern: string | string[], handler: (event: EventEnvelope) => Promise<void>) {
        await consumer.assertQueue(`${queue}.dead`, { durable: true });
        await consumer.bindQueue(`${queue}.dead`, deadExchange, queue);
        await consumer.assertQueue(queue, { durable: true, arguments: {
          "x-dead-letter-exchange": deadExchange, "x-dead-letter-routing-key": queue,
        } });
        for (const binding of Array.isArray(pattern) ? pattern : [pattern]) await consumer.bindQueue(queue, exchange, binding);
        const { consumerTag } = await consumer.consume(queue, message => {
          if (!message) { connected = false; onError(new Error("Broker cancelled consumer")); return; }
          void (async () => {
            try {
              const event = EventEnvelope.parse(JSON.parse(message.content.toString("utf8")));
              await handler(event);
              consumer.ack(message);
            } catch (error) {
              onError(error instanceof Error ? error : new Error("Consumer failed"));
              // No automatic retry yet: preserve poison/failed messages in the DLQ.
              consumer.nack(message, false, false);
            }
          })().catch(onError);
        }, { noAck: false });
        return () => consumer.cancel(consumerTag);
      },
      // Bounded operator recovery, never an automatic poison-message loop.
      // Confirm the replacement before acking the original dead-letter delivery.
      async replayDeadLetters(queue: string, limit: number,
        beforePublish: (event: EventEnvelope) => Promise<void> = async () => undefined,
        afterPublish: (event: EventEnvelope) => Promise<void> = async () => undefined,
      ) {
        if (!/^[a-zA-Z0-9._-]{1,150}$/.test(queue) || !Number.isInteger(limit) || limit < 1 || limit > 100)
          throw new Error("Invalid redrive parameters");
        await consumer.checkQueue(queue);
        const pending: amqp.GetMessage[] = [];
        let replayed = 0, invalid = 0;
        try {
          for (let i = 0; i < limit; i++) {
            const message = await consumer.get(`${queue}.dead`, { noAck: false });
            if (!message) break;
            pending.push(message);
            let event: EventEnvelope;
            try { event = EventEnvelope.parse(JSON.parse(message.content.toString("utf8"))); }
            catch { invalid++; continue; } // Keep malformed evidence for manual repair.
            await beforePublish(event);
            await confirm((attempt, callback) => {
              publisher.sendToQueue(queue, message.content, { persistent: true, contentType: "application/json", messageId: event.id, correlationId: event.correlationId, type: event.type, mandatory: true, headers: { "x-publish-attempt": attempt } }, callback);
            });
            await afterPublish(event);
            consumer.ack(message);
            pending.pop();
            replayed++;
          }
        } finally {
          for (const message of pending) consumer.nack(message, false, true);
          // RPC barrier: report completion only once the requeues were processed.
          if (pending.length) await consumer.checkQueue(`${queue}.dead`);
        }
        return { replayed, invalid };
      },
      async close() {
        closing = true;
        connected = false;
        try { await consumer.close(); }
        finally {
          try { await publisher.close(); }
          finally { await connection.close(); }
        }
      },
    };
  } catch (error) {
    closing = true;
    await connection.close();
    throw error;
  }
}
