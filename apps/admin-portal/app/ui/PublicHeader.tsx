import Link from "next/link";
import Brand from "../landing/Brand";
import "./public.css";

export default function PublicHeader({ current, backdrop = false }: { current: "courses" | "contact"; backdrop?: boolean }) {
  return <header className="public-header">
    <nav className="public-frame" aria-label="Điều hướng chính">
      <Brand />
      {!backdrop && <>
        <div className="public-nav">
          <Link href="/khoa-hoc" aria-current={current === "courses" ? "page" : undefined}>Khóa học</Link>
          <Link href="/lien-he" aria-current={current === "contact" ? "page" : undefined}>Liên hệ</Link>
        </div>
        <Link className="btn btn-ghost" href="/student/login">Cổng học viên</Link>
      </>}
    </nav>
  </header>;
}
