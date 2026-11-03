import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (!process.env.CLASS_TEST_DATABASE_URL) {
  console.error(
    "CLASS_TEST_DATABASE_URL is required; DB acceptance must not be skipped",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url),
    ),
    "run",
    "src/postgres.test.ts",
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
