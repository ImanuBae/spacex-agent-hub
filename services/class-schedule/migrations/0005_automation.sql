-- Source-owned confirmation and separate approval; consumption and cancellation share one transaction.
CREATE TABLE class_cancellation_requests (
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id),
  branch_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_session_id uuid NOT NULL,
  context_id uuid NOT NULL,
  event_id uuid NOT NULL,
  payload jsonb NOT NULL,
  approver_id uuid,
  approver_session_id uuid,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
  revoked_at timestamptz,
  consumed_at timestamptz,
  result jsonb,
  job_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
