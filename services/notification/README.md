# Notification

Notification persists course intents, attempted deliveries, learner inbox messages and immutable receipts. Use the PostgreSQL `SYNTHETIC_LOCAL_MAILBOX` for local testing and keep its database and evidence private. Course notices appear in the learner's Portal inbox.

Run migrations with `DATABASE_URL` pointing to the Notification database. Start with `RABBITMQ_URL`, `AUTH_SECRET`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `IDENTITY_URL`, `ENROLLMENT_URL`, `CLASS_URL`, `CRM_URL`, `NOTIFICATION_ADAPTER=synthetic`, `NOTIFICATION_OWNER_ID`, `IAM_NOTIFICATION_SECRET`, and `SOURCE_CLIENT_ID` / `SOURCE_CLIENT_SECRET`. Use a separate UUID machine principal with `notification` audience, `automation:source` scope and `WF-10` grant. The notification service and IAM share a fresh secret solely for OTP delivery. Set `NOTIFICATION_URL` for IAM, Enrollment, Class and CRM so those services can retrieve the fenced intent authority.

The broker queue `spacex.notification.course.v1` receives confirmed Enrollment, effective entitlement changes and versioned Class schedule changes. Payment matching does not create a message. A transfer or resume moves the learner's notification membership to the new class after the entitlement becomes effective. WF10 calls `/internal/notification/deadlines` to enqueue due intents through the durable outbox. The workflow authorizes `notification.deliver` for the bound ID, performs lookup, then sends pending work. Send checks Enrollment and the exact committed Class seat, source version, verified learner recipient and current CRM `COURSE_NOTICES` consent. Reminders are due 24 hours before each future session and expire at its server-side start. Schedule changes create new intent versions. A sent message and its receipt remain stored.

Staff can read their branch's delivery status via `GET /api/v1/notifications` and create a `REMINDER` using `POST` on that route. A learner sees their own Portal messages via `GET`. Payloads use Enrollment and Class references. Destinations come from IAM. OTP is delivered through a dedicated IAM-only endpoint and receives a mailbox receipt. OTP bodies are absent from learner Portal responses and automation jobs.

For a transport failure, use `GET /internal/notification/intents/:id` with the live job's `notification.deliver` command before retry. A persisted adapter receipt resolves `ADAPTER_RESPONSE_LOST` without sending again. `ADAPTER_UNCERTAIN` stays `UNKNOWN` and has an owner. Review it by reconciling the local mailbox receipt in the private runtime. A receipt must exist before reporting delivery. Without proof, record it as unresolved. Synthetic fault configuration is available only under `NODE_ENV=test` with a live center director session and cannot target OTP.

## OTP gửi đến hộp thư thật

Giữ `NOTIFICATION_ADAPTER=synthetic` cho thông báo khóa học trong Portal. Đặt các biến sau riêng trong cấu hình của Notification để gửi OTP đăng ký và đăng nhập qua Resend.

```dotenv
NOTIFICATION_OTP_ADAPTER=resend
OTP_EMAIL_FROM="Space Agent Hub <xac-minh@your-verified-domain.example>"
RESEND_API_KEY=<khóa chỉ có quyền gửi từ tên miền đã xác minh>
```

Xác minh tên miền người gửi và DNS (SPF/DKIM) trong Resend, rồi cấp HTTPS outbound tới `api.resend.com`. Giữ `IAM_NOTIFICATION_SECRET` riêng giữa Identity và Notification. Với adapter Resend, Notification lưu mã biên nhận của nhà cung cấp cùng intent. Mã OTP và nội dung email đi trong yêu cầu gửi qua HTTPS. Kiểm tra thư thực tế đến hộp thư khi nghiệm thu triển khai.

Ở local, đặt `NOTIFICATION_OTP_ADAPTER=synthetic` hoặc để mặc định. Đọc mã qua cơ sở dữ liệu Notification của môi trường thử nghiệm. WF‑10 giữ thông báo xác nhận của đơn tự đăng ký ở trạng thái chờ khi IAM chưa có liên kết đã xác minh. Các lần quét hạn sau kiểm tra liên kết và đưa lại cùng intent vào hàng đợi.

[Xác minh tên miền Resend](https://resend.com/docs/dashboard/domains/introduction) · [Idempotency của email](https://resend.com/changelog/idempotency-keys)
