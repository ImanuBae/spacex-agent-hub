ALTER TABLE courses ADD COLUMN policy_text text NOT NULL DEFAULT '';
ALTER TABLE course_packages ADD COLUMN policy_text text NOT NULL DEFAULT '';
