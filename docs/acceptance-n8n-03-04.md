# N8N-03 / N8N-04 — nghiệm thu local được ủy quyền

Ngày bắt đầu: 12/11/2026 (+07:00). Reviewer: Codex agent.
Phạm vi: dữ liệu tổng hợp, runtime/DB mới; production và khách thật vẫn đóng.
Yêu cầu gốc: [prompt ủy quyền](prompt-hoan-thanh-n8n-03-04.md).

## Baseline và acceptance matrix

| Ticket / yêu cầu bắt buộc | Source / kiểm chứng | Baseline | Việc cần hoàn tất |
| --- | --- | --- | --- |
| 03: machine identity, audience/scope/workflow, rotate/revoke/expiry | `packages/contracts/src/machine.ts`, `services/identity/src/machine.ts`, `scripts/test-automation.mjs` | PASS: regression mới 12/12 IAM + 11/11 Bridge | [Receipt mới](../workflows/n8n/iam-command-evidence.json) |
| 03: actor/session/branch/ownership từ backend, quyền hiện hành | IAM delegation, `packages/auth/src/index.ts`, Class | PASS: actor/session từ IAM, branch/resource từ Class | Record/payload không nhận actor/role tự khai |
| 03: confirmation/approval record, payload/version/expiry/consume | `class_cancellation_requests`, API Class, migration 0005 | PASS: 5 phút, hai actor, consume một lần | Không mở Enrollment/Payment |
| 03: invariant/version/idempotency, replay/stale/mismatch/race/dependency | `scripts/test-n8n03-command.mjs`, Class transaction/audit/outbox | PASS: 19/19 API/DB/n8n, 0 SKIP | Có lớp COMMITTED bị chặn, revoke lúc chờ khóa rollback |
| 03: lease/attempt/workflow/intent fencing và operation lookup | BridgeStore, IAM introspection, source lookup | PASS: DONE/attempt cũ/expiry/mismatch denied; concurrent execute chỉ một effect | Scope local, không tuyên bố atomic xuyên DB |
| 04: tool contract request/parser/guard/tools thống nhất | `build-chat-workflows.mjs`, guard, canonical/manifest | FAIL: API ≥1 tool, parser đúng 1 | Serial-control được kiểm; tiếp tục từ chối action set mơ hồ |
| 04: giá/policy/lịch/chỗ đúng nguồn và provenance | WF-02 Sources/Draft, Catalog/Class, corpus VI-01–10 | Policy fix synthetic 61/14/4; live 1 PASS / 1 FAIL / 8 SKIP | Chạy đủ corpus checksum cuối và review nội dung |
| 04: web send/receive/history/reconnect/dedup/isolation | Conversation/Channel, browser harness | Có evidence lịch sử | Đối chiếu source; browser regression phù hợp |
| 04: takeover/release/late draft/revocation, lỗi sang HUMAN | Conversation CAS, WF-03, native/transport acceptance | Có evidence synthetic | Kiểm checksum cuối, slow headers/body/early exit/budget/lease |
| 04: quota/cost/trace/DB và cleanup | guard/runner/isolation, receipts kiểm hash | Lịch sử attempts phải tính lại; cap cũ bị thay thế | Metadata mới; ≤20/batch, ≤50/ngày UTC, 0 USD; giữ UNKNOWN |

## Kế hoạch và điều kiện chốt

1. Kiểm baseline/source/receipts và quota hiện tại; lưu snapshot trước sửa.
2. Hoàn thiện contract và dependency command tối thiểu; kiểm unit/API/DB/n8n.
3. Sinh canonical/manifest, chạy affected native/transport/browser checks; benchmark mới.
4. Review callers/contracts theo Ponytail Review; ghi quyết định riêng từng ticket.

Trạng thái hiện tại: **N8N-03 ACCEPT local; N8N-04 NOT_ACCEPTED**.
Chưa sử dụng baseline hoặc an toàn handoff làm bằng chứng hoàn thành chức năng.

<!-- CURRENT_N8N04_BEGIN -->
## N8N-04 hiện hành — 12/11/2026

**NOT_ACCEPTED trong khi kiểm bản cuối.** Lượt 1: 8 PASS/2 FAIL/0 SKIP; lượt 2:
6 PASS/4 FAIL/0 SKIP. Lượt Gemma dừng vì upstream Google AI Studio 429:
1 PASS template/1 FAIL/8 SKIP, không có câu trả lời model. Các raw receipts giữ nguyên.

Đã sửa lọc offer/lớp theo trần VND strict `<`, renderer policy version từ metadata
nguồn riêng, và bộ che PII không làm hỏng ngày ISO/UUID/giá VND có đơn vị.
Parser chỉ xử lý trần VND rõ ràng ở lượt GUEST mới nhất. Regex minimization không
bảo đảm mọi văn bản tự do không có PII; production/export dữ liệu thật vẫn đóng.

Profile cuối: `nvidia/nemotron-3-ultra-550b-a55b:free`, chỉ Nvidia, temperature 0, max price 0, không
fallback. Client 10s, model node 12s, Draft 30s, workflow 55s, lease 60s: hai provider
calls có tổng deadline 20s và 10s headroom trong Draft. Đây không là SLA toàn lượt.
Model answer tối đa 400 tokens. Các nhánh slow headers/body/partial/early n8n,
budget và HUMAN được kiểm lại; không tắt guard để lấy PASS.

68 kiểm offline và 9 Conversation unit PASS; prompt/schema đang được chốt UTF-8
trước benchmark. Binding test dùng IP private đã phân giải từ Docker host; khi mất
response Result chỉ lookup đúng job/event/context, không gọi lại model hay operation.
Giữ các lỗi networking lịch sử ở UNKNOWN, không tuyên bố đã chứng minh nguyên nhân.

Ngày UTC: 33 agent attempts / 56 tích lũy. Account còn 18 request nhưng agent chỉ còn
17 attempts. Call 429 thiếu usage/cost vẫn UNKNOWN; 32 generation metadata trước đó
xác nhận 0 USD. Chưa chạy model mới sau lần dừng này.

WF-02 hiện hành: `2242ad5ada86d1bf12cbc5a836a373f6e359f5b8e293959d9fb720e4277f3aed`.
Corpus/expected không đổi. Hai browser runs đã render model/source và kiểm reconnect/
takeover/release; không dùng chúng thay cho corpus của profile cuối.
<!-- CURRENT_N8N04_END -->

## Review N8N-03 — Codex agent, 12/11/2026

What this change does: Class owns a short-lived confirmation and a separate
director approval. A scoped n8n job can cancel only that class/version/payload;
Class commits consumption, business changes, audit, outbox and result together.

Looks good. Ship for the tested synthetic local scope. Reviewed the IAM issuer,
contracts/auth callers, Bridge lease proof, source routes, existing cancellation
rules, migration and command harness. Evidence: 19 command cases, 12 IAM/read
cases, 11 Bridge cases and real n8n execution. Two concurrent executions caused
one state change/audit/outbox. No business endpoint was stubbed.

Not checked: production load/restore or global atomicity across IAM/Bridge/Class;
already admitted work is not cancelled by a later cross-service revocation.
