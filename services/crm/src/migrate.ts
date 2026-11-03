import { readFile } from "node:fs/promises";
import pg from "pg";
import { messagingSchema } from "@spacex/messaging";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }), client = await pool.connect();
try {
  await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(40050001)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)");
  if (!(await client.query("SELECT 1 FROM schema_migrations WHERE version='0001'")).rowCount) {
    await client.query(await readFile(new URL("../migrations/0001.sql", import.meta.url), "utf8"));
    await client.query(messagingSchema);
    await client.query("INSERT INTO schema_migrations VALUES('0001')");
  }
  await client.query("COMMIT"); console.log("CRM migration completed");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
