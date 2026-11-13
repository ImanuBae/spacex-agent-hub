# Prompt triển khai N8N-05 đến N8N-08 theo dependency

Khuyến nghị: **N8N-05 và phần hạ tầng local của N8N-08 bắt đầu trước**. N8N-06
có thể xây Notification, N8N-07 có thể xây Reporting/import cho các nguồn đã có;
phần quyền lợi/thanh toán/xóa xuyên service chỉ tích hợp sau khi API tương ứng
được triển khai và kiểm. Không cần chờ benchmark N8N-04 cho các phần độc lập.

| Luồng | Có thể bắt đầu | Phần phải chờ dependency |
| --- | --- | --- |
| N8N-05 / WF-04–07 | CRM identity/consent/lead/merge theo quyền; Enrollment confirmation/snapshot và Class hold, rồi Payment | Chỉ xử lý matched/confirm/exception khi Payment và Enrollment thật đã có; không đóng toàn ticket chỉ bằng CRM |
| N8N-06 / WF-08–10 | Notification intent/dedup/receipt với mail sink local; phần lịch/approval có API thật | Refund/transfer/suspend/waitlist, quyền lợi và invoice cần các API Enrollment/Payment tương ứng |
| N8N-07 / WF-11–12 | Reporting event store/checkpoint, rebuild, import dry-run cho nguồn hiện có; recovery từ Bridge | Chỉ số tiền/quyền lợi và erasure proof toàn hệ thống cần từng nguồn/target thực |
| N8N-08 / hạ tầng, restore, evidence | Inventory, runtime isolation, backup/restore local, registry và kiểm lỗi hạ tầng | Nghiệm thu cuối cần bản tích hợp và evidence N8N-02–07; VPS/HTTPS/kênh/provider thật cần quyền và đầu vào riêng |

Nếu chỉ mở hai session: dùng **N8N-05 làm điều phối/tích hợp**, session thứ hai
làm **N8N-08 local**. Khi contract đã rõ và đủ tài nguyên mới thêm N8N-06/07 vào
các phần độc lập. Không cho nhiều session sửa/build cùng checkout.

## Prompt điều phối toàn bộ N8N-05–08

Dán khối dưới vào một session làm đầu mối. Session đó có thể giao subagent cho
phần độc lập hoặc điều phối các session riêng theo các lệnh ngắn ở cuối tài liệu.

```text
Làm việc tại D:\Imanu\Study\space-agent-hub.

Tôi giao bạn triển khai các phần còn thiếu của N8N-05, N8N-06, N8N-07 và N8N-08
theo phạm vi/acceptance của dự án. Làm đến khi đạt các tiêu chí được phép kiểm
hoặc còn blocker bên ngoài thực sự; không chỉ lập kế hoạch/readiness/skeleton.
Đây là nhiệm vụ mới cho N8N-05–08, mở rộng phạm vi rà soát trước đây, được triển
khai WF-04–12 trong môi trường test local có dữ liệu tổng hợp.

N8N-04 được xử lý riêng. Không tiêu quota model, đọc OpenRouter key, chạy benchmark
hoặc thay trạng thái/evidence của N8N-04 trong nhiệm vụ này. N8N-03 giữ ACCEPT theo
source/evidence hiện hành; sửa authority/contracts thì kiểm lại phần ảnh hưởng.
Không suy nhiệm vụ này thành quyền dùng khách thật, paid API, giao dịch thật,
production, VPS/domain trả phí hoặc gửi email/tin nhắn/ticket ra bên ngoài.

1. ĐỌC BASELINE VÀ XÁC ĐỊNH ACCEPTANCE

Đọc AGENTS.md ở root và thư mục liên quan. Áp dụng karpathy-guidelines bản project,
Ponytail full và ponytail-review trước nghiệm thu; dùng Playwright khi kiểm browser.
Đọc bundled docs của Turbo trước khi thay cấu hình/lệnh Turbo.

Đọc docs/product-plan-v3.md, docs/phan-cong-task-v3.md, docs/n8n-workflows.md,
docs/n8n-readiness.md; README/contracts/migrations/callers/tests của IAM, Bridge,
Conversation, CRM, Catalog, Class, Org và packages/messaging. Đọc các bàn giao
liên quan, đặc biệt docs/ban-giao-lop-giu-cho.md, ban-giao-crm-2026-11-03.md,
ban-giao-n8n-01.md và acceptance-n8n-03-04.md trong docs.

Kiểm source thực: service/API nào có, contract nào chưa có, chỗ nào mới demo hoặc
chưa nối. Không dùng một snapshot tài liệu thay chứng cứ hiện hành. Lập acceptance
matrix riêng từng ticket/WF với source, dependency, tests/evidence, trạng thái và
phần còn thiếu. Giữ acceptance gốc; phân biệt local tổng hợp với mục tiêu cần
provider/kênh/giao dịch/VPS thật. Không đổi expected hoặc bỏ mục khó để đóng ticket.

2. QUYỀN THỰC HIỆN VÀ GIỚI HẠN

Được tự thiết kế/sửa code, contracts, migrations, API nghiệp vụ còn thiếu, workflow,
generator, harness, caller/Portal và runbook cần cho N8N-05–08. Tái dùng patterns
có sẵn, bổ sung dependency tối thiểu cần thiết, không tự viết lại toàn hệ thống.
Được tự quyết kỹ thuật thường lệ và nghiệm thu kỹ thuật local, ghi reviewer agent.
Không giả chữ ký, approval hoặc sự có mặt của con người.

Được khởi động Docker nếu đang tắt, kéo image đã pin, tạo runtime/network/DB/role/
credential/volume test mới. Được activate WF-04–12 trong runtime test riêng khi
cần kiểm tự động; ghi rõ activation và giữ canonical inactive mặc định. Không
activate/sửa runtime cũ hoặc nối nguồn ingress thật. Giữ version workflow của job
cũ; không publish bản mới rồi âm thầm đổi hành vi job đang chờ.

Dữ liệu tổng hợp có nhãn, chi phí0USD. Không đọc personal env/credential cá nhân,
không mua credit/billing/top-up/paid plugin và không dùng model trong nghiệp vụ
các luồng này. Tạo secret tổng hợp riêng, không đưa key/token/OTP/raw statement
vào execution/public artifacts. Private artifacts giữ ACL current user/Admins/
SYSTEM; không publish hoặc purge khi evidence đang cần đối soát.

Nếu policy nghiệp vụ chưa được chốt và source/plan không suy ra được, nêu đúng
quyết định còn thiếu và tác động, hỏi ngắn gọn trong khi tiếp tục việc độc lập.
Policy demo chỉ áp dụng khi đã có căn cứ/ủy quyền, phải có nhãn/version; không
tự biến policy demo thành điều khoản khách thật hoặc tự duyệt ngoại lệ.

3. CHIA LUỒNG VÀ THỨ TỰ TÍCH HỢP

Bạn được dùng subagents hoặc điều phối nhiều session cho công việc độc lập.
Một đầu mối sở hữu source tích hợp, shared contracts/IAM/Bridge và bảng trạng thái
chính. Lập phân công file/domain trước khi giao việc; ghi rõ ai sở hữu thay đổi
Enrollment/Payment core và ai mở rộng adjustment/reconciliation/invoice/erasure.
Không tạo nhiều service/contract khác nhau cho cùng một domain.

Bắt đầu N8N-05 và N8N-08-local. Chốt contract tối thiểu cần giao nhau trước khi
cho N8N-06/07 viết caller tích hợp; được làm Notification/Reporting thật cho nguồn
đã có trong lúc chờ. Không bắt mọi luồng chờ đóng toàn bộ ticket cha; chỉ cần
đúng contract/API và acceptance của dependency được dùng.

Mỗi luồng ghi code/build trong worktree có overlay dirty đã kiểm hash hoặc bản
làm việc riêng từ source hiện hành. Snapshot phải giữ tracked modifications và
untracked source cần thiết; chỉ lấy HEAD sẽ bỏ mất công việc chưa commit.
Lưu baseline/result hashes và diff để không nhận công việc cũ thành thay đổi mới.
Không sao chép personal env, provider credentials hoặc private evidence. Bản sao
thường không copy .git của source gốc; worktree để Git quản lý metadata của nó.
Không dùng chung node_modules/dist/.next/cache build giữa các bản làm việc.

Tách project Docker/DB/role/credential/volume/ports/process/artifacts từng luồng.
Giới hạn các lượt build/integration/restore nặng theo tài nguyên máy, không đồng
loạt làm nghẽn Engine. Không restart Engine hoặc kill process dùng chung.
Nếu N8N-04 đang live batch trên source chính, các luồng này phải ở bản sao;
không ghi source/output/index bên đó và không chạy kiểm tải/restore nặng cùng lúc.

Tích hợp từng diff sau khi luồng đã lưu evidence và các batch liên quan đã dừng.
Đầu mối review callers/contracts/migrations, giải quyết conflict giữ công việc
người khác, kiểm affected cases trên source tích hợp rồi mới cập nhật trạng thái.
Không gom PASS từ các working copies khác nhau để gọi bản tích hợp đã đạt.

4. N8N-05 — CRM / ENROLLMENT / PAYMENT, WF-04–07

Triển khai theo thứ tự dependency, gồm phần backend thật cần thiết:
- WF-04: identity mapping từ Conversation/Channel đã xác minh, contact/learner/
  payer tách đúng, consent ADMISSIONS hiện hành, lead ownership/claim/version và
  merge plan/approval/conflict/audit theo scope. Không auto-merge vì trùng số;
  tư vấn chung không bị ép marketing. Lát cắt CRM đơn lẻ chưa đóng toàn N8N-05.
- WF-05: confirmation record gắn learner/class/package/quote/terms version tại
  nguồn có thẩm quyền; Enrollment snapshot/state machine/operation lookup, quote
  revalidation, Class hold atomic và Payment request/QR có hạn/idempotency.
  Không có hold không phát QR; giá/TTL/chỗ do backend quyết định. Kết thúc job
  sau khi có kết quả bền, không dùng n8n Wait node làm nguồn sự thật về hạn.
- WF-06: Payment xác minh input, lưu ledger/dedup/match rồi phát event; n8n gọi
  Class commit/lookup và Enrollment transition. Chỉ CONFIRMED sau khi commit
  hợp lệ; thông báo học dựa enrollment.confirmed, không dựa payment.matched.
- WF-07: expiry/cancel/review, tiền muộn/thiếu/thừa/sai mã/hai giao dịch, owner/
  deadline/escalation và phương án có quyền. Không tự kéo hold, xóa ledger hoặc
  gán tiền chỉ vì cùng số tiền; uncertain mutation phải lookup trước retry.

Payment/Enrollment phải là service/API/DB nghiệp vụ thực trong local, không là
stub luôn200. Sender/adapter tổng hợp hoặc QR demo chỉ là đầu vào kiểm có nhãn,
tách khỏi ledger/state machine thật; không tuyên bố đó là SePay/giao dịch thật.
Thiếu credential/quyền provider giữ gate live BLOCKED, tiếp tục đường local thực.
Không phát sinh hoặc giả bằng chứng chuyển khoản bên ngoài.

5. N8N-06 — LỊCH / QUYỀN LỢI / NOTIFICATION, WF-08–10

- WF-08: request/approval ở backend, impact plan theo schedule/class version,
  xử lý hold/committed và Enrollment plan trước apply. Không bỏ guard
  ENROLLMENT_REQUIRED khi quyền lợi chưa được xử lý; giữ lịch sử/snapshot.
- WF-09: refund request/approve/record-execution/lookup có trần và bằng chứng,
  người lập không tự duyệt; transfer chỉ nhả quyền cũ sau khi chốt quyền mới,
  suspension có hạn, waitlist invitation có consent/expiry và tranh chỗ atomic.
  Timeout/bù trừ có adjustment plan bền, không nhả cả hai bên hoặc hoàn lặp.
- WF-10: Notification intent/claim/dedup/receipt/UNKNOWN, kiểm recipient/consent/
  sourceVersion trước gửi; reminder cũ bị supersede. IAM sở hữu OTP hash/expiry/
  rate limit/ownership, không log mã. Invoice mô phỏng có nhãn và kiểm quyền tải.
  Dùng mail sink/adapter local có nhãn; không gửi ra địa chỉ/kênh ngoài. Không
  tuyên bố exactly-once email hoặc provider delivery thật từ kết quả mail sink.

Tái dùng Enrollment/Payment của N8N-05; thay core qua đầu mối tích hợp, không tạo
backend song song khác. API chưa có phải triển khai và kiểm phần thực cần thiết;
không nối stub rồi đóng workflow.

6. N8N-07 — REPORTING / IMPORT / ERASURE / RECOVERY, WF-11–12

- WF-11: Reporting event store/projection/checkpoint/lag, version/order/dedup,
  reconcile qua source APIs và kỳ Asia/Ho_Chi_Minh. Rebuild từ event store hoặc
  snapshot+delta, dry-run/import mapping/approval/apply/rollback có provenance.
  Không cộng lại lead/tiền khi replay; tiền lịch sử không phát payment.received
  giả. Dashboard đọc API thật; không dùng SQL node ghi nhiều DB.
- WF-12: erasure được quản lý xác minh, task/owner/deadline/proof tại từng nơi,
  PROCESSING đến khi đủ kết quả; audit bất biến và nghĩa vụ giữ chứng từ được
  bảo toàn. Backup retention/suppression có proof và được áp dụng khi restore,
  không tuyên bố backup đã xóa khi chưa xử lý. Dữ liệu bị xóa thử chỉ thuộc DB
  tổng hợp riêng có snapshot, không đụng lịch sử evidence hoặc dữ liệu cũ.
- Recovery: DEAD/lease/health alert dedup, operator scope/reason và approval còn
  hiệu lực; tra operation đã commit trước replay, giữ event/operation key để
  không sinh effects mới. Erasure và replay dùng quyền riêng, không sửa audit.

7. N8N-08 — HẠ TẦNG / RESTORE / EVIDENCE FINAL

Làm trước inventory services/DB/broker/key/workflow/credential/version, cấu hình
local pin image, resource/isolation, secret/ACL/retention, runbook và restore plan.
Backup DB+key+jobs/broker theo boundary nhất quán, restore sang runtime test sạch,
chứng minh đọc credential, hội tụ jobs/lookup/replay, money/seat/erasure suppression
và source reconciliation trước khi mở xử lý tiếp. Restart hay giữ volume không
thay clean restore. Có số đo load/RPO/RTO/latency và đối chiếu ngưỡng plan; không
tự đặt ngưỡng dễ hơn để PASS hoặc gọi một budget node là SLA toàn hệ thống.

Kiểm lỗi broker/DB/n8n/provider giả lập có nhãn trên stack mới, không kill runtime
cũ. Khi có bản tích hợp N8N-05–07, chạy final import/version/credential/migration/
recovery và kiểm xuyên luồng trên đúng checksum đó.

Không tự mua VPS/domain, deploy production, liên hệ provider hoặc dùng credential
chưa được cấp. Chuẩn bị cấu hình và gói deploy review được trước khi hỏi quyền
thực hiện bên ngoài. Thiếu VPS/HTTPS hoặc gate live trong acceptance gốc thì ghi
PARTIAL/BLOCKED đúng mục; chỉ nghiệm thu phần local đã kiểm, không hạ scope để
đóng toàn N8N-08. N8N-04 chưa đạt cũng phải phản ánh trong điều kiện final của08,
không dùng gate đó làm lý do ngừng các công việc độc lập đã được giao.

8. ACCEPTANCE CHUNG VÀ ĐẦU RA

Từng lát cắt phải có cả API/DB/n8n thật, ca thành công và từ chối. Kiểm machine
identity/audience/scope/workflow, rotation/revoke/expiry và quyền hiện hành;
actor/session/branch/ownership/consent/confirmation/approval lấy từ backend.
Kiểm version/payload/resource/expiry/revoke, replay/idempotency, last-seat/claim/
commit-expire/adjustment races, crash sau commit trước checkpoint, lỗi dependency.
Fence lease/attempt/job DONE/workflow version/operation intent, lookup uncertain
outcome; đếm đúng business state/result/audit/outbox theo DB transaction sở hữu.
Không tuyên bố atomic xuyên DB hoặc exactly-once provider ngoài quyền quan sát.

Review toàn bộ diff và callers/contracts bằng ponytail-review; chạy kiểm đúng
phần ảnh hưởng trên source tích hợp, kể cả N8N-03/04 nếu shared authority/caller
bị thay. Nếu cần sửa N8N-04 để giữ tương thích, tách diff/giao đầu mối N8N-04 và
kiểm lại theo quyền/ngân sách của luồng đó, không chạy inference ở đây.

Giữ một báo cáo hiện hành N8N-05–08: acceptance matrix từng ticket/WF và agent
ACCEPT/NOT_ACCEPTED hoặc LOCAL/PARTIAL/BLOCKED đúng phạm vi; source/canonical/
manifest/schema hashes, tests thực chạy và expected/actual; job/execution/event/
operation/trace hashes, DB/audit/outbox/ledger/seat outcomes; migration/caller
impact, demo/recovery/restore/load, runtime/ACL/retention/cleanup. Evidence local,
mail sink, Payment tổng hợp và provider/giao dịch thật phải ghi đúng bản chất.
Một lát cắt PASS không tự đóng ticket cha, không dùng tỷ lệ100% khi còn gate.

Preserve workspace dirty và mọi thay đổi ngoài scope; không reset/checkout ghi
đè hoặc tự khôi phục file người dùng xóa. Migration test trên DB mới/bản sao.
Cleanup chỉ process/project test của nhiệm vụ; giữ volumes/artifacts/receipts,
không down-v/prune. Bảo toàn baseline, patch/diff và lịch sử quyết định.

Tự giải quyết lỗi kỹ thuật trong quyền đã cấp; khi blocker thật nêu evidence,
ảnh hưởng, việc đã thử và điều kiện gỡ, tiếp tục phần độc lập. Cập nhật ngắn theo
kết quả quan sát. Không kết thúc ở kế hoạch hoặc stub khi vẫn triển khai/kiểm
được đường thực. Không hứa ngày hoàn tất hoặc tự chạy nền khi chưa có cơ chế.
```

## Nếu giao từng session riêng

Mỗi session đọc **toàn bộ prompt điều phối** và chỉ nhận phần được chỉ định.
Chọn một session N8N-05 làm đầu mối tích hợp; không để cả bốn tự ghi trạng thái
chính hoặc sửa shared source cùng lúc.

**Session N8N-05:**

```text
Đọc docs/prompt-song-song-n8n-05-08.md và thực hiện vai trò N8N-05/đầu mối tích hợp
trong đó. Triển khai WF-04–07 cùng dependency backend thật cần thiết; điều phối
contracts/giao nhau với06/07/08. Không tự nhận PASS cho các phần chưa được giao
hoặc chưa tích hợp. Bắt đầu baseline và lát cắt CRM, rồi Enrollment/Class hold,
Payment và matched/exception theo dependency. Không chỉ dừng ở N8N-05-A.
```

**Session N8N-06:**

```text
Đọc docs/prompt-song-song-n8n-05-08.md và thực hiện vai trò N8N-06 trong đó.
Tạo bản làm việc riêng; phối hợp contract với đầu mối05 trước khi sửa phần dùng
chung. Làm Notification local thực và phần lịch/approval độc lập trước; tích hợp
quyền lợi/refund/transfer/suspend/waitlist khi API Enrollment/Payment đã có proof.
Không tạo backend thay thế của05; giao diff/evidence cho đầu mối tích hợp.
```

**Session N8N-07:**

```text
Đọc docs/prompt-song-song-n8n-05-08.md và thực hiện vai trò N8N-07 trong đó.
Tạo bản làm việc riêng; triển khai Reporting/checkpoint/rebuild/import cho nguồn
đã có và Bridge recovery trước. Nối money metrics và erasure từng target khi
contract/API thật sẵn sàng. Không hoàn tất erasure bằng record task chưa có proof;
giao diff/evidence cho đầu mối tích hợp, giữ dữ liệu/evidence cũ.
```

**Session N8N-08:**

```text
Đọc docs/prompt-song-song-n8n-05-08.md và thực hiện vai trò N8N-08-local trong đó.
Tạo bản làm việc riêng; chuẩn bị inventory/isolation/backup/key/restore/runbook,
kiểm clean restore trên stack hiện có trước, rồi bổ sung dịch vụ05/06/07 đã tích
hợp. Phối hợp lịch test nặng; không ảnh hưởng runtime khác hoặc N8N-04 live batch.
Giữ VPS/HTTPS/provider/rollout thật ngoài quyền hiện tại; ghi rõ gate còn thiếu.
```

Chỉ tạo prompt chưa thay đổi trạng thái nghiệm thu hay khởi chạy các luồng.
Gate bên ngoài vẫn theo [Product Plan](product-plan-v3.md); thiếu gate phải được
ghi đúng, không được thay bằng evidence tổng hợp để đóng ticket.
