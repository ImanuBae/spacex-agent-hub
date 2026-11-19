ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK(role IN ('center_director','branch_director','admissions','accountant','teacher','student'));
ALTER TABLE service_delegations DROP CONSTRAINT service_delegations_audience_check;
ALTER TABLE service_delegations ADD CONSTRAINT service_delegations_audience_check CHECK(audience IN ('enrollment','payment','class-schedule','notification'));
CREATE TABLE learner_identities (
 account_id uuid PRIMARY KEY REFERENCES accounts(id), learner_id uuid NOT NULL UNIQUE,
 branch_id uuid NOT NULL, verified_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE otp_challenges (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), session_binding uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='STUDENT_LOGIN'), code_hash text NOT NULL CHECK(code_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 5), consumed_at timestamptz,
 delivery_ref uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX otp_rate_limit ON otp_challenges(account_id,created_at);
