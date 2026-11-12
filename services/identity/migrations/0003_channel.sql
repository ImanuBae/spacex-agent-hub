CREATE TABLE channel_delegations (
 id uuid PRIMARY KEY,
 source_id text NOT NULL REFERENCES machine_principals(id),
 credential_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
