ALTER TABLE crm_automation_requests ADD COLUMN erasure_request_id uuid REFERENCES crm_erasure_requests(id);
ALTER TABLE crm_merge_plans ADD COLUMN erasure_request_id uuid REFERENCES crm_erasure_requests(id);

CREATE FUNCTION crm_erased_payload(payload jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE payload->>'action'
  WHEN 'resolve-channel' THEN payload-'contact'-'consent'
  WHEN 'lead.create' THEN jsonb_set(payload,'{lead,notes}','""')
  WHEN 'lead.update' THEN jsonb_set(payload,'{update,notes}','""')
  ELSE payload END
$$;

CREATE FUNCTION crm_scrub_automation_history(person uuid, request uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE crm_merge_plans SET report='{"erased":true}',erasure_request_id=request,
  status=CASE WHEN status IN ('PLANNED','APPROVED') THEN 'REVOKED' ELSE status END
 WHERE erasure_request_id IS NULL AND (
  source_id=person OR target_id=person
  OR jsonb_path_exists(report,'$.** ? (@ == $person)',jsonb_build_object('person',person::text))
  OR EXISTS (SELECT 1 FROM crm_leads l WHERE (l.contact_id=person OR l.learner_id=person OR l.payer_id=person)
   AND report @> jsonb_build_object('leads',jsonb_build_array(jsonb_build_object('id',l.id))))
  OR EXISTS (SELECT 1 FROM crm_relationships r WHERE (r.from_person_id=person OR r.learner_id=person)
   AND report @> jsonb_build_object('relationships',jsonb_build_array(jsonb_build_object('id',r.id))))
 );
 UPDATE crm_automation_requests a SET payload=crm_erased_payload(payload),erasure_request_id=request
 WHERE erasure_request_id IS NULL AND (
  payload->'lead'->>'contactId'=person::text OR payload->'lead'->>'learnerId'=person::text OR payload->'lead'->>'payerId'=person::text
  OR result->>'contactId'=person::text OR result->>'sourceId'=person::text OR result->>'targetId'=person::text
  OR EXISTS (SELECT 1 FROM crm_leads l WHERE (l.contact_id=person OR l.learner_id=person OR l.payer_id=person)
   AND (payload->>'leadId'=l.id::text OR result->>'leadId'=l.id::text))
  OR EXISTS (SELECT 1 FROM crm_channel_identities i WHERE i.contact_id=person
   AND source->>'provider'=i.provider AND source->>'accountRef'=i.account_ref::text AND source->>'subjectRef'=i.subject_ref::text)
  OR EXISTS (SELECT 1 FROM crm_merge_plans p WHERE p.erasure_request_id=request AND a.payload->>'planId'=p.id::text)
 );
END
$$;

DROP TRIGGER crm_automation_payload_immutable ON crm_automation_requests;
DROP TRIGGER crm_merge_payload_immutable ON crm_merge_plans;
-- Repair copies left by anonymizations performed before this migration.
DO $$ DECLARE tombstone record; BEGIN
 FOR tombstone IN SELECT t.* FROM crm_erasure_tombstones t
  JOIN crm_people p ON p.id=t.person_id AND p.status='ERASED'
  JOIN crm_erasure_requests r ON r.id=t.request_id AND r.person_id=t.person_id AND r.status IN ('VERIFIED','PROCESSING','COMPLETED')
 LOOP PERFORM crm_scrub_automation_history(tombstone.person_id,tombstone.request_id); END LOOP;
END $$;

CREATE FUNCTION crm_automation_payload_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()=2 AND OLD.erasure_request_id IS NULL AND NEW.erasure_request_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM crm_erasure_tombstones WHERE request_id=NEW.erasure_request_id)
  AND NEW.payload=crm_erased_payload(OLD.payload)
  AND to_jsonb(NEW)-ARRAY['payload','erasure_request_id']=to_jsonb(OLD)-ARRAY['payload','erasure_request_id']
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'CRM audit is append only';
END
$$;
CREATE FUNCTION crm_merge_payload_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()=2 AND OLD.erasure_request_id IS NULL AND NEW.erasure_request_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM crm_erasure_tombstones WHERE request_id=NEW.erasure_request_id)
  AND NEW.report='{"erased":true}'::jsonb
  AND NEW.status=(CASE WHEN OLD.status IN ('PLANNED','APPROVED') THEN 'REVOKED' ELSE OLD.status END)
  AND to_jsonb(NEW)-ARRAY['report','status','erasure_request_id']=to_jsonb(OLD)-ARRAY['report','status','erasure_request_id']
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'CRM audit is append only';
END
$$;
CREATE TRIGGER crm_automation_payload_immutable BEFORE UPDATE OF payload,source,branch_id,actor_id,actor_session_id,event_id,context_id,erasure_request_id ON crm_automation_requests FOR EACH ROW EXECUTE FUNCTION crm_automation_payload_guard();
CREATE TRIGGER crm_merge_payload_immutable BEFORE UPDATE OF payload,report,report_hash,source_id,target_id,branch_id,actor_id,actor_session_id,erasure_request_id ON crm_merge_plans FOR EACH ROW EXECUTE FUNCTION crm_merge_payload_guard();

CREATE FUNCTION crm_erasure_scrub_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM crm_erasure_requests r JOIN crm_people p ON p.id=r.person_id
  WHERE r.id=NEW.request_id AND r.person_id=NEW.person_id AND r.branch_id=NEW.branch_id
   AND r.status='VERIFIED' AND r.verified_by IS NOT NULL AND p.status='ERASED')
 THEN RAISE EXCEPTION 'Verified CRM anonymization required'; END IF;
 PERFORM crm_scrub_automation_history(NEW.person_id,NEW.request_id);
 RETURN NEW;
END
$$;
CREATE TRIGGER crm_erasure_scrub_history AFTER INSERT ON crm_erasure_tombstones FOR EACH ROW EXECUTE FUNCTION crm_erasure_scrub_history();
