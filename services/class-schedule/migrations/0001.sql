CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE rooms (
 id uuid PRIMARY KEY, branch_id uuid NOT NULL, name text NOT NULL, capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 500), active boolean NOT NULL DEFAULT true,
 UNIQUE(branch_id,name)
);
CREATE TABLE classes (
 id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, course_id uuid NOT NULL, package_id uuid NOT NULL,
 branch_id uuid NOT NULL, teacher_id uuid, teacher_account_id uuid, mode text NOT NULL CHECK(mode IN ('onsite','online')),
 room_id uuid REFERENCES rooms(id), online_url text, capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 500),
 minimum_size integer NOT NULL CHECK(minimum_size >= 0 AND minimum_size <= capacity), registration_closes_at timestamptz NOT NULL,
 decision_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PLANNED','OPEN')),
 version integer NOT NULL DEFAULT 1, session_count integer NOT NULL CHECK(session_count > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id), teacher_id uuid, room_id uuid REFERENCES rooms(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at > starts_at),
 EXCLUDE USING gist (class_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&),
 EXCLUDE USING gist (teacher_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (teacher_id IS NOT NULL),
 EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (room_id IS NOT NULL)
);
CREATE INDEX ON sessions(class_id);
CREATE TABLE demo_fixtures (id uuid PRIMARY KEY, learner_id uuid NOT NULL, enrollment_id uuid NOT NULL UNIQUE, label text NOT NULL, branch_id uuid NOT NULL);
CREATE TABLE holds (
 id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id), package_id uuid NOT NULL, learner_id uuid NOT NULL, enrollment_id uuid NOT NULL,
 actor_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('HELD','CANCELLED','EXPIRED','COMMITTED')), expires_at timestamptz NOT NULL,
 operation_key uuid NOT NULL, request_payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,operation_key)
);
CREATE UNIQUE INDEX holds_one_learner ON holds(class_id,learner_id) WHERE status IN ('HELD','COMMITTED');
CREATE UNIQUE INDEX holds_one_enrollment ON holds(enrollment_id) WHERE status IN ('HELD','COMMITTED');
CREATE INDEX ON holds(class_id,status,expires_at);
CREATE TABLE class_audit(id uuid PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL, target_id uuid NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION immutable_class_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit is append only'; END $$;
CREATE TRIGGER class_audit_immutable BEFORE UPDATE OR DELETE ON class_audit FOR EACH ROW EXECUTE FUNCTION immutable_class_audit();
