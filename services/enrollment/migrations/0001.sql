CREATE TABLE confirmations (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL UNIQUE, actor_id uuid NOT NULL, session_id uuid NOT NULL,
 branch_id uuid NOT NULL, snapshot jsonb NOT NULL, payload jsonb NOT NULL, operation_key uuid NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CONSUMED','REVOKED')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', event_id uuid NOT NULL,
 context_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(actor_id,operation_key)
);
CREATE TABLE enrollments (
 id uuid PRIMARY KEY, confirmation_id uuid NOT NULL UNIQUE REFERENCES confirmations(id),
 actor_id uuid NOT NULL, branch_id uuid NOT NULL, learner_id uuid NOT NULL, class_id uuid NOT NULL,
 snapshot jsonb NOT NULL, status text NOT NULL CHECK(status IN ('PENDING_HOLD','HELD','CONFIRMING','CONFIRMED','PAYMENT_REVIEW','EXPIRED','CANCELLED','REFUND_PENDING','NEEDS_CONFIRMATION')),
 version integer NOT NULL DEFAULT 1, hold_id uuid, expires_at timestamptz, payment_id uuid, match_ref uuid,
 correlation_id text NOT NULL, deadline_version integer, release_authorized boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX enrollment_active_learner ON enrollments(learner_id,class_id) WHERE status IN ('PENDING_HOLD','HELD','CONFIRMING','CONFIRMED','PAYMENT_REVIEW');
CREATE TABLE enrollment_operations (key text PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES enrollments(id), action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL);
CREATE TABLE enrollment_audit (id uuid PRIMARY KEY, target_id uuid NOT NULL, actor_id uuid NOT NULL, action text NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE enrollment_cancellations (id uuid PRIMARY KEY,enrollment_id uuid NOT NULL REFERENCES enrollments(id),actor_id uuid NOT NULL,session_id uuid NOT NULL,payload jsonb NOT NULL,event_id uuid NOT NULL,context_id uuid NOT NULL,UNIQUE(enrollment_id,id));
CREATE FUNCTION immutable_enrollment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN RAISE EXCEPTION 'Immutable confirmed snapshot'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER enrollment_snapshot BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION immutable_enrollment_snapshot();
CREATE TRIGGER confirmation_snapshot BEFORE UPDATE ON confirmations FOR EACH ROW EXECUTE FUNCTION immutable_enrollment_snapshot();
