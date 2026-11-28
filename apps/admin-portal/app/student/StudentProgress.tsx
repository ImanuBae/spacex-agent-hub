"use client";

import { useState } from "react";
import Link from "next/link";
import { dayKey } from "../../lib/student-portal";
import { useStudent } from "./StudentShell";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";
import { useLibrary, useStudentClock } from "./portal-data";
import { useDeviceLearning } from "./learning-device";
import type { StudyCourse } from "./StudentLearning";

export function learningRows(courses: StudyCourse[], data: ReturnType<typeof useDeviceLearning>["data"]) {
  return courses.filter(course => course.lessonIds.length).map(course => {
    const record = data[course.courseCode];
    const completed = course.lessonIds.map(id => record?.lessons[id]).filter(lesson => lesson?.completed);
    return { course, record, completed };
  });
}

export function LearningActivity({ rows, days = 7 }: { rows: ReturnType<typeof learningRows>; days?: number }) {
  const today = useStudentClock();
  const byDay = new Map<string, number>();
  for (const { completed } of rows) {
    for (const lesson of completed) {
      if (typeof lesson?.completedAt !== "number" || !Number.isFinite(lesson.completedAt)) continue;
      const key = dayKey(new Date(lesson.completedAt));
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
  }
  const chart = Array.from({ length: days }, (_, index) => {
    const day = dayKey(new Date(today - (days - index - 1) * 86400000));
    return { day, count: byDay.get(day) ?? 0 };
  });
  const max = Math.max(1, ...chart.map(item => item.count));
  return <>
    <p className="sp-muted">Số bài đánh dấu đã học xong trên thiết bị</p>
    <div className="sp-week" data-days={days} aria-label="Hoạt động tự học">
      {chart.map(({ day, count }, index) => <div key={day} className="sp-week-day" title={`${day}: ${count} bài`} aria-label={`Ngày ${day}, ${count} bài`}>
        {days < 10 && <strong>{count}</strong>}
        <div><span style={{ height: `${Math.max(2, count / max * 100)}%` }} data-current={count > 0} /></div>
        <small>{days < 10 || index % 5 === 0 || index === days - 1 ? day.slice(8) : ""}</small>
      </div>)}
    </div>
  </>;
}

export default function StudentProgress() {
  const { account } = useStudent();
  const { data } = useDeviceLearning(account.id);
  const library = useLibrary<StudyCourse[]>();
  const rows = learningRows(library.data ?? [], data);
  const [days, setDays] = useState(7);
  const total = rows.reduce((count, row) => count + row.course.lessonIds.length, 0);
  const done = rows.reduce((count, row) => count + row.completed.length, 0);
  return <>
    <StudentHeading title="Tiến độ học tập" subtitle="Theo dõi các bài tự học đã đánh dấu trên trình duyệt này." />
    <ResourceState error={library.error} retry={library.reload} loading={!library.data} />
    {library.data && !rows.length && <StudentEmpty title="Chưa có bài tự học được cấp cho bạn" icon="progress"><Link className="sp-text-link" href="/student/hoc-lieu">Xem học liệu →</Link></StudentEmpty>}
    {rows.length > 0 && <>
      <div className="sp-stats sp-stats-progress">
        <div className="sp-stat"><span>Bài tự học đã đánh dấu</span><strong>{done}/{total}</strong></div>
        <div className="sp-stat"><span>Tiến độ tự học</span><strong>{Math.round(done / total * 100)}%</strong></div>
        <div className="sp-stat"><span>Thời gian học</span><strong>—</strong></div>
      </div>
      <div className="sp-detail-grid">
        <StudentPanel title="Hoạt động tự học">
          <div className="sp-view" role="group" aria-label="Khoảng thời gian">
            <button className="sp-button" aria-pressed={days === 7} onClick={() => setDays(7)}>7 ngày</button>
            <button className="sp-button" aria-pressed={days === 30} onClick={() => setDays(30)}>30 ngày</button>
          </div>
          <LearningActivity rows={rows} days={days} />
        </StudentPanel>
        <StudentPanel title="Tiến độ theo khóa">
          {rows.map(({ course, completed }) => <div className="sp-progress-row" key={course.courseCode}>
            <Link href={`/student/hoc-lieu/${course.courseCode}`}>{course.courseName}</Link>
            <strong>{completed.length}/{course.lessonIds.length} bài</strong>
            <progress value={completed.length} max={course.lessonIds.length} aria-label={course.courseName} />
          </div>)}
        </StudentPanel>
      </div>
    </>}
    <StudentPanel className="sp-stack-panel" title="Đánh giá của khóa học">
      <p className="sp-muted">Chưa có dữ liệu thời lượng, bài nộp và điểm trong cổng học viên.</p>
      <div className="sp-actions"><Link className="sp-text-link" href="/student/bai-tap">Bài tập →</Link><Link className="sp-text-link" href="/student/bai-thi">Kiểm tra & bài thi →</Link></div>
    </StudentPanel>
  </>;
}
