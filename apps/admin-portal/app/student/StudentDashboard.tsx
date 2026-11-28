"use client";

import Link from "next/link";
import type { ClassEvent, Enrollment } from "../../lib/student-portal";
import { classEvents, courseStatus, dayKey, offerFor, practiceSchedules, registrationCode } from "../../lib/student-portal";
import { dateTime } from "../../lib/services/classes";
import CourseCover from "../khoa-hoc/CourseCover";
import HubIcon from "../dashboard/components/HubIcon";
import OrbitArt from "../ui/OrbitArt";
import { useStudent } from "./StudentShell";
import { useDeviceLearning } from "./learning-device";
import { LearningActivity, learningRows } from "./StudentProgress";
import type { StudyCourse } from "./StudentLearning";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";
import { useLibrary, useOffers, useSchedules, useStudentClock, useStudentResource } from "./portal-data";
import "../khoa-hoc/courses.css";

export function ClassRow({ event }: { event: ClassEvent }) {
  const { schedule, startsAt, endsAt } = event;
  const href = schedule.practiceCourseCode ? `/student/hoc-lieu/${schedule.practiceCourseCode}` : `/student/khoa-hoc/${schedule.enrollmentId}#student-study`;
  const mode = schedule.mode === "practice" ? "Tự học" : schedule.mode === "online" ? "Trực tuyến" : schedule.roomName ?? "Tại phòng";
  const date = dayKey(startsAt);
  const clock = (value: string) => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
  return <article className="sp-class-row">
    <time className="sp-date-block" dateTime={startsAt}><strong>{date.slice(8)}</strong><span>Tháng {Number(date.slice(5, 7))}</span></time>
    <div><Link href={href}>{schedule.name}</Link>
      <p>{clock(startsAt)} – {clock(endsAt)} · {mode}</p>
    </div>
    {schedule.onlineUrl?.startsWith("https://") && <a className="sp-button" href={schedule.onlineUrl} target="_blank" rel="noreferrer">Vào lớp <span aria-hidden="true">↗</span></a>}
  </article>;
}

export default function StudentDashboard() {
  const { account, notices } = useStudent();
  const enrollments = useStudentResource<Enrollment[]>("student/enrollments");
  const offers = useOffers();
  const library = useLibrary<StudyCourse[]>();
  const device = useDeviceLearning(account.id);
  const lessons = learningRows(library.data ?? [], device.data);
  const schedules = useSchedules(enrollments.data);
  const now = useStudentClock();
  const events = classEvents([...(schedules.schedules ?? []), ...practiceSchedules(library.data ?? [])]);
  const upcoming = events.filter(event => Date.parse(event.endsAt) > now);
  const enrolled = enrollments.data ?? [];
  const active = enrolled.filter(row => ["Đang học", "Chờ khai giảng"].includes(courseStatus(row, undefined, now)));
  const complete = enrolled.filter(row => row.currentEntitlement.state === "COMPLETED");
  const catalog = offers.data ?? [];
  const suggestions = catalog.filter(offer => offer.sellable && !enrolled.some(row => row.snapshot.courseId === offer.courseId))
    .filter((offer, index, rows) => rows.findIndex(row => row.courseId === offer.courseId) === index).slice(0, 2);
  const next = upcoming[0];
  const first = [...lessons].sort((a, b) => (b.record?.at ?? 0) - (a.record?.at ?? 0))[0]?.course;
  const total = lessons.reduce((count, row) => count + row.course.lessonIds.length, 0);
  const done = lessons.reduce((count, row) => count + row.completed.length, 0);
  const today = new Date(now);
  const day = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(today);
  const scheduleLoading = !enrollments.error && (!enrollments.data || Boolean(active.length && !schedules.schedules));

  return <>
    <div className="sp-welcome orbit-hero"><OrbitArt />
    <StudentHeading title={`Chào ${account.name || "bạn"}!`} subtitle={day}>
      <Link className="sp-button" href="/student/thong-bao"><HubIcon name="bell" size={17} /> Thông báo</Link>
      <Link className="sp-button sp-primary" href="/khoa-hoc">Khám phá khóa học <HubIcon name="arrow" size={17} /></Link>
    </StudentHeading></div>
    <div className="sp-stats">
      {[
        ["Đang tham gia", enrollments.data ? active.length : "—", "/student/khoa-hoc", "courses"],
        ["Đã hoàn thành", complete.length || "—", "/student/tien-do", "progress"],
        ["Tiến độ trên thiết bị", total ? Math.round(done / total * 100) + "%" : "—", "/student/tien-do", "grid"],
        ["Thời gian học", "—", "/student/tien-do", "schedule"],
        ["Chứng chỉ", "—", "/student/chung-chi", "certificate"],
      ].map(([label, value, href, icon]) => <Link className="sp-stat" href={String(href)} key={label}>
        <span><HubIcon name={String(icon)} size={16} />{label}</span><strong>{value}</strong>
      </Link>)}
    </div>

    <div className="sp-dashboard">
      <StudentPanel title="Tiếp tục học" className="sp-span-8 sp-continue" href="/student/khoa-hoc" label="Khóa học của tôi">
        <ResourceState error={library.error} retry={library.reload} loading={!library.data && !next} />
        <div className="sp-continue-body">
          <div>
            <p className="sp-muted">{first ? "Học liệu của bạn" : next ? "Buổi học tiếp theo" : "Bắt đầu từ danh mục khóa học"}</p>
            <h3>{first?.courseName ?? next?.schedule.name ?? "Bạn muốn học kỹ năng nào tiếp theo?"}</h3>
            <p>{first ? first.goal : next ? dateTime(next.startsAt) : "Xem chương trình học và chọn lịch khai giảng phù hợp."}</p>
            <Link className="sp-button sp-primary" href={first ? `/student/hoc-lieu/${first.courseCode}` : next ? "/student/lich-hoc" : "/khoa-hoc"}>
              {first ? "Mở bài học" : next ? "Xem lịch học" : "Xem danh mục"} <HubIcon name="arrow" size={16} />
            </Link>
          </div>
          {(first || suggestions[0]) && <CourseCover code={first?.courseCode ?? suggestions[0].courseCode} />}
        </div>
      </StudentPanel>
      <StudentPanel title="Lịch sắp tới" className="sp-span-4" href="/student/lich-hoc" label="Xem lịch">
        <ResourceState error={enrollments.error} retry={enrollments.reload} loading={scheduleLoading} />
        {schedules.failed > 0 && <ResourceState error={new Error("Một số lịch lớp chưa tải được.")} retry={schedules.retry} />}
        {upcoming.slice(0, 2).map(event => <ClassRow key={event.schedule.classId + event.startsAt} event={event} />)}
        {!scheduleLoading && !enrollments.error && !schedules.failed && !upcoming.length && <StudentEmpty icon="schedule" title="Chưa có buổi học sắp tới" />}
      </StudentPanel>
      <StudentPanel title="Khóa học gần đây" className="sp-span-8" href="/student/khoa-hoc">
        <ResourceState error={enrollments.error} retry={enrollments.reload} loading={!enrollments.data} />
        {enrollments.data?.length === 0 && <StudentEmpty icon="courses" title="Bạn chưa đăng ký khóa học nào" />}
        {enrolled.slice(0, 3).map(row => {
          const offer = offerFor(row, catalog);
          return <Link className="sp-course-row" key={row.id} href={`/student/khoa-hoc/${row.id}`}>
            <CourseCover code={offer?.courseCode ?? ""} />
            <span><strong>{offer?.courseName ?? row.snapshot.className ?? row.snapshot.packageName ?? registrationCode(row.id)}</strong>
              <small>{registrationCode(row.id)} · {row.currentEntitlement.remainingSessions} buổi còn lại</small></span>
            <span className="sp-status" data-state={row.currentEntitlement.state}>{courseStatus(row, schedules.schedules?.find(item => item.enrollmentId === row.id), now)}</span>
            <HubIcon name="chevron" size={16} />
          </Link>;
        })}
      </StudentPanel>
      <StudentPanel title="Thông báo mới" className="sp-span-4" href="/student/thong-bao">
        <ResourceState error={notices.error} retry={notices.reload} loading={!notices.data} />
        {notices.data?.filter(notice => !notice.readAt).slice(0, 3).map(notice => <Link className="sp-notice-preview" key={notice.id} href={`/student/thong-bao#notice-${notice.id}`}>
          <span className="sp-unread-dot" /><span><strong>{notice.subject}</strong><small>{dateTime(notice.createdAt)}</small></span>
        </Link>)}
        {notices.data && !notices.data.some(notice => !notice.readAt) && <StudentEmpty icon="bell" title="Không có thông báo chưa đọc" />}
      </StudentPanel>
      <StudentPanel title="Hoạt động tự học" className="sp-span-6" href="/student/tien-do" label="Xem tiến độ">
        <ResourceState error={library.error} retry={library.reload} loading={!library.data} />
        {lessons.length > 0 ? <LearningActivity rows={lessons} /> : library.data && <StudentEmpty icon="progress" title="Chưa có bài tự học được cấp cho bạn" />}
      </StudentPanel>
      <StudentPanel title="Deadline bài tập" className="sp-span-6" href="/student/bai-tap">
        <StudentEmpty icon="audit" title="Chưa có dữ liệu bài tập" />
        <Link className="sp-text-link" href="/student/tien-do">Xem dữ liệu tiến độ <HubIcon name="arrow" size={15} /></Link>
      </StudentPanel>
      <StudentPanel title="Khóa học đề xuất" className="sp-span-12" href="/khoa-hoc" label="Toàn bộ danh mục">
        <ResourceState error={offers.error} retry={offers.reload} loading={!offers.data} />
        {suggestions.length > 0 ? <div className="sp-recommendations">{suggestions.map(offer => <Link className="sp-course-row" key={offer.packageId} href={`/khoa-hoc/${offer.packageId}`}>
          <CourseCover code={offer.courseCode} /><span><strong>{offer.courseName}</strong><small>{offer.sessionCount} buổi</small></span>
          <HubIcon name="chevron" size={16} />
        </Link>)}</div> : offers.data && <StudentEmpty icon="courses" title="Chưa có khóa học đề xuất" />}
      </StudentPanel>
      <div className="sp-span-12"><Link className="sp-text-link" href="/student/yeu-cau">Yêu cầu điều chỉnh và lời mời vào lớp <HubIcon name="arrow" size={16} /></Link></div>
    </div>
  </>;
}
