"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { inter } from "../ui/fonts";
import { api, dateTime, money, OperationError } from "../../lib/services/classes";
import { kinds, states, type Adjustment, type ClassChange, type Operation } from "../../lib/services/adjustments";
import { intentKey } from "../../lib/services/crm";
import { ErrorMessage, Field } from "../dashboard/components/OperationUI";
import "../ui/theme.css";
import "../dashboard/components/operations.css";
import "./student.css";

type Entitlement = { state: string; classId: string; remainingSessions: number; expiresAt?: string };
type Enrollment = { id: string; currentEntitlement: Entitlement; snapshot: { amountDue: number } };
type Schedule = { name: string; onlineUrl?: string; sessions: { startsAt: string; endsAt: string }[] };
type Invoice = { id: string; enrollmentId: string; amount: number; createdAt: string };
type Notice = { id: string; subject: string; body: string; createdAt: string };
type Invitation = Operation & { targetClassId?: string; classId?: string; expiresAt?: string };
type Data = { enrollments: Enrollment[]; adjustments: Adjustment[]; invoices: Invoice[]; notices: Notice[]; invitations: Invitation[] };
const empty: Data = { enrollments: [], adjustments: [], invoices: [], notices: [], invitations: [] };

export default function StudentPage() {
  const router = useRouter();
  const [data, setData] = useState<Data>(empty), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true), [selected, setSelected] = useState("");
  const [schedule, setSchedule] = useState<Schedule>(), [plans, setPlans] = useState<ClassChange[]>([]);
  const invoiceKey = useRef<{ payload: string; key: string } | null>(null);
  const run = useCallback(async (change?: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try {
      if (change) await change();
      const [e, a, i, n, w] = await Promise.all([api<Enrollment[]>("student/enrollments"), api<Adjustment[]>("student/adjustments"),
        api<Invoice[]>("student/invoices"), api<Notice[]>("notifications"), api<Invitation[]>("student/waitlist")]);
      setData({ enrollments: e.data, adjustments: a.data, invoices: i.data, notices: n.data, invitations: w.data });
    } catch (e) { if (e instanceof OperationError && e.code === "UNAUTHORIZED") router.replace("/student/login"); else setError(e); }
    finally { setBusy(false); }
  }, [router]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);
  function viewSchedule(id: string) {
    setSelected(id); setSchedule(undefined); setPlans([]);
    void run(async () => {
      const [s, p] = await Promise.all([api<Schedule>("student/class-schedule/"+id), api<ClassChange[]>("student/class-changes?enrollmentId="+id)]);
      setSchedule(s.data); setPlans(p.data);
    });
  }
  function invoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), taxCode = String(form.get("taxCode") ?? "").trim();
    const body = { enrollmentId: form.get("enrollmentId"), recipientName: form.get("recipientName"), address: form.get("address"), ...(taxCode ? { taxCode } : {}) };
    void run(async () => { await api("student/invoices", "POST", body, intentKey(invoiceKey, body)); invoiceKey.current = null; });
  }
  return <main className={`hub-theme ops student-workspace ${inter.className}`}>
    <header className="ops-heading"><div><span className="student-brand">Space Agent Hub</span><h1>Hồ sơ học viên</h1></div>
      <div className="ops-actions"><button disabled={busy} onClick={() => void run()}>Làm mới</button><button disabled={busy} onClick={() => void (async () => {
        try { const response = await fetch("/api/session/logout", { method: "POST" }); if (!response.ok) throw new Error("Chưa đăng xuất được."); router.replace("/student/login"); } catch (e) { setError(e); }
      })()}>Đăng xuất</button></div>
    </header>
    <ErrorMessage error={error} />
    <div className="student-list" aria-busy={busy}>
      <section className="ops-panel"><h2>Quyền lợi và lịch học</h2>
        {!data.enrollments.length && <p role="status">{busy ? "Đang tải quyền lợi…" : "Bạn chưa có đăng ký."}</p>}
        {data.enrollments.map(row => <article className="n8n06-row" key={row.id} data-enrollment-id={row.id}><div>
          <strong>{states[row.currentEntitlement.state] ?? row.currentEntitlement.state}</strong>
          <p>{row.currentEntitlement.remainingSessions} buổi · {money(row.snapshot.amountDue)}</p>
          {row.currentEntitlement.expiresAt && <small>Đến {dateTime(row.currentEntitlement.expiresAt)}</small>}</div>
          {row.currentEntitlement.state === "ACTIVE" && <button disabled={busy} onClick={() => viewSchedule(row.id)}>Xem lịch và link lớp</button>}
        </article>)}
        {schedule && <div aria-live="polite"><h3>{schedule.name}</h3><ul>{schedule.sessions.map(s => <li key={s.startsAt}>{dateTime(s.startsAt)} – {dateTime(s.endsAt)}</li>)}</ul>
          {schedule.onlineUrl?.startsWith("https://") && <a className="ops-link" href={schedule.onlineUrl} target="_blank" rel="noopener noreferrer">Mở link lớp</a>}
        </div>}
        {plans.map(plan => <article key={plan.id} className="n8n06-row"><div><strong>{kinds[plan.kind]}</strong><p>{plan.payload.reason}</p></div>
          {plan.kind !== "CANCEL" && <button disabled={busy} onClick={() => void run(async () => {
            await api("student/class-changes/"+plan.id+"/choice", "POST", { enrollmentId: selected, version: plan.version, accepted: true });
            setPlans(previous => previous.filter(p => p.id !== plan.id));
          })}>Đồng ý phương án lịch</button>}</article>)}
      </section>
      <section className="ops-panel"><h2>Thông báo</h2>
        {!data.notices.length && <p>Bạn chưa có thông báo.</p>}
        {data.notices.map(n => <article key={n.id} className="n8n06-row"><div><strong>{n.subject}</strong><p>{n.body}</p><small>{dateTime(n.createdAt)}</small></div></article>)}
      </section>
      <section className="ops-panel"><h2>Yêu cầu và lời mời</h2>
        {!data.adjustments.length && !data.invitations.length && <p>Bạn chưa có yêu cầu điều chỉnh hoặc lời mời.</p>}
        {data.adjustments.map(row => <article key={row.id} className="n8n06-row"><div><strong>{kinds[row.type]}</strong>
          <p>{states[row.status] ?? row.status} · {money(row.amountDelta)}</p><p>{row.reason}</p>
          {row.deadlineAt && <small>Hạn chọn {dateTime(row.deadlineAt)}</small>}</div>
          {!row.customerChoice && ["REQUESTED","APPROVED"].includes(row.status) && <button disabled={busy} onClick={() => void run(() => api("adjustments/"+row.id+"/choice", "POST", { version: row.version, accepted: true }))}>Đồng ý phương án</button>}
        </article>)}
        {data.invitations.map(row => <article key={row.id} className="n8n06-row"><div><strong>Lời mời vào lớp</strong><p>{states[row.status] ?? row.status}</p>{row.expiresAt && <small>Hạn {dateTime(row.expiresAt)}</small>}</div>
          {row.status === "INVITED" && <div className="ops-actions">{["accept","decline"].map(action => <button key={action} disabled={busy} onClick={() => void run(() => api("waitlist/"+row.id+"/"+action, "POST", { version: row.version }))}>{action === "accept" ? "Nhận lời mời" : "Từ chối"}</button>)}</div>}
        </article>)}
      </section>
      <section className="ops-panel"><h2>Hóa đơn mô phỏng</h2><p className="muted">Không có giá trị pháp lý.</p>
        {data.invoices.map(row => <article className="n8n06-row" key={row.id}><div>{row.createdAt && dateTime(row.createdAt)}</div><a className="ops-link" href={"/api/v1/student/invoices/"+row.id+"/download"}>Tải hóa đơn</a></article>)}
        {data.enrollments.some(e => e.currentEntitlement.state === "ACTIVE") && <form className="ops-form" onSubmit={invoice}>
          <Field name="invoice-enrollment" label="Đăng ký"><select name="enrollmentId" id="invoice-enrollment" required><option value="">Chọn đăng ký</option>{data.enrollments.filter(e => e.currentEntitlement.state === "ACTIVE").map(e => <option key={e.id} value={e.id}>{e.id}</option>)}</select></Field>
          <Field name="invoice-name" label="Tên người nhận"><input name="recipientName" id="invoice-name" required maxLength={200} /></Field>
          <Field name="invoice-address" label="Địa chỉ"><input name="address" id="invoice-address" required maxLength={500} /></Field>
          <Field name="invoice-tax" label="Mã số thuế (nếu có)"><input name="taxCode" id="invoice-tax" maxLength={20} /></Field>
          <div className="span"><button disabled={busy} className="primary">Tạo hóa đơn mô phỏng</button></div>
        </form>}
      </section>
    </div>
  </main>;
}
