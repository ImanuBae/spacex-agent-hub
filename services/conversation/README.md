# Conversation / web Channel — N8N-04 local slice

Status: **SYNTHETIC TEST ONLY**; the current agent decision and acceptance are in
[the N8N-03/04 matrix](../../docs/acceptance-n8n-03-04.md). Provider export is
blocked by default, including when a key is installed. The earlier model acceptance
is historical and does not verify the new workflow checksum. See the
[findings and rollout gates](../../docs/review-n8n-04-hardening.md),
[new evidence](../../workflows/n8n/chat-hardening-evidence.json) and [handoff](../../docs/ban-giao-n8n-04.md).
The service owns its own PostgreSQL DB: opaque guest sessions, conversation messages,
ownership/mode/version, delivery queue, context and audit. It reuses IAM, Gateway,
Bridge and messaging; no Enrollment/Payment or external channel adapter is enabled.

## Configuration and migration

Use a new protected environment file/process environment; never overwrite a personal `.env`.
Copy the names in [.env.example](.env.example). `CHAT_BRANCH_ID` is a trusted deployment
mapping, not a guest/model argument. Provision the mapped branch through the existing Org setup.
Create a dedicated DB/user, revoke PUBLIC CONNECT and grant no access to other service DBs.
Run `node ../../node_modules/tsx/dist/cli.mjs src/migrate.ts` from this service with its
own `DATABASE_URL`; migration is transactional/versioned and can be rerun.
Build from root with `npm run check`, then start `node dist/index.js` from this directory
with the explicit process environment. Default root dev excludes this optional service.

Configure IAM `CONVERSATION_URL` to this service and Gateway `CONVERSATION_URL` likewise.
IAM alone holds the signing private key. Provision a dedicated `channel-source` principal:
audience `conversation`, scope `channel:context`, workflow `WF-02`. Install its returned
secret only in this service's protected environment. n8n never receives this credential.
Set `CHANNEL_CLIENT_ID` to the exact provisioned subject. The source callback rejects
other subjects even if they have the same scope. Rotation/revocation invalidates existing
source delegations; restart with the new secret and initiate a fresh conversation turn.

Provision n8n worker grants for `WF-01/02/03`: Bridge claim/checkpoint/result/authorize,
Catalog read and Class read. Domain grants cannot issue unrestricted machine domain tokens.
Use [workflow manifest](../../workflows/n8n/chat-manifest.json) bindings and event patterns
`channel.#`, `conversation.#` on Bridge; add the exact worker subject to its allowlist.
Keep the existing mappings if other workflows are already deployed.

## HTTP contracts

All bodies use strict [Zod contracts](../../packages/contracts/src/conversation.ts).
Guest endpoints pass through Gateway; Portal BFF stores the guest token in an HttpOnly,
SameSite=Strict cookie and checks Origin on mutation. Internal endpoints have no Gateway route.
Configure TLS for non-local deployment; no production rollout was performed.

| Endpoint | Authority / result |
| --- | --- |
| POST `/api/v1/chat/session` | `{consent:true}`; server-mapped branch, opaque 8h token; DB stores only its hash |
| GET `/api/v1/chat/history` | Guest Bearer; resolves only its own conversation; includes durable messages and mode |
| POST `/api/v1/chat/messages` | Guest Bearer + `{clientMessageId,text}`; 2,000 chars, max 100 inbound/session; dedup + event outbox commit atomically |
| POST `/api/v1/chat/revoke` | Guest Bearer + `{}`; subsequent history/context reads denied |
| GET `/api/v1/conversations` | Live IAM staff; branch and current ownership; up to 100 conversations |
| GET `/api/v1/conversations/:id` | Live IAM staff; branch/ownership checked before history |
| POST `/api/v1/conversations/:id/mode` | `{expectedVersion,mode}`; row lock/CAS, owner from IAM; cancels queued AI drafts immediately |
| POST `/api/v1/conversations/:id/messages` | Current human owner + `{expectedVersion,clientMessageId,text}`; durable outbound/dedup |
| GET `/internal/conversations/contexts/:id` | Exact Channel source subject + live IAM introspection; current guest/session/mode/version/watermark/expiry |
| POST `/internal/conversations/route` | WF-01 proof + checkpointed `conversation.route`; creates deduped WF-02 context/event |
| POST `/internal/conversations/turn` | WF-02 proof + `conversation.send`; registers verified context with IAM; returns last eight minimized messages |
| POST `/internal/conversations/draft` | WF-02 proof; CAS/current context + fresh lease check before storing queued AI output, or durable HUMAN/error/handoff event |
| POST `/internal/conversations/handoff` | WF-03 proof + `conversation.handoff`; observes durable queue/owner and records audit; cannot undo a human CAS |

Proof: `{jobId,leaseToken,attempt}`. Bridge verifies workflow, subject, operation intent,
live lease and attempt; client-provided actor/branch/role are rejected. IAM stores a
Channel-source delegation reference and credential version, not a fake employee session.
Every delegated Catalog/Class request rechecks source session/version and Bridge lease.
Confirmation/approval fields cannot unlock any Enrollment/Payment command.

## Delivery and safety

`chat_messages` is the durable web outbound queue. Guest polling drains QUEUED to
DELIVERED while holding the conversation lock; this is adapter delivery, not a browser
read receipt. Lost HTTP responses are safe: reconnect returns those durable messages again
under the same IDs. The UI replaces its history by ID rather than appending duplicate polls.
AI drafts queued before takeover but not delivered are CANCELLED in the takeover transaction.
Already delivered messages remain history. New guest input increments version/watermark;
older drafts cannot send. Repeated AI submission uses the event ID as its dedup key.

Guest tools receive public projections: Catalog active offers/price/policy versions;
Class OPEN snapshots without teacher/room IDs, online links, occupancy details or internal
conditions. Class `sellable=true` remains forbidden. WF-02 separately reads Catalog and
Class, joins course/package/mode and filters closed registration/full snapshots. This is
not a hold, a guarantee of sale, or an atomic cross-service snapshot. More than 100 source
rows triggers a handoff instead of silently treating a truncated page as a complete result.

`CHAT_PROVIDER_DATA_POLICY` defaults to blocked. Only an isolated deployment with
`NODE_ENV=test` **and** `CHAT_PROVIDER_DATA_POLICY=synthetic-only` may export synthetic
prose. Unknown/missing values and every non-test environment remain blocked. This is
an operator declaration about the entire isolated dataset, not a PII classifier;
never connect this deployment to customer ingress or real Catalog data. There is no
customer-data approval mode in this implementation. `AI_FREE_MODEL_READY=true` alone
does not open the gate. `/turn` returns empty messages and `DATA_POLICY_BLOCKED`, and
WF-02 durably hands off to HUMAN without running either model node. Successful
drafts are also rejected by the backend if the gate is closed.

Turn admission locks session then conversation, rechecks context/version/lease and
excludes STAFF text. WF-02 repeats admission before its second model call; tool errors
skip that call. Successful drafts revalidate Channel source authority and both output
and error drafts recheck the worker lease after acquiring locks. Already-admitted
requests cannot be recalled from the provider, and remote authority/DB commit remain
separate operations.

Context/output redaction covers email, phone-like numbers and explicitly labelled personal
fields. Arbitrary free prose can contain unlabelled names/addresses; this is not a complete
PII classifier. Use synthetic fixtures for the free-provider pilot. No staff identifiers,
tokens or branch overrides are passed into model messages. Provider data policy and any
broader real-customer rollout still require review.

## Model and rerun

Workflow uses the fixed OpenRouter endpoint and `nvidia/nemotron-3.5-lightning:free`;
no paid fallback. The initial `openrouter/free` evaluation varied models and produced
invalid tool arguments; the fixed free model was verified with a real tool-call probe.
Only `read_catalog_classes` (three fixed read APIs) and `request_handoff` are allowed.
Neither accepts arguments; the model cannot supply URLs, filters, branch or identity.
Machine credentials are n8n Custom Auth, with credential JSON
`{"body":{"clientId":"PROVISIONED_ID","clientSecret":"PROVISIONED_SECRET"}}`.
The free-model Header Auth credential is `llm-free-demo` with header Authorization.
Do not put either secret into exported workflow JSON. See the [n8n runbook](../../workflows/n8n/README.md).

`AI_FREE_MODEL_READY` defaults false. It represents credential readiness only; enable
it solely in the isolated synthetic pilot after installing the credential and data gate.
Missing key yields a durable HUMAN/MISSING_KEY state, not a fabricated AI answer.
429/timeout/tool/denied errors also hand off; no automatic return to AI.
Each HTTP call is bounded (internal 3s, model 6s), max two model calls and three domain
reads per turn. Draft checks the 20s turn budget; the workflow's 55s recovery timeout is
not a demonstrated 20s end-to-end handoff SLA. Technical Bridge retry remains bounded
by its existing eight-failure policy. The fixed free model has now run through real
n8n/IAM/Catalog/Class and the [ten-case review](../../workflows/n8n/chat-benchmark-review.json)
passed locally. The nineteen requests in those ten cases each reported USD 0.

From root:

```powershell
npm run check
npm run test:chat
```

This creates a fresh Docker project, five separate application DBs/users, broker and n8n
test DB/volumes. N8N-02/03 are rerun before N8N-04. It does not read personal `.env`
contents; it compares file size/mtime and existing n8n container start times, stops only its project and retains
volumes. Receipts include each retained volume's KiB and private artifact bytes.
No global prune or Docker disk relocation occurs.

## Current guarded benchmark

Use the already authorized `.local/credentials/openrouter.key`; never put its value
in a command. `prepare-authorized-n8n04.mjs` reads fresh quota/pricing/capability
metadata and verifies receipts/hashes. It creates a new grant, not an inference.

```powershell
node scripts/prepare-authorized-n8n04.mjs
node scripts/accept-n8n04.mjs .local/automation/<new-grant>/acceptance-preflight.json
node scripts/test-n8n04-transport.mjs .local/automation/<new-grant>/preflight.json
# Refresh quota/grant after checks; use that new directory for the real batch.
node scripts/prepare-authorized-n8n04.mjs
node scripts/run-n8n04-benchmark.mjs .local/automation/<fresh-grant>/preflight.json
```

The guard limits a batch to 20 attempts, two per case, zero-price routing and no
paid fallback. The current authorization also limits agent attempts to 50 per UTC
day and the actual remaining free quota. Metadata and loopback tests are recorded
separately. The real provider key stays in the guard process; n8n receives only a
local capability. Public evidence binds the raw receipt; review actual/expected,
sources, renderer/template provenance and DB outcomes separately before acceptance.

The pinned request model and response model ID are separate fields in
`scripts/n8n04-model.mjs`. Current official endpoint metadata reports the canonical
response alias; generation metadata identifies the dated model and Nvidia endpoint.
The guard requires that exact response ID, provider and zero cost. A changed ID
stops the batch; it does not silently accept another model.

For a newly authorized partial batch, preparation accepts original corpus IDs in
order, for example `node scripts/prepare-authorized-n8n04.mjs 'VI-09'`.
It still hashes the complete corpus and keeps all ten rows in the receipt. Unselected
rows remain SKIP and required for acceptance. Each batch needs a new grant/marker;
this is not a stopped-run resume. A changed canonical/model/prompt needs new evidence
for affected cases. Follow the current matrix checkpoint and budget before running.

Do not resume a stopped marker or blindly retry a business operation. Preserve
FAIL/UNKNOWN/SKIP, diagnose/fix/review/test, then use a new authorized grant within
the remaining budget. Missing usage/cost stays UNKNOWN. On quota exhaustion, save a
checkpoint/next eligible UTC date; this runbook does not schedule an automatic run.

The live benchmark also stops its local guard on an authority denial/unavailable
authority or an unexpected tool failure. It saves the exact failing node/code and
the HUMAN outcome before cleanup. A safe failure is not a passing functional answer.

The guard now records monotonic request/socket timing, DNS/TCP/TLS observations,
socket reuse, local writes, headers/body progress and aborts. A local write is not
an upstream acknowledgement; pool connection candidates remain unconfirmed until
the exact request is bound to its socket. Response generation/request IDs are
allowlisted and persisted before reading the body, without logging credentials,
payload chunks or TLS secrets. If the body stalls, use the saved header generation
ID for a separately recorded official metadata GET. Missing metadata/cost stays
UNKNOWN. The runner reserves two calls per functional case before starting; the
current full corpus requires16 attempts. See [diagnostic evidence and continuation](../../docs/n8n04-timeout-diagnostics.md).

<details>
<summary>Historical unguarded harness instructions — do not use for current budgeted inference</summary>

For a real free-model benchmark, first create the key yourself and save only its value
to ignored `.local/credentials/openrouter.key`. Then set the path, never the key in a command:

```powershell
$env:N8N04_MODEL_KEY_FILE='D:\Imanu\Study\space-agent-hub\.local\credentials\openrouter.key'
npm run test:chat
```

The harness imports the key into the disposable n8n credential store and runs the ten
Vietnamese cases in `chat-benchmark.json`. It preserves actual outputs/tool/model traces
for review; execution alone does not auto-approve answer quality. Without this variable
the provider is not called and benchmark is explicitly BLOCKED/0 executed.

For a quota-limited continuation, `N8N04_BENCHMARK_RESUME_FILE` can point to a prior
private `benchmark-private.json`. The harness requires matching canonical workflow
checksums, identical inputs and real model/job evidence. It records each case's source
project; resumed cases are not represented as having run again. The 09/11 review used
two cases from one isolated project and eight from another with identical workflows.
Execution IDs are ordered numerically; traces are also retained under unique job IDs.
Test workflow copies retain private execution data, while canonical exports keep it disabled.

</details>

429/timeout/Class failures are injected through a separate local fixture process in
the model-enabled harness. No model response text is mocked, no provider key is sent
to the fixture, and these fault checks are explicitly not counted as AI inference.
The test restores the real workflow afterwards. Free NVIDIA endpoint data terms still
require synthetic/non-personal pilot data; this acceptance does not enable real customers.

Cleanup only after inspecting the receipt: use the recorded project/env/compose files
with `docker compose ... down`. Volumes remain deliberately; delete only explicitly
reviewed test-volume names if later requested. Keep private execution/credential files
out of Git; do not publish the ignored directory.
