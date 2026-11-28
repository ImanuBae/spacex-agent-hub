"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, dateTime, money, OperationError } from "../../lib/services/classes";
import { kinds, states, type Adjustment, type Operation } from "../../lib/services/adjustments";
import { intentKey } from "../../lib/services/crm";
import { ErrorMessage, Field } from "../dashboard/components/OperationUI";
import StudentStudy from "./StudentStudy";
import { registrationCode, type Enrollment } from "../../lib/student-portal";
import { StudentHeading } from "./StudentUI";

type Invoice = { id: string; enrollmentId: string; amount: number; createdAt: string };
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

export default function StudentOperations({ view = "requests" }: { view?: "requests" | "invoices" }) {
  const router = useRouter();
  const [data, setData] = useState<Data>(empty), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const invoiceKey = useRef<{ payload: string; key: string } | null>(null);
  const run = useCallback(async (change?: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try {
      if (change) await change();
      const enrollments = api<Enrollment[]>("student/enrollments");
      if (view === "invoices") {
        const [e, i] = await Promise.all([enrollments, api<Invoice[]>("student/invoices")]);
        setData({ ...empty, enrollments: e.data, invoices: i.data });
      } else {
        const [e, a, w, p] = await Promise.all([enrollments, api<Adjustment[]>("student/adjustments"),
          api<Invitation[]>("student/waitlist"), api<Movement[]>("student/payments").then(result => result.data, () => null)]);
        setData({ ...empty, enrollments: e.data, adjustments: a.data, invitations: w.data, payments: p });
      }
    } catch (e) { if (e instanceof OperationError && e.code === "UNAUTHORIZED") router.replace("/student/session-expired"); else setError(e); }
    finally { setBusy(false); }
  }, [router, view]);
  const refresh = useCallback(() => { void run(); }, [run]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);
  function invoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), taxCode = String(form.get("taxCode") ?? "").trim();
    const body = { enrollmentId: form.get("enrollmentId"), recipientName: form.get("recipientName"), address: form.get("address"), ...(taxCode ? { taxCode } : {}) };
    void run(async () => { await api("student/invoices", "POST", body, intentKey(invoiceKey, body)); invoiceKey.current = null; });
  }
  const adjustments = [...data.adjustments].sort((a, b) => Number(needsChoice(b)) - Number(needsChoice(a)));
  return <div className="ops sp-operations">
    <StudentHeading title={view === "invoices" ? "Hóa đơn" : "Yêu cầu và lời mời"} />
    <ErrorMessage error={error} retry={refresh} />
    <div className="student-list" aria-busy={busy}>
      {view === "requests" && <StudentStudy enrollments={data.enrollments} busy={busy} run={run} />}
      {view === "requests" && <section className="ops-panel" id="student-requests"><h2>Yêu cầu và lời mời</h2>
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
      </section>}
      {view === "invoices" && <section className="ops-panel" id="student-invoices"><h2>Hóa đơn mô phỏng · DEMO</h2><p className="muted">Không có giá trị pháp lý.</p>
        {!data.invoices.length && <p role="status">{busy ? "Đang tải hóa đơn…" : "Bạn chưa có hóa đơn."}</p>}
        {data.invoices.map(row => <article className="n8n06-row" key={row.id}><div><strong>{money(row.amount)}</strong><p className="muted">{row.createdAt && dateTime(row.createdAt)}</p></div><a className="ops-link" href={"/api/v1/student/invoices/"+row.id+"/download"}>Tải hóa đơn</a></article>)}
        {data.enrollments.some(e => e.currentEntitlement.state === "ACTIVE") && <form className="ops-form" onSubmit={invoice}>
          <Field name="invoice-enrollment" label="Đăng ký"><select name="enrollmentId" id="invoice-enrollment" required><option value="">Chọn đăng ký</option>{data.enrollments.filter(e => e.currentEntitlement.state === "ACTIVE").map(e => <option key={e.id} value={e.id}>{registrationCode(e.id)} · {money(e.snapshot.amountDue)}</option>)}</select></Field>
          <Field name="invoice-name" label="Tên người nhận"><input name="recipientName" id="invoice-name" required maxLength={200} /></Field>
          <Field name="invoice-address" label="Địa chỉ"><input name="address" id="invoice-address" required maxLength={500} /></Field>
          <Field name="invoice-tax" label="Mã số thuế (nếu có)"><input name="taxCode" id="invoice-tax" maxLength={20} /></Field>
          <div className="span"><button disabled={busy} className="primary">Tạo hóa đơn mô phỏng</button></div>
        </form>}
      </section>}
    </div>
  </div>;
}
