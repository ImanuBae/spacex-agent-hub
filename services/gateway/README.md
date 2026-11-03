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
