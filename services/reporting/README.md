# Reporting

Reporting giữ số liệu từng ngày và chi nhánh, thời điểm tổng hợp mỗi ngày và checkpoint từng event. [Định nghĩa chỉ số và bằng chứng](../../docs/acceptance-portal-wf11.md).

API đọc `GET /api/v1/reports?start=2026-11-01&end=2026-11-20&branchId=<uuid>` nhận kỳ tối đa 31 ngày. Giám đốc chi nhánh mặc định đọc các chi nhánh được cấp. Giám đốc trung tâm có thêm nhóm `branchId=unassigned`. `coveredDays` và `periodDays` biểu thị độ phủ của kỳ. Ngày đã tổng hợp đủ nguồn có thể có số liệu bằng 0.

## Chạy local

- Tạo DB và role riêng cho Reporting, sau đó chạy `npm run db:migrate -w @spacex/reporting`. Mặc định dịch vụ nghe cổng 4011.
- Cấu hình `DATABASE_URL`, các biến IAM dùng chung, `ENROLLMENT_URL`, `PAYMENT_URL` và một principal riêng qua `REPORTING_SOURCE_CLIENT_ID` và `REPORTING_SOURCE_CLIENT_SECRET`. IAM cấp scope `reporting:source` cho audience Enrollment và Payment, workflow WF‑11.
- Principal WF‑11 dùng `automation:claim`, `automation:result` tại Bridge và `reporting:project` tại Reporting. Bind `reporting.refresh_requested` version 1 tới WF‑11 version 1. Đặt `REPORTING_EVENTS_ENABLED=true` ở Enrollment và Payment khi đã có binding. Gateway dùng `REPORTING_URL`.
- Với kỳ đã có dữ liệu trước ngày bật event, gọi `POST /internal/reporting/rebuild` bằng token scope `reporting:project` và JSON `{"start":"2026-11-01","end":"2026-11-20"}`. Cùng API nhận `{}` để cron chạy ngày hôm trước lúc 02:15 Asia/Saigon. Rebuild đọc lại aggregate nguồn và thay kỳ trong một transaction. Enrollment giữ event `enrollment.confirmed` cho thời gian còn cần dựng lại báo cáo.
- Kiểm lại trong project tổng hợp mới bằng `node scripts/test-n8n06.mjs --case=REPORTING-SOURCE`. [Manifest Workflow](../../workflows/n8n/reporting-manifest.json).
