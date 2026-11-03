"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, allPages, intentKey, kinds, purposes, erasureStates, services, type PersonView, type ConsentView, type RelationshipView, type ErasureView, type ErasureTaskView } from "../../../lib/services/crm";
import { dateTime } from "../../../lib/services/classes";
import { ErrorMessage, Field, OperationDialog } from "../components/OperationUI";

type Detail = { person: PersonView; consents: ConsentView[]; relationships: RelationshipView[]; duplicates: PersonView[] };
type Action = "CONSENT" | "RELATIONSHIP" | "ERASURE" | RelationshipView;
export function PersonDetail({ id, manager, onClose, onEdit, onChanged }: { id: string; manager: boolean; onClose: () => void; onEdit: (person: PersonView) => void; onChanged: () => void }) {
  const [data, setData] = useState<Detail | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData((await api<Detail>(`crm/people/${id}`)).data); } catch (e) { setError(e); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => {
    // Read the current profile, never edit masked list values.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  return <OperationDialog title="Hồ sơ khách hàng" drawer onClose={onClose}>
    <ErrorMessage error={error} retry={() => void load()} />
    {loading ? <p role="status">Đang đọc hồ sơ…</p> : !data || error ? <p>Chưa xác minh được hồ sơ.</p> : <>
      <div className="ops-heading"><div><h2>{data.person.fullName}</h2><p className="muted">{kinds[data.person.kind]} · {data.person.status === "ERASED" ? "Đã ẩn danh" : "Đang hoạt động"}</p></div>{data.person.status === "ACTIVE" && <button onClick={() => onEdit(data.person)}>Sửa hồ sơ</button>}</div>
      <dl><dt>Điện thoại</dt><dd>{data.person.phone || "—"}</dd><dt>Email</dt><dd>{data.person.email || "—"}</dd><dt>Tiếp nhận</dt><dd>{dateTime(data.person.createdAt)}</dd></dl>
      <p className="crm-note">{data.person.notes || "Chưa có ghi chú."}</p>
      {!!data.duplicates.length && <section className="ops-panel"><h3>Hồ sơ có thông tin liên hệ trùng</h3><p className="muted">Cần kiểm tra riêng; hệ thống giữ nguyên từng hồ sơ.</p>{data.duplicates.map(p => <p key={p.id}>{p.fullName} · {p.phone || p.email}</p>)}</section>}
      <section className="ops-panel"><div className="ops-heading"><h3>Đồng ý theo mục đích</h3>{data.person.status === "ACTIVE" && <button onClick={() => setAction("CONSENT")}>Ghi nhận / thu hồi</button>}</div>
        {Object.entries(purposes).map(([purpose, label]) => { const consent = data.consents.find(c => c.purpose === purpose); return <div className="crm-consent" key={purpose}><strong>{label}</strong><p>{consent ? consent.status === "GRANTED" ? "Đã ghi nhận đồng ý" : "Đã thu hồi" : "Chưa có đồng ý"}</p>{consent && <details><summary>Thông báo đã ghi nhận · {consent.statementVersion}</summary><p className="crm-note">{consent.statementText}</p><p className="muted">{dateTime(consent.recordedAt)}</p></details>}</div>; })}
      </section>
      <section className="ops-panel"><div className="ops-heading"><h3>Quan hệ với học viên</h3>{data.person.status === "ACTIVE" && data.person.kind !== "LEARNER" && <button onClick={() => setAction("RELATIONSHIP")}>Liên kết học viên</button>}</div>
        {!data.relationships.length ? <p>Chưa có liên kết. Người liên hệ không tự động được coi là học viên hoặc người trả tiền.</p> : data.relationships.map(link => <div className="crm-consent" key={link.id}><p>{link.fromName} → {link.learnerName}</p><p className="muted">{link.kind} · {link.status === "VERIFIED" ? "Đã xác minh" : link.status === "REJECTED" ? "Không còn hiệu lực" : "Chờ quản lý xác minh"}</p>{manager && data.person.status === "ACTIVE" && <button onClick={() => setAction(link)}>{link.status === "VERIFIED" ? "Xem lại xác minh" : "Xác minh quan hệ"}</button>}</div>)}
      </section>
      {data.person.status === "ACTIVE" && <section className="ops-panel"><h3>Yêu cầu xóa thông tin</h3><p className="muted">Ghi nhận yêu cầu trước. Quản lý xác minh người yêu cầu và theo dõi xử lý từng nơi.</p><button onClick={() => setAction("ERASURE")}>Ghi nhận yêu cầu xóa</button></section>}
      {action && <ProfileAction action={action} person={data.person} onClose={() => setAction(null)} onSaved={() => { setAction(null); void load(); onChanged(); }} />}
    </>}
  </OperationDialog>;
}

function ProfileAction({ action, person, onClose, onSaved }: { action: Action; person: PersonView; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [learners, setLearners] = useState<PersonView[]>([]), [loading, setLoading] = useState(action === "RELATIONSHIP");
  const intent = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (action === "RELATIONSHIP") void allPages<PersonView>(`crm/people?branchId=${person.branchId}&kind=LEARNER`).then(rows => { if (active) setLearners(rows); }).catch(e => { if (active) setError(e); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [action, person.branchId]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(null);
    try {
      if (action === "CONSENT") {
        const input = { purpose: f.get("purpose"), status: f.get("status"), statementVersion: f.get("statementVersion"), statementText: f.get("statementText"), method: f.get("method") };
        await api(`crm/people/${person.id}/consents`, "POST", input, intentKey(intent, input));
      } else if (action === "RELATIONSHIP") {
        const input = { fromPersonId: person.id, learnerId: f.get("learnerId"), kind: f.get("kind") };
        await api("crm/relationships", "POST", input, intentKey(intent, input));
      } else if (action === "ERASURE") {
        const input = { personId: person.id, reason: f.get("reason") };
        await api("crm/erasure-requests", "POST", input, intentKey(intent, input));
      } else await api(`crm/relationships/${action.id}/decision`, "POST", { version: action.version, status: f.get("status"), evidenceRef: f.get("evidenceRef") });
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const title = action === "CONSENT" ? "Ghi nhận đồng ý / thu hồi" : action === "RELATIONSHIP" ? "Liên kết học viên" : action === "ERASURE" ? "Ghi nhận yêu cầu xóa" : "Xác minh quan hệ học viên";
  return <OperationDialog title={title} onClose={() => { if (!busy) onClose(); }}>
    <p><strong>{person.fullName}</strong></p>
    <form className="ops-form" onSubmit={e => void submit(e)}>
      {action === "CONSENT" && <>
        <Field name="purpose" label="Mục đích"><select id="purpose" name="purpose">{Object.entries(purposes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field name="consent-status" label="Khách xác nhận"><select id="consent-status" name="status"><option value="GRANTED">Đồng ý</option><option value="REVOKED">Thu hồi đồng ý</option></select></Field>
        <Field name="statementVersion" label="Phiên bản thông báo"><input id="statementVersion" name="statementVersion" required maxLength={50} /></Field>
        <Field name="method" label="Cách ghi nhận"><select id="method" name="method"><option value="WRITTEN">Văn bản</option><option value="VERBAL">Trực tiếp / điện thoại</option><option value="WEB_FORM">Biểu mẫu web</option></select></Field>
        <div className="span"><Field name="statementText" label="Nội dung đã thông báo / yêu cầu thu hồi"><textarea id="statementText" name="statementText" required maxLength={5000} rows={3} /></Field></div>
      </>}
      {action === "RELATIONSHIP" && <>
        <Field name="learnerId" label="Hồ sơ học viên"><select id="learnerId" name="learnerId" required disabled={loading}><option value="">{loading ? "Đang tải học viên…" : "Chọn học viên"}</option>{learners.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
        <Field name="relationship-kind" label="Quan hệ khai báo"><select id="relationship-kind" name="kind"><option value="SELF">Cùng một người, hai vai trò</option><option value="PARENT">Cha / mẹ</option><option value="GUARDIAN">Người giám hộ</option><option value="OTHER">Khác</option></select></Field><p className="span muted">Khai báo chưa cấp quyền đại diện; cần quản lý xác minh trước khi gắn vào lead.</p>
      </>}
      {action === "ERASURE" && <><Field name="erasure-reason" label="Lý do"><select id="erasure-reason" name="reason"><option value="SUBJECT_REQUEST">Khách yêu cầu</option><option value="DUPLICATE_RECORD">Hồ sơ trùng</option><option value="OTHER">Khác</option></select></Field><p className="span muted">Thao tác này chỉ ghi nhận yêu cầu. Hồ sơ chưa bị xóa cho đến khi quản lý xác minh.</p></>}
      {typeof action === "object" && <><Field name="relationship-status" label="Kết quả kiểm tra"><select id="relationship-status" name="status" defaultValue={action.status === "VERIFIED" ? "REJECTED" : "VERIFIED"}><option value="VERIFIED">Đã xác minh</option><option value="REJECTED">Không xác minh được / thu hồi</option></select></Field><Field name="evidenceRef" label="Mã biên bản / tham chiếu xác minh"><input id="evidenceRef" name="evidenceRef" required maxLength={100} /></Field><p className="span muted">Kiểm tra danh tính và quyền đại diện trước khi ghi nhận kết quả. Dùng mã tham chiếu, không ghi số giấy tờ vào ô này.</p></>}
      <div className="span"><ErrorMessage error={error} /><div className="ops-actions"><button type="button" disabled={busy} onClick={onClose}>Đóng</button><button className="primary" disabled={busy || loading}>{busy ? "Đang lưu…" : "Ghi nhận"}</button></div></div>
    </form>
  </OperationDialog>;
}

export function ErasureDetail({ id, manager, onClose, onChanged }: { id: string; manager: boolean; onClose: () => void; onChanged: () => void }) {
  const [request, setRequest] = useState<ErasureView | null>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"VERIFY" | "ANONYMIZE" | ErasureTaskView | null>(null);
  const load = useCallback(async () => { setError(null); try { setRequest((await api<ErasureView>(`crm/erasure-requests/${id}`)).data); } catch (e) { setError(e); } }, [id]);
  useEffect(() => {
    // Read the latest version before a sensitive decision.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!request || !action) return;
    const f = new FormData(e.currentTarget); setBusy(true); setError(null);
    try {
      const path = `crm/erasure-requests/${request.id}`;
      const result = action === "VERIFY" ? await api<ErasureView>(`${path}/decision`, "POST", { version: request.version, decision: f.get("decision"), method: f.get("method"), evidenceRef: f.get("evidenceRef") }) : action === "ANONYMIZE" ? await api<ErasureView>(`${path}/anonymize`, "POST", { version: request.version }) : await api<ErasureView>(`${path}/tasks/${action.service}`, "POST", { version: action.version, status: f.get("status"), evidenceRef: f.get("evidenceRef") });
      setRequest(result.data); setAction(null); onChanged();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <OperationDialog title="Theo dõi yêu cầu xóa" drawer onClose={() => { if (!busy) onClose(); }}>
    <ErrorMessage error={error} retry={() => void load()} />
    {!request ? <p role="status">Đang đọc yêu cầu…</p> : <>
      <h2>{request.personName}</h2><p>{erasureStates[request.status]} · {dateTime(request.createdAt)}</p>
      {manager && request.status === "PENDING_VERIFICATION" && <button onClick={() => { setError(null); setAction("VERIFY"); }}>Ghi nhận xác minh</button>}
      {manager && request.status === "VERIFIED" && <button onClick={() => { setError(null); setAction("ANONYMIZE"); }}>Ẩn danh trong CRM</button>}
      <section className="ops-panel"><h3>Tiến độ từng nơi xử lý</h3><p className="muted">Các nơi ngoài CRM cần được kiểm tra và có bằng chứng riêng. Chỉ hoàn tất yêu cầu khi mọi nơi đã được xử lý hoặc xác nhận không có dữ liệu liên quan.</p>
        {request.tasks.map(task => <div className="crm-consent" key={task.service}><div className="ops-heading"><strong>{services[task.service]}</strong><span className="status">{{ PENDING: "Chờ xử lý", DONE: "Đã xử lý", NOT_APPLICABLE: "Không có dữ liệu liên quan", BLOCKED: "Cần xử lý thêm" }[task.status]}</span></div>{task.evidenceRef && <p className="muted">Tham chiếu: {task.evidenceRef}</p>}{manager && request.status === "PROCESSING" && task.service !== "CRM" && <button onClick={() => { setError(null); setAction(task); }}>Ghi nhận kết quả · {services[task.service]}</button>}</div>)}
      </section>
      {action && <OperationDialog title={action === "VERIFY" ? "Xác minh người yêu cầu" : action === "ANONYMIZE" ? "Xác nhận ẩn danh hồ sơ" : `Kết quả xử lý · ${services[action.service]}`} onClose={() => { if (!busy) setAction(null); }}>
        <p><strong>{request.personName}</strong></p><form className="ops-form" onSubmit={e => void submit(e)}>
          {action === "VERIFY" && <><Field name="decision" label="Kết quả"><select id="decision" name="decision"><option value="VERIFIED">Đã xác minh người yêu cầu</option><option value="REJECTED">Từ chối yêu cầu</option></select></Field><Field name="method" label="Cách xác minh"><select id="method" name="method"><option value="REGISTERED_CONTACT_CALLBACK">Liên hệ lại qua thông tin đã đăng ký</option><option value="IN_PERSON_CHECK">Kiểm tra trực tiếp</option><option value="VERIFIED_REPRESENTATIVE">Người đại diện đã được xác minh</option></select></Field></>}
          {action === "ANONYMIZE" ? <div className="span"><p>Họ tên, điện thoại, email và ghi chú của hồ sơ này sẽ được ẩn danh; các lead liên quan sẽ đóng. Các nơi khác tiếp tục được theo dõi riêng.</p><label className="crm-check"><input type="checkbox" required />Tôi xác nhận đã kiểm tra yêu cầu và đúng hồ sơ cần ẩn danh.</label></div> : <>
            {typeof action === "object" && <Field name="task-status" label="Kết quả đã kiểm tra"><select id="task-status" name="status"><option value="BLOCKED">Cần xử lý thêm</option><option value="DONE">Đã xử lý, có bằng chứng</option><option value="NOT_APPLICABLE">Đã kiểm tra, không có dữ liệu liên quan</option></select></Field>}
            <Field name="evidenceRef" label="Mã biên bản / bằng chứng xử lý"><input id="evidenceRef" name="evidenceRef" required maxLength={100} /></Field>
          </>}
          <div className="span"><ErrorMessage error={error} /><div className="ops-actions"><button type="button" disabled={busy} onClick={() => setAction(null)}>Đóng</button><button className="primary" disabled={busy}>{busy ? "Đang xử lý…" : "Xác nhận"}</button></div></div>
        </form>
      </OperationDialog>}
    </>}
  </OperationDialog>;
}
