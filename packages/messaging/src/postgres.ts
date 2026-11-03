import type { Pool, PoolClient } from "pg";
import { EventEnvelope } from "@spacex/contracts";

// Install in each service's OWN database, inside its versioned migration.
export const messagingSchema = `
CREATE TABLE IF NOT EXISTS event_outbox (
 id uuid PRIMARY KEY, event jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','DEAD')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, last_error text
);
CREATE INDEX IF NOT EXISTS event_outbox_pending ON event_outbox(next_attempt_at) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS event_inbox (
 consumer text NOT NULL, id uuid NOT NULL, event jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DONE','DEAD')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, last_error text,
 PRIMARY KEY(consumer,id)
);
CREATE INDEX IF NOT EXISTS event_inbox_pending ON event_inbox(consumer,next_attempt_at) WHERE status='PENDING';
`;

export async function enqueueEvent(client: PoolClient, input: EventEnvelope) {
  const event = EventEnvelope.parse(input);
  const { rows } = await client.query(
    `INSERT INTO event_outbox(id,event) VALUES($1,$2)
     ON CONFLICT(id) DO UPDATE SET id=event_outbox.id
     RETURNING event=$2::jsonb AS identical`,
    [event.id, JSON.stringify(event)],
  );
  if (!rows[0].identical) throw new Error("Event ID reused with different content");
}

// Acknowledge the broker only AFTER this durable insert commits.
export async function receiveEvent(pool: Pool, consumer: string, input: EventEnvelope) {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(consumer)) throw new Error("Invalid consumer");
  const event = EventEnvelope.parse(input);
  const { rows } = await pool.query(
    `INSERT INTO event_inbox(consumer,id,event) VALUES($1,$2,$3)
     ON CONFLICT(consumer,id) DO UPDATE SET id=event_inbox.id
     RETURNING event=$3::jsonb AS identical`,
    [consumer, event.id, JSON.stringify(event)],
  );
  if (!rows[0].identical) throw new Error("Event ID reused with different content");
}

type RetryOptions = { maxAttempts?: number; batchSize?: number };
function retryOptions(options: RetryOptions) {
  const maxAttempts = options.maxAttempts ?? 8, batchSize = options.batchSize ?? 50;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100 ||
      !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error("Invalid retry options");
  return { maxAttempts, batchSize };
}

// Row locks survive until publish confirmation + status write. A crash between
// those steps can redeliver: inbox deduplication, not the broker, gives one effect.
export async function dispatchOutbox(
  pool: Pool,
  publish: (event: EventEnvelope) => Promise<void>,
  options: RetryOptions = {},
) {
  const { maxAttempts, batchSize } = retryOptions(options);
  let sent = 0;
  for (let i = 0; i < batchSize; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM event_outbox WHERE status='PENDING' AND next_attempt_at<=clock_timestamp() ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!rows.length) { await client.query("COMMIT"); break; }
      const row = rows[0];
      try {
        await publish(EventEnvelope.parse(row.event));
        await client.query("UPDATE event_outbox SET status='SENT',completed_at=clock_timestamp(),last_error=NULL WHERE id=$1", [row.id]);
        sent++;
      } catch (error) {
        // Persist only error class: provider messages may contain credentials/PII.
        await client.query(
          `UPDATE event_outbox SET attempts=attempts+1,
           status=CASE WHEN attempts+1 >= $2 THEN 'DEAD' ELSE 'PENDING' END,
           next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(300,power(2,attempts+1))::int),last_error=$3 WHERE id=$1`,
          [row.id, maxAttempts, error instanceof Error ? error.name : "UnknownError"],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return sent;
}

// The handler MUST write using this client, never perform external side effects.
// Effects and DONE commit together. Savepoint rolls back a failed handler before
// persisting backoff/DLQ, including handlers which fail after a partial SQL write.
export async function processInbox(
  pool: Pool, consumer: string,
  handler: (client: PoolClient, event: EventEnvelope) => Promise<void>,
  options: RetryOptions = {},
) {
  const { maxAttempts, batchSize } = retryOptions(options);
  let processed = 0;
  for (let i = 0; i < batchSize; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM event_inbox WHERE consumer=$1 AND status='PENDING' AND next_attempt_at<=clock_timestamp() ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED", [consumer],
      );
      if (!rows.length) { await client.query("COMMIT"); break; }
      const row = rows[0];
      await client.query("SAVEPOINT handler");
      try {
        await handler(client, EventEnvelope.parse(row.event));
        await client.query("UPDATE event_inbox SET status='DONE',completed_at=clock_timestamp(),last_error=NULL WHERE consumer=$1 AND id=$2", [consumer, row.id]);
        processed++;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT handler");
        await client.query(
          `UPDATE event_inbox SET attempts=attempts+1,
           status=CASE WHEN attempts+1 >= $3 THEN 'DEAD' ELSE 'PENDING' END,
           next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(300,power(2,attempts+1))::int),last_error=$4 WHERE consumer=$1 AND id=$2`,
          [consumer, row.id, maxAttempts, error instanceof Error ? error.name : "UnknownError"],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return processed;
}

// Call only from an authenticated operator path; retain the original event ID.
export async function replayDeadEvent(client: PoolClient, id: string, consumer?: string) {
  const result = consumer === undefined
    ? await client.query("UPDATE event_outbox SET status='PENDING',attempts=0,next_attempt_at=clock_timestamp(),last_error=NULL WHERE id=$1 AND status='DEAD'", [id])
    : await client.query("UPDATE event_inbox SET status='PENDING',attempts=0,next_attempt_at=clock_timestamp(),last_error=NULL WHERE id=$1 AND consumer=$2 AND status='DEAD'", [id, consumer]);
  return result.rowCount === 1;
}
