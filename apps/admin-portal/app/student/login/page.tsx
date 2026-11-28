"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Brand from "../../landing/Brand";
import { inter } from "../../ui/fonts";
import "../../ui/theme.css";
import "../../dashboard/components/operations.css";
import "../student.css";

export default function StudentLogin() {
  const router = useRouter();
  const [email, setEmail] = useState(""), [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent, action: "request" | "verify") {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/student-session/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "request" ? { email } : { code }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Chưa xác minh được đăng nhập.");
      setCode("");
      if (action === "verify") router.replace("/student");
      else setExpiresAt(body.data.expiresAt);
    } catch (e) { setError(e instanceof Error ? e.message : "Lỗi kết nối"); }
    finally { setBusy(false); }
  }
  return <main className={`hub-theme ops student-login ${inter.className}`}>
    <Brand />
    <section className="ops-panel">
      <h1>Đăng nhập học viên</h1>
      <p className="muted">Xem lịch, quyền lợi và hóa đơn của bạn.</p>
      {error && <p role="alert" className="ops-error">{error}</p>}
      {!expiresAt ? <form onSubmit={e => void submit(e, "request")}>
        <label htmlFor="student-email">Email đã xác minh</label>
        <input id="student-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} />
        <button type="submit" className="primary" disabled={busy}>{busy ? "Đang yêu cầu mã…" : "Nhận mã đăng nhập"}</button>
      </form> : <form onSubmit={e => void submit(e, "verify")}>
        <p role="status">Kiểm tra hộp thư của bạn. Mã hết hạn lúc {new Date(expiresAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.</p>
        <label htmlFor="student-code">Mã xác minh</label>
        <input id="student-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required disabled={busy} />
        <div className="ops-actions"><button type="submit" className="primary" disabled={busy}>{busy ? "Đang xác minh…" : "Xác minh và đăng nhập"}</button>
          <button type="button" disabled={busy} onClick={() => { setExpiresAt(""); setCode(""); setError(""); }}>Yêu cầu mã mới</button></div>
      </form>}
    </section>
    <p><Link href="/login">Đăng nhập nhân viên</Link></p>
  </main>;
}
