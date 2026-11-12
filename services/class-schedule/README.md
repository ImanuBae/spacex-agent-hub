# Class & Schedule

Vòng 2 bổ sung giờ rảnh/nghỉ, vòng đời lớp, outbox/inbox và worker RabbitMQ.
Migration và giới hạn nghiệp vụ: [bàn giao vòng 2](../../docs/ban-giao-vong-2-2026-11-03.md).

PostgreSQL riêng `class_schedule`, service port 4004. Xem
[contract, quyền, kiểm chứng và runbook](../../docs/ban-giao-lop-giu-cho.md).

```sh
npm run build
npm run db:migrate --workspace=@spacex/class-schedule
npm run db:seed --workspace=@spacex/class-schedule
npm run start --workspace=@spacex/class-schedule
```

Seed chỉ chạy khi `APP_ENV=demo`, không ghi đè fixture đã có. File `.env.example`
liệt kê cấu hình; không chép đè `.env` cá nhân. Worker chạy trong tiến trình,
quét ngay khi startup và mỗi 5 giây, dùng PostgreSQL để phục hồi sau restart.

```powershell
$env:CLASS_TEST_DATABASE_URL='postgresql://postgres:space_agent_local_dev@127.0.0.1:55432/postgres'
npm run test:class:db
```

Suite cần DB test có quyền tạo database/extension, tự tạo bốn database tên ngẫu
nhiên và xóa đúng các database đó sau khi chạy. Thiếu URL là lỗi; không skip.
API chạy bằng user service riêng, không dùng user quản trị của suite test.

## N8N-03 delegated reads

Machine tokens may read `/api/v1/classes` and `/api/v1/classes/:id` with
audience `class-schedule`, scope `classes:read`, a live IAM delegation and
a current Bridge operation/lease/attempt. Class checks branch and teacher
ownership in its own DB; even center-director delegations stay within the
context branch. Machine writes, other routes and `sellable=true` fail closed.
For the read slice, query active Catalog offers/quotes separately and match
course/package IDs with Class results. Class `sellable=true` calls Catalog
internally with the caller token; scoped cross-service token exchange remains
a dependency before enabling that query for automation. Existing human API
behavior is unchanged. [Contract/runbook](../automation-bridge/README.md#n8n-03-machine-authority-and-delegation).

## N8N-03 confirmed and approved cancellation

The local command slice is `classes.cancel`, audience `class-schedule`, scope
`classes:cancel`. It reuses the existing cancellation rules. A class with committed
seats remains blocked until the Enrollment process handles its obligations.

1. A director confirms through `POST /api/v1/classes/:id/cancellation-requests`
   with `{version,status:"CANCELLED",reason}` and a current human IAM session.
   Class creates the request ID, actor/session/branch binding, five-minute expiry,
   immutable payload and IAM delegation; the caller cannot supply these fields.
2. A separate current branch director calls
   `POST /api/v1/class-cancellation-requests/:id/approve` with `{}`. The source
   transaction saves the approver and enqueues `class.cancellation_approved`.
   Self-approval, repeat approval and another branch fail closed.
3. An explicitly configured Bridge binding maps that event to `WF-CLASS-CANCEL`
   v1. The worker checkpoints `classes.cancel`, obtains the target token, then
   reads `GET /internal/classes/cancellations/:id` for the source payload.
4. `POST /internal/classes/cancellations/:id/execute` accepts only that payload.
   Class locks the class/request, checks current IAM/Bridge and approver session,
   then consumes the request and commits business state/audit/outbox/result together.
   The request ID is the idempotency key; another job cannot consume it again.
5. The confirming or approving human can inspect
   `GET /api/v1/class-cancellation-requests/:id`, including the durable result/job ID,
   or revoke an unused request with `POST .../:id/revoke` and `{}`.

After an uncertain response, inspect the source lookup. A consumed result is the
outcome; do not re-create the request or replay a business mutation blindly. An
expired/revoked/stale approval needs a new human confirmation and separate approval.
The local transaction covers only Class's DB. Live checks do not promise a
distributed transaction or cancellation of already admitted work after revocation.

Migration `0005_automation` adds a table only. Test it on a new/copy DB, preserve the
previous runtime and volumes, and keep binding/polling disabled outside the test.

```powershell
node scripts/build-iam-command-workflow.mjs
node scripts/test-n8n03-command.mjs
```

The harness generates fresh credentials and uses separate application databases;
it imports an inactive [command smoke](../../workflows/n8n/iam-command-smoke.json)
and retains private traces and test volumes. See [acceptance](../../docs/acceptance-n8n-03-04.md).
