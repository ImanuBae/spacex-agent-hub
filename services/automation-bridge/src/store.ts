import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  AutomationJob, AutomationInput, AutomationCheckpoint, AutomationResult, AutomationReplay,
  EventEnvelope, WorkflowBindings, CommandFence, CommandBinding, type WorkflowBinding,
} from "@spacex/contracts";
import { receiveEvent } from "@spacex/messaging";
import { HttpError } from "@spacex/http";
import { recordIncident } from "./incidents.js";

export const consumer = "automation.bridge.v1";
const stale = () => new HttpError(409, "STALE_LEASE_OR_VERSION", "Job lease, attempt or version is no longer current");
type JobRow = {
  id: string; event_id: string; correlation_id: string; causation_id: string | null;
  workflow_id: string; workflow_version: number; input_schema_version: number;
  entity: unknown; context_ref: string; input_ref: string; status: string; version: number;
  step: string; attempt: number; failure_count: number; replay_count: number;
  lease_token: string | null; lease_owner: string | null; lease_expires_at: Date | null;
  operation_refs: AutomationJob["operationRefs"]; wait_for: unknown; deadline_at: Date | null;
  wake_event_id: string | null; wake_reason: string | null; next_attempt_at: Date | null;
  result_ref: string | null; error_code: string | null; created_at: Date; updated_at: Date;
};
export function jobView(row: JobRow, includeLease = false): AutomationJob {
  return AutomationJob.parse({
    jobId: row.id, eventId: row.event_id, correlationId: row.correlation_id, causationId: row.causation_id ?? undefined,
    workflowId: row.workflow_id, workflowVersion: row.workflow_version, inputSchemaVersion: row.input_schema_version,
    entity: row.entity, contextRef: row.context_ref, inputRef: row.input_ref,
    status: row.status, version: row.version, step: row.step, attempt: row.attempt,
    failureCount: row.failure_count, replayCount: row.replay_count,
    leaseToken: includeLease ? row.lease_token ?? undefined : undefined,
    leaseExpiresAt: row.lease_expires_at?.toISOString(), operationRefs: row.operation_refs,
    waitFor: row.wait_for ?? undefined, deadlineAt: row.deadline_at?.toISOString(),
    wakeEventId: row.wake_event_id ?? undefined, wakeReason: row.wake_reason ?? undefined,
    nextAttemptAt: row.next_attempt_at?.toISOString(), resultRef: row.result_ref ?? undefined,
    errorCode: row.error_code ?? undefined, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  });
}

export class BridgeStore {
  readonly bindings: WorkflowBinding[];
  constructor(readonly pool: Pool, bindings: WorkflowBinding[]) { this.bindings = WorkflowBindings.parse(bindings); }

  async transaction<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      // Serialize short scheduler transactions across replicas: capacity and early wakeups share one order.
      await c.query("SELECT pg_advisory_xact_lock(40060001)");
      const result = await work(c); await c.query("COMMIT"); return result;
    } catch (error) { await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }
  async row(c: Pool | PoolClient, id: string) {
    const row = (await c.query<JobRow>("SELECT * FROM automation_jobs WHERE id=$1", [id])).rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "Job not found");
    return row;
  }
  async audit(c: PoolClient, row: JobRow, action: string, actor: string, reason?: string) {
    await c.query("INSERT INTO automation_audit(id,job_id,action,actor_id,reason,attempt,version,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [randomUUID(), row.id, action, actor, reason ?? null, row.attempt, row.version, row.correlation_id]);
  }

  async ingest(input: EventEnvelope) {
    const event = EventEnvelope.parse(input);
    return this.transaction(async c => {
      await receiveEvent(c, consumer, event);
      const receipt = (await c.query("SELECT status FROM event_inbox WHERE consumer=$1 AND id=$2", [consumer, event.id])).rows[0];
      if (receipt.status === "DONE") return;
      for (const binding of this.bindings.filter(b => b.eventType === event.type)) {
        if (event.version !== binding.inputSchemaVersion) throw new Error("Unsupported automation input version");
        const payload = AutomationInput.parse(event.payload);
        if ((event.entityId && event.entityId !== payload.entity.id) ||
            (event.entityVersion !== undefined && event.entityVersion !== payload.entity.version)) throw new Error("Event entity mismatch");
        await c.query(`INSERT INTO automation_jobs(id,event_id,correlation_id,causation_id,workflow_id,workflow_version,
          input_schema_version,entity,context_ref,input_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT(event_id,workflow_id) DO NOTHING`,
        [randomUUID(), event.id, event.correlationId, event.causationId ?? null, binding.workflowId, binding.workflowVersion,
          binding.inputSchemaVersion, payload.entity, payload.contextRef, payload.inputRef]);
      }
      await c.query("UPDATE event_inbox SET status='DONE',completed_at=clock_timestamp() WHERE consumer=$1 AND id=$2", [consumer, event.id]);
      await this.wake(c);
    });
  }

  async wake(c: PoolClient) {
    const waiting = (await c.query<JobRow>("SELECT * FROM automation_jobs WHERE status='WAITING' ORDER BY created_at,id")).rows;
    for (const row of waiting) {
      const wait = jobView(row).waitFor!;
      const event = (await c.query(`SELECT i.id FROM event_inbox i WHERE i.consumer=$1 AND i.status='DONE'
        AND i.event->>'type'=$2 AND i.event->>'entityId'=$3 AND i.event->>'correlationId'=$4 AND i.id<>$5
        AND NOT EXISTS(SELECT 1 FROM automation_wakeups w WHERE w.job_id=$6 AND w.event_id=i.id)
        ORDER BY i.created_at,i.id LIMIT 1`, [consumer, wait.type, wait.entityId, row.correlation_id, row.event_id, row.id])).rows[0];
      const expired = (await c.query("SELECT $1::timestamptz<=clock_timestamp() AS expired", [row.deadline_at])).rows[0].expired;
      if (!event && !expired) continue;
      if (event) await c.query("INSERT INTO automation_wakeups(job_id,event_id) VALUES($1,$2)", [row.id, event.id]);
      await c.query(`UPDATE automation_jobs SET status='PENDING',wake_event_id=$2,wake_reason=$3,
        version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [row.id, event?.id ?? null, event ? "EVENT" : "DEADLINE"]);
      await this.audit(c, await this.row(c, row.id), "WAKE", "bridge");
    }
  }

  async recover(c: PoolClient) {
    const expired = (await c.query<JobRow>("SELECT * FROM automation_jobs WHERE status='RUNNING' AND lease_expires_at<=clock_timestamp()")).rows;
    for (const row of expired) await this.fail(c, row, "LEASE_EXPIRED", "bridge");
    await this.wake(c);
  }
  async fail(c: PoolClient, row: JobRow, errorCode: string, actor: string, retryAfterSeconds = 0, requireLive = false, failedStep = row.step) {
    const result = await c.query<JobRow>(`UPDATE automation_jobs SET failure_count=failure_count+1,
      status=CASE WHEN failure_count+1>=8 THEN 'DEAD' ELSE 'RETRY' END,
      next_attempt_at=CASE WHEN failure_count+1>=8 THEN NULL ELSE clock_timestamp()+make_interval(secs=>GREATEST($2,LEAST(300,power(2,failure_count+1))::int)) END,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code=$3,version=version+1,updated_at=clock_timestamp()
      WHERE id=$1 AND (NOT $4 OR lease_expires_at>clock_timestamp()) RETURNING *`, [row.id, retryAfterSeconds, errorCode, requireLive]);
    if (!result.rows[0]) throw stale();
    const failed = result.rows[0];
    await this.audit(c, failed, failed.status, actor);
    if (failed.status === "DEAD") await recordIncident(c, failed, failedStep);
    return failed;
  }
  async maintain() { await this.transaction(c => this.recover(c)); }

  async claim(workflowId: string, workflowVersion: number, owner: string) {
    return this.transaction(async c => {
      await this.recover(c);
      const count = (await c.query("SELECT count(*)::int AS n FROM automation_jobs WHERE status='RUNNING' AND lease_expires_at>clock_timestamp()")).rows[0].n;
      if (count >= 2) return null;
      const row = (await c.query<JobRow>(`SELECT * FROM automation_jobs WHERE workflow_id=$1 AND workflow_version=$2
        AND (status='PENDING' OR (status='RETRY' AND next_attempt_at<=clock_timestamp()))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [workflowId, workflowVersion])).rows[0];
      if (!row) return null;
      const claimed = (await c.query<JobRow>(`UPDATE automation_jobs SET status='RUNNING',attempt=attempt+1,
        lease_token=$2,lease_owner=$3,lease_expires_at=clock_timestamp()+interval '60 seconds',next_attempt_at=NULL,
        version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [row.id, randomUUID(), owner])).rows[0];
      await this.audit(c, claimed, "CLAIM", owner);
      return jobView(claimed, true);
    });
  }

  async fenced(c: PoolClient, id: string, fence: z.infer<typeof AutomationCheckpoint>, owner: string) {
    const row = (await c.query<JobRow>(`SELECT * FROM automation_jobs WHERE id=$1 AND status='RUNNING'
      AND lease_token=$2 AND attempt=$3 AND version=$4 AND lease_owner=$5 AND lease_expires_at>clock_timestamp()`,
    [id, fence.leaseToken, fence.attempt, fence.expectedVersion, owner])).rows[0];
    if (!row) throw stale();
    return row;
  }
  async checkpoint(id: string, input: z.infer<typeof AutomationCheckpoint>, owner: string) {
    return this.transaction(async c => {
      const row = await this.fenced(c, id, input, owner);
      if (input.operation) {
        const op = input.operation, existing = row.operation_refs.find(r => r.name === op.name);
        if (existing?.operationId && op.operationId && existing.operationId !== op.operationId)
          throw new HttpError(409, "OPERATION_CONFLICT", "Operation identity is immutable");
        const updated = { ...existing, ...op, operationKey: `automation:${id}:${op.name}` };
        row.operation_refs = [...row.operation_refs.filter(r => r.name !== op.name), updated];
      }
      const changed = (await c.query<JobRow>(`UPDATE automation_jobs SET step=$2,operation_refs=$3,
        lease_expires_at=clock_timestamp()+interval '60 seconds',version=version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING *`, [id, input.step, JSON.stringify(row.operation_refs)])).rows[0];
      if (!changed) throw stale();
      await this.audit(c, changed, "CHECKPOINT", owner);
      return jobView(changed, true);
    });
  }
  async authorization(id: string, input: z.infer<typeof CommandFence>, owner: string) {
    return this.transaction(async c => {
      const row = (await c.query<JobRow>(`SELECT * FROM automation_jobs WHERE id=$1 AND status='RUNNING'
        AND lease_token=$2 AND attempt=$3 AND lease_owner=$4 AND lease_expires_at>clock_timestamp()`,
      [id, input.leaseToken, input.attempt, owner])).rows[0];
      if (!row) throw stale();
      if (!row.operation_refs.some(op => op.name === input.operation))
        throw new HttpError(403, "OPERATION_INTENT_REQUIRED", "Checkpoint operation intent before authorization");
      return CommandBinding.parse({ jobId: id, ...input, eventId: row.event_id, workflowId: row.workflow_id,
        workflowVersion: row.workflow_version, entity: row.entity, contextRef: row.context_ref, inputRef: row.input_ref });
    });
  }
  async result(id: string, input: z.infer<typeof AutomationResult>, owner: string) {
    return this.transaction(async c => {
      const row = await this.fenced(c, id, input, owner);
      // Check again in the write: a transaction must never revive an expired lease.
      const updated = (await c.query<JobRow>(`UPDATE automation_jobs SET step=$2,version=version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING *`, [id, input.step])).rows[0];
      if (!updated) throw stale();
      const failedStep = row.step === "start" ? input.step : row.step;
      if (input.outcome === "RETRY") return jobView(await this.fail(c, updated, input.errorCode!, owner, input.retryAfterSeconds, true, failedStep));
      const completed = await c.query(`UPDATE automation_jobs SET status=$2,wait_for=$3,deadline_at=$4,result_ref=$5,error_code=$6,
        wake_event_id=NULL,wake_reason=NULL,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL
        WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING id`,
      [id, input.outcome, input.waitFor ?? null, input.deadlineAt ?? null, input.resultRef ?? null, input.errorCode ?? null]);
      if (!completed.rowCount) throw stale();
      const outcome = await this.row(c, id);
      await this.audit(c, outcome, input.outcome, owner);
      if (input.outcome === "DEAD") await recordIncident(c, outcome, failedStep);
      if (input.outcome === "WAITING") await this.wake(c);
      return jobView(await this.row(c, row.id));
    });
  }
  async replay(id: string, input: z.infer<typeof AutomationReplay>, actor: string) {
    return this.transaction(async c => {
      const row = (await c.query<JobRow>(`UPDATE automation_jobs SET status='PENDING',failure_count=0,replay_count=replay_count+1,
        next_attempt_at=NULL,error_code=NULL,version=version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND status='DEAD' AND version=$2 RETURNING *`, [id, input.expectedVersion])).rows[0];
      if (!row) throw new HttpError(409, "REPLAY_CONFLICT", "Only the current DEAD job can be replayed");
      await this.audit(c, row, "REPLAY", actor, input.reason);
      return jobView(row);
    });
  }
}
