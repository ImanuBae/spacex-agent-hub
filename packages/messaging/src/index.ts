import amqp from "amqplib";
import { EventEnvelope } from "@spacex/contracts";

export async function connectBroker(
  url: string,
  onError: (error: Error) => void,
) {
  const connection = await amqp.connect(url, { timeout: 5000 });
  let closing = false;
  connection.on("error", onError);
  connection.on("close", () => { if (!closing) onError(new Error("Broker connection closed")); });
  try {
    const publisher = await connection.createConfirmChannel();
    const consumer = await connection.createChannel();
    publisher.on("error", onError);
    consumer.on("error", onError);
    const exchange = "spacex.events";
    const deadExchange = "spacex.dead";
    await publisher.assertExchange(exchange, "topic", { durable: true });
    await consumer.assertExchange(deadExchange, "direct", { durable: true });
    await consumer.prefetch(1);
    return {
      async publish(input: EventEnvelope) {
        const event = EventEnvelope.parse(input);
        await new Promise<void>((resolve, reject) => {
          publisher.publish(exchange, event.type, Buffer.from(JSON.stringify(event)), {
            persistent: true, contentType: "application/json", messageId: event.id,
            correlationId: event.correlationId, type: event.type,
          }, error => error ? reject(error) : resolve());
        });
      },
      async subscribe(queue: string, pattern: string, handler: (event: EventEnvelope) => Promise<void>) {
        await consumer.assertQueue(`${queue}.dead`, { durable: true });
        await consumer.bindQueue(`${queue}.dead`, deadExchange, queue);
        await consumer.assertQueue(queue, { durable: true, arguments: {
          "x-dead-letter-exchange": deadExchange, "x-dead-letter-routing-key": queue,
        } });
        await consumer.bindQueue(queue, exchange, pattern);
        const { consumerTag } = await consumer.consume(queue, message => {
          if (!message) { onError(new Error("Broker cancelled consumer")); return; }
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
      async close() {
        closing = true;
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
