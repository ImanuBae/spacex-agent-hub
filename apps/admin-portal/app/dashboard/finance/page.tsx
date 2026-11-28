"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useOperations } from "../../../lib/services/adjustments";
import { dateTime, money } from "../../../lib/services/classes";
import { transactionStatuses, type Transaction } from "../../../lib/services/finance";
import { useAuth } from "../../../src/context/AuthContext";
import { ErrorMessage, Field } from "../components/OperationUI";
import "./finance.css";

export default function FinancePage() {
  return <Suspense fallback={<p role="status">Đang tải giao dịch…</p>}><Finance /></Suspense>;
}

function Finance() {
  const { user } = useAuth();
  const receipt = useSearchParams().get("receipt");
  const [filters, setFilters] = useState({ q: "", status: "", page: 1 });
  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFilters({ q: String(data.get("q")).trim(), status: String(data.get("status")), page: 1 });
  }

  return <div className="ops finance-page">
    <header className="ops-heading">
      <h1>Tài chính</h1>
      {user?.role === "accountant" && <Link className="ops-link" href="/dashboard/refunds">Hoàn tiền</Link>}
    </header>
    {receipt && <section className="ops-panel" aria-labelledby="finance-receipt-title">
      <div className="ops-heading">
        <h2 id="finance-receipt-title">Chứng từ giao dịch</h2>
        <Link className="ops-link" href="/dashboard/finance">Đóng chứng từ</Link>
      </div>
      {/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt)
        ? <TransactionList key={receipt} resource={`payment-transactions?id=${receipt}`} />
        : <p role="status">Không tìm thấy chứng từ.</p>}
    </section>}
    <section className="ops-panel" aria-labelledby="finance-list-title">
      <div className="ops-heading"><h2 id="finance-list-title">Giao dịch thanh toán</h2></div>
      <form className="ops-filters" onSubmit={search}>
        <Field name="transaction-search" label="Mã giao dịch hoặc mã chuyển khoản">
          <input id="transaction-search" name="q" type="search" maxLength={200} defaultValue={filters.q} />
        </Field>
        <Field name="transaction-status" label="Trạng thái">
          <select id="transaction-status" name="status" defaultValue={filters.status}>
            <option value="">Tất cả trạng thái</option>
            {Object.entries(transactionStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <button type="submit">Tìm giao dịch</button>
      </form>
      <TransactionList key={params.toString()} resource={`payment-transactions?${params}`}
        onPage={page => setFilters(current => ({ ...current, page }))} />
    </section>
  </div>;
}

function TransactionList({ resource, onPage }: { resource: string; onPage?: (page: number) => void }) {
  const { rows, pagination, busy, error, run } = useOperations<Transaction>(resource);
  const { page = 1, pageSize = 20, total = 0 } = pagination ?? {};
  const pages = Math.ceil(total / pageSize);
  return <div aria-busy={busy}>
    <ErrorMessage error={error} retry={() => void run()} />
    {busy ? <p role="status">Đang tải giao dịch…</p> : !error && <>
      {onPage && <p className="muted" role="status">{total} giao dịch · Giờ Việt Nam</p>}
      {!rows.length && <p role="status">{onPage ? "Không có giao dịch phù hợp." : "Không tìm thấy chứng từ."}</p>}
      {rows.length > 0 && <ul className="finance-transactions">
        {rows.map(row => <li className="finance-transaction" key={row.id}>
          <div>
            <p className="muted">{row.kind === "REFUND" ? "Khoản hoàn" : "Tiền nhận"}{row.demo && " · DEMO"}</p>
            <strong>{row.transactionId}</strong>
            <p className="muted">Mã chuyển khoản</p>
            <p>{row.reference || "—"}</p>
          </div>
          <div className="finance-amount">
            <strong>{money(row.amount)}</strong>
            <p className="status" data-status={row.status}>{transactionStatuses[row.status]}</p>
          </div>
          <div>
            <p className="muted">{row.kind === "REFUND" ? "Thời điểm hoàn" : "Thời điểm nhận"}</p>
            {row.receivedAt ? <time dateTime={row.receivedAt}>{dateTime(row.receivedAt)}</time> : <p>Chưa có chứng từ</p>}
            {!onPage && row.receiptRef && <p>Chứng từ DEMO {row.receiptRef}</p>}
          </div>
          {onPage && (row.reviewId
            ? <Link className="ops-link" href={`/dashboard/reconciliation?review=${row.reviewId}`}>Mở ca đối soát</Link>
            : <Link className="ops-link" href={`/dashboard/finance?receipt=${row.id}`}>{row.receivedAt ? "Xem chứng từ" : "Xem khoản hoàn"}</Link>)}
        </li>)}
      </ul>}
      {onPage && (pages > 1 || page > 1) && <nav className="ops-actions" aria-label="Phân trang giao dịch">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Trang trước</button>
        <span>Trang {page}{pages > 0 && ` / ${pages}`}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Trang sau</button>
      </nav>}
    </>}
  </div>;
}
