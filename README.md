# SpaceX Agent Hub

Monorepo npm workspaces + Turborepo. Yêu cầu Node.js 22+, npm 10+ và Docker Compose cho hạ tầng local.

## Cài và kiểm tra

```powershell
npm ci
npm run check
```

`check` chạy ESLint, TypeScript, test và build. CI áp dụng các bước này cho workspace hiện có; job RabbitMQ riêng kiểm publish/consume bằng broker thật. Chưa có pipeline deploy độc lập từng service.

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

Portal và Catalog thuộc hai dev phụ, chưa có implementation tại thời điểm bàn giao nền tảng. Chưa có đăng nhập thật, Gateway, migration Catalog hoặc luồng tư vấn/thanh toán. Xem trạng thái chi tiết trong biên bản bàn giao.
