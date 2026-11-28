import pg from "pg";
import { authConfig } from "@spacex/auth";
import { createReportingApp } from "./app.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), connectionTimeoutMillis: 5000 });
const server = createReportingApp(pool, authConfig(), {
  enrollment: required("ENROLLMENT_URL"), payment: required("PAYMENT_URL"),
  sourceClientId: required("REPORTING_SOURCE_CLIENT_ID"), sourceClientSecret: required("REPORTING_SOURCE_CLIENT_SECRET"),
}).listen(Number(process.env.PORT ?? 4011), process.env.HOST ?? "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.close(() => { void pool.end().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10000).unref();
});
