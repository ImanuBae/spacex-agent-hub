ALTER TABLE crm_erasure_tasks ADD COLUMN outcome_code text;
ALTER TABLE crm_erasure_requests ADD COLUMN retry_at timestamptz;
CREATE INDEX crm_erasure_due ON crm_erasure_requests(retry_at,created_at,id) WHERE status IN ('VERIFIED','PROCESSING');
