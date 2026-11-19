# Identity & Access

Migration `0005_learner` adds learner accounts and OTP challenges for WF10. A
director provisions `/api/v1/learner-identities` after IAM checks an active CRM
learner, branch and matching email. `POST /api/v1/auth/otp/request` and
`POST /api/v1/auth/otp/verify` use purpose `STUDENT_LOGIN` and a browser challenge
binding. IAM stores a keyed code hash and uses server time for the five minute
expiry. A challenge allows five incorrect attempts and is consumed in the same
transaction that creates the learner session. IAM permits three challenges per
account over the prior 15 minutes. `/api/v1/auth/learner` resolves the current
session to the learner and branch for downstream ownership checks.

Set `CRM_URL`, `NOTIFICATION_URL` and a fresh `IAM_NOTIFICATION_SECRET` shared
only with Notification. OTP text goes to the private synthetic mailbox. IAM
returns challenge and delivery references. WF08–10 command grants are scoped to
version 1 of the relevant workflow and its stored resource. WF10 accepts only a
Notification source delegation. The delivery command resolves its recipient
through the bound intent and a current learner mapping. See [Notification](../notification/README.md).

N8N-05 current: migration `0004_service` adds source-owned, immutable service
delegations for synthetic Enrollment deadlines and verified Payment events.
Domain audiences/scopes are `crm`/`crm:write`, `enrollment`/`enrollment:write`,
`payment`/`payment:write`, `class-schedule`/`classes:enroll`; only job-bound command
tokens can use them. Source credentials have only `automation:source`, never the
n8n worker's write grants. Every command still rechecks live IAM and Bridge.
Backend APIs bind their stored confirmation/cancellation/approval and resource;
the workflow cannot declare actor, branch, consent or paid status. Source rotation
invalidates existing source contexts; human session rotation/revocation remains
fail-closed. [Current acceptance](../../docs/acceptance-n8n-05.md).

N8N-04 adds the limited Channel-source `conversation` / `channel:context` policy.
Its context is verified against the configured Conversation backend and rechecked
on every guest domain authorization/introspection; no employee session is fabricated.
Source credential rotation/revocation fences existing source delegations. See the
[Conversation runbook](../conversation/README.md) and [N8N-04 actual status](../../docs/ban-giao-n8n-04.md).

N8N-03 adds internal IAM machine-principal provisioning, rotation/revocation,
RS256 issuance and live delegation/command introspection. Existing human APIs
keep their session contract. Run migration `0002_machine` before enabling it;
only IAM receives `IAM_MACHINE_PRIVATE_KEY_FILE` (outside the repository).
`IAM_MACHINE_ISSUER` must match Bridge; `AUTOMATION_BRIDGE_URL` is the fixed,
trusted internal lease authority. Missing signing configuration fails closed.
See [machine contract and runbook](../automation-bridge/README.md#n8n-03-machine-authority-and-delegation)
and [actual evidence/dependencies](../../docs/ban-giao-n8n-03.md).

The `classes.cancel` command additionally checks the confirming actor's current
session/branch and exposes `/internal/iam/commands/approval-session` only to a
scoped Class command token. Class supplies the approver account/session from its
own locked record; a worker's self-declared approval has no authority. The issuer
uses one timestamp for token iat/exp so a second boundary cannot lengthen its TTL.
Confirmation, approval, consumption and business invariants belong to Class, not
IAM. See [the source-owned command protocol](../class-schedule/README.md#n8n-03-confirmed-and-approved-cancellation).

Workspace `@spacex/identity`, local :4002, database `identity_access`.
Contract, cấu hình, migration/seed và kiểm chứng:
[hướng dẫn đợt 1](../../docs/huong-dan-dot-1.md).

Copy `.env.example` nếu chưa có, điền DATABASE_URL, AUTH_SECRET và admin seed;
từ root chạy `npm run db:migrate --workspace=@spacex/identity`,
`npm run db:seed --workspace=@spacex/identity`, build rồi start workspace.
Seed không ghi đè mật khẩu/account đã tồn tại. Không dùng credential test cho vận hành.

Login/refresh/logout, phiên, role/branch và trạng thái account thuộc IAM.
Org chỉ gọi API IAM với quyền giám đốc hợp lệ, không ghi DB IAM.
`npm run test:db --workspace=@spacex/identity` bắt buộc STAGE1_TEST_DATABASE_URL;
suite dùng ba DB test ngẫu nhiên riêng, không chạy với server production.
