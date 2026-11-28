CREATE TABLE automation_incidents (
 job_id uuid PRIMARY KEY REFERENCES automation_jobs(id),
 failed_at timestamptz NOT NULL,
 failed_step text NOT NULL,
 failed_attempt integer NOT NULL,
 error_code text,
 owner_role text NOT NULL DEFAULT 'center_director' CHECK(owner_role='center_director'),
 alerted_at timestamptz
);
CREATE INDEX automation_incidents_unalerted ON automation_incidents(failed_at,job_id) WHERE alerted_at IS NULL;
INSERT INTO automation_incidents(job_id,failed_at,failed_step,failed_attempt,error_code)
 SELECT id,updated_at,step,attempt,error_code FROM automation_jobs WHERE status='DEAD';
