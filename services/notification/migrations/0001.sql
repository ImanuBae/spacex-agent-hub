CREATE TABLE notification_intents (
 id uuid PRIMARY KEY, dedup_key text NOT NULL UNIQUE, enrollment_id uuid, learner_id uuid NOT NULL,
 branch_id uuid NOT NULL, class_id uuid, template text NOT NULL CHECK(template IN ('ENROLLMENT_CONFIRMED','CLASS_CHANGED','ENTITLEMENT_CHANGED','REMINDER','OTP')),
 source_version integer NOT NULL CHECK(source_version>0), source_event_id uuid, challenge_id uuid UNIQUE,
 session_starts_at timestamptz, correlation_id text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','WAITING','SENT','SUPERSEDED','FAILED','UNKNOWN')),
 due_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, receipt_id uuid, owner_id uuid NOT NULL, error_code text,
 event_id uuid, context_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX notification_due ON notification_intents(due_at,id) WHERE event_id IS NULL AND template<>'OTP';
CREATE TABLE notification_attempts (
 id uuid PRIMARY KEY, intent_id uuid NOT NULL REFERENCES notification_intents(id), number integer NOT NULL,
 job_id uuid NOT NULL, outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(intent_id,number)
);
CREATE TABLE notification_mailbox (
 id uuid PRIMARY KEY, intent_id uuid NOT NULL UNIQUE REFERENCES notification_intents(id), recipient text NOT NULL,
 subject text NOT NULL, body text NOT NULL, adapter text NOT NULL CHECK(adapter='SYNTHETIC_LOCAL_MAILBOX'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE notification_portal_messages (
 id uuid PRIMARY KEY, intent_id uuid NOT NULL UNIQUE REFERENCES notification_intents(id), learner_id uuid NOT NULL,
 subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE notification_audit (
 id uuid PRIMARY KEY, intent_id uuid NOT NULL, action text NOT NULL, actor_id uuid NOT NULL,
 correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE notification_class_versions (class_id uuid PRIMARY KEY, version integer NOT NULL CHECK(version>0));
CREATE TABLE notification_memberships (
 enrollment_id uuid PRIMARY KEY, learner_id uuid NOT NULL, branch_id uuid NOT NULL, class_id uuid NOT NULL,
 entitlement_version integer NOT NULL CHECK(entitlement_version>0),
 state text NOT NULL CHECK(state IN ('ACTIVE','SUSPENDED','CANCELLED'))
);
CREATE INDEX notification_class_members ON notification_memberships(class_id,branch_id);
CREATE TABLE notification_adapter_faults (
 intent_id uuid PRIMARY KEY REFERENCES notification_intents(id), mode text NOT NULL CHECK(mode IN ('REJECT','TIMEOUT_BEFORE','TIMEOUT_AFTER','UNKNOWN_NO_LOOKUP')), consumed_at timestamptz
);
CREATE FUNCTION immutable_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append only delivery receipt'; END $$;
CREATE TRIGGER notification_mailbox_immutable BEFORE UPDATE OR DELETE ON notification_mailbox FOR EACH ROW EXECUTE FUNCTION immutable_notification_receipt();
