CREATE TABLE class_enrollment_operations (
 operation_key text PRIMARY KEY,
 enrollment_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('hold','commit','release')),
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX class_enrollment_operations_enrollment ON class_enrollment_operations(enrollment_id);
CREATE TRIGGER class_enrollment_operations_immutable BEFORE UPDATE OR DELETE ON class_enrollment_operations
FOR EACH ROW EXECUTE FUNCTION immutable_class_audit();
