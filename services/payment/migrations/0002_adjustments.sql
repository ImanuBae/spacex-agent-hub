CREATE TABLE payment_adjustments (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL, payment_id uuid NOT NULL REFERENCES payment_requests(id),
 branch_id uuid NOT NULL, amount_delta bigint NOT NULL, refund_mode text,
 source_version integer NOT NULL CHECK(source_version>0), policy_version text NOT NULL, source jsonb NOT NULL,
 status text NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING','AUTHORIZED','RESERVED','UNKNOWN','EXECUTED','FAILED','REVOKED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), actor_id uuid NOT NULL, actor_session uuid NOT NULL,
 approved_by uuid, approved_session uuid, execution_by uuid, execution_session uuid,
 deadline_at timestamptz NOT NULL, receipt_id uuid, error_code text, correlation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(approved_by IS NULL OR approved_by<>actor_id),
 CHECK((approved_by IS NULL)=(approved_session IS NULL)), CHECK((execution_by IS NULL)=(execution_session IS NULL)),
 CHECK(execution_by IS NULL OR approved_by IS DISTINCT FROM execution_by),
 CHECK(status<>'EXECUTED' OR receipt_id IS NOT NULL), CHECK(status<>'RESERVED' OR amount_delta<0)
);
CREATE TABLE synthetic_payment_executions(id uuid PRIMARY KEY,adjustment_id uuid NOT NULL REFERENCES payment_adjustments(id),direction text NOT NULL CHECK(direction IN ('REFUND','CHARGE','ZERO','REVERSAL')),amount bigint NOT NULL CHECK(amount>=0),adapter text NOT NULL CHECK(adapter='SYNTHETIC'),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(adjustment_id,direction),UNIQUE(adjustment_id,id),CHECK((amount=0)=(direction='ZERO')));
ALTER TABLE payment_adjustments ADD CONSTRAINT payment_adapter_receipt FOREIGN KEY(id,receipt_id) REFERENCES synthetic_payment_executions(adjustment_id,id);
CREATE TABLE payment_adjustment_operations(key text PRIMARY KEY,adjustment_id uuid NOT NULL REFERENCES payment_adjustments(id),action text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_adjustment_history(id uuid PRIMARY KEY,adjustment_id uuid NOT NULL REFERENCES payment_adjustments(id),version integer NOT NULL,action text NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(adjustment_id,version));
CREATE TABLE payment_invoices(id uuid PRIMARY KEY,payment_id uuid NOT NULL REFERENCES payment_requests(id),enrollment_id uuid NOT NULL,learner_id uuid NOT NULL,branch_id uuid NOT NULL,actor_id uuid NOT NULL,payload jsonb NOT NULL,amount bigint NOT NULL CHECK(amount>0),operation_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,operation_key));
CREATE FUNCTION immutable_synthetic_execution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append only synthetic execution'; END $$;
CREATE TRIGGER synthetic_execution_immutable BEFORE UPDATE OR DELETE ON synthetic_payment_executions FOR EACH ROW EXECUTE FUNCTION immutable_synthetic_execution();
