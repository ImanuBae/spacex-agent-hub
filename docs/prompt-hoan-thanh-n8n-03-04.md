# Prompt ủy quyền hoàn thành N8N-03 và N8N-04

```text
Làm việc tại D:\Imanu\Study\space-agent-hub.

Tôi giao bạn toàn quyền thực hiện kỹ thuật và quyết định nghiệm thu để hoàn
thành 100% N8N-03 và N8N-04 theo phạm vi/acceptance của dự án. Hãy thực hiện
công việc, không chỉ đưa kế hoạch hoặc báo cáo phần còn thiếu.

Đây là nhiệm vụ triển khai và kiểm chứng local với dữ liệu tổng hợp. Hoàn thành
hai ticket không đồng nghĩa triển khai production hoặc mở cho khách thật.

1. Quyền được cấp và nguyên tắc thực hiện

- Tự quyết định thiết kế, sửa code/contracts/migrations/workflow/harness, build,
  kiểm thử, chẩn đoán và nghiệm thu. Không hỏi lại các quyết định kỹ thuật thường
  lệ hoặc xin lại quyền đã ghi trong prompt này.
- Tự khởi động Docker Desktop/Engine khi cần; kéo đúng image đã pin, tạo runtime,
  network, DB, role, credential và volume test riêng. Được activate workflow trong
  runtime test mới để kiểm luồng tự động khi cần; ghi rõ activation này và tách
  khỏi các kiểm dùng bản sao inactive.
- Được bổ sung dependency nghiệp vụ tối thiểu cần thiết để đạt acceptance thực
  của N8N-03/04. Chưa có service/API thì triển khai đường thực cần thiết theo
  kiến trúc và policy demo có nhãn, không thay bằng stub rồi đóng ticket.
- Được tự chọn hoặc thay model/upstream provider miễn phí có thể truy cập qua
  tài khoản OpenRouter hiện có nếu model hiện tại không phù hợp. Kiểm giá,
  quyền và khả năng hỗ trợ tham số trước khi dùng; cố định lựa chọn trong từng
  lượt benchmark và ghi model/provider/config/checksum rõ ràng.
- Được điều chỉnh deadline/budget nếu có phân tích vận hành và kiểm thử tương
  ứng. Giữ thứ tự deadline client/node/workflow, budget và lease nhất quán.
  Không kéo timeout chỉ để lấy PASS hoặc gọi budget Draft là SLA toàn lượt.
- Được quyết định ACCEPT/NOT_ACCEPTED và đóng ticket khi đủ bằng chứng, không
  chờ tôi ký lại phần nghiệm thu kỹ thuật đã ủy quyền. Ghi reviewer là agent,
  không giả chữ ký, hành động phê duyệt hoặc sự có mặt của một con người.

2. Đọc hiện trạng trước khi sửa

Đọc AGENTS.md ở root và thư mục liên quan. Áp dụng karpathy-guidelines bản
project, Ponytail full và ponytail-review. Dùng Playwright khi kiểm browser;
đọc bundled docs của Turbo trước khi thay đổi cấu hình/lệnh Turbo.

Đọc các tài liệu và source liên quan:
- docs/product-plan-v3.md, docs/phan-cong-task-v3.md.
- docs/ban-giao-n8n-03.md, docs/ban-giao-n8n-04.md.
- docs/review-n8n-04-hardening.md, docs/benchmark-n8n-04-plan.md.
- docs/checklist-dong-n8n-04.md, docs/n8n-workflows.md.
- services/automation-bridge/README.md và contracts/IAM/Bridge/Conversation/
  Catalog/Class cùng các caller, migrations, tests bị ảnh hưởng.
- workflows/n8n/iam-read-evidence.json, chat-hardening-evidence.json,
  chat-manifest.json, chat-benchmark.json.
- Generator, runner, guard, fixture, acceptance và isolation scripts hiện có.

Mốc tham khảo cuối trước prompt này:
- N8N-03 PARTIAL: authority/read đã có evidence 12/12; phần confirmation/approval
  và command còn thiếu. Kiểm source hiện tại vì một số mô tả ngày04/11 đã cũ.
- N8N-04: policy/version fix đạt61/61 offline,14/14 native,4/4 transport trên
  checksum của lượt đó; benchmark thật sau review1PASS/1FAIL/8SKIP.
- Evidence ưu tiên: policyVersionFixAuthorizedBenchmark20261111.
- Lỗi gần nhất: planner trả đồng thời read_catalog_classes và request_handoff;
  API required cho phép ít nhất một tool, workflow/guard đang yêu cầu đúng một.
- Đã ghi23 inference attempts tích lũy; đây là lịch sử, không phải quota ngày
  hiện tại. Hãy tính lại từ receipts đã kiểm hash, không hardcode23.

Đối chiếu source/manifest/receipts trước khi sửa. Giữ workspace dirty và mọi
thay đổi của người khác; không reset/checkout hoặc ghi đè công việc ngoài scope.

3. Hoàn thành đầy đủ N8N-03

Lập acceptance matrix từ phạm vi đã duyệt và source thật, rồi xử lý toàn bộ
phần thiếu. Không đóng N8N-03 chỉ bằng phần đọc hoặc enum luôn từ chối command.

Cần chứng minh bằng API/DB và n8n thật:
- Machine identity, audience/scope/workflow, credential rotate/revoke/expiry,
  live permission checks và context từ backend đã xác minh.
- Actor/session/branch/ownership/resource/operation lấy từ nguồn có thẩm quyền;
  n8n/LLM không tự khai role, approval hoặc confirmation để nâng quyền.
- Confirmation/approval có record thực tại service có thẩm quyền, gắn đúng
  actor/resource/operation/payload hoặc version, expiry và quy tắc tiêu thụ.
  Có cả ca được phép thực thi thành công và các ca bị từ chối.
- API đích kiểm business invariants, quyền hiện hành, version và idempotency
  ở transaction/commit boundary phù hợp. Kiểm replay, stale approval, khác
  payload/resource/branch, hết hạn, revoke, race và lỗi dependency.
- Lease/attempt/workflow version/operation intent được fence; job DONE hoặc
  worker cũ không tạo tác dụng mới. Operation lookup dùng để đối soát sau
  kết quả không chắc chắn, không retry mù lệnh có tác dụng nghiệp vụ.
- Audit/outbox và số lần tác dụng đúng với record DB. Không dùng mock nghiệp
  vụ làm bằng chứng command thật hoặc tuyên bố atomic xuyên DB khi chưa có.

Nếu dependency cần thiết chưa có, triển khai phần thực cần cho acceptance này
và kiểm bằng dữ liệu test. Không tự triển khai toàn bộ ticket ngoài scope;
không giả dependency đã đạt hoặc giảm acceptance để ghi100%.

4. Hoàn thành đầy đủ N8N-04

- Sửa lệch contract tool calling từ request đến parser/guard/workflow và tools.
  Chỉ dựa vào khả năng endpoint được kiểm chứng; thiếu tham số trong metadata
  không tự động chứng minh hỗ trợ hoặc không hỗ trợ.
- Không âm thầm chọn call đầu tiên, thực thi action set mơ hồ hoặc nới quyền
  để vượt benchmark. Giữ allowlist và semantics handoff/source/authority.
- Kiểm policy/version fix với câu trả lời model thật; nội dung giá/chính sách/
  lịch/chỗ phải đúng nguồn và thời điểm. Tách phần model sinh với template hoặc
  phần renderer lấy từ nguồn; vẫn review sự thật trong toàn bộ câu trả lời.
- Kiểm web chat gửi/nhận/lưu lịch sử/reconnect, đúng hội thoại, chống gửi trùng,
  source reads, human takeover/release, late draft và quyền bị thu hồi.
- Provider/tool/JSON/quota/timeout lỗi phải đi đúng nhánh HUMAN; không tự quay
  về AI, không lẫn khách, không hứa giữ chỗ/đăng ký/thanh toán ngoài phạm vi.
- Nếu đổi WF-02, sửa generator và sinh lại canonical/manifest. Kiểm acceptance
  trên checksum cuối và các ca bị ảnh hưởng, gồm body/headers chậm, n8n kết
  thúc trước guard, budget, lease và handoff.
- Chạy đủ corpus VI-01–VI-10 trên bản cuối, không bỏ ca khó hoặc sửa expected
  cho khớp actual. Từng ca có actual/expected, model/template provenance,
  nguồn, usage/cost, job/execution/trace hash và DB/replay/dedup outcomes.
- Không dùng fixture, HTTP200, DONE, handoff an toàn hoặc kết quả checksum cũ
  thay cho một câu trả lời chức năng chưa đạt. Những phần deterministic phải
  được ghi đúng bản chất, không tính thành model inference.

5. Quyền OpenRouter và ngân sách mới

Credential được phép dùng:
D:\Imanu\Study\space-agent-hub\.local\credentials\openrouter.key

Được đọc quota hiện tại và generation metadata, đối chiếu latency/request ID/
provider/token/cost qua API chính thức. Không in key, ghi key vào artifact hoặc
đọc credential cá nhân khác; GET metadata ghi riêng với inference attempts.

Prompt này thay thế các cap request21/23/40 và giới hạn lượt18 trước đây bằng:
- Chi phí inference tối đa0USD; không mua credit, bật billing/auto-top-up,
  paid model, paid fallback hoặc dùng plugin có phí.
- Mỗi ngày UTC, tối đa50 inference attempts do agent thực hiện, đồng thời
  không vượt quota miễn phí còn lại thực tế của tài khoản. Đọc quota mới lúc
  bắt đầu và trước mỗi batch; không dùng snapshot quota ngày cũ.
- Mỗi batch tối đa20 attempts và không vượt phần ngân sách ngày/quota còn lại.
  Tính cả request thất bại, bị hủy hoặc kết quả không chắc chắn; không chỉ PASS.
- Tất cả inference để chọn/kiểm model đều phải thuộc kịch bản kiểm có nhãn,
  có ngân sách và ledger; không có probe ẩn hoặc inference không ghi nhận.
- Giữ bộ đếm lịch sử tích lũy xuyên phiên/ngày. Quota reset không xóa attempts
  đã ghi. Không tạo key/tài khoản khác để né giới hạn.
- Kiểm giá công khai hiện hành và routing giới hạn giá0, fallback trả phí=false.
  Không suy ra miễn phí chỉ từ tên model. Response thiếu usage/cost hợp lệ
  giữ UNKNOWN và dừng batch; không tự biến unknown thành0.

Tôi ủy quyền tự tạo grant/preflight mới trong ngân sách trên, bao gồm sau khi
một lượt trước thất bại và bạn đã phân tích, sửa, review và kiểm lại phần ảnh
hưởng. Không cần xin lại từng lượt hoặc từng model miễn phí trong phạm vi này.

Mỗi batch vẫn phải dừng tại lỗi guard/provider/authority/cost/cap nghiêm trọng,
giữ FAIL/UNKNOWN/SKIP và cleanup. Không resume marker cũ hoặc retry mù. Sau khi
xử lý nguyên nhân, được mở batch mới với marker mới và prior thực tế, trong
ngân sách còn lại. Quy tắc này thay thế yêu cầu cũ phải kết thúc toàn nhiệm vụ
và hỏi người dùng sau mọi guard stop.

Hết quota thì không gọi tiếp để thăm dò. Lưu checkpoint/nextEligibleAt và tiếp
tục khi quota reset nếu phiên thực thi cho phép. Nếu không thể tự chờ/tiếp tục,
bàn giao đúng blocker và lệnh tiếp tục; không hứa lịch tự chạy khi môi trường
không hỗ trợ. Tiếp tục các việc offline không phụ thuộc quota.

6. Bảo toàn và giới hạn không được vượt

- Dùng dữ liệu tổng hợp có nhãn. Không xuất dữ liệu khách/nhân viên thật lên
  provider hoặc tự mở rollout khách thật.
- Không đọc env cá nhân, xóa lịch sử evidence/grants/markers hoặc thao tác
  phá hủy DB/volume/runtime cũ. Migration test chạy trên bản sao hoặc DB mới.
- Cleanup chỉ process/project test do nhiệm vụ này tạo; giữ volumes/artifacts,
  không down-v hoặc prune. Khi cần dọn dữ liệu, chỉ dọn dữ liệu test có danh
  tính rõ và snapshot phù hợp, không xóa evidence cần đối chiếu.
- Không gửi email/ticket/tin nhắn cho bên ngoài. Được chuẩn bị gói chẩn đoán
  để tôi gửi khi cần hỗ trợ; quyền đọc metadata không là quyền liên hệ người khác.
- Không tự phát sinh giao dịch tiền/chỗ thật, triển khai production hoặc mở
  toàn bộ WF-04–12. Production và auto-send final vẫn giữ gate dữ liệu/consent,
  người trực HUMAN,50hội thoại gán nhãn và load/restore/SLA theo plan.

7. Cách làm và điều kiện kết thúc

Bắt đầu bằng baseline và acceptance matrix N8N-03/N8N-04: mỗi yêu cầu liên kết
source, test, evidence, trạng thái và phần còn thiếu. Thực hiện theo dependency,
ưu tiên tái sử dụng code và pattern đã có; không thêm abstraction/dependency
hoặc chạy lại toàn regression nếu không có thay đổi/rủi ro liên quan.

Tự xử lý lỗi kỹ thuật có thể sửa. Không dừng chỉ vì phải đổi vài file, thiếu
một script, Docker tắt, cần chọn model miễn phí hoặc một batch vừa thất bại.
Chỉ yêu cầu tôi tham gia khi thiếu thông tin nghiệp vụ thực sự không suy ra
được hoặc cần quyền/chi phí/hành động ngoài các giới hạn đã cấp.

Khi gặp blocker thật, nêu chính xác bằng chứng, ảnh hưởng, việc đã thử và điều
kiện gỡ; tiếp tục phần độc lập. Không xóa dependency, đổi phạm vi, hạ acceptance
hoặc dùng nhãn100% để thay cho phần chưa làm.

Trước nghiệm thu, review diff/callers/contracts bằng ponytail-review. Chỉ đóng
từng ticket khi mọi acceptance bắt buộc của nó đạt với bằng chứng phù hợp;
N8N-03/04 có thể hoàn tất vào hai thời điểm khác nhau. Không cần chứng minh
nội bộ máy chủ provider ngoài quyền quan sát để thay cho kiểm hành vi thực tế;
giữ các nguyên nhân lịch sử chưa biết ở trạng thái UNKNOWN, không suy diễn.

Đầu ra cuối:
- Acceptance matrix đầy đủ của từng ticket và quyết định agent ACCEPT hoặc
  NOT_ACCEPTED, ngày/phạm vi/lý do. Chỉ ghi100% khi đủ tiêu chí bắt buộc.
- Tóm tắt thay đổi, source/canonical/manifest/corpus hashes và tests thực chạy.
- Bảng đủ10ca N8N-04; nguồn, traces, DB outcomes và kết quả review nội dung.
- Request mới/tích lũy/ngân sách ngày/quota; tách metadata, loopback và inference;
  usage/cost biết được và phần còn UNKNOWN.
- Runtime/isolation/cleanup, ACL/retention và runbook demo/recovery liên quan.
- Cập nhật bàn giao, checklist, evidence index và bảng trạng thái hiện hành;
  bảo toàn receipts và lịch sử. Giữ một phần tóm tắt hiện hành dễ tìm, tránh
  chồng thêm nhiều bản tóm tắt trùng lặp.

Hãy bắt đầu kiểm hiện trạng rồi triển khai đến khi cả hai ticket đạt hoặc còn
blocker bên ngoài thực sự không thể xử lý trong quyền đã cấp. Trong khi làm,
cập nhật tiến độ ngắn gọn, không hỏi lại những quyền prompt này đã cấp.
```
