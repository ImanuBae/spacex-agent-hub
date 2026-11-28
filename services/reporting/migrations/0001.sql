CREATE TABLE report_daily (
  day date NOT NULL,
  branch_key text NOT NULL,
  confirmed bigint NOT NULL DEFAULT 0 CHECK (confirmed >= 0),
  received bigint NOT NULL DEFAULT 0 CHECK (received >= 0),
  refunded bigint NOT NULL DEFAULT 0 CHECK (refunded >= 0),
  PRIMARY KEY (day, branch_key)
);
CREATE TABLE report_day_checkpoints (
  day date PRIMARY KEY,
  projected_at timestamptz NOT NULL
);
CREATE TABLE report_event_checkpoints (
  event_id uuid PRIMARY KEY,
  day date NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
