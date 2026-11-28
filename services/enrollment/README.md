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
## N8N06 adjustments and learner ownership

Migration `0002_adjustments.sql` adds effective entitlement, adjustment history, operation results, schedule choices, and waitlist invitations. Original confirmations, Enrollment rows and pricing snapshots remain the registration record. A transfer commits a distinct Class seat, records the effective entitlement, and only then authorizes release of the source seat. Suspension records the unused session count and a server expiry. It never reserves a new seat until a resume operation runs.

Staff create `/api/v1/adjustments` with a UUID idempotency key, the expected effective entitlement version, and a reason. A director distinct from the requester approves the exact version. A mapped learner makes their own choice at `/api/v1/adjustments/:id/choice`. Learner reads use `/api/v1/student/enrollments` and `/api/v1/student/adjustments`. The IAM mapping and live session, rather than a claimed learner ID, authorize those reads. A class cancellation can link the exact affected adjustment using `classChangeId`.

Use a UUID-named service principal with the `enrollment` audience, `automation:source` scope and `WF-09` allowance. Existing deployments that use `WF-07` retain their grant. `NOTIFICATION_URL` enables the bound WF10 authoritative entitlement projection. All mutating workflow calls require current IAM and Bridge bindings for the same adjustment and operation. A Class-approved target with stale quote, consent or class impact fails before commitment. Once a target commit exists, recovery reads it and continues forward.

Waitlist eligibility requires a paid active or unexpired suspended source entitlement and verified current consent. An independent director offers a 24-hour invitation to the earliest eligible waiting entry while Class reports space. Accepting the invitation records learner choice and triggers normal target seat acquisition, which may still lose a capacity race. `POST /internal/enrollment/adjustment-deadlines` performs bounded expiry processing for WF09. Server-time checks also deny expired decisions when orchestration is offline.

## Học viên tự đăng ký

Chạy migration Enrollment `0004` và Identity `0006`. Cấp `WF-05` cho principal `automation:source` của Enrollment, cùng các quyền workflow đang dùng. Cấu hình ba khóa độc lập từ 32 byte trở lên ở Enrollment và ở đúng dịch vụ nhận tương ứng.

| Biến | Dịch vụ dùng chung với Enrollment |
| --- | --- |
| `ENROLLMENT_CRM_SECRET` | CRM |
| `ENROLLMENT_IAM_SECRET` | Identity |
| `ENROLLMENT_PAYMENT_SECRET` | Payment |

Identity cần `ENROLLMENT_URL`, `NOTIFICATION_URL` và khóa OTP dùng chung với Notification. Catalog và Class cần gói đang bán, lớp mở đúng gói và chi nhánh, cùng lịch hợp lệ. Enrollment và Payment phải cùng dùng `PAYMENT_ADAPTER=sepay` khi nhận chuyển khoản MB. RabbitMQ và các workflow WF‑05, WF‑06, WF‑07, WF‑10 cần hoạt động. Cấu hình webhook và ngân hàng theo [Payment](../payment/README.md) và hộp thư theo [Notification](../notification/README.md#otp-gửi-đến-hộp-thư-thật).

Trình duyệt lưu một mã ngẫu nhiên trong phiên tab để tiếp tục cùng đơn sau khi tải lại. Chỉ OTP của hộp thư đăng ký mới tạo hoặc gắn đăng ký vào tài khoản học viên. Một tài khoản học viên có thể sở hữu nhiều đăng ký đã xác minh. Email dành cho tài khoản nhân viên hoặc tài khoản đã khóa bị từ chối trước khi tạo yêu cầu thanh toán.

Chạy `node scripts/test-n8n06.mjs --case=SELF-REGISTRATION` để kiểm trên trình duyệt với cơ sở dữ liệu, n8n, webhook SePay ký bằng khóa thử và mailbox riêng của lần chạy. Dùng `--case=SELF-REGISTRATION-EDGES` để chạy riêng ca hết hạn, đối soát và Portal nhân viên. Bài kiểm tra xác minh tham số VietQR MB từ Payment và thay ảnh từ máy chủ bên ngoài bằng ảnh thử cho tài khoản giả.
