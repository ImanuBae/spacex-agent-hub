ALTER TABLE learner_identities DROP CONSTRAINT learner_identities_pkey;
ALTER TABLE learner_identities ADD PRIMARY KEY (account_id,learner_id);
ALTER TABLE learner_identities ADD COLUMN enrollment_id uuid UNIQUE;
CREATE TABLE checkout_otp_challenges (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  email text NOT NULL,
  session_binding uuid NOT NULL,
  code_hash text NOT NULL CHECK(code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
  failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 5),
  consumed_at timestamptz,
  delivery_ref uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX checkout_otp_email_rate ON checkout_otp_challenges(email,created_at);
CREATE INDEX checkout_otp_cleanup ON checkout_otp_challenges(created_at);
