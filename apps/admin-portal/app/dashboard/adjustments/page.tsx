"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "../../../src/context/AuthContext";
import { api, allPages, dateTime, money, type ClassView } from "../../../lib/services/classes";
import { kinds, states, useOperations, type Adjustment } from "../../../lib/services/adjustments";
import { intentKey } from "../../../lib/services/crm";
import type { Enrollment } from "../../../lib/services/enrollments";
import { ErrorMessage, Field } from "../components/OperationUI";

export default function AdjustmentsPage() {
  const { user } = useAuth(), { rows, busy, error, run } = useOperations<Adjustment>("adjustments");
  const accountant = user?.role === "accountant", director = user?.role === "center_director" || user?.role === "branch_director";
  const [type, setType] = useState(accountant ? "REFUND" : "TRANSFER");
  const [classes, setClasses] = useState<ClassView[]>([]), [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [detail, setDetail] = useState<Adjustment>(), [optionsError, setOptionsError] = useState<unknown>(null);
  const request = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    if (accountant) return;
    Promise.all([allPages<ClassView>("classes?status=OPEN"), allPages<Enrollment>("enrollments")])
      .then(([c, e]) => { setClasses(c); setEnrollments(e); }).catch(setOptionsError);
  }, [accountant]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), target = classes.find(c => c.id === form.get("target")), classChangeId = String(form.get("classChangeId") ?? "").trim();
    const input = { enrollmentId: String(form.get("enrollmentId")), version: Number(form.get("version")), type,
      reason: String(form.get("reason")), ...(classChangeId ? { classChangeId } : {}), ...(target ? { targetClassId: target.id, packageId: target.packageId } : {}),
      ...(type === "REFUND" ? { amount: Number(form.get("amount")), refundMode: String(form.get("refundMode")) } : {}) };
    void run(async () => { await api("adjustments", "POST", input, intentKey(request, input)); request.current = null; });
  }
  return <div className="ops">
    <header className="ops-heading"><div><h1>Điều chỉnh quyền lợi</h1><p className="muted">Theo dõi chuyển lớp, bảo lưu và hoàn tiền theo từng đăng ký.</p></div><div className="ops-actions">{!accountant && <Link className="ops-link" href="/dashboard/adjustments/waitlist">Danh sách chờ</Link>}<button onClick={() => void run()} disabled={busy}>Làm mới</button></div></header>
    <ErrorMessage error={error ?? optionsError} />
    <section className="ops-panel"><h2>Lập yêu cầu</h2>
      <form className="ops-form" onSubmit={submit}>
        <Field name="adjustment-type" label="Nghiệp vụ"><select id="adjustment-type" value={type} onChange={e => setType(e.target.value)}>{(accountant ? ["REFUND"] : ["TRANSFER", "SUSPEND", "RESUME"]).map(kind => <option key={kind} value={kind}>{kinds[kind]}</option>)}</select></Field>
        <Field name="adjustment-enrollment" label="Mã đăng ký"><input id="adjustment-enrollment" name="enrollmentId" list="adjustment-enrollments" required /><datalist id="adjustment-enrollments">{enrollments.map(e => <option key={e.id} value={e.id}>Phiên bản {e.version}</option>)}</datalist></Field>
        <Field name="adjustment-version" label="Phiên bản quyền lợi"><input id="adjustment-version" name="version" type="number" min="1" required /></Field>
        {["TRANSFER", "RESUME"].includes(type) && <Field name="adjustment-target" label="Lớp đích"><select id="adjustment-target" name="target" required><option value="">Chọn lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        {type === "REFUND" && <><Field name="adjustment-amount" label="Số tiền hoàn (VND)"><input id="adjustment-amount" type="number" min="1" name="amount" required /></Field><Field name="adjustment-refund-mode" label="Phương án hoàn"><select id="adjustment-refund-mode" name="refundMode"><option value="EXCESS">Hoàn phần tiền dư</option><option value="CANCEL">Hủy quyền lợi và hoàn tiền</option></select></Field></>}
        <Field name="adjustment-reason" label="Lý do"><textarea id="adjustment-reason" name="reason" minLength={10} maxLength={1000} required /></Field>
        <Field name="adjustment-plan" label="Mã phương án hủy lớp (nếu có)"><input id="adjustment-plan" name="classChangeId" /></Field>
        <div className="span"><button className="primary" disabled={busy}>Gửi yêu cầu</button></div>
      </form>
    </section>
    <section className="ops-panel" aria-busy={busy}><h2>Danh sách yêu cầu</h2>
      {!rows.length && <p role="status">{busy ? "Đang tải yêu cầu…" : "Chưa có yêu cầu điều chỉnh."}</p>}
      {rows.map(row => <article key={row.id} className="n8n06-row" data-adjustment-id={row.id}>
        <div><strong>{kinds[row.type]}</strong><p>{states[row.status] ?? row.status} · {row.customerChoice ? "Đã có lựa chọn của học viên" : "Chưa có lựa chọn của học viên"}</p><small>{row.deadlineAt && dateTime(row.deadlineAt)} · {money(row.amountDelta)}</small><p>{row.reason}</p></div>
        <div className="ops-actions"><button onClick={() => void run(async () => setDetail((await api<Adjustment>("adjustments/"+row.id)).data))} disabled={busy}>Xem lịch sử</button>
        {director && row.status === "REQUESTED" && <button disabled={busy} onClick={() => void run(() => api("adjustments/"+row.id+"/approve", "POST", { version: row.version }))}>Duyệt yêu cầu</button>}
        {director && ["REQUESTED", "APPROVED"].includes(row.status) && <button disabled={busy} onClick={() => void run(() => api("adjustments/"+row.id+"/revoke", "POST", { version: row.version }))}>Thu hồi</button>}</div>
      </article>)}
    </section>
    {detail && <section className="ops-panel" aria-live="polite"><h2>Lịch sử yêu cầu</h2><p>{detail.id}</p><ol>{detail.history?.map(row => <li key={row.version}>{dateTime(row.createdAt)} · {row.action}</li>)}</ol></section>}
  </div>;
}
