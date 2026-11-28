"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { api, dateTime, OperationError } from "../../../lib/services/classes";
import { useOperations } from "../../../lib/services/adjustments";
import { ErrorMessage, Field, OperationDialog } from "../components/OperationUI";
import "./operations-queue.css";

type Incident = {
  jobId: string; workflowId: string; workflowVersion: number; status: string; version: number;
  failedAt: string; failedStep: string; failedAttempt: number; errorCode: string;
  alertedAt: string | null; ownerRole: "center_director";
  attempt: number; updatedAt: string; replayCount: number; replayedAt: string | null; replayedBy: string | null;
};

const incidentPath = "automation/incidents";
const pageSize = 20;
const statuses: Record<string, string> = {
  DEAD: "Cần xử lý", PENDING: "Đã xếp lịch replay", RUNNING: "Đang chạy",
  RETRY: "Chờ thử lại", WAITING: "Đang chờ điều kiện", DONE: "Workflow đã kết thúc",
};
const status = (state: string) => statuses[state] ?? state;

export default function OperationsPage() {
  return <Suspense fallback={<p role="status">Đang tải hàng đợi sự cố…</p>}><IncidentQueue /></Suspense>;
}

function IncidentQueue() {
  const selected = useSearchParams().get("incident");
  const [page, setPage] = useState(1);
  const queue = useOperations<Incident>(`${incidentPath}?pageSize=${pageSize}&page=${page}`);
  const select = (id?: string) => window.history.replaceState(null, "", id ? `?incident=${id}` : "/dashboard/operations");
  return <div className="ops incident-queue">
    <header className="ops-heading">
      <div><h1>Vận hành</h1><p className="muted">Sự cố workflow tại Bridge. Tin trong broker DLQ được kiểm tra tại RabbitMQ.</p></div>
      <button type="button" disabled={queue.busy} onClick={() => void queue.run()}>Làm mới hàng đợi</button>
    </header>
    <section className="ops-panel" aria-labelledby="incident-queue-title" aria-busy={queue.busy}>
      <h2 id="incident-queue-title">Hàng đợi sự cố</h2>
      <ErrorMessage error={queue.error} retry={() => void queue.run()} />
      {!queue.rows.length && !queue.error && <p role="status">{queue.busy ? "Đang tải sự cố…" : "Chưa có sự cố workflow."}</p>}
      <ul className="incident-list">
        {queue.rows.map(row => <li key={row.jobId} className="incident-row">
          <div>
            <strong>{row.workflowId} · {row.failedStep}</strong>
            <p className="muted"><time dateTime={row.failedAt}>{dateTime(row.failedAt)}</time> · Lần {row.failedAttempt}</p>
          </div>
          <code>{row.errorCode}</code>
          <span className={row.status === "DEAD" ? "incident-open" : "muted"}>{status(row.status)}</span>
          <button type="button" onClick={() => select(row.jobId)} aria-label={`Xem sự cố ${row.workflowId} ${row.jobId}`}>Xem sự cố</button>
        </li>)}
      </ul>
      {(page > 1 || (queue.pagination?.total ?? 0) > pageSize) && <nav className="ops-actions" aria-label="Phân trang sự cố">
        <button type="button" disabled={queue.busy || page === 1} onClick={() => setPage(page - 1)}>Trang trước</button>
        <span>Trang {page}</span>
        <button type="button" disabled={queue.busy || page * pageSize >= (queue.pagination?.total ?? 0)} onClick={() => setPage(page + 1)}>Trang sau</button>
      </nav>}
    </section>
    {selected && /^[a-f0-9-]{36}$/i.test(selected) && <IncidentDetail key={selected} id={selected} close={() => select()} refreshQueue={queue.run} />}
  </div>;
}

function IncidentDetail({ id, close, refreshQueue }: { id: string; close: () => void; refreshQueue: () => Promise<void> }) {
  const [incident, setIncident] = useState<Incident>();
  const [readError, setReadError] = useState<unknown>();
  const [submitError, setSubmitError] = useState<unknown>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const resource = `${incidentPath}/${id}`;
  const conflict = submitError instanceof OperationError && submitError.code === "REPLAY_CONFLICT";

  useEffect(() => {
    let current = true;
    void api<Incident>(resource).then(
      value => { if (current) setIncident(value.data); },
      error => { if (current) setReadError(error); },
    );
    return () => { current = false; };
  }, [resource]);

  async function reload() {
    setBusy(true);
    setReadError(null);
    try {
      setIncident((await api<Incident>(resource)).data);
      setSubmitError(null);
      await refreshQueue();
    } catch (error) { setReadError(error); }
    finally { setBusy(false); }
  }

  async function replay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!incident || busy || conflict || incident.status !== "DEAD" || reason.trim().length < 10) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const { data } = await api<Pick<Incident, "status" | "version">>(`automation/jobs/${id}/replay`, "POST", {
        expectedVersion: incident.version, reason: reason.trim(),
      });
      setIncident({ ...incident, ...data });
      setReason("");
    } catch (error) {
      setSubmitError(error);
      setBusy(false);
      return;
    }
    await reload();
  }

  return <OperationDialog title="Chi tiết sự cố" onClose={close} drawer>
    <ErrorMessage error={readError} retry={() => void reload()} />
    {!incident && !readError && <p role="status">Đang tải chi tiết…</p>}
    {incident && <>
      <p className="incident-summary"><strong>{incident.workflowId} · v{incident.workflowVersion}</strong> <span role="status">{status(incident.status)}</span></p>
      <dl className="incident-facts">
        <dt>Job</dt><dd><code>{incident.jobId}</code></dd>
        <dt>Bước lỗi</dt><dd>{incident.failedStep}</dd>
        <dt>Lúc xảy ra</dt><dd>{dateTime(incident.failedAt)}</dd>
        <dt>Lần thử khi lỗi</dt><dd>{incident.failedAttempt}</dd>
        <dt>Mã lỗi</dt><dd><code>{incident.errorCode}</code></dd>
        <dt>Nhóm xử lý</dt><dd>Giám đốc trung tâm</dd>
        <dt>Ghi cảnh báo</dt><dd>{incident.alertedAt ? dateTime(incident.alertedAt) : "Đang chờ"}</dd>
        <dt>Replay</dt><dd>{incident.replayCount} lần</dd>
        {incident.replayedAt && <>
          <dt>Replay gần nhất</dt><dd>{dateTime(incident.replayedAt)}</dd>
          <dt>Người replay</dt><dd><code>{incident.replayedBy}</code></dd>
          <dt>Kết quả hiện tại</dt><dd>{status(incident.status)} · Lần thử {incident.attempt}</dd>
        </>}
      </dl>
      <p><button type="button" onClick={() => void reload()} disabled={busy}>Tải trạng thái mới</button></p>
      {incident.status === "DEAD" && <form className="incident-replay" onSubmit={replay}>
        <h3>Hướng xử lý</h3>
        <p>{incident.errorCode === "PAYMENT_UNKNOWN"
          ? "Đối chiếu kết quả đã ghi tại Payment. Khi nguyên nhân đã được xử lý, replay cùng job để workflow tra lại chứng từ trước khi tiếp tục."
          : "Kiểm tra bước lỗi tại dịch vụ phụ trách. Khi nguyên nhân đã được xử lý, replay cùng job để tiếp tục từ kết quả đã lưu."}</p>
        <Field name="incident-replay-reason" label="Lý do replay">
          <textarea id="incident-replay-reason" required minLength={10} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {conflict ? <p role="alert" className="ops-error">Phiên bản đã thay đổi. Tải trạng thái mới để đọc kết quả hoặc gửi lại.</p> : <ErrorMessage error={submitError} />}
        <button type="submit" className="primary" disabled={busy || conflict || reason.trim().length < 10}>Replay job</button>
      </form>}
    </>}
  </OperationDialog>;
}
