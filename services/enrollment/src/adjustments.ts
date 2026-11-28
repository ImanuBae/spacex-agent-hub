import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { authenticate, allowRoles, principal, bearer, checkBranch, iamRequest, verifyCommand, type AuthConfig, type Principal } from "@spacex/auth";
import { LearnerMemberships, MachineClaims } from "@spacex/contracts";
import { HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";
import type { EnrollmentConfig } from "./app.js";

// PostgreSQL JSON projections are validated at their source boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const policy = "DEMO-N8N06-2026-11-16-v1";
const conflict = (code: string) => new HttpError(409, code, "Reload the durable adjustment and its decision history");
const denied = () => new HttpError(403, "FORBIDDEN", "Adjustment authority does not match");
const uuid = z.uuid();
const versionInput = z.object({ version: z.number().int().positive() }).strict();
const createInput = z.object({ enrollmentId: uuid, type: z.enum(["REFUND", "TRANSFER", "SUSPEND", "RESUME"]), version: z.number().int().positive(), reason: z.string().trim().min(10).max(1000), targetClassId: uuid.optional(), packageId: uuid.optional(), amount: z.number().int().positive().max(1_000_000_000).optional(), refundMode: z.enum(["EXCESS", "CANCEL"]).optional(), classChangeId: uuid.optional() }).strict();
const Quote = z.object({ packageId: uuid, courseId: uuid, priceVnd: z.number().int().positive(), sessionCount: z.number().int().positive(), packageVersion: z.number().int().positive(), courseVersion: z.number().int().positive(), packagePolicy: z.string(), coursePolicy: z.string(), effectiveAt: z.iso.datetime(), currency: z.literal("VND") });
const moveKinds = ["TRANSFER", "RESUME", "WAITLIST"];
export function adjustmentSeatPermissions(state: string, kind: string, authorized: boolean) {
  return { holdAuthorized: authorized && moveKinds.includes(kind) && state === "PREPARED", commitAuthorized: authorized && moveKinds.includes(kind) && state === "COMMITTING", releaseTargetAuthorized: ["FAILED", "REVOKED", "EXPIRED"].includes(state), releaseSourceAuthorized: ["APPLIED", "EXECUTED"].includes(state) };
}

export function registerAdjustments(app: Express, pool: Pool, auth: AuthConfig, config: EnrollmentConfig) {
  async function tx<T>(work: (c: PoolClient) => Promise<T>) { const c = await pool.connect(); try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const result = await work(c); await c.query("COMMIT"); return result; } catch (error) { await c.query("ROLLBACK"); if ((error as { code?: string }).code === "23505") throw conflict("ACTIVE_ADJUSTMENT_CONFLICT"); throw error; } finally { c.release(); } }
  async function api(base: string, path: string, token: string): Promise<Row> { let r: Response; try { r = await fetch(base + path, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000), redirect: "error" }); } catch { throw new HttpError(503, "SOURCE_UNAVAILABLE", "Adjustment source unavailable"); } if (!r.ok) throw new HttpError([401, 403, 404, 409].includes(r.status) ? r.status : 503, "SOURCE_DENIED", "Adjustment source denied"); return (await r.json() as { data: Row }).data; }
  async function live(token: string) { await iamRequest(auth.identityUrl, "/api/v1/auth/introspect", token, {}); }
  async function learner(token: string) { return LearnerMemberships.parse(await api(auth.identityUrl, "/api/v1/auth/learner", token)); }
  const owns = (identity: Awaited<ReturnType<typeof learner>>, row: Row) => identity.memberships.some(p => p.learnerId === row.learner_id && p.branchId === row.branch_id);
  const memberRows = 'JOIN jsonb_to_recordset($1::jsonb) AS l("learnerId" uuid,"branchId" uuid) ON r.learner_id=l."learnerId" AND r.branch_id=l."branchId"';
  async function effective(c: Pool | PoolClient, id: string, lock = false) {
    const e = (await c.query(`SELECT *,clock_timestamp() AS now FROM enrollments WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0];
    if (!e) throw new HttpError(404, "NOT_FOUND", "Enrollment not found");
    const t = (await c.query("SELECT * FROM enrollment_entitlements WHERE enrollment_id=$1", [id])).rows[0];
    return { enrollment: e, entitlement: t ?? { enrollment_id: id, learner_id: e.learner_id, branch_id: e.branch_id, class_id: e.class_id, seat_id: id, hold_id: e.hold_id, package_id: e.snapshot.packageId, state: e.status === "CONFIRMED" ? "ACTIVE" : e.status, amount: e.snapshot.amountDue, remaining_sessions: e.snapshot.quote.sessionCount, version: e.version, expires_at: null } };
  }
  async function get(c: Pool | PoolClient, id: string, lock = false) { const r = (await c.query(`SELECT *,clock_timestamp() AS now FROM enrollment_adjustments WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0]; if (!r) throw new HttpError(404, "NOT_FOUND", "Adjustment not found"); return r; }
  function view(r: Row) { return { id: r.id, enrollmentId: r.enrollment_id, branchId: r.branch_id, learnerId: r.learner_id, type: r.kind, status: r.state, state: r.state, version: r.version, sourceVersion: r.source_version, source: r.source, target: r.target, targetSeatId: r.target_seat_id, amountDelta: Number(r.amount_delta), refundMode: r.refund_mode, policyVersion: r.policy_version, deadlineAt: r.deadline_at, reason: r.reason, approved: !!r.approved_by, customerChoice: !!r.choice_at, remainingSessions: r.remaining_sessions, errorCode: r.error_code, classChangeId: r.class_change_id, sourceReleased: !!r.source_released_at }; }
  async function history(c: PoolClient, r: Row, actor: string, action: string) { const id = randomUUID(); await c.query("INSERT INTO adjustment_history(id,adjustment_id,version,action,actor_id) VALUES($1,$2,$3,$4,$5)", [id, r.id, r.version, action, actor]); await c.query("INSERT INTO enrollment_audit(id,target_id,actor_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)", [id, r.id, actor, action, r.correlation_id]); await enqueueEvent(c, { id, type: "enrollment.adjustment_changed", version: 1, occurredAt: new Date().toISOString(), correlationId: r.correlation_id, entityId: r.id, entityVersion: r.version, payload: { adjustmentId: r.id, enrollmentId: r.enrollment_id, state: r.state, sourceVersion: r.version } }); }
  async function bound(token: string, id: string, audience: "enrollment" | "payment" | "class-schedule" = "enrollment") {
    const scope = { enrollment: "enrollment:adjust", payment: "payment:refund", "class-schedule": "classes:adjust" } as const;
    const operation = { enrollment: "enrollment.adjust", payment: "payment.refund", "class-schedule": "classes.adjust" } as const;
    const u = await verifyCommand(auth, token, audience, scope[audience]), d = u.delegation;
    if (d?.workflowId !== "WF-09" || d.operation !== operation[audience] || d.entity?.type !== "adjustment" || d.entity.id !== id || d.inputRef !== id) throw denied();
    return u;
  }
  async function decisions(r: Row, token: string, u: Principal, requireChoice = true) {
    checkBranch(u, r.branch_id);
    if (!r.approved_by || r.approved_by === r.actor_id || (requireChoice && (!r.choice_by || r.choice_version !== r.source_version))) throw conflict("DECISION_REQUIRED");
    await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: r.approved_by, sessionId: r.approved_session, branchId: r.branch_id, role: "director" });
    if (r.kind === "REFUND") await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: r.actor_id, sessionId: r.actor_session, branchId: r.branch_id, role: "accountant" });
    if (requireChoice) { const p = await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: r.choice_by, sessionId: r.choice_session, branchId: r.branch_id, role: "student", learnerId: r.learner_id }) as Row; if (p.learnerId !== r.learner_id) throw denied(); }
  }
  async function emit(c: PoolClient, r: Row) {
    const eventId = randomUUID(), entity = { type: "adjustment", id: r.id, version: r.version };
    const { accessToken } = await iamRequest(auth.identityUrl, "/internal/iam/machine/token", "", { clientId: config.sourceClientId, clientSecret: config.sourceClientSecret, audience: "enrollment", scopes: ["automation:source"], workflows: ["WF-09"], ttlSeconds: 60 }) as { accessToken: string };
    const { contextRef } = await iamRequest(auth.identityUrl, "/internal/iam/service-delegations", accessToken, { audience: "enrollment", input: { eventId, workflowId: "WF-09", workflowVersion: 1, branchId: r.branch_id, entity, inputRef: r.id, operations: ["enrollment.adjust", "classes.adjust", "payment.refund"] } }) as { contextRef: string };
    await c.query("UPDATE enrollment_adjustments SET context_id=$2,event_id=$3 WHERE id=$1", [r.id, contextRef, eventId]);
    await enqueueEvent(c, { id: eventId, type: "adjustment.ready", version: 1, occurredAt: new Date().toISOString(), correlationId: r.correlation_id, entityId: r.id, entityVersion: r.version, payload: { entity, inputRef: r.id, contextRef } });
  }
  async function signalClass(c: PoolClient, id: string, correlationId: string, enrollmentId: string) {
    await enqueueEvent(c, { id: randomUUID(), type: "enrollment.class_change_resolution", version: 1, occurredAt: new Date().toISOString(), correlationId, entityId: id, payload: { enrollmentId } });
  }
  async function targetQuote(classId: string, packageId: string, branchId: string, token: string) {
    const [cls, quote] = await Promise.all([api(config.classUrl, `/api/v1/classes/${classId}`, token), api(config.catalogUrl, `/api/v1/packages/${packageId}/quote`, token)]);
    if (cls.branchId !== branchId || cls.status !== "OPEN" || cls.packageId !== packageId || cls.courseId !== quote.courseId || cls.sessions.length !== quote.sessionCount) throw conflict("INVALID_TARGET");
    const current = Quote.parse(quote);
    return { classId: cls.id, classVersion: cls.version, packageId, quote: current, amount: current.priceVnd, available: cls.available };
  }
  async function recheckQuote(r: Row, token: string) {
    if (!r.target) return;
    let current: Row;
    try { current = await api(config.catalogUrl, `/internal/catalog/adjustments/${r.id}/quote`, token); }
    catch (error) { if (error instanceof HttpError && error.status === 409) throw conflict("QUOTE_CHANGED"); throw error; }
    if (JSON.stringify(Quote.parse(current)) !== JSON.stringify(Quote.parse(r.target.quote))) throw conflict("QUOTE_CHANGED");
  }
  async function create(c: PoolClient, input: z.infer<typeof createInput>, u: Principal, token: string, key: string) {
    const { enrollment: e, entitlement: t } = await effective(c, input.enrollmentId, true); checkBranch(u, e.branch_id);
    const old = (await c.query("SELECT *,payload=$3::jsonb AS identical FROM enrollment_adjustments WHERE actor_id=$1 AND operation_key=$2", [u.sub, key, input])).rows[0]; if (old) { if (!old.identical || old.actor_session !== u.sid) throw conflict("IDEMPOTENCY_MISMATCH"); return old; }
    if (t.version !== input.version) throw conflict("STALE_ENTITLEMENT");
    if (input.type === "REFUND" && u.role !== "accountant") throw denied();
    if (input.type === "RESUME" ? t.state !== "SUSPENDED" || !t.expires_at || t.expires_at <= e.now : input.type !== "REFUND" && t.state !== "ACTIVE") throw conflict("INVALID_ENTITLEMENT");
    if (input.type === "REFUND" && (!input.amount || !input.refundMode)) throw conflict("REFUND_AMOUNT_REQUIRED");
    if (input.type !== "REFUND" && (input.amount || input.refundMode) || !moveKinds.includes(input.type) && (input.targetClassId || input.packageId)) throw conflict("ADJUSTMENT_FIELDS_MISMATCH");
    if (input.type === "REFUND" && (!e.payment_id || !["ACTIVE", "REFUND_PENDING", "CANCELLED", "EXPIRED"].includes(t.state))) throw conflict("REFUND_NOT_ELIGIBLE");
    let target: Row | null = null, delta = input.type === "REFUND" ? -input.amount! : 0, classChange: Row | undefined;
    let remainingSessions = Number(t.remaining_sessions);
    if (input.type === "SUSPEND") {
      const source = await api(config.classUrl, `/api/v1/classes/${t.class_id}`, token);
      if (source.branchId !== e.branch_id) throw denied();
      remainingSessions = source.sessions.filter((s: Row) => new Date(s.endsAt) > new Date(source.serverTime)).length;
      if (remainingSessions <= 0) throw conflict("NO_REMAINING_ENTITLEMENT");
    }
    if (input.classChangeId) {
      classChange = await api(config.classUrl, `/api/v1/class-changes/${input.classChangeId}`, token);
      if (classChange.classId !== t.class_id || classChange.branchId !== e.branch_id || classChange.kind !== "CANCEL" || !["REQUESTED", "APPROVED"].includes(classChange.status) || !(input.type === "TRANSFER" || input.type === "SUSPEND" || input.type === "REFUND" && input.refundMode === "CANCEL")) throw conflict("CLASS_CHANGE_MISMATCH");
    }
    if (["TRANSFER", "RESUME"].includes(input.type)) {
      if (!input.targetClassId || !input.packageId || input.targetClassId === t.class_id && input.type === "TRANSFER") throw conflict("TARGET_REQUIRED");
      target = await targetQuote(input.targetClassId, input.packageId, e.branch_id, token);
      delta = target.amount - Number(t.amount);
    }
    await live(token);
    const r = (await c.query("INSERT INTO enrollment_adjustments(id,enrollment_id,branch_id,learner_id,kind,source_version,source,target,policy_version,amount_delta,refund_mode,remaining_sessions,deadline_at,actor_id,actor_session,reason,operation_key,payload,target_seat_id,correlation_id,class_change_id,class_change_correlation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp()+interval '24 hours',$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *,clock_timestamp() AS now", [randomUUID(), e.id, e.branch_id, e.learner_id, input.type, t.version, t, target, policy, delta, input.refundMode ?? null, remainingSessions, u.sub, u.sid, input.reason, key, input, randomUUID(), e.correlation_id, input.classChangeId ?? null, classChange?.correlationId ?? null])).rows[0];
    await history(c, r, u.sub, "adjustment.requested"); return r;
  }
  const staff = [authenticate(auth), allowRoles("center_director", "branch_director", "admissions", "accountant")] as const;
  const schedulingStaff = [authenticate(auth), allowRoles("center_director", "branch_director", "admissions")] as const;
  const directors = [authenticate(auth), allowRoles("center_director", "branch_director")] as const;
  const student = [authenticate(auth), allowRoles("student")] as const;
  app.post("/api/v1/adjustments", ...staff, async (req, res) => { const input = createInput.parse(req.body), u = principal(res), token = bearer(req.get("authorization")), key = uuid.parse(req.get("idempotency-key")); res.status(201).json({ data: view(await tx(c => create(c, input, u, token, key))) }); });
  app.get("/api/v1/adjustments", ...staff, async (_req, res) => { const u = principal(res); res.json({ data: (await pool.query("SELECT * FROM enrollment_adjustments WHERE ($1 OR branch_id=ANY($2)) ORDER BY created_at DESC LIMIT 100", [u.role === "center_director", u.branchIds])).rows.map(view) }); });
  app.get("/api/v1/adjustments/:id", ...staff, async (req, res) => { const r = await get(pool, uuid.parse(req.params.id)); checkBranch(principal(res), r.branch_id); res.json({ data: { ...view(r), history: (await pool.query("SELECT version,action,actor_id AS \"actorId\",created_at AS \"createdAt\" FROM adjustment_history WHERE adjustment_id=$1 ORDER BY version", [r.id])).rows } }); });
  for (const action of ["approve", "revoke"] as const) app.post(`/api/v1/adjustments/:id/${action}`, ...staff, async (req, res) => {
    const input = versionInput.parse(req.body), token = bearer(req.get("authorization")), u = principal(res), id = uuid.parse(req.params.id);
    const r = await tx(async c => { let r = await get(c, id, true); checkBranch(u, r.branch_id); if (r.version !== input.version) throw conflict("STALE_ADJUSTMENT");
      if (action === "approve") { if (!["center_director", "branch_director"].includes(u.role) || r.actor_id === u.sub) throw denied(); if (r.state !== "REQUESTED" || r.deadline_at <= r.now) throw conflict("APPROVAL_EXPIRED"); r = (await c.query("UPDATE enrollment_adjustments SET state='APPROVED',approved_by=$2,approved_session=$3,version=version+1 WHERE id=$1 RETURNING *", [id, u.sub, u.sid])).rows[0]; }
      else { if (!["REQUESTED", "APPROVED"].includes(r.state)) throw conflict("RECOVERY_REQUIRED"); if (u.sub !== r.actor_id && !["center_director", "branch_director"].includes(u.role)) throw denied(); r = (await c.query("UPDATE enrollment_adjustments SET state='REVOKED',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0]; }
      await live(token); await history(c, r, u.sub, `adjustment.${action}`); if (r.choice_at && action === "approve") await emit(c, r); return r;
    }); res.json({ data: view(r) });
  });
  app.get("/api/v1/student/adjustments", ...student, async (req, res) => { const p = await learner(bearer(req.get("authorization"))); res.json({ data: (await pool.query(`SELECT r.* FROM enrollment_adjustments r ${memberRows} ORDER BY r.created_at DESC LIMIT 100`, [JSON.stringify(p.memberships)])).rows.map(view) }); });
  app.post("/api/v1/adjustments/:id/choice", ...student, async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), accepted: z.literal(true) }).strict().parse(req.body), token = bearer(req.get("authorization")), u = principal(res), p = await learner(token), id = uuid.parse(req.params.id);
    const r = await tx(async c => { let r = await get(c, id, true); if (!owns(p, r)) throw denied(); if (r.kind === "WAITLIST" || r.version !== input.version || r.choice_at || !["REQUESTED", "APPROVED"].includes(r.state) || r.deadline_at <= r.now) throw conflict("CHOICE_EXPIRED"); await live(token); r = (await c.query("UPDATE enrollment_adjustments SET choice_by=$2,choice_session=$3,choice_version=source_version,choice_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *", [id, u.sub, u.sid])).rows[0]; await history(c, r, u.sub, "adjustment.choice"); if (r.approved_by) await emit(c, r); return r; }); res.json({ data: view(r) });
  });
  function waitlistView(r: Row) {
    return { id: r.id, enrollmentId: r.enrollment_id, learnerId: r.learner_id, branchId: r.branch_id, classId: r.class_id, packageId: r.package_id,
      status: r.status === "INVITED" && r.expires_at <= r.now ? "EXPIRED" : r.status, version: r.version, expiresAt: r.expires_at, createdAt: r.created_at, adjustmentId: r.adjustment_id };
  }
  async function waitlistEntry(c: PoolClient, id: string) {
    const result = (await c.query("SELECT *,clock_timestamp() AS now FROM enrollment_waitlist WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!result) throw new HttpError(404, "NOT_FOUND", "Waitlist entry not found");
    return result;
  }
  async function waitlistAudit(c: PoolClient, r: Row, actor: string, action: string, correlationId: string) {
    const id = randomUUID();
    await c.query("INSERT INTO enrollment_audit(id,target_id,actor_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)", [id, r.id, actor, action, correlationId]);
    await enqueueEvent(c, { id, type: action, version: 1, occurredAt: new Date().toISOString(), correlationId, entityId: r.id, entityVersion: r.version, payload: { enrollmentId: r.enrollment_id, adjustmentId: r.adjustment_id } });
  }
  async function waitlistConsent(learnerId: string, branchId: string, token: string) {
    const crm = await api(config.crmUrl, `/api/v1/crm/people/${learnerId}`, token);
    if (crm.person?.kind !== "LEARNER" || crm.person?.branchId !== branchId || crm.person?.status !== "ACTIVE" || crm.person?.mergedInto || !crm.consents?.some((r: Row) => r.purpose === "COURSE_NOTICES" && r.status === "GRANTED")) throw conflict("CONSENT_REQUIRED");
  }
  app.get("/api/v1/waitlist", ...schedulingStaff, async (_req, res) => {
    const u = principal(res), rows = (await pool.query("SELECT *,clock_timestamp() AS now FROM enrollment_waitlist WHERE ($1 OR branch_id=ANY($2)) ORDER BY created_at,id LIMIT 100", [u.role === "center_director", u.branchIds])).rows;
    res.json({ data: rows.map(waitlistView) });
  });
  app.get("/api/v1/student/waitlist", ...student, async (req, res) => {
    const p = await learner(bearer(req.get("authorization"))), rows = (await pool.query(`SELECT r.*,clock_timestamp() AS now FROM enrollment_waitlist r ${memberRows} ORDER BY r.created_at DESC,r.id LIMIT 100`, [JSON.stringify(p.memberships)])).rows;
    res.set("cache-control", "no-store").json({ data: rows.map(waitlistView) });
  });
  app.post("/api/v1/waitlist", ...schedulingStaff, async (req, res) => {
    const input = z.object({ enrollmentId: uuid, classId: uuid, packageId: uuid, consent: z.literal(true) }).strict().parse(req.body), token = bearer(req.get("authorization")), u = principal(res);
    const r = await tx(async c => {
      const { enrollment: e, entitlement: t } = await effective(c, input.enrollmentId, true); checkBranch(u, e.branch_id);
      if (!e.payment_id || !["ACTIVE", "SUSPENDED"].includes(t.state) || t.state === "ACTIVE" && t.class_id === input.classId || t.state === "SUSPENDED" && t.expires_at <= e.now) throw conflict("WAITLIST_NOT_ELIGIBLE");
      await targetQuote(input.classId, input.packageId, e.branch_id, token);
      await waitlistConsent(e.learner_id, e.branch_id, token);
      await live(token);
      const prior = (await c.query("SELECT *,clock_timestamp() AS now FROM enrollment_waitlist WHERE learner_id=$1 AND class_id=$2 AND status IN ('WAITING','INVITED')", [e.learner_id, input.classId])).rows[0];
      if (prior) { if (prior.enrollment_id !== e.id || prior.package_id !== input.packageId) throw conflict("WAITLIST_ALREADY_EXISTS"); return prior; }
      const entry = (await c.query("INSERT INTO enrollment_waitlist(id,learner_id,branch_id,class_id,package_id,enrollment_id,actor_id,actor_session,consent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *,clock_timestamp() AS now", [randomUUID(), e.learner_id, e.branch_id, input.classId, input.packageId, e.id, u.sub, u.sid])).rows[0];
      await waitlistAudit(c, entry, u.sub, "enrollment.waitlist_requested", e.correlation_id);
      return entry;
    });
    res.status(201).json({ data: waitlistView(r) });
  });
  app.post("/api/v1/waitlist/:id/invite", ...directors, async (req, res) => {
    const id = uuid.parse(req.params.id), input = versionInput.parse(req.body), token = bearer(req.get("authorization")), u = principal(res);
    const r = await tx(async c => {
      const entry = await waitlistEntry(c, id); checkBranch(u, entry.branch_id);
      if (entry.actor_id === u.sub) throw denied();
      if (entry.version !== input.version || entry.status !== "WAITING") throw conflict("STALE_INVITATION");
      const { enrollment: e, entitlement: t } = await effective(c, entry.enrollment_id, true);
      if (!e.payment_id || !["ACTIVE", "SUSPENDED"].includes(t.state) || t.state === "ACTIVE" && t.class_id === entry.class_id || t.state === "SUSPENDED" && t.expires_at <= e.now) throw conflict("WAITLIST_NOT_ELIGIBLE");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4008))", [`waitlist:${entry.class_id}`]);
      const oldest = (await c.query("SELECT id FROM enrollment_waitlist WHERE class_id=$1 AND status='WAITING' ORDER BY created_at,id LIMIT 1", [entry.class_id])).rows[0];
      if (oldest?.id !== entry.id) throw conflict("WAITLIST_PRIORITY");
      await waitlistConsent(entry.learner_id, entry.branch_id, token);
      const target = await targetQuote(entry.class_id, entry.package_id, entry.branch_id, token);
      if (target.available < 1) throw conflict("TARGET_SOLD_OUT");
      await live(token);
      const adjustment = (await c.query(`INSERT INTO enrollment_adjustments(id,enrollment_id,branch_id,learner_id,kind,state,source_version,source,target,policy_version,amount_delta,remaining_sessions,deadline_at,actor_id,actor_session,reason,operation_key,payload,approved_by,approved_session,target_seat_id,correlation_id)
        VALUES($1,$2,$3,$4,'WAITLIST','APPROVED',$5,$6,$7,$8,$9,$10,clock_timestamp()+interval '24 hours',$11,$12,'Invited from eligible waitlist',$13,$14,$15,$16,$17,$18) RETURNING *`, [randomUUID(), e.id, e.branch_id, e.learner_id, t.version, t, target, policy, target.amount - Number(t.amount), t.remaining_sessions, entry.actor_id, entry.actor_session, randomUUID(), { waitlistId: id }, u.sub, u.sid, randomUUID(), e.correlation_id])).rows[0];
      await history(c, adjustment, u.sub, "adjustment.waitlist_invited");
      const next = (await c.query("UPDATE enrollment_waitlist SET status='INVITED',invited_at=clock_timestamp(),expires_at=$2,adjustment_id=$3,version=version+1 WHERE id=$1 RETURNING *,clock_timestamp() AS now", [id, adjustment.deadline_at, adjustment.id])).rows[0];
      await waitlistAudit(c, next, u.sub, "enrollment.waitlist_invited", e.correlation_id);
      return next;
    });
    res.json({ data: waitlistView(r) });
  });
  for (const action of ["accept", "decline", "revoke"] as const) {
    app.post(`/api/v1/waitlist/:id/${action}`, ...(action === "revoke" ? directors : student), async (req, res) => {
      const id = uuid.parse(req.params.id), input = versionInput.parse(req.body), token = bearer(req.get("authorization")), u = principal(res);
      const r = await tx(async c => {
        const entry = await waitlistEntry(c, id); checkBranch(u, entry.branch_id);
        if (action !== "revoke") { const p = await learner(token); if (!owns(p, entry)) throw denied(); }
        if (action === "revoke" && entry.status === "WAITING" && entry.version === input.version) {
          const { enrollment } = await effective(c, entry.enrollment_id, true);
          await live(token);
          const next = (await c.query("UPDATE enrollment_waitlist SET status='REVOKED',version=version+1 WHERE id=$1 RETURNING *,clock_timestamp() AS now", [id])).rows[0];
          await waitlistAudit(c, next, u.sub, "enrollment.waitlist_revoked", enrollment.correlation_id);
          return next;
        }
        if (entry.version !== input.version || entry.status !== "INVITED" || entry.expires_at <= entry.now || !entry.adjustment_id) throw conflict("INVITATION_UNAVAILABLE");
        const a = await get(c, entry.adjustment_id, true);
        if (a.state !== "APPROVED" || a.choice_at || a.deadline_at <= a.now) throw conflict("INVITATION_UNAVAILABLE");
        const { entitlement } = await effective(c, entry.enrollment_id, true);
        if (action === "accept" && (entitlement.version !== a.source_version || entitlement.state === "SUSPENDED" && entitlement.expires_at <= a.now)) throw conflict("STALE_ENTITLEMENT");
        await live(token);
        if (action === "accept") {
          const choice = (await c.query("UPDATE enrollment_adjustments SET choice_by=$2,choice_session=$3,choice_version=source_version,choice_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *", [a.id, u.sub, u.sid])).rows[0];
          await history(c, choice, u.sub, "adjustment.choice");
          await emit(c, choice);
        } else {
          const revoked = (await c.query("UPDATE enrollment_adjustments SET state='REVOKED',version=version+1 WHERE id=$1 RETURNING *", [a.id])).rows[0];
          await history(c, revoked, u.sub, "adjustment.revoke");
        }
        const status = action === "accept" ? "ACCEPTED" : action === "decline" ? "DECLINED" : "REVOKED";
        const next = (await c.query("UPDATE enrollment_waitlist SET status=$2,version=version+1 WHERE id=$1 RETURNING *,clock_timestamp() AS now", [id, status])).rows[0];
        await waitlistAudit(c, next, u.sub, `enrollment.waitlist_${status.toLowerCase()}`, a.correlation_id);
        return next;
      });
      res.json({ data: waitlistView(r) });
    });
  }
  async function studentEnrollment(id: string, token: string, p?: Awaited<ReturnType<typeof learner>>) {
    const identity = p ?? await learner(token), { enrollment: e, entitlement: t } = await effective(pool, id);
    if (!owns(identity, e)) throw denied();
    const { classId, packageId, amountDue, currency, termsVersion, terms } = e.snapshot;
    const courseId = e.snapshot.quote.courseId;
    return { id: e.id, status: e.status, version: e.version, branchId: e.branch_id, learnerId: e.learner_id, paymentRequestId: e.payment_id, createdAt: e.created_at, holdExpiresAt: e.expires_at, snapshot: { courseId, classId, packageId, amountDue, currency, termsVersion, terms, packageName: e.snapshot.packageName, className: e.snapshot.className }, currentEntitlement: { classId: t.class_id, seatId: t.seat_id, holdId: t.hold_id, packageId: t.package_id, state: t.state === "SUSPENDED" && t.expires_at <= e.now ? "EXPIRED" : t.state, amount: Number(t.amount), remainingSessions: t.remaining_sessions, version: t.version, expiresAt: t.expires_at } };
  }
  app.get("/api/v1/student/enrollments", ...student, async (req, res) => { const token = bearer(req.get("authorization")), p = await learner(token), rows = (await pool.query(`SELECT r.id FROM enrollments r ${memberRows} ORDER BY r.created_at DESC LIMIT 100`, [JSON.stringify(p.memberships)])).rows; res.set("cache-control", "no-store").json({ data: await Promise.all(rows.map(r => studentEnrollment(r.id, token, p))) }); });
  app.get("/api/v1/student/enrollments/:id", ...student, async (req, res) => { res.json({ data: await studentEnrollment(uuid.parse(req.params.id), bearer(req.get("authorization"))) }); });
  app.get("/api/v1/enrollments/:id/entitlement", ...staff, async (req, res) => {
    const u = principal(res), { enrollment: e, entitlement: t } = await effective(pool, uuid.parse(req.params.id));
    checkBranch(u, e.branch_id); if (u.role === "admissions" && e.actor_id !== u.sub) throw denied();
    res.json({ data: { id: e.id, branchId: e.branch_id, learnerId: e.learner_id, sourceVersion: e.version, state: t.state === "SUSPENDED" && t.expires_at <= e.now ? "EXPIRED" : t.state, classId: t.class_id, seatId: t.seat_id, holdId: t.hold_id, version: t.version } });
  });
  app.get("/internal/enrollment/adjustments/:id", async (req, res) => { const id = uuid.parse(req.params.id), u = await bound(bearer(req.get("authorization")), id), r = await get(pool, id); checkBranch(u, r.branch_id); res.json({ data: view(r) }); });
  for (const kind of ["seat-authority", "payment-authority", "authority"] as const) app.get(`/internal/enrollment/adjustments/:id/${kind}`, async (req, res) => {
    const id = uuid.parse(req.params.id), token = bearer(req.get("authorization")), u = await bound(token, id, kind === "seat-authority" ? "class-schedule" : kind === "payment-authority" ? "payment" : "enrollment"), r = await get(pool, id); checkBranch(u, r.branch_id);
    let authorized = false;
    if (kind !== "authority" && ["APPROVED", "PREPARED", "COMMITTING"].includes(r.state) && r.deadline_at > r.now) { await decisions(r, token, u); authorized = true; }
    if (["TARGET_COMMITTED", "APPLIED", "EXECUTED"].includes(r.state)) authorized = true;
    const permissions = adjustmentSeatPermissions(r.state, r.kind, authorized);
    const releaseSourceAuthorized = permissions.releaseSourceAuthorized && !(r.kind === "REFUND" && r.refund_mode === "EXCESS");
    res.json({ data: { ...view(r), ...permissions, sourceEnrollmentId: r.enrollment_id, sourceSeatId: r.source.seat_id, sourceClassId: r.source.class_id, sourceHoldId: r.source.hold_id, targetClassId: r.target?.classId, targetPackageId: r.target?.packageId, targetClassVersion: r.target?.classVersion, quote: r.target?.quote, releaseSourceAuthorized, authorized,
      ...(kind === "payment-authority" ? { correlationId: r.correlation_id, eventId: r.event_id, approvedBy: r.approved_by, approvedSession: r.approved_session, actorId: r.actor_id, actorSession: r.actor_session } : {}) } });
  });
  app.post("/internal/enrollment/adjustments/:id/:action", async (req, res) => {
    z.object({}).strict().parse(req.body); const id = uuid.parse(req.params.id), action = z.enum(["prepare", "begin-target-commit", "target-committed", "apply", "source-released", "complete", "fail"]).parse(req.params.action), token = bearer(req.get("authorization"));
    const r = await tx(async c => {
      const u = await bound(token, id); let r = await get(c, id, true); checkBranch(u, r.branch_id);
      const key = `adjustment:${id}:${action}`, prior = (await c.query("SELECT result FROM adjustment_operations WHERE key=$1", [key])).rows[0]; if (prior) return prior.result;
      const final = ["EXECUTED", "FAILED", "REVOKED", "EXPIRED"].includes(r.state);
      if (!final && (action === "prepare" || action === "begin-target-commit" || action === "apply" && !moveKinds.includes(r.kind))) await decisions(r, token, u);
      const { entitlement: current } = await effective(c, r.enrollment_id, true);
      const seats = action === "prepare" && !r.class_change_id ? null : await api(config.classUrl, `/internal/classes/adjustments/${id}/enrollment-authority`, token);
      if (r.class_change_id && (action === "prepare" || action === "begin-target-commit" || action === "apply" && !moveKinds.includes(r.kind)) && seats?.classChangeValid !== true) throw conflict("CLASS_CHANGE_NOT_CURRENT");
      if (action === "prepare") {
        if (final) return view(r);
        if (r.state !== "APPROVED") throw conflict("APPROVAL_REQUIRED");
        if (r.deadline_at <= r.now || current.version !== r.source_version) throw conflict("STALE_ENTITLEMENT");
        if (r.kind === "RESUME" && current.state !== "SUSPENDED" || current.state === "SUSPENDED" && current.expires_at <= r.now) throw conflict("SUSPENSION_EXPIRED");
        await recheckQuote(r, token);
        if (r.kind === "WAITLIST" && !(await api(config.crmUrl, `/internal/crm/adjustments/${id}/waitlist-consent`, token)).allowed) throw conflict("CONSENT_REQUIRED");
        r = (await c.query("UPDATE enrollment_adjustments SET state='PREPARED',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0];
      } else if (action === "begin-target-commit") {
        if (!moveKinds.includes(r.kind) || r.state !== "PREPARED" || r.deadline_at <= r.now || seats?.targetHold?.status !== "HELD" || current.version !== r.source_version) throw conflict("TARGET_HOLD_REQUIRED");
        if (current.state === "SUSPENDED" && current.expires_at <= r.now) throw conflict("SUSPENSION_EXPIRED");
        await recheckQuote(r, token);
        if (r.kind === "WAITLIST" && !(await api(config.crmUrl, `/internal/crm/adjustments/${id}/waitlist-consent`, token)).allowed) throw conflict("CONSENT_REQUIRED");
        const p = await api(config.paymentUrl, `/internal/payment/adjustments/${id}/enrollment-authority`, token);
        if (!p?.settled && !p?.reserved) throw conflict("DELTA_NOT_SECURED");
        r = (await c.query("UPDATE enrollment_adjustments SET state='COMMITTING',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0];
      } else if (action === "target-committed") {
        if (!moveKinds.includes(r.kind) || r.state !== "COMMITTING" || seats?.targetHold?.status !== "COMMITTED" || seats.targetHold.enrollmentId !== r.target_seat_id) throw conflict("TARGET_COMMIT_REQUIRED");
        r = (await c.query("UPDATE enrollment_adjustments SET state='TARGET_COMMITTED',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0];
      } else if (action === "apply") {
        if (final) return view(r);
        if (["TRANSFER", "RESUME", "WAITLIST"].includes(r.kind) ? r.state !== "TARGET_COMMITTED" || seats?.targetHold?.status !== "COMMITTED" : r.state !== "PREPARED") throw conflict("APPLY_NOT_READY");
        if (current.version !== r.source_version) throw conflict("STALE_ENTITLEMENT");
        const transferred = !!r.target, excess = r.kind === "REFUND" && r.refund_mode === "EXCESS";
        if (r.kind === "SUSPEND" && seats?.remainingSessions !== r.remaining_sessions) throw conflict("REMAINING_ENTITLEMENT_CHANGED");
        if (transferred || r.kind === "REFUND") {
          const p = await api(config.paymentUrl, `/internal/payment/adjustments/${id}/enrollment-authority`, token);
          if (!p?.settled && !p?.reserved) throw conflict("DELTA_NOT_SECURED");
        }
        if (!excess) {
          const classId = transferred ? r.target.classId : current.class_id, state = transferred ? "ACTIVE" : r.kind === "SUSPEND" ? "SUSPENDED" : "CANCELLED", sourceVersion = current.version + 1;
          await c.query("INSERT INTO enrollment_entitlements(enrollment_id,learner_id,branch_id,class_id,seat_id,hold_id,package_id,state,amount,remaining_sessions,version,expires_at,adjustment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $8='SUSPENDED' THEN clock_timestamp()+interval '90 days' ELSE NULL END,$12) ON CONFLICT(enrollment_id) DO UPDATE SET class_id=EXCLUDED.class_id,seat_id=EXCLUDED.seat_id,hold_id=EXCLUDED.hold_id,package_id=EXCLUDED.package_id,state=EXCLUDED.state,amount=EXCLUDED.amount,remaining_sessions=EXCLUDED.remaining_sessions,version=EXCLUDED.version,expires_at=EXCLUDED.expires_at,adjustment_id=EXCLUDED.adjustment_id,updated_at=clock_timestamp()", [r.enrollment_id, r.learner_id, r.branch_id, classId, transferred ? r.target_seat_id : current.seat_id, transferred ? seats!.targetHold.id : current.hold_id, transferred ? r.target.packageId : current.package_id, state, transferred ? r.target.amount : current.amount, r.remaining_sessions, sourceVersion, id]);
          await enqueueEvent(c, { id: randomUUID(), type: "enrollment.entitlement_changed", version: 1, occurredAt: new Date().toISOString(), correlationId: r.correlation_id, causationId: r.event_id, entityId: r.enrollment_id, entityVersion: sourceVersion, payload: { enrollmentId: r.enrollment_id, learnerId: r.learner_id, branchId: r.branch_id, classId, sourceVersion, state } });
        }
        r = (await c.query("UPDATE enrollment_adjustments SET state='APPLIED',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0];
      } else if (action === "source-released") {
        if (final) return view(r);
        if (r.state !== "APPLIED" || r.kind === "REFUND" && r.refund_mode === "EXCESS" || ["HELD", "COMMITTED"].includes(seats?.sourceHold?.status)) throw conflict("SOURCE_RELEASE_REQUIRED");
        r = (await c.query("UPDATE enrollment_adjustments SET source_released_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0];
        if (r.class_change_id && r.class_change_correlation) await signalClass(c, r.class_change_id, r.class_change_correlation, r.enrollment_id);
      } else if (action === "complete") {
        if (final) return view(r);
        if (r.state !== "APPLIED") throw conflict("APPLY_REQUIRED");
        if (!(r.kind === "REFUND" && r.refund_mode === "EXCESS") && (!r.source_released_at || ["HELD", "COMMITTED"].includes(seats?.sourceHold?.status))) throw conflict("SOURCE_RELEASE_REQUIRED");
        if (r.kind !== "SUSPEND") { const p = await api(config.paymentUrl, `/internal/payment/adjustments/${id}/enrollment-authority`, token); if (!p?.settled) throw conflict("PAYMENT_EXECUTION_REQUIRED"); }
        r = (await c.query("UPDATE enrollment_adjustments SET state='EXECUTED',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0];
      } else {
        if (seats?.targetHold?.status === "COMMITTED" || ["TARGET_COMMITTED", "APPLIED", "EXECUTED"].includes(r.state)) throw conflict("FORWARD_RECOVERY_REQUIRED");
        if (!final) r = (await c.query("UPDATE enrollment_adjustments SET state='FAILED',error_code='TARGET_UNAVAILABLE',version=version+1 WHERE id=$1 RETURNING *", [id])).rows[0]; else return view(r);
      }
      await bound(token, id);
      await history(c, r, u.sub, `adjustment.${action}`); const result = view(r); await c.query("INSERT INTO adjustment_operations(key,adjustment_id,action,payload,result) VALUES($1,$2,$3,'{}',$4)", [key, id, action, result]); return result;
    }); res.json({ data: r });
  });
  app.post("/internal/enrollment/adjustment-deadlines", async (req, res) => {
    z.object({}).strict().parse(req.body);
    const token = bearer(req.get("authorization")), claims = MachineClaims.parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/introspect", token, { audience: "automation-bridge", scope: "automation:authorize" }));
    if (!claims.workflows.includes("WF-09")) throw denied();
    const data = await tx(async c => {
      const due = (await c.query("SELECT * FROM enrollment_waitlist WHERE status='INVITED' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED")).rows;
      for (const r of due) {
        const next = (await c.query("UPDATE enrollment_waitlist SET status='EXPIRED',version=version+1 WHERE id=$1 RETURNING *", [r.id])).rows[0];
        const a = await get(c, r.adjustment_id, true); await waitlistAudit(c, next, a.actor_id, "enrollment.waitlist_expired", a.correlation_id);
      }
      const expired = (await c.query("SELECT * FROM enrollment_adjustments WHERE state IN ('REQUESTED','APPROVED') AND deadline_at<=clock_timestamp() ORDER BY deadline_at LIMIT 50 FOR UPDATE SKIP LOCKED")).rows;
      for (const r of expired) {
        const next = (await c.query("UPDATE enrollment_adjustments SET state='EXPIRED',version=version+1 WHERE id=$1 RETURNING *", [r.id])).rows[0];
        await history(c, next, r.actor_id, "adjustment.expired");
      }
      const suspensions = (await c.query("SELECT t.enrollment_id,e.actor_id,e.correlation_id,t.version FROM enrollment_entitlements t JOIN enrollments e ON e.id=t.enrollment_id WHERE t.state='SUSPENDED' AND t.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM enrollment_adjustments a WHERE a.enrollment_id=t.enrollment_id AND a.state IN ('COMMITTING','TARGET_COMMITTED')) ORDER BY t.expires_at LIMIT 50 FOR UPDATE OF e,t SKIP LOCKED")).rows;
      for (const r of suspensions) {
        await c.query("UPDATE enrollment_entitlements SET state='EXPIRED',version=version+1,updated_at=clock_timestamp() WHERE enrollment_id=$1", [r.enrollment_id]);
        const id = randomUUID();
        await c.query("INSERT INTO enrollment_audit(id,target_id,actor_id,action,correlation_id) VALUES($1,$2,$3,'enrollment.suspension_expired',$4)", [id, r.enrollment_id, r.actor_id, r.correlation_id]);
        await enqueueEvent(c, { id, type: "enrollment.suspension_expired", version: 1, occurredAt: new Date().toISOString(), correlationId: r.correlation_id, entityId: r.enrollment_id, entityVersion: r.version + 1, payload: { enrollmentId: r.enrollment_id } });
      }
      return { invitations: due.length, adjustments: expired.length, suspensions: suspensions.length };
    });
    res.json({ data });
  });
  async function impacts(classId: string) { return (await pool.query("SELECT e.id,e.learner_id,e.branch_id,COALESCE(t.version,e.version) AS version,COALESCE(t.state,e.status) AS state,COALESCE(t.seat_id,e.id) AS seat_id,t.adjustment_id FROM enrollments e LEFT JOIN enrollment_entitlements t ON t.enrollment_id=e.id WHERE COALESCE(t.class_id,e.class_id)=$1 AND COALESCE(t.state,e.status) IN ('ACTIVE','PENDING_HOLD','HELD','CONFIRMING','CONFIRMED','PAYMENT_REVIEW') ORDER BY e.id", [classId])).rows; }
  app.get("/api/v1/enrollments/class-impact", authenticate(auth), allowRoles("center_director", "branch_director", "teacher"), async (req, res) => {
    const id = uuid.parse(req.query.classId), token = bearer(req.get("authorization")), u = principal(res);
    const cls = await api(config.classUrl, `/api/v1/classes/${id}`, token); checkBranch(u, cls.branchId);
    const rows = await impacts(id);
    res.json({ data: rows.map(r => ({ enrollmentId: r.id, version: r.version, state: r.state, seatId: r.seat_id })) });
  });
  app.post("/api/v1/student/class-changes/:id/choice", ...student, async (req, res) => {
    const id = uuid.parse(req.params.id), input = z.object({ enrollmentId: uuid, version: z.number().int().positive(), accepted: z.literal(true) }).strict().parse(req.body), token = bearer(req.get("authorization")), u = principal(res), e = await studentEnrollment(input.enrollmentId, token);
    const change = await api(config.classUrl, `/api/v1/student/class-changes/${id}?enrollmentId=${input.enrollmentId}`, token);
    if (change.version !== input.version || change.status !== "APPROVED" || change.classId !== e.currentEntitlement.classId || change.branchId !== e.branchId || !change.correlationId) throw conflict("STALE_CHANGE_PLAN");
    await tx(async c => { const current = await effective(c, e.id, true); if (current.entitlement.version !== e.currentEntitlement.version || new Date(change.deadlineAt) <= current.enrollment.now) throw conflict("STALE_ENTITLEMENT"); await live(token); const inserted = await c.query("INSERT INTO enrollment_schedule_choices(change_id,enrollment_id,change_version,source_version,actor_id,session_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [id, e.id, change.version, current.entitlement.version, u.sub, u.sid]); if (inserted.rowCount) await signalClass(c, id, change.correlationId, e.id); }); res.json({ data: { changeId: id, enrollmentId: e.id, accepted: true } });
  });
  app.get("/internal/enrollment/class-changes/:id/impact", async (req, res) => {
    const id = uuid.parse(req.params.id), token = bearer(req.get("authorization")), u = await verifyCommand(auth, token, "class-schedule", "classes:change"); if (u.delegation?.entity?.id !== id || u.delegation.workflowId !== "WF-08") throw denied();
    const change = await api(config.classUrl, `/internal/classes/changes/${id}/authority`, token); checkBranch(u, change.branchId); const rows = await impacts(change.classId), result = [];
    for (const r of rows) {
      const choice = (await pool.query("SELECT * FROM enrollment_schedule_choices WHERE change_id=$1 AND enrollment_id=$2 AND change_version=$3 AND source_version=$4", [id, r.id, change.version, r.version])).rows[0];
      let choiceValid = false;
      if (choice) {
        try { const p = await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: choice.actor_id, sessionId: choice.session_id, branchId: r.branch_id, role: "student", learnerId: r.learner_id }) as Row; choiceValid = p.learnerId === r.learner_id; }
        catch (error) { if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error; }
      }
      result.push({ enrollmentId: r.id, version: r.version, state: r.state, seatId: r.seat_id, resolutionRef: r.adjustment_id, choiceValid, resolved: false });
    }
    if (change.kind === "CANCEL") {
      const resolutions = (await pool.query("SELECT id,enrollment_id,source_version,source FROM enrollment_adjustments WHERE class_change_id=$1 AND branch_id=$2 AND source_released_at IS NOT NULL ORDER BY created_at", [id, change.branchId])).rows;
      for (const r of resolutions) {
        if (r.source.class_id === change.classId && !rows.some(live => live.id === r.enrollment_id)) result.push({ enrollmentId: r.enrollment_id, version: r.source_version, resolvedVersion: r.source_version, state: r.source.state, seatId: r.source.seat_id, resolutionRef: r.id, choiceValid: true, resolved: true });
      }
    }
    res.json({ data: result });
  });
  app.get("/internal/enrollment/notifications/:id", async (req, res) => {
    const id = uuid.parse(req.params.id), token = bearer(req.get("authorization")), u = await verifyCommand(auth, token, "notification", "notification:deliver"); if (u.delegation?.entity?.id !== id || u.delegation.workflowId !== "WF-10" || !config.notificationUrl) throw denied();
    const intent = await api(config.notificationUrl, `/internal/notification/intents/${id}/authority`, token), { enrollment: e, entitlement: t } = await effective(pool, uuid.parse(intent.enrollmentId ?? intent.sourceId)); checkBranch(u, e.branch_id);
    res.json({ data: { valid: e.status === "CONFIRMED" && t.state === "ACTIVE" && intent.recipientRef === e.learner_id && intent.branchId === e.branch_id, branchId: e.branch_id, learnerId: e.learner_id, sourceVersion: e.version, entitlementVersion: t.version, classId: t.class_id, holdId: t.hold_id, seatId: t.seat_id, committed: e.status === "CONFIRMED" && t.state === "ACTIVE", historicallyConfirmed: e.status === "CONFIRMED" && !!e.match_ref && !!e.hold_id, selfRegistration: e.snapshot.selfRegistration === true } });
  });
}
