ALTER TABLE sessions ADD COLUMN schedule_revision integer NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN retired_revision integer;
ALTER TABLE classes ADD COLUMN minimum_policy_version text;
ALTER TABLE classes ADD COLUMN preserve_schedule_history boolean NOT NULL DEFAULT false;
CREATE TABLE class_changes (
 id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id), branch_id uuid NOT NULL,
 actor_id uuid NOT NULL, actor_session_id uuid NOT NULL, operation_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('RESCHEDULE','MAKEUP','POSTPONE','CANCEL','MINIMUM_SIZE')),
 payload jsonb NOT NULL, class_version integer NOT NULL, impact jsonb NOT NULL,
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','REJECTED','REVOKED','EXECUTED','EXPIRED','FAILED')),
 version integer NOT NULL DEFAULT 1, policy_version text NOT NULL,
 approver_id uuid, approver_session_id uuid, approver_role text, decision_reason text,
 context_id uuid NOT NULL, event_id uuid NOT NULL UNIQUE, correlation_id text NOT NULL, job_id uuid, result jsonb,
 deadline_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,operation_key)
);
CREATE TABLE class_change_decisions (
 id uuid PRIMARY KEY, change_id uuid NOT NULL REFERENCES class_changes(id), actor_id uuid NOT NULL,
 action text NOT NULL, reason text NOT NULL, version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER class_change_decisions_immutable BEFORE UPDATE OR DELETE ON class_change_decisions
FOR EACH ROW EXECUTE FUNCTION immutable_class_audit();
CREATE TABLE class_adjustment_operations (
 operation_key text PRIMARY KEY, adjustment_id uuid NOT NULL, action text NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER class_adjustment_operations_immutable BEFORE UPDATE OR DELETE ON class_adjustment_operations
FOR EACH ROW EXECUTE FUNCTION immutable_class_audit();
