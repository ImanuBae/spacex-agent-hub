import { randomUUID } from "node:crypto";
import { createLogger } from "@spacex/logger";
import { connectBroker } from "@spacex/messaging";

const logger = createLogger("messaging-demo");
const correlationId = randomUUID();
const eventId = randomUUID();
const broker = await connectBroker(
  process.env.RABBITMQ_URL ?? "amqp://spacex:spacex_dev@127.0.0.1:5672",
  error => logger.error("broker.error", { correlationId, errorName: error.name }),
);
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  let received!: () => void;
  const delivered = new Promise<void>((resolve) => {
    received = resolve;
  });
  const cancel = await broker.subscribe("demo.service-template", "demo.ping", async event => {
    logger.info("event.received", { correlationId: event.correlationId, eventId: event.id, type: event.type });
    if (event.id === eventId) received();
  });
  await broker.publish({ id: eventId, type: "demo.ping", version: 1,
    occurredAt: new Date().toISOString(), correlationId, payload: { message: "hello" } });
  logger.info("event.published", { correlationId, eventId });
  await Promise.race([delivered, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("No demo event received within 10 seconds")), 10_000);
  })]);
  await cancel();
} finally {
  clearTimeout(timer);
  await broker.close();
}
