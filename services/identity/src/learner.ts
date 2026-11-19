import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { bearer, checkBranch, verifyCommand, type AuthConfig, type Principal } from "@spacex/auth";
import { HttpError } from "@spacex/http";
import { hashPassword } from "./password.js";
import type { Account } from "./app.js";

export interface LearnerConfig { crmUrl: string; notificationUrl: string; notificationSecret: string; }
const RequestOtp = z.object({ email: z.email().max(254).toLowerCase(), challengeSessionId: z.uuid(), purpose: z.literal("STUDENT_LOGIN") }).strict();
const VerifyOtp = z.object({ challengeId: z.uuid(), challengeSessionId: z.uuid(), purpose: z.literal("STUDENT_LOGIN"), code: z.string().regex(/^\d{6}$/) }).strict();
export function otpHash(secret: string, challengeId: string, code: string) { return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex"); }
const denied = () => new HttpError(403, "FORBIDDEN", "Learner authority denied");
const invalid = () => new HttpError(401, "OTP_INVALID", "Invalid or expired verification");
export function registerLearnerRoutes(app: Express, pool: Pool, auth: AuthConfig, config: LearnerConfig | undefined,
  live: (token: string) => Promise<Principal>, issue: (c: PoolClient, account: Account) => Promise<unknown>) {
  function configured() { if (!config || config.notificationSecret.length < 32) throw new HttpError(503, "LEARNER_NOT_CONFIGURED", "Learner verification unavailable"); return config; }
  async function tx<T>(work: (c: PoolClient) => Promise<T>) { const c = await pool.connect(); try { await c.query("BEGIN"); const result = await work(c); await c.query("COMMIT"); return result; } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); } }
  async function audit(c: PoolClient, account: string, action: string, target: string) { await c.query("INSERT INTO identity_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)", [randomUUID(), account, action, target]); }
  app.post("/api/v1/learner-identities", async (req, res) => {
    const cfg = configured(), token = bearer(req.get("authorization")), user = await live(token);
    if (!["center_director", "branch_director"].includes(user.role)) throw denied();
    const input = z.object({ learnerId: z.uuid(), branchId: z.uuid(), email: z.email().max(254).toLowerCase(), name: z.string().trim().min(1).max(120) }).strict().parse(req.body);
    checkBranch(user, input.branchId);
    let response: Response;
    try { response = await fetch(`${cfg.crmUrl}/api/v1/crm/people/${input.learnerId}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: "error" }); }
    catch { throw new HttpError(503, "CRM_UNAVAILABLE", "Learner source unavailable"); }
    if (!response.ok) throw denied();
    const { data } = await response.json() as { data: { person: { id: string; branchId: string; kind: string; status: string; email?: string } } };
    if (data.person.id !== input.learnerId || data.person.branchId !== input.branchId || data.person.kind !== "LEARNER" || data.person.status !== "ACTIVE" || data.person.email?.toLowerCase() !== input.email) throw denied();
    const password = await hashPassword(randomBytes(48).toString("base64url"));
    const result = await tx(async c => {
      const verified = await live(token);
      checkBranch(verified, input.branchId);
      const id = randomUUID();
      await c.query("INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,$3,$4,'student',$5)", [id, input.email, input.name, password, [input.branchId]]);
      await c.query("INSERT INTO learner_identities(account_id,learner_id,branch_id,verified_by) VALUES($1,$2,$3,$4)", [id, input.learnerId, input.branchId, user.sub]);
      await audit(c, user.sub, "learner.identity_verified", id);
      return { accountId: id, learnerId: input.learnerId, branchId: input.branchId };
    }); res.status(201).json({ data: result });
  });
  app.get("/api/v1/learner-identities/:learnerId", async (req, res) => {
    const user = await live(bearer(req.get("authorization")));
    if (!["center_director", "branch_director", "admissions"].includes(user.role)) throw denied();
    const row = (await pool.query("SELECT l.*,a.email,a.name FROM learner_identities l JOIN accounts a ON a.id=l.account_id WHERE l.learner_id=$1 AND a.active=true AND a.role='student' AND l.branch_id=ANY(a.branch_ids)", [z.uuid().parse(req.params.learnerId)])).rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "Learner identity not found");
    checkBranch(user, row.branch_id);
    res.json({ data: { accountId: row.account_id, learnerId: row.learner_id, branchId: row.branch_id, email: row.email, name: row.name } });
  });
  app.get("/api/v1/auth/learner", async (req, res) => {
    const user = await live(bearer(req.get("authorization")));
    if (user.role !== "student") throw denied();
    const row = (await pool.query("SELECT * FROM learner_identities WHERE account_id=$1", [user.sub])).rows[0];
    if (!row || !user.branchIds.includes(row.branch_id)) throw denied();
    res.json({ data: { accountId: user.sub, learnerId: row.learner_id, branchId: row.branch_id } });
  });
  app.post("/api/v1/auth/otp/request", async (req, res) => {
    const cfg = configured(), input = RequestOtp.parse(req.body), code = randomInt(0, 1000000).toString().padStart(6, "0"), id = randomUUID();
    const row = await tx(async c => {
      const account = (await c.query("SELECT a.*,l.learner_id,l.branch_id FROM accounts a JOIN learner_identities l ON l.account_id=a.id WHERE a.email=$1 AND a.active=true AND a.role='student' AND l.branch_id=ANY(a.branch_ids) FOR UPDATE OF a", [input.email])).rows[0];
      if (!account) throw invalid();
      if (Number((await c.query("SELECT count(*) FROM otp_challenges WHERE account_id=$1 AND created_at>clock_timestamp()-interval '15 minutes'", [account.id])).rows[0].count) >= 3) throw new HttpError(429, "OTP_RATE_LIMIT", "Try verification later");
      const challenge = (await c.query("INSERT INTO otp_challenges(id,account_id,session_binding,purpose,code_hash) VALUES($1,$2,$3,$4,$5) RETURNING expires_at", [id, account.id, input.challengeSessionId, input.purpose, otpHash(auth.secret, id, code)])).rows[0];
      await audit(c, account.id, "otp.requested", id);
      return { ...challenge, accountId: account.id, learnerId: account.learner_id, branchId: account.branch_id, email: account.email };
    });
    let delivery: Response;
    try { delivery = await fetch(`${cfg.notificationUrl}/internal/notification/otp`, { method: "POST", headers: { "content-type": "application/json", "x-iam-notification-secret": cfg.notificationSecret }, body: JSON.stringify({ challengeId: id, accountId: row.accountId, learnerId: row.learnerId, branchId: row.branchId, email: row.email, code, expiresAt: row.expires_at }), signal: AbortSignal.timeout(5000), redirect: "error" }); }
    catch { throw new HttpError(503, "OTP_DELIVERY_PENDING", "Verification delivery unavailable"); }
    if (!delivery.ok) throw new HttpError(503, "OTP_DELIVERY_PENDING", "Verification delivery unavailable");
    const receipt = z.object({ intentId: z.uuid() }).parse((await delivery.json() as { data: unknown }).data);
    await pool.query("UPDATE otp_challenges SET delivery_ref=$2 WHERE id=$1", [id, receipt.intentId]);
    res.status(201).json({ data: { challengeId: id, deliveryRef: receipt.intentId, expiresAt: row.expires_at } });
  });
  app.post("/api/v1/auth/otp/verify", async (req, res) => {
    configured(); const input = VerifyOtp.parse(req.body);
    const result = await tx(async c => {
      const account = (await c.query("SELECT a.* FROM accounts a JOIN otp_challenges o ON o.account_id=a.id WHERE o.id=$1 FOR UPDATE OF a", [input.challengeId])).rows[0];
      const row = (await c.query("SELECT *,expires_at>clock_timestamp() AS valid FROM otp_challenges WHERE id=$1 FOR UPDATE", [input.challengeId])).rows[0];
      if (!account || !account.active || account.role !== "student" || !row || !row.delivery_ref || row.consumed_at || !row.valid || row.failures >= 5 || row.session_binding !== input.challengeSessionId || row.purpose !== input.purpose) return null;
      const mapping = (await c.query("SELECT branch_id FROM learner_identities WHERE account_id=$1", [account.id])).rows[0];
      if (!mapping || !account.branch_ids.includes(mapping.branch_id)) return null;
      if (!timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(otpHash(auth.secret, input.challengeId, input.code), "hex"))) {
        await c.query("UPDATE otp_challenges SET failures=failures+1 WHERE id=$1", [input.challengeId]);
        await audit(c, account.id, "otp.rejected", input.challengeId); return null;
      }
      await c.query("UPDATE otp_challenges SET consumed_at=clock_timestamp() WHERE id=$1", [input.challengeId]);
      const tokens = await issue(c, account); await audit(c, account.id, "otp.consumed", input.challengeId); return tokens;
    });
    if (!result) throw invalid(); res.json({ data: result });
  });
  app.get("/internal/iam/otp/:id", async (req, res) => {
    const cfg = configured(), supplied = req.get("x-iam-notification-secret") ?? "";
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(cfg.notificationSecret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(cfg.notificationSecret))) throw denied();
    const row = (await pool.query(`SELECT o.id,o.account_id,l.learner_id,l.branch_id,a.email,o.expires_at,
      o.expires_at>clock_timestamp() AND o.consumed_at IS NULL AND o.failures<5 AND a.active AND a.role='student' AND l.branch_id=ANY(a.branch_ids) AS valid
      FROM otp_challenges o JOIN accounts a ON a.id=o.account_id JOIN learner_identities l ON l.account_id=a.id WHERE o.id=$1`, [z.uuid().parse(req.params.id)])).rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "Verification not found");
    res.json({ data: { challengeId: row.id, accountId: row.account_id, learnerId: row.learner_id, branchId: row.branch_id, email: row.email, valid: row.valid, expiresAt: row.expires_at } });
  });
  app.get("/internal/iam/notification-recipients/:id", async (req, res) => {
    const cfg = configured(), token = bearer(req.get("authorization")), id = z.uuid().parse(req.params.id);
    const user = await verifyCommand(auth, token, "notification", "notification:deliver"), d = user.delegation;
    if (d?.workflowId !== "WF-10" || d.entity?.type !== "notification" || d.entity.id !== id || d.inputRef !== id) throw denied();
    let response: Response;
    try { response = await fetch(`${cfg.notificationUrl}/internal/notification/intents/${id}/authority`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: "error" }); }
    catch { throw new HttpError(503, "NOTIFICATION_UNAVAILABLE", "Recipient scope unavailable"); }
    if (!response.ok) throw denied();
    const source = z.object({ learnerId: z.uuid(), branchId: z.uuid() }).parse((await response.json() as { data: unknown }).data);
    if (source.branchId !== d.branchId) throw denied();
    const row = (await pool.query("SELECT l.*,a.email FROM learner_identities l JOIN accounts a ON a.id=l.account_id WHERE l.learner_id=$1 AND l.branch_id=$2 AND a.active=true AND a.role='student' AND l.branch_id=ANY(a.branch_ids)", [source.learnerId, source.branchId])).rows[0];
    if (!row) throw denied();
    res.json({ data: { accountId: row.account_id, learnerId: row.learner_id, branchId: row.branch_id, email: row.email } });
  });
}
