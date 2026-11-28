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
import { coursePreview, levels, modes } from "../course-previews";
import CourseCover from "../CourseCover";
import CourseLoading from "../CourseLoading";
import PythonMaterials from "../PythonMaterials";
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
  const sample = offer && coursePreview(offer.courseCode);

  return <div className={`ascend public-page course-page ${inter.className}`}>
    <a className="skip-link" href="#course-main">Đến nội dung chính</a>
    <PublicHeader current="courses" />
    <main className="public-frame course-content course-checkout" id="course-main" tabIndex={-1}>
      <Link className="offer-back" href="/khoa-hoc"><span aria-hidden="true">←</span> Tất cả khóa học</Link>
      {offer ? <>
        <header className="offer-hero">
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
              {sample && <a className="btn btn-outline" href="#course-preview">Bài học thử</a>}
              {offer.courseCode === "DEMO-PYTHON" && <a className="btn btn-outline" href="#python-materials">Tài liệu và video</a>}
            </div>
          </div>
          <CourseCover code={offer.courseCode} />
        </header>
        <div className="offer-body">
          <div className="offer-content">
            <section aria-labelledby="offer-goal">
              <h2 id="offer-goal">Mục tiêu học</h2>
              <p>{offer.goal}</p>
              {sample && <p>{sample.audience}</p>}
            </section>
            {sample && <>
              <section aria-labelledby="offer-syllabus">
                <h2 id="offer-syllabus">Đề cương</h2>
                <ol className="offer-syllabus">{sample.syllabus.map(topic => <li key={topic}>{topic}</li>)}</ol>
              </section>
              <section className="offer-preview" id="course-preview" aria-labelledby="preview-title">
                <p className="offer-preview-label">Bài học thử · DEMO</p>
                <h2 id="preview-title">{sample.title}</h2>
                <p>{sample.lesson}</p>
                <details>
                  <summary>Xem ví dụ và kết quả</summary>
                  <pre tabIndex={0}><code>{sample.code}</code></pre>
                  <p>{sample.result}</p>
                </details>
              </section>
            </>}
            {offer.courseCode === "DEMO-PYTHON" && <PythonMaterials />}
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
