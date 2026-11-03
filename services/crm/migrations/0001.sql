CREATE TABLE crm_people (
 id uuid PRIMARY KEY, branch_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('CONTACT','LEARNER','PAYER')),
 full_name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ERASED')), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON crm_people(branch_id,kind,created_at);
CREATE INDEX ON crm_people(branch_id,phone) WHERE phone<>'' AND status='ACTIVE';
CREATE INDEX ON crm_people(branch_id,email) WHERE email<>'' AND status='ACTIVE';
CREATE TABLE crm_relationships (
 id uuid PRIMARY KEY, from_person_id uuid NOT NULL REFERENCES crm_people(id), learner_id uuid NOT NULL REFERENCES crm_people(id),
 kind text NOT NULL CHECK(kind IN ('SELF','PARENT','GUARDIAN','OTHER')), status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REJECTED')),
 evidence_ref text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, actor_id uuid NOT NULL,
 UNIQUE(from_person_id,learner_id), CHECK(from_person_id<>learner_id)
);
CREATE TABLE crm_consents (
 id uuid PRIMARY KEY, person_id uuid NOT NULL REFERENCES crm_people(id), purpose text NOT NULL CHECK(purpose IN ('ADMISSIONS','MARKETING','COURSE_NOTICES')),
 status text NOT NULL CHECK(status IN ('GRANTED','REVOKED')), statement_version text NOT NULL, statement_text text NOT NULL,
 method text NOT NULL CHECK(method IN ('WRITTEN','VERBAL','WEB_FORM')), actor_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX ON crm_consents(person_id,purpose,sequence DESC);
CREATE TABLE crm_leads (
 id uuid PRIMARY KEY, branch_id uuid NOT NULL, contact_id uuid NOT NULL REFERENCES crm_people(id),
 learner_id uuid REFERENCES crm_people(id), payer_id uuid REFERENCES crm_people(id), course_id uuid,
 source text NOT NULL CHECK(source IN ('WALK_IN','PHONE','WEB_CHAT','REFERRAL','FACEBOOK','ZALO','OTHER')),
 owner_id uuid, stage text NOT NULL DEFAULT 'NEW' CHECK(stage IN ('NEW','CONTACTED','QUALIFIED','LOST')),
 notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_lead_active ON crm_leads(branch_id,contact_id,COALESCE(learner_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(course_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE stage<>'LOST';
CREATE INDEX ON crm_leads(branch_id,stage,owner_id,created_at);
CREATE TABLE crm_erasure_requests (
 id uuid PRIMARY KEY, person_id uuid NOT NULL REFERENCES crm_people(id), branch_id uuid NOT NULL,
 reason text NOT NULL, status text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK(status IN ('PENDING_VERIFICATION','VERIFIED','PROCESSING','COMPLETED','REJECTED')),
 version integer NOT NULL DEFAULT 1, requested_by uuid NOT NULL, verified_by uuid, verification_method text,
 evidence_ref text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_erasure_active ON crm_erasure_requests(person_id) WHERE status NOT IN ('COMPLETED','REJECTED');
CREATE TABLE crm_erasure_tasks (
 request_id uuid NOT NULL REFERENCES crm_erasure_requests(id), service text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DONE','NOT_APPLICABLE','BLOCKED')),
 evidence_ref text NOT NULL DEFAULT '', actor_id uuid, version integer NOT NULL DEFAULT 1, PRIMARY KEY(request_id,service)
);
CREATE TABLE crm_erasure_tombstones (person_id uuid PRIMARY KEY, branch_id uuid NOT NULL, request_id uuid NOT NULL, erased_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE crm_operations (actor_id uuid NOT NULL, namespace text NOT NULL, operation_key uuid NOT NULL, request_hash text NOT NULL, resource_id uuid NOT NULL, PRIMARY KEY(actor_id,namespace,operation_key));
CREATE TABLE crm_audit (id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL, target_id uuid, branch_id uuid, correlation_id text NOT NULL, version integer, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION crm_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CRM audit is append only'; END $$;
CREATE TRIGGER crm_audit_immutable BEFORE UPDATE OR DELETE ON crm_audit FOR EACH ROW EXECUTE FUNCTION crm_immutable();
CREATE TRIGGER crm_erasure_tombstones_immutable BEFORE UPDATE OR DELETE ON crm_erasure_tombstones FOR EACH ROW EXECUTE FUNCTION crm_immutable();
CREATE TABLE crm_event_receipts (event_id uuid PRIMARY KEY, event_type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now());
