import Link from "next/link";
import Brand from "../landing/Brand";
import HubIcon from "../dashboard/components/HubIcon";
import { inter } from "../ui/fonts";

const states = {
  "403": ["Bạn chưa có quyền truy cập", "Trang này yêu cầu tài khoản học viên hoặc quyền học tương ứng.", "/student/login", "Đăng nhập học viên"],
  "404": ["Không tìm thấy trang", "Địa chỉ có thể đã thay đổi hoặc nội dung đã được gỡ.", "/student", "Về tổng quan"],
  "500": ["Cổng học viên gặp sự cố", "Hãy thử tải lại trang trong ít phút.", "/student", "Về tổng quan"],
  "maintenance": ["Đang bảo trì", "Vui lòng thử truy cập lại sau.", "/", "Về trang chủ"],
  "offline": ["Bạn đang ngoại tuyến", "Kiểm tra kết nối mạng trước khi mở lại lịch học, học liệu hoặc đơn hàng.", "/student", "Mở lại cổng học viên"],
  "session-expired": ["Phiên đăng nhập đã hết hạn", "Yêu cầu mã xác minh mới để tiếp tục học.", "/student/login", "Đăng nhập lại"],
  "register": ["Đăng ký học", "Chọn khóa học và lịch khai giảng. Sau khi hệ thống xác nhận đăng ký, bạn có thể xác minh email để vào cổng học viên.", "/khoa-hoc", "Chọn khóa học"],
  "forgot-password": ["Khôi phục quyền truy cập", "Tài khoản học viên dùng mã xác minh gửi qua email. Nếu bạn còn truy cập hộp thư, hãy yêu cầu một mã mới.", "/student/login", "Nhận mã đăng nhập"],
  "reset-password": ["Nhận mã đăng nhập mới", "Học viên đăng nhập bằng email và mã dùng một lần. Hãy mở trang đăng nhập để yêu cầu mã xác minh.", "/student/login", "Về trang đăng nhập"],
  "verify-email": ["Xác minh email học viên", "Nếu vừa đăng ký lớp, hãy mở lại đơn trên tab đã dùng để đăng ký và yêu cầu mã xác minh. Nếu email đã xác minh, bạn có thể đăng nhập ngay.", "/student/login", "Đăng nhập học viên"],
} as const;

export function StudentState({ state, retry }: { state: keyof typeof states; retry?: () => void }) {
  const [title, description, href, label] = states[state];
  const stateCard = <section className="sp-auth-card">
    <HubIcon name={state === "register" ? "courses" : "help"} size={24} />
    <h1>{title}</h1><p>{description}</p>
    <div className="sp-actions">
      {retry && <button className="sp-button sp-primary" type="button" onClick={retry}>Thử lại</button>}
      <Link className={`sp-button ${retry ? "" : "sp-primary"}`} href={href}>{label} <HubIcon name="arrow" size={16} /></Link>
      {state === "verify-email" && <Link className="sp-button" href="/khoa-hoc">Tìm nơi đăng ký</Link>}
    </div>
    {["forgot-password", "reset-password", "maintenance", "verify-email"].includes(state) && <Link className="sp-text-link" href="/lien-he">Liên hệ trung tâm →</Link>}
  </section>;
  if (state === "404") return <div className={`hub-theme sp-auth ${inter.className}`}><Brand />{stateCard}</div>;
  return <main className={`hub-theme sp-auth ${inter.className}`}><Brand />{stateCard}</main>;
}
