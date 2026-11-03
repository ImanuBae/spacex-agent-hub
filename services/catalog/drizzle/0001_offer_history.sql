ALTER TABLE courses ADD COLUMN policy_version integer NOT NULL DEFAULT 1;
ALTER TABLE courses ADD COLUMN effective_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE course_packages ADD COLUMN policy_version integer NOT NULL DEFAULT 1;
ALTER TABLE course_packages ADD COLUMN effective_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE offer_history(entity text NOT NULL, entity_id uuid NOT NULL, version integer NOT NULL, effective_at timestamptz NOT NULL, snapshot jsonb NOT NULL, PRIMARY KEY(entity,entity_id,version));
INSERT INTO offer_history SELECT 'courses',id,policy_version,effective_at,to_jsonb(courses) FROM courses;
INSERT INTO offer_history SELECT 'course_packages',id,policy_version,effective_at,to_jsonb(course_packages) FROM course_packages;
CREATE FUNCTION offer_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN NEW.policy_version := OLD.policy_version+1; NEW.effective_at := clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION offer_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO offer_history VALUES(TG_TABLE_NAME,NEW.id,NEW.policy_version,NEW.effective_at,to_jsonb(NEW)); RETURN NEW;
END $$;
CREATE TRIGGER course_version BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION offer_version();
CREATE TRIGGER package_version BEFORE UPDATE ON course_packages FOR EACH ROW EXECUTE FUNCTION offer_version();
CREATE TRIGGER course_snapshot AFTER INSERT OR UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION offer_snapshot();
CREATE TRIGGER package_snapshot AFTER INSERT OR UPDATE ON course_packages FOR EACH ROW EXECUTE FUNCTION offer_snapshot();
CREATE FUNCTION immutable_offer_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Policy history is append only'; END $$;
CREATE TRIGGER immutable_offer_history BEFORE UPDATE OR DELETE ON offer_history FOR EACH ROW EXECUTE FUNCTION immutable_offer_history();
