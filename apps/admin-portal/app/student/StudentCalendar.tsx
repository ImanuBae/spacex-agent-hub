"use client";

import { useState } from "react";
import type { Enrollment, LibraryCourse } from "../../lib/student-portal";
import { classEvents, dayKey, practiceSchedules, scheduleFile } from "../../lib/student-portal";
import { useLibrary, useSchedules, useStudentClock, useStudentResource } from "./portal-data";
import { ClassRow } from "./StudentDashboard";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";

export default function StudentCalendar() {
  const enrollments = useStudentResource<Enrollment[]>("student/enrollments");
  const library = useLibrary<LibraryCourse[]>();
  const { schedules, failed, retry } = useSchedules(enrollments.data);
  const [selection, setSelection] = useState("");
  const [grid, setGrid] = useState(true);
  const now = useStudentClock();
  const today = dayKey(new Date(now));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState("");
  const allSchedules = [...(schedules ?? []), ...practiceSchedules(library.data ?? [])];
  const events = classEvents(allSchedules.filter(item => !selection || item.classId === selection));
  const next = events.find(event => Date.parse(event.endsAt) > now);
  const nextMonth = next && dayKey(next.startsAt).slice(0, 7);
  const monthEvents = events.filter(event => dayKey(event.startsAt).startsWith(month));
  const view = grid ? monthEvents.filter(event => !day || dayKey(event.startsAt) === day) : events;
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const monthLabel = `Tháng ${number}, ${year}`;

  function moveMonth(delta: number) {
    setMonth(new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7));
    setDay("");
  }
  function download() {
    const url = URL.createObjectURL(new Blob([scheduleFile(view)], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "lich-hoc-spacex.ics"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const loading = !enrollments.data || (enrollments.data.some(row => row.currentEntitlement.state === "ACTIVE") && !schedules) || (!library.data && !library.error);
  return <>
    <StudentHeading title="Lịch học" subtitle="Múi giờ Việt Nam · UTC+7">
      <button type="button" className="sp-button" onClick={download} disabled={!view.length}>Tải lịch ICS</button>
    </StudentHeading>
    <div className="sp-filters">
      <label><span>Lọc theo lớp</span><select value={selection} onChange={event => setSelection(event.target.value)}><option value="">Tất cả lớp</option>
        {[...new Map(allSchedules.map(item => [item.classId, item])).values()].map(item => <option key={item.classId} value={item.classId}>{item.name}</option>)}</select></label>
      <div className="sp-view" role="group" aria-label="Kiểu lịch">
        <button className="sp-button" aria-pressed={grid} onClick={() => setGrid(true)}>Theo tháng</button>
        <button className="sp-button" aria-pressed={!grid} onClick={() => setGrid(false)}>Danh sách</button>
      </div>
    </div>
    <ResourceState error={enrollments.error} retry={enrollments.reload} loading={loading} />
    <ResourceState error={library.error} retry={library.reload} />
    {failed > 0 && <ResourceState error={new Error("Một số lịch lớp chưa tải được.")} retry={retry} />}
    {grid && <StudentPanel title={monthLabel}>
      <nav className="sp-cal-controls" aria-label="Chọn tháng">
        <button className="sp-button" onClick={() => moveMonth(-1)} aria-label="Tháng trước">←</button>
        <button className="sp-button" onClick={() => { setMonth(today.slice(0, 7)); setDay(""); }}>Hôm nay</button>
        <button className="sp-button" onClick={() => moveMonth(1)} aria-label="Tháng sau">→</button>
        {nextMonth && month !== nextMonth && <button className="sp-button" onClick={() => { setMonth(nextMonth); setDay(""); }}>Buổi sắp tới</button>}
      </nav>
      <div className="sp-cal-grid">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map(label => <strong key={label}>{label}</strong>)}
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {Array.from({ length: count }, (_, index) => {
          const key = `${month}-${String(index + 1).padStart(2, "0")}`;
          const sessions = monthEvents.filter(event => dayKey(event.startsAt) === key).length;
          return <button key={key} aria-label={`Ngày ${index + 1}, ${sessions} buổi học`} aria-current={key === today ? "date" : undefined}
            aria-pressed={key === day} onClick={() => setDay(key === day ? "" : key)}>{index + 1}{sessions > 0 && <small>{sessions}</small>}</button>;
        })}
      </div>
    </StudentPanel>}
    <StudentPanel className="sp-stack-panel" title={grid ? day ? `Buổi học ngày ${Number(day.slice(8))}/${number}` : "Buổi học trong tháng" : "Tất cả buổi học"}>
      {!loading && !view.length && <StudentEmpty icon="schedule" title={failed ? "Chưa tải được buổi học cho lựa chọn này" : "Chưa có buổi học trong khoảng này"} />}
      {view.map(event => <ClassRow key={event.schedule.classId + event.startsAt} event={event} />)}
    </StudentPanel>
  </>;
}
