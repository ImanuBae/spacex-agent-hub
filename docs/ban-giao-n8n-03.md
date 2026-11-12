# Bàn giao N8N-03 — IAM machine authority và lát cắt đọc

## Hiện hành — 12/11/2026 (+07:00)

**Agent Codex: ACCEPT cho phạm vi kỹ thuật local tổng hợp của N8N-03.**
[Acceptance matrix và kết quả chung](acceptance-n8n-03-04.md) là nơi giữ trạng thái
hiện hành. N8N-03 nay có command nghiệp vụ thực `classes.cancel`, ngoài luồng đọc.
Không mở Enrollment/Payment, giao dịch thật, production hoặc WF-04–12.

- Regression mới: Bridge **11/11**, IAM/delegation/read **12/12**, hai smoke n8n;
  receipt `.local/automation/space-agent-automation-test-2fd80f12754b/evidence.json`.
- Command mới: **19/19 PASS, 0 SKIP**, Class/IAM/Bridge/PostgreSQL/RabbitMQ/n8n
  thật; receipt `.local/automation/space-agent-n8n04-acceptance-4237338275fa/evidence.json`.
  Có 11 source hashes và execution n8n **1**. Hai lượt FAIL trước đó được giữ nguyên.
- Confirmation được Class tạo sau phiên IAM thật, gắn actor/session/branch/class/
  version/payload, TTL 5 phút. Một branch director khác phê duyệt một lần; n8n
  không được truyền actor, role, confirmation hoặc approval tự khai.
- Event approval được ghi trong outbox của Class rồi chuyển qua RabbitMQ/Bridge.
  Job cố định `WF-CLASS-CANCEL` v1, operation `classes.cancel`; token target 30 giây
  phải qua live IAM và Bridge. Workflow smoke dùng bản sao inactive, không activate.
- Transaction Class khóa resource/confirmation, kiểm version và trạng thái, cấm
  hủy lớp có chỗ COMMITTED; dùng lại logic hủy holds/sessions của API hiện hữu.
  Kiểm lại IAM/Bridge và phiên approver khi đang giữ khóa, rồi consume confirmation,
  đổi trạng thái, lưu status change/audit/outbox/result trong cùng transaction.
- Hai execute đồng thời cùng operation trả cùng kết quả: một lần đổi trạng thái,
  một audit và một outbox. DONE/attempt cũ/lease hết hạn/resource hoặc payload hoặc
  branch hoặc workflow khác đều bị chặn; revoke trong lúc chờ khóa cũng rollback.
- Operation lookup thuộc Class, dùng request ID; không thay semantics API
  `/api/v1/operations` vốn là messaging. Khi mất kết quả, tra lookup trước quyết định
  tiếp theo; không tạo key/request mới hoặc retry mù command.

IAM và Class/Bridge là các DB riêng. Kiểm quyền cuối trong transaction Class không
là atomic transaction xuyên DB và không hủy một thao tác đã được chấp nhận trước
thu hồi. Các ca race xác minh thu hồi trong lúc chờ khóa, không chứng minh mọi thứ
tự tuyến tính hóa giữa nhiều DB. Rollout tiền/chỗ thật vẫn phải có acceptance riêng.

Chạy lại và API: [Class cancellation runbook](../services/class-schedule/README.md#n8n-03-confirmed-and-approved-cancellation).
Các mục 04/11 bên dưới là lịch sử; nhận định command chưa tồn tại không còn hiện hành.

Kế thừa 08/11: [N8N-04](ban-giao-n8n-04.md) bổ sung source context cho khách và chạy
lại acceptance N8N-02/N8N-03. Phần bên dưới là receipt lịch sử 04/11; giới hạn
Conversation chưa tồn tại tại thời điểm đó không mô tả trạng thái code hiện tại.

Ngày **04/11/2026**, Asia/Ho_Chi_Minh. Đã triển khai/kiểm chứng LOCAL phần machine
principal, delegation, thu hồi và đọc Catalog/Class. Ticket rộng N8N-03 giữ
**PARTIAL**: confirmation/approval cho command nghiệp vụ còn dependency ở service
chưa tồn tại; chúng tiếp tục fail-closed. Không bật WF-01–12, không triển khai
Enrollment/Payment, không dùng kết quả này để tuyên bố sẵn sàng production.

## Thay đổi và ranh giới quyền

- IAM cấp machine identity có secret scrypt hash, grants theo audience/scope/workflow;
  RS256 token TTL tối đa 300s, rotate/revoke có audit. Chỉ IAM giữ private key.
- Bridge giữ public key IAM và bắt buộc live IAM introspection cho mọi internal
  request. Không có test-authority runtime fallback; token smoke hợp lệ được cấp
  bởi API IAM thật, không do script ký thay IAM.
- IAM tạo context từ phiên người khởi tạo đã xác minh; actor/role/session lấy từ
  IAM, branch được kiểm theo quyền. Context gắn eventId/workflow/version/entity/
  inputRef và chỉ cho phép `catalog.read`, `classes.read`. n8n không tạo context
  bằng machine token, không truyền actor/role/branch/approval để tự nâng quyền.
- Checkpoint intent trước authorize. IAM hỏi Bridge qua URL nội bộ cấu hình cố định
  để kiểm owner/workflow/operation/leaseToken/attempt còn hiệu lực. Token command
  30s gắn đúng job và operation; khi sử dụng API đích lại hỏi IAM và kiểm lease
  hiện hành ở Bridge. Hết lease/attempt cũ/DONE đều bị chặn dù JWT chưa hết hạn.
- Catalog áp branch từ context trong SQL, chỉ active offers; Class dùng branch và
  teacher ownership hiện hành trong DB của nó. Center-director delegation vẫn bị
  giới hạn đúng branch context. Không đưa internal API hoặc replay vào Gateway.
- N8N-02 giữ ingress, claim/checkpoint/result/replay và operation-key semantics.
  Yêu cầu JWT mở rộng `kind/jti/credentialVersion` và live IAM là chủ đích của
  N8N-03: fixture JWT của receipt cũ không còn đủ để vận hành.

Contract: [machine.ts](../packages/contracts/src/machine.ts),
[automation.ts](../packages/contracts/src/automation.ts).
Provision/rotate/revoke, cấu hình, gọi API, recovery và giới hạn:
[runbook Bridge/IAM](../services/automation-bridge/README.md#n8n-03-machine-authority-and-delegation).
Migration IAM mới `0002_machine` không sửa/xóa bảng cũ, chạy lặp lại có version lock.

## Evidence thực tế

Receipt công khai đã che:
[iam-read-evidence.json](../workflows/n8n/iam-read-evidence.json).
Workflow import được:
[iam-read-smoke.json](../workflows/n8n/iam-read-smoke.json),
[manifest/checksum](../workflows/n8n/iam-read-manifest.json).
Regression workflow cũ: [bridge-smoke.json](../workflows/n8n/bridge-smoke.json).

Lượt cuối: **15:20:52–15:22:03 ngày 04/11/2026** (UTC 08:20:52–08:22:03),
project `space-agent-automation-test-df4791da1c62`.
Node **24.2.0**, Docker **29.1.3**, Compose **2.40.3-desktop.1**, PostgreSQL **17.7**,
RabbitMQ **4.3.6**, n8n **2.46.4**; image pin/digest nằm trong receipt.
`sourceCommit` là HEAD nền, workspace đã có thay đổi N8N-01/02 trước task này;
SHA-256 trong `artifacts` định danh các file code thực sự được chạy, không tuyên
bố đây là một commit sạch.

| Yêu cầu | Kết quả thực chạy |
| --- | --- |
| 1. Token IAM đúng audience/scope | PASS: API IAM cấp, Bridge nhận; domain token đọc Catalog courses/packages/quote và Class list/detail thật |
| 2. Chữ ký/audience/scope/expiry/escalation | PASS: sai key, khác audience, sai scope, JWT hết hạn, machine TTL 1s hết hạn bằng wall clock, TTL >300, workflow/scope/field nâng quyền và raw machine domain access bị chặn |
| 3. Giả context/actor/branch và chéo phạm vi | PASS: strict body, context không tồn tại/sai input/entity/workflow version, khác branch, quote khác branch, teacher không sở hữu lớp; thay teacher owner trong DB thì token cũ mất quyền |
| 4. Thu hồi | PASS: principal revoke, credential rotate, context revoke, live branch removal, logout, API IAM access change và account disable; session cũ không được phục hồi khi bật lại account |
| 5. Lease/attempt | PASS: thiếu intent, lease hết hạn trước recovery, attempt cũ sau reclaim và job DONE đều không cấp/dùng được authorization |
| 6. Smoke thật | PASS: n8n → Bridge authorize → IAM issuer/introspection → Catalog/Class → Bridge DONE; không mock endpoint nghiệp vụ |
| 7. Regression N8N-02 | PASS **11/11** integration cùng smoke claim/checkpoint/result thật với token IAM |

Acceptance N8N-03 **12/12 PASS**, **0 skipped**; N8N-02 **11/11 PASS**, **0 skipped**.
Các ca bổ sung kiểm IAM/Bridge unavailable → 503, thiếu authority → 503, máy không
ghi API và Gateway không forward internal routes.

Smoke N8N-02 execution **1**, job `b585de19-0e75-42d8-9333-25583389e695`, audit
`CLAIM → CHECKPOINT → DONE`. Smoke N8N-03 execution **2**, job
`3d9d3fa3-98b9-4097-b112-cae036e69483`, trả **1 khóa + 2 lớp đúng branch** và
DB job **DONE**. Backend fixture có nhãn tổng hợp, không phải dữ liệu khách hàng.
Full execution chứa token/lease chỉ ở thư mục private bị gitignore.

`npm run check`: **60/60 task PASS**, có 31 cache hits; lint/typecheck/test/build
toàn workspace. Unit/contract Bridge **3/3 PASS**. Lệnh check mặc định skip **21
Catalog DB + 13 IAM stage-1 DB tests** và không chạy full Class/CRM/messaging DB
acceptance; không tính các skip đó là PASS DB. Acceptance mới ở trên dùng DB thật
riêng và không được phép skip. `node --check scripts/test-automation.mjs` và kiểm
diff/checksum/link được ghi ở receipt bảo toàn kèm evidence.

## Cơ chế và độ trễ thu hồi

Không cache allow: sau khi revoke/rotate/access/status/logout commit và API trả về,
request kế tiếp kiểm lại IAM DB; domain request còn kiểm lại Bridge DB. Bảng đo từ
lúc **API/transaction thu hồi đã trả về** đến khi **request thử kế tiếp trả deny**;
đây là latency request LOCAL quan sát được, không phải upper bound production hay
một benchmark phân phối. Không có khoảng chờ TTL 300s trước khi thu hồi hiệu lực.

| Thu hồi | Request kế tiếp trả deny sau | HTTP |
| --- | ---: | ---: |
| Rotate machine credential | 5,20 ms | 401 |
| Revoke context | 15,75 ms | 403 |
| Bỏ branch hiện hành (DB fixture) | 31,78 ms | 403 |
| Logout phiên khởi tạo | 23,29 ms | 403 |
| API IAM đổi access | 21,44 ms | 403 |
| API IAM disable account | 13,53 ms | 403 |
| Revoke machine principal | 3,59 ms | 401 |

Ca đổi access gọi API IAM thật để đổi tài khoản fixture sang center_director không
branch, nên không cần Org stub/bypass; API thu hồi các phiên cũ ngay cả khi quyền
mới cao hơn. Phục hồi fixture cho ca sau không phục hồi session cũ. Ca bỏ branch
bằng DB chỉ tác động IAM test để kiểm riêng quyền hiện hành, ngoài hai ca API thật.

Read đã được nhận trước thu hồi không bị hủy giữa chừng. Không có atomic fencing
giữa introspection và commit nghiệp vụ khác service trong lát cắt đọc này. Command
tiền/chỗ sau này phải kiểm business version/idempotency/quyền tại commit boundary;
không dùng receipt đọc để mở command. Test lease/backoff đặt timestamp ở DB test;
chưa chờ wall clock hết toàn bộ lease 60s. Expiry token máy 1s có chờ wall clock.

## Bảo toàn môi trường và chạy lại

Harness không load/ghi `.env`, không kết nối DB demo hiện có. Mỗi lượt tạo project,
volume, mật khẩu, key mới; DB/user IAM, Bridge, Catalog, Class tách CONNECT; n8n có
PostgreSQL riêng. Migrate mỗi service hai lần. Test process gọi trực tiếp API/DB
test; n8n chỉ nhận machine token. Dừng đúng project test bằng `down`, giữ volume,
không `down -v`, prune hoặc restart runtime cũ.

Đối chiếu bảo toàn nằm trong phần `preservation` của receipt công khai: hash sáu
`.env` cá nhân không đổi; n8n/PostgreSQL N8N-01 healthy và StartedAt vẫn lần lượt
`2026-11-04T06:44:51.980215998Z`, `2026-11-04T06:44:46.213458074Z`.

Chạy lại từ root sau build theo [runbook](../services/automation-bridge/README.md):

```powershell
npm run check
npm run test:automation
```

Log, secret, IAM private test key, credential input, báo cáo Vitest và full
execution: `.local/automation/space-agent-automation-test-df4791da1c62/`.
Receipt FAIL đầu tiên `space-agent-automation-test-f7b2f9da5f69` giữ lại: setup
fixture PostgreSQL dùng cùng parameter UUID/text không cast nên chưa chạy ca
N8N-03; đã sửa fixture và chạy lại. Lượt giữa `05412851e92b` PASS 10 ca + hai
smoke; lượt cuối ở trên thêm unavailable/access/status và PASS 12 ca. Không dùng
receipt lỗi hoặc ca skipped để cộng acceptance. NTFS ACL vẫn do operator bảo vệ.

## Dependency và phần chưa làm

- **Confirmation/approval**: Conversation/Enrollment/Payment phải có record nguồn,
  owner/branch/version/expiry và API command/operation lookup/idempotency. Chưa có
  service/API đó; enum chỉ cho read, approval/confirmation tự khai bị reject. Ticket
  tổng giữ PARTIAL và guard command vẫn BLOCKED/fail-closed.
- **N8N-04**: nguồn context/event từ Channel/Conversation, khách không có phiên
  nhân viên, service/system actor policy và automatic machine credential renewal
  phải được triển khai/acceptance riêng. Hiện chỉ verified human-initiated reads.
- Class delegation chưa hỗ trợ `sellable=true` vì đường hiện hữu dùng token caller
  gọi tiếp Catalog; scoped cross-service exchange chưa có. Đọc Catalog/quote và
  Class riêng rồi đối chiếu course/package; không coi available là quyền mua/hold.
- Refresh IAM thu hồi session cũ; delegation không chuyển sang session mới, cũng
  không được replay sửa context để vượt kiểm tra. Cần khởi tạo lại qua backend.
- Chưa chạy full DB/browser regression cũ, VPS/HTTPS, tải/multi-host, distributed
  transaction/money/seat race, key rollover không gián đoạn, backup/restore/RPO/RTO.
  WF-01–12, Enrollment/Payment, Portal Operations và provider giữ ngoài task này.
