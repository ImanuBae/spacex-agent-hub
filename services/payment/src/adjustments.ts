import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { allowRoles, authenticate, bearer, checkBranch, iamRequest, principal, verifyCommand, type AuthConfig } from "@spacex/auth";
import { LearnerMemberships } from "@spacex/contracts";
import { HttpError } from "@spacex/http";
import { enqueueEvent, enqueueReportingRefresh } from "@spacex/messaging";
import type { PaymentConfig } from "./app.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const Id = z.uuid();
const PositiveVersion = z.number().int().positive();
const denied = () => new HttpError(403, "FORBIDDEN", "Adjustment payment authority does not match");
const conflict = (code: string) => new HttpError(409, code, "Reload the payment adjustment before proceeding");
const absent = () => new HttpError(404, "NOT_FOUND", "Payment record not found");
const AdjustmentSource = z.object({ id: Id, enrollmentId: Id, branchId: Id, type: z.enum(["REFUND", "TRANSFER", "RESUME", "WAITLIST"]), status: z.string(), sourceVersion: PositiveVersion,
  source: z.object({ amount: z.coerce.number().int().nonnegative() }).passthrough(), amountDelta: z.number().int(), refundMode: z.enum(["EXCESS", "CANCEL"]).nullable(), policyVersion: z.string(), deadlineAt: z.iso.datetime(), correlationId: z.string(),
  actorId: Id, actorSession: Id, approvedBy: Id.nullable(), approvedSession: Id.nullable(), authorized: z.boolean(), eventId: Id }).passthrough();
const InvoiceInput = z.object({ enrollmentId: Id, recipientName: z.string().trim().min(2).max(150), address: z.string().trim().min(5).max(255), taxCode: z.string().regex(/^\d{10}(?:-\d{3})?$/).optional() }).strict();
const InvoiceSource = z.object({ id: Id, learnerId: Id, branchId: Id, paymentRequestId: Id, status: z.literal("CONFIRMED"), currentEntitlement: z.object({ state: z.literal("ACTIVE"), amount: z.number().int().positive() }) });
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export function availableRefund(allocated: number, captured: number, reversed: number, reservedOrRefunded: number, protectedTuition: number) {
  return Math.max(0, allocated + captured - reversed - reservedOrRefunded - protectedTuition);
}

export function registerPaymentAdjustments(app: Express, pool: Pool, auth: AuthConfig, config: PaymentConfig) {
  async function tx<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const result = await work(c); await c.query("COMMIT"); return result; }
    catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  async function read(base: string, path: string, token: string) {
    let response: Response;
    try { response = await fetch(base + path, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000), redirect: "error" }); }
    catch { throw new HttpError(503, "SOURCE_UNAVAILABLE", "Payment source unavailable"); }
    if (!response.ok) throw new HttpError([401, 403, 404, 409].includes(response.status) ? response.status : 503, "SOURCE_DENIED", "Payment source rejected");
    return (await response.json() as { data: unknown }).data;
  }
  const staff = [authenticate(auth), allowRoles("center_director", "branch_director", "accountant")] as const;
  const student = [authenticate(auth), allowRoles("student")] as const;
  function enabled() { if (!config.syntheticEnabled || process.env.NODE_ENV !== "test") throw denied(); }
  async function bound(token: string, id: string, caller: "payment" | "enrollment" | "class-schedule") {
    const scope = { payment: "payment:refund", enrollment: "enrollment:adjust", "class-schedule": "classes:adjust" } as const;
    const operation = { payment: "payment.refund", enrollment: "enrollment.adjust", "class-schedule": "classes.adjust" } as const;
    const u = await verifyCommand(auth, token, caller, scope[caller]), d = u.delegation;
    if (d?.workflowId !== "WF-09" || d.operation !== operation[caller] || d.entity?.type !== "adjustment" || d.entity.id !== id || d.inputRef !== id) throw denied();
    return u;
  }
  async function row(c: Pool | PoolClient, id: string, lock = false) {
    return (await c.query(`SELECT *,clock_timestamp() AS now FROM payment_adjustments WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0];
  }
  function view(r: Row, seat = false) {
    return { id: r.id, enrollmentId: r.enrollment_id, branchId: r.branch_id, status: r.status, reserved: r.status === "RESERVED", executionAuthorized: !!r.execution_by, settled: r.status === "EXECUTED" || seat && r.status === "RESERVED", receiptRef: r.receipt_id, delta: Number(r.amount_delta), adapter: "SYNTHETIC", deadlineAt: r.deadline_at, version: r.version, errorCode: r.error_code, ownerId: config.reviewOwnerId };
  }
  async function audit(c: PoolClient, r: Row, actor: string, action: string) {
    const id = randomUUID();
    await c.query("INSERT INTO payment_audit(id,target_id,actor_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)", [id, r.id, actor, action, r.correlation_id]);
    if (r.version) await c.query("INSERT INTO payment_adjustment_history(id,adjustment_id,version,action,actor_id) VALUES($1,$2,$3,$4,$5)", [id, r.id, r.version, action, actor]);
    await enqueueEvent(c, { id, type: action, version: 1, occurredAt: new Date().toISOString(), correlationId: r.correlation_id, entityId: r.id, ...(r.version ? { entityVersion: r.version } : {}), payload: { paymentAdjustmentId: r.id, action, sourceVersion: r.version ?? 1 } });
    return id;
  }
  async function change(c: PoolClient, r: Row, actor: string, status: string, receiptId: string | null, errorCode: string | null) {
    const next = (await c.query("UPDATE payment_adjustments SET status=$2,receipt_id=$3,error_code=$4,version=version+1 WHERE id=$1 RETURNING *", [r.id, status, receiptId, errorCode])).rows[0];
    const eventId = await audit(c, next, actor, `payment.adjustment_${status.toLowerCase()}`);
    if (config.reportingEnabled && receiptId && (status === "EXECUTED" || status === "REVOKED")) {
      const {rows} = await c.query<{created_at:Date}>(`SELECT created_at FROM synthetic_payment_executions
        WHERE adjustment_id=$1 AND direction<>'ZERO' AND (id=$2 OR ($3='REVOKED' AND direction='CHARGE'))`, [r.id,receiptId,status]);
      await enqueueReportingRefresh(c,rows.map(x=>x.created_at),{id:eventId,correlationId:next.correlation_id});
    }
    return next;
  }
  async function currentFinancialDecisions(r: Row, token: string, originalRefund: boolean) {
    await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: r.approved_by, sessionId: r.approved_session, branchId: r.branch_id, role: "director" });
    if (originalRefund) await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: r.actor_id, sessionId: r.actor_session, branchId: r.branch_id, role: "accountant" });
    await iamRequest(auth.identityUrl, "/internal/iam/commands/stored-session", token, { accountId: r.execution_by, sessionId: r.execution_session, branchId: r.branch_id, role: "accountant" });
  }
  async function receipt(c: PoolClient, id: string, direction: "REFUND" | "CHARGE" | "ZERO" | "REVERSAL", amount: number) {
    const existing = (await c.query("SELECT id,amount FROM synthetic_payment_executions WHERE adjustment_id=$1 AND direction=$2", [id, direction])).rows[0];
    if (existing) { if (Number(existing.amount) !== amount) throw conflict("OPERATION_PAYLOAD_CHANGED"); return existing.id; }
    const ref = randomUUID();
    await c.query("INSERT INTO synthetic_payment_executions(id,adjustment_id,direction,amount,adapter) VALUES($1,$2,$3,$4,'SYNTHETIC')", [ref, id, direction, amount]);
    return ref;
  }
  async function persistResult(c: PoolClient, r: Row, action: "settle" | "compensate") {
    const value = view(r), payload = { sourceVersion: r.source_version, delta: Number(r.amount_delta) };
    await c.query("INSERT INTO payment_adjustment_operations(key,adjustment_id,action,payload,result) VALUES($1,$2,$3,$4,$5)", [`adjustment:${r.id}:${action}`, r.id, action, payload, value]);
    return value;
  }
  const path = "/internal/payment/adjustments/:id";
  for (const caller of ["payment", "enrollment", "class-schedule"] as const) {
    const suffix = caller === "payment" ? "" : caller === "enrollment" ? "/enrollment-authority" : "/seat-authority";
    app.get(path + suffix, async (req, res) => {
      const id = Id.parse(req.params.id), u = await bound(bearer(req.get("authorization")), id, caller), r = await row(pool, id);
      if (!r) { res.json({ data: null }); return; }
      checkBranch(u, r.branch_id);
      res.json({ data: view(r, caller === "class-schedule") });
    });
  }
  app.get("/api/v1/refunds", ...staff, async (_req, res) => {
    const u = principal(res);
    const entries = (await pool.query("SELECT * FROM payment_adjustments WHERE ($1 OR branch_id=ANY($2)) ORDER BY created_at DESC LIMIT 100", [u.role === "center_director", u.branchIds])).rows;
    res.json({ data: entries.map(r => view(r)) });
  });
  app.get("/api/v1/refunds/:id", ...staff, async (req, res) => {
    const r = await row(pool, Id.parse(req.params.id)); if (!r) throw absent(); checkBranch(principal(res), r.branch_id);
    const history = (await pool.query("SELECT version,action,actor_id AS \"actorId\",created_at AS \"createdAt\" FROM payment_adjustment_history WHERE adjustment_id=$1 ORDER BY version", [r.id])).rows;
    res.json({ data: { ...view(r), history } });
  });
  app.post("/api/v1/refunds/:id/execute", authenticate(auth), allowRoles("accountant"), async (req, res) => {
    enabled();
    const id = Id.parse(req.params.id), input = z.object({ version: PositiveVersion }).strict().parse(req.body), u = principal(res), token = bearer(req.get("authorization"));
    const result = await tx(async c => {
      const r = await row(c, id, true); if (!r) throw absent(); checkBranch(u, r.branch_id);
      if (r.version !== input.version || !["WAITING", "RESERVED"].includes(r.status) || r.execution_by || r.deadline_at <= r.now || r.approved_by === u.sub) throw conflict("EXECUTION_NOT_AVAILABLE");
      await iamRequest(auth.identityUrl, "/api/v1/auth/introspect", token, {});
      const next = (await c.query("UPDATE payment_adjustments SET status=CASE WHEN status='RESERVED' THEN status ELSE 'AUTHORIZED' END,execution_by=$2,execution_session=$3,version=version+1 WHERE id=$1 RETURNING *", [id, u.sub, u.sid])).rows[0];
      await audit(c, next, u.sub, "payment.adjustment_authorized");
      return view(next);
    });
    res.json({ data: result });
  });
  app.post(path + "/settle", async (req, res) => {
    enabled(); z.object({}).strict().parse(req.body);
    const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
    const u = await bound(token, id, "payment");
    const result = await tx(async c => {
      const source = AdjustmentSource.parse(await read(config.enrollmentUrl, `/internal/enrollment/adjustments/${id}/payment-authority`, token));
      checkBranch(u, source.branchId);
      const pay = (await c.query("SELECT *,clock_timestamp() AS now FROM payment_requests WHERE enrollment_id=$1 FOR UPDATE", [source.enrollmentId])).rows[0];
      if (!pay || pay.branch_id !== source.branchId) throw conflict("PAYMENT_SOURCE_REQUIRED");
      if (pay.snapshot.paymentAccount) throw conflict("LIVE_ADJUSTMENT_UNAVAILABLE");
      let r = await row(c, id, true);
      if (!r) {
        if (!source.authorized || !["PREPARED", "APPLIED"].includes(source.status) || new Date(source.deadlineAt) <= pay.now) throw conflict("ADJUSTMENT_NOT_AUTHORIZED");
        r = (await c.query(`INSERT INTO payment_adjustments(id,enrollment_id,payment_id,branch_id,amount_delta,refund_mode,source_version,policy_version,source,actor_id,actor_session,approved_by,approved_session,deadline_at,correlation_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [id, source.enrollmentId, pay.id, source.branchId, source.amountDelta, source.refundMode, source.sourceVersion, source.policyVersion, source.source, source.actorId, source.actorSession, source.approvedBy, source.approvedSession, source.deadlineAt, source.correlationId])).rows[0];
        await audit(c, r, u.sub, "payment.adjustment_waiting");
      }
      if (r.payment_id !== pay.id || r.source_version !== source.sourceVersion || Number(r.amount_delta) !== source.amountDelta) throw conflict("PAYMENT_SOURCE_CHANGED");
      if (["EXECUTED", "FAILED", "REVOKED"].includes(r.status)) return view(r);
      if (r.status === "UNKNOWN") {
        const recovered = (await c.query("SELECT id FROM synthetic_payment_executions WHERE adjustment_id=$1 AND direction<>'REVERSAL'", [id])).rows[0];
        return recovered ? persistResult(c, await change(c, r, u.sub, "EXECUTED", recovered.id, null), "settle") : view(r);
      }
      if (r.deadline_at <= pay.now && source.status !== "APPLIED") return view(await change(c, r, u.sub, "FAILED", null, "PAYMENT_AUTHORIZATION_EXPIRED"));
      const delta = Number(r.amount_delta), move = source.type !== "REFUND";
      if (!source.authorized) throw conflict("ADJUSTMENT_NOT_AUTHORIZED");
      if (delta < 0 && r.status !== "RESERVED") {
        const totals = (await c.query(`SELECT
          COALESCE((SELECT SUM(l.amount) FROM payment_ledger l WHERE l.payment_id=$1 AND (
            EXISTS(SELECT 1 FROM payment_allocations a WHERE a.ledger_id=l.id AND a.payment_id=$1 AND a.amount=l.amount) OR
            EXISTS(SELECT 1 FROM payment_reviews v WHERE v.ledger_id=l.id AND v.payment_id=$1 AND v.status='REFUND_PENDING' AND
              EXISTS(SELECT 1 FROM payment_review_decisions d WHERE d.review_id=v.id AND d.payload->>'decision'='REFUND_PENDING')))),0) AS allocated,
          COALESCE((SELECT SUM(x.amount) FROM synthetic_payment_executions x JOIN payment_adjustments a ON a.id=x.adjustment_id WHERE a.payment_id=$1 AND x.direction='CHARGE'),0) AS captured,
          COALESCE((SELECT SUM(x.amount) FROM synthetic_payment_executions x JOIN payment_adjustments a ON a.id=x.adjustment_id WHERE a.payment_id=$1 AND x.direction='REVERSAL'),0) AS reversed,
          COALESCE((SELECT SUM(-amount_delta) FROM payment_adjustments WHERE payment_id=$1 AND id<>$2 AND amount_delta<0 AND status IN ('RESERVED','UNKNOWN','EXECUTED')),0) AS refunds`, [pay.id, id])).rows[0];
        const protectedTuition = source.refundMode === "EXCESS" ? source.source.amount : 0;
        if (-delta > availableRefund(Number(totals.allocated), Number(totals.captured), Number(totals.reversed), Number(totals.refunds), protectedTuition))
          return view(await change(c, r, u.sub, "FAILED", null, "REFUND_CAP_EXCEEDED"));
        await bound(token, id, "payment");
        r = await change(c, r, u.sub, "RESERVED", null, null);
      }
      if (delta < 0 && source.status !== "APPLIED") return view(r, move);
      if (delta !== 0 && !r.execution_by) return { ...view(r), status: "WAITING" };
      if (delta !== 0) await currentFinancialDecisions(r, token, !move);
      if (move && source.status !== "APPLIED") {
        const seats = z.object({ targetHold: z.object({ status: z.string() }).nullable() }).parse(await read(config.classUrl, `/internal/classes/adjustments/${id}/payment-authority`, token));
        if (seats.targetHold?.status === "EXPIRED") throw conflict("TARGET_HOLD_EXPIRED");
        if (seats.targetHold?.status !== "HELD") throw conflict("TARGET_HOLD_REQUIRED");
      }
      const fresh = AdjustmentSource.parse(await read(config.enrollmentUrl, `/internal/enrollment/adjustments/${id}/payment-authority`, token));
      if (!fresh.authorized || fresh.status !== source.status || fresh.amountDelta !== delta) throw conflict("PAYMENT_SOURCE_CHANGED");
      await bound(token, id, "payment");
      if (delta !== 0) await currentFinancialDecisions(r, token, !move);
      if (config.adjustmentFault === "UNKNOWN_BEFORE" && delta !== 0) return view(await change(c, r, u.sub, "UNKNOWN", null, "ADAPTER_OUTCOME_UNKNOWN"));
      const receiptId = await receipt(c, id, delta < 0 ? "REFUND" : delta > 0 ? "CHARGE" : "ZERO", Math.abs(delta));
      if (config.adjustmentFault === "UNKNOWN_AFTER" && delta !== 0) return view(await change(c, r, u.sub, "UNKNOWN", null, "ADAPTER_RESPONSE_LOST"));
      return persistResult(c, await change(c, r, u.sub, "EXECUTED", receiptId, null), "settle");
    });
    res.json({ data: result });
  });
  app.post(path + "/compensate", async (req, res) => {
    enabled(); z.object({}).strict().parse(req.body);
    const id = Id.parse(req.params.id), token = bearer(req.get("authorization")), u = await bound(token, id, "payment");
    const result = await tx(async c => {
      const r = await row(c, id, true); if (!r) return null; checkBranch(u, r.branch_id);
      if (r.status === "REVOKED") return view(r);
      const source = AdjustmentSource.parse(await read(config.enrollmentUrl, `/internal/enrollment/adjustments/${id}/payment-authority`, token));
      if (!["FAILED", "REVOKED", "EXPIRED"].includes(source.status)) throw conflict("COMPENSATION_NOT_AUTHORIZED");
      const seats = z.object({ targetHold: z.object({ status: z.string() }).nullable() }).parse(await read(config.classUrl, `/internal/classes/adjustments/${id}/payment-authority`, token));
      if (seats.targetHold?.status === "COMMITTED") throw conflict("FORWARD_RECOVERY_REQUIRED");
      await bound(token, id, "payment");
      const movement = (await c.query("SELECT direction,amount FROM synthetic_payment_executions WHERE adjustment_id=$1 AND direction<>'REVERSAL'", [id])).rows[0];
      if (movement?.direction === "REFUND") throw conflict("FORWARD_RECOVERY_REQUIRED");
      if (!movement && r.status === "UNKNOWN") return view(r);
      const reversal = movement?.direction === "CHARGE" ? await receipt(c, id, "REVERSAL", Number(movement.amount)) : null;
      return persistResult(c, await change(c, r, u.sub, "REVOKED", reversal, null), "compensate");
    });
    res.json({ data: result });
  });

  async function learner(token: string) { return LearnerMemberships.parse(await read(auth.identityUrl, "/api/v1/auth/learner", token)); }
  const owns = (identity: Awaited<ReturnType<typeof learner>>, learnerId: string, branchId: string) =>
    identity.memberships.some(link => link.learnerId === learnerId && link.branchId === branchId);
  const invoiceMembers = 'JOIN jsonb_to_recordset($1::jsonb) AS l("learnerId" uuid,"branchId" uuid) ON i.learner_id=l."learnerId" AND i.branch_id=l."branchId"';
  app.get("/api/v1/student/payments", ...student, async (req, res) => {
    const token = bearer(req.get("authorization")), identity = await learner(token);
    const enrollments = z.array(z.object({ id: Id, branchId: Id, learnerId: Id })).parse(
      await read(config.enrollmentUrl, "/api/v1/student/enrollments", token));
    if (enrollments.some(e => !owns(identity, e.learnerId, e.branchId))) throw denied();
    const { rows } = await pool.query(`SELECT a.id,a.enrollment_id AS "enrollmentId",a.status,a.amount_delta::int AS delta,
      x.id AS "receiptRef",x.direction,x.created_at AS "executedAt"
      FROM payment_adjustments a LEFT JOIN synthetic_payment_executions x ON x.id=a.receipt_id
      JOIN jsonb_to_recordset($1::jsonb) AS e(id uuid,"branchId" uuid) ON a.enrollment_id=e.id AND a.branch_id=e."branchId"
      WHERE a.amount_delta<>0 ORDER BY a.created_at DESC,a.id`, [JSON.stringify(enrollments)]);
    res.set("cache-control", "no-store").json({ data: rows });
  });
  async function eligibility(token: string, enrollmentId: string) {
    const result = InvoiceSource.safeParse(await read(config.enrollmentUrl, `/api/v1/student/enrollments/${enrollmentId}`, token));
    if (!result.success) throw conflict("INVOICE_NOT_ELIGIBLE");
    return result.data;
  }
  app.get("/api/v1/student/invoices", ...student, async (req, res) => {
    const mapping = await learner(bearer(req.get("authorization")));
    const data = (await pool.query(`SELECT i.id,i.enrollment_id AS "enrollmentId",i.amount::int,i.created_at AS "createdAt" FROM payment_invoices i ${invoiceMembers} ORDER BY i.created_at DESC LIMIT 100`, [JSON.stringify(mapping.memberships)])).rows;
    res.set("cache-control", "no-store").json({ data });
  });
  app.post("/api/v1/student/invoices", ...student, async (req, res) => {
    enabled();
    const input = InvoiceInput.parse(req.body), key = Id.parse(req.get("idempotency-key")), token = bearer(req.get("authorization")), identity = await learner(token), source = await eligibility(token, input.enrollmentId);
    if (!owns(identity, source.learnerId, source.branchId)) throw denied();
    const result = await tx(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4009))", [`invoice:${identity.accountId}:${key}`]);
      const previous = (await c.query("SELECT *,payload=$3::jsonb AS identical FROM payment_invoices WHERE actor_id=$1 AND operation_key=$2", [identity.accountId, key, input])).rows[0];
      if (previous) { if (!previous.identical) throw conflict("IDEMPOTENCY_MISMATCH"); return previous; }
      const payment = (await c.query("SELECT * FROM payment_requests WHERE id=$1 AND enrollment_id=$2 FOR UPDATE", [source.paymentRequestId, input.enrollmentId])).rows[0];
      if (!payment || payment.branch_id !== source.branchId) throw conflict("INVOICE_NOT_ELIGIBLE");
      const verified = (await c.query("SELECT 1 FROM payment_matches m JOIN payment_allocations a ON a.ledger_id=m.ledger_id AND a.payment_id=m.payment_id WHERE m.payment_id=$1 AND a.amount>=m.amount", [payment.id])).rowCount;
      if (!verified) throw conflict("INVOICE_NOT_ELIGIBLE");
      const fresh = await eligibility(token, input.enrollmentId);
      if (fresh.currentEntitlement.amount !== source.currentEntitlement.amount || fresh.learnerId !== source.learnerId || fresh.branchId !== source.branchId) throw conflict("INVOICE_SOURCE_CHANGED");
      const invoice = (await c.query("INSERT INTO payment_invoices(id,payment_id,enrollment_id,learner_id,branch_id,actor_id,payload,amount,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [randomUUID(), payment.id, source.id, source.learnerId, source.branchId, identity.accountId, input, source.currentEntitlement.amount, key])).rows[0];
      await audit(c, { ...invoice, correlation_id: res.locals.correlationId }, identity.accountId, "payment.invoice_created");
      return invoice;
    });
    res.status(201).set("cache-control", "no-store").json({ data: { id: result.id, enrollmentId: result.enrollment_id, amount: Number(result.amount), createdAt: result.created_at } });
  });
  app.get("/api/v1/student/invoices/:id/download", ...student, async (req, res) => {
    const token = bearer(req.get("authorization")), identity = await learner(token);
    const invoice = (await pool.query(`SELECT i.* FROM payment_invoices i ${invoiceMembers} WHERE i.id=$2`, [JSON.stringify(identity.memberships), Id.parse(req.params.id)])).rows[0];
    if (!invoice) throw absent();
    await tx(c => audit(c, { ...invoice, correlation_id: res.locals.correlationId }, identity.accountId, "payment.invoice_downloaded"));
    const details = InvoiceInput.parse(invoice.payload);
    res.set({ "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="invoice-${invoice.id}.html"`, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
    res.send(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Hóa đơn mô phỏng · DEMO</title><h1>DEMO · MÔ PHỎNG — KHÔNG CÓ GIÁ TRỊ PHÁP LÝ</h1><p>Mã hóa đơn: ${invoice.id}</p><p>Người nhận: ${escape(details.recipientName)}</p><p>Địa chỉ: ${escape(details.address)}</p>${details.taxCode ? `<p>Mã số thuế: ${escape(details.taxCode)}</p>` : ""}<p>Tổng giá trị: ${Number(invoice.amount).toLocaleString("vi-VN")} VND</p></html>`);
  });
}
