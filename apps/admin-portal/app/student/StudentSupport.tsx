import Link from "next/link";
import { StudentHeading, StudentPanel } from "./StudentUI";

const questions = [
  ["Tôi tìm mã đăng nhập ở đâu?", "Kiểm tra hộp thư đến và thư rác của địa chỉ đã xác minh. Nếu mã hết hạn, yêu cầu mã mới từ trang đăng nhập."],
  ["Tôi đã chuyển khoản, vì sao chưa vào được lớp?", "Mở Đơn hàng để cập nhật trạng thái. Nếu hệ thống đang đối soát hoặc đã quá hạn giữ chỗ, hãy giữ chứng từ và liên hệ trung tâm cùng mã đăng ký."],
  ["Tôi lấy link vào lớp ở đâu?", "Mở Lịch học và chọn buổi trực tuyến của lớp bạn đã được cấp quyền."],
  ["Tôi cần đổi lịch hoặc xác nhận lời mời vào lớp.", "Vào Yêu cầu và lời mời để xem các phương án và phản hồi trước hạn."],
];
export default function StudentSupport() {
  return <>
    <StudentHeading title="Trung tâm hỗ trợ" subtitle="Tra cứu cách xử lý hoặc liên hệ bộ phận tư vấn." />
    <div className="sp-detail-grid">
      <StudentPanel title="Câu hỏi thường gặp">
        {questions.map(([q, a]) => <details key={q} className="sp-faq"><summary>{q}</summary><p>{a}</p></details>)}
      </StudentPanel>
      <StudentPanel title="Liên hệ trung tâm">
        <p>Chọn cơ sở và gửi nội dung qua kênh tư vấn của trung tâm.</p>
        <Link className="sp-button sp-primary" href="/lien-he">Mở kênh liên hệ</Link>
        <Link className="sp-text-link sp-block-link" href="/student/yeu-cau">Yêu cầu và lời mời →</Link>
      </StudentPanel>
    </div>
  </>;
}
