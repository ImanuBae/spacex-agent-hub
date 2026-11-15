# N8N-05 — ACCEPT_LOCAL

Quyết định 2026-11-15T17:13:06.257Z (16/11/26, Asia/Saigon). Reviewer: **Codex agent**, theo [ủy quyền hiện hành](prompt-chot-nghiem-thu-n8n-05.md); [prompt nghiệp vụ gốc](prompt-hoan-thanh-n8n-05.md). **ACCEPT_LOCAL** cho WF04–07 tổng hợp local. Provider/live/production BLOCKED riêng.

[Evidence index](../workflows/n8n/registration-evidence.json) · [Bàn giao](ban-giao-n8n-05.md) · [Checkpoint mới](../.local/automation/n8n05-closeout-audit/checkpoint.json) · [Expected/actual và DB effects](../.local/automation/space-agent-n8n05-acceptance-2b18def65d0e/evidence.json) · [Review](../.local/automation/n8n05-closeout-audit/final-review.json) · [Isolation/ACL](../.local/automation/n8n05-closeout-audit/final-isolation.json).

Lượt cuối **49/49 nhóm PASS, 0 FAIL/0 SKIP**, gồm API/PostgreSQL/RabbitMQ/n8n thật, bốn workflow manual, poll/event tự động, timeout sau QR commit, kill sau Class commit và Portal tại 1440/768/390px. Build Portal sạch với env allowlist/preload đã PASS. Mỗi ca có expected/actual; index trỏ đúng JSON pointer, trace IDs/hash và DB outcomes, không công khai raw secret/PII.

| WF/gate | Acceptance bắt buộc | Source/dependency | Ca kiểm / evidence | Kết quả |
| --- | --- | --- | --- | --- |
| WF04 | Identity nguồn Portal/Conversation/Channel; actor/session/branch hiện hành | Conversation crm-context; CRM requests; IAM | N8N-WF04-VERIFIED-CRM; CRM22 assertions/DB | PASS |
| WF04 | Contact/learner/payer và consent/đại diện xác minh; cùng số không auto-merge | CRM relationships/consents/enrollment-authority | N8N-WF04-VERIFIED-CRM; CRM22 assertions/DB | PASS |
| WF04 | Claim race/version/idempotency; partial result giữ mapping | CRM operations/result/audit/outbox | N8N-WF04-VERIFIED-CRM; CRM22 assertions/DB | PASS |
| WF04 | Merge conflict/plan/hash/version/branch/approval độc lập; erasure giữ lineage | CRM migrations 0002/0003; IAM approval-session | N8N-WF04-VERIFIED-CRM; CRM22 assertions/DB | PASS |
| WF05 | Confirmation backend explicit, payload/session/expiry/revoke/consume | Enrollment confirmations; Portal | WF05-STRICT-CONFIRMATION-AND-OWNERSHIP, WF05-PREVIEW-IDEMPOTENCY, WF05-CONFIRMATION-EXPIRY-AND-REVOKE, WF05-CONFIRMATION-REPLAY, N8N-BROWSER-CONFIRMATION | PASS |
| WF05 | Snapshot bất biến và quote/terms/class version | Enrollment migration; Catalog quote | WF05-QUOTE-CHANGED-BEFORE-CONFIRM, WF05-QUOTE-CHANGED-OR-CLOSED-AFTER-CONFIRM | PASS |
| WF05 | Hold thật; OPEN/lịch/quyền/last-seat/server deadline | Enrollment/Class scoped API | API-WF05-HELD, WF05-CLASS-NOT-OPEN, WF05-LAST-SEAT-RACE, WF07-CLASS-DEADLINE-WITHOUT-N8N | PASS |
| WF05 | QR sau hold; giá/ref/hạn backend; dedup/lookup | Payment/Class/Enrollment readback | WF05-NO-HOLD-NO-QR, WF05-DUPLICATE-AND-LOOKUP-AFTER-COMMIT, REVIEW-QR-CANCEL-RACE-CLOSE, REVIEW-QR-CANCEL-RACE-CREATE | PASS |
| WF05 | Kết thúc bền; lookup trước retry/bù trừ; timeout không nhả hold | n8n WF05; domain operation keys | RECOVERY-PAYMENT-SERVICE-OUTAGE-AFTER-QR-COMMIT, N8N-WF05-HOLD-QR, N8N-TIMEOUT-AFTER-QR-COMMIT | PASS |
| WF06 | Webhook auth/replay/conflict; append-only ledger/dedup/allocation | Payment synthetic HMAC + transaction | WF06-WEBHOOK-AUTH-DEDUP-CONFLICT, WF06-TWO-ACTUAL-SYNTHETIC-TRANSFERS | PASS |
| WF06 | Backend-only matched; đúng matchRef/scope; một entitlement | Payment authority; IAM live contexts | API-WF06-CONFIRMED, AUTH-RESOURCE-AUDIENCE-AND-STRICT-MUTATIONS, REVIEW-LEGACY-SEAT-ENDPOINTS-CANNOT-BYPASS-PAYMENT | PASS |
| WF06 | CONFIRMING → Class COMMITTED → CONFIRMED/outbox; crash hội tụ cùng key | Enrollment/Class commit/lookup | WF06-COMMIT-CRASH-RECOVERY, REVIEW-LATE-CONFIRM-CLEARS-RELEASE, N8N-WF06-MATCH-COMMIT-CONFIRM, N8N-KILL-AFTER-CLASS-COMMIT | PASS |
| WF07 | Class tự chặn hết hạn dù n8n tắt; deadline/version dedup | Class expiry; Enrollment Class deadline readback | WF07-CLASS-DEADLINE-WITHOUT-N8N, REVIEW-ORPHAN-HOLD-USES-CLASS-DEADLINE | PASS |
| WF07 | Tiền đủ muộn lấy chỗ nguyên tử hoặc NO_SEAT review có owner | Class late commit; Payment review | WF07-LATE-FULL-AVAILABLE, WF07-LATE-FULL-NO-SEAT | PASS |
| WF07 | Thiếu/thừa/sai mã/hai giao dịch/hủy race; ledger không mất | Payment ledger/reviews; Enrollment reconcile | WF06-TWO-ACTUAL-SYNTHETIC-TRANSFERS, WF07-UNDERPAYMENT, WF07-OVERPAYMENT, WF07-WRONG-REFERENCE, WF07-CANCEL-IDEMPOTENCY, WF07-MONEY-AFTER-CANCEL, WF07-CANCEL-VS-MATCHED-MONEY, REVIEW-EXCESS-REFUND-BEFORE_CONFIRM, REVIEW-EXCESS-REFUND-AFTER_CONFIRM, N8N-WF07-CANCEL | PASS |
| WF07 | Review timeout, một extension; duyệt độc lập/current; refund pending | Payment proposals/decisions; IAM | WF07-REVIEW-TIMEOUT, WF07-REVIEW-EXTEND-ONCE, WF07-REFUND-PENDING-APPROVAL, REVIEW-SERVICE-CANNOT-INVENT-CUSTOMER-CANCEL | PASS |
| Authority | Không tin actor/branch/customer; revoke/rotate/expiry/dependency | IAM/auth/domain final checks | WF06-WEBHOOK-AUTH-DEDUP-CONFLICT, AUTH-RESOURCE-AUDIENCE-AND-STRICT-MUTATIONS, AUTH-STALE-LEASE-DONE-OLD-VERSION-REDELIVERY, AUTH-CONTEXT-REVOKED-AFTER-TOKEN, AUTH-MACHINE-EXPIRY-ROTATE-REVOKE, RECOVERY-PAYMENT-SERVICE-OUTAGE-AFTER-QR-COMMIT | PASS |
| Fencing | Lease/attempt/DONE/workflowVersion/intent/event dedup | Bridge + source context | AUTH-STALE-LEASE-DONE-OLD-VERSION-REDELIVERY | PASS |
| Consistency | Own-DB state/result/audit/outbox transaction; causation/correlation | Domain migrations/APIs/contracts | API-WF06-CONFIRMED, N8N-TIMEOUT-AFTER-QR-COMMIT, N8N-KILL-AFTER-CLASS-COMMIT | PASS |
| n8n | Import thật; manual + automatic poll/event/recovery; canonical inactive | WF04–07 canonical/manifest; 7 bindings | N8N-WF04-VERIFIED-CRM, N8N-WF05-HOLD-QR, N8N-WF06-MATCH-COMMIT-CONFIRM, N8N-WF07-CANCEL, N8N-AUTOMATIC-TRIGGERS, N8N-TIMEOUT-AFTER-QR-COMMIT, N8N-KILL-AFTER-CLASS-COMMIT | PASS |
| Portal | Checkbox explicit; QR/trạng thái bền/reload; không xác nhận tiền/chỗ sớm | Gateway/BFF; enrollments screen; clean safe build | N8N-BROWSER-CONFIRMATION | PASS |
| Preservation | Affected regressions, source/review, isolation/ACL/retention | Baseline + audit + fresh runtime | SETUP | PASS |

## Kế thừa và đối chiếu

CRM 22, Class 19, Bridge11/IAM13, command N8N03 19, native N8N04 16 được kế thừa sau kiểm source/config/schema/shared hashes và receipt refs. Conversation gồm 17 nhóm backend, browser/fault tổng hợp PASS; chat receipt vẫn PARTIAL vì model benchmark BLOCKED/không chạy. Không gọi đó là model PASS mới.

312 source/config hashes cuối khớp; runtime preflight có 298. Chênh duy nhất so regression cũ là đường dẫn prompt và metadata promptFile của runner, đã kiểm diff chính xác, smoke trên runtime mới và lượt tích hợp mới. Bản prompt gốc từng vắng ở đầu lượt rà soát, nay có lại và khớp byte baseline; không coi đó là thay đổi nghiệp vụ.

Quality cũ 65/65 task thành công hoàn toàn từ cache, **0 task vừa thực thi** trong lượt đó. Đã kiểm 245 input ngoài env và cache metadata/archive; không đọc lại env cá nhân để kiểm hash. Thiếu provenance an toàn của Portal cache được thay bằng build sạch mới và browser mới, không tuyên bố mọi env input cũ đã xác minh.

Lượt tích hợp cũ22d58ae29067 vẫn PASS/NOT_ACCEPTED nguyên bản. Parent regression8b4b0d8b5b1e vẫn FAIL; lượt focused dbfad1371763 giữ9PASS/1FAIL/6SKIP; lượt thay thế e7c23a808725 PASS16/0FAIL/0SKIP. Mọi FAIL/UNKNOWN/SKIP và checkpoint cũ được giữ. N8N03/04 checkpoint, model/corpus/prompt/WF01–03 đã kiểm hash, không sửa quyết định lịch sử hoặc chạy lại model.

Nhãn `IMPLEMENTED_NOT_ACCEPTED` của manifest/generator được giữ như metadata
trước quyết định để bảo toàn hash canonical. Quyết định nghiệm thu hiện hành
thuộc evidence index và checkpoint mới, không thuộc nhãn export này.

## Giới hạn

Policy DEMO-N8N05-2026-11-14-v1 và runbook ở bàn giao. QR DEMO không phải QR ngân hàng; REFUND_PENDING chưa hoàn tiền. Deadline được rút ngắn có chủ đích trong DB test, không tuyên bố chờ đủ20phút thực. Không nghiệm thu live, production, thu/hoàn tiền thật, WF08–12 hoặc downstream Notification/Reporting. Gate thiếu account/credential/provider approval/quyền rollout, owner người dùng; không chặn local. Không có scheduler tự tiếp tục.

Giữ sự cố Next từng tự load personal .env.local trong [incident](../.local/automation/space-agent-n8n05-acceptance-594ee3149d07/batch-interruption.json); chưa biết biến nào được nạp, không in/kiểm nội dung. Đã dùng preload, env allowlist, fixture tự kiểm và build/runtime mới. Bản build trước được giữ nguyên ở app/out với ACL cũ; snapshot byte-identical có ACL private nằm trong hồ sơ local.
