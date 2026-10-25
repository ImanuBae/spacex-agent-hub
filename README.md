# SpaceX Agent Hub

Monorepo npm workspaces + Turborepo. Yêu cầu Node.js 22+, npm 10+ và Docker Compose cho hạ tầng local.

## Cài và kiểm tra

```powershell
npm ci
npm run check
```

`check` chạy ESLint, TypeScript, test và build. CI có job Catalog/PostgreSQL
chạy migration, seed và test CRUD thật; job RabbitMQ kiểm publish/consume.
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

- [Quy ước API, Catalog, role/token và event](docs/quy-uoc-phat-trien.md).
- [Phân công đến 20/10/2026](docs/phan-cong-den-2026-10-20.md).
- [Bàn giao và kiểm chứng phần Lead](docs/ban-giao-lead.md).

## Chạy demo Portal và Catalog

1. Bật PostgreSQL theo mục hạ tầng local. Copy mẫu `.env` của Catalog nếu
   chưa có, chỉnh DATABASE_URL theo cổng PostgreSQL. Không ghi đè file cá nhân.
2. Từ root chạy `npm run build`, `npm run db:migrate --workspace=@spacex/catalog`,
   `npm run db:seed --workspace=@spacex/catalog`, rồi `npm start --workspace=@spacex/catalog`.
3. Terminal khác: copy `apps/admin-portal/.env.example` thành `.env.local`
   trong cùng thư mục app, chạy `npm run dev --workspace=@spacex/admin-portal`.
   Mở `http://localhost:3000/login` để đăng nhập demo và tạo/xem khóa.

Chi tiết cấu hình, kiểm tra và giới hạn: [Catalog](services/catalog/README.md),
[Portal](apps/admin-portal/README.md). Khóa/gói lưu PostgreSQL; các module khác
còn mock. Mock session chỉ bật khi Next dev và NEXT_PUBLIC_ENABLE_MOCK=true;
production luôn tắt. Chưa có đăng nhập thật/IAM, Gateway hoặc luồng tư vấn/thanh toán.
