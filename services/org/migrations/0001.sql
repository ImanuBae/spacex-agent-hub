CREATE TABLE branches (
  id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('center','branch')), active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX one_center ON branches(kind) WHERE kind='center';
CREATE TABLE departments (
  id uuid PRIMARY KEY, branch_id uuid NOT NULL REFERENCES branches(id), name text NOT NULL,
  description text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  UNIQUE(branch_id,name), UNIQUE(id,branch_id)
);
CREATE TABLE employees (
  id uuid PRIMARY KEY, account_id uuid NOT NULL UNIQUE, branch_id uuid NOT NULL REFERENCES branches(id),
  department_id uuid, name text NOT NULL, title text NOT NULL DEFAULT '', teacher_profile text,
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY(department_id,branch_id) REFERENCES departments(id,branch_id)
);
CREATE TABLE access_sync (
  id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES employees(id), actor_id uuid NOT NULL,
  role text NOT NULL, branch_ids uuid[] NOT NULL, status text NOT NULL CHECK(status IN ('pending','applied','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_access ON access_sync(employee_id) WHERE status='pending';
CREATE TABLE org_audit (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL, target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
