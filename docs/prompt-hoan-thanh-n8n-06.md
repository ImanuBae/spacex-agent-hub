# Prompt ủy quyền hoàn thành N8N-06 đến ACCEPT_LOCAL

Ngày soạn: 16/11/2026 (+07:00). Dán nguyên khối dưới vào phiên thực hiện.
Việc lưu prompt này chưa triển khai hoặc nghiệm thu N8N-06.

```text
Làm việc tại D:\Imanu\Study\space-agent-hub.

Tôi giao bạn toàn quyền kỹ thuật, review, chốt policy DEMO và quyết định nghiệm
thu để hoàn thành N8N-06 đến ACCEPT_LOCAL: WF-08/09/10, phê duyệt Portal,
thông báo, quyền lợi và kiểm bù trừ theo acceptance nghiệp vụ của dự án.
Đây là yêu cầu thực hiện trọn vẹn, không chỉ lập kế hoạch hoặc báo cáo tiến độ.

Điều kiện bắt buộc: không làm hỏng, giảm bảo mật, thay đổi semantics trái tương
thích hoặc ảnh hưởng runtime/dữ liệu/evidence của các N8N khác. Bảo toàn các kết
quả đã nghiệm thu, đặc biệt N8N-03/04/05. Không mở N8N-07/08 hoặc WF-11/12.

Bạn là reviewer và người quyết định theo ủy quyền của tôi; ghi đúng vai trò
Codex agent, không giả chữ ký/approval của con người. Không cần tôi duyệt lại
bước kỹ thuật, policy DEMO local hay ký nghiệm thu. Khi đủ proof thì tự chốt
ACCEPT_LOCAL; nếu chưa đủ thì sửa, review và kiểm tiếp. Không dừng ở skeleton,
readiness, lát cắt hoặc “test PASS nhưng chờ người dùng nghiệm thu”.

1. ĐỌC BASELINE, XÁC MINH TRẠNG THÁI VÀ GIỮ PHẠM VI

Đọc AGENTS.md root/thư mục liên quan. Áp dụng karpathy-guidelines bản project,
Ponytail full và ponytail-review. Dùng skill browser khi kiểm trình duyệt và
skill frontend phù hợp khi sửa UI. Đọc bundled docs của Turbo trước khi đổi
cấu hình/lệnh Turbo; đọc docs Next đi kèm bản cài trước khi sửa Next.

Đọc:
- docs/product-plan-v3.md, docs/phan-cong-task-v3.md, docs/n8n-workflows.md:
  N8N-06, toàn bộ WF08–10, hợp đồng job/event, quyền và negative tests.
- docs/product-plan-v2.md: baseline nghiệp vụ/C01–C12 và UAT được v3 kế thừa.
- docs/n8n-readiness.md; phân biệt snapshot cũ với source/evidence hiện tại.
- docs/acceptance-n8n-03-04.md, docs/acceptance-n8n-05.md,
  docs/ban-giao-n8n-05.md và các bàn giao N8N01–04/Class/CRM liên quan.
- workflows/n8n/registration-evidence.json;
  .local/automation/n8n05-closeout-audit/checkpoint.json và final-verification.json;
  .local/automation/n8n05-20261114-baseline/checkpoint.json;
  .local/automation/n8n-completion-5edb68dbbaa2/checkpoint.json.
- README/contracts/migrations/callers/tests của Class/Enrollment/Payment,
  IAM/Org/Gateway/Portal, Bridge/messaging và Channel/Conversation khi bị ảnh hưởng.

Mốc để xác minh, không tự động kế thừa nhãn PASS:
- N8N05 ACCEPT_LOCAL, quyết định2026-11-15T17:13:06.257Z; lượt tích hợp
  .local/automation/space-agent-n8n05-acceptance-2b18def65d0e PASS49/49,
  gồm n8n thật, automatic triggers, Portal3viewport và hai physical faults.
- Hồ sơ chốt N8N05 kiểm312source hashes,134refs/hashes,162links;
  isolation20project/169port, volume/artifact được giữ, ACL private.
- Các nhóm CRM/Class/Bridge/IAM/N8N03/04 kế thừa phải đối chiếu refs/hash và
  phạm vi. Quality65task là kết quả cache lịch sử, không phải65test mới chạy.
- Model/corpus/prompt/WF01–03 và quyết định N8N03/04 là lịch sử được bảo toàn;
  không chạy lại model/OpenRouter để làm N8N06.

Nếu trạng thái đã đổi, dùng source/evidence mới đã xác minh, không ghi đè bằng
snapshot trên. Tệp prompt/link cũ có thể đã bị người dùng xóa; tìm bản tương ứng
hoặc snapshot đã bảo toàn, ghi rõ nguồn, không khôi phục file người dùng xóa.
Harness mới ghi đường dẫn và hash prompt thực tồn tại, không phụ thuộc prompt cũ.

2. QUYỀN THỰC HIỆN VÀ HÀNG RÀO BẢO TOÀN N8N KHÁC

Được tự sửa code/contracts/migrations/API/callers/Portal, tạo Notification hoặc
phần backend còn thiếu, generator/workflows/harness và tài liệu cần thiết cho
N8N06. Được cài dependency miễn phí thật sự cần; ưu tiên code/pattern hiện có.
Được build/test/review, tạo grant/preflight/marker, secret/DB/runtime test mới,
khởi động Docker Desktop khi cần và activate copy WF08–10 trong runtime test
riêng. Canonical inactive. Không cần xin lại quyền đã cấp.

Trước sửa: git status, snapshot dirty/untracked phần sẽ chạm; lưu source/schema/
manifest/config hashes, receipts/checkpoints và inventory process/runtime/port.
Không reset, checkout ghi đè, xóa evidence, DB/volume, down-v/prune hoặc kill/
restart process của phiên khác. Không commit/push chỉ để gắn nhãn hoàn thành.

Được dùng subagents cho phần độc lập với ownership rõ; không sửa/build chồng
checkout hoặc output. Dùng runtime/network/port/DB/role/queue/consumer/workflowId/
credential namespace riêng. Không chiếm queue, binding hoặc job của N8N khác.
Không ghi migration vào DB đang dùng. Test migration trên DB mới và bản sao
tổng hợp có schema/dữ liệu phiên bản trước, gồm trạng thái N8N05 đang dở.

“Không ảnh hưởng” không có nghĩa cấm mọi sửa shared code: chỉ sửa khi cần,
giữ hợp đồng/quyền/route/event/idempotency cũ tương thích và có affected regression
trên source cuối. Ưu tiên mở rộng có version/route riêng; không đổi nghĩa field,
status, operation key hoặc endpoint cũ một cách ngầm định. Đọc tất cả callers.
Không gỡ ENROLLMENT_REQUIRED hoặc guard cũ để vượt acceptance quyền lợi.

Giữ nguyên receipts/quyết định lịch sử và protected canonical WF01–07, prompt/
model/corpus của N8N04. Không chạy generator mới làm ghi đè WF cũ. Nếu có lỗi
shared bắt buộc cần sửa protected artifact, snapshot/hash bản trước, sửa tối
thiểu, kiểm lại workflow bị ảnh hưởng trên source cuối và tạo receipt tương
thích bổ sung; không tự coi hash mới tương đương hoặc sửa receipt cũ cho khớp.
Không được chốt N8N06 nếu regression do nhiệm vụ tạo còn chưa giải quyết.

Lập dependency/impact matrix N8N01–05 và phần N8N khác có source hiện hữu:
phần không đổi kế thừa sau kiểm hash/rủi ro; phần shared đổi phải kiểm thực.
Các luồng đăng ký N8N05 về confirmation/QR/ledger/hold/commit/expiry/review,
N8N03 về command/delegation và N8N04 về Conversation/browser/fault phải còn đúng.
Kiểm được bằng đường credential-free; không mở LLM mutation hoặc dùng model.
Không yêu cầu mọi hash shared giữ nguyên để né sửa lỗi, cũng không tuyên bố
không regression chỉ vì test N8N06 xanh hoặc ticket cũ vẫn ghi ACCEPT.

3. POLICY DEMO, BẢO MẬT VÀ GATE BÊN NGOÀI

Tôi ủy quyền bạn chốt policy DEMO local cần cho WF08–10, dựa trên C02–C07/C10/C12
và baseline dự án: đổi/hủy, sĩ số tối thiểu/học bù, eligibility và trần hoàn,
chuyển/chênh lệch, bảo lưu/hạn, waitlist/lời mời, notification/OTP/invoice.
Ghi version/ngày/reviewer/lý do/phạm vi; không sửa hồi tố snapshot/điều khoản
N8N05. Không mặc định tắt hoặc hoãn chức năng bắt buộc để tránh triển khai.

Actor phê duyệt/khách trong test là tài khoản tổng hợp có phiên/quyền backend
thật. Người lập không tự duyệt; quyền/branch/ownership/consent và lựa chọn khách
được kiểm lại tại boundary ghi. AI chỉ thu nhu cầu/chuyển người, không phê duyệt.

Chi phí0USD, dữ liệu tổng hợp local. Không đọc personal env/credential; không
gọi model/OpenRouter/benchmark AI, mua dịch vụ, bật billing, thuê hạ tầng,
gửi email/tin nhắn/ticket ra ngoài hoặc chuyển/hoàn tiền thật. Tạo secret test
mới, raw artifacts/PII/OTP/credential chỉ ở private ACL current user/Admin/SYSTEM.
Public evidence chỉ metadata/refs/hashes được rà soát, không raw payload/token.

Giữ sự cố Next từng tự load personal .env.local trong lịch sử N8N05. Build/start
Portal dùng env allowlist và scripts/no-personal-env.cjs, truyền preload cho
worker; tự kiểm bằng fixture riêng. Không mô tả thành chưa từng xảy ra sự cố.

Notification dùng Portal và mail sink/adapter local có nhận message thực, không
stub luôn200. OTP có thể tới hộp thư test private; không đưa mã vào workflow,
public receipt hay log. Synthetic refund/delivery phải có nhãn và proof thực
hiện trong adapter local, không được gọi là giao dịch ngân hàng/SMTP live.
Approval/REFUND_PENDING chưa phải execution; chỉ trạng thái hoàn tất khi đủ
proof, và nếu dùng REFUNDED trong test phải nhận diện rõ adapter SYNTHETIC.
Không biến UNKNOWN thành success. Gate provider/live/production thiếu account,
credential hoặc approval không chặn ACCEPT_LOCAL; ghi owner/điều kiện gỡ riêng.

4. TRIỂN KHAI TRỌN WF08–10

WF08 — Teacher-time, thay đổi lịch, nghỉ, học bù, hoãn/hủy lớp:
- Request/approval backend có reason/version/scope; giảng viên không tự duyệt.
  Giữ semantics giờ rảnh hiện có, kiểm xung đột lịch/giảng viên/phòng/sức chứa.
- Impact plan đọc hold/committed/Enrollment hiện hành. Lớp có quyền lợi cần
  phương án theo từng đơn, lựa chọn khách khi policy yêu cầu và đường WF09.
  Duyệt xong nhưng version/impact đổi phải revalidate hoặc lập plan mới.
- Xử lý race duyệt nghỉ/xếp lịch, cancel/commit, đổi lịch khi đang hold/committed,
  minimum-size/decision deadline và học bù. Không xóa buổi/lịch sử/snapshot cũ.
- Nhả quyền lợi chỉ khi Enrollment hủy có hiệu lực; không chờ hoàn xong mới nhả.
  Bước sau lỗi không làm mất quyền lợi hoặc PUT lùi version mù. Event cuối có
  causation/sourceVersion để WF10 supersede reminder lịch cũ.

WF09 — Hoàn một phần/toàn bộ, chuyển lớp, bảo lưu, waitlist:
- Adjustment/ref/policy/quote/chênh lệch/version/deadline/approval/customer choice
  lưu backend. Có state machine, operation lookup và lịch sử quyết định bền.
- Refund: kế toán lập/ghi thực hiện, giám đốc độc lập còn quyền duyệt; kiểm trần
  tiền thực thu được hoàn, các khoản đã hoàn/đang reserve/UNKNOWN và race. Lookup
  trước retry; không hoàn hai lần hoặc vượt số tiền. Tiền dư được hoàn không
  làm mất entitlement học phí hợp lệ. Ledger/audit không xóa/ghi đè để khớp test.
- Transfer: kiểm target/quote/seat/chênh lệch và xác nhận cần thiết; quyền mới
  phải chốt an toàn trước nhả quyền cũ. Trước chốt mới mà lỗi thì hủy hold mới,
  giữ quyền cũ; sau chốt mà lỗi thì recovery theo plan bền, không nhả cả hai.
  Chênh lệch thu/hoàn đi Payment có authority và proof, không sửa giá snapshot.
- Suspension: lưu phần quyền lợi còn lại, hạn, quyết định và đường dùng lại/
  hết hạn; không hứa chỗ ở lớp chưa giữ/commit, không tự hồi sinh quyền hết hạn.
- Waitlist: eligibility/consent/priority policy rõ, dedup, invitation có hạn/
  version; nhận lời mời không tự bảo đảm chỗ. Hai người tranh chỗ cuối vẫn qua
  Class atomic hold/commit. Hết hạn/revoke/decline không để hold rò rỉ.

WF10 — Notification, reminder, OTP, hóa đơn mô phỏng:
- Notification sở hữu intent/dedup/recipient/template/sourceVersion/attempt/
  delivery/lookup/receipt/owner/escalation. n8n gọi API, không giữ delivery state
  duy nhất trong execution và không tự chọn email/URL ngoài scope intent.
- Xác nhận học chỉ sau enrollment.confirmed/commit hợp lệ, không từ matched.
  Reminder đọc lại lịch/version/consent/cancel ngay trước gửi; supersede intent
  cũ. Tin đã gửi không bị giả thu hồi; đính chính là intent version mới.
- Test Portal + hộp thư local nhận thật. Xử lý retry, provider-style rejection,
  timeout trước/sau gửi; nếu adapter không chứng minh dedup/lookup thì UNKNOWN
  có owner, không auto-resend có nguy cơ trùng hoặc hứa exactly-once email.
- IAM phát/verify OTP có hash, server expiry, rate limit/chống brute force,
  replay/consume nguyên tử, ràng buộc identity/session/purpose. OTP chỉ là proof
  identity; quyền learner/ownership vẫn phải backend kiểm cho từng resource.
- Tối thiểu hoàn thiện caller Student Portal/learner cần cho acceptance OTP,
  quyền lợi/lịch/link lớp và tải invoice của chính mình; không mở dữ liệu chéo
  learner/branch bằng cách biết ID/URL, không lưu token/OTP nhạy cảm ở browser.
- Invoice mô phỏng: input/form backend an toàn, entitlement/payment eligibility,
  file/download có ownership và audit; nhãn không giá trị pháp lý; không đưa
  PII hóa đơn vào model/public execution hoặc dùng public URL bỏ qua quyền.
- Có Portal tạo/xem/phê duyệt/thực hiện/đọc lại trạng thái bền cho các vai trò
  cần thiết. UI phân biệt request/approved/pending/executed/failed/unknown;
  không toast thành công trước kết quả nghiệp vụ, giữ accessibility và reload.

5. AUTHORITY, TRANSACTION, JOB VÀ RECOVERY

Giữ kiến trúc: domain sở hữu state và DB; n8n là bên điều phối; Bridge sở hữu
job/lease/checkpoint kỹ thuật. Không thêm backend saga runner cạnh tranh n8n,
SQL node ghi nhiều DB hoặc quyền admin/token dài hạn dùng chung cho workflow.

Mở đúng machine audience/scope/operation từng domain. Actor/session/branch/
ownership/approval/customer choice/recipient lấy từ nguồn backend đã xác minh,
không tin body n8n/LLM. Kiểm revoke/rotate/expiry và fail-closed khi dependency lỗi.
Fence job/workflowVersion/lease/attempt/operation intent; DONE/worker cũ không
tạo effect mới. Key gắn payload/resource/version, cùng key khác payload bị chặn.

Mỗi domain ghi state/result/audit/outbox trong transaction của mình. Giữ
causation/correlation, event/resource/schema version riêng biệt. WAITING có
loại/hạn bền, không giữ n8n execution chờ người/tiền. Deadline còn hiệu lực khi
n8n tắt; recovery lookup có authority trước retry/bù trừ, không nhả/xóa kết quả
đã commit chỉ vì transport timeout. Lỗi chưa rõ có trạng thái/owner/đường xử lý.

6. ACCEPTANCE VÀ KHÔNG REGRESSION

Lập matrix từng yêu cầu WF08/09/10 và impact matrix N8N01–05 trước triển khai.
Không chỉ đếm PASS: mỗi mục phải có expected/actual, assertion/API/DB effects,
trace/job/event/execution/operation IDs và source/schema/config hashes.
Kiểm source tích hợp cuối với API/PostgreSQL/RabbitMQ/n8n thật; fixture chỉ là
đầu vào tổng hợp. Import và chạy manual/automatic/event/cron/recovery thực,
activate copy riêng, canonical inactive. Browser thật ở1440/768/390px.

Tối thiểu kiểm:
- WF08: quyền/branch/self-approval/stale plan; duyệt nghỉ vs xếp lịch;
  cancel vs hold/commit; lịch có quyền lợi; minimum-size/học bù; lỗi giữa bước.
- WF09: refund lặp/partial/vượt trần/concurrent/UNKNOWN/self-approval/revoke;
  transfer hết chỗ/chênh lệch/thất bại trước và sau commit; suspension hết hạn/
  dùng lại; invitation duplicate/expiry/revoke và tranh chỗ cuối.
- WF10: intent duplicate/out-of-order; đổi/hủy lịch trước gửi; consent rút;
  delivery reject/timeout/mất phản hồi sau gửi; reminder cũ không phát;
  OTP sai/lặp/hết hạn/rate-limit/race; chéo learner/invoice/link ownership.
- Fault vật lý trên runtime riêng tại điểm business commit trước checkpoint:
  tối thiểu transfer/adjustment và refund execution hoặc send có kết quả chưa rõ.
  Chứng minh lookup/recovery/bù trừ không mất/nhân đôi tiền/chỗ/quyền lợi/delivery.
  Không thay physical fault bằng chỉnh sẵn DB rồi gọi đó là crash thật.
- Authority: fake actor/branch/approval/customer/recipient, cross-resource,
  revoke/rotate/expiry, job DONE/lease cũ/event replay/workflow version cũ.
- DB: tổng tiền thu/đã hoàn/reserved/pending, chỗ cũ/mới, entitlement, intent/
  delivery, operation/result/audit/outbox đúng; không chỉ HTTP200 hoặc job DONE.
- N8N khác: kiểm từng vùng bị shared changes ảnh hưởng trên source cuối;
  đặc biệt đăng ký N8N05 trong lúc N8N06 đổi/hủy/chuyển/hoàn chạy đồng thời.
  Snapshot/smoke trước thay đổi không thay được regression sau thay đổi.

Giữ mọi FAIL/SKIP/UNKNOWN. Lỗi authority/tiền/chỗ/ledger/isolation/secret phải
dừng batch, lưu proof/trace, cleanup đúng runtime sở hữu; sửa root cause, review
và kiểm affected trước lượt mới. Không sửa expected cho xanh, bỏ ca khó, cộng
PASS từ source không tương thích, retry mutation mù hoặc resume marker cũ.
Nhóm đã PASS chỉ kế thừa khi hashes và rủi ro liên quan không đổi; không chạy
lại toàn bộ vì đổi tài liệu. Không dùng sourceCommit thay dirty source hashes.

7. HỒ SƠ, CLEANUP VÀ QUYẾT ĐỊNH CUỐI

Duy trì outputs riêng, tái dùng conventions của repo:
- docs/acceptance-n8n-06.md: matrix đầy đủ, expected/actual refs, quyết định agent,
  executed vs inherited, affected regression và các giới hạn/gate live.
- docs/ban-giao-n8n-06.md: policy DEMO/version/lý do; migrations/contracts/callers,
  credential registry không secret, demo/recovery, upgrade impact, retention.
- Evidence index N8N06 riêng trong workflows/n8n; canonical/manifest WF08–10
  tương ứng, nguồn/hash/refs/schema/config/trace/review và compatibility evidence.
  Không ghi đè registration-evidence.json hoặc index nghiệm thu N8N khác.
- Checkpoint N8N06 private có quyết định/source/refs/hashes/lệnh tiếp tục nếu cần;
  snapshot checkpoint trước sửa. Cập nhật mục hiện hành N8N06 trong product-plan-v3,
  phan-cong-task-v3, n8n-workflows, n8n-readiness. Giữ lịch sử có ngày và trạng thái
  N8N khác đúng bằng chứng; không đánh dấu parent ticket hoàn tất từ lát cắt nhỏ.

Review toàn diff và connected callers/contracts/migrations bằng ponytail-review;
sửa finding chặn, kiểm trên source cuối. Review cả script closeout/verifier trước
dùng: guard đường dẫn/preconditions/vị trí Markdown, không PASS mặc định, không
nuốt FAIL, hardcode số đếm hoặc tự tạo proof. Kiểm độc lập JSON/link/hash và
tính nhất quán tất cả outputs sau ghi; một file ACCEPT riêng lẻ chưa đóng task.

Trước nghiệm thu, xác minh mọi process/container/network/port/worker do nhiệm vụ
tạo đã dừng, không tiếp tục gửi/quét ngoài dự kiến; giữ volume/artifact/private
ACL kể cả descendants và snapshot di chuyển. Không đòi runtime của người dùng
dừng. Xác minh protected evidence/corpus/checkpoints N8N khác còn nguyên và mọi
thay đổi source cần thiết đã có compatibility proof. Không cài scheduler ngầm.

Tự chốt ACCEPT_LOCAL khi mọi acceptance bắt buộc WF08–10 có proof hợp lệ trên
source cuối, regression N8N khác đạt hoặc kế thừa hợp lệ, không còn finding
chặn, isolation/ACL/preservation đạt và hồ sơ đồng nhất. Không hỏi tôi ký lại.

Nếu còn lỗi thuộc quyền kỹ thuật, tiếp tục sửa/kiểm đến khi đủ. Chỉ kết thúc
NOT_ACCEPTED khi có blocker thực sự ngoài quyền đã cấp, ghi evidence/owner/
điều kiện gỡ/phần hoàn tất/checkpoint; không dùng thiếu backend, Docker tắt,
test FAIL lần đầu hoặc chờ approval local làm lý do dừng. Gate live riêng không
biến local thành BLOCKED, cũng không được dùng để bỏ acceptance local bắt buộc.

Báo cáo cuối ngắn gọn: ACCEPT_LOCAL hoặc NOT_ACCEPTED; phần làm thêm, executed
vs inherited, bằng chứng không regression N8N khác, link matrix/index/bàn giao/
checkpoint, phần chưa kiểm và gate live còn đóng. Không nhận đã triển khai
N8N07/08, live, hoàn tiền/gửi mail thật hoặc hứa tự tiếp tục khi không có scheduler.

Bắt đầu kiểm baseline và thực hiện đến khi đủ ACCEPT_LOCAL theo các điều kiện
trên, không chỉ trả kế hoạch. Trong phạm vi đã giao, tự quyết và làm đến cùng.
```
