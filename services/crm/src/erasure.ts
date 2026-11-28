import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Express } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ErasureProof, ErasureScope, ErasureService } from "@spacex/contracts";
import { erasureTestEnabled, erasureWorker, readRestoreExclusions, type AuthConfig } from "@spacex/auth";
import { HttpError } from "@spacex/http";

type Subject = { id: string; person_id: string; branch_id: string; verified_by: string; version: number; status: string };
const ScopeRef = ErasureScope.pick({ requestId:true,personId:true,branchId:true });
const Targets = ["ENROLLMENT","PAYMENT","REPORTING","CONVERSATION"] as const;

export async function anonymizeCrmSubject(c: PoolClient, row: Pick<Subject,"id"|"person_id"|"branch_id">, actor: string) {
  const { id, person_id: person, branch_id: branch } = row;
  await c.query("UPDATE crm_people SET full_name='Đã ẩn danh',phone='',email='',notes='',status='ERASED',version=version+1 WHERE id=$1 AND branch_id=$2", [person,branch]);
  await c.query("UPDATE crm_leads SET stage='LOST',notes='',version=version+1 WHERE branch_id=$2 AND (contact_id=$1 OR learner_id=$1 OR payer_id=$1)", [person,branch]);
  await c.query("UPDATE crm_relationships SET status='REJECTED',evidence_ref='',version=version+1 WHERE from_person_id=$1 OR learner_id=$1", [person]);
  await c.query("UPDATE crm_consents SET status='REVOKED',statement_text='Nội dung đã được loại bỏ theo yêu cầu xóa' WHERE person_id=$1", [person]);
  await c.query("INSERT INTO crm_erasure_tombstones(person_id,branch_id,request_id) VALUES($1,$2,$3)", [person,branch,id]);
  await c.query("UPDATE crm_operations SET request_hash='ERASED' WHERE resource_id=$1 OR resource_id IN (SELECT id FROM crm_leads WHERE contact_id=$1 OR learner_id=$1 OR payer_id=$1) OR resource_id IN (SELECT id FROM crm_consents WHERE person_id=$1) OR resource_id IN (SELECT id FROM crm_relationships WHERE from_person_id=$1 OR learner_id=$1)", [person]);
  await c.query("UPDATE crm_erasure_tasks SET status='DONE',outcome_code='ANONYMIZED',evidence_ref='CRM_TRANSACTION',actor_id=$2,version=version+1 WHERE request_id=$1 AND service='CRM'", [id,actor]);
  await c.query("UPDATE crm_erasure_requests SET status='PROCESSING',version=version+1 WHERE id=$1", [id]);
}

async function transaction<T>(pool: Pool, work: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='5s'");
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}

async function verifiedSubject(c: PoolClient, id: string) {
  await c.query(`SELECT p.id FROM crm_people p JOIN crm_erasure_requests r ON r.person_id=p.id AND r.branch_id=p.branch_id
    WHERE r.id=$1 AND p.merged_into IS NULL FOR UPDATE OF p`,[id]);
  const { rows:[row] } = await c.query<Subject>(`SELECT r.* FROM crm_erasure_requests r JOIN crm_people p ON p.id=r.person_id AND p.branch_id=r.branch_id
    WHERE r.id=$1 AND p.merged_into IS NULL AND r.verified_by IS NOT NULL AND r.verification_method IS NOT NULL
    AND r.evidence_ref<>'' FOR UPDATE OF r`,[id]);
  return row;
}

const registry = z.object({
  archives:z.array(z.object({ id:z.uuid(), subjects:z.array(z.uuid()), retainUntil:z.iso.datetime() }).strict()).max(1000),
}).strict();

export function registerCrmErasure(app: Express, pool: Pool, auth: AuthConfig) {
  if (!erasureTestEnabled()) return;
  const targets = {
    ENROLLMENT:process.env.ENROLLMENT_URL, PAYMENT:process.env.PAYMENT_URL,
    REPORTING:process.env.REPORTING_URL, CONVERSATION:process.env.CONVERSATION_URL,
  };
  app.get("/internal/crm/erasure/:id/scope", async (req,res) => {
    await erasureWorker(auth,req.get("authorization"));
    const id = ScopeRef.shape.requestId.parse(req.params.id);
    const {rows:[row]} = await pool.query(`SELECT r.id AS "requestId",r.person_id AS "personId",r.branch_id AS "branchId",
      ARRAY(SELECT DISTINCT source_ref FROM crm_channel_identities WHERE contact_id=r.person_id AND branch_id=r.branch_id) AS "conversationIds",
      EXISTS(SELECT 1 FROM crm_erasure_tasks t WHERE t.request_id=r.id AND service='ENROLLMENT' AND status='NOT_APPLICABLE'
        AND outcome_code='NO_SCOPED_DATA') AS "noEnrollment"
      FROM crm_erasure_requests r JOIN crm_erasure_tombstones s ON s.request_id=r.id AND s.person_id=r.person_id AND s.branch_id=r.branch_id
      WHERE r.id=$1 AND r.status='PROCESSING' AND r.verified_by IS NOT NULL`,[id]);
    if (!row) throw new HttpError(404,"ERASURE_SCOPE_UNAVAILABLE","An active verified erasure is required");
    res.set("Cache-Control","no-store").json({data:ErasureScope.parse(row)});
  });
  app.post("/internal/crm/erasure/process", async (req,res) => {
    const token = await erasureWorker(auth,req.get("authorization"));
    z.object({}).strict().parse(req.body);
    const correlation = res.locals.correlationId;
    const picked = (await pool.query<{id:string}>(`SELECT id FROM crm_erasure_requests WHERE status IN ('VERIFIED','PROCESSING')
      AND (retry_at IS NULL OR retry_at<=clock_timestamp()) ORDER BY (status='VERIFIED') DESC,retry_at NULLS FIRST,created_at,id LIMIT 1`)).rows[0];
    const claim = picked && await transaction(pool, async c => {
      const row = await verifiedSubject(c,picked.id);
      if (!row || !["VERIFIED","PROCESSING"].includes(row.status)) return;
      const changed = await c.query(`UPDATE crm_erasure_requests SET retry_at=clock_timestamp()+interval '1 minute'
        WHERE id=$1 AND (retry_at IS NULL OR retry_at<=clock_timestamp())`,[row.id]);
      if (!changed.rowCount) return;
      if (row.status === "VERIFIED") {
        await anonymizeCrmSubject(c,row,row.verified_by);
        await c.query("INSERT INTO crm_audit(id,actor_id,action,target_id,branch_id,correlation_id,version) VALUES($1,$2,'crm.person.anonymized',$3,$4,$5,$6)",
          [randomUUID(),row.verified_by,row.person_id,row.branch_id,correlation,row.version+1]);
      }
      return row;
    });
    if (!claim) { res.json({data:{processed:0}}); return; }
    const id = claim.id;
    async function record(service: string, status: ErasureProof["status"], code: string, reference: string) {
      await transaction(pool, async c => {
        const task = await c.query(`UPDATE crm_erasure_tasks SET status=$3,outcome_code=$4,evidence_ref=$5,actor_id=$6,version=version+1
          WHERE request_id=$1 AND service=$2 AND status IN ('PENDING','BLOCKED')
          AND (status,outcome_code,evidence_ref) IS DISTINCT FROM ($3,$4,$5)`,
        [id,service,status,code,reference,claim!.verified_by]);
        if (task.rowCount) await c.query(`INSERT INTO crm_audit(id,actor_id,action,target_id,branch_id,correlation_id)
          VALUES($1,$2,'crm.erasure.proof_recorded',$3,$4,$5)`,[randomUUID(),claim!.verified_by,id,claim!.branch_id,correlation]);
      });
    }
    const tasks = (await pool.query("SELECT service,status FROM crm_erasure_tasks WHERE request_id=$1",[id])).rows;
    const pending = (service: string) => tasks.some(row => row.service===service && ["PENDING","BLOCKED"].includes(row.status));
    for (const service of Targets) {
      if (!pending(service)) continue;
      let proof: ErasureProof;
      try {
        if (!targets[service]) throw new Error("Target is unconfigured");
        const response = await fetch(`${targets[service]}/internal/erasure/${id}`, {
          method:"POST", headers:{ authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(5000), redirect:"error",
        });
        if (!response.ok) throw new Error("Target did not record proof");
        proof = ErasureProof.parse((await response.json()).data);
      } catch { await record(service,"BLOCKED","SERVICE_UNAVAILABLE",id); continue; }
      await record(service,proof.status,proof.code,proof.evidenceRef);
    }
    if (pending("BACKUPS")) {
      let inventory;
      try {
        const file = process.env.WF12_BACKUP_REGISTRY;
        if (file) inventory = registry.parse(JSON.parse(await readFile(file,"utf8")));
      } catch { /* An unreadable inventory stays blocked. */ }
      const archive = inventory?.archives.find(item => item.subjects.includes(claim.person_id));
      await (archive ? record("BACKUPS","BLOCKED",Date.parse(archive.retainUntil)>Date.now()?"BACKUP_RETENTION":"BACKUP_DISPOSAL_PENDING",archive.id)
        : inventory ? record("BACKUPS","NOT_APPLICABLE","NO_SCOPED_BACKUP",id)
          : record("BACKUPS","BLOCKED","BACKUP_INVENTORY_REQUIRED",id));
    }
    const result = await pool.query(`WITH completed AS (
      UPDATE crm_erasure_requests r SET status='COMPLETED',version=version+1 WHERE id=$1 AND status='PROCESSING'
        AND (SELECT count(*) FROM crm_erasure_tasks WHERE request_id=r.id AND service=ANY($2::text[]) AND
          status IN ('DONE','NOT_APPLICABLE') AND evidence_ref<>'' AND outcome_code IS NOT NULL)=$3
        RETURNING id,verified_by,branch_id,version
      ) INSERT INTO crm_audit(id,actor_id,action,target_id,branch_id,correlation_id,version)
        SELECT $4,verified_by,'crm.erasure.completed',id,branch_id,$5,version FROM completed`,
      [id,ErasureService.options,ErasureService.options.length,randomUUID(),correlation]);
    res.json({data:{processed:1,completed:result.rowCount === 1}});
  });
}

export async function applyRestoreExclusions(pool: Pool, file: string, expectedSha: string | undefined) {
  const scopes = await readRestoreExclusions(file,expectedSha);
  await transaction(pool, async c => {
    for (const scope of scopes) {
      const row = await verifiedSubject(c,scope.requestId);
      if (!row || row.person_id!==scope.personId || row.branch_id!==scope.branchId) throw new Error("Restore exclusion verification missing");
      const {rows:linked} = await c.query("SELECT DISTINCT source_ref FROM crm_channel_identities WHERE contact_id=$1 AND branch_id=$2",[scope.personId,scope.branchId]);
      if (scope.conversationIds.some(id=>!linked.some(entry=>entry.source_ref===id))) throw new Error("Restore exclusion conversation scope mismatch");
      if (row.status==="VERIFIED") {
        await anonymizeCrmSubject(c,row,row.verified_by);
        await c.query(`INSERT INTO crm_audit(id,actor_id,action,target_id,branch_id,correlation_id,version)
          VALUES($1,$2,'crm.erasure.restore_applied',$3,$4,$5,$6)`,[randomUUID(),row.verified_by,row.person_id,row.branch_id,scope.requestId,row.version+1]);
      } else if (!["PROCESSING","COMPLETED"].includes(row.status) ||
        !(await c.query("SELECT 1 FROM crm_erasure_tombstones WHERE person_id=$1 AND branch_id=$2 AND request_id=$3",[scope.personId,scope.branchId,scope.requestId])).rowCount) {
        throw new Error("Restore exclusion state is inconsistent");
      }
    }
  });
}
