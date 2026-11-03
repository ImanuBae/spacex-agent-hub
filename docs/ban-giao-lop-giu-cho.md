# Bàn giao lớp học và giữ chỗ kỹ thuật

Ngày 02/11/2026. Đối chiếu [yêu cầu](demo-lop-giu-cho.md).
Đây là triển khai demo Class đồng bộ; chưa đóng CAT-1, WEB-4, CS-4, PL-2 hay toàn bộ M1.

## Phần đã triển khai

- Contract Zod trong `packages/contracts/src/classes.ts`: lớp, lịch, phòng, bộ lọc,
  pagination, optimistic version, hold và fixture. Không nhận actor/TTL/giá/số chỗ từ browser.
- Class có DB/user riêng; migration idempotent; `/health`, `/ready`; audit cùng
  transaction, DB trigger chặn sửa/xóa audit. Không truy cập DB của Org/Catalog.
- Lớp DRAFT → PLANNED → OPEN; các chuyển trạng thái khác bị từ chối. Kiểm tra
  khóa/gói, hình thức/chi nhánh bán, Org/giảng viên và phòng qua API/dữ liệu service sở hữu.
- Kiểm số buổi theo gói, giảng viên, phòng hoặc HTTPS online, cutoff/hạn quyết định
  trước buổi đầu. Không cho sửa quan hệ khóa/gói/chi nhánh sau tạo; cần tạo lớp mới.
- PostgreSQL exclusion constraints chặn trùng buổi, giảng viên, phòng khi ghi đồng
  thời, kể cả DRAFT. Khoảng `[startsAt, endsAt)` cho phép hai buổi kề nhau.
- Tính `available = capacity - committed - held chưa hết hạn` trong snapshot đọc
  PostgreSQL, cùng thời gian đọc của transaction. Không có API sửa bộ đếm.
- Hold PostgreSQL, khóa lớp trước mọi thay đổi chỗ; unique index học viên/lớp và
  enrollment còn hiệu lực. Không giảm capacity dưới chỗ committed + hold chưa hết hạn.
- Idempotency namespace `(actorId, operationKey)` cho tạo hold. Key UUID, cùng key
  và payload trả cùng hold/trạng thái hiện tại; khác payload trả 409. Chỉ actor tạo
  được đọc/hủy, vẫn kiểm scope hiện tại; GET theo operation phục hồi được khi timeout.
- Hủy/expire/commit idempotent, cùng thứ tự khóa lớp → hold. Commit kiểm lại hạn tại
  câu UPDATE; không hồi sinh hold. Worker quét startup và mỗi 5 giây. Hold hết hạn
  ngừng chiếm chỗ ngay cả khi worker chưa chạy.
- Giới hạn 5 hold đang hiệu lực và 30 hold mới/phút/actor, lưu bằng DB nên không mất
  giới hạn khi service restart. Fixture có ID cố định do backend seed, không nhập ID tùy ý.
- Catalog dùng lại API gói; lọc khóa/gói theo dữ liệu thật; policyVersion/effectiveAt
  tự tăng khi thay đổi. `offer_history` lưu snapshot cùng transaction qua trigger và
  không cho sửa/xóa. Quote VND lấy từ Catalog, không lấy giá do client gửi vào hold.
- Portal dùng cookie HttpOnly hiện có, Gateway + BFF whitelist Class/room/hold/teacher.
  Endpoint commit chỉ có ở đường nội bộ, không có ở Gateway/BFF hay nút thanh toán.
- UI gói học chọn khóa từ API; tạo/sửa lớp và buổi; tạo phòng; tra cứu theo bộ lọc,
  số chỗ thật; fixture hold, reload, countdown theo server, hủy có xác nhận tên lớp.
  Cùng ý định giữ key trong sessionStorage (không chứa token); mạng lỗi giữ nguyên key.
  Ý định mới chỉ lấy key mới khi đổi payload hoặc đã xác minh hold cũ kết thúc.
- 401 dùng sự kiện về đăng nhập hiện có, 403 báo thiếu quyền; lỗi service không trả
  danh sách rỗng hay tự tuyên bố giữ chỗ thành công. Countdown về 0/tab hiện lại gọi API.

## Ma trận quyền đã chốt cho demo

| Thao tác | Trung tâm | Giám đốc chi nhánh | Tuyển sinh | Giảng viên |
| --- | --- | --- | --- | --- |
| Đọc khóa/gói | Có | Có | Có | Có |
| Sửa khóa/gói | Có | Không | Không | Không |
| Đọc lớp/lịch | Toàn hệ thống | Scope IAM | Scope IAM | Chỉ lớp được phân công trong scope |
| Tạo/sửa lớp, phòng; PLANNED | Có | Scope IAM | Không | Không |
| Duyệt OPEN | **Không** | Scope IAM | Không | Không |
| Tạo fixture hold | Demo | Demo trong scope | Demo trong scope | Không |
| Đọc/hủy hold | Chỉ hold của mình trong scope | Như bên trái | Như bên trái | Không |

Student/accountant/ai_agent không truy cập API Class. Role/branch lấy từ JWT và
IAM introspection; gọi thẳng service vẫn áp dụng cùng kiểm tra. Trung tâm không
được suy diễn có quyền OPEN. `GET /teachers` chỉ cung cấp dữ liệu chọn giảng viên,
không mở quyền đọc đầy đủ hồ sơ nhân sự cho tuyển sinh.

Enrollment backend gọi `/internal/holds/:id/commit` với credential riêng
`ENROLLMENT_SERVICE_SECRET` tối thiểu 32 byte, fail-closed khi chưa cấu hình.
Không dùng token Portal thay cho credential backend. Adapter điều phối nghiệp vụ
Enrollment/CRM thật chưa có, nên ngoài demo tạo hold bị khóa ở backend.

## Contract HTTP

Base public `/api/v1`, dữ liệu trong `{ data }`; danh sách lớp có
`pagination: {page,pageSize,total}`. GET không cache. Correlation ID được chuyển
qua BFF → Gateway → Class → Org/Catalog, response/log theo quy ước hiện tại.

| Route | Phương thức / nội dung |
| --- | --- |
| `/classes` | GET bộ lọc; POST `ClassInput`, luôn tạo DRAFT |
| `/classes/:id` | GET chi tiết; PUT `{version,input}` thay thông tin/lịch nguyên tử |
| `/classes/:id/status` | POST `{version,status: PLANNED hoặc OPEN}` |
| `/rooms` | GET phòng trong scope; POST phòng theo `RoomInput` |
| `/teachers` | GET giảng viên hoạt động từ Org, theo scope |
| `/hold-fixtures` | GET `{enabled,ttlSeconds,fixtures}`; không có fixture khi demo tắt |
| `/holds` | POST `HoldInput` + `Idempotency-Key`; GET hold của mình, tùy chọn `operationKey` |
| `/holds/:id` | GET trạng thái và serverTime |
| `/holds/:id/cancel` | POST hủy idempotent |
| `/packages/:id/history`, `/courses/:id/history` | GET phiên bản/snapshot policy |
| `/packages/:id/quote` | GET snapshot giá VND và version khóa/gói khi cả hai đang bán |

ClassQuery: `courseId,packageId,branchId,mode,status,from,to,sellable,sort,page,pageSize`.
`sort=code|registrationClosesAt`, `pageSize=1..100`. Khung thời gian chọn lớp có ít
nhất một buổi nằm trọn trong khoảng UTC; cùng một buổi phải thỏa cả hai đầu mút.
`sellable=true` chỉ trả OPEN còn hạn/còn chỗ và khớp offer đang bán của Catalog,
bao gồm branch/mode. Metadata và tổng được lọc trước pagination. Upstream lỗi trả lỗi.
Kiểm tra offer/ghế được lặp lại khi ghi hold, không coi kết quả tra cứu là bảo đảm chỗ.

Lỗi phân biệt: 400 `VALIDATION_ERROR`; 401 `UNAUTHORIZED`; 403 `FORBIDDEN`,
`FIXTURE_REQUIRED`, `DEMO_DISABLED`; 404 `NOT_FOUND`; 409 `SOLD_OUT`,
`DUPLICATE_LEARNER`, `IDEMPOTENCY_CONFLICT`, `NOT_OPEN`, `REGISTRATION_CLOSED`,
`NOT_SELLABLE`, `PACKAGE_MISMATCH`, `SCHEDULE_CONFLICT`, `CAPACITY_CONFLICT`,
`OPEN_CONDITIONS`, `STALE_VERSION`, `HOLD_EXPIRED`, `ALREADY_COMMITTED`;
429 `HOLD_LIMIT/HOLD_RATE_LIMIT`; 502/503 upstream/identity unavailable.
Lỗi validation có `details[{path,message}]`, form hiển thị gần trường và tại vùng lỗi.

## Chạy demo riêng, không ghi đè cấu hình cá nhân

Node >=22, npm, Docker hoặc PostgreSQL 17, Chrome/Edge cho kiểm trình duyệt.
Kiểm các cổng 3000,4000–4004,55432 trước khi chạy. Không dùng PostgreSQL 5432 hay
Redis 6379 của dự án khác. Luồng đồng bộ này không cần Redis/RabbitMQ.

```powershell
# Chỉ tạo lần đầu; nếu đã có container cùng tên thì docker start container đó.
docker run --name space-agent-demo-postgres -e POSTGRES_PASSWORD=space_agent_local_dev -p 55432:5432 -d postgres:17
npm ci
npm run build
npm run demo:class -- --production
```

Runner kiểm cổng trống, tạo DB/user riêng `identity_access`, `org`, `catalog`,
`class_schedule` trên server demo; migrate và seed idempotent; chạy 5 service + Portal.
Mở **http://localhost:3000**. Runner dùng biến môi trường riêng, không ghi `.env`.
Để dùng PostgreSQL demo khác, đặt `DEMO_DATABASE_URL` trỏ đúng server biệt lập có
quyền tạo DB/user. Runner dùng mật khẩu service `_dev` cho môi trường local này.

Mật khẩu tài khoản demo ở `.local/class-demo.json` (gitignored); không đưa vào
commit/log/video. Bộ tài khoản local đã thay ngày 02/11/2026; email theo role nằm
trong `accounts` của file này. Các tài khoản dùng chung mật khẩu đó:

- `admin@spacex.test`: giám đốc trung tâm, tạo khóa/gói/lớp và quản lý tổ chức.
- `manager@spacex.test`: giám đốc chi nhánh Quận 1, duyệt OPEN.
- `admissions@spacex.test`: tuyển sinh, tra cứu và giữ/hủy fixture.
- `accountant@spacex.test`: kế toán, quyền tài chính theo role hiện tại.
- `teacher@spacex.test`: giảng viên, xem đúng lớp được phân công.

Hai email quản lý cũ `director@class-demo.test` và `director@demo.spacex.test`
không còn đăng nhập được. Thay email/mật khẩu và thu hồi phiên cũ, giữ ID để
bảo toàn liên kết nhân sự/lớp học và lịch sử. Học viên và AI Agent chưa có luồng
đăng nhập nên không tạo tài khoản giả cho hai role này.

Runner và script kiểm tra lấy email từ cấu hình local; fallback email cũ chỉ
phục vụ checkout chưa có cấu hình mới. Đã kiểm cả năm tài khoản qua Gateway,
Portal BFF, cookie phiên và quyền quản lý tài khoản/tra lớp. Kết quả local:
`.local/demo-account-verification.json`.

Seed nhận diện bằng tiền tố `DEMO`: khóa/gói một buổi, 6 fixture, phòng Quận 1,
OPEN một chỗ, PLANNED, OPEN hết chỗ (committed fixture kỹ thuật; không thanh toán).
Không ghi đè dữ liệu đã có khi chạy lại. Không tự đổi hạn/lịch cũ: khi demo seed
quá hạn, tạo lớp mới bằng UI. Lịch xung đột là yêu cầu bị DB từ chối trong suite,
không lưu lịch sai như dữ liệu hợp lệ.

Mặc định hold 1200 giây (C03 chưa được customer duyệt). Demo nhanh:

```powershell
$env:CLASS_DEMO_HOLD_TTL_SECONDS='30'
npm run demo:class -- --production
```

UI hiển thị TTL thực từ backend. Ngoài `APP_ENV=demo` + `CLASS_DEMO_ENABLED=true`,
TTL luôn 1200 giây và tạo fixture hold bị tắt. Với vận hành thủ công, sao chép cấu
hình từ `.env.example` vào nơi riêng và chạy `db:migrate`, `db:seed`, `start` cho
từng service. Class cần `AUTH_SECRET`, `IDENTITY_URL`, `ORG_URL`, `CATALOG_URL`;
Gateway cần `CLASS_URL`. Worker nằm trong Class, không cần tiến trình riêng.

Ctrl+C ở runner dừng các service con. Restart cùng lệnh giữ nguyên DB/hold, worker
startup xử lý hold quá hạn. Không xóa volume/database để reset demo.

## Kiểm chứng và bằng chứng local

```powershell
npm run check
$env:CLASS_TEST_DATABASE_URL='postgresql://postgres:space_agent_local_dev@127.0.0.1:55432/postgres'
npm run test:class:db
node scripts/test-class-browser.mjs
node scripts/inspect-class.mjs http://localhost:3000/dashboard/schedule --app --out .local/taste/final-schedule
# Cho màn hình Catalog, dùng tài khoản trung tâm:
$env:DEMO_INSPECT_EMAIL='director@class-demo.test'
node scripts/inspect-class.mjs http://localhost:3000/dashboard/courses --app --out .local/taste/final-catalog
```

Browser scripts dùng `TASTE_SKILL_ROOT` hoặc skill cài tại home `.agents/skills/`.
Đăng nhập qua BFF thật, cookies chỉ ở bộ nhớ browser. Script browser tạo dữ liệu
`DEMO-BROWSER-*`, `DEMO-PACK-*`, `DEMO-CLASS-*` mới để kiểm chứng; không xóa dữ liệu
của người dùng. Video dùng screencast Chrome + ffmpeg, ghép frame 5fps (tua nhanh,
không phải phép đo thời gian thực). Mọi bằng chứng ở `.local/`, không chứa token.

Kết quả local đã chạy:

| Kiểm tra | Kết quả / file |
| --- | --- |
| Lint/typecheck/unit/build toàn workspace | 52 tác vụ qua; `.local/class-workspace-check.log` |
| Class PostgreSQL | 11 test qua, không skip; `.local/class-db-check.log` |
| Catalog PostgreSQL regression | 26 test qua; `.local/class-catalog-regression.log` |
| IAM/Org/Gateway/BFF regression | 13 test qua, có Portal thật; `.local/class-iam-regression.log` |
| Browser production | Form tạo khóa/gói/lớp, OPEN, reload, hold/hủy/giữ lại, race qua BFF, timeout/retry cùng key, hết phiên về login, bàn phím và overflow 3 kích thước; `.local/class-browser-check.log` |
| Class service tắt thật | Dừng process Class, Portal báo Gateway 502/service unavailable và chưa xác minh danh sách, không giả danh sách rỗng; `.local/class-outage-check.log`, `.local/class-browser/service-unavailable.jpg`; đã khởi động lại demo sau kiểm tra |
| Inspector production | Schedule và Catalog: 0 FAIL, 0 WARN ở 1440/768/390; `.local/taste/final-schedule/report.json`, `.local/taste/final-catalog/report.json` |
| Lint thiết kế | 0 FAIL; 1 WARN `padStart` cho countdown phút:giây, hợp lệ; `.local/class-design-lint.log` |
| Ảnh trước | `.local/taste/before/`, có ảnh 1440/768/390 |
| Ảnh sau và video luồng | `.local/class-browser/schedule-1440.jpg`, `schedule-768.jpg`, `schedule-390.jpg`, `hold-reload.jpg`, `demo.mp4` |

Suite Class có yêu cầu đồng thời thật, cùng learner khác key, cùng key khác payload,
cutoff/trạng thái/quyền/scope, audit bất biến, conflict lịch, capacity/version,
idempotent cancel/commit, expire–commit race. Test restart chạy **process Node thật**,
dừng rồi chạy lại với cùng DB, kiểm worker startup cập nhật hold quá hạn.
Tranh chỗ cuối và chống giữ trùng learner được kiểm cả giữa hai actor khác nhau,
để không chỉ dựa vào khóa giới hạn thao tác của cùng một actor.
Các test DB Catalog/IAM cũ trong `npm run check` mặc định có thể skip khi thiếu URL;
kết quả nghiệm thu ở bảng là từ các lần chạy DB riêng không skip.

CI thêm job `classes` với PostgreSQL 17 và `npm run test:class:db`, URL bắt buộc;
thiếu URL làm suite lỗi. **Chưa chạy CI remote** và chưa có kết quả merge/PR.

## Thiết kế và giới hạn còn lại

Dùng `design-taste-frontend` nhánh app, kind `smb-admin`, style **Achromatic ledger**,
seed **20261102**, giữ palette/type (Arial và nhận diện Portal). Chọn danh sách
và số ghế căn phải thay KPI; sắc xanh chỉ trên chỗ còn, primary gần đen; bộ lọc gập
để mobile ưu tiên lớp. Không thêm UI library/framework. Chữ số tabular, control 44px,
dialog native hỗ trợ bàn phím và trả focus. Warning `padStart` là countdown phút:giây.

Câu hỏi màn hình: Catalog “khóa có gói nào/giá bao nhiêu”; schedule “lớp nào đủ
điều kiện và còn chỗ”; hold “còn hiệu lực tới khi nào”. Dữ liệu thật lấy từ PostgreSQL
qua API; mọi dữ liệu thử ở runbook có nhãn DEMO. Shell sidebar tối hiện có được giữ
để không thiết kế lại toàn Portal; đây là ngoại lệ so với sidebar sáng của skill.

Đã xem ảnh cuối của cả hai màn hình ở 1440/768/390 và các ảnh page-01 do inspector
liệt kê, cùng ảnh dialog 390px. Ba vấn đề đã sửa: chữ header thiếu tương phản do
shell cũ, bộ lọc đẩy danh sách xuống quá sâu trên mobile, thao tác/số chỗ khuất ở
cột cuối. Mobile/tablet hiện mở chi tiết bằng tên lớp và thấy chỗ còn ngay dưới tên.

Đối chiếu bảy điểm critique của app skill: (1) danh sách lớp/gói trả lời câu hỏi
chính trước; (2) panel theo cùng hai lề, không có ô KPI thừa; (3) màu trên chỗ còn
và trạng thái, shell cũ là ngoại lệ đã nêu; (4) chỗ lặp trên mobile dùng cùng biến
`available/capacity`, tổng khóa/gói lấy từ dữ liệu tải đủ trang; (5) 0 hiển thị 0,
thiếu dữ liệu là dấu gạch; (6) không có biểu đồ/legend giả; (7) menu mobile gập,
bảng cuộn trong khung, form xếp dọc. Các ảnh là snapshot tại thời điểm đọc; số dòng
có thể tăng giữa các ảnh vì suite browser tạo thêm dữ liệu DEMO có nhãn.

- C02/C03 chưa duyệt. Lớp `minimumSize>0` bị chặn OPEN với lý do rõ ràng; chưa giả
  chính sách ngoại lệ hay luồng hủy lớp CS-7. Chỉ hỗ trợ ba trạng thái đã công bố.
- Enrollment/CRM/Payment/AI/chat/QR/Student Portal chưa được triển khai ở đợt này.
  Không có hồ sơ học viên nghiệp vụ hay thanh toán từ fixture.
- Không phát event phụ thuộc nghiệp vụ; chưa có transactional outbox/inbox,
  dedup/retry/DLQ/recovery broker. **PL-2 còn mở**, các test ở đây nghiệm thu luồng đồng bộ.
- PL-3 hiện có correlation HTTP, log lỗi worker/DB và số hold expire mỗi lần quét.
  Chưa có dashboard metric, distributed tracing hay alert vận hành.
- Policy phiên bản có hiệu lực ngay theo DB; chưa có UI lập lịch policy tương lai,
  chính sách ưu đãi/phê duyệt tài chính hoặc khóa giá nghiệp vụ Enrollment.
- Kiểm tra Org/Catalog là API đồng bộ, không có distributed transaction với Class.
  Có cửa sổ thay đổi offer ngay sau kiểm tra; không tuyên bố bảo đảm snapshot
  xuyên service. Enrollment về sau cần quote/version và quy ước chốt giá riêng.
- Credential commit nội bộ là cơ chế service secret cho demo tích hợp; vận hành
  thật cần vòng đời service identity/rotation theo thiết kế nền tảng.
- Nhánh/commit hiện có nhiều thay đổi từ trước; lượt này không tự commit, reset,
  deploy hoặc đóng ticket thay nhóm. Bằng chứng local không thay thế CI remote.
