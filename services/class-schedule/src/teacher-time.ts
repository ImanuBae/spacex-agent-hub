import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { TeacherTimeInput, TeacherTimeDecision } from "@spacex/contracts";
import { allowRoles, principal, checkBranch } from "@spacex/auth";
import { HttpError } from "@spacex/http";

type Audit = (client: PoolClient, actor: string, action: string, target: string, correlation: string) => Promise<void>;
type Transaction = <T>(pool: Pool, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type Teacher = { id: string; accountId: string; branchId: string; name: string };
const conflict = (message: string) => new HttpError(409, "TEACHER_TIME_CONFLICT", message);

export async function lockTeacher(client: PoolClient, teacherId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4004))", [teacherId]);
}

// Legacy timetables remain usable until a teacher first declares availability.
// Configuration is durable; cancelling the last declaration never disables checks.
export async function checkTeacherSessions(client: PoolClient, teacherId: string, sessions: { startsAt: string; endsAt: string }[]) {
  await lockTeacher(client, teacherId);
  for (const s of sessions) {
    const { rows } = await client.query(
      `SELECT
       EXISTS(SELECT 1 FROM teacher_time WHERE teacher_id=$1 AND kind='LEAVE' AND status='APPROVED' AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')) AS on_leave,
       EXISTS(SELECT 1 FROM teacher_time_config WHERE teacher_id=$1) AS configured,
       EXISTS(SELECT 1 FROM teacher_time WHERE teacher_id=$1 AND kind='AVAILABLE' AND status='APPROVED' AND starts_at<=$2 AND ends_at>=$3) AS available`,
      [teacherId, s.startsAt, s.endsAt],
    );
    if (rows[0].on_leave) throw conflict("Buổi học trùng thời gian nghỉ đã duyệt của giảng viên");
    if (rows[0].configured && !rows[0].available) throw conflict("Buổi học nằm ngoài giờ rảnh đã khai báo của giảng viên");
  }
}

export function registerTeacherTime(
  app: Express, pool: Pool, transaction: Transaction, audit: Audit,
  teachers: (req: Request, res: Response) => Promise<Teacher[]>,
) {
  const view = (row: Record<string, unknown>) => ({
    id: row.id, teacherId: row.teacher_id, accountId: row.account_id,
    branchId: row.branch_id, kind: row.kind, startsAt: row.starts_at,
    endsAt: row.ends_at, reason: row.reason, status: row.status,
    version: row.version, decisionReason: row.decision_reason,
  });
  app.get("/api/v1/teacher-time", allowRoles("center_director", "branch_director", "teacher"), async (req, res) => {
    const user = principal(res), teacherId = z.uuid().optional().parse(req.query.teacherId);
    const permitted = await teachers(req, res);
    const ids = permitted.filter(t => !teacherId || t.id === teacherId).map(t => t.id);
    const { rows } = await pool.query(
      "SELECT * FROM teacher_time WHERE teacher_id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR account_id=$2) ORDER BY starts_at DESC,id LIMIT 500",
      [ids, user.role === "teacher" ? user.sub : null],
    );
    res.json({ data: rows.map(view) });
  });
  app.post("/api/v1/teacher-time", allowRoles("teacher"), async (req, res) => {
    const input = TeacherTimeInput.parse(req.body), user = principal(res), key = z.uuid().parse(req.get("idempotency-key"));
    const teacher = (await teachers(req, res)).find(t => t.id === input.teacherId && t.accountId === user.sub);
    if (!teacher) throw new HttpError(403, "FORBIDDEN", "Chỉ được khai thời gian cho hồ sơ giảng viên của mình");
    checkBranch(user, teacher.branchId);
    const data = await transaction(pool, async client => {
      await lockTeacher(client, teacher.id);
      const previous = (await client.query("SELECT *,input_payload=$3::jsonb AS identical FROM teacher_time WHERE account_id=$1 AND operation_key=$2", [user.sub, key, JSON.stringify(input)])).rows[0];
      if (previous) {
        if (!previous.identical) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "Khóa thao tác đã dùng cho khai báo khác");
        return view(previous);
      }
      if (!(await client.query("SELECT $1::timestamptz>clock_timestamp() AS valid", [input.startsAt])).rows[0].valid)
        throw new HttpError(400, "VALIDATION_ERROR", "Chọn thời gian trong tương lai");
      const id = randomUUID();
      const { rows } = await client.query(
        "INSERT INTO teacher_time(id,teacher_id,account_id,branch_id,kind,starts_at,ends_at,reason,status,operation_key,input_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [id, teacher.id, user.sub, teacher.branchId, input.kind, input.startsAt, input.endsAt, input.reason, input.kind === "AVAILABLE" ? "APPROVED" : "PENDING", key, JSON.stringify(input)],
      );
      if (input.kind === "AVAILABLE") {
        await client.query("INSERT INTO teacher_time_config(teacher_id) VALUES($1) ON CONFLICT DO NOTHING", [teacher.id]);
        const sessions = (await client.query("SELECT starts_at,ends_at FROM sessions WHERE teacher_id=$1 AND active AND ends_at>clock_timestamp()", [teacher.id])).rows;
        await checkTeacherSessions(client, teacher.id, sessions.map(s => ({ startsAt: s.starts_at.toISOString(), endsAt: s.ends_at.toISOString() })));
      }
      await audit(client, user.sub, `teacher-time.${input.kind.toLowerCase()}.created`, id, res.locals.correlationId);
      return view(rows[0]);
    });
    res.status(201).json({ data });
  });
  app.post("/api/v1/teacher-time/:id/decision", allowRoles("center_director", "branch_director", "teacher"), async (req, res) => {
    const id = z.uuid().parse(req.params.id), input = TeacherTimeDecision.parse(req.body), user = principal(res);
    const permitted = await teachers(req, res);
    const data = await transaction(pool, async client => {
      const old = (await client.query("SELECT * FROM teacher_time WHERE id=$1", [id])).rows[0];
      if (!old) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy khai báo");
      checkBranch(user, old.branch_id);
      if (input.status === "APPROVED" && old.account_id === user.sub) throw new HttpError(403, "FORBIDDEN", "Không được tự duyệt đề nghị nghỉ của mình");
      if (!permitted.some(t => t.id === old.teacher_id)) throw new HttpError(403, "FORBIDDEN", "Ngoài phạm vi giảng viên hiện tại");
      if (user.role === "teacher" && (old.account_id !== user.sub || input.status !== "CANCELLED"))
        throw new HttpError(403, "FORBIDDEN", "Giảng viên chỉ được rút khai báo của mình");
      await lockTeacher(client, old.teacher_id);
      const current = (await client.query("SELECT * FROM teacher_time WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (current.version !== input.version) throw new HttpError(409, "STALE_VERSION", "Khai báo đã thay đổi, hãy tải lại");
      if (!(input.status === "CANCELLED" && ["PENDING", "APPROVED"].includes(current.status)) &&
          !(current.kind === "LEAVE" && current.status === "PENDING" && ["APPROVED", "REJECTED"].includes(input.status)))
        throw new HttpError(409, "INVALID_TRANSITION", "Trạng thái khai báo không cho phép thao tác này");
      if (input.status === "APPROVED") {
        const affected = await client.query("SELECT 1 FROM sessions WHERE teacher_id=$1 AND active AND ends_at>clock_timestamp() AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1", [current.teacher_id, current.starts_at, current.ends_at]);
        if (affected.rowCount) throw conflict("Cần xếp lại các buổi học bị ảnh hưởng trước khi duyệt nghỉ");
      }
      const { rows } = await client.query("UPDATE teacher_time SET status=$2,decision_reason=$3,decided_by=$4,version=version+1 WHERE id=$1 RETURNING *", [id, input.status, input.reason, user.sub]);
      if (current.kind === "AVAILABLE" && input.status === "CANCELLED") {
        const sessions = (await client.query("SELECT starts_at,ends_at FROM sessions WHERE teacher_id=$1 AND active AND ends_at>clock_timestamp()", [current.teacher_id])).rows;
        await checkTeacherSessions(client, current.teacher_id, sessions.map(s => ({ startsAt: s.starts_at.toISOString(), endsAt: s.ends_at.toISOString() })));
      }
      await audit(client, user.sub, `teacher-time.${input.status.toLowerCase()}`, id, res.locals.correlationId);
      return view(rows[0]);
    });
    res.json({ data });
  });
}
