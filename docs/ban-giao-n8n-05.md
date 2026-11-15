# Bàn giao N8N-05 — WF04–WF07

Ngày 14/11/2026 (+07:00). Reviewer và người quyết định local: Codex agent theo
[ủy quyền hiện hành](prompt-chot-nghiem-thu-n8n-05.md) và
[prompt nghiệp vụ gốc](prompt-hoan-thanh-n8n-05.md). Trạng thái nghiệm thu và bằng chứng cuối
ở [acceptance matrix](acceptance-n8n-05.md); tài liệu này không thay gate live.

## Phạm vi và policy DEMO

Enrollment/Payment là service thật, PostgreSQL riêng; Class quản lý chỗ, Payment
quản lý ledger, Enrollment quản lý snapshot và trạng thái. n8n điều phối các bước
HTTP, không ghi nhiều DB và không có backend saga runner thay n8n. WF04 nối nguồn
CRM có thẩm quyền; WF05 chỉ tạo giữ chỗ/QR; WF06 commit chỗ trước xác nhận; WF07
đối soát hủy/hết hạn/review. `enrollment.confirmed` có refs và causation để downstream
tiếp tục, chưa triển khai hoặc tuyên bố Notification/Reporting đã xử lý.

Policy `DEMO-N8N05-2026-11-14-v1`: hold 20 phút theo Class server; confirmation
5 phút, gắn phiên/actor/payload/quote/terms. Đổi offer phải xác nhận mới. Review có
owner/hạn và được gia hạn tối đa một lần 24 giờ bằng đề xuất kế toán + giám đốc
độc lập còn quyền; không gia hạn hold. Tách contact/learner/payer và quan hệ đã
xác minh; không auto-merge. Giá từ Catalog snapshot, VND nguyên đồng, adapter demo
giới hạn mỗi transaction 1 tỷ đồng. Thiếu/thừa/sai mã/hai giao dịch vào review;
không tự gán tiền hoặc duyệt tài chính. `REFUND_PENDING` là chờ xử lý, chưa hoàn.
Thu thủ công, giảm giá/trả góp, giao dịch thật và WF08–12 chưa mở.

Codex agent chốt policy DEMO này ngày14/11/2026 theo ủy quyền, để kiểm invariants
tiền/chỗ với mặc định Class và quy trình duyệt độc lập của dự án. Chỉ áp dụng dữ
liệu tổng hợp; không là điều khoản khách thật. Quyết định local cuối và thời gian
nằm trong [index](../workflows/n8n/registration-evidence.json) và
[checkpoint](../.local/automation/n8n05-closeout-audit/checkpoint.json).

QR PNG được tạo local và chứa payload `DEMO-ONLY`, không phải QR ngân hàng/SePay.
Webhook tổng hợp chỉ mở trong test, xác minh HMAC bằng secret mới của runtime.
Ledger append-only, dedup provider/account/transactionId; cùng ID khác payload bị
chặn. QR hết hạn/đóng không ngăn ghi nhận tiền muộn vào ledger và review.

## Migration, caller và credential

- Thêm DB/migration riêng [Enrollment](../services/enrollment/README.md) và
  [Payment](../services/payment/README.md); không chạy trên DB cũ để làm nghiệm thu.
- IAM `0004_service` bổ sung source principal có phiên bản và delegation service;
  Class `0006_enrollment` bổ sung scoped operation; CRM `0003_erasure_history`
  scrub bản sao PII theo tombstone đã xác minh. Các migration được kiểm lặp trên DB mới.
- Gateway/BFF mở whitelist public; Portal `/dashboard/enrollments` xem preview,
  checkbox xác nhận rõ ràng, QR/trạng thái bền và đọc lại sau reload. Chat/LLM không
  có quyền tự xác nhận mua. Legacy Class commit/cancel không vượt biên Enrollment thật.
- Canonical WF04–07 luôn inactive. Credential IDs `N8N05WF04Machine` đến
  `N8N05WF07Machine`, loại `httpCustomAuth`, tên `WF-04-machine-client` đến
  `WF-07-machine-client`; secret chỉ được import trong bản runtime test. Worker chỉ
  có các operation CRM/Enrollment/Payment/Class đã khai báo, không có admin/source grant.
  Source Enrollment/Payment có credential riêng; operator bootstrap không vào n8n.

## Chạy demo và recovery local

Từ root chạy `node scripts/test-n8n05.mjs`. Runner tự tạo grant/preflight/marker,
secret, project/network/volume và DB/role mới, dùng image pin sẵn; cần Docker Desktop
và Microsoft Edge. Build Portal trước bằng Node preload bảo vệ personal env:

```powershell
@'
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const keys=['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','COMSPEC','PATHEXT'];
const env=Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const guard=path.resolve('scripts/no-personal-env.cjs').replaceAll('\\','/');
Object.assign(env,{NODE_ENV:'production',NEXT_PUBLIC_ENABLE_MOCK:'false',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--require "${guard}"`});
const result=spawnSync(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'build','apps/admin-portal'],{env,stdio:'inherit',windowsHide:true});
process.exit(result.status??1);
'@ | node
node scripts/test-n8n05.mjs
```

Không build khi một phiên khác đang dùng output Portal. Preload cũng đi vào
worker qua NODE_OPTIONS; đường dẫn trong NODE_OPTIONS dùng dấu `/` trên Windows.
Runner ghi `promptFile` và SHA-256 tài liệu ủy quyền hiện hành vào preflight;
không phụ thuộc đường dẫn prompt cũ từng bị thiếu. Canonical không bị activate.
Nhãn `IMPLEMENTED_NOT_ACCEPTED` trong manifest là metadata generator trước
nghiệm thu; quyết định sau kiểm chứng thuộc evidence index/checkpoint mới.
Giữ nguyên manifest/canonical đã được receipt định danh bằng hash.

Không trỏ runner vào runtime cũ. Bản copy test được activate để kiểm poll/event,
mất phản hồi và kill/restart; chỉ endpoint binding và retention trace đổi so với
canonical, graph giữ nguyên. Sau lỗi, giữ marker/trace và chẩn đoán; không resume
marker cũ. Sửa/review/check phần ảnh hưởng rồi chạy lượt mới. Không tự chạy lại
model benchmark hoặc các preflight cũ có đọc OpenRouter credential.

Job DONE chỉ là hoàn tất kỹ thuật. Khi timeout chưa biết kết quả, tra operation và
trạng thái nguồn trước mutation/compensation. Sau Class commit, giữ cùng job/key,
lookup COMMITTED rồi mới Enrollment confirm; không giữ thêm chỗ. Payment close khi
chưa có request vẫn ghi fence để chặn create muộn. Tiền đủ đến muộn chỉ lấy chỗ qua
Class nguyên tử; hết chỗ vào NO_SEAT review, không tự hoàn hoặc chuyển lớp.

Runtime cleanup chỉ dừng process/project test do nhiệm vụ tạo, không `down -v` hoặc
prune. Giữ volumes/artifacts, raw webhook, credential và execution trong `.local/automation`
với ACL current user/Administrators/SYSTEM; không đưa raw vào Git hoặc báo cáo công khai.
Không có scheduler tiếp tục sau khi agent dừng.

Đợt chốt hồ sơ đã kiểm lại runtime mới, source/schema/canonical/config hashes,
trace hashes, ACL descendants và các project/port lịch sử; xem
[isolation cuối](../.local/automation/n8n05-closeout-audit/final-isolation.json).
Giữ checkpoint trước sửa trong snapshot `before`, cùng mọi FAIL/SKIP/UNKNOWN.
Script closeout cũ không được chạy: nó gán PASS mặc định, dùng số đếm cố định,
thiếu guard khi sửa Markdown và có thể đánh dấu quá rộng ticket cha. Verifier cũ
thiếu receipt-only projects/network/port/worker/retention; thay bằng inventory
read-only và kiểm tra cuối. Chỉ xóa một network test mồ côi đã xác minh không có
container; giữ mọi volume/artifact.

Build cũ giữ nguyên tại `apps/admin-portal/out/n8n05-build-before-20261116` với
ACL có sẵn của output; snapshot byte-identical của 1043 file được tạo lại trong
vùng evidence private. Không dùng output cũ làm proof build an toàn. Lượt build
đầu sau đó thất bại trước khi Next chạy do escape dấu `\\` trong NODE_OPTIONS;
giữ FAIL, sửa đường dẫn `/` rồi build sạch PASS. Không đọc personal env ở lượt này.

## Gate bên ngoài và giới hạn

Provider/live/production **BLOCKED**, firstSeen 14/11/2026; owner: người dùng/chủ tài
khoản provider. Chưa được chỉ định tài khoản/ngân hàng, credential, provider approval
và quyền rollout. Đã hoàn tất đường adapter tổng hợp local, không liên hệ bên ngoài
hoặc mua dịch vụ để gỡ gate. Chỉ mở task live riêng sau khi đủ đầu vào và quyền cụ thể;
gate này không chặn acceptance local. Chi phí nhiệm vụ 0 USD, không gọi model/provider.

Một build phát triển trước đây đã để Next tự load `.env.local` cá nhân. Nội dung
không được in/đọc để kiểm tra, nên không khẳng định biết những biến nào đã được nạp.
Lượt liên quan đã dừng, giữ receipt/sự cố; sửa build/start bằng preload chặn đọc
metadata/nội dung `.env*`, tự kiểm bằng fixture riêng, rebuild và kiểm runtime mới
bằng env allowlist. Đây là sự cố đã ghi nhận, không được che thành “chưa từng đọc env”.
