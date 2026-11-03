# Bàn giao phần CRM đang dở — 03/11/2026

Đối chiếu [bàn giao vòng 2](ban-giao-vong-2-2026-11-03.md) với working tree:
Catalog/Class/giờ rảnh đã có bằng chứng hoàn thành phạm vi vòng 2. Phần đang
làm tiếp là CRM: có service, migration, contract, Gateway/BFF và form nhưng
trang Lead vẫn dùng localStorage, các form chưa được gắn vào trang.

## Đã hoàn thiện trong lượt này

- `/dashboard/leads` dùng API CRM thật: tab lead, hồ sơ và yêu cầu xóa; bộ lọc
  chi nhánh/tìm khách/giai đoạn/phụ trách, trạng thái tải/rỗng/lỗi và thử lại.
- Tạo/sửa hồ sơ riêng CONTACT/LEARNER/PAYER, ghi nhận/thu hồi consent theo
  mục đích, liên kết học viên và xác minh quan hệ qua các form đã có.
- Tạo lead, nhận lead chưa phân công, cập nhật giai đoạn/ghi chú và quản lý phân
  công. Form sửa đọc lại detail đầy đủ, không gửi ghi chú rỗng từ list đã che.
- Yêu cầu xóa: nhân viên ghi nhận, quản lý xác minh/ẩn danh CRM, ghi nhận bằng
  chứng từng nơi. Chỉ COMPLETED khi tất cả task đã được xử lý hoặc có kết quả
  kiểm tra không áp dụng; không tự tuyên bố đã xóa service khác.
- Trang Tổng quan đọc lead CRM, hiển thị QUALIFIED là đủ nhu cầu, không gọi đó
  là đăng ký học. Lỗi CRM không hiển thị thành số 0.
- Bỏ banner bản mẫu tại trang CRM; giữ shell/type/palette Portal, dùng hướng
  Achromatic ledger đã có trong `.local/crm-design/direction.json` (seed
  20261104). Bỏ gradient trên scope trang CRM, dùng đường phân cách nhẹ; danh
  sách chuyển thành dòng dọc trên mobile. Không redraw, không thêm dữ liệu giả.
- Thêm lệnh `test:crm:browser`, nối kiểm thử CRM DB vào job CI PostgreSQL hiện
  có và [hướng dẫn service](../services/crm/README.md).

## Bằng chứng local

| Kiểm tra | Kết quả | Artifact local (không commit) |
| --- | --- | --- |
| Workspace lint/typecheck/unit/build | 56/56 tác vụ qua | `.local/crm-workspace-check.log` |
| CRM + PostgreSQL/IAM/Org/Catalog/Gateway | 10/10 test qua, không skip | `.local/crm-db-check.log` |
| Browser Portal production | Qua form hồ sơ/consent/lead, giữ ghi chú khi sửa, reload, quyền, xóa có xác minh và từng bằng chứng, lỗi service | `.local/crm-browser/result.json` |
| Giao diện 1440/768/390px | Không tràn trang; inspector 0 FAIL, 0 WARN | `.local/crm-design/inspection/report.json` |

Đã xem ảnh desktop/tablet/mobile và đối chiếu hướng thiết kế: hierarchy rõ,
biên danh sách/thao tác thẳng hàng, màu chủ yếu dành cho trạng thái chọn,
mobile giữ toàn bộ trường và thao tác. Dữ liệu kiểm thử chỉ có một lead nên
giữ khoảng trống đúng số liệu, không bịa số để lấp màn hình.

Suite tạo bốn DB UUID riêng và dọn DB/process do nó tạo; migration chạy hai
lần. PostgreSQL demo riêng cổng 55432 được khởi động lại vì Docker đang tắt.
Không sửa `.env`, tài khoản hoặc dữ liệu demo cũ; không chạy trên DB marketing.

Chạy lại: build trước, đặt CRM_TEST_DATABASE_URL trỏ PostgreSQL kiểm thử có
quyền CREATE DATABASE rồi chạy `npm run test:crm:db` và
`npm run test:crm:browser`. Đặt `CRM_INSPECT=1` để kèm inspector; cần Chrome/Edge
và skill design-taste-frontend local hoặc TASTE_SKILL_ROOT.

## Phạm vi còn lại

Đây là hoàn thiện luồng CRM đã bắt đầu, không đóng toàn bộ đợt 3 hoặc CRM-1
theo toàn plan: định danh kênh chat và liên kết Conversation chưa có, gộp hồ sơ
CRM-2/import CRM-5 nằm ngoài phạm vi. Enrollment/Payment/Notification và xử lý
xóa tự động xuyên service chưa được triển khai. Các task bên ngoài CRM hiện
theo dõi kết quả thủ công có bằng chứng. Chưa chạy CI remote, deploy production
hoặc customer UAT; chưa tự xác nhận C01–C12. Không tự commit working tree.
