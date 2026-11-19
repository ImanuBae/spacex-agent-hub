CREATE TABLE enrollment_entitlements (
 enrollment_id uuid PRIMARY KEY REFERENCES enrollments(id), learner_id uuid NOT NULL, branch_id uuid NOT NULL,
 class_id uuid NOT NULL, seat_id uuid NOT NULL UNIQUE, hold_id uuid, package_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
 amount bigint NOT NULL CHECK(amount>=0), remaining_sessions integer NOT NULL CHECK(remaining_sessions>=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), expires_at timestamptz, adjustment_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entitlement_active_learner ON enrollment_entitlements(learner_id,class_id) WHERE state='ACTIVE';
CREATE TABLE enrollment_adjustments (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES enrollments(id), branch_id uuid NOT NULL,
 learner_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('REFUND','TRANSFER','SUSPEND','RESUME','WAITLIST')),
 state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','APPROVED','PREPARED','COMMITTING','TARGET_COMMITTED','APPLIED','EXECUTED','FAILED','REVOKED','EXPIRED','UNKNOWN')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), source_version integer NOT NULL CHECK(source_version>0), source jsonb NOT NULL, target jsonb,
 policy_version text NOT NULL, amount_delta bigint NOT NULL DEFAULT 0, refund_mode text,
 remaining_sessions integer NOT NULL CHECK(remaining_sessions>=0), deadline_at timestamptz NOT NULL,
 actor_id uuid NOT NULL, actor_session uuid NOT NULL, reason text NOT NULL, operation_key uuid NOT NULL,
 payload jsonb NOT NULL, approved_by uuid, approved_session uuid, choice_by uuid, choice_session uuid,
 choice_version integer, choice_at timestamptz, target_seat_id uuid NOT NULL UNIQUE,
 correlation_id text NOT NULL, context_id uuid, event_id uuid, error_code text, class_change_id uuid, class_change_correlation text, source_released_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,operation_key), CHECK(approved_by IS NULL OR approved_by<>actor_id),
 CHECK((approved_by IS NULL)=(approved_session IS NULL)), CHECK((choice_by IS NULL)=(choice_session IS NULL)),
 CHECK((choice_by IS NULL)=(choice_version IS NULL)), CHECK((choice_by IS NULL)=(choice_at IS NULL)),
 CHECK((kind IN ('TRANSFER','RESUME','WAITLIST'))=(target IS NOT NULL)),
 CHECK((kind='REFUND')=(refund_mode IS NOT NULL)), CHECK(refund_mode IS NULL OR refund_mode IN ('EXCESS','CANCEL')),
 CHECK(kind<>'REFUND' OR amount_delta<0), CHECK(kind<>'SUSPEND' OR amount_delta=0)
);
ALTER TABLE enrollment_entitlements ADD CONSTRAINT entitlement_adjustment FOREIGN KEY(adjustment_id) REFERENCES enrollment_adjustments(id);
CREATE UNIQUE INDEX one_active_adjustment ON enrollment_adjustments(enrollment_id) WHERE state IN ('REQUESTED','APPROVED','PREPARED','COMMITTING','TARGET_COMMITTED','APPLIED','UNKNOWN');
CREATE TABLE adjustment_operations(key text PRIMARY KEY,adjustment_id uuid NOT NULL REFERENCES enrollment_adjustments(id),action text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE adjustment_history(id uuid PRIMARY KEY,adjustment_id uuid NOT NULL REFERENCES enrollment_adjustments(id),version integer NOT NULL,action text NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(adjustment_id,version));
CREATE TABLE enrollment_schedule_choices(change_id uuid NOT NULL,enrollment_id uuid NOT NULL REFERENCES enrollments(id),change_version integer NOT NULL,source_version integer NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,accepted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(change_id,enrollment_id,change_version));
CREATE TABLE enrollment_waitlist(id uuid PRIMARY KEY,learner_id uuid NOT NULL,branch_id uuid NOT NULL,class_id uuid NOT NULL,package_id uuid NOT NULL,enrollment_id uuid NOT NULL REFERENCES enrollments(id),actor_id uuid NOT NULL,actor_session uuid NOT NULL,consent boolean NOT NULL CHECK(consent),status text NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING','INVITED','ACCEPTED','DECLINED','REVOKED','EXPIRED')),version integer NOT NULL DEFAULT 1,invited_at timestamptz,expires_at timestamptz,adjustment_id uuid UNIQUE REFERENCES enrollment_adjustments(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX waitlist_active_learner ON enrollment_waitlist(learner_id,class_id) WHERE status IN ('WAITING','INVITED');
