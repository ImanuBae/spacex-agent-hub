# Payment — N8N-05 synthetic adapter

Own PostgreSQL database, port4009. Migrate only a fresh/copy DB; rerunning the
migration is safe. Required service secrets are supplied via protected process
configuration, never workflow JSON or personal env files.

Payment request creation verifies an actual Class hold through both Enrollment and
Class. Amount/currency are taken from the immutable confirmed snapshot. Reference,
server deadline, QR payload and operation result persist in Payment. The adapter
is SYNTHETIC: qrPayload is labelled DEMO-ONLY and is not a SePay/bank QR.
It models request expiry/cancellation; incoming late transactions still enter the
ledger/review. No real payment/refund/transfer is performed.
PNG images are encoded locally with pinned `qrcode`1.5.4 (MIT),
[library API](https://github.com/soldair/node-qrcode#todataurltext-options-cberror-url).
No QR image service receives data. Only OPEN requests return an image; expired,
cancelled or settled requests keep the reference/payload for lookup and accounting.

Only NODE_ENV=test + PAYMENT_ADAPTER=synthetic opens POST
/internal/payment/synthetic-webhook. Authenticate with x-demo-signature: HMAC-SHA256
of JSON.stringify(SyntheticPaymentInput.parse(payload)), using the runtime's unique
32-byte-or-longer secret. Strict schema fixes SYNTHETIC/DEMO-N8N05/VND. This is the
specified demo adapter, not provider webhook validation or evidence of bank receipt.

Ledger is append-only, unique by provider/account/transactionId; same ID with a
different payload is409. One exact first transaction with the backend reference
creates one allocation/match and payment.matched in the same transaction. Wrong
references are UNALLOCATED reviews, not amount-based matches. Under/over/multiple
transactions create owned deadline reviews. NO_SEAT/REFUND_PENDING blocks match
eligibility. Never delete ledger to make an expected total fit.

Internal payment.execute: GET /internal/payment/enrollments/:id lookup;
POST /:id/create {}, /close {reason:EXPIRE|CANCEL|FAILED},
/exception {reason:NO_SEAT}. Stable keys bind job, action and immutable payload.
Closing a missing request persists a `payment_closures` fence under the same
Enrollment resource lock as creation. Later creation is rejected; a cancelled
registration cannot acquire an orphan QR. CANCEL requires the exact backend human
cancellation record; a service review cannot invent it. FAILED belongs only to
WF-05 compensation; EXPIRE belongs to WF-07 service policy.
Match readback routes enforce exact matchRef/enrollment/resource/audience.
POST /internal/payment/review-deadlines escalates overdue reviews without moving
money or extending a hold.

Public payment-requests/:id is a minimal money/QR projection. Kế toán đọc
payment-reviews and evidence detail, proposes a versioned EXTEND or REFUND_PENDING
with reason; a separate current director approves. A central UNALLOCATED review is
visible to its configured accountant owner and center director. Every completed
decision is retained in payment_review_decisions. At most one24-hour extension;
REFUND_PENDING is pending, never REFUNDED. Manual collection is disabled by demo
policy; the API has no fake-provider receipt path.
Refund review for an additional transaction is separate from the original tuition
ledger allocation. It cannot invalidate a funded match or release its seat.

Run node scripts/test-n8n05.mjs from root. Receipts, synthetic webhook bodies,
credentials and execution traces stay only in its ACL-protected local directory.
[Acceptance](../../docs/acceptance-n8n-05.md) separates local from provider/live gates.
## N8N06 local adjustment settlement and invoices

Migration `0002_adjustments.sql` adds separate adjustment reservations, decisions, operation results, immutable synthetic movement receipts, and invoice records. A refund reserves against allocated receipts plus earlier net synthetic charges, less earlier refunds and unresolved reservations under the original payment request lock. The excess variant protects the amount assigned to active tuition.

Enrollment retains the initiating accountant and independent approving director for refunds. A signed-in accountant with current branch access authorizes execution at `/api/v1/refunds/:id/execute`. This records a decision and wakes the waiting workflow. The synthetic adapter commits the execution receipt under the payment transaction only after checking the durable Enrollment plan and current sessions for both financial decisions. `EXECUTED` requires an adapter receipt. `UNKNOWN` requires a receipt lookup and owner review before retry. A charge that committed before a target seat failure is reversed with its own append-only receipt once Class proves the target never committed.

The adapter is enabled only in the isolated synthetic runtime. Optional `PAYMENT_ADJUSTMENT_FAULT=UNKNOWN_BEFORE|UNKNOWN_AFTER` selects a test-only uncertain-outcome case. A receipt exists only for the latter and can be recovered without replaying the movement. No bank provider is called.

Student invoice creation, list and authenticated attachment download are under `/api/v1/student/invoices`. Payment verifies the mapped learner, active entitlement and allocated match before creation. It audits each download and returns an escaped attachment labeled as a simulation. Invoice rendering uses stored backend data and never provides a public file link.
