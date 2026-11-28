"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, dateTime, OperationError, utcTime } from "../../../lib/services/classes";
import { states, useOperations, type Operation } from "../../../lib/services/adjustments";
import { ErrorMessage, Field } from "../components/OperationUI";
import { EnrollmentPicker, useEnrollmentPicker } from "../components/EnrollmentPicker";

type Notice = Operation & { template: string; dueAt?: string; sourceVersion: number; receiptId?: string; errorCode?: string };
const templates: Record<string, string> = { ENROLLMENT_CONFIRMED: "Xác nhận học", CLASS_CHANGED: "Đính chính lịch", REMINDER: "Nhắc học" };
export default function NotificationsPage() {
  return <Suspense fallback={<p role="status">Đang tải thông báo…</p>}><NotificationRoute /></Suspense>;
}
function NotificationRoute() {
  const id = useSearchParams().get("enrollment") ?? "";
  return <Notifications key={id} id={id} />;
}
function Notifications({ id }: { id: string }) {
  const { rows, busy, error, run } = useOperations<Notice>("notifications");
  const picker = useEnrollmentPicker(id, false);
  const current = picker.current;
  const formError = error instanceof OperationError && error.code === "SOURCE_CHANGED"
    ? new Error("Lịch hoặc lớp đã thay đổi. Tải lại thông tin đăng ký trước khi gửi lại.")
    : error instanceof OperationError && error.code === "REMINDER_DEADLINE"
      ? new Error("Giờ gửi phải trước buổi học tiếp theo.") : error;
  return <div className="ops">
    <header className="ops-heading"><div><h1>Thông báo học viên</h1><p className="muted">Theo dõi từng lần gửi và chứng từ nhận.</p></div><button onClick={() => void run()} disabled={busy}>Làm mới</button></header>
    <ErrorMessage error={formError ?? picker.error} />
    <section className="ops-panel"><h2>Lập thông báo lịch</h2><form className="ops-form" onSubmit={e => {
      e.preventDefault(); const form = new FormData(e.currentTarget), due = form.get("dueAt");
      if (!current?.cls || current.entitlement.state !== "ACTIVE") return;
      void run(() => api("notifications", "POST", { enrollmentId: current.entitlement.id, template: "REMINDER",
        classId: current.cls!.id, sourceVersion: current.cls!.version, ...(due ? { dueAt: utcTime(String(due)) } : {}) }));
    }}>
      <EnrollmentPicker picker={picker} />
      <Field name="notice-due" label="Giờ gửi (giờ Việt Nam)"><input type="datetime-local" id="notice-due" name="dueAt" /></Field>
      <div className="span"><button className="primary" disabled={busy || !current?.cls || current.entitlement.state !== "ACTIVE"}>Lưu thông báo</button></div>
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
