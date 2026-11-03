import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (!process.env.MESSAGING_TEST_DATABASE_URL || !process.env.RABBITMQ_TEST_URL) {
  console.error("MESSAGING_TEST_DATABASE_URL and RABBITMQ_TEST_URL are required; acceptance must not skip");
  process.exit(1);
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "src/postgres.test.ts", "src/broker.test.ts"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
