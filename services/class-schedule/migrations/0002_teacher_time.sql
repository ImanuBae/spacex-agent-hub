CREATE TABLE teacher_time_config (
 teacher_id uuid PRIMARY KEY, configured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE teacher_time (
 id uuid PRIMARY KEY, teacher_id uuid NOT NULL, account_id uuid NOT NULL, branch_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('AVAILABLE','LEAVE')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 reason text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 version integer NOT NULL DEFAULT 1, decision_reason text NOT NULL DEFAULT '',
 decided_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 operation_key uuid NOT NULL, input_payload jsonb NOT NULL,
 UNIQUE(account_id,operation_key),
 EXCLUDE USING gist(teacher_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&)
 WHERE(kind='AVAILABLE' AND status='APPROVED')
);
CREATE INDEX teacher_time_teacher ON teacher_time(teacher_id,starts_at);
CREATE TABLE class_event_receipts (
 event_id uuid PRIMARY KEY, event_type text NOT NULL, target_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operation_replays (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, consumer text,
 reason text NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER operation_replays_immutable BEFORE UPDATE OR DELETE ON operation_replays
FOR EACH ROW EXECUTE FUNCTION immutable_class_audit();
