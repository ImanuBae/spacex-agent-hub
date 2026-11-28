import { createHash, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ClassInput } from "@spacex/contracts";
import {
  authenticate,
  allowRoles,
  bearer,
  checkBranch,
  iamRequest,
  principal,
  verifyCommand,
  type AuthConfig,
  type Principal,
} from "@spacex/auth";
import { HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";
import { checkTeacherSessions, lockTeacher } from "./teacher-time.js";
import type { ClassConfig } from "./app.js";

// SQL/remote rows are validated at the authority boundaries below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Db = Pool | PoolClient;
const Id = z.uuid(),
  Empty = z.object({}).strict();
const denied = () => new HttpError(403, "FORBIDDEN", "Current bound authority required");
const conflict = (code: string) => new HttpError(409, code, "Reload the current class and impact plan");
const missing = () => new HttpError(404, "NOT_FOUND", "Class change not found");
export const ChangeInput = z
  .object({
    classId: Id,
    classVersion: z.number().int().positive(),
    kind: z.enum(["RESCHEDULE", "MAKEUP", "POSTPONE", "CANCEL", "MINIMUM_SIZE"]),
    reason: z.string().trim().min(1).max(1000),
    input: ClassInput.optional(),
    targetStatus: z.enum(["PLANNED", "OPEN", "IN_PROGRESS"]).optional(),
  })
  .strict()
  .refine(
    (v) => (v.kind === "CANCEL" ? !v.input && !v.targetStatus : !!v.input),
    "A schedule input is required except for cancellation",
  );
export const ChangeDecision = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["APPROVED", "REJECTED", "REVOKED"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const AdjustmentAuthority = z
  .object({
    id: Id,
    branchId: Id,
    learnerId: Id,
    enrollmentId: Id.optional(),
    sourceVersion: z.number().int().positive().optional(),
    classChangeId: Id.nullish(),
    sourceClassId: Id,
    sourceSeatId: Id,
    targetSeatId: Id,
    targetClassId: Id.nullish(),
    targetPackageId: Id.nullish(),
    targetClassVersion: z.number().int().positive().nullish(),
    state: z.string(),
    holdAuthorized: z.boolean(),
    commitAuthorized: z.boolean(),
    releaseTargetAuthorized: z.boolean(),
    releaseSourceAuthorized: z.boolean(),
  })
  .passthrough();
const ImpactEnrollment = z
  .object({
    enrollmentId: Id,
    seatId: Id,
    version: z.number().int().positive(),
    state: z.string(),
    resolved: z.boolean().default(false),
    choiceValid: z.boolean().default(false),
    resolvedVersion: z.number().int().positive().nullish(),
  })
  .passthrough();
type Impact = {
  holds: {
    id: string;
    enrollmentId: string;
    status: string;
    expiresAt: Date | string;
  }[];
  enrollments: z.infer<typeof ImpactEnrollment>[];
  digest: string;
};
function holdSignature(h: Impact["holds"][number]) {
  return JSON.stringify([h.id, h.enrollmentId, h.status, new Date(h.expiresAt).toISOString()]);
}
export function impactDigest(holds: Impact["holds"], enrollments: Impact["enrollments"]) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        holds: holds.map(holdSignature).sort(),
        enrollments: enrollments
          .map((e) => [e.enrollmentId, e.seatId, e.version, e.state])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      }),
    )
    .digest("hex");
}
export function assessImpact(before: Impact, current: Impact, cancelling: boolean) {
  const planned = new Map(before.enrollments.map((e) => [e.enrollmentId, e]));
  const seats = new Set(before.holds.map(holdSignature));
  const resolvedSeats = new Set<string>();
  const currentSeats = new Set(current.holds.map(holdSignature));
  if (current.holds.some((h) => !seats.has(holdSignature(h)))) return "STALE";
  for (const e of current.enrollments) {
    const original = planned.get(e.enrollmentId);
    if (!original || original.seatId !== e.seatId) return "STALE";
    if (e.resolved && e.resolvedVersion === original.version) resolvedSeats.add(e.seatId);
    else if (original.version !== e.version || original.state !== e.state) return "STALE";
    planned.delete(e.enrollmentId);
  }
  if (
    planned.size ||
    before.holds.some((h) => !currentSeats.has(holdSignature(h)) && !resolvedSeats.has(h.enrollmentId))
  )
    return "STALE";
  // Held and confirming registrations carry an immutable original schedule. Do not move that schedule under them.
  if (
    current.holds.some((h) => h.status === "HELD") ||
    (cancelling && current.holds.length) ||
    current.enrollments.some(
      (e) =>
        !resolvedSeats.has(e.seatId) &&
        (cancelling || !e.choiceValid || !["CONFIRMED", "ACTIVE"].includes(e.state)),
    )
  )
    return "WAITING";
  return "READY";
}
type Dependencies = {
  transaction: <T>(pool: Pool, work: (c: PoolClient) => Promise<T>) => Promise<T>;
  audit: (c: PoolClient, actor: string, action: string, target: string, correlation: string) => Promise<void>;
  expireClass: (c: PoolClient, id: string, correlation: string) => Promise<number>;
  classRow: (c: PoolClient, id: string, user?: Principal, lock?: boolean) => Promise<Row>;
  view: (c: PoolClient, row: Row) => Promise<Row>;
  validate: (
    c: PoolClient,
    input: ClassInput,
    req: Request,
    res: Response,
  ) => Promise<{ sessionCount: number; teacherAccountId: string | null }>;
};

export function registerChanges(
  app: Express,
  pool: Pool,
  auth: AuthConfig,
  config: ClassConfig,
  deps: Dependencies,
) {
  const { transaction, audit, expireClass, classRow, view, validate } = deps;
  async function remote(base: string | undefined, path: string, token: string): Promise<Row> {
    if (!base) throw new HttpError(503, "DEPENDENCY_NOT_CONFIGURED", "Authority source not configured");
    let response: globalThis.Response;
    try {
      response = await fetch(base + path, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new HttpError(503, "DEPENDENCY_UNAVAILABLE", "Authority source unavailable");
    }
    if (!response.ok)
      throw new HttpError(
        [400, 401, 403, 404, 409].includes(response.status) ? response.status : 503,
        "SOURCE_DENIED",
        "Authority source rejected request",
      );
    return ((await response.json()) as { data: Row }).data;
  }
  const changeView = (r: Row) => ({
    id: r.id,
    classId: r.class_id,
    branchId: r.branch_id,
    kind: r.kind,
    payload: r.payload,
    classVersion: r.class_version,
    status: ["REQUESTED", "APPROVED"].includes(r.status) && r.deadline_at <= r.now ? "EXPIRED" : r.status,
    version: r.version,
    policyVersion: r.policy_version,
    impact: r.impact,
    deadlineAt: r.deadline_at,
    decisionReason: r.decision_reason,
    result: r.result,
    requestedBy: r.actor_id,
    approverId: r.approver_id,
  });
  async function change(db: Db, id: string, lock = false) {
    const r = (
      await db.query(
        `SELECT *,clock_timestamp() AS now FROM class_changes WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [id],
      )
    ).rows[0];
    if (!r) throw missing();
    return r;
  }
  function bindChange(u: Principal, r: Row) {
    const d = u.delegation;
    if (
      d?.operation !== "classes.change" ||
      d.workflowId !== "WF-08" ||
      d.entity?.type !== "class-change" ||
      d.entity.id !== r.id ||
      d.entity.version !== 1 ||
      d.inputRef !== r.id ||
      d.branchId !== r.branch_id ||
      u.sub !== r.actor_id ||
      u.sid !== r.actor_session_id
    )
      throw denied();
  }
  async function impact(c: PoolClient, row: Row, token: string, changeId?: string): Promise<Impact> {
    const holds = (
      await c.query<Impact["holds"][number]>(
        `SELECT id,enrollment_id AS "enrollmentId",status,expires_at AS "expiresAt" FROM holds WHERE class_id=$1 AND (status='COMMITTED' OR status='HELD' AND expires_at>clock_timestamp()) ORDER BY id`,
        [row.id],
      )
    ).rows;
    const data = await remote(
      config.enrollmentUrl,
      changeId
        ? `/internal/enrollment/class-changes/${changeId}/impact`
        : `/api/v1/enrollments/class-impact?classId=${row.id}`,
      token,
    );
    const enrollments = z.array(ImpactEnrollment).parse(data);
    return { holds, enrollments, digest: impactDigest(holds, enrollments) };
  }
  const staff = [authenticate(auth), allowRoles("center_director", "branch_director", "teacher")] as const;
  app.get("/api/v1/class-changes", ...staff, async (_req, res) => {
    const u = principal(res);
    const rows = (
      await pool.query(
        "SELECT *,clock_timestamp() AS now FROM class_changes WHERE ($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2::uuid IS NULL OR actor_id=$2) ORDER BY created_at DESC LIMIT 200",
        [u.role === "center_director" ? null : u.branchIds, u.role === "teacher" ? u.sub : null],
      )
    ).rows;
    res.json({ data: rows.map(changeView) });
  });
  app.get(
    "/api/v1/class-changes/:id",
    authenticate(auth),
    allowRoles("center_director", "branch_director", "teacher", "accountant"),
    async (req, res) => {
      const r = await change(pool, Id.parse(req.params.id)),
        u = principal(res);
      checkBranch(u, r.branch_id);
      if (u.role === "teacher" && r.actor_id !== u.sub) throw denied();
      if (u.role === "accountant") {
        res.json({
          data: {
            id: r.id,
            classId: r.class_id,
            branchId: r.branch_id,
            kind: r.kind,
            status: changeView(r).status,
            version: r.version,
            correlationId: r.correlation_id,
            deadlineAt: r.deadline_at,
            impact: { enrollments: r.impact.enrollments },
          },
        });
        return;
      }
      res.json({
        data: {
          ...changeView(r),
          correlationId: r.correlation_id,
          decisions: (
            await pool.query(
              "SELECT action,reason,version,created_at FROM class_change_decisions WHERE change_id=$1 ORDER BY created_at,id",
              [r.id],
            )
          ).rows,
        },
      });
    },
  );
  const student = [authenticate(auth), allowRoles("student")] as const;
  async function learnerEnrollment(req: Request, id: string) {
    const source = await remote(
      config.enrollmentUrl,
      `/api/v1/student/enrollments/${id}`,
      bearer(req.get("authorization")),
    );
    return z
      .object({
        id: Id,
        branchId: Id,
        learnerId: Id,
        currentEntitlement: z
          .object({
            classId: Id,
            seatId: Id,
            holdId: Id.nullish(),
            state: z.string(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(source);
  }
  const studentChangeView = (r: Row) => ({
    id: r.id,
    classId: r.class_id,
    branchId: r.branch_id,
    kind: r.kind,
    classVersion: r.class_version,
    version: r.version,
    status: changeView(r).status,
    correlationId: r.correlation_id,
    deadlineAt: r.deadline_at,
    reason: r.payload.reason,
    sessions: r.payload.input?.sessions ?? [],
  });
  app.get("/api/v1/student/class-changes", ...student, async (req, res) => {
    const enrollment = await learnerEnrollment(req, Id.parse(req.query.enrollmentId));
    checkBranch(principal(res), enrollment.branchId);
    const rows = (
      await pool.query(
        "SELECT *,clock_timestamp() AS now FROM class_changes WHERE class_id=$1 AND branch_id=$2 AND status='APPROVED' AND deadline_at>clock_timestamp() ORDER BY created_at DESC LIMIT 100",
        [enrollment.currentEntitlement.classId, enrollment.branchId],
      )
    ).rows;
    res.json({
      data: rows
        .filter((r) => (r.impact as Impact).enrollments.some((e) => e.enrollmentId === enrollment.id))
        .map(studentChangeView),
    });
  });
  app.get("/api/v1/student/class-changes/:id", ...student, async (req, res) => {
    const r = await change(pool, Id.parse(req.params.id)),
      enrollment = await learnerEnrollment(req, Id.parse(req.query.enrollmentId));
    checkBranch(principal(res), enrollment.branchId);
    if (
      enrollment.branchId !== r.branch_id ||
      enrollment.currentEntitlement.classId !== r.class_id ||
      !(r.impact as Impact).enrollments.some((e) => e.enrollmentId === enrollment.id)
    )
      throw denied();
    res.json({ data: studentChangeView(r) });
  });
  app.get("/api/v1/student/class-schedule/:enrollmentId", ...student, async (req, res) => {
    const id = Id.parse(req.params.enrollmentId),
      enrollment = await learnerEnrollment(req, id),
      entitlement = enrollment.currentEntitlement;
    if (enrollment.id !== id || entitlement.state !== "ACTIVE" || !entitlement.holdId) throw denied();
    const data = await transaction(pool, async (c) => {
      const row = await classRow(c, entitlement.classId, principal(res), true);
      if (row.branch_id !== enrollment.branchId || ["CANCELLED", "DRAFT"].includes(row.status))
        throw denied();
      const seat = await committedSeat(
        c,
        entitlement.holdId!,
        entitlement.seatId,
        row.id,
        enrollment.learnerId,
      );
      const latest = await learnerEnrollment(req, id),
        current = latest.currentEntitlement;
      if (
        !seat ||
        latest.branchId !== row.branch_id ||
        latest.learnerId !== enrollment.learnerId ||
        current.state !== "ACTIVE" ||
        current.holdId !== entitlement.holdId ||
        current.seatId !== entitlement.seatId ||
        current.classId !== row.id
      )
        throw denied();
      const result = await view(c, row);
      const room = row.room_id ? (await c.query("SELECT name FROM rooms WHERE id=$1 AND branch_id=$2", [row.room_id, row.branch_id])).rows[0] : undefined;
      return {
        enrollmentId: id,
        classId: row.id,
        name: row.name,
        status: row.status,
        mode: row.mode,
        roomName: room?.name ?? null,
        onlineUrl: ["OPEN", "IN_PROGRESS"].includes(row.status) ? row.online_url : null,
        sessions: result.sessions,
        version: row.version,
      };
    });
    res.setHeader("cache-control", "no-store");
    res.json({ data });
  });
  app.post("/api/v1/class-changes", ...staff, async (req, res) => {
    const input = ChangeInput.parse(req.body),
      u = principal(res),
      token = bearer(req.get("authorization")),
      key = Id.parse(req.get("idempotency-key"));
    const data = await transaction(pool, async (c) => {
      const row = await classRow(c, input.classId, u, true);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4004))", [
        `class-change:${u.sub}:${key}`,
      ]);
      const old = (
        await c.query(
          "SELECT *,payload=$3::jsonb AS identical FROM class_changes WHERE actor_id=$1 AND operation_key=$2",
          [u.sub, key, input],
        )
      ).rows[0];
      if (old) {
        if (!old.identical) throw conflict("IDEMPOTENCY_CONFLICT");
        return changeView(old);
      }
      if (row.version !== input.classVersion) throw conflict("STALE_VERSION");
      if (["CANCELLED", "COMPLETED"].includes(row.status)) throw conflict("CLASS_LOCKED");
      if (input.input) {
        if (
          input.input.branchId !== row.branch_id ||
          input.input.courseId !== row.course_id ||
          input.input.packageId !== row.package_id ||
          input.input.code !== row.code
        )
          throw conflict("IMMUTABLE_REFERENCE");
        if (input.kind !== "MINIMUM_SIZE" && input.input.minimumSize !== row.minimum_size)
          throw conflict("MINIMUM_SIZE_DECISION_REQUIRED");
        await validate(c, input.input, req, res);
      }
      const currentImpact = await impact(c, row, token),
        id = randomUUID(),
        eventId = randomUUID();
      const delegation = (await iamRequest(auth.identityUrl, "/internal/iam/delegations", token, {
        eventId,
        workflowId: "WF-08",
        workflowVersion: 1,
        branchId: row.branch_id,
        entity: { type: "class-change", id, version: 1 },
        inputRef: id,
        operations: ["classes.change"],
      })) as { contextRef: string };
      const saved = (
        await c.query(
          `INSERT INTO class_changes(id,class_id,branch_id,actor_id,actor_session_id,operation_key,kind,payload,class_version,impact,policy_version,context_id,event_id,correlation_id,deadline_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DEMO-N8N06-2026-11-16-v1',$11,$12,$13,clock_timestamp()+interval '24 hours') RETURNING *`,
          [
            id,
            row.id,
            row.branch_id,
            u.sub,
            u.sid,
            key,
            input.kind,
            input,
            row.version,
            currentImpact,
            delegation.contextRef,
            eventId,
            id,
          ],
        )
      ).rows[0];
      await audit(c, u.sub, "class-change.requested", id, res.locals.correlationId);
      return changeView(saved);
    });
    res.status(201).json({ data });
  });
  app.post(
    "/api/v1/class-changes/:id/decision",
    authenticate(auth),
    allowRoles("center_director", "branch_director"),
    async (req, res) => {
      const id = Id.parse(req.params.id),
        input = ChangeDecision.parse(req.body),
        u = principal(res),
        token = bearer(req.get("authorization"));
      const data = await transaction(pool, async (c) => {
        const initial = await change(c, id),
          row = await classRow(c, initial.class_id, u, true),
          r = await change(c, id, true);
        checkBranch(u, r.branch_id);
        if (r.version !== input.version || r.deadline_at <= r.now) throw conflict("STALE_VERSION");
        if (input.status === "APPROVED") {
          if (r.actor_id === u.sub) throw denied();
          if (r.status !== "REQUESTED") throw conflict("INVALID_TRANSITION");
          if (row.version !== r.class_version || (await impact(c, row, token)).digest !== r.impact.digest)
            throw conflict("STALE_IMPACT");
          if (r.payload.input) await validate(c, r.payload.input, req, res);
        } else if (!["REQUESTED", "APPROVED"].includes(r.status)) throw conflict("INVALID_TRANSITION");
        const saved = (
          await c.query(
            "UPDATE class_changes SET status=$2,version=version+1,approver_id=$3,approver_session_id=$4,decision_reason=$5,approver_role=$6 WHERE id=$1 RETURNING *",
            [id, input.status, u.sub, u.sid, input.reason, u.role],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO class_change_decisions(id,change_id,actor_id,action,reason,version) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), id, u.sub, input.status, input.reason, saved.version],
        );
        if (input.status === "APPROVED")
          await enqueueEvent(c, {
            id: r.event_id,
            type: "class.change.approved",
            version: 1,
            occurredAt: new Date().toISOString(),
            correlationId: r.correlation_id,
            entityId: id,
            entityVersion: 1,
            payload: {
              entity: { type: "class-change", id, version: 1 },
              contextRef: r.context_id,
              inputRef: id,
            },
          });
        if (input.status !== "APPROVED" && r.status === "APPROVED")
          await enqueueEvent(c, {
            id: randomUUID(),
            type: "enrollment.class_change_resolution",
            version: 1,
            occurredAt: new Date().toISOString(),
            correlationId: r.correlation_id,
            causationId: r.event_id,
            entityId: id,
            payload: { classChangeId: id, status: saved.status },
          });
        await audit(c, u.sub, `class-change.${input.status.toLowerCase()}`, id, res.locals.correlationId);
        return changeView(saved);
      });
      res.json({ data });
    },
  );
  app.get("/internal/classes/changes/:id/authority", async (req, res) => {
    const r = await change(pool, Id.parse(req.params.id)),
      u = await verifyCommand(auth, bearer(req.get("authorization")), "class-schedule", "classes:change");
    bindChange(u, r);
    res.json({
      data: {
        id: r.id,
        classId: r.class_id,
        branchId: r.branch_id,
        classVersion: r.class_version,
        kind: r.kind,
        payload: r.payload,
        status: r.status,
        version: r.version,
        correlationId: r.correlation_id,
        eventId: r.event_id,
        impact: r.impact,
      },
    });
  });
  app.get("/internal/classes/changes/:id", async (req, res) => {
    const r = await change(pool, Id.parse(req.params.id)),
      u = await verifyCommand(auth, bearer(req.get("authorization")), "class-schedule", "classes:change");
    bindChange(u, r);
    res.json({
      data: {
        id: r.id,
        status: r.status,
        classId: r.class_id,
        version: r.version,
        deadlineAt: r.deadline_at,
        result: r.result,
      },
    });
  });
  app.post("/internal/classes/changes/:id/apply", async (req, res) => {
    Empty.parse(req.body);
    const id = Id.parse(req.params.id),
      token = bearer(req.get("authorization"));
    const verify = () => verifyCommand(auth, token, "class-schedule", "classes:change");
    const data = await transaction(pool, async (c) => {
      const initial = await change(c, id),
        u = await verify(),
        row = await classRow(c, initial.class_id, u, true),
        r = await change(c, id, true);
      bindChange(await verify(), r);
      if (["EXECUTED", "EXPIRED", "FAILED"].includes(r.status)) {
        if (r.job_id !== u.delegation!.jobId) throw denied();
        return r.result;
      }
      if (["REJECTED", "REVOKED"].includes(r.status)) return { id, status: r.status, classId: r.class_id };
      if (r.status !== "APPROVED") throw conflict("APPROVAL_REQUIRED");
      if (r.deadline_at <= r.now) {
        const result = { id, status: "EXPIRED", classId: r.class_id };
        await c.query(
          "UPDATE class_changes SET status='EXPIRED',version=version+1,job_id=$2,result=$3 WHERE id=$1",
          [id, u.delegation!.jobId, result],
        );
        await c.query(
          "INSERT INTO class_change_decisions(id,change_id,actor_id,action,reason,version) VALUES($1,$2,$3,'EXPIRED',$4,$5)",
          [randomUUID(), id, u.sub, "Decision deadline elapsed", r.version + 1],
        );
        await audit(c, u.sub, "class-change.expired", id, r.correlation_id);
        return result;
      }
      const verifyApproval = () =>
        iamRequest(auth.identityUrl, "/internal/iam/commands/approval-session", token, {
          accountId: r.approver_id,
          sessionId: r.approver_session_id,
        });
      await verifyApproval();
      const failPlan = async (errorCode: string) => {
        bindChange(await verify(), r);
        const result = { id, status: "FAILED", classId: row.id, errorCode };
        await c.query(
          "UPDATE class_changes SET status='FAILED',version=version+1,job_id=$2,result=$3 WHERE id=$1",
          [id, u.delegation!.jobId, result],
        );
        await c.query(
          "INSERT INTO class_change_decisions(id,change_id,actor_id,action,reason,version) VALUES($1,$2,$3,'FAILED',$4,$5)",
          [randomUUID(), id, u.sub, errorCode, r.version + 1],
        );
        await audit(c, u.sub, "class-change.failed", id, r.correlation_id);
        return result;
      };
      if (row.version !== r.class_version) return failPlan("STALE_VERSION");
      await expireClass(c, row.id, res.locals.correlationId);
      const current = await impact(c, row, token, id);
      const readiness = assessImpact(r.impact, current, r.kind === "CANCEL");
      if (readiness === "STALE") return failPlan("STALE_IMPACT");
      if (readiness === "WAITING") {
        bindChange(await verify(), r);
        const result = {
          id,
          classId: row.id,
          status: "WAITING",
          waitFor: { type: "enrollment.class_change_resolution", entityId: id },
          deadlineAt: r.deadline_at,
        };
        await c.query("UPDATE class_changes SET result=$2 WHERE id=$1", [id, result]);
        return result;
      }
      const p = ChangeInput.parse(r.payload),
        before = await view(c, row);
      let status: string;
      const org = await remote(config.orgUrl, `/internal/org/class-changes/${id}/authority`, token);
      if (
        !org.branchActive ||
        (p.input?.teacherId &&
          (!org.teacher || org.teacher.id !== p.input.teacherId || org.teacher.branchId !== row.branch_id))
      )
        throw conflict("INVALID_TEACHER_OR_BRANCH");
      if (p.kind === "CANCEL") {
        if (row.teacher_id) await lockTeacher(c, row.teacher_id);
        await c.query("UPDATE sessions SET active=false,retired_revision=$2 WHERE class_id=$1 AND active", [
          row.id,
          row.version + 1,
        ]);
        status = "CANCELLED";
        await c.query("UPDATE classes SET status=$2,version=version+1 WHERE id=$1", [row.id, status]);
      } else {
        const input = p.input!;
        if (input.roomId) {
          const room = (await c.query("SELECT * FROM rooms WHERE id=$1 FOR SHARE", [input.roomId])).rows[0];
          if (!room || !room.active || room.branch_id !== row.branch_id || room.capacity < input.capacity)
            throw conflict("INVALID_ROOM");
        }
        if (input.capacity < current.holds.length) throw conflict("CAPACITY_CONFLICT");
        if (input.sessions.length !== row.session_count) throw conflict("SESSION_COUNT");
        const immutable = (
          await c.query(
            "SELECT starts_at,ends_at FROM sessions WHERE class_id=$1 AND active AND starts_at<=$2",
            [row.id, r.now],
          )
        ).rows;
        const past = input.sessions.filter((s) => Date.parse(s.startsAt) <= r.now.getTime());
        const future = input.sessions.filter((s) => Date.parse(s.startsAt) > r.now.getTime());
        if (
          immutable.length !== past.length ||
          immutable.some(
            (s) =>
              !past.some(
                (pastSession) =>
                  Date.parse(pastSession.startsAt) === s.starts_at.getTime() &&
                  Date.parse(pastSession.endsAt) === s.ends_at.getTime(),
              ),
          )
        )
          throw conflict("PAST_SESSION_CHANGED");
        if (p.kind === "MAKEUP" && future.length === 0) throw conflict("MAKEUP_SESSION_REQUIRED");
        for (const teacher of [...new Set<string>([row.teacher_id, input.teacherId].filter(Boolean))].sort())
          await lockTeacher(c, teacher);
        if (input.teacherId) await checkTeacherSessions(c, input.teacherId, future);
        status = p.kind === "POSTPONE" ? "PLANNED" : (p.targetStatus ?? row.status);
        const transitions: Record<string, string[]> = {
          DRAFT: ["PLANNED"],
          PLANNED: ["OPEN"],
          OPEN: ["IN_PROGRESS", ...(p.kind === "POSTPONE" ? ["PLANNED"] : [])],
        };
        if (status !== row.status && !transitions[row.status]?.includes(status))
          throw conflict("INVALID_TRANSITION");
        if (
          status !== row.status &&
          ["OPEN", "IN_PROGRESS"].includes(status) &&
          r.approver_role !== "branch_director"
        )
          throw denied();
        if (
          p.kind === "MINIMUM_SIZE" &&
          row.decision_at <= r.now &&
          before.committed < input.minimumSize &&
          status !== "PLANNED"
        )
          throw conflict("MINIMUM_SIZE_DECISION_REQUIRED");
        if (
          status === "IN_PROGRESS" &&
          (before.held > 0 ||
            before.committed < input.minimumSize ||
            !input.sessions.some((s) => Date.parse(s.startsAt) <= r.now.getTime()))
        )
          throw conflict("START_CONDITIONS");
        await c.query(
          "UPDATE sessions SET active=false,retired_revision=$3 WHERE class_id=$1 AND active AND starts_at>$2",
          [row.id, r.now, row.version + 1],
        );
        for (const s of future.sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
          await c.query(
            "INSERT INTO sessions(id,class_id,teacher_id,room_id,starts_at,ends_at,schedule_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [randomUUID(), row.id, input.teacherId, input.roomId, s.startsAt, s.endsAt, row.version + 1],
          );
        await c.query(
          `UPDATE classes SET name=$2,teacher_id=$3,teacher_account_id=$4,mode=$5,room_id=$6,online_url=$7,capacity=$8,minimum_size=$9,
          registration_closes_at=$10,decision_at=$11,status=$12,version=version+1,preserve_schedule_history=true,minimum_policy_version=CASE WHEN $13 THEN $14 ELSE minimum_policy_version END WHERE id=$1`,
          [
            row.id,
            input.name,
            input.teacherId,
            org.teacher?.accountId ?? null,
            input.mode,
            input.roomId,
            input.onlineUrl,
            input.capacity,
            input.minimumSize,
            input.registrationClosesAt,
            input.decisionAt,
            status,
            p.kind === "MINIMUM_SIZE",
            r.policy_version,
          ],
        );
      }
      bindChange(await verify(), r);
      await verifyApproval();
      if (assessImpact(r.impact, await impact(c, row, token, id), r.kind === "CANCEL") !== "READY")
        throw conflict("STALE_IMPACT");
      const after = await view(c, await classRow(c, row.id));
      if (
        status === "OPEN" &&
        (after.missingConditions.length ||
          (status !== row.status &&
            !(
              await c.query(
                "SELECT registration_closes_at>clock_timestamp() AS before_cutoff FROM classes WHERE id=$1",
                [row.id],
              )
            ).rows[0].before_cutoff))
      )
        throw conflict("OPEN_CONDITIONS");
      if (status !== row.status)
        await c.query(
          "INSERT INTO class_status_changes(id,class_id,version,previous_status,status,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [randomUUID(), row.id, after.version, row.status, status, p.reason, u.sub],
        );
      const result = {
        id,
        status: "EXECUTED",
        classId: row.id,
        sourceVersion: after.version,
        previousVersion: row.version,
        classStatus: status,
      };
      const saved = await c.query(
        "UPDATE class_changes SET status='EXECUTED',version=version+1,job_id=$2,result=$3 WHERE id=$1 AND deadline_at>clock_timestamp() RETURNING id",
        [id, u.delegation!.jobId, result],
      );
      if (!saved.rowCount) throw conflict("APPROVAL_EXPIRED");
      await c.query(
        "INSERT INTO class_change_decisions(id,change_id,actor_id,action,reason,version) VALUES($1,$2,$3,'EXECUTED',$4,$5)",
        [randomUUID(), id, u.sub, p.reason, r.version + 1],
      );
      await audit(c, u.sub, "class-change.executed", id, res.locals.correlationId);
      await enqueueEvent(c, {
        id: randomUUID(),
        type: status === "CANCELLED" ? "class.cancelled" : "class.schedule_changed",
        version: 1,
        occurredAt: new Date().toISOString(),
        correlationId: r.correlation_id,
        causationId: r.event_id,
        entityId: row.id,
        entityVersion: after.version,
        payload: {
          classId: row.id,
          targetId: row.id,
          branchId: row.branch_id,
          sourceVersion: after.version,
          changeRef: id,
          status,
        },
      });
      return result;
    });
    if (data.status === "FAILED") throw conflict(data.errorCode);
    res.json({ data });
  });

  async function committedSeat(db: Db, holdId: string, seatId: string, classId: string, learnerId: string) {
    return !!(
      await db.query(
        "SELECT 1 FROM holds WHERE id=$1 AND enrollment_id=$2 AND class_id=$3 AND learner_id=$4 AND status='COMMITTED'",
        [holdId, seatId, classId, learnerId],
      )
    ).rowCount;
  }
  async function adjustmentSource(id: string, token: string) {
    return AdjustmentAuthority.parse(
      await remote(config.enrollmentUrl, `/internal/enrollment/adjustments/${id}/seat-authority`, token),
    );
  }
  async function linkedPlanValid(db: Db, source: z.infer<typeof AdjustmentAuthority>) {
    if (!source.classChangeId) return true;
    const plan = (
      await db.query(
        `SELECT cc.impact FROM class_changes cc JOIN classes c ON c.id=cc.class_id
       WHERE cc.id=$1 AND cc.class_id=$2 AND cc.branch_id=$3 AND cc.kind='CANCEL' AND cc.status='APPROVED'
         AND cc.deadline_at>clock_timestamp() AND cc.class_version=c.version`,
        [source.classChangeId, source.sourceClassId, source.branchId],
      )
    ).rows[0];
    return (
      !!plan &&
      (plan.impact as Impact).enrollments.some(
        (e) =>
          e.enrollmentId === source.enrollmentId &&
          e.seatId === source.sourceSeatId &&
          e.version === source.sourceVersion,
      )
    );
  }
  function bindAdjustment(
    u: Principal,
    id: string,
    s: z.infer<typeof AdjustmentAuthority>,
    operation = "classes.adjust",
  ) {
    const d = u.delegation;
    if (
      d?.operation !== operation ||
      d.workflowId !== "WF-09" ||
      d.entity?.type !== "adjustment" ||
      d.entity.id !== id ||
      d.inputRef !== id ||
      s.id !== id ||
      d.branchId !== s.branchId
    )
      throw denied();
  }
  const seatView = (r: Row | undefined) =>
    r
      ? {
          id: r.id,
          classId: r.class_id,
          packageId: r.package_id,
          learnerId: r.learner_id,
          enrollmentId: r.enrollment_id,
          status: r.status === "HELD" && r.expires_at <= r.now ? "EXPIRED" : r.status,
          expiresAt: r.expires_at,
          serverTime: r.now,
        }
      : null;
  async function seats(db: Db, s: z.infer<typeof AdjustmentAuthority>) {
    const rows = (
      await db.query(
        "SELECT *,clock_timestamp() AS now FROM holds WHERE enrollment_id=ANY($1::uuid[]) ORDER BY created_at DESC",
        [[s.sourceSeatId, s.targetSeatId]],
      )
    ).rows;
    const target = rows.find((r) => r.enrollment_id === s.targetSeatId),
      source = rows.find((r) => r.enrollment_id === s.sourceSeatId);
    if (
      (target &&
        (target.class_id !== s.targetClassId ||
          target.package_id !== s.targetPackageId ||
          target.learner_id !== s.learnerId)) ||
      (source && (source.class_id !== s.sourceClassId || source.learner_id !== s.learnerId))
    )
      throw conflict("ADJUSTMENT_MISMATCH");
    return {
      targetHold: seatView(target),
      sourceHold: seatView(source),
      committed: target?.status === "COMMITTED",
    };
  }
  for (const [suffix, audience, scope, operation, sourcePath] of [
    ["", "class-schedule", "classes:adjust", "classes.adjust", "seat-authority"],
    ["/enrollment-authority", "enrollment", "enrollment:adjust", "enrollment.adjust", "authority"],
    ["/payment-authority", "payment", "payment:refund", "payment.refund", "payment-authority"],
  ] as const)
    app.get(`/internal/classes/adjustments/:id${suffix}`, async (req, res) => {
      const id = Id.parse(req.params.id),
        token = bearer(req.get("authorization"));
      const u = await verifyCommand(auth, token, audience, scope);
      const s = AdjustmentAuthority.parse(
        await remote(config.enrollmentUrl, `/internal/enrollment/adjustments/${id}/${sourcePath}`, token),
      );
      bindAdjustment(u, id, s, operation);
      const data = await seats(pool, s);
      if (audience === "enrollment") {
        const remainingSessions = (
          await pool.query(
            "SELECT count(*)::int AS n FROM sessions WHERE class_id=$1 AND active AND ends_at>clock_timestamp()",
            [s.sourceClassId],
          )
        ).rows[0].n;
        res.json({ data: { ...data, remainingSessions, classChangeValid: await linkedPlanValid(pool, s) } });
        return;
      }
      res.json({ data });
    });
  for (const action of ["hold-target", "commit-target", "release-target", "release-source"] as const)
    app.post(`/internal/classes/adjustments/:id/${action}`, async (req, res) => {
      Empty.parse(req.body);
      const id = Id.parse(req.params.id),
        token = bearer(req.get("authorization")),
        verify = () => verifyCommand(auth, token, "class-schedule", "classes:adjust");
      const u = await verify(),
        initial = await adjustmentSource(id, token);
      bindAdjustment(u, id, initial);
      const data = await transaction(pool, async (c) => {
        const ids = [
          ...new Set([initial.sourceClassId, initial.targetClassId].filter((v): v is string => !!v)),
        ].sort();
        for (const classId of ids) {
          await classRow(c, classId, u, true);
          await expireClass(c, classId, res.locals.correlationId);
        }
        const s = await adjustmentSource(id, token);
        bindAdjustment(await verify(), id, s);
        if (
          s.sourceClassId !== initial.sourceClassId ||
          s.targetClassId !== initial.targetClassId ||
          s.targetSeatId !== initial.targetSeatId ||
          s.sourceSeatId !== initial.sourceSeatId
        )
          throw conflict("ADJUSTMENT_CHANGED");
        const payload = {
            id,
            action,
            branchId: s.branchId,
            learnerId: s.learnerId,
            sourceClassId: s.sourceClassId,
            sourceSeatId: s.sourceSeatId,
            sourceVersion: s.sourceVersion ?? null,
            classChangeId: s.classChangeId ?? null,
            targetSeatId: s.targetSeatId,
            targetClassId: s.targetClassId ?? null,
            targetPackageId: s.targetPackageId ?? null,
            targetClassVersion: s.targetClassVersion ?? null,
          },
          key = `adjustment:${id}:${action}`;
        const old = (
          await c.query(
            "SELECT *,payload=$2::jsonb AS identical FROM class_adjustment_operations WHERE operation_key=$1",
            [key, payload],
          )
        ).rows[0];
        if (old) {
          if (!old.identical) throw conflict("IDEMPOTENCY_CONFLICT");
          return old.result;
        }
        const current = await seats(c, s),
          target = current.targetHold;
        const allowed =
          action === "hold-target"
            ? s.holdAuthorized
            : action === "commit-target"
              ? s.commitAuthorized
              : action === "release-target"
                ? s.releaseTargetAuthorized
                : s.releaseSourceAuthorized;
        if (!allowed) throw conflict("ADJUSTMENT_NOT_AUTHORIZED");
        if (action === "hold-target" || action === "commit-target") {
          if (!(await linkedPlanValid(c, s))) throw conflict("CLASS_CHANGE_STALE");
          if (!s.targetClassId || !s.targetPackageId || s.targetSeatId === s.sourceSeatId)
            throw conflict("TARGET_REQUIRED");
          const row = await classRow(c, s.targetClassId, u),
            now = (await c.query("SELECT clock_timestamp() AS now")).rows[0].now;
          if (row.branch_id !== s.branchId || row.package_id !== s.targetPackageId)
            throw conflict("PACKAGE_MISMATCH");
          if (
            row.status !== "OPEN" ||
            row.registration_closes_at <= now ||
            row.version !== s.targetClassVersion
          )
            throw conflict("TARGET_CHANGED");
          if ((await view(c, row)).missingConditions.length) throw conflict("CLASS_INCOMPLETE");
          const duplicate = (
            await c.query(
              "SELECT 1 FROM holds WHERE class_id=$1 AND learner_id=$2 AND enrollment_id<>$3 AND status IN ('HELD','COMMITTED')",
              [row.id, s.learnerId, s.targetSeatId],
            )
          ).rowCount;
          if (duplicate) throw conflict("DUPLICATE_LEARNER");
          const count = (
            await c.query(
              "SELECT count(*)::int AS n FROM holds WHERE class_id=$1 AND enrollment_id<>$2 AND status IN ('HELD','COMMITTED')",
              [row.id, s.targetSeatId],
            )
          ).rows[0].n;
          if (count >= row.capacity) throw conflict("SOLD_OUT");
          if (action === "hold-target") {
            if (target && target.status !== "HELD") throw conflict("TARGET_HOLD_EXPIRED");
            if (!target) {
              const h = (
                await c.query(
                  `INSERT INTO holds(id,class_id,package_id,learner_id,enrollment_id,actor_id,status,expires_at,operation_key,request_payload)
              VALUES($1,$2,$3,$4,$5,$6,'HELD',clock_timestamp()+make_interval(secs=>$7),$5,$8) RETURNING id`,
                  [
                    randomUUID(),
                    row.id,
                    s.targetPackageId,
                    s.learnerId,
                    s.targetSeatId,
                    u.sub,
                    config.ttlSeconds,
                    payload,
                  ],
                )
              ).rows[0];
              await audit(c, u.sub, "hold.created", h.id, res.locals.correlationId);
            }
          } else {
            const payment = z
              .object({
                settled: z.boolean(),
                receiptRef: z.string().nullable(),
                delta: z.number().int(),
                adapter: z.literal("SYNTHETIC"),
              })
              .passthrough()
              .parse(
                await remote(config.paymentUrl, `/internal/payment/adjustments/${id}/seat-authority`, token),
              );
            if (!payment.settled) throw conflict("PAYMENT_DELTA_REQUIRED");
            if (!target || target.status !== "HELD") throw conflict("TARGET_HOLD_REQUIRED");
            const committed = await c.query(
              "UPDATE holds SET status='COMMITTED' WHERE id=$1 AND status='HELD' AND expires_at>clock_timestamp() RETURNING id",
              [target.id],
            );
            if (!committed.rowCount) throw conflict("TARGET_HOLD_EXPIRED");
            await audit(c, u.sub, "hold.committed", target.id, res.locals.correlationId);
          }
        } else {
          const h = action === "release-target" ? target : current.sourceHold;
          if (action === "release-target" && h?.status === "COMMITTED")
            throw conflict("TARGET_ALREADY_COMMITTED");
          if (h && ["HELD", "COMMITTED"].includes(h.status)) {
            await c.query("UPDATE holds SET status='CANCELLED' WHERE id=$1", [h.id]);
            await audit(c, u.sub, "hold.cancelled", h.id, res.locals.correlationId);
          }
        }
        const final = await adjustmentSource(id, token);
        bindAdjustment(await verify(), id, final);
        const remains =
          action === "hold-target"
            ? final.holdAuthorized
            : action === "commit-target"
              ? final.commitAuthorized
              : action === "release-target"
                ? final.releaseTargetAuthorized
                : final.releaseSourceAuthorized;
        if (
          !remains ||
          final.sourceClassId !== s.sourceClassId ||
          final.sourceSeatId !== s.sourceSeatId ||
          final.sourceVersion !== s.sourceVersion ||
          final.classChangeId !== s.classChangeId ||
          final.learnerId !== s.learnerId ||
          final.targetClassId !== s.targetClassId ||
          final.targetSeatId !== s.targetSeatId ||
          final.targetPackageId !== s.targetPackageId ||
          final.targetClassVersion !== s.targetClassVersion
        )
          throw conflict("ADJUSTMENT_CHANGED");
        if (["hold-target", "commit-target"].includes(action) && !(await linkedPlanValid(c, final)))
          throw conflict("CLASS_CHANGE_STALE");
        if (
          action === "commit-target" &&
          !(await remote(config.paymentUrl, `/internal/payment/adjustments/${id}/seat-authority`, token))
            .settled
        )
          throw conflict("PAYMENT_DELTA_CHANGED");
        const result = await seats(c, s);
        if (action === "hold-target" && result.targetHold?.status !== "HELD")
          throw conflict("TARGET_HOLD_EXPIRED");
        if (
          ["hold-target", "commit-target"].includes(action) &&
          !(
            await c.query(
              "SELECT registration_closes_at>clock_timestamp() AS open FROM classes WHERE id=$1",
              [s.targetClassId],
            )
          ).rows[0].open
        )
          throw conflict("REGISTRATION_CLOSED");
        await c.query(
          "INSERT INTO class_adjustment_operations(operation_key,adjustment_id,action,payload,result) VALUES($1,$2,$3,$4,$5)",
          [key, id, action, payload, result],
        );
        return result;
      });
      res.json({ data });
    });
  app.get("/internal/classes/notifications/:intentId/source", async (req, res) => {
    const id = Id.parse(req.params.intentId),
      token = bearer(req.get("authorization")),
      u = await verifyCommand(auth, token, "notification", "notification:deliver");
    const d = u.delegation;
    if (
      d?.workflowId !== "WF-10" ||
      d.operation !== "notification.deliver" ||
      d.entity?.type !== "notification" ||
      d.entity.id !== id ||
      d.inputRef !== id
    )
      throw denied();
    const source = z
      .object({ classId: Id, branchId: Id, learnerId: Id })
      .passthrough()
      .parse(await remote(config.notificationUrl, `/internal/notification/intents/${id}/authority`, token));
    if (source.branchId !== d.branchId) throw denied();
    const data = await transaction(pool, async (c) => {
      const row = await classRow(c, source.classId, u, true);
      const enrollment = z
        .object({
          classId: Id,
          branchId: Id,
          learnerId: Id,
          holdId: Id.nullish(),
          seatId: Id,
          valid: z.boolean(),
          committed: z.boolean(),
        })
        .passthrough()
        .parse(await remote(config.enrollmentUrl, `/internal/enrollment/notifications/${id}`, token));
      if (enrollment.branchId !== source.branchId || enrollment.learnerId !== source.learnerId)
        throw denied();
      const committed =
        enrollment.valid &&
        enrollment.committed &&
        enrollment.classId === row.id &&
        !!enrollment.holdId &&
        (await committedSeat(c, enrollment.holdId, enrollment.seatId, row.id, source.learnerId));
      return {
        classId: row.id,
        version: row.version,
        status: row.status,
        sessions: (await view(c, row)).sessions,
        committed,
      };
    });
    res.json({ data });
  });
}
