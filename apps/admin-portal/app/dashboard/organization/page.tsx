"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, request } from "../../../lib/request";
import { roleLabels, type UserRole } from "../../../lib/roles";

interface Branch { id: string; code: string; name: string; kind: string; active: boolean; }
interface Department { id: string; branchId: string; name: string; description: string; active: boolean; }
interface Account { id: string; email: string; name: string; role: UserRole; branchIds: string[]; active: boolean; }
interface Employee { id: string; accountId: string; branchId: string; departmentId: string | null; name: string; title: string; teacherProfile: string | null; active: boolean; }
interface Sync { id: string; employeeId: string; role: string; branchIds: string[]; status: string; }
const control = "rounded border border-slate-300 bg-white p-2 text-sm";
const button = "rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50";
const fetchOrganization = () => Promise.all([
  request<Branch[]>("/api/v1/branches"), request<Department[]>("/api/v1/departments"), request<Account[]>("/api/v1/accounts"), request<Employee[]>("/api/v1/employees"), request<Sync[]>("/api/v1/access-sync"),
]);

export default function OrganizationPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [syncs, setSyncs] = useState<Sync[]>([]);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState(""); const [accountId, setAccountId] = useState("");
  const [operation, setOperation] = useState<{ key: string; employeeId: string; role: string; branchIds: string[] } | null>(null);
  const load = useCallback(async () => {
    const [b, d, a, e, s] = await fetchOrganization();
    setBranches(b); setDepartments(d); setAccounts(a); setEmployees(e); setSyncs(s);
  }, []);
  useEffect(() => { void fetchOrganization().then(([b, d, a, e, s]) => { setBranches(b); setDepartments(d); setAccounts(a); setEmployees(e); setSyncs(s); }).catch(e => setMessage(e.message)); }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await action(); await load(); setMessage("Đã lưu."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Thao tác thất bại."); }
    finally { setBusy(false); }
  }
  const write = (path: string, data: unknown, method = "POST") => request(path, { method, body: JSON.stringify(data) });
  const values = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return new FormData(e.currentTarget); };
  async function applyAccess(op: NonNullable<typeof operation>) {
    setBusy(true); setMessage("");
    try {
      const result = await request<{ status: string }>(`/api/v1/employees/${op.employeeId}/access`, { method: "PUT", headers: { "idempotency-key": op.key }, body: JSON.stringify({ role: op.role, branchIds: op.branchIds }) });
      setMessage(result.status === "applied" ? "Đã gán quyền; phiên cũ đã bị thu hồi." : "Đang chờ IAM. Giữ nguyên yêu cầu và bấm thử lại.");
      if (result.status === "applied") setOperation(null);
      await load();
    } catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) setOperation(null); setMessage(e instanceof Error ? e.message : "Lỗi gán quyền"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Tổ chức và tài khoản nhân viên</h1>
    {message && <p role="status" className="rounded border bg-white p-3">{message}</p>}
    <section className="space-y-3 rounded bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Trung tâm và chi nhánh</h2>
      <ul className="space-y-2">{branches.map(b => <li key={b.id} className="flex flex-wrap items-center gap-3"><span>{b.code} — {b.name} ({b.active ? "Hoạt động" : "Ngừng hoạt động"})</span><button disabled={busy} className={control} onClick={() => void run(() => write(`/api/v1/branches/${b.id}`, { code: b.code, name: b.name, kind: b.kind, active: !b.active }, "PUT"))}>{b.active ? "Ngừng hoạt động" : "Kích hoạt"}</button></li>)}</ul>
      <form className="flex flex-wrap gap-2" onSubmit={e => { const f = values(e); void run(() => write("/api/v1/branches", { code: f.get("code"), name: f.get("name"), kind: "branch" })); }}>
        <input required name="code" aria-label="Mã chi nhánh" placeholder="Mã chi nhánh" className={control} /><input required name="name" aria-label="Tên chi nhánh" placeholder="Tên chi nhánh" className={control} /><button disabled={busy} className={button}>Thêm chi nhánh</button>
      </form>
    </section>
    <section className="space-y-3 rounded bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Phòng ban</h2>
      <ul>{departments.map(d => <li key={d.id}>{d.name} — {branches.find(b => b.id === d.branchId)?.name}</li>)}</ul>
      <form className="flex flex-wrap gap-2" onSubmit={e => { const f = values(e); void run(() => write("/api/v1/departments", { branchId: f.get("branchId"), name: f.get("name"), description: f.get("description") })); }}>
        <select required name="branchId" aria-label="Chi nhánh phòng ban" className={control}><option value="">Chọn chi nhánh</option>{branches.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input required name="name" aria-label="Tên phòng ban" placeholder="Tên phòng ban" className={control} /><input name="description" aria-label="Mô tả phòng ban" placeholder="Mô tả" className={control} /><button disabled={busy} className={button}>Thêm phòng ban</button>
      </form>
    </section>
    <section className="space-y-3 rounded bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Cấp tài khoản</h2>
      <p className="text-sm text-slate-600">Tài khoản mới chưa có phạm vi chi nhánh. Tạo hồ sơ nhân sự rồi gán quyền bên dưới. Ngừng hồ sơ nhân sự không thay thế khóa tài khoản.</p>
      <form className="flex flex-wrap gap-2" onSubmit={e => { const f = values(e); const form = e.currentTarget; void run(async () => { await write("/api/v1/accounts", { name: f.get("name"), email: f.get("email"), password: f.get("password") }); form.reset(); }); }}>
        <input required name="name" aria-label="Tên tài khoản" placeholder="Họ tên" className={control} /><input required type="email" name="email" aria-label="Email tài khoản" placeholder="Email" className={control} /><input required minLength={12} maxLength={256} type="password" name="password" autoComplete="new-password" aria-label="Mật khẩu cấp mới" placeholder="Mật khẩu từ 12 ký tự" className={control} /><button disabled={busy} className={button}>Cấp tài khoản</button>
      </form>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{accounts.map(a => <tr key={a.id} className="border-t"><td className="p-2">{a.email}</td><td>{roleLabels[a.role]}</td><td>{a.active ? "Hoạt động" : "Đã khóa"}</td><td><button disabled={busy} className={control} onClick={() => void run(() => write(`/api/v1/accounts/${a.id}/status`, { active: !a.active }, "PUT"))}>{a.active ? "Khóa" : "Mở khóa"}</button></td></tr>)}</tbody></table></div>
    </section>
    <section className="space-y-3 rounded bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Hồ sơ nhân sự / giảng viên</h2>
      <form className="flex flex-wrap gap-2" onSubmit={e => { const f = values(e); void run(() => write("/api/v1/employees", { accountId, branchId, departmentId: f.get("departmentId") || null, name: accounts.find(a => a.id === accountId)?.name, title: f.get("title"), teacherProfile: f.get("teacherProfile") || null })); }}>
        <select required value={accountId} onChange={e => setAccountId(e.target.value)} aria-label="Tài khoản nhân sự" className={control}><option value="">Chọn tài khoản</option>{accounts.filter(a => a.active && !employees.some(e => e.accountId === a.id)).map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select>
        <select required value={branchId} onChange={e => setBranchId(e.target.value)} aria-label="Chi nhánh nhân sự" className={control}><option value="">Chọn chi nhánh</option>{branches.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select key={branchId} name="departmentId" aria-label="Phòng ban nhân sự" className={control}><option value="">Không có phòng ban</option>{departments.filter(d => d.branchId === branchId && d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <input name="title" aria-label="Chức danh" placeholder="Chức danh" className={control} /><input name="teacherProfile" aria-label="Chuyên môn giảng viên" placeholder="Chuyên môn giảng viên (nếu có)" className={control} /><button disabled={busy} className={button}>Thêm nhân sự</button>
      </form>
      <ul>{employees.map(e => <li key={e.id} className="flex flex-wrap items-center gap-2 border-t py-2"><span>{e.name} — {e.title} — {e.teacherProfile ?? ""} ({e.active ? "Hoạt động" : "Ngừng"})</span><button disabled={busy} className={control} onClick={() => void run(() => write(`/api/v1/employees/${e.id}`, { accountId: e.accountId, branchId: e.branchId, departmentId: e.departmentId, name: e.name, title: e.title, teacherProfile: e.teacherProfile, active: !e.active }, "PUT"))}>{e.active ? "Ngừng hồ sơ" : "Kích hoạt hồ sơ"}</button></li>)}</ul>
    </section>
    <section className="space-y-3 rounded bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Gán vai trò và phạm vi chi nhánh</h2>
      <form className="flex flex-wrap gap-2" onSubmit={e => { const f = values(e); const op = { key: crypto.randomUUID(), employeeId: String(f.get("employeeId")), role: String(f.get("role")), branchIds: f.getAll("branchIds").map(String) }; setOperation(op); void applyAccess(op); }}>
        <select required name="employeeId" aria-label="Nhân sự gán quyền" className={control}><option value="">Chọn nhân sự</option>{employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <select name="role" aria-label="Vai trò cấp" className={control}>{Object.entries(roleLabels).filter(([r]) => r !== "student" && r !== "ai_agent").map(([r, label]) => <option key={r} value={r}>{label}</option>)}</select>
        <fieldset className="flex flex-wrap gap-2"><legend className="text-sm">Phạm vi (bao gồm chi nhánh chính của nhân sự)</legend>{branches.filter(b => b.active).map(b => <label key={b.id}><input type="checkbox" name="branchIds" value={b.id} /> {b.name}</label>)}</fieldset>
        <button disabled={busy || operation !== null} className={button}>Gán quyền</button>
      </form>
      {operation && <button disabled={busy} className={button} onClick={() => void applyAccess(operation)}>Thử lại yêu cầu {operation.key}</button>}
      <p className="text-sm">Yêu cầu chờ đồng bộ: {syncs.filter(s => s.status === "pending").length}. Trạng thái applied nghĩa là IAM đã cấp quyền và thu hồi phiên cũ.</p>
      {syncs.filter(s => s.status === "pending").map(s => <button key={s.id} disabled={busy} className={control} onClick={() => { const op = { key: s.id, employeeId: s.employeeId, role: s.role, branchIds: s.branchIds }; setOperation(op); void applyAccess(op); }}>Thử lại yêu cầu chờ {s.id}</button>)}
    </section>
  </div>;
}
