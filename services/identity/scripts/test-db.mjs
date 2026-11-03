import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (!process.env.STAGE1_TEST_DATABASE_URL) {
  console.error("STAGE1_TEST_DATABASE_URL required; use an isolated PostgreSQL server with CREATE DATABASE permission.");
  process.exit(1);
}
const cli = fileURLToPath(new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [cli, "run", "src/stage1.test.ts"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
