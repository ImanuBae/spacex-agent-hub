# Service mẫu Express + TypeScript

Chạy từ root repo sau `npm ci`:

```powershell
npm run dev:template
```

Health: `http://127.0.0.1:4000/health`. Lệnh build trước khi chạy; khi sửa TypeScript cần chạy build lại ở terminal khác. `node --watch` theo dõi JavaScript đã build, không tự compile TypeScript.

Muốn đổi cấu hình, copy `.env.example` thành `.env` trong thư mục này. `PORT`, `HOST`, `SERVICE_NAME` được kiểm bằng Zod khi khởi động. Health chỉ thể hiện process hoạt động, không kiểm DB/broker.

## Tạo Catalog từ mẫu

Từ root, copy `templates/service/` sang `services/catalog/`, bỏ `dist/`, `.env`, `.turbo/` nếu được copy cùng. Đổi tên package thành `@spacex/catalog`, dùng `SERVICE_NAME=catalog`, `PORT=4001`; chạy `npm install` ở root để cập nhật workspace lockfile.

Giữ `app.ts` không mở cổng để test được. Thêm route qua callback `registerRoutes` trước middleware 404; dùng `HttpError` cho lỗi nghiệp vụ và parse Zod cho request. Bổ sung PostgreSQL/migration/seed trong service. Bỏ demo/test mẫu khi thay bằng kiểm tra Catalog thật.

Hợp đồng API và vai trò: [quy ước phát triển](../../docs/quy-uoc-phat-trien.md).

## Demo RabbitMQ

Chạy hạ tầng theo README gốc, sau đó:

```powershell
npm run demo:messaging
```

Nếu đổi cổng RabbitMQ trong `infra/.env`, cập nhật `RABBITMQ_URL` trong `templates/service/.env` theo cổng đó. Không commit `.env`. Demo subscribe trước, publish `demo.ping`, chờ đúng event id rồi thoát. Log publish/receive mang cùng correlationId. Queue bền vững `demo.service-template` và queue `.dead` được giữ lại để kiểm tra; demo không tự xóa dữ liệu broker.

Kết nối broker cần callback ghi nhận lỗi. Tắt consumer/process có công việc đang chạy cần đợi handler kết thúc trước khi close. Demo chỉ có một event và chờ hoàn thành; khi áp dụng vào service phải xử lý shutdown phù hợp công việc thực tế.

## Cơ sở dữ liệu (PostgreSQL + Drizzle)

Catalog lưu khóa học và gói học trong PostgreSQL, database `catalog`. Schema ở `src/db/schema.ts`, migration SQL ở `drizzle/`.

### Chuẩn bị

1. Chạy hạ tầng từ root: `docker compose -f infra/docker-compose.yml up -d`. Database `catalog`, user `catalog` được tạo bởi `infra/postgres-init/01-create-dbs.sh`.
2. Copy `.env.example` thành `.env` trong thư mục này. `DATABASE_URL` mặc định: `postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog`. Nếu `POSTGRES_PORT` trong `infra/.env` khác 5432 (ví dụ 5433), đổi cổng trong `DATABASE_URL` cho khớp. Không commit `.env`.

### Lệnh (chạy từ root repo)

```powershell
npm run db:generate --workspace=@spacex/catalog
npm run db:migrate --workspace=@spacex/catalog
npm run db:seed --workspace=@spacex/catalog
```

- `db:generate`: sinh file migration mới trong `drizzle/` từ `src/db/schema.ts`. Chỉ cần chạy khi sửa schema; không kết nối database.
- `db:migrate`: áp dụng các migration chưa chạy vào database. Chạy lại nhiều lần an toàn.
- `db:seed`: nạp khóa `OFFICE-BASIC` và gói `OFFICE-12` theo ví dụ trong `docs/quy-uoc-phat-trien.md`. Chạy lại nhiều lần an toàn (bỏ qua `code` đã có).

Đã áp dụng hoặc commit migration thì không sửa tay file đó. Muốn đổi cấu trúc, sửa `schema.ts` rồi chạy `db:generate` để tạo migration mới.

### Bảng

| Bảng | Ghi chú |
|---|---|
| `courses` | `code` duy nhất; `delivery_modes` là `text[]`; `branch_ids` là `uuid[]` (mặc định rỗng); `price_vnd` là `bigint`; `created_at`/`updated_at` là `timestamptz` (UTC). |
| `course_packages` | `course_id` là khóa ngoại tới `courses(id)`, `ON DELETE RESTRICT`; `code` duy nhất; `session_count` > 0; giá chung, không có giá theo chi nhánh. |

`UNIQUE(code)` của gói hiện áp dụng toàn hệ thống; chờ Lead xác nhận có đổi thành duy nhất trong cùng khóa hay không.

### Kiểm tra bằng psql

```powershell
docker compose -f infra/docker-compose.yml exec postgres psql -P pager=off "postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog" -c "\dt"
docker compose -f infra/docker-compose.yml exec postgres psql -P pager=off "postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog" -c "SELECT code, name, price_vnd, status FROM courses;"
```

## API Catalog (BE-02)

Hợp đồng đầy đủ: [quy ước phát triển](../../docs/quy-uoc-phat-trien.md). Schema đầu vào dùng `CourseInput`, `CoursePackageInput`, `ListQuery` từ `@spacex/contracts`. Chưa có xác thực (IAM làm sau): API chỉ dùng để demo local.

### Chạy server

Cần PostgreSQL đang chạy và đã `db:migrate`, `db:seed` (xem mục trên). Từ root repo:

```powershell
npm run build --workspace=@spacex/catalog
npm start --workspace=@spacex/catalog
```

Server nghe ở `http://127.0.0.1:4001`. `start` chạy `dist/`, nên sửa code TypeScript xong phải build lại và khởi động lại.

### Endpoint

| Method | Path | Thành công | Lỗi có thể gặp |
|---|---|---|---|
| GET | `/health` | 200 | |
| POST | `/api/v1/courses` | 201 `{ data }` | 400, 409 (trùng `code`) |
| GET | `/api/v1/courses?page=1&pageSize=20` | 200 `{ data, pagination }` | 400 |
| GET | `/api/v1/courses/:id` | 200 `{ data }` | 400 (id không phải UUID), 404 |
| PUT | `/api/v1/courses/:id` | 200 `{ data }` | 400, 404, 409 |
| POST | `/api/v1/packages` | 201 `{ data }` | 400, 404 (`courseId` không tồn tại), 409 (trùng `code`) |
| GET | `/api/v1/packages?page=1&pageSize=20` | 200 `{ data, pagination }` | 400 |
| GET | `/api/v1/packages/:id` | 200 `{ data }` | 400, 404 |
| PUT | `/api/v1/packages/:id` | 200 `{ data }` | 400, 404 (id hoặc `courseId` mới không tồn tại), 409 |

- `PUT` thay toàn bộ các trường (chưa có PATCH); gửi đủ dữ liệu, trường có giá trị mặc định sẽ về mặc định nếu bỏ qua. `id` và `createdAt` được giữ nguyên, `updatedAt` được cập nhật.
- Danh sách sắp `createdAt DESC, id DESC`, `pageSize` tối đa 100, trả mọi trạng thái (`draft`, `active`, `closed`), chưa có bộ lọc.
- `priceVnd` và `pagination.total` là số. Chưa có `DELETE`.
- Lỗi theo dạng `{ "error": { "code", "message", "details"? }, "correlationId" }`; `code` là `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` hoặc `INTERNAL_ERROR`.

### Gọi thử (PowerShell)

```powershell
$base = "http://127.0.0.1:4001"
$body = @{ code = "DEMO-1"; name = "Khoa demo"; goal = "Thu API"; level = "beginner"; deliveryModes = @("online"); priceVnd = 1500000 } | ConvertTo-Json
$course = Invoke-RestMethod -Method Post -Uri "$base/api/v1/courses" -ContentType "application/json" -Body $body
$pkg = @{ courseId = $course.data.id; code = "DEMO-PKG-1"; name = "Goi 12 buoi"; sessionCount = 12; priceVnd = 1200000 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/v1/packages" -ContentType "application/json" -Body $pkg
Invoke-RestMethod "$base/api/v1/courses?page=1&pageSize=20"
```

`Invoke-RestMethod` ném lỗi khi gặp 4xx; dùng `Invoke-WebRequest` trong `try/catch` nếu cần xem mã và nội dung lỗi. Dữ liệu tạo qua API không xóa được bằng API; dọn bằng psql nếu cần.

### Test

```powershell
npm test --workspace=@spacex/catalog
```

Test API chạm PostgreSQL thật nằm ở `src/routes.test.ts` và **chỉ chạy khi có biến `CATALOG_TEST_DATABASE_URL`** (CI hiện chưa có PostgreSQL nên tự bỏ qua). Chạy cục bộ:

```powershell
$env:CATALOG_TEST_DATABASE_URL = "postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog"; npm test --workspace=@spacex/catalog
```

Mỗi lần chạy dùng mã `code` riêng, tự xóa dữ liệu test khi xong và không phụ thuộc dữ liệu seed.
