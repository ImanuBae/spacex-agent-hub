ALTER TABLE crm_people ADD COLUMN merged_into uuid REFERENCES crm_people(id), ADD COLUMN merged_at timestamptz;
CREATE TABLE crm_channel_identities (
 id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider='WEB_CHAT'), account_ref uuid NOT NULL, subject_ref uuid NOT NULL,
 branch_id uuid NOT NULL, contact_id uuid NOT NULL REFERENCES crm_people(id), source_ref uuid NOT NULL,
 source_version integer NOT NULL, version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(provider,account_ref,subject_ref)
);
CREATE TABLE crm_merge_plans (
 id uuid PRIMARY KEY, branch_id uuid NOT NULL, source_id uuid NOT NULL REFERENCES crm_people(id), target_id uuid NOT NULL REFERENCES crm_people(id),
 actor_id uuid NOT NULL, actor_session_id uuid NOT NULL, payload jsonb NOT NULL, report jsonb NOT NULL, report_hash text NOT NULL,
 approver_id uuid, approver_session_id uuid, evidence_ref text, job_id uuid, result jsonb,
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','APPROVED','EXECUTED','REVOKED')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE crm_automation_requests (
 id uuid PRIMARY KEY, branch_id uuid NOT NULL, actor_id uuid NOT NULL, actor_session_id uuid NOT NULL,
 event_id uuid UNIQUE NOT NULL, context_id uuid UNIQUE NOT NULL, payload jsonb NOT NULL, source jsonb,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PARTIAL','DONE')), result jsonb,
 job_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER crm_automation_payload_immutable BEFORE UPDATE OF payload,source,branch_id,actor_id,actor_session_id,event_id,context_id ON crm_automation_requests FOR EACH ROW EXECUTE FUNCTION crm_immutable();
CREATE TRIGGER crm_merge_payload_immutable BEFORE UPDATE OF payload,report,report_hash,source_id,target_id,branch_id,actor_id,actor_session_id ON crm_merge_plans FOR EACH ROW EXECUTE FUNCTION crm_immutable();
