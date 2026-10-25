# Phân công SpaceX Agent Hub — hạn thứ Ba 20/10/2026

- Ngày lập: Chủ nhật, 18/10/2026.
- Hạn cuối: **23:59 thứ Ba, 20/10/2026**, giờ Việt Nam (UTC+7).
- Thành viên: Lead, Dev phụ 1, Dev phụ 2. Thay các nhãn này bằng tên thực tế khi nhận việc.
- Căn cứ: mục 8 của Product Plan và trạng thái repo hiện tại.

## Mục tiêu đợt này

Hoàn thiện nền tảng tối thiểu để cả đội phát triển độc lập; có khung Admin Portal và API Catalog có thể demo. Repo hiện mới có monorepo, cấu hình hạ tầng và một số schema dùng chung.

Thời gian khoảng hai ngày nên chỉ cam kết các phần nhỏ dưới đây. Đây là một đợt triển khai thuộc nền tảng và chuẩn bị MVP, chưa phải mốc hoàn thành toàn bộ giai đoạn 0 hay MVP tư vấn đến QR.

## Phân công và điều kiện bàn giao

### Lead — nền tảng và tích hợp

| Mã đợt này | Liên hệ plan | Công việc | Hạn bàn giao | Điều kiện nghiệm thu |
|---|---|---|---|---|
| L-01 | Chuẩn bị PL-1, IAM-2, CAT-1, WEB-1 | Chốt cấu trúc service, API lỗi, mô hình khóa/gói, bộ vai trò, token và phạm vi chi nhánh; ghi vào `docs/` | 10:00 thứ Hai 19/10 | Hai dev có ví dụ request/response và biết rõ phần mình sở hữu; vai trò phân biệt giám đốc trung tâm/chi nhánh, tuyển sinh, kế toán, giảng viên, học viên, AI Agent |
| L-02 | Một phần PL-1 | Dựng service mẫu Express + TypeScript, health check, đọc cấu hình, xử lý lỗi; cấu hình CI build/typecheck | 12:00 thứ Hai 19/10 | Dev phụ 2 tạo Catalog từ mẫu được; chạy service trả health HTTP 200; CI thực sự build/typecheck |
| L-03 | Một phần PL-2, PL-3 | Tạo kết nối RabbitMQ, ví dụ publish/consume dùng EventEnvelope; logger có service name và correlationId | 12:00 thứ Ba 20/10 | Gửi/nhận được event mẫu; log có thể đối chiếu theo correlationId; ghi rõ outbox, retry và idempotency còn thiếu nếu chưa triển khai |
| L-04 | Tích hợp đợt này | Review PR, kiểm tra Docker, migration và hướng dẫn chạy; tích hợp Portal với Catalog; xử lý lỗi chặn demo | 22:00 thứ Ba 20/10 | Từ hướng dẫn trong repo có thể chạy hạ tầng, Catalog và Portal; tạo/xem khóa qua giao diện; liệt kê phần còn mock và phần chưa làm |

Lead chịu trách nhiệm chốt hợp đồng API đúng giờ và review PR sớm để hai dev không chờ. IAM/Gateway đầy đủ sẽ làm tiếp sau đợt này; không nhận thêm toàn bộ đăng nhập, saga và AI vào cùng deadline.

### Dev phụ 1 — khung Admin Portal

Phạm vi sở hữu: `apps/admin-portal/`. Mã công việc đợt này là phần tách nhỏ của WEB-1 và WEB-4.

| Mã đợt này | Công việc | Hạn bàn giao | Điều kiện nghiệm thu |
|---|---|---|---|
| FE-01 | Khởi tạo Next.js theo workspace, layout, sidebar, màn hình đăng nhập giao diện | 18:00 thứ Hai 19/10 | Chạy được bằng lệnh ghi trong README; build/typecheck thành công; bố cục dùng được trên desktop và màn hình hẹp |
| FE-02 | Menu theo vai trò bằng mock session, trạng thái loading/lỗi; ghi rõ cách bật mock | 12:00 thứ Ba 20/10 | Đổi vai trò thấy đúng menu đã thống nhất; mock chỉ phục vụ phát triển; không mô tả đây là đăng nhập/phân quyền thật |
| FE-03 | Trang danh sách và form tạo khóa học, gọi API Catalog đã chốt | 18:00 thứ Ba 20/10 | Tạo khóa xong thấy trong danh sách; hiển thị lỗi validation và lỗi API; bàn giao PR cùng hướng dẫn kiểm tra |

Trong lúc chờ Catalog, dùng fixture đúng hợp đồng API. Khi backend sẵn sàng, thay fixture bằng API thật trước mốc tích hợp. Nếu tạo service/app chưa có quy ước, thống nhất với Lead trước khi chọn cấu trúc.

### Dev phụ 2 — Catalog API

Phạm vi sở hữu: `services/catalog/`. Mã công việc đợt này là phần tách nhỏ của CAT-1.

| Mã đợt này | Công việc | Hạn bàn giao | Điều kiện nghiệm thu |
|---|---|---|---|
| BE-01 | Chuẩn bị schema khóa/gói, request/response và seed; dùng service mẫu sau mốc L-02 | 18:00 thứ Hai 19/10 | Có migration và seed chạy được trên DB Catalog; quan hệ khóa/gói theo L-01; giá chung, không tạo bảng giá riêng theo chi nhánh |
| BE-02 | API tạo, danh sách, chi tiết và cập nhật khóa/gói; validation | 12:00 thứ Ba 20/10 | Dữ liệu lưu PostgreSQL và còn sau khi restart; từ chối tên trống/giá âm; ID không tồn tại trả 404; lỗi theo định dạng chung |
| BE-03 | Kiểm tra các trường hợp chính, tài liệu API và hỗ trợ FE tích hợp | 18:00 thứ Ba 20/10 | Có ví dụ gọi API; kiểm tra tạo hợp lệ, dữ liệu sai và cập nhật; bàn giao PR và dữ liệu demo; FE gọi API được trong môi trường local |

Trước khi có IAM, API này chỉ dùng để demo local. Chưa nghiệm thu phân quyền tạo/sửa Catalog; phần đó phải nối quyền giám đốc trung tâm ở đợt tiếp theo.

## Quy tắc giao nhận

- Mỗi đầu việc có một người chịu trách nhiệm; PR nhỏ, ghi rõ mã công việc và ticket plan liên quan.
- Dev phụ không tự sửa `packages/contracts`, cấu hình gốc hay phần của người khác; gửi yêu cầu để Lead điều phối thay đổi.
- Báo ngay khi bị chặn bởi API, service mẫu hoặc môi trường; nêu cần ai xử lý và ảnh hưởng deadline nào.
- Mỗi PR ghi: đã làm gì, cách chạy, cách kiểm tra, phần còn thiếu. Chạy build/typecheck cho workspace bị ảnh hưởng; thêm kiểm tra có ý nghĩa cho validation và lưu dữ liệu ở backend.
- Không đưa `.env`, mật khẩu hoặc token vào Git. Dùng `.env.example` để mô tả cấu hình cần thiết.
- Không đóng ticket plan đầy đủ khi mới hoàn thành phần tách nhỏ. Đặc biệt PL-2 còn yêu cầu outbox/consumer idempotent; PL-3 còn metric/trace; WEB-1 còn đăng nhập thật; CAT-1 còn phạm vi quản lý đầy đủ.

## Checklist nghiệm thu cuối đợt

Trạng thái cập nhật **26/10/2026**, dựa trên
[biên bản nghiệm thu](nghiem-thu-sau-fix-2026-10-26.md). Dấu hoàn thành phản ánh
chức năng đã kiểm chứng local, không khẳng định hoàn tất trước hạn 20/10.

- [x] Có hướng dẫn và biến môi trường mẫu để chạy hạ tầng, Catalog, Portal.
- [x] PostgreSQL, Redis, RabbitMQ được xác nhận khởi động trên máy demo; Catalog kết nối được PostgreSQL.
- [x] Service mẫu và Catalog có health check hoạt động.
- [ ] CI build/typecheck thực sự chạy trên GitHub. Workflow có lệnh thật và bản tương đương local qua 32/32 task trên Windows/Linux; chưa có kết quả GitHub Actions được xác minh.
- [x] Publish/consume được event mẫu; log có service name và correlationId.
- [x] Portal có layout, màn hình đăng nhập giao diện và menu theo mock role.
- [x] Tạo/xem khóa từ Portal qua Catalog API thật; kiểm tra lỗi đầu vào và dữ liệu còn sau restart.
- [x] API tạo/xem/sửa gói học có ví dụ kiểm tra, dù giao diện gói chưa nằm trong đợt này.
- [x] Ghi rõ mock session, phần chưa có IAM/Gateway và các hạng mục chưa hoàn thành.
- [ ] Lead review PR và cập nhật trạng thái trước hạn cuối: chưa đủ bằng chứng. Code đã được review, sửa và merge local ngày 26/10; không xác nhận ngược mốc 20/10 hoặc tình trạng PR trên GitHub.

## Sau deadline

Tiến độ phần Lead và bằng chứng kiểm tra được cập nhật trong
[biên bản bàn giao](ban-giao-lead.md). L-01 có hợp đồng/schema; L-02 có service
mẫu và workflow kiểm tra; L-03 đã demo broker thật. L-04 đã đạt luồng chức năng
Portal/Catalog local ngày 26/10, gồm migration/seed và dữ liệu sau restart.
FE-01/02/03 và BE-01/02/03 đạt output chức năng của đợt này trong bản tích hợp;
hai mục quy trình/remote còn mở như checklist trên. Các nhánh gốc là lịch sử
phát triển; nghiệm thu dùng main chứa bản sửa tích hợp, không dùng từng nhánh
gốc độc lập để thay cho main.

Ưu tiên IAM-1/IAM-2 → ORG-1/ORG-2 → GW-1 → nối đăng nhập thật cho WEB-1 để hoàn thiện mốc giai đoạn 0. Tiếp tục hoàn thiện outbox, idempotency và quan sát hệ thống theo PL-2/PL-3. Sau đó triển khai luồng web chat → Conversation → nhân viên trả lời, rồi mới nối AI, giữ chỗ và QR.
