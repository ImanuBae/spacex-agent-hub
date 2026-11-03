"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { TeacherTimeView } from "@spacex/contracts";
import { useAuth } from "../../../src/context/AuthContext";
import { api, dateTime, utcTime, type Teacher } from "../../../lib/services/classes";
import { ErrorMessage, Field, OperationDialog } from "../components/OperationUI";
import "../components/operations.css";
import "./availability.css";

const statusLabels = { PENDING: "Chờ duyệt", APPROVED: "Có hiệu lực", REJECTED: "Từ chối", CANCELLED: "Đã rút" };

export default function AvailabilityPage() {
  const { user } = useAuth();
  const isTeacher = user?.role === "teacher";
  const [rows, setRows] = useState<TeacherTimeView[]>([]), [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState(""), [creating, setCreating] = useState(false);
  const [decision, setDecision] = useState<{ row: TeacherTimeView; status: "APPROVED" | "REJECTED" | "CANCELLED" } | null>(null);
  const [saving, setSaving] = useState(false), [formError, setFormError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");
  const intent = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [times, people] = await Promise.all([api<TeacherTimeView[]>("teacher-time"), api<Teacher[]>("teachers")]);
      setRows(times.data); setTeachers(people.data);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // Synchronize declarations with the authenticated service.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setSaving(true); setFormError(null);
    try {
      const payload = { teacherId: f.get("teacherId"), kind: f.get("kind"), startsAt: utcTime(String(f.get("startsAt"))), endsAt: utcTime(String(f.get("endsAt"))), reason: f.get("reason") };
      const serialized = JSON.stringify(payload);
      if (intent.current?.payload !== serialized) intent.current = { payload: serialized, key: crypto.randomUUID() };
      await api("teacher-time", "POST", payload, intent.current.key);
      intent.current = null; setCreating(false); setNotice("Đã lưu khai báo. Đề nghị nghỉ cần người quản lý duyệt."); await load();
    } catch (e) { setFormError(e); }
    finally { setSaving(false); }
  }
  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!decision) return;
    const reason = String(new FormData(e.currentTarget).get("reason"));
    setSaving(true); setFormError(null);
    try {
      await api(`teacher-time/${decision.row.id}/decision`, "POST", { version: decision.row.version, status: decision.status, reason });
      setDecision(null); setNotice("Đã cập nhật khai báo thời gian."); await load();
    } catch (e) { setFormError(e); }
    finally { setSaving(false); }
  }
  const visible = rows.filter(r => !filter || r.teacherId === filter);
  const choose = (row: TeacherTimeView, status: "APPROVED" | "REJECTED" | "CANCELLED") => { setFormError(null); setDecision({ row, status }); };
  return <div className="ops teacher-time-screen">
    <div className="ops-heading">
      <div><h1>Giờ rảnh và đề nghị nghỉ</h1><p className="muted">{isTeacher ? "Khai giờ có thể dạy và theo dõi đề nghị nghỉ của bạn." : "Kiểm tra giờ có thể dạy và duyệt nghỉ sau khi xử lý lịch bị ảnh hưởng."}</p></div>
      <div className="ops-actions"><button disabled={loading} onClick={() => void load()}>Làm mới</button>{isTeacher && <button className="primary" disabled={loading || !!error || !teachers.length} onClick={() => { setFormError(null); intent.current = null; setCreating(true); }}>Thêm khai báo</button>}</div>
    </div>
    {notice && <p role="status">{notice}</p>}
    <ErrorMessage error={error} retry={() => void load()} />
    <section className="ops-panel">
      <div className="ops-heading"><h2>Khai báo thời gian</h2><p className="muted">Giờ Việt Nam · tối đa 500 khai báo gần nhất</p></div>
      {!isTeacher && <Field name="teacher-filter" label="Giảng viên"><select id="teacher-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tất cả trong phạm vi</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {loading ? <p role="status">Đang tải khai báo…</p> : error ? <p>Chưa xác minh được danh sách khai báo.</p> : !visible.length ? <p>Chưa có khai báo phù hợp. Giảng viên có thể thêm giờ rảnh hoặc gửi đề nghị nghỉ.</p> : <div className="ops-table-wrap"><table>
        <thead><tr><th>Giảng viên / Loại</th><th>Khoảng thời gian</th><th>Lý do</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id}>
          <td><strong>{teachers.find(t => t.id === row.teacherId)?.name ?? "—"}</strong><p className="muted">{row.kind === "AVAILABLE" ? "Giờ rảnh" : "Đề nghị nghỉ"}</p></td>
          <td data-label="Khoảng thời gian">{dateTime(row.startsAt)}<p className="muted">đến {dateTime(row.endsAt)}</p></td>
          <td data-label="Lý do">{row.reason || "—"}{row.decisionReason && <p className="muted">Xử lý: {row.decisionReason}</p>}</td>
          <td data-label="Trạng thái"><span className="status">{statusLabels[row.status]}</span></td>
          <td><div className="ops-actions">{!isTeacher && row.kind === "LEAVE" && row.status === "PENDING" && <><button onClick={() => choose(row, "APPROVED")}>Duyệt nghỉ</button><button onClick={() => choose(row, "REJECTED")}>Từ chối</button></>}{["APPROVED", "PENDING"].includes(row.status) && <button onClick={() => choose(row, "CANCELLED")}>Rút khai báo</button>}</div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <p className="muted">Sau khi khai giờ rảnh lần đầu, mỗi buổi học phải nằm trọn trong một khoảng giờ rảnh còn hiệu lực. Muốn rút giờ rảnh hoặc duyệt nghỉ trùng lịch, cần xếp lại các buổi học trước.</p>
    {creating && <OperationDialog title="Thêm khai báo thời gian" onClose={() => { if (!saving) setCreating(false); }}>
      <form className="ops-form" onSubmit={e => void create(e)}>
        <Field name="teacherId" label="Hồ sơ giảng viên"><select id="teacherId" name="teacherId" required>{teachers.filter(t => t.accountId === user?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field name="kind" label="Loại khai báo"><select id="kind" name="kind"><option value="AVAILABLE">Giờ rảnh</option><option value="LEAVE">Đề nghị nghỉ</option></select></Field>
        <Field name="startsAt" label="Bắt đầu (giờ Việt Nam)" error={formError}><input id="startsAt" name="startsAt" type="datetime-local" required /></Field>
        <Field name="endsAt" label="Kết thúc (giờ Việt Nam)" error={formError}><input id="endsAt" name="endsAt" type="datetime-local" required /></Field>
        <div className="span"><Field name="reason" label="Lý do / ghi chú (bắt buộc khi nghỉ)" error={formError}><textarea id="reason" name="reason" maxLength={1000} rows={3} /></Field></div>
        <div className="span"><ErrorMessage error={formError} /><div className="ops-actions"><button type="button" disabled={saving} onClick={() => setCreating(false)}>Đóng</button><button className="primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu khai báo"}</button></div></div>
      </form>
    </OperationDialog>}
    {decision && <OperationDialog title={decision.status === "APPROVED" ? "Duyệt đề nghị nghỉ" : decision.status === "REJECTED" ? "Từ chối đề nghị nghỉ" : "Rút khai báo thời gian"} onClose={() => { if (!saving) setDecision(null); }}>
      <p>{teachers.find(t => t.id === decision.row.teacherId)?.name} · {dateTime(decision.row.startsAt)} đến {dateTime(decision.row.endsAt)}</p>
      <form onSubmit={e => void decide(e)}><Field name="reason" label="Lý do xử lý"><textarea id="reason" name="reason" required maxLength={1000} rows={3} /></Field><ErrorMessage error={formError} /><div className="ops-actions"><button type="button" disabled={saving} onClick={() => setDecision(null)}>Đóng</button><button className="primary" disabled={saving}>{saving ? "Đang xử lý…" : "Xác nhận"}</button></div></form>
    </OperationDialog>}
  </div>;
}
