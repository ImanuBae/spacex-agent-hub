# Đợt 1 — IAM, Org, Gateway và Portal đăng nhập thật

Cập nhật 27/10/2026. Phạm vi theo [phân công đợt 1](phan-cong-task-v2.md): IAM-1/2/4, GW-1, WEB-1, ORG-1/2 và bảo vệ Catalog. Tài liệu này là contract và hướng dẫn chạy hiện hành; các kết quả đợt Portal/Catalog 26/10 là lịch sử.

## Kiến trúc và cổng mặc định

Browser → Next Portal/BFF :3000 → Gateway :4000 → Identity :4002 / Org :4003 / Catalog :4001. Gateway và service đều xác minh JWT rồi kiểm phiên trực tiếp với IAM. IAM truy DB của mình; Org không đọc hoặc ghi DB IAM. Catalog là danh mục/giá chung nên quyền đọc không lọc theo chi nhánh; dữ liệu Org được lọc theo phạm vi, giảng viên chỉ thấy hồ sơ nhân sự của mình.

`packages/auth` chứa kiểm JWT, vai trò và branch; `packages/http` chứa correlation/envelope/xử lý lỗi dùng chung cho các service mới. Các service chỉ mở `/health` và `/ready` không cần token; `/health` kiểm process, `/ready` của IAM/Org kiểm bảng DB. Gateway không có DB. API dùng JSON, dữ liệu thành công trong `{ data }`; lỗi trong `{ error: { code, message, details? }, correlationId }`.

## Chuẩn bị cấu hình

Yêu cầu Node 22+, npm 10+, PostgreSQL. Trên PowerShell nếu npm.ps1 bị chặn, dùng `npm.cmd` thay `npm`. Không thay đổi ExecutionPolicy.

1. `npm ci`; chuẩn bị PostgreSQL theo README root. Init mới đã tạo `identity_access`, `org`, `catalog` và user riêng. Nếu volume có sẵn thiếu DB/user, bổ sung bằng tài khoản quản trị sau khi kiểm tra; không xóa volume hoặc chạy lại toàn bộ init gây trùng/mất dữ liệu.
2. Chỉ copy `.env.example` sang `.env` khi chưa tồn tại cho `services/identity`, `services/org`, `services/gateway`, `services/catalog`. Chỉnh DATABASE_URL theo DB/user/cổng thật; mẫu dùng cổng 5432, máy có thể dùng 5433. Không dùng một DB chung cho ba service.
3. Tạo `AUTH_SECRET` ngẫu nhiên ít nhất 32 byte. Đặt cùng secret, AUTH_ISSUER và AUTH_AUDIENCE trên bốn backend. Có thể tạo bằng `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`; không commit hoặc đưa vào frontend. HS256 là lựa chọn tối thiểu của đợt này; triển khai nhiều miền tin cậy cần đánh giá chuyển sang khóa bất đối xứng.
4. `IDENTITY_URL` ở Gateway/Org/Catalog trỏ IAM; `ORG_URL` ở IAM/Gateway trỏ Org; `CATALOG_URL` ở Gateway trỏ Catalog. `.env.example` đã có giá trị local.
5. IAM seed cần SEED_ADMIN_EMAIL và SEED_ADMIN_PASSWORD ít nhất 12 ký tự. Không có mật khẩu mặc định, không sinh user quản trị từ giao diện public. Seed lại giữ nguyên tài khoản/mật khẩu đã có.
6. Chỉ copy `apps/admin-portal/.env.example` sang `.env.local` khi chưa có; thêm GATEWAY_URL và PORTAL_ORIGIN nếu file cũ thiếu. PORTAL_ORIGIN phải khớp chính xác origin người dùng mở, ví dụ `http://localhost:3000` khác `http://127.0.0.1:3000`. Hai biến cũ CATALOG_API_URL/NEXT_PUBLIC_ENABLE_MOCK không còn điều khiển luồng đăng nhập hoặc API thật.

Nếu dùng biến môi trường của terminal thay file, giữ các biến đó cho tiến trình tương ứng; node ưu tiên biến môi trường đã có. Không dùng DATABASE_URL của service này để chạy migration service khác.

## Migration, seed và chạy

Chạy từ root sau khi đã cấu hình `.env` từng workspace:

```powershell
npm run build
npm run db:migrate --workspace=@spacex/identity
npm run db:seed --workspace=@spacex/identity
npm run db:migrate --workspace=@spacex/org
npm run db:seed --workspace=@spacex/org
npm run db:migrate --workspace=@spacex/catalog
npm run db:seed --workspace=@spacex/catalog
npm run dev
```

Migration/seed IAM và Org chạy lại an toàn; migration có journal và khóa transaction. Org seed một trung tâm + năm chi nhánh với ID ổn định; seed không ghi đè dữ liệu đã sửa. Không sửa migration sau khi đã triển khai vào DB dùng chung; tạo migration tiếp theo khi đổi schema.

`npm run dev` chạy Portal, IAM, Org, Gateway và Catalog; loại service-template để tránh trùng cổng 4000. Các backend chạy `dist/`, nên sửa TypeScript thì build lại workspace liên quan và khởi động lại nếu cần. Có thể chạy riêng bằng `npm start --workspace=@spacex/identity` và tương tự Org/Gateway/Catalog. Portal production dùng `npm start --workspace=@spacex/admin-portal` sau build, yêu cầu HTTPS để cookie Secure hoạt động trong trình duyệt.

Mở `/login` và dùng tài khoản seed. Giám đốc vào Tổ chức để cấp account → tạo employee gắn chi nhánh/phòng ban → gán role/phạm vi. Account không phải giám đốc chưa có branch không đăng nhập được. Không có tự đăng ký tài khoản quản trị. UI tự khóa thao tác sửa khóa học cho vai trò không phải giám đốc trung tâm; backend vẫn kiểm lại.

## Contract IAM và phiên

| Method | Path | Hành vi/quyền |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | `{email,password}`; thành công trả token + user cho client backend; sai/khóa/unassigned trả 401 |
| POST | `/api/v1/auth/refresh` | `{refreshToken}`; xoay token nguyên tử, token cũ dùng lại bị từ chối |
| POST | `/api/v1/auth/logout` | `{refreshToken}`; thu hồi toàn bộ family của phiên, kể cả dùng token cũ đã xoay; 204 idempotent |
| GET | `/api/v1/auth/me` | Bearer token hợp lệ + phiên còn sống; trả user, không có password hash |
| POST | `/api/v1/auth/introspect` | Service kiểm JWT và phiên hiện tại; không public anonymous |
| GET / POST | `/api/v1/accounts` | Giám đốc trung tâm xem tối đa 100 account/cấp account; tạo với email/name/password/role tùy chọn, branchIds ban đầu rỗng |
| GET | `/api/v1/accounts/:id` | Giám đốc trung tâm kiểm tra account cụ thể |
| PUT | `/api/v1/accounts/:id/access` | Giám đốc trung tâm; `{role,branchIds}` và header idempotency-key UUID; kiểm branch qua Org, đổi quyền và thu hồi mọi phiên |
| PUT | `/api/v1/accounts/:id/status` | Giám đốc trung tâm; `{active}`; khóa/mở và thu hồi phiên, không tự khóa mình |

JWT có sub, role, branchIds, sid, iat, exp, issuer/audience; chỉ HS256 đã cấu hình được chấp nhận. Access token 5 phút; phiên refresh tối đa 8 giờ từ lần login, refresh không kéo dài vô hạn. DB chỉ giữ hash refresh token; mật khẩu dùng scrypt có salt ngẫu nhiên. Năm lần đăng nhập sai khóa tạm 15 phút; thông báo không phân biệt email không có với mật khẩu sai.

Đổi role/phạm vi, khóa account hoặc logout được chặn ở lần xác thực kế tiếp, không đợi access token hết hạn. Request đã được cấp quyền trước thay đổi có thể đang thực thi; không hứa rollback request đang chạy. Service không cache introspection; IAM mất kết nối thì từ chối bằng 503. Client không được tự gửi role/branch header để thay quyền.

Portal chỉ dùng `/api/session/login`, `/api/session/me`, `/api/session/logout`; BFF trả user, không trả token cho JavaScript. Cookie HttpOnly, SameSite=Strict, Secure ở production. Các thao tác ghi kiểm Origin chính xác, kể cả login/logout. `/api/v1/*` là BFF proxy có whitelist đến Gateway, không còn rewrite thẳng Catalog. Token không lưu localStorage; localStorage cũ không cấp quyền.

BFF tự refresh khi access hết hạn; gom refresh đồng thời trong một tiến trình để không xoay token hai lần. Đợt này hỗ trợ một instance Portal; nhiều instance cần cơ chế phối hợp refresh dùng chung trước khi scale. UI kiểm phiên khi focus/định kỳ 30 giây; API luôn kiểm ngay mỗi request. 401 dẫn về login, 403 hiển thị thiếu quyền, lỗi IAM/kết nối hiển thị thử lại.

## Contract Org và quyền

| Method | Path | Hành vi/quyền |
| --- | --- | --- |
| GET | `/api/v1/branches`, `/api/v1/branches/:id` | Nhân viên đọc trong branch; giám đốc trung tâm đọc tất cả |
| POST / PUT | `/api/v1/branches`, `/api/v1/branches/:id` | Giám đốc trung tâm; code/name/kind/active; không xóa vật lý |
| GET | `/api/v1/departments` | Lọc branch |
| POST / PUT | `/api/v1/departments`, `/api/v1/departments/:id` | Giám đốc trung tâm hoặc giám đốc chi nhánh trong phạm vi; branchId/name/description/active |
| GET | `/api/v1/employees` | Giám đốc trung tâm: tất cả; giám đốc branch: phạm vi; teacher: hồ sơ của mình; vai trò khác bị chặn |
| POST | `/api/v1/employees` | Giám đốc trung tâm; accountId/branchId/departmentId/name/title/teacherProfile/active; account phải có trong IAM |
| PUT | `/api/v1/employees/:id` | Giám đốc trung tâm/branch trong phạm vi; sửa hồ sơ, không đổi accountId/branch chính bằng PUT |
| PUT | `/api/v1/employees/:id/access` | Giám đốc trung tâm; `{role,branchIds}`, idempotency-key UUID; IAM là nơi ghi quyền |
| GET | `/api/v1/access-sync` | Giám đốc trung tâm xem tối đa 100 yêu cầu applied/pending/rejected, dữ liệu để retry |

Department phải cùng branch với employee bằng ràng buộc DB; accountId không bị gán hai employee. Không có FK xuyên DB; Org xác minh account qua IAM. Ngừng hoạt động hồ sơ Org không tự khóa account IAM; thao tác khóa account riêng có nhãn trong UI.

Gán quyền lưu access_sync pending trước khi gọi IAM với cùng operationId. IAM áp dụng và ghi access_changes trong một transaction; retry cùng key/payload không thu hồi phiên lại. IAM không phản hồi/5xx thì Org trả 202/pending; UI không báo đã cấp quyền, có nút thử lại giữ key kể cả sau reload. Từ chối 4xx được đánh dấu rejected để có thể gửi yêu cầu mới. Chỉ người tạo yêu cầu với quyền giám đốc còn hợp lệ được retry cùng key; chuyển người xử lý là giới hạn hiện tại cần workflow riêng. Không lưu Bearer token vào DB/job hoặc tự động gọi lại bằng quyền đã hết hạn.

Audit IAM/Org cho login, đổi account, dữ liệu tổ chức và gán quyền nằm trong DB của service; thao tác ghi dữ liệu chính và audit cùng transaction. Chưa phải Reporting & Audit đầy đủ của M1; không có API sửa audit. Không ghi credential/token/body vào logger.

## Kiểm tra và CI

```powershell
npm run check
$env:STAGE1_TEST_DATABASE_URL = 'postgresql://postgres:TEST_PASSWORD@127.0.0.1:TEST_PORT/postgres'
$env:STAGE1_PORTAL_TEST = '1'
npm run test:db --workspace=@spacex/identity
```

Chỉ dùng server PostgreSQL test riêng với quyền CREATE DATABASE. Suite tạo ba DB tên ngẫu nhiên riêng cho IAM/Org/Catalog, chạy migration/seed hai lần, khởi động HTTP server cổng ngẫu nhiên và tự xóa đúng DB do nó tạo. Không dùng DB thật/production. Test:db thiếu biến URL thoát lỗi; npm test mặc định có thể skip DB, không dùng skip để nghiệm thu.

STAGE1_PORTAL_TEST=1 cần build Portal trước và chạy Portal production thật trên cổng ngẫu nhiên, kiểm login/cookie/refresh/logout/CSRF/403 qua BFF. Để kiểm thêm giao diện, đặt STAGE1_BROWSER_PATH trỏ Chrome/Edge có sẵn, ví dụ `C:/Program Files/Google/Chrome/Application/chrome.exe`; suite dùng playwright-core chạy headless, không tải browser. Nó kiểm form cấp tài khoản → tạo nhân sự → gán quyền → login nhân viên → menu/403/thu hồi phiên, desktop 1440px và mobile 390px; ảnh mobile lưu `.local/stage1-mobile.png` (không commit). Nếu không đặt đường dẫn, test chỉ kiểm BFF/HTTP, không kiểm trực quan. CI có job stage1 cấp PostgreSQL và chạy suite gồm BFF; kết quả remote chỉ xác nhận khi workflow thật đã chạy.

## Phạm vi còn lại

Đây là implementation đợt 1, chưa hoàn tất M0/M1 toàn bộ: chưa có outbox/idempotency broker, metric/trace đầy đủ, deploy độc lập, chat/lead/lớp/thanh toán thật. Những trang ngoài Catalog/Tổ chức vẫn là mock/khung và được gắn thông báo. Student/AI service account không đăng nhập Admin Portal. UI Org mới phục vụ các thao tác đợt 1; API quản lý có thể dùng trực tiếp với quyền hợp lệ. Customer vẫn cần duyệt C01–C12; code không thay thế quyết định nghiệp vụ hoặc ký nghiệm thu của customer.
