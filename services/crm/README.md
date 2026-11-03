# CRM

Hồ sơ người liên hệ/học viên/người trả tiền được lưu riêng theo chi nhánh;
lead có nguồn, giai đoạn và người phụ trách. Portal dùng BFF tại
`/dashboard/leads`, không đọc lead từ localStorage.

## Chạy local

Sao chép `.env.example` nếu chưa có `.env`, đặt DATABASE_URL của **CRM riêng**,
AUTH_SECRET/issuer/audience cùng IAM và các URL IAM/Org/Catalog đúng môi trường.
Không dùng DB của service khác. Gateway đọc CRM_URL (mặc định cổng 4005).

```powershell
npm run build
npm run db:migrate --workspace=@spacex/crm
npm run start --workspace=@spacex/crm
```

Migration có transaction/version/khóa và chạy lại được. `GET /ready` kiểm tra
schema CRM. Restart Gateway/Portal sau khi cập nhật cấu hình hoặc build.
Không có RabbitMQ thì event vẫn ở outbox PENDING; thành công HTTP không có
nghĩa consumer khác đã xử lý. Có RABBITMQ_URL thì worker ghi receipt vận hành,
chưa phải tích hợp Conversation/Enrollment/Notification.

## API và quy tắc

Các resource dưới `/api/v1/crm`: `people`, `leads`, `relationships`,
`erasure-requests`; xem schema request trong `packages/contracts/src/crm.ts`.
Chỉ center_director/branch_director/admissions được truy cập trong scope được cấp.
Danh sách che thông tin liên hệ; đọc chi tiết được audit, form sửa đọc lại
bản ghi đầy đủ trước khi gửi version. Tạo hồ sơ/lead/consent/quan hệ/yêu cầu xóa
dùng UUID Idempotency-Key; cập nhật và nhận lead dùng optimistic version.

- Không tự gộp khách trùng thông tin. Các loại hồ sơ được liên kết qua quan hệ
  do quản lý xác minh, không tự coi người liên hệ là người học/người trả tiền.
- Tạo/tiếp tục lead cần consent ADMISSIONS hiện hành. Marketing là mục đích
  riêng, không tự bật. Lead không có trạng thái xác nhận đăng ký học.
- Nhân viên chỉ sửa lead do mình phụ trách; nhận lead chưa phân công là nguyên tử.
  Quản lý có thể phân công người hoạt động đúng vai trò/chi nhánh.
- Yêu cầu xóa cần quản lý xác minh, rồi mới ẩn danh CRM. Trạng thái còn
  PROCESSING cho đến khi từng nơi Conversation/Enrollment/Payment/Reporting/Backups
  có kết quả và mã bằng chứng. Các task này là ghi nhận xử lý có kiểm soát,
  chưa tự xóa dữ liệu ở service ngoài CRM.

## Kiểm tra

Đặt CRM_TEST_DATABASE_URL trỏ PostgreSQL kiểm thử có quyền tạo DB. Hai suite
tạo và dọn DB UUID riêng, không tái sử dụng dữ liệu demo. Browser cần build
production và Chrome/Edge; công cụ CDP lấy từ TASTE_SKILL_ROOT hoặc skill local.

```powershell
npm run test:crm:db
npm run test:crm:browser
# Tùy chọn chạy inspector giao diện trong suite browser:
$env:CRM_INSPECT='1'
npm run test:crm:browser
```

Chưa bao gồm định danh kênh chat thật, gộp hồ sơ CRM-2, import CRM-5,
Enrollment/Payment hay customer xác nhận chính sách. Không coi phạm vi này
là hoàn thành toàn bộ đợt 3.
