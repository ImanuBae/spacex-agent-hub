"use client";
import Link from "next/link";
import { useAuth } from "../../../src/context/AuthContext";
import { api, dateTime, money } from "../../../lib/services/classes";
import { states, useOperations, type Operation } from "../../../lib/services/adjustments";
import { ErrorMessage } from "../components/OperationUI";

type Refund = Operation & { delta: number; receiptRef?: string; adapter: string; executionAuthorized: boolean };
export default function RefundsPage() {
  const { user } = useAuth(), { rows, busy, error, run } = useOperations<Refund>("refunds");
  return <div className="ops">
    <header className="ops-heading"><div><h1>Thực hiện hoàn tiền</h1><p className="muted">Theo dõi chứng từ của bộ mô phỏng thanh toán.</p></div><Link href="/dashboard/adjustments" className="ops-link">Yêu cầu điều chỉnh</Link></header>
    <ErrorMessage error={error} />
    <section className="ops-panel" aria-busy={busy}><h2>Khoản chờ kế toán</h2>
      <button onClick={() => void run()} disabled={busy}>Làm mới</button>
      {!rows.length && <p role="status">{busy ? "Đang tải khoản hoàn…" : "Chưa có khoản hoàn."}</p>}
      {rows.map(row => <article key={row.id} className="n8n06-row" data-refund-id={row.id}><div>
        <strong>{money(Math.abs(row.delta))}</strong><p>{states[row.status] ?? row.status}</p>
        <small>{row.deadlineAt && dateTime(row.deadlineAt)} · {row.adapter}</small>
        {row.receiptRef && <p>Chứng từ mô phỏng {row.receiptRef}</p>}</div>
        {user?.role === "accountant" && !row.executionAuthorized && ["WAITING", "RESERVED"].includes(row.status) && <button disabled={busy} onClick={() => void run(() => api("refunds/"+row.id+"/execute", "POST", { version: row.version }))}>{row.delta > 0 ? "Cho phép thu chênh lệch mô phỏng" : "Cho phép thực hiện hoàn mô phỏng"}</button>}
      </article>)}
    </section>
  </div>;
}
