# N8N-04 — đề xuất benchmark checksum cuối, 10/11/2026 (+07:00)

<!-- CURRENT_N8N_LINK -->
Trạng thái hiện hành ngày14/11/2026,acceptance matrix,10ca,hashes,ngân sách và runbook:
[nghiệm thu N8N-03/04](acceptance-n8n-03-04.md).
**N8N-03 ACCEPT local; N8N-04 ACCEPT local** —10/10 corpus cuối,8câu trả lời model,2nhánh deterministic;16generation0USD. Agent đã nghiệm thu;production/khách thật/WF-04–12 vẫn đóng.

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


## VI-01 và instrumentation — 10/11/2026 (+07:00), trạng thái hiện hành

**Đã nghiệm thu kỹ thuật VI-01 template + instrumentation synthetic theo ủy quyền
cho Codex; N8N-04 vẫn PARTIAL / NOT_ACCEPTED, model pilot NO_GO, khách thật BLOCKED.**
WF-02 hỏi đúng hai câu mục tiêu/thời gian học khi GUEST ở lượt đầu nói rõ chưa biết
học gì, không gọi model hay đề xuất khóa/giá. Matcher chỉ bao phủ sự lưỡng lự rõ
ràng ở lượt đầu; giữ readiness/policy, source đọc Catalog/Class, recheck và backend
contract. Runner ghi `CLARIFICATION_TEMPLATE`, model inference=false, không tự
đánh dấu thành benchmark model PASS.

Guard có số đo headers/byte đầu-cuối/số byte-chunk/body complete/thời gian đọc và
khoảng im lặng cuối body, không lưu body dở dang. Đây là thời gian quan sát Fetch
ở client, chưa xác định queue/generation/network phía provider. Deadline/cap giữ
nguyên. **58/58 offline, 14/14 native (13 cũ + 1 mới), 4/4 transport integration**
PASS: trước headers, trước byte đầu, treo sau 9 byte và n8n kết thúc trước guard.
Receipt FAIL do cạnh workflow trùng lúc phát triển được giữ; generator đã sửa và
có regression check. Guard cuối có checks riêng sau lần native, canonical/harness
không đổi.

WF-02 mới `69476ff95cbdbe26520002db381fd51291b4caf6545e5ba912c93dcef3ed1e44`;
manifest `eddb8150c5c4144187bc25b46b0cd14883d360118a6b8b425141c652d0b19352`.
WF-01/WF-03/corpus không đổi. **0 provider request thật, không đọc key; vẫn 18/23,
còn 5**. Bốn loopback requests không cộng vào tổng thật. Benchmark thật gần nhất
**1 PASS / 2 FAIL / 7 SKIP thuộc checksum cũ**; chưa có model benchmark trên bản mới,
chưa chứng minh timeout thật đã hết, actualCostUsd lịch sử vẫn null. Muốn chạy tiếp
cần grant mới bind checksum/history hiện hành trong quota còn lại; không tái dùng
grant đã dừng, không tự tăng quota hoặc đóng N8N-04.

Cleanup 6 project mới: 0 container/network, 32 cổng đóng, giữ 24 volumes; không
activate/deploy/sửa runtime cũ. 445 refs lịch sử giữ nguyên. Xem
[bàn giao hiện hành](ban-giao-n8n-04.md), [review](review-n8n-04-hardening.md) và
[verification](../.local/automation/n8n04-clarification-instrumentation-20261110-13ca6d43f755/verification.json). Các kết quả bên dưới là lịch sử, không phải kết quả
model cho checksum mới; các production gates vẫn chưa hoàn tất.


## Lượt sửa reasoning/timeout theo ủy quyền — 10/11/2026 (+07:00)

User giao Codex quyền kỹ thuật và quyết định nghiệm thu. Giữ trần 23: prior 12/max 11,
2/ca, 0 USD, retry/probe0, fallback=false; không suy diễn quyền tăng cap hoặc đổi model.
Runner đã bind toàn history, chống đếm trùng/unknown; source 64 file và delta 8 file+1 test
mới được ghi rõ. WF-02/manifest mới có reasoning.enabled=false, routing 0 USD,
prompt/policy version và Han guard; guard 5.900 ms/node 8.000 ms/Draft 20 s/workflow 55 s/lease 60 s.

**53/53 offline, 13/13 canonical runtime, 3/3 transport integration mới PASS**, sau hai
receipt phát triển expression lỗi được giữ riêng. Preflight/marker live mới chỉ tạo
sau các kiểm, public price và source integrity; runtime mới kiểm absence/mount/network/
DB rỗng/seed/hash/inactive trước approved key. Không dùng kết quả checksum cũ thay mới.

Benchmark **14:52:56–14:55:07 (+07:00)** dừng VI-03answer body timeout, 6 request mới/
18 tích lũy, 5 response/usage báo reasoning 0, cost 0, 4.318 token. Review **1 PASS/2 FAIL/7 SKIP**:
VI-01 sai clarifying/source facts, VI-02 PASS policy version/giá/nguồn, VI-03 FAIL timeout,
VI-04–10 SKIP. Cost tổng/actualCostUsd=null; còn 5 request nhưng không resume/retry.

Quyết định được ủy quyền: **chấp nhận kỹ thuật synthetic; chưa nghiệm thu N8N-04,
NO-GO pilot có model, khách thật BLOCKED**. Tắt reasoning đã được xác nhận nhưng chưa
chữa hết timeout; không có provider-side evidence để quy nguyên nhân request lỗi.
7 project mới đã down, 0 container/network, giữ 28 volume; không activate/deploy hoặc xóa/prune.
[Hồ sơ/quyết định](ban-giao-n8n-04.md), evidence `delegatedReasoningTimeoutFix20261110`.
Lượt sau phải có grant mới bind prior 18; không dùng lại marker hoặc tự tiêu5 request còn lại.

## Engine sẵn sàng, cap 23 đã chạy — 10/11/2026 (+07:00), dừng VI-05

Sau ảnh Docker của người dùng, Engine 29.1.3 được kiểm đọc; tiếp tục quyền đã cấp bằng
preflight/marker mới, prior 3/max 20/total 23, 2/ca, 0 USD, retry/probe 0, fallback=false.
63 source /141 ref khớp; integration admission mới 1/1 PASS qua n8n/DB, 1 loopback/0 provider/
key thật chưa đọc. Giữ ba ca transport và offline/canonical lịch sử cho source không đổi.
Cả project synthetic và live mới đạt isolation/DB rỗng/seed/hash/inactive trước egress.

Lượt thật **13:43:14–13:46:13 (+07:00)**: **9 request mới/12 tích lũy**, bốn answer hoàn
chỉnh rồi VI-05planner headers 200/body timeout5.917 ms. Dừng ngay, không retry/probe,
VI-06–10 SKIP. Review riêng: **2 PASS / 1 FAIL / 2 NEEDS_REVIEW / 5 SKIP**; VI-01 trộn tiếng Trung,
VI-02 thiếu visible policy version, VI-03/04 PASS, VI-05 FAIL do thiếu response. Raw
0 PASS / 1 FAIL / 5 SKIP / 4 reviewPending được giữ nguyên. 8 usage/8.544 token/cost subtotal 0;
costUsd/actualCostUsd=null. Chưa đạt10 ca; người chính chưa ký, pilot chưa được chấp nhận.

Giữ timeout/canonical/manifest, không nâng hạn để lấy PASS. Hai project mới đã down,
0 container/network, 10 API port đóng, giữ 8 volume. Còn11 request chưa dùng nhưng không resume
sau guard stop. Trước phiên provider khác phải bind prior 12 và quyền mới, không chạy
lại runner baseline 3 hoặc xóa marker. [Kết quả/checklist/no-go](ban-giao-n8n-04.md),
evidence `engineReadyBudget23Benchmark20261110`; các mục bên dưới giữ làm lịch sử.

## Lượt tiếp tục đã cấp cap tích lũy 23 — 10/11/2026 (+07:00), SKIP Engine

Prompt đính kèm cấp **prior=3, max mới=20, total=23, 2/ca, 0 USD**, retry/probe=0,
paidFallback=false; provider/model/credential/corpus giữ nguyên. Runner/test đã sửa để
bind đủ raw receipts 1+2 và session receipt gần nhất, kiểm count/hash/cumulative trước
marker/Docker; 9/9 caller tests và syntax đạt. Receipt/history/grant cũ không sửa.

Preflight mới `.local/automation/n8n04-continuation-20261110-7e45a36dfd4a/preflight.json`
đã claim bằng marker wx, không được chạy lại. Docker context desktop-linux, pipe Engine
không tồn tại → **SKIP_ENGINE_UNAVAILABLE**, lượt mới **0 PASS / 0 FAIL / 10 SKIP**;
0 provider/loopback, không đọc key hoặc tạo runtime. Không bật Desktop để vượt gate.
Integration runtime admission mới/isolation/seed **SKIP**, không coi 3/3 lịch sử là lượt mới.

Benchmark thật gần nhất vẫn **0/1/9**, 3 attempt tích lũy, planner844 token/cost báo0,
answer headers200/body timeout, actualCostUsd=null. Giữ timeout5900/6000/20000/55s/60s,
không đổi canonical/manifest; 13/13 synthetic, 43/43 offline, 3/3 transport là lịch sử.
Public model/routing đã kiểm; không phát sinh completions probe hoặc account API.

Phiên này hoàn tất ở gate Engine, không tự resume hoặc xóa marker. Khi có lượt mới,
đối chiếu receipt hiện hành và quyền còn hiệu lực, tạo grant mới một lần; phải đạt runtime
integration/isolation/corpus và kiểm lại giá trước key/egress. Bắt đầu VI-01, không dùng
DONE/fixture/benchmark cũ làm PASS. [Checklist/no-go và quyền quyết định](ban-giao-n8n-04.md),
evidence mới `continuationBudget23EngineSkip20261110`; người chính chưa ký, pilot chưa
được chấp nhận, khách thật BLOCKED. Các mục dưới giữ nguyên làm lịch sử.

## Đã thực hiện ngân sách mới — 10/11/2026 (+07:00), dừng đúng gate

Prompt hiện tại đã xác nhận dùng19request còn lại và bổ sung1: cap lượt mới20,
tích lũy21, prior 1, 2/ca, 0 USD, retry/probe/paid fallback=0. Không còn chờ xác nhận gói
OpenRouter/endpoint/model/credential/corpus đã ghi. Template pending và grant lịch sử
giữ nguyên; grant mới `.local/automation/n8n04-confirmed-20261110-a7d62f90/preflight.json`
đã có marker dùng một lần, không được xóa hoặc tái dùng.

Integrity 63 source/45 refs, public zero-price và routing max_price 0/no fallback đạt.
Engine local 29.1.3 sẵn sàng, không bật Desktop. Đã kiểm3/3 integration synthetic
guard/runner/n8n/DB trước đọc key thật, 0 provider: timeout trước headers; body chậm
sau headers 200; n8n kết thúc trước guard khi I/O chậm mà receipt vẫn giữ chứng cứ.
Mỗi lượt dùng project/DB/roles/network/volumes mới, actual mounts từng service,
DB rỗng/seed synthetic/hash trước egress, import inactive, giữ gate/binding/lease/fence.

Lượt thật02:58:28–03:00:02: **0 PASS / 1 FAIL / 9 SKIP**, dừng VI-01 answer timeout
đọc body sau headers 200. Planner response hợp lệ844token/cost0; answer thiếu body/usage.
**2 request mới / 3tích lũy**, còn18trong cap nhưng không tự retry/resume sau stop.
Reported subtotal 0, costUsd=null, actualCostUsd=null; chi phí attempt cũ vẫn chưa biết.
1 HUMAN/TIMEOUT, 0 AI, một audit/event; replay 409/dedup đạt. Chưa có final answer để
review chất lượng; VI-02–10SKIP. Không dùng DONE, fixture hoặc 10/10lịch sử làm PASS mới.

Giữ guard 5.900 ms/node 6.000 ms/Draft 20.000 ms/workflow 55s/lease 60s gia hạn; đệm100ms không
bảo đảm guard trả trước n8n, không hứa handoff 20s. WF-02/manifest/corpus không đổi;
13/13 synthetic và43/43offline là lịch sử được giữ, không rerun regression không đổi.
4 project mới đã down, 0 container/network, 20 API port đóng, giữ16volume và artifacts.

[Bảng từng ca, checklist, hash và bàn giao](ban-giao-n8n-04.md),
[review cuối](review-n8n-04-hardening.md), evidence `confirmedBudgetIntegrationBenchmark20261110`.
Lượt hiện tại kết thúc ở guard stop; chưa có quyền tự mở thêm lượt sau điểm dừng này.
Còn mở: body chậm/chi phí chưa đối soát, benchmark cuối chưa đạt, người chính chưa ký,
pilot chưa được chấp nhận, rollout khách BLOCKED. Các mục bên dưới giữ làm lịch sử.


## Lượt mới sau chẩn đoán offline — chờ xác nhận ngân sách, 10/11/2026 (+07:00)

**Giai đoạn 1 hoàn tất offline; giai đoạn 2 chưa chạy.** Lượt thực gần nhất vẫn
0 PASS / 1 FAIL / 9 SKIP, đã dùng 1 attempt, không có response/usage được xác nhận,
actualCostUsd=null. Chưa xác định nguyên nhân lỗi cũ hoặc chất lượng model. Các mục
phía dưới là snapshot lịch sử; mục này có ưu tiên cho lượt mới.

Giữ đúng gói đã duyệt: OpenRouter `https://openrouter.ai/api/v1/chat/completions`,
`nvidia/nemotron-3.5-lightning:free`, credential duy nhất
`D:\Imanu\Study\space-agent-hub\.local\credentials\openrouter.key`, corpus VI-01–10
hash `1cb9d4820c820ebe2e4063e0f97b3e80fc302278a8e81e7edaf22a8c6dd855e9`
và Catalog/Class tổng hợp đã mô tả trong bảng lịch sử. Không yêu cầu chọn lại gói này.
Lượt offline không đọc credential hoặc xác minh route/giá hiện hành qua mạng.

| Ngân sách cần xác nhận sau guard stop | Giá trị |
| --- | --- |
| Cap đã duyệt / attempt đã dùng / phần còn lại | 20 / 1 / tối đa 19 request; không tự gia hạn quyền sau stop |
| Phương án đề xuất cho 10 ca mới | Cho dùng 19 còn lại + duyệt bổ sung 1; cap lượt mới 20, cap tích lũy 21 |
| Nếu chỉ cho dùng 19 còn lại | Cap lượt mới 19, tích lũy 20; có thể SKIP khi chưa đủ 10 ca nếu cần hai calls/ca |
| Chốt không đổi | 2 request/ca, 0 USD, probe=0, retry=0, paid fallback=false; không bật billing/đổi model |

Preflight mẫu mới tại `.local/automation/n8n04-transport-offline-033b560c8abc/preflight.json`
đang **PENDING_BUDGET_CONFIRMATION**, cap lượt mới=null; không được chạy live.
Chỉ sau xác nhận mới ghi grant và cap tương ứng trong **preflight mới**, chốt lại hashes;
không sửa snapshot/template pending hoặc grant của lượt cũ thành lịch sử đã cấp quyền.
Runner nhận đường dẫn preflight mới, từ chối grant cũ/pending và ràng buộc receipt của
1 attempt đã dùng; marker create-exclusive chặn dùng cùng preflight hai lần, kể cả khi
lượt đó dừng vì prerequisite. Marker không được xóa để thử lại. Engine SKIP không tiêu
request provider; mọi lượt sau vẫn cần đối chiếu và ghi quyết định riêng, không reset.

Giữ guard 5.900ms, n8n 6.000ms, budget Draft 20.000ms, workflow 55s và lease 60s
(checkpoint gia hạn). Đệm 100ms mong manh; chưa đo qua runtime mới. Budget ở Draft
không cắt toàn turn sau 20s, cũng không đảm bảo handoff 20s. Chưa đổi canonical;
WF-02/manifest giữ hash đã có 13/13 synthetic. Nếu cần thay timeout/WF-02, phải có căn
cứ/decision riêng, sinh canonical+manifest checksum mới và acceptance 13 ca WF-02 cùng
headers/body chậm, budget và lease/handoff liên quan; fixture khác timeout không chứng
minh acceptance canonical cũ.

Trình tự sau xác nhận (chưa thực hiện):

1. Chốt preflight mới: cap thực được duyệt và 1 attempt trước đó, source 60 baseline +
   3 harness mới, canonical/manifest/corpus, receipt/ledger mới nhất; lệch thì dừng review.
2. Docker chỉ đọc context/endpoint/version; Engine chưa sẵn sàng → **SKIP và dừng**,
   không bật Desktop, pull image hoặc đụng runtime cũ.
3. Tạo project/network/volume/DB/roles/credential test mới; absence/config rồi actual
   mount/network **từng service**, init.sql read-only và DB rỗng trước import. Seed corpus
   synthetic mới có hash, chỉ chạy bản sao inactive; giữ guard/binding/fence/recheck.
4. Bắt đầu VI-01 như ca đầu mới. Chỉ tiếp tục VI-02–10 khi response/usage/cost/guard
   của ca trước hợp lệ; không retry/probe/fallback. Chạm bất kỳ chốt dừng đã duyệt thì
   dừng ngay, ca chưa chạy SKIP; không thử lại để sửa điểm.
5. Review đủ 10 actual/expected nếu chạy được: nguồn/thời điểm/policy/giá/lịch, tool,
   guard, AI outbound/handoff đúng hội thoại, usage/reported cost và phần chưa đối soát,
   trace hash, job/execution refs, DB outcomes/replay/dedup. DONE, fixture hoặc 10/10 cũ
   không phải benchmark mới PASS. Lưu từng ca và cleanup riêng project test, giữ volume.

43/43 test offline và syntax đã đạt; chứng cứ/diff ở `transportDiagnosticsOffline20261110`
trong [evidence](../workflows/n8n/chat-hardening-evidence.json). Chưa kiểm Docker, n8n/DB
với harness mới hoặc provider/billing; chưa ký nghiệm thu/chấp nhận pilot, rollout BLOCKED.

## Quyền và kết quả hiện hành — 10/11/2026 (+07:00)

Người dùng đã cấp quyền rõ **“tôi cấp quyền cho bạn”** cho gói bốn phần bên dưới.
Runner hẹp/guard đã triển khai và kiểm offline trước đọc key/runtime; không chạy
entry point regression rộng. Lượt mới 01:00:38–01:02:02 dừng sau VI-01 theo điều kiện
đã duyệt: **0 PASS / 1 FAIL / 9 SKIP**, 1 attempted planner request, không quan sát
được model response/usage; không retry. DB về HUMAN/MODEL_ERROR đúng một lần.
Project mới đã dừng riêng, giữ 4 volume; canonical inactive/source sản phẩm không đổi.

Quyền đã cấp không biến thành benchmark PASS: chưa xác nhận provider có thực inference
hay chi phí tài khoản; reportedCostUsd=0, actualCostUsd=null. Không tiếp tục 9 ca còn lại
hoặc thử lại VI-01 sau guard stop nếu chưa có chỉ dẫn cho lượt mới. Tách bằng chứng
attempt và observed inference; raw receipt giữ nguyên và có biên bản giải thích sửa lỗi
bookkeeping chỉ kiểm offline. [Kết quả/refs](ban-giao-n8n-04.md),
[finding/review](review-n8n-04-hardening.md), evidence `finalChecksumAuthorizedBenchmark20261110`.
Người chính chưa ký, pilot chưa được chấp nhận; các đoạn đề xuất/chưa có quyền bên dưới
giữ nguyên làm snapshot lịch sử, không phải trạng thái hiện hành.

**PROPOSED / PROVIDER AUTHORIZATION NOT GRANTED.** Người dùng giao Codex tự chọn
phương án sau khi kiểm project; chưa xác nhận rõ quyền đọc credential, corpus và
ngân sách theo điều kiện đã đặt. Chỉ chuẩn bị offline, không suy ra quyền gọi provider.
Benchmark mới **0 PASS / 0 FAIL / 10 SKIP**, inference=0, request=0, chi phí thực tế=0.
Không có project/DB/credential/runtime mới. Người chính chưa ký, pilot chưa được chấp nhận.

## Gói đề xuất để xác nhận một lần

| Phần cần xác nhận | Phương án Codex chọn, chưa được cấp quyền |
| --- | --- |
| Provider / endpoint | OpenRouter / `https://openrouter.ai/api/v1/chat/completions`; HTTPS, không redirect, không đổi endpoint |
| Model | `nvidia/nemotron-3.5-lightning:free`, đúng manifest hiện tại; không paid fallback hoặc đổi model khi hết quota |
| Credential | Chỉ file `D:\Imanu\Study\space-agent-hub\.local\credentials\openrouter.key`, lấy đường dẫn từ runbook; chưa kiểm file có tồn tại, chưa đọc nội dung; không đọc key/env khác |
| Corpus hội thoại | Đúng 10 input VI-01–VI-10 trong [benchmark](../workflows/n8n/chat-benchmark.json), SHA-256 `1cb9d4820c820ebe2e4063e0f97b3e80fc302278a8e81e7edaf22a8c6dd855e9`; mỗi ca một session mới, không history khách/nhân viên hoặc output lịch sử |
| Corpus Catalog | Một khóa `DEMO — Excel cơ bản`, mục tiêu `Học hàm Excel cơ bản và xử lý bảng tính`, beginner/online; gói `DEMO — Excel online một buổi`, 1 buổi, 100.000đ; policy đúng chuỗi ở receipt đề xuất: chưa công bố hoàn/chuyển, cần tư vấn viên; không giữ chỗ/tạo đơn |
| Corpus Class | Một lớp OPEN online tổng hợp cùng khóa/gói/branch, capacity=10, không hold; một buổi UTC tương lai. IDs ngẫu nhiên và thời điểm seed mới được ghi riêng, không lấy DB cũ. Nội dung lịch/giá chỉ từ API test thật |
| Traces | Lưu private trong project test mới; không public key/token/header/body nhạy cảm. Public chỉ tổng hợp đã che, refs, hashes, expected/actual tổng hợp được review |
| Ngân sách đề xuất | Tối đa **20 provider request tổng**, tối đa **2/ca**, **0 USD**, probe=0, retry=0; không tái dùng/resume 10/10 cũ. Đây là đề xuất, chưa phải ngân sách được duyệt |
| Dừng | Trước request vượt cap; 429/quota, timeout/network/provider lỗi, response sai dạng, usage.cost thiếu/không hợp lệ/>0, model/endpoint khác, redirect, tool/URL/dữ liệu ngoài quyền, lộ secret hoặc isolation/lease/binding sai. Ca chưa chạy ghi SKIP; lỗi chất lượng ghi FAIL, không gọi lại để sửa điểm |

Trước request đầu cần xác minh model/route còn miễn phí ở thời điểm chạy. Không suy ra
giá 0 chỉ từ hậu tố `:free` hay benchmark cũ; không xác minh được thì dừng. Usage/cost
là báo cáo sau request, không phải cơ chế hoàn tác phí. Chốt request/cost ở đường gọi
provider phải kiểm trước lần kế tiếp, kể cả giữa planner và answer. Không thể chứng minh
phù hợp ngân sách 0 USD thì không gọi; tuyệt đối không bật billing/nạp tiền.

## Review phạm vi và lựa chọn harness

Đã đối chiếu cấu trúc workspace, README/kế hoạch/runbook, luồng Conversation →
IAM/Bridge → Catalog/Class → WF-01/02/03, manifest/benchmark và evidence cuối.
Đây là kiểm phạm vi phục vụ benchmark, không phải audit toàn bộ repository.

| Điểm cần xử lý trước inference | Tình huống / tác động | Cách nhỏ nhất được chọn |
| --- | --- | --- |
| `scripts/test-automation.mjs:42–46`, `scripts/test-chat.mjs:16`, `:251–256` | `npm run test:chat` hash env cá nhân, có nhánh đọc key từ env và chạy Bridge/IAM/browser/fault regression ngoài phạm vi | Không gọi entry point rộng; dùng lại `withAcceptanceRuntime` và isolation hiện có qua runner riêng hẹp, nhận duy nhất quyền/credential đã xác nhận |
| `scripts/test-chat.mjs:241–245` | Vòng benchmark không có chốt request/usage/cost trước mỗi egress; kiểm cuối một workflow có thể quá muộn để dừng answer sau planner lỗi ngân sách | Runner hẹp cần bộ đếm chung trên đường gửi request và kiểm response trước request tiếp; test offline cap/quota/cost/model/endpoint/retry trước key hoặc runtime |
| Cùng vòng benchmark | Handoff chỉ lưu state, không chạy WF-03 ngay trong từng ca để có receipt đầy đủ | Runner chạy WF-03 cho ca HUMAN, kiểm một handoff event/error audit và DONE đúng hội thoại; không dùng job tồn từ regression |

Giữ canonical/source sản phẩm/harness acceptance đã đạt nguyên hash. Không refactor
`test-chat.mjs` hoặc chạy lại regression chỉ để chuẩn bị benchmark. Runner inference hẹp
**chưa triển khai/kiểm**; đây là gate công việc tiếp theo sau xác nhận rõ gói trên,
không phải tuyên bố runner live đã sẵn sàng. Script chuẩn bị không có đường chạy live:

```powershell
node scripts/prepare-n8n04-benchmark.mjs
```

Script chỉ dùng fs/crypto/assert/path/url, không HTTP, child process, Docker hoặc env/key.
Nó kiểm 53 source hashes, 9 harness hashes, canonical/manifest/benchmark và 5 artifact
receipt mới nhất; ghi proposal cùng 10 SKIP vào thư mục `.local` mới, không sửa evidence.
Receipt chuẩn bị: `.local/automation/n8n04-benchmark-preparation-43d01aecf302/receipt.json`,
SHA-256 `7cf0a5442bcf3a8a490b730e777b74f580fe19b3a1394312ec84c64e565d6004`.
Syntax và assertions offline đã đạt; không có model inference mới.

## Thứ tự thực hiện sau khi được cấp quyền rõ

1. Chốt lại gói được duyệt, hash corpus/benchmark, WF-02
   `885d4f6e35103bc177c96f7de3938b42b1adae63f02b43a29ee675c0fab98068`,
   manifest `1096403f14f46e88bb215e9b3a21f7369654912989b4074b99c3f0fb6ec6749a`
   và receipt mới nhất; có delta ngoài phạm vi thì dừng review lại.
2. Hoàn thiện runner hẹp và kiểm offline admission/ngân sách, sanitization và
   fixture diff. Không truyền credential khi các kiểm này chưa đạt.
3. Chỉ đọc Docker context/endpoint/version; Engine không sẵn sàng thì receipt
   SKIP và dừng, không bật Desktop. Không pull image/cài dependency tự động.
4. Dùng setup `n8n04-runtime.mjs`, project/network/4 volume/DB/roles/machine credential
   mới; absence/config trước up, actual mount/network từng service và workflow/credential
   DB=0 trước import. Giữ readonly bind init.sql, restart=no, canonical inactive;
   không hot-import/runtime cũ. Fixture chỉ thay port, lưu trace và đường transport
   có kiểm ngân sách; không bỏ gate/recheck/authority, không đổi prompt/model/contract.
5. Seed corpus tổng hợp trong DB test mới, lưu hash seed/snapshot trước egress.
   Chỉ sau đó đọc đúng credential được phép; không probe ngoài cap, không env cá nhân.
6. Chạy tuần tự đủ 10 ca nếu không chạm điều kiện dừng. Với mỗi actual/expected:
   đối chiếu tool Catalog/Class, nguồn/thời điểm/policy/giá/lịch, allowlist/guard;
   AI outbound đúng hội thoại/DELIVERED/không trùng hoặc HUMAN/handoff thật.
   VI-10 cần WF-03; VI-05/06/07 không được đọc khách khác, xuất token, gọi URL hoặc
   tạo đơn/chỗ/QR. `chat_messages.model` là model được yêu cầu, không chứng thực inference.
7. Ghi private trace và receipt sau từng ca; phân biệt execution DONE, review chất lượng
   PENDING/PASS/FAIL và ca chưa chạy SKIP. Ghi request thực, usage/cost, canonical/fixture
   hash + diff, job/event/execution/conversation refs, SQL outcomes và prompt/model version.
   Chưa đủ 10 ca mới được review đạt thì benchmark chưa PASS; không dùng cache/fixture/10 ca cũ.
8. Dừng riêng process/project test, giữ volume; cập nhật bàn giao/review/evidence bằng mục
   mới và xác minh bảo toàn lịch sử. Không activate/deploy, xóa volume/prune hoặc ký pilot.

Người dùng cần xác nhận rõ bốn phần ở bảng đầu trước bước phụ thuộc provider.
Quyền benchmark không tự cấp chữ ký người chính, chấp nhận pilot hoặc quyền dữ liệu khách.

</details>

