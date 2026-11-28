import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "../ui/PublicHeader";
import { inter } from "../ui/fonts";
import BranchConsultation from "./BranchConsultation";
import "../landing/landing.css";
import "../ui/theme.css";
import "./contact.css";

export const metadata: Metadata = {
  title: "Liên hệ | SpaceX Agent Hub",
  description: "Trao đổi qua chat về khóa học, học phí và chi nhánh bạn quan tâm.",
};

export default function ContactPage() {
  return <div className={`ascend public-page contact-page ${inter.className}`}>
    <a className="skip-link" href="#contact-main">Đến nội dung chính</a>
    <PublicHeader current="contact" />
    <main className="public-frame contact-main" id="contact-main" tabIndex={-1}>
      <div className="public-orbit contact-hero">
        <h1 className="public-display">Liên hệ <em>tư vấn</em></h1>
        <p>Trao đổi qua chat về nội dung khóa học, học phí và lịch của chi nhánh bạn quan tâm.</p>
      </div>
      <div className="contact-content">
        <section aria-labelledby="contact-chat-title">
          <h2 id="contact-chat-title">Chat với SpaceX Agent Hub</h2>
          <p>Chia sẻ mục tiêu học và khung giờ phù hợp để được tư vấn.</p>
          <BranchConsultation />
        </section>
        <section aria-labelledby="contact-student-title">
          <h2 id="contact-student-title">Bạn đã đăng ký học?</h2>
          <p>Vào cổng học viên để xem lịch lớp, thông báo và hóa đơn của bạn.</p>
          <Link className="btn btn-outline" href="/student/login">Vào cổng học viên <span aria-hidden="true">→</span></Link>
          <Link className="contact-text-link" href="/khoa-hoc">Xem danh mục khóa học <span aria-hidden="true">→</span></Link>
        </section>
      </div>
    </main>
  </div>;
}
