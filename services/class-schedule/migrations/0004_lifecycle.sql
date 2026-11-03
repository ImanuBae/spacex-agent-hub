ALTER TABLE classes DROP CONSTRAINT classes_status_check;
ALTER TABLE classes ADD CONSTRAINT classes_status_check CHECK(status IN ('DRAFT','PLANNED','OPEN','IN_PROGRESS','COMPLETED','CANCELLED'));
ALTER TABLE sessions ADD COLUMN active boolean NOT NULL DEFAULT true;
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='sessions'::regclass AND contype='x'
 LOOP EXECUTE format('ALTER TABLE sessions DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE sessions ADD CONSTRAINT session_class_overlap EXCLUDE USING gist(class_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active);
ALTER TABLE sessions ADD CONSTRAINT session_teacher_overlap EXCLUDE USING gist(teacher_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active AND teacher_id IS NOT NULL);
ALTER TABLE sessions ADD CONSTRAINT session_room_overlap EXCLUDE USING gist(room_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active AND room_id IS NOT NULL);
CREATE TABLE class_status_changes (
 id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id), version integer NOT NULL,
 previous_status text NOT NULL, status text NOT NULL, reason text NOT NULL,
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER class_status_changes_immutable BEFORE UPDATE OR DELETE ON class_status_changes
FOR EACH ROW EXECUTE FUNCTION immutable_class_audit();
