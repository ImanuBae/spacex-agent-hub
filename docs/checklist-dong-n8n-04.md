# Checklist đóng N8N-04 — 11/11/2026 (+07:00)

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

### Checklist hiện hành sau lượt mới

| Mục | Kết quả | Còn thiếu |
| --- | --- | --- |
| VI-02 policy/version từ nguồn | ACCEPTED kỹ thuật:61unit/14native/4transport mới | Live answer chưa tới vì planner bị từ chối |
| Tool contract một hành động | OPEN:request required cho≥1,workflow nhận đúng1 | Chốt khả năng serial-control/schema phù hợp endpoint; không nới quyền để lấy PASS |
| Bộ10ca checksum cuối |1PASS(template)/1FAIL/8SKIP | Chạy lại bằng grant mới sau khi xử lý contract,không retry lượt đã dừng |
| Quota/metadata | DONE:đã đọc thật,trước31/50,sau30/50;ngân sách app23/40 | Không đồng nhất budget app với reset quota tài khoản |
| Provider nội bộ | Metadata có cho response hoàn chỉnh | Call timeout cũ chưa có ID,nguyên nhân vẫnUNKNOWN |
| Integrity/cleanup/ACL |65source/779refs cũ;7project down;15new roots ACLverified | Không coi export5files là restore DB/key đã đạt |
| Quyết định nghiệm thu | Codex được ủy quyền:NOT_ACCEPTED toàn task | Không cần giả chữ ký người dùng;chỉ đổi ACCEPT khi đủactual/expected |

Ưu tiên tiếp theo là contract single-action, không phải mua quota hoặc tăng timeout.
Còn17capacity trong trần40,nhưng marker/grant đã stop không tái dùng. Dữ liệu thật,
Enrollment/Payment,WF-04–12 và pilot không giám sát tiếp tục đóng.


**Quyết định hiện hành của Codex theo ủy quyền: NOT_ACCEPTED toàn N8N-04;
model pilot NO_GO; khách thật BLOCKED.** Benchmark thật mới đã chạy và dừng đúng
gate, không phải một kế hoạch chưa thực hiện. Quota được giữ ở trần23 theo câu trả
lời “có bao nhiêu dùng bấy nhiêu trước đã”; đề xuất18request/trần36 chưa được cấp.

Phạm vi đóng ticket là demo local web chat chỉ đọc qua WF-01/02/03, tool nguồn thật,
hộp thư/handoff/guard và bộ10ca tiếng Việt trên checksum cuối. Không mở giao dịch,
Facebook/Zalo hoặc WF-04–12. Phê duyệt khách thật, production và50hội thoại gán nhãn
trước auto-send final vẫn là các gate riêng trong plan v3, không được tự coi đã đạt.

| Điều kiện | Actual hiện tại | Còn phải làm |
| --- | --- | --- |
| Canonical/source/integrity | PASS:65source,706refs cũ; WF-02 69476ff95cbdbe26520002db381fd51291b4caf6545e5ba912c93dcef3ed1e44 | Nếu sửa code, bind checksum mới và kiểm phần bị ảnh hưởng |
| Synthetic kỹ thuật | Giữ58offline/14native/4transport PASS ngày10/11, source không đổi | Không rerun toàn regression; thay WF-02 thì chạy lại14ca và affected transport/budget/lease |
| VI-01 làm rõ | PASS mới:đúng2câu, không khóa/giá,0modelrequest,template được ghi rõ | Không đánh tráo thành inference PASS hoặc classifier nhiều lượt |
| VI-02 giá/policy | FAIL mới:100000VND/1buổi/nguồn đúng, thiếu policy/version trong answer | Sửa cách bảo đảm thông tin policy/version từ nguồn xuất hiện trong output; prompt đơn thuần chưa đủ |
| VI-03 lịch/chỗ | FAIL mới:HTTP200,22byte body chưa hoàn chỉnh,timeout5900ms | Quyết định vận hành provider/deadline dựa trên số đo; chưa chứng minh nguyên nhân phía server; không tăng deadline để lấy PASS |
| VI-04–10 | SKIP sau guard stop | Chạy mới trên checksum cuối khi có grant/budget phù hợp; review nguồn/quyền/injection/giá/policy/handoff từng ca |
| Authority/session/source/lease/CAS | Các checks source không đổi được giữ; lượt mới3replay409/dedup,1handoff TIMEOUT | Không bỏ guard để chạy tiếp |
| Ngân sách/chi phí | 4mới/22tích lũy;3usage/2515token;reported subtotal0;call4 và actualCost unknown | Còn1request không đủ bộ đầy đủ; không retry/probe/accountAPI hoặc tăng cap mặc nhiên |
| Version/drain/recovery/rollback | Đã chốt chỉ bản sao v1 inactive/hash cố định; không claim job cũ/replay UNKNOWN; giữ volumes/export | Deployment thật/version rollout cần thay đổi riêng |
| ACL/retention/backup local | Hai thư mục mới được hạn chế quyền;62items PASS;5workflow/corpus/manifest copies hash khớp | Không tuyên bố ACL cũ/backup mã hóa/DB-key restore đã đạt; giữ evidence đang review, chưa bật purge |
| HUMAN/pilot | Backend queue một lần đã kiểm; chưa chỉ định người trực/SLA/escalation cho vận hành | Không mở pilot không giám sát khi thiếu người nhận; Codex là reviewer kỹ thuật, không giả làm nhân viên trực |
| Nghiệm thu được ủy quyền | Codex đã review actual/expected và quyết định NOT_ACCEPTED | Chỉ ghi ACCEPT khi đủ bộ đầu ra, không cần giả chữ ký người dùng |

Thứ tự xử lý tiếp để có thể đóng:

1. Sửa finding cụ thể VI-02: câu trả lời giá/policy phải nêu đúng phiên bản từ
   Catalog; giữ nguồn/readAt. Kiểm response thiếu version, dữ liệu thiếu/nhiều
   version và đường fail-closed. Không tự bịa version hoặc sửa fixture để che lỗi.
2. Chốt khả năng phục vụ của provider trong budget vận hành: số đo mới cho thấy
   body có tiến triển nhưng không hoàn tất trước5,9s. Cần phân biệt giả thuyết
   queue/generation/gateway/network với điều đã chứng minh. Không tự đổi model,
   stream protocol hoặc SLA để tránh lỗi; deadline nào cũng phải khớp node/Draft/
   workflow/lease và có kiểm chậm/handoff. Một request còn lại không phải probe.
3. Sau mọi thay đổi WF-02: sửa generator, sinh canonical/manifest, review diff và
   kiểm14native/affected cases trên checksum cuối. Giữ kết quả không bị ảnh hưởng.
4. Một lượt benchmark đầy đủ cần grant mới, bắt đầu VI-01 và bind prior thực tế22.
   VI-01template0request;9ca model tối đa2request/ca => upper bound18request.
   Cap23 hiện chỉ còn1; chưa có quyền tăng cap. Không reuse marker/grant đã stop,
   không ghép PASS checksum cũ vào lượt mới, không coi quota còn lại là quyền retry.
5. Review đủ10actual/expected, source/trace/DB/usage/cost và nhánh handoff; giải
   quyết finding trước khi Codex quyết định nghiệm thu. Giữ FAIL/UNKNOWN/SKIP nếu
   chưa đủ. Sau đó cập nhật bảng ticket; pilot/khách thật giữ quyết định riêng.

Lượt11/11:3hội thoại/3GUEST/2AI DELIVERED/1HUMAN TIMEOUT;7job/execution.
Raw0PASS/1FAIL/7SKIP/2reviewPending được giữ bất biến; review1PASS/2FAIL/7SKIP.
Cả2AI đã gửi trong môi trường synthetic; VI-02 bị đánh FAIL sau review, không
ghi như đã bị backend chặn. Ba usage reports reasoning0; call timeout chưa biết.

| Độ trễ quan sát | VI-01 | VI-02 | VI-03 |
| --- | ---: | ---: | ---: |
| WF-02 đến Result (ms) |1772|6569|8561|
| Inbound đến Submit draft (ms) |12740|16876|18541|

Số đo có overhead CLI/harness, không phải browser percentile hoặc bảo đảm20s SLA.
Cleanup:chỉ project mới space-agent-n8n04-acceptance-53fde8a94470 đã down;
0container/network,5APIport đóng,4volumes giữ. Không bật Desktop/activate/deploy,
đọc env cá nhân/dữ liệu khách hoặc xóa volume/prune. Provider key được đọc đúng
đường đã cấp sau isolation/seed, không in/log key và không đọc credential khác.

Bằng chứng:

- [Receipt](../.local/automation/n8n04-closeout-20261111-653595913f6f/final-receipt.json) và [review từng ca](../.local/automation/n8n04-closeout-20261111-653595913f6f/quality-review.json).
- [Chẩn đoán](../.local/automation/n8n04-closeout-20261111-653595913f6f/diagnosis.json), [quyết định vận hành](../.local/automation/n8n04-closeout-20261111-653595913f6f/local-operations-decision.json).
- [Grant mới](../.local/automation/n8n04-closeout-20261111-653595913f6f/preflight.json), [cleanup](../.local/automation/n8n04-closeout-20261111-653595913f6f/cleanup.json), [ACL](../.local/automation/n8n04-closeout-20261111-653595913f6f/acl-verification.json).
- [Verification](../.local/automation/n8n04-closeout-20261111-653595913f6f/verification.json); [bàn giao](ban-giao-n8n-04.md); [index](../workflows/n8n/chat-hardening-evidence.json).

Giá được kiểm lại bằng metadata công khai và [trang model](https://openrouter.ai/nvidia/nemotron-3.5-lightning:free),
không suy ra từ hậu tố free. Metadata hiện chỉ quảng cáo prompt/completion0, không
có request field; không ép trường thiếu thành0. Routing vẫn ép cả3max_price0,
tắt fallback và buộc usage.cost0; [quy tắc max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price).

Chưa kiểm:nguyên nhân nội bộ provider,usage/billing call dở dang,7ca còn lại,
production/load/restore/SLA. Không tuyên bố đã hoàn thành toàn bộ N8N-04.

</details>

