# Nghiệm thu sau sửa tích hợp — 26/10/2026

Nhánh local: `fix/dev-handoff`, tích hợp FE-03 `e006573` và BE-03 `06f06ba`.
Đối chiếu phạm vi trong `phan-cong-den-2026-10-20.md` và hợp đồng L-01.

## Kết quả theo mã việc

| Mã | Kết quả | Bằng chứng |
|---|---|---|
| FE-01 | Đạt phạm vi đợt này | Build, lint, typecheck qua; README ghi lệnh workspace; Chrome kiểm tra desktop 1440px, mobile 390px và sidebar đóng/mở được. |
| FE-02 | Đạt phạm vi đợt này | Đã sửa menu admissions; kiểm tra đủ 7 role và các route trả 200. Mock chỉ bật trong Next dev với cờ true; tắt cờ hoặc production sẽ ẩn dashboard/role selector. Login ghi rõ giả lập, đăng ký không tạo tài khoản. |
| FE-03 | Đạt phạm vi đợt này | Chrome tạo khóa qua `/api/v1/*` → Next rewrite → Catalog → PostgreSQL, khóa xuất hiện và còn sau reload/restart. Form hiển thị lỗi validation thật; lỗi API được xử lý. |
| BE-01 | Đạt phạm vi đợt này | DB test mới PostgreSQL 17: migration và seed chạy hai lần thành công, vẫn 4 khóa/3 gói; không có giá riêng theo chi nhánh. Mẫu DATABASE_URL đã sửa. |
| BE-02 | Đạt phạm vi đợt này | 21 test CRUD PostgreSQL kiểm tra khóa/gói, dữ liệu sai, 404, 409 và PUT. Dữ liệu tạo trên Portal còn sau restart API và PostgreSQL. Đã xử lý lỗi idle pool khi DB restart. |
| BE-03 | Đạt phạm vi đợt này | Catalog 26/26 test qua, không skip khi chạy test:db; README có API và seed, Portal gọi API thật. CI có job DB riêng, test:db thiếu URL thoát lỗi thay vì báo thành công với skip. |
| L-04 | Luồng Portal/Catalog đạt | Hai nhánh đã hợp nhất, xử lý xung đột và thống nhất hợp đồng rewrite; migration/seed/CRUD/persist/Chrome được kiểm chứng. Không dùng dữ liệu/container của project khác. |

## Thay đổi chính

- Menu tuyển sinh bỏ tài chính, thêm xem khóa/lịch. Bổ sung 11 test Portal
  cho menu, cờ mock và envelope/lỗi API.
- `CATALOG_API_URL` chỉ ở server; trình duyệt dùng đường dẫn tương đối,
  bỏ CORS bổ sung và NEXT_PUBLIC_API_URL trong luồng khóa học.
- Gỡ nút/API DELETE ngoài phạm vi đợt này, thống nhất 8 endpoint của L-01.
- Sửa URL DB mẫu, hướng dẫn chạy, bật/tắt mock, phần chưa có IAM/Gateway và
  các trang còn mock. Production không mô phỏng xác thực thật.
- CI giữ npm ci; bổ sung metadata binary tùy chọn đúng phiên bản trong lockfile,
  thêm job PostgreSQL chạy migration/seed/test DB. Không nâng phiên bản các
  dependency đã có trong lockfile.

## Kiểm chứng

- Windows: `npm run check` **32/32 task qua** (lint/typecheck/test/build).
- `npm run test:db --workspace=@spacex/catalog` với DB test: **26/26 test qua**,
  không skip. Thiếu cả hai biến URL: exit 1 đúng yêu cầu kiểm tra bắt buộc.
- Migration/seed chạy hai lần; SQL đếm **4 courses, 3 packages** trước khi
  thực hiện các thao tác tạo dữ liệu bằng trình duyệt.
- Chrome với Portal dev và Catalog thật: tạo khóa, thấy trong bảng, reload,
  restart API, restart PostgreSQL rồi đọc lại đều thành công; form trống trả
  validation thật. Kiểm tra 7 role, các menu 200 và sidebar mobile 390px.
- Chrome khi tắt mock: không có dashboard/role selector. Production với cờ
  true vẫn hiển thị thông báo demo chưa bật.
- Hạ tầng test riêng: PostgreSQL accepting connections, Redis PONG,
  RabbitMQ ping thành công; demo publish/consume có cùng eventId/correlationId,
  test broker thật 1/1 qua.
- Linux Node 22/npm 10: cài sạch bằng `npm ci --ignore-scripts` và
  `npm run check` **32/32 task qua**, có native SWC/Tailwind bindings.

DB kiểm thử chạy trong container riêng `spacex-handoff-verify-20261026` trên
localhost:55439. Không chỉnh `.env` cá nhân hoặc DB có sẵn. File README ghi
cách tái kiểm bằng DB local và biến `CATALOG_TEST_DATABASE_URL`.
Các server/Chrome và ba container test đã được dừng/dọn sau kiểm tra;
container kiểm tra Linux cũng tự dọn khi hoàn thành.

`npm run check` mặc định có thể skip test DB nếu thiếu URL, và test broker nếu
thiếu RABBITMQ_TEST_URL; không dùng kết quả đó thay cho test:db/broker riêng.
Kết quả GitHub Actions trên remote chưa được chạy trong phiên local này.

## Giới hạn đúng phạm vi plan

Chưa có IAM/JWT thật, Gateway, quyền/phạm vi dữ liệu backend, các nghiệp vụ
tài chính/chat/lead/tổ chức đầy đủ hoặc giao diện gói học. Các trang kế toán/
giảng viên ngoài lịch mới có khung. Đây là nghiệm thu phần tách nhỏ của đợt,
không đóng toàn bộ WEB-1/WEB-4/CAT-1 hoặc toàn bộ MVP.

## Chốt hồ sơ nghiệm thu ngày 26/10

- Fetch lại origin: không có commit dev mới; cả 6 nhánh FE/BE đều đã nằm
  trong lịch sử main. Code tích hợp tại `2b527ec` không còn lỗi đã nêu ở hai
  lần review trong phạm vi output chức năng FE-01/02/03, BE-01/02/03.
- Chạy lại check: 32/32 task qua; DB mới chạy migration/seed và test:db
  26/26 qua. Chạy lại Chrome: tạo/xem, validation, restart API/DB, đủ 7 role,
  mobile và tắt mock/production đều qua. Không phát hiện lỗi chức năng mới.
- Hoàn chỉnh [bàn giao Lead](ban-giao-lead.md) và
  [checklist phân công](phan-cong-den-2026-10-20.md), bỏ các trạng thái cũ
  nói chưa có Portal/Catalog hoặc L-04 vẫn chờ tích hợp. Giữ lịch sử kiểm tra
  18/10 riêng với kết quả 26/10.
- Hai mục quy trình vẫn chưa xác minh: kết quả GitHub Actions/PR trên remote
  và việc review/cập nhật trước deadline 20/10. Không đánh dấu đạt hai mục này
  bằng kết quả local hoặc thay đổi ngược thời hạn.

Bản chốt hồ sơ chỉ thay đổi tài liệu; kết quả Linux 32/32 trên cùng code
`2b527ec` vẫn áp dụng. Không mở rộng nghiệm thu sang IAM/Gateway/MVP đầy đủ.
