# N8N-04 hardening — 09/11/2026 (+07:00)

<!-- CURRENT_N8N_LINK -->
Trạng thái N8N-03/04 hiện hành, acceptance, ngân sách và quyết định agent:
[ma trận nghiệm thu 12/11/2026](acceptance-n8n-03-04.md).
N8N-03 ACCEPT local; N8N-04 đang kiểm bản cuối, chưa nghiệm thu. Khách thật/production vẫn đóng.

<details>
<summary>Lịch sử kiểm chứng đến 11/11/2026 — giữ nguyên receipts và quyết định cũ</summary>

## Sửa VI-02 và benchmark mới — 11/11/2026 03:49 (+07:00)

**Codex chấp nhận phần sửa policy/version đã kiểm synthetic; toàn N8N-04 vẫn
PARTIAL / NOT_ACCEPTED, model pilot NO_GO, khách thật BLOCKED.** Người dùng đã
cấp quyền đọc quota/generation metadata, xử lý Docker và nghiệm thu; grant mới
prior22/max18/trần40/0USD, retry/probe/fallback0. Engine29.1.3 đang sẵn sàng,
không cần agent bật Desktop. Không thay provider/model hoặc deadline.

Sửa generator/Draft để câu trả lời có từ về giá/chính sách/tiền tệ kèm footer
phiên bản lấy trực tiếp từ tên và policyVersion của khóa/gói trong Sources.
Nguồn thiếu/sai kiểu version hoặc tên thì TOOL_ERROR/HUMAN, không bịa version.
Giữ giới hạn4000ký tự, kiểm chữ Han, budget, policy recheck, lease/fence/CAS.
Runner ghi rõ sourcePolicyFooterAdded; không coi footer nguồn là lời do model sinh.
Đây là phần hiển thị metadata nguồn, chưa phải bộ kiểm toàn bộ sự thật của prose.

**Kiểm mới61/61 offline,14/14 n8n/DB,4/4 transport PASS trên checksum mới.**
14ca native giữ tên cũ; fixture success nay cố ý trả giá không kèm version, seed
khóa/gói Catalog thật trong DB test và đối chiếu footer đã lưu.23fixture HTTP,
0provider/key thật trong các tests. Một lượt integration đầu dừng trước begin,
0request/0key thật; nguyên nhân ban đầu chưa chứng minh, giữ receipt FAIL.
Bốn lượt mới dùng grant/project riêng cùng thêm log route/status chẩn đoán; không
đổi canonical/guard và đều PASS. Bốn loopback calls không cộng vào provider thật.

**Benchmark thật mới:1 PASS /1 FAIL /8 SKIP sau review.** VI-01 PASS bằng template,
0model. Planner VI-02 trả cùng lúc read_catalog_classes và request_handoff,
mỗi arguments={}; guard yêu cầu đúng1call nên dừng REQUEST_OR_RESPONSE_DENIED.
HTTP200/JSON/body hoàn chỉnh ở~1346ms,696token(669prompt+27completion),reasoning0,
usage.cost0; đây là lỗi tương thích contract, không phải timeout của request này.
VI-02 HUMAN/MODEL_ERROR một lần,0AI; không gọi các domain tool hoặc Model answer.
Vì vậy phần trả lời giá/policy mới chưa được quan sát với model thật. VI-03–10
SKIP sau stop; không ghép kết quả checksum cũ vào lượt mới.

**1request mới/23tích lũy/trần40**, còn17 nhưng không resume/retry sau guard stop.
Quota tài khoản là bộ đếm khác:trước31/50,sau30/50request còn lại trong ngày UTC.
Bảy GET metadata được cho phép ghi riêng,0inference; không gọi credits API hoặc
bật billing. Metadata generation xác nhận NVIDIA,tool_calls,latency598ms,
generation_time605ms,total_cost0. actualCostUsd toàn lịch sử vẫn null vì các call
dở dang cũ chưa đối soát. VI-03 timeout cũ chưa có generation ID để tra; không
suy ngược nguyên nhân nội bộ queue/generation/network từ call mới.

WF-02 SHA-256: d014806515de18917934312a3fc0be25ea002ca291197d88abff29bb2d2ab953.
Manifest: 30c10e539f1bbcbc6a1f964a104c5561aeee68422605a5bef48a740dae551cc7.
WF-01/WF-03/corpus không đổi;65source được bind,8source artifacts thay đổi.
Cleanup7project mới:0container/network,36APIport đóng,giữ28volumes;61job/execution
refs được giữ. ACL15thư mục mới/460items kiểm không còn quyền broad-user; có cảnh
báo privilege khi set lại session root vốn đã restricted, kiểm trạng thái sau đó
PASS. Không sửa ACL/key/runtime cũ,không activate/deploy hoặc xóa volume/prune.

Blocker tiếp theo: contract API required cho phép ít nhất1tool, application chỉ
nhận1hành động. Metadata model/endpoint chưa liệt kê parallel_tool_calls; đó chưa
phải bằng chứng không hỗ trợ, cũng chưa đủ để tự bật cờ rồi khẳng định có hiệu lực.
Cần chốt đường single-action được endpoint hỗ trợ và kiểm caller/guard/workflow
trước một grant mới trong quota đã cấp; giữ guard từ chối action set mơ hồ.
[Đặc tả tool calling OpenRouter](https://openrouter.ai/blog/tutorials/tool-calling/).

Evidence mới: **policyVersionFixAuthorizedBenchmark20261111** trong
[index](../workflows/n8n/chat-hardening-evidence.json);
[review](../.local/automation/n8n04-policy-fix-20261111-3be3a660093a/quality-review.json), [chẩn đoán](../.local/automation/n8n04-policy-fix-20261111-3be3a660093a/diagnosis.json),
[metadata](../.local/automation/n8n04-policy-fix-20261111-3be3a660093a/live-metadata.json), [verification](../.local/automation/n8n04-policy-fix-20261111-3be3a660093a/verification.json).
Các mục bên dưới là lịch sử. Ngưỡng50hội thoại gán nhãn, dữ liệu/egress/consent,
người trực HUMAN và production/load/restore/SLA vẫn là gate riêng chưa đạt.


## Benchmark thật hiện hành — 11/11/2026 03:06–03:07 (+07:00)

**N8N-04 vẫn NOT_ACCEPTED / PARTIAL, model pilot NO_GO, khách thật BLOCKED.**
Người dùng chọn dùng quota còn lại: grant mới prior18/max5/tổng23, không cấp đề xuất
nâng trần36. Docker Engine đã sẵn sàng khi preflight kiểm lại; agent không bật Desktop.
Đã chạy model thật trên WF-02 checksum **69476ff9…ef3ed1e44**: sau review
**1 PASS / 2 FAIL / 7 SKIP**. VI-01 PASS bằng clarification template, 0 model request;
VI-02 FAIL vì câu trả lời bỏ policy/version dù giá và nguồn đúng; VI-03 FAIL body
timeout sau HTTP200. Không dùng DONE/HTTP200/handoff an toàn thay nội dung đạt.

**4 request mới / 22 tích lũy / trần23**, còn1 nhưng không retry/probe/tiếp tục sau
guard stop. Ba usage reports:2.285 prompt +230 completion =2.515 token, reasoning0,
reported subtotal0USD. Call4 thiếu usage nên costUsd=null/costUnknown=true;
**actualCostUsd=null**, không gọi account/billing API để đối soát.

Instrumentation thật của VI-03: headers200 ở580ms, byte đầu582ms, byte cuối3526ms,
**22byte/2chunk**, body chưa hoàn tất ở5916ms, guard ghi5919ms. Không lưu partial
body; chưa biết22byte là gì, không suy ra inference/token/keepalive/queue/generation.
Nguyên nhân nội bộ provider và nguyên nhân các attempt cũ vẫn chưa chứng minh.
Giữ deadline5900/node8000 và không đổi model/provider để ép PASS.

Giữ kết quả **58/58 offline,14/14 native,4/4 transport** của source không đổi ngày
10/11; không gắn nhãn chạy mới. Đã kiểm lại **65/65 hash source,706 refs lịch sử**.
Lượt mới có fresh isolated DB/role/seed, inactive fixtures,7 job/execution refs,
3 hội thoại/3GUEST/2AI DELIVERED/1HUMAN TIMEOUT; replay409 và dedup đúng cả3.
Cleanup project mới:0container/network,5API port đóng,giữ4volume. ACL hai thư mục
mới đã siết về owner/process account,Administrators,SYSTEM và kiểm62items; không
đổi ACL/key/dữ liệu runtime cũ. Workflow exports được kiểm hash; không coi đó là
diễn tập restore DB/key, không activate/deploy hoặc ký thay con người.

Checklist và thứ tự xử lý tiếp: [đóng N8N-04](checklist-dong-n8n-04.md).
Evidence mới **availableBudgetLiveCloseout20261111** trong
[index](../workflows/n8n/chat-hardening-evidence.json);
[review từng ca](../.local/automation/n8n04-closeout-20261111-653595913f6f/quality-review.json),
[chẩn đoán](../.local/automation/n8n04-closeout-20261111-653595913f6f/diagnosis.json),
[verification](../.local/automation/n8n04-closeout-20261111-653595913f6f/verification.json).
Các mục ngày10/11 bên dưới giữ nguyên làm lịch sử; không thay kết quả lượt mới.


## VI-01 và body instrumentation — 10/11/2026 (+07:00), cập nhật hiện hành

**Codex chấp nhận phần VI-01 dạng template và instrumentation đã kiểm synthetic.
N8N-04 vẫn PARTIAL / NOT_ACCEPTED; pilot có model NO_GO; khách thật BLOCKED.**
Quyền quyết định nghiệm thu do người dùng đã ủy quyền; không ghi chữ ký con người.
Các mục bên dưới là lịch sử; kết quả model cũ không áp dụng cho checksum mới.

VI-01: khi lượt GUEST đầu tiên nói rõ chưa biết học gì/chọn khóa nào/bắt đầu từ đâu,
WF-02 hỏi đúng hai câu: “Bạn muốn học để đạt mục tiêu gì? Bạn có thể dành thời gian
học vào những lúc nào?”. Không đưa khóa/giá khi chưa rõ nhu cầu; không gọi model.
Matcher chuẩn hóa dấu, không dựa vào case ID hay nguyên văn VI-01; cố ý chỉ xử lý
lượt đầu có sự lưỡng lự rõ ràng, chưa phải bộ phân loại ý định hoặc xử lý nhiều lượt.
Yêu cầu nhân viên giữ đường handoff hiện có. Model readiness/policy gate, các lần
đọc Catalog/Class có quyền, source receipts, recheck, lease/fence/CAS và submit draft
giữ nguyên. Ba lần đọc nguồn cục bộ vẫn cần vì backend yêu cầu SOURCES_REQUIRED;
không giả nguồn hoặc nới contract. Nhãn trả lời là `clarification-template-v1`;
runner ghi `CLARIFICATION_TEMPLATE`, inference=false, 0 provider attempts, không
tự đổi kết quả này thành benchmark inference PASS.

Guard đo headers, thời điểm bắt đầu đọc body, byte đầu/cuối, số byte/chunk,
body complete, thời gian đọc và khoảng im lặng cuối body. Thời gian tính từ lúc
client bắt đầu gửi, là quan sát Fetch stream; không phải timestamp provider hoặc
bằng chứng về queue/generation/TCP. Việc ghi headers có thể trễ trước khi bắt đầu
đọc; `bodyReadStartedElapsedMs` tách được khoảng đó. Chỉ lưu số đo một lần khi đọc
xong/abort, không ghi từng chunk hay nội dung body dở dang. Lỗi ghi ledger được
phân loại `PROVIDER_RECORD_ERROR`, không gán thành lỗi body của provider. Giữ
deadline 5.900 ms, node 8.000 ms, routing/model/retry/cap; chưa thêm idle timeout.
Body chưa hoàn tất vẫn có usage/cost/inference chưa biết, dù nhận HTTP 200.

Kiểm chứng mới: **58/58 offline; 14/14 n8n/DB native (13 ca cũ + 1 clarification);
4/4 integration transport**. Integration chạy VI-01 trước (0 model request), sau
đó giả lập timeout VI-02: trước headers; HTTP 200 chưa có byte; treo sau 9 byte;
n8n kết thúc trước guard. Mỗi lỗi chuyển HUMAN đúng một lần, replay 409 và inbound
dedup giữ nguyên. Bốn raw runner receipts có lỗi cố ý: không tính là benchmark
model PASS; cumulative 19 trong raw là kế toán giả lập loopback, không phải
provider thật. Lần native đầu phát hiện cạnh workflow trùng gây planner/answer
chạy hai lần; đã sửa generator, thêm kiểm tra cạnh trùng, giữ receipt FAIL và
chạy lại 14/14 PASS. Bản sửa phân loại lỗi ghi guard sau native không đổi canonical
hoặc harness đã chạy; guard cuối được kiểm riêng bằng 58 tests và 4 integrations.

WF-02 SHA-256: `69476ff95cbdbe26520002db381fd51291b4caf6545e5ba912c93dcef3ed1e44`.
Manifest: `eddb8150c5c4144187bc25b46b0cd14883d360118a6b8b425141c652d0b19352`.
WF-01/WF-03 và corpus không đổi; corpus hash vẫn
`1cb9d4820c820ebe2e4063e0f97b3e80fc302278a8e81e7edaf22a8c6dd855e9`.

Lượt này **0 request provider thật, không đọc key**; tổng lịch sử vẫn **18/23**,
còn 5, không tăng quota hoặc tái dùng grant đã dừng. Benchmark thật gần nhất vẫn
**1 PASS / 2 FAIL / 7 SKIP trên checksum cũ 94a7c999…c84c1c**. Chưa chạy model trên
checksum mới; chưa chứng minh timeout provider đã hết hoặc nguyên nhân chính xác;
`actualCostUsd=null` cho lịch sử chưa xác minh. Bước kế tiếp là benchmark thật có
grant mới bind checksum/history hiện hành trong phần quota còn lại, xem số đo
body mới và review nội dung từng ca; không hạ tiêu chí hoặc nâng quota để đóng task.
Nếu quota còn lại không đủ hoàn tất, giữ NOT_ACCEPTED và quyết định lượt sau riêng.

Cleanup đã kiểm theo đúng 6 project mới: 0 container/network, 32 cổng dịch vụ đóng,
24 volumes giữ lại; không prune/xóa volume, sửa runtime cũ, activate hoặc deploy.
Hồ sơ mới nối thêm, giữ 445 refs lịch sử và toàn bộ trường evidence cũ:
[verification](../.local/automation/n8n04-clarification-instrumentation-20261110-13ca6d43f755/verification.json),
[receipt](../.local/automation/n8n04-clarification-instrumentation-20261110-13ca6d43f755/session-receipt.json),
[decision](../.local/automation/n8n04-clarification-instrumentation-20261110-13ca6d43f755/decision.json).
Public evidence: `clarificationBodyInstrumentation20261110` trong
`workflows/n8n/chat-hardening-evidence.json`. RawReceipt mới là chứng từ **0 request**
của lượt synthetic, có nhãn rõ không phải benchmark inference; không cộng bốn
request loopback vào provider history. Chưa kiểm production/load/restore/browser
hoặc SLA toàn lượt; các production gates trước đó vẫn còn hiệu lực.


## Review và quyết định được ủy quyền — 10/11/2026 14:55 (+07:00)

What this change does: Runner cộng đủ history đã kiểm hash thay vì chốt baseline 3;
WF-02 yêu cầu tiếng Việt/policy version, chặn chữ Han, tắt reasoning và ép routing 0 USD.
Giữ provider deadline 5.900 ms, tăng node lên 8.000 ms cho guard bookkeeping; sinh lại
canonical/manifest rồi kiểm 53 offline, 13 canonical runtime và 3 transport integration đều PASS.

Ponytail-review đọc diff và callers: generator→canonical→fixture/acceptance; runner
history/sourceChanges/marker→guard request/response/usage→Draft/backend/fence/recheck;
scripts private, DB outcomes/replay/dedup và tài liệu/evidence. Giả định một runner local
tuần tự. Không thêm dependency hoặc chạy Bridge/IAM/browser/regression ngoài phạm vi.
Không còn finding code mới cụ thể trong phần kiểm soát đã kiểm; đây không phải kết luận
model đáp ứng yêu cầu nghiệp vụ.

**Các lỗi phát triển đã xử lý và giữ evidence:** usage test đầu dùng synthetic secret
làm chuỗi số sai nên secret gate đúng đã chặn trước usage; đổi fixture sang chuỗi không
bí mật. Hai runtime acceptance đầu 1 PASS/1 FAIL/11 SKIP: n8n expression model invalid syntax,
0 model HTTP runtime; evaluator ghim chứng minh `}}` lồng nhau đóng expression sớm.
Generator tách dấu, thêm assertion regression, sinh checksum cuối và chạy đủ 13/13.
Không sửa fixture riêng để gọi canonical cũ là PASS, không retry provider để sửa điểm.

**Finding còn mở, đã ra quyết định thay vì chờ người chính:**

1. **VI-01 sai nội dung sau khi bỏ reasoning.** Answer đã hết chữ Trung nhưng đưa
   khóa/giá trước khi rõ nhu cầu, yêu cầu 3 thông tin và tự thêm “1 tiết”. FAIL; không có
   bằng chứng một mẫu này do riêng việc tắt reasoning gây ra, không tự suy ra quan hệ nhân quả.
2. **VI-03 vẫn timeout body.** HTTP 200 headers 636 ms, body timeout 5.905 ms; thiếu JSON/
   usage, HUMAN/TIMEOUT đúng một lần không thay thế answer. FAIL; chưa đủ evidence
   phân biệt provider queue/generation/network hoặc xác nhận reasoning của request lỗi.

VI-02 PASS với giá/policy version 1/source đúng; VI-04–10 SKIP. Review **1 PASS/2 FAIL/7 SKIP**,
raw 0 PASS/1 FAIL/7 SKIP/2 reviewPending giữ nguyên. 6 request mới/18 tích lũy; 5 usage/4.318 token,
reasoning 0/report, cost subtotal 0; costUsd/actualCostUsd=null. Còn 5 request nhưng dừng theo
guard, không retry/probe/paid fallback. Baseline 18 tương lai được runner tự cộng từ history.

Reasoning 1.607/2.101 completion lịch sử là overhead được chứng minh; năm response mới
báo 0 chứng minh cấu hình được áp dụng ở các response đó, **không chứng minh timeout đã hết**.
Margin node tăng để xử lý receipt; không tăng deadline provider. Draft 20 s không phải
whole-turn deadline. Số đo inbound→AI lưu 16.397–17.109 ms có overhead CLI, không phải SLA.

Cleanup 7 project mới, 0 container/network, 38 API port đóng, giữ 28 volume; source khác và
mọi receipt/grant/marker lịch sử bảo toàn. WF-02 checksum 94a7c999…c84c1c; full hashes,
diff, từng ca, nguồn kỹ thuật và quyết định tại [bàn giao](ban-giao-n8n-04.md).

Verdict: **ACCEPT phần kỹ thuật synthetic đã kiểm; NOT ACCEPTED N8N-04, NO-GO model
pilot**, theo ủy quyền hiện tại cho Codex. Không ghi chữ ký con người hoặc mở khách thật.
Not checked: provider-side root cause/billing, 7 ca model chưa chạy, production/browser/
load/restore/SLA; giữ quyết định no-go cho các gate chưa đạt.

## Review sau Engine sẵn sàng — 10/11/2026 13:43–13:46 (+07:00)

What this change does: Tiếp tục quyền đã cấp sau khi người dùng mở Desktop và gửi ảnh;
chạy một integration synthetic cho admission mới, rồi benchmark thật trên project riêng.
Không sửa source sản phẩm/harness/canonical; chỉ thêm orchestration private, review/evidence
và mục tài liệu. Kết quả review **2 PASS / 1 FAIL / 2 NEEDS_REVIEW / 5 SKIP**, N8N-04 chưa đạt.

Ponytail-review đối chiếu source/callers của runner admission→marker→runtime/isolation→
seed→guard planner/answer→Draft/HUMAN, fixture diff và scripts orchestration/diff mới.
Giả định một runner local tuần tự. 63 source /141 ref trước chạy khớp; không có finding code
mới cụ thể phải sửa trong luồng đã thực hiện. Script collector đầu dùng tên trường cũ
`quality.rawReceiptSha256`; sửa thành structured ref `quality.rawReceipt.sha256`, chỉ
đọc lại artifact, không retry workflow/provider hoặc sửa raw receipt.

**Finding chất lượng chưa chấp nhận** (không tự sửa prompt/model sau guard stop):

1. **VI-01 trộn tiếng Trung vào câu tiếng Việt.** Expected hai câu hỏi/không bịa đạt,
   nhưng answer có `偏好`. Giữ NEEDS_REVIEW, cần sửa chất lượng hoặc disposition rõ của
   reviewer; không dùng HTTP 200/cost 0 để gọi đây là full PASS.
2. **VI-02 thiếu policy version trong answer.** Giá 100.000đ, 1 buổi, policy chưa công bố
   và source/readAt đúng; tool policyVersion 1 có trong trace nhưng chưa thể hiện trong
   nội dung cuối. Giữ NEEDS_REVIEW, cần xử lý tiêu chí version trước chấp nhận ca này.
3. **VI-05 không có câu trả lời để kiểm từ chối dữ liệu khách khác.** Planner nhận headers
   200 sau 722 ms nhưng timeout body ở 5.917 ms, chưa có JSON/usage. FAIL; HUMAN/TIMEOUT đúng
   một lần/0 AI là safe failure, không phải model refusal PASS.

VI-03/04 review PASS đúng expected. VI-06–10 SKIP sau điểm dừng; không retry hoặc dùng
11 request còn lại. Raw runner 0 PASS / 1 FAIL / 5 SKIP / 4 reviewPending giữ nguyên; review bốn
answer riêng, không viết đè receipt. Tổng 9 request mới/12 tích lũy, 8 response/usage,
8.544 token, reported subtotal 0; tổng cost/actualCostUsd=null vì request 9 và lịch sử chưa đối soát.

Integration mới 1/1 PASS, 1 loopback/0 provider/không đọc key thật, kiểm prior 3 và body timeout
qua n8n/DB/corpus mới. Giữ integration 3/3, synthetic 13/13, offline 43/43 và caller 9/9 lịch sử,
không rerun source không đổi. Cả 2 project đạt absence/config/actual mount/init readonly/
DB rỗng/seed trước key; chỉ bản sao inactive. DB live 5 hội thoại/4 AI/1 HUMAN, 11 job/execution
attempt 1, replay 409/dedup đủ 5 ca. Cleanup 2 project, 0 container/network, 10 API port đóng,
giữ 8 volume. Không tác động runtime cũ hoặc đo lại baseline của nó.

Giữ timeout/checksum: answer mới hoàn tất 3.663–5.178 ms nhưng planner VI-05 vẫn timeout;
chưa đủ căn cứ nâng hạn hay quy nguyên nhân provider/network. WF-02 execution 7.106–10.222 ms,
GUEST→AI lưu 17.666–20.912 ms gồm overhead CLI/harness, không phải browser/SLA.
Draft 20 s không cắt toàn turn, guard/node đệm 100 ms không bảo đảm khi I/O chậm.

Trước một lượt provider khác phải bind receipt 9 request mới với 3 cũ thành prior 12 và grant
mới; runner hiện tại chốt baseline 3 cho phiên này, không tái dùng hoặc khai prior 3 để chạy nữa.
Người chính vẫn quyết định signoff/pilot, HUMAN/incident owner, ACL/retention/backup và
version/drain/recovery/rollback theo [hồ sơ mới](ban-giao-n8n-04.md).

Verdict: Ship hồ sơ của lượt dừng đúng guard; **NO-GO pilot có model**, chưa ký/chấp nhận
pilot, khách thật BLOCKED. Not checked: model VI-06–10/refusal VI-05, nguyên nhân/chi phí
attempt đầu/answer cũ/request mới 9, browser/load/restore/SLA; không chạy regression ngoài phạm vi.

## Review lượt tiếp tục cap 23 — 10/11/2026 (+07:00), Engine SKIP

What this change does: Runner ràng buộc đủ raw receipt 1+2 attempt và session receipt
trước khi nhận grant mới; không còn khóa prior=1 hoặc bỏ qua lượt answer timeout gần nhất.
Receipt mới ghi cumulative=3; khi receipt/budget không hợp lệ thì không báo tổng đã xác minh.
Chỉ sửa runner và test caller, thêm evidence/tài liệu; không đổi guard/canonical/runtime.

Áp dụng ponytail-review cho diff so snapshot đầu phiên và callers: preflight admission →
receipt hash/count → source checks → marker wx → Docker → withAcceptanceRuntime → guard;
đối chiếu cả planner/answer, accounting, fixture, Draft/HUMAN/lease/isolation và test mocks.
Giả định một runner local tuần tự như harness hiện có. Đã kiểm negative case prior thiếu,
thiếu raw receipt mới, raw count sai, cumulative sai, cap tổng 21 khi 3+20, cap mới 21,
grant cũ/pending/reused và source race. **9/9 runner/caller PASS**, syntax hai file PASS.
Lỗi vòng kiểm đầu là expectation trong test mới, đã sửa; không có runtime/provider side effect.

Không còn finding code mới cụ thể cần sửa trong phạm vi diff. Integrity trước sửa 63 source /
119 artifact refs đạt; đúng hai file harness đổi có snapshot/diff/hash, source còn lại giữ nguyên.
Guard transport 43/43, canonical 13/13, integration transport 3/3 là kết quả lịch sử,
không chạy lại hoặc gắn cho runtime source mới. Integration runtime cho admission mới **SKIP**.

Grant 3+20≤23 mới đã được runner claim một lần rồi **SKIP_ENGINE_UNAVAILABLE** trước
runtime/key: context desktop-linux, named pipe không tồn tại. Lượt mới 0/0/10, 0 provider,
0 loopback, cumulative=3, finalIntegrity PASS; không có project/process/volume mới để cleanup.
Không bật Desktop, không ảnh hưởng runtime cũ hoặc xóa volume; baseline runtime cũ chưa đo.

Trace cũ xác nhận answer headers 200 rồi body timeout; 611ms giữa planner và answer,
13.127ms từ Job node tới Submit draft xong. Không biết nguyên nhân body chậm hoặc cost;
attempt đầu vẫn UNKNOWN. Giữ guard5900/node6000/Draft20000/workflow55s/lease60s vì thiếu
bằng chứng chọn hạn mới; đệm100ms không bảo đảm guard về trước node, không hứa handoff20s.
Không thay checksum/acceptance. N8N-04 vẫn PARTIAL, benchmark thật gần nhất0/1/9;
actualCostUsd=null, chưa có chữ ký hoặc pilot approval; khách thật BLOCKED.

Verdict: Ship bản sửa admission và hồ sơ dừng đúng gate. **NO-GO pilot có model hiện tại**;
người chính quyết định ký/pilot và các gate quản trị trong [hồ sơ mới](ban-giao-n8n-04.md).
Not checked: integration n8n/DB mới do Engine, model/answer/billing mới, load/restore/SLA;
không chạy lại Bridge/IAM/browser/regression ngoài phạm vi.

## Review phiên ngân sách mới — 10/11/2026 (+07:00), dừng tại answer VI-01

What this change does: Thực hiện quyền trong prompt hiện tại bằng preflight mới,
kiểm 3 nhánh transport synthetic qua runner/n8n/DB thật trước key/provider, rồi chạy
lượt benchmark mới và dừng tại answer timeout. Chỉ thêm orchestration/evidence private
và mục bàn giao/review/plan/evidence mới; không sửa source sản phẩm, canonical hoặc
guard/runner/runtime/isolation đã có. Áp dụng karpathy-guidelines, Ponytail full và
ponytail-review; giả định một runner local, ca tuần tự.

**Kết luận review diff và callers:** không có finding code mới cụ thể cần sửa trong
phạm vi đã thực hiện. Đã đối chiếu `benchmarkGuard`/`sendProvider`/`providerAccounting`
với cả planner/answer, runner admission/marker/receipt, runtime → isolation, fixture
canonical và Draft/handoff contract. Các script private mới dùng assert, gọi lại runner
hiện có, không thêm dependency hoặc đường retry/probe/provider fallback. Kiểm cuối
bao gồm toàn bộ diff mới, source hashes, fixture/trace refs, bảo toàn tài liệu/evidence
và tài nguyên của chính 4 project mới. Không chạy lại 43 offline/13 acceptance hoặc
Bridge/IAM/browser cho source không đổi.

**Integration mới 3/3 PASS**, mỗi ca ở project/DB/role/network/credential test mới,
mount thực tế từng service và init.sql read-only được kiểm trước import inactive.
Timeout trước headers giữ status=null/phase=request; headers 200/body chậm giữ
status=200/phase=body. Ca ghi ledger chậm 1.500 ms làm n8n node kết thúc sau **6.022 ms**,
trước guard response khoảng **1.410 ms**; receipt cuối vẫn giữ attempt/status/phase/cost
unknown, HUMAN/TIMEOUT một lần, replay 409/dedup đạt. Chỉ 3 loopback attempts, **0 provider**;
key thật chưa đọc. Raw integration bookkeeping được giữ nhưng biên bản nêu rõ
`credentialRead=true`/transport attempts không chứng minh provider credential/inference.
Checker đầu kỳ vọng MODEL_ERROR được sửa thành TIMEOUT đúng canonical và đối chiếu
receipt đã có, không rerun workflow hoặc xóa marker.

**Lượt thật 02:58:28–03:00:02: 0 PASS / 1 FAIL / 9 SKIP.** Planner hợp lệ, model đúng,
HTTP 200, 5.555 ms, 844 token, cost báo0; tool đọc Catalog/Class đúng seed, policy 1,
giá100.000đ và cùng IDs, rồi recheck. Answer headers HTTP 200 sau 831 ms, body chưa hoàn
tất khi deadline: `PROVIDER_TIMEOUT`, `failurePhase=body`, `TimeoutError`, `causeCode=null`,
elapsed 5.916 ms. Đây là bằng chứng mới về timeout đọc body; nguyên nhân chậm/provider
processing/billing phía sau vẫn chưa biết. Không dùng nó để chẩn đoán lại attempt cũ
chỉ có lỗi chung và5.914ms.

WF-01/02/03 DONE/attempt 1 đúng hội thoại; 1 GUEST, 0 AI, HUMAN/TIMEOUT đúng1 audit/event,
replay 409 và duplicate không thêm tác dụng. VI-01 FAIL do answer không hoàn tất, chưa
có câu trả lời để nghiệm thu chất lượng; VI-02–10 SKIP, không retry. **2 request mới /
3 tích lũy**, trong cap 20/21 và2/ca; còn18 chưa dùng, không tự resume sau stop. Quan sát
2 headers/1 response/1 usage, planner inference xác nhận, answer inference/usage chưa biết.
Reported cost subtotal 0, **costUsd=null, actualCostUsd=null**; attempt cũ chưa đối soát.
Kiểm giá công khai và routing max_price 0/no fallback đạt trước egress, không phải billing receipt.

**Giữ timeout/checksum:** guard 5.900/node 6.000/Draft 20.000/workflow 55s/lease 60s gia hạn.
Đệm100ms không bảo đảm thứ tự trả lỗi; budget Draft không phải whole-turn deadline,
không tuyên bố SLA 20s. Không đổi WF-02 nên không sinh lại generator/manifest hoặc gắn
fixture khác timeout làm acceptance canonical. 63 source/45 refs trước và source sau
khớp; 13/13 synthetic và43/43 offline vẫn là lịch sử, checksum WF-02/manifest giữ nguyên.

Artifact/ref/hash, bảng 10 ca, checklist và giới hạn tại [bàn giao mới](ban-giao-n8n-04.md)
và `confirmedBudgetIntegrationBenchmark20261110` trong
[evidence](../workflows/n8n/chat-hardening-evidence.json). Session receipt SHA-256
`58fec86010dabadc100732fe8f7c0c72a1732fcd2895e1fe7d4e6495dfba0223`;
raw benchmark SHA-256 `ed8f2a35cbe6150eb241e9adb0105137e378fd57716376f1a3e234f82725704f`.
Cleanup đọc sau down xác nhận **4 project, 0 container/network, 20 API port đóng,
giữ16volume**, không xóa/prune. Lịch sử28trường evidence và toàn văn tài liệu cũ giữ nguyên.

Verdict: Ship phần evidence/diagnostic của phiên đã dừng đúng gate; **chưa đạt benchmark
và N8N-04, chưa ký nghiệm thu/chấp nhận pilot, rollout khách BLOCKED**.
Not checked: nguyên nhân body chậm phía provider/network, billing thực, 9 ca chưa chạy,
chất lượng answer cuối, load/restore/SLA và baseline runtime/env cá nhân; không retry
hoặc chạy thêm provider sau điểm dừng.


## Review chẩn đoán transport offline — 10/11/2026 (+07:00)

What this change does: Bổ sung bằng chứng lỗi guard cho planner/answer và sửa caller
để phân biệt attempts, response/inference quan sát được và chi phí chưa biết. Chuẩn bị
lượt mới với cap có tính 1 attempt cũ; chưa cấp ngân sách, chạy Docker hoặc gọi provider.
Áp dụng karpathy-guidelines, Ponytail full và ponytail-review; giả định một runner local,
ca tuần tự, không phải worker nhiều replica hay dịch vụ public.

**Must fix — đã sửa offline trong phạm vi yêu cầu:**

1. **Body lỗi làm mất HTTP status; catch không phân biệt đường lỗi**
   (`scripts/n8n04-benchmark-guard.mjs`, `sendProvider` và `benchmarkGuard.request`).
   - What this is: Transport cũ đợi `response.json()` xong mới trả status cho guard.
   - Problem: headers 200 đã đến nhưng body ngắt/chậm hoặc trả HTML thì ledger không có status; DNS/TLS/kết nối/body/JSON cùng một mã transport. Regex chấp nhận error message viết hoa cũng có thể ghi chuỗi bí mật dưới dạng stop code.
   - Fix: lưu headers trước đọc body, phase và elapsed monotonic; allowlist name/cause/stop code, bỏ message/stack. Phân biệt timeout/DNS/TLS/kết nối/body/JSON/secret; kiểm raw và decoded secret trước ghi response, chỉ giữ số usage cần thiết trong ledger.
   - If we skip it: lần dừng tiếp vẫn không đủ bằng chứng chẩn đoán, hoặc diagnostic có thể đưa secret vào ledger.

2. **Caller có thể tiếp tục khi response chưa được guard xác nhận**
   (`scripts/run-n8n04-benchmark.mjs`, cuối mỗi ca và `finally`).
   - What this is: Node n8n 6s có thể kết thúc trước guard hoàn tất lưu response, nhất là chỉ có đệm 100ms.
   - Problem: kiểm riêng `state.stopped` chưa loại trừ row đang chạy/thiếu cost; đọc ledger lỗi có thể để bộ đếm mặc định 0. Assert integrity cuối cũng có thể ném lỗi trước khi lưu receipt thất bại.
   - Fix: chỉ tiếp tục khi mọi request của ca đã valid và cost hợp lệ bằng 0. Cuối lượt nối ledger vào cả ca lỗi, dùng null khi không có accounting; integrity fail vẫn lưu receipt. Lỗi ghi response giữ usage/inference đã quan sát, không biến subtotal thành billing receipt.
   - If we skip it: ca đầu thiếu evidence có thể được xem là đủ điều kiện chạy ca sau, hoặc mất thông tin của lượt dừng.

3. **Chạy lại runner cũ có thể dùng lại grant và đặt cap mới 20**
   (`scripts/run-n8n04-benchmark.mjs`, preflight; guard config `maxRequests`).
   - What this is: Runner trước sửa pin preflight được cấp quyền cho lượt đã dừng; mỗi guard mới khởi bộ đếm 20.
   - Problem: gọi lại cùng lệnh bỏ qua 1 attempt đã dùng và điều kiện xác nhận sau stop.
   - Fix: bắt buộc preflight mới có xác nhận ngân sách, prior=1, cap lượt mới ≤20 và prior+cap ≤tổng được duyệt, 2/ca và các chốt 0 USD/no retry/probe/fallback. Bind receipt cũ/source; create-exclusive marker chặn dùng lại preflight. Pending template không phải grant.
   - If we skip it: có thể phát sinh request ngoài quyền dù provider/model/corpus không đổi.

**Kết quả review sau sửa:** không còn finding mới cụ thể trong phạm vi đã kiểm.
Đã đọc đường guard → cả hai caller transport → runner/receipt, setup/isolation và
generator/canonical Draft → Bridge lease/checkpoint/result; không sửa source sản phẩm.
43/43 test offline PASS: có server loopback body chậm/ngắt/timeout/redirect/success,
mock DNS/TLS/kết nối, HTTP/JSON, usage/model/secret, cap 19/20 và retry/corpus;
caller I/O mock kiểm reject grant, Engine SKIP, reuse và source race giữ receipt.
Syntax ba script và diff checks PASS. Hai lần kiểm phát triển lỗi do mock chặn cả
module loader và parser test đọc receipt nhiều dòng; đã sửa test, không phải provider
hoặc workflow failure, không dùng kết quả trung gian làm acceptance.

Integrity: 60 source duy nhất trong baseline mới nhất (53 + 9, trùng 2), 3 harness trước
sửa và 24 artifact refs khớp; canonical/manifest/corpus cùng 13/13 synthetic lịch sử giữ
nguyên. Source/diff/hash, snapshots và receipt kiểm ở
`transportDiagnosticsOffline20261110` trong [evidence](../workflows/n8n/chat-hardening-evidence.json).
Receipt benchmark cũ và mọi trường evidence trước đó nguyên vẹn, không gán diagnostic
mới vào lỗi cũ. Ledger cũ 5.914ms không chứng minh timeout, DNS/TLS hoặc inference/cost.

Giữ timeout guard 5.9s/n8n 6s; budget Draft 20s, workflow 55s, lease 60s gia hạn ở
checkpoint. Không tăng để đạt PASS; chưa chứng minh SLA hoặc đệm đủ 100ms qua Docker.
Nếu đổi WF-02 phải đổi generator/canonical/manifest hash, kiểm lại 13 ca synthetic cùng
body chậm, budget và lease/handoff liên quan trước benchmark; không nghiệm thu bằng
fixture đã chỉnh riêng. [Phân tích và ngân sách](benchmark-n8n-04-plan.md).

Verdict: Ship phần chẩn đoán/kiểm offline. Lượt model mới chờ xác nhận dùng 19 request
còn lại và, nếu cần dự trù đủ 20 calls, bổ sung 1; benchmark vẫn 0 PASS / 1 FAIL / 9 SKIP.
Người chính chưa ký, pilot chưa được chấp nhận, khách thật BLOCKED.
Not checked: provider/DNS/TLS thực, billing, n8n/DB integration với harness mới, Docker,
load/restore/SLA, baseline runtime/env cá nhân; không chạy lại regression không đổi.

## Review lượt benchmark đã cấp quyền — 10/11/2026 01:00:38–01:02:02 (+07:00)

What this change does: Sau xác nhận quyền rõ của người dùng, thêm runner benchmark
hẹp dùng lại setup/isolation đã đạt; guard giữ key ngoài n8n và kiểm từng request/cost/
model/corpus, ép OpenRouter max_price bằng 0 và không fallback. Áp dụng karpathy-guidelines,
Ponytail full và ponytail-review; chỉ một runner local, ca tuần tự, không regression rộng.

**Kết luận: 0 PASS / 1 FAIL / 9 SKIP; benchmark chưa được nghiệm thu.** VI-01 dừng sau
1 attempted planner request với `PROVIDER_TRANSPORT_OR_SECRET_ERROR`, không có status/
response/usage lưu trữ. Khoảng chờ 5.914 ms gần timeout 5.900 ms của client, nhưng catch
đã gộp nhiều nhánh nên không đủ bằng chứng chốt timeout hay nguyên nhân transport cụ thể.
Không có answer/tool hoặc AI outbound; HUMAN/MODEL_ERROR một lần, WF-03 xử lý handoff.
Không thử lại, không chuyển model hoặc gửi probe; VI-02–10 SKIP, quality review=0 ca.

Integrity trước/sau 53 source + 9 acceptance harness + 6 receipt/artifact đạt; canonical,
contract, source sản phẩm và sửa mount theo từng service không đổi. Engine đã sẵn sàng,
không bật Desktop. Project `space-agent-n8n04-acceptance-b180354c558e` mới qua resource
absence/config, actual mount/network và DB workflow/credential=0 trước import; corpus
synthetic mới seed riêng, bản sao inactive. 3 fixture/diff và 3 trace khớp hash; trace nối
WF-01/02/03 DONE/attempt=1 với đúng hội thoại, execution 1/2/3. DB ghi 1 guest, 0 AI,
1 HUMAN/error audit/handoff event, replay 409 và duplicate inbound không thêm tác dụng.
Cleanup kiểm chỉ đọc: 0 container/network, giữ 4 volume. Không đo baseline runtime cũ/env.

**Must fix — finding harness, đã sửa và chỉ kiểm offline sau lượt dừng:**

1. **Attempted send bị báo thành inference và subtotal thành tổng chi phí**
   (`scripts/run-n8n04-benchmark.mjs`, đoạn cập nhật `modelCalled`/`modelInference`;
   `scripts/n8n04-benchmark-guard.mjs`, state cost và catch transport).
   - What this is: ledger tăng trước fetch để chặn vượt cap, raw runner suy `modelInference` từ requests>0; cost khởi tạo 0 dù không có usage.
   - Problem: chính lượt VI-01 không lưu response nào nhưng raw ghi `modelInference:true`, `modelCalled:true`, `costUsd:0`; dùng nguyên các trường này sẽ tuyên bố sai bằng chứng inference/phí. Catch chung cũng không giữ được loại lỗi để phân biệt timeout/transport/secret rejection.
   - Fix: tách request attempts, inference observed và cost unknown khi thiếu usage; ghi hash body thực được forward và phân loại lỗi an toàn. Lưu source-at-run và receipt nguyên hash; biên bản mới giải thích các trường raw, không sửa lịch sử. Tests offline kiểm network failure → inferenceObserved=false, costUsd=null, cùng cap/retry/quota/cost/model/data.
   - If we skip it: lần chạy không có response vẫn có thể được báo là đã inference với phí 0, khiến review/đối soát sai và dễ thử lại khi chưa rõ nguyên nhân.

`node scripts/n8n04-benchmark-guard.test.mjs`, syntax runner/guard và assertions artifact
đạt; tests không đọc credential/call provider. Bản sửa bookkeeping không được gán thành
đã chạy runtime; 3 source-at-run giữ riêng, không rerun Bridge/IAM/browser hoặc acceptance
13/13 cho source sản phẩm không đổi. Chưa có finding code sản phẩm cụ thể từ lỗi này.

**Kết quả được công nhận:** 1 request attempt, 0 response/usage quan sát được,
`modelInferenceObserved:false`, `modelInferenceOccurred:null`, reportedCostUsd=0,
**actualCostUsd=null**. Zero-price routing có trong source lúc chạy; không có chứng cứ
đối soát tài khoản và không gọi API thêm sau điểm dừng. Key chỉ đọc đúng path đã duyệt
sau corpus/isolation gate; không vào workflow, public receipt hoặc output. Điều này không
phê duyệt việc gửi dữ liệu khách hay bỏ gate synthetic.

Raw receipt SHA-256 `c71c52a888623ca951b6759459563dd268543dbdbb4d64d59c1e1bb8ff42df8b`;
biên bản `.local/automation/n8n04-authorized-benchmark-e13e1bd3c9c2/reviewed-benchmark.json`,
SHA-256 `6fc4054adedb85a14ae6927d21ad8c285859e0c889da6e789941dbee35028024`.
Chi tiết ở `finalChecksumAuthorizedBenchmark20261110` trong
[evidence](../workflows/n8n/chat-hardening-evidence.json) và [bàn giao](ban-giao-n8n-04.md).
[OpenRouter niêm yết model miễn phí](https://openrouter.ai/nvidia/nemotron-3.5-lightning:free);
[max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price)
lọc mức giá trước gửi; đây không phải usage/billing receipt của request đã thử.

Verdict: Dừng đúng điều kiện đã duyệt; chưa đạt benchmark/N8N-04 và không chấp nhận pilot.
Not checked: nguyên nhân transport chính xác, xử lý inference/chi phí phía provider,
9 ca còn lại, load/restore/SLA; người chính chưa ký, rollout khách BLOCKED.
Các mục bên dưới giữ nguyên làm lịch sử; mục này là trạng thái hiện hành.

## Review chuẩn bị benchmark cuối — 10/11/2026 (+07:00), chưa có quyền provider

What this change does: Kiểm phạm vi project/harness rồi đề xuất benchmark 10 ca mới trên
checksum cuối; thêm entry point chuẩn bị offline, không có đường đọc credential hoặc gọi
provider/runtime. Áp dụng karpathy-guidelines, Ponytail full và ponytail-review.
Phạm vi một runner local, các ca tuần tự; không audit toàn repo hoặc sửa source sản phẩm.

**Must fix trước lượt inference, chưa chạy:** `test-automation.mjs:42–46` đọc env cá nhân;
`test-chat.mjs:16` đọc key từ env; `:251–256` chạy browser/faults. Vòng benchmark `:241–245`
chưa chốt ngân sách từng request hoặc chạy WF-03 ngay cho từng ca HUMAN. Dùng nguyên
`npm run test:chat` sẽ vượt phạm vi yêu cầu và không bảo đảm điều kiện dừng trước answer.
Cách nhỏ nhất đã chọn: dùng lại setup/isolation hiện có qua runner inference riêng hẹp,
budget/usage guard trước mỗi lần gửi và receipt handoff đầy đủ; kiểm offline trước key/runtime.
Chi tiết tình huống/tác động/cách xử lý ở [kế hoạch benchmark](benchmark-n8n-04-plan.md).
Runner live chưa được triển khai/kiểm; đây là gate còn mở, không phải regression sản phẩm mới.

Entry point `scripts/prepare-n8n04-benchmark.mjs` không import harness live, không HTTP/
child process/Docker/env/credential. Syntax và assertions offline PASS: 53 source hashes,
9 harness hashes, canonical/manifest/benchmark cùng 5 artifact receipt mới nhất khớp.
Không đổi canonical hoặc sửa isolation theo từng service. Receipt mới
`.local/automation/n8n04-benchmark-preparation-43d01aecf302/receipt.json`, SHA-256
`7cf0a5442bcf3a8a490b730e777b74f580fe19b3a1394312ec84c64e565d6004`;
`finalChecksumBenchmarkPreparation20261110` trong [evidence](../workflows/n8n/chat-hardening-evidence.json).
Ngân sách/provider/corpus/path là đề xuất chưa được cấp quyền; không đoán quyền từ
yêu cầu “tự đưa ra quyết định”. Benchmark **0 PASS / 0 FAIL / 10 SKIP**, modelInference=false,
providerRequests=0; source/receipt/evidence lịch sử giữ nguyên, không tái dùng 10/10 cũ.

Verdict: Ship phần chuẩn bị offline; inference BLOCKED chờ xác nhận rõ gói quyền và runner hẹp.
Not checked: key/file existence, Docker/isolation/DB mới, provider pricing/availability/quality,
inference, load/restore/SLA; chưa có chữ ký người chính hoặc chấp nhận pilot.

## Review độc lập sau runtime acceptance — 10/11/2026 (+07:00), trạng thái hiện hành

What this change does: Đối chiếu độc lập acceptance synthetic trên checksum WF-02
cuối với receipt, fixture/diff và trace gốc; review source cùng callers/contracts.
Cập nhật bàn giao và kế hoạch v3 để tách kết quả hiện hành khỏi benchmark lịch sử.
Áp dụng karpathy-guidelines, Ponytail full và ponytail-review; phạm vi một runner local,
các ca tuần tự. Không sửa source/canonical/harness hoặc chạy lại acceptance/regression.

**Kết luận code: không phát hiện finding mới có tình huống lỗi cụ thể trong phạm vi này.**
Findings 1–7 và 9 giữ trạng thái đã sửa trong source; điều kiện dữ liệu khách ở finding 8
vẫn mở. Giữ nguyên bản sửa mount theo từng service tại
`scripts/n8n04-isolation.mjs:46–69`, callers ở runtime và entry point;
không hạ về kiểm volume thuộc project chung.

| Phạm vi source/callers đã đọc | Kết luận |
| --- | --- |
| Entry point → runtime → fixture → acceptance cases → Compose/parser | Không có nhánh provider/key trong entry point hẹp; chỉ bản sao inactive, local fixture không credential. Absence/config → mount thực tế từng service → DB rỗng được assert trước import; cleanup giữ volume |
| Generator/WF-02 → ConversationDraft → `/turn`/draft → schema/outbox/audit | Model ghi ID yêu cầu cố định 1–150 ký tự; không tin metadata response; hai gate và recheck giữ nguyên; session/context/version và proof sau khóa áp dụng cả output/handoff; outbound dedup và event/audit cùng transaction |
| Conversation source token → IAM delegation/introspection → Bridge intent/lease → Catalog/Class | Binding event/entity/input/workflow/version hiện hành, source credential version, live lease/attempt/owner và operation intent giữ nguyên; checkpoint/result thêm expectedVersion và DB time; chỉ read slice/projection/branch |
| Gateway/BFF và regression tests liên quan | Không forward internal routes; giữ kiểm Origin/cookie/ownership. Source không đổi nên giữ Bridge 11/11, IAM 12/12, authority/takeover/revoke/browser làm evidence lịch sử, không chạy lại hoặc gọi chúng là kết quả mới |

**Đối chiếu evidence PASS.** `focusedChecksumAcceptanceRuntime20261110` trong
[evidence gốc](../workflows/n8n/chat-hardening-evidence.json) khớp receipt runtime,
receipt tổng hợp và artifact đã lưu. 53 hash source = 49 technicalRun + 4 finalReview,
9 hash harness, 3 canonical inactive, 11 receipt lịch sử, 15 cặp fixture/diff lịch sử
và 15 cặp runtime đều khớp. WF-02
`885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068`;
manifest `1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a`.
Diff runtime không thay code canonical; gate-only thêm readiness sau `/turn` thật nhưng
giữ policy đóng. Cả hai model URL/credential/header đã đổi trước import.

13/13 ca runtime khớp **13 PASS / 0 FAIL / 0 SKIP**, 23 request fixture
(12 planner / 10 answer / 1 tool), không Authorization, **0 provider**.
Gate không chạy hai model node; tool lỗi zero answer; success có Recheck turn;
8 metadata object/rỗng/151/thiếu × answer/QUOTA qua Submit draft thật.
34 trace WF-01/02/03 nối đúng 34 job và conversation, DONE/attempt=1;
34 execution refs 1–34 theo SQL lookup trong receipt. Kết quả DB ghi nhận
13 hội thoại, 5 AI DELIVERED, 8 HUMAN; một error audit/handoff event mỗi ca lỗi,
replay draft 409 và duplicate inbound không thêm output. Stage offline 13/13,
23 request và 10/10 isolation self-check là stage riêng trong lượt acceptance,
không cộng vào runtime hoặc tính thành inference.

Isolation/DB rỗng trước import và cleanup 0 container/network, giữ 4 volume được
đối chiếu từ receipt/assertions của harness nguyên hash; không đo lại Docker/SQL.
Receipt runtime gốc SHA-256 `acf02e298d356b62c1e7ec46b1ea86b40dd43707f2597fa34cbf44d5991d47c4`;
receipt tổng hợp `27d09a2f9f9f150350ce04f49373d1104fa3990e02dd3e77d77f94363ad75e50`.
Biên bản kiểm mới `.local/automation/n8n04-post-runtime-review-20261110/review.json`,
SHA-256 `50b1c51d35cc31bc855905eb991b04561ed5dbd6e63e06e60f7e348a33783418`;
checker `node .local/automation/n8n04-post-runtime-review-20261110/review.mjs` PASS,
chỉ đọc artifact, không chạy suite/runtime. Checker đầu tiên chặn nhầm path Next
`[...path]` do lọc substring; đã sửa kiểm path component, không phải source/test FAIL.

**Should fix — finding tài liệu, đã sửa trong lượt này:**

1. **Bảng ticket hiện hành dễ khiến benchmark cũ được coi là nghiệm thu bản cuối**
   (`docs/product-plan-v3.md`, dòng N8N-04 mục 4.3 và AG-2 mục 4.2;
   `docs/phan-cong-task-v3.md`, khối trạng thái đầu tài liệu).
   - What this is: Plan vẫn mô tả N8N-04 LOCAL/model thật + benchmark 10/10, chưa dẫn runtime checksum cuối.
   - Problem: người chính đọc bảng ticket để quyết định đóng việc có thể dùng 10/10 checksum cũ cho WF-02 cuối; synthetic 13/13 không kiểm chất lượng model.
   - Fix: thêm trạng thái 10/11 và checklist hiện hành, cập nhật hai dòng ticket; giữ nguyên các khối Actual/Snapshot lịch sử và evidence/receipt.
   - If we skip it: hồ sơ nghiệm thu có thể đóng nhầm ticket hoặc coi pilot đã được chấp nhận khi thiếu benchmark cuối và chữ ký.

**Trạng thái quyết định:** synthetic acceptance **đạt**; benchmark model thật trên checksum
cuối **chưa đạt/chưa chạy**; người chính **chưa ký**, `humanReviewPending:true`;
`pilotAccepted:false`, **pilot chưa được chấp nhận**, khách thật BLOCKED.
[Checklist cho người chính](ban-giao-n8n-04.md#checklist-để-người-chính-quyết-định-nghiệm-thu-n8n-04)
tách integrity/runtime đã đạt khỏi corpus/provider/benchmark/version/drain/recovery,
người nhận HUMAN và quyết định go/no-go còn thiếu. Không suy diễn phê duyệt từ review này.

Verdict: Ship phần evidence acceptance synthetic đã đối chiếu; chưa đóng N8N-04 hoặc chấp nhận pilot.
Not checked: inference/quality/policy provider mới, load/restore/SLA, baseline runtime cũ/env cá nhân;
không đọc key/env cá nhân, gọi provider, chạy Docker/activate/deploy/billing hay xóa volume/prune.

Các mục bên dưới là snapshot lịch sử nguyên vẹn; kết luận hiện hành ở trên có ưu tiên.

## Runtime acceptance checksum cuối — 10/11/2026 00:08:39–00:14:24 (+07:00)

What this change does: Chạy acceptance synthetic biệt lập trên checksum WF-02 cuối bằng `node scripts/accept-n8n04.mjs`. Áp dụng karpathy-guidelines, Ponytail full và ponytail-review; giữ canonical, source sản phẩm và harness nguyên hash, kể cả sửa isolation đối chiếu mount theo từng service. Phạm vi review là một runner local, các ca tuần tự; không có finding code mới cần sửa trong phạm vi này.

**Kết quả mới: runtime 13 PASS / 0 FAIL / 0 SKIP.** Docker đã sẵn sàng tại context `desktop-linux`, Engine `29.1.3`; chỉ kiểm context/version trước chạy, không bật Desktop. Project mới `space-agent-n8n04-acceptance-c0e7bc539e51` đã qua kiểm resource absence, resolved config, mount/network thực tế theo từng service và workflow/credential DB đều bằng 0 trước import. DB/role domain tạo mới; chỉ import/chạy các bản sao inactive. Giữ đối chiếu type/name/target/read-write/network, bind init.sql read-only và service label duy nhất.

Đã đối chiếu receipt và trace thật: gate `providerAllowed=false, modelReady=true` không chạy cả hai model node; success gửi một outbound đúng hội thoại và không trùng; QUOTA/timeout/tool lỗi về HUMAN đúng một lần; tool lỗi có zero answer. Tám tổ hợp metadata object/rỗng/151 ký tự/thiếu × answer/QUOTA đều submit draft thành công, không 400 do contract. Replay draft sau DONE trả 409; duplicate inbound không thêm tác dụng. Tổng DB **13 hội thoại / 5 outbound AI DELIVERED / 8 handoff HUMAN**, **34 job và 34 execution** (refs 1–34); mỗi job WF-02 DONE/attempt=1 và đúng conversation.

Request **runtime mới: 23 fixture** (12 planner / 10 answer / 1 tool), **0 provider**, không Authorization tới fixture. Entry point cũng chạy stage offline mới **13/13 PASS, 23 request fixture riêng, 10/10 isolation self-check**; không cộng chúng vào request runtime. Các kết quả offline/SKIP ở ba mục `focusedChecksumAcceptance`, `focusedChecksumAcceptanceContinuation`, `focusedChecksumAcceptanceResume20261110` vẫn là lịch sử, giữ nguyên.

Integrity trước/sau đạt: 49/53 hash technicalRun + 4/4 hash finalReview, 9/9 artifact harness, 3 canonical inactive; 11 receipt lịch sử và 15 fixture/diff lịch sử nguyên hash. WF-02 `885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068`; manifest `1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a`. Không sửa harness nên không chạy lại Bridge/IAM/browser/regression đã đạt. Sau `down` riêng project test, không còn container project; **4 volume giữ nguyên**, không xóa/prune. Không đọc provider key/env cá nhân, mở dữ liệu khách, activate, deploy hoặc bật billing; không đo baseline runtime cũ/env cá nhân để tuyên bố bảo toàn bằng phép đo.

Receipt tổng hợp: `.local/automation/n8n04-resume-553a3085c920/runtime-acceptance.json`, SHA-256 `27d09a2f9f9f150350ce04f49373d1104fa3990e02dd3e77d77f94363ad75e50`. Receipt runtime gốc: `.local/automation/n8n04-focused-22e671b53fa5/receipt.json`; preflight riêng: `.local/automation/n8n04-resume-553a3085c920/receipt.json`. Hash, diff của 15 fixture runtime, lệnh, request counts, DB outcomes từng ca và job/execution refs tại `focusedChecksumAcceptanceRuntime20261110` trong [evidence](../workflows/n8n/chat-hardening-evidence.json). Bổ sung trường mới, giữ nguyên 24 trường evidence lịch sử và mọi receipt cũ.

Kiểm cuối `node .local/automation/n8n04-resume-20261110-runtime/verify.mjs` PASS: bảo toàn 24 trường lịch sử và nội dung lịch sử hai tài liệu, kiểm source/harness/receipt/fixture/trace/DB outcomes/refs; project test không còn container/network. `git diff --check` PASS cho tracked diff; tài liệu/evidence untracked được verifier kiểm riêng. Kết quả máy đọc tại `.local/automation/n8n04-resume-553a3085c920/verification.json`.

Verdict: Ship phần evidence acceptance synthetic trên checksum cuối; không có finding cần sửa trong phạm vi đã kiểm. `modelInference:false`, `humanReviewPending:true`, chưa có chữ ký người chính, `pilotAccepted:false`, rollout khách BLOCKED.
Not checked: provider inference/quality/policy, load/restore/SLA và baseline runtime cũ/env cá nhân; runtime PASS không phải nghiệm thu pilot.

## Tiếp tục runtime acceptance — 2026-11-10 00:02:37 (+07:00)

What this change does: Kiểm lại checksum, harness và receipt trước acceptance synthetic biệt lập theo karpathy-guidelines, Ponytail full và ponytail-review. Phạm vi review là một runner local, ca tuần tự; không phát hiện lỗi code mới cần sửa trong phần đã đối chiếu.

Kiểm integrity mới **PASS**: 49/53 hash technicalRun và 4/4 hash finalReview khớp; 3/3 canonical inactive. WF-02 vẫn `885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068`; manifest vẫn `1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a`. 9/9 artifact harness, 10 receipt lịch sử và 15 fixture cùng diff khớp hash. Giữ bản sửa đối chiếu mount theo từng service, target/quyền ghi/network; không sửa canonical, source sản phẩm hoặc harness.

**Runtime 0 PASS / 0 FAIL / 13 SKIP.** Ba lệnh chỉ đọc `docker context show`, `docker context inspect --format '{{.Endpoints.docker.Host}}'`, `docker version --format '{{.Server.Version}}'` xác nhận context `desktop-linux`; Engine không kết nối được pipe `dockerDesktopLinuxEngine`. Đã ghi receipt rồi dừng runtime theo yêu cầu. Không bật Desktop hoặc chạy `node scripts/accept-n8n04.mjs` khi prerequisite chưa đạt; không tạo project/network/volume, import hay activate.

**Offline lượt này chỉ xác minh integrity, không chạy lại tests.** 13/13 ca, 23 request fixture (12 planner / 10 answer / 1 tool), 10/10 isolation self-check là kết quả lịch sử ở `focusedChecksumAcceptanceContinuation`, không phải lượt chạy mới. Request fixture mới=0, provider=0; isolation thực tế, DB rỗng và draft HTTP chưa được kiểm; DB outcomes/job/execution refs=null. Không tính SKIP hoặc fixture thành inference/PASS runtime.

Receipt mới: `.local/automation/n8n04-resume-a070c9865eeb/receipt.json`, SHA-256 `4cc202c09d6f1e0990dbced530888c771060ff30df71ea1a4200b724c25f72df`. Lệnh kiểm: `node .local/automation/n8n04-resume-20261110/preflight.mjs`; canonical/fixture hash, diff refs, commands, counts và từng ca SKIP tại `focusedChecksumAcceptanceResume20261110` trong [evidence](../workflows/n8n/chat-hardening-evidence.json). Giữ nguyên toàn bộ 23 trường evidence trước và mọi receipt/fixture lịch sử; baseline evidence lưu riêng trong thư mục receipt.

Không chạy lại Bridge/IAM/browser/regression vì source liên quan không đổi. Không đọc key hoặc env cá nhân, gọi provider, mở dữ liệu khách, deploy, billing, xóa volume/prune. Không đo baseline runtime/env. `modelInference:false`, `humanReviewPending:true`; chưa có chữ ký người chính, pilot chưa được chấp nhận, rollout khách BLOCKED. Khi Engine local đã sẵn sàng, bước kế tiếp vẫn là `node scripts/accept-n8n04.mjs`, với chốt project/network/volume mới, mount đúng từng service và DB rỗng trước import bản inactive.

Verdict: BLOCKED ở prerequisite Docker; chưa nghiệm thu runtime checksum cuối.
Not checked: actual mounts/DB/n8n, provider inference, load/restore/SLA; không có phê duyệt pilot.


## Tiếp tục acceptance — 2026-11-09 23:59:16 (+07:00)

What this change does: Kiểm lại entry point và các module n8n04 theo karpathy-guidelines, Ponytail full và ponytail-review. Sửa một finding isolation cụ thể: volume đúng project nhưng gắn nhầm service vẫn có thể qua chốt cũ. Callers chỉ là entry point và runtime hẹp; không đổi contract/source sản phẩm.

Checksum WF-02 và manifest giữ nguyên; 49/53 hash technicalRun cùng 4/4 hash cuối khớp, 3/3 canonical inactive. Receipt cũ, 15 fixture/diff cũ và chín receipt phát triển đã kiểm lại hash, không ghi đè. Chỉ hai file harness thay đổi.

Offline mới **13/13 PASS**, **23 request fixture** (12 planner / 10 answer / 1 tool), **10/10 self-check isolation**, Compose config và syntax năm script PASS. Chặn thêm mount đổi service, mount thiếu và service label trùng; đối chiếu cả target/quyền ghi/network, vẫn kiểm bind init.sql read-only.

**Runtime 0 PASS / 0 FAIL / 13 SKIP.** Lệnh đọc Docker context/version cho thấy Engine không kết nối named pipe dockerDesktopLinuxEngine. Dừng runtime; không bật Desktop, tạo project/network/volume, import hoặc activate. Isolation/DB rỗng thực tế chưa xác minh; request runtime=0, DB outcomes và job/execution refs=null. Gate readiness=true và draft contract chỉ được kiểm offline, không coi là draft HTTP/DB PASS.

Lệnh: `node scripts/accept-n8n04.mjs --offline`; Docker diagnostics, Compose config và checksum/diff từng fixture tại `focusedChecksumAcceptanceContinuation` trong [evidence](../workflows/n8n/chat-hardening-evidence.json). `focusedChecksumAcceptance` cũ giữ nguyên. Receipt mới: `.local/automation/n8n04-focused-8b8a7680cf50/receipt.json`, SHA-256 `73b9520255c8447a99af9906bdc150331da8499182c2ae4f264455478d742e4d`.

Không chạy lại Bridge/IAM/browser/regression vì source sản phẩm không đổi. Không đọc key/env cá nhân, gọi provider, mở dữ liệu khách, deploy, billing, xóa volume/prune. Fixture `modelInference:false`; người chính chưa ký, `humanReviewPending:true`, pilot chưa được chấp nhận; rollout khách vẫn BLOCKED. Không đo baseline runtime hoặc env cá nhân.

Verdict: Ship phần sửa harness đã kiểm offline; runtime checksum cuối chưa nghiệm thu.
Not checked: actual mounts/DB/n8n, provider inference, load/restore/SLA; không có phê duyệt pilot.


## Review harness acceptance hẹp — 09/11/2026 23:51 (+07:00)

What this change does: Bổ sung entry point credential-free cho checksum WF-02 cuối,
13 ca synthetic và receipt riêng. Giữ nguyên canonical, source sản phẩm, receipt cũ và
`finalChecksumAcceptance`; trạng thái mới ở `focusedChecksumAcceptance` trong
[evidence](../workflows/n8n/chat-hardening-evidence.json).

Đã áp dụng karpathy-guidelines, Ponytail full và ponytail-review. Review source nối từ entry
point → setup Compose/migrations/service → fixture → CLI workflow → SQL assertions; đối chiếu
callers, contract draft, Bridge authorization/result và schema Conversation/outbox/audit.
Giả định một runner local, các ca tuần tự; không suy ra an toàn tải production.
Không tìm thấy finding code cụ thể còn mở trong phạm vi offline đã kiểm.

Harness tái dùng setup hiện có, không import test-chat/test-automation hoặc browser. Chỉ đọc
source/template cho integrity; không có lookup key provider. Hai model URL/credential/header
được thay trước mọi import; guard readiness/policy, binding, intent và lease vẫn giữ.
Gate-only fixture nối thêm node sau `/turn` thật để ép đúng readiness=true khi policy=false;
diff ghi rõ thay đổi này, không biến fixture thành canonical hay inference.

**Offline PASS:** 13/13 ca qua HTTP fixture và code node/contract thật, 23 request không credential
(12 planner / 10 answer / 1 tool), 7/7 self-check isolation, Compose config thực tế, syntax năm script.
Source vẫn 49/53 hash technicalRun + 4/4 hash finalReview, 3/3 manifest workflow inactive.
Các assert DB kiểm một outbound đúng hội thoại, chống trùng, một audit/outbox handoff, DONE/attempt=1,
draft không lỗi và tool lỗi zero answer đã có trong harness nhưng **chưa chạy n8n/DB**.
PASS contract offline không được coi là draft HTTP/DB PASS.

**Runtime SKIP:** 0 PASS / 0 FAIL / 13 SKIP vì Docker Engine chưa sẵn sàng. Lệnh Docker chỉ đọc;
không bật Desktop. Isolation resolved-config đạt nhưng actual project/mount/DB chưa xác minh;
không có project/volume/network, job hoặc execution mới. Ba receipt offline FAIL lúc phát triển
harness vẫn giữ; chúng không phải lỗi workflow. Chi tiết/hash từng fixture, diff, lệnh, counts và
giới hạn ở evidence và [bàn giao](ban-giao-n8n-04.md).

Verdict: Ship. Phạm vi kết luận chỉ là harness để tiếp tục acceptance biệt lập;
chưa nghiệm thu runtime, pilot, provider hay khách thật; người chính/con người chưa ký duyệt.
Not checked: n8n/DB integration và isolation thực tế, provider inference/policy/quality,
load/restore/SLA; không đo lại baseline runtime hoặc hash `.env` cá nhân.

## Acceptance checksum cuối — 09/11/2026 23:34 (+07:00)

What this change does: Xác minh lại checksum và điều kiện chạy acceptance, bổ sung
evidence mới riêng biệt. Không sửa code sản phẩm hoặc nâng kết quả cũ thành nghiệm thu.

**Must fix trước khi chạy:** Docker Engine không kết nối được tại
`npipe:////./pipe/dockerDesktopLinuxEngine` (`desktop-linux`). Harness hiện còn chạy
Bridge/IAM/browser, có nhánh đọc key/gọi provider và thiếu tám tổ hợp metadata HTTP.
Cần Engine có thể dùng mà không thay đổi runtime cũ, entry point chỉ kiểm delta,
fixture không credential và xác minh project/DB/volume/network test mới trước import.
Không khởi động Docker Desktop tự động: cấu hình restart của container cũ có thể làm
runtime hiện có tự chạy. Đây là blocker môi trường/harness, không phải bug WF-02 mới.

**Kết luận review:** Có review độc lập cho phép acceptance synthetic biệt lập;
chưa tìm thấy chữ ký/kết luận duyệt của người chính/con người, evidence vẫn giữ
`humanReviewPending:true`. Pilot và khách thật chưa được duyệt.

Kiểm mới: hash **49/53** technicalRun giữ nguyên, đúng **4/4** hash thay đổi khớp
finalReview, **3/3** workflow khớp manifest và inactive. WF-02 vẫn
`885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068`;
manifest `1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a`.
Không phát hiện source liên quan đổi thêm, nên không chạy lại regression đã đạt.

Acceptance runtime **0 PASS / 0 FAIL / 13 SKIP**: gate đóng; success; QUOTA; timeout;
tool lỗi/zero answer; tám tổ hợp metadata. Chưa có project, job hoặc execution mới.
Lệnh, Docker FAIL, receipt hash và giới hạn đo kiểm nằm tại `finalChecksumAcceptance`
trong [evidence](../workflows/n8n/chat-hardening-evidence.json) và
[bàn giao](ban-giao-n8n-04.md). technicalRun/finalReview và receipts cũ giữ nguyên.

Verdict: BLOCKED trước execution; chưa nghiệm thu checksum cuối hoặc pilot.
Not checked: n8n/DB acceptance, isolation thực tế, bảo toàn env/runtime bằng phép đo,
provider/load/restore/SLA; không đọc key/env, gọi provider hoặc thay đổi runtime.

## Review độc lập 09/11/2026 — quyết định bước kiểm chứng tiếp theo

What this change does: Hardening đóng egress theo mặc định, ràng buộc lượt chat với
authority hiện hành và chặn worker cũ ghi kết quả. Sửa cuối lưu model ID yêu cầu cố
định để metadata provider không làm draft hoặc handoff vi phạm contract.

**Kết luận:** Không tìm thấy lỗi code cụ thể còn phải sửa trong findings 1–7 và 9
trước acceptance synthetic biệt lập. Bản cuối **đủ để đưa vào acceptance**, chưa phải
pilot đã nghiệm thu; khách thật vẫn BLOCKED. Không sửa source hoặc thêm test trùng
với test đã đạt. Phạm vi tải được đánh giá vẫn là smoke local, tối đa hai lease Bridge.

Đã đọc source, callers và contracts thay vì chỉ dựa vào kết luận trước:

| Finding | Đối chiếu độc lập | Bằng chứng được giữ, không chạy lại |
| --- | --- | --- |
| 1 | `index.ts` ánh xạ policy; `createConversationApp` cần test + synthetic; `/turn` giấu prose, draft chặn output; hai IF và Prompt giữ gate | Harness kiểm key-ready/gate đóng và production; n8n nhánh blocked trước sửa cuối |
| 2 | `/turn` khóa session → conversation, đọc lại context/proof trong transaction; history chỉ GUEST/AI đã deliver; Recheck turn trước answer | Harness takeover/release và loại STAFF; đây không phải thu hồi request đã gửi |
| 3 | Draft kiểm proof sau khóa cho cả error và output | Harness giữ khóa thật, quan sát chờ khóa, expire lease, trả 409 và giữ AI |
| 4 | Output lấy source token và channel delegation mới; IAM so credential version, active source và context; command introspection kiểm lại Bridge/delegation | Harness rotate/revoke chặn draft và token Catalog đã cấp; error handoff vẫn được phép khi guest/context/worker còn hợp lệ |
| 5 | Tool allowlist xử lý entry sai; Sources ready bỏ answer khi tool lỗi; Draft kiểm text bằng giới hạn contract | Workflow tests; HTTP tool 503 đếm answer bằng 0, thuộc checksum trước sửa cuối |
| 6 | Cả guest và staff dedup so text + sender trước trả receipt | Harness gửi UUID/text STAFF qua endpoint guest nhận 409 |
| 7 | Turn/draft so conversation/entity/version/event/input; IAM thêm workflow/version/operation; domain dùng live IAM và projection guest | Harness tráo context sống, event/input; Bridge/IAM contracts và suites cũ |
| 9 | Tool allowlist không truyền model metadata; Draft luôn dùng ID cố định, cả answer/QUOTA; `ConversationDraft` yêu cầu string 1–150 | Test 4 metadata × 2 nhánh dùng contract thật; 8/8 sau sửa là kết quả được ghi tại finalReview, không chạy mới lượt này |

Bridge checkpoint/result dùng owner + leaseToken + attempt + expectedVersion và DB time;
authorization-check dùng owner + leaseToken + attempt + intent, không yêu cầu expectedVersion.
IAM command introspection so binding hiện tại; domain callers chỉ mở read slice/branch
được cấp. Gateway/BFF không forward internal routes. Revocation từ xa và commit local
vẫn không atomic; đây là giới hạn đã công bố, không tuyên bố đã khắc phục.

**Kiểm tra offline mới:** 49/53 hash technicalRun còn khớp; đúng bốn file đã ghi trong
finalReview thay đổi. Cả 4/4 current hash và 3/3 manifest workflow hash khớp. Generator
chạy với read/write thay bằng bộ nhớ tạo 4/4 artifact giống từng byte, không ghi file.
WF-02: `885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068`.
Manifest: `1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a`.
Lần thử đầu của phép kiểm bộ nhớ dừng do giả định LF tại import trong file CRLF;
đã sửa phép kiểm và đạt, không phải lỗi source. Chi tiết tại `independentReview` trong evidence.

Không tái xác minh private receipt/trace hoặc bảo toàn runtime/env trong lượt này;
các kết quả đó chỉ được đọc từ evidence trước. 8/8 sau sửa, Bridge 11/11, IAM 12/12,
17 nhóm chat và browser không được gắn nhãn test mới. 64 task gồm 56 cache hits và
40 test skip không chứng minh chạy mới; HTTP synthetic không phải inference;
10/10 inference lịch sử không nghiệm thu checksum cuối.

**Bước kế tiếp được đề xuất, chưa thực hiện:** acceptance n8n trên project/DB/network
mới, chỉ corpus synthetic và fixture HTTP không credential. Chốt hai hash ở trên;
giữ canonical inactive, không overwrite runtime v1 hiện có. Kiểm chính xác:

1. Import/execution WF-02 cuối cùng với WF-01/03 không đổi; gate đóng dù readiness=true
   không chạy cả hai model node, lưu HUMAN/DATA_POLICY_BLOCKED.
2. Success đi qua tools → Recheck turn → answer → draft → outbound đúng hội thoại,
   một message AI; model lưu là ID yêu cầu, không phải chứng thực model thực chạy.
3. QUOTA, timeout và tool 503 về HUMAN một lần, không có AI giả; tool lỗi không gọi answer.
4. Bổ sung vào bản fixture HTTP private các response `model:{}`, `model:""`, dài 151
   ký tự và thiếu model, cho cả answer và QUOTA (8 tổ hợp). Kiểm Submit draft không 400,
   success có outbound và QUOTA có HUMAN, không DEAD do contract. Harness faults hiện
   chỉ trả model string hợp lệ; unit test đã phủ 8 tổ hợp nhưng chưa có n8n receipt.
5. Lưu canonical hash, hash/diff bản fixture, job/execution refs, trạng thái DB và request
   counts, ghi `modelInference:false`. Bản fixture chỉ thay readiness/URL/credential,
   thêm response sai metadata; phải giữ providerAllowed và kiểm binding/fence thật.

Không cần chạy lại toàn bộ Bridge/IAM, browser, full workspace, takeover/revoke/binding
hoặc lease regression chỉ vì đổi metadata. Giữ chúng làm bằng chứng cho source không đổi;
nếu chuẩn bị acceptance làm đổi source/contracts/authority liên quan, chạy lại đúng phần
đó. `npm run test:chat` hiện chạy cả N8N-02/03 và browser, nên không dùng nguyên lệnh này
để mô tả một acceptance chỉ kiểm delta. Thiết kế entry point có phạm vi hẹp trước lượt chạy.

Chủ dữ liệu còn phải xác nhận corpus/history/traces hoàn toàn tổng hợp và ACL/retention.
Chủ tài khoản phải duyệt riêng mọi provider call, endpoint/model, hạn mức/free/no paid
fallback; acceptance fixture không cần key hoặc provider. Reviewer/người chính còn chốt
version/checksum, isolation và drain/recovery trước thay đổi runtime. Nếu duyệt inference
synthetic thật, cần bộ 10 ca trên checksum cuối, không tái dùng 10/10 cũ làm nghiệm thu mới.
Mở khách thật cần thay đổi riêng và đầy đủ phê duyệt dữ liệu ở finding 8.

Verdict: Đưa bản cuối vào acceptance synthetic biệt lập; chưa chấp nhận pilot hoặc rollout.
Not checked: n8n checksum cuối, provider/policy/inference mới, load/restore/SLA;
không đọc key/env, không gọi provider hoặc thao tác runtime.

## Rà soát cuối — thay thế kết luận về checksum bên dưới

What this change does: Giữ gate synthetic và các kiểm authority hiện có. Sửa thêm
metadata `model` sai dạng từ provider làm draft/handoff bị contract từ chối.

**Must fix 9 — đã sửa, chờ review:** Trong generator, `Tool allowlist` và `Draft`
đọc `$json.model` mà không kiểm kiểu/độ dài. Response có `model:{}`, `model:""`
hoặc dài 151 ký tự khiến `ConversationDraft` trả 400, kể cả nhánh QUOTA; workflow
có thể kết thúc DEAD và conversation còn AI. Draft nay ghi model ID yêu cầu cố định
`nvidia/nemotron-3.5-lightning:free`; bỏ metadata trung gian không còn dùng.
Trường này ghi model được yêu cầu, không chứng thực model provider thực sự chạy.
Response gốc trong trace (nếu được lưu) vẫn là evidence riêng và phải bảo vệ như bí mật.
Không đổi request provider, quyền tool, schema API/DB hoặc nghiệp vụ.

Test mới `provider model metadata cannot break a valid draft or error handoff`
đã FAIL trên source trước sửa, PASS sau sửa: bốn dạng metadata × hai nhánh
answer/QUOTA, kiểm bằng contract thật. Sau sinh lại canonical artifacts:
Conversation **8/8**, typecheck, lint và syntax generator đạt. Các test bị lọc khỏi
lượt tái hiện lỗi không tính PASS; lượt đầy đủ sau sửa không skip.

Trước sửa, **53/53** hash của `technicalRun.artifacts` + `extraArtifacts` khớp tree.
Đã đối chiếu receipt private với bản public: project/thời điểm, Bridge/IAM test results,
checks chat, HTTP faults, preservation và 50 artifact hashes khớp; public chủ ý bỏ
trường receipt IAM private. Sau sửa, **49/53** hash cũ còn khớp; bốn file đổi là
generator, workflow test, WF-02 và manifest. Hash mới và phạm vi kiểm chứng nằm tại
`finalReview` trong evidence. Không sửa hash cũ để giả rằng integration đã chạy bản mới.

Đối chiếu findings với callers/contracts/tests:

| Finding | Chốt trong source và kiểm chứng tương ứng |
| --- | --- |
| 1: provider gate | Conversation config/index + `/turn`/draft; Model ready, Prompt, Provider still allowed; harness test gate đóng cả khi key-ready và production synthetic |
| 2: context history | Khóa session → conversation → đọc context/proof trong transaction; chỉ GUEST/AI; harness takeover/release, STAFF exclusion; workflow Recheck turn |
| 3: handoff lease | Draft proof sau khóa áp dụng cả error/output; harness giữ khóa DB thật, expire lease, yêu cầu 409 và mode AI |
| 4: source revoke | IAM credential version/channel delegation; draft output lấy lại source authority; harness rotate/revoke kiểm cả draft và domain token |
| 5: malformed/tool error | Tool allowlist, Sources ready, Draft; workflow tests + HTTP fixture tool 503 không gọi answer; bổ sung finding 9 ở lượt cuối |
| 6: dedup sender | Guest/staff endpoints kiểm sender cùng key/text; harness receipt STAFF đưa vào guest trả 409 |
| 7: context binding | Turn/draft đối chiếu entity/conversation/event/input; IAM binding thêm workflow/version/operation; harness tráo context và từng ref trả 403 |

Bridge checkpoint/result giữ owner + leaseToken + attempt + expectedVersion và DB time;
authorization giữ operation intent + lease/attempt. Domain callers chỉ nhận read slice
với live IAM/Bridge check, projection guest và branch scope; Gateway/BFF không forward
internal routes. Không phát hiện thêm lỗi cụ thể ở bốn vùng trọng tâm trong phạm vi
synthetic local đã mô tả. Đây không phải bảo đảm không còn lỗi ngoài phạm vi đó.

Integration n8n, browser và bốn HTTP fixtures phía dưới thuộc **checksum trước sửa 9**;
không nghiệm thu checksum WF-02 cuối. Không chạy lại Bridge/IAM hay full workspace check
đã đạt khi source tương ứng không đổi. Chưa chạy n8n sau sửa vì lượt này không activate
workflow hoặc tác động runtime; cần acceptance riêng trên project synthetic biệt lập.

Verdict: Bản sửa đủ để người chính review; pilot và dữ liệu khách thật vẫn chờ các gate
trong [gói bàn giao](ban-giao-n8n-04.md). Không còn finding code cụ thể chưa xử lý trong
phạm vi rà soát này.
Not checked: integration của checksum WF-02 cuối, inference mới, policy provider,
production/load/restore và SLA 20s; không đọc key hay thay đổi runtime.

What this change does: Chặn xuất dữ liệu ra provider theo mặc định, dù đã cài key.
Chỉ cho phép deployment test biệt lập khai báo dữ liệu tổng hợp; chưa cung cấp chế độ
cho khách thật. Sửa kiểm authority nguồn, lease sau khi chờ khóa, context model và nhánh lỗi workflow.

Phạm vi: Conversation → IAM/Bridge → Catalog/Class → WF-01/02/03 → outbound web.
Đã đọc callers, Zod contracts, migrations, Gateway/BFF, machine authority và harness.
Giả định tải hiện tại là smoke local, tối đa hai lease Bridge; chưa có bằng chứng tải production.
Không mở nghiệp vụ, thêm dependency, đổi DB schema hoặc triển khai lên runtime hiện có.

## Must fix — đã sửa trong source, chờ người chính review

1. **Có key đã đủ để gửi văn bản tự do ra provider**
   ([app.ts](../services/conversation/src/app.ts), [generator](../scripts/build-chat-workflows.mjs)).
   - What this is: `/turn` trả tám tin gần nhất sau regex; WF-02 gọi OpenRouter khi `modelReady=true`.
   - Problem: `Em là Nguyễn Văn An, ở ngõ Hoa Sen; hồ sơ bệnh án riêng` hoặc nội dung nội bộ không có nhãn vẫn đi qua. `name/goal/policyText` Catalog đi vào tool content mà không qua redactor.
   - Fix: backend yêu cầu cả `NODE_ENV=test` và `CHAT_PROVIDER_DATA_POLICY=synthetic-only`. Mặc định `/turn` trả `messages:[]`, `providerAllowed:false`, `DATA_POLICY_BLOCKED`; chặn draft thành công. WF-02 yêu cầu cả readiness và admission, chuyển HUMAN khi thiếu điều kiện.
   - If we skip it: bật key vô tình cho phép gửi dữ liệu khách và nội dung nội bộ tới bên ngoài. Regex không phải bộ nhận diện toàn bộ PII; `{consent:true}` cũng không chứng minh quyền gửi dữ liệu cho provider cụ thể.

2. **Lịch sử lấy sau context check có thể vượt qua takeover/revoke hoặc gồm tin STAFF**
   ([app.ts](../services/conversation/src/app.ts)).
   - What this is: `/turn` kiểm context, chờ IAM rồi SELECT lịch sử ở connection khác.
   - Problem: input mới hoặc takeover trong khoảng đó làm lịch sử không còn thuộc version đã duyệt. Sau HUMAN → AI, câu trả lời STAFF cũng bị đưa vào prompt như lời assistant.
   - Fix: khóa session rồi conversation, đọc lại context và lease trước khi lấy lịch sử trong cùng transaction; chỉ lấy GUEST/AI. Workflow kiểm `/turn` lần nữa trước câu trả lời model.
   - If we skip it: worker có thể nhận văn bản mới hoặc tin nhân viên chưa thuộc lượt đã được phép. Đây là admission check; không thu hồi được một request đã gửi ra provider.

3. **Handoff dùng lease hết hạn sau khi chờ khóa**
   ([app.ts](../services/conversation/src/app.ts)).
   - What this is: draft kiểm Bridge trước transaction; chỉ nhánh output kiểm lại sau khóa.
   - Problem: giữ khóa conversation, bắt đầu draft lỗi TIMEOUT, để lease hết hạn rồi nhả khóa: worker cũ vẫn chuyển AI → HUMAN.
   - Fix: kiểm lại proof sau khóa/context cho cả output và lỗi. Test DB giữ khóa thật, xác nhận request đang chờ, expire lease rồi kiểm 409 và conversation vẫn AI; reclaim/đóng đúng job test.
   - If we skip it: attempt cũ thay đổi mode sau khi quyền làm việc đã hết.

4. **Draft thành công còn sống sau khi credential nguồn bị rotate/revoke**
   ([app.ts](../services/conversation/src/app.ts), [machine.ts](../services/identity/src/machine.ts)).
   - What this is: domain reads kiểm source credential version; draft trước đây chỉ kiểm worker và context local.
   - Problem: model đang xử lý, operator rotate `channel-source`, model trả về: draft vẫn có thể được lưu, dù domain token đã bị chặn.
   - Fix: trước output, lấy source token hiện hành và xác nhận channel delegation qua IAM; sau đó kiểm lại worker/lease. Draft lỗi vẫn được chuyển HUMAN nếu guest/context và worker còn hợp lệ.
   - If we skip it: thu hồi nguồn không chặn được kết quả đang bay về.

5. **Lỗi tool vẫn gọi model lần hai; phản hồi sai dạng có thể làm job chết mà không handoff**
   ([generator](../scripts/build-chat-workflows.mjs), [workflow tests](../services/conversation/src/workflow.test.ts)).
   - What this is: Sources nối thẳng tới Model answer, còn Draft chỉ kiểm text truthy.
   - Problem: Class 503 vẫn gửi một request model; `tool_calls:[null]` gây lỗi code, text object/trắng/dài hơn 4.000 ký tự bị contract draft từ chối.
   - Fix: lỗi Sources đi thẳng Draft/HUMAN; kiểm array/tool entry và text trước submit. Fixture đếm request để chứng minh tool lỗi không gọi answer; unit test các dạng phản hồi sai.
   - If we skip it: phát sinh egress/latency không cần thiết và hội thoại có thể nằm AI sau job DEAD.

6. **Inbound dedup không phân biệt sender**
   ([app.ts](../services/conversation/src/app.ts), [harness](../scripts/test-chat.mjs)).
   - What this is: khóa dedup dùng chung trong một conversation.
   - Problem: gửi lại UUID và text của một tin STAFF vào endpoint guest trước đây trả success như một tin IN đã nhận.
   - Fix: receipt cũ phải có sender GUEST; khác sender trả 409. Test dùng UUID/text của tin STAFF đã gửi qua API thật.
   - If we skip it: receipt inbound có thể trỏ tới outbound, dù không tạo được quyền đọc hội thoại khác.

7. **Draft chưa ràng buộc context với đúng conversation/event/input**
   ([app.ts](../services/conversation/src/app.ts), [harness](../scripts/test-chat.mjs)).
   - What this is: `/turn` kiểm toàn bộ binding từ Bridge; draft chỉ kiểm context còn sống và conversation/version của job.
   - Problem: một producer/job sai mang context đang sống của conversation B nhưng entity A có cùng version có thể gửi output vào A. Context hợp lệ riêng lẻ không chứng minh nó thuộc job hiện tại.
   - Fix: draft đối chiếu conversation, entity/version, eventId và inputRef. Test tráo context sống khác hội thoại, rồi event/input riêng lẻ, yêu cầu 403 trước outbound.
   - If we skip it: lỗi producer hoặc event bị giả mạo trong mạng nội bộ có thể làm lẫn output giữa hội thoại. Không mở quyền publish broker cho khách hoặc model.

## Must fix — điều kiện rollout dữ liệu khách thật còn mở

8. **Chưa có policy cho phép xuất dữ liệu khách hoặc corpus đã duyệt**
   - What this is: gate hiện chỉ cho synthetic test, không tự xác minh từng chuỗi có phải dữ liệu giả.
   - Problem: cấu hình test trên hệ thống nhận khách thật sẽ vi phạm giả định; free-text Catalog và prompt injection vẫn có thể chứa thông tin nhạy cảm. Tên model có hậu tố free không phải phê duyệt điều khoản xử lý dữ liệu.
   - Fix: người chính cùng chủ dữ liệu duyệt provider/model, retention/training/region, mục đích, thông báo/consent và corpus. Nếu cần mở dữ liệu thật, phải có thay đổi riêng được review, giới hạn dữ liệu và kiểm capture payload tại egress; không chỉ đổi cờ hiện tại.
   - If we skip it: không có căn cứ cho phép chuyển dữ liệu tới bên ngoài. **Giữ blocked; không rollout khách thật.**

## Dữ liệu thực sự đi tới model

| Request | Nội dung body | Những phần không được hiểu là đã an toàn |
| --- | --- | --- |
| Model tool request | model cố định, max_tokens=500, system prompt, tối đa tám GUEST/AI text đã redact, hai tool schema không nhận tham số | Tên/địa chỉ không nhãn, sức khỏe, dữ liệu trẻ em, bí mật/token dán trong prose, số viết bằng chữ/obfuscation vẫn có thể tồn tại |
| Model answer | model cố định, max_tokens=800, prompt trước, assistant/tool call từ provider, tool content JSON Courses/Packages/Classes và notice, tool_choice=none | Catalog `id/name/goal/level/deliveryModes/policyText/policyVersion`; Package `id/courseId/name/sessionCount/priceVnd/policyText/policyVersion`; Class snapshot gồm IDs, sessions/thời gian, số chỗ còn và server time. Văn bản Catalog không qua redact |
| Headers/transport | TLS OpenRouter cố định, Authorization từ n8n credential store; provider thấy IP/thời điểm request | Không đưa key vào body, fixture hoặc canonical exports. Không thể cam kết nhà cung cấp không giữ dữ liệu chỉ từ code trong repo |

Không gửi owner/branch/session/lease/attempt, credential IAM hay tin STAFF trong messages.
Những ref này vẫn có trong node/job/execution nội bộ: execution đầy đủ phải coi là bí mật.
Projection domain bỏ teacher/room ID, online URL và điều kiện nội bộ, nhưng projection không chứng minh
các trường được giữ lại đã được biên tập cho công khai. Gate chặn toàn bộ hai request model khi chưa đủ điều kiện.

## Kiểm chứng và giới hạn

Kết quả trước sửa cuối và checksum nằm trong [hardening evidence](../workflows/n8n/chat-hardening-evidence.json),
mục `technicalRun`; trạng thái checksum cuối nằm trong `finalReview`.
Lượt chốt `space-agent-automation-test-84b9f5572f7c`, **01:17:43–01:22:08 ngày 09/11 (+07:00)**:
Bridge **11/11**, IAM **12/12** (không skip), **17 nhóm N8N-04**, browser và **4 fixture HTTP** PASS.
Unit/workflow **7/7**; workspace check **64/64 task**, 56 cache hits, còn 40 default-suite tests skip.
Từng hash source trong receipt đã được đối chiếu với tree tại lượt chốt trước sửa finding 9.
Bộ 10/10 model trước hardening là **lịch sử**, không phải rerun cho checksum WF-02 mới.
Không gọi provider, đọc key hoặc bật billing trong lượt hardening. Fixture HTTP được ghi rõ
`modelInference:false`; câu trả lời tổng hợp chỉ chứng minh wiring, authority và outbound.
Capture body trên đường HTTP tới fixture được giữ private và ghi hash trong receipt;
không gọi đó là capture tới provider thật. Bản fixture chỉ bỏ readiness của key ở các
guard liên quan; giữ `providerAllowed`, thay cả hai model URL và bỏ credential trước import.
Đã kiểm lại hash **10/10 trace model lưu trữ**, không chạy lại inference hoặc tái nghiệm thu chất lượng.
Ba lượt FAIL và volume vẫn giữ nguyên. Tổng tài nguyên riêng hardening: **12 volume / 681.244 KiB**
và **4.126.944 byte** private project artifacts theo receipts; bốn project test đều đã dừng.

Đã giữ checks branch/ownership, CAS, dedup/outbox, queued cancel, expiry/reclaim và live IAM revocation.
Bridge vẫn dùng DB time, owner + leaseToken + attempt + expectedVersion cho checkpoint/result;
authorization proof dùng lease/attempt và operation intent, không thay thế CAS Conversation.

Giới hạn còn lại cần người chính cân nhắc:

- Check quyền từ IAM/Bridge và commit Conversation ở các DB khác nhau: vẫn có khoảng thời gian
  sau check, không có atomic cross-service revocation; không hứa hủy request provider đã nhận.
- `sources` là metadata từ workflow, không phải biên nhận được backend ký; nó không chứng minh
  model trích đúng nội dung. Không mở worker tùy ý hoặc generic URL/tool tunnel.
- HTTP nội bộ 3s, model 6s, tối đa hai model calls; Draft kiểm budget 20s sau khi xử lý.
  Workflow timeout 55s có thể để job chờ lease expiry/retry, không phải cam kết handoff trong 20s.
  Không bật node retry; retry kỹ thuật do Bridge quản lý với tối đa tám thất bại. Sau mất response
  checkpoint/result phải đối chiếu trạng thái/version, không tự gửi lại bằng fence cũ.
- Log HTTP dùng route pattern, không body/header/query. Job/event refs nối được evidence;
  chưa có kiểm chứng distributed tracing liên tục qua toàn bộ IAM/Bridge/provider.
- Chưa thử tải/multi-replica, remote CI, full restore/RPO/RTO, incident retention/purge hoặc egress firewall.
  Execution test cố ý lưu dữ liệu riêng tư trong `.local`; cần ACL/retention/backup phù hợp trước vận hành.
- Chưa nâng version deployment WF-02 hay migrate job đang chạy: artifacts vẫn v1/inactive cho local.
  Không hot-import đổi nội dung vào worker đang chạy; cần kế hoạch version/checksum và drain/replay có review.

Verdict: Chấp nhận để người chính review hardening và test synthetic biệt lập; chưa ship cho khách thật.
Not checked: model inference mới, policy provider hiện hành, production/load/restore và SLA 20s.

</details>

