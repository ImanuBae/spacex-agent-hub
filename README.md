# SpaceX Agent Hub

Monorepo npm workspaces + Turborepo. Yêu cầu Node.js 22+, npm 10+ và Docker Compose cho hạ tầng local.

## Cài và kiểm tra

```powershell
npm ci
npm run check
```

`check` chạy ESLint, TypeScript, test và build. CI có job Catalog/PostgreSQL
chạy migration, seed và test CRUD thật; job RabbitMQ kiểm publish/consume.
Job stage1 kiểm IAM/Org/Gateway/Catalog và Portal BFF với PostgreSQL riêng.
Chưa có pipeline deploy độc lập từng service.

## Hạ tầng local

Nếu chưa có, copy `infra/.env.example` thành `infra/.env` và chỉnh cổng khi bị trùng. Không ghi đè `.env` đang có.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
```

PostgreSQL tạo DB/user riêng cho từng service khi volume được khởi tạo lần đầu; Catalog được bật pgvector. Script init không chạy lại với volume đã có. Không xóa volume để chạy lại vì sẽ mất dữ liệu; kiểm tra và bổ sung migration phù hợp nếu DB đã tồn tại. Giá trị mặc định trong compose/init chỉ phục vụ local.

## Service mẫu và event demo

```powershell
npm run dev:template
```

Mở `http://127.0.0.1:4000/health`. Config mẫu và cách tạo service mới: [templates/service](templates/service/README.md).

```powershell
npm run demo:messaging
```

Lệnh demo yêu cầu RabbitMQ đang chạy; điều chỉnh `RABBITMQ_URL` trong `templates/service/.env` khi dùng cổng khác mặc định.

## Tài liệu đội

- [Bàn giao vòng 2: sự kiện tin cậy, Catalog/Class và giờ rảnh/nghỉ](docs/ban-giao-vong-2-2026-11-03.md).
- [Bàn giao CRM: hồ sơ, lead, consent và yêu cầu xóa](docs/ban-giao-crm-2026-11-03.md).

- [Quy ước API, Catalog, role/token và event](docs/quy-uoc-phat-trien.md).
- [Product Plan v2: phạm vi, nghiệp vụ và roadmap](docs/product-plan-v2.md).
- [Phân công task cho Lead và hai dev](docs/phan-cong-task-v2.md).
- [Hướng dẫn và contract đợt 1: IAM, Org, Gateway, Portal](docs/huong-dan-dot-1.md).
- [Kết quả triển khai và kiểm chứng đợt 1](docs/ban-giao-dot-1.md).
- [Bằng chứng nghiệm thu Portal/Catalog ngày 26/10/2026](docs/nghiem-thu-sau-fix-2026-10-26.md).

## Chạy Portal, IAM, Org, Gateway và Catalog

Chỉ chạy một stack tại một thời điểm: `npm run dev` hoặc `npm run demo:class`.
Nếu Next báo `Another next dev server is already running`, dừng terminal/tiến trình
đang chạy checkout này trước khi khởi động lại; không xóa `.next/dev/lock` khi server còn sống.

1. Bật PostgreSQL; chuẩn bị `.env` riêng của IAM/Org/Catalog/Gateway theo
   [hướng dẫn đợt 1](docs/huong-dan-dot-1.md). Cấu hình AUTH_SECRET chung,
   DATABASE_URL riêng và tài khoản admin seed; không ghi đè `.env` cá nhân.
2. Build, migrate và seed IAM/Org/Catalog theo hướng dẫn, rồi chạy `npm run dev`.
   Lệnh dev loại service-template để không trùng cổng Gateway 4000.
3. Portal dùng GATEWAY_URL và PORTAL_ORIGIN trong `.env.local`.
   Mở `http://localhost:3000/login`, đăng nhập tài khoản seed; role không còn chọn giả.

Chi tiết cấu hình, kiểm tra và giới hạn: [Catalog](services/catalog/README.md),
[Portal](apps/admin-portal/README.md). IAM/Org/Catalog lưu PostgreSQL; Gateway và
từng service kiểm quyền thật. Các nghiệp vụ chat/lead/tài chính ngoài đợt 1
còn mock/khung; chưa có luồng tư vấn/thanh toán thật. Production cần HTTPS cho cookie Secure.

Luồng **lớp/lịch và giữ chỗ kỹ thuật** đã có service PostgreSQL riêng, UI Catalog/gói,
Gateway/BFF và kiểm thử đồng thời. Chạy theo [runbook lớp và giữ chỗ](docs/ban-giao-lop-giu-cho.md).
Hold dùng fixture demo có nhãn; Enrollment/Payment và PL-2 vẫn chưa hoàn tất.
