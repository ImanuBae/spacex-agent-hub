import { spawnSync } from "node:child_process";

if (!process.env.CATALOG_TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  throw new Error("Database tests require CATALOG_TEST_DATABASE_URL or DATABASE_URL; use a local test database.");
}

const result = spawnSync(process.execPath, ["../../node_modules/vitest/vitest.mjs", "run"], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
