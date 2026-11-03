import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  PersonInput, PersonUpdate, PersonQuery, LeadInput, LeadUpdate, LeadQuery, ConsentInput,
  RelationshipInput, RelationshipDecision, ErasureInput, ErasureDecision, ErasureTaskUpdate, ErasureService, VersionInput, ListQuery,
} from "@spacex/contracts";
import { authenticate, allowRoles, principal, checkBranch, type AuthConfig, type Principal } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";

// Explicit conversion of the PostgreSQL row boundary, matching the other services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const Id = z.uuid(), conflict = (code: string, message: string) => new HttpError(409, code, message);
const missing = () => new HttpError(404, "NOT_FOUND", "Không tìm thấy dữ liệu CRM");
const scope = (user: Principal) => user.role === "center_director" ? null : user.branchIds;
const maskedPhone = (phone: string) => phone ? `•••• ${phone.slice(-4)}` : "";
const maskedEmail = (email: string) => email ? `${email.slice(0, 1)}•••@${email.split("@")[1]}` : "";
const personView = (r: Row, full = false) => ({ id: r.id, branchId: r.branch_id, kind: r.kind, fullName: r.full_name, phone: full ? r.phone : maskedPhone(r.phone), email: full ? r.email : maskedEmail(r.email), notes: full ? r.notes : "", status: r.status, version: r.version, createdAt: r.created_at });
const leadView = (r: Row, full = true) => ({ id: r.id, branchId: r.branch_id, contactId: r.contact_id, learnerId: r.learner_id, payerId: r.payer_id, courseId: r.course_id, source: r.source, ownerId: r.owner_id, stage: r.stage, notes: full ? r.notes : "", version: r.version, createdAt: r.created_at, contactName: r.contact_name, contactPhone: maskedPhone(r.contact_phone) });
const consentView = (r: Row) => ({ id: r.id, personId: r.person_id, purpose: r.purpose, status: r.status, statementVersion: r.statement_version, statementText: r.statement_text, method: r.method, actorId: r.actor_id, recordedAt: r.recorded_at });

export function createCrmApp(pool: Pool, auth: AuthConfig, config: { orgUrl: string; catalogUrl: string }) {
  async function transaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const result = await work(c); await c.query("COMMIT"); return result; }
    catch (error) {
      await c.query("ROLLBACK");
      const code = (error as { code?: string })?.code;
      if (code === "23505") throw conflict("DUPLICATE_RECORD", "Đã có lead, quan hệ hoặc yêu cầu đang hoạt động tương ứng. Tải lại để kiểm tra.");
      if (["55P03", "40P01"].includes(code ?? "")) throw conflict("RETRY_OPERATION", "Dữ liệu đang được cập nhật. Thử lại cùng yêu cầu.");
      throw error;
    } finally { c.release(); }
  }
  async function audit(c: PoolClient, res: Response, action: string, target: string | null, branch: string | null, version?: number, emit = true) {
    const id = randomUUID(), actor = principal(res).sub;
    await c.query("INSERT INTO crm_audit(id,actor_id,action,target_id,branch_id,correlation_id,version) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, actor, action, target, branch, res.locals.correlationId, version ?? null]);
    if (emit) await enqueueEvent(c, { id, type: action, version: 1, occurredAt: new Date().toISOString(), correlationId: res.locals.correlationId, payload: { targetId: target, branchId: branch, actorId: actor, aggregateVersion: version ?? 1 } });
  }
  async function upstream<T>(base: string, path: string, req: Request, res: Response): Promise<T> {
    let response: globalThis.Response;
    try { response = await fetch(`${base}${path}`, { headers: { authorization: req.get("authorization")!, "x-correlation-id": res.locals.correlationId, traceparent: res.locals.traceparent }, signal: AbortSignal.timeout(5000) }); }
    catch { throw new HttpError(503, "UPSTREAM_UNAVAILABLE", "Chưa xác minh được dữ liệu Org/IAM/Catalog"); }
    if (response.status === 404) throw conflict("INVALID_REFERENCE", "Dữ liệu tham chiếu không tồn tại");
    if (response.status === 403) throw new HttpError(403, "FORBIDDEN", "Dữ liệu tham chiếu nằm ngoài phạm vi được cấp");
    if (!response.ok) throw new HttpError(503, "UPSTREAM_UNAVAILABLE", "Chưa xác minh được dữ liệu Org/IAM/Catalog");
    return ((await response.json()) as { data: T }).data;
  }
  async function branch(id: string, req: Request, res: Response) {
    checkBranch(principal(res), id);
    const b = await upstream<Row>(config.orgUrl, `/api/v1/branches/${id}`, req, res);
    if (!b.active || b.kind !== "branch") throw conflict("INVALID_BRANCH", "Chọn chi nhánh đang hoạt động");
  }
  async function people(c: PoolClient, ids: string[], user: Principal, active = true) {
    const unique = [...new Set(ids)].sort();
    const { rows } = await c.query("SELECT * FROM crm_people WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [unique]);
    if (rows.length !== unique.length) throw missing();
    for (const row of rows) {
      checkBranch(user, row.branch_id);
      if (active && row.status !== "ACTIVE") throw conflict("PERSON_ERASED", "Hồ sơ đã ẩn danh, không được dùng lại");
      if (active && (await c.query("SELECT 1 FROM crm_erasure_requests WHERE person_id=$1 AND status IN ('VERIFIED','PROCESSING')", [row.id])).rowCount)
        throw conflict("PRIVACY_LOCKED", "Hồ sơ đang xử lý yêu cầu xóa, tạm dừng thay đổi và tạo lead");
    }
    return rows;
  }
  async function idempotent(c: PoolClient, req: Request, res: Response, namespace: string, input: unknown, create: () => Promise<string>) {
    const key = Id.parse(req.get("idempotency-key")), actor = principal(res).sub;
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4005))", [`${actor}:${namespace}:${key}`]);
    const old = (await c.query("SELECT * FROM crm_operations WHERE actor_id=$1 AND namespace=$2 AND operation_key=$3", [actor, namespace, key])).rows[0];
    if (old) { if (old.request_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT", "Khóa thao tác đã dùng cho nội dung khác"); return old.resource_id as string; }
    const id = await create();
    await c.query("INSERT INTO crm_operations VALUES($1,$2,$3,$4,$5)", [actor, namespace, key, hash, id]);
    return id;
  }
  async function admissionsConsent(c: PoolClient, personId: string) {
    const row = (await c.query("SELECT status FROM crm_consents WHERE person_id=$1 AND purpose='ADMISSIONS' ORDER BY sequence DESC LIMIT 1", [personId])).rows[0];
    if (row?.status !== "GRANTED") throw conflict("CONSENT_REQUIRED", "Cần ghi nhận đồng ý tư vấn trước khi tạo hoặc tiếp tục lead. Khách vẫn có thể được tư vấn chung.");
  }
  async function owner(id: string | null, branchId: string, req: Request, res: Response) {
    if (!id) return;
    const rows = await upstream<Row[]>(auth.identityUrl, `/api/v1/assignees?branchId=${branchId}&accountId=${id}`, req, res);
    if (!rows.some(r => r.id === id)) throw conflict("INVALID_OWNER", "Người phụ trách không hoạt động, sai vai trò hoặc ngoài chi nhánh");
  }
  const readLead = async (c: PoolClient, id: string, user: Principal, lock = false) => {
    const row = (await c.query(`SELECT l.*,p.full_name AS contact_name,p.phone AS contact_phone FROM crm_leads l JOIN crm_people p ON p.id=l.contact_id WHERE l.id=$1${lock ? " FOR UPDATE OF l" : ""}`, [id])).rows[0];
    if (!row) throw missing(); checkBranch(user, row.branch_id); return row;
  };
  async function erasureView(c: PoolClient, row: Row) {
    const tasks = (await c.query("SELECT service,status,evidence_ref AS \"evidenceRef\",version FROM crm_erasure_tasks WHERE request_id=$1 ORDER BY service", [row.id])).rows;
    return { id: row.id, personId: row.person_id, branchId: row.branch_id, personName: row.person_name, reason: row.reason, status: row.status, version: row.version, createdAt: row.created_at, tasks };
  }
  async function erasureRow(c: PoolClient, id: string, user: Principal) {
    const row = (await c.query("SELECT r.*,p.full_name AS person_name FROM crm_erasure_requests r JOIN crm_people p ON p.id=r.person_id WHERE r.id=$1 FOR UPDATE OF r", [id])).rows[0];
    if (!row) throw missing(); checkBranch(user, row.branch_id); return row;
  }

  return createApp("crm", app => {
    app.get("/ready", async (_req, res) => { await pool.query("SELECT 1 FROM crm_people LIMIT 1"); res.json({ status: "ok" }); });
    app.use("/api/v1/crm", authenticate(auth), allowRoles("center_director", "branch_director", "admissions"));
    app.get("/api/v1/crm/people", async (req, res) => {
      const q = PersonQuery.parse(req.query), user = principal(res); if (q.branchId) checkBranch(user, q.branchId);
      const result = await transaction(async c => {
        const where = "($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2::uuid IS NULL OR branch_id=$2) AND ($3::text IS NULL OR kind=$3) AND ($4 OR status='ACTIVE') AND ($5::text IS NULL OR full_name ILIKE $5 OR phone ILIKE $5 OR email ILIKE $5)";
        const params = [scope(user), q.branchId ?? null, q.kind ?? null, q.includeErased === "true", q.search ? `%${q.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null];
        const rows = (await c.query(`SELECT * FROM crm_people WHERE ${where} ORDER BY created_at DESC,id LIMIT $6 OFFSET $7`, [...params, q.pageSize, (q.page - 1) * q.pageSize])).rows;
        const total = Number((await c.query(`SELECT count(*) FROM crm_people WHERE ${where}`, params)).rows[0].count);
        await audit(c, res, "crm.people.read", null, q.branchId ?? null, undefined, false);
        return { data: rows.map(r => personView(r)), pagination: { page: q.page, pageSize: q.pageSize, total } };
      }); res.json(result);
    });
    app.post("/api/v1/crm/people", async (req, res) => {
      const input = PersonInput.parse(req.body); await branch(input.branchId, req, res);
      const data = await transaction(async c => {
        const id = await idempotent(c, req, res, "person.create", input, async () => {
          const id = randomUUID(); await c.query("INSERT INTO crm_people(id,branch_id,kind,full_name,phone,email,notes) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, input.branchId, input.kind, input.fullName, input.phone, input.email, input.notes]);
          await audit(c, res, "crm.person.created", id, input.branchId, 1); return id;
        });
        const row = (await c.query("SELECT * FROM crm_people WHERE id=$1", [id])).rows[0];
        checkBranch(principal(res), row.branch_id); return personView(row, true);
      }); res.status(201).json({ data });
    });
    app.get("/api/v1/crm/people/:id", async (req, res) => {
      const data = await transaction(async c => {
        const id = Id.parse(req.params.id), row = (await c.query("SELECT * FROM crm_people WHERE id=$1", [id])).rows[0];
        if (!row) throw missing(); checkBranch(principal(res), row.branch_id);
        const consents = (await c.query("SELECT DISTINCT ON(purpose) * FROM crm_consents WHERE person_id=$1 ORDER BY purpose,sequence DESC", [id])).rows.map(consentView);
        const relationships = (await c.query("SELECT r.*,a.full_name AS from_name,b.full_name AS learner_name FROM crm_relationships r JOIN crm_people a ON a.id=r.from_person_id JOIN crm_people b ON b.id=r.learner_id WHERE r.from_person_id=$1 OR r.learner_id=$1 ORDER BY r.id", [id])).rows.map(r => ({ id: r.id, fromPersonId: r.from_person_id, learnerId: r.learner_id, kind: r.kind, status: r.status, version: r.version, evidenceRef: r.evidence_ref, fromName: r.from_name, learnerName: r.learner_name }));
        const duplicates = row.status === "ACTIVE" ? (await c.query("SELECT * FROM crm_people WHERE branch_id=$1 AND kind=$2 AND id<>$3 AND status='ACTIVE' AND (($4<>'' AND phone=$4) OR ($5<>'' AND email=$5)) ORDER BY created_at LIMIT 20", [row.branch_id, row.kind, id, row.phone, row.email])).rows.map(r => personView(r)) : [];
        await audit(c, res, "crm.person.read", id, row.branch_id, row.version, false);
        return { person: personView(row, true), consents, relationships, duplicates };
      }); res.json({ data });
    });
    app.put("/api/v1/crm/people/:id", async (req, res) => {
      const id = Id.parse(req.params.id), input = PersonUpdate.parse(req.body); await branch(input.input.branchId, req, res);
      const data = await transaction(async c => {
        const [row] = await people(c, [id], principal(res));
        if (row.version !== input.version) throw conflict("STALE_VERSION", "Hồ sơ đã thay đổi, hãy tải lại");
        if (row.branch_id !== input.input.branchId || row.kind !== input.input.kind) throw conflict("IMMUTABLE_REFERENCE", "Không đổi loại hồ sơ hoặc chi nhánh; tạo hồ sơ và liên kết riêng");
        const p = input.input;
        const updated = (await c.query("UPDATE crm_people SET full_name=$2,phone=$3,email=$4,notes=$5,version=version+1 WHERE id=$1 RETURNING *", [id, p.fullName, p.phone, p.email, p.notes])).rows[0];
        await audit(c, res, "crm.person.updated", id, row.branch_id, updated.version); return personView(updated, true);
      }); res.json({ data });
    });
    app.post("/api/v1/crm/people/:id/consents", async (req, res) => {
      const personId = Id.parse(req.params.id), input = ConsentInput.parse(req.body);
      const data = await transaction(async c => {
        // Always re-check current scope/state, even for a retry of an old key.
        const [person] = await people(c, [personId], principal(res));
        const id = await idempotent(c, req, res, `consent:${personId}`, input, async () => {
          const id = randomUUID();
          await c.query("INSERT INTO crm_consents(id,person_id,purpose,status,statement_version,statement_text,method,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id, personId, input.purpose, input.status, input.statementVersion, input.statementText, input.method, principal(res).sub]);
          await audit(c, res, "crm.consent.recorded", personId, person.branch_id); return id;
        }); return consentView((await c.query("SELECT * FROM crm_consents WHERE id=$1", [id])).rows[0]);
      }); res.status(201).json({ data });
    });
    app.post("/api/v1/crm/relationships", async (req, res) => {
      const input = RelationshipInput.parse(req.body);
      const data = await transaction(async c => {
        const rows = await people(c, [input.fromPersonId, input.learnerId], principal(res));
        const from = rows.find(r => r.id === input.fromPersonId)!, learner = rows.find(r => r.id === input.learnerId)!;
        if (!["CONTACT", "PAYER"].includes(from.kind) || learner.kind !== "LEARNER" || from.branch_id !== learner.branch_id) throw conflict("INVALID_RELATIONSHIP", "Liên kết cần người liên hệ/người trả tiền và học viên cùng chi nhánh");
        const id = await idempotent(c, req, res, "relationship.create", input, async () => {
          const id = randomUUID(); await c.query("INSERT INTO crm_relationships(id,from_person_id,learner_id,kind,actor_id) VALUES($1,$2,$3,$4,$5)", [id, from.id, learner.id, input.kind, principal(res).sub]);
          await audit(c, res, "crm.relationship.created", id, from.branch_id, 1); return id;
        }); return { id };
      }); res.status(201).json({ data });
    });
    app.post("/api/v1/crm/relationships/:id/decision", allowRoles("center_director", "branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), input = RelationshipDecision.parse(req.body);
      const data = await transaction(async c => {
        const initial = (await c.query("SELECT * FROM crm_relationships WHERE id=$1", [id])).rows[0]; if (!initial) throw missing();
        const rows = await people(c, [initial.from_person_id, initial.learner_id], principal(res));
        const row = (await c.query("SELECT * FROM crm_relationships WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (row.version !== input.version) throw conflict("STALE_VERSION", "Quan hệ đã thay đổi, hãy tải lại");
        if (row.status === input.status) throw conflict("INVALID_TRANSITION", "Quan hệ đã ở trạng thái này");
        await c.query("UPDATE crm_relationships SET status=$2,evidence_ref=$3,version=version+1 WHERE id=$1", [id, input.status, input.evidenceRef]);
        await audit(c, res, "crm.relationship.decided", id, rows[0].branch_id, row.version + 1); return { id };
      }); res.json({ data });
    });
    app.get("/api/v1/crm/leads", async (req, res) => {
      const q = LeadQuery.parse(req.query), user = principal(res); if (q.branchId) checkBranch(user, q.branchId);
      const result = await transaction(async c => {
        const where = "($1::uuid[] IS NULL OR l.branch_id=ANY($1)) AND ($2::uuid IS NULL OR l.branch_id=$2) AND ($3::text IS NULL OR l.stage=$3) AND ($4::text IS NULL OR l.source=$4) AND ($5::uuid IS NULL OR l.owner_id=$5) AND (NOT $6 OR l.owner_id IS NULL) AND ($7::text IS NULL OR p.full_name ILIKE $7 OR p.phone ILIKE $7 OR p.email ILIKE $7)";
        const params = [scope(user), q.branchId ?? null, q.stage ?? null, q.source ?? null, q.ownerId ?? null, q.unassigned === "true", q.search ? `%${q.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null];
        const from = "FROM crm_leads l JOIN crm_people p ON p.id=l.contact_id";
        const rows = (await c.query(`SELECT l.*,p.full_name AS contact_name,p.phone AS contact_phone ${from} WHERE ${where} ORDER BY l.created_at DESC,l.id LIMIT $8 OFFSET $9`, [...params, q.pageSize, (q.page - 1) * q.pageSize])).rows;
        const total = Number((await c.query(`SELECT count(*) ${from} WHERE ${where}`, params)).rows[0].count);
        await audit(c, res, "crm.leads.read", null, q.branchId ?? null, undefined, false);
        return { data: rows.map(r => leadView(r, false)), pagination: { page: q.page, pageSize: q.pageSize, total } };
      }); res.json(result);
    });
    app.get("/api/v1/crm/leads/:id", async (req, res) => {
      const data = await transaction(async c => {
        const row = await readLead(c, Id.parse(req.params.id), principal(res));
        await audit(c, res, "crm.lead.read", row.id, row.branch_id, row.version, false);
        return leadView(row);
      }); res.json({ data });
    });
    app.post("/api/v1/crm/leads", async (req, res) => {
      const input = LeadInput.parse(req.body), user = principal(res); await branch(input.branchId, req, res);
      const ownerId = user.role === "admissions" ? user.sub : input.ownerId;
      if (user.role === "admissions" && input.ownerId && input.ownerId !== user.sub) throw new HttpError(403, "FORBIDDEN", "Chỉ quản lý được phân công cho người khác");
      await owner(ownerId, input.branchId, req, res);
      if (input.courseId) { const course = await upstream<Row>(config.catalogUrl, `/api/v1/courses/${input.courseId}`, req, res); if (course.status !== "active" || (course.branchIds.length && !course.branchIds.includes(input.branchId))) throw conflict("INVALID_COURSE", "Khóa chưa hoạt động hoặc không bán ở chi nhánh"); }
      const data = await transaction(async c => {
        const rows = await people(c, [input.contactId, input.learnerId, input.payerId].filter((id): id is string => !!id), user);
        const contact = rows.find(r => r.id === input.contactId)!;
        if (contact.kind !== "CONTACT" || rows.some(r => r.branch_id !== input.branchId)) throw conflict("INVALID_CONTACT", "Chọn đúng người liên hệ và hồ sơ cùng chi nhánh");
        await admissionsConsent(c, input.contactId);
        for (const [id, kind] of [[input.learnerId, "LEARNER"], [input.payerId, "PAYER"]] as const) if (id && rows.find(r => r.id === id)?.kind !== kind) throw conflict("INVALID_PERSON_KIND", "Loại hồ sơ không phù hợp");
        if (input.learnerId) {
          for (const from of [input.contactId, input.payerId].filter((id): id is string => !!id))
            if (!(await c.query("SELECT 1 FROM crm_relationships WHERE from_person_id=$1 AND learner_id=$2 AND status='VERIFIED'", [from, input.learnerId])).rowCount) throw conflict("RELATIONSHIP_UNVERIFIED", "Cần quản lý xác minh quan hệ với học viên trước khi dùng liên kết");
        } else if (input.payerId) throw conflict("LEARNER_REQUIRED", "Chọn học viên để xác minh quan hệ người trả tiền");
        const id = await idempotent(c, req, res, "lead.create", input, async () => {
          const id = randomUUID(); await c.query("INSERT INTO crm_leads(id,branch_id,contact_id,learner_id,payer_id,course_id,source,owner_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, input.branchId, input.contactId, input.learnerId, input.payerId, input.courseId, input.source, ownerId, input.notes]);
          await audit(c, res, "crm.lead.created", id, input.branchId, 1); return id;
        }); return leadView(await readLead(c, id, user));
      }); res.status(201).json({ data });
    });
    app.put("/api/v1/crm/leads/:id", async (req, res) => {
      const id = Id.parse(req.params.id), input = LeadUpdate.parse(req.body), user = principal(res);
      const initial = await transaction(c => readLead(c, id, user));
      await branch(initial.branch_id, req, res); await owner(input.ownerId, initial.branch_id, req, res);
      const data = await transaction(async c => {
        await people(c, [initial.contact_id, initial.learner_id, initial.payer_id].filter(Boolean), user);
        const row = await readLead(c, id, user, true);
        if (row.version !== input.version) throw conflict("STALE_VERSION", "Lead đã thay đổi, hãy tải lại");
        if (user.role === "admissions" && (row.owner_id !== user.sub || input.ownerId !== row.owner_id)) throw new HttpError(403, "FORBIDDEN", "Nhận lead chưa phân công trước; không sửa lead của nhân viên khác");
        const allowed: Record<string, string[]> = { NEW: ["NEW", "CONTACTED", "LOST"], CONTACTED: ["CONTACTED", "QUALIFIED", "LOST"], QUALIFIED: ["QUALIFIED", "CONTACTED", "LOST"], LOST: ["LOST", "NEW"] };
        if (!allowed[row.stage].includes(input.stage)) throw conflict("INVALID_STAGE", "Giai đoạn lead không cho phép chuyển trực tiếp");
        if (input.stage !== "LOST") await admissionsConsent(c, row.contact_id);
        await c.query("UPDATE crm_leads SET stage=$2,owner_id=$3,notes=$4,version=version+1 WHERE id=$1", [id, input.stage, input.ownerId, input.notes]);
        await audit(c, res, "crm.lead.updated", id, row.branch_id, row.version + 1); return leadView(await readLead(c, id, user));
      }); res.json({ data });
    });
    app.post("/api/v1/crm/leads/:id/claim", async (req, res) => {
      const id = Id.parse(req.params.id), { version } = VersionInput.parse(req.body), user = principal(res);
      const initial = await transaction(c => readLead(c, id, user)); await owner(user.sub, initial.branch_id, req, res);
      const data = await transaction(async c => {
        await people(c, [initial.contact_id], user); await admissionsConsent(c, initial.contact_id);
        const row = await readLead(c, id, user, true);
        if (row.version !== version) throw conflict("STALE_VERSION", "Lead đã được cập nhật hoặc nhận bởi người khác");
        if (row.owner_id || row.stage === "LOST") throw conflict("ALREADY_ASSIGNED", "Lead đã có người phụ trách hoặc đã đóng");
        await c.query("UPDATE crm_leads SET owner_id=$2,version=version+1 WHERE id=$1", [id, user.sub]);
        await audit(c, res, "crm.lead.claimed", id, row.branch_id, row.version + 1); return leadView(await readLead(c, id, user));
      }); res.json({ data });
    });
    app.get("/api/v1/crm/erasure-requests", async (req, res) => {
      const q = ListQuery.extend({ branchId: Id.optional() }).strict().parse(req.query), user = principal(res); if (q.branchId) checkBranch(user, q.branchId);
      const result = await transaction(async c => {
        const params = [scope(user), q.branchId ?? null];
        const where = "($1::uuid[] IS NULL OR r.branch_id=ANY($1)) AND ($2::uuid IS NULL OR r.branch_id=$2)";
        const rows = (await c.query(`SELECT r.*,p.full_name AS person_name FROM crm_erasure_requests r JOIN crm_people p ON p.id=r.person_id WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`, [...params, q.pageSize, (q.page - 1) * q.pageSize])).rows;
        const total = Number((await c.query(`SELECT count(*) FROM crm_erasure_requests r WHERE ${where}`, params)).rows[0].count);
        await audit(c, res, "crm.erasure.read", null, q.branchId ?? null, undefined, false);
        return { data: await Promise.all(rows.map(row => erasureView(c, row))), pagination: { page: q.page, pageSize: q.pageSize, total } };
      }); res.json(result);
    });
    app.post("/api/v1/crm/erasure-requests", async (req, res) => {
      const input = ErasureInput.parse(req.body);
      const data = await transaction(async c => {
        const [person] = await people(c, [input.personId], principal(res));
        const id = await idempotent(c, req, res, "erasure.create", input, async () => {
          const id = randomUUID(); await c.query("INSERT INTO crm_erasure_requests(id,person_id,branch_id,reason,requested_by) VALUES($1,$2,$3,$4,$5)", [id, person.id, person.branch_id, input.reason, principal(res).sub]);
          for (const service of ErasureService.options) await c.query("INSERT INTO crm_erasure_tasks(request_id,service) VALUES($1,$2)", [id, service]);
          await audit(c, res, "crm.erasure.requested", id, person.branch_id, 1); return id;
        }); return erasureView(c, await erasureRow(c, id, principal(res)));
      }); res.status(201).json({ data });
    });
    app.get("/api/v1/crm/erasure-requests/:id", async (req, res) => {
      const data = await transaction(async c => {
        const row = await erasureRow(c, Id.parse(req.params.id), principal(res));
        await audit(c, res, "crm.erasure.read", row.id, row.branch_id, row.version, false);
        return erasureView(c, row);
      }); res.json({ data });
    });
    app.post("/api/v1/crm/erasure-requests/:id/decision", allowRoles("center_director", "branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), input = ErasureDecision.parse(req.body);
      const data = await transaction(async c => {
        const initial = (await c.query("SELECT person_id FROM crm_erasure_requests WHERE id=$1", [id])).rows[0]; if (!initial) throw missing();
        await people(c, [initial.person_id], principal(res)); const row = await erasureRow(c, id, principal(res));
        if (row.version !== input.version) throw conflict("STALE_VERSION", "Yêu cầu đã thay đổi, hãy tải lại");
        if (row.status !== "PENDING_VERIFICATION") throw conflict("INVALID_TRANSITION", "Yêu cầu không còn chờ xác minh");
        await c.query("UPDATE crm_erasure_requests SET status=$2,verified_by=$3,verification_method=$4,evidence_ref=$5,version=version+1 WHERE id=$1", [id, input.decision, principal(res).sub, input.method, input.evidenceRef]);
        await audit(c, res, "crm.erasure.decided", id, row.branch_id, row.version + 1); return erasureView(c, await erasureRow(c, id, principal(res)));
      }); res.json({ data });
    });
    app.post("/api/v1/crm/erasure-requests/:id/anonymize", allowRoles("center_director", "branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), { version } = VersionInput.parse(req.body);
      const data = await transaction(async c => {
        const initial = (await c.query("SELECT person_id FROM crm_erasure_requests WHERE id=$1", [id])).rows[0]; if (!initial) throw missing();
        const [person] = await people(c, [initial.person_id], principal(res), false); const row = await erasureRow(c, id, principal(res));
        if (row.version !== version) throw conflict("STALE_VERSION", "Yêu cầu đã thay đổi, hãy tải lại");
        if (row.status !== "VERIFIED") throw conflict("VERIFICATION_REQUIRED", "Cần xác minh người yêu cầu trước khi ẩn danh");
        await c.query("UPDATE crm_people SET full_name='Đã ẩn danh',phone='',email='',notes='',status='ERASED',version=version+1 WHERE id=$1", [person.id]);
        await c.query("UPDATE crm_leads SET stage='LOST',notes='',version=version+1 WHERE contact_id=$1 OR learner_id=$1 OR payer_id=$1", [person.id]);
        await c.query("UPDATE crm_relationships SET status='REJECTED',evidence_ref='',version=version+1 WHERE from_person_id=$1 OR learner_id=$1", [person.id]);
        await c.query("UPDATE crm_consents SET status='REVOKED',statement_text='Nội dung đã được loại bỏ theo yêu cầu xóa' WHERE person_id=$1", [person.id]);
        await c.query("INSERT INTO crm_erasure_tombstones(person_id,branch_id,request_id) VALUES($1,$2,$3)", [person.id, person.branch_id, id]);
        // Idempotency hashes can contain fingerprints of identifying input.
        await c.query("UPDATE crm_operations SET request_hash='ERASED' WHERE resource_id=$1 OR resource_id IN (SELECT id FROM crm_leads WHERE contact_id=$1 OR learner_id=$1 OR payer_id=$1) OR resource_id IN (SELECT id FROM crm_consents WHERE person_id=$1) OR resource_id IN (SELECT id FROM crm_relationships WHERE from_person_id=$1 OR learner_id=$1)", [person.id]);
        await c.query("UPDATE crm_erasure_tasks SET status='DONE',evidence_ref='CRM_TRANSACTION',actor_id=$2,version=version+1 WHERE request_id=$1 AND service='CRM'", [id, principal(res).sub]);
        await c.query("UPDATE crm_erasure_requests SET status='PROCESSING',version=version+1 WHERE id=$1", [id]);
        await audit(c, res, "crm.person.anonymized", person.id, person.branch_id, person.version + 1);
        return erasureView(c, await erasureRow(c, id, principal(res)));
      }); res.json({ data });
    });
    app.post("/api/v1/crm/erasure-requests/:id/tasks/:service", allowRoles("center_director", "branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), service = ErasureService.parse(req.params.service), input = ErasureTaskUpdate.parse(req.body);
      if (service === "CRM") throw new HttpError(403, "FORBIDDEN", "Trạng thái CRM chỉ cập nhật bởi thao tác ẩn danh thực tế");
      const data = await transaction(async c => {
        const row = await erasureRow(c, id, principal(res));
        if (row.status !== "PROCESSING") throw conflict("INVALID_TRANSITION", "Cần hoàn thành xác minh và ẩn danh CRM trước");
        const changed = await c.query("UPDATE crm_erasure_tasks SET status=$3,evidence_ref=$4,actor_id=$5,version=version+1 WHERE request_id=$1 AND service=$2 AND version=$6", [id, service, input.status, input.evidenceRef, principal(res).sub, input.version]);
        if (!changed.rowCount) throw conflict("STALE_VERSION", "Trạng thái xử lý đã thay đổi, hãy tải lại");
        const remaining = (await c.query("SELECT 1 FROM crm_erasure_tasks WHERE request_id=$1 AND status NOT IN ('DONE','NOT_APPLICABLE') LIMIT 1", [id])).rowCount;
        await c.query("UPDATE crm_erasure_requests SET status=$2,version=version+1 WHERE id=$1", [id, remaining ? "PROCESSING" : "COMPLETED"]);
        await audit(c, res, "crm.erasure.task_recorded", id, row.branch_id, row.version + 1); return erasureView(c, await erasureRow(c, id, principal(res)));
      }); res.json({ data });
    });
  });
}
