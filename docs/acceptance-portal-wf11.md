# Portal và WF‑11 — bằng chứng local

**ACCEPT_LOCAL** ngày 20/11/2026 cho ba phần trong hồ sơ này. N8N‑07 ở trạng thái PARTIAL. [Evidence index](../workflows/n8n/reporting-evidence.json).

## 1. Đối soát ngoại lệ

Edge mở hàng đợi với tài khoản kế toán và giám đốc chi nhánh. Ba loại giao dịch tổng hợp xuất hiện đúng phạm vi. Kế toán xem chứng từ, nhận lỗi lý do ngắn, giữ bản nháp khi mất phiên và khi API từ chối phiên bản cũ, sau đó tải lại và gửi đề xuất. Giám đốc vào từ menu, dùng bàn phím để mở và duyệt. Cả hai vai trò đọc lại lịch sử sau reload. DB ghi hai đề xuất và một quyết định cho ca gia hạn, một đề xuất và một quyết định cho ca chờ hoàn. API từ chối sai vai trò và chi nhánh bằng 403, sai phiên bản bằng 409. [Ca API/DB/Edge](../.local/automation/space-agent-n8n06-acceptance-5aa0bfe511da/acceptance-cases.json) · [1440 px](../.local/automation/space-agent-n8n06-acceptance-5aa0bfe511da/reconciliation-director-1440.png) · [768 px](../.local/automation/space-agent-n8n06-acceptance-5aa0bfe511da/reconciliation-director-768.png) · [390 px](../.local/automation/space-agent-n8n06-acceptance-5aa0bfe511da/reconciliation-director-390.png).

Payment phân biệt quyết định chờ hoàn với khoản hoàn của đơn có chứng từ mô phỏng. Liên kết hiện hành nằm ở cấp đơn thanh toán. Nghiệp vụ phân bổ khoản hoàn cho từng giao dịch gốc vẫn cần hợp đồng riêng.

Ca hồi quy hoàn phần tiền dư chứng minh cùng chi tiết đối soát trả khoản `RESERVED` khi chưa có chứng từ, rồi khoản `EXECUTED` có đúng chứng từ mô phỏng 12.000 ₫ sau khi kế toán thực hiện. Ledger và ghế học được giữ đúng. [Receipt cleanup và các ca](../.local/automation/space-agent-n8n06-acceptance-5aa0bfe511da/evidence.json).

Lượt đầu ghi nhận lỗi mở lại màn hình khi đăng nhập lại. Lượt sau dùng điều hướng tải trang đầy đủ sau khi tạo phiên và kiểm lại bản nháp trong cùng tab. [Lượt đầu](../.local/automation/space-agent-n8n06-acceptance-1f20350cfcf8/acceptance-cases.json).

## 2. Luồng Portal hiện có

Playwright đi từ hồ sơ CRM đến danh sách đăng ký của học viên bằng bàn phím. Ca `PORTAL-CONTEXT` xác nhận tên, trạng thái và nút Xem trạng thái đều trong viewport ở 390 px. Bảo lưu và chuyển lớp nhận đúng đăng ký đã chọn. Sau khi chuyển, form nhắc lịch đọc lớp mới, nhận lỗi giờ gửi sai và gửi lại bằng phiên bản lịch từ Class. Notification trả 409 khi ghi với lớp cũ. [API/DB/Edge](../.local/automation/space-agent-n8n06-acceptance-2a5367998028/acceptance-cases.json) · [Danh sách ở 390 px](../.local/automation/space-agent-n8n06-acceptance-2a5367998028/context-registrations-390.png).

Student Portal đọc đơn ban đầu 100.000 ₫, quyền lợi hiện hành 80.000 ₫ và chênh lệch hoàn 20.000 ₫. Reload khi dự trù hiển thị Chờ hoàn. Reload sau WF‑09 hiển thị Đã hoàn cùng chứng từ khớp Payment. [Student ở 1440 px](../.local/automation/space-agent-n8n06-acceptance-2a5367998028/context-student-1440.png) · [768 px](../.local/automation/space-agent-n8n06-acceptance-2a5367998028/context-student-768.png) · [390 px](../.local/automation/space-agent-n8n06-acceptance-2a5367998028/context-student-390.png).

Các lượt trước giữ bằng chứng lỗi focus khi rời dialog, form chọn lại nghiệp vụ khi đi qua lịch sử trình duyệt và locator trùng với option ẩn. [Lượt 1](../.local/automation/space-agent-n8n06-acceptance-38ad8a612d84/acceptance-cases.json) · [Lượt 2](../.local/automation/space-agent-n8n06-acceptance-6832e8625dbe/acceptance-cases.json) · [Lượt 3](../.local/automation/space-agent-n8n06-acceptance-a2cf0185ba1a/acceptance-cases.json).

## 3. Định nghĩa báo cáo WF‑11

Kỳ dùng ngày lịch Asia/Saigon. API nhận ngày đầu và ngày cuối theo dạng ISO, gồm cả hai ngày. Nguồn lọc từ 00:00 ngày đầu đến trước 00:00 ngày sau ngày cuối. Đơn vị tiền là VND, tổng được trao đổi dưới dạng chuỗi số nguyên.

| Chỉ số | Mốc, phạm vi và điều kiện |
| --- | --- |
| Đơn đã xác nhận | Một đơn theo event `enrollment.confirmed` đã lưu cùng commit Enrollment. Dùng `occurredAt` và chi nhánh trong event xác nhận. Chuyển lớp và hoàn tiền sau đó không thay đổi kỳ xác nhận. |
| Tiền đã nhận | Tổng tiền gộp theo `payment_ledger.received_at`, gồm tiền thiếu và thừa đã vào ledger. Chênh lệch thu thêm dùng giờ tạo chứng từ CHARGE đã được Payment xác minh. Khoản thu đã đảo có cả dòng thu và dòng hoàn ở kỳ tương ứng. |
| Tiền đã hoàn | Dùng giờ tạo chứng từ mô phỏng REFUND gắn với bản ghi Payment EXECUTED. Khoản đảo CHARGE dùng chứng từ REVERSAL gắn với bản ghi REVOKED. Khoản duyệt, chờ hoàn, dự trù và UNKNOWN chưa được tính. |

Khoản thu chưa gán hiển thị riêng cho giám đốc trung tâm. Số tiền đã nhận của từng chi nhánh và tổng tiền đã nhận trong phần chính chỉ cộng các khoản đã gắn chi nhánh. Tiền hoàn ghi theo chi nhánh của nghiệp vụ Payment và ngày chứng từ, kể cả khi tiền đến ở kỳ trước.

API nguồn và DB trả 1 đơn, 100.000 ₫ nhận và 20.000 ₫ hoàn trong chi nhánh. Kỳ hai ngày có thêm 15.000 ₫ chưa gán. Hai fixture sát nửa đêm được đưa vào hai ngày khác nhau. Khoản dự trù có tổng hoàn bằng 0 trước khi có chứng từ. Reporting giữ bốn checkpoint event, cùng tổng khi giao lại event và khi dựng lại sau khi xóa bảng tổng hợp trong DB test. Chủ thể sai scope bị chặn ở machine API và API báo cáo. [Ca WF‑11](../.local/automation/space-agent-n8n07-acceptance-3a2fd1aa6dda/acceptance-cases.json).

WF‑11 import inactive rồi chạy manual, poll và lịch đối chiếu ngày trên bản sao. Lịch test gọi mỗi 10 giây để quan sát cả job và đối chiếu ngày hôm trước. Canonical ghi 02:15 Asia/Saigon và giữ nguyên SHA‑256. [Receipt project cô lập](../.local/automation/space-agent-n8n07-acceptance-3a2fd1aa6dda/evidence.json) · [Cấu hình local](../services/reporting/README.md).

Tổng quan lấy số liệu đã đối chiếu qua Gateway/BFF. Màn hình có bộ lọc tháng và chi nhánh, nhãn mô phỏng, độ phủ ngày và trạng thái lỗi tải. Edge kiểm số liệu, 403 ngoài chi nhánh, HTTP 503 ở trình duyệt, thử lại bằng bàn phím và reload. [API/DB/browser](../.local/automation/space-agent-n8n07-acceptance-d267f8212418/acceptance-cases.json) · [1440 px](../.local/automation/space-agent-n8n07-acceptance-d267f8212418/overview-1440.png) · [768 px](../.local/automation/space-agent-n8n07-acceptance-d267f8212418/overview-768.png) · [390 px](../.local/automation/space-agent-n8n07-acceptance-d267f8212418/overview-390.png).

## Hồi quy và bảo toàn

- WF‑05 giữ chỗ và QR, WF‑06 xác nhận đơn, luồng đối soát Portal và hoàn phần tiền dư đều PASS trên source tích hợp. [Receipt](../.local/automation/space-agent-n8n06-acceptance-0f15678c73e7/evidence.json).
- Các ca Portal context, tư cách thành viên sau chuyển lớp, chênh lệch thu/hoàn và browser OTP/hóa đơn đều PASS. Lượt bổ sung kiểm dedup/consent và thứ tự phiên bản lịch WF‑10. [Receipt UX](../.local/automation/space-agent-n8n06-acceptance-2a5367998028/evidence.json) · [Receipt nhắc lịch](../.local/automation/space-agent-n8n06-acceptance-47cff74fe025/evidence.json).
- 46 test chọn lọc PASS sau khi cập nhật assertion Bridge cũ cho `payment.refund`, vốn đã được schema WF‑09 chấp nhận. Kiểm lại generator WF04–07, WF08–10 và WF‑11 cùng preload chặn env cá nhân. 191 artifact lịch sử khớp SHA‑256. [Đối chiếu trước sửa](../.local/automation/portal-wf11-867b614cba/baseline.json) · [Kiểm bảo toàn](../.local/automation/portal-wf11-867b614cba/preservation.json).

Các bộ kiểm dùng dữ liệu và credential tổng hợp ở project riêng với 0 USD. Receipt ghi trạng thái đóng process, container, mạng và cổng. Volume test được giữ theo runner để kiểm chứng lại dữ liệu. Import, WF‑12, provider/live và restore toàn hệ thống thuộc các mốc riêng.
