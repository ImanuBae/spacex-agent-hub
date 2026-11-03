import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AccessInput, AccountInput, LoginInput, type Role } from "@spacex/contracts";
import { bearer, verifyAccessToken, signAccessToken, allowRoles, principal, checkBranch, type AuthConfig, type Principal } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";
import { hashPassword, verifyPassword, refreshHash } from "./password.js";

interface Account { id: string; email: string; name: string; role: Role; branch_ids: string[]; active: boolean; password_hash: string; locked_until: Date | null; }
const view = (a: Account) => ({ id: a.id, email: a.email, name: a.name, role: a.role, branchIds: a.branch_ids, active: a.active });
const Id = z.uuid();
const invalid = () => new HttpError(401, "UNAUTHORIZED", "Invalid credentials or session");

export function createIdentityApp(pool: Pool, config: AuthConfig, orgUrl: string) {
  async function audit(db: Pool | PoolClient, actor: string | null, action: string, target: string | null) {
    await db.query("INSERT INTO identity_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)", [randomUUID(), actor, action, target]);
  }
  async function issue(client: PoolClient, account: Account, sid = randomUUID(), familyId = sid, expiresAt = new Date(Date.now() + 28800000)) {
    const refreshToken = randomBytes(32).toString("base64url");
    await client.query("INSERT INTO sessions(id,account_id,family_id,refresh_hash,expires_at) VALUES($1,$2,$3,$4,$5)", [sid, account.id, familyId, refreshHash(refreshToken), expiresAt]);
    const accessToken = await signAccessToken({ id: account.id, role: account.role, branchIds: account.branch_ids }, sid, config);
    return { accessToken, refreshToken, expiresIn: 300, refreshExpiresIn: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)), user: view(account) };
  }
  async function live(token: string): Promise<Principal> {
    const claims = await verifyAccessToken(token, config);
    const result = await pool.query("SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=$1 AND a.id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.active=true", [claims.sid, claims.sub]);
    const account = result.rows[0] as Account | undefined;
    if (!account || account.role !== claims.role || JSON.stringify([...account.branch_ids].sort()) !== JSON.stringify([...claims.branchIds].sort())) throw invalid();
    return claims;
  }
  return createApp("identity", app => {
    app.get("/ready", async (_req, res) => { await pool.query("SELECT 1 FROM accounts LIMIT 1"); res.json({ status: "ok" }); });
    app.post("/api/v1/auth/login", async (req, res) => {
      const input = LoginInput.parse(req.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT * FROM accounts WHERE email=$1 FOR UPDATE", [input.email]);
        const account = rows[0] as Account | undefined;
        // Use a fixed-cost hash even for an unknown email to reduce timing disclosure.
        const fallback = "scrypt$00000000000000000000000000000000$" + "00".repeat(64);
        const valid = await verifyPassword(input.password, account?.password_hash ?? fallback);
        if (!account || !account.active || (account.role !== "center_director" && account.branch_ids.length === 0) || (account.locked_until && account.locked_until > new Date()) || !valid) {
          if (account) await client.query("UPDATE accounts SET failed_attempts=CASE WHEN locked_until>now() THEN failed_attempts WHEN locked_until IS NOT NULL THEN 1 ELSE failed_attempts+1 END, locked_until=CASE WHEN locked_until>now() THEN locked_until WHEN (CASE WHEN locked_until IS NOT NULL THEN 0 ELSE failed_attempts END)>=4 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1", [account.id]);
          await audit(client, null, "login.failed", account?.id ?? null);
          await client.query("COMMIT");
          throw invalid();
        }
        await client.query("UPDATE accounts SET failed_attempts=0, locked_until=NULL WHERE id=$1", [account.id]);
        const data = await issue(client, account);
        await audit(client, account.id, "login.succeeded", account.id);
        await client.query("COMMIT");
        res.json({ data });
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    app.post("/api/v1/auth/refresh", async (req, res) => {
      const { refreshToken } = z.object({ refreshToken: z.string().min(32).max(200) }).strict().parse(req.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const account = await client.query("SELECT * FROM accounts WHERE id=(SELECT account_id FROM sessions WHERE refresh_hash=$1) AND active=true FOR UPDATE", [refreshHash(refreshToken)]);
        if (!account.rowCount) throw invalid();
        const old = await client.query("SELECT * FROM sessions WHERE refresh_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE", [refreshHash(refreshToken)]);
        if (!old.rowCount) throw invalid();
        await client.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [old.rows[0].id]);
        const data = await issue(client, account.rows[0], randomUUID(), old.rows[0].family_id, old.rows[0].expires_at);
        await audit(client, account.rows[0].id, "session.refreshed", account.rows[0].id);
        await client.query("COMMIT");
        res.json({ data });
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    app.post("/api/v1/auth/logout", async (req, res) => {
      const { refreshToken } = z.object({ refreshToken: z.string().min(32).max(200) }).strict().parse(req.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM accounts WHERE id=(SELECT account_id FROM sessions WHERE refresh_hash=$1) FOR UPDATE", [refreshHash(refreshToken)]);
        await client.query("UPDATE sessions SET revoked_at=now() WHERE family_id=(SELECT family_id FROM sessions WHERE refresh_hash=$1) AND revoked_at IS NULL", [refreshHash(refreshToken)]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      res.status(204).end();
    });
    app.use("/api/v1", async (req, res, next) => {
      try { res.locals.principal = await live(bearer(req.get("authorization"))); next(); } catch (error) { next(error); }
    });
    app.post("/api/v1/auth/introspect", (_req, res) => res.json({ data: principal(res) }));
    app.get("/api/v1/assignees", allowRoles("center_director", "branch_director", "admissions"), async (req, res) => {
      const query = z.object({ branchId: Id, accountId: Id.optional() }).strict().parse(req.query);
      checkBranch(principal(res), query.branchId);
      const { rows } = await pool.query("SELECT id,name,role FROM accounts WHERE active=true AND role IN ('admissions','branch_director') AND $1::uuid=ANY(branch_ids) AND ($2::uuid IS NULL OR id=$2) ORDER BY name,id LIMIT 500", [query.branchId, query.accountId ?? null]);
      res.json({ data: rows });
    });
    app.get("/api/v1/auth/me", async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM accounts WHERE id=$1", [principal(res).sub]);
      res.json({ data: view(rows[0]) });
    });
    app.use("/api/v1/accounts", allowRoles("center_director"));
    app.get("/api/v1/accounts", async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM accounts ORDER BY created_at,id LIMIT 100");
      res.json({ data: rows.map(view) });
    });
    app.get("/api/v1/accounts/:id", async (req, res) => {
      const { rows } = await pool.query("SELECT * FROM accounts WHERE id=$1", [Id.parse(req.params.id)]);
      if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Account not found");
      res.json({ data: view(rows[0]) });
    });
    app.post("/api/v1/accounts", async (req, res) => {
      const input = AccountInput.parse(req.body);
      const passwordHash = await hashPassword(input.password);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("INSERT INTO accounts(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *", [randomUUID(), input.email, input.name, passwordHash, input.role]);
        await audit(client, principal(res).sub, "account.created", rows[0].id);
        await client.query("COMMIT");
        res.status(201).json({ data: view(rows[0]) });
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    app.put("/api/v1/accounts/:id/access", async (req, res) => {
      const id = Id.parse(req.params.id);
      const input = AccessInput.parse(req.body);
      const changeId = Id.parse(req.get("idempotency-key"));
      if (id === principal(res).sub) throw new HttpError(403, "FORBIDDEN", "Cannot change your own access");
      if (input.role !== "center_director" && input.branchIds.length === 0) throw new HttpError(400, "VALIDATION_ERROR", "Staff must be assigned a branch");
      for (const branchId of input.branchIds) {
        let response: Response;
        try { response = await fetch(`${orgUrl}/api/v1/branches/${branchId}`, { headers: { authorization: req.get("authorization")! }, signal: AbortSignal.timeout(5000) }); }
        catch { throw new HttpError(503, "ORG_UNAVAILABLE", "Cannot validate branch"); }
        if (response.status === 404) throw new HttpError(400, "VALIDATION_ERROR", "Unknown branch");
        if (!response.ok) throw new HttpError(503, "ORG_UNAVAILABLE", "Cannot validate branch");
        const branch = await response.json() as { data: { active: boolean } };
        if (!branch.data.active) throw new HttpError(409, "CONFLICT", "Branch is inactive");
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [id]);
        const previous = await client.query("SELECT * FROM access_changes WHERE id=$1", [changeId]);
        if (previous.rowCount) {
          const old = previous.rows[0];
          if (old.account_id !== id || old.actor_id !== principal(res).sub || old.role !== input.role || JSON.stringify(old.branch_ids) !== JSON.stringify(input.branchIds)) throw new HttpError(409, "CONFLICT", "Idempotency key reused");
        } else {
          const result = await client.query("UPDATE accounts SET role=$2,branch_ids=$3 WHERE id=$1 RETURNING id", [id, input.role, input.branchIds]);
          if (!result.rowCount) throw new HttpError(404, "NOT_FOUND", "Account not found");
          await client.query("UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL", [id]);
          await client.query("INSERT INTO access_changes(id,account_id,role,branch_ids,actor_id) VALUES($1,$2,$3,$4,$5)", [changeId, id, input.role, input.branchIds, principal(res).sub]);
          await audit(client, principal(res).sub, "account.access_changed", id);
        }
        await client.query("COMMIT");
        res.json({ data: { changeId, status: "applied" } });
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    app.put("/api/v1/accounts/:id/status", async (req, res) => {
      const id = Id.parse(req.params.id);
      const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
      if (id === principal(res).sub) throw new HttpError(403, "FORBIDDEN", "Cannot change your own account status");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("UPDATE accounts SET active=$2,failed_attempts=0,locked_until=NULL WHERE id=$1 RETURNING id", [id, active]);
        if (!result.rowCount) throw new HttpError(404, "NOT_FOUND", "Account not found");
        await client.query("UPDATE sessions SET revoked_at=now() WHERE account_id=$1", [id]);
        await audit(client, principal(res).sub, "account.status_changed", id);
        await client.query("COMMIT");
        res.json({ data: { id, active } });
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
  });
}
