# Quy ước bàn giao cho hai dev — L-01

## Phạm vi và quyền sở hữu

- Lead: `packages/`, `templates/`, cấu hình gốc, hạ tầng và CI.
- Dev 1: `apps/admin-portal/` (Next.js, cổng local 3000).
- Dev 2: `services/catalog/` (Express, cổng local 4001, DB `catalog`).
- Thư viện dùng chung ở `packages/`; service chỉ ghi vào DB mình sở hữu.
- Dùng npm workspaces, TypeScript strict, ESM; import tương đối trong TS có đuôi `.js`.
- Backend dùng `src/app.ts` để tạo Express app không mở port, `src/index.ts` để đọc config và listen. Migration/seed nằm trong service sở hữu DB. Catalog dùng PostgreSQL; Dev 2 lựa chọn một ORM và ghi lệnh migrate/seed trong README service.

## Vai trò và token

Schema nguồn: `packages/contracts/src/roles.ts` và `auth.ts`. Đây là hợp đồng dữ liệu, chưa phải bộ xác thực JWT.

| Role | Phạm vi dữ liệu | Menu dự kiến trên Portal |
|---|---|---|
| `center_director` | Cả trung tâm và 5 chi nhánh; được quản lý giá | Tổng quan, hộp thư, lead/đăng ký, Catalog/lịch, tài chính, tổ chức, audit |
| `branch_director` | Các chi nhánh trong token; không đổi giá chung | Tổng quan chi nhánh, hộp thư, lead/đăng ký, lịch/lớp, tài chính chi nhánh |
| `admissions` | Chi nhánh được gán; không tài chính/hoàn tiền | Hộp thư, lead/đăng ký, xem khóa và lịch |
| `accountant` | Thanh toán chi nhánh được gán; không đọc chat | Thanh toán, đối soát, hoàn tiền |
| `teacher` | Lớp do mình dạy, không phải mọi lớp trong chi nhánh | Lịch dạy, giờ rảnh, danh sách lớp |
| `student` | Hồ sơ của chính mình | Student Portal ở giai đoạn 3 |
| `ai_agent` | Tài khoản dịch vụ, dữ liệu khách đang chat và công cụ được phép | Không đăng nhập Admin Portal |

Ví dụ claims sau khi IAM xác minh chữ ký:

```json
{
  "sub": "employee-001",
  "role": "branch_director",
  "branchIds": ["b428c292-02e9-480d-9813-51cb7d5b5885"],
  "exp": 2000000000
}
```

`center_director` xem toàn hệ thống theo vai trò; `branchIds: []` không tự cấp quyền toàn hệ thống cho các vai trò khác. IAM sẽ kiểm tra token hết hạn, issuer/audience và chữ ký; parse Zod không thay thế xác thực. Service còn phải kiểm quyền chức năng, phạm vi chi nhánh, lớp/hồ sơ sở hữu. Không tin role/header do trình duyệt tự gửi. Mock session của FE chỉ để dựng giao diện.

## Catalog: mô hình đã chọn cho đợt này

- `Course`: khóa học có code duy nhất, tên, mô tả, mục tiêu, trình độ, hình thức, danh sách chi nhánh mở khóa, giá VND chung, trạng thái.
- `CoursePackage`: một gói thuộc đúng một khóa, có code duy nhất, tên, số buổi, giá VND chung và trạng thái. Gói đa khóa chưa nằm trong phạm vi đợt này.
- Giá là số nguyên VND không âm; không có giá theo chi nhánh. Giá gói là giá toàn gói, không cộng thêm giá khóa. Khi mua khóa trực tiếp dùng giá khóa; khi mua gói dùng giá gói. Enrollment về sau lưu snapshot từ Catalog.
- `draft`: chưa bán; `active`: được bán nếu lớp đáp ứng điều kiện; `closed`: ngừng bán. Không xóa dữ liệu đã được tham chiếu.
- ID do backend cấp bằng UUID. `createdAt`, `updatedAt` là ISO UTC. CoursePackage tham chiếu khóa không tồn tại trả 404.
- Quan hệ mở chi nhánh và giá chỉ nằm ở Catalog, lớp/lịch thuộc Class & Schedule. Đợt này chưa kiểm tra chi nhánh với Org vì Org chưa triển khai.

## API v1 thống nhất

Schema đầu vào dùng trực tiếp `CourseInput`, `CoursePackageInput`, `ListQuery` từ `@spacex/contracts`. Dùng `PUT` với đầy đủ trường bắt buộc; chưa có PATCH. Giá trị mặc định theo schema cũng áp dụng khi PUT, vì vậy FE nên gửi đủ dữ liệu đang chỉnh sửa.

| Method | Path | Kết quả |
|---|---|---|
| GET | `/health` | 200 `{ "status": "ok", "service": "catalog" }`; chỉ kiểm process, không đại diện DB readiness |
| POST | `/api/v1/courses` | 201 `{ "data": Course }` |
| GET | `/api/v1/courses?page=1&pageSize=20` | 200 `{ "data": Course[], "pagination": { "page": 1, "pageSize": 20, "total": 1 } }` |
| GET / PUT | `/api/v1/courses/:id` | 200 `{ "data": Course }` |
| POST / GET | `/api/v1/packages` | Tạo/danh sách gói, tương tự khóa |
| GET / PUT | `/api/v1/packages/:id` | Chi tiết/cập nhật gói, tương tự khóa |

Danh sách sắp `createdAt DESC, id DESC`, pageSize tối đa 100. Các bộ lọc CAT-2 làm ở đợt sau. Course và Package trả đủ trường đầu vào sau khi áp dụng default, cộng `id`, `createdAt`, `updatedAt`.

Ví dụ tạo khóa (fixture FE dùng cùng cấu trúc):

```http
POST /api/v1/courses
Content-Type: application/json
x-correlation-id: demo-catalog-001
```

```json
{
  "code": "OFFICE-BASIC",
  "name": "Tin học văn phòng cơ bản",
  "description": "Word, Excel, PowerPoint",
  "goal": "Sử dụng Office trong công việc",
  "level": "beginner",
  "deliveryModes": ["onsite", "online"],
  "branchIds": [],
  "priceVnd": 1500000,
  "status": "draft"
}
```

Khóa có `branchIds: []` chưa mở học tại lớp ở chi nhánh nào. Online về sau không lọc khu vực của khách; vẫn cần lớp thuộc chi nhánh phụ trách. Đợt này chỉ quản lý Catalog, chưa suy ra lớp hoặc chỗ trống từ fixture.

Ví dụ response 201 (ID/thời gian do server cấp):

```json
{
  "data": {
    "id": "b428c292-02e9-480d-9813-51cb7d5b5885",
    "code": "OFFICE-BASIC",
    "name": "Tin học văn phòng cơ bản",
    "description": "Word, Excel, PowerPoint",
    "goal": "Sử dụng Office trong công việc",
    "level": "beginner",
    "deliveryModes": ["onsite", "online"],
    "branchIds": [],
    "priceVnd": 1500000,
    "status": "draft",
    "createdAt": "2026-10-18T00:00:00.000Z",
    "updatedAt": "2026-10-18T00:00:00.000Z"
  }
}
```

Ví dụ tạo gói:

```json
{
  "courseId": "b428c292-02e9-480d-9813-51cb7d5b5885",
  "code": "OFFICE-12",
  "name": "Gói 12 buổi",
  "sessionCount": 12,
  "priceVnd": 1500000,
  "status": "draft"
}
```

Lỗi chung, correlationId trùng header response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [{ "path": "priceVnd", "message": "Giá phải không âm" }]
  },
  "correlationId": "demo-catalog-001"
}
```

`details` chỉ có khi validation; FE dùng `code` để xử lý, không phụ thuộc chuỗi message của Zod. HTTP: 400 validation/JSON sai; 401 chưa xác thực; 403 không có quyền; 404 không tồn tại; 409 code trùng; 413 body quá lớn; 500 lỗi hệ thống. 401/403 triển khai cùng IAM sau đợt này. Không trả stack trace hoặc chuỗi kết nối DB.

## Tích hợp FE/BE

Dev 1 dùng Next.js rewrite `/api/v1/:path*` sang `http://127.0.0.1:4001/api/v1/:path*` qua biến môi trường server `CATALOG_API_URL`. Trình duyệt gọi đường dẫn tương đối cùng origin; không cần mở CORS rộng ở backend. Chưa có Gateway nên rewrite chỉ là giải pháp phát triển local. Không đặt URL kèm bí mật vào biến `NEXT_PUBLIC_*`.

## Event và log

- Exchange topic bền vững `spacex.events`; routing key bằng event `type`.
- Dùng EventEnvelope: id UUID, type, version, occurredAt UTC, correlationId, payload. Producer giữ nguyên id khi gửi lại cùng sự kiện.
- Consumer dùng queue riêng theo service/chức năng; ack sau khi handler thành công. Thất bại đưa vào `<queue>.dead` qua exchange `spacex.dead`.
- Publisher dùng confirms; đây chưa phải transactional outbox. Consumer vẫn có thể nhận lại event nếu mất kết nối sau xử lý, trước ack; service phải thêm inbox/idempotency theo `event.id` cùng transaction nghiệp vụ.
- Chưa có tự reconnect, retry tăng dần, đảm bảo thứ tự theo entity hoặc replay tooling. Sau mất kết nối cần restart process; không dùng bản này để chạy saga thanh toán thật.
- Log JSON có service, level, timestamp, correlationId. HTTP truyền correlation bằng header `x-correlation-id`; event mang cùng correlationId. Không ghi token, body chat hay dữ liệu cá nhân vào log.

## Tham khảo triển khai

- [Express — xử lý lỗi](https://expressjs.com/en/guide/error-handling/).
- [RabbitMQ — consumer acknowledgements và publisher confirms](https://www.rabbitmq.com/docs/confirms).
