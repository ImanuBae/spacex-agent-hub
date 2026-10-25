# Admin Portal — FE-01/02/03

Next.js workspace `@spacex/admin-portal`, cổng local 3000. Yêu cầu Node 22+,
npm 10+ và Catalog/PostgreSQL cho màn hình khóa học. Chạy các lệnh dưới đây
từ **root monorepo**; `npm run dev` ở root khởi động tất cả service.

## Cài và chạy

```powershell
npm ci
# Chỉ copy khi chưa có file; không ghi đè cấu hình cá nhân.
Copy-Item apps/admin-portal/.env.example apps/admin-portal/.env.local
npm run dev --workspace=@spacex/admin-portal
```

Mở `http://localhost:3000/login`. Cấu hình trong `.env.local`:

```dotenv
NEXT_PUBLIC_ENABLE_MOCK=true
CATALOG_API_URL=http://127.0.0.1:4001
```

`CATALOG_API_URL` là biến server, chỉ chứa origin Catalog. Trình duyệt gọi
`/api/v1/*` cùng origin, Next rewrite sang Catalog; không cần CORS.
Không dùng `NEXT_PUBLIC_API_URL`. Restart Next sau khi đổi cấu hình.
Hướng dẫn DB, migration, seed và backend: [Catalog](../../services/catalog/README.md).

## Mock và giới hạn

Mock chỉ bật khi chạy `next dev` và `NEXT_PUBLIC_ENABLE_MOCK=true`. Đặt `false`
hoặc bỏ biến để tắt; login/dashboard hiển thị thông báo chưa bật demo.
Production luôn tắt mock, kể cả khi biến bằng true.

Đăng nhập demo bằng email hợp lệ bất kỳ và mật khẩu từ 6 ký tự. Không xác thực
tài khoản thật; đăng ký chỉ mô phỏng giao diện, không tạo tài khoản. Bộ chọn
role trên sidebar chỉ đổi menu, không cấp quyền backend. Student/AI Agent
không có menu Admin. Quyền/menu theo [L-01](../../docs/quy-uoc-phat-trien.md).

Khóa học dùng **Catalog API/PostgreSQL thật**. Tài chính, hộp thư, lead, tổ chức,
profile và audit vẫn là giao diện/mock localStorage. Đối soát, hoàn tiền,
giờ rảnh, danh sách lớp mới có khung trang. Chưa có IAM, JWT, Gateway hoặc
giới hạn dữ liệu theo chi nhánh; chỉ demo local. Đợt này hỗ trợ tạo/xem/sửa
khóa, không hỗ trợ xóa khóa hay giao diện gói học.

## Kiểm tra bàn giao

```powershell
npm run lint --workspace=@spacex/admin-portal
npm run typecheck --workspace=@spacex/admin-portal
npm test --workspace=@spacex/admin-portal
npm run build --workspace=@spacex/admin-portal
```

1. Chạy Catalog và Portal dev. Tạo khóa với code duy nhất, tên/mục tiêu,
   cấp độ, hình thức, giá VND nguyên không âm; khóa xuất hiện ngay trong danh sách.
2. Reload trang; restart Catalog rồi reload: khóa vẫn được đọc từ DB.
3. Gửi tên trống hoặc giá âm; form giữ mở và hiển thị lỗi validation kèm trường
   sai. Gửi code trùng để xem 409; tắt Catalog rồi reload để xem lỗi tải API.
4. Đổi đủ 7 role. Tuyển sinh có hộp thư, lead, xem khóa/lịch, không tài chính.
   Kế toán không chat. Các menu kế toán/giảng viên không dẫn tới 404.
5. Kiểm tra desktop và rộng 390px: mở/đóng sidebar, cuộn form và bảng. Tắt
   mock rồi restart Next để kiểm tra trang thông báo.

`build` kiểm tra bản production; dùng `dev` với mock để demo đến khi có IAM thật.
