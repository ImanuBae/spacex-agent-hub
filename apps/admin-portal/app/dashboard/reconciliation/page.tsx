"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { api, dateTime, money, OperationError } from "../../../lib/services/classes";
import { states, useOperations } from "../../../lib/services/adjustments";
import { useAuth } from "../../../src/context/AuthContext";
import { ErrorMessage, Field } from "../components/OperationUI";

const choices = { EXTEND: "Gia hạn thêm 24 giờ", REFUND_PENDING: "Đưa vào diện chờ hoàn" };
const reasons: Record<string, string> = {
  UNDERPAID: "Chuyển thiếu", OVERPAID: "Chuyển thừa", UNALLOCATED_REFERENCE: "Sai mã hoặc chưa gán đơn",
  MULTIPLE_TRANSACTIONS: "Nhiều giao dịch", AFTER_CANCEL: "Tiền về sau khi hủy", NO_SEAT: "Không còn chỗ",
};
type Draft = { decision: keyof typeof choices; reason: string };
type Review = {
  id: string; branchId: string | null; status: string; reason: string; deadlineAt: string;
  version: number; extended: boolean; reference?: string; decision: Draft | null;
};
type History = { version: number; payload: Draft; createdAt: string };
type Detail = Review & {
  ledger?: { amount: string; reference: string; provider: string; account: string; transactionId: string; receivedAt: string };
  payment?: { enrollmentId: string; amountDue: string };
  proposals: (History & { actorId: string })[];
  decisions: (History & { approvedBy: string })[];
  refunds: { id: string; status: string; amount: string; receiptRef: string | null; executedAt: string | null }[];
};
const initialDraft: Draft = { decision: "REFUND_PENDING", reason: "" };

function reviewStatus(review: Review) {
  if (review.decision) return "Chờ duyệt";
  return ({ OPEN: "Cần xử lý", ESCALATED: "Quá hạn xử lý", EXTENDED: "Đã duyệt gia hạn", REFUND_PENDING: "Chờ hoàn" })[review.status] ?? review.status;
}

export default function ReconciliationPage() {
  return <Suspense fallback={<p role="status">Đang tải hàng đợi đối soát…</p>}><Queue /></Suspense>;
}

function Queue() {
  const selected = useSearchParams().get("review");
  const [page, setPage] = useState(1);
  const queue = useOperations<Review>(`payment-reviews?pageSize=20&page=${page}`);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  function open(id: string) {
    window.history.replaceState(null, "", `?review=${id}`);
    detailHeading.current?.focus();
  }
  return <div className="ops">
    <header className="ops-heading"><div><h1>Đối soát ngoại lệ</h1><p className="muted">Giao dịch cần kiểm tra và quyết định xử lý.</p></div></header>
    <div className="ops-detail-grid items-start">
      <section className="ops-panel" aria-busy={queue.busy}>
        <div className="ops-heading"><h2>Hàng đợi giao dịch</h2><button type="button" disabled={queue.busy} onClick={() => void queue.run()}>Làm mới hàng đợi</button></div>
        <ErrorMessage error={queue.error} />
        {!queue.rows.length && !queue.error && <p role="status">{queue.busy ? "Đang tải giao dịch…" : "Không có giao dịch trong hàng đợi."}</p>}
        {queue.rows.map(row => <article key={row.id} className="n8n06-row" data-review-id={row.id}>
          <div><strong>{reasons[row.reason] ?? row.reason}</strong><p>{row.reference ?? "Chưa có mã giao dịch"}</p>
            <small>Hạn {dateTime(row.deadlineAt)}</small></div>
          <div><p className="status">{reviewStatus(row)}</p><p><button type="button" aria-pressed={selected === row.id} onClick={() => open(row.id)}>Xem chứng từ</button></p></div>
        </article>)}
        {(page > 1 || (queue.pagination?.total ?? 0) > 20) && <div className="ops-actions" aria-label="Phân trang giao dịch">
          <button type="button" disabled={queue.busy || page === 1} onClick={() => setPage(page - 1)}>Trang trước</button>
          <span>Trang {page}</span>
          <button type="button" disabled={queue.busy || page * 20 >= (queue.pagination?.total ?? 0)} onClick={() => setPage(page + 1)}>Trang sau</button>
        </div>}
      </section>
      <section className="ops-panel" aria-labelledby="review-detail-title">
        <h2 id="review-detail-title" tabIndex={-1} ref={detailHeading}>Chi tiết đối soát</h2>
        {selected && /^[\da-f-]{36}$/i.test(selected)
          ? <ReviewDetail key={selected} id={selected} refreshQueue={queue.run} />
          : <p className="muted">Chọn giao dịch để đọc chứng từ và lịch sử xử lý.</p>}
      </section>
    </div>
  </div>;
}

function ReviewDetail({ id, refreshQueue }: { id: string; refreshQueue: () => Promise<void> }) {
  const { user } = useAuth();
  const draftKey = `hub:review-draft:${user?.id}:${id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as Draft | null;
      if (saved && Object.hasOwn(choices, saved.decision) && typeof saved.reason === "string") return saved;
    } catch {}
    return initialDraft;
  });
  const [row, setRow] = useState<Detail>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const resource = `payment-reviews/${id}`;
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setRow((await api<Detail>(resource)).data); setNeedsRefresh(false); }
    catch (failure) { setRow(undefined); setError(failure); }
    finally { setBusy(false); }
  }, [resource]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function updateDraft(next: Draft) {
    setDraft(next);
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch {}
  }
  async function submit(event: FormEvent<HTMLFormElement>, approve = false) {
    event.preventDefault();
    if (!row || busy || needsRefresh) return;
    const reason = draft.reason.trim();
    if (!approve && row.extended && draft.decision === "EXTEND") {
      setError(new Error("Giao dịch đã được gia hạn. Chọn phương án hiện có để dùng lại lý do."));
      return;
    }
    if (!approve && reason.length < 10) {
      setError(new Error("Nhập lý do có ít nhất 10 ký tự."));
      return;
    }
    setBusy(true); setError(null); setMessage("");
    try {
      await api(`${resource}/${approve ? "approve" : "decision"}`, "POST", approve
        ? { version: row.version } : { ...draft, reason, version: row.version });
      if (!approve) {
        setDraft(initialDraft);
        try { sessionStorage.removeItem(draftKey); } catch {}
      }
      setMessage(approve ? "Đã lưu quyết định duyệt." : "Đã gửi đề xuất để duyệt.");
      await Promise.all([load(), refreshQueue()]);
    } catch (failure) {
      const code = failure instanceof OperationError ? failure.code : "";
      const refresh = ["STALE_REVIEW_DECISION", "REVIEW_ALREADY_EXTENDED", "NETWORK_UNKNOWN"].includes(code);
      setNeedsRefresh(refresh);
      setError(refresh ? new Error("Tải lại chứng từ để kiểm tra trạng thái mới nhất trước khi gửi. Bản nháp vẫn có thể dùng lại.") : failure);
    } finally { setBusy(false); }
  }
  const refundPending = row?.status === "REFUND_PENDING";
  const canPropose = user?.role === "accountant" && !refundPending;
  const canApprove = user?.role === "center_director" || (user?.role === "branch_director" && !!row?.branchId);
  const history = row && [
    ...row.proposals.map(p => ({ ...p, action: "Đề xuất", actor: p.actorId, order: 0 })),
    ...row.decisions.map(d => ({ ...d, action: "Đã duyệt", actor: d.approvedBy, order: 1 })),
  ].sort((a, b) => a.version - b.version || a.order - b.order);

  return <div aria-busy={busy}>
    <button type="button" disabled={busy} onClick={() => void Promise.all([load(), refreshQueue()])}>Tải lại chứng từ</button>
    <ErrorMessage error={error} />
    {message && <p role="status">{message}</p>}
    {busy && !row && <p role="status">Đang tải chứng từ…</p>}
    {row && <>
      <h3>{reasons[row.reason] ?? row.reason}</h3>
      <p className="status">{reviewStatus(row)}</p>
      <dl><dt>Hạn xử lý</dt><dd>{dateTime(row.deadlineAt)}</dd>
        {!row.branchId && <><dt>Chi nhánh</dt><dd>Chưa gán chi nhánh</dd></>}
        {row.payment && <><dt>Phải thu theo đơn</dt><dd>{money(Number(row.payment.amountDue))}</dd></>}
        {row.ledger && <><dt>Đã nhận</dt><dd>{money(Number(row.ledger.amount))}</dd><dt>Mã chuyển khoản</dt><dd>{row.ledger.reference}</dd>
          <dt>Chứng từ{row.ledger.provider === "SYNTHETIC" && " · DEMO"}</dt><dd>{row.ledger.transactionId}</dd><dt>Nguồn</dt><dd>{row.ledger.provider} · {row.ledger.account}</dd>
          <dt>Thời điểm nhận</dt><dd>{dateTime(row.ledger.receivedAt)}</dd></>}
      </dl>
      {row.decision && <><h3>Đề xuất đang chờ duyệt</h3><p>{choices[row.decision.decision]}</p><p className="break-words">{row.decision.reason}</p></>}
      {canPropose && <form onSubmit={e => void submit(e)} className="ops-form">
        <Field label="Phương án" name="review-choice"><select id="review-choice" required value={draft.decision === "EXTEND" && row.extended ? "" : draft.decision}
          onChange={e => updateDraft({ ...draft, decision: e.target.value as Draft["decision"] })}>
          <option value="" disabled>Chọn phương án</option>
          <option value="REFUND_PENDING">{choices.REFUND_PENDING}</option>
          {!row.extended && <option value="EXTEND">{choices.EXTEND}</option>}
        </select></Field>
        <div className="span"><Field label="Lý do đề xuất" name="review-reason"><textarea id="review-reason" required maxLength={1000} rows={3}
          value={draft.reason} onChange={e => updateDraft({ ...draft, reason: e.target.value })} /></Field></div>
        <div className="span"><button className="primary" disabled={busy || needsRefresh} type="submit">{row.decision ? "Cập nhật đề xuất" : "Gửi đề xuất"}</button></div>
      </form>}
      {canApprove && row.decision && <form onSubmit={e => void submit(e, true)}>
        <button className="primary" disabled={busy || needsRefresh} type="submit">Duyệt đề xuất</button>
      </form>}
      <h3>Lịch sử xử lý</h3>
      {history?.length ? <ul>{history.map(item => <li className="break-words" key={`${item.order}-${item.version}`}>
        <strong>{item.action} · {choices[item.payload.decision]}</strong>
        <p>{item.payload.reason}</p><small>{dateTime(item.createdAt)} · {item.actor}</small>
      </li>)}</ul> : <p className="muted">Chưa có đề xuất hoặc quyết định.</p>}
      {refundPending && <p className="muted">Quyết định đối soát đã được duyệt. Theo dõi việc chi tiền theo chứng từ hoàn của đơn.</p>}
      {!!row.refunds.length && <><h3>Các khoản hoàn của đơn</h3>{row.refunds.map(refund => <article key={refund.id} className="n8n06-row">
        <div><strong>{money(Number(refund.amount))}</strong><p>{refund.receiptRef ? "Đã thực hiện" : refund.status === "EXECUTED" ? "Chờ xác minh chứng từ" : states[refund.status] ?? refund.status}</p>
          {refund.receiptRef && refund.executedAt && <small>Chứng từ mô phỏng {refund.receiptRef} · DEMO · {dateTime(refund.executedAt)}</small>}</div>
      </article>)}</>}
    </>}
  </div>;
}
