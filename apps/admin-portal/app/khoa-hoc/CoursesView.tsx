import type { PublicClass, PublicOffer } from "@spacex/contracts";
import Link from "next/link";
import { connection } from "next/server";
import { gatewayFetch } from "../../lib/server-session";
import PublicHeader from "../ui/PublicHeader";
import { inter } from "../ui/fonts";
import DemoCatalog from "./DemoCatalog";
import { coursePreview } from "./course-previews";
import "../landing/landing.css";
import "../ui/theme.css";
import "./courses.css";

export default async function CoursesView({ backdrop = false }: { backdrop?: boolean }) {
  const Content = backdrop ? "div" : "main";
  const Title = backdrop ? "p" : "h1";
  let offers: PublicOffer[] | null = null;
  if (!backdrop) {
    await connection();
    try {
      const response = await gatewayFetch("/api/v1/public-offers");
      if (response.ok) offers = (await response.json()).data;
    } catch { /* The customer can still open the consultation. */ }
  }
  const nextClasses = Object.fromEntries(await Promise.all((offers ?? [])
    .filter(offer => offer.sellable && coursePreview(offer.courseCode))
    .map(async ({ packageId }) => {
      const response = await gatewayFetch(`/api/v1/public-checkouts/classes/${packageId}`).catch(() => null);
      const classes: PublicClass[] | null = response?.ok ? (await response.json()).data : null;
      const next = classes?.filter(cls => cls.availableSeats > 0 && cls.startsAt)
        .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0];
      return [packageId, next ?? null] as const;
    })));
  return (
    <div className={`ascend public-page course-page ${inter.className}`}>
      {!backdrop && <a className="skip-link" href="#course-main">Đến nội dung chính</a>}
      <PublicHeader current="courses" backdrop={backdrop} />
      <Content id="course-main" tabIndex={-1}>
        <div className="public-frame public-orbit course-intro">
          <Title className="public-display">Khám phá <em>khóa học</em></Title>
          <p>Chọn khóa học phù hợp với mục tiêu, lịch học và ngân sách của bạn.</p>
          {!backdrop && <a className="btn btn-outline" href="#course-results">Xem danh mục <span aria-hidden="true">↓</span></a>}
        </div>
        {offers ? <DemoCatalog catalog={offers} nextClasses={nextClasses} /> : !backdrop && <div className="public-frame public-status" id="course-results">
          <p role="alert">Chưa tải được danh sách khóa học.</p>
          <form action="/khoa-hoc"><button className="btn btn-outline" type="submit">Tải lại danh mục</button></form>
        </div>}
      </Content>
      {!backdrop && <footer className="public-footer"><div className="public-frame">
        <Link href="/lien-he">Cần gợi ý chọn khóa? Liên hệ tư vấn <span aria-hidden="true">↗</span></Link>
      </div></footer>}
    </div>
  );
}
