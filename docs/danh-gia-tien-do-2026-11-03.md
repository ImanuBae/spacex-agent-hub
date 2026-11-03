# Đối chiếu tiến độ project — 03/11/2026

> Đây là snapshot **trước** lượt triển khai vòng 2 cùng ngày. Các đầu ra mới và giới hạn sau triển khai được ghi riêng tại [bàn giao vòng 2](ban-giao-vong-2-2026-11-03.md); số đếm dưới đây được giữ để truy vết mốc đánh giá, không dùng làm trạng thái live.

Phạm vi đánh giá: working tree local hiện tại, bao gồm file chưa commit/untracked. Không suy ra trạng thái GitHub, CI remote hay production từ code local. Không sửa code hoặc đóng ticket trong lượt rà soát này.

Nguồn chuẩn: [Product Plan v2](product-plan-v2.md), mục 10.3–10.4: **86 ticket = 72 gốc + 14 bổ sung**; mục 1.2: **11 mục tiêu G1–G11**. Dùng [phân công v2](phan-cong-task-v2.md) để hiểu thứ tự triển khai. Bằng chứng bổ sung: [bàn giao đợt 1](ban-giao-dot-1.md), [bàn giao lớp/giữ chỗ](ban-giao-lop-giu-cho.md), code và log kiểm tra.

## 1. Cách tính và kết luận

Đây là đánh giá bảo thủ theo phạm vi ticket và dependency, không phải phép đo công sức. “Hoàn tất local” là phạm vi chức năng có implementation và bằng chứng bàn giao/kiểm tra; không đồng nghĩa customer đã nghiệm thu hoặc đã phát hành. “Một phần” bao gồm code đã hoạt động nhưng còn thiếu phạm vi, tích hợp hoặc dependency để đóng ticket. “Chưa có nghiệp vụ thật” có thể vẫn có tài liệu, giao diện mẫu hoặc localStorage.

| Trạng thái | Số ticket | Tỷ lệ trên 86 |
| --- | ---: | ---: |
| Hoàn tất local theo phạm vi bàn giao | 7 | 8,1% |
| Triển khai một phần/chưa đủ điều kiện đóng | 17 | 19,8% |
| Chưa có implementation nghiệp vụ thật đủ để ghi nhận | 62 | 72,1% |
| Tổng | 86 | 100% |

**Tỷ lệ ticket hoàn tất: 7/86 = 8,1%.** Có 24/86 ticket đã có một phần kỹ thuật, tương đương 27,9% ticket được chạm tới; không được gọi đây là tỷ lệ hoàn thành.

Nếu cần một số quy đổi để theo dõi tạm thời, cho Done = 1, Partial = 0,5, còn lại = 0 thì `(7 + 17 × 0,5) / 86 = 18,0%`. **18% chỉ là chỉ số quy ước của báo cáo này**, chưa phải trọng số được plan/customer phê duyệt và không đo công sức hay độ sẵn sàng production. Không có cơ sở báo cáo 65–75% toàn sản phẩm.

Mẫu số giữ đủ 86 ticket, kể cả ticket có điều kiện như import/kênh ngoài; chưa có quyết định scope để loại chúng. M0 riêng có 7/10 ticket hoàn tất local = 70%; ba ticket platform còn một phần. Không dùng 70% M0 cho toàn dự án.

## 2. Thống kê theo nhóm ticket

| Nhóm | Tổng | Hoàn tất local | Một phần | Chưa có nghiệp vụ thật |
| --- | ---: | ---: | ---: | ---: |
| PL — Nền tảng | 3 | 0 | 3 | 0 |
| IAM — Đăng nhập/quyền | 4 | 3 | 0 | 1 |
| ORG — Tổ chức/nhân sự | 2 | 2 | 0 | 0 |
| GW — Gateway/BFF | 2 | 1 | 1 | 0 |
| CH — Kênh chat | 7 | 0 | 0 | 7 |
| CV — Hội thoại | 5 | 0 | 0 | 5 |
| CRM — Khách/lead/consent | 5 | 0 | 0 | 5 |
| CAT — Catalog | 4 | 0 | 3 | 1 |
| CS — Lớp/lịch/chỗ | 8 | 0 | 6 | 2 |
| ENR — Đăng ký | 8 | 0 | 0 | 8 |
| PAY — Thanh toán | 8 | 0 | 0 | 8 |
| AG — AI Agent | 10 | 0 | 0 | 10 |
| NT — Thông báo | 4 | 0 | 0 | 4 |
| RP — Báo cáo/audit | 4 | 0 | 1 | 3 |
| WEB — Giao diện | 9 | 1 | 2 | 6 |
| PM — Xác nhận nghiệp vụ | 1 | 0 | 0 | 1 |
| OPS — Vận hành | 1 | 0 | 1 | 0 |
| UAT — Nghiệm thu | 1 | 0 | 0 | 1 |
| **Tổng** | **86** | **7** | **17** | **62** |

7 ticket hoàn tất local: **IAM-1, IAM-2, IAM-4, ORG-1, ORG-2, GW-1, WEB-1**.

17 ticket một phần và phần còn thiếu:

| Ticket | Đã có / còn thiếu |
| --- | --- |
| PL-1 | Monorepo, template, workflow và build; thiếu bằng chứng deploy độc lập/migration-rollback trên pipeline thật |
| PL-2 | Thư viện broker, confirm/ack và DLQ; thiếu transactional outbox/inbox, dedup, retry/recovery nghiệp vụ |
| PL-3 | Log/correlation HTTP; thiếu metric, distributed trace và alert |
| GW-2 | BFF và whitelist thật; chưa có rate limit Gateway đầy đủ cho pilot |
| CAT-1 | CRUD khóa/gói/giá, quyền và version; policy nghiệp vụ chưa đầy đủ, bàn giao Class ghi chưa đóng ticket |
| CAT-2 | Lọc tên/trình độ/hình thức/chi nhánh/trạng thái; chưa đủ lọc mục tiêu/ngân sách theo plan |
| CAT-4 | Version/effectiveAt/history bất biến; chưa có snapshot đơn cũ do Enrollment chưa có, policy tương lai chưa hỗ trợ |
| CS-1 | Lớp/buổi/phòng, DRAFT–PLANNED–OPEN; chưa đủ vòng đời và điều kiện nghiệp vụ toàn plan |
| CS-2 | Chặn xung đột buổi/phòng/giảng viên tại DB; chưa có giờ rảnh/nghỉ và duyệt thay đổi |
| CS-3 | API tìm lớp hợp lệ/còn chỗ; dependency CS-2 chưa hoàn tất, chưa đóng cả chuỗi tìm lớp theo lịch khả dụng |
| CS-4 | Hold/expire/commit nguyên tử, retry/idempotency, test race/restart; còn fixture demo, PL-2 và tích hợp Enrollment |
| CS-6 | Ràng buộc phòng/link online có code; giữ trạng thái một phần do CS-1 là dependency chưa hoàn tất, chưa nghiệm thu ticket riêng |
| CS-7 | Có minimumSize/deadline, chặn OPEN khi minimumSize > 0; thiếu chính sách sĩ số, thay người/học bù và xử lý tiếp |
| WEB-4 | UI khóa/gói/lớp/lịch thật; phạm vi Class/Catalog nền chưa hoàn tất, bàn giao chưa đóng ticket |
| WEB-6 | Giảng viên xem lịch được phân công; trang khai giờ rảnh còn RoadmapState, chưa có đề nghị nghỉ |
| RP-1 | Audit cục bộ IAM/Org/Class, Class có bảo vệ bất biến; chưa đủ audit đọc/ghi nhạy cảm xuyên hệ thống và PL-2 |
| OPS-1 | Runbook, config mẫu, health/readiness; chưa có bằng chứng backup/restore thử và phục hồi vận hành đầy đủ |

Mọi ticket không thuộc hai danh sách trên nằm trong nhóm 62 ticket chưa có nghiệp vụ thật. UI mẫu của WEB-2/3/5/7 không được cộng 0,5 chỉ vì đã có trang.

## 3. Đối chiếu 11 tính năng/mục tiêu chính của plan

| Mục tiêu | Trạng thái | Nhận định |
| --- | --- | --- |
| G1 — Hộp thư đa kênh | Chưa đạt | Mailbox dùng localStorage, chưa có web chat/kênh ngoài thật |
| G2 — Quyền vai trò/phạm vi | Đạt local ở các service hiện có | Gateway/service kiểm JWT, phiên, role, scope; có test trực tiếp và chéo chi nhánh; chưa suy rộng sang service chưa xây |
| G3 — AI tư vấn | Chưa đạt | Chưa có service agent, tool calling và bộ eval |
| G4 — Giá/lịch/chỗ từ nguồn thật | Một phần | Catalog/Class PostgreSQL và quote/search thật; chưa có câu trả lời AI truy nguồn |
| G5 — Đăng ký/giữ chỗ an toàn | Một phần | Kỹ thuật giữ chỗ có test; chưa có Enrollment và race với tiền muộn |
| G6 — QR/đối soát | Chưa đạt | Chưa có Payment/webhook/ledger thật |
| G7 — Nhân viên tiếp quản AI | Chưa đạt | Chưa có Conversation/handoff/AI |
| G8 — Báo cáo đối chiếu | Chưa đạt | Dashboard đang trộn API thật với localStorage, chưa có read model/checkpoint |
| G9 — Thông báo có truy vết | Chưa đạt | Chưa có Notification/provider delivery |
| G10 — Riêng tư/audit | Một phần | Có audit cục bộ; chưa có consent, xóa/ẩn danh có tracking đầy đủ |
| G11 — Phân công/phát hành kiểm chứng | Một phần | Có plan, owner, build/test/migration local; thiếu bằng chứng phát hành/rollback đầy đủ |

Kết quả: **1/11 đạt local có giới hạn, 4/11 một phần, 6/11 chưa đạt**. Tỷ lệ mục tiêu đạt đầy đủ trong phạm vi hiện có là 9,1%; đây là thước đo khác với tỷ lệ ticket.

Các nhóm chức năng có thể demo bằng dữ liệu thật hiện tại: (1) đăng nhập/phiên, (2) quyền và scope, (3) tổ chức/nhân sự, (4) khóa/gói/giá, (5) lớp/lịch/phòng và tìm chỗ, (6) giữ/hủy/hết hạn chỗ kỹ thuật. Đây là cách nhóm luồng demo, không phải sáu mục tiêu đã hoàn tất của plan. Landing page là đầu ra bổ sung, không tự cộng thêm ticket vào mẫu số.

## 4. Kiểm chứng trong lượt rà soát

- `npm run check`: **52/52 tác vụ thành công**, trong đó **48 cache hit**. Log: `.local/progress-audit-check.log`. Đây là tác vụ lint/typecheck/test/build, không phải 52 ticket sản phẩm. Suite mặc định có skip 21 test DB Catalog, 13 test DB IAM và 1 test broker; không dùng skip làm bằng chứng tích hợp mới.
- Chạy lại `npm run test:class:db` trên PostgreSQL demo riêng cổng 55432: **11/11 test qua, không skip**. Suite tạo DB kiểm thử UUID riêng, không chạy trên DB marketing; log `.local/progress-audit-class-db.log`.
- Đọc lại code Catalog, Class, Gateway/BFF, các trang nghiệp vụ và log bàn giao/browser trước đó. Không chạy lại browser, IAM DB, Catalog DB hay broker trong lượt này; các kết quả cũ được ghi nhận là bằng chứng trước đó.
- Chưa kiểm CI remote/deploy/customer UAT. Working tree có nhiều thay đổi và file untracked nên đánh giá này chỉ áp dụng local.

## 5. Chỗ tài liệu cũ cần đọc thận trọng và việc tiếp theo

[Phân công](phan-cong-task-v2.md) nói toàn bộ đợt 2 còn backlog. Code và bàn giao Class mới hơn cho thấy các phần này đã được triển khai một phần. Không dùng mô tả kế hoạch cũ để kết luận chưa làm; cũng không tự coi toàn đợt 2 đã xong. Báo cáo lần 1 đã được dọn vì mô tả hiện trạng trước khi có UI gói/lớp/giữ chỗ.

Ưu tiên để tăng số ticket hoàn tất: chốt phạm vi/chính sách C01–C12; hoàn thiện PL-2/PL-3 và nghiệm thu platform; khép các phần Catalog/Class/WEB-4/6 còn thiếu; sau đó triển khai chat/CRM và Enrollment/Payment theo các đợt của plan. M0 chưa hoàn tất, M1 chưa có luồng tuyển sinh end-to-end, M2–M4 chưa có luồng nghiệp vụ hoàn chỉnh.
