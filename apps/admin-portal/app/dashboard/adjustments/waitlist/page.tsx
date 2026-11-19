"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "../../../../src/context/AuthContext";
import { api, allPages, dateTime, type ClassView } from "../../../../lib/services/classes";
import { states, useOperations, type Operation } from "../../../../lib/services/adjustments";
import { ErrorMessage, Field } from "../../components/OperationUI";

type Invitation = Operation & { enrollmentId: string; classId: string; expiresAt?: string };
export default function WaitlistPage() {
  const { user } = useAuth(), { rows, busy, error, run } = useOperations<Invitation>("waitlist");
  const director = user?.role === "center_director" || user?.role === "branch_director";
  const [classes, setClasses] = useState<ClassView[]>([]), [classError, setClassError] = useState<unknown>(null);
  useEffect(()=>{allPages<ClassView>("classes?status=OPEN").then(setClasses).catch(setClassError);},[]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), cls=classes.find(c=>c.id===form.get("classId"));
    if (cls) void run(()=>api("waitlist","POST",{enrollmentId:form.get("enrollmentId"),classId:cls.id,packageId:cls.packageId,consent:form.get("consent")==="on"}));
  }
  return <div className="ops">
    <header className="ops-heading"><div><h1>Danh sách chờ</h1><p className="muted">Gửi lời mời theo thứ tự đăng ký khi lớp còn chỗ.</p></div><Link className="ops-link" href="/dashboard/adjustments">Điều chỉnh quyền lợi</Link></header>
    <ErrorMessage error={error ?? classError} />
    <section className="ops-panel"><h2>Đưa học viên vào danh sách</h2>
      <form className="ops-form" onSubmit={submit}>
        <Field name="wait-enrollment" label="Mã đăng ký hiện hành"><input id="wait-enrollment" name="enrollmentId" required /></Field>
        <Field name="wait-class" label="Lớp chờ"><select id="wait-class" name="classId" required><option value="">Chọn lớp</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <div className="span"><label><input type="checkbox" name="consent" required style={{width:"auto",minHeight:0}} /> Đã ghi nhận đồng ý vào danh sách chờ</label></div>
        <div className="span"><button className="primary" disabled={busy}>Thêm vào danh sách</button></div>
      </form>
    </section>
    <section className="ops-panel" aria-busy={busy}><h2>Lời mời theo lớp</h2><button disabled={busy} onClick={()=>void run()}>Làm mới</button>
      {!rows.length && <p>{busy ? "Đang tải danh sách…" : "Chưa có học viên chờ lớp."}</p>}
      {rows.map(row=><article className="n8n06-row" key={row.id}><div>
        <strong>{classes.find(c=>c.id===row.classId)?.name ?? row.classId}</strong><p>{states[row.status] ?? row.status}</p><small>{row.enrollmentId} {row.expiresAt && "· "+dateTime(row.expiresAt)}</small>
      </div>{director && <div className="ops-actions">
        {["QUEUED","WAITING"].includes(row.status) && <button disabled={busy} onClick={()=>void run(()=>api("waitlist/"+row.id+"/invite","POST",{version:row.version}))}>Gửi lời mời</button>}
        {["QUEUED","WAITING","INVITED"].includes(row.status) && <button disabled={busy} onClick={()=>void run(()=>api("waitlist/"+row.id+"/revoke","POST",{version:row.version}))}>Thu hồi</button>}
      </div>}</article>)}
    </section>
  </div>;
}
