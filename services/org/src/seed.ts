import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const branches = [["HCM", "Trung tâm TP.HCM"], ["Q1", "Quận 1"], ["TD", "Thủ Đức"], ["TB", "Tân Bình"], ["BT", "Bình Thạnh"], ["Q7", "Quận 7"]];
try {
  for (const [i, [code, name]] of branches.entries()) {
    const id = `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    await pool.query("INSERT INTO branches(id,code,name,kind) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING", [id, code, name, i === 0 ? "center" : "branch"]);
  }
  console.log("Org seed completed (existing branches unchanged)");
} finally { await pool.end(); }
