"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, dateTime, type Branch } from "../../../lib/services/classes";
import { allPages, stages, type LeadView } from "../../../lib/services/crm";
import { courseService, type Course } from "../../../lib/services/courses";
import { useAuth } from "../../../src/context/AuthContext";
import { ErrorMessage, Field } from "../components/OperationUI";
import OrbitArt from "../../ui/OrbitArt";

type Summary = {
  confirmed: string; received: string; refunded: string; unassignedReceived: string;
  projectedAt: string | null; coveredDays: number; periodDays: number;
};
const calendarDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Saigon", dateStyle: "short" });
const currency = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("vi-VN");

function period(month: string, today: string) {
  const [year, ordinal] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, ordinal, 0)).toISOString().slice(0, 10);
  return { start: month + "-01", end: last < today ? last : today };
}

export default function OverviewPage() {
  const { user } = useAuth();
  const today = calendarDay.format(new Date()), currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth), [branch, setBranch] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]), [branchError, setBranchError] = useState<unknown>();
  const [loaded, setLoaded] = useState<{ key: string; result?: Summary; error?: unknown }>();
  const range = period(month, today);
  const query = new URLSearchParams({ ...range, ...(branch ? { branchId: branch } : {}) }).toString();
  const requestKey = query + "/" + attempt;
  useEffect(() => {
    let active = true;
    api<Branch[]>("branches").then(({ data }) => {
      if (active) { setBranches(data); setBranchError(null); }
    }, error => { if (active) setBranchError(error); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    api<Summary>("reports?" + query).then(({ data }) => {
      if (active) setLoaded({ key: requestKey, result: data });
    }, () => {
      if (active) setLoaded({ key: requestKey, error: new Error("Không tải được báo cáo. Hãy thử lại.") });
    });
    return () => { active = false; };
  }, [query, requestKey]);
  const current = loaded?.key === requestKey ? loaded : undefined, report = current?.result;
  const center = user?.role === "center_director";
  const reload = () => setAttempt(value => value + 1);

  return <div className="ops">
    <header className="ops-heading orbit-hero hub-overview-intro"><OrbitArt /><div><h1>Tổng quan</h1><p className="muted">Đăng ký và dòng tiền theo chi nhánh.</p></div>
      <Link className="ops-link" href="/dashboard/reconciliation">Đối soát ngoại lệ</Link></header>
    <section className="ops-panel" aria-labelledby="report-heading" aria-busy={!current}>
      <div className="ops-heading"><div><h2 id="report-heading">Báo cáo đăng ký và thanh toán</h2><p className="muted">Dữ liệu tổng hợp mô phỏng · Asia/Saigon</p></div>
        <button type="button" onClick={reload} disabled={!current}>Làm mới báo cáo</button></div>
      <div className="ops-filters">
        <Field name="report-month" label="Tháng báo cáo"><input type="month" id="report-month" value={month} min="2000-01" max={currentMonth}
          onChange={event => { if (event.target.validity.valid && /^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value); }} /></Field>
        <Field name="report-branch" label="Chi nhánh"><select id="report-branch" value={branch} onChange={event => setBranch(event.target.value)}>
          <option value="">{center ? "Toàn trung tâm" : "Chi nhánh được cấp"}</option>
          {branches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          {center && <option value="unassigned">Chưa gán chi nhánh</option>}
        </select></Field>
      </div>
      <p className="muted">Kỳ {range.start.split("-").reverse().join("/")} – {range.end.split("-").reverse().join("/")}</p>
      <ErrorMessage error={branchError} />
      <ErrorMessage error={current?.error} retry={reload} />
      {!current && <p role="status">Đang tải báo cáo…</p>}
      {report && report.coveredDays === 0 && <p role="status">Chưa có kỳ đã tổng hợp. Hãy tải lại sau khi dữ liệu được đối chiếu.</p>}
      {report && report.coveredDays > 0 && <>
        <div className="grid gap-3 sm:grid-cols-3">
          {(branch === "unassigned" ? [["Tiền chưa gán chi nhánh", currency.format(BigInt(report.unassignedReceived))]] : [
            ["Đơn đã xác nhận", integer.format(BigInt(report.confirmed))],
            ["Tiền đã nhận", currency.format(BigInt(report.received))],
            ["Tiền đã hoàn", currency.format(BigInt(report.refunded))],
          ]).map(([label, value]) => <article key={label} className="ops-panel">
            <h3>{label}</h3><p className="text-2xl font-semibold tabular-nums">{value}</p>
          </article>)}
        </div>
        {center && !branch && <p>Tiền chưa gán chi nhánh <strong>{currency.format(BigInt(report.unassignedReceived))}</strong></p>}
        <p className="muted" role="status">Đã tổng hợp {report.coveredDays}/{report.periodDays} ngày{report.projectedAt && <> · Cập nhật {dateTime(report.projectedAt)}</>}</p>
      </>}
    </section>
    <CurrentActivity />
  </div>;
}

function CurrentActivity() {
  const [courses, setCourses] = useState<Course[]>();
  const [leads, setLeads] = useState<LeadView[]>();
  const [courseError, setCourseError] = useState(false), [leadError, setLeadError] = useState(false);
  useEffect(() => {
    let active = true;
    void courseService.getAllCourses().then(value => { if (active) setCourses(value); }, () => { if (active) setCourseError(true); });
    void allPages<LeadView>("crm/leads").then(value => { if (active) setLeads(value); }, () => { if (active) setLeadError(true); });
    return () => { active = false; };
  }, []);
  return <section className="ops-panel"><h2>Tư vấn và khóa học hiện tại</h2>
    <p>{courseError ? "Không tải được danh sách khóa học." : courses ? `${courses.length} khóa học` : "Đang tải khóa học…"}</p>
    <p>{leadError ? "Không tải được dữ liệu CRM." : leads ? `${leads.length} học viên tiềm năng` : "Đang tải học viên tiềm năng…"}</p>
    {leads?.slice(0, 5).map(lead => <article className="n8n06-row" key={lead.id}>
      <div><strong>{lead.contactName}</strong><p className="muted">{courses?.find(course => course.id === lead.courseId)?.name ?? "Chưa xác minh khóa học"}</p></div>
      <span className="status">{stages[lead.stage]}</span>
    </article>)}
  </section>;
}
