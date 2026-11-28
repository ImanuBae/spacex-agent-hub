"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lesson } from "../../lib/student-lessons";
import type { LibraryCourse } from "../../lib/student-portal";
import HubIcon from "../dashboard/components/HubIcon";
import CourseCover from "../khoa-hoc/CourseCover";
import { useLibrary } from "./portal-data";
import { useDeviceLearning } from "./learning-device";
import { useStudent } from "./StudentShell";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";
import StudentQuiz, { type QuizQuestion } from "./StudentQuiz";
import "../khoa-hoc/courses.css";

export type StudyCourse = LibraryCourse & { lessonIds: string[] };
type DetailedCourse = StudyCourse & { lessons: Lesson[]; quiz?: QuizQuestion[] };

export default function StudentLearning({ code, lessonId }: { code?: string; lessonId?: string }) {
  const { account } = useStudent();
  const device = useDeviceLearning(account.id);
  const library = useLibrary<StudyCourse[] | DetailedCourse>(code);
  const courses = Array.isArray(library.data) ? library.data : undefined;
  const current = !Array.isArray(library.data) ? library.data : undefined;
  if (code) return <>
    <Link className="sp-back" href="/student/hoc-lieu">← Học liệu</Link>
    <ResourceState error={library.error} retry={library.reload} loading={!current} label="Đang kiểm tra quyền học liệu…" />
    {current && <LessonReader key={current.courseCode} course={current} lessonId={lessonId} device={device} />}
  </>;
  return <>
    <StudentHeading title="Học liệu" subtitle="Bài đọc, video tham khảo và tệp thực hành đã được cấp quyền." />
    <ResourceState error={library.error} retry={library.reload} loading={!courses} />
    {courses?.length === 0 && <StudentEmpty icon="folder" title="Bạn chưa được cấp quyền học liệu">
      <Link href="/student/khoa-hoc" className="sp-text-link">Xem khóa học của tôi <HubIcon name="arrow" size={15} /></Link>
    </StudentEmpty>}
    <div className="sp-course-grid">
      {courses?.map(course => {
        const record = device.data[course.courseCode];
        const done = course.lessonIds.filter(id => record?.lessons[id]?.completed).length;
        return <article key={course.courseCode} className="sp-course-card">
          <CourseCover code={course.courseCode} />
          <div className="sp-card-info"><h2>{course.courseName}</h2><p>{course.goal}</p>
            {course.lessonIds.length > 0 && <p>{done}/{course.lessonIds.length} bài đã đánh dấu trên thiết bị</p>}
            <Link className="sp-button" href={`/student/hoc-lieu/${course.courseCode}`}>
              {record?.last ? "Tiếp tục học" : "Mở học liệu"} <HubIcon name="arrow" size={16} />
            </Link>
          </div>
        </article>;
      })}
    </div>
  </>;
}

function LessonReader({ course, lessonId, device }: { course: DetailedCourse; lessonId?: string; device: ReturnType<typeof useDeviceLearning> }) {
  const [tab, setTab] = useState("content");
  const [status, setStatus] = useState("");
  const record = device.data[course.courseCode];
  const lesson = course.lessons.find(item => item.id === (lessonId ?? record?.last)) ?? course.lessons[0];
  const base = `/student/hoc-lieu/${course.courseCode}`;
  const done = course.lessons.filter(item => record?.lessons[item.id]?.completed).length;
  const saveOnDevice = device.save;
  const activeId = !lessonId || lesson?.id === lessonId ? lesson?.id : undefined;
  useEffect(() => {
    if (activeId) saveOnDevice(course.courseCode, activeId);
  }, [activeId, course.courseCode, saveOnDevice]);

  if (!lesson) return <>
    <StudentHeading title={course.courseName} subtitle={course.goal} />
    <StudentEmpty icon="folder" title="Khóa học chưa có bài giảng trong cổng học viên">
      <Link className="sp-text-link" href={`/khoa-hoc/${course.packageId}`}>Xem chương trình công khai →</Link>
    </StudentEmpty>
  </>;
  if (lessonId && lesson.id !== lessonId) return <StudentEmpty title="Không tìm thấy bài học"><Link href={base}>Về đề cương</Link></StudentEmpty>;

  const index = course.lessons.indexOf(lesson);
  const saved = record?.lessons[lesson.id];
  const tabs = [
    ["content", "Bài giảng"],
    ...(lesson.video ? [["video", "Video"]] : []),
    ["resources", "Tài nguyên"],
    ...(course.quiz?.length ? [["quiz", "Quiz tự luyện"]] : []),
    ["notes", "Ghi chú"],
  ];
  const selectedTab = tabs.some(([key]) => key === tab) ? tab : "content";
  function save(id: string, patch?: Parameters<typeof device.save>[2]) {
    setStatus(device.save(course.courseCode, id, patch) ? "" : "Không thể lưu trên trình duyệt này.");
  }
  function go() { setTab("content"); }
  function download() {
    if (!lesson.download) return;
    const url = URL.createObjectURL(new Blob([lesson.download.content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = lesson.download.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <StudentHeading title={course.courseName} subtitle="Học liệu tự học" />
    <div className="sp-lesson-layout">
      <section className="sp-panel sp-lesson-content" aria-label={lesson.title}>
        <p className="sp-muted">Bài {index + 1} / {course.lessons.length} · Bài đọc & thực hành</p>
        <h2>{lesson.title}</h2>
        <nav className="sp-lesson-tabs" aria-label="Nội dung bài học">
          {tabs.map(([key, label]) =>
            <button key={key} className="sp-button" aria-pressed={key === selectedTab} onClick={() => setTab(key)}>{label}</button>)}
        </nav>
        {selectedTab === "content" && <>
          <p>{lesson.body}</p>
          {lesson.example && <pre tabIndex={0}><code>{lesson.example}</code></pre>}
          <h3>Thực hành</h3><p>{lesson.practice}</p>
        </>}
        {selectedTab === "video" && lesson.video && <div className="sp-lesson-video">
          <iframe src={lesson.video.embed} title={lesson.video.title} allowFullScreen
            allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
          <a className="sp-text-link" href={lesson.video.source} target="_blank" rel="noreferrer">Xem tại CS50P · Video tiếng Anh ↗</a>
        </div>}
        {selectedTab === "quiz" && course.quiz && <StudentQuiz course={course.courseCode} questions={course.quiz} />}
        {selectedTab === "resources" && <>
          {lesson.resources?.map(item => <a className="sp-text-link sp-block-link" key={item.href} href={item.href} target="_blank" rel="noreferrer">{item.title} ↗</a>)}
          {lesson.download && <button className="sp-button" type="button" onClick={download}>Tải {lesson.download.name}</button>}
          {!lesson.resources?.length && !lesson.download && <p className="sp-muted">Bài học này chưa có tài nguyên bổ sung.</p>}
        </>}
        {selectedTab === "notes" && <label className="sp-note"><span>Ghi chú cá nhân · lưu trên trình duyệt này</span>
          <textarea key={lesson.id} defaultValue={saved?.note ?? ""} maxLength={5000} rows={6} onChange={event => save(lesson.id, { note: event.target.value })} />
        </label>}
        {status && <p role="alert">{status}</p>}
        <div className="sp-lesson-footer">
          <button className="sp-button" aria-pressed={Boolean(saved?.bookmarked)} onClick={() => save(lesson.id, { bookmarked: !saved?.bookmarked })}>
            {saved?.bookmarked ? "Đã đánh dấu" : "Đánh dấu bài"}
          </button>
          <button className="sp-button sp-primary" aria-pressed={Boolean(saved?.completed)} onClick={() => save(lesson.id, { completed: !saved?.completed })}>
            {saved?.completed ? "Đã học xong" : "Đánh dấu đã học xong"}
          </button>
        </div>
        <div className="sp-lesson-footer">
          {index > 0 && <Link className="sp-text-link" href={`${base}/${course.lessons[index - 1].id}`} onClick={go}>← Bài trước</Link>}
          {index + 1 < course.lessons.length && <Link className="sp-text-link" href={`${base}/${course.lessons[index + 1].id}`} onClick={go}>Bài tiếp theo →</Link>}
        </div>
      </section>
      <StudentPanel title="Chương trình học">
        <p className="sp-muted">{done}/{course.lessons.length} bài đã đánh dấu trên thiết bị</p>
        <progress value={done} max={course.lessons.length} aria-label="Tiến độ tự học trên thiết bị" />
        <ol className="sp-lesson-list">
          {course.lessons.map((item, position) => <li key={item.id}>
            <Link href={`${base}/${item.id}`} aria-current={item.id === lesson.id ? "page" : undefined} onClick={go}>
              <span>{record?.lessons[item.id]?.completed ? <HubIcon name="check" size={16} /> : position + 1}</span>{item.title}
              {record?.lessons[item.id]?.completed && <span className="sr-only"> · Đã học xong</span>}
              {record?.lessons[item.id]?.bookmarked && <HubIcon name="bookmark" size={16} />}
            </Link>
          </li>)}
        </ol>
      </StudentPanel>
    </div>
  </>;
}
