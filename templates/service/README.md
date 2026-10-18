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
