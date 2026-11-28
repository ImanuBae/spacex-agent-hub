"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PublicOffer } from "@spacex/contracts";
import { courseStatus, offerFor, orderStatuses, registrationCode, type Enrollment, type LibraryCourse } from "../../lib/student-portal";
import { dateTime } from "../../lib/services/classes";
import CourseCover from "../khoa-hoc/CourseCover";
import HubIcon from "../dashboard/components/HubIcon";
import StudentStudy from "./StudentStudy";
import { useStudent } from "./StudentShell";
import type { StudyCourse } from "./StudentLearning";
import { useDeviceLearning } from "./learning-device";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";
import { useLibrary, useOffers, useSchedules, useStudentClock, useStudentResource } from "./portal-data";
import "../khoa-hoc/courses.css";

const pageSize = 9;
const grantState = "Được cấp quyền học liệu";
const categories = [
  { label: "Tin học văn phòng", match: /word|excel|powerpoint|mos|ic3|văn phòng/i },
  { label: "Lập trình & dữ liệu", match: /python|sql|power bi/i },
  { label: "AI & tự động hóa", match: /\bai\b|automation|tự động/i },
  { label: "Thiết kế", match: /figma|thiết kế/i },
];
const courseCategory = (name: string) => categories.find(category => category.match.test(name))?.label ?? "Khác";

function CourseCard({ row, offer, state, study }: {
  row: Enrollment; offer?: PublicOffer; state: string; study?: { code: string; done: number; total: number };
}) {
  const title = offer?.courseName ?? row.snapshot.className ?? row.snapshot.packageName ?? registrationCode(row.id);
  const href = "/student/khoa-hoc/" + row.id;
  const payment = row.status === "HELD";
  const action = payment ? { label: "Thanh toán", href: "/student/thanh-toan/" + row.id }
    : study ? { label: "Tiếp tục học", href: "/student/hoc-lieu/" + study.code } : { label: "Xem khóa học", href };
  return <article className="sp-course-card">
    <Link className="sp-card-cover" aria-label={title} href={href}><CourseCover code={offer?.courseCode ?? ""} /></Link>
    <div className="sp-card-info">
      <span className="sp-status" data-state={row.currentEntitlement.state}>{state}</span>
      <h2><Link href={href}>{title}</Link></h2>
      <p>{courseCategory(title)} · {registrationCode(row.id)}</p>
      <p>{row.currentEntitlement.remainingSessions} buổi còn lại{row.currentEntitlement.expiresAt && ` · Đến ${dateTime(row.currentEntitlement.expiresAt)}`}</p>
      {study && <p>{study.done}/{study.total} bài tự học đã đánh dấu trên thiết bị</p>}
      <Link className="sp-button" href={action.href}>
        {action.label} <HubIcon name="arrow" size={16} />
      </Link>
    </div>
  </article>;
}

export default function StudentCourses() {
  const { account } = useStudent();
  const enrollments = useStudentResource<Enrollment[]>("student/enrollments");
  const offers = useOffers();
  const library = useLibrary<StudyCourse[]>();
  const device = useDeviceLearning(account.id);
  const { schedules } = useSchedules(enrollments.data);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState("new");
  const [list, setList] = useState(false);
  const [page, setPage] = useState(1);
  const now = useStudentClock();
  const normalized = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
  const courses = (enrollments.data ?? []).map(row => {
    const offer = offerFor(row, offers.data ?? []);
    const title = offer?.courseName ?? row.snapshot.className ?? row.snapshot.packageName ?? registrationCode(row.id);
    const material = library.data?.find(item => item.courseCode === offer?.courseCode && item.lessonIds.length);
    const study = material && {
      code: material.courseCode,
      total: material.lessonIds.length,
      done: material.lessonIds.filter(id => device.data[material.courseCode]?.lessons[id]?.completed).length,
    };
    return { row, offer, title, study, status: courseStatus(row, schedules?.find(item => item.enrollmentId === row.id), now) };
  });
  const filtered = courses.filter(course => (!category || courseCategory(course.title) === category) && (!state || course.status === state) &&
    normalized(course.title + " " + registrationCode(course.row.id)).includes(normalized(query.trim())));
  const directGrants = library.data?.filter(item => item.lessonIds.length &&
    !courses.some(course => course.offer?.courseCode === item.courseCode && course.row.currentEntitlement.state === "ACTIVE")) ?? [];
  const matchingGrants = directGrants.filter(course => (!category || courseCategory(course.courseName) === category) &&
    (!state || state === grantState) && normalized(course.courseName).includes(normalized(query.trim())));
  const statusOptions = new Set([...courses.map(course => course.status), ...(directGrants.length ? [grantState] : [])]);
  if (sort === "name") filtered.sort((a, b) => a.title.localeCompare(b.title, "vi"));
  if (sort === "name") matchingGrants.sort((a, b) => a.courseName.localeCompare(b.courseName, "vi"));
  if (sort === "old") filtered.reverse();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  return <>
    <StudentHeading title="Khóa học của tôi" subtitle="Xem chương trình học, lớp đã đăng ký và quyền truy cập.">
      <Link href="/khoa-hoc" className="sp-button sp-primary">Khám phá khóa học <HubIcon name="arrow" size={16} /></Link>
    </StudentHeading>
    <div className="sp-filters">
      <label className="sp-search"><HubIcon name="search" size={17} /><input type="search" aria-label="Tìm khóa học" placeholder="Tìm theo tên hoặc mã đăng ký" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label><span>Danh mục</span><select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="">Tất cả danh mục</option>
        {[...categories.map(item => item.label), "Khác"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Trạng thái</span><select value={state} onChange={event => { setState(event.target.value); setPage(1); }}><option value="">Tất cả trạng thái</option>
        {[...statusOptions].map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Sắp xếp</span><select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="new">Mới nhất</option><option value="old">Cũ nhất</option><option value="name">Tên khóa học</option></select></label>
      <div className="sp-view" role="group" aria-label="Kiểu hiển thị">
        <button className="sp-icon-button" type="button" aria-label="Dạng lưới" aria-pressed={!list} onClick={() => setList(false)}><HubIcon name="grid" /></button>
        <button className="sp-icon-button" type="button" aria-label="Dạng danh sách" aria-pressed={list} onClick={() => setList(true)}><HubIcon name="list" /></button>
      </div>
    </div>
    <ResourceState error={enrollments.error} retry={enrollments.reload} loading={!enrollments.data} />
    <ResourceState error={offers.error} retry={offers.reload} />
    {enrollments.data && library.data && !filtered.length && !matchingGrants.length && <StudentEmpty icon="courses" title={courses.length || directGrants.length ? "Không tìm thấy khóa học phù hợp" : "Bạn chưa có khóa học nào"}>
      {courses.length === 0 && directGrants.length === 0 && <Link className="sp-text-link" href="/khoa-hoc">Xem danh mục <HubIcon name="arrow" size={15} /></Link>}
    </StudentEmpty>}
    <div className="sp-course-grid" data-view={list ? "list" : "grid"}>
      {filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(({ row, offer, status, study }) => <CourseCard key={row.id} row={row} offer={offer} state={status} study={study} />)}
    </div>
    {totalPages > 1 && <nav className="sp-pagination" aria-label="Phân trang khóa học">
      <button className="sp-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Trang trước</button>
      <span>Trang {currentPage} / {totalPages}</span>
      <button className="sp-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Trang sau</button>
    </nav>}
    <ResourceState error={library.error} retry={library.reload} loading={!enrollments.data?.length && !library.data} label="Đang kiểm tra quyền học liệu…" />
    {matchingGrants.length > 0 && <StudentPanel className="sp-stack-panel" title="Khóa học được cấp quyền">
      {matchingGrants.map(course => <Link key={course.courseCode} className="sp-course-row" href={`/student/hoc-lieu/${course.courseCode}`}>
        <CourseCover code={course.courseCode} />
        <span><strong>{course.courseName}</strong>
          <small>{course.lessonIds.length} bài tự học{course.practiceSessions?.length ? ` · ${course.practiceSessions.length} buổi trải nghiệm` : ""}</small></span>
        <span className="sp-text-link">Mở học liệu <HubIcon name="arrow" size={15} /></span>
      </Link>)}
    </StudentPanel>}
  </>;
}

export function StudentCourseDetail({ id }: { id: string }) {
  const enrollment = useStudentResource<Enrollment>("student/enrollments/" + id);
  const offers = useOffers();
  const library = useLibrary<LibraryCourse[]>();
  const row = enrollment.data;
  const enrollmentRows = useMemo(() => row ? [row] : [], [row]);
  const offer = row && offerFor(row, offers.data ?? []);
  const materials = offer && library.data?.find(course => course.courseCode === offer.courseCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const now = useStudentClock();
  async function change(action: () => Promise<unknown>) {
    setBusy(true); setError(undefined);
    try { await action(); enrollment.reload(); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <>
    <Link href="/student/khoa-hoc" className="sp-back">← Khóa học của tôi</Link>
    <StudentHeading title={offer?.courseName ?? row?.snapshot.className ?? row?.snapshot.packageName ?? "Chi tiết khóa học"}
      subtitle={row ? registrationCode(row.id) : undefined}>
      {materials && <Link className="sp-button sp-primary" href={`/student/hoc-lieu/${materials.courseCode}`}>Mở học liệu <HubIcon name="arrow" size={16} /></Link>}
      {row?.status === "HELD" && <Link className="sp-button sp-primary" href={`/student/thanh-toan/${id}`}>Thanh toán</Link>}
    </StudentHeading>
    <ResourceState error={enrollment.error} retry={enrollment.reload} loading={!row} />
    {row && <div className="sp-detail-grid">
      <StudentPanel title="Thông tin khóa học">
        <CourseCover code={offer?.courseCode ?? ""} />
        <dl className="sp-details">
          <dt>Trạng thái quyền học</dt><dd>{courseStatus(row, undefined, now)}</dd>
          <dt>Đăng ký</dt><dd>{orderStatuses[row.status] ?? row.status}</dd>
          <dt>Lớp / gói học</dt><dd>{[row.snapshot.className, row.snapshot.packageName].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Buổi còn lại</dt><dd>{row.currentEntitlement.remainingSessions}</dd>
          <dt>Hạn truy cập</dt><dd>{row.currentEntitlement.expiresAt ? dateTime(row.currentEntitlement.expiresAt) : "—"}</dd>
        </dl>
        {offer?.description && <p>{offer.description}</p>}
        {offer?.goal && <><h3>Mục tiêu học tập</h3><p>{offer.goal}</p></>}
        {offer && <Link className="sp-text-link" href={`/khoa-hoc/${offer.packageId}`}>Chương trình công khai <HubIcon name="arrow" size={15} /></Link>}
      </StudentPanel>
      <div className="ops sp-operations">
        <ResourceState error={error} />
        <StudentStudy enrollments={enrollmentRows} busy={busy || enrollment.refreshing} run={change} />
      </div>
      <StudentPanel title="Học liệu và điều kiện hoàn thành">
        <ResourceState error={library.error} retry={library.reload} loading={!library.data} />
        {materials ? <Link className="sp-text-link" href={`/student/hoc-lieu/${materials.courseCode}`}>Xem đề cương và tài liệu <HubIcon name="arrow" size={15} /></Link>
          : library.data && <p className="sp-muted">Chưa có học liệu được cấp cho khóa này.</p>}
        <p className="sp-muted">Điều kiện hoàn thành và cấp chứng chỉ sẽ hiển thị khi khóa học có cấu hình đánh giá.</p>
      </StudentPanel>
    </div>}
  </>;
}
