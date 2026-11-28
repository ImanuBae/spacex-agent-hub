import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { PublicClass, PublicOffer } from "@spacex/contracts";
import { gatewayFetch } from "../../../lib/server-session";
import { money } from "../../../lib/services/classes";
import { ChatButton } from "../../chat/ChatWidget";
import PublicHeader from "../../ui/PublicHeader";
import { inter } from "../../ui/fonts";
import { courseRoadmap, levels, modes } from "../course-roadmaps";
import OrbitArt from "../../ui/OrbitArt";
import CourseCover from "../CourseCover";
import CourseLoading from "../CourseLoading";
import Checkout from "./Checkout";
import "../../landing/landing.css";
import "../../ui/theme.css";
import "../courses.css";
import "./checkout.css";

export default function CoursePage({ params }: { params: Promise<{ packageId: string }> }) {
  return <Suspense fallback={<CourseLoading>Đang tải chi tiết gói học…</CourseLoading>}><CourseDetails params={params} /></Suspense>;
}

async function CourseDetails({ params }: { params: Promise<{ packageId: string }> }) {
  await connection();
  const { packageId } = await params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(packageId)) notFound();
  const response = await gatewayFetch(`/api/v1/public-offers/${packageId}`).catch(() => null);
  if (response?.status === 404) notFound();
  const offer: PublicOffer | null = response?.ok ? (await response.json()).data : null;
  const classResponse = offer ? await gatewayFetch(`/api/v1/public-checkouts/classes/${packageId}`).catch(() => null) : null;
  const classes: PublicClass[] | null = classResponse?.ok ? (await classResponse.json()).data : null;
  const roadmap = offer && courseRoadmap(offer.courseCode);

  return <div className={`ascend public-page course-page ${inter.className}`}>
    <a className="skip-link" href="#course-main">Đến nội dung chính</a>
    <PublicHeader current="courses" />
    <main className="public-frame course-content course-checkout" id="course-main" tabIndex={-1}>
      <Link className="offer-back" href="/khoa-hoc"><span aria-hidden="true">←</span> Tất cả khóa học</Link>
      {offer ? <>
        <header className="offer-hero orbit-hero">
          <OrbitArt />
          <div className="offer-heading">
            <p className="offer-package">{offer.packageName} · {levels[offer.level] ?? offer.level}</p>
            <h1 className="public-display">{offer.courseName}</h1>
            <p>{offer.description}</p>
            <dl className="offer-facts">
              <div><dt>Học phí</dt><dd>{money(offer.priceVnd)}</dd></div>
              <div><dt>Thời lượng</dt><dd>{offer.sessionCount} buổi</dd></div>
              <div><dt>Hình thức</dt><dd>{offer.deliveryModes.map(mode => modes[mode] ?? mode).join(" / ")}</dd></div>
            </dl>
            <div className="checkout-actions">
              <a className="btn btn-primary" href="#course-registration">Xem lịch lớp <span aria-hidden="true">↓</span></a>
              {roadmap && <a className="btn btn-outline" href="#offer-roadmap">Xem lộ trình <span aria-hidden="true">↓</span></a>}
            </div>
          </div>
          <CourseCover code={offer.courseCode} />
        </header>
        <div className="offer-body">
          <div className="offer-content">
            <section aria-labelledby="offer-goal">
              <h2 id="offer-goal">Bạn sẽ đạt được gì?</h2>
              {offer.goal && <p>{offer.goal}</p>}
              {roadmap && <ul className="offer-outcomes">
                {roadmap.outcomes.map(outcome => <li key={outcome}>{outcome}</li>)}
              </ul>}
            </section>
            {roadmap && <>
              <section id="offer-roadmap" aria-labelledby="offer-roadmap-title">
                <h2 id="offer-roadmap-title">Lộ trình học</h2>
                <ol className="offer-syllabus">
                  {roadmap.stages.map(({ title, description }) => <li key={title}><h3>{title}</h3><p>{description}</p></li>)}
                </ol>
              </section>
              <section aria-labelledby="offer-audience">
                <h2 id="offer-audience">Khóa học dành cho ai?</h2>
                <p>{roadmap.audience}</p>
              </section>
            </>}
          </div>
          <div id="course-registration" tabIndex={-1}><Checkout offer={offer} classes={classes} /></div>
        </div>
      </> : <section className="public-status">
        <h1 className="public-display">Chi tiết gói học</h1>
        <p role="alert">Chưa tải được gói học.</p>
        <a className="btn btn-outline" href={`/khoa-hoc/${packageId}`}>Tải lại gói học</a>
        <ChatButton className="btn btn-ghost">Hỏi tư vấn</ChatButton>
      </section>}
    </main>
  </div>;
}
