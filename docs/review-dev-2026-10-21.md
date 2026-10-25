# Review hai dev — 21/10/2026

Đối chiếu `docs/phan-cong-den-2026-10-20.md` và hợp đồng L-01 trong
`docs/quy-uoc-phat-trien.md`. Đây là nghiệm thu phạm vi đợt FE-01/02/03,
BE-01/02/03; không phải nghiệm thu toàn bộ WEB-1/WEB-4/CAT-1.

## Nhánh đã kiểm tra

Đã fetch origin ngày 21/10/2026:

| Dev | Nhánh | Commit |
|---|---|---|
| FE | `feat/FE-01-admin-portal` | `31cfc02` |
| BE | `feat/BE-01-catalog-schema` | `db3b136` |
| BE | `feat/BE-02-catalog-crud-api` | `96b8ed2` |
| BE | `feat/BE-03-catalog-tests-docs` | `12a53cf` |

Ba nhánh BE nối tiếp nhau; review bản BE-03 đã bao gồm BE-01 và BE-02.
Nhánh FE chứa cả code role mock và form khóa học dù tên chỉ ghi FE-01.
Review dùng bản sao tạm của từng nhánh, không checkout/merge vào main.
Chưa kiểm tra nội dung PR hoặc kết quả GitHub Actions.

## Kết luận nghiệm thu

| Mã | Đánh giá | Bằng chứng / điều kiện còn thiếu |
|---|---|---|
| FE-01 | Đạt một phần | Có Next workspace, layout/sidebar/login; build kèm TypeScript và lint qua. README chưa hướng dẫn riêng cho app; chưa kiểm tra trực quan desktop/màn hình hẹp. |
| FE-02 | Chưa đạt | Có đổi mock role và trạng thái loading/lỗi ở trang khóa. Menu admissions sai hợp đồng; một số menu dẫn tới 404; mock luôn bật, thiếu hướng dẫn/cấu hình chỉ dùng phát triển. |
| FE-03 | Chưa đạt | Danh sách/form dùng localStorage, schema khác Catalog, chưa gọi API thật và chưa hiển thị lỗi validation từ Catalog. |
| BE-01 | Có implementation, chưa nghiệm thu runtime | Có schema, migration, seed 4 khóa/3 gói, FK một gói thuộc một khóa, giá chung. Chưa chạy migration/seed trên PostgreSQL trong phiên review. |
| BE-02 | Có implementation, chưa nghiệm thu runtime | Đủ 8 endpoint tạo/danh sách/chi tiết/cập nhật khóa và gói; dùng shared schema, xử lý 400/404/409 và lưu PostgreSQL. Build/typecheck/lint qua; chưa xác nhận CRUD thực và persist sau restart. |
| BE-03 | Đạt một phần | Có 21 test CRUD PostgreSQL, ví dụ API và dữ liệu demo. Cả 21 test bị skip ở lần chạy này; tài liệu có chỗ lệch hợp đồng. Chưa có demo tích hợp FE/BE. |
| L-04 | Chưa đạt | FE chưa nối Catalog; chưa chạy migration/seed, kiểm tra persist và demo tạo/xem khóa qua API thật. |

## Các điểm cần sửa

### 1. [P1] FE-03 chưa có luồng Catalog thật

- `apps/admin-portal/lib/services/courses.ts:3-11`: Course dùng `id: number`,
  `title`, `category`, `instructor`, `price: string`, trạng thái tiếng Việt.
  Hợp đồng yêu cầu UUID, `code`, `name`, `goal`, `level`, `deliveryModes`,
  `priceVnd: number`, `draft/active/closed` và các trường mặc định.
- `lib/services/courses.ts:40-64`: đọc/tạo khóa trực tiếp bằng localStorage.
- `app/dashboard/courses/CourseModal.tsx:37`: submit cấu trúc Course riêng,
  thiếu các trường bắt buộc của Catalog.
- `next.config.ts`: không có rewrite `/api/v1/:path*` hay `CATALOG_API_URL`.
- `lib/api-client.ts:4`: URL mặc định là `http://localhost:4000/api`,
  không phải Catalog 4001; hiện cũng không được course service sử dụng.

Kiểm chứng bằng cách chạy service FE với localStorage giả lập: tạo/list thành
công nhưng số lần gọi fetch bằng 0; dữ liệu trả về bị `CourseInput` từ chối.
Trên Portal production local, `/api/v1/courses` trả 404.

Cần dùng hợp đồng Catalog cho form/danh sách, gọi API cùng origin qua rewrite,
xử lý envelope `{data,pagination}` và lỗi `{error,correlationId}`. Nghiệm thu lại
bằng tạo khóa trên Portal, kiểm tra trong DB và mở lại sau khi restart Catalog.

### 2. [P1] Menu admissions sai yêu cầu FE-02

`apps/admin-portal/lib/roles.ts:37-42` cho admissions thấy Tài chính chi nhánh,
đồng thời thiếu xem khóa và lịch. L-01 quy định admissions không có tài chính.
Dashboard thực tế import `app/dashboard/components/Sidebar.tsx`, dùng file này;
cấu hình khác trong `src/config/menu.ts` không được layout sử dụng.

Cần sửa cấu hình đang dùng và kiểm tra lại đủ 7 role. Đây là lỗi menu mock;
phân quyền backend/IAM thật nằm ngoài phạm vi đợt này.

### 3. [P2] Menu có đường dẫn chưa tồn tại

`apps/admin-portal/lib/roles.ts:44-56` trỏ tới:

- Kế toán: `/dashboard/reconciliation`, `/dashboard/refunds`.
- Giảng viên: `/dashboard/availability`, `/dashboard/classes`.

Cả 4 đường dẫn trả HTTP 404 khi chạy production server. Đợt này chỉ cần khung
menu; có thể thêm trang thông báo chưa triển khai hoặc vô hiệu hóa rõ ràng,
không cần xây đầy đủ nghiệp vụ ngoài plan.

### 4. [P2] Bàn giao FE chưa phân định và cấu hình mock đầy đủ

`app/dashboard/components/Sidebar.tsx:41-61` luôn render bộ chọn role;
`lib/mock-session.ts` luôn dùng localStorage, không có cờ môi trường để bật/tắt.
Sidebar có chú thích mock nhưng trang login/đăng ký không giải thích đăng nhập
giả lập. `README.md` vẫn là create-next-app mặc định; không hướng dẫn mock,
Catalog URL, cách kiểm tra hay phần còn thiếu; không có `.env.example` của app.

Cần bổ sung hướng dẫn workspace, cấu hình mock chỉ phục vụ phát triển và ghi
rõ giới hạn chưa có IAM/Gateway; không coi mô phỏng đăng ký là tạo tài khoản thật.

### 5. [P2] Tài liệu BE có ví dụ lệch hợp đồng và code

Trong `services/catalog/README.md`:

- Dòng 282-293 hướng dẫn `/api/catalog/:path*` và URL hardcode, trong khi L-01
  thống nhất `/api/v1/:path*` qua biến server `CATALOG_API_URL`.
- Dòng 186 có `pagination.totalPages`, nhưng route chỉ trả `page/pageSize/total`.
- Dòng 252 mô tả `details.path` là mảng; `src/app.ts` và L-01 trả chuỗi.
- Phần đầu vẫn hướng dẫn chạy template và copy template thành Catalog,
  gây nhầm khi người đọc cần chạy service Catalog đã có sẵn.

Cần đồng bộ README với hợp đồng trước khi bàn giao tích hợp.

## Kiểm tra đã chạy

- Cài dependencies bằng `npm ci --ignore-scripts --no-audit --no-fund`
  trong hai bản sao tạm; không thay dependency của working tree.
- FE: `npm run build --workspace=@spacex/admin-portal` thành công, gồm
  kiểm tra TypeScript; `npm run lint --workspace=@spacex/admin-portal`
  thành công với 1 warning dùng `<img>`.
- FE: chạy Next production trên cổng 4300; `/login` và `/dashboard/courses`
  trả 200; 4 menu trên và `/api/v1/courses` trả 404; đã dừng server sau kiểm tra.
- FE: thực thi course service và hàm menu; xác nhận localStorage thay API,
  payload không khớp CourseInput, admissions có menu tài chính.
- BE: `npm run check` thành công **28/28 task**, gồm lint/build/typecheck/test.
  Catalog có **5 test HTTP qua, 21 test PostgreSQL skip**. Năm test HTTP
  dùng route thử `/courses`, không kiểm CRUD `/api/v1/*` với DB thật.
- Docker daemon không hoạt động; localhost 5432/5433 không có PostgreSQL.
  Vì vậy chưa chạy migration, seed, test DB, restart persistence hoặc tích hợp
  FE/BE. CI hiện không cấp PostgreSQL/`CATALOG_TEST_DATABASE_URL`, nên check
  xanh mặc định cũng không chứng minh CRUD database đã được kiểm tra.

## Điều kiện để nghiệm thu lại

1. Dev FE sửa luồng Catalog, menu và tài liệu mock nêu trên; bổ sung bằng chứng
   giao diện dùng được ở desktop/màn hình hẹp.
2. Dev BE sửa README; chạy migration/seed, toàn bộ 21 test PostgreSQL và
   chứng minh khóa/gói còn sau restart service. Chưa thấy lỗi chặn build trong BE.
3. Lead kiểm tra phối hợp hai nhánh (cả hai đều sửa package-lock.json), cài lại
   dependencies, chạy check và demo tạo/xem khóa trên Portal qua Catalog thật.

Chưa đủ bằng chứng để đánh dấu hai dev hoàn thành toàn bộ yêu cầu đợt này.
