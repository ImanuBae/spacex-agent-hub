"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../../../src/context/AuthContext";
import { api, allPages, dateTime, localTimeInput, type ClassView, type Room, type Teacher } from "../../../lib/services/classes";
import { kinds, states, useOperations, type ClassChange } from "../../../lib/services/adjustments";
import { intentKey } from "../../../lib/services/crm";
import { ErrorMessage, Field } from "../components/OperationUI";

const vietnamTime = (value: FormDataEntryValue | null) => new Date(String(value) + ":00+07:00").toISOString();
export default function ClassChangesPage() {
  const { user } = useAuth(), { rows, busy, error, run } = useOperations<ClassChange>("class-changes");
  const [classes, setClasses] = useState<ClassView[]>([]), [classId, setClassId] = useState("");
  const [kind, setKind] = useState("RESCHEDULE"), [classesError, setClassesError] = useState<unknown>(null);
  const [decision, setDecision] = useState<ClassChange>();
  const [rooms, setRooms] = useState<Room[]>([]), [teachers, setTeachers] = useState<Teacher[]>([]);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const cls = classes.find(c => c.id === classId);
  const director = user?.role === "center_director" || user?.role === "branch_director";
  useEffect(() => { allPages<ClassView>("classes").then(setClasses).catch(setClassesError); }, []);
  useEffect(() => {
    if (director) Promise.all([allPages<Room>("rooms"), allPages<Teacher>("teachers")]).then(([r,t])=>{setRooms(r);setTeachers(t);}).catch(setClassesError);
  },[director]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cls) return;
    const form = new FormData(event.currentTarget);
    const input = kind === "CANCEL" ? undefined : {
      code: cls.code, name: cls.name, courseId: cls.courseId, packageId: cls.packageId, branchId: cls.branchId,
      teacherId: director ? String(form.get("teacherId") || "") || null : cls.teacherId,
      roomId: cls.mode === "onsite" && director ? String(form.get("roomId") || "") || null : cls.roomId,
      mode: cls.mode, onlineUrl: cls.mode === "online" && director ? String(form.get("onlineUrl") || "") || null : cls.onlineUrl,
      capacity: Number(form.get("capacity")), minimumSize: Number(form.get("minimumSize")),
      registrationClosesAt: vietnamTime(form.get("registrationClosesAt")), decisionAt: vietnamTime(form.get("decisionAt")),
      sessions: cls.sessions.map((_, i) => ({ startsAt: vietnamTime(form.get("start-"+i)), endsAt: vietnamTime(form.get("end-"+i)) })),
    };
    const targetStatus = form.get("targetStatus");
    const body = { classId, classVersion: cls.version, kind, reason: form.get("reason"), ...(input ? { input } : {}), ...(targetStatus ? { targetStatus } : {}) };
    void run(async () => { await api("class-changes", "POST", body, intentKey(request, body)); request.current = null; });
  }
  return <div className="ops">
    <header className="ops-heading"><div><h1>Đổi lịch và hủy lớp</h1><p className="muted">Duyệt phương án theo số chỗ giữ và quyền lợi bị ảnh hưởng.</p></div><button onClick={() => void run()} disabled={busy}>Làm mới</button></header>
    <ErrorMessage error={error ?? classesError} />
    <section className="ops-panel"><h2>Đề nghị thay đổi</h2><form className="ops-form" onSubmit={submit}>
      <Field name="change-class" label="Lớp"><select id="change-class" value={classId} required onChange={e => setClassId(e.target.value)}><option value="">Chọn lớp</option>{classes.filter(c => !["COMPLETED", "CANCELLED"].includes(c.status)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field name="change-kind" label="Phương án"><select id="change-kind" value={kind} onChange={e => setKind(e.target.value)}>{["RESCHEDULE", "MAKEUP", "POSTPONE", "CANCEL", "MINIMUM_SIZE"].map(value => <option key={value} value={value}>{kinds[value]}</option>)}</select></Field>
      {cls && kind !== "CANCEL" && <fieldset className="span ops-form" key={cls.id}>
        <legend>Lịch và sĩ số (giờ Việt Nam)</legend>
        {director && <Field name="plan-teacher" label="Giảng viên"><select id="plan-teacher" name="teacherId" defaultValue={cls.teacherId ?? ""}>
          <option value="">Chưa phân công</option>{teachers.filter(t=>t.branchId===cls.branchId).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
        {director && (cls.mode === "onsite" ? <Field name="plan-room" label="Phòng học"><select id="plan-room" name="roomId" defaultValue={cls.roomId ?? ""}>
          <option value="">Chưa chọn phòng</option>{rooms.filter(r=>r.branchId===cls.branchId&&r.active).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field> :
          <Field name="plan-url" label="Đường dẫn lớp"><input type="url" id="plan-url" name="onlineUrl" defaultValue={cls.onlineUrl ?? ""} /></Field>)}
        {kind === "MINIMUM_SIZE" && <Field name="plan-target-status" label="Quyết định sĩ số"><select id="plan-target-status" name="targetStatus"><option value="PLANNED">Hoãn mở lớp</option><option value="OPEN">Mở lớp theo điều kiện</option><option value="IN_PROGRESS">Bắt đầu học</option></select></Field>}
        <Field name="plan-capacity" label="Sức chứa"><input type="number" id="plan-capacity" name="capacity" min="1" max="500" defaultValue={cls.capacity} required /></Field>
        <Field name="plan-minimum" label="Sĩ số tối thiểu"><input type="number" id="plan-minimum" name="minimumSize" min="0" max="500" defaultValue={cls.minimumSize} required /></Field>
        <Field name="plan-close" label="Hạn đăng ký"><input type="datetime-local" id="plan-close" name="registrationClosesAt" defaultValue={localTimeInput(cls.registrationClosesAt)} required /></Field>
        <Field name="plan-decision" label="Hạn quyết định"><input type="datetime-local" id="plan-decision" name="decisionAt" defaultValue={localTimeInput(cls.decisionAt)} required /></Field>
        {cls.sessions.map((session, i) => <div className="span ops-form" key={session.startsAt}>
          <Field name={"start-"+i} label={"Bắt đầu buổi "+(i+1)}><input type="datetime-local" id={"start-"+i} name={"start-"+i} defaultValue={localTimeInput(session.startsAt)} required /></Field>
          <Field name={"end-"+i} label={"Kết thúc buổi "+(i+1)}><input type="datetime-local" id={"end-"+i} name={"end-"+i} defaultValue={localTimeInput(session.endsAt)} required /></Field>
        </div>)}
      </fieldset>}
      <Field name="plan-reason" label="Lý do"><textarea id="plan-reason" name="reason" maxLength={1000} required /></Field>
      <div className="span"><button className="primary" disabled={busy || !cls}>Gửi phương án</button></div>
    </form></section>
    <section className="ops-panel" aria-busy={busy}><h2>Phương án đã lập</h2>
      {!rows.length && <p role="status">{busy ? "Đang tải phương án…" : "Chưa có phương án."}</p>}
      {rows.map(row => <article className="n8n06-row" key={row.id} data-change-id={row.id}>
        <div><strong>{kinds[row.kind]} · {classes.find(c => c.id === row.classId)?.name ?? row.classId}</strong>
        <p>{states[row.status] ?? row.status} · {row.impact.holds.length} chỗ · {row.impact.enrollments.length} đăng ký</p>
        <small>{row.deadlineAt && dateTime(row.deadlineAt)}</small><p>{row.payload.reason}</p></div>
        {director && ["REQUESTED","APPROVED"].includes(row.status) && <button onClick={() => setDecision(row)}>Quyết định phương án</button>}
      </article>)}
    </section>
    {decision && <section className="ops-panel"><h2>Quyết định {kinds[decision.kind].toLowerCase()}</h2>
      <form className="ops-form" onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        void run(async () => { await api("class-changes/"+decision.id+"/decision", "POST", { version: decision.version, status: form.get("status"), reason: form.get("reason") }); setDecision(undefined); });
      }}><Field name="decision-status" label="Quyết định"><select id="decision-status" name="status">
        {decision.status === "REQUESTED" && <><option value="APPROVED">Duyệt</option><option value="REJECTED">Từ chối</option></>}
        <option value="REVOKED">Thu hồi</option></select></Field>
        <Field name="decision-reason" label="Lý do quyết định"><textarea id="decision-reason" name="reason" required maxLength={1000} /></Field>
        <div className="ops-actions span"><button disabled={busy} className="primary">Lưu quyết định</button><button type="button" onClick={() => setDecision(undefined)}>Đóng</button></div>
      </form></section>}
  </div>;
}
