# N8N readiness — hiện hành 16/11/26

**N8N-05 ACCEPT_LOCAL**: WF04–07 đã nối CRM/Enrollment/Payment/Class và kiểm tổng hợp backend thật; không còn gate thiếu backend local. [Matrix](acceptance-n8n-05.md), [index](../workflows/n8n/registration-evidence.json), [bàn giao](ban-giao-n8n-05.md). Provider/live/production BLOCKED riêng; N8N06–08/WF08–12 chưa nghiệm thu bởi nhiệm vụ này.

<details>
<summary>Snapshot readiness ngày12/11/2026 — giữ nguyên nội dung, TODO và thiếu backend tại thời điểm cũ</summary>

# N8N-05–08 — readiness từ source, 12/11/2026

Phạm vi lượt này: đọc source/contracts và chuẩn bị task; **không triển khai hoặc
activate WF-04–12**. Trạng thái N8N-05–08 vẫn TODO theo
[Product Plan v3](product-plan-v3.md#43-ticket-mới-n8n). Đây không phải nghiệm thu
DB/API của các dependency hoặc cam kết hoàn thành toàn bộ trong một ngày.

## Dependency matrix

| Ticket / workflow | Phần có trong source | Phần còn thiếu để đạt acceptance thật | Task đầu tiên nên giao |
| --- | --- | --- | --- |
| N8N-05 / WF-04–07 | CRM có people/leads/relationships/consent/erasure, Idempotency-Key và version; Catalog có offer/quote/policy; Class có hold/cancel/commit và invariant; Bridge có inbox/job/lease/checkpoint/result; IAM hiện cấp quyền Catalog/Class/Conversation | Chưa có service/contracts nghiệp vụ Enrollment và Payment trong workspace services/contracts hiện hành. CRM chưa nối Conversation/Channel mapping thành command đã xác minh. Chưa có scope/delegation CRM write, Enrollment hoặc Payment; sellable exchange automation vẫn đóng. Chưa có luồng confirmation → enrollment snapshot → hold → QR → matched → commit/reconcile/exception thật | **Đề xuất N8N-05-A:** lát cắt WF-04 từ Conversation đã xác minh sang CRM lead, consent và branch/ownership; bổ sung quyền hẹp, operation lookup/idempotency và API/DB/n8n acceptance. Cần task triển khai riêng; chưa đóng cả N8N-05 bằng lát cắt này |
| N8N-06 / WF-08–10 | Class/Org có các API quản lý hiện hành; command `classes.cancel` đã có confirmation/approval và transaction thực; Conversation có delivery/handoff | Chưa có quy trình Enrollment/Payment cho refund/transfer/suspend/waitlist và bù trừ. Chưa có service Notification với intent dedup, delivery/version, reminder/OTP và quyền learner. Command hủy lớp N8N-03 không thay thế toàn bộ schedule/refund/notification | Sau dependency nghiệp vụ, nối từng command được phê duyệt với API đích; chứng minh version/revoke/race và một tác dụng, rồi notification theo kết quả commit cuối |
| N8N-07 / WF-11–12 | CRM có erasure request và task ghi nhận từng nơi; Bridge có DEAD/replay/lease/recovery; packages/messaging có outbox/inbox | Chưa có Reporting/read model và import mapping/provenance/restore được kiểm. CRM erasure task chưa tự xóa ở Conversation/Enrollment/Payment/Reporting/Backups. Chưa có kết quả xử lý/suppression/retention xuyên các nguồn | Đề xuất chuẩn bị schema projection/checkpoint và erasure target contract; kiểm rebuild/replay trước khi mở import hoặc thao tác xóa. Không báo COMPLETED khi task ngoài CRM chưa có proof |
| N8N-08 / hạ tầng và evidence final | Compose pin image, DB/key/role test riêng, isolation, clean import và inactive execution smoke; registry/manifest và hash evidence | VPS/domain/HTTPS, quyền kênh/provider và chi phí chưa được cấp cho rollout trong nhiệm vụ hiện tại. Chưa chứng minh clean restore đầy đủ DB + credential key + jobs/broker, load/RPO/RTO/SLA và final evidence của N8N-05–07 | Chuẩn bị inventory/restore acceptance và runbook từ source; chỉ triển khai hạ tầng/dịch vụ ngoài local khi có task/quyền/đầu vào tương ứng. Export workflow hoặc giữ volume không là restore PASS |

## Những giới hạn phải giữ khi giao task tiếp

- N8N-05 trong plan phụ thuộc CRM/Enrollment/Payment/Class và N8N-02/03; không
  cần đợi N8N-04 để **chuẩn bị** phần độc lập. Nhưng nhiệm vụ hiện tại chỉ cho
  triển khai N8N-03/04 và rà readiness N8N-05–08, không mở các WF khác.
- IAM `MachineAudience`, `MachineScope`, `DomainOperation` và `JobOperation`
  hiện không có các operation ghi CRM/Enrollment/Payment/Notification/Reporting.
  Thêm workflow JSON không tạo ra quyền hoặc dependency còn thiếu.
- Tái dùng Class confirmation/approval và Bridge fencing như pattern, không
  tuyên bố chúng đã cấp quyền cho domain khác. API nguồn vẫn phải giữ invariant,
  version, idempotency/result lookup và business/audit/outbox đúng transaction.
- Dữ liệu tổng hợp và mail sink/sandbox có nhãn dùng để phát triển; giao dịch,
  gửi tin thật, provider terms/consent và production là các gate riêng.

## Acceptance tối thiểu cho task N8N-05-A được đề xuất

1. API nguồn xác minh conversation/guest hoặc staff session, branch, consent,
   identity mapping và ownership; n8n/LLM không tự khai actor hoặc consent.
2. CRM nhận command bằng quyền hẹp; tạo/nhận lead idempotent theo payload,
   kiểm quyền/version/consent ở boundary thực; lookup đối soát khi timeout.
3. Event redelivery, hai worker, stale/revoke/cross-branch và dependency error
   không tạo hồ sơ/lead hoặc audit/outbox trùng; DB và n8n thật có proof.
4. Caller/Portal liên quan đọc đúng kết quả bền, phân biệt lead với Enrollment;
   không báo đã đăng ký, giữ chỗ hoặc thanh toán. Không thay API nghiệp vụ bằng stub.

Đây là đề xuất để người dùng giao phạm vi triển khai tiếp theo, không là quyền
tự mở WF-04 trong lượt đang làm.

## Source đã đối chiếu

- [Ticket/dependency và acceptance N01–N12](product-plan-v3.md#43-ticket-mới-n8n),
  [đặc tả WF-04–12](n8n-workflows.md#3-đặc-tả-12-workflow).
- [CRM API và giới hạn integration](../services/crm/README.md),
  [CRM contracts](../packages/contracts/src/crm.ts).
- [Class API/invariants](../services/class-schedule/src/app.ts),
  [Class command runbook](../services/class-schedule/README.md).
- [IAM scopes/operations hiện có](../packages/contracts/src/machine.ts),
  [Bridge recovery](../services/automation-bridge/README.md).
- Workspace hiện có services: identity, org, catalog, class-schedule, crm,
  automation-bridge, conversation, gateway. Đã kiểm danh mục source; không chạy
  acceptance Enrollment/Payment/Notification/Reporting hoặc thử gate bên ngoài.

</details>
