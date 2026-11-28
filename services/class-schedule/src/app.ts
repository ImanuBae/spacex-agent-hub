import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  ClassInput,
  ClassUpdate,
  ClassTransition,
  ClassQuery,
  HoldInput,
  RoomInput,
  DelegatedPrincipal,
  MachineClaims,
} from "@spacex/contracts";
import {
  authenticateDomain,
  allowRoles,
  principal,
  checkBranch,
  authenticate,
  bearer,
  iamRequest,
  verifyCommand,
  type AuthConfig,
  type Principal,
} from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent, replayDeadEvent } from "@spacex/messaging";
import { checkTeacherSessions, registerTeacherTime } from "./teacher-time.js";
import { registerChanges } from "./changes.js";

export interface ClassConfig {
  orgUrl: string;
  catalogUrl: string;
  demo: boolean;
  ttlSeconds: number;
  enrollmentSecret?: string;
  messagingEnabled?: boolean;
  enrollmentUrl?: string;
  paymentUrl?: string;
  notificationUrl?: string;
}
const Id = z.uuid();
export const EnrollmentCommitInput = z.object({ matchRef: Id }).strict();
export const EnrollmentSeatInput = z.object({}).strict();
const seatAuthority = z.object({
  id: Id, branchId: Id, classId: Id, packageId: Id, learnerId: Id,
  state: z.string(), classVersion: z.number().int().positive(), quoteCurrent: z.boolean().optional(), matchRef: Id.nullish(),
  releaseAuthorized: z.boolean().optional(),
  quote: z.object({ packageId: Id, courseId: Id }).passthrough(),
}).passthrough();
const matchAuthority = z.object({ id: Id, enrollmentId: Id, eligible: z.boolean(), late: z.boolean() }).passthrough();
// pg's untyped row boundary is converted explicitly by the view functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const missing = () => new HttpError(404, "NOT_FOUND", "Resource not found");
const fail = (code: string, message: string) =>
  new HttpError(409, code, message);
const scope = (user: Principal) =>
  user.delegation ? [user.delegation.branchId] : user.role === "center_director" ? null : user.branchIds;
const holdView = (r: Row, now: Date) => ({
  id: r.id,
  classId: r.class_id,
  packageId: r.package_id,
  learnerId: r.learner_id,
  enrollmentId: r.enrollment_id,
  actorId: r.actor_id,
  operationKey: r.operation_key,
  status: r.status === "HELD" && r.expires_at <= now ? "EXPIRED" : r.status,
  expiresAt: r.expires_at,
  serverTime: now,
});
const roomView = (r: Row) => ({
  id: r.id,
  branchId: r.branch_id,
  name: r.name,
  capacity: r.capacity,
  active: r.active,
});
const CONDITIONS = (r: Row, sessions: Row[]) => [
  ...(!r.teacher_id ? ["Chưa phân công giảng viên"] : []),
  ...(r.mode === "onsite" && !r.room_id ? ["Chưa có phòng học"] : []),
  ...(r.mode === "online" && !r.online_url
    ? ["Chưa có liên kết học online"]
    : []),
  ...(sessions.length !== r.session_count
    ? [`Cần đủ ${r.session_count} buổi theo gói`]
    : []),
  ...(sessions.some((s) => s.starts_at <= r.registration_closes_at)
    ? ["Hạn đăng ký phải trước buổi đầu"]
    : []),
  ...(r.decision_at < r.registration_closes_at ||
  (sessions.length && r.decision_at >= sessions[0].starts_at)
    ? ["Hạn quyết định phải từ hạn đăng ký đến trước buổi đầu"]
    : []),
  ...(r.minimum_size > 0 && !r.minimum_policy_version
    ? [
        "Chính sách duyệt dưới sĩ số tối thiểu C02/CS-7 chưa được chốt; demo chỉ mở lớp minimumSize=0",
      ]
    : []),
];
async function audit(
  c: PoolClient,
  actor: string,
  action: string,
  target: string,
  correlation: string,
) {
  await c.query(
    "INSERT INTO class_audit VALUES($1,$2,$3,$4,$5,clock_timestamp())",
    [randomUUID(), actor, action, target, correlation],
  );
  const state = action.startsWith("class.")
    ? (await c.query("SELECT id AS \"aggregateId\",version AS \"aggregateVersion\",branch_id AS \"branchId\",status FROM classes WHERE id=$1", [target])).rows[0]
    : action.startsWith("hold.")
      ? (await c.query("SELECT h.class_id AS \"aggregateId\",c.version AS \"classVersion\",c.branch_id AS \"branchId\",h.status FROM holds h JOIN classes c ON c.id=h.class_id WHERE h.id=$1", [target])).rows[0]
      : action.startsWith("teacher-time.")
        ? (await c.query("SELECT id AS \"aggregateId\",version AS \"aggregateVersion\",branch_id AS \"branchId\",status FROM teacher_time WHERE id=$1", [target])).rows[0]
        : {};
  await enqueueEvent(c, {
    id: randomUUID(), type: action, version: 1, occurredAt: new Date().toISOString(),
    correlationId: correlation, payload: { targetId: target, actorId: actor, ...state },
  });
}
export async function transaction<T>(
  pool: Pool,
  work: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='5s'");
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    const code = (e as { code?: string }).code;
    if (code === "23P01")
      throw fail(
        "SCHEDULE_CONFLICT",
        "Trùng buổi học, giảng viên hoặc phòng; các buổi kề nhau được phép",
      );
    if (["55P03", "40P01"].includes(code ?? ""))
      throw fail(
        "RETRY_OPERATION",
        "Concurrent update; retry the same operation",
      );
    throw e;
  } finally {
    c.release();
  }
}
// All seat mutations lock the class first. Availability is derived, never maintained as a counter.
export async function expireClass(
  c: PoolClient,
  classId: string,
  correlation: string,
) {
  const { rows } = await c.query(
    "UPDATE holds SET status='EXPIRED' WHERE class_id=$1 AND status='HELD' AND expires_at<=clock_timestamp() RETURNING id",
    [classId],
  );
  for (const r of rows)
    await audit(c, "expiry-worker", "hold.expired", r.id, correlation);
  return rows.length;
}
export async function expireHolds(pool: Pool) {
  const { rows } = await pool.query(
    "SELECT DISTINCT class_id FROM holds WHERE status='HELD' AND expires_at<=clock_timestamp() LIMIT 100",
  );
  let expired = 0;
  for (const r of rows)
    expired += await transaction(pool, async (c) => {
      await c.query("SELECT id FROM classes WHERE id=$1 FOR UPDATE", [
        r.class_id,
      ]);
      return expireClass(c, r.class_id, randomUUID());
    });
  return expired;
}

export function createClassApp(
  pool: Pool,
  auth: AuthConfig,
  config: ClassConfig,
) {
  if (
    !Number.isInteger(config.ttlSeconds) ||
    config.ttlSeconds < 1 ||
    config.ttlSeconds > 1200 ||
    (!config.demo && config.ttlSeconds !== 1200)
  )
    throw new Error("Invalid hold TTL");
  async function upstream<T>(
    base: string,
    path: string,
    req: Request,
    res: Response,
  ): Promise<T> {
    let response: globalThis.Response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: {
          authorization: req.get("authorization")!,
          "x-correlation-id": res.locals.correlationId,
          traceparent: res.locals.traceparent,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new HttpError(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Cannot validate Org/Catalog",
      );
    }
    if (response.status === 404)
      throw fail("INVALID_REFERENCE", "Unknown Org/Catalog reference");
    if (response.status === 403)
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Reference outside authorized scope",
      );
    if (!response.ok)
      throw new HttpError(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Cannot validate Org/Catalog",
      );
    return ((await response.json()) as { data: T }).data;
  }
  async function offer(
    input: {
      packageId: string;
      courseId: string;
      branchId: string;
      mode: string;
    },
    req: Request,
    res: Response,
  ) {
    const [p, course] = await Promise.all([
      upstream<Row>(
        config.catalogUrl,
        `/api/v1/packages/${input.packageId}`,
        req,
        res,
      ),
      upstream<Row>(
        config.catalogUrl,
        `/api/v1/courses/${input.courseId}`,
        req,
        res,
      ),
    ]);
    if (p.courseId !== input.courseId)
      throw fail("PACKAGE_MISMATCH", "Gói không thuộc khóa học");
    if (p.status !== "active" || course.status !== "active")
      throw fail("NOT_SELLABLE", "Khóa/gói đã ngừng bán hoặc chưa hoạt động");
    if (
      !course.deliveryModes.includes(input.mode) ||
      (course.branchIds.length && !course.branchIds.includes(input.branchId))
    )
      throw fail(
        "NOT_SELLABLE",
        "Khóa không bán tại chi nhánh/hình thức đã chọn",
      );
    return p;
  }
  async function validate(
    c: PoolClient,
    input: Pick<
      ClassInput,
      | "branchId"
      | "courseId"
      | "packageId"
      | "mode"
      | "teacherId"
      | "roomId"
      | "onlineUrl"
      | "capacity"
    >,
    req: Request,
    res: Response,
  ) {
    checkBranch(principal(res), input.branchId);
    const [branch, p, teachers] = await Promise.all([
      upstream<Row>(
        config.orgUrl,
        `/api/v1/branches/${input.branchId}`,
        req,
        res,
      ),
      offer(input, req, res),
      input.teacherId
        ? upstream<Row[]>(config.orgUrl, "/api/v1/teachers", req, res)
        : Promise.resolve([]),
    ]);
    if (!branch.active || branch.kind !== "branch")
      throw fail("INVALID_BRANCH", "Chọn chi nhánh đang hoạt động");
    const teacher = teachers.find(
      (t) => t.id === input.teacherId && t.branchId === input.branchId,
    );
    if (input.teacherId && !teacher)
      throw fail(
        "INVALID_TEACHER",
        "Giảng viên không hoạt động hoặc khác chi nhánh",
      );
    if (input.mode === "online" && input.roomId)
      throw fail("INVALID_ROOM", "Lớp online không sử dụng phòng");
    if (input.mode === "onsite" && input.onlineUrl)
      throw fail("INVALID_MODE", "Lớp tại phòng không sử dụng liên kết online");
    if (input.roomId) {
      const room = (
        await c.query("SELECT * FROM rooms WHERE id=$1 FOR SHARE", [
          input.roomId,
        ])
      ).rows[0];
      if (
        !room ||
        !room.active ||
        room.branch_id !== input.branchId ||
        room.capacity < input.capacity
      )
        throw fail(
          "INVALID_ROOM",
          "Phòng không hoạt động, khác chi nhánh hoặc thiếu sức chứa",
        );
    }
    return {
      sessionCount: p.sessionCount,
      teacherAccountId: teacher?.accountId ?? null,
    };
  }
  async function classRow(
    c: PoolClient,
    id: string,
    user?: Principal,
    lock = false,
  ) {
    const row = (
      await c.query(
        `SELECT * FROM classes WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      )
    ).rows[0];
    if (!row) throw missing();
    if (user) {
      checkBranch(user, row.branch_id);
      if (user.role === "teacher" && row.teacher_account_id !== user.sub)
        throw new HttpError(403, "FORBIDDEN", "Class not assigned to you");
    }
    return row;
  }
  async function view(c: PoolClient, row: Row) {
    const sessions = (
      await c.query(
        `SELECT starts_at,ends_at FROM sessions WHERE class_id=$1 AND (active OR $2='CANCELLED' AND
          (retired_revision=$3 OR retired_revision IS NULL AND NOT EXISTS(SELECT 1 FROM sessions WHERE class_id=$1 AND retired_revision=$3))) ORDER BY starts_at`,
        [row.id,row.status,row.version],
      )
    ).rows;
    const counts = (
      await c.query(
        "SELECT transaction_timestamp() AS now, count(*) FILTER(WHERE status='COMMITTED')::int AS committed, count(*) FILTER(WHERE status='HELD' AND expires_at>transaction_timestamp())::int AS held FROM holds WHERE class_id=$1",
        [row.id],
      )
    ).rows[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      courseId: row.course_id,
      packageId: row.package_id,
      branchId: row.branch_id,
      teacherId: row.teacher_id,
      mode: row.mode,
      roomId: row.room_id,
      onlineUrl: row.online_url,
      capacity: row.capacity,
      minimumSize: row.minimum_size,
      registrationClosesAt: row.registration_closes_at,
      decisionAt: row.decision_at,
      status: row.status,
      version: row.version,
      sessions: sessions.map((s) => ({
        startsAt: s.starts_at,
        endsAt: s.ends_at,
      })),
      committed: counts.committed,
      held: counts.held,
      available: row.capacity - counts.committed - counts.held,
      serverTime: counts.now,
      missingConditions: [...CONDITIONS(row, sessions), ...(row.minimum_policy_version && row.decision_at <= counts.now && counts.committed < row.minimum_size ? ["Sĩ số dưới mức tối thiểu tại hạn quyết định: cần kế hoạch hoãn/hủy đã duyệt"] : [])],
    };
  }
  function guestView(row: Awaited<ReturnType<typeof view>>) {
    return { id: row.id, name: row.name, courseId: row.courseId, packageId: row.packageId, mode: row.mode,
      registrationClosesAt: row.registrationClosesAt, status: row.status, version: row.version,
      sessions: row.sessions, available: row.available, serverTime: row.serverTime };
  }
  async function saveSessions(c: PoolClient, id: string, input: ClassInput) {
    if (input.teacherId) await checkTeacherSessions(c, input.teacherId, input.sessions);
    await c.query("DELETE FROM sessions WHERE class_id=$1 AND active AND NOT (SELECT preserve_schedule_history FROM classes WHERE id=$1)", [id]);
    await c.query("UPDATE sessions SET active=false,retired_revision=(SELECT version FROM classes WHERE id=$1) WHERE class_id=$1 AND active", [id]);
    // Ordered inserts avoid opposite lock acquisition order across concurrent requests.
    for (const s of [...input.sessions].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    ))
      await c.query("INSERT INTO sessions(id,class_id,teacher_id,room_id,starts_at,ends_at,schedule_revision) VALUES($1,$2,$3,$4,$5,$6,(SELECT version FROM classes WHERE id=$2))", [
        randomUUID(),
        id,
        input.teacherId,
        input.roomId,
        s.startsAt,
        s.endsAt,
      ]);
  }
  async function cancelClass(c: PoolClient, row: Row, actor: string, correlation: string) {
    await expireClass(c, row.id, correlation);
    if ((await view(c, row)).committed > 0) throw fail("ENROLLMENT_REQUIRED", "Lớp có chỗ đã chốt: cần quy trình Enrollment/hoàn hoặc chuyển lớp trước khi hủy");
    if ((await c.query("SELECT 1 FROM holds h WHERE h.class_id=$1 AND h.status='HELD' AND NOT EXISTS(SELECT 1 FROM demo_fixtures f WHERE f.enrollment_id=h.enrollment_id)",[row.id])).rowCount)
      throw fail("ENROLLMENT_REQUIRED","Reconcile real Enrollment/Payment holds before cancelling the class");
    const holds = (await c.query("UPDATE holds SET status='CANCELLED' WHERE class_id=$1 AND status='HELD' RETURNING id", [row.id])).rows;
    for (const hold of holds) await audit(c, actor, "hold.cancelled", hold.id, correlation);
    await c.query("UPDATE sessions SET active=false,retired_revision=$2 WHERE class_id=$1 AND active", [row.id,row.version+1]);
  }
  return createApp("class-schedule", (app) => {
    registerChanges(app,pool,auth,config,{transaction,audit,expireClass,classRow,view,validate});
    app.post("/internal/classes/deadlines",async(req,res)=>{
      const claims=MachineClaims.parse(await iamRequest(auth.identityUrl,"/internal/iam/machine/introspect",bearer(req.get("authorization")),{audience:"enrollment",scope:"automation:source"}));
      if(!claims.workflows.includes("WF-07"))throw new HttpError(403,"FORBIDDEN","Enrollment deadline source required");
      const {enrollmentIds}=z.object({enrollmentIds:z.array(Id).min(1).max(50)}).strict().parse(req.body);
      const holds=(await pool.query("SELECT h.*,clock_timestamp() AS now FROM holds h WHERE enrollment_id=ANY($1::uuid[]) ORDER BY created_at DESC",[enrollmentIds])).rows;
      res.json({data:enrollmentIds.map(id=>{const h=holds.find(r=>r.enrollment_id===id);return {enrollmentId:id,hold:h?holdView(h,h.now):null};})});
    });
    app.get("/ready", async (_req, res) => {
      await pool.query("SELECT 1 FROM holds LIMIT 1");
      res.json({ status: "ok" });
    });
    async function enrollmentAuthority(base: string | undefined, path: string, token: string) {
      if (!base) throw new HttpError(503, "ENROLLMENT_NOT_CONFIGURED", "Enrollment/Payment authority required");
      let response: globalThis.Response;
      try {
        response = await fetch(`${base}${path}`, {
          headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: "error",
        });
      } catch { throw new HttpError(503, "UPSTREAM_UNAVAILABLE", "Cannot validate seat authority"); }
      if ([400, 401, 403, 404, 409].includes(response.status))
        throw new HttpError(response.status, "SEAT_AUTHORITY_DENIED", "Enrollment/Payment authority denied");
      if (!response.ok) throw new HttpError(503, "UPSTREAM_UNAVAILABLE", "Cannot validate seat authority");
      return (await response.json() as { data: unknown }).data;
    }
    app.get("/public/classes/:packageId", async (req, res) => {
      const packageId = Id.parse(req.params.packageId), classId = Id.optional().parse(req.query.classId);
      const c = await pool.connect();
      try {
        const { rows } = await c.query(`SELECT * FROM classes WHERE package_id=$1 AND status='OPEN'
          AND registration_closes_at>clock_timestamp() AND ($2::uuid IS NULL OR id=$2) ORDER BY code,id`, [packageId, classId ?? null]);
        const classes = [];
        for (const row of rows) {
          const cls = await view(c, row);
          if (cls.missingConditions.length) continue;
          classes.push({ id: cls.id, code: cls.code, name: cls.name, branchId: cls.branchId, packageId: cls.packageId,
            courseId: cls.courseId, mode: cls.mode, version: cls.version, sessionCount: cls.sessions.length,
            startsAt: cls.sessions[0]?.startsAt ?? null, availableSeats: Math.max(0, cls.available) });
        }
        res.json({ data: classes });
      } finally { c.release(); }
    });
    function seatActor(user: Principal) {
      if (!["center_director", "branch_director", "admissions", "accountant"].includes(user.role) &&
        !(user.role === "ai_agent" && user.delegation?.source === "service" && ["WF-05", "WF-06", "WF-07"].includes(user.delegation.workflowId ?? "")))
        throw new HttpError(403, "FORBIDDEN", "Current enrollment staff or scoped Payment/expiry service required");
    }
    function seatBinding(user: Principal, enrollmentId: string, source: z.infer<typeof seatAuthority>) {
      seatActor(user);
      const d = user.delegation;
      if (!d || d.operation !== "classes.enroll" || d.entity?.type !== "enrollment" || d.entity.id !== enrollmentId ||
        source.id !== enrollmentId || source.branchId !== d.branchId)
        throw new HttpError(403, "FORBIDDEN", "Enrollment does not match the delegated resource");
    }
    const enrollmentPath = "/internal/classes/enrollments/:id";
    async function readEnrollmentSeat(id: string, user: Principal, source?: z.infer<typeof seatAuthority>, db: Pool | PoolClient = pool) {
      seatActor(user);
      const d = user.delegation;
      if (!d || d.entity?.type !== "enrollment" || d.entity.id !== id)
        throw new HttpError(403, "FORBIDDEN", "Seat lookup requires the bound Enrollment");
      const hold = (await db.query(`SELECT h.*,clock_timestamp() AS now,c.branch_id FROM holds h
        JOIN classes c ON c.id=h.class_id WHERE h.enrollment_id=$1 ORDER BY h.created_at DESC LIMIT 1`, [id])).rows[0];
      if (hold) {
        checkBranch(user, hold.branch_id);
        if (source && (hold.class_id !== source.classId || hold.learner_id !== source.learnerId || hold.package_id !== source.packageId))
          throw fail("ENROLLMENT_MISMATCH", "Persisted seat does not match the Enrollment snapshot");
      }
      return { hold: hold ? holdView(hold, hold.now) : null, committed: hold?.status === "COMMITTED" };
    }
    for (const audience of ["enrollment", "payment"] as const) app.get(`${enrollmentPath}/${audience}-authority`, async (req, res) => {
      const id = Id.parse(req.params.id);
      const user = await verifyCommand(auth, bearer(req.get("authorization")), audience, audience === "enrollment" ? "enrollment:write" : "payment:write");
      if (user.delegation?.operation !== `${audience}.execute`) throw new HttpError(403, "FORBIDDEN", "Scoped source lookup operation required");
      const seat = await readEnrollmentSeat(id, user);
      if (user.delegation?.workflowId === "WF-05" && user.role === "admissions" && seat.hold && seat.hold.actorId !== user.sub)
        throw new HttpError(403, "FORBIDDEN", "Seat belongs to another initiating actor");
      if (audience === "payment" && seat.hold) {
        const token = bearer(req.get("authorization"));
        const source = seatAuthority.parse(await enrollmentAuthority(config.enrollmentUrl, `/internal/enrollment/enrollments/${id}/payment-authority`, token));
        const result = await transaction(pool, async c => {
          const row = await classRow(c, seat.hold!.classId, user, true);
          const current = await readEnrollmentSeat(id,user,undefined,c);
          const now = (await c.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
          const occupancy = (await c.query("SELECT count(*)::int AS n FROM holds WHERE class_id=$1 AND enrollment_id<>$2 AND (status='COMMITTED' OR (status='HELD' AND expires_at>clock_timestamp()))",[row.id,id])).rows[0].n;
          const duplicate=(await c.query("SELECT 1 FROM holds WHERE class_id=$1 AND learner_id=$2 AND enrollment_id<>$3 AND (status='COMMITTED' OR (status='HELD' AND expires_at>clock_timestamp()))",[row.id,source.learnerId,id])).rowCount;
          const committable = row.status === "OPEN" && row.version === source.classVersion && row.registration_closes_at > now && occupancy < row.capacity && !duplicate &&
            !!current.hold && ["HELD","EXPIRED"].includes(current.hold.status) && !(await view(c,row)).missingConditions.length;
          return {...current,committable};
        });
        res.json({ data: result }); return;
      }
      res.json({ data: { ...seat, committable: false } });
    });
    app.get(enrollmentPath, async (req, res) => {
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const user = await verifyCommand(auth, token, "class-schedule", "classes:enroll");
      const source = seatAuthority.parse(await enrollmentAuthority(config.enrollmentUrl, `/internal/enrollment/enrollments/${id}/seat-authority`, token));
      seatBinding(user, id, source);
      res.json({ data: await readEnrollmentSeat(id, user, source) });
    });
    for (const action of ["hold", "commit", "release"] as const) app.post(`${enrollmentPath}/${action}`, async (req, res) => {
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const payload = action === "commit" ? EnrollmentCommitInput.parse(req.body) : EnrollmentSeatInput.parse(req.body);
      const verify = () => verifyCommand(auth, token, "class-schedule", "classes:enroll");
      const user = await verify();
      const sourcePath = `/internal/enrollment/enrollments/${id}/seat-authority`;
      const initial = seatAuthority.parse(await enrollmentAuthority(config.enrollmentUrl, sourcePath, token));
      seatBinding(user, id, initial);
      const data = await transaction(pool, async c => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`hold-actor:${user.sub}`]);
        const row = await classRow(c, initial.classId, user, true);
        const currentUser = await verify();
        const source = seatAuthority.parse(await enrollmentAuthority(config.enrollmentUrl, sourcePath, token));
        seatBinding(currentUser, id, source);
        if (source.classId !== row.id || source.branchId !== row.branch_id || source.packageId !== row.package_id ||
          source.quote.packageId !== row.package_id || source.quote.courseId !== row.course_id)
          throw fail("PACKAGE_MISMATCH", "Enrollment snapshot does not match the class offer");
        const operationKey = `automation:${user.delegation!.jobId}:classes.enroll:${action}`;
        const previous = (await c.query("SELECT * FROM class_enrollment_operations WHERE operation_key=$1", [operationKey])).rows[0];
        if (previous) {
          if (previous.enrollment_id !== id || JSON.stringify(previous.payload) !== JSON.stringify(payload))
            throw fail("IDEMPOTENCY_CONFLICT", "Operation was used with different input");
          await verify();
          return previous.result;
        }
        await expireClass(c, row.id, res.locals.correlationId);
        const now = (await c.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
        let committedNow = false;
        let hold = (await c.query("SELECT * FROM holds WHERE enrollment_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [id])).rows[0];
        if (hold && (hold.class_id !== row.id || hold.package_id !== source.packageId || hold.learner_id !== source.learnerId))
          throw fail("ENROLLMENT_MISMATCH", "Persisted seat does not match the Enrollment snapshot");
        async function available() {
          if (source.classVersion !== row.version) throw fail("CLASS_CHANGED", "Confirm the current class schedule before taking a seat");
          if (row.status !== "OPEN") throw fail("NOT_OPEN", "Class is not OPEN");
          if (row.registration_closes_at <= now) throw fail("REGISTRATION_CLOSED", "Registration cutoff passed");
          if ((await view(c, row)).missingConditions.length) throw fail("CLASS_INCOMPLETE", "Class is not ready for enrollment");
          if ((await c.query("SELECT 1 FROM holds WHERE class_id=$1 AND learner_id=$2 AND enrollment_id<>$3 AND status IN ('HELD','COMMITTED')", [row.id, source.learnerId, id])).rowCount)
            throw fail("DUPLICATE_LEARNER", "Learner already holds or has committed this class");
          const count = (await c.query("SELECT count(*)::int AS n FROM holds WHERE class_id=$1 AND enrollment_id<>$2 AND status IN ('HELD','COMMITTED')", [row.id, id])).rows[0].n;
          if (count >= row.capacity) throw fail("SOLD_OUT", "Class has no available seat");
        }
        if (action === "hold") {
          const selfRegistration = user.delegation?.source === "service" && user.delegation.workflowId === "WF-05";
          if (!["center_director", "branch_director", "admissions"].includes(user.role) && !selfRegistration)
            throw new HttpError(403, "FORBIDDEN", "Only confirmed admissions requests may create holds");
          if (!["PENDING_HOLD", "HELD"].includes(source.state)) throw fail("INVALID_ENROLLMENT_STATE", "Enrollment cannot request a hold");
          if (source.quoteCurrent !== true) throw fail("QUOTE_CHANGED", "A new confirmation is required for the current offer");
          await available();
          if (hold) {
            if (hold.status !== "HELD" || hold.expires_at <= now) throw fail("HOLD_EXPIRED", "Existing hold is no longer available");
          } else {
            if (!selfRegistration) {
              const counts = (await c.query(`SELECT count(*) FILTER(WHERE status='HELD' AND expires_at>clock_timestamp())::int AS active,
                count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 minute')::int AS recent FROM holds WHERE actor_id=$1`, [user.sub])).rows[0];
              if (counts.active >= 5 || counts.recent >= 30) throw new HttpError(429, "HOLD_LIMIT", "Actor hold limit reached");
            }
            hold = (await c.query(`INSERT INTO holds(id,class_id,package_id,learner_id,enrollment_id,actor_id,status,expires_at,operation_key,request_payload)
              VALUES($1,$2,$3,$4,$5,$6,'HELD',clock_timestamp()+make_interval(secs=>$7),$5,$8) RETURNING *`,
            [randomUUID(), row.id, source.packageId, source.learnerId, id, user.sub, config.ttlSeconds,
              { classId: row.id, packageId: source.packageId, learnerId: source.learnerId, enrollmentId: id }])).rows[0];
            await audit(c, user.sub, "hold.created", hold.id, res.locals.correlationId);
          }
        } else if (action === "commit") {
          const { matchRef } = EnrollmentCommitInput.parse(payload);
          if (source.state !== "CONFIRMING" || source.matchRef !== matchRef) throw fail("INVALID_ENROLLMENT_STATE", "Enrollment must be confirming the verified match");
          const match = matchAuthority.parse(await enrollmentAuthority(config.paymentUrl, `/internal/payment/matches/${matchRef}/seat-authority`, token));
          if (match.id !== matchRef || match.enrollmentId !== id || !match.eligible)
            throw new HttpError(403, "UNVERIFIED_PAYMENT", "A verified eligible Payment match is required");
          if (!hold) throw fail("HOLD_REQUIRED", "A paid request must refer to its original hold");
          if (hold.status !== "COMMITTED") {
            await available();
            if (hold.status !== "HELD" && !(hold.status === "EXPIRED" && match.late))
              throw fail("HOLD_EXPIRED", "Hold cannot be committed");
            hold = (await c.query(`UPDATE holds SET status='COMMITTED' WHERE id=$1
              AND (status='HELD' AND expires_at>clock_timestamp() OR $2 AND status IN ('HELD','EXPIRED')) RETURNING *`, [hold.id, match.late])).rows[0];
            if (!hold) throw fail("HOLD_EXPIRED", "Hold expired before commit; reconcile the late payment");
            committedNow = true;
            await audit(c, user.sub, "hold.committed", hold.id, res.locals.correlationId);
          }
        } else {
          if (!source.releaseAuthorized && !["EXPIRED", "CANCELLED", "REFUND_PENDING"].includes(source.state))
            throw fail("RECONCILIATION_REQUIRED", "Money must be reconciled before releasing the hold");
          if (hold?.status === "COMMITTED") throw fail("ALREADY_COMMITTED", "A committed seat requires the approved adjustment workflow");
          if (hold?.status === "HELD") {
            hold = (await c.query("UPDATE holds SET status='CANCELLED' WHERE id=$1 RETURNING *", [hold.id])).rows[0];
            await audit(c, user.sub, "hold.cancelled", hold.id, res.locals.correlationId);
          }
        }
        const finalSource = seatAuthority.parse(await enrollmentAuthority(config.enrollmentUrl, sourcePath, token));
        seatBinding(await verify(), id, finalSource);
        if (action === "commit") {
          const finalMatch = matchAuthority.parse(await enrollmentAuthority(config.paymentUrl, `/internal/payment/matches/${EnrollmentCommitInput.parse(payload).matchRef}/seat-authority`, token));
          if (!finalMatch.eligible || finalMatch.enrollmentId !== id) throw new HttpError(403,"UNVERIFIED_PAYMENT","Payment authority changed before commit");
        }
        if (finalSource.classId !== source.classId || finalSource.classVersion !== source.classVersion || finalSource.packageId !== source.packageId || finalSource.learnerId !== source.learnerId ||
          (action === "hold" && (!["PENDING_HOLD", "HELD"].includes(finalSource.state) || finalSource.quoteCurrent !== true)) ||
          (action === "commit" && (finalSource.state !== "CONFIRMING" || finalSource.matchRef !== source.matchRef)) ||
          (action === "release" && !finalSource.releaseAuthorized && !["EXPIRED", "CANCELLED", "REFUND_PENDING"].includes(finalSource.state)))
          throw fail("ENROLLMENT_CHANGED", "Enrollment authority changed before the seat commit");
        const finalNow = (await c.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
        if ((action === "hold" || committedNow) && row.registration_closes_at <= finalNow)
          throw fail("REGISTRATION_CLOSED", "Registration cutoff passed before commit");
        if (action === "hold" && hold.expires_at <= finalNow)
          throw fail("HOLD_EXPIRED", "Hold expired before commit");
        const result = hold ? holdView(hold, now) : null;
        await c.query(`INSERT INTO class_enrollment_operations(operation_key,enrollment_id,action,payload,result)
          VALUES($1,$2,$3,$4,$5)`, [operationKey, id, action, JSON.stringify(payload), JSON.stringify(result)]);
        return result;
      });
      res.json({ data });
    });
    // Separate service credential. There is deliberately no public /api/v1 commit route.
    app.post("/internal/holds/:id/commit", async (req, res) => {
      const expected = config.enrollmentSecret,
        supplied = req.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (
        !expected ||
        Buffer.byteLength(expected) < 32 ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Enrollment service credential required",
        );
      const id = Id.parse(req.params.id);
      const result = await transaction(pool, async (c) => {
        const initial = (
          await c.query("SELECT class_id FROM holds WHERE id=$1", [id])
        ).rows[0];
        if (!initial) throw missing();
        const targetClass = await classRow(c, initial.class_id, undefined, true);
        await expireClass(c, initial.class_id, res.locals.correlationId);
        const row = (
          await c.query(
            "SELECT *,clock_timestamp() AS now FROM holds WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!(await c.query("SELECT 1 FROM demo_fixtures WHERE enrollment_id=$1",[row.enrollment_id])).rowCount)
          throw fail("ENROLLMENT_REQUIRED","Real Enrollment seats require the scoped verified payment-match API");
        if (row.status === "COMMITTED") return holdView(row, row.now);
        if (targetClass.status !== "OPEN") throw fail("NOT_OPEN", "Class no longer accepts seat commits");
        if (row.status !== "HELD" || row.expires_at <= row.now) return null;
        const updated = (
          await c.query(
            "UPDATE holds SET status='COMMITTED' WHERE id=$1 AND status='HELD' AND expires_at>clock_timestamp() RETURNING *",
            [id],
          )
        ).rows[0];
        if (!updated) {
          await expireClass(c, initial.class_id, res.locals.correlationId);
          return null;
        }
        await audit(
          c,
          "enrollment-service",
          "hold.committed",
          id,
          res.locals.correlationId,
        );
        return holdView(updated, row.now);
      });
      if (!result) throw fail("HOLD_EXPIRED", "Hold is expired or cancelled");
      res.json({ data: result });
    });
    const cancellationPayload = ClassTransition.safeExtend({ status: z.literal("CANCELLED") });
    const cancellationBase = "/api/v1/class-cancellation-requests";
    app.post("/api/v1/classes/:id/cancellation-requests", authenticate(auth), allowRoles("center_director", "branch_director"), async (req, res) => {
      const user = principal(res), classId = Id.parse(req.params.id), payload = cancellationPayload.parse(req.body);
      const data = await transaction(pool, async c => {
        const row = await classRow(c, classId, user, true);
        if (row.version !== payload.version) throw fail("STALE_VERSION", "Reload class");
        if (!["DRAFT", "PLANNED", "OPEN"].includes(row.status)) throw fail("INVALID_TRANSITION", "Class cannot be cancelled");
        const id = randomUUID(), eventId = randomUUID();
        const delegation = await iamRequest(auth.identityUrl, "/internal/iam/delegations", bearer(req.get("authorization")), {
          eventId, workflowId: "WF-CLASS-CANCEL", workflowVersion: 1, branchId: row.branch_id,
          entity: { type: "class", id: classId, version: row.version }, inputRef: id, operations: ["classes.cancel"],
        }) as { contextRef: string };
        const result = await c.query(`INSERT INTO class_cancellation_requests(id,class_id,branch_id,actor_id,actor_session_id,context_id,event_id,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,expires_at`, [id, classId, row.branch_id, user.sub, user.sid, delegation.contextRef, eventId, payload]);
        await audit(c, user.sub, "automation.cancellation_confirmed", id, res.locals.correlationId);
        return result.rows[0];
      });
      res.status(201).json({ data });
    });
    for (const action of ["approve", "revoke"] as const) app.post(`${cancellationBase}/:id/${action}`, authenticate(auth), allowRoles("center_director", "branch_director"), async (req, res) => {
      z.object({}).strict().parse(req.body);
      const id = Id.parse(req.params.id), user = principal(res);
      await transaction(pool, async c => {
        const row = (await c.query("SELECT * FROM class_cancellation_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!row) throw missing();
        checkBranch(user, row.branch_id);
        if (row.consumed_at || row.revoked_at || row.expires_at <= new Date()) throw fail("CONFIRMATION_EXPIRED", "Confirmation no longer available");
        if (action === "revoke") {
          if (user.sub !== row.actor_id && user.sub !== row.approver_id) throw new HttpError(403, "FORBIDDEN", "Only the confirming or approving actor may revoke");
          await c.query("UPDATE class_cancellation_requests SET revoked_at=clock_timestamp() WHERE id=$1", [id]);
        } else {
          if (user.role !== "branch_director" || user.sub === row.actor_id || row.approver_id) throw new HttpError(403, "FORBIDDEN", "A separate branch director must approve once");
          await c.query("UPDATE class_cancellation_requests SET approver_id=$2,approver_session_id=$3 WHERE id=$1", [id, user.sub, user.sid]);
          await enqueueEvent(c, { id: row.event_id, type: "class.cancellation_approved", version: 1, occurredAt: new Date().toISOString(), correlationId: res.locals.correlationId,
            entityId: row.class_id, entityVersion: row.payload.version,
            payload: { entity: { type: "class", id: row.class_id, version: row.payload.version }, contextRef: row.context_id, inputRef: id } });
        }
        await audit(c, user.sub, `automation.cancellation_${action}`, id, res.locals.correlationId);
      });
      res.json({ data: { id, action } });
    });
    app.get(`${cancellationBase}/:id`, authenticate(auth), async (req, res) => {
      const row = (await pool.query("SELECT * FROM class_cancellation_requests WHERE id=$1", [Id.parse(req.params.id)])).rows[0];
      if (!row) throw missing();
      const user = principal(res); checkBranch(user, row.branch_id);
      if (![row.actor_id, row.approver_id].includes(user.sub)) throw new HttpError(403, "FORBIDDEN", "Request belongs to another actor");
      res.json({ data: { id: row.id, consumedAt: row.consumed_at, revokedAt: row.revoked_at, expiresAt: row.expires_at, result: row.result, jobId: row.job_id } });
    });
    app.get("/internal/classes/cancellations/:id", async (req, res) => {
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const user = DelegatedPrincipal.parse(await iamRequest(auth.identityUrl, "/internal/iam/commands/introspect", token, { audience: "class-schedule", scope: "classes:cancel" }));
      const row = (await pool.query("SELECT * FROM class_cancellation_requests WHERE id=$1", [id])).rows[0], d = user.delegation;
      if (!row) throw missing();
      if (d.operation !== "classes.cancel" || d.inputRef !== id || d.entity?.id !== row.class_id || row.actor_id !== user.sub || row.actor_session_id !== user.sid || row.branch_id !== d.branchId)
        throw new HttpError(403, "FORBIDDEN", "Confirmation binding does not match the operation lookup");
      res.json({ data: { id, payload: row.payload, consumedAt: row.consumed_at, result: row.result } });
    });
    app.post("/internal/classes/cancellations/:id/execute", async (req, res) => {
      const id = Id.parse(req.params.id), payload = cancellationPayload.parse(req.body), token = bearer(req.get("authorization"));
      const verify = async () => DelegatedPrincipal.parse(await iamRequest(auth.identityUrl, "/internal/iam/commands/introspect", token, { audience: "class-schedule", scope: "classes:cancel" }));
      const data = await transaction(pool, async c => {
        const user = await verify(), d = user.delegation;
        const source = (await c.query("SELECT class_id FROM class_cancellation_requests WHERE id=$1", [id])).rows[0];
        if (!source) throw missing();
        const row = await classRow(c, source.class_id, user, true);
        const confirmation = (await c.query("SELECT *,clock_timestamp() AS now FROM class_cancellation_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (d.operation !== "classes.cancel" || d.inputRef !== id || d.entity?.type !== "class" || d.entity.id !== row.id || d.entity.version !== payload.version ||
          confirmation.actor_id !== user.sub || confirmation.actor_session_id !== user.sid || confirmation.branch_id !== d.branchId ||
          confirmation.payload.version !== payload.version || confirmation.payload.status !== payload.status || confirmation.payload.reason !== payload.reason)
          throw new HttpError(403, "FORBIDDEN", "Confirmation binding does not match the command");
        if (confirmation.consumed_at) {
          if (confirmation.job_id !== d.jobId) throw fail("CONFIRMATION_CONSUMED", "Lookup the original operation");
          return confirmation.result;
        }
        if (!confirmation.approver_id || confirmation.revoked_at || confirmation.expires_at <= confirmation.now) throw fail("CONFIRMATION_EXPIRED", "A current separate approval is required");
        if (row.version !== payload.version) throw fail("STALE_VERSION", "Approval is stale; confirm the current version");
        if (!["DRAFT", "PLANNED", "OPEN"].includes(row.status)) throw fail("INVALID_TRANSITION", "Class cannot be cancelled");
        await cancelClass(c, row, user.sub, res.locals.correlationId);
        // Final live checks while resource/confirmation locks are held; IAM and Class are separate databases.
        await verify();
        await iamRequest(auth.identityUrl, "/internal/iam/commands/approval-session", token, { accountId: confirmation.approver_id, sessionId: confirmation.approver_session_id });
        const consumed = await c.query("UPDATE class_cancellation_requests SET consumed_at=clock_timestamp(),job_id=$2 WHERE id=$1 AND expires_at>clock_timestamp() AND revoked_at IS NULL RETURNING id", [id, d.jobId]);
        if (!consumed.rowCount) throw fail("CONFIRMATION_EXPIRED", "Confirmation expired before commit");
        const updated = (await c.query("UPDATE classes SET status='CANCELLED',version=version+1 WHERE id=$1 RETURNING *", [row.id])).rows[0];
        await c.query("INSERT INTO class_status_changes(id,class_id,version,previous_status,status,reason,actor_id) VALUES($1,$2,$3,$4,'CANCELLED',$5,$6)", [randomUUID(), row.id, updated.version, row.status, payload.reason, user.sub]);
        await audit(c, user.sub, "class.cancelled", row.id, res.locals.correlationId);
        const result = await view(c, updated);
        await c.query("UPDATE class_cancellation_requests SET result=$2 WHERE id=$1", [id, result]);
        return result;
      });
      res.json({ data });
    });
    app.use(
      "/api/v1",
      authenticateDomain(auth, "class-schedule", "classes:read", /^\/classes(\/[^/]+)?$/),
      (req, res, next) => {
        if (principal(res).delegation?.source === "guest") { next(); return; }
        allowRoles("center_director", "branch_director", "admissions", "teacher")(req, res, next);
      },
    );
    registerTeacherTime(app, pool, transaction, audit, (req, res) =>
      upstream(config.orgUrl, "/api/v1/teachers", req, res));
    app.get("/api/v1/operations", allowRoles("center_director"), async (_req, res) => {
      const outbox = await pool.query("SELECT status,count(*)::int AS count,min(created_at) AS oldest FROM event_outbox GROUP BY status");
      const inbox = await pool.query("SELECT consumer,status,count(*)::int AS count,min(created_at) AS oldest FROM event_inbox GROUP BY consumer,status");
      const recentEvents = await pool.query("SELECT event_id,event_type,target_id,occurred_at,received_at FROM class_event_receipts ORDER BY received_at DESC LIMIT 20");
      res.json({ data: { messagingEnabled: config.messagingEnabled ?? false, outbox: outbox.rows, inbox: inbox.rows, recentEvents: recentEvents.rows, http: app.locals.httpMetrics(), observedAt: new Date().toISOString() } });
    });
    app.post("/api/v1/operations/:id/replay", allowRoles("center_director"), async (req, res) => {
      const id = Id.parse(req.params.id), input = z.object({ reason: z.string().trim().min(1).max(1000), consumer: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional() }).strict().parse(req.body);
      const replayed = await transaction(pool, async c => {
        if (!await replayDeadEvent(c, id, input.consumer)) return false;
        await c.query("INSERT INTO operation_replays(id,event_id,consumer,reason,actor_id) VALUES($1,$2,$3,$4,$5)", [randomUUID(), id, input.consumer ?? null, input.reason, principal(res).sub]);
        await audit(c, principal(res).sub, "operations.replayed", id, res.locals.correlationId);
        return true;
      });
      if (!replayed) throw fail("NOT_DEAD", "Event is not in the dead-letter queue");
      res.json({ data: { replayed } });
    });
    app.get("/api/v1/rooms", async (_req, res) => {
      const { rows } = await pool.query(
        "SELECT * FROM rooms WHERE ($1::uuid[] IS NULL OR branch_id=ANY($1)) ORDER BY name",
        [scope(principal(res))],
      );
      res.json({ data: rows.map(roomView) });
    });
    app.post(
      "/api/v1/rooms",
      allowRoles("center_director", "branch_director"),
      async (req, res) => {
        const input = RoomInput.parse(req.body);
        checkBranch(principal(res), input.branchId);
        const branch = await upstream<Row>(
          config.orgUrl,
          `/api/v1/branches/${input.branchId}`,
          req,
          res,
        );
        if (!branch.active || branch.kind !== "branch")
          throw fail("INVALID_BRANCH", "Inactive branch");
        const row = await transaction(pool, async (c) => {
          const r = (
            await c.query(
              "INSERT INTO rooms VALUES($1,$2,$3,$4,$5) RETURNING *",
              [
                randomUUID(),
                input.branchId,
                input.name,
                input.capacity,
                input.active,
              ],
            )
          ).rows[0];
          await audit(
            c,
            principal(res).sub,
            "room.created",
            r.id,
            res.locals.correlationId,
          );
          return r;
        });
        res.status(201).json({ data: roomView(row) });
      },
    );
    app.get("/api/v1/classes", async (req, res) => {
      const q = ClassQuery.parse(req.query),
        user = principal(res);
      if (q.branchId) checkBranch(user, q.branchId);
      if (user.delegation?.source === "guest" && q.status && q.status !== "OPEN") throw new HttpError(403, "FORBIDDEN", "Only open classes are public");
      if (user.delegation && q.sellable === "true") throw new HttpError(403, "DELEGATED_SELLABLE_UNAVAILABLE", "Read Catalog offers separately; cross-service token exchange is not enabled");
      let sellableOffers: Row[] | null = null;
      if (q.sellable === "true") {
        const catalogRows = async (resource: string) => {
          const rows: Row[] = [];
          for (let page = 1; ; page++) {
            const next = await upstream<Row[]>(
              config.catalogUrl,
              `/api/v1/${resource}?status=active&pageSize=100&page=${page}`,
              req,
              res,
            );
            rows.push(...next);
            if (next.length < 100) return rows;
          }
        };
        const [courses, packages] = await Promise.all([
          catalogRows("courses"),
          catalogRows("packages"),
        ]);
        sellableOffers = packages.flatMap((p) => {
          const course = courses.find((c) => c.id === p.courseId);
          return course
            ? [
                {
                  packageId: p.id,
                  courseId: course.id,
                  branchIds: course.branchIds,
                  modes: course.deliveryModes,
                },
              ]
            : [];
        });
      }
      const result = await transaction(pool, async (c) => {
        // One snapshot for the rows, schedules and occupancy on this page.
        await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const filter = `($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2::uuid IS NULL OR teacher_account_id=$2)
          AND ($3::uuid IS NULL OR course_id=$3) AND ($4::uuid IS NULL OR package_id=$4) AND ($5::uuid IS NULL OR branch_id=$5)
          AND ($6::text IS NULL OR mode=$6) AND ($7::text IS NULL OR status=$7)
          AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL) OR EXISTS(SELECT 1 FROM sessions s WHERE s.class_id=classes.id
            AND (s.active OR classes.status='CANCELLED' AND (s.retired_revision=classes.version OR s.retired_revision IS NULL AND NOT EXISTS(SELECT 1 FROM sessions retired WHERE retired.class_id=classes.id AND retired.retired_revision=classes.version)))
            AND ($8::timestamptz IS NULL OR s.starts_at >= $8) AND ($9::timestamptz IS NULL OR s.ends_at <= $9)))
          AND (NOT $10::boolean OR (status='OPEN' AND registration_closes_at>transaction_timestamp() AND capacity>(SELECT count(*) FROM holds h WHERE h.class_id=classes.id AND (h.status='COMMITTED' OR (h.status='HELD' AND h.expires_at>transaction_timestamp())))))
          AND ($11::jsonb IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements($11::jsonb) o WHERE (o->>'packageId')::uuid=package_id AND (o->>'courseId')::uuid=course_id AND (o->'modes') ? mode AND ((o->'branchIds')='[]'::jsonb OR (o->'branchIds') ? branch_id::text)))`;
        const params = [
          scope(user),
          user.role === "teacher" ? user.sub : null,
          q.courseId ?? null,
          q.packageId ?? null,
          q.branchId ?? null,
          q.mode ?? null,
          user.delegation?.source === "guest" ? "OPEN" : q.status ?? null,
          q.from ?? null,
          q.to ?? null,
          q.sellable === "true",
          sellableOffers === null ? null : JSON.stringify(sellableOffers),
        ];
        const total = Number(
          (
            await c.query(
              `SELECT count(*) FROM classes WHERE ${filter}`,
              params,
            )
          ).rows[0].count,
        );
        const rows = (
          await c.query(
            `SELECT * FROM classes WHERE ${filter} ORDER BY ${q.sort === "code" ? "code" : "registration_closes_at"},id LIMIT $12 OFFSET $13`,
            [...params, q.pageSize, (q.page - 1) * q.pageSize],
          )
        ).rows;
        const snapshots = await Promise.all(rows.map((r) => view(c, r)));
        const data = user.delegation?.source === "guest" ? snapshots.map(guestView) : snapshots;
        return {
          data,
          pagination: { page: q.page, pageSize: q.pageSize, total },
        };
      });
      res.json(result);
    });
    app.get("/api/v1/classes/:id", async (req, res) => {
      const data = await transaction(pool, async (c) => {
        await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        return view(
          c,
          await classRow(c, Id.parse(req.params.id), principal(res)),
        );
      });
      if (principal(res).delegation?.source === "guest" && data.status !== "OPEN") throw new HttpError(403, "FORBIDDEN", "Only open classes are public");
      res.json({ data: principal(res).delegation?.source === "guest" ? guestView(data) : data });
    });
    app.post(
      "/api/v1/classes",
      allowRoles("center_director", "branch_director"),
      async (req, res) => {
        const input = ClassInput.parse(req.body);
        const data = await transaction(pool, async (c) => {
          const refs = await validate(c, input, req, res),
            id = randomUUID();
          const row = (
            await c.query(
              "INSERT INTO classes(id,code,name,course_id,package_id,branch_id,teacher_id,teacher_account_id,mode,room_id,online_url,capacity,minimum_size,registration_closes_at,decision_at,session_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *",
              [
                id,
                input.code,
                input.name,
                input.courseId,
                input.packageId,
                input.branchId,
                input.teacherId,
                refs.teacherAccountId,
                input.mode,
                input.roomId,
                input.onlineUrl,
                input.capacity,
                input.minimumSize,
                input.registrationClosesAt,
                input.decisionAt,
                refs.sessionCount,
              ],
            )
          ).rows[0];
          await saveSessions(c, id, input);
          await audit(
            c,
            principal(res).sub,
            "class.created",
            id,
            res.locals.correlationId,
          );
          return view(c, row);
        });
        res.status(201).json({ data });
      },
    );
    app.put(
      "/api/v1/classes/:id",
      allowRoles("center_director", "branch_director"),
      async (req, res) => {
        const id = Id.parse(req.params.id),
          { input, version } = ClassUpdate.parse(req.body);
        const data = await transaction(pool, async (c) => {
          const old = await classRow(c, id, principal(res), true);
          if (!["DRAFT", "PLANNED", "OPEN"].includes(old.status)) throw fail("CLASS_LOCKED", "Lớp đã bắt đầu hoặc kết thúc, không thể sửa lịch qua thao tác này");
          if (old.version !== version)
            throw fail("STALE_VERSION", "Class changed; reload before editing");
          if (
            input.branchId !== old.branch_id ||
            input.courseId !== old.course_id ||
            input.packageId !== old.package_id
          )
            throw fail(
              "IMMUTABLE_REFERENCE",
              "Branch/course/package cannot change; create a new class",
            );
          const refs = await validate(c, input, req, res);
          const occupied = Number(
            (
              await c.query(
                "SELECT count(*) FROM holds WHERE class_id=$1 AND (status='COMMITTED' OR (status='HELD' AND expires_at>clock_timestamp()))",
                [id],
              )
            ).rows[0].count,
          );
          const previous = await view(c, old);
          const signature = (sessions: { startsAt: string | Date; endsAt: string | Date }[]) => JSON.stringify(sessions.map(s => [new Date(s.startsAt).toISOString(), new Date(s.endsAt).toISOString()]).sort());
          const scheduleChanged = old.teacher_id !== input.teacherId || old.room_id !== input.roomId || old.mode !== input.mode || old.online_url !== input.onlineUrl || signature(previous.sessions) !== signature(input.sessions);
          if (occupied > 0 && scheduleChanged) throw fail("ENROLLMENT_REQUIRED", "Lớp đang có quyền lợi/giữ chỗ: cần xử lý đăng ký và thông báo trước khi đổi lịch, giảng viên hoặc hình thức");
          if (input.capacity < occupied)
            throw fail(
              "CAPACITY_CONFLICT",
              "Capacity below committed plus active holds",
            );
          const row = (
            await c.query(
              `UPDATE classes SET code=$2,name=$3,teacher_id=$4,teacher_account_id=$5,mode=$6,room_id=$7,online_url=$8,capacity=$9,
                minimum_size=$10,registration_closes_at=$11,decision_at=$12,session_count=$13,version=version+1,
                minimum_policy_version=CASE WHEN minimum_size=$10 AND registration_closes_at=$11 AND decision_at=$12 THEN minimum_policy_version END WHERE id=$1 RETURNING *`,
              [
                id,
                input.code,
                input.name,
                input.teacherId,
                refs.teacherAccountId,
                input.mode,
                input.roomId,
                input.onlineUrl,
                input.capacity,
                input.minimumSize,
                input.registrationClosesAt,
                input.decisionAt,
                refs.sessionCount,
              ],
            )
          ).rows[0];
          await saveSessions(c, id, input);
          const result = await view(c, row);
          const now = (await c.query("SELECT clock_timestamp() AS now")).rows[0]
            .now;
          if (
            old.status === "OPEN" &&
            (result.missingConditions.length ||
              row.registration_closes_at <= now)
          )
            throw fail(
              "OPEN_CONDITIONS",
              result.missingConditions.join("; ") || "Registration closed",
            );
          await audit(
            c,
            principal(res).sub,
            "class.updated",
            id,
            res.locals.correlationId,
          );
          return result;
        });
        res.json({ data });
      },
    );
    app.post(
      "/api/v1/classes/:id/status",
      allowRoles("center_director", "branch_director"),
      async (req, res) => {
        const id = Id.parse(req.params.id),
          input = ClassTransition.parse(req.body),
          user = principal(res);
        if (["OPEN", "IN_PROGRESS", "COMPLETED"].includes(input.status) && user.role !== "branch_director")
          throw new HttpError(
            403,
            "FORBIDDEN",
            "Only branch director approves OPEN; center-director approval not delegated",
          );
        const data = await transaction(pool, async (c) => {
          const row = await classRow(c, id, user, true);
          if (row.version !== input.version)
            throw fail("STALE_VERSION", "Reload class");
          const allowed: Record<string, string[]> = { DRAFT: ["PLANNED", "CANCELLED"], PLANNED: ["OPEN", "CANCELLED"], OPEN: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED"], COMPLETED: [], CANCELLED: [] };
          if (!allowed[row.status]?.includes(input.status))
            throw fail(
              "INVALID_TRANSITION",
              "Không thể chuyển trạng thái lớp theo yêu cầu",
            );
          if (input.status === "OPEN") {
            const result = await view(c, row);
            await validate(c, result, req, res);
            const now = (await c.query("SELECT clock_timestamp() AS now"))
              .rows[0].now;
            if (
              result.missingConditions.length ||
              row.registration_closes_at <= now
            )
              throw fail(
                "OPEN_CONDITIONS",
                result.missingConditions.join("; ") || "Registration closed",
              );
          }
          if (["IN_PROGRESS", "COMPLETED"].includes(input.status)) {
            const timing = (await c.query("SELECT min(starts_at)<=clock_timestamp() AS started,max(ends_at)<=clock_timestamp() AS ended FROM sessions WHERE class_id=$1 AND active", [id])).rows[0];
            const current = await view(c, row);
            if (input.status === "IN_PROGRESS" && (!timing.started || current.committed < row.minimum_size || current.held > 0))
              throw fail("START_CONDITIONS", "Chưa đến giờ học, chưa đủ sĩ số hoặc còn giữ chỗ chưa xử lý");
            if (input.status === "COMPLETED" && !timing.ended) throw fail("COMPLETION_CONDITIONS", "Lịch học chưa kết thúc");
          }
          if (input.status === "CANCELLED") {
            await cancelClass(c, row, user.sub, res.locals.correlationId);
          }
          const updated = (
            await c.query(
              "UPDATE classes SET status=$2,version=version+1 WHERE id=$1 RETURNING *",
              [id, input.status],
            )
          ).rows[0];
          await c.query("INSERT INTO class_status_changes(id,class_id,version,previous_status,status,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), id, updated.version, row.status, input.status, input.reason, user.sub]);
          await audit(
            c,
            user.sub,
            `class.${input.status.toLowerCase()}`,
            id,
            res.locals.correlationId,
          );
          return view(c, updated);
        });
        res.json({ data });
      },
    );
    app.get(
      "/api/v1/hold-fixtures",
      allowRoles("center_director", "branch_director", "admissions"),
      async (_req, res) => {
        const rows = config.demo
          ? (
              await pool.query(
                "SELECT * FROM demo_fixtures WHERE ($1::uuid[] IS NULL OR branch_id=ANY($1)) ORDER BY label",
                [scope(principal(res))],
              )
            ).rows
          : [];
        res.json({
          data: {
            enabled: config.demo,
            ttlSeconds: config.ttlSeconds,
            fixtures: rows.map((r) => ({
              id: r.id,
              learnerId: r.learner_id,
              enrollmentId: r.enrollment_id,
              label: r.label,
              branchId: r.branch_id,
            })),
          },
        });
      },
    );
    app.post(
      "/api/v1/holds",
      allowRoles("center_director", "branch_director", "admissions"),
      async (req, res) => {
        if (!config.demo)
          throw new HttpError(
            403,
            "DEMO_DISABLED",
            "Enrollment adapter required; fixture demo disabled",
          );
        const input = HoldInput.parse(req.body),
          key = Id.parse(req.get("idempotency-key")),
          user = principal(res);
        const data = await transaction(pool, async (c) => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`hold-actor:${user.sub}`],
          );
          const row = await classRow(c, input.classId, user, true);
          const previous = (
            await c.query(
              "SELECT *,clock_timestamp() AS now FROM holds WHERE actor_id=$1 AND operation_key=$2",
              [user.sub, key],
            )
          ).rows[0];
          if (previous) {
            if (
              JSON.stringify(HoldInput.parse(previous.request_payload)) !==
              JSON.stringify(input)
            )
              throw fail(
                "IDEMPOTENCY_CONFLICT",
                "Key was used with a different payload",
              );
            return holdView(previous, previous.now);
          }
          const fixture = (
            await c.query(
              "SELECT 1 FROM demo_fixtures WHERE learner_id=$1 AND enrollment_id=$2 AND branch_id=$3",
              [input.learnerId, input.enrollmentId, row.branch_id],
            )
          ).rowCount;
          if (!fixture)
            throw new HttpError(
              403,
              "FIXTURE_REQUIRED",
              "Only labelled, seeded demo learners are allowed",
            );
          if (input.packageId !== row.package_id)
            throw fail("PACKAGE_MISMATCH", "Hold package does not match class");
          await offer(
            {
              packageId: row.package_id,
              courseId: row.course_id,
              branchId: row.branch_id,
              mode: row.mode,
            },
            req,
            res,
          );
          await expireClass(c, row.id, res.locals.correlationId);
          const now = (await c.query("SELECT clock_timestamp() AS now")).rows[0]
            .now as Date;
          if (row.status !== "OPEN")
            throw fail("NOT_OPEN", "Class is not OPEN");
          if (row.registration_closes_at <= now)
            throw fail("REGISTRATION_CLOSED", "Registration cutoff passed");
          if (
            (
              await c.query(
                "SELECT 1 FROM holds WHERE class_id=$1 AND learner_id=$2 AND status IN ('HELD','COMMITTED')",
                [row.id, input.learnerId],
              )
            ).rowCount
          )
            throw fail(
              "DUPLICATE_LEARNER",
              "Learner already holds or has committed this class",
            );
          const count = Number(
            (
              await c.query(
                "SELECT count(*) FROM holds WHERE class_id=$1 AND status IN ('HELD','COMMITTED')",
                [row.id],
              )
            ).rows[0].count,
          );
          if (count >= row.capacity)
            throw fail("SOLD_OUT", "Lớp đã hết chỗ. Vui lòng tải lại.");
          const active = Number(
            (
              await c.query(
                "SELECT count(*) FROM holds WHERE actor_id=$1 AND status='HELD' AND expires_at>clock_timestamp()",
                [user.sub],
              )
            ).rows[0].count,
          );
          if (active >= 5)
            throw new HttpError(
              429,
              "HOLD_LIMIT",
              "At most five active demo holds per actor",
            );
          const recent = Number(
            (
              await c.query(
                "SELECT count(*) FROM holds WHERE actor_id=$1 AND created_at>clock_timestamp()-interval '1 minute'",
                [user.sub],
              )
            ).rows[0].count,
          );
          if (recent >= 30)
            throw new HttpError(
              429,
              "HOLD_RATE_LIMIT",
              "At most thirty new holds per minute per actor",
            );
          const hold = (
            await c.query(
              "INSERT INTO holds(id,class_id,package_id,learner_id,enrollment_id,actor_id,status,expires_at,operation_key,request_payload) VALUES($1,$2,$3,$4,$5,$6,'HELD',$7,$8,$9) RETURNING *",
              [
                randomUUID(),
                row.id,
                input.packageId,
                input.learnerId,
                input.enrollmentId,
                user.sub,
                new Date(now.getTime() + config.ttlSeconds * 1000),
                key,
                input,
              ],
            )
          ).rows[0];
          await audit(
            c,
            user.sub,
            "hold.created",
            hold.id,
            res.locals.correlationId,
          );
          return holdView(hold, now);
        });
        res.status(201).json({ data });
      },
    );
    app.get(
      "/api/v1/holds",
      allowRoles("center_director", "branch_director", "admissions"),
      async (req, res) => {
        const key =
          req.query.operationKey === undefined
            ? null
            : Id.parse(req.query.operationKey);
        const { rows } = await pool.query(
          "SELECT h.*,statement_timestamp() AS now FROM holds h JOIN classes c ON c.id=h.class_id WHERE actor_id=$1 AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2)) AND ($3::uuid IS NULL OR operation_key=$3) ORDER BY created_at DESC LIMIT 100",
          [principal(res).sub, scope(principal(res)), key],
        );
        res.json({ data: rows.map((r) => holdView(r, r.now)) });
      },
    );
    const readHold = async (id: string, user: Principal, c: PoolClient) => {
      const row = (
        await c.query(
          "SELECT h.*,clock_timestamp() AS now,c.branch_id FROM holds h JOIN classes c ON c.id=h.class_id WHERE h.id=$1",
          [id],
        )
      ).rows[0];
      if (!row) throw missing();
      checkBranch(user, row.branch_id);
      if (row.actor_id !== user.sub)
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Only the creating actor may read/cancel a hold",
        );
      return row;
    };
    app.get(
      "/api/v1/holds/:id",
      allowRoles("center_director", "branch_director", "admissions"),
      async (req, res) => {
        const data = await transaction(pool, async (c) => {
          const row = await readHold(
            Id.parse(req.params.id),
            principal(res),
            c,
          );
          return holdView(row, row.now);
        });
        res.json({ data });
      },
    );
    app.post(
      "/api/v1/holds/:id/cancel",
      allowRoles("center_director", "branch_director", "admissions"),
      async (req, res) => {
        const data = await transaction(pool, async (c) => {
          const id = Id.parse(req.params.id),
            initial = await readHold(id, principal(res), c);
          await classRow(c, initial.class_id, principal(res), true);
          if (!(await c.query("SELECT 1 FROM demo_fixtures WHERE enrollment_id=$1",[initial.enrollment_id])).rowCount)
            throw fail("ENROLLMENT_REQUIRED","Cancel real Enrollment holds through money reconciliation");
          await expireClass(c, initial.class_id, res.locals.correlationId);
          const updated = (
            await c.query(
              "UPDATE holds SET status='CANCELLED' WHERE id=$1 AND status='HELD' RETURNING id",
              [id],
            )
          ).rowCount;
          if (updated)
            await audit(
              c,
              principal(res).sub,
              "hold.cancelled",
              id,
              res.locals.correlationId,
            );
          const row = await readHold(id, principal(res), c);
          if (row.status === "COMMITTED")
            throw fail(
              "ALREADY_COMMITTED",
              "A committed seat must be handled by Enrollment",
            );
          return holdView(row, row.now);
        });
        res.json({ data });
      },
    );
  });
}
