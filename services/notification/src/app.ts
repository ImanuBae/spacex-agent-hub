import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { authenticate, bearer, checkBranch, iamRequest, principal, verifyCommand, type AuthConfig } from "@spacex/auth";
import { EnrollmentConfirmedEvent, MachineClaims, type EventEnvelope } from "@spacex/contracts";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";

const Id = z.uuid(), Version = z.number().int().positive(), Timestamp = z.iso.datetime({ offset: true });
const Fault = z.enum(["REJECT", "TIMEOUT_BEFORE", "TIMEOUT_AFTER", "UNKNOWN_NO_LOOKUP"]);
const timeout = () => new HttpError(503, "ADAPTER_TIMEOUT", "Delivery response timed out; look up the intent before retrying");
const denied = () => new HttpError(403, "FORBIDDEN", "Notification authority denied");
const empty = z.object({}).strict();
const recipient = z.object({ accountId: Id, learnerId: Id, branchId: Id, email: z.email() });
const enrollment = z.object({ valid: z.boolean(), branchId: Id, learnerId: Id, sourceVersion: Version, classId: Id, committed: z.boolean(), historicallyConfirmed: z.boolean().optional(), entitlementVersion: Version });
const session = z.object({ startsAt: Timestamp });
const schedule = z.object({ classId: Id, version: Version, status: z.string(), sessions: z.array(session), committed: z.boolean() });
const classEvent = z.object({ classId: Id, branchId: Id, sourceVersion: Version, status: z.string() });
const legacyCancellation = z.object({ targetId: Id, aggregateId: Id, aggregateVersion: Version, branchId: Id, status: z.literal("CANCELLED") });
const entitlementEvent = z.object({ enrollmentId: Id, learnerId: Id, branchId: Id, classId: Id, sourceVersion: Version, state: z.enum(["ACTIVE", "SUSPENDED", "CANCELLED"]) });
const terminal = new Set(["SENT", "SUPERSEDED", "FAILED", "UNKNOWN"]);
type Template = "ENROLLMENT_CONFIRMED" | "CLASS_CHANGED" | "ENTITLEMENT_CHANGED" | "REMINDER" | "OTP";
type Status = "PENDING" | "WAITING" | "SENT" | "SUPERSEDED" | "FAILED" | "UNKNOWN";
type Intent = {
  id: string; enrollment_id: string | null; learner_id: string; branch_id: string; class_id: string | null;
  template: Template; source_version: number; source_event_id: string | null; challenge_id: string | null; session_starts_at: Date | null;
  correlation_id: string; status: Status; due_at: Date; expires_at: Date | null; attempts: number; receipt_id: string | null;
  owner_id: string; error_code: string | null; event_id: string | null; context_id: string | null; created_at: Date;
};
type IntentInput = {
  enrollmentId?: string; learnerId: string; branchId: string; classId?: string;
  template: Template; sourceVersion: number; sourceEventId?: string; challengeId?: string;
  sessionStartsAt?: Date; correlationId: string; dueAt?: Date; expiresAt?: Date;
};
export interface NotificationConfig {
  enrollmentUrl: string; classUrl: string; crmUrl: string;
  sourceClientId: string; sourceClientSecret: string; iamNotificationSecret: string;
  ownerId: string; testFaults?: boolean;
}

function view(row: Intent) {
  return { id: row.id, enrollmentId: row.enrollment_id, classId: row.class_id, template: row.template,
    sourceVersion: row.source_version, dueAt: row.due_at, status: row.status, attempts: row.attempts,
    receiptId: row.receipt_id, ownerId: row.owner_id, errorCode: row.error_code, createdAt: row.created_at };
}

function intentKey(input: IntentInput) {
  return [input.template, input.challengeId ?? input.enrollmentId, input.classId, input.sourceVersion, input.sessionStartsAt?.toISOString()].join(":");
}

async function addIntent(c: PoolClient, input: IntentInput, ownerId: string) {
  const key = intentKey(input);
  const result = await c.query<Intent>(`INSERT INTO notification_intents
    (id,dedup_key,enrollment_id,learner_id,branch_id,class_id,template,source_version,source_event_id,challenge_id,session_starts_at,correlation_id,due_at,expires_at,owner_id,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,clock_timestamp()),$14,$15,
    CASE WHEN $13>clock_timestamp() THEN 'WAITING' ELSE 'PENDING' END)
    ON CONFLICT (dedup_key) DO NOTHING RETURNING *`,
  [randomUUID(), key, input.enrollmentId ?? null, input.learnerId, input.branchId, input.classId ?? null, input.template, input.sourceVersion,
    input.sourceEventId ?? null, input.challengeId ?? null, input.sessionStartsAt ?? null, input.correlationId, input.dueAt ?? null, input.expiresAt ?? null, ownerId]);
  if (result.rows[0]) {
    await c.query("INSERT INTO notification_audit(id,intent_id,action,actor_id,correlation_id) VALUES($1,$2,'INTENT_CREATED',$3,$4)",
      [randomUUID(), result.rows[0].id, ownerId, input.correlationId]);
    return result.rows[0];
  }
  const stored = (await c.query<Intent>("SELECT * FROM notification_intents WHERE dedup_key=$1", [key])).rows[0];
  if (stored.learner_id !== input.learnerId || stored.branch_id !== input.branchId)
    throw new HttpError(409, "INTENT_CONFLICT", "Notification already exists with different source data");
  return stored;
}

async function membership(c: PoolClient, input: z.infer<typeof entitlementEvent>) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4010))", [input.classId]);
  const result = await c.query(`INSERT INTO notification_memberships(enrollment_id,learner_id,branch_id,class_id,entitlement_version,state)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(enrollment_id) DO UPDATE SET class_id=excluded.class_id,entitlement_version=excluded.entitlement_version,state=excluded.state
      WHERE notification_memberships.entitlement_version<excluded.entitlement_version AND notification_memberships.learner_id=excluded.learner_id
      AND notification_memberships.branch_id=excluded.branch_id RETURNING enrollment_id`,
  [input.enrollmentId, input.learnerId, input.branchId, input.classId, input.sourceVersion, input.state]);
  return !!result.rowCount;
}

async function auditSuperseded(c: PoolClient, rows: Intent[], ownerId: string) {
  for (const row of rows) await c.query("INSERT INTO notification_audit(id,intent_id,action,actor_id,correlation_id) VALUES($1,$2,'SUPERSEDED',$3,$4)",
    [randomUUID(), row.id, ownerId, row.correlation_id]);
}

export async function receiveCourseEvent(c: PoolClient, event: EventEnvelope, ownerId: string) {
  if (event.type === "enrollment.confirmed") {
    const confirmed = EnrollmentConfirmedEvent.parse(event);
    const p = confirmed.payload;
    if (p.enrollmentId !== confirmed.entityId) throw new Error("Enrollment event entity mismatch");
    if (!await membership(c, { ...p, sourceVersion: confirmed.entityVersion, state: "ACTIVE" })) return;
    const input = { enrollmentId: p.enrollmentId, learnerId: p.learnerId, branchId: p.branchId, classId: p.classId,
      correlationId: confirmed.correlationId, sourceEventId: confirmed.id };
    await addIntent(c, { ...input, template: "ENROLLMENT_CONFIRMED", sourceVersion: confirmed.entityVersion }, ownerId);
    const latest = (await c.query<{ version: number }>("SELECT version FROM notification_class_versions WHERE class_id=$1", [p.classId])).rows[0];
    if (latest) await addIntent(c, { ...input, template: "CLASS_CHANGED", sourceVersion: latest.version }, ownerId);
    return;
  }
  if (event.type === "enrollment.entitlement_changed") {
    const e = entitlementEvent.parse(event.payload);
    if (event.version !== 1 || event.entityId !== e.enrollmentId || event.entityVersion !== e.sourceVersion || !event.causationId)
      throw new Error("Entitlement event entity mismatch");
    if (!await membership(c, e)) return;
    const old = await c.query<Intent>(`UPDATE notification_intents SET status='SUPERSEDED',error_code='ENTITLEMENT_CHANGED',updated_at=clock_timestamp()
      WHERE enrollment_id=$1 AND template='REMINDER' AND (class_id<>$2 OR $3<>'ACTIVE') AND status IN ('PENDING','WAITING') RETURNING *`,
    [e.enrollmentId, e.classId, e.state]);
    await auditSuperseded(c, old.rows, ownerId);
    if (e.state === "ACTIVE") await addIntent(c, { ...e, template: "ENTITLEMENT_CHANGED", sourceEventId: event.id, correlationId: event.correlationId }, ownerId);
    return;
  }
  if (!["class.schedule_changed", "class.cancelled"].includes(event.type) || event.version !== 1) throw new Error("Unexpected course notification event");
  const legacy = event.type === "class.cancelled" && !event.entityId ? legacyCancellation.parse(event.payload) : undefined;
  if (legacy && legacy.targetId !== legacy.aggregateId) throw new Error("Legacy cancellation entity mismatch");
  const p = legacy ? { classId: legacy.targetId, sourceVersion: legacy.aggregateVersion, branchId: legacy.branchId } : classEvent.parse(event.payload);
  if (!legacy && (event.entityId !== p.classId || event.entityVersion !== p.sourceVersion)) throw new Error("Class event entity mismatch");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4010))", [p.classId]);
  const changed = await c.query(`INSERT INTO notification_class_versions(class_id,version) VALUES($1,$2)
    ON CONFLICT(class_id) DO UPDATE SET version=excluded.version WHERE notification_class_versions.version<excluded.version RETURNING version`, [p.classId, p.sourceVersion]);
  if (!changed.rowCount) return;
  const superseded = await c.query<Intent>(`UPDATE notification_intents SET status='SUPERSEDED',error_code='SOURCE_CHANGED',updated_at=clock_timestamp()
    WHERE class_id=$1 AND branch_id=$2 AND template='REMINDER' AND source_version<$3 AND status IN ('PENDING','WAITING') RETURNING *`, [p.classId, p.branchId, p.sourceVersion]);
  await auditSuperseded(c, superseded.rows, ownerId);
  const affected = (await c.query<{ enrollment_id: string; learner_id: string }>(`SELECT enrollment_id,learner_id FROM notification_memberships
    WHERE class_id=$1 AND branch_id=$2 AND (state='ACTIVE' OR $3='class.cancelled') ORDER BY enrollment_id`, [p.classId, p.branchId, event.type])).rows;
  for (const row of affected) await addIntent(c, { enrollmentId: row.enrollment_id, learnerId: row.learner_id,
    branchId: p.branchId, classId: p.classId, template: "CLASS_CHANGED", sourceVersion: p.sourceVersion,
    correlationId: event.correlationId, sourceEventId: event.id }, ownerId);
}

export function createNotificationApp(pool: Pool, auth: AuthConfig, config: NotificationConfig) {
  async function tx<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const r = await work(c); await c.query("COMMIT"); return r; }
    catch (error) { await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }
  async function read<T>(schema: z.ZodType<T>, base: string, route: string, headers: Record<string, string>): Promise<T> {
    let response: Response;
    try { response = await fetch(`${base}${route}`, { headers, signal: AbortSignal.timeout(5000), redirect: "error" }); }
    catch { throw new HttpError(503, "NOTIFICATION_SOURCE_UNAVAILABLE", "Could not verify notification source"); }
    if ([401, 403, 404].includes(response.status)) throw denied();
    if (!response.ok) throw new HttpError(503, "NOTIFICATION_SOURCE_UNAVAILABLE", "Could not verify notification source");
    const parsed = schema.safeParse((await response.json() as { data: unknown }).data);
    if (!parsed.success) throw new HttpError(503, "NOTIFICATION_SOURCE_INVALID", "Source returned an invalid notification projection");
    return parsed.data;
  }
  async function intent(c: Pool | PoolClient, id: string, locked = false) {
    const row = (await c.query<Intent>(`SELECT * FROM notification_intents WHERE id=$1${locked ? " FOR UPDATE" : ""}`, [id])).rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "Notification intent not found");
    return row;
  }
  async function scope(token: string, id: string) {
    const user = await verifyCommand(auth, token, "notification", "notification:deliver"), d = user.delegation;
    if (user.sub !== config.sourceClientId || d?.source !== "service" || d.operation !== "notification.deliver" || d.workflowId !== "WF-10" || d.entity?.type !== "notification" || d.entity.id !== id || d.entity.version !== 1 || d.inputRef !== id) throw denied();
    return { user, d };
  }
  function validateScope(row: Intent, branchId: string, contextId: string) {
    if (row.branch_id !== branchId || !row.event_id || row.context_id !== contextId || row.template === "OTP") throw denied();
  }
  async function audit(c: PoolClient, row: Intent, action: string, actor: string) {
    await c.query("INSERT INTO notification_audit(id,intent_id,action,actor_id,correlation_id) VALUES($1,$2,$3,$4,$5)", [randomUUID(), row.id, action, actor, row.correlation_id]);
  }
  async function outcome(c: PoolClient, row: Intent, status: Status, code: string | null, receipt: string | null, actor: string, jobId?: string) {
    const next = (await c.query<Intent>(`UPDATE notification_intents SET status=$2,error_code=$3,receipt_id=$4,
      attempts=attempts+CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [row.id, status, code, receipt, jobId ?? null])).rows[0];
    if (jobId) await c.query("INSERT INTO notification_attempts(id,intent_id,number,job_id,outcome) VALUES($1,$2,$3,$4,$5)", [randomUUID(), row.id, next.attempts, jobId, code ?? status]);
    await audit(c, row, status, actor);
    return next;
  }
  async function reconcile(c: PoolClient, row: Intent, actor: string) {
    if (row.status !== "UNKNOWN" || row.error_code !== "ADAPTER_RESPONSE_LOST") return row;
    const receipt = (await c.query<{ id: string }>("SELECT id FROM notification_mailbox WHERE intent_id=$1", [row.id])).rows[0];
    return receipt ? outcome(c, row, "SENT", null, receipt.id, actor) : row;
  }
  async function mailbox(c: PoolClient, row: Intent, to: string, subject: string, body: string) {
    const id = randomUUID();
    await c.query(`INSERT INTO notification_mailbox(id,intent_id,recipient,subject,body,adapter)
      VALUES($1,$2,$3,$4,$5,'SYNTHETIC_LOCAL_MAILBOX')`, [id, row.id, to, subject, body]);
    if (row.template !== "OTP") await c.query("INSERT INTO notification_portal_messages(id,intent_id,learner_id,subject,body) VALUES($1,$2,$3,$4,$5)", [randomUUID(), row.id, row.learner_id, subject, body]);
    return id;
  }
  async function reminders(c: PoolClient, row: Intent, current: z.infer<typeof schedule>, now: Date) {
    if (row.template === "REMINDER") return;
    for (const s of current.sessions) {
      const start = new Date(s.startsAt);
      if (start <= now) continue;
      await addIntent(c, { enrollmentId: row.enrollment_id!, learnerId: row.learner_id, branchId: row.branch_id, classId: current.classId,
        template: "REMINDER", sourceVersion: current.version, sessionStartsAt: start, sourceEventId: row.source_event_id ?? undefined,
        correlationId: row.correlation_id, dueAt: new Date(start.getTime() - 86400000), expiresAt: start }, config.ownerId);
    }
  }

  return createApp("notification", app => {
    app.get("/ready", async (_req, res) => { await pool.query("SELECT 1 FROM notification_intents LIMIT 1"); res.json({ status: "ok" }); });
    app.post("/internal/notification/deadlines", async (req, res) => {
      empty.parse(req.body);
      const token = bearer(req.get("authorization"));
      const claims = MachineClaims.parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/introspect", token, { audience: "automation-bridge", scope: "automation:claim" }));
      if (!claims.workflows.includes("WF-10")) throw denied();
      const count = await tx(async c => {
        const rows = (await c.query<Intent>(`SELECT * FROM notification_intents WHERE event_id IS NULL AND template<>'OTP'
          AND status IN ('PENDING','WAITING') AND due_at<=clock_timestamp() ORDER BY due_at,id LIMIT 10 FOR UPDATE SKIP LOCKED`)).rows;
        if (!rows.length) return 0;
        const sourceToken = z.object({ accessToken: z.string() }).parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/token", "", {
          clientId: config.sourceClientId, clientSecret: config.sourceClientSecret, audience: "notification", scopes: ["automation:source"], workflows: ["WF-10"], ttlSeconds: 60,
        })).accessToken;
        for (const row of rows) {
          const entity = { type: "notification", id: row.id, version: 1 }, eventId = randomUUID(), inputRef = row.id;
          const { contextRef } = z.object({ contextRef: Id }).parse(await iamRequest(auth.identityUrl, "/internal/iam/service-delegations", sourceToken, {
            audience: "notification", input: { entity, eventId, workflowId: "WF-10", workflowVersion: 1, branchId: row.branch_id, operations: ["notification.deliver"], inputRef },
          }));
          await c.query("UPDATE notification_intents SET event_id=$2,context_id=$3,status='PENDING' WHERE id=$1", [row.id, eventId, contextRef]);
          await enqueueEvent(c, { id: eventId, type: "notification.requested", version: 1, occurredAt: new Date().toISOString(),
            correlationId: row.correlation_id, causationId: row.source_event_id ?? undefined, entityId: row.id, entityVersion: 1,
            payload: { entity, inputRef, contextRef } });
        }
        return rows.length;
      });
      res.json({ data: { queued: count } });
    });
    app.get("/internal/notification/intents/:id/authority", async (req, res) => {
      const id = Id.parse(req.params.id), { user, d } = await scope(bearer(req.get("authorization")), id);
      const row = await intent(pool, id); validateScope(row, d.branchId, user.sid);
      res.json({ data: { enrollmentId: row.enrollment_id, learnerId: row.learner_id, recipientRef: row.learner_id,
        branchId: row.branch_id, classId: row.class_id, sourceVersion: row.source_version, template: row.template } });
    });
    app.get("/internal/notification/intents/:id", async (req, res) => {
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const { user, d } = await scope(token, id);
      const data = await tx(async c => {
        const row = await intent(c, id, true); validateScope(row, d.branchId, user.sid);
        if (row.status === "UNKNOWN" && row.error_code === "ADAPTER_RESPONSE_LOST") await scope(token, id);
        return view(await reconcile(c, row, user.sub));
      });
      res.json({ data });
    });
    app.post("/internal/notification/intents/:id/send", async (req, res) => {
      empty.parse(req.body);
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const { user, d } = await scope(token, id);
      const headers = { authorization: `Bearer ${token}`, "x-correlation-id": res.locals.correlationId };
      const result = await tx(async c => {
        const row = await intent(c, id, true); validateScope(row, d.branchId, user.sid);
        await scope(token, id);
        if (terminal.has(row.status)) return { row: await reconcile(c, row, user.sub), timedOut: false };
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
        if (row.due_at > now) throw new HttpError(409, "NOTIFICATION_NOT_DUE", "Notification is not due");
        if (row.expires_at && row.expires_at <= now) return { row: await outcome(c, row, "SUPERSEDED", "REMINDER_EXPIRED", null, user.sub), timedOut: false };
        const [e, s] = await Promise.all([
          read(enrollment, config.enrollmentUrl, `/internal/enrollment/notifications/${id}`, headers),
          read(schedule, config.classUrl, `/internal/classes/notifications/${id}/source`, headers),
        ]);
        const key = row.template === "ENROLLMENT_CONFIRMED" ? e.sourceVersion : row.template === "ENTITLEMENT_CHANGED" ? e.entitlementVersion : s.version;
        const nextSession = s.sessions.find(value => Date.parse(value.startsAt) === row.session_starts_at?.getTime());
        const cancelled = row.template === "CLASS_CHANGED" && s.status === "CANCELLED" && row.source_event_id && e.historicallyConfirmed;
        const active = e.valid && e.committed && s.committed && s.status !== "CANCELLED" && s.status !== "COMPLETED";
        const sourceValid = cancelled || active && (row.template !== "REMINDER" || ["OPEN", "IN_PROGRESS"].includes(s.status));
        if (!sourceValid || key !== row.source_version || e.branchId !== row.branch_id || e.learnerId !== row.learner_id || e.classId !== row.class_id || s.classId !== row.class_id || (row.template === "REMINDER" && (!nextSession || new Date(nextSession.startsAt) <= now)))
          return { row: await outcome(c, row, "SUPERSEDED", "SOURCE_CHANGED", null, user.sub), timedOut: false };
        let target: z.infer<typeof recipient>;
        try { target = await read(recipient, auth.identityUrl, `/internal/iam/notification-recipients/${id}`, headers); }
        catch (error) {
          if (!(error instanceof HttpError) || error.status !== 403) throw error;
          await scope(token, id);
          return { row: await outcome(c, row, "FAILED", "RECIPIENT_UNVERIFIED", null, user.sub), timedOut: false };
        }
        if (target.branchId !== row.branch_id || target.learnerId !== row.learner_id) throw denied();
        const consent = await read(z.object({ allowed: z.boolean() }), config.crmUrl, `/internal/crm/notifications/${id}`, headers);
        if (!consent.allowed) return { row: await outcome(c, row, "SUPERSEDED", "CONSENT_WITHDRAWN", null, user.sub), timedOut: false };
        const fault = (await c.query<{ mode: z.infer<typeof Fault> }>(`UPDATE notification_adapter_faults SET consumed_at=clock_timestamp()
          WHERE intent_id=$1 AND consumed_at IS NULL RETURNING mode`, [id])).rows[0]?.mode;
        await scope(token, id);
        const finish = (status: Status, error: string | null, receipt: string | null) => outcome(c, row, status, error, receipt, user.sub, d.jobId);
        if (fault === "REJECT") return { row: await finish("FAILED", "ADAPTER_REJECTED", null), timedOut: false };
        if (fault === "UNKNOWN_NO_LOOKUP") return { row: await finish("UNKNOWN", "ADAPTER_UNCERTAIN", null), timedOut: false };
        if (fault === "TIMEOUT_BEFORE") return { row: await finish("PENDING", "ADAPTER_TIMEOUT_BEFORE", null), timedOut: true };
        const subject = cancelled ? "Lớp đã hủy" : row.template === "ENROLLMENT_CONFIRMED" ? "Xác nhận đăng ký học"
          : row.template === "CLASS_CHANGED" ? "Lịch lớp đã thay đổi" : row.template === "ENTITLEMENT_CHANGED" ? "Quyền lợi học đã thay đổi" : "Nhắc buổi học";
        const body = nextSession ? `Buổi học bắt đầu lúc ${new Date(nextSession.startsAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}. Xem lịch và đường dẫn tại cổng học viên.` : "Xem lịch và quyền lợi tại cổng học viên.";
        const receipt = await mailbox(c, row, target.email, subject, body);
        if (["OPEN", "IN_PROGRESS"].includes(s.status)) await reminders(c, row, s, now);
        if (fault === "TIMEOUT_AFTER") return { row: await finish("UNKNOWN", "ADAPTER_RESPONSE_LOST", null), timedOut: true };
        return { row: await finish("SENT", null, receipt), timedOut: false };
      });
      if (result.timedOut) throw timeout();
      res.json({ data: view(result.row) });
    });
    app.post("/internal/notification/otp", async (req, res) => {
      const supplied = Buffer.from(req.get("x-iam-notification-secret") ?? ""), secret = Buffer.from(config.iamNotificationSecret);
      if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) throw denied();
      const input = recipient.extend({ challengeId: Id, code: z.string().regex(/^\d{6}$/), expiresAt: Timestamp }).strict().parse(req.body);
      const source = await read(recipient.extend({ challengeId: Id, valid: z.boolean(), expiresAt: Timestamp }), auth.identityUrl, `/internal/iam/otp/${input.challengeId}`, { "x-iam-notification-secret": config.iamNotificationSecret });
      if (!source.valid || source.challengeId !== input.challengeId || source.accountId !== input.accountId || source.learnerId !== input.learnerId || source.branchId !== input.branchId || source.email !== input.email || source.expiresAt !== input.expiresAt) throw denied();
      const data = await tx(async c => {
        const correlationId = res.locals.correlationId as string;
        const proposed = await addIntent(c, { learnerId: source.learnerId, branchId: source.branchId, template: "OTP", sourceVersion: 1,
          challengeId: source.challengeId, correlationId, expiresAt: new Date(source.expiresAt) }, config.ownerId);
        const row = await intent(c, proposed.id, true);
        if (row.status === "SENT") return { intentId: row.id, receiptId: row.receipt_id };
        if (!(await c.query("SELECT 1 WHERE $1::timestamptz>clock_timestamp()", [row.expires_at])).rowCount) throw denied();
        const receiptId = await mailbox(c, row, source.email, "Mã đăng nhập học viên", `Mã đăng nhập của bạn: ${input.code}. Mã có hạn 5 phút.`);
        await outcome(c, row, "SENT", null, receiptId, source.accountId);
        return { intentId: row.id, receiptId };
      });
      res.status(201).json({ data });
    });
    if (config.testFaults) app.post("/internal/notification/intents/:id/test-fault", authenticate(auth), async (req, res) => {
      if (principal(res).role !== "center_director") throw denied();
      const id = Id.parse(req.params.id), { mode } = z.object({ mode: Fault }).strict().parse(req.body);
      await tx(async c => {
        const row = await intent(c, id, true);
        if (row.template === "OTP" || terminal.has(row.status)) throw new HttpError(409, "INTENT_TERMINAL", "Intent cannot accept a test fault");
        await c.query("INSERT INTO notification_adapter_faults(intent_id,mode) VALUES($1,$2)", [id, mode]);
        await audit(c, row, "SYNTHETIC_FAULT_CONFIGURED", principal(res).sub);
      });
      res.json({ data: { id, mode } });
    });
    app.use("/api/v1/notifications", authenticate(auth));
    app.get("/api/v1/notifications", async (req, res) => {
      const user = principal(res);
      if (user.role === "student") {
        const { learnerId, branchId } = await read(recipient.pick({ learnerId: true, branchId: true }), auth.identityUrl, "/api/v1/auth/learner", { authorization: req.get("authorization")! });
        const messages = await pool.query(`SELECT m.id,m.intent_id AS "intentId",m.subject,m.body,m.created_at AS "createdAt" FROM notification_portal_messages m
          JOIN notification_intents i ON i.id=m.intent_id WHERE m.learner_id=$1 AND i.branch_id=$2 ORDER BY m.created_at DESC LIMIT 100`, [learnerId, branchId]);
        res.json({ data: messages.rows }); return;
      }
      if (!["center_director", "branch_director", "admissions"].includes(user.role)) throw denied();
      const rows = await pool.query<Intent>(`SELECT * FROM notification_intents WHERE template<>'OTP' AND ($1::uuid[] IS NULL OR branch_id=ANY($1))
        ORDER BY created_at DESC LIMIT 100`, [user.role === "center_director" ? null : user.branchIds]);
      res.json({ data: rows.rows.map(view) });
    });
    app.post("/api/v1/notifications", async (req, res) => {
      const user = principal(res);
      if (!["center_director", "branch_director", "admissions"].includes(user.role)) throw denied();
      const input = z.object({ enrollmentId: Id, template: z.literal("REMINDER"), sourceVersion: Version, dueAt: Timestamp.optional() }).strict().parse(req.body);
      const headers = { authorization: req.get("authorization")! };
      const e = await read(z.object({ id: Id, status: z.literal("CONFIRMED"), snapshot: z.object({ branchId: Id, learnerId: Id, classId: Id }) }), config.enrollmentUrl, `/api/v1/enrollments/${input.enrollmentId}`, headers);
      checkBranch(user, e.snapshot.branchId);
      const s = await read(schedule.omit({ classId: true, committed: true }).extend({ id: Id, branchId: Id }), config.classUrl, `/api/v1/classes/${e.snapshot.classId}`, headers);
      if (s.id !== e.snapshot.classId || s.branchId !== e.snapshot.branchId || s.status === "CANCELLED" || input.sourceVersion !== s.version) throw new HttpError(409, "SOURCE_CHANGED", "Class schedule version changed");
      const data = await tx(async c => {
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
        const next = s.sessions.filter(x => new Date(x.startsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
        if (!next) throw new HttpError(409, "NO_FUTURE_SESSION", "There is no future session for this class");
        const startsAt = new Date(next.startsAt), dueAt = input.dueAt ? new Date(input.dueAt) : new Date(startsAt.getTime() - 86400000);
        if (dueAt >= startsAt) throw new HttpError(409, "REMINDER_DEADLINE", "Reminder must be due before the session begins");
        const row = await addIntent(c, { enrollmentId: e.id, learnerId: e.snapshot.learnerId, branchId: e.snapshot.branchId,
          classId: s.id, sourceVersion: s.version, template: "REMINDER", sessionStartsAt: startsAt, dueAt, expiresAt: startsAt, correlationId: res.locals.correlationId }, config.ownerId);
        if (input.dueAt && row.due_at.getTime() !== dueAt.getTime()) throw new HttpError(409, "INTENT_CONFLICT", "Reminder already exists with a different due time");
        await audit(c, row, "REMINDER_REQUESTED", user.sub);
        return view(row);
      });
      res.status(201).json({ data });
    });
  });
}
