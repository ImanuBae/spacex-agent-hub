# Org

Workspace `@spacex/org`, local :4003, database `org`.
Contract và hướng dẫn: [đợt 1](../../docs/huong-dan-dot-1.md).

Copy `.env.example` nếu chưa có, điền DATABASE_URL/AUTH_SECRET; từ root chạy
`npm run db:migrate --workspace=@spacex/org`, `npm run db:seed --workspace=@spacex/org`,
build rồi start workspace. Seed sáu đơn vị chạy lại không nhân đôi.

Org sở hữu branches/departments/employees, IAM sở hữu role/branchIds cấp quyền.
Access sync lưu pending/applied/rejected, retry giữ nguyên idempotency-key/payload.
API có lọc branch và quyền giảng viên theo accountId; không có auth bypass.
Kiểm tích hợp trong `services/identity/src/stage1.test.ts` bằng suite test:db của IAM.
