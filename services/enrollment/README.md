# Enrollment — N8N-05

Own PostgreSQL database, port4008. Run the versioned migration twice on a fresh/copy
DB before service startup. Never point it at Class, CRM, Payment or an existing demo DB.

Public staff API: POST /api/v1/enrollment-confirmations/preview with
{contactId,learnerId,payerId,classId,packageId} and a UUID Idempotency-Key. Backend
checks current CRM consent/relationships, Class and Catalog and stores the immutable
offer, actor/session, class/quote/terms versions and a five-minute server deadline.
POST /:id/confirm {accepted:true} creates one enrollment.requested event. POST
/:id/revoke {} invalidates an unused confirmation. Chat prose does not confirm buying.
GET confirmations/:id and enrollments/:id read durable money/seat state; managers read
in their branch, admissions only their own enrollment. POST enrollments/:id/cancel
{version,reason} creates a versioned cancellation request, not a claim of refund.

Internal enrollment.execute steps: create, held, payment, confirming, confirm,
reconcile, cancel, failed, exception. Their bodies are {}, resource comes from the
live IAM/Bridge context. Stable keys are automation:<jobId>:enrollment.execute:<step>.
GET /internal/enrollment/enrollments/:id reads current state. Each step validates
real source results and writes state, operation result, audit and outbox in its own
transaction. CONFIRMED requires a Class COMMITTED seat and verified Payment match.
A technical job DONE does not imply Enrollment CONFIRMED.
Customer cancellation requires its stored actor/session/context; system review
jobs cannot claim it. Entering CONFIRMING/CONFIRMED clears expired release rights.
The Payment match links its durable request even if money arrived before the
WF-05 request-association checkpoint.

The seat-authority/payment-authority/customer-authority routes accept only their
reviewed exact-resource command audience. No generic admin or cross-database writes.
POST /internal/enrollment/deadlines lists due work through events; n8n runs the saga.
Class itself rejects expired holds even if n8n stops. No backend saga runner or Wait
node owns the deadline.

DEMO-N8N05-2026-11-14-v1 is synthetic only;20-minute hold, one24-hour review extension
with independent approval, no extension of the hold. Existing snapshots never change
when Catalog or terms change. A changed/closed quote requires a new confirmation.

Run local checks from root: node scripts/test-n8n05.mjs. It creates an isolated
pinned Docker project, fresh roles/DBs, test secrets and protected receipts. Keep
volumes/artifacts; never down-v/prune. Final acceptance and limitations are in
[the matrix](../../docs/acceptance-n8n-05.md). No provider/live/production acceptance
is implied by the synthetic adapter or fixture records.
