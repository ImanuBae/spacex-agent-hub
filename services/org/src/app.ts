import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { AccessInput, BranchInput, DepartmentInput, EmployeeInput } from "@spacex/contracts";
import { authenticate, allowRoles, principal, checkBranch, type AuthConfig, type Principal } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";

const Id = z.uuid();
const missing = () => new HttpError(404, "NOT_FOUND", "Resource not found");
const branchView = (r: Record<string, unknown>) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, active: r.active });
const deptView = (r: Record<string, unknown>) => ({ id: r.id, branchId: r.branch_id, name: r.name, description: r.description, active: r.active });
const employeeView = (r: Record<string, unknown>) => ({ id: r.id, accountId: r.account_id, branchId: r.branch_id, departmentId: r.department_id, name: r.name, title: r.title, teacherProfile: r.teacher_profile, active: r.active });

export function createOrgApp(pool: Pool, config: AuthConfig) {
  const scope = (user: Principal) => user.role === "center_director" ? null : user.branchIds;
  async function activeBranch(id: string) {
    const result = await pool.query("SELECT id FROM branches WHERE id=$1 AND active=true", [id]);
    if (!result.rowCount) throw new HttpError(409, "CONFLICT", "Unknown or inactive branch");
  }
  async function activeDepartment(id: string | null, branchId: string) {
    if (!id) return;
    if (!(await pool.query("SELECT id FROM departments WHERE id=$1 AND branch_id=$2 AND active=true", [id, branchId])).rowCount) throw new HttpError(409, "CONFLICT", "Department is inactive or belongs to another branch");
  }
  async function accountExists(id: string, authorization: string) {
    let response: Response;
    try { response = await fetch(`${config.identityUrl}/api/v1/accounts/${id}`, { headers: { authorization }, signal: AbortSignal.timeout(5000) }); }
    catch { throw new HttpError(503, "IDENTITY_UNAVAILABLE", "Cannot validate account"); }
    if (response.status === 404) throw new HttpError(409, "CONFLICT", "Unknown account");
    if (!response.ok) throw new HttpError(503, "IDENTITY_UNAVAILABLE", "Cannot validate account");
    const data = await response.json() as { data: { id: string; active: boolean } };
    if (!data.data.active) throw new HttpError(409, "CONFLICT", "Inactive account");
  }
  async function mutation(sql: string, values: unknown[], actor: string, action: string, target?: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(sql, values);
      if (!result.rows[0]) throw missing();
      await client.query("INSERT INTO org_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)", [randomUUID(), actor, action, target ?? result.rows[0].id]);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  return createApp("org", app => {
    app.get("/ready", async (_req, res) => { await pool.query("SELECT 1 FROM branches LIMIT 1"); res.json({ status: "ok" }); });
    app.use("/api/v1", authenticate(config), allowRoles("center_director", "branch_director", "admissions", "accountant", "teacher"));
    app.get("/api/v1/branches", async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM branches WHERE ($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY code", [scope(principal(res))]);
      res.json({ data: rows.map(branchView) });
    });
    app.get("/api/v1/branches/:id", async (req, res) => {
      const id = Id.parse(req.params.id); checkBranch(principal(res), id);
      const { rows } = await pool.query("SELECT * FROM branches WHERE id=$1", [id]);
      if (!rows[0]) throw missing();
      res.json({ data: branchView(rows[0]) });
    });
    app.post("/api/v1/branches", allowRoles("center_director"), async (req, res) => {
      const b = BranchInput.parse(req.body);
      const { rows } = await mutation("INSERT INTO branches(id,code,name,kind,active) VALUES($1,$2,$3,$4,$5) RETURNING *", [randomUUID(), b.code, b.name, b.kind, b.active], principal(res).sub, "branch.created");
      res.status(201).json({ data: branchView(rows[0]) });
    });
    app.put("/api/v1/branches/:id", allowRoles("center_director"), async (req, res) => {
      const id = Id.parse(req.params.id), b = BranchInput.parse(req.body);
      const { rows } = await mutation("UPDATE branches SET code=$2,name=$3,kind=$4,active=$5 WHERE id=$1 RETURNING *", [id, b.code, b.name, b.kind, b.active], principal(res).sub, "branch.updated");
      if (!rows[0]) throw missing();
      res.json({ data: branchView(rows[0]) });
    });
    app.get("/api/v1/departments", async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM departments WHERE ($1::uuid[] IS NULL OR branch_id=ANY($1)) ORDER BY name", [scope(principal(res))]);
      res.json({ data: rows.map(deptView) });
    });
    app.post("/api/v1/departments", allowRoles("center_director", "branch_director"), async (req, res) => {
      const d = DepartmentInput.parse(req.body); checkBranch(principal(res), d.branchId); await activeBranch(d.branchId);
      const { rows } = await mutation("INSERT INTO departments(id,branch_id,name,description,active) VALUES($1,$2,$3,$4,$5) RETURNING *", [randomUUID(), d.branchId, d.name, d.description, d.active], principal(res).sub, "department.created");
      res.status(201).json({ data: deptView(rows[0]) });
    });
    app.put("/api/v1/departments/:id", allowRoles("center_director", "branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), d = DepartmentInput.parse(req.body);
      const old = await pool.query("SELECT * FROM departments WHERE id=$1", [id]);
      if (!old.rows[0]) throw missing();
      checkBranch(principal(res), old.rows[0].branch_id); checkBranch(principal(res), d.branchId); await activeBranch(d.branchId);
      const { rows } = await mutation("UPDATE departments SET branch_id=$2,name=$3,description=$4,active=$5 WHERE id=$1 RETURNING *", [id, d.branchId, d.name, d.description, d.active], principal(res).sub, "department.updated");
      res.json({ data: deptView(rows[0]) });
    });
    app.get("/api/v1/employees", allowRoles("center_director", "branch_director", "teacher"), async (_req, res) => {
      const user = principal(res);
      const { rows } = await pool.query("SELECT * FROM employees WHERE ($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2::uuid IS NULL OR account_id=$2) ORDER BY name", [scope(user), user.role === "teacher" ? user.sub : null]);
      res.json({ data: rows.map(employeeView) });
    });
    app.get("/api/v1/teachers", async (_req, res) => {
      const user = principal(res);
      const { rows } = await pool.query("SELECT id,account_id,branch_id,name FROM employees WHERE active=true AND teacher_profile IS NOT NULL AND ($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2::uuid IS NULL OR account_id=$2) ORDER BY name", [scope(user), user.role === "teacher" ? user.sub : null]);
      res.json({ data: rows.map(r => ({ id: r.id, accountId: r.account_id, branchId: r.branch_id, name: r.name })) });
    });
    app.post("/api/v1/employees", allowRoles("center_director"), async (req, res) => {
      const e = EmployeeInput.parse(req.body); await activeBranch(e.branchId); await activeDepartment(e.departmentId, e.branchId); await accountExists(e.accountId, req.get("authorization")!);
      const { rows } = await mutation("INSERT INTO employees(id,account_id,branch_id,department_id,name,title,teacher_profile,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [randomUUID(), e.accountId, e.branchId, e.departmentId, e.name, e.title, e.teacherProfile, e.active], principal(res).sub, "employee.created");
      res.status(201).json({ data: employeeView(rows[0]) });
    });
    app.put("/api/v1/employees/:id", allowRoles("center_director", "branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), e = EmployeeInput.parse(req.body);
      const old = await pool.query("SELECT * FROM employees WHERE id=$1", [id]);
      if (!old.rows[0]) throw missing();
      const user = principal(res); checkBranch(user, old.rows[0].branch_id); checkBranch(user, e.branchId);
      if (old.rows[0].account_id !== e.accountId || old.rows[0].branch_id !== e.branchId) throw new HttpError(409, "CONFLICT", "Account and primary branch are immutable; use access workflow for permissions");
      await activeBranch(e.branchId);
      await activeDepartment(e.departmentId, e.branchId);
      const { rows } = await mutation("UPDATE employees SET department_id=$2,name=$3,title=$4,teacher_profile=$5,active=$6 WHERE id=$1 RETURNING *", [id, e.departmentId, e.name, e.title, e.teacherProfile, e.active], user.sub, "employee.updated");
      res.json({ data: employeeView(rows[0]) });
    });
    app.get("/api/v1/access-sync", allowRoles("center_director"), async (_req, res) => {
      const { rows } = await pool.query("SELECT id,employee_id,role,branch_ids,status,created_at FROM access_sync ORDER BY created_at DESC LIMIT 100");
      res.json({ data: rows.map(r => ({ id: r.id, employeeId: r.employee_id, role: r.role, branchIds: r.branch_ids, status: r.status, createdAt: r.created_at })) });
    });
    app.put("/api/v1/employees/:id/access", allowRoles("center_director"), async (req, res) => {
      const id = Id.parse(req.params.id), input = AccessInput.parse(req.body), changeId = Id.parse(req.get("idempotency-key"));
      const { rows } = await pool.query("SELECT * FROM employees WHERE id=$1", [id]);
      const employee = rows[0]; if (!employee) throw missing();
      if (!employee.active) throw new HttpError(409, "CONFLICT", "Employee inactive");
      if (employee.account_id === principal(res).sub) throw new HttpError(403, "FORBIDDEN", "Cannot change your own access");
      if (input.role !== "center_director" && !input.branchIds.includes(employee.branch_id)) throw new HttpError(400, "VALIDATION_ERROR", "Access must include employee primary branch");
      for (const branchId of input.branchIds) await activeBranch(branchId);
      await pool.query("INSERT INTO access_sync(id,employee_id,actor_id,role,branch_ids,status) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(id) DO NOTHING", [changeId, id, principal(res).sub, input.role, input.branchIds]);
      const previous = (await pool.query("SELECT * FROM access_sync WHERE id=$1", [changeId])).rows[0];
      if (previous.employee_id !== id || previous.actor_id !== principal(res).sub || previous.role !== input.role || JSON.stringify(previous.branch_ids) !== JSON.stringify(input.branchIds)) throw new HttpError(409, "CONFLICT", "Idempotency key reused");
      if (previous.status === "applied") { res.json({ data: { changeId, status: "applied" } }); return; }
      if (previous.status === "rejected") throw new HttpError(409, "CONFLICT", "Rejected operation; create a new request");
      let response: Response;
      try {
        response = await fetch(`${config.identityUrl}/api/v1/accounts/${employee.account_id}/access`, { method: "PUT", headers: { authorization: req.get("authorization")!, "content-type": "application/json", "idempotency-key": changeId }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
      } catch {
        res.status(202).json({ data: { changeId, status: "pending", message: "Retry the same operation with the same key after IAM recovers" } }); return;
      }
      if (!response.ok) {
        if (response.status >= 500) { res.status(202).json({ data: { changeId, status: "pending" } }); return; }
        await pool.query("UPDATE access_sync SET status='rejected' WHERE id=$1 AND status='pending'", [changeId]);
        res.status(response.status).json(await response.json()); return;
      }
      await mutation("UPDATE access_sync SET status='applied' WHERE id=$1 RETURNING id", [changeId], principal(res).sub, "employee.access_applied", id);
      res.json({ data: { changeId, status: "applied" } });
    });
  });
}
