# Bàn giao N8N-02 — Automation Bridge

Ngày 04/11/2026, Asia/Ho_Chi_Minh. Người thực hiện: Codex trong workspace local;
người chính/reviewer con người: chưa review. Theo [plan v3](product-plan-v3.md),
[phân công](phan-cong-task-v3.md), [contract workflow](n8n-workflows.md) và
[baseline runtime N8N-01](ban-giao-n8n-01.md).

Trạng thái: **LOCAL — acceptance kỹ thuật N8N-02 đạt**, chưa phải triển khai production
hoặc nghiệm thu N8N-03/WF-01–12. Bridge không được cấp quyền nghiệp vụ bằng test authority.

## Artifact và phạm vi

- [Service và runbook đầy đủ](../services/automation-bridge/README.md), [migration DB riêng](../services/automation-bridge/migrations/0001.sql), [config mẫu không secret](../services/automation-bridge/.env.example).
- [Contract Zod](../packages/contracts/src/automation.ts), EventEnvelope mở rộng optional causation/entity tương thích dữ liệu cũ; `receiveEvent` dùng được với PoolClient để commit inbox/job cùng transaction.
- [Integration tests thật](../services/automation-bridge/src/postgres.test.ts), [harness chạy lại](../scripts/test-automation.mjs), [Compose test](../infra/automation/compose.test.yml).
- [Workflow n8n import được](../workflows/n8n/bridge-smoke.json), [manifest](../workflows/n8n/bridge-manifest.json), [receipt/checksum đã che](../workflows/n8n/bridge-evidence.json).

Đã có inbox/job dedup transactional, atomic claim với capacity 2, lease 60 giây, owner/token/attempt/
version fencing, checkpoint/intent/operation receipts, result, WAITING/wakeup durable, retry hữu hạn,
DEAD và replay có IAM role hiện hành/lý do/CAS/audit. workflowVersion và operation keys giữ qua
recovery/retry/replay. Không có SQL nghiệp vụ, LLM/provider hoặc saga thứ hai.

Mọi endpoint Bridge chạy trực tiếp trong mạng nội bộ. Không thêm route/target vào Gateway/BFF.
Default `npm run dev` loại Bridge chưa cấu hình; service chạy riêng theo runbook, không buộc stack cũ
phải có `.env` Bridge để khởi động. Không sửa/xóa `.env`, DB, volume hoặc workflow runtime N8N-01.

## Expected và actual

Expected: chạy thực tế đủ bảy ca yêu cầu trên DB/broker/n8n thật, chặn quyền bằng middleware thật,
giữ recovery state ngoài execution n8n và cung cấp receipt chạy lại được.

Actual: **11/11 integration tests PASS**, thêm workflow smoke HTTP n8n thật PASS. Lượt chốt chạy
**14:22:12–14:23:02 ngày 04/11/2026 (+07:00)**, project `space-agent-automation-test-6a377fd30014`,
n8n execution **1**, job `5ef89b2e-df27-4255-b66d-2db27a8262e4` kết thúc DONE. Runtime/version,
project, giờ UTC, job/event/correlation IDs, execution ID và SHA-256 chính xác nằm trong
[receipt](../workflows/n8n/bridge-evidence.json). Đây là source tree chưa commit; sourceCommit chỉ là
HEAD nền, checksum artifact xác định code đã chạy.

| Ca nghiệm thu | Kết quả thực tế |
| --- | --- |
| 1. Event trùng chỉ một job | Hai ingest đồng thời và RabbitMQ redelivery cùng ID chỉ một job; ID đổi nội dung bị chặn; input lỗi rollback inbox lẫn job; deploy mapping v2 không đổi job v1 |
| 2. Hai worker tranh claim | Hai HTTP request với hai machine subject, chỉ một response có lease; subject còn lại không checkpoint được; ba claim cạnh tranh chỉ cấp tối đa hai lease |
| 3. Worker hết lease | Checkpoint/result trả 409 trước cả maintenance; sau recovery/reclaim, attempt/token cũ vẫn 409; version cũ và result vào job DONE cũng 409 |
| 4. Restart Bridge | SIGKILL tiến trình Bridge thật rồi start lại cùng DB; step, operationId/key còn nguyên; lease hết hạn thành RETRY, claim mới tiếp tục cùng job với attempt tăng |
| 5. Event đến sớm | Event đã commit trước WAITING wake ngay; đăng ký WAITING đồng thời event cũng wake; event chỉ dùng một lần/job; sai entity/correlation không wake; deadline vẫn wake sau restart |
| 6. Replay có quyền/lý do/audit | Không phiên 401; machine token không thay phiên IAM; admissions 403; thiếu lý do 400; IAM đổi role/thu hồi phiên chặn token cũ; center hợp lệ giữ ID/version/operation keys, audit đúng actor/reason; replay kép 409 |
| 7. Smoke n8n | JSON import vào n8n test 2.46.4, execution thật qua HTTP claim → checkpoint → result; result DONE, operationKey ổn định và DB audit đúng CLAIM/CHECKPOINT/DONE |

Các kiểm tra bổ sung: migrate hai lần chỉ một migration; role Bridge không superuser/createdb/
createrole và không CONNECT được IAM DB; Retry-After được tôn trọng, lần lỗi kỹ thuật thứ tám DEAD,
DEAD audit một lần; human wait không tăng failureCount. Token sai audience/scope/workflow/subject,
hết hạn hoặc TTL >300 giây bị chặn; không cấu hình machine authority trả 503. Gateway trả 404 cho
internal Bridge và automation prefix dù caller có phiên hợp lệ. OperationId đã lưu không được thay.

`attempt` là fencing counter tăng theo lease issuance; `failureCount` là ngân sách retry kỹ thuật
tối đa 8, reset khi replay có quyền. Phân biệt này giữ human wait không tiêu ngân sách mà vẫn chặn
worker cũ. WAITING match event theo type/entityId/correlationId và ledger event đã dùng cho từng job.

Kiểm tra workspace: đã chạy lint/typecheck/test/build toàn workspace, 60/60 task thành công
(có cache; suite DB cũ có skip). Sau thay đổi cuối, nhóm Bridge và dependency được chạy lại:
**28/28 task thành công**. Hai contract tests của Bridge PASS; `node --check scripts/test-automation.mjs`
và `git diff --check` PASS. Dry-run task graph xác nhận default dev không chạy Bridge.

Smoke đầu tiên có 11/11 integration PASS nhưng n8n checkpoint lỗi parser `jsonBody`; đã sửa dấu cách
trong biểu thức object lồng và chạy lại thành công, không bỏ node/check hoặc tắt auth. Lần FAIL giữ
trong `.local/automation/space-agent-automation-test-cc5552bd6a7c/`, không dùng làm receipt PASS.

## Môi trường và bảo toàn runtime cũ

Mỗi lượt harness tạo project/volume/key/password mới; Bridge DB và IAM DB mới trong PostgreSQL test,
n8n ở PostgreSQL container riêng, RabbitMQ riêng. Không đọc `.env` trong command test. n8n main
`space-agent-n8n-n8n-1` và PostgreSQL main vẫn healthy sau kiểm tra, StartedAt lần lượt
`2026-11-04T06:44:51.980215998Z` và `2026-11-04T06:44:46.213458074Z`, trước mọi lượt N8N-02;
không restart/recreate chúng. Các project test đã `down` và giữ volume; không dùng `down -v`/prune.

Receipt public chỉ có synthetic refs/IDs/checksums. Full execution, env, test private key và credential
input giữ trong `.local/automation/<project>/` bị gitignore, không đưa vào repo. NTFS ACL cần bảo vệ
artifact riêng. Ngày/giờ và versions là actual của lượt chạy, không phải SLA hoặc chứng minh production.

## Dependency, kiểm tra chưa chạy và giới hạn

**N8N-03 còn thiếu:** IAM cấp/rotate machine principal và job/audience/scope-bound command token,
machine introspection/revocation, context/delegation hiện hành, backend kiểm branch/ownership/
confirmation/approval trước tác động. Claim N8N-02 trả contextRef/inputRef, không tự mint token gọi
nghiệp vụ. Bridge verifier RS256 chỉ có public key; thiếu authority fail closed. Khóa ký authority test
chỉ là fixture biệt lập, không tạo issuer endpoint hoặc role center_director dùng chung cho n8n.
Replay dùng IAM thật hiện có với live session/role; không mock allow-all để test xanh.

Chưa triển khai/chạy: WF-01–12, SW-API/SW-ERROR/SW-NOTIFY, command lookup/idempotency ở service
nguồn, business confirmation/compensation, Portal Operations, notification DEAD email, API redrive
Bridge DLQ, VPS/HTTPS, tải lớn/multi-host benchmark, full backup/restore/RPO/RTO, pruning 7 ngày.
Không tái chạy các suite DB toàn phần Catalog/Class/CRM/IAM cũ hoặc browser; unit workspace có
Catalog **21** và IAM **13** test DB bị skip, không tính là PASS DB. DB tests messaging mặc định có
skip khi thiếu URL, không coi chúng là nghiệm thu reliability toàn hệ thống.

Test recovery/backoff đặt timestamp trong DB test để kiểm điều kiện; chưa chờ lease/backoff dài bằng
wall clock. Advisory lock bảo vệ scheduler transaction ngắn ở quy mô local, chưa đo throughput lớn.
Không có workflow nghiệp vụ được bật trong config mặc định. Không dùng kết quả này để bỏ gate N8N-03.

Chạy lại và vận hành/replay/backup: theo [runbook Bridge](../services/automation-bridge/README.md).
## Ghi chú kế thừa N8N-03

Bằng chứng N8N-02 bên dưới là receipt lịch sử. Regression hiện tại vẫn giữ 11 ca
và claim/checkpoint/result contract; token hợp lệ nay được IAM HTTP cấp và Bridge
bắt buộc live introspection. Xem [bàn giao N8N-03](ban-giao-n8n-03.md) và
[runbook hiện hành](../services/automation-bridge/README.md#n8n-03-machine-authority-and-delegation).
Không dùng private test signer của receipt cũ làm runtime authority.

