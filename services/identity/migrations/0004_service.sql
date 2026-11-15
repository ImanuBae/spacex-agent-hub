CREATE TABLE service_delegations (
 id uuid PRIMARY KEY, source_id text NOT NULL REFERENCES machine_principals(id),
 credential_version integer NOT NULL, audience text NOT NULL CHECK(audience IN ('enrollment','payment')), input jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE UNIQUE INDEX service_delegation_event ON service_delegations(source_id,(input->>'eventId'));
