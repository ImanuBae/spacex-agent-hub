# Nghiệm thu lại hai dev — 26/10/2026

Đối chiếu phân công đợt 20/10, hợp đồng L-01 trong
`quy-uoc-phat-trien.md` và các phát hiện của `review-dev-2026-10-21.md`.
Kết luận: đã sửa được luồng HTTP Catalog, lỗi menu 404 và bố cục mobile;
chưa đủ điều kiện nghiệm thu toàn bộ vì FE-02 vẫn sai và chưa xác minh CRUD
PostgreSQL/persist trong phiên này.

## Phiên bản đã lấy từ origin

| Nhánh | Commit | Phạm vi review |
|---|---|---|
| `feat/FE-01-admin-portal` | `fadce36` | Nằm trong chuỗi nhánh FE |
| `feat/FE-02-mock-roles-courses-routes` | `f57503f` | Nằm trong chuỗi nhánh FE |
| `feat/FE-03` | `e006573` | Bản FE mới nhất, gồm cả FE-01/02 |
| `feat/BE-01-catalog-schema` | `db3b136` | Không đổi so với lần trước |
| `feat/BE-02-catalog-crud-api` | `96b8ed2` | Không đổi so với lần trước |
| `feat/BE-03-catalog-tests-docs` | `06f06ba` | Bản BE mới nhất, gồm BE-01/02 |

FE-03 có bản sao Catalog và thay đổi backend riêng, không chứa commit BE-03
theo quan hệ tổ tiên Git. Phải phân biệt Catalog trong FE-03 với nhánh BE riêng.
Các kiểm tra chạy trong bản sao tạm; không checkout/merge hay sửa code các dev.
Chưa kiểm tra PR và kết quả GitHub Actions trên remote.

## Bảng kết luận nghiệm thu

| Mã | Kết luận | Đã xác nhận / điều kiện còn thiếu |
|---|---|---|
| FE-01 | Đạt phần khung; tài liệu còn thiếu | Build kèm TypeScript, lint qua. Chrome kiểm tra 1440×900 và 390×844; sidebar mobile mở/đóng được. README có hướng dẫn nhưng chưa ghi rõ lệnh workspace/build và bước kiểm tra. |
| FE-02 | Chưa đạt | 4 menu cũ đã trả 200. Tuy nhiên admissions vẫn thấy tài chính và thiếu xem khóa/lịch; cờ bật/tắt mock trong README không được code sử dụng; login/đăng ký giả lập chưa được giải thích đủ. |
| FE-03 | Đạt phần gọi API và hiển thị lỗi; chưa nghiệm thu trọn luồng | Đã bỏ localStorage cho khóa học, payload dùng cấu trúc Catalog, có GET/POST/PUT. Chrome xác nhận hiển thị lỗi validation từ Catalog thật. Chưa kiểm tra tạo thành công → thấy trong danh sách → đọc lại sau restart vì thiếu DB. Cách nối trực tiếp CORS vẫn khác hợp đồng rewrite L-01. |
| BE-01 | Có implementation; chưa xác minh lại DB | Migration/schema/seed có sẵn; README bổ sung kết quả runtime do dev ghi. Phiên này chưa chạy migration/seed vì PostgreSQL và Docker chưa hoạt động. |
| BE-02 | Build và HTTP validation đạt; CRUD/persist chưa xác minh lại | Nhánh BE qua check 28/28 task. Catalog trong FE-03 health 200 và dữ liệu sai trả 400 theo envelope chung. Chưa kiểm tra CRUD thành công/persist với PostgreSQL. |
| BE-03 | Đạt một phần | Đã sửa ví dụ pagination, details.path và rewrite trong README; có test:db và bảng tự kiểm của dev. Nhánh BE chạy 7 test HTTP qua nhưng 21 test DB vẫn skip. README còn mô tả không bật CORS dù code đã bật. |
| L-04 | Chưa nghiệm thu | Đã xác minh Portal gửi HTTP tới Catalog và hiển thị lỗi thật; còn thiếu DB, migration/seed, tạo/xem thành công, persist và thống nhất hai bản Catalog trước merge. |

## Các điểm còn cần xử lý

### 1. [P1] Menu tuyển sinh vẫn sai yêu cầu cũ

Trên FE-03, `apps/admin-portal/lib/roles.ts:39-44` vẫn trả menu Tài chính
chi nhánh cho `admissions`, thiếu xem khóa/lịch. Dashboard sử dụng chính hàm
này qua Sidebar; đây không phải cấu hình bỏ quên không được sử dụng.
Đã thực thi hàm và xác nhận kết quả. Cần sửa menu theo L-01 và kiểm đủ 7 role.

### 2. [P2] Cờ mock trong hướng dẫn chưa có tác dụng

`apps/admin-portal/README.md:34` hướng dẫn `NEXT_PUBLIC_ENABLE_MOCK=true/false`,
nhưng không có code ứng dụng đọc biến này. Sidebar luôn hiện bộ chọn role,
`lib/mock-session.ts` luôn mặc định `center_director`/đọc localStorage.
Đã đặt biến thành `false` khi thực thi helper: vẫn trả role mặc định.
Login/đăng ký vẫn chỉ giả lập, nhưng giao diện mô tả đăng ký quản trị viên thành
công. Cần thực hiện cờ mock và ghi rõ giới hạn IAM; không yêu cầu xây IAM thật.

### 3. [P1] Mẫu DATABASE_URL trên FE-03 bị hỏng

`services/catalog/.env.example:7` trên FE-03 là `DATABASE_URL=postgresql:`.
Đây không phải cấu hình kết nối đủ host/user/database theo hướng dẫn local;
copy nguyên mẫu không kết nối được DB Catalog như README mô tả.
Nhánh BE-03 riêng vẫn giữ URL đầy đủ. Cần phục hồi mẫu của BE hoặc thống nhất
mẫu hợp lệ trước khi tích hợp; không sửa file .env cá nhân.

### 4. [P2] Chưa thống nhất hợp đồng tích hợp và hai bản backend

- FE gọi trực tiếp `NEXT_PUBLIC_API_URL` mặc định `http://127.0.0.1:4001`;
  cả hai bản Catalog đã cho phép CORS từ localhost/127.0.0.1:3000. Đã kiểm tra
  trình duyệt gửi request được. Tuy nhiên L-01 thống nhất gọi `/api/v1/*` cùng
  origin qua Next rewrite và biến server `CATALOG_API_URL`; hiện chưa có rewrite.
  Cần Lead chốt thay đổi hợp đồng hoặc chỉnh lại theo L-01.
- FE `lib/services/courses.ts:152-158` gọi DELETE; Catalog trong FE-03 có
  endpoint DELETE bổ sung, nhánh BE-03 riêng không có. Nếu dùng đúng backend
  từ nhánh BE, nút xóa sẽ nhận 404. Xóa không thuộc yêu cầu đợt này; có thể bỏ
  nút hoặc đưa phần API bổ sung vào PR backend có review rõ ràng.
- FE-03 còn sửa `.github/workflows/ci.yml`: xóa lockfile rồi npm install trong
  cả hai job. Đã kiểm tra npm ci trên Windows vẫn cài được. Cần Lead review
  riêng thay đổi CI/cấu hình gốc; chưa xác minh được nguyên nhân lỗi Linux và
  phương án này làm CI không còn kiểm đúng dependency đã khóa trong repo.

### 5. [P2] Tài liệu bàn giao còn thiếu hoặc mâu thuẫn

- README FE đã thay mẫu Next.js, nhưng phần đầu vẫn mô tả toàn bộ dùng
  localStorage; khóa học thực tế đã dùng API. Lệnh `npm run dev` không nói rõ
  chạy tại app hay root; chạy tại root khởi động cả các service cần .env.
  Cần ghi lệnh workspace, build, backend prerequisite và cách thử thành công/lỗi.
- README Catalog vẫn nói không bật CORS; thực tế `src/app.ts` đã bật allowlist.
  Còn phần hướng dẫn copy template thành Catalog dù service đã có sẵn.

## Kiểm chứng trong phiên review

| Kiểm tra | Kết quả |
|---|---|
| Cài dependencies hai bản sao bằng npm ci --ignore-scripts | Thành công; không thay dependencies working tree |
| Nhánh BE-03: npm run check | 28/28 task thành công; Catalog 7 test HTTP qua, 21 test DB skip |
| Nhánh FE-03: npm run check | 30/30 task thành công; gồm Portal build, TypeScript, lint; Catalog 7 test HTTP qua, 23 test DB skip |
| 4 route từng 404 | availability/classes/reconciliation/refunds đều HTTP 200; là khung trang, không coi nghiệp vụ đã hoàn thành |
| Chrome desktop/mobile | Kiểm tra 1440×900 và 390×844; không tràn chiều rộng tài liệu, sidebar mobile mở được; bảng có cuộn ngang |
| HTTP thật tới Catalog trong FE-03 | Health 200; POST thiếu dữ liệu/tên trống/giá âm trả 400 VALIDATION_ERROR có details và correlationId |
| Form trên Chrome → Catalog thật | Submit form rỗng hiển thị lỗi API theo các trường code/name/goal/priceVnd |
| FE course service với phản hồi giả lập | GET/POST đúng /api/v1/courses và envelope; lỗi validation được định dạng kèm field. Đây không phải bằng chứng persist |
| DB/migration/seed/persist | Chưa chạy: Docker daemon không hoạt động, localhost 5432/5433 không có PostgreSQL |

Dev BE đã ghi bảng kiểm runtime ngày 21/10 trong README (migration, seed,
restart, 26 test qua). Đây là bằng chứng do dev cung cấp; phiên review này chưa
tái lập các kết quả đó. Việc thêm fallback DATABASE_URL/test:db giúp chạy test
khi có DB, không tự loại bỏ skip trong CI; CI hiện vẫn chưa cấp PostgreSQL.
GET danh sách với DB chưa chạy trả 500 và Portal hiển thị lỗi API; không coi
đây là lỗi CRUD của dev khi chưa có môi trường DB.

## Điều kiện nghiệm thu tiếp

1. FE sửa menu admissions, thực hiện cờ mock, hoàn chỉnh hướng dẫn bàn giao.
2. Lead và hai dev thống nhất bản Catalog, DATABASE_URL mẫu, CORS/rewrite,
   DELETE và thay đổi CI trước merge.
3. Bật PostgreSQL local, chạy migration/seed và toàn bộ test DB; dùng Portal
   tạo khóa, xác nhận xuất hiện trong danh sách, restart Catalog rồi đọc lại.

Các server/Chrome dùng để kiểm tra đã dừng. Báo cáo 21/10 được giữ nguyên
để đối chiếu lịch sử. Chưa merge hoặc commit thay cho các dev.
