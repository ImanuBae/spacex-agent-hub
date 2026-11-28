"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, dateTime, money, OperationError } from "../../lib/services/classes";
import { kinds, states, type ClassChange } from "../../lib/services/adjustments";
import { ErrorMessage } from "../dashboard/components/OperationUI";
import { registrationCode, type Enrollment } from "../../lib/student-portal";

type Session = { startsAt: string; endsAt: string };
type Schedule = { name: string; mode: string; onlineUrl?: string | null; sessions: Session[] };
type Calendar = Record<string, Schedule | null>;
type ScheduleChange = Pick<ClassChange, "id" | "kind" | "version"> & { reason: string };

export default function StudentStudy({ enrollments, busy, run }: {
  enrollments: Enrollment[];
  busy: boolean;
  run: (change: () => Promise<unknown>) => Promise<void>;
}) {
  const router = useRouter();
  const [calendar, setCalendar] = useState<{ source: Enrollment[]; attempt: number; results: Calendar }>();
  const [selection, setSelection] = useState<{ id: string }>();
  const [plans, setPlans] = useState<{ selection: { id: string }; source: Enrollment[]; data?: ScheduleChange[]; error?: unknown }>();
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let current = true;
    const active = enrollments.filter(row => row.currentEntitlement.state === "ACTIVE");
    if (!active.length) return;
    const requests = active.map(async ({ id }) => {
      try {
        return [id, (await api<Schedule>("student/class-schedule/" + id)).data] as const;
      } catch (error) {
        if (current && error instanceof OperationError && error.code === "UNAUTHORIZED") router.replace("/student/session-expired");
        return [id, null] as const;
      }
    });
    void Promise.all(requests).then(results => {
      if (!current) return;
      setNow(Date.now());
      setCalendar({ source: enrollments, attempt, results: Object.fromEntries(results) });
    });
    return () => { current = false; };
  }, [enrollments, attempt, router]);

  const selectedId = selection?.id;
  const selectionActive = enrollments.some(row => row.id === selectedId && row.currentEntitlement.state === "ACTIVE");

  useEffect(() => {
    if (!selectionActive || !selection) return;
    let current = true;
    void api<ScheduleChange[]>("student/class-changes?enrollmentId=" + selection.id).then(
      result => { if (current) setPlans({ selection, source: enrollments, data: result.data }); },
      error => {
        if (!current) return;
        if (error instanceof OperationError && error.code === "UNAUTHORIZED") router.replace("/student/session-expired");
        else setPlans({ selection, source: enrollments, error });
      },
    );
    return () => { current = false; };
  }, [selection, selectionActive, enrollments, router]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const active = enrollments.filter(row => row.currentEntitlement.state === "ACTIVE");
  const inactive = enrollments.filter(row => row.currentEntitlement.state !== "ACTIVE");
  const available = calendar?.source === enrollments && calendar.attempt === attempt ? calendar.results : undefined;
  const upcoming = Object.entries(available ?? {}).flatMap(([id, schedule]) =>
    (schedule?.sessions ?? []).filter(session => Date.parse(session.endsAt) > now).map(session => ({ id, session })),
  ).sort((a, b) => Date.parse(a.session.startsAt) - Date.parse(b.session.startsAt))[0];
  const nextCourse = active.find(row => row.id === upcoming?.id) ?? active[0];
  const nextSchedule = nextCourse && available?.[nextCourse.id];
  const currentPlans = plans?.selection === selection && plans?.source === enrollments ? plans : undefined;
  const failed = Object.values(available ?? {}).some(schedule => schedule === null);
  const currentSession = upcoming && Date.parse(upcoming.session.startsAt) <= now;

  return <section className="ops-panel student-study" id="student-study" aria-labelledby="study-title">
    <div className="student-next">
      <h2 id="study-title">Lịch học của bạn</h2>
      {nextCourse ? <>
        <h3>{nextSchedule?.name ?? nextCourse.snapshot.className ?? nextCourse.snapshot.packageName ?? registrationCode(nextCourse.id)}</h3>
        {upcoming ? <p className="student-date">
          {currentSession ? "Đang diễn ra" : "Buổi tiếp theo"} <time dateTime={upcoming.session.startsAt}>{dateTime(upcoming.session.startsAt)}</time>
          {nextSchedule && <span>· {nextSchedule.mode === "online" ? "Trực tuyến" : "Tại phòng"}</span>}
        </p> : <p role="status">{!available ? "Đang tải lịch học…" : failed ? "Chưa tải được đầy đủ lịch học." : "Chưa có buổi học sắp tới."}</p>}
        <div className="ops-actions">
          {nextSchedule?.onlineUrl?.startsWith("https://") &&
            <a className="ops-link primary" href={nextSchedule.onlineUrl} target="_blank" rel="noopener noreferrer">Vào lớp <span aria-hidden="true">↗</span></a>}
          <a className="ops-link" href="#student-courses">Xem khóa đang học</a>
        </div>
      </> : <p role="status">{busy ? "Đang tải khóa học…" : "Chưa có lớp đang học."}</p>}
    </div>
    <div className="student-enrollments" id="student-courses">
      <h3>Khóa học và quyền lợi</h3>
      {!enrollments.length && !busy && <p>Bạn chưa có đăng ký.</p>}
      {failed && <ErrorMessage error={new Error("Có lịch lớp chưa tải được.")} retry={() => setAttempt(value => value + 1)} />}
      {[...active, ...inactive].map(row => {
        const schedule = available?.[row.id];
        const expanded = selectedId === row.id && selectionActive;
        return <article className="student-enrollment" key={row.id} data-enrollment-id={row.id}>
          <div className="student-course-heading">
            <div>
              <h4>{schedule?.name ?? row.snapshot.className ?? row.snapshot.packageName ?? registrationCode(row.id)}</h4>
              {row.snapshot.packageName && row.snapshot.packageName !== (schedule?.name ?? row.snapshot.className ?? row.snapshot.packageName) &&
                <p>{row.snapshot.packageName}</p>}
              <p className="muted">{registrationCode(row.id)} · {row.currentEntitlement.remainingSessions} buổi còn lại</p>
            </div>
            <span className="status" data-state={row.currentEntitlement.state}>{row.currentEntitlement.state === "ACTIVE" ? "Đang học" : states[row.currentEntitlement.state] ?? row.currentEntitlement.state}</span>
          </div>
          {row.currentEntitlement.state === "ACTIVE" && <button type="button" aria-expanded={expanded}
            aria-controls={`student-schedule-${row.id}`} onClick={() => setSelection(expanded ? undefined : { id: row.id })}>Xem lịch và link lớp</button>}
          <div id={`student-schedule-${row.id}`} hidden={!expanded}>
            {expanded && <div className="student-calendar">
              {schedule ? schedule.sessions.length ? <ul>{schedule.sessions.map(session => <li key={session.startsAt} data-past={Date.parse(session.endsAt) <= now}>
                <time dateTime={session.startsAt}>{dateTime(session.startsAt)}</time> – <time dateTime={session.endsAt}>{dateTime(session.endsAt)}</time>
              </li>)}</ul> : <p>Chưa có buổi học trong lịch.</p> : <p role="status">{schedule === null ? "Chưa tải được lịch lớp." : "Đang tải lịch lớp…"}</p>}
              {schedule?.onlineUrl?.startsWith("https://") && row.id !== nextCourse?.id &&
                <a className="ops-link primary" href={schedule.onlineUrl} target="_blank" rel="noopener noreferrer">Vào lớp <span aria-hidden="true">↗</span></a>}
              {!currentPlans && <p className="muted" role="status">Đang kiểm tra thay đổi lịch…</p>}
              <ErrorMessage error={currentPlans?.error} retry={() => setSelection({ id: row.id })} />
              {currentPlans?.data?.map(plan => {
                const key = row.id + ":" + plan.id;
                if (acknowledged.includes(key)) return null;
                return <div className="n8n06-row" key={plan.id}>
                  <div><strong>{kinds[plan.kind]}</strong><p>{plan.reason}</p></div>
                  {plan.kind !== "CANCEL" && <button disabled={busy} onClick={() => void run(async () => {
                    await api("student/class-changes/" + plan.id + "/choice", "POST", { enrollmentId: row.id, version: plan.version, accepted: true });
                    setAcknowledged(previous => [...previous, key]);
                  })}>Đồng ý phương án lịch</button>}
                </div>;
              })}
            </div>}
          </div>
          <details className="student-entitlement"><summary>Chi tiết quyền lợi</summary>
            <dl><dt>Số tiền đơn ban đầu</dt><dd>{money(row.snapshot.amountDue)}</dd>
              <dt>Giá trị quyền lợi hiện hành</dt><dd>{money(row.currentEntitlement.amount)}</dd></dl>
            {row.currentEntitlement.expiresAt && <small>Đến {dateTime(row.currentEntitlement.expiresAt)}</small>}
          </details>
        </article>;
      })}
    </div>
  </section>;
}
