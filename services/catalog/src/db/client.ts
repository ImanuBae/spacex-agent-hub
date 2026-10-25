import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createLogger } from "@spacex/logger";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
}

const logger = createLogger(process.env.SERVICE_NAME ?? "catalog");
export const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
// PostgreSQL restart closes idle connections; handle the pool event so the
// process stays alive and the next request can open a fresh connection.
pool.on("error", error => logger.error("database.idle_error", { errorName: error.name }));
export const db = drizzle(pool);
