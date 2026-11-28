CREATE TABLE self_registrations (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL UNIQUE,
  browser_key_hash text NOT NULL UNIQUE,
  event_id uuid NOT NULL,
  offer jsonb NOT NULL,
  email_hash text,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
