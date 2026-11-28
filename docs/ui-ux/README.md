# Bàn giao UI/UX SpaceX Agent Hub

Giao diện dùng lại Inter, nền xanh đêm, màu nhấn và ảnh bìa có sẵn. Danh mục dùng ảnh bìa và thông tin gói để quét nhanh. Chi tiết Python cơ bản đặt học phí, lịch lớp và bài học thử cạnh nội dung khóa học. Checkout dùng chỉ báo bốn bước và màu theo trạng thái đơn. Student Portal đưa buổi học gần nhất và “Vào lớp” lên đầu. Admin dùng điều hướng theo nhóm nghiệp vụ, bảng và bộ lọc gọn. [Landing page tham chiếu](before/landing-desktop.jpg).

## Ảnh trước và sau

Ảnh chụp bằng Edge/Playwright trên desktop 1440 px và điện thoại 390 px hoặc Pixel 7. Ảnh thanh toán và hồ sơ học viên dùng dữ liệu tổng hợp trong môi trường kiểm thử cô lập.

| Màn hình | Trước · desktop | Sau · desktop | Trước · điện thoại | Sau · điện thoại |
| --- | --- | --- | --- | --- |
| Student Portal | [Ảnh](before/student-desktop.jpg) | [Ảnh](after/student-desktop.jpg) | [Ảnh](before/student-mobile.jpg) | [Ảnh](after/student-mobile.jpg) |
| Đăng ký | [Ảnh](before/enrollment-desktop.jpg) | [Ảnh](after/enrollment-desktop.jpg) | [Ảnh](before/enrollment-mobile.jpg) | [Ảnh](after/enrollment-mobile.jpg) |
| Chờ thanh toán | [Ảnh](before/payment-desktop.jpg) | [Ảnh](after/payment-desktop.jpg) | [Ảnh](before/payment-mobile.jpg) | [Ảnh](after/payment-mobile.jpg) |
| Danh mục khóa học | [Ảnh](before/catalog-desktop.jpg) | [Ảnh](after/catalog-desktop.jpg) | [Ảnh](before/catalog-mobile.jpg) | [Ảnh](after/catalog-mobile.jpg) |
| Chi tiết Python cơ bản | [Ảnh](before/detail-desktop.jpg) | [Ảnh](after/detail-desktop.jpg) | [Ảnh](before/detail-mobile.jpg) | [Ảnh](after/detail-mobile.jpg) |
| Liên hệ | [404](before/contact-desktop.jpg) | [Ảnh](after/contact-desktop.jpg) | [404](before/contact-mobile.jpg) | [Ảnh](after/contact-mobile.jpg) |
| Admin Portal | [Ảnh](before/admin-desktop.jpg) | [Ảnh](after/admin-desktop.jpg) | [Ảnh](before/admin-mobile.jpg) | [Ảnh](after/admin-mobile.jpg) |

Ảnh bổ sung

- Bài học thử Python trên [desktop](after/sample-desktop.jpg) và [điện thoại](after/sample-mobile.jpg).
- Khung QR với mẫu thanh toán mô phỏng cho Python cơ bản trên [desktop](after/payment-qr-desktop.jpg) và [điện thoại](after/payment-qr-mobile.jpg).
- Đăng ký thành công trên [desktop](after/payment-success-desktop.jpg) và [điện thoại](after/payment-success-mobile.jpg), cùng trạng thái [hết hạn](after/payment-expired-desktop.jpg) và [cần đối soát](after/payment-review-desktop.jpg).
- Lịch sử khóa học trong Admin trên [desktop](after/admin-history-desktop.jpg) và [điện thoại](after/admin-history-mobile.jpg).
- Đăng nhập học viên trên [desktop trước](before/student-login-desktop.jpg), [desktop sau](after/student-login-desktop.jpg), [điện thoại trước](before/student-login-mobile.jpg) và [điện thoại sau](after/student-login-mobile.jpg).

## Luồng đã kiểm tra

- **Danh mục → chi tiết → đăng ký.** Mở Python cơ bản từ danh mục, xem học phí và lịch lớp, mở bài học thử và điền thông tin đăng ký trên cả hai kích thước.
- **Đăng ký → thanh toán.** Môi trường cô lập chạy luồng giữ chỗ, chờ thanh toán, tải lại với cùng mã, xác nhận qua webhook SePay thử nghiệm và hiển thị thành công. Kiểm tra thêm hết hạn, giao dịch cần đối soát và gói chưa có lớp mở. Mã QR và khoản thu sử dụng dữ liệu thử nghiệm.
- **Đăng nhập → lịch → vào lớp.** Xác minh OTP qua hộp thư tổng hợp, chọn khóa học, kiểm tra buổi tiếp theo và mở link lớp thử nghiệm trong tab mới.
- **Liên hệ và Admin.** Chọn Thủ Đức, mở chat và xác nhận tin nhắn nháp có tên chi nhánh. Đăng nhập Admin, lọc Python bằng bàn phím, tải lịch sử qua API và đóng bằng Escape. Trên điện thoại, Escape cũng đóng menu và trả focus về nút mở menu.
- **Hồi quy Student và Admin.** Kiểm tra lỗi tải thông báo, thử lại, tạo và tải hóa đơn mô phỏng, cùng phạm vi chi nhánh của các màn hình tài chính và đối soát.
- **Chuyển động.** Kiểm tra chuyển động khi cuộn của danh mục và liên hệ ở 1440, 768 và 390 px. Bật tùy chọn giảm chuyển động và kiểm tra hiệu ứng dừng.

Danh sách chi nhánh lấy từ seed Org của dự án. Lựa chọn được điền vào tin nhắn tư vấn để người dùng xem lại trước khi gửi. API lịch học hiện có giờ học và link lớp. Mục tài liệu chưa xuất hiện vì API chưa có dữ liệu tài liệu.

Build production, lint, typecheck và 15 test Portal đã qua. Hai ca tích hợp chạy bằng `node scripts/test-n8n06.mjs --case=SELF-REGISTRATION` và `node scripts/test-n8n06.mjs --case=PORTAL-PAYMENT-DEMO`.
