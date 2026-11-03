# Phân công task — Lead và hai dev

Cập nhật: 27/10/2026. Căn cứ: [Product Plan v2](product-plan-v2.md). Đây là thứ tự giao việc đề xuất, chưa phải cam kết ngày hoàn thành. Các quyết định customer C01–C12 được theo dõi trong plan.

**Trạng thái sau triển khai:** phần kỹ thuật đợt 1 đã được triển khai và kiểm
chứng local; xem [bàn giao đợt 1](ban-giao-dot-1.md) và
[hướng dẫn chạy](huong-dan-dot-1.md). Customer chưa xác nhận C01–C12; chưa có
bằng chứng CI remote/deploy production. Đợt 2 đã có thêm nền tảng sự kiện,
Catalog/Class và Portal được kiểm chứng local; xem [bàn giao vòng 2 ngày 03/11](ban-giao-vong-2-2026-11-03.md)
để phân biệt phần đã làm với các điều kiện còn thiếu. Các đợt sau vẫn theo backlog.

## Nguyên tắc phân công

- **Lead:** nền tảng dùng chung, phân quyền, logic khó, contract, review và tích hợp; điều phối xác nhận nghiệp vụ với customer.
- **Dev 1 — Frontend:** Admin Portal, widget chat, giao diện vận hành và xử lý phiên/lỗi theo contract.
- **Dev 2 — Backend:** Org, Catalog, dữ liệu lớp, CRM, Payment và Notification theo contract đã thống nhất.
- Mỗi người giữ một task chính đang triển khai. Các nhóm ticket dưới đây là backlog theo thứ tự, không giao tất cả cùng lúc.
- Mỗi ticket thuộc một service, có 2–4 tiêu chí nghiệm thu, dependency, contract và bằng chứng kiểm tra. Luồng tích hợp dùng parent ticket và các sub-ticket theo service.
- Lead review phần quyền, tiền và chỗ trước khi merge. Không coi mock, test skip hoặc README là bằng chứng hoàn tất nghiệp vụ thật.

Hiện trạng và bằng chứng của đợt Portal/Catalog trước: [nghiệm thu 26/10](nghiem-thu-sau-fix-2026-10-26.md). Không làm lại Catalog đã có; chỉ bổ sung khoảng trống theo plan.

## Đợt 1 — Đăng nhập và phân quyền thật

| Người | Thứ tự task | Đầu ra nghiệm thu |
| --- | --- | --- |
| Lead | IAM-1 → IAM-2/IAM-4 → GW-1; áp dụng kiểm quyền vào Catalog bằng sub-ticket Catalog riêng | Login/JWT, phiên/thu hồi, thư viện kiểm quyền, Gateway; API chặn thao tác trái quyền |
| Dev 1 | Hoàn thiện WEB-1 | Login thật, xử lý phiên theo contract, menu từ quyền, logout/hết phiên và 401/403; thay mock trong luồng thật |
| Dev 2 | ORG-1 → ORG-2 | Trung tâm/chi nhánh/phòng ban, nhân sự/giảng viên; gán quyền qua IAM, không ghi DB IAM trực tiếp |

Lead bàn giao contract trước: API login/session, cơ chế truyền và lưu token, role/branchIds, lỗi, giới hạn hiệu lực phiên khi đổi quyền và tài khoản test. Dev 1 dựng theo phản hồi mẫu đúng contract rồi nối API thật; Dev 2 làm ORG-1 song song IAM, nối ORG-2 sau khi IAM sẵn sàng. ORG-1 phải được bảo vệ bằng IAM-2 trước pilot.

Lead đồng thời điều phối PM-1: chốt phạm vi pilot, điều kiện mở bán lớp, thanh toán, giữ chỗ, hoàn tiền và các quyết định C01–C12 liên quan; chưa có quyết định thì đánh dấu pending, không tự coi customer đã duyệt.

**Mốc hoàn thành:** đăng nhập thật → đúng menu → quyền backend đúng cả qua Gateway và khi gọi trực tiếp Catalog; truy cập chéo chi nhánh/sai quyền bị chặn.

## Đợt 2 — Dữ liệu khóa/lớp và giữ chỗ

| Người | Thứ tự task | Đầu ra nghiệm thu |
| --- | --- | --- |
| Lead | Hoàn thiện PL-2, phần cần thiết PL-3 → CS-4 | Outbox/inbox, idempotency, retry/DLQ và quan sát luồng; hold/expire/commit nguyên tử |
| Dev 1 | Phần Catalog/Class của WEB-4 → WEB-6 | Quản lý gói học, lớp/lịch; giảng viên xem lịch và khai giờ rảnh |
| Dev 2 | Khoảng trống CAT-1/2/4 → CS-1/2/3/6, phần tối thiểu CS-7 | Giá/chính sách có version; lớp, lịch, phòng, online, kiểm xung đột, điều kiện mở bán và tìm lớp |

Dev 2 bàn giao schema/API Class sớm để Lead làm CS-4 và Dev 1 làm giao diện. Phân định file/module trước khi Lead và Dev 2 cùng làm service Class; CS-4 sở hữu thao tác chỗ, CS-1 không tự sửa số chỗ giữ/chốt.

PL-2 chưa sẵn sàng thì chỉ triển khai phần độc lập; chưa bật luồng nghiệp vụ dùng event hoặc nghiệm thu độ tin cậy. Audit được gắn tại các thao tác cần thiết trong từng đợt, không để cuối mới bổ sung.

**Mốc hoàn thành:** tra được lớp hợp lệ; lớp chưa mở bán bị chặn; hai khách tranh chỗ cuối chỉ tối đa một người giữ thành công; hết hạn/retry không làm lệch chỗ.

## Đợt 3 — Web chat và hộp thư nhân viên

| Người | Thứ tự task | Đầu ra nghiệm thu |
| --- | --- | --- |
| Lead | CH-1/2/7 → CV-1/2/3/5 | Web chat hai chiều, lưu tin, gắn chi nhánh, phân công nguyên tử và chuyển giao |
| Dev 1 | WEB-8 → WEB-2 | Widget/session/reconnect; hộp thư, nhận/chuyển hội thoại, trạng thái gửi và lỗi |
| Dev 2 | CRM-1/3/4 → NT-1/2 | Contact/learner/payer, lead, consent và yêu cầu xóa; thông báo/escalation |

Chốt contract CRM trước CV-1 vì Conversation phụ thuộc CRM-1. CV-3 có version để chặn phản hồi AI lỗi thời, nhưng M1 chỉ bật nhân viên xử lý. Chốt giờ trực, hạn nhận hội thoại và người nhận escalation theo C06.

NT-1 xây hạ tầng delivery ở đợt này; template xác nhận đăng ký chỉ nối sau khi có enrollment.confirmed ở đợt 4, không phát xác nhận chỉ từ sự kiện nhận tiền.

**Mốc hoàn thành:** khách nhắn web → đúng hàng đợi → một nhân viên nhận/trả lời → khách nhận đúng tin; retry/reconnect không tạo trùng hoặc lộ lịch sử.

## Đợt 4 — Đăng ký, QR và xác nhận

| Người | Thứ tự task | Đầu ra nghiệm thu |
| --- | --- | --- |
| Lead | ENR-1 → ENR-2/3/5; review thiết kế Payment | State machine, snapshot giá/chính sách, saga hold–QR–commit, phục hồi và hủy/hết hạn |
| Dev 1 | WEB-3 → phần tối thiểu WEB-5 | Đăng ký tại quầy/chat, QR/hạn thanh toán; phân biệt tiền/chỗ; giao diện hàng đợi kế toán |
| Dev 2 | PAY-1/2 → PAY-3 → phần tối thiểu PAY-4/5 | Sandbox QR/webhook, giao dịch/đối soát, tiền lệch/muộn, hoàn có phê duyệt |

Lead chốt contract payment request, giao dịch, matched/review, commit/expire và idempotency trước khi chia implementation. ENR-2 cần PAY-1/2 và CS-4; ENR-5 cần CS-5 cùng PAY-4 tối thiểu. Phần hủy lớp CS-5 được chia thành sub-ticket Class trước khi nghiệm thu ENR-5; không bỏ qua vì nằm ở mốc mở rộng của v1.

Lead chịu trách nhiệm review/test race giữa tiền và hết hạn, chỗ cuối, timeout, retry, khởi động lại saga. Dev 2 triển khai Payment; kế toán không được sửa bằng chứng giao dịch hoặc giả webhook. Hoàn tối thiểu M1 có phê duyệt và ghi thực hiện thủ công đúng plan, chưa phải hoàn tự động.

**Mốc hoàn thành:** tiền hợp lệ → Class commit chỗ → mới CONFIRMED; không còn chỗ thì hoàn/chuyển có đồng ý; tiền không xác định đơn vào UNALLOCATED có owner; không mất/nhân đôi giao dịch.

## Đợt 5 — Nghiệm thu M1 và chuẩn bị pilot

| Người | Công việc | Đầu ra nghiệm thu |
| --- | --- | --- |
| Lead | OPS-1, phần còn lại PL-1/3; điều phối UAT-1 | Backup/restore, runbook, CI/deploy và phục hồi; bằng chứng go/no-go |
| Dev 1 | Hoàn chỉnh luồng lỗi/mobile, sửa UAT, hướng dẫn người dùng | Luồng chính dùng được trên 390px, không báo thành công giả; hướng dẫn theo vai trò |
| Dev 2 | Hoàn thiện RP-1, phần tối thiểu RP-2, NT-4; đối chiếu/import nếu cần | Audit đầy đủ, checkpoint/rebuild, báo hủy/đổi lịch, đối chiếu dữ liệu và tiền |

RP-1 được triển khai từng phần từ các đợt trước; đợt này nghiệm thu độ phủ. Các thao tác pilot phát sinh dữ liệu nhạy cảm không được phát hành khi audit chưa sẵn sàng. NT-4 tối thiểu và CS-5 phải có trước nghiệm thu luồng hủy lớp. CV-4 tự động có thể để M3, nhưng pilot phải có cách xóa dữ liệu có kiểm soát và theo dõi theo CRM-4.

Import chỉ mở nếu C12 xác nhận có dữ liệu cũ: CRM-5, CS-8, ENR-8, PAY-8 được chia theo service, có mapping ID, chạy thử và customer đối chiếu. Không có script ghi thẳng nhiều DB service.

**Mốc hoàn thành:** nhân viên vận hành được trọn luồng M1; các kịch bản UAT tiền/chỗ/quyền và phục hồi đạt; customer xác nhận chính sách/phạm vi, có owner hỗ trợ và phương án xử lý thủ công. Kết quả CI remote ghi riêng với kiểm tra local.

## Sau M1 — AI và một kênh ngoài (M2)

| Người | Công việc | Điều kiện bật |
| --- | --- | --- |
| Lead | AG-1 đến AG-9, theo dependency | Draft → auto-reply ít rủi ro → tool giữ/QR sau UAT; không giao cả chín ticket cùng lúc |
| Dev 1 | Giao diện duyệt nháp, mode AI/người, tiếp quản và lỗi | Contract Conversation/AI ổn định; kiểm tình huống AI đang chạy thì nhân viên nhận |
| Dev 2 | Một trong CH-3 hoặc CH-4, hỗ trợ Notification/API tool | Customer đã có quyền kênh; adapter có delivery, cửa sổ trả lời và dedup |

AG-7/8/9 phải có trước khi dùng LLM thật hoặc auto-send tương ứng: che PII, eval/log và quota. Lead review mọi tool về scope, nguồn dữ liệu và idempotency. Có công tắc tắt AI theo hệ thống/chi nhánh/hội thoại và đường chuyển người.

**Mốc hoàn thành:** bộ hội thoại UAT đạt ngưỡng trong plan, phản hồi có số liệu truy được nguồn, AI không chen sau handoff và không vượt quyền. Không mở rộng kênh chỉ để đủ số lượng khi quyền chưa được duyệt.

## Backlog sau M2

M3: ENR-4/6/7, các phần mở rộng CS-5/7, PAY-4/5/6, CAT-3, CRM-2, CV-4, NT-3, RP-3/4, WEB-7 và kênh ngoài còn lại. M4: IAM-3/WEB-9. Chốt lại owner theo năng lực từng vòng; Lead giữ saga và logic chuyển chỗ, Dev 1 làm UI, Dev 2 làm backend độc lập theo contract.

Nếu bảo lưu/chuyển lớp hoặc nghiệp vụ mở rộng là điều kiện bắt buộc để bán cho customer, đưa ticket liên quan lên trước pilot; chưa có tính năng thì không công bố chính sách hứa hỗ trợ tính năng đó.

## Ba task mở đầu tiên

| Người | Task đầu tiên | Tiêu chí để đóng |
| --- | --- | --- |
| Lead | IAM-1 | Login đúng nhận token hợp lệ chứa role/branch; sai credential bị từ chối; password hash, không lộ mật khẩu/token trong log; có test và contract |
| Dev 1 | WEB-1 — phần login/session theo contract | Form gọi đúng API/envelope, hiển thị lỗi/hết phiên; mock khi API chưa có được ghi rõ, chỉ nghiệm thu tích hợp khi nối IAM thật |
| Dev 2 | ORG-1 | Migration/seed sáu đơn vị, API theo contract, kiểm dữ liệu và trạng thái; chỉ cho pilot khi áp dụng IAM-2 |

Không đặt deadline từ danh mục ticket. Mỗi vòng đề xuất một tuần: chọn ticket vừa sức, demo đầu ra, ghi bằng chứng và cập nhật estimate/phụ thuộc. Sửa task ownership hoặc phạm vi phải đồng bộ với Product Plan v2.
