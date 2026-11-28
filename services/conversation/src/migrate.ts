import { readFile } from "node:fs/promises";
import pg from "pg";
import { messagingSchema } from "@spacex/messaging";
import { erasureProofSchema } from "@spacex/auth";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }), c = await pool.connect();
try {
  await c.query("BEGIN"); await c.query("SELECT pg_advisory_xact_lock(40070001)");
  await c.query("CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)");
  if (!(await c.query("SELECT 1 FROM schema_migrations WHERE version='0001'")).rowCount) {
    await c.query(await readFile(new URL("../migrations/0001.sql", import.meta.url), "utf8"));
    await c.query(messagingSchema); await c.query("INSERT INTO schema_migrations VALUES('0001')");
  }
  if (!(await c.query("SELECT 1 FROM schema_migrations WHERE version='0002'")).rowCount) {
    await c.query(erasureProofSchema);
    await c.query("ALTER TABLE conversations ADD COLUMN erased_at timestamptz");
    await c.query("INSERT INTO schema_migrations VALUES('0002')");
  }
  if (!(await c.query("SELECT 1 FROM schema_migrations WHERE version='0003'")).rowCount) {
    await c.query(`ALTER TABLE conversations ADD COLUMN local_reply_pending boolean NOT NULL DEFAULT false;
      CREATE INDEX conversations_local_reply_pending ON conversations(updated_at) WHERE local_reply_pending`);
    await c.query("INSERT INTO schema_migrations VALUES('0003')");
  }
  await c.query("COMMIT");
} catch (error) { await c.query("ROLLBACK"); throw error; }
finally { c.release(); await pool.end(); }
