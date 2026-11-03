# Landing page — hoàn thiện UI/UX

Ngày: 02/11/2026. Phạm vi: cải tiến landing hiện có trong repository, không xuất bản hosting.

## Hiểu sản phẩm

Agent Hub là công cụ nội bộ cho trung tâm tin học SpaceX Việt Nam giả định.
Người dùng chính của landing là nhân viên tuyển sinh và quản lý được cấp tài khoản.
Luồng trang: hiểu sản phẩm → thử lịch lớp/giữ chỗ mẫu → đăng nhập `/login`.
Không công bố AI, thanh toán hoặc Student Portal như chức năng đã hoàn thành.

Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 và Motion.
Backend hiện có gồm IAM, Org, Catalog, Class & Schedule và Gateway; landing không
phụ thuộc backend để hiển thị hoặc thử giữ/hủy chỗ.

Đã khảo sát README, product plan v2, tài liệu Portal, đánh giá landing trước,
cấu trúc route, landing, component minh họa, motion, CSS dùng chung và script QA.

## Hướng thiết kế

Giữ phong cách sản phẩm công nghiệp đen–trắng hiện có: chữ lớn, bề mặt phẳng,
nhịp bố cục sáng/tối, giao diện sản phẩm thay cho ảnh trang trí. Font hệ thống
hỗ trợ tiếng Việt và không cần tải font ngoài. Không thêm dependency.

Chất liệu của ý tưởng: SpaceX Việt Nam, chi nhánh Thủ Đức, vai trò tuyển sinh,
khóa/gói riêng biệt, lịch buổi tối/cuối tuần, phòng học, sức chứa, chỗ đã đăng ký,
chỗ giữ có thể hủy và tài khoản được quản lý cấp.

**Ý tưởng:** sức chứa và trạng thái chỗ học trở thành vật thể trình diễn cho
không gian điều phối tuyển sinh. Tương tác chính là chọn lớp, giữ và hủy một chỗ.

Giữ direction `borrowed-category` của bản có sẵn; lượt draw mới được lưu trong
`.local/landing-polish-direction/` để tham khảo. Không áp lại hero hoặc footer
ngẫu nhiên lên bố cục hiện có vì nhiệm vụ cũng yêu cầu tái sử dụng và giữ thay
đổi tập trung. Không sử dụng ảnh bầu trời được gợi ý: tên SpaceX ở đây là trung
tâm tin học, không phải sản phẩm hàng không vũ trụ.

Mỗi phần có một luận điểm và bằng chứng:

| Phần | Luận điểm | Bằng chứng |
| --- | --- | --- |
| Hero | Khóa học, lịch và chỗ nằm trong cùng một luồng | Workspace chọn/lọc lớp, giữ/hủy thao tác được |
| Quy trình | Tư vấn cần gói học và trạng thái chỗ rõ ràng | Fragment gói/giá và phiếu giữ chỗ có nhãn mẫu |
| Phạm vi | Quyền đi theo vai trò và chi nhánh | Fragment quyền truy cập có nhãn minh họa |
| FAQ | Người dùng hiểu demo và cách có tài khoản | Giải thích dữ liệu mẫu, phạm vi và lộ trình |
| CTA cuối | Nhân viên tiếp tục bằng tài khoản được cấp | Liên kết `/login` có sẵn |

## File chỉnh sửa trong lượt này

- `apps/admin-portal/app/landing/Landing.tsx`: nhóm CTA, thống nhất tên nút chính
  thành “Đăng nhập Agent Hub”, thêm liên kết “Thử giữ chỗ”.
- `apps/admin-portal/app/landing/ScheduleDemo.tsx`: thông báo theo lớp đang chọn;
  khi quay lại lớp đã giữ, thông báo phản ánh chỗ đang giữ; liên kết control với
  vùng chi tiết bằng `aria-controls`, thêm tên vùng và trạng thái nút giữ chỗ.
- `apps/admin-portal/app/landing/foundation.css`: token focus/hover, giữ tên sản
  phẩm trên một dòng.
- `apps/admin-portal/app/landing/landing.css`: bố cục CTA, hit area navigation,
  header 320px, heading co giãn, focus trên nền tối và nền lớp được chọn.
- `apps/admin-portal/app/page.tsx`: bổ sung Open Graph tiếng Việt, không bịa URL
  production hay ảnh chia sẻ.
- `scripts/test-landing-browser.mjs`: mở rộng chín viewport, kiểm hồi quy thông
  báo chuyển lớp và chỗ đã giữ; tùy chọn `--ui-only` để kiểm khi thiếu backend.
- Tài liệu này.

## Kiểm chứng

```powershell
npm run lint --workspace=@spacex/admin-portal
npm run typecheck --workspace=@spacex/admin-portal
npm test --workspace=@spacex/admin-portal
npm run build --workspace=@spacex/admin-portal
# Chạy trên Portal production đang phục vụ tại cổng kiểm thử:
node scripts/test-landing-browser.mjs http://localhost:3101 --ui-only
```

Lint, type-check, 15 unit test và production build qua. Browser regression qua
320, 375, 390, 430, 768, 1024, 1280, 1440 và 1920px: không tràn ngang;
giữ/hủy bằng Enter/Space, bộ đếm và sơ đồ nhất quán; chọn/lọc lớp; trở lại lớp
đã giữ; FAQ; reset khi reload; điều hướng login; input dưới dark preference;
hiện/ẩn mật khẩu. Reduced motion không có animation và các heading vẫn đọc được.
Khi tắt JavaScript, nội dung server-rendered và giải thích fallback vẫn hiển thị.

Ảnh và báo cáo máy nằm trong `.local/landing-polish-final/`;
browser regression trong `.local/landing-v2/browser-check.json`.

Inspector trên build cuối: **0 FAIL, 3 WARN**. Đã mở cả bảy ảnh desktop,
tablet và mobile. Playwright kiểm thêm tám viewport theo brief: h1/h2 tối đa
hai dòng, không tràn ngang, CTA trải nghiệm tới đúng vùng; không có console
error, runtime exception, HTTP response lỗi hoặc request `/api/session` trên
landing. Chrome có cảnh báo CSS preload chưa sử dụng trong vài giây; chưa
định lượng ảnh hưởng của cảnh báo này bằng audit hiệu năng.

Ba WARN thiết kế được giữ có chủ đích: không có ảnh/video vì bằng chứng là
bốn fragment sản phẩm, không có tư liệu cơ sở đã xác nhận; phép đo lệch lề
32/63px bắt cả inset trong fragment, trong khi `.lp-frame` có hai lề bằng nhau.
Hai WARN source lint là đường viền trạng thái chỗ trong fragment `data-ui`.

Đánh giá qua ảnh cuối: điểm nhìn đầu là headline và workspace sức chứa;
thứ tự bố cục split → fragment so le → nền tối → FAQ → wordmark. Tự đánh giá
design 8, usability 8, creativity 7, content 8; tổng trọng số 7,8/10, không phải
đánh giá độc lập. Ba giới hạn thị giác còn lại: minh họa vẫn gần phần mềm cùng
ngành, workspace nằm dưới phần giới thiệu trên điện thoại, và một số label
trong fragment nhỏ hơn body. Không thêm ảnh hoặc thay cấu trúc để nâng điểm
khi không có nội dung xác thực tương ứng.

## Giới hạn

Đây là kiểm UI trên Chrome desktop với viewport giả lập, chưa phải Safari,
iPhone vật lý, UAT nhân viên hay audit accessibility/performance độc lập.
Lượt này không chạy kiểm chứng credential IAM/Gateway; `--ui-only` ghi rõ phần
bị bỏ qua. Không thay đổi xác thực, API contract hoặc nghiệp vụ backend.

Giá, lịch và số chỗ minh họa giữ nhãn dữ liệu mẫu. Không thêm testimonial,
thành tích, khách hàng hoặc thông tin liên hệ chưa xác nhận. Không thêm ảnh/video
không liên quan chỉ để vượt chỉ tiêu media của công cụ chấm thiết kế.
