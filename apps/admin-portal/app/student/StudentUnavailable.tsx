import Link from "next/link";
import { StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";

const sections = {
  assignments: ["Bài tập", "Chưa hỗ trợ nộp bài qua cổng học viên", "Hỏi giảng viên về yêu cầu, hạn nộp và cách gửi bài.", "audit"],
  assignment: ["Chi tiết bài tập", "Chưa có dữ liệu bài tập qua cổng học viên", "Hỏi giảng viên về đề bài, tệp mẫu và kết quả chấm.", "audit"],
  exams: ["Kiểm tra & bài thi", "Quiz tự luyện có trong học liệu của khóa", "Hỏi trung tâm về lịch thi và hình thức đánh giá chính thức.", "exam"],
  exam: ["Bài thi", "Chưa hỗ trợ làm bài thi qua cổng học viên", "Liên hệ trung tâm để biết hình thức đánh giá của khóa.", "exam"],
  result: ["Kết quả bài thi", "Chưa có dữ liệu kết quả thi qua cổng học viên", "Liên hệ giảng viên để nhận kết quả.", "exam"],
  certificates: ["Chứng chỉ", "Chưa hỗ trợ cấp chứng chỉ qua cổng học viên", "Liên hệ trung tâm để kiểm tra điều kiện hoàn thành và nhận chứng chỉ.", "certificate"],
} as const;

export default function StudentUnavailable({ section }: { section: keyof typeof sections }) {
  const [title, message, detail, icon] = sections[section];
  return <>
    <StudentHeading title={title} />
    <StudentPanel title={title}>
      <StudentEmpty title={message} icon={icon}>
        <p>{detail}</p>
        <Link className="sp-text-link" href={section === "exams" ? "/student/hoc-lieu" : "/student/ho-tro"}>
          {section === "exams" ? "Mở học liệu →" : "Hỏi trung tâm →"}
        </Link>
      </StudentEmpty>
    </StudentPanel>
  </>;
}
