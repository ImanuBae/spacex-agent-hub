"use client";

import Link from "next/link";
import { useStudent } from "./StudentShell";
import { StudentHeading, StudentPanel } from "./StudentUI";

export default function StudentAccount({ section }: { section: "profile" | "settings" | "security" }) {
  const { account, dark, toggleTheme } = useStudent();
  if (section === "profile") return <>
    <StudentHeading title="Hồ sơ học viên" subtitle="Thông tin tài khoản đã xác minh.">
      <Link className="sp-button" href="/student/cai-dat">Cài đặt tài khoản</Link>
    </StudentHeading>
    <StudentPanel title="Thông tin cá nhân">
      <dl className="sp-details"><dt>Họ và tên</dt><dd>{account.name}</dd><dt>Email đăng nhập</dt><dd>{account.email}</dd>
        <dt>Loại tài khoản</dt><dd>Học viên</dd><dt>Trạng thái</dt><dd>Đã xác minh</dd></dl>
      <Link className="sp-text-link" href="/student/ho-tro">Liên hệ để cập nhật thông tin →</Link>
    </StudentPanel>
  </>;
  if (section === "security") return <>
    <Link className="sp-back" href="/student/cai-dat">← Cài đặt tài khoản</Link>
    <StudentHeading title="Bảo mật" subtitle="Truy cập cổng học viên bằng mã xác minh qua email." />
    <StudentPanel title="Phương thức đăng nhập">
      <dl className="sp-details"><dt>Email</dt><dd>{account.email}</dd><dt>Xác minh</dt><dd>Mã dùng một lần</dd></dl>
      <p className="sp-muted">Dùng nút Đăng xuất để kết thúc phiên hiện tại. Nếu mất quyền truy cập email, liên hệ trung tâm để được xác minh.</p>
      <Link className="sp-text-link" href="/student/ho-tro">Yêu cầu hỗ trợ →</Link>
    </StudentPanel>
  </>;
  return <>
    <StudentHeading title="Cài đặt tài khoản" />
    <div className="sp-settings">
      <StudentPanel title="Giao diện">
        <div className="sp-setting"><div><h3>Chế độ tối</h3><p>Lưu lựa chọn trên trình duyệt này.</p></div>
          <button type="button" className="sp-switch" role="switch" aria-label="Chế độ tối" aria-checked={dark} onClick={toggleTheme}><span /></button>
        </div>
        <div className="sp-setting"><div><h3>Ngôn ngữ hiển thị</h3><p>Tiếng Việt</p></div></div>
      </StudentPanel>
      <div id="student-notice-settings"><StudentPanel title="Tùy chọn thông báo">
        <p>Thông báo đăng ký và lịch học được gửi theo lựa chọn đồng ý đã ghi nhận khi đăng ký.</p>
        <Link className="sp-text-link" href="/student/ho-tro">Liên hệ để thay đổi tùy chọn →</Link>
      </StudentPanel></div>
      <StudentPanel title="Quyền riêng tư">
        <p>Cổng học viên dùng phiên đã xác minh để hiển thị thông tin và lịch học của bạn.</p>
        <div className="sp-actions"><Link className="sp-text-link" href="/student/ho-so">Xem hồ sơ →</Link><Link className="sp-text-link" href="/student/cai-dat/bao-mat">Cài đặt bảo mật →</Link></div>
      </StudentPanel>
    </div>
  </>;
}
