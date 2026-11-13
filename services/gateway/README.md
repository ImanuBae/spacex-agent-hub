# API Gateway

Workspace `@spacex/gateway`, local :4000, không có DB.
Contract/cách chạy: [đợt 1](../../docs/huong-dan-dot-1.md).

Copy `.env.example` nếu chưa có; điền AUTH_SECRET chung và các URL backend.
Sau build: `npm start --workspace=@spacex/gateway`. Không chạy service-template
cùng cổng; root dev đã loại template.

Chỉ login/refresh/logout public; các API còn lại kiểm JWT và phiên IAM.
Gateway whitelist route đến IAM/Org/Catalog, chỉ chuyển các header cần thiết;
service vẫn kiểm quyền riêng. Upstream lỗi trả 502, IAM lỗi khi xác thực trả 503.
Rate limit/BFF aggregation đầy đủ của GW-2 thuộc đợt sau.

N8N-05: `ENROLLMENT_URL` (mặc định :4007) chỉ nhận GET danh sách/chi tiết
`enrollments`, GET `enrollment-confirmations/:id`, POST preview và confirm/revoke.
`PAYMENT_URL` (mặc định :4008) chỉ nhận GET `payment-requests`/`:id`.
Webhook tổng hợp và lệnh machine nội bộ không được forward. Mỗi backend vẫn
kiểm actor/session/branch/quyền sở hữu; Gateway không cấp quyền bằng body/header.

Portal `/dashboard/enrollments` dùng phiên BFF hiện hành: xem snapshot báo giá,
tick xác nhận rõ rồi gửi `accepted:true` cho đúng confirmation ID. Trang đọc lại
kết quả bền trước khi thử xác nhận sau lỗi kết nối, hiển thị tiền và chỗ riêng;
chỉ Enrollment `CONFIRMED` hiển thị đã xác nhận chỗ học. Nội dung QR `SYNTHETIC`
được ghi nhãn DEMO, không là QR ngân hàng hoặc hướng dẫn chuyển tiền thật.
