CREATE TABLE automation_jobs (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, correlation_id text NOT NULL, causation_id uuid,
 workflow_id text NOT NULL, workflow_version integer NOT NULL CHECK(workflow_version>0),
 input_schema_version integer NOT NULL CHECK(input_schema_version=1),
 entity jsonb NOT NULL, context_ref text NOT NULL, input_ref text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','WAITING','RETRY','DONE','DEAD')),
 version integer NOT NULL DEFAULT 1, step text NOT NULL DEFAULT 'start',
 attempt integer NOT NULL DEFAULT 0, failure_count integer NOT NULL DEFAULT 0, replay_count integer NOT NULL DEFAULT 0,
 lease_token uuid, lease_owner text, lease_expires_at timestamptz,
 operation_refs jsonb NOT NULL DEFAULT '[]', wait_for jsonb, deadline_at timestamptz,
 wake_event_id uuid, wake_reason text CHECK(wake_reason IN ('EVENT','DEADLINE')),
 next_attempt_at timestamptz, result_ref text, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,workflow_id),
 CHECK((status='RUNNING')=(lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX automation_jobs_due ON automation_jobs(status,next_attempt_at,created_at);
CREATE TABLE automation_wakeups (
 job_id uuid NOT NULL REFERENCES automation_jobs(id), event_id uuid NOT NULL,
 PRIMARY KEY(job_id,event_id)
);
CREATE TABLE automation_audit (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES automation_jobs(id), action text NOT NULL,
 actor_id text NOT NULL, reason text, attempt integer NOT NULL, version integer NOT NULL,
 correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_audit_job ON automation_audit(job_id,created_at);
