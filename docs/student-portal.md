# Student Portal

## Kiến trúc đã kiểm tra

| Thành phần | Hiện trạng và cách portal sử dụng |
| --- | --- |
| Frontend | `apps/admin-portal` dùng Next.js App Router, React, TypeScript và npm workspaces trong Turborepo. Trang học viên nằm dưới `/student`. Shell dùng Inter, nhận diện SpaceX và token từ `app/ui/theme.css`. Học liệu và khóa học tái sử dụng ảnh bìa của Catalog. |
| Gateway và xác thực | Next BFF giữ cookie phiên HttpOnly, kiểm tra origin khi ghi và chuyển yêu cầu qua Express Gateway. Identity kiểm tra phiên đang hoạt động và liên kết học viên theo cặp learner/chi nhánh. Tài khoản học viên đăng nhập bằng OTP qua email. Các trang khôi phục hướng người dùng về phương thức này. |
| Catalog, Enrollment và Class | Catalog phục vụ gói có thể bán. Enrollment lưu xác nhận, snapshot bất biến, đơn và quyền lợi trong PostgreSQL. Class Schedule kiểm tra quyền lợi, ghế đã chốt và trạng thái lớp khi trả lịch hoặc URL vào lớp. |
| Payment | PostgreSQL lưu yêu cầu thanh toán, ledger, phân bổ và đối soát. API xem giao dịch của học viên kiểm tra quyền sở hữu qua Enrollment, sau đó đối chiếu mã yêu cầu, mã đăng ký và chi nhánh với Payment. Cổng trả số tiền đã phân bổ, thời điểm nhận, nội dung chuyển khoản và VietQR còn hạn. |
| Notification | Workflow tạo và chuyển tiếp intent. Notification cung cấp inbox dựa trên membership hiện tại. Bản triển khai này bổ sung thời điểm đã đọc cho thông báo hiện hữu và điểm cuối ghi theo từng thông báo hoặc toàn bộ hộp thư. |
| CRM và Conversation | CRM quản lý hồ sơ liên hệ và consent, gồm thông tin nhập tại checkout. Conversation hỗ trợ tư vấn và bàn giao theo cấu hình hiện có. Trang hỗ trợ dẫn về kênh liên hệ và tư vấn của trung tâm. |

Các hợp đồng nền tảng ở [packages/contracts](../packages/contracts/src), route phân luồng ở [Gateway](../services/gateway/src/app.ts) và schema lịch sử ở thư mục migration của từng service. Các API cũ giữ nguyên đường dẫn. API đọc đăng ký bổ sung ngày tạo và hạn giữ chỗ, API lịch lớp bổ sung tên phòng. Notification cần migration [0002](../services/notification/migrations/0002_portal_read.sql) trước khi đưa service mới vào hoạt động.

## Đăng ký, thanh toán và thông báo

- **WF-05** Đọc xác nhận và giá từ backend, tạo đăng ký, giữ ghế và mở yêu cầu thanh toán theo operation key. Checkout hiện hữu dùng browser proof và đọc trạng thái lặp lại trên tab đã đăng ký. Học viên đã xác minh cũng có thể mở đơn thuộc quyền sở hữu từ lịch sử. [Workflow](../workflows/n8n/wf-05.json)
- **WF-06** Payment xác thực SePay bằng HMAC-SHA256 trên timestamp và raw body, áp dụng cửa sổ năm phút, so sánh an toàn và chống xử lý lặp theo giao dịch. Payment kiểm tra đối chiếu tiền, rồi workflow chốt ghế và chuyển Enrollment sang trạng thái đã xác nhận. Giao diện phân biệt giao dịch đã xác thực với việc đăng ký đã chốt chỗ. QR chỉ hiển thị khi Payment còn mở và Enrollment còn giữ chỗ. Thông tin xác thực SePay nằm ở Payment. [SePay](../services/payment/src/sepay.ts) · [Workflow](../workflows/n8n/wf-06.json)
- **WF-10** Nhận intent theo sự kiện xác nhận đăng ký, quyền lợi, đổi lịch và nhắc lịch. Portal đọc inbox qua BFF, đồng bộ đã đọc trên máy chủ và điều hướng đến đăng ký liên quan. OTP tiếp tục dùng luồng IAM và adapter gửi hiện có. Adapter thông báo khóa học của Notification hiện là synthetic. [Workflow](../workflows/n8n/wf-10.json) · [Notification](../services/notification/src/index.ts)

## Các luồng đã nối

| Luồng | Trang và dữ liệu |
| --- | --- |
| Tài khoản | Đăng nhập OTP, đăng xuất, hồ sơ đọc từ Identity, chế độ sáng/tối lưu trên trình duyệt, đăng ký và xác minh theo quy trình checkout. |
| Tổng quan và khóa học | Lời chào theo phiên, khóa đang tham gia, khóa gần đây, lịch tới, thông báo chưa đọc, học liệu tiếp tục và gợi ý từ Catalog. Có tìm kiếm, lọc danh mục theo tên, lọc trạng thái, grid/list và phân trang trong tập đăng ký trả về. |
| Lịch | Lịch tháng và danh sách, lọc theo lớp, tên phòng hoặc link học online, giờ Việt Nam và tải ICS. Tệp ICS giữ lịch và phòng, còn link online lấy qua portal đã xác thực. |
| Học liệu | Bài đọc Python và SQL, video tham khảo CS50P, tệp thực hành, ghi chú, bookmark và tiến độ tự học trên thiết bị. Python có quiz tự luyện chấm trên máy chủ và trả kết quả sau khi nộp. Quyền học liệu đọc từ quyền đăng ký đang hoạt động hoặc `STUDENT_COURSE_GRANTS` theo ID tài khoản. |
| Đơn hàng | Lịch sử đăng ký được backend cấp quyền, chi tiết yêu cầu và giao dịch, VietQR, polling, chuyển lại checkout lưu trên tab khi phù hợp, và hóa đơn mô phỏng do Payment cấp. |
| Hộp thư và hỗ trợ | Đã đọc/chưa đọc, lọc loại, dấu số chưa đọc, đọc tất cả, link đến khóa học, FAQ, tư vấn, phản hồi yêu cầu điều chỉnh và lời mời vào lớp. |
| Trạng thái hệ thống | Trang lỗi 404 và error boundary ở cấp portal. Có trạng thái 403, phiên hết hạn, mất mạng và trang bảo trì. Hệ thống triển khai có thể điều hướng người dùng sang trang bảo trì khi cần. |

## Phụ thuộc để hoàn tất LMS

| Phần còn thiếu | Phương án triển khai |
| --- | --- |
| Giáo trình, video, phụ đề, tài liệu riêng và quyền theo giao dịch | Tạo mô hình Course Content với phiên bản xuất bản, module, lesson và quyền theo enrollment. Kiểm tra quyền hiện hành ở server khi cấp URL file ngắn hạn. Metadata video cần cung cấp nguồn media và track caption, cùng API đọc/lưu vị trí xem. |
| Tiến độ chính thức, thời lượng, giảng viên và hoàn thành khóa | Đồng bộ sự kiện lesson/session vào backend. Tách thời gian mở trang khỏi thời gian học có xác minh. Thêm mục tiêu tự học, dữ liệu tham gia, quy tắc hoàn thành và thông tin giảng viên phù hợp quyền xem. |
| Nộp và chấm bài | Thêm Assignment/Submission theo phiên bản và giới hạn nộp lại. Storage kiểm tra kích thước, loại tệp và chữ ký tệp khi nhận, giới hạn tải xuống theo learner. Giảng viên chấm và trả phản hồi qua API. |
| Quiz, bài thi và kết quả | Thêm Exam Attempt trên server với thời hạn, số lần thi, autosave có phiên bản và nộp idempotent. DTO làm bài chỉ chứa đề và lựa chọn. Chính sách công bố của server quyết quyền xem điểm, đáp án và nhận xét. |
| Chứng chỉ | Xác nhận điều kiện hoàn thành từ backend, cấp mã duy nhất và PDF. Thêm đường dẫn xác thực có trạng thái thu hồi. |
| Hồ sơ, quyền riêng tư, ngôn ngữ và phiên | Bổ sung hồ sơ học viên tự phục vụ trong Identity/CRM, quyền chỉnh sửa từng trường, quản lý thiết bị/phiên và bản địa hóa. Giữ OTP là chính sách hiện tại. |
| Thông báo LMS và hỗ trợ | Bổ sung event LMS, mẫu WF-10 và API sở thích thông báo. Thêm ticket, lịch sử, tệp đính kèm và trạng thái xử lý trong CRM/Conversation. |
| Thanh toán và chứng từ nâng cao | Bổ sung chi tiết giảm giá từ quote, API nghiệp vụ hoàn tiền học phí thật và hóa đơn chính thức. Luồng hiện tại hiển thị trạng thái Enrollment/Payment và hóa đơn mô phỏng. |

## Kiểm tra cục bộ

- Chạy `npm run dev` từ gốc rồi mở [trang đăng nhập](http://localhost:3000/student/login) trên stack đã cấu hình.
- Chạy `npm run db:migrate --workspace=@spacex/notification` theo cấu hình service trước khi kiểm tra hộp thư trên DB hiện hữu.
- Để thử lịch cho tài khoản có quyền học liệu trực tiếp, khai báo `STUDENT_PRACTICE_SCHEDULES` trong Portal. Giá trị JSON ánh xạ ID tài khoản đến mã khóa học và danh sách cặp `startsAt`, `endsAt` ở UTC. Lịch trải nghiệm dẫn đến học liệu và có thể xuất ICS.
- Chạy `npm run test --workspace=@spacex/admin-portal` để kiểm tra thư viện theo quyền, session và lịch Việt Nam.
- Chạy `node scripts/test-n8n06.mjs --case=SELF-REGISTRATION` để nghiệm thu đăng ký, WF-05/06/10 và OTP trong stack cô lập. Case `N8N06-BROWSER` kiểm tra quyền sở hữu lịch, hóa đơn, giao dịch và quy trình điều chỉnh.

Bố cục dùng hướng Editorial greeting, seed `1658758101`. Câu hỏi chính của trang tổng quan là học viên có thể tiếp tục bài nào hoặc tham gia buổi học nào. Lời chào dùng tài khoản thật, cụm tiếp tục học dùng bìa khóa học hoặc lịch lớp, và biểu đồ dùng số bài đã đánh dấu. Trên điện thoại, menu thu gọn và các nhóm dữ liệu xếp theo một cột.
