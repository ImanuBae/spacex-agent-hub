import type { Pool, PoolClient } from "pg";
import { HttpError } from "@spacex/http";

const steps = new Set(("start chat complete result report-projected crm-execute apply-class-plan apply-entitlement " +
  "class-commit class-hold class-release close-failed-payment commit-target-seat complete-adjustment deliver-intent " +
  "enrollment-cancel enrollment-confirm enrollment-confirming enrollment-create enrollment-exception enrollment-failed " +
  "enrollment-held enrollment-inspect enrollment-payment enrollment-reconcile fence-target-commit hold-target-seat " +
  "mark-target-failure payment-close payment-create payment-no-seat prepare-adjustment record-source-release " +
  "record-target-commit release-exception-hold release-failed-hold release-failed-target release-source-seat " +
  "reserve-refund-cap reverse-failed-target-charge settle-before-target-commit settle-final-amount").split(" "));
const codes = new Set(("AUTHORIZATION_DENIED BUSINESS_REJECTED CONVERSATION_DENIED DEADLINE_EXPIRED DELIVERY_UNKNOWN " +
  "DOMAIN_DENIED DOMAIN_REJECTED LEASE_EXPIRED NETWORK_ERROR PAYMENT_DENIED PAYMENT_UNKNOWN RATE_LIMITED " +
  "REFUND_CAP_EXCEEDED REPORT_PROJECTION_REJECTED STALE_LEASE_OR_VERSION TIMEOUT UPSTREAM_UNAVAILABLE").split(" "));
export const incidentOwner = "center_director";

export async function recordIncident(c: PoolClient, failure: { id: string; updated_at: Date; attempt: number; error_code: string | null }, step: string) {
  await c.query(`INSERT INTO automation_incidents(job_id,failed_at,failed_step,failed_attempt,error_code)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO UPDATE SET failed_at=EXCLUDED.failed_at,
      failed_step=EXCLUDED.failed_step,failed_attempt=EXCLUDED.failed_attempt,error_code=EXCLUDED.error_code`,
  [failure.id, failure.updated_at, steps.has(step) ? step : "unclassified", failure.attempt,
    codes.has(failure.error_code ?? "") ? failure.error_code : "UNCLASSIFIED"]);
}

type IncidentRow = {
  job_id: string; workflow_id: string; workflow_version: number; status: string; version: number;
  failed_at: Date; failed_step: string; failed_attempt: number; error_code: string; alerted_at: Date | null;
  owner_role: typeof incidentOwner;
  updated_at: Date; attempt: number; replay_count: number; replayed_at: Date | null; replayed_by: string | null;
};
const select = `SELECT i.*,j.workflow_id,j.workflow_version,j.status,j.version,j.updated_at,j.attempt,j.replay_count,
    r.actor_id AS replayed_by,r.created_at AS replayed_at
  FROM automation_incidents i JOIN automation_jobs j ON j.id=i.job_id
  LEFT JOIN LATERAL (SELECT actor_id,created_at FROM automation_audit
    WHERE job_id=i.job_id AND action='REPLAY' ORDER BY version DESC LIMIT 1) r ON true`;
function view(row: IncidentRow) {
  return {
    kind: "BRIDGE_DEAD", jobId: row.job_id, workflowId: /^WF-(0[1-9]|1[0-2])$/.test(row.workflow_id) ? row.workflow_id : "OTHER",
    workflowVersion: row.workflow_version, status: row.status, version: row.version,
    failedAt: row.failed_at.toISOString(), failedStep: steps.has(row.failed_step) ? row.failed_step : "unclassified",
    failedAttempt: row.failed_attempt, errorCode: codes.has(row.error_code) ? row.error_code : "UNCLASSIFIED",
    alertedAt: row.alerted_at?.toISOString() ?? null, ownerRole: row.owner_role,
    attempt: row.attempt, updatedAt: row.updated_at.toISOString(), replayCount: row.replay_count,
    replayedAt: row.replayed_at?.toISOString() ?? null, replayedBy: row.replayed_by,
  };
}
export async function listIncidents(pool: Pool, page: number, pageSize: number) {
  const [result, count] = await Promise.all([
    pool.query<IncidentRow>(`${select} ORDER BY (j.status='DEAD') DESC,i.failed_at DESC,i.job_id DESC LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]),
    pool.query<{ total: number }>("SELECT count(*)::int AS total FROM automation_incidents"),
  ]);
  return { data: result.rows.map(view), pagination: { page, pageSize, total: count.rows[0].total } };
}
export async function readIncident(pool: Pool, id: string) {
  const row = (await pool.query<IncidentRow>(`${select} WHERE i.job_id=$1`, [id])).rows[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "Incident not found");
  return view(row);
}
export async function alertIncidents(pool: Pool) {
  const { rowCount } = await pool.query(`WITH due AS (
    SELECT job_id FROM automation_incidents WHERE alerted_at IS NULL ORDER BY failed_at,job_id
    LIMIT 100 FOR UPDATE SKIP LOCKED
  ) UPDATE automation_incidents i SET alerted_at=clock_timestamp() FROM due WHERE i.job_id=due.job_id`);
  return { alertsRecorded: rowCount, ownerRole: incidentOwner };
}
