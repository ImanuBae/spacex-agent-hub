"use client";
import { api, dateTime } from "../../../lib/services/classes";
import { states, useOperations, type Operation } from "../../../lib/services/adjustments";
import { ErrorMessage, Field } from "../components/OperationUI";

type Notice = Operation & { template: string; dueAt?: string; sourceVersion: number; receiptId?: string; errorCode?: string };
const templates: Record<string, string> = { ENROLLMENT_CONFIRMED: "Xác nhận học", CLASS_CHANGED: "Đính chính lịch", REMINDER: "Nhắc học" };
export default function NotificationsPage() {
  const { rows, busy, error, run } = useOperations<Notice>("notifications");
  return <div className="ops">
    <header className="ops-heading"><div><h1>Thông báo học viên</h1><p className="muted">Theo dõi từng lần gửi và chứng từ nhận.</p></div><button onClick={() => void run()} disabled={busy}>Làm mới</button></header>
    <ErrorMessage error={error} />
    <section className="ops-panel"><h2>Lập thông báo lịch</h2><form className="ops-form" onSubmit={e => {
      e.preventDefault(); const form = new FormData(e.currentTarget), due = form.get("dueAt");
      void run(() => api("notifications", "POST", { enrollmentId: form.get("enrollmentId"), template: form.get("template"),
        sourceVersion: Number(form.get("sourceVersion")), ...(due ? { dueAt: new Date(String(due)+":00+07:00").toISOString() } : {}) }));
    }}>
      <Field name="notice-enrollment" label="Mã đăng ký"><input id="notice-enrollment" name="enrollmentId" required /></Field>
      <input type="hidden" name="template" value="REMINDER" />
      <Field name="notice-version" label="Phiên bản lịch"><input id="notice-version" name="sourceVersion" type="number" min="1" required /></Field>
      <Field name="notice-due" label="Giờ gửi (giờ Việt Nam)"><input type="datetime-local" id="notice-due" name="dueAt" /></Field>
      <div className="span"><button className="primary" disabled={busy}>Lưu thông báo</button></div>
    </form></section>
    <section className="ops-panel" aria-busy={busy}><h2>Trạng thái gửi</h2>
      {!rows.length && <p role="status">{busy ? "Đang tải thông báo…" : "Chưa có thông báo."}</p>}
      {rows.map(row => <article key={row.id} className="n8n06-row" data-intent-id={row.id}><div>
        <strong>{templates[row.template] ?? row.template}</strong><p>{states[row.status] ?? row.status}</p>
        <small>Phiên bản {row.sourceVersion} {row.dueAt && "· "+dateTime(row.dueAt)}</small>
        {row.receiptId && <p>Chứng từ nhận {row.receiptId}</p>}{row.errorCode && <p>{row.errorCode}</p>}
      </div></article>)}
    </section>
  </div>;
}
