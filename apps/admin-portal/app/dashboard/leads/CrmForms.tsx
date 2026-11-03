"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PersonInput, PersonView, LeadView } from "@spacex/contracts";
import { api, allPages, intentKey, kinds, stages, sources, type Assignee } from "../../../lib/services/crm";
import type { Branch } from "../../../lib/services/classes";
import type { Course } from "../../../lib/services/courses";
import { ErrorMessage, Field, OperationDialog } from "../components/OperationUI";

export function PersonForm({ branches, initial, onClose, onSaved }: { branches: Branch[]; initial?: PersonView; onClose: () => void; onSaved: (person: PersonView) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [grant, setGrant] = useState(false);
  const personIntent = useRef<{ payload: string; key: string } | null>(null), consentIntent = useRef<{ payload: string; key: string } | null>(null);
  const saved = useRef<PersonView | null>(initial ?? null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const input: PersonInput = { branchId: initial?.branchId ?? String(f.get("branchId")), kind: (initial?.kind ?? f.get("kind")) as PersonInput["kind"], fullName: String(f.get("fullName")).trim(), phone: String(f.get("phone")).trim(), email: String(f.get("email")).trim(), notes: String(f.get("notes")).trim() };
      const result = saved.current ? await api<PersonView>(`crm/people/${saved.current.id}`, "PUT", { version: saved.current.version, input }) : await api<PersonView>("crm/people", "POST", input, intentKey(personIntent, input));
      saved.current = result.data;
      if (grant) {
        const consent = { purpose: "ADMISSIONS", status: "GRANTED", statementVersion: String(f.get("statementVersion")), statementText: String(f.get("statementText")), method: String(f.get("method")) };
        await api(`crm/people/${result.data.id}/consents`, "POST", consent, intentKey(consentIntent, consent));
      }
      onSaved(result.data);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <OperationDialog title={initial ? "Sửa hồ sơ" : "Tạo hồ sơ khách hàng"} onClose={() => { if (!busy) onClose(); }}>
    <form className="ops-form" onSubmit={e => void submit(e)}>
      <Field name="person-branch" label="Chi nhánh"><select id="person-branch" name="branchId" required disabled={!!initial} defaultValue={initial?.branchId ?? ""}><option value="">Chọn chi nhánh</option>{branches.filter(b => b.kind === "branch" && b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field name="person-kind" label="Loại hồ sơ"><select id="person-kind" name="kind" disabled={!!initial} defaultValue={initial?.kind ?? "CONTACT"}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field name="fullName" label="Họ và tên" error={error}><input id="fullName" name="fullName" required maxLength={150} defaultValue={initial?.fullName ?? ""} /></Field>
      <Field name="phone" label="Số điện thoại" error={error}><input id="phone" name="phone" type="tel" maxLength={30} defaultValue={initial?.phone ?? ""} /></Field>
      <Field name="email" label="Email" error={error}><input id="email" name="email" type="email" maxLength={254} defaultValue={initial?.email ?? ""} /></Field>
      <Field name="notes" label="Ghi chú" error={error}><textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ""} /></Field>
      <div className="span"><label className="crm-check"><input type="checkbox" checked={grant} onChange={e => setGrant(e.target.checked)} />Đã ghi nhận đồng ý cho mục đích tư vấn tuyển sinh</label><p className="muted">Không tự đăng ký marketing. Chưa có đồng ý thì lưu hồ sơ, chưa tạo lead tư vấn cá nhân.</p></div>
      {grant && <>
        <Field name="statementVersion" label="Phiên bản thông báo đã dùng"><input id="statementVersion" name="statementVersion" required maxLength={50} /></Field>
        <Field name="method" label="Cách ghi nhận"><select id="method" name="method"><option value="WRITTEN">Văn bản</option><option value="VERBAL">Trao đổi trực tiếp / điện thoại</option><option value="WEB_FORM">Biểu mẫu web</option></select></Field>
        <div className="span"><Field name="statementText" label="Nội dung khách đã được thông báo"><textarea id="statementText" name="statementText" required maxLength={5000} rows={3} /></Field></div>
      </>}
      <div className="span"><ErrorMessage error={error} /><div className="ops-actions"><button type="button" disabled={busy} onClick={onClose}>Đóng</button><button className="primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu hồ sơ"}</button></div></div>
    </form>
  </OperationDialog>;
}

export function LeadForm({ branches, courses, initial, manager, currentUserId, onClose, onSaved }: { branches: Branch[]; courses: Course[]; initial?: LeadView; manager: boolean; currentUserId: string; onClose: () => void; onSaved: () => void }) {
  const [branchId, setBranchId] = useState(initial?.branchId ?? ""), [people, setPeople] = useState<PersonView[]>([]), [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState<unknown>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const intent = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (!branchId) return;
    const load = async () => {
      setLoading(true); setLoadError(null);
      try { const [profiles, owners] = await Promise.all([initial ? Promise.resolve([]) : allPages<PersonView>(`crm/people?branchId=${branchId}`), api<Assignee[]>(`assignees?branchId=${branchId}`)]); if (active) { setPeople(profiles); setAssignees(owners.data); } }
      catch (e) { if (active) setLoadError(e); }
      finally { if (active) setLoading(false); }
    };
    void load(); return () => { active = false; };
  }, [branchId, initial]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(null);
    try {
      const ownerId = manager ? String(f.get("ownerId") ?? "") || null : initial?.ownerId ?? currentUserId;
      if (initial) await api(`crm/leads/${initial.id}`, "PUT", { version: initial.version, stage: f.get("stage"), ownerId, notes: f.get("notes") });
      else {
        const input = { branchId, contactId: f.get("contactId"), learnerId: String(f.get("learnerId") ?? "") || null, payerId: String(f.get("payerId") ?? "") || null, courseId: String(f.get("courseId") ?? "") || null, source: f.get("source"), ownerId, notes: f.get("notes") };
        await api("crm/leads", "POST", input, intentKey(intent, input));
      }
      onSaved();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <OperationDialog title={initial ? `Chăm sóc · ${initial.contactName}` : "Tạo lead tư vấn"} onClose={() => { if (!busy) onClose(); }}>
    <form className="ops-form" onSubmit={e => void submit(e)}>
      <Field name="lead-branch" label="Chi nhánh"><select id="lead-branch" value={branchId} required disabled={!!initial} onChange={e => setBranchId(e.target.value)}><option value="">Chọn chi nhánh</option>{branches.filter(b => b.active && b.kind === "branch").map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      {initial ? <Field name="stage" label="Giai đoạn tư vấn"><select id="stage" name="stage" defaultValue={initial.stage}>{Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field> : <>
        <Field name="source" label="Nguồn khách"><select id="source" name="source">{Object.entries(sources).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {([ ["contactId", "Người liên hệ", "CONTACT", true], ["learnerId", "Học viên (nếu đã xác minh quan hệ)", "LEARNER", false], ["payerId", "Người trả tiền (nếu đã xác minh quan hệ)", "PAYER", false] ] as const).map(([name, label, kind, required]) => <Field key={name} name={name} label={label}><select id={name} name={name} required={required} disabled={!branchId || loading || !!loadError}><option value="">{required ? "Chọn người liên hệ" : "Chưa xác định"}</option>{people.filter(p => p.kind === kind).map(p => <option key={p.id} value={p.id}>{p.fullName} {p.phone}</option>)}</select></Field>)}
        <Field name="courseId" label="Khóa quan tâm"><select id="courseId" name="courseId"><option value="">Chưa xác định</option>{courses.filter(c => c.status === "active" && (!c.branchIds.length || c.branchIds.includes(branchId))).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </>}
      {manager && <Field name="ownerId" label="Người phụ trách"><select id="ownerId" name="ownerId" defaultValue={initial?.ownerId ?? ""} disabled={!branchId || loading || !!loadError}><option value="">Chưa phân công</option>{assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      <div className="span"><Field name="lead-notes" label="Nhu cầu / ghi chú tư vấn"><textarea id="lead-notes" name="notes" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ""} /></Field></div>
      <div className="span"><p className="muted">Lead chưa phải đăng ký học. Hồ sơ người liên hệ cần có đồng ý tư vấn; liên kết học viên/người trả tiền cần quản lý xác minh.</p><ErrorMessage error={loadError} /><ErrorMessage error={error} /><div className="ops-actions"><button type="button" disabled={busy} onClick={onClose}>Đóng</button><button className="primary" disabled={busy || loading || !!loadError || !branchId}>{busy ? "Đang lưu…" : "Lưu lead"}</button></div></div>
    </form>
  </OperationDialog>;
}
