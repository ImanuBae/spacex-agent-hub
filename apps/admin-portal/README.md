## Admin Portal (`@spacex/admin-portal`)

Hệ thống quản trị viên (Admin Portal) được xây dựng trên nền tảng Next.js (App Router), TypeScript và Tailwind CSS, tích hợp mô hình dữ liệu cục bộ (`localStorage`) cho phép quản lý toàn diện các module vận hành.

### Các tính năng chính

- **Dashboard Overview**: Thống kê KPI trực quan và theo dõi hoạt động gần đây.
- **Courses**: Quản lý danh sách khóa học và lịch trình đào tạo.
- **Finance**: Quản lý tài chính, giao dịch và báo cáo doanh thu.
- **Mailbox**: Hệ thống hộp thư và trao đổi thông tin.
- **Leads**: Quản lý học viên tiềm năng và trạng thái đăng ký.
- **Organization**: Sơ đồ cấu trúc tổ chức, phòng ban và nhân sự.
- **Audit Logs**: Nhật ký hệ thống ghi nhận lịch sử thao tác của quản trị viên.

### Hướng dẫn cài đặt và chạy ứng dụng

1. **Cài đặt dependencies từ thư mục gốc monorepo:**
   ```bash
   npm install
   ```
2. Chạy môi trường phát triển (Development) cho Admin Portal:
   npm run dev

## Cấu hình Môi trường & Mock Mode

Ứng dụng hỗ trợ chế độ Mock (giả lập dữ liệu) phục vụ cho quá trình phát triển giao diện và kiểm thử độc lập mà chưa cần kết nối Backend đầy đủ.

### Cách cấu hình:

1. Tạo file `.env.local` tại thư mục `apps/admin-portal/`.
2. Khai báo biến cấu hình:
   ```env
# Bật/tắt chế độ Mock cho Admin Portal (true/false)
NEXT_PUBLIC_ENABLE_MOCK=true
NEXT_PUBLIC_API_URL=http://127.0.0.1:4001

   ```
