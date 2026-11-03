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
} from "@spacex/contracts";
import {
  authenticate,
  allowRoles,
  principal,
  checkBranch,
  type AuthConfig,
  type Principal,
} from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent, replayDeadEvent } from "@spacex/messaging";
import { checkTeacherSessions, registerTeacherTime } from "./teacher-time.js";

export interface ClassConfig {
  orgUrl: string;
  catalogUrl: string;
  demo: boolean;
  ttlSeconds: number;
  enrollmentSecret?: string;
  messagingEnabled?: boolean;
}
const Id = z.uuid();
// pg's untyped row boundary is converted explicitly by the view functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const missing = () => new HttpError(404, "NOT_FOUND", "Resource not found");
const fail = (code: string, message: string) =>
  new HttpError(409, code, message);
const scope = (user: Principal) =>
  user.role === "center_director" ? null : user.branchIds;
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
  ...(r.minimum_size > 0
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
        "SELECT starts_at,ends_at FROM sessions WHERE class_id=$1 ORDER BY starts_at",
        [row.id],
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
      missingConditions: CONDITIONS(row, sessions),
    };
  }
  async function saveSessions(c: PoolClient, id: string, input: ClassInput) {
    if (input.teacherId) await checkTeacherSessions(c, input.teacherId, input.sessions);
    await c.query("DELETE FROM sessions WHERE class_id=$1", [id]);
    // Ordered inserts avoid opposite lock acquisition order across concurrent requests.
    for (const s of [...input.sessions].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    ))
      await c.query("INSERT INTO sessions(id,class_id,teacher_id,room_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)", [
        randomUUID(),
        id,
        input.teacherId,
        input.roomId,
        s.startsAt,
        s.endsAt,
      ]);
  }
  return createApp("class-schedule", (app) => {
    app.get("/ready", async (_req, res) => {
      await pool.query("SELECT 1 FROM holds LIMIT 1");
      res.json({ status: "ok" });
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
    app.use(
      "/api/v1",
      authenticate(auth),
      allowRoles("center_director", "branch_director", "admissions", "teacher"),
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
          AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL) OR EXISTS(SELECT 1 FROM sessions s WHERE s.class_id=classes.id AND ($8::timestamptz IS NULL OR s.starts_at >= $8) AND ($9::timestamptz IS NULL OR s.ends_at <= $9)))
          AND (NOT $10::boolean OR (status='OPEN' AND registration_closes_at>transaction_timestamp() AND capacity>(SELECT count(*) FROM holds h WHERE h.class_id=classes.id AND (h.status='COMMITTED' OR (h.status='HELD' AND h.expires_at>transaction_timestamp())))))
          AND ($11::jsonb IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements($11::jsonb) o WHERE (o->>'packageId')::uuid=package_id AND (o->>'courseId')::uuid=course_id AND (o->'modes') ? mode AND ((o->'branchIds')='[]'::jsonb OR (o->'branchIds') ? branch_id::text)))`;
        const params = [
          scope(user),
          user.role === "teacher" ? user.sub : null,
          q.courseId ?? null,
          q.packageId ?? null,
          q.branchId ?? null,
          q.mode ?? null,
          q.status ?? null,
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
        const data = await Promise.all(rows.map((r) => view(c, r)));
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
      res.json({ data });
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
              "UPDATE classes SET code=$2,name=$3,teacher_id=$4,teacher_account_id=$5,mode=$6,room_id=$7,online_url=$8,capacity=$9,minimum_size=$10,registration_closes_at=$11,decision_at=$12,session_count=$13,version=version+1 WHERE id=$1 RETURNING *",
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
            const timing = (await c.query("SELECT min(starts_at)<=clock_timestamp() AS started,max(ends_at)<=clock_timestamp() AS ended FROM sessions WHERE class_id=$1", [id])).rows[0];
            const current = await view(c, row);
            if (input.status === "IN_PROGRESS" && (!timing.started || current.committed < row.minimum_size || current.held > 0))
              throw fail("START_CONDITIONS", "Chưa đến giờ học, chưa đủ sĩ số hoặc còn giữ chỗ chưa xử lý");
            if (input.status === "COMPLETED" && !timing.ended) throw fail("COMPLETION_CONDITIONS", "Lịch học chưa kết thúc");
          }
          if (input.status === "CANCELLED") {
            await expireClass(c, id, res.locals.correlationId);
            if ((await view(c, row)).committed > 0) throw fail("ENROLLMENT_REQUIRED", "Lớp có chỗ đã chốt: cần quy trình Enrollment/hoàn hoặc chuyển lớp trước khi hủy");
            const holds = (await c.query("UPDATE holds SET status='CANCELLED' WHERE class_id=$1 AND status='HELD' RETURNING id", [id])).rows;
            for (const hold of holds) await audit(c, user.sub, "hold.cancelled", hold.id, res.locals.correlationId);
            await c.query("UPDATE sessions SET active=false WHERE class_id=$1", [id]);
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
