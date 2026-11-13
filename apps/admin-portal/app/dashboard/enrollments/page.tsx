"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, allPages, dateTime, money, enrollmentStates, confirmationStates, moneyStates, type Enrollment, type EnrollmentConfirmation } from "../../../lib/services/enrollments";
import { intentKey, type PersonView } from "../../../lib/services/crm";
import type { ClassView, Package } from "../../../lib/services/classes";
import { ErrorMessage, Field } from "../components/OperationUI";
import "./enrollments.css";

export default function EnrollmentsPage() {
  const [people, setPeople] = useState<PersonView[]>([]), [classes, setClasses] = useState<ClassView[]>([]), [packages, setPackages] = useState<Package[]>([]);
  const [rows, setRows] = useState<Enrollment[]>([]), [confirmation, setConfirmation] = useState<EnrollmentConfirmation | null>(null);
  const [selection, setSelection] = useState({ contactId: "", learnerId: "", payerId: "", classId: "", packageId: "" });
  const [accepted, setAccepted] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const previewIntent = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, c, offers, enrollments] = await Promise.all([
        allPages<PersonView>("crm/people"), allPages<ClassView>("classes"), allPages<Package>("packages?status=active"), allPages<Enrollment>("enrollments"),
      ]);
      setPeople(p); setClasses(c); setPackages(offers); setRows(enrollments);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const confirmationId = confirmation?.id, confirmationStatus = confirmation?.status;
  const enrollmentStatus = confirmation?.enrollment?.status;
  useEffect(() => {
    if (!confirmationId || !["CONFIRMED", "CONSUMED"].includes(confirmationStatus ?? "") || ["CONFIRMED", "CANCELLED", "EXPIRED", "REFUND_PENDING"].includes(enrollmentStatus ?? "")) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<EnrollmentConfirmation>(`enrollment-confirmations/${confirmationId}`);
        if (cancelled) return;
        setConfirmation(result.data);
        timer = setTimeout(() => void poll(), 3000);
      } catch (e) { if (!cancelled) setError(e); }
    }
    timer = setTimeout(() => void poll(), 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [confirmationId, confirmationStatus, enrollmentStatus]);
  function change(name: keyof typeof selection, value: string) {
    setSelection(previous => ({ ...previous, [name]: value, ...(name === "classId" ? { packageId: classes.find(c => c.id === value)?.packageId ?? "" } : {}) }));
    setConfirmation(null); setAccepted(false); setError(null);
  }
  async function preview() {
    setBusy(true); setError(null);
    try {
      const result = await api<EnrollmentConfirmation>("enrollment-confirmations/preview", "POST", selection, intentKey(previewIntent, selection));
      setConfirmation(result.data); setAccepted(false);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function refreshConfirmation(id: string) {
    const result = await api<EnrollmentConfirmation>(`enrollment-confirmations/${id}`);
    setConfirmation(result.data);
    setRows(await allPages<Enrollment>("enrollments"));
    return result.data;
  }
  async function confirm() {
    if (!confirmation || !accepted) return;
    setBusy(true); setError(null);
    try {
      // Read the source record first after any uncertain response; confirmation IDs are consumed once.
      const current = (await api<EnrollmentConfirmation>(`enrollment-confirmations/${confirmation.id}`)).data;
      setConfirmation(current);
      if (current.status === "DRAFT") await api(`enrollment-confirmations/${current.id}/confirm`, "POST", { accepted: true });
      await refreshConfirmation(current.id);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function lookup(id: string) {
    setBusy(true); setError(null); setAccepted(false);
    try { await refreshConfirmation(id); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!confirmation) return;
    setBusy(true); setError(null);
    try { await api(`enrollment-confirmations/${confirmation.id}/revoke`, "POST", {}); await refreshConfirmation(confirmation.id); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  const learnerName = (id: string) => people.find(p => p.id === id)?.fullName ?? id;
  const className = (id: string) => classes.find(c => c.id === id)?.name ?? id;
  const enrollment = confirmation?.enrollment, payment = enrollment?.paymentRequest;
  const draft = confirmation?.status === "DRAFT";
  return <div className="ops enrollment-page">
    <header className="ops-heading"><div><h1>Đăng ký học</h1><p className="muted">Xác nhận gói và điều khoản, theo dõi tiền và chỗ học từ hệ thống.</p></div><button disabled={loading || busy} onClick={() => void load()}>Làm mới danh sách</button></header>
    <ErrorMessage error={error} />
    <div className="enrollment-workspace">
      <section className="ops-panel" aria-busy={loading || busy}>
        <h2>Yêu cầu đăng ký</h2>
        {loading ? <p role="status">Đang tải hồ sơ, lớp và gói học…</p> : <form className="ops-form" onSubmit={e => { e.preventDefault(); void preview(); }}>
          {(["contactId", "learnerId", "payerId"] as const).map((name, i) => <Field key={name} name={name} label={["Người liên hệ", "Học viên", "Người trả tiền"][i]} error={error}>
            <select id={name} required disabled={busy} value={selection[name]} onChange={e => change(name, e.target.value)}><option value="">Chọn hồ sơ</option>{people.filter(p => p.kind === ["CONTACT", "LEARNER", "PAYER"][i] && p.status === "ACTIVE").map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select>
          </Field>)}
          <Field name="classId" label="Lớp học" error={error}><select id="classId" required disabled={busy} value={selection.classId} onChange={e => change("classId", e.target.value)}><option value="">Chọn lớp</option>{classes.filter(c => c.status === "OPEN").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field name="packageId" label="Gói học" error={error}><select id="packageId" required disabled={busy} value={selection.packageId} onChange={e => change("packageId", e.target.value)}><option value="">Chọn gói</option>{packages.filter(p => !selection.classId || p.id === classes.find(c => c.id === selection.classId)?.packageId).map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.priceVnd)}</option>)}</select></Field>
          <div className="span ops-actions"><button type="submit" disabled={busy || !!confirmation && !draft}>Xem báo giá và điều khoản</button>{confirmation && <button type="button" disabled={busy} onClick={() => { setConfirmation(null); setAccepted(false); previewIntent.current = null; }}>Yêu cầu mới</button>}</div>
        </form>}
      </section>
      <section className="ops-panel enrollment-result" aria-live="polite" aria-busy={busy}>
        <h2>{enrollment ? "Tiền và chỗ học" : "Xác nhận báo giá"}</h2>
        {!confirmation ? <p>Chọn đúng người liên hệ, học viên, người trả tiền và lớp để xem điều khoản trước khi xác nhận.</p> : <>
          <p><strong>{enrollment ? enrollmentStates[enrollment.status] ?? enrollment.status : confirmationStates[confirmation.status] ?? confirmation.status}</strong></p>
          <dl><dt>Học viên</dt><dd>{learnerName(confirmation.snapshot.learnerId)}</dd><dt>Lớp</dt><dd>{className(confirmation.snapshot.classId)}</dd><dt>Số tiền</dt><dd>{money(confirmation.snapshot.amountDue)}</dd><dt>Chính sách</dt><dd>{confirmation.snapshot.policyVersion} · {confirmation.snapshot.termsVersion}</dd><dt>Hạn xác nhận</dt><dd>{dateTime(confirmation.expiresAt)}</dd></dl>
          {draft && <>
            <p className="enrollment-terms">{confirmation.snapshot.terms}</p>
            <label className="enrollment-accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /><span>Tôi xác nhận đúng học viên, lớp, gói, số tiền và điều khoản hiển thị.</span></label>
            <div className="ops-actions"><button className="primary" disabled={busy || !accepted} onClick={() => void confirm()}>Xác nhận mua</button><button disabled={busy} onClick={() => void revoke()}>Rút xác nhận</button></div>
          </>}
          {!draft && !enrollment && <p>Đang chờ xử lý đăng ký. Chỗ học chỉ được xác nhận sau khi đối soát tiền và chốt chỗ thành công.</p>}
          {enrollment && <><dl><dt>Trạng thái tiền</dt><dd>{enrollment.moneyStatus ? moneyStates[enrollment.moneyStatus] ?? enrollment.moneyStatus : "Chưa xác minh"}</dd><dt>Chỗ học</dt><dd>{enrollmentStates[enrollment.status] ?? enrollment.status}</dd>{enrollment.expiresAt && <><dt>Hạn giữ chỗ</dt><dd>{dateTime(enrollment.expiresAt)}</dd></>}</dl></>}
          {payment && <div className="enrollment-payment"><h3>Yêu cầu thanh toán {payment.adapter === "SYNTHETIC" ? "DEMO" : ""}</h3><p>Trạng thái: {payment.status}</p><dl><dt>Số tiền</dt><dd>{money(payment.amountDue)}</dd><dt>Mã tham chiếu</dt><dd><code>{payment.reference}</code></dd><dt>Hạn thanh toán</dt><dd>{dateTime(payment.expiresAt)}</dd></dl>{payment.qrPayload && <><p>Nội dung QR {payment.adapter === "SYNTHETIC" ? "tổng hợp — không dùng chuyển tiền thật" : ""}</p><code className="enrollment-qr">{payment.qrPayload}</code></>}</div>}
          <div className="ops-actions"><button disabled={busy} onClick={() => void lookup(confirmation.id)}>Tra cứu trạng thái</button></div>
          <p className="muted">Mã xác nhận: <code>{confirmation.id}</code>{enrollment && <> · Mã đăng ký: <code>{enrollment.id}</code></>}</p>
        </>}
      </section>
    </div>
    <section className="ops-panel" aria-busy={loading}>
      <div className="ops-heading"><h2>Đăng ký đã tiếp nhận</h2><span className="muted">{loading ? "Đang tải…" : `${rows.length} đăng ký`}</span></div>
      {!loading && !rows.length ? <p>Chưa có đăng ký trong phạm vi được cấp.</p> : <div className="ops-table-wrap"><table><thead><tr><th>Học viên / lớp</th><th>Chỗ học</th><th className="num">Số tiền</th><th>Tra cứu</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-enrollment-id={row.id}><td>{learnerName(row.snapshot.learnerId)}<p className="muted">{className(row.snapshot.classId)}</p></td><td>{enrollmentStates[row.status] ?? row.status}</td><td className="num">{money(row.snapshot.amountDue)}</td><td><button disabled={busy} onClick={() => void lookup(row.confirmationId)}>Xem trạng thái</button></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
