# Bàn giao vòng 2 — nền tảng, Catalog/Class và Portal

Tiếp nối sau bản bàn giao này: phần CRM có code nhưng chưa nối trang Lead đã
được hoàn thiện theo phạm vi ghi tại [bàn giao CRM cùng ngày](ban-giao-crm-2026-11-03.md).
Các giới hạn và bằng chứng vòng 2 bên dưới được giữ để truy vết.

Ngày 03/11/2026. Phạm vi: đảm nhận công việc kỹ thuật của Lead, frontend và backend ở vòng kế tiếp đã đề xuất; không coi đây là hoàn thành toàn bộ M0–M4. Đối chiếu [phân công v2](phan-cong-task-v2.md) và [Product Plan v2](product-plan-v2.md).

## 1. Đầu ra theo ba vai trò

| Vai trò | Đã triển khai và kiểm chứng |
| --- | --- |
| Lead / nền tảng | Thư viện PostgreSQL outbox/inbox, chống xử lý trùng, backoff, dead letter và replay; Class ghi event cùng giao dịch nghiệp vụ. Worker khai báo binding bền trước publish, chờ broker confirm, ghi inbox trước ack, xử lý inbox cùng transaction của hiệu ứng. Worker reconnect, xử lý backlog sau restart; API operations cho trung tâm, replay có lý do và audit bất biến. |
| Backend | Nội dung policy khóa/gói có version/history, quote chứa policy; lọc mục tiêu/trình độ/hình thức/chi nhánh/ngân sách theo giá gói. Giờ rảnh, đề nghị nghỉ và quyết định có version/ownership/scope; chặn race duyệt nghỉ–xếp lịch bằng khóa giảng viên. Vòng đời lớp, hủy lớp chưa chốt chỗ, lịch sử trạng thái, bảo vệ quyền lợi khi đổi lịch/hủy. |
| Frontend | Giờ rảnh/nghỉ qua API thật, giảng viên gửi và quản lý duyệt/rút; menu/guard theo role; mobile giữ đủ trạng thái/thao tác. Form policy khóa/gói, lịch sử và tra gói theo nhu cầu/ngân sách; thao tác bắt đầu/hoàn tất/hủy lớp có xác nhận. Không còn banner bản mẫu ở trang giờ rảnh. |

Nền tảng HTTP bổ sung trace context W3C, trace/span trong log, thời gian request, số request/lỗi theo mẫu route; trace được chuyển Gateway → service → IAM/Org/Catalog và qua BFF. Gateway có rate limit theo socket IP cho auth và theo actor đã xác thực cho API, không tin X-Forwarded-For. CI có thêm job PostgreSQL + RabbitMQ cho reliability.

## 2. Quy tắc nghiệp vụ được thực thi

- Giảng viên chỉ khai thời gian cho hồ sơ hoạt động của mình. AVAILABLE có hiệu lực ngay; LEAVE ở PENDING đến khi quản lý quyết định. Không tự duyệt nghỉ, kể cả khi người gửi sau đó được đổi thành vai trò quản lý.
- Khai báo giờ rảnh đầu tiên bật kiểm tra giờ rảnh cho giảng viên đó một cách bền vững. Mỗi buổi phải nằm trọn trong một khoảng AVAILABLE còn hiệu lực. Lịch cũ chưa có khai báo vẫn dùng được; không tự suy ra thời gian rảnh từ việc chưa có dữ liệu. Khai báo đầu tiên phải bao phủ lịch tương lai hiện có, nếu không toàn giao dịch bị từ chối.
- Không cho rút giờ rảnh làm mất bao phủ lịch tương lai, hoặc duyệt nghỉ khi còn buổi bị ảnh hưởng. Quản lý cần xếp lại buổi trước; việc đề nghị nghỉ không tự hủy lịch học. Cửa sổ thời gian dùng `[start,end)`, hai khoảng kề nhau không xung đột.
- Tạo khai báo dùng Idempotency-Key; cùng key/payload trả lại bản ghi hiện tại, khác payload bị từ chối. Duyệt/rút dùng optimistic version, stale request bị chặn. Form giữ key khi thử lại cùng payload sau mất mạng trong cùng phiên mở trang.
- Lớp: DRAFT → PLANNED → OPEN → IN_PROGRESS → COMPLETED; DRAFT/PLANNED/OPEN có thể CANCELLED khi chưa có chỗ committed. Chỉ giám đốc chi nhánh duyệt OPEN/bắt đầu/hoàn tất. Bắt đầu kiểm giờ buổi đầu, sĩ số và hold chưa xử lý; hoàn tất kiểm giờ buổi cuối.
- Hủy lớp cần lý do, hủy hold còn hiệu lực, giải phóng phòng/giảng viên nhưng giữ buổi trong hồ sơ. Lịch sử trạng thái append-only. Hủy và commit khóa cùng lớp, không thể vừa CANCELLED vừa có quyền lợi mới committed.
- Có committed thì hủy bị chặn `ENROLLMENT_REQUIRED`. Đổi lịch/giảng viên/phòng/hình thức khi còn hold/committed cũng bị chặn, chờ workflow bảo vệ quyền lợi và thông báo. Không sửa lịch lớp đã bắt đầu/kết thúc qua API chỉnh lớp thông thường.
- OPEN với `minimumSize > 0` vẫn bị chặn khi chính sách C02/CS-7 chưa được chốt. Không tự bật ngoại lệ mở dưới sĩ số.
- Ngân sách tra khóa dựa trên gói active đáp ứng khoảng tiền; tra gói `sellable=true` kiểm cả khóa lẫn gói active. Giá niêm yết ở khóa không thay thế giá gói. Policy hiện có hiệu lực ngay, không hỗ trợ lập lịch policy tương lai.

## 3. Migration và chạy local

Không chép đè `.env` cá nhân. Build trước khi migrate; mỗi lệnh dưới đây dùng DATABASE_URL riêng của service, sau đó restart đúng service:

```powershell
npm run build
# Đặt DATABASE_URL đúng Catalog trước lệnh này:
npm run db:migrate --workspace=@spacex/catalog
# Đặt DATABASE_URL đúng Class trước lệnh này:
npm run db:migrate --workspace=@spacex/class-schedule
```

Catalog thêm `0002_policy_text`. Class thêm `0002_teacher_time`, `0003_messaging` (schema từ thư viện), `0004_lifecycle`; migration có version và khóa, đã chạy hai lần trên DB kiểm thử. Migration lifecycle giữ dữ liệu lịch và thêm cờ active cho exclusion constraints. Khi có quyền lợi thật, lên kế hoạch triển khai/rollback riêng trước vận hành; backup local không phải bằng chứng rollback production.

Đặt `RABBITMQ_URL` trong môi trường Class để bật worker. Không cấu hình thì nghiệp vụ đồng bộ vẫn chạy và event ở PENDING; API operations trả `messagingEnabled=false`. Không báo đã giao event chỉ vì thao tác HTTP thành công.

Demo hiện tại đã được nâng cấp, giữ tài khoản/mật khẩu và dữ liệu cũ:

- Portal: **http://localhost:3000**; giờ rảnh: `/dashboard/availability`.
- Identity/Org/Catalog/Class/Gateway vẫn cổng 4002/4003/4001/4004/4000.
- PostgreSQL demo riêng vẫn cổng 55432. Không dùng DB marketing 5432/Redis 6379.
- RabbitMQ demo riêng `space-agent-demo-rabbitmq`, chỉ bind loopback cổng 55673. Credential dev ở `.local/class-demo.json`, không đưa vào Git/log/slide. `npm run demo:class -- --production` đọc brokerUrl local nếu có hoặc ưu tiên RABBITMQ_URL từ môi trường; trước khi dùng runner cần dừng đúng stack demo đang chiếm cổng.
- Đã dump Catalog/Class trước migration vào `.local/stage-next-backups/`. Đây là bản sao lưu, chưa tuyên bố đã diễn tập restore.
- Đã smoke login giảng viên qua BFF và trang giờ rảnh thật. Bản demo chưa có khai báo thì hiển thị trạng thái trống đúng dữ liệu, không tự thêm đơn nghỉ vào dữ liệu của người dùng.

## 4. Vận hành sự kiện

- Delivery là **at-least-once**, hiệu ứng SQL trong inbox là một lần theo `(consumer,eventId)`. Handler inbox phải chỉ ghi bằng client transaction được truyền vào; tác vụ gửi email/HTTP ngoài transaction cần outbox riêng.
- Retry tối đa mặc định 8 lần, exponential backoff 2 giây đến trần 300 giây. Lỗi cuối vào DEAD; log chỉ lưu loại lỗi, không lưu thông tin kết nối hay payload nhạy cảm.
- `GET /api/v1/operations`: chỉ center_director, có trạng thái outbox/inbox, thời điểm đọc, metric HTTP và 20 event receipt gần nhất. Không có payload riêng tư trong danh sách receipt.
- `POST /api/v1/operations/:eventId/replay`, body `{reason, consumer?}`: chỉ center_director. Bỏ consumer để replay outbox; truyền consumer để replay inbox. Chỉ nhận DEAD, giữ event ID để không nhân đôi hiệu ứng; lý do/người làm được lưu append-only.
- Broker delivery không ghi được inbox sẽ đi broker DLQ `spacex.class-schedule.operations.v1.dead`. Đây là hàng đợi khác với DB DEAD. Sau khi sửa nguyên nhân, dùng `node scripts/replay-broker-dlq.mjs`: cần `DATABASE_URL` của Class, `RABBITMQ_URL`, `IDENTITY_URL`, `OPERATOR_ACCESS_TOKEN`, `REPLAY_REASON`; `REPLAY_LIMIT` mặc định 10, tối đa 100. CLI kiểm phiên/role center_director với IAM, ghi audit intent/confirmed rồi mới ack bản gốc sau khi broker confirm bản thay thế. Giữ nguyên event ID, không phát lại sang tất cả subscriber. Message sai schema được giữ trong DLQ để kiểm tra, không tự xóa. Không dùng requeue vòng lặp vô hạn cho poison message.
- Khi broker mất kết nối, event nghiệp vụ vẫn ở outbox và worker thử kết nối lại. Log cảnh báo khi có DEAD hoặc pending quá 5 phút. Binding đã khai báo trước publish trong luồng Class; service mới phải khai báo durable consumer binding trước khi bật publisher. Publisher dùng mandatory return + confirm; event không có destination bị từ chối, không đánh dấu SENT.
- Projection hiện tại là receipt vận hành của Class, không phải read model nghiệp vụ RP-2 hay audit tập trung RP-1. Event class có aggregateVersion; consumer nghiệp vụ tương lai cần xử lý event đến sai thứ tự theo version.

## 5. Bằng chứng kiểm tra

| Kiểm tra | Kết quả | Bằng chứng local |
| --- | --- | --- |
| Workspace lint/typecheck/unit/build | 52/52 tác vụ thành công | `.local/stage-next-workspace-check.log` |
| Class PostgreSQL + IAM/Org/Catalog/Gateway | 19/19 qua; gồm restart process thật, worker broker thật, race chỗ/hủy/commit/duyệt nghỉ | `.local/stage-next-class-tests.log` |
| Reliability PostgreSQL + RabbitMQ | 6/6 qua; rollback, retry/dead/replay, dedup, concurrent worker, redelivery sau lỗi xác nhận, broker DLQ redrive và publish không có destination | `.local/stage-next-messaging-tests.log` |
| Catalog regression DB riêng | 26/26 qua | `.local/stage-next-catalog-tests.log` |
| IAM/Org/Gateway/Portal BFF regression | 13/13 qua, có Portal production | `.local/stage-next-iam-tests.log` |
| Browser production biệt lập | 9 nhóm kiểm tra qua | `.local/stage-next-browser/result.json` |
| Kiểm giao diện giờ rảnh | 0 FAIL, 1 WARN | `.local/stage-next-design/availability/report.json` |
| Lint thiết kế phần mới | 0 FAIL, 1 WARN | `.local/stage-next-design-lint.log` |
| Smoke demo đã nâng cấp | Qua | `.local/stage-next-demo-smoke.json` |

CLI khôi phục broker cũng đã smoke trên demo: phiên giảng viên bị từ chối, phiên trung tâm được phép xử lý DLQ trống. Test broker riêng kiểm redrive message thật và giữ nguyên message sai JSON trong DLQ.

64 test tích hợp DB/broker nêu trên không skip. Suite mặc định của `check` vẫn có các test tích hợp opt-in bị skip khi thiếu URL; không dùng kết quả đó thay cho 64 test chạy riêng.

Lệnh chạy lại (cấu hình URL trỏ môi trường kiểm thử biệt lập có quyền tạo DB):

```powershell
npm run check
# CLASS_TEST_DATABASE_URL: PostgreSQL kiểm thử; thêm RABBITMQ_TEST_URL để kiểm worker process với broker.
npm run test:class:db
# MESSAGING_TEST_DATABASE_URL + RABBITMQ_TEST_URL bắt buộc:
npm run test:reliability
# CLASS_TEST_DATABASE_URL bắt buộc; cần Chrome/Edge đã cài và build production trước:
$env:STAGE2_INSPECT='1'
npm run test:stage2:browser
```

Browser acceptance tự tạo bốn DB UUID, chạy migration hai lần, start Portal production trên cổng trống, dùng fixture mang nhãn DEMO và dọn đúng DB/process do nó tạo. Không dùng tài khoản hoặc dữ liệu của bản demo đang chạy.

Thiết kế: giữ palette/type và nhận diện Portal, hướng Achromatic ledger, seed 20261103; màn hình trả lời “giảng viên có thể dạy/nghỉ lúc nào, đề nghị nào cần quyết định?”. Giữ shell sẵn có, bỏ gradient/blur trên trang giờ rảnh và chuyển danh sách thành các dòng đầy đủ trường trên mobile. Đã xem ảnh desktop/tablet/mobile và page-01. WARN `hero-void` chấp nhận vì tài khoản kiểm thử chỉ có hai khai báo, không bịa dữ liệu để lấp màn hình; WARN lint `backdrop-filter` là khai báo **none** để bỏ blur kế thừa. Không redraw.

## 6. Những việc chưa thể gọi là hoàn tất

- Chưa hoàn thành cả dự án hoặc toàn bộ đợt 2. CS-7 còn chính sách sĩ số/hoãn/học bù; giữ chỗ vẫn dùng fixture khi chưa có Enrollment/CRM. Hủy/đổi lịch của lớp có quyền lợi phải chờ Enrollment/Payment/Notification.
- PL-2 có nền tảng và tích hợp Class thật, cùng redrive DB/broker có kiểm soát; service nghiệp vụ ở các đợt sau vẫn cần tích hợp và kiểm phục hồi riêng, chưa suy rộng bằng chứng Class thành toàn hệ thống. PL-3 có trace context/log/metric cơ bản và log cảnh báo; chưa có collector, dashboard, metric bền hoặc hệ thống gửi alert bên ngoài. Rate limit Gateway hiện theo một instance, chưa dùng kho chia sẻ cho nhiều replica.
- Chưa có CI remote, deploy production, xác nhận customer C01–C12, diễn tập backup/restore hoặc UAT go/no-go. Không tự ký duyệt thay customer.
- Chat/CRM, Enrollment/Payment/QR, AI, Notification, reporting đầy đủ và Student Portal vẫn theo các đợt sau. Không đổi tỷ lệ của snapshot tiến độ trước thành “toàn dự án đã xong” từ số test mới.
- Code còn cùng working tree với các thay đổi trước đó; không tự commit toàn bộ thay đổi của người dùng. Có thể review theo file và checklist kiểm chứng trong tài liệu này.
