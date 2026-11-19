# N8N-06 — acceptance local

**ACCEPT_LOCAL** ngày 20/11/2026 (Asia/Saigon). Codex agent quyết định theo [ủy quyền](prompt-hoan-thanh-n8n-06.md). Phạm vi WF08–10 và Portal với dữ liệu tổng hợp local, chi phí 0 USD. [Index bằng chứng](../workflows/n8n/adjustment-evidence.json).

Baseline trước sửa: `.local/automation/n8n06-20261115T172538-036c38e6/`. Đã snapshot 402 source files và 4 checkpoints; 312 source/config hashes cùng 117 refs của registration evidence được đối chiếu độc lập và khớp. Đây là kiểm integrity, không phải regression trên source sau sửa. N8N05 historical integrated receipt có 49 PASS; quyết định ACCEPT_LOCAL nằm ở index/checkpoint. Mọi FAIL/SKIP/UNKNOWN mới phải giữ trong receipt riêng.

## Matrix yêu cầu và bằng chứng

Mỗi dòng đối chiếu kết quả nghiệp vụ với mã ca trong bảng bằng chứng. Receipt ghi expected/actual, assertion effects API/DB và IDs job/event/operation/execution ở những ca đi qua workflow. Preflight giữ hash source, schema và cấu hình. Kết quả kỹ thuật của Bridge được đọc cùng trạng thái nghiệp vụ của domain.

| ID | Expected / yêu cầu phải chứng minh | Actual / evidence |
| --- | --- | --- |
| 08-01 | Request/approval có reason/version/branch; teacher không tự duyệt; actor giả/cross-branch bị chặn | Duyệt cùng chi nhánh và khác người lập thành công. Bị chặn khi tự duyệt, sai version hoặc sai branch. `WF08-APPROVAL-AND-HISTORY`, `WF08-STALE-BEFORE-APPROVAL`. |
| 08-02 | AVAILABLE giữ semantics; duyệt LEAVE và xếp lịch đồng thời không tạo xung đột | Giờ AVAILABLE có hiệu lực ngay. Hai ghi đồng thời không tạo cảnh giảng viên vừa được duyệt nghỉ vừa có buổi. `WF08-LEAVE-SCHEDULE-RACE`. |
| 08-03 | Impact gồm hold/committed/current entitlement; stale plan phải tính lại | Plan ghi chỗ và quyền lợi hiện hành. Đăng ký mới làm plan đã duyệt hóa stale. Version và hai committed seat được giữ. `WF08-REGISTRATION-INTERLEAVING`. |
| 08-04 | Đổi lịch/phòng/teacher/sức chứa kiểm conflict; giữ lịch sử buổi/snapshot | Chọn lịch mới rồi hoãn/mở lớp giữ chỗ, snapshot và lịch sử buổi. Cùng khóa giảng viên, exclusion constraint và kiểm sức chứa của Class áp dụng khi ghi. `WF08-LEARNER-CHOICE`, `WF08-LEAVE-SCHEDULE-RACE`, `WF08-MINIMUM-AND-MAKEUP`. [Baseline Class](ban-giao-lop-giu-cho.md). |
| 08-05 | Hủy với quyền lợi có quyết định từng đơn/customer choice/WF09; cancel-vs-commit an toàn | Hủy lớp có đăng ký chờ resolution đúng đơn. WF09 bảo lưu rồi nhả chỗ nguồn trước khi WF08 đóng lớp. Đăng ký HELD chuyển COMMITTED làm plan stale. Đăng ký mới giữ chỗ và lớp OPEN, khoản hoàn liên kết có đúng một chứng từ. `WF08-CANCEL-VS-REGISTRATION-COMMIT`, `WF08-WF09-LINKED-CANCELLATION`, `WF08-REGISTRATION-INTERLEAVING`, `WF08-MANUAL-CANCEL`. |
| 08-06 | Minimum-size/decision deadline/hoãn/học bù thực thi theo policy | Thiếu sĩ số tại cutoff bị chặn mở. Plan học bù ghi lịch mới và giữ lịch sử. `WF08-MINIMUM-AND-MAKEUP`. |
| 08-07 | Nhả quyền lợi sau cancellation có hiệu lực; không đợi refund; lỗi bước sau không PUT lùi | Hủy quyền lợi nhả chỗ khi Payment còn giữ dự trù. Khi bù trừ trước target commit, chỗ nguồn và quyền lợi vẫn tồn tại. `WF08-WF09-LINKED-CANCELLATION`, `WF09-REFUND-UNKNOWN_BEFORE`, `WF09-TRANSFER-CHARGE-COMPENSATION`. |
| 08-08 | Event cuối có causation/sourceVersion; reminder cũ bị supersede | Class ghi event có version và causation. Lịch cũ thành SUPERSEDED và event cũ không tái tạo lời nhắc. `WF08-APPROVAL-AND-HISTORY`, `WF10-CLASS-VERSION-ORDER`. |
| 09-01 | Adjustment lưu policy/quote/delta/version/deadline/choice/history; authority hiện hành | Version, policy, quote/delta, deadline và lựa chọn học viên được đọc lại trong luồng giữ chỗ, thanh toán và commit. `WF09-TRANSFER-DELTA`, `WF09-REVOKED-APPROVAL`, `WF09-INVITATION-AND-SUSPENSION-EXPIRY`. |
| 09-02 | Accountant lập/thực hiện, director độc lập duyệt; self/revoked approval bị chặn | Kế toán không duyệt. Giám đốc không tự duyệt. Phiên duyệt bị thu hồi làm job dừng trước Payment, quyền lợi và ghế nguồn còn giữ. `WF09-REVOKED-APPROVAL`. |
| 09-03 | Partial/full/excess refund; received-minus-refunded/reserved/UNKNOWN cap và race đúng | Proposal cạnh tranh trả 201/409. Vượt trần bị chặn, hoàn dư giữ tuition, khoản UNKNOWN còn owner và dự trù. `WF09-REFUND-OVER-CAP-CONCURRENT`, `WF09-EXCESS-REFUND-KEEPS-TUITION`, `WF09-REFUND-UNKNOWN_BEFORE`, `WF09-REFUND-UNKNOWN_AFTER`. |
| 09-04 | Lookup trước retry; synthetic adapter proof; duplicate không nhân tiền, UNKNOWN không success | Hoàn dư chỉ có một chứng từ dù hai lệnh thực hiện cạnh tranh. Replay UNKNOWN phục hồi đúng chứng từ cũ khi có và giữ UNKNOWN khi thiếu. `WF09-EXCESS-REFUND-KEEPS-TUITION`, `WF09-REFUND-UNKNOWN_BEFORE`, `WF09-REFUND-UNKNOWN_AFTER`. |
| 09-05 | Transfer giữ/chốt target an toàn trước release source; delta Payment proof | Thu thêm mô phỏng 25.000 VND trước commit đích. Hoàn chênh lệch 20.000 VND sau khi dự trù và chốt đích. Snapshot ban đầu vẫn 100.000 VND. `WF09-TRANSFER`, `WF09-TRANSFER-DELTA`. |
| 09-06 | Target hết chỗ/lỗi trước commit nhả target, giữ source; sau commit recovery không nhả cả hai | Target hết chỗ giữ quyền lợi nguồn. Hold hết hạn trước commit dẫn tới đúng một reversal cho khoản thu. SIGKILL sau commit phục hồi theo hướng tiến và giữ chỗ đích. `WF09-WAITLIST-LAST-SEAT`, `WF09-TRANSFER-CHARGE-COMPENSATION`, `WF09-SIGKILL-AFTER-COMMIT`. |
| 09-07 | Suspension lưu remaining entitlement/hạn; resume atomic seat; expiry không hồi sinh | Bảo lưu giữ số buổi còn lại và nhả chỗ cũ. Resume commit chỗ mới và giữ số buổi. Bản hết hạn bị từ chối trước khi xin chỗ. `WF09-SUSPEND-RESUME`, `WF09-INVITATION-AND-SUSPENSION-EXPIRY`. |
| 09-08 | Waitlist consent/eligibility/FIFO/dedup; invitation version/expiry/revoke/decline | Kiểm trùng, consent và FIFO. Thu hồi mục chờ giải phóng thứ tự. Lời mời bị từ chối, thu hồi hoặc quá hạn không thể nhận. `WF09-WAITLIST-FIFO-CONSENT`, `WF09-WAITLIST-LAST-SEAT`, `WF09-WAITLIST-DECLINE-REVOKE`, `WF09-INVITATION-AND-SUSPENSION-EXPIRY`. |
| 09-09 | Hai invitation tranh chỗ cuối qua atomic hold/commit; không hold rò rỉ | Hai lời mời được nhận, đúng một chỗ đích COMMITTED. Học viên còn lại giữ chỗ nguồn. `WF09-WAITLIST-LAST-SEAT`. |
| 10-01 | Intent/dedup/recipient/template/sourceVersion/attempt/lookup/owner thuộc Notification | Intent trùng giữ cùng ID. Body gửi không chọn được recipient khác. Các lần thử, trạng thái, receipt và owner được lưu. `WF10-CONSENT-DEDUP-REMINDER`, `WF10-COMMAND-FENCE`, nhóm `WF10-ADAPTER-*`. |
| 10-02 | Confirmation chỉ từ enrollment.confirmed + commit hợp lệ; không từ matched | Tại payment match và chỗ HELD có 0 intent. Khi kiểm được confirmed và COMMITTED có đúng một thông báo Portal và một mail receipt. `WF10-MATCH-NOT-CONFIRMED`, `WF10-CONFIRMED-MAIL-PORTAL`. |
| 10-03 | Reminder kiểm lại schedule/version/cancel/consent ngay trước gửi; out-of-order an toàn | Rút consent, đổi version và chuyển entitlement chặn reminder cũ. Tin đã gửi giữ nguyên receipt, membership chuyển sang lớp mới. `WF10-CONSENT-DEDUP-REMINDER`, `WF10-CLASS-VERSION-ORDER`, `WF10-TRANSFER-MEMBERSHIP`. |
| 10-04 | Portal và local mailbox nhận thật; rejected/before-send/after-send timeout; lookup recovery | Adapter local ghi Portal/mailbox thật. Đã đối chiếu reject, timeout trước/sau gửi, UNKNOWN và SIGKILL sau lưu receipt. `WF10-ADAPTER-*`, `WF10-SIGKILL-AFTER-MAIL`. |
| 10-05 | OTP hash/expiry/rate limit/brute force/session/purpose; wrong/replay/race bị chặn | OTP sai session không tiêu lượt, sai mã khóa sau 5 lần, hai verify đồng thời chỉ một phiên, replay và request quá trần bị chặn. Expiry dùng server time. `WF10-OTP-RATE-RACE-REPLAY`, `WF10-OTP-EXPIRY-OWNERSHIP`. |
| 10-06 | Learner chỉ xem entitlement/schedule/link mình; cross-learner/branch/URL bị chặn | Learner sở hữu đọc được lịch và link HTTPS. Learner khác bị chặn khi dùng cùng ID qua API và Portal. `WF10-OTP-EXPIRY-OWNERSHIP`, `N8N06-BROWSER`. |
| 10-07 | Invoice input/eligibility/ownership/audit; download mô phỏng; không public PII | Payment ghi invoice và audit tạo/tải. File mô phỏng escape dữ liệu, tải attachment theo ownership và trả 404 cho learner khác. `WF10-OTP-EXPIRY-OWNERSHIP`, `N8N06-BROWSER`. |
| UI-01 | Staff tạo/xem/duyệt/thực hiện/reload bền; trạng thái requested/approved/pending/executed/failed/unknown rõ | Kế toán lập và cho phép thực hiện refund, tuyển sinh chỉ đọc, giám đốc độc lập duyệt, học viên chọn. Refund và Class plan có trạng thái bền sau reload. `N8N06-BROWSER`. |
| UI-02 | Browser thật 1440/768/390; keyboard/accessibility; learner OTP/invoice | Edge thật ở 1440/768/390 px. Kiểm link đăng nhập bằng bàn phím, OTP, lịch và file. Menu staff mở bằng Enter, đóng bằng Escape và trả focus. Ảnh viewport lấy sau khi menu ổn định. `N8N06-BROWSER`, `N8N06-BROWSER-RESPONSIVE`. |
| AUTH-01 | Fake actor/branch/approval/choice/recipient và cross-resource bị chặn | Role/branch sai, tự duyệt, quyết định đã thu hồi, lựa chọn học viên khác hoặc intent ngoài scope đều bị chặn. `WF08-APPROVAL-AND-HISTORY`, `WF09-WAITLIST-LAST-SEAT`, `WF09-REVOKED-APPROVAL`, `WF10-COMMAND-FENCE`. |
| AUTH-02 | Rotate/revoke/expiry/DONE/stale lease/attempt/workflow-version/event replay fail closed | Worker WF10 bị chặn với attempt sai, ngoài scope và job DONE. Version cũ không claim được. Thu hồi/rotation/expiry đã kiểm trên Bridge/IAM và regression N8N05 cùng hợp đồng, stale event kiểm trên WF10. `WF10-COMMAND-FENCE`, `WF10-CLASS-VERSION-ORDER`, nhóm `AUTH-*`. |
| DB-01 | Domain state/result/audit/outbox atomic; operation key ràng payload/resource/version | Đối chiếu số chỗ, entitlement, snapshot, ledger, khoản dự trù, operation và receipt. Approval/history/outbox theo các job và event lưu trong receipts. `WF08-APPROVAL-AND-HISTORY`, `WF09-EXCESS-REFUND-KEEPS-TUITION`, `WF09-TRANSFER-DELTA`, `WF10-CONFIRMED-MAIL-PORTAL`. |
| DB-02 | Fresh + upgrade migration trên synthetic prior schema gồm N8N05 đang dở | DB và role riêng, migration fresh hai lượt. Enrollment nâng từ schema `0001` với đơn HELD, hold/payment refs và snapshot giữ nguyên. `N8N06-ENROLLMENT-UPGRADE`, preflight và migration receipts. |
| RUN-01 | PostgreSQL/RabbitMQ/n8n thật; manual/automatic/event/cron/recovery; canonical inactive | PostgreSQL, RabbitMQ và n8n thật. Import ba workflow inactive, manual cancel, poll tự động, broker events, deadline và forward recovery. `WF08-WF10-IMPORT`, `WF08-MANUAL-CANCEL`, `WF09-TRANSFER`, `WF09-INVITATION-AND-SUSPENSION-EXPIRY`. |
| FAULT-01 | Physical kill sau target/adjustment commit trước checkpoint; recovery không mất/nhân chỗ | SIGKILL thật sau target commit. Cùng job phục hồi, target vẫn COMMITTED, source chỉ nhả sau khi quyền mới đã bền. `WF09-SIGKILL-AFTER-COMMIT`. |
| FAULT-02 | Physical kill sau refund/send commit trước checkpoint; lookup không nhân tiền/delivery | SIGKILL thật sau mailbox commit. Cùng job phục hồi ở attempt 2, receipt và bản tin Portal giữ đúng một bản và cùng ID. `WF10-SIGKILL-AFTER-MAIL`. |
| SAFE-01 | Private ACL descendants, allowlisted env/preload fixture; không personal credentials/model | Preflight fixture riêng và Portal source-only với env allowlist/preload. ACL descendants được kiểm riêng theo lượt, gồm recheck cả đường dẫn dài. Sự cố typegen cũ có trong bàn giao. |
| SAFE-02 | Owned processes/containers/networks/ports stopped; volumes/artifacts retained; protected hashes nguyên | Cleanup xác nhận project đóng, 0 container/network/cổng thuộc lượt chạy còn mở, volumes giữ lại. Đối chiếu 19 mục bảo vệ và refs N8N05 từ snapshot bảo toàn. |
| CLOSE-01 | Ponytail review final connected diff; independent JSON/link/hash consistency; không finding chặn | Rà connected callers và harness theo Ponytail Review. Đã kiểm các lỗi Portal khoản RESERVED và hàng chờ FIFO sau sửa. Kiểm độc lập receipts, refs, trace, screenshot và hash canonical. |

## Dependency / impact matrix

| Nhóm | Baseline | Quy tắc kiểm source cuối |
| --- | --- | --- |
| N8N01 runtime | Image/compose receipts lịch sử | Isolated config/mount/namespace/import/cleanup mới; không sửa runtime khác |
| N8N02 Bridge | Job/inbox/lease/wakeup/replay receipts | Receipt Bridge/IAM khớp 24 hash. Ca `WF10-COMMAND-FENCE` và hai ca SIGKILL kiểm đường dùng operation N8N-06 |
| N8N03 IAM/commands | Authority/delegation receipts | Giữ proof rotate/revoke/expiry. Ca mới kiểm các scope, lựa chọn, quyết định đã thu hồi, DONE và attempt sai |
| N8N04 model/corpus/WF01–03 | Hash/ref baseline khớp | Kế thừa chỉ sau preservation hash/reachability; không inference/OpenRouter |
| N8N04 Conversation/browser/fault | Synthetic historical receipts | 27 mục regression gồm backend thật, browser 3 viewport và fault tổng hợp. Đối chiếu 50 hash, giữ nguyên provider/model history |
| N8N05 WF04–07 | 312 hash + 117 refs verified; 49 historical integrated groups | 50 ca regression trên source tích hợp, gồm browser và physical faults. Kèm recheck ACL độc lập. Các ca interleaving kiểm chỗ, quyền lợi và tiền khi đăng ký đi cùng WF08/09 |
| N8N07/08, WF11/12 | Chưa mở | Không triển khai; source hiện hữu chỉ kiểm ảnh hưởng shared contracts nếu có |

## Bằng chứng theo lượt

| Lượt | Kết quả dùng trong nghiệm thu | Receipt |
| --- | --- | --- |
| N8N02/03 và N8N04 | Kế thừa integration, delegation, smoke, Conversation và browser sau đối chiếu hash | [Bridge/IAM](../.local/automation/space-agent-automation-test-bd28fd199763/evidence.json), [Conversation](../.local/automation/space-agent-automation-test-806f27e847c5/evidence.json) |
| Regression N8N05 | 50 ca PASS. Receipt toàn lượt giữ FAIL do bộ đọc ACL Windows. Lượt kiểm độc lập đủ 1.398 mục, 0 cấp quyền ngoài allowlist | [Ca kiểm](../.local/automation/space-agent-n8n06-acceptance-6bde90d32314/acceptance-cases.json), [Kiểm lại ACL](../.local/automation/n8n06-resume-a450a0199eb5/regression-registration-acl-recheck.json) |
| Chẩn đoán N8N06 | Kế thừa kiểm sai mã/rate/race/replay OTP vì IAM và schema liên quan trùng hash. OTP issuance, mailbox và ownership cũng có proof mới. Giữ lỗi transport cũ; kiểm lại các ca Notification bị ảnh hưởng sau drift | [Chẩn đoán](../.local/automation/space-agent-n8n06-acceptance-b5304dae0a44/evidence.json) |
| Lượt tích hợp trước | Kế thừa migrate upgrade, import, manual cancel, automatic transfer, SIGKILL sau target commit. Giữ FAIL cũ của proxy mailbox | [Lượt trước](../.local/automation/space-agent-n8n06-acceptance-82f36f0beba1/evidence.json) |
| SIGKILL WF10 | Ca mailbox PASS. Receipt toàn lượt giữ FAIL vì phần fixture của ca đổi lịch phụ thuộc ca không được chọn. Fixture đã tách và có receipt tiếp theo | [Physical fault](../.local/automation/space-agent-n8n06-acceptance-d8ccaf3d3bab/evidence.json) |
| WF08/09/10 theo ca | 15 PASS, gồm lớp, quyền lợi, lớp đích, waitlist, đổi lịch và membership | [Ca nghiệp vụ](../.local/automation/space-agent-n8n06-acceptance-ed94383e9a6d/evidence.json) |
| Notification và Payment | 11 PASS. Ca revoke giữ FAIL vì assertion dùng mã lỗi của IAM thay vì mã chuẩn hóa tại boundary. Ca revoke được thực thi riêng trong lượt bổ sung | [Delivery và tiền](../.local/automation/space-agent-n8n06-acceptance-21bfa8fa76d5/evidence.json) |
| Authority, bù trừ và Portal | 5 ca PASS. Receipt toàn lượt giữ FAIL do PowerShell bỏ sót đường dẫn cache Next. Lượt kiểm lại 1.486 mục, gồm 16 đường dẫn dài, với 0 cấp quyền ngoài allowlist | [Bổ sung](../.local/automation/space-agent-n8n06-acceptance-b59eb238d154/evidence.json), [Kiểm lại ACL](../.local/automation/n8n06-selective-71ab1b69058e/browser-acl-recheck.json) |
| Hủy lớp, đăng ký và hoàn đồng thời | Ca interleaving PASS, đóng project và kiểm ACL PASS theo bộ duyệt đường dẫn mới | [Class/Enrollment/Payment](../.local/automation/space-agent-n8n06-acceptance-cd6adf391956/evidence.json) |
| Responsive và bàn phím | Edge PASS cho bốn màn hình staff ở ba viewport. Cleanup và ACL PASS, gồm cache Next đường dẫn dài | [Viewport staff](../.local/automation/space-agent-n8n06-acceptance-13b2da1f9281/evidence.json) |

Thay đổi sau các lượt tích hợp trước gồm harness chọn ca và trình duyệt, nhánh Portal thực hiện thanh toán đã dự trù và nhánh thu hồi mục `WAITING` của waitlist. Nhánh Enrollment mới kiểm chính xác trạng thái và version trên route thu hồi. Cùng nhánh `INVITED`, đăng ký N8N05, schema, canonical, giao thức lease và các đường thực thi tiền vẫn giữ proof cũ khi hash và đường gọi tương thích. [Inventory và SHA-256](../.local/automation/n8n06-selective-71ab1b69058e/receipt-inventory.json).

## Review connected callers

- Portal và Gateway chuyển khoản đã dự trù từ màn hình Refunds vào đúng endpoint Payment với version hiện tại. Nút bám authority của kế toán và ẩn khi khoản đã được cho phép thực hiện. `N8N06-BROWSER`.
- Danh sách chờ từng bị kẹt khi người đầu hàng rút consent. API thu hồi mục chờ giờ kiểm branch, actor hiện hành và version, ghi audit rồi cho phép mục tiếp theo theo FIFO. `WF09-WAITLIST-FIFO-CONSENT`.
- Harness tách fixture giữa các ca để chạy theo ID. Bộ kiểm ACL duyệt đủ thư mục trước khi đọc ACL theo đường dẫn Windows mở rộng. Cleanup vẫn gọi Docker down khi thu thập log gặp lỗi. [Kiểm ACL độc lập](../.local/automation/n8n06-selective-71ab1b69058e/browser-acl-recheck.json).

## Quyết định

**ACCEPT_LOCAL** theo policy `DEMO-N8N06-2026-11-16-v1`. Hồ sơ có 34 ca N8N-06 chạy mới PASS, 6 ca N8N-06 kế thừa có đối chiếu và 50 ca regression đăng ký kế thừa cùng biên bản ACL. 13 test IAM DB ghi SKIP trong lượt unit vẫn giữ SKIP. Đường IAM DB thực thi được đối chiếu qua receipt integration riêng. Các bản canonical WF08–10 giữ inactive. [Index](../workflows/n8n/adjustment-evidence.json), [checkpoint](../.local/automation/n8n06-selective-71ab1b69058e/checkpoint.json), [bàn giao](ban-giao-n8n-06.md).

Gate provider/live/production còn đóng. Chủ tài khoản và vận hành cần cấp credential sandbox/provider, kiểm lookup và đối soát adapter, hoàn tất runbook và phê duyệt production.
