# Bàn giao đợt 1 — 27/10/2026

Phạm vi: toàn bộ phần kỹ thuật của Lead, Dev 1 và Dev 2 tại đợt 1 trong
[phân công task v2](phan-cong-task-v2.md). Hướng dẫn chạy và contract hiện hành:
[huong-dan-dot-1.md](huong-dan-dot-1.md).

## Kết quả triển khai

| Phần | Kết quả |
| --- | --- |
| IAM-1 | Service Identity/PostgreSQL, migration/seed admin, mật khẩu scrypt có salt, login và JWT role/branch/sid/issuer/audience/expiry |
| IAM-2 | packages/auth kiểm JWT + phiên IAM, role và branch; Gateway/Org/Catalog không tin role/header từ client; Catalog chỉ center_director được sửa |
| IAM-4 | Refresh xoay nguyên tử, hạn phiên tuyệt đối 8 giờ, logout theo family; khóa/đổi quyền thu hồi mọi phiên account; login sai có khóa tạm |
| GW-1 | Service Gateway whitelist route IAM/Org/Catalog, xác thực trước proxy, giữ correlation, lỗi upstream có envelope |
| WEB-1 | Login thật, cookie HttpOnly/SameSite Strict/Secure production qua Next BFF, refresh/logout, menu theo quyền, guard trang, 401/403/lỗi kết nối |
| ORG-1 | Branch/center/department có API đọc/tạo/sửa/trạng thái và seed sáu đơn vị; lọc branch và kiểm quyền từng service |
| ORG-2 | Employee/teacher profile gắn account/branch/department; IAM là chủ quyền; access_sync pending/applied/rejected và retry idempotent |
| Tích hợp | Portal → BFF → Gateway → service, thêm kiểm quyền khi gọi trực tiếp; UI Tổ chức cấp account/tạo nhân sự/gán quyền; Catalog có trạng thái chỉ đọc |

Account/phòng ban/nhân sự dùng soft status, không có xóa vật lý qua API.
Snapshot dữ liệu giả trước đây không được tự import vào hệ thống thật.
Không sửa file .env cá nhân hoặc dùng DB hiện có để nghiệm thu.

## Kiểm chứng local

- `npm run check`: 48/48 task lint/typecheck/test/build cho 12 workspace.
- Portal: 15 test lib, gồm menu, API envelope, CSRF/origin và cookie/session BFF.
- `npm run test:db --workspace=@spacex/identity` với STAGE1_PORTAL_TEST=1:
  13/13 test tích hợp PostgreSQL, không skip; lượt kiểm giao diện có thêm
  STAGE1_BROWSER_PATH trỏ Chrome có sẵn.
- Suite IAM tạo ba DB ngẫu nhiên riêng, chạy migration/seed IAM/Org hai lần;
  vẫn đúng một admin và sáu đơn vị. Kiểm login đúng/sai, JWT hết hạn/sai quyền,
  cross-branch, teacher chỉ xem hồ sơ mình, đổi role, khóa account, logout,
  refresh đồng thời, IAM mất kết nối và retry access_sync sau phục hồi.
- Portal production thật chạy trên cổng ngẫu nhiên: login không trả token vào
  JSON, cookie HttpOnly/Secure/SameSite Strict, Origin lạ bị chặn, tự refresh,
  Catalog write sai role trả 403, logout làm phiên không còn truy cập được.
- Chrome desktop 1440×900: cấp account → tạo employee → gán admissions/chi nhánh
  → logout/login nhân viên → menu đúng → Catalog không sửa được → trang Tổ chức
  bị chặn → khóa account làm browser quay về login. Không có pageerror.
- Chrome mobile 390×844: mở/đóng sidebar, vào Catalog và ảnh local tại
  `.local/stage1-mobile.png`; bảng cuộn trong khung.
- Regression Catalog với PostgreSQL riêng: migrate/seed và 26/26 test qua,
  không skip. Các test CRUD cũ nay gửi JWT; suite tích hợp riêng dùng IAM thật.

PostgreSQL kiểm thử nằm trong container riêng
`spacex-stage1-verify-20261027`, cổng host 55440; không phải DB cấu hình của project.
Các DB ngẫu nhiên do suite tự dọn, các HTTP server/Portal/Chrome test được đóng.
Container test và volume riêng đã được dọn sau lượt kiểm cuối; không giữ stack
demo đang chạy hoặc sửa cấu hình cá nhân để tự khởi động lại.
Không dùng kết quả check có DB/broker skip để thay cho suite DB chạy riêng.

## Điều kiện và giới hạn bàn giao

- Có implementation/workflow CI nhưng chưa push, mở PR hoặc xác nhận GitHub
  Actions trên remote trong phiên này. Chưa deploy production.
- Cần điền .env, AUTH_SECRET và credential seed của môi trường thật theo hướng
  dẫn trước khi chạy; tài khoản/mật khẩu test không dùng cho vận hành.
- C01–C12 cần customer xác nhận; đây là đầu việc phối hợp PM/customer, chưa thể
  đánh dấu đã được customer duyệt từ việc code hoặc test local thành công.
- Phiên được thu hồi ở request xác thực kế tiếp; request đã được chấp nhận
  trước đó có thể đang chạy. UI tự kiểm lại theo focus/30 giây và khi API 401.
- BFF refresh đồng thời hỗ trợ một instance Portal. Pending access retry cần
  cùng người tạo còn quyền; chuyển owner xử lý cần workflow bổ sung.
- Chưa hoàn tất M0/M1 đầy đủ: PL-2/PL-3/deploy, chat/lead/lớp/tiền thật và
  Reporting/Audit tập trung vẫn theo các đợt sau. Audit IAM/Org local không
  thay cho RP-1. Các trang nghiệp vụ ngoài Catalog/Tổ chức vẫn mock/khung có nhãn.

Việc tiếp theo theo plan: chốt các quyết định customer ảnh hưởng mở bán;
Lead hoàn thiện PL-2/PL-3 và CS-4, Dev 1 làm WEB-4/WEB-6, Dev 2 bổ sung
Catalog policy và Class theo đợt 2. Không tiếp tục coi IAM/Gateway là phần chưa có.
