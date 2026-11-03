# Admin Portal — đợt 1

Next.js workspace `@spacex/admin-portal`, cổng local 3000. Portal dùng IAM,
Org, Gateway và Catalog thật. Cấu hình, migration/seed và contract:
[hướng dẫn đợt 1](../../docs/huong-dan-dot-1.md).

Từ root, sau khi các backend đã được cấu hình/chạy:

```powershell
# Chỉ copy nếu chưa tồn tại; cập nhật biến thiếu trong file cũ, không ghi đè.
Copy-Item apps/admin-portal/.env.example apps/admin-portal/.env.local
npm run dev --workspace=@spacex/admin-portal
```

`.env.local` cần GATEWAY_URL=http://127.0.0.1:4000 và
PORTAL_ORIGIN=http://localhost:3000. Mở đúng origin này tại `/login`, dùng
account seed của IAM; không có đăng ký public hoặc bộ chọn role giả.
NEXT_PUBLIC_ENABLE_MOCK và CATALOG_API_URL cũ không bật/tắt phiên đăng nhập thật.

Phiên nằm trong cookie HttpOnly/SameSite Strict, Secure trong production.
Frontend gọi `/api/session/*` và `/api/v1/*` cùng origin; route handler server
nối Gateway, tự refresh và không trả token cho JavaScript. LocalStorage không
cấp quyền. Login sai/khóa tài khoản hiển thị lỗi; hết phiên trở về login;
403 báo thiếu quyền; mất kết nối có thao tác thử lại. Production cần HTTPS.

Sidebar và quyền vào trang lấy role từ IAM. Catalog có tạo/xem/sửa khóa,
chỉ giám đốc trung tâm có nút sửa được bật; backend kiểm lại quyền. Trang
Tổ chức cho giám đốc trung tâm quản lý chi nhánh, phòng ban, cấp account,
hồ sơ nhân sự/giảng viên và gán quyền qua Org → IAM; yêu cầu pending có thể retry.
Các trang chat/lead/tài chính/audit/lịch khác vẫn là mock/khung được gắn thông báo.
Giao diện gói học, Student Portal và luồng nghiệp vụ M1 chưa thuộc đợt này.

```powershell
npm run lint --workspace=@spacex/admin-portal
npm run typecheck --workspace=@spacex/admin-portal
npm test --workspace=@spacex/admin-portal
npm run build --workspace=@spacex/admin-portal
```

Kiểm phiên/cookie/CSRF, Gateway và dữ liệu PostgreSQL bằng suite `test:db`
của Identity có STAGE1_PORTAL_TEST=1 theo hướng dẫn đợt 1. Suite chạy Next
production thật; thêm STAGE1_BROWSER_PATH để kiểm cả giao diện với Chrome/Edge
có sẵn theo hướng dẫn. Khi không đặt đường dẫn browser, suite chỉ kiểm HTTP/BFF.
