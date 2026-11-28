import PublicHeader from "../ui/PublicHeader";
import { inter } from "../ui/fonts";
import "../landing/landing.css";
import "../ui/theme.css";

export default function CourseLoading({ children }: { children: string }) {
  return <div className={`ascend public-page ${inter.className}`}>
    <PublicHeader current="courses" />
    <main className="public-frame public-status" aria-busy="true"><p role="status">{children}</p></main>
  </div>;
}
