CREATE TABLE machine_principals (
  id text PRIMARY KEY,
  secret_hash text NOT NULL,
  grants jsonb NOT NULL,
  workflows text[] NOT NULL,
  credential_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE automation_delegations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  input jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
