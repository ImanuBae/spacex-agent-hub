# Prompt tiếp tục N8N-06 từ phiên hiện tại

Mốc bàn giao 20/11/2026, Asia/Saigon. Dán phần dưới vào đúng session đang làm N8N-06.

```text
Tiếp tục công việc đang dở tại D:\Imanu\Study\space-agent-hub trong chính
session này. Mục tiêu vẫn là hoàn thành N8N-06 đến ACCEPT_LOCAL, đủ WF08/09/10,
Portal, nghiệp vụ tiền/chỗ/quyền lợi và kiểm bù trừ. Yêu cầu gốc và các hàng
rào tại docs/prompt-hoan-thanh-n8n-06.md vẫn áp dụng. Matrix tại
docs/acceptance-n8n-06.md và policy DEMO tại docs/ban-giao-n8n-06.md.

Tôi trao toàn quyền kỹ thuật trong phạm vi N8N-06, gồm sửa code/harness,
dùng Docker local, tạo test fixtures/credentials riêng, review, chốt policy
DEMO và tự quyết định nghiệm thu với vai trò Codex agent. Không chờ tôi duyệt
lại. Giữ nguyên dữ liệu, runtime, canonical và hồ sơ N8N khác. Chi phí 0 USD,
dữ liệu tổng hợp, không đọc personal env, không gọi model hoặc gửi/chuyển tiền
thật, không mở WF11/12 hoặc N8N07/08. Không dừng ở bản kế hoạch.

Quy tắc tiếp tục: đừng chạy lại các công việc đã hoàn tất trong phiên này.
Đọc source đang có, receipt và hash trước khi chạy bất kỳ batch nào. Dùng lại
từng proof đã PASS khi các source/config/schema liên quan và đường gọi thật
vẫn tương thích. Đừng chạy lại cả suite vì đổi tài liệu, code verifier hay
một ca lỗi. Chạy đúng ca chưa có proof hoặc ca đã lỗi sau khi sửa. Nếu một
sửa đổi làm mất hiệu lực proof, bổ sung ca hẹp nhất cho phần thực sự thay đổi
và ghi lý do, không chạy lại các phần độc lập. Có thể dựng runtime mới, seed
fixture và import các bản sao workflow để tạo tiền đề cho ca còn thiếu.
Không tính thao tác setup mở đường là bằng chứng nghiệm thu mới. Giữ FAIL,
SKIP, UNKNOWN, không resume marker cũ và không biến chúng thành PASS.

Đọc trạng thái repo và các receipt dưới .local/automation. Phiên đã có
snapshots n8n06-20261115T172538-036c38e6 và n8n06-resume-a450a0199eb5.
Source hiện có cả Class/Org, Enrollment/Payment, IAM/Notification, Gateway,
Portal, canonical WF08–10 inactive, adjustment-manifest.json và harness
test-n8n06.mjs. Tiếp tục trên diff hiện có, không viết lại hoặc khôi phục prompt
cũ. Baseline đầu phiên đã đối chiếu 312 hash N8N05. Kiểm bảo toàn sau sửa đã
xác nhận 117/117 refs N8N05, 19 tệp/checkpoint bảo vệ, gồm WF01–07. Thay đổi
shared source đã được liệt kê trong preservation-current.json của snapshot
resume. Chỉ đối chiếu phần có drift mới trước khi chốt.

Các kết quả có thể đối chiếu để dùng lại:

- N8N02/03: space-agent-automation-test-bd28fd199763/evidence.json PASS,
  11 ca DB/broker/IAM, 13 ca delegation/lease và các smoke n8n thật.
  SHA-256 2961c14b2fb4500e60b8f94f84df445aea23930ba3d8117957dfc620f5a7f3a4.
  Cả 24 source hashes trong receipt khớp khi lập prompt.
- N8N04: space-agent-automation-test-806f27e847c5/evidence.json PASS,
  27 mục, gồm Conversation, browser 1440/768/390, synthetic quota/timeout/
  tool error và revoke/rotate. Harness dùng bản sao Portal đã build với env
  allowlist, không dùng model/provider. 50 source hashes trong receipt khớp.
  SHA-256 95df418b6ad07d399d47731238ad7084859be4fa5ac51da92b7470d7c44d30d8.
- N8N05: space-agent-n8n06-acceptance-6bde90d32314/acceptance-cases.json có
  50 PASS, gồm cả browser và physical faults, thêm ca upgrade Enrollment từ
  schema cũ với đơn HELD. SHA-256
  2edc19453f6a05e2c358c99870eefa33f9dc165c6587c22f691aa9d5dc7bcbfa.
  Receipt toàn lượt giữ FAIL vì Get-Acl của PowerShell không đọc được sáu
  đường dẫn dài trong output Next. Project đã down, volume giữ nguyên.
  n8n06-resume-a450a0199eb5/regression-registration-acl-recheck.json đã kiểm
  độc lập 1.398 mục, 0 ACL ngoài allowlist, dùng đường dẫn Windows mở rộng.
  Đọc hai receipt cùng nhau. Đừng chạy lại 50 ca để đổi nhãn FAIL của lượt cũ.
  Danh sách drift so với preflight chỉ có scripts/n8n06-cases.mjs,
  scripts/n8n06-runtime.mjs và app/login/page.tsx (thêm link học viên).
- N8N06 chẩn đoán 1: space-agent-n8n06-acceptance-b5304dae0a44 có 15 PASS,
  gồm OTP, ownership, consent/dedup, mailbox thật và bốn lỗi adapter. Ca
  WF10-CLASS-VERSION-ORDER FAIL do ECONNABORTED bị phân loại DEAD. Generator
  đã sửa phân loại lỗi mạng sang retry có lookup. Receipt này có drift
  source, nhất là Notification có thêm cập nhật membership khi chuyển lớp.
  Dùng làm chẩn đoán và chỉ kế thừa các ca có closure được chứng minh.
- N8N06 lượt 2: space-agent-n8n06-acceptance-82f36f0beba1 có 8 PASS. Đã qua
  migration fresh/upgrade, import WF08–10, hủy lớp manual, chuyển lớp tự
  động và WF09-SIGKILL-AFTER-COMMIT. Ca cuối chứng minh target đã commit
  trước khi kill n8n, nguồn còn giữ tại điểm ngắt, recovery cùng job nhả
  nguồn mà không mất quyền lợi. SHA-256 acceptance-cases.json
  96f5616eec0e62c111b72ba62df3789e77521ff52c270edb6b5519cd914244d2.
  WF10-SIGKILL-AFTER-MAIL FAIL vì proxy chưa cho qua POST deadlines của cron,
  nên chưa đến điểm gửi thật. Proxy đã sửa whitelist đúng route, chưa chạy
  lại ca này. Delta từ preflight là hai script harness nêu trên và link
  học viên. Lượt này đã cleanup, ACL PASS.
- Focused suite tại n8n06-resume-a450a0199eb5/focused-suite.log có 40 test
  PASS, 13 test IAM DB skip ở lượt unit. Không coi 13 skip là PASS. Portal
  lint và fixture no-personal-env đã qua. Hệ thống N8N05/N8N04 browser đã
  chạy với backend thật. Chưa có proof browser N8N06 cho app/student và
  màn hình nhân viên mới.

Việc cần làm tiếp, theo thứ tự:

1. Đọc checkpoint, matrix và các receipt nói trên. So với source hiện tại,
   ghim danh sách case proof dùng lại và case còn thiếu. Nếu Docker đang
   tắt, được bật Desktop để dựng project test mới; đừng chạm process/queue/
   DB/volume của người dùng hay các N8N đã nghiệm thu.
2. Thêm cách chọn case cần chạy trong scripts/test-n8n06.mjs và
   scripts/n8n06-cases.mjs nếu cần. Harness hiện có --n8n06-only và
   --regression-only, nhưng cả hai vẫn chạy nhiều ca đã có proof. Không
   dùng hai lệnh đó như batch lặp mặc định. Dùng `stagePortal` và ACL Windows
   mở rộng đã sửa. Có một lần `next typegen` trong phiên này đã gọi trình
   nạp env khi `.env.local` tồn tại. Giữ sự cố trong hồ sơ theo bàn giao.
   Mọi lần sinh type/build/start sau đó dùng bản sao Portal chỉ gồm source,
   allowlist env và preload no-personal-env.cjs đến worker.
3. Chạy ca physical kill WF10 sau mailbox commit, kiểm retry/lookup và
   receipt + Portal message đúng một bản. Kiểm lại ca đổi lịch gặp lỗi
   transport, cộng ca mới về membership sau chuyển lớp và nhắc lịch cũ.
   Chạy riêng các ca WF08/WF09/WF10 còn thiếu trong n8n06-class-cases.mjs,
   n8n06-adjustment-cases.mjs và n8n06-notification-cases.mjs. Tập trung
   class plan có quyền lợi/chờ lựa chọn, teacher leave race, minimum/makeup,
   cancel-vs-registration, khoản hoàn/cap/reserved/UNKNOWN, delta chuyển
   lớp, suspension/resume, waitlist và tranh chỗ cuối. Bổ sung ca hẹp nếu
   matrix còn thiếu proof về refund UNKNOWN, revoke hay giá chênh lệch.
4. Hoàn tất kiểm Portal mới bằng trình duyệt thật 1440/768/390. Xác nhận
   tài khoản thật trên IAM test, lựa chọn/duyệt đúng vai trò, readback sau
   reload, OTP và link lớp/hóa đơn có ownership. N8N05 browser đã có proof;
   với link đăng nhập học viên mới chỉ kiểm riêng điều hướng và luồng mới.
5. Review connected callers và harness bằng ponytail-review, sửa các lỗi
   chặn rồi chỉ chạy phần bị ảnh hưởng. Đối chiếu source/schema/config,
   case IDs, DB effects, traces, operation keys và hashes. Cleanup project,
   process, port của đúng lượt chạy, giữ raw artifacts/volume với private
   ACL. Ghi evidence index riêng tại workflows/n8n/adjustment-evidence.json,
   cập nhật matrix, bàn giao, readiness và checkpoint riêng. Index công
   khai chỉ metadata/refs/hashes, không chứa OTP/token/raw payload.

Tự chốt ACCEPT_LOCAL khi tất cả yêu cầu gốc có proof hợp lệ trên source
cuối hoặc được kế thừa có căn cứ, các lỗi authority/tiền/chỗ/delivery đã
sửa, và isolation/ACL/hồ sơ đạt. Nếu còn thiếu proof thì tiếp tục làm rõ
hoặc kiểm đúng phần đó. Khi thực sự không còn cách tiếp tục trong quyền
đã cấp, ghi NOT_ACCEPTED với bằng chứng và điều kiện gỡ. Báo cáo ngắn gọn
việc mới chạy, proof dùng lại, trạng thái cuối, link hồ sơ và gate live.
```
