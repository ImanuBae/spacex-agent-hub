import { randomUUID } from "node:crypto";
import pg from "pg";
import { AccountInput } from "@spacex/contracts";
import { hashPassword } from "./password.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const input = AccountInput.parse({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD, name: "Giám đốc trung tâm", role: "center_director" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query("INSERT INTO accounts(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING", [randomUUID(), input.email, input.name, await hashPassword(input.password), input.role]);
  console.log("Admin seed completed (existing account unchanged)");
} finally { await pool.end(); }
