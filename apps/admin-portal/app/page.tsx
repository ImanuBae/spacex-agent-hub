import type { Metadata } from "next";
import Landing from "./landing/Landing";

export const metadata: Metadata = {
  title: "Khóa học và tư vấn demo | SpaceX Agent Hub",
  description:
    "Xem khóa học mẫu, học phí và số buổi. Hỏi thêm qua chat tư vấn.",
  openGraph: {
    title: "Khóa học và tư vấn demo | SpaceX Agent Hub",
    description:
      "Xem khóa học mẫu và thử tìm gói phù hợp với chủ đề, ngân sách của bạn.",
    locale: "vi_VN",
    type: "website",
  },
};

export default function Home() {
  return <Landing />;
}
