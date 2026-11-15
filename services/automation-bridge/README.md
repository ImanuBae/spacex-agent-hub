# Automation Bridge — N8N-02 / N8N-03

N8N-05 current source adds narrow `crm.execute`, `enrollment.execute`,
`payment.execute`, `classes.enroll` operation intents through shared contracts/IAM.
The Bridge still owns only durable jobs/inbox/lease/checkpoints; n8n owns step
orchestration and each backend owns its transaction and operation lookup.
Reference-only bindings and inactive canonical WF-04–07 are in
`workflows/n8n/registration-manifest.json`. Activation is only in the isolated
test project; historical smokes/receipts below keep their original scope.
[Current decision/matrix](../../docs/acceptance-n8n-05.md).

Current N8N-03 command slice: `classes.cancel` now has source-owned confirmation,
separate branch-director approval, expiry/version/payload binding, transactional
consumption and operation lookup in Class. See the
[Class runbook](../class-schedule/README.md#n8n-03-confirmed-and-approved-cancellation)
and [19-case command evidence](../../workflows/n8n/iam-command-evidence.json).
The read-only restrictions described in the historical read acceptance below do
not describe this new operation. Enrollment/Payment commands stay unavailable.

N8N-04 hardening: [findings/rollout gates](../../docs/review-n8n-04-hardening.md) and
[new evidence](../../workflows/n8n/chat-hardening-evidence.json). Bridge grants and
lease proof do not authorize provider export. Conversation now checks its separate
default-closed synthetic-test gate; checkpoint/result fencing remains unchanged.
Do not retry a lost checkpoint with its old expectedVersion, or hot-replace v1 chat
workflow content for in-flight jobs. Review versions/checksums and drain/recovery first.

N8N-04 adds an optional [Conversation / web Channel slice](../conversation/README.md),
[workflow bindings](../../workflows/n8n/chat-manifest.json) and [fresh evidence/status](../../docs/ban-giao-n8n-04.md).
It reuses this job/lease/attempt/intent protocol. `CommandFence` also permits the three
Conversation operations `conversation.route/send/handoff`; IAM refuses domain command
tokens for them. Conversation validates their live Bridge proof directly. Catalog/Class
issuance remains read-only. The Channel-source IAM audience/scope is separate from the
n8n worker and cannot impersonate staff. Business bindings remain opt-in; root dev
does not start the unconfigured Conversation service.

N8N-03 implements real IAM authority and the delegated Catalog/Class read slice.
See [current contract/runbook below](#n8n-03-machine-authority-and-delegation) and
[actual evidence/dependencies](../../docs/ban-giao-n8n-03.md). The N8N-02 receipt
remains historical; the current acceptance uses IAM-issued tokens for both smokes.

Bridge sở hữu PostgreSQL riêng: durable inbox, job, lease, checkpoint, operation references,
wait/wakeup và audit. Không chạy saga/command nghiệp vụ, không đọc DB service khác, không có
HTTP ingress tạo job từ n8n. Broker event từ backend đã xác minh là ingress duy nhất.
WF-01–12 chưa bật. Xem [bàn giao và bằng chứng](../../docs/ban-giao-n8n-02.md).

## Chạy lại acceptance biệt lập

Node.js 22+, npm, Docker Desktop/Engine và Compose v2. Chạy từ root repo.
Nếu chưa có image, tải đúng pin trước (harness dùng `--pull never`):

```powershell
docker pull postgres:17.7-alpine@sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2
docker pull docker.n8n.io/n8nio/n8n:2.46.4@sha256:4384b9ff20a78bc1708c35ce7864f84f724611de7801fb36d715998db7c000f1
docker pull rabbitmq:4-management@sha256:8dd6e3570ddaa2ef82a6c3a8950e79c1f73893adfbdddbc374fc1f1ac8a0f5dd
npm install --ignore-scripts
node node_modules/turbo/bin/turbo run build lint typecheck test --filter=@spacex/automation-bridge... --filter=@spacex/identity --filter=@spacex/catalog --filter=@spacex/class-schedule --output-logs=errors-only
npm run test:automation
```

`test:automation` tạo project `space-agent-automation-test-<random>` với hai PostgreSQL container:
một của n8n; một chứa DB/user Bridge, IAM, Catalog, Class test tách quyền CONNECT. RabbitMQ,
encryption key, IAM RSA key và volume đều mới; port host chọn động. Không nạp/ghi `.env` cá nhân
hoặc sửa runtime N8N-01. Các tiến trình Bridge/Catalog/Class smoke tổng hợp bind `0.0.0.0`
để Docker gọi host; quyền chỉ cho workflow/fixture test, không có command ghi nghiệp vụ.

Harness migrate hai lần, chạy regression N8N-02 và acceptance IAM N8N-03 trên Bridge thật,
import credential HTTP Header Auth do IAM cấp vào n8n mới, chạy cả hai workflow smoke thật và
đối chiếu DB/audit. Test lease/backoff/deadline
chủ động đặt timestamp trong **DB test** để kiểm ranh giới, không chờ 60 giây/300 giây thời gian thực.
Khóa ký của IAM test chỉ nằm trong `.local/automation/<project>/`, không phải key production;
token runtime được cấp bởi IAM HTTP thật và bị introspection mỗi lần sử dụng.

Evidence đã che: `.local/automation/<project>/evidence.json`; report: `vitest.json`.
Log, env, private key, credential input, full execution có thể chứa secret/lease: không commit/chia sẻ.
NTFS ACL vẫn cần bảo vệ thư mục; mode 0600 của Node không thay ACL trên Windows.
Harness dừng đúng project test bằng `down`, giữ volume và file để kiểm tra, không dùng `down -v`.
Nếu cổng vừa chọn bị chiếm, chạy lại để tạo project mới; không đổi cổng hệ thống đang chạy.

## Cấu hình và khởi động service

[.env.example](.env.example) mô tả biến; đây không phải file credential đã cấp.
DBA tạo **DB/user `automation_bridge` riêng**, role LOGIN không superuser/createdb/createrole,
chỉ sở hữu DB này; thu hồi CONNECT/schema access chéo DB. Không trỏ `DATABASE_URL` vào Catalog,
IAM, n8n hoặc DB có dữ liệu nghiệp vụ. Broker cấp tài khoản/vhost và quyền queue/exchange giới hạn.

Chuẩn bị file env mới ngoài repo hoặc dưới `.local/automation/operator.env` với secret được cấp,
không ghi đè file cũ. Dừng consumer/claim trước migration và backup DB. Chạy từ root:

```powershell
node --env-file=.local/automation/operator.env node_modules/tsx/dist/cli.mjs services/automation-bridge/src/migrate.ts
node --env-file=.local/automation/operator.env services/automation-bridge/dist/index.js
```

Bridge chạy riêng; `npm run dev` mặc định loại Bridge để không làm hỏng stack cũ khi chưa cấp cấu hình.
Migration có version/advisory lock, transactional, không DROP/seed dữ liệu và không tự chạy lúc start.
`GET /health` kiểm process; `GET /ready` kiểm DB/schema. Broker reconnect/recovery mỗi giây;
broker lỗi thì log `automation.tick_failed`/`messaging.broker_error`, không ack event chưa commit.
Consumer queue `spacex.automation.bridge.v1`, DLQ cùng tên thêm `.dead`, exchange `spacex.events`.
Giữ queue cũ khi restart; không purge. Handler lỗi được thư viện messaging đưa vào DLQ bền,
không tự lặp poison message. Inbox/job rollback cùng nhau nếu mapping/schema/DB lỗi.

`AUTOMATION_BINDINGS` là JSON allowlist `{eventType, workflowId, workflowVersion, inputSchemaVersion:1}`;
`AUTOMATION_EVENT_PATTERNS` là JSON các binding RabbitMQ, gồm trigger **và event wakeup** đã review.
Mặc định cả hai rỗng: không bật nghiệp vụ. Chỉ subscribe event đã che, reference-only;
không bind `#` tới event chứa PII, prompt hoặc sao kê. Context/input do backend nguồn lưu/kiểm quyền,
không lấy actor/role/branch hay token từ workflow payload.

## Contract triển khai

Schema chính thức: [automation.ts](../../packages/contracts/src/automation.ts).
EventEnvelope giữ `id/type/version/occurredAt/correlationId/payload`; thêm optional
`causationId/entityId/entityVersion` tương thích envelope cũ. `version` vẫn là **schema version**,
khác `entityVersion`. Trigger mới dùng payload `AutomationInput` strict, chỉ entity/contextRef/inputRef.
Không thay đổi payload/event cũ và không coi event nghiệp vụ hiện có là trigger tự động.

| API trực tiếp tại Bridge | Quyền và hành vi |
| --- | --- |
| `POST /internal/automation/jobs/claim` | scope `automation:claim`; body `{workflowId,workflowVersion}`; `{data:null}` khi không có việc/đủ 2 lease, ngược lại trả job + leaseToken |
| `POST /internal/automation/jobs/:id/checkpoint` | scope `automation:checkpoint`; lưu intent/receipt operation và renew lease 60 giây |
| `POST /internal/automation/jobs/:id/result` | scope `automation:result`; DONE, WAITING, RETRY hoặc DEAD; không sửa job đã kết thúc |
| `GET /internal/automation/jobs/:id` | scope `automation:read`, workflow allowlist; chỉ refs và metadata, không trả leaseToken |
| `POST /api/v1/automation/jobs/:id/replay` | phiên IAM hiện hành + `center_director`, lý do 10–500 ký tự và expectedVersion; chỉ DEAD |

Gateway không có target/route Bridge; cả internal API lẫn replay không được forward public.
Operator truy cập qua mạng nội bộ được quản lý. BFF/Portal Operations chưa tích hợp.

Machine token: RS256, issuer cấu hình, audience **`automation-bridge`**, `sub/iat/exp` bắt buộc,
TTL tối đa 300 giây, `scope` là chuỗi cách nhau bằng space, `workflows` là array workflow ID.
`AUTOMATION_MACHINE_SUBJECTS` allowlist subject → workflow IDs được intersect với claim đã ký.
Bridge chỉ đọc public key từ `AUTOMATION_MACHINE_PUBLIC_KEY_FILE`; không chứa private key/token
issuer, không nhận token phiên nhân viên cho internal API. Thiếu authority → 503; chữ ký/audience/TTL
sai → 401; thiếu scope/workflow → 403. N8N-03 bổ sung live IAM introspection bắt buộc,
`kind=machine`, `jti`, `credentialVersion`; JWT tự ký theo fixture N8N-02 cũ không đủ để chạy runtime.

Checkpoint/result bắt buộc `{leaseToken,attempt,expectedVersion,step}`. Fencing kiểm status RUNNING,
owner từ JWT, token, attempt, version và DB server time; sai/hết lease → 409. Dùng version mới từ
response cho lời gọi tiếp. Không tự retry checkpoint khi phản hồi mất: đọc metadata/reclaim hợp lệ.
Chỉ response claim/checkpoint có leaseToken cho owner; không đưa response/log execution vào evidence public.

Checkpoint nhận optional `operation:{name,operationId?,resultRef?}`. **Lưu intent trước gọi command**:
Bridge tạo `operationKey=automation:<jobId>:<name>`, trả lại để dùng làm Idempotency-Key. Tên operation
ổn định theo bước nghiệp vụ, không theo execution/attempt; operationId đã ghi không được đổi.
Sau timeout phải lookup backend theo key/operationId trước resend. Backend command lookup/idempotency,
confirmation/ownership/version vẫn là trách nhiệm service đích và N8N-03, chưa có trong Bridge.

`attempt` tăng đơn điệu mỗi lần cấp lease để fence, kể cả resume/replay. `failureCount` mới là ngân sách
retry kỹ thuật: lease expiry hoặc RETRY tăng một; lần thứ 8 thành DEAD. Human wait/resume không tăng
failureCount. Backoff 2,4,8… tối đa 300 giây; `retryAfterSeconds` (0–86400) nâng thời gian chờ nếu lớn hơn.
RETRY chỉ nhận `NETWORK_ERROR`, `TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`; lỗi quyền/schema
phải DEAD hoặc chờ sửa có kiểm soát, không retry mù. n8n smoke tắt node retry, timeout HTTP 10 giây.

WAITING yêu cầu `waitFor:{type,entityId}` và `deadlineAt` UTC ISO. Cùng transaction với step/result,
Bridge tìm inbox DONE theo type + entityId + correlationId, loại trigger và event đã dùng cho job này.
Event đã đến trước WAITING sẽ wake ngay; event đến sau cũng được ingress wake; deadline do server
wake trong maintenance/claim. WakeReason EVENT/DEADLINE và wakeEventId giúp workflow đọc lại nguồn.
Một event chỉ được dùng một lần/job; nếu cùng lúc có event và deadline thì ưu tiên event để đọc lại nguồn.
Không suy ra đã duyệt/đã thanh toán chỉ vì wake; backend đích phải kiểm lại trạng thái/quyền hiện hành.

Replay giữ jobId, eventId, workflowVersion, checkpoint và toàn bộ operation keys/receipts; reset
failureCount, tăng replayCount, attempt cũ còn nguyên tới claim tiếp. Không cho sửa input/context/quyền
trong replay body. CAS chặn replay kép. Audit cùng transaction ghi actor IAM, reason, attempt,
version và correlationId. Claim/checkpoint/wake/retry/DONE/DEAD cũng có audit; DEAD chỉ một record
cho mỗi lần kết thúc. Chưa gửi email/Notification alert (ngoài phạm vi N8N-02).

## Recovery, replay và backup

1. Khi Bridge chết, dừng worker có lease cũ. Restart process với cùng DB/config; maintenance chuyển
   lease hết hạn sang RETRY/DEAD và wake deadline. Lease còn hạn giữ nguyên tới expiry, không cướp job.
2. Worker claim đúng **version đã ghim**, đọc checkpoint/operationRefs, kiểm source/lookup receipt rồi
   mới gọi bước tiếp. Không đổi workflowVersion/job ID bằng SQL để ép workflow mới chạy job cũ.
3. Với DEAD, điều tra errorCode, audit và source operations. Center director đăng nhập IAM còn hiệu lực,
   lấy metadata qua principal nội bộ có `automation:read`, rồi POST replay kèm current expectedVersion
   và lý do đã che PII. Dùng header `Authorization: Bearer <phiên IAM>`, không machine/admin token chung.
   401/403/409 phải giải quyết nguyên nhân, không sửa role/DB hoặc bỏ middleware cho qua.
4. Với broker DLQ, giữ delivery gốc và sửa producer/schema trước. Chưa có API redrive DLQ của Bridge;
   dùng quy trình vận hành RabbitMQ có quyền, bounded và giữ event ID, không publish JSON sửa actor.
   Retry delivery hợp lệ vẫn dedup ở inbox/job. Không nhầm DLQ message với job DEAD/replay.

Backup trước migration và hằng ngày bằng `pg_dump -Fc` vào file, cùng registry workflow/config;
giữ encryption key n8n/credential backup riêng theo [runbook N8N-01](../../workflows/n8n/README.md).
Không dùng redirect binary qua PowerShell cũ. Restore vào DB/instance mới biệt lập, chưa bật consumer/
claim, đối chiếu jobs/checkpoints/audit/operations nguồn rồi mới cho nhận việc. Không replay toàn bộ
job DONE hoặc xóa inbox/wakeup để chạy lại. Diễn tập full restore/RPO/RTO thuộc OPS-1/N8N-08, chưa đạt.

Giới hạn hiện tại: scheduler dùng một advisory lock cho transaction DB ngắn để bảo vệ capacity/wakeup
trên mọi replica; không gọi HTTP nghiệp vụ trong lock. Đã kiểm correctness ở tải smoke, chưa benchmark
tải lớn. Máy cấp token IAM, introspection/revocation cho machine, job-bound command authorization và
tra quyền người khởi tạo đã có cho lát cắt đọc N8N-03 bên dưới. Confirmation/approval và quyền command
nghiệp vụ vẫn phụ thuộc service sở hữu. Không bật chúng trước acceptance; test authority không phải
phương án vận hành.

## N8N-03 machine authority and delegation

Contracts: [machine.ts](../../packages/contracts/src/machine.ts). IAM owns the private
RS256 signing key, hashed machine credentials, active/credential-version state and
immutable delegation records. Bridge owns job/operation/lease state and only the
IAM **public key**. n8n gets neither the signing key nor a human/admin session.
There is no test-authority runtime fallback and no default principal/credential.

### Internal IAM endpoints (direct managed network only)

| Endpoint | Authentication / input / result |
| --- | --- |
| `POST /internal/iam/principals` | Live IAM `center_director`; `{id,grants:[{audience,scopes}],workflows}`; returns `clientSecret` once, stores scrypt hash, audits provisioning |
| `POST /internal/iam/principals/:id/rotate` | Live director + `{}`; new secret once, increments `credentialVersion`; all old tokens/secret rejected |
| `POST /internal/iam/principals/:id/revoke` | Live director + `{}`; deactivates principal, increments version; revoked principal cannot rotate/reactivate |
| `POST /internal/iam/machine/token` | Strict `{clientId,clientSecret,audience,scopes,workflows,ttlSeconds?}`; scopes/workflows must be subsets of DB grants; TTL 1–300s |
| `POST /internal/iam/machine/introspect` | Bearer machine token + `{audience,scope}`; signature/issuer/TTL/version/current grants/active state |
| `POST /internal/iam/delegations` | Live initiating human session; `{eventId,workflowId,workflowVersion,entity,inputRef,branchId,operations}`; returns opaque UUID `contextRef` |
| `POST /internal/iam/delegations/:id/revoke` | Live context owner or director + `{}`; audited revocation |
| `POST /internal/iam/commands/token` | Bearer machine token, `automation:authorize`; `{jobId,leaseToken,attempt,operation}`; IAM fetches trusted Bridge proof, verifies context and current grants; 30s token |
| `POST /internal/iam/commands/introspect` | Bearer command token + `{audience,scope}`; live principal/delegation/session/rights and a fresh Bridge lease proof; verified human principal with restricted branch |

Allowed audiences: `automation-bridge`, `catalog`, `class-schedule`. Machine scopes:
`automation:claim/checkpoint/result/read/authorize` (each uses the full `automation:`
prefix), `catalog:read`, `classes:read`. A raw machine token can only target Bridge;
domain audiences require a job-bound command token. Requested unknown scope,
audience, actor, role or extra context fields are rejected, never used to escalate.

Delegation creation derives actor/session/role from live IAM authentication and
checks the requested branch against current account access. Its authority is
read-only: `catalog.read` or `classes.read`. It grants no ownership of a business
entity and no confirmation/approval. IAM binds `contextRef` to the exact backend
eventId, workflow/version, entity (including version when present) and inputRef;
an event with a different reference cannot borrow it. Do not give n8n a human token
to create contexts. A trusted backend producer must create the context with the
initiating session, then persist/publish the matching reference-only event through
its own ingress/outbox. The harness uses a labelled synthetic backend producer.
Channel/Conversation producer integration remains N8N-04; no guest/service-actor
policy has been silently introduced.

### Calling a read operation

1. Acquire a short-lived machine token from IAM with only the workflow grants needed.
   Keep the machine secret in a protected credential store, not workflow JSON.
   Refresh through IAM before expiry; the manual harness provisions a fresh token
   before execution. Automatic credential renewal for business workflows is not
   implemented by these manual smokes.
2. Claim as N8N-02; checkpoint intent `operation:{name:"catalog.read"}` (or
   `classes.read`). The stable operation key remains `automation:<jobId>:<name>`.
3. `POST /internal/automation/jobs/:id/authorize` with machine Bearer token and
   `{leaseToken,attempt,operation}`. This proxies to IAM; n8n cannot replace actor,
   branch, scope, audience or context in this request. IAM asks
   `POST /internal/automation/jobs/:id/authorization-check` for current proof.
   The check requires `automation:authorize`, matching workflow, owner, live lease,
   attempt and an existing operation intent. It does not renew a lease or alter a job.
4. Call the allowlisted domain read directly with the returned Bearer token. Every
   call verifies IAM state and rechecks the Bridge lease; a signed but stale token
   cannot be consumed after lease expiry, reclaim, DONE/DEAD/WAITING/RETRY.
   IAM's internal probe is signed as that same machine with only `automation:authorize`
   and the bound workflow; it does not widen machine grants.
5. Checkpoint/result with the current N8N-02 version/fence. Authorization does not
   change `version`; checkpoints still do. Tokens contain opaque references and
   lease proof: treat them and full n8n execution output as credentials.

Catalog allows `GET /api/v1/courses`, `/packages`, `/packages/:id/quote`, limited
to active offers available in the context branch (empty offer branch list means
global). Its SQL applies that verified branch even when the query omits branchId;
a conflicting branch/status is denied. Class allows class list/detail and applies
current branch and teacher ownership from its own DB. A director delegation also
stays in the one context branch. Domain tokens cannot write, read catalog history,
inspect holds/teacher-time/operations, or call the other service's audience.

For Class automation, query Catalog and Class separately and join course/package
IDs. `sellable=true` remains closed for delegated Class reads: the existing human
query forwards its token to Catalog, so it needs a reviewed scoped service-to-service
exchange before automation can use it. Ordinary Class reads are availability
snapshots, not permission to create a hold or a guarantee the offer is sellable.

Enrollment/Payment/Conversation confirmation, approval, versioned business command
and idempotency/lookup contracts do not exist yet. Their operation names are absent
from the enum/allowlist; submitted `approvalRef`/`confirmationRef` cannot unlock
anything. No placeholder business endpoint or generic command tunnel is provided.

### Revocation and failure behavior

No authorization cache: every Bridge call introspects IAM; every domain call checks
IAM plus Bridge. Revoke/rotate commits before returning; a subsequent authorization
or domain call is denied without waiting for JWT expiry. Logout, refresh rotation,
IAM access/status changes, context revoke/expiry, disabled accounts and removed
branch/read roles all invalidate delegation. Delegations also expire after 8h and
never outlive their originating session. Refresh revokes the original session;
jobs depending on it must fail closed and be reinitiated by a verified backend,
not have context/session refs edited by replay or SQL.

Machine/command JWT verification permits one second of issuance-clock jitter.
Both IAM and Bridge separately reject `exp <= now`, so this tolerance does not
extend expiry. Signature, audience, scope, workflow, credential version and live
permission/lease checks remain mandatory. The local DB integration suite checks
near-future issuance, larger future issuance and exact expiry for both token kinds.

Already-admitted reads are not cancelled; there is a normal gap between the live
check and the DB read. This read-only acceptance is not a transactional authorization
guarantee for money/seat commands. Those must validate business version, confirmation,
ownership and authorization at their actual commit boundary before being enabled.
No timed cache or 300s revocation window is claimed. Local post-revocation request
timings are recorded in the evidence; they are observations, not a production SLA.
IAM/Bridge unreachable → 503 (no cached allow); bad token → 401; rights/context →
403; stale lease/attempt → 409. Never retry authorization denials as technical work.

### Provision, rotate, rerun

Back up IAM/Bridge before migration. Use fresh protected environment files or
process environment; do not overwrite existing `.env`. Migrate IAM with the existing
`src/migrate.ts` entry point (`0002_machine` is repeatable). Configure IAM
`IAM_MACHINE_PRIVATE_KEY_FILE`, `IAM_MACHINE_ISSUER`, `AUTOMATION_BRIDGE_URL`;
configure Bridge `AUTOMATION_MACHINE_PUBLIC_KEY_FILE`, matching
`AUTOMATION_MACHINE_ISSUER`, `IDENTITY_URL` and explicit subject→workflow allowlist.
Catalog/Class use their existing `IDENTITY_URL`; no private key or new shared admin
token is installed there. Keep these URLs on the trusted internal network.

An individual director logs in to IAM, provisions each machine through the internal
API, and transfers the returned secret to its credential store. Grant only reviewed
workflow/audience/scope combinations. Rotate using the internal rotate endpoint,
install the returned secret, then acquire new short-lived tokens. Revocation is
final for that principal: provision a new identity rather than reactivate a stolen
credential. Rotating the IAM signing key is a coordinated cutover: update IAM's
private key and Bridge's public key, restart those configured services, and obtain
new tokens; there is no multi-key overlap/JWKS rollover in this slice. Preserve
old key backups securely for the backup policy, never as a fallback verifier.

`npm run test:automation` creates a fresh Docker project, IAM/Bridge/Catalog/Class
DBs and roles, n8n DB, broker and IAM key. It migrates each DB twice, runs N8N-02
regression and N8N-03 acceptance, then imports and executes both manual HTTP
smokes with IAM-issued credentials. It never reads personal `.env`, changes the
N8N-01 project or deletes volumes. See `workflows/n8n/iam-read-manifest.json` and
`iam-read-evidence.json`. Full logs/executions/secrets stay under ignored
`.local/automation/<project>/`; share only the sanitized receipt. Containers stop
with project-specific `down`, volumes remain. Workflow defaults/bindings remain
empty; no WF-01–12 business workflow is activated.
