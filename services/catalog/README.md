# Catalog API - BE-01/02/03

PostgreSQL + Drizzle, Express/TypeScript, local port 4001.

Chạy từ root monorepo với Node 22+, npm 10+ và Docker:

```powershell
npm ci
# Chỉ copy khi chưa có file; chỉnh DATABASE_URL theo cổng PostgreSQL local.
Copy-Item services/catalog/.env.example services/catalog/.env
npm run build
npm run db:migrate --workspace=@spacex/catalog
npm run db:seed --workspace=@spacex/catalog
npm start --workspace=@spacex/catalog
```

Health: `http://127.0.0.1:4001/health` chỉ kiểm process. Chạy PostgreSQL như
mục dưới trước migration. Portal: [hướng dẫn FE](../../apps/admin-portal/README.md).
Đây là demo local chưa có IAM/Gateway; mock session không xác thực quyền API.

## Cơ sở dữ liệu (PostgreSQL + Drizzle)

Catalog lưu khóa học và gói học trong PostgreSQL, database `catalog`. Schema ở `src/db/schema.ts`, migration SQL ở `drizzle/`.

### Chuẩn bị

1. Chạy hạ tầng từ root: `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d`. Database `catalog`, user `catalog` được tạo bởi `infra/postgres-init/01-create-dbs.sh`.
2. Copy `.env.example` thành `.env` trong thư mục này. `DATABASE_URL` mặc định: `postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog`. Nếu `POSTGRES_PORT` trong `infra/.env` khác 5432 (ví dụ 5433), đổi cổng trong `DATABASE_URL` cho khớp. Không commit `.env`.

### Lệnh (chạy từ root repo)

```powershell
npm run db:generate --workspace=@spacex/catalog
npm run db:migrate --workspace=@spacex/catalog
npm run db:seed --workspace=@spacex/catalog
```

- `db:generate`: sinh file migration mới trong `drizzle/` từ `src/db/schema.ts`. Chỉ cần chạy khi sửa schema; không kết nối database.
- `db:migrate`: áp dụng các migration chưa chạy vào database. Chạy lại nhiều lần an toàn.
- `db:seed`: nạp 4 khóa học và 3 gói học mẫu. Chạy lại nhiều lần an toàn (bỏ qua `code` đã có).


Đã áp dụng hoặc commit migration thì không sửa tay file đó. Muốn đổi cấu trúc, sửa `schema.ts` rồi chạy `db:generate` để tạo migration mới.

### Bảng

| Bảng | Ghi chú |
|---|---|
| `courses` | `code` duy nhất; `delivery_modes` là `text[]`; `branch_ids` là `uuid[]` (mặc định rỗng); `price_vnd` là `bigint`; `created_at`/`updated_at` là `timestamptz` (UTC). |
| `course_packages` | `course_id` là khóa ngoại tới `courses(id)`, `ON DELETE RESTRICT`; `code` duy nhất; `session_count` > 0; giá chung, không có giá theo chi nhánh. |

`UNIQUE(code)` của gói áp dụng toàn hệ thống theo L-01.

### Kiểm tra bằng psql

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.yml exec postgres psql -P pager=off "postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog" -c "\dt"
docker compose --env-file infra/.env -f infra/docker-compose.yml exec postgres psql -P pager=off "postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog" -c "SELECT code, name, price_vnd, status FROM courses;"
```

## API Catalog (BE-02)

Hợp đồng đầy đủ: [quy ước phát triển](../../docs/quy-uoc-phat-trien.md). Schema đầu vào dùng `CourseInput`, `CoursePackageInput`, `ListQuery` từ `@spacex/contracts`. Chưa có xác thực (IAM làm sau): API chỉ dùng để demo local.

### Chạy server

Cần PostgreSQL đang chạy và đã `db:migrate`, `db:seed` (xem mục trên). Từ root repo:

```powershell
npm run build
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
# Thử phân trang (seed có 4 khóa, pageSize=2 sẽ chia thành 2 trang)
Invoke-RestMethod "$base/api/v1/courses?page=1&pageSize=2"
```

`Invoke-RestMethod` ném lỗi khi gặp 4xx; dùng `Invoke-WebRequest` trong `try/catch` nếu cần xem mã và nội dung lỗi. Dữ liệu tạo qua API không xóa được bằng API; dọn bằng psql nếu cần.

### Ví dụ Payload & Response từng Endpoint

Tất cả phản hồi thành công bọc trong `{ "data": ... }` (kèm `"pagination"` với danh sách). Mọi phản hồi lỗi tuân theo chuẩn: `{ "error": { "code", "message", "details"? }, "correlationId" }`.

#### 1. Khóa học (Courses)

- **`POST /api/v1/courses`** (Tạo khóa học)
  - Request:
    ```json
    {
      "code": "PROG-JS-01",
      "name": "JavaScript căn bản cho người mới",
      "description": "Biến, hàm, DOM, Async/Await",
      "goal": "Làm chủ JavaScript cơ bản",
      "level": "beginner",
      "deliveryModes": ["online", "onsite"],
      "branchIds": [],
      "priceVnd": 1500000,
      "status": "draft"
    }
    ```
  - Response `201 Created`:
    ```json
    {
      "data": {
        "id": "e814d3f3-0fb6-407b-8ff8-043329241b71",
        "code": "PROG-JS-01",
        "name": "JavaScript căn bản cho người mới",
        "description": "Biến, hàm, DOM, Async/Await",
        "goal": "Làm chủ JavaScript cơ bản",
        "level": "beginner",
        "deliveryModes": ["online", "onsite"],
        "branchIds": [],
        "priceVnd": 1500000,
        "status": "draft",
        "createdAt": "2026-10-20T08:00:00.000Z",
        "updatedAt": "2026-10-20T08:00:00.000Z"
      }
    }
    ```

- **`GET /api/v1/courses?page=1&pageSize=20`** (Danh sách khóa học)
  - Response `200 OK`:
    ```json
    {
      "data": [
        {
          "id": "e814d3f3-0fb6-407b-8ff8-043329241b71",
          "code": "PROG-JS-01",
          "name": "JavaScript căn bản cho người mới",
          "description": "Biến, hàm, DOM, Async/Await",
          "goal": "Làm chủ JavaScript cơ bản",
          "level": "beginner",
          "deliveryModes": ["online", "onsite"],
          "branchIds": [],
          "priceVnd": 1500000,
          "status": "draft",
          "createdAt": "2026-10-20T08:00:00.000Z",
          "updatedAt": "2026-10-20T08:00:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "pageSize": 20,
        "total": 1
      }
    }
    ```

- **`GET /api/v1/courses/:id`** (Chi tiết khóa học)
  - Response `200 OK`: Trả về `{ "data": { ... } }` như trên.
  - Response `404 Not Found`:
    ```json
    {
      "error": {
        "code": "NOT_FOUND",
        "message": "Course not found"
      },
      "correlationId": "req-1234"
    }
    ```

- **`PUT /api/v1/courses/:id`** (Cập nhật toàn bộ khóa học)
  - Gửi body đầy đủ các trường cần cập nhật (giống `POST`).
  - Response `200 OK`: Trả về `{ "data": { ... } }` với `updatedAt` được làm mới.

#### 2. Gói học (Packages)

- **`POST /api/v1/packages`** (Tạo gói học gắn với một khóa)
  - Request:
    ```json
    {
      "courseId": "e814d3f3-0fb6-407b-8ff8-043329241b71",
      "code": "PROG-JS-01-PK12",
      "name": "Gói tiêu chuẩn 12 buổi",
      "sessionCount": 12,
      "priceVnd": 1500000,
      "status": "draft"
    }
    ```
  - Response `201 Created`:
    ```json
    {
      "data": {
        "id": "7b05536b-67df-4b72-a08b-6fa8cf835338",
        "courseId": "e814d3f3-0fb6-407b-8ff8-043329241b71",
        "code": "PROG-JS-01-PK12",
        "name": "Gói tiêu chuẩn 12 buổi",
        "sessionCount": 12,
        "priceVnd": 1500000,
        "status": "draft",
        "createdAt": "2026-10-20T08:05:00.000Z",
        "updatedAt": "2026-10-20T08:05:00.000Z"
      }
    }
    ```

- **`GET /api/v1/packages?page=1&pageSize=20`** (Danh sách gói học)
  - Response `200 OK`: Trả về `{ "data": [...], "pagination": { ... } }`.

- **`GET /api/v1/packages/:id`** (Chi tiết gói học)
  - Response `200 OK` hoặc `404 Not Found`.

- **`PUT /api/v1/packages/:id`** (Cập nhật gói học)
  - Request: Cung cấp đầy đủ các trường (`courseId`, `code`, `name`, `sessionCount`, `priceVnd`, `status`).

### Mã lỗi chuẩn (Error Codes)

| HTTP Status | Error Code (`error.code`) | Khi nào xảy ra | Ví dụ `details` |
|---|---|---|---|
| **400** | `VALIDATION_ERROR` | Thiếu trường, sai kiểu (`priceVnd` âm, `level` không hợp lệ, id không phải UUID) | `[{ "path": "level", "message": "Invalid option: expected one of \"beginner\"|\"intermediate\"|\"advanced\"" }]` |
| **404** | `NOT_FOUND` | Khóa/gói không tìm thấy; hoặc `courseId` trong gói không tồn tại | — |
| **409** | `CONFLICT` | Mã `code` đã tồn tại | — |
| **500** | `INTERNAL_ERROR` | Lỗi database hoặc sự cố server | Không trả stack trace |

### Dữ liệu Seed sẵn có (Local / Demo)

Sau khi chạy `npm run db:seed`, cơ sở dữ liệu có sẵn:

**Khóa học (`courses`):**

| code | name | level | status | priceVnd |
|---|---|---|---|---|
| `OFFICE-BASIC` | Tin học văn phòng cơ bản | beginner | draft | 1 500 000 |
| `GRAPHIC-DESIGN` | Thiết kế đồ hoạ với Canva & Photoshop | beginner | active | 2 000 000 |
| `DATA-ANALYSIS` | Phân tích dữ liệu với Excel nâng cao | intermediate | active | 3 000 000 |
| `WEB-FULLSTACK` | Lập trình Web Fullstack | advanced | draft | 5 000 000 |

**Gói học (`course_packages`):**

| code | name | courseCode | sessionCount | status | priceVnd |
|---|---|---|---|---|---|
| `OFFICE-12` | Gói 12 buổi | OFFICE-BASIC | 12 | draft | 1 500 000 |
| `GRAPHIC-8` | Gói 8 buổi | GRAPHIC-DESIGN | 8 | active | 2 000 000 |
| `DATA-16` | Gói 16 buổi chuyên sâu | DATA-ANALYSIS | 16 | active | 3 000 000 |

### Lưu ý cho Frontend (FE) tích hợp

1. **CORS và Reverse Proxy**:
   - Catalog **không** bật CORS middleware (theo `docs/quy-uoc-phat-trien.md`).
   - Cấu hình rewrite thuộc quyền sở hữu của Dev 1 tại `apps/admin-portal/next.config.ts`. Ví dụ cấu hình tham khảo theo đúng quy ước dòng 138:
     ```javascript
     const catalogUrl = process.env.CATALOG_API_URL || 'http://127.0.0.1:4001';
     async rewrites() {
       return [
         {
           source: '/api/v1/:path*',
           destination: `${catalogUrl}/api/v1/:path*`,
         },
       ];
     }
     ```
   - Trình duyệt gọi đường dẫn tương đối cùng origin (ví dụ `fetch('/api/v1/courses')`) → không bị lỗi CORS.

2. **`PUT` thay toàn bộ**: Gửi đủ payload như `POST`. Trường tùy chọn bị bỏ sẽ về mặc định. Chưa có `PATCH`.

3. **`priceVnd` là số**: Backend serialize `BIGINT` → `number` trong JSON. FE format tiền bằng `Number.prototype.toLocaleString('vi-VN')`.

4. **Chưa cần Auth**: Giai đoạn hiện tại không yêu cầu JWT/Session header.

### Khởi động nhanh Catalog cho FE

```powershell
# 1. Bật PostgreSQL
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d postgres

# 2. Migration + Seed
npm run db:migrate --workspace=@spacex/catalog
npm run db:seed --workspace=@spacex/catalog

# 3. Build & chạy (cổng 4001)
npm run build
npm start --workspace=@spacex/catalog
```

### Test

```powershell
# 1. Chạy test tích hợp kèm PostgreSQL thật (tự động đọc DATABASE_URL từ .env)
npm run test:db --workspace=@spacex/catalog

# 2. Hoặc truyền biến môi trường thủ công
$env:CATALOG_TEST_DATABASE_URL = "postgresql://catalog:catalog_dev@127.0.0.1:5432/catalog"; npm test --workspace=@spacex/catalog

# 3. Unit test (khi không có DB, tự động skip an toàn cho CI)
npm test --workspace=@spacex/catalog
```

Test dùng mã `code` riêng, tự xóa dữ liệu khi xong, không phụ thuộc seed.

Chỉ dùng DB test local. `test:db` thoát lỗi nếu thiếu cả hai biến URL; không
được coi test skip là kiểm tra DB đạt. CI có job Catalog riêng, cấp PostgreSQL,
chạy migration/seed và test:db. `npm test` mặc định vẫn có thể skip DB khi chưa
cấu hình URL. Kiểm chứng nghiệm thu bản tích hợp được ghi trong `docs/`.

## Lịch sử tự kiểm của dev ngày 21/10/2026

| Mã TC | Hạng mục | Mục tiêu & Lệnh kiểm tra | Kết quả thực tế | Đánh giá |
|:---:|:---:|---|---|:---:|
| **TC-01** | BE-01 | Migration DB trống (`catalog_verify`) | Migration completed | **Đạt** |
| **TC-02** | BE-01 | Migration chạy lần 2 an toàn (idempotent) | Migration completed (mã thoát 0) | **Đạt** |
| **TC-03** | BE-01 | Seed chạy 2 lần không nhân đôi | Đúng 4 courses, 3 packages | **Đạt** |
| **TC-04** | BE-01 | Ràng buộc DB (psql): giá âm, trùng code, FK ảo | Ném lỗi 23514, 23505, 23503 | **Đạt** |
| **TC-05** | BE-02 | Tạo và xem khóa (POST & GET /courses/:id) | 201 Created (id UUID, priceVnd dạng số) | **Đạt** |
| **TC-06** | BE-02 | Bắt lỗi dữ liệu sai (400, 404, 409) | 400 VALIDATION_ERROR, details.path là chuỗi | **Đạt** |
| **TC-07** | BE-02 | Phân trang GET /courses?page=1&pageSize=2 | Trả 2 bản ghi, pagination có page, pageSize, total | **Đạt** |
| **TC-08** | BE-02 | Cập nhật PUT thay thế toàn bộ khóa | 200 OK, đổi tên & giá, giữ nguyên createdAt | **Đạt** |
| **TC-09** | BE-02 | CRUD gói học (POST, GET, PUT /packages) | Tạo gói 201, đọc 200, cập nhật 200 | **Đạt** |
| **TC-10** | BE-02 | Dữ liệu còn sau khi tắt/bật lại server API | Đọc lại dữ liệu thành công qua HTTP 200 | **Đạt** |
| **TC-11** | BE-02 | Sống sót sau restart container Postgres | Container restart 0.4s, API tự kết nối lại | **Đạt** |
| **TC-12** | BE-03 | Test tự động `npm run test:db` (có Postgres) | 26 passed (26), 0 skipped (2.19s) | **Đạt** |
| **TC-13** | BE-03 | Kiểm tra Monorepo `npm run check` | Tasks: 28 successful, 28 total (4.26s) | **Đạt** |
