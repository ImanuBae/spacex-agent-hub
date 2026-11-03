import type { Metadata } from "next";
import Landing from "./landing/Landing";

export const metadata: Metadata = {
  title: "SpaceX Agent Hub — Điều phối tuyển sinh",
  description:
    "Không gian làm việc cho đội ngũ SpaceX Việt Nam: tra cứu khóa học, lịch lớp và giữ chỗ kỹ thuật trong môi trường demo theo vai trò, chi nhánh.",
  openGraph: {
    title: "SpaceX Agent Hub — Điều phối tuyển sinh",
    description:
      "Tra cứu khóa học, lịch lớp và chỗ giữ trong cùng một không gian làm việc cho đội ngũ SpaceX Việt Nam.",
    locale: "vi_VN",
    type: "website",
  },
};

export default function Home() {
  return <Landing />;
}
