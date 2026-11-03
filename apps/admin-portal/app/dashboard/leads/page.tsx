"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../src/context/AuthContext";
import { api, allPages, kinds, stages, sources, erasureStates, type PersonView, type LeadView, type ErasureView } from "../../../lib/services/crm";
import { dateTime, type Branch } from "../../../lib/services/classes";
import type { Course } from "../../../lib/services/courses";
import { ErrorMessage, OperationTabs } from "../components/OperationUI";
import { PersonForm, LeadForm } from "./CrmForms";
import { PersonDetail, ErasureDetail } from "./CrmDetails";
import "../components/operations.css";
import "./crm.css";

type Tab = "leads" | "people" | "erasure-requests";
export default function LeadsPage() {
  const { user } = useAuth();
  const manager = user?.role === "center_director" || user?.role === "branch_director";
  const [tab, setTab] = useState<Tab>("leads"), [branch, setBranch] = useState("");
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [stage, setStage] = useState(""), [assignment, setAssignment] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]), [courses, setCourses] = useState<Course[]>([]);
  const [leads, setLeads] = useState<LeadView[]>([]), [people, setPeople] = useState<PersonView[]>([]), [erasures, setErasures] = useState<ErasureView[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [personForm, setPersonForm] = useState<PersonView | "new" | null>(null), [leadForm, setLeadForm] = useState<LeadView | "new" | null>(null);
  const [personId, setPersonId] = useState<string | null>(null), [erasureId, setErasureId] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (branch) params.set("branchId", branch);
      if (tab !== "erasure-requests" && query) params.set("search", query);
      if (tab === "leads") {
        if (stage) params.set("stage", stage);
        if (assignment === "mine" && user) params.set("ownerId", user.id);
        if (assignment === "unassigned") params.set("unassigned", "true");
      }
      const [branchRows, courseRows, rows] = await Promise.all([
        allPages<Branch>("branches"), allPages<Course>("courses"),
        allPages<LeadView | PersonView | ErasureView>(`crm/${tab}?${params}`),
      ]);
      if (current !== request.current) return;
      setBranches(branchRows); setCourses(courseRows);
      if (tab === "leads") setLeads(rows as LeadView[]);
      else if (tab === "people") setPeople(rows as PersonView[]);
      else setErasures(rows as ErasureView[]);
    } catch (e) { if (current === request.current) setError(e); }
    finally { if (current === request.current) setLoading(false); }
  }, [tab, branch, query, stage, assignment, user]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const pending = request;
    return () => { pending.current++; };
  }, [load]);
  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? id;
  const saved = () => { setNotice("Đã lưu thay đổi."); void load(); };
  async function editLead(row: LeadView) {
    setBusy(true); setError(null);
    try { setLeadForm((await api<LeadView>(`crm/leads/${row.id}`)).data); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function claim(row: LeadView) {
    setBusy(true); setError(null);
    try { await api(`crm/leads/${row.id}/claim`, "POST", { version: row.version }); saved(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  const count = tab === "leads" ? leads.length : tab === "people" ? people.length : erasures.length;
  return <div className="ops crm">
    <header className="ops-heading"><div><h1>Khách hàng & tư vấn</h1><p className="muted">Hồ sơ, người phụ trách và quyền sử dụng thông tin theo từng chi nhánh.</p></div><div className="ops-actions"><button onClick={() => setPersonForm("new")}>Tạo hồ sơ</button><button className="primary" onClick={() => setLeadForm("new")}>Tạo lead tư vấn</button></div></header>
    <OperationTabs value={tab} onChange={value => { setTab(value as Tab); setNotice(""); }} items={[{ id: "leads", label: "Lead tư vấn" }, { id: "people", label: "Hồ sơ khách hàng" }, { id: "erasure-requests", label: "Yêu cầu xóa" }]} />
    <form className="crm-filters" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); }}>
      <label>Chi nhánh<select value={branch} onChange={e => setBranch(e.target.value)}><option value="">Trong phạm vi được cấp</option>{branches.filter(b => b.kind === "branch").map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      {tab !== "erasure-requests" && <label>Tìm hồ sơ<input value={search} maxLength={100} onChange={e => setSearch(e.target.value)} placeholder="Tên, điện thoại hoặc email" /></label>}
      {tab === "leads" && <><label>Giai đoạn<select value={stage} onChange={e => setStage(e.target.value)}><option value="">Tất cả giai đoạn</option>{Object.entries(stages).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Phụ trách<select value={assignment} onChange={e => setAssignment(e.target.value)}><option value="">Tất cả</option><option value="mine">Của tôi</option><option value="unassigned">Chưa phân công</option></select></label></>}
      {tab !== "erasure-requests" && <button type="submit" disabled={loading}>Tìm kiếm</button>}<button type="button" disabled={loading} onClick={() => void load()}>Làm mới</button>
    </form>
    {notice && <p role="status">{notice}</p>}<ErrorMessage error={error} retry={() => void load()} />
    <section className="ops-panel" aria-busy={loading}>
      <div className="ops-heading"><h2>{tab === "leads" ? "Hàng đợi tư vấn" : tab === "people" ? "Hồ sơ theo vai trò" : "Theo dõi yêu cầu xóa"}</h2><span className="muted">{loading || error ? "Chưa xác minh số lượng" : `${count} kết quả`}</span></div>
      {loading ? <p role="status">Đang tải dữ liệu CRM…</p> : error ? <p>Chưa xác minh được dữ liệu. Thử tải lại để tiếp tục.</p> : !count ? <p>Chưa có {tab === "leads" ? "lead" : tab === "people" ? "hồ sơ" : "yêu cầu xóa"} phù hợp bộ lọc.</p> : <div className="crm-rows">
        {tab === "leads" && leads.map(row => <article className="crm-row" key={row.id}>
          <div><button className="crm-person" onClick={() => setPersonId(row.contactId)}>{row.contactName}</button><p className="muted">{row.contactPhone || "—"} · {branchName(row.branchId)}</p></div>
          <div><strong>{stages[row.stage]}</strong><p className="muted">{sources[row.source]} · {courses.find(c => c.id === row.courseId)?.name ?? "Chưa chọn khóa"}</p><p className="muted">{row.ownerId ? row.ownerId === user?.id ? "Bạn phụ trách" : "Đã có người phụ trách" : "Chưa phân công"} · {dateTime(row.createdAt)}</p></div>
          <div className="ops-actions">{!row.ownerId && row.stage !== "LOST" && <button disabled={busy} onClick={() => void claim(row)}>Nhận tư vấn</button>}{(manager || row.ownerId === user?.id) && <button disabled={busy} onClick={() => void editLead(row)}>Chăm sóc / phân công</button>}</div>
        </article>)}
        {tab === "people" && people.map(row => <article className="crm-row" key={row.id}><div><button className="crm-person" onClick={() => setPersonId(row.id)}>{row.fullName}</button><p className="muted">{row.phone || row.email || "Chưa có liên hệ"}</p></div><div><strong>{kinds[row.kind]}</strong><p className="muted">{branchName(row.branchId)} · {dateTime(row.createdAt)}</p></div><button onClick={() => setPersonId(row.id)}>Xem hồ sơ</button></article>)}
        {tab === "erasure-requests" && erasures.map(row => <article className="crm-row" key={row.id}><div><strong>{row.personName}</strong><p className="muted">{branchName(row.branchId)} · {dateTime(row.createdAt)}</p></div><div><strong>{erasureStates[row.status]}</strong><p className="muted">{row.tasks.filter(t => t.status === "DONE" || t.status === "NOT_APPLICABLE").length}/{row.tasks.length} nơi đã xử lý</p></div><button onClick={() => setErasureId(row.id)}>Xem tiến độ</button></article>)}
      </div>}
    </section>
    <p className="muted">Lead ghi nhận nhu cầu tư vấn. Xác nhận đăng ký học sẽ được thực hiện qua luồng Enrollment.</p>
    {personForm && <PersonForm branches={branches} initial={personForm === "new" ? undefined : personForm} onClose={() => setPersonForm(null)} onSaved={() => { setPersonForm(null); saved(); }} />}
    {leadForm && user && <LeadForm branches={branches} courses={courses} initial={leadForm === "new" ? undefined : leadForm} manager={manager} currentUserId={user.id} onClose={() => setLeadForm(null)} onSaved={() => { setLeadForm(null); saved(); }} />}
    {personId && <PersonDetail id={personId} manager={manager} onClose={() => setPersonId(null)} onEdit={person => { setPersonId(null); setPersonForm(person); }} onChanged={saved} />}
    {erasureId && <ErasureDetail id={erasureId} manager={manager} onClose={() => setErasureId(null)} onChanged={saved} />}
  </div>;
}
