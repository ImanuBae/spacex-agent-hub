import pg from "pg";
const branch = "10000000-0000-4000-8000-000000000002";
if (!process.env.DATABASE_URL || process.env.APP_ENV !== "demo")
  throw new Error("DATABASE_URL and APP_ENV=demo required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (let i = 1; i <= 6; i++) {
    const suffix = String(i).padStart(12, "0");
    await pool.query(
      "INSERT INTO demo_fixtures VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
      [
        `d0000000-0000-4000-8000-${suffix}`,
        `d1000000-0000-4000-8000-${suffix}`,
        `d2000000-0000-4000-8000-${suffix}`,
        `DEMO · Học viên thử ${i}`,
        branch,
      ],
    );
  }
  console.log("Six labelled demo fixtures seeded; existing data unchanged");
} finally {
  await pool.end();
}
