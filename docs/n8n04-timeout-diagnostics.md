# N8N-04 — chẩn đoán timeout, Giai đoạn A/B

## Giai đoạn B đã hoàn tất —14/11/2026 (+07:00)

**N8N-04 ACCEPT local;N8N-03 ACCEPT không đổi.** Full corpus cuối10/10PASS,16generation chính thức0USD;48attempts mới trong ngàyUTC13/11,trong đó chẩn đoán6/6. Giữ nguyên mọi FAIL/UNKNOWN cũ. [Acceptance matrix và đầy đủ10ca](acceptance-n8n-03-04.md);[review cuối](../.local/automation/n8n04-phase-b-a59ef73f47bd/full-review.json);[ledger/cleanup/ACL](../.local/automation/n8n04-phase-b-a59ef73f47bd/closeout.json).

Telemetry mới quan sát được POST planner/answer thật và header generation ID khớp body/metadata. Request/socket binding và reuse đúng;không có timeout mới trong Giai đoạn B. Điều này không giải thích được timeout/401 lịch sử. Không đổi model/provider/deadlines,routing0USD/paid fallback=false.

Đã sửa các chỉ dẫn prompt theo lỗi nội dung quan sát: hạn đăng ký không là ngày kết thúc lớp;số chỗ còn không là tổng sức chứa;không tự thêm thứ trong tuần;từ chối yêu cầu URL/token đúng trọng tâm. Không còn việc inference bắt buộc;không dùng lại marker cũ và không cài scheduler.

<details>
<summary>Giai đoạn A và runbook tiếp tục tại thời điểm12/11/2026 — lịch sử</summary>


**Đã hoàn tất instrumentation và kiểm local; chưa có POST inference dùng telemetry
mới.** N8N-03 giữ ACCEPT local, N8N-04 giữ NOT_ACCEPTED. Quyết định và đủ 10 ca
ở [báo cáo hiện hành](acceptance-n8n-03-04.md); tài liệu này giữ phân tích timeout,
không thay acceptance hoặc lịch sử receipts.

## Đã đo được gì

[Collector](../scripts/n8n04-wire-trace.mjs) dùng Node built-ins và Undici
diagnostics trên chính `fetch` đang có; không đổi endpoint, routing, request,
TLS hoặc deadline. Request clock là `performance.now()`:

- Tạo request, chờ connection, DNS start/end nếu runtime quan sát được, TCP,
  TLS, ghi headers/body vào socket, nhận headers, first/last body byte và abort/
  body complete. Clock connection tách riêng với clock request.
- Chỉ gắn connection vào request khi `undici:client:sendHeaders` cung cấp đúng
  cả object request và socket. Pool connect/error trước đó là **candidate chưa
  xác nhận**, không được coi là socket đã phục vụ request. Request chưa bind,
  event bị thiếu hoặc nhiều request trong một scope được ghi rõ.
- Socket reuse có cùng connection ID và lịch sử handshake cũ; không ghi DNS/
  TCP/TLS cũ thành latency mới. Socket có trước collector có reuse UNKNOWN.
  DNS offsets mang traceId gốc, không ghép lookup khác request.
- `requestBodyWritten` chỉ chứng minh ghi vào socket local. Nó **không chứng
  minh upstream/model server đã nhận hoặc bắt đầu inference**.
- Ngay sau headers, guard persist allowlist `x-generation-id`, `x-request-id`,
  `cf-ray` và content-type đã lọc, trước khi đọc body. ID sai format, quá dài
  hoặc chứa secret bị bỏ; chỉ ghi tên header bị loại.
- Body chỉ thêm số bytes/chunks/whitespace và loại ký tự đầu có nghĩa:
  JSON_OPEN/COMMENT_PREFIX/OTHER. Không ghi chunk, body prefix, Authorization,
  capability, IP/hostname, key hoặc TLS secrets. Response hoàn chỉnh vẫn qua
  kiểm secret trước khi lưu model content vào artifact private như trước.

[Undici diagnostics](https://undici.nodejs.org/api/DiagnosticsChannel) phân biệt
event request và connection pool. [OpenRouter streaming docs](https://openrouter.ai/docs/api_reference/streaming)
mô tả `X-Generation-Id` và comment/heartbeat. Không suy bytes của các lượt cũ là
heartbeat khi thiếu content-type/prefix/ID tương ứng; chưa đổi JSON parser vì giả thuyết đó.

## Kiểm đã chạy và evidence

| Kiểm | Kết quả / giới hạn |
| --- | --- |
| Guard/parser/workflow/runtime/handoff/collector | [83/83 offline](../.local/automation/n8n04-diagnostics-0bdfca3af822/all-unit-reviewed.log), 0 SKIP; 0 inference |
| Slow headers, body stall/disconnect, refused connection, reuse, concurrent requests, header secret filtering, trusted/untrusted TLS | [Wire observations](../.local/automation/n8n04-diagnostics-0bdfca3af822/wire-unit-observations.json). CA tổng hợp chỉ được trust trong child test, không sửa OS trust hoặc tắt TLS verification |
| n8n thật + DB + guard, 4 transport modes | [4/4 PASS](../.local/automation/n8n04-transport-09e233f7e96d/receipt.json); headers/body/partial/n8n-first. Socket bind đúng, clientAbort được giữ; HUMAN/TIMEOUT một lần, replay409/dedup; 0 external requests/0 provider credential reads/0 inference |
| Hai GET metadata thật qua collector | [Receipt](../.local/automation/n8n04-diagnostics-0bdfca3af822/metadata-wire.json), [đúng source lúc smoke](../.local/automation/n8n04-diagnostics-0bdfca3af822/metadata-wire-provenance.json). GET key và pinned endpoints; **không chứng minh POST inference khỏe** |
| Hai GET preflight | [Grant](../.local/automation/n8n04-authorized-d5837157ddcb/preflight.json); official pricing 0 và quota mới; 0 inference |

GET thứ nhất quan sát DNS hoàn tất khoảng 19ms, TCP 88ms, TLS 133ms (authorized,
TLS1.3), headers 468ms và body hoàn tất 472ms. GET thứ hai reuse cùng socket,
headers khoảng 186ms. Các mốc request và connection có origin khác nhau, không
trừ chéo để tính phase. Sau smoke, collector được review thêm DNS deduplication,
clientAbort và lọc ID; source cuối được kiểm trong 83 checks và 4 transport modes.

Hai lần test đầu thất bại do OpenSSL trên máy trỏ config cài đặt không tồn tại.
Test hiện dùng config TLS tổng hợp riêng; không sửa cấu hình máy. Lỗi setup test
này không chứng minh nguyên nhân của các POST provider lịch sử.

Runner đã thêm admission: một ca chức năng phải có đủ ngân sách planner + answer
trước khi đọc credential hoặc khởi động runtime. Full corpus hiện cần **16**
attempts; VI-01 và VI-10 là deterministic. Kiểm offline chứng minh budget 1 bị
từ chối cho ca 2 calls, không tiêu một attempt rồi mới phát hiện thiếu.

## Giả thuyết và tín hiệu phân biệt

| Giả thuyết | Tín hiệu cần đối chiếu trên **cùng request** | Kết luận hiện tại |
| --- | --- | --- |
| DNS lỗi/chậm | DNS start/end, ENOTFOUND/EAI_AGAIN, chưa TCP; lookup chưa bind chỉ là candidate | Loopback/TLS collector đã kiểm; các POST cũ thiếu signal nên UNKNOWN |
| TCP/TLS lỗi hoặc chậm | TCP/TLS event và safe error code; authorized/protocol, connection bind hoặc candidate rõ ràng | Refused/untrusted TLS phân biệt được trong test; không suy nguyên nhân lịch sử |
| Chờ response sau local write | Đã bind, requestBodyWritten, không responseHeadersReceived trước abort | Chứng minh client đã ghi và chưa nhận headers; network edge/upstream queue/model vẫn UNKNOWN nếu không có metadata |
| Headers đã tới, body không hoàn tất | HTTP status/content-type, ID lưu ngay, bytes/chunks, first/last/idle, thiếu bodyCompleted | Đã tái hiện độc lập với pre-headers timeout; phải dùng header generation ID nếu có để tra metadata |
| Body bị đứt | Headers/partial bytes rồi UND_ERR_SOCKET/ECONNRESET, không complete | Loopback phân biệt được disconnect với abort; chưa có bằng chứng áp cho các lượt cũ |
| Heartbeat/SSE hoặc JSON dở | content-type, COMMENT_PREFIX/JSON_OPEN, whitespace/bytes và ID; body cuối nếu hoàn tất | Byte counts lịch sử chưa đủ. Parser giữ nguyên, không tự coi response dở là JSON thành công |
| Quota/provider từ chối | HTTP429/error envelope hoàn chỉnh hoặc metadata chính thức | Có một 429 riêng; không đồng nhất các timeout khác với quota |
| n8n/node kết thúc trước guard | Node execution time đối chiếu guard abort/response và lease/DB/outbox | Test n8n-first PASS, giữ HUMAN và không draft trễ; không là bằng chứng model đã hoàn tất |
| Usage/cost chưa biết | Body usage hợp lệ hoặc generation metadata của đúng ID/provider | 3 attempts lịch sử còn UNKNOWN; quota không tăng không chứng minh cost 0 |

## Hai dạng timeout lịch sử không được gộp nguyên nhân

| UTC / ca | Headers | Body trước timeout | Giới hạn kết luận |
| --- | --- | --- | --- |
| 09/11 19:58, VI-01 answer | HTTP200 ~831ms | Timeout ~5916ms; bản cũ chưa có byte count | Body chưa xong; không có DNS/TCP/TLS hoặc header ID |
| 10/11 06:43, VI-05 planner | HTTP200 ~722ms | Timeout ~5917ms | Như trên |
| 10/11 07:52, VI-03 answer | HTTP200 ~636ms | Timeout ~5905ms | Như trên |
| 10/11 20:05, VI-03 answer | HTTP200 ~581ms | 22 bytes/2 chunks; timeout ~5919ms | Chưa đủ để gọi heartbeat hoặc JSON |
| 12/11 11:58, VI-02 Ultra answer | HTTP200 ~613ms | 44 bytes/6 chunks; timeout ~10009ms | Generation/cost UNKNOWN, không suy cùng nguyên nhân với Lightning |
| 12/11 14:45, VI-06 Lightning planner | Chưa nhận headers | 0 bytes; timeout ~10017ms | Chưa biết lỗi trước/sau DNS/TCP/TLS/local write; không thể khôi phục telemetry chưa được lưu |

Raw receipts/grants/markers giữ trong evidence index cũ. 401 authority riêng cũng
giữ nguyên nhân UNKNOWN khi thiếu underlying probe; không dùng fix jitter để suy
ngược nguyên nhân. Instrumentation giải quyết thiếu quan sát cho lượt tiếp theo,
không tạo lại sự kiện đã mất của bốn ngày trước.

## Lượt live tiếp theo sau khi budget đủ

1. Kiểm UTC, tính lại ledger từ receipts hash và đọc quota/pricing/capability
   mới. Không dùng grant ngày 12/11. Giữ model/provider/config cố định trong
   từng batch, 0 USD, paid fallback=false và tối đa20/batch.
2. Dành tối đa **6 attempts tổng** cho chẩn đoán thuộc corpus, không phải 6
   batch. Bắt đầu một ca 2 calls như VI-06 với grant mới; kiểm header IDs/wire,
   model output và metadata ngay. Dự trù **16 attempts** cho full corpus cuối;
   không bắt đầu ca hai calls khi chỉ còn một.
3. Nếu có `provider[].responseIds['x-generation-id']`, dùng ID này để GET
   `https://openrouter.ai/api/v1/generation?id=<ID đã URL-encode>` bằng key đã
   cấp, kể cả khi body không hoàn tất và không có response file. Nếu body cũng
   có ID thì đối chiếu hai giá trị; lệch ID dừng đối soát. Persist metadata/
   hash riêng, không log Authorization và không cộng GET thành inference.
   HTTP404/metadata thiếu giữ UNKNOWN; không tạo POST để thăm dò hoặc retry mù.
4. Lỗi guard/provider/authority/cost/cap nghiêm trọng dừng batch, giữ FAIL/
   UNKNOWN/SKIP và cleanup. Đọc trace rồi sửa/review/kiểm phần ảnh hưởng mới
   tạo grant/marker khác. Không tăng timeout hoặc đổi model để thử may.
5. Khi đường thực đủ điều kiện, chạy nguyên VI-01–VI-10, review toàn bộ model/
   template/renderer + source/version/readAt + usage/cost + DB/replay/dedup.
   Chỉ agent ACCEPT khi đủ acceptance bắt buộc. Canonical hiện vẫn c654f079…;
   model/client10s/node12s/Draft30s/workflow55s/lease60s không đổi trong Giai đoạn A.

Lệnh tạo grant chẩn đoán (chỉ chạy khi đã kiểm ngân sách và quota ngày mới):

```powershell
$n8n04Grant = node scripts/prepare-authorized-n8n04.mjs 'VI-06' | ConvertFrom-Json
if ($n8n04Grant.maxRequests -lt $n8n04Grant.plannedModelRequests) { throw 'Thiếu budget; không inference.' }
node scripts/run-n8n04-benchmark.mjs ($n8n04Grant.directory + '/preflight.json')
```

Sau chẩn đoán đủ điều kiện, tạo **grant mới không chọn case** cho full corpus;
runner tự kiểm 16 attempts tối thiểu. Không tái dùng marker chẩn đoán. Các batch
mới phải được thêm vào evidence index/hash ledger trước batch sau để đếm đúng.
Grant có maxRequests lớn hơn nhu cầu selected case vẫn bị case/stage cap hai calls;
trần6 chẩn đoán phải được theo dõi tổng ở checkpoint, không dùng hết vì có quota.

Snapshot ngày UTC12/11:49/50 agent attempts,72 tích lũy; còn1 agent attempt nên
không chạy thêm ca2calls. Metadata4 GET và4 synthetic transport attempts trong
Giai đoạn A tách riêng, **0 inference mới**. Lần sớm nhất kiểm budget ngày mới:
13/11/2026 00:00UTC =07:00(+07). Không có scheduler được thiết lập; lưu checkpoint
và lệnh tiếp tục, không hứa tự chạy khi phiên kết thúc. Trong lúc chờ đã chuẩn bị
[readiness N8N-05–08](n8n-readiness.md), chưa mở WF-04–12.

## Review thay đổi — Codex agent, Ponytail full / ponytail-review

What this change does: observe the existing provider request without changing its
transport policy, preserve safe correlation IDs before reading the body, and reject
a functional case that cannot fit its request budget before starting inference.

Looks good for Phase A local diagnostics. Reviewed connected guard/persist/error
classification, runner/preparer/hash binding, synthetic preload, collector lifecycle,
concurrent request/socket association, header filtering and fixtures. No dependency,
application authority, command contract, canonical workflow or model/deadline changed.
83 offline checks and four actual n8n transport modes pass. Existing N8N-03 evidence
remains applicable; broad authority/browser regression was not repeated without a
related source change. Raw failures and historical receipts are retained.

Not checked: a POST inference with the new telemetry, production load/restore or
provider internals. Final functional corpus remains the blocking N8N-04 acceptance.

</details>
