# Bàn giao N8N-06

**ACCEPT_LOCAL** ngày 20/11/2026 cho WF08–10 và Portal. [Matrix](acceptance-n8n-06.md), [index bằng chứng](../workflows/n8n/adjustment-evidence.json).

## Policy DEMO-N8N06-2026-11-16-v1

Ngày hiệu lực local: 16/11/2026 (Asia/Saigon). Người quyết định/reviewer: **Codex agent**, được người dùng ủy quyền. Lý do: hoàn thiện C02–C07/C10/C12 trên dữ liệu tổng hợp, bảo toàn điều khoản/snapshot N8N05. Không phải chữ ký con người hoặc chính sách giao dịch thật.

- Giờ AVAILABLE giữ hiệu lực theo semantics cũ. Nghỉ/đổi lịch/hoãn/hủy/học bù cần lý do, impact version và duyệt độc lập đúng chi nhánh. Thay đổi ảnh hưởng quyền lợi cần lựa chọn của learner gắn snapshot mới; không suy lựa chọn từ workflow body.
- Sĩ số tối thiểu được cấu hình trong kế hoạch mới, quyết định trước buổi đầu; thiếu sĩ số yêu cầu quyết định hoãn/hủy/học bù có duyệt, không tự thu thêm hoặc tự bỏ quyền lợi. Deadline dùng server time dù n8n tắt.
- Hoàn tối đa tiền đã thu còn khả dụng sau trừ completed/reserved/UNKNOWN. Hoàn dư chỉ phần dư, không tước tuition entitlement. Full cancellation có hiệu lực trước release; hoàn là bước riêng. Kế toán lập/ghi execution, director độc lập duyệt và còn quyền lúc ghi. Adapter hoàn chỉ SYNTHETIC có receipt bền.
- Chuyển lớp cần quote/policy/deadline/lựa chọn khách; target seat reference riêng. Chênh lệch thu/hoàn có Payment proof. Chốt quyền mới trước release quyền cũ; failure trước commit chỉ nhả target; failure sau commit recovery theo plan.
- Bảo lưu phần quyền còn lại tối đa 90 ngày theo server time; resume cần target hợp lệ và hold/commit thực. Hết hạn không tự khôi phục. Không hứa chỗ chưa giữ.
- Waitlist cần consent/eligibility, mỗi learner/lớp một entry hoạt động, ưu tiên FIFO theo thời điểm server. Lời mời 24 giờ, có version/revoke/decline; nhận lời mời vẫn phải cạnh tranh atomic seat.
- Thông báo dùng Portal và adapter hộp thư local bền; recipient lấy từ backend. Confirmation chỉ sau confirmed/commit. Reminder kiểm schedule/version/consent tại send; tin đã gửi giữ receipt, đính chính là intent mới.
- OTP STUDENT_LOGIN: hạn 5 phút, tối đa 5 lần sai, tối đa 3 yêu cầu/15 phút; hash tại IAM, consume một lần, ràng identity/session/purpose. Chỉ proof identity; từng resource vẫn kiểm ownership.
- Invoice tổng hợp chỉ cho learner có quyền và payment đủ điều kiện, download có auth/audit; nhãn **MÔ PHỎNG — KHÔNG CÓ GIÁ TRỊ PHÁP LÝ**. Không email/OTP/PII trong workflow/public evidence.

## Bảo toàn và nguồn

Snapshot trước sửa: `.local/automation/n8n06-20261115T172538-036c38e6/`. N8N05 ACCEPT_LOCAL giữ lịch sử riêng. Preflight mới ghi tham số gọi runner và SHA‑256 của tài liệu áp dụng cho lượt chạy. Ca N8N‑06 dùng policy trong bàn giao này. Ca Portal/WF‑11 dùng [hồ sơ nghiệm thu](acceptance-portal-wf11.md). Receipt cũ lưu đường dẫn và hash của nguồn tại thời điểm chạy.

Sự cố Next tự load personal `.env.local` trong N8N05 vẫn là lịch sử có thật. Mọi build/start mới phải env allowlist và preload `scripts/no-personal-env.cjs` đến workers, có fixture tự kiểm.

Phiên 19/11/2026 có một lần chạy `next typegen` thiếu preload. Bản Next đã cài gọi `loadEnvConfig`, và metadata xác nhận `apps/admin-portal/.env.local` tồn tại. Xử lý lượt đó như sự cố nạp env vào tiến trình con. Tiến trình đã kết thúc. Nội dung tệp và giá trị biến chưa được xem, in hoặc đưa vào bằng chứng. Kiểm thử không dùng model/provider. Các lượt sau build và chạy bản sao Portal chỉ chứa source đã liệt kê, cùng allowlist env và `NODE_OPTIONS` truyền preload cho worker. Fixture `node --require ./scripts/no-personal-env.cjs --test scripts/no-personal-env.test.cjs` kiểm việc chặn metadata/nội dung file env. Sự cố này tách biệt sự cố lịch sử N8N05.

## Biên nghiệp vụ và thao tác local

| Chủ state | Migration | API và bằng chứng |
| --- | --- | --- |
| Class | `0007_changes.sql` | Plan/phê duyệt/ảnh hưởng, lịch sử buổi, hold đích và release nguồn. `class.change.approved` tạo WF08. Event lịch cuối giữ source version và causation. |
| Enrollment | `0002_adjustments.sql` | Lựa chọn học viên, quyết định, quyền lợi hiện hành, waitlist. `adjustment.ready` tạo WF09. `enrollment.class_change_resolution` đánh thức WF08 khi nhả chỗ đã có hiệu lực. |
| Payment | `0002_adjustments.sql` | Reserve/refund/charge/reversal và bằng chứng adapter SYNTHETIC. `payment.adjustment_authorized` đánh thức WF09. Invoice có kiểm quyền lúc yêu cầu và tải. |
| IAM | `0005_learner.sql` | Identity mapping, OTP và live session, kiểm command theo lease và scope của WF08–10. |
| Notification | `0001.sql` | Intent, attempt, local mailbox, Portal receipt và trạng thái xử lý lỗi. `notification.requested` tạo WF10. |

Quyền đứng tên theo service. Worker WF08–10 lấy machine token riêng đối với Bridge. Bridge/IAM cấp command token theo operation `classes.change`, `classes.adjust`, `enrollment.adjust`, `payment.refund`, `notification.deliver`. Producer Notification có `automation:source` riêng. Enrollment giữ source WF07 và mở WF09 cho deadline. Hai danh sách quyền có phiên bản workflow, không chứa secret. Runtime test tạo mới key, mật khẩu DB và thông tin máy mỗi lần.

Chạy `node scripts/build-adjustment-workflows.mjs --check` để đối chiếu generator và canonical. Chọn từng ca bằng `node scripts/test-n8n06.mjs --case=WF10-CLASS-VERSION-ORDER --case=WF10-TRANSFER-MEMBERSHIP`. Mỗi lượt tạo project, DB, role và thông tin xác thực riêng, seed dữ liệu demo, migrate rồi import bản sao inactive. Import làm tiền đề cho ca đã chọn. Harness chỉ ghi ca import như bằng chứng mới khi có `--case=WF08-WF10-IMPORT`. Các cờ `--n8n06-only` và `--regression-only` vẫn phục vụ lượt chạy theo nhóm.

Khi thực hiện khoản hoàn hoặc thu chênh lệch, kế toán đọc khoản đang chờ trên Portal và xác nhận theo phiên bản. Nút thực hiện có hiệu lực với khoản `WAITING` hoặc `RESERVED` chưa được phép thực hiện. Trạng thái cho phép thực hiện, trạng thái hoàn tất và chứng từ adapter được hiển thị theo kết quả Payment. Nếu học viên đã rút consent ở đầu danh sách chờ, giám đốc đúng chi nhánh có thể thu hồi mục đang chờ. Backend kiểm version, ghi audit rồi mới tiếp tục FIFO.

Khi khôi phục, kiểm job hiện tại và tra lookup của domain qua WF tương ứng. `UNKNOWN` giữ owner và khoản dự trù. Người có thẩm quyền chỉ replay job `DEAD` ở version hiện tại sau khi đọc hồ sơ, dùng lại cùng job và khóa nghiệp vụ. Adapter tra chứng từ đã có trước khi tiếp tục. Giữ nguyên trạng thái `UNKNOWN` nếu vẫn thiếu chứng từ. Giữ volume của lượt test để đối chiếu, tránh purge và giữ nguyên payload trong quá trình phục hồi.

Lưu receipt, volume và raw artifacts với ACL Windows giới hạn ở user hiện hành, Administrators và SYSTEM. Index dùng metadata, refs và SHA-256. Mailbox, OTP, hóa đơn, token và execution raw nằm trong thư mục private của lượt chạy.

Gate live thuộc chủ tài khoản và người vận hành. Cần cấp credential sandbox/provider, kiểm lookup/dedup và đối soát theo adapter được cấp, phê duyệt production và hoàn tất runbook vận hành trước khi bật gửi hoặc thanh toán thật.
