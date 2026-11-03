# Kế hoạch triển khai luồng thật: Lớp học và giữ chỗ

Cập nhật: 02/11/2026. Trạng thái: **kế hoạch cần làm, chưa phải biên bản hoàn thành**.

Kết quả triển khai và bằng chứng chạy được ghi riêng tại
[bàn giao lớp và giữ chỗ](ban-giao-lop-giu-cho.md). Checklist dưới đây giữ nguyên
làm chuẩn đối chiếu; không đồng nghĩa đã đóng toàn bộ các ticket được viện dẫn.

Căn cứ: [Product Plan v2](product-plan-v2.md), [phân công task v2](phan-cong-task-v2.md), [bàn giao đợt 1](ban-giao-dot-1.md).

## 1. Mục tiêu và giới hạn

Luồng cần chứng minh bằng dữ liệu thật:

**Đăng nhập → quản lý khóa/gói → tạo lớp và lịch → duyệt mở bán → tra lớp còn chỗ → giữ chỗ → hết hạn/hủy → chỗ được trả lại.**

Hai yêu cầu đồng thời tranh chỗ cuối chỉ có tối đa một yêu cầu thành công. Tải lại trang hoặc khởi động lại service không làm mất hold hoặc tăng sai số chỗ.

Đợt này ưu tiên phần Catalog/Class của đợt 2. Chat, QR, Payment, AI và Student Portal vẫn theo các đợt sau. Không gọi hold là đăng ký đã xác nhận hoặc thanh toán thành công. Chưa tự đánh dấu hoàn thành CAT-1, WEB-4, CS-4 hoặc toàn bộ M1 chỉ từ một demo thuận lợi.

Luồng đăng ký đầy đủ trong Product Plan phải qua Enrollment. Khi Enrollment/CRM chưa có, bản demo giữ chỗ chỉ là **demo kỹ thuật của Class**, dùng learnerId/enrollmentId từ fixture test có nhãn; không cho nhập ID tùy ý để giả thành hồ sơ học viên thật. Chốt adapter/contract trước; khi tích hợp nghiệp vụ, Enrollment là bên điều phối, không cho browser tự commit chỗ.

Mặc định demo đề xuất: một chi nhánh, giá VND, giữ chỗ 20 phút theo C03. C02/C03 chưa được customer duyệt. Nếu rút ngắn TTL cho buổi demo, cấu hình riêng môi trường demo và ghi rõ trên màn hình; không thay mặc định nghiệp vụ.

## 2. Phần đã có, cần tận dụng

- IAM/JWT/refresh/logout/thu hồi phiên và quyền backend thật.
- Gateway, Portal BFF và cookie HttpOnly; không đưa token về localStorage.
- Org, sáu đơn vị, phòng ban, hồ sơ nhân sự/giảng viên.
- Catalog/PostgreSQL: API tạo/xem/sửa khóa và gói; UI khóa học đã nối thật.
- Luồng Tổ chức: cấp account → tạo nhân sự → gán quyền/phạm vi.

Chưa có Class & Schedule hoặc nghiệp vụ hold thật. Trang `/dashboard/schedule` hiện là khung, `/dashboard/classes` đang dành cho danh sách lớp của giảng viên. Sidebar hiện dùng `lib/roles.ts`; không lấy các đường dẫn cũ trong `src/config/menu.ts` làm chuẩn nếu chưa kiểm tra nơi sử dụng.

## 3. Thứ tự thực hiện và điểm dừng nghiệm thu

| Mốc | Việc chính | Điều kiện chuyển mốc |
| --- | --- | --- |
| A — Chạy lại nền | Cấu hình, DB riêng, seed, tài khoản và demo IAM/Org/Catalog | Khởi động lại vẫn đăng nhập, gọi API và lưu dữ liệu được |
| B — Khóa/gói và lớp | UI gói học, dữ liệu Class, lịch, quyền, điều kiện OPEN | Tạo lớp từ UI, dữ liệu tồn tại sau reload; lớp sai điều kiện không được mở |
| C — Tra cứu và giữ chỗ | Tìm lớp hợp lệ, hold nguyên tử, retry, hết hạn/hủy | UI và DB cùng kết quả; không vượt sức chứa khi đồng thời |
| D — Tích hợp và bằng chứng | Recovery/event theo scope, browser test, kiểm tra quyền, runbook | Có kết quả kiểm tra, ảnh/video và giới hạn được ghi rõ |

Mỗi người giữ một task chính. Chốt contract trước khi frontend và backend triển khai độc lập. Nếu chỉ đạt B thì báo cáo đúng B; không dùng mock để trình bày C đã xong.

## 4. Lead / phần tích hợp cần làm

- [ ] Chốt contract lớp/lịch/hold, quyền theo actor và chi nhánh, lỗi nghiệp vụ, thời gian server, pagination và idempotency; đặt schema trong `packages/contracts`.
- [ ] Chốt ranh giới: backend phụ trách dữ liệu lớp/lịch; Lead phụ trách thao tác hold/expire/commit. Không để CRUD lớp tự sửa số chỗ giữ/chốt.
- [ ] Bổ sung định tuyến Class ở Gateway **và whitelist Portal BFF**; có timeout, correlationId và envelope lỗi theo quy ước.
- [ ] Áp dụng IAM ở Class khi gọi trực tiếp, không chỉ bảo vệ tại Gateway; không tin role/branch gửi từ browser.
- [ ] Hoàn thiện phần cần thiết PL-2: transactional outbox/inbox, dedup, retry/DLQ và recovery trước khi bật nghiệp vụ phụ thuộc event. Broker demo hiện có chưa đủ để đóng PL-2.
- [ ] Bổ sung log/correlation và quan sát lỗi/worker hết hạn cho luồng demo; ghi rõ phần PL-3 còn thiếu.
- [ ] Review transaction/locking, idempotency, race hold–expire–commit và giới hạn tạo hold hàng loạt.
- [ ] Chuẩn bị lệnh chạy, seed, cấu hình và pipeline kiểm tra. Lưu bằng chứng local và CI remote riêng.

Điểm chốt quyền trước khi code: Product Plan quy định giám đốc chi nhánh duyệt OPEN; quyền của giám đốc trung tâm đối với thao tác này cần ghi rõ trong ma trận, không ngầm suy diễn. Gọi commit chỉ dành cho luồng backend đã được cấp quyền; demo qua test kỹ thuật, không tạo nút “xác nhận đã thanh toán” trên Portal.

## 5. Backend cần làm — Dev 2 và Lead

### BE-01 — Hoàn thiện Catalog phục vụ lớp

- [ ] Dùng lại API `/api/v1/packages`; kiểm gói thuộc khóa, trạng thái, số buổi, giá và quyền sửa.
- [ ] Bổ sung policy version/effectiveAt và lịch sử theo CAT-1/CAT-4; chốt nguồn báo giá và snapshot để Enrollment dùng sau.
- [ ] Bổ sung lọc CAT-2 theo dữ liệu thật; gói/khóa ngừng bán không được tạo mới yêu cầu bán.
- [ ] Có seed khóa/gói và chính sách mẫu, gắn rõ dữ liệu demo; không ghi đè dữ liệu người dùng khi seed lại.

**Nghiệm thu:** giá/gói lấy từ Catalog; mã trùng và quan hệ sai bị từ chối; chỉ vai trò được phép mới sửa. API gói đã có thì không làm lại từ đầu.

### BE-02 — Dựng Class & Schedule

- [ ] Tạo service, DB/user riêng, migration/seed, health/readiness và cấu hình theo template hiện tại.
- [ ] Schema tối thiểu: lớp, buổi học, phòng, khóa/gói, chi nhánh, giảng viên, hình thức, sức chứa, hạn đăng ký, sĩ số tối thiểu/hạn quyết định và trạng thái.
- [ ] Tham chiếu Org/Catalog qua contract/API; không đọc hoặc ghi DB của service khác.
- [ ] Tạo/xem/sửa lớp và lịch; vòng đời DRAFT → PLANNED → OPEN theo scope. Các trạng thái khác chưa làm phải được từ chối đúng, không giả chuyển trạng thái.
- [ ] OPEN chỉ khi đủ điều kiện lịch/giảng viên/phòng hoặc online theo plan; lớp chưa đủ điều kiện trả lỗi rõ ràng. Cách duyệt khi chưa đạt sĩ số tối thiểu phải được chốt riêng theo C02/CS-7.
- [ ] Chặn trùng buổi của cùng lớp, lịch giảng viên và phòng; khoảng thời gian kề nhau xử lý nhất quán. Kiểm các yêu cầu ghi lịch đồng thời.
- [ ] Phân quyền tạo/sửa/đọc theo chi nhánh; giảng viên chỉ xem lớp được phân công, không lộ dữ liệu học viên không cần thiết.
- [ ] Ghi audit cùng transaction cho thay đổi nhạy cảm; không cho API chỉnh/xóa audit.

**Nghiệm thu:** tạo lớp online/onsite hợp lệ; sai chi nhánh, thiếu phòng, trùng lịch hoặc thiếu quyền bị chặn cả khi gọi service trực tiếp. Không giảm capacity dưới số committed + hold còn hiệu lực.

### BE-03 — Tra lớp và số chỗ thật

- [ ] API lọc khóa/gói, chi nhánh, hình thức và khung thời gian; kiểm sort/pagination theo contract.
- [ ] Kết quả có trạng thái, lịch, capacity, committed, held còn hiệu lực, available và thời điểm đọc.
- [ ] `available = capacity - committed - held còn hiệu lực`; tính nhất quán theo đồng hồ DB/server.
- [ ] Luồng tuyển sinh chỉ chọn lớp OPEN còn hạn đăng ký và đủ điều kiện bán; danh sách quản lý có thể thấy DRAFT/PLANNED nhưng không được giữ chỗ.

**Nghiệm thu:** thay hold làm thay đổi chỗ còn; hold đã hết hạn không tiếp tục chiếm chỗ dù worker chưa quét đến. Danh sách đọc không thay thế kiểm tra nguyên tử khi ghi hold.

### BE-04 — Hold, hủy, hết hạn và commit — Lead

- [ ] Lưu hold bền vững tại PostgreSQL: holdId, classId, packageId, learnerId, enrollmentId, actor, trạng thái, expiresAt và operation/idempotency key.
- [ ] Transaction/locking bảo vệ chỗ cuối; một học viên/lớp chỉ có một hold hiệu lực, kể cả khi gửi nhiều key khác nhau.
- [ ] Cùng key và payload trả cùng kết quả; key cũ khác payload bị từ chối. Chốt namespace key và quyền đọc lại kết quả.
- [ ] Hủy/expire idempotent; trả chỗ đúng một lần. Worker khởi động lại phải xử lý được hold quá hạn còn trong DB.
- [ ] Commit nguyên tử/idempotent, chỉ khi hold còn hợp lệ và caller có quyền; expire thắng thì commit không được hồi sinh chỗ cũ.
- [ ] Kiểm class/package khớp, trạng thái bán, cutoff, scope và giới hạn tạo hold; không chấp nhận TTL/giá/actor do client tự quyết.
- [ ] Nếu dùng event, ghi thay đổi và outbox cùng transaction; consumer dedup trước xử lý. Chưa đủ PL-2 thì chỉ nghiệm thu sub-task đồng bộ đã kiểm chứng.

**Nghiệm thu:** hai request tranh chỗ cuối chỉ một thắng; retry, hủy nhiều lần, expire–commit cạnh tranh và restart không làm âm hoặc tăng sai số chỗ.

## 6. Frontend cần làm — bắt buộc dùng design-taste-frontend

Trước khi sửa UI, đọc `design-taste-frontend/SKILL.md` và `references/app-screens.md` từ skill đã cài global. Đây là màn hình vận hành, áp dụng nhánh **app screen**, không dùng bố cục landing page.

### FE-01 — Chốt bố cục và dữ liệu

- [ ] Kiểm Portal hiện tại trong trình duyệt, lưu ảnh trước khi sửa; ghi lại các route/form/quyền cần giữ.
- [ ] Liệt kê dữ liệu thật: khóa/gói, lớp, chi nhánh, giảng viên/phòng, lịch, chỗ còn và hold/hạn server. Dữ liệu demo phải được seed vào backend và được nhận diện là demo.
- [ ] Chạy `draw.mjs --app --list kinds`, chọn kind phù hợp; dùng `--keep palette,type` để giữ nhận diện/type đang có. Ghi style/seed/lý do chọn vào bàn giao.
- [ ] Giới hạn thay đổi trong màn hình của luồng; không viết lại toàn bộ Portal, không đổi framework hoặc thêm thư viện UI khi chưa cần.

| Màn hình | Câu hỏi chính cần trả lời | Thao tác chính |
| --- | --- | --- |
| Khóa/gói học | Khóa này đang bán những gói nào, giá và số buổi bao nhiêu? | Tạo/sửa gói với đúng quyền |
| Quản lý lớp/lịch | Lớp nào đủ điều kiện mở bán, vướng điều kiện gì? | Tạo/sửa lớp, xếp buổi và duyệt OPEN |
| Tra lớp còn chỗ | Lớp nào phù hợp nhu cầu và còn chỗ ngay lúc đọc? | Lọc, xem chi tiết và xin giữ chỗ |
| Chi tiết hold | Đang giữ chỗ nào, tới khi nào và còn hiệu lực không? | Làm mới trạng thái hoặc hủy hold |

### FE-02 — Giao diện gói học

- [ ] Bổ sung phần gói học trong màn hình Catalog, gọi API thật để tạo/xem/sửa; chọn khóa từ API, không gõ UUID.
- [ ] Hiển thị tên/mã, khóa, số buổi, giá VND và trạng thái; lỗi validation tại trường liên quan.
- [ ] Chỉ giám đốc trung tâm sửa khóa/gói theo quyền hiện tại; các vai trò khác được đọc theo contract.
- [ ] Reload vẫn thấy dữ liệu đã lưu; có loading, empty, error, retry và trạng thái đang lưu.

### FE-03 — Quản lý lớp và lịch

- [ ] Dùng `/dashboard/schedule` cho luồng quản lý/tra cứu sau khi chốt menu/guard; giữ `/dashboard/classes` cho giảng viên hoặc cập nhật đồng bộ nếu chọn thiết kế route khác.
- [ ] Form có khóa/gói, chi nhánh, hình thức, giảng viên, phòng hoặc thông tin online, capacity, hạn đăng ký và các buổi học.
- [ ] Select lấy từ API theo quyền; dữ liệu thiếu thì hướng dẫn tạo/bổ sung, không dùng danh sách hardcode như dữ liệu thật.
- [ ] Hiển thị lỗi xung đột lịch cụ thể; thao tác OPEN chỉ hiện cho actor có quyền và hiển thị điều kiện còn thiếu.
- [ ] Thời gian hiển thị Asia/Ho_Chi_Minh, request/storage dùng quy ước UTC; label ghi rõ múi giờ.

### FE-04 — Tra lớp và giữ chỗ

- [ ] Bộ lọc theo contract; kết quả thể hiện lớp, gói, lịch/chi nhánh, sức chứa, đã chốt, đang giữ và còn chỗ.
- [ ] Chi tiết lớp có một thao tác chính “Giữ chỗ”; khi chưa OPEN, quá hạn, hết chỗ hoặc thiếu quyền thì nêu lý do.
- [ ] Giữ cùng idempotency key cho một ý định khi timeout/retry; đổi payload là ý định mới. Không gửi key mới tùy tiện sau lỗi mạng.
- [ ] Chỉ hiện giữ thành công sau khi backend xác nhận. Nếu chỗ cuối bị người khác lấy, báo hết chỗ và tải lại dữ liệu.
- [ ] Countdown dựa trên expiresAt/server time; về 0 hoặc quay lại tab phải kiểm lại API. Browser không tự giải phóng chỗ hoặc tự chuyển trạng thái backend.
- [ ] Hủy hold có xác nhận nêu đúng lớp; API thành công mới cập nhật kết quả, sau đó làm mới số chỗ.
- [ ] Khi chưa có Enrollment/CRM, chỉ bật trải nghiệm fixture trong môi trường demo có nhãn và giới hạn ở backend; không mở form giữ chỗ nghiệp vụ công khai.

### FE-05 — Thiết kế, trạng thái và khả năng truy cập

- [ ] Title rõ, khoảng 20–24px; ưu tiên danh sách/lịch/chỗ cần xử lý, không thêm banner lớn hoặc KPI giả.
- [ ] Bề mặt phẳng, viền nhẹ; màu chủ yếu dành cho trạng thái cần quyết định và một hành động chính. Tránh gradient, glow, icon trong ô màu lặp lại hoặc biểu đồ không có dữ liệu.
- [ ] Số lượng/giá căn phải, dùng tabular figures; số 0 là 0, dữ liệu thiếu là “—”. Tổng theo đúng phạm vi dữ liệu/lọc; không lấy trang đầu để giả tổng toàn hệ thống.
- [ ] Form có label thật, lỗi gắn trường, focus thấy rõ; dialog dùng được bằng bàn phím, trả focus khi đóng, nút disabled có lý do đọc được.
- [ ] Mỗi khu vực có loading/empty/error/retry; khi không xác minh được hold thì hiển thị trạng thái chưa xác định, không báo thành công hay hết hạn giả.
- [ ] 401 về login theo cơ chế hiện có; 403 thông báo thiếu quyền; lỗi service không bị biến thành danh sách rỗng.
- [ ] Kiểm 1440px, 768px, 390px; mobile thu menu, control chạm tối thiểu 44px, form xếp dọc; bảng cuộn trong khung hoặc chuyển thành danh sách, không tràn ngang trang.
- [ ] Dùng `lint.mjs --app` và `inspect.mjs --app` của skill; kiểm màn hình đã đăng nhập bằng cơ chế phiên được tool hỗ trợ, không chỉ chụp trang login. Không lưu token vào file version control.
- [ ] Xem ảnh ở cả ba kích thước, sửa ba vấn đề lớn nhất, kiểm lại tối đa ba vòng; mọi ngoại lệ do shell cũ phải được ghi rõ, không tuyên bố đã đạt nếu chưa kiểm.

## 7. Contract cần bàn giao trước khi nối UI

Các route Class/hold dưới đây là **đề xuất, chưa phải API đang có**; Lead chốt tên/schema/quyền và cập nhật tài liệu khi triển khai.

| Nhóm | Thao tác cần có | Dữ liệu/lỗi cần thống nhất |
| --- | --- | --- |
| Catalog | `/api/v1/packages` hiện có | courseId, giá VND, số buổi, trạng thái, quyền ghi |
| Class | Danh sách/chi tiết/tạo/sửa, duyệt OPEN | Filter/pagination, branchId, packageId, lịch, capacity, version |
| Schedule | Buổi học, phòng, phân công giảng viên | UTC/múi giờ, online/onsite, lỗi trùng lịch |
| Availability | Tra lớp hợp lệ còn chỗ | capacity/committed/held/available, serverTime và thời điểm đọc |
| Hold | Tạo, tra theo ID/operation, hủy, backend commit | Idempotency key, learnerId/enrollmentId, expiresAt, quyền đọc/hủy/commit |
| Lỗi | Envelope theo quy ước dự án | Phân biệt validation, forbidden, conflict, hết chỗ, hết hạn, chưa mở bán, upstream unavailable |

## 8. Bộ kiểm tra bắt buộc trước bàn giao

| Tình huống | Kết quả đạt |
| --- | --- |
| Tạo khóa/gói/lớp qua Portal, reload | Dữ liệu từ PostgreSQL còn nguyên |
| DRAFT/PLANNED hoặc lớp quá hạn đăng ký | Không tạo hold được |
| Lịch trùng giảng viên/phòng; hai lần ghi đồng thời | Không tạo lịch xung đột |
| Hai learner tranh một chỗ cuối | Đúng một hold thành công, available không âm |
| Cùng learner gửi hai key cho cùng lớp | Tối đa một hold hiệu lực |
| Retry cùng key; key cũ khác payload | Cùng kết quả; payload khác bị conflict |
| Hold hết hạn trước worker quét | Không chiếm chỗ khi tính available; không commit được |
| Hủy/expire nhiều lần; commit cạnh tranh expire | Trả/chốt chỗ đúng một lần, trạng thái cuối nhất quán |
| Restart worker/service sau khi giữ chỗ | Hold tồn tại; quá hạn được xử lý sau phục hồi |
| Sai role, giả branch, chéo chi nhánh, gọi service trực tiếp | Bị từ chối, không lộ dữ liệu ngoài scope |
| Timeout rồi thử lại; hết phiên; service tắt | UI thể hiện đúng lỗi/trạng thái, không báo thành công giả |
| Trình duyệt 1440/768/390px và bàn phím | Dùng được luồng chính, không lỗi JS hoặc tràn ngang trang |

Chạy lint/typecheck/test/build và suite PostgreSQL có dữ liệu thật; test DB không được skip để nghiệm thu. Nếu dùng event, thêm test broker gián đoạn, replay trùng và phục hồi outbox/inbox. Các bài test race phải gửi đồng thời, không chỉ gọi tuần tự.

## 9. Chuẩn bị môi trường và bàn giao

- [ ] Chuẩn bị cấu hình IAM/Org/Gateway/Catalog/Class/Portal và AUTH_SECRET theo hướng dẫn; không ghi đè `.env` cá nhân.
- [ ] Kiểm cổng trước khi chạy: lượt rà soát trước thấy dự án khác đang dùng PostgreSQL 5432 và Redis 6379; chọn cổng riêng, không dùng nhầm DB.
- [ ] Seed dữ liệu demo có lớp OPEN hợp lệ còn đúng một chỗ, lớp PLANNED, lớp hết chỗ và lịch xung đột; số liệu lấy từ DB, không chỉnh số trực tiếp ở UI.
- [ ] Ghi cách chạy migration/seed/service/worker và cách khởi động lại; tách TTL demo nếu cần.
- [ ] Cập nhật README/contract/menu/guard và nhãn mock: chỉ bỏ nhãn ở phần đã nối và kiểm chứng thật.
- [ ] Lưu commit/nhánh theo quy trình nhóm; bàn giao kèm test command, kết quả, ảnh 3 kích thước, video demo và phần chưa hoàn tất. Không đóng ticket toàn phần từ sub-task demo.

## 10. Kịch bản trình bày

1. Giám đốc tạo khóa/gói; người có quyền tạo lịch và duyệt lớp OPEN.
2. Nhân viên tra lớp theo chi nhánh/khung giờ và thấy còn một chỗ.
3. Hai phiên thử giữ chỗ: một thành công, phiên còn lại nhận thông báo hết chỗ.
4. Reload phiên thắng: hold và hạn server vẫn còn; hủy hoặc chờ TTL demo để trả chỗ.
5. Phiên khác tra lại và giữ được chỗ đã trả; lớp PLANNED/sai chi nhánh vẫn bị chặn.
6. Trình bày bằng chứng test concurrency/recovery, ranh giới demo Class và phần Enrollment/Payment/AI sẽ tích hợp sau.

**Tiêu chí bàn giao cuối:** luồng đi qua Portal → BFF → Gateway → service → PostgreSQL; đúng quyền, đúng chỗ, đúng thời hạn, có bằng chứng chạy lại. Tài liệu và UI nói đúng mức đã hoàn thành.
