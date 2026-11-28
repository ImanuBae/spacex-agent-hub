"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Brand from "../landing/Brand";
import { inter } from "../ui/fonts";
import { api, dateTime, money, OperationError } from "../../lib/services/classes";
import { kinds, states, type Adjustment, type Operation } from "../../lib/services/adjustments";
import { intentKey } from "../../lib/services/crm";
import { ErrorMessage, Field } from "../dashboard/components/OperationUI";
import StudentStudy, { registrationCode, type Enrollment } from "./StudentStudy";
import "../ui/theme.css";
import "../dashboard/components/operations.css";
import "./student.css";

type Invoice = { id: string; enrollmentId: string; amount: number; createdAt: string };
type Notice = { id: string; subject: string; body: string; createdAt: string };
type Invitation = Operation & { targetClassId?: string; classId?: string; expiresAt?: string };
type Movement = { id: string; status: string; receiptRef: string | null; executedAt: string | null; direction: "CHARGE" | "REFUND" | "REVERSAL" | null };
type Data = { enrollments: Enrollment[]; adjustments: Adjustment[]; invoices: Invoice[]; invitations: Invitation[]; payments: Movement[] | null };
const empty: Data = { enrollments: [], adjustments: [], invoices: [], invitations: [], payments: null };
const needsChoice = (row: Adjustment) => !row.customerChoice && ["REQUESTED", "APPROVED"].includes(row.status);

function movementStatus(delta: number, payment?: Movement) {
  if (payment?.receiptRef && payment.direction === "REVERSAL" && payment.status === "REVOKED") return "Đã hoàn lại khoản thu";
  if (payment?.receiptRef && payment.status === "EXECUTED" && payment.direction === (delta > 0 ? "CHARGE" : "REFUND"))
    return delta > 0 ? "Đã thu" : "Đã hoàn";
  if (payment && ["FAILED", "REVOKED", "UNKNOWN", "EXECUTED"].includes(payment.status))
    return payment.status === "EXECUTED" ? "Chờ xác minh chứng từ" : states[payment.status];
  return payment ? (delta > 0 ? "Chờ thu" : "Chờ hoàn") : "Chưa có chứng từ thực hiện";
}

export default function StudentPage() {
  const router = useRouter();
  const [data, setData] = useState<Data>(empty), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticesBusy, setNoticesBusy] = useState(true), [noticesError, setNoticesError] = useState<unknown>();
  const invoiceKey = useRef<{ payload: string; key: string } | null>(null);
  const loadNotices = useCallback(async (background = false) => {
    if (!background) setNoticesBusy(true);
    try { setNotices((await api<Notice[]>("notifications")).data); setNoticesError(null); }
    catch (failure) {
      if (failure instanceof OperationError && failure.code === "UNAUTHORIZED") router.replace("/student/login");
      else setNoticesError(new Error("Không thể tải thông báo."));
    } finally { if (!background) setNoticesBusy(false); }
  }, [router]);
  const run = useCallback(async (change?: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try {
      if (change) { await change(); void loadNotices(); }
      const [e, a, i, w, p] = await Promise.all([api<Enrollment[]>("student/enrollments"), api<Adjustment[]>("student/adjustments"),
        api<Invoice[]>("student/invoices"), api<Invitation[]>("student/waitlist"),
        api<Movement[]>("student/payments").then(result => result.data, () => null)]);
      setData({ enrollments: e.data, adjustments: a.data, invoices: i.data, invitations: w.data, payments: p });
    } catch (e) { if (e instanceof OperationError && e.code === "UNAUTHORIZED") router.replace("/student/login"); else setError(e); }
    finally { setBusy(false); }
  }, [router, loadNotices]);
  const refresh = useCallback(() => { void run(); void loadNotices(); }, [run, loadNotices]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(() => { if (!document.hidden) void loadNotices(true); }, 10000);
    return () => clearInterval(timer);
  }, [refresh, loadNotices]);
  function invoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), taxCode = String(form.get("taxCode") ?? "").trim();
    const body = { enrollmentId: form.get("enrollmentId"), recipientName: form.get("recipientName"), address: form.get("address"), ...(taxCode ? { taxCode } : {}) };
    void run(async () => { await api("student/invoices", "POST", body, intentKey(invoiceKey, body)); invoiceKey.current = null; });
  }
  const actionCount = data.invitations.filter(row => row.status === "INVITED").length + data.adjustments.filter(needsChoice).length;
  const adjustments = [...data.adjustments].sort((a, b) => Number(needsChoice(b)) - Number(needsChoice(a)));
  return <main className={`hub-theme ops student-workspace ${inter.className}`}>
    <header className="student-topbar"><Brand />
      <div className="ops-actions"><button disabled={busy || noticesBusy} onClick={refresh}>Làm mới</button><button disabled={busy} onClick={() => void (async () => {
        try { const response = await fetch("/api/session/logout", { method: "POST" }); if (!response.ok) throw new Error("Chưa đăng xuất được."); router.replace("/student/login"); } catch (e) { setError(e); }
      })()}>Đăng xuất</button></div>
    </header>
    <div className="student-heading">
      <h1>Hồ sơ học viên</h1>
      <nav aria-label="Trong hồ sơ học viên">
        {actionCount > 0 && <a className="student-attention" href="#student-requests">{actionCount} việc cần phản hồi</a>}
        <Link href="/student/hoc-lieu">Học liệu</Link>
        <a href="#student-notices">Thông báo</a>
        <a href="#student-invoices">Hóa đơn</a>
      </nav>
    </div>
    <ErrorMessage error={error} retry={refresh} />
    <div className="student-list" aria-busy={busy}>
      <StudentStudy enrollments={data.enrollments} busy={busy} run={run} />
      <section className="ops-panel student-notices" id="student-notices" aria-busy={noticesBusy}><h2>Thông báo</h2>
        <ErrorMessage error={noticesError} retry={() => void loadNotices()} />
        {noticesBusy ? <p role="status">Đang tải thông báo…</p>
          : !noticesError && !notices.length && <p role="status">Bạn chưa có thông báo.</p>}
        {notices.map(n => <article key={n.id} className="n8n06-row"><div><strong>{n.subject}</strong><p>{n.body}</p><small>{dateTime(n.createdAt)}</small></div></article>)}
      </section>
      <section className="ops-panel" id="student-requests"><h2>Yêu cầu và lời mời</h2>
        {!data.adjustments.length && !data.invitations.length && <p role="status">{busy ? "Đang tải yêu cầu…" : "Bạn chưa có yêu cầu điều chỉnh hoặc lời mời."}</p>}
        {data.invitations.map(row => <article key={row.id} className="n8n06-row" data-attention={row.status === "INVITED"}><div><strong>Lời mời vào lớp</strong><p>{states[row.status] ?? row.status}</p>{row.expiresAt && <small>Hạn {dateTime(row.expiresAt)}</small>}</div>
          {row.status === "INVITED" && <div className="ops-actions">{["accept","decline"].map(action => <button key={action} className={action === "accept" ? "primary" : undefined} disabled={busy} onClick={() => void run(() => api("waitlist/"+row.id+"/"+action, "POST", { version: row.version }))}>{action === "accept" ? "Nhận lời mời" : "Từ chối"}</button>)}</div>}
        </article>)}
        {adjustments.map(row => {
          const payment = data.payments?.find(p => p.id === row.id);
          return <article key={row.id} data-adjustment-id={row.id} className="n8n06-row" data-attention={needsChoice(row)}><div><strong>{kinds[row.type]}</strong>
          <p>{states[row.status] ?? row.status}</p>
          {row.amountDelta !== 0 && <dl>
            <dt>{row.type === "TRANSFER" || row.type === "RESUME" || row.type === "WAITLIST" ? "Chênh lệch" : "Khoản hoàn"} {row.amountDelta > 0 ? "thu thêm" : row.type === "REFUND" ? "" : "hoàn lại"}</dt>
            <dd>{money(Math.abs(row.amountDelta))}</dd>
            <dt>Trạng thái tiền</dt><dd>{data.payments ? movementStatus(row.amountDelta, payment) : "Không tải được trạng thái tiền. Hãy làm mới."}</dd>
            {payment?.receiptRef && payment.executedAt && <><dt>Chứng từ mô phỏng · DEMO</dt><dd>{payment.receiptRef} · {dateTime(payment.executedAt)}</dd></>}
          </dl>}
          <p>{row.reason}</p>
          {row.deadlineAt && <small>Hạn chọn {dateTime(row.deadlineAt)}</small>}</div>
          {needsChoice(row) && <button className="primary" disabled={busy} onClick={() => void run(() => api("adjustments/"+row.id+"/choice", "POST", { version: row.version, accepted: true }))}>Đồng ý phương án</button>}
        </article>; })}
      </section>
      <section className="ops-panel" id="student-invoices"><h2>Hóa đơn mô phỏng · DEMO</h2><p className="muted">Không có giá trị pháp lý.</p>
        {!data.invoices.length && <p role="status">{busy ? "Đang tải hóa đơn…" : "Bạn chưa có hóa đơn."}</p>}
        {data.invoices.map(row => <article className="n8n06-row" key={row.id}><div><strong>{money(row.amount)}</strong><p className="muted">{row.createdAt && dateTime(row.createdAt)}</p></div><a className="ops-link" href={"/api/v1/student/invoices/"+row.id+"/download"}>Tải hóa đơn</a></article>)}
        {data.enrollments.some(e => e.currentEntitlement.state === "ACTIVE") && <form className="ops-form" onSubmit={invoice}>
          <Field name="invoice-enrollment" label="Đăng ký"><select name="enrollmentId" id="invoice-enrollment" required><option value="">Chọn đăng ký</option>{data.enrollments.filter(e => e.currentEntitlement.state === "ACTIVE").map(e => <option key={e.id} value={e.id}>{registrationCode(e.id)} · {money(e.snapshot.amountDue)}</option>)}</select></Field>
          <Field name="invoice-name" label="Tên người nhận"><input name="recipientName" id="invoice-name" required maxLength={200} /></Field>
          <Field name="invoice-address" label="Địa chỉ"><input name="address" id="invoice-address" required maxLength={500} /></Field>
          <Field name="invoice-tax" label="Mã số thuế (nếu có)"><input name="taxCode" id="invoice-tax" maxLength={20} /></Field>
          <div className="span"><button disabled={busy} className="primary">Tạo hóa đơn mô phỏng</button></div>
        </form>}
      </section>
    </div>
  </main>;
}
