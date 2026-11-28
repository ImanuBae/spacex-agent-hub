import { readFile } from "node:fs/promises";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(40020001)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)");
  for (const version of ["0001", "0002_machine", "0003_channel", "0004_service", "0005_learner", "0006_self_registration"]) {
    if ((await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version])).rowCount) continue;
    await client.query(await readFile(new URL(`../migrations/${version}.sql`, import.meta.url), "utf8"));
    await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
  }
  await client.query("COMMIT");
  console.log("Identity migration completed");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
