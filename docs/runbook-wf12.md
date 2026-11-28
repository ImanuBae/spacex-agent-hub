# WF‑12 · Vận hành local

Dữ liệu và credential trong diễn tập là dữ liệu test. Chi phí 0 USD. N8N‑07 ở trạng thái PARTIAL. [Baseline Portal/WF‑11](acceptance-portal-wf11.md) · [Index WF‑12](../workflows/n8n/wf12-evidence.json).

## Hàng đợi sự cố và replay

1. Chạy migration Bridge 0002 bằng role sở hữu DB Bridge. Migration đưa các job đang DEAD vào hàng đợi. Cấu hình Gateway với `AUTOMATION_BRIDGE_URL`.
2. Tạo machine principal riêng với audience `automation-bridge`, scope `automation:incidents` và workflow `WF-12`. Cho principal dùng WF‑12 trong `AUTOMATION_MACHINE_SUBJECTS`. Import [canonical inactive](../workflows/n8n/wf-12-incidents.json), remap URL nội bộ, gắn credential theo manifest. [Manifest](../workflows/n8n/incident-manifest.json).
3. WF‑12 ghi cảnh báo bền trong hàng đợi, gán cho nhóm giám đốc trung tâm. Một job có một sự cố logic, kể cả khi replay rồi DEAD lần nữa. Cột `alerted_at` ghi lần cảnh báo đầu. Workflow quét tối đa 100 sự cố mỗi lượt.
4. Giám đốc trung tâm mở **Vận hành**, đọc bước lỗi và mã lỗi, đối chiếu dịch vụ nguồn rồi nhập lý do. Phiên và quyền được IAM kiểm lại. Bridge chỉ nhận replay cho version DEAD hiện hành. Khi nhận 409, tải trạng thái mới và đọc lại trước khi gửi.
5. Theo dõi kết quả tại cùng job. Bridge dùng lại lease/checkpoint và operation key. Workflow xử lý ban đầu đọc kết quả nguồn đã lưu. Audit ghi người gửi, lý do, lượt thử và version. Portal chỉ đọc thuộc tính sự cố được phép và trạng thái workflow.
6. Delivery trong `spacex.automation.bridge.v1.dead` được xử lý qua quy trình broker. Sự kiện không được Bridge nhận thành job sẽ không xuất hiện trong hàng đợi Portal.

Chạy `npm run build --workspace=@spacex/contracts`, `node scripts/build-incident-workflow.mjs --check` và `node scripts/test-n8n06.mjs --case=WF12-INCIDENT-REPLAY`. Runner tự tạo project và bản build Portal cô lập với env allowlist và preload.

Ngày 20/11/2026, WF‑12 chạy manual hai lần trên bản sao đã import và ghi lần lượt 1, 0 cảnh báo. Ca broker có một delivery trong DLQ và 0 job tương ứng. Edge kiểm cảnh báo xung đột, giữ lý do, replay qua BFF và reload trạng thái DONE. DB ghi một audit replay hợp lệ và cùng một chứng từ hoàn 100.000 ₫ trước và sau replay. [Receipt API/DB/n8n/Edge](../.local/automation/space-agent-n8n07-acceptance-84df8d3222e2/evidence.json) · [Ảnh 1440 px](../.local/automation/space-agent-n8n07-acceptance-84df8d3222e2/wf12-incident-1440.png) · [Ảnh 768 px](../.local/automation/space-agent-n8n07-acceptance-84df8d3222e2/wf12-incident-768.png) · [Ảnh 390 px](../.local/automation/space-agent-n8n07-acceptance-84df8d3222e2/wf12-incident-390.png).

Màn Vận hành dùng bố cục Achromatic Ledger với font và vỏ Portal hiện có. Mỗi dòng cho biết workflow nào cần xử lý, bước lỗi và lần thử. Chụp ảnh và kiểm bố cục ở ba kích thước bằng Playwright. Đã kiểm hai lượt chạy manual của WF‑12 và poll WF‑09. Lịch 30 giây của WF‑12 có trong canonical.

## Diễn tập backup và restore

Chạy `node scripts/test-n8n06.mjs --case=WF12-RESTORE` sau khi build contracts. Runner tạo hai project local độc lập và dùng dữ liệu tổng hợp.

1. Dừng n8n nguồn và unpublish WF‑08–10. Xếp lịch replay cho job Payment đã ghi chứng từ rồi dừng các backend nguồn. Kiểm broker có 0 delivery chờ và 0 delivery chưa ack. Ghi topology queue.
2. Tạo dump DB n8n và 10 DB backend. Lưu khóa giải mã n8n ở tệp riêng trong kho backup test, cùng cấu hình, manifest, bản sao workflow đã bind và hash từng mục. Kho giữ ACL riêng. Bằng chứng công khai chỉ có hash và metadata.
3. Tạo project đích sạch, role/database, broker, volume và cổng riêng. Phục hồi dump vào các DB đích. Kiểm danh mục workflow, credential, Bridge checkpoint, wakeup, inbox, outbox, ledger và trạng thái chỗ trước khi bật backend. Giữ mọi trigger n8n inactive.
4. Bind lại URL của bản sao n8n về các cổng đích. Chạy probe chỉ cấp token qua credential đã phục hồi. Thực thi WF‑09 manual một lần, kiểm cùng job ID và operation key, một chứng từ đã ghi, ledger 100.000 ₫ và cùng trạng thái chỗ `CANCELLED`.

Lượt đạt ngày 20/11/2026 mất **21,18 giây** để tạo backup sau khi bắt đầu tắt nguồn, **89,35 giây** từ khởi tạo đích đến đối chiếu và cấp token, và **98,27 giây** đến khi kiểm xong replay. Hai lượt trước dừng ở bộ đọc kiểm queue. Dòng header của `rabbitmqctl` đã được xử lý và receipt cũ được giữ. [Receipt nguồn](../.local/automation/space-agent-n8n07-acceptance-12d7acdea2f9/evidence.json) · [Receipt đích](../.local/automation/space-agent-n8n07-acceptance-a89d29a1a53d/evidence.json).

Giới hạn bài diễn tập là nguồn đã quiesce và broker đã rỗng, với một job WF‑09 và các backend liên quan. Thời gian trên đo fixture local, chưa phải RTO/RPO production hay bằng chứng restore broker còn backlog.

## Xóa và ẩn danh có bằng chứng

Policy local `DEMO-C09-WF12-v1` chỉ áp dụng cho dữ liệu tổng hợp. Quản lý xác minh danh tính và phạm vi trong CRM trước khi WF‑12 nhận yêu cầu. Mỗi lượt xử lý một yêu cầu đến hạn. Giữ một tham chiếu bằng chứng tại mỗi DB dịch vụ và đối chiếu vào task CRM. CRM chỉ hoàn tất khi đủ sáu task có bằng chứng. Người xử lý có thể ghi lý do chờ. Trạng thái hoàn tất do workflow ghi từ bằng chứng dịch vụ.

| Chủ dữ liệu | Quyết định local |
| --- | --- |
| CRM | Ẩn danh hồ sơ và dữ liệu liên quan theo logic erasure hiện có. Giữ tombstone và audit. |
| Conversation | Chỉ xử lý conversation khớp mapping và chi nhánh. Fixture áp dụng mốc 90 ngày khi Enrollment đã xác nhận phạm vi không có đăng ký. Thu hồi phiên khách, xóa context, ẩn nội dung và ghi audit. Các trường hợp còn retention giữ BLOCKED. |
| Enrollment và Payment | Truy vấn theo đối tượng trong snapshot và chi nhánh. Khi có hồ sơ thuộc phạm vi lưu giữ, ghi RETENTION và giữ chứng từ, ledger, audit, quyền lợi và chỗ. |
| Reporting | Ghi bằng chứng cho phạm vi chỉ có tổng hợp theo ngày và chi nhánh. |
| Backups | Danh mục đã đối chiếu ghi ID bản sao, đối tượng và hạn giữ. Bản sao còn lưu giữ hoặc chờ chứng minh xử lý giữ task BLOCKED. |

Build `@spacex/contracts` và `@spacex/auth`. Chạy `node scripts/test-n8n06.mjs --case=WF12-ERASURE --case=N8N06-ENROLLMENT-UPGRADE`. Runner bật `WF12_ERASURE_TEST` trong runtime test, cấp principal audience `crm` với đúng scope `erasure:process` cho WF‑12 và dùng một danh mục backup tổng hợp tách riêng. Bản canonical inactive. [Manifest](../workflows/n8n/erasure-manifest.json).

Khi diễn tập restore sau erasure, lấy danh sách loại trừ hiện hành từ tombstone và bằng chứng Conversation của nguồn. Lưu file và SHA‑256 độc lập với backup cũ. Restore các DB đích và giữ Gateway cùng trigger erasure đóng trong lúc đối chiếu. Truyền `WF12_RESTORE_EXCLUSIONS` và `WF12_RESTORE_EXCLUSIONS_SHA256` vào CRM và Conversation phục hồi. Hai backend áp dụng lại dữ liệu thuộc phạm vi trước khi mở listener. Digest sai, yêu cầu xác minh thiếu hoặc mapping bất nhất dừng startup. API đích xác nhận hồ sơ CRM ở ERASED và phiên chat cũ nhận 401.

Các ca local kiểm yêu cầu chưa xác minh, sai chi nhánh, yêu cầu ghi DONE thiếu bằng chứng, Conversation dừng rồi chạy lại, và Enrollment/Payment giữ PROCESSING khi còn retention. Ca restore dùng backup CRM và Conversation được chụp sau xác minh và trước ẩn danh. Bản sao vẫn còn trong thời hạn lưu giữ. Bộ CRM PostgreSQL đạt 22/22. Ca nâng Enrollment từ schema cũ và build Portal cô lập cũng PASS. [Receipt API/DB/n8n](../.local/automation/space-agent-n8n07-acceptance-98980c42c5a2/evidence.json).

Gate ngoài local cần policy C09 đã duyệt, danh mục sao lưu và kênh lưu danh sách loại trừ có chủ quản. Backup có trước xác minh cần phục hồi bằng chứng xác minh trước khi mở phục vụ. Phạm vi ca local là sáu task CRM trên dữ liệu tổng hợp đã nêu ở bảng.
