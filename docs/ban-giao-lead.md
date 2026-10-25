# Bàn giao phần Lead — cập nhật 26/10/2026

Phần nền tảng được bàn giao ngày 18/10. Portal/Catalog và các sửa tích hợp
đã vào `main` tại `2b527ec` ngày 26/10; các nhánh FE/BE gốc đều là tổ tiên của
bản này. Không còn commit dev mới chưa tích hợp tại lần fetch ngày 26/10.
Kết quả chi tiết: [biên bản nghiệm thu](nghiem-thu-sau-fix-2026-10-26.md).

## Trạng thái theo phân công

| Việc | Trạng thái | Bằng chứng / phần còn lại |
|---|---|---|
| L-01 — quy ước và hợp đồng | Đã áp dụng trong bản tích hợp | `quy-uoc-phat-trien.md`; backend dùng shared schema, Portal gọi API đúng envelope và menu đã sửa theo L-01. Chưa có biên bản xác nhận riêng của từng dev |
| L-02 — service mẫu và CI | Implementation xong, kiểm tra local đạt | `templates/service`; health, config, HTTP error; workflow CI có check và job RabbitMQ. Workflow chưa được chạy trên GitHub trong phiên này |
| L-03 — broker và logger | Demo local đạt | Publisher confirms, consumer manual ack, DLQ; log JSON mang service/correlationId; demo thật và test lỗi handler đạt |
| L-04 — tích hợp | Đạt kiểm chứng chức năng local ngày 26/10 | Migration/seed, 26 test Catalog với PostgreSQL thật; Chrome tạo/xem khóa, dữ liệu còn sau restart API/DB; kiểm tra role/mobile. Chưa xác minh PR/CI trên GitHub hoặc việc hoàn tất trước deadline 20/10 |

## Kiểm chứng tích hợp ngày 26/10

- Windows và Linux Node 22: check 32/32 task qua, gồm lint/typecheck/test/build.
- Catalog: test:db 26/26 qua, không skip; thiếu URL DB thì test:db thoát lỗi.
- Migration/seed chạy hai lần vẫn giữ 4 khóa, 3 gói trước khi tạo dữ liệu UI.
- Portal gọi Catalog qua Next rewrite cùng origin, hiển thị validation/API error;
  khóa tạo thành công xuất hiện trong bảng và còn sau restart Catalog/PostgreSQL.
- Kiểm tra đủ 7 role và mobile 390px. Mock chỉ bật trong dev với cờ true;
  production luôn tắt. Các trang ngoài phạm vi vẫn được ghi rõ là mock/khung.
- Hạ tầng test riêng: PostgreSQL accepting connections, Redis PONG, RabbitMQ
  ping thành công; demo event/correlation và test broker thật qua.
- Đã review code các nhánh qua Git local và merge bản sửa vào main local.
  Chưa xác minh nội dung PR/GitHub Actions; chưa push main lên origin.

## Lịch sử kiểm chứng nền tảng ngày 18/10

- `npm run check`: 24 task thành công cho 6 workspace, gồm lint thật, build, typecheck và test.
- Có 13 test HTTP/schema/config/logger thành công; 1 test broker được bỏ qua trong lệnh check mặc định vì chưa đặt biến môi trường test.
- Chạy riêng test broker bằng `RABBITMQ_TEST_URL`: thành công; consumer ném lỗi thì event được giữ trong DLQ, queue chính không còn event chờ.
- `npm run demo:messaging`: publish/receive đúng event id, log mang cùng correlationId, process thoát thành công.
- PostgreSQL `pg_isready`: accepting connections; extension `vector` tồn tại trong DB `catalog`.
- RabbitMQ diagnostics: ping thành công.
- Redis project: `redis-cli ping` trả `PONG`.
- `git diff --check`: không có lỗi khoảng trắng.

Các test HTTP khởi động Express thật trên cổng ngẫu nhiên và gọi bằng fetch, kiểm health/correlation, validation, JSON hỏng, 404 và async 500 không lộ nội dung lỗi nội bộ. Đây chưa phải test lưu dữ liệu Catalog.

## Cấu hình máy đã kiểm tra ngày 18/10

Đây là cấu hình lịch sử, không khẳng định stack hiện đang chạy. Kiểm chứng
26/10 dùng container test riêng tại 55439 (PostgreSQL), 55772 (RabbitMQ),
56380 (Redis); các container test đã được dọn sau khi chạy.

| Thành phần | Cổng host | Ghi chú |
|---|---|---|
| PostgreSQL project | 5433 | Theo cấu hình local hiện có |
| RabbitMQ AMQP / management | 5672 / 15672 | Theo cấu hình local hiện có |
| Redis project | 6380 | Cổng 6379 bị container khác chiếm; dùng override trong shell |

Không sửa `infra/.env` đang có. Để khởi động lại cả stack với Redis ở cổng đã kiểm tra, dùng terminal PowerShell riêng:

```powershell
$env:REDIS_PORT = '6380'
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
```

Biến trên chỉ có hiệu lực trong terminal hiện tại. Nếu dùng `.env` cũ và không override, lệnh up có thể lại đụng cổng 6379. Lần kiểm tra 18/10 giữ container project chạy; không dùng thông tin đó thay cho kiểm tra trạng thái hiện tại và không dừng/sửa container project khác.

## Lệnh bàn giao

```powershell
npm ci
npm run check
npm run dev:template
```

Service mẫu: `http://127.0.0.1:4000/health`. Terminal khác chạy demo:

```powershell
npm run demo:messaging
$env:RABBITMQ_TEST_URL = 'amqp://spacex:spacex_dev@127.0.0.1:5672'
npm test --workspace=@spacex/messaging
```

Test broker tạo queue tên ngẫu nhiên và dọn các queue test sau khi chạy. Không dùng URL của broker production. Demo dùng queue riêng, không xóa queue demo khi kết thúc.

## Lịch sử hướng dẫn hai dev ngày 18/10

Các bước dưới đã được thực hiện trong bản tích hợp. Người nhận bàn giao hiện
tại dùng README gốc, README Portal/Catalog và biên bản nghiệm thu 26/10.

1. Dev 1 đọc hợp đồng Catalog và bảng menu trong `quy-uoc-phat-trien.md`, dựng Portal bằng fixture cùng schema; dùng Next rewrite để nối API thật khi có Catalog.
2. Dev 2 copy service mẫu theo `templates/service/README.md`, thêm DB/migration/seed và CRUD đúng hợp đồng API. Không cần tự dựng lại xử lý lỗi hoặc logger.
3. Khi hai PR sẵn sàng, Lead review schema/migration, kiểm persist sau restart, rồi demo tạo/xem khóa từ Portal. Lúc đó mới nghiệm thu L-04.

## Giới hạn chưa hoàn thành

- PL-1 chưa có CD/deploy độc lập từng service.
- PL-2 chưa có transactional outbox, inbox/idempotency, tự reconnect, retry tăng dần hoặc đảm bảo thứ tự theo entity. Không dùng broker helper hiện tại để nghiệm thu saga thanh toán.
- PL-3 mới có log/correlation; chưa có metric hoặc distributed tracing.
- TokenClaims chỉ kiểm hình dạng dữ liệu; chưa xác thực JWT, chưa có middleware phân quyền backend.
- Gói học thuộc một khóa là quyết định tối thiểu cho đợt này; chưa hỗ trợ bundle nhiều khóa.
- Đã có Portal/Catalog trong phạm vi đợt này; chưa có đăng nhập thật, Gateway
  hoặc toàn bộ nghiệp vụ MVP. Không đóng toàn bộ ticket PL/WEB/CAT dựa trên
  việc hoàn thành các đầu việc tách nhỏ FE/BE.
