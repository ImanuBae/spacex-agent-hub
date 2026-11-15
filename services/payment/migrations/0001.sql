CREATE TABLE payment_requests (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL UNIQUE, branch_id uuid NOT NULL, snapshot jsonb NOT NULL,
 amount_due bigint NOT NULL CHECK(amount_due>0), reference text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','EXPIRED','CANCELLED','SETTLED','REVIEW')),
 expires_at timestamptz NOT NULL, operation_key text NOT NULL UNIQUE, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_ledger (
 id uuid PRIMARY KEY, provider text NOT NULL, account text NOT NULL, transaction_id text NOT NULL,
 payload jsonb NOT NULL, amount bigint NOT NULL CHECK(amount>0), reference text NOT NULL,
 payment_id uuid REFERENCES payment_requests(id), received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,account,transaction_id)
);
CREATE TABLE payment_matches (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL UNIQUE REFERENCES payment_requests(id),
 ledger_id uuid NOT NULL UNIQUE REFERENCES payment_ledger(id), amount bigint NOT NULL, late boolean NOT NULL,
 event_id uuid NOT NULL, context_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_allocations (ledger_id uuid PRIMARY KEY REFERENCES payment_ledger(id), payment_id uuid NOT NULL REFERENCES payment_requests(id), amount bigint NOT NULL CHECK(amount>0));
CREATE TABLE payment_reviews (
 id uuid PRIMARY KEY, payment_id uuid REFERENCES payment_requests(id), ledger_id uuid REFERENCES payment_ledger(id),
 branch_id uuid, owner_id uuid NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ESCALATED','EXTENDED','REFUND_PENDING')),
 deadline_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', extended boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, proposed_by uuid, proposed_session uuid, decision jsonb,
 approved_by uuid, approved_session uuid, UNIQUE(ledger_id,reason)
);
CREATE TABLE payment_operations (key text PRIMARY KEY, enrollment_id uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL);
CREATE TABLE payment_closures (enrollment_id uuid PRIMARY KEY,reason text NOT NULL CHECK(reason IN ('EXPIRE','CANCEL','FAILED')),job_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_audit (id uuid PRIMARY KEY, target_id uuid NOT NULL, actor_id uuid NOT NULL, action text NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_review_decisions (id uuid PRIMARY KEY,review_id uuid NOT NULL REFERENCES payment_reviews(id),version integer NOT NULL,payload jsonb NOT NULL,proposed_by uuid NOT NULL,approved_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(review_id,version));
CREATE TABLE payment_review_proposals (id uuid PRIMARY KEY,review_id uuid NOT NULL REFERENCES payment_reviews(id),version integer NOT NULL,payload jsonb NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(review_id,version));
CREATE FUNCTION immutable_payment_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append only payment ledger'; END $$;
CREATE TRIGGER payment_ledger_immutable BEFORE UPDATE OR DELETE ON payment_ledger FOR EACH ROW EXECUTE FUNCTION immutable_payment_ledger();
