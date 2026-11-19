import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  PersonInput, PersonUpdate, PersonQuery, LeadInput, LeadUpdate, LeadQuery, ConsentInput,
  RelationshipInput, RelationshipDecision, ErasureInput, ErasureDecision, ErasureTaskUpdate, ErasureService, VersionInput, ListQuery,
  CrmAutomationInput, CrmMergeInput, CrmMergeApproval,
} from "@spacex/contracts";
import { authenticate, authenticateCommand, verifyCommand, bearer, iamRequest, allowRoles, principal, checkBranch, type AuthConfig, type Principal } from "@spacex/auth";
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
const personView = (r: Row, full = false) => ({ id: r.id, branchId: r.branch_id, kind: r.kind, fullName: r.full_name, phone: full ? r.phone : maskedPhone(r.phone), email: full ? r.email : maskedEmail(r.email), notes: full ? r.notes : "", status: r.status, version: r.version, createdAt: r.created_at, mergedInto: r.merged_into ?? null });
const leadView = (r: Row, full = true) => ({ id: r.id, branchId: r.branch_id, contactId: r.contact_id, learnerId: r.learner_id, payerId: r.payer_id, courseId: r.course_id, source: r.source, ownerId: r.owner_id, stage: r.stage, notes: full ? r.notes : "", version: r.version, createdAt: r.created_at, contactName: r.contact_name, contactPhone: maskedPhone(r.contact_phone) });
const consentView = (r: Row) => ({ id: r.id, personId: r.person_id, purpose: r.purpose, status: r.status, statementVersion: r.statement_version, statementText: r.statement_text, method: r.method, actorId: r.actor_id, recordedAt: r.recorded_at });

export function createCrmApp(pool: Pool, auth: AuthConfig, config: { orgUrl: string; catalogUrl: string; conversationUrl?: string; enrollmentUrl?: string; notificationUrl?: string }) {
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
      if (active && row.merged_into) throw conflict("PERSON_MERGED", "Hồ sơ đã gộp; đọc mapping và dùng hồ sơ đích");
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

  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)).digest("hex");
  const channelIdentity = z.object({ provider: z.literal("WEB_CHAT"), accountRef: Id, subjectRef: Id, branchId: Id, conversationId: Id, version: z.number().int().positive() }).strict();
  async function enrollmentAuthority(c: PoolClient, input: { contactId: string; learnerId: string; payerId: string }, user: Principal) {
    const rows = await people(c, [input.contactId, input.learnerId, input.payerId], user);
    const contact = rows.find(r => r.id === input.contactId)!, learner = rows.find(r => r.id === input.learnerId)!, payer = rows.find(r => r.id === input.payerId)!;
    if (contact.kind !== "CONTACT" || learner.kind !== "LEARNER" || payer.kind !== "PAYER" || rows.some(r => r.branch_id !== contact.branch_id)) throw conflict("INVALID_PERSON_KIND", "Contact, learner and payer must be separate verified profiles in one branch");
    await admissionsConsent(c, contact.id);
    const relationships = (await c.query("SELECT id,version,from_person_id FROM crm_relationships WHERE learner_id=$1 AND from_person_id=ANY($2::uuid[]) AND status='VERIFIED' ORDER BY id FOR UPDATE", [learner.id, [contact.id, payer.id]])).rows;
    if (relationships.length !== 2) throw conflict("RELATIONSHIP_UNVERIFIED", "Both contact and payer must have verified relationships to this learner");
    const consent = (await c.query("SELECT id,sequence FROM crm_consents WHERE person_id=$1 AND purpose='ADMISSIONS' ORDER BY sequence DESC LIMIT 1", [contact.id])).rows[0];
    return { contactId: input.contactId, learnerId: input.learnerId, payerId: input.payerId, branchId: contact.branch_id, consentRef: consent.id, consentSequence: String(consent.sequence), relationshipVersions: relationships.map(r => ({ id: r.id, version: r.version })) };
  }
  async function mergeReport(c: PoolClient, input: z.infer<typeof CrmMergeInput>, user: Principal) {
    const rows = await people(c, [input.sourceId, input.targetId], user), source = rows.find(r => r.id === input.sourceId)!, target = rows.find(r => r.id === input.targetId)!;
    if (source.branch_id !== target.branch_id || source.kind !== target.kind) throw conflict("MERGE_SCOPE", "Only profiles of the same kind and branch can merge");
    if (source.version !== input.sourceVersion || target.version !== input.targetVersion) throw conflict("STALE_VERSION", "Merge needs fresh profile versions");
    const unresolved = ["fullName", "phone", "email", "notes"].filter(field => {
      const column = field === "fullName" ? "full_name" : field;
      return source[column] !== target[column] && !input.resolutions[field as keyof typeof input.resolutions];
    });
    const leads = (await c.query("SELECT * FROM crm_leads WHERE contact_id=ANY($1::uuid[]) OR learner_id=ANY($1::uuid[]) OR payer_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[source.id, target.id]])).rows;
    const relationships = (await c.query("SELECT * FROM crm_relationships WHERE from_person_id=ANY($1::uuid[]) OR learner_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[source.id, target.id]])).rows;
    const identities = (await c.query("SELECT id,contact_id,version FROM crm_channel_identities WHERE contact_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[source.id, target.id]])).rows;
    const consents = (await c.query("SELECT DISTINCT ON(person_id,purpose) person_id,purpose,status,sequence FROM crm_consents WHERE person_id=ANY($1::uuid[]) ORDER BY person_id,purpose,sequence DESC", [[source.id, target.id]])).rows;
    const remap = (id: string) => id === source.id ? target.id : id;
    const leadKeys = leads.filter(r => r.stage !== "LOST").map(r => [r.branch_id, remap(r.contact_id), remap(r.learner_id), r.course_id].join(":"));
    const relationshipKeys = relationships.map(r => [remap(r.from_person_id), remap(r.learner_id)].join(":"));
    const blockers = [...(new Set(leadKeys).size !== leadKeys.length ? ["LEAD_COLLISION"] : []), ...(new Set(relationshipKeys).size !== relationshipKeys.length ? ["RELATIONSHIP_COLLISION"] : [])];
    return { source: personView(source, true), target: personView(target, true), unresolved, blockers, leads, relationships, identities, consents, consentPolicy: "REQUIRE_NEW_CONSENT_AFTER_MERGE" };
  }
  async function crmRequest(c: PoolClient, id: string, user: Principal, lock = false) {
    const row = (await c.query(`SELECT * FROM crm_automation_requests WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
    if (!row) throw missing(); checkBranch(user, row.branch_id);
    if (row.actor_id !== user.sub || row.actor_session_id !== user.sid) throw new HttpError(403, "FORBIDDEN", "CRM request belongs to another actor/session");
    if (user.delegation && (user.delegation.operation !== "crm.execute" || user.delegation.inputRef !== id || user.delegation.entity?.type !== "crm-request" || user.delegation.entity.id !== id || user.delegation.entity.version !== 1)) throw new HttpError(403, "FORBIDDEN", "CRM source binding does not match");
    return row;
  }
  const requestView = (row: Row) => ({ id: row.id, branchId: row.branch_id, action: row.payload.action, status: row.status, result: row.result, source: row.source, jobId: row.job_id, erased: !!row.erasure_request_id });

  return createApp("crm", app => {
    app.get("/ready", async (_req, res) => { await pool.query("SELECT 1 FROM crm_people LIMIT 1"); res.json({ status: "ok" }); });
    async function currentCourseConsent(c: PoolClient, learnerId: string, branchId: string) {
      const person = (await c.query("SELECT * FROM crm_people WHERE id=$1 FOR SHARE", [learnerId])).rows[0];
      const consent = (await c.query("SELECT status FROM crm_consents WHERE person_id=$1 AND purpose='COURSE_NOTICES' ORDER BY sequence DESC LIMIT 1", [learnerId])).rows[0];
      const erasure = (await c.query("SELECT 1 FROM crm_erasure_requests WHERE person_id=$1 AND status IN ('VERIFIED','PROCESSING')", [learnerId])).rowCount;
      return !!person && person.kind === "LEARNER" && person.status === "ACTIVE" && !person.merged_into && person.branch_id === branchId && !erasure && consent?.status === "GRANTED";
    }
    app.get("/internal/crm/adjustments/:id/waitlist-consent", async (req, res) => {
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const verify = () => verifyCommand(auth, token, "enrollment", "enrollment:adjust");
      const user = await verify(), d = user.delegation;
      if (d?.workflowId !== "WF-09" || d.operation !== "enrollment.adjust" || d.entity?.type !== "adjustment" || d.entity.id !== id || d.inputRef !== id)
        throw new HttpError(403, "FORBIDDEN", "Waitlist source binding does not match");
      if (!config.enrollmentUrl) throw new HttpError(503, "ENROLLMENT_UNAVAILABLE", "Enrollment authority required");
      const source = z.object({ learnerId: Id, branchId: Id, type: z.literal("WAITLIST") }).passthrough().parse(await upstream(config.enrollmentUrl, `/internal/enrollment/adjustments/${id}/authority`, req, res));
      if (source.branchId !== d.branchId) throw new HttpError(403, "FORBIDDEN", "Waitlist branch does not match");
      const allowed = await transaction(async c => { const allowed = await currentCourseConsent(c, source.learnerId, source.branchId); await verify(); return allowed; });
      res.json({ data: { allowed } });
    });
    app.get("/internal/crm/notifications/:id", async (req, res) => {
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization"));
      const verify = () => verifyCommand(auth, token, "notification", "notification:deliver");
      const user = await verify(), d = user.delegation;
      if (d?.workflowId !== "WF-10" || d.operation !== "notification.deliver" || d.entity?.type !== "notification" || d.entity.id !== id || d.inputRef !== id)
        throw new HttpError(403, "FORBIDDEN", "Notification source binding does not match");
      if (!config.notificationUrl) throw new HttpError(503, "NOTIFICATION_UNAVAILABLE", "Notification authority required");
      const source = z.object({ learnerId: Id, branchId: Id }).passthrough().parse(await upstream(config.notificationUrl, `/internal/notification/intents/${id}/authority`, req, res));
      if (source.branchId !== d.branchId) throw new HttpError(403, "FORBIDDEN", "Notification branch does not match");
      const data = await transaction(async c => {
        const allowed = await currentCourseConsent(c, source.learnerId, source.branchId);
        await verify();
        return { allowed };
      });
      res.json({ data });
    });
    app.get("/internal/crm/enrollment-authority", async (req, res) => {
      const { enrollmentId } = z.object({ enrollmentId: Id }).strict().parse(req.query), token = bearer(req.get("authorization"));
      const verify = () => verifyCommand(auth, token, "enrollment", "enrollment:write");
      const user = await verify();
      if (user.delegation?.operation !== "enrollment.execute" || user.delegation.entity?.type !== "enrollment" || user.delegation.entity.id !== enrollmentId) throw new HttpError(403, "FORBIDDEN", "Enrollment source binding does not match");
      if (!config.enrollmentUrl) throw new HttpError(503, "ENROLLMENT_UNAVAILABLE", "Enrollment source required");
      const source = z.object({ id: Id, branchId: Id, contactId: Id, learnerId: Id, payerId: Id }).strict().parse(await upstream(config.enrollmentUrl, `/internal/enrollment/enrollments/${enrollmentId}/customer-authority`, req, res));
      if (source.id !== enrollmentId || source.branchId !== user.delegation.branchId) throw new HttpError(403, "FORBIDDEN", "Enrollment source binding does not match");
      const data = await transaction(async c => { const data = await enrollmentAuthority(c, source, user); await verify(); return data; });
      res.json({ data });
    });
    app.use("/internal/crm/requests", authenticateCommand(auth, "crm", "crm:write"), allowRoles("center_director", "branch_director", "admissions"));
    app.get("/internal/crm/requests/:id", async (req, res) => res.json({ data: requestView(await transaction(c => crmRequest(c, Id.parse(req.params.id), principal(res)))) }));
    app.post("/internal/crm/requests/:id/execute", async (req, res) => {
      z.object({}).strict().parse(req.body);
      const id = Id.parse(req.params.id), token = bearer(req.get("authorization")), verify = () => verifyCommand(auth, token, "crm", "crm:write");
      const user = await verify();
      const data = await transaction(async c => {
        const request = await crmRequest(c, id, user, true);
        if (request.erasure_request_id) throw conflict("PERSON_ERASED", "CRM request was scrubbed by verified erasure");
        const input = CrmAutomationInput.parse(request.payload);
        if (request.job_id && request.job_id !== user.delegation!.jobId) throw conflict("OPERATION_CONFLICT", "Lookup the original CRM job");
        if (request.status === "DONE") return requestView(request);
        await c.query("UPDATE crm_automation_requests SET job_id=$2 WHERE id=$1", [id, user.delegation!.jobId]);
        let result: Row, partial = false;
        if (input.action === "resolve-channel") {
          if (!config.conversationUrl) throw new HttpError(503, "CHANNEL_UNAVAILABLE", "Conversation source required");
          const source = channelIdentity.parse(await upstream(config.conversationUrl, `/internal/conversations/${input.conversationId}/crm-context`, req, res));
          if (digest(source) !== digest(request.source)) throw conflict("SOURCE_CHANGED", "Reconfirm the current Conversation identity");
          await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4005))", [`${source.provider}:${source.accountRef}:${source.subjectRef}`]);
          // The contact lock below also fences merge; do not lock mapping before people.
          let mapping = (await c.query("SELECT * FROM crm_channel_identities WHERE provider=$1 AND account_ref=$2 AND subject_ref=$3", [source.provider, source.accountRef, source.subjectRef])).rows[0];
          if (!mapping) {
            const contactId = randomUUID(), identityId = randomUUID(), p = input.contact;
            await c.query("INSERT INTO crm_people(id,branch_id,kind,full_name,phone,email,notes) VALUES($1,$2,'CONTACT',$3,$4,$5,$6)", [contactId, source.branchId, p.fullName, p.phone, p.email, p.notes]);
            mapping = (await c.query("INSERT INTO crm_channel_identities(id,provider,account_ref,subject_ref,branch_id,contact_id,source_ref,source_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [identityId, source.provider, source.accountRef, source.subjectRef, source.branchId, contactId, source.conversationId, source.version, user.sub])).rows[0];
            await audit(c, res, "crm.channel.resolved", contactId, source.branchId, 1);
            if (input.consent) {
              const p = input.consent;
              if (p.purpose !== "ADMISSIONS" || p.status !== "GRANTED") throw conflict("CONSENT_PURPOSE", "Only explicit admissions consent may accompany this source request");
              await c.query("INSERT INTO crm_consents(id,person_id,purpose,status,statement_version,statement_text,method,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), contactId, p.purpose, p.status, p.statementVersion, p.statementText, p.method, user.sub]);
              await audit(c, res, "crm.consent.recorded", contactId, source.branchId);
            }
          }
          await people(c, [mapping.contact_id], user);
          result = { contactId: mapping.contact_id, identityRef: mapping.id };
          if (input.createLead) {
            const consent = (await c.query("SELECT status FROM crm_consents WHERE person_id=$1 AND purpose='ADMISSIONS' ORDER BY sequence DESC LIMIT 1", [mapping.contact_id])).rows[0];
            if (consent?.status !== "GRANTED") { partial = true; result.errorCode = "CONSENT_REQUIRED"; }
            else {
              let lead = (await c.query("SELECT * FROM crm_leads WHERE contact_id=$1 AND learner_id IS NULL AND course_id IS NULL AND stage<>'LOST' FOR UPDATE", [mapping.contact_id])).rows[0];
              if (!lead) {
                lead = (await c.query("INSERT INTO crm_leads(id,branch_id,contact_id,source,owner_id) VALUES($1,$2,$3,'WEB_CHAT',$4) RETURNING *", [randomUUID(), source.branchId, mapping.contact_id, user.role === "admissions" ? user.sub : null])).rows[0];
                await audit(c, res, "crm.lead.created", lead.id, source.branchId, 1);
              }
              result.leadId = lead.id;
            }
          }
        } else if (input.action === "lead.create") {
          const p = input.lead, rows = await people(c, [p.contactId, p.learnerId, p.payerId].filter((id): id is string => !!id), user);
          if (rows.some(r => r.branch_id !== p.branchId) || rows.find(r => r.id === p.contactId)?.kind !== "CONTACT") throw conflict("INVALID_CONTACT", "Invalid lead profiles");
          await admissionsConsent(c, p.contactId);
          for (const [personId, kind] of [[p.learnerId, "LEARNER"], [p.payerId, "PAYER"]] as const) if (personId && rows.find(r => r.id === personId)?.kind !== kind) throw conflict("INVALID_PERSON_KIND", "Invalid lead profile kind");
          if (p.payerId && !p.learnerId) throw conflict("LEARNER_REQUIRED", "Choose the represented learner");
          if (p.learnerId) for (const from of [p.contactId, p.payerId].filter(Boolean)) if (!(await c.query("SELECT 1 FROM crm_relationships WHERE from_person_id=$1 AND learner_id=$2 AND status='VERIFIED'", [from, p.learnerId])).rowCount) throw conflict("RELATIONSHIP_UNVERIFIED", "Verify the representative first");
          if (p.ownerId && p.ownerId !== user.sub) throw new HttpError(403, "FORBIDDEN", "Use the verified staff assignment API to assign another owner");
          const leadId = randomUUID();
          await c.query("INSERT INTO crm_leads(id,branch_id,contact_id,learner_id,payer_id,course_id,source,owner_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [leadId, p.branchId, p.contactId, p.learnerId, p.payerId, p.courseId, p.source, user.role === "admissions" ? user.sub : null, p.notes]);
          await audit(c, res, "crm.lead.created", leadId, p.branchId, 1); result = { leadId };
        } else if (input.action === "lead.claim" || input.action === "lead.update") {
          const initial = await readLead(c, input.leadId, user);
          await people(c, [initial.contact_id, initial.learner_id, initial.payer_id].filter(Boolean), user);
          const row = await readLead(c, input.leadId, user, true), version = input.action === "lead.claim" ? input.version : input.update.version;
          if (row.version !== version) throw conflict("STALE_VERSION", "Reload the lead");
          if (input.action === "lead.claim") {
            if (user.role !== "admissions" || row.owner_id || row.stage === "LOST") throw conflict("ALREADY_ASSIGNED", "Only admissions may claim an unassigned open lead");
            await admissionsConsent(c, row.contact_id);
            await c.query("UPDATE crm_leads SET owner_id=$2,version=version+1 WHERE id=$1", [row.id, user.sub]);
          } else {
            const p = input.update;
            if ((user.role === "admissions" && row.owner_id !== user.sub) || p.ownerId !== row.owner_id) throw new HttpError(403, "FORBIDDEN", "Only current lead owner may edit; use staff assignment API for reassignment");
            const allowed: Record<string, string[]> = { NEW: ["NEW", "CONTACTED", "LOST"], CONTACTED: ["CONTACTED", "QUALIFIED", "LOST"], QUALIFIED: ["QUALIFIED", "CONTACTED", "LOST"], LOST: ["LOST", "NEW"] };
            if (!allowed[row.stage].includes(p.stage)) throw conflict("INVALID_STAGE", "Invalid lead stage");
            if (p.stage !== "LOST") await admissionsConsent(c, row.contact_id);
            await c.query("UPDATE crm_leads SET stage=$2,notes=$3,version=version+1 WHERE id=$1", [row.id, p.stage, p.notes]);
          }
          await audit(c, res, input.action === "lead.claim" ? "crm.lead.claimed" : "crm.lead.updated", row.id, row.branch_id, row.version + 1); result = { leadId: row.id, version: row.version + 1 };
        } else {
          const initial = (await c.query("SELECT * FROM crm_merge_plans WHERE id=$1", [input.planId])).rows[0];
          if (!initial) throw missing();
          const p = CrmMergeInput.parse(initial.payload), report = await mergeReport(c, p, user);
          const plan = (await c.query("SELECT *,clock_timestamp() AS now FROM crm_merge_plans WHERE id=$1 FOR UPDATE", [input.planId])).rows[0];
          if (plan.actor_id !== user.sub || plan.actor_session_id !== user.sid || plan.status !== "APPROVED" || plan.expires_at <= plan.now || !plan.approver_id || plan.report_hash !== input.reportHash || digest(report) !== plan.report_hash) throw conflict("MERGE_APPROVAL_REQUIRED", "Merge needs the current exact approved report");
          if (report.unresolved.length || report.blockers.length) throw conflict("MERGE_CONFLICT", "Resolve the reported collisions before a new merge plan");
          await iamRequest(auth.identityUrl, "/internal/iam/commands/approval-session", token, { accountId: plan.approver_id, sessionId: plan.approver_session_id });
          const values = ["fullName", "phone", "email", "notes"].map(field => {
            const choice = p.resolutions[field as keyof typeof p.resolutions], key = field as keyof typeof report.source;
            return choice === "SOURCE" ? report.source[key] : choice === "BOTH" ? `${report.target.notes}\n${report.source.notes}`.trim() : report.target[key];
          });
          await c.query("UPDATE crm_people SET full_name=$2,phone=$3,email=$4,notes=$5,version=version+1 WHERE id=$1", [p.targetId, ...values]);
          await c.query("UPDATE crm_people SET merged_into=$2,merged_at=clock_timestamp(),version=version+1 WHERE id=$1", [p.sourceId, p.targetId]);
          for (const column of ["contact_id", "learner_id", "payer_id"]) await c.query(`UPDATE crm_leads SET ${column}=$2,version=version+1 WHERE ${column}=$1`, [p.sourceId, p.targetId]);
          for (const column of ["from_person_id", "learner_id"]) await c.query(`UPDATE crm_relationships SET ${column}=$2,version=version+1 WHERE ${column}=$1`, [p.sourceId, p.targetId]);
          await c.query("UPDATE crm_channel_identities SET contact_id=$2,version=version+1 WHERE contact_id=$1", [p.sourceId, p.targetId]);
          for (const purpose of ["ADMISSIONS", "MARKETING", "COURSE_NOTICES"]) await c.query("INSERT INTO crm_consents(id,person_id,purpose,status,statement_version,statement_text,method,actor_id) VALUES($1,$2,$3,'REVOKED','DEMO-MERGE-v1','Reverification required after verified profile merge','WRITTEN',$4)", [randomUUID(), p.targetId, purpose, user.sub]);
          result = { sourceId: p.sourceId, targetId: p.targetId, consentPolicy: report.consentPolicy };
          const executed = await c.query("UPDATE crm_merge_plans SET status='EXECUTED',job_id=$2,result=$3 WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id", [plan.id, user.delegation!.jobId, result]);
          if (!executed.rowCount) throw conflict("MERGE_APPROVAL_EXPIRED", "Merge approval expired before commit");
          await audit(c, res, "crm.people.merged", p.targetId, plan.branch_id, p.targetVersion + 1);
          await iamRequest(auth.identityUrl, "/internal/iam/commands/approval-session", token, { accountId: plan.approver_id, sessionId: plan.approver_session_id });
        }
        await verify();
        const status = partial ? "PARTIAL" : "DONE";
        if (request.status === status && digest(request.result) === digest(result)) return requestView({ ...request, job_id: user.delegation!.jobId });
        const updated = (await c.query("UPDATE crm_automation_requests SET status=$2,result=$3 WHERE id=$1 RETURNING *", [id, status, result])).rows[0];
        await audit(c, res, partial ? "crm.request.partial" : "crm.request.completed", id, request.branch_id);
        return requestView(updated);
      }); res.json({ data });
    });
    app.use("/api/v1/crm", authenticate(auth), allowRoles("center_director", "branch_director", "admissions"));
    app.get("/api/v1/crm/enrollment-authority", async (req, res) => {
      const input = z.object({ contactId: Id, learnerId: Id, payerId: Id }).strict().parse(req.query);
      res.json({ data: await transaction(c => enrollmentAuthority(c, input, principal(res))) });
    });
    app.post("/api/v1/crm/merge-plans", allowRoles("center_director", "branch_director"), async (req, res) => {
      const input = CrmMergeInput.parse(req.body), user = principal(res);
      const data = await transaction(async c => {
        const planId = await idempotent(c, req, res, "merge.plan", input, async () => {
          const report = await mergeReport(c, input, user), id = randomUUID();
          await c.query("INSERT INTO crm_merge_plans(id,branch_id,source_id,target_id,actor_id,actor_session_id,payload,report,report_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, report.source.branchId, input.sourceId, input.targetId, user.sub, user.sid, input, report, digest(report)]);
          await audit(c, res, "crm.merge.planned", id, report.source.branchId); return id;
        }); return (await c.query("SELECT id,status,report,report_hash AS \"reportHash\",expires_at AS \"expiresAt\" FROM crm_merge_plans WHERE id=$1", [planId])).rows[0];
      }); res.status(201).json({ data });
    });
    app.get("/api/v1/crm/merge-plans/:id", allowRoles("center_director", "branch_director"), async (req, res) => {
      const row = (await pool.query("SELECT id,branch_id AS \"branchId\",status,report,report_hash AS \"reportHash\",result,expires_at AS \"expiresAt\" FROM crm_merge_plans WHERE id=$1", [Id.parse(req.params.id)])).rows[0];
      if (!row) throw missing(); checkBranch(principal(res), row.branchId); res.json({ data: row });
    });
    app.post("/api/v1/crm/merge-plans/:id/approve", allowRoles("branch_director"), async (req, res) => {
      const id = Id.parse(req.params.id), input = CrmMergeApproval.parse(req.body), user = principal(res);
      const data = await transaction(async c => {
        const initial = (await c.query("SELECT payload FROM crm_merge_plans WHERE id=$1", [id])).rows[0]; if (!initial) throw missing();
        const report = await mergeReport(c, CrmMergeInput.parse(initial.payload), user);
        const row = (await c.query("SELECT *,clock_timestamp() AS now FROM crm_merge_plans WHERE id=$1 FOR UPDATE", [id])).rows[0];
        checkBranch(user, row.branch_id);
        if (row.actor_id === user.sub) throw new HttpError(403, "FORBIDDEN", "A separate manager must approve the merge");
        if (row.status !== "PLANNED" || row.expires_at <= row.now || row.report_hash !== input.reportHash || digest(report) !== row.report_hash) throw conflict("STALE_APPROVAL", "Approve the current exact report");
        if (report.unresolved.length || report.blockers.length) throw conflict("MERGE_CONFLICT", "Resolve conflicts in a new plan before approval");
        await c.query("UPDATE crm_merge_plans SET status='APPROVED',approver_id=$2,approver_session_id=$3,evidence_ref=$4 WHERE id=$1", [id, user.sub, user.sid, input.evidenceRef]);
        await audit(c, res, "crm.merge.approved", id, row.branch_id); return { id, status: "APPROVED" };
      }); res.json({ data });
    });
    app.post("/api/v1/crm/automation-requests", async (req, res) => {
      const input = CrmAutomationInput.parse(req.body), user = principal(res);
      const data = await transaction(async c => {
        const id = await idempotent(c, req, res, "automation.request", input, async () => {
          let branchId: string, source: z.infer<typeof channelIdentity> | null = null;
          if (input.action === "resolve-channel") {
            if (!config.conversationUrl) throw new HttpError(503, "CHANNEL_UNAVAILABLE", "Conversation source required");
            source = channelIdentity.parse(await upstream(config.conversationUrl, `/api/v1/conversations/${input.conversationId}/crm-context`, req, res)); branchId = source.branchId;
            await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4005))", [`${source.provider}:${source.accountRef}:${source.subjectRef}`]);
            const mapping = (await c.query("SELECT contact_id FROM crm_channel_identities WHERE provider=$1 AND account_ref=$2 AND subject_ref=$3", [source.provider, source.accountRef, source.subjectRef])).rows[0];
            if (mapping) await people(c, [mapping.contact_id], user);
          } else if (input.action === "lead.create") {
            branchId = input.lead.branchId;
            await people(c, [input.lead.contactId, input.lead.learnerId, input.lead.payerId].filter((id): id is string => !!id), user);
            if (input.lead.courseId) { const course = await upstream<Row>(config.catalogUrl, `/api/v1/courses/${input.lead.courseId}`, req, res); if (course.status !== "active" || (course.branchIds.length && !course.branchIds.includes(branchId))) throw conflict("INVALID_COURSE", "Course unavailable in this branch"); }
          } else if (input.action === "merge.execute") {
            const plan = (await c.query("SELECT * FROM crm_merge_plans WHERE id=$1 FOR UPDATE", [input.planId])).rows[0]; if (!plan) throw missing();
            if (plan.erasure_request_id) throw conflict("PERSON_ERASED", "Merge plan was scrubbed by verified erasure");
            if (!["center_director", "branch_director"].includes(user.role) || plan.actor_id !== user.sub || plan.actor_session_id !== user.sid || plan.report_hash !== input.reportHash) throw new HttpError(403, "FORBIDDEN", "Merge request must originate from its verified planner");
            branchId = plan.branch_id;
          } else {
            const lead = await readLead(c, input.leadId, user); branchId = lead.branch_id;
            await people(c, [lead.contact_id, lead.learner_id, lead.payer_id].filter(Boolean), user);
          }
          checkBranch(user, branchId);
          const id = randomUUID(), eventId = randomUUID(), entity = { type: "crm-request", id, version: 1 };
          const delegation = await iamRequest(auth.identityUrl, "/internal/iam/delegations", bearer(req.get("authorization")), { eventId, workflowId: "WF-04", workflowVersion: 1, branchId, entity, inputRef: id, operations: ["crm.execute"] }) as { contextRef: string };
          await c.query("INSERT INTO crm_automation_requests(id,branch_id,actor_id,actor_session_id,event_id,context_id,payload,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id, branchId, user.sub, user.sid, eventId, delegation.contextRef, input, source]);
          await enqueueEvent(c, { id: eventId, type: "crm.requested", version: 1, occurredAt: new Date().toISOString(), correlationId: res.locals.correlationId, entityId: id, entityVersion: 1, payload: { entity, contextRef: delegation.contextRef, inputRef: id } });
          await audit(c, res, "crm.request.created", id, branchId); return id;
        }); return requestView(await crmRequest(c, id, user));
      }); res.status(201).json({ data });
    });
    app.get("/api/v1/crm/automation-requests/:id", async (req, res) => res.json({ data: requestView(await transaction(c => crmRequest(c, Id.parse(req.params.id), principal(res)))) }));
    app.get("/api/v1/crm/people", async (req, res) => {
      const q = PersonQuery.parse(req.query), user = principal(res); if (q.branchId) checkBranch(user, q.branchId);
      const result = await transaction(async c => {
        const where = "merged_into IS NULL AND ($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2::uuid IS NULL OR branch_id=$2) AND ($3::text IS NULL OR kind=$3) AND ($4 OR status='ACTIVE') AND ($5::text IS NULL OR full_name ILIKE $5 OR phone ILIKE $5 OR email ILIKE $5)";
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
        const duplicates = row.status === "ACTIVE" && !row.merged_into ? (await c.query("SELECT * FROM crm_people WHERE branch_id=$1 AND kind=$2 AND id<>$3 AND status='ACTIVE' AND merged_into IS NULL AND (($4<>'' AND phone=$4) OR ($5<>'' AND email=$5)) ORDER BY created_at LIMIT 20", [row.branch_id, row.kind, id, row.phone, row.email])).rows.map(r => personView(r)) : [];
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
