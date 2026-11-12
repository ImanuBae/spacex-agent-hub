# Bàn giao N8N-01 — local runtime

Ngày 04/11/2026, Asia/Ho_Chi_Minh. Người thực hiện: Codex trong workspace local;
reviewer con người: chưa review. Phạm vi theo [plan v3](product-plan-v3.md#43-ticket-mới-n8n).

Trạng thái: **LOCAL — N8N-01 đạt acceptance runtime local**, chưa nghiệm thu workflow nghiệp vụ.

Artifact:

- [Compose riêng](../infra/n8n/compose.yml), [role bootstrap](../infra/n8n/init.sql).
- [Script init/smoke](../scripts/n8n-local.mjs), [workflow tổng hợp](../workflows/n8n/runtime-smoke.json).
- [Runbook và credential map](../workflows/n8n/README.md).
- [Manifest/checksum](../workflows/n8n/manifest.json), [receipt đã che](../workflows/n8n/evidence.json).

Expected: n8n đúng pin chạy với PostgreSQL riêng, import/export JSON thực, workflow và credential
đọc được sau restart; không thay `.env` hoặc xóa dữ liệu có sẵn.

Actual: **6/6 nhóm assertion PASS**, chạy thực tế 13:44:29–13:46:19 ngày 04/11/2026 (+07:00),
project biệt lập `space-agent-n8n-smoke-d6f722f25211`, Linux amd64 qua Docker Desktop trên Windows.
Docker Engine 29.1.3 / Compose v2.40.3-desktop.1 / Node.js v24.2.0.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| Khởi động/version | PostgreSQL 17.7, n8n 2.46.4; cả hai healthy, HTTP readiness 200 |
| DB/user tách biệt | DB mới có 0 workflow/0 credential; role `n8n` không superuser/createdb/createrole |
| Import và credential | `N8N01Smoke`, credential `N8N01Postgres` lưu mã hóa; execution **1** query thật thành công |
| Export/import roundtrip | JSON export thật có SHA-256 trong receipt; import ID `N8N01Roundtrip`, execution **2** thành công |
| Restart cả DB và n8n | Còn đủ 2 workflow; ciphertext credential không đổi; execution **34** query thật thành công |
| Force-recreate cả hai container | Volume giữ workflow/credential; execution **35** query thật thành công |

Mỗi execution trả `{ "marker": "N8N-01", "db_user": "n8n" }` từ PostgreSQL thật qua node
`n8n-nodes-base.postgres` v2.6, nối Manual Trigger v1. Không chỉ kiểm tra export credential reference.
Không có job/event/correlation/operation ID nghiệp vụ trong smoke này vì Bridge chưa triển khai.
Workflow JSON trong Git lấy từ export thật, bỏ timestamp, project/owner và metadata instance;
giữ node, connection, setting, credential alias và versionId. Manifest lưu hash của bản này;
receipt lưu riêng hash raw export của lượt chạy cuối (hai file khác nhau có hash khác nhau).

Cả image tag và digest đã ghim trong Compose/manifest. Runtime chính `space-agent-n8n` đang chạy
healthy tại <http://localhost:5678>; chưa tạo owner thay người dùng. PostgreSQL không publish cổng.
Key/password cố định ở `.local/n8n/runtime.env`, volume chính là `space-agent-n8n_postgres_data`
và `space-agent-n8n_n8n_data`; không dùng volume/DB của stack hiện có.

`node --check`, Compose config validation, manifest checksum và scan secret sinh mới trong các
artifact runtime đều PASS. `init` chạy lặp giữ nguyên secret; SHA-256 của 7 `.env` cá nhân không đổi.
Toàn bộ container và volume tồn tại trước lượt làm việc vẫn còn; không chạy SQL vào DB nghiệp vụ,
không dùng `down -v` hoặc prune. Đây không phải checksum toàn bộ dữ liệu bên trong volume cũ.
`npm run check`: 56/56 thành công, **toàn bộ từ cache Turbo**; không thay thế test runtime n8n.

Trace source: base commit `1446702162e4c06db11cbdba44082a63238ac246`; thay đổi hiện tại chưa commit.
Receipt ghi SHA-256 Compose/bootstrap/script/fixture để xác định nội dung đã chạy trong working tree.
Chi tiết local ở `.local/n8n/space-agent-n8n-smoke-d6f722f25211/` gồm evidence, export và env riêng;
không commit thư mục đó. Container test đã `down`, volume và secret được giữ để kiểm tra lại.

Lịch sử kiểm chứng: lượt `0651ec1f156f` không đạt do pull image quá 300 giây; nhánh ghi log ban đầu
cũng vượt giới hạn command Windows. Đã sửa log ghi trực tiếp bằng filesystem, yêu cầu pull trước smoke,
dọn process Compose mồ côi và dừng đúng project test, giữ volume. Lượt `93c9c35bfcd0` đạt 6/6;
lượt cuối `d6f722f25211` chạy lại sau ghim digest và thêm execution IDs/checksum, đạt 6/6 như bảng.

Chưa kiểm: Bridge/machine principal/WF-01–12, API nghiệp vụ, provider/AI live, UI browser,
full backup/restore sang instance sạch, pruning sau 7 ngày và VPS/HTTPS. N01/N11 toàn hệ thống chưa đạt.
Key mới nằm trong file ignored `.local/n8n/runtime.env`; phải backup bảo mật ngoài repo trước khi dùng
credential quan trọng. Không commit secret, credential dump hoặc execution payload thật.
