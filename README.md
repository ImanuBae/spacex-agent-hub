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

- **Kế hoạch hiện hành (04/11/2026):** [Product Plan v3 — n8n điều phối nghiệp vụ](docs/product-plan-v3.md),
  [phân công một người chính và hai người hỗ trợ](docs/phan-cong-task-v3.md),
  [đặc tả 12 workflow n8n và runbook nghiệm thu](docs/n8n-workflows.md).
  Mục tiêu báo cáo lần 1 **11/11/2026**, final **05/01/2027**.
  n8n local và smoke kỹ thuật N8N-01: [hướng dẫn chạy](workflows/n8n/README.md),
  [bằng chứng thực tế](docs/ban-giao-n8n-01.md). Automation Bridge N8N-02 đã đạt LOCAL:
  [contract/runbook](services/automation-bridge/README.md), [evidence](docs/ban-giao-n8n-02.md).
  Machine authority/delegation N8N-03 và WF-01–12 chưa triển khai.
- [Bàn giao vòng 2: sự kiện tin cậy, Catalog/Class và giờ rảnh/nghỉ](docs/ban-giao-vong-2-2026-11-03.md).
- [Bàn giao CRM: hồ sơ, lead, consent và yêu cầu xóa](docs/ban-giao-crm-2026-11-03.md).

- [Quy ước API, Catalog, role/token và event](docs/quy-uoc-phat-trien.md).
- [Product Plan v2 — lịch sử và baseline nghiệp vụ được v3 dẫn chiếu](docs/product-plan-v2.md).
- [Phân công v2 — lịch sử Lead và hai dev](docs/phan-cong-task-v2.md).
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
   Lệnh dev loại service-template để không trùng cổng Gateway 4000 và loại Bridge chưa cấp cấu hình;
   Bridge chạy riêng theo runbook N8N-02.
3. Portal dùng GATEWAY_URL và PORTAL_ORIGIN trong `.env.local`.
   Mở `http://localhost:3000/login`, đăng nhập tài khoản seed; role không còn chọn giả.

Chi tiết cấu hình, kiểm tra và giới hạn: [Catalog](services/catalog/README.md),
[Portal](apps/admin-portal/README.md). IAM/Org/Catalog lưu PostgreSQL; Gateway và
từng service kiểm quyền thật. CRM/Lead đã có API PostgreSQL và Portal thật theo
[bàn giao CRM](docs/ban-giao-crm-2026-11-03.md); chat/tài chính còn mock/khung,
chưa có luồng tư vấn/đăng ký/thanh toán xuyên suốt. Production cần HTTPS cho cookie Secure.

Luồng **lớp/lịch và giữ chỗ kỹ thuật** đã có service PostgreSQL riêng, UI Catalog/gói,
Gateway/BFF và kiểm thử đồng thời. Chạy theo [runbook lớp và giữ chỗ](docs/ban-giao-lop-giu-cho.md).
Hold dùng fixture demo có nhãn; Enrollment/Payment chưa triển khai. PL-2 đã có
nền outbox/inbox/retry/replay và tích hợp Class/CRM theo bàn giao, chưa nghiệm thu
xuyên toàn hệ thống hoặc với n8n/Bridge theo plan v3.
