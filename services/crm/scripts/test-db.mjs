import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (!process.env.CRM_TEST_DATABASE_URL) { console.error("CRM_TEST_DATABASE_URL required; DB acceptance must not skip"); process.exit(1); }
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "src/postgres.test.ts"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
