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

## N8N-05 / WF-04 local

Migration `0002_automation` bổ sung mapping WEB_CHAT có nguồn Conversation,
request bất biến và merge plan. Đặt `CONVERSATION_URL`, `ENROLLMENT_URL` trỏ
đúng service biệt lập. Không đọc DB của service khác.

- `POST /api/v1/crm/automation-requests`, UUID `Idempotency-Key`: action
  `resolve-channel`, `lead.create`, `lead.claim`, `lead.update`, `merge.execute`.
  Actor/session được IAM xác minh. `resolve-channel` lấy branch/account/session
  từ Conversation, không nhận các giá trị này từ client. Backend lưu delegation
  và phát `crm.requested` qua outbox để WF-04 xử lý.
- `GET /api/v1/crm/automation-requests/:id` đọc kết quả bền. `PARTIAL` có
  `contactId`, `identityRef` và `CONSENT_REQUIRED`: giữ hồ sơ vừa tạo, không tạo
  lead, không tự bật marketing. Consent mới phải qua API có phiên được kiểm.
- n8n dùng `crm.execute`, audience `crm`, scope `crm:write` và exact request
  binding để GET `/internal/crm/requests/:id`, rồi POST `.../:id/execute` với
  body `{}`. Không nhận payload/actor do workflow sửa. Lookup trước retry;
  cùng request/job trả cùng result. Backend kiểm lại lease/session, nguồn
  Conversation, branch, consent và ownership dưới khóa trước commit.
- `POST /api/v1/crm/merge-plans`: hai hồ sơ cùng loại/branch, version hiện hành,
  lựa chọn SOURCE/TARGET rõ cho trường khác nhau (notes hỗ trợ BOTH). Report
  lưu dữ liệu/version liên quan, hash và collision. `.../:id/approve` cần hash
  chính xác và evidence, do quản lý độc lập. Kế hoạch thiếu resolution hoặc
  đụng lead/relationship không được duyệt. `merge.execute` kiểm lại toàn report
  và phiên branch director phê duyệt lúc ghi; hai merge xung đột chỉ một thắng.
  Mapping, lead, relationship chuyển sang hồ sơ đích; hồ sơ nguồn giữ lineage
  `mergedInto` và lịch sử, không xóa để giả transaction.
- `GET /api/v1/crm/enrollment-authority?contactId=...&learnerId=...&payerId=...`
  kiểm ba loại hồ sơ riêng, ADMISSIONS hiện hành và cả hai quan hệ VERIFIED.
  Internal `/internal/crm/enrollment-authority?enrollmentId=...` lấy các refs
  từ snapshot Enrollment với command token ràng buộc đúng enrollment, không
  tin refs do n8n tự khai.

Policy DEMO `CRM-MERGE-v1`, ngày **14/11/2026**, chỉ dữ liệu tổng hợp: merge có
thể thay ngữ cảnh người nhận consent, nên target phải được ghi consent mới;
merge tự ghi REVOKED cho từng purpose, không kế thừa grant từ nguồn. Kế hoạch
merge hết hạn sau 24 giờ; không sửa profile/phiên bản để tái dùng approval cũ.
Policy này không là chữ ký của khách thật hoặc phê duyệt customer production.

DB tests mở rộng chạy IAM/Bridge/Conversation/CRM và kiểm cả state/audit/outbox.
Fixture event được lấy từ CRM outbox rồi ingest qua Bridge backend; bộ kiểm
n8n/broker tích hợp của N8N-05 là evidence riêng. Có thể đặt
`CRM_TEST_EVIDENCE_FILE` vào thư mục artifact private đã siết ACL để giữ
case/request/job/event/correlation/operation refs và snapshot DB đã che trước
khi suite dọn DB test. Không lưu token hoặc dữ liệu liên hệ vào receipt này.
Import CRM-5, Facebook/Zalo
live và xóa tự động xuyên service vẫn ngoài phạm vi này.
