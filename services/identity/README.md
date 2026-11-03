# Identity & Access

Workspace `@spacex/identity`, local :4002, database `identity_access`.
Contract, cấu hình, migration/seed và kiểm chứng:
[hướng dẫn đợt 1](../../docs/huong-dan-dot-1.md).

Copy `.env.example` nếu chưa có, điền DATABASE_URL, AUTH_SECRET và admin seed;
từ root chạy `npm run db:migrate --workspace=@spacex/identity`,
`npm run db:seed --workspace=@spacex/identity`, build rồi start workspace.
Seed không ghi đè mật khẩu/account đã tồn tại. Không dùng credential test cho vận hành.

Login/refresh/logout, phiên, role/branch và trạng thái account thuộc IAM.
Org chỉ gọi API IAM với quyền giám đốc hợp lệ, không ghi DB IAM.
`npm run test:db --workspace=@spacex/identity` bắt buộc STAGE1_TEST_DATABASE_URL;
suite dùng ba DB test ngẫu nhiên riêng, không chạy với server production.
