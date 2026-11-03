# Class & Schedule

Vòng 2 bổ sung giờ rảnh/nghỉ, vòng đời lớp, outbox/inbox và worker RabbitMQ.
Migration và giới hạn nghiệp vụ: [bàn giao vòng 2](../../docs/ban-giao-vong-2-2026-11-03.md).

PostgreSQL riêng `class_schedule`, service port 4004. Xem
[contract, quyền, kiểm chứng và runbook](../../docs/ban-giao-lop-giu-cho.md).

```sh
npm run build
npm run db:migrate --workspace=@spacex/class-schedule
npm run db:seed --workspace=@spacex/class-schedule
npm run start --workspace=@spacex/class-schedule
```

Seed chỉ chạy khi `APP_ENV=demo`, không ghi đè fixture đã có. File `.env.example`
liệt kê cấu hình; không chép đè `.env` cá nhân. Worker chạy trong tiến trình,
quét ngay khi startup và mỗi 5 giây, dùng PostgreSQL để phục hồi sau restart.

```powershell
$env:CLASS_TEST_DATABASE_URL='postgresql://postgres:space_agent_local_dev@127.0.0.1:55432/postgres'
npm run test:class:db
```

Suite cần DB test có quyền tạo database/extension, tự tạo bốn database tên ngẫu
nhiên và xóa đúng các database đó sau khi chạy. Thiếu URL là lỗi; không skip.
API chạy bằng user service riêng, không dùng user quản trị của suite test.
