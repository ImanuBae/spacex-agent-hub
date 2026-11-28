"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LoginEntry from "../../landing/LoginEntry";
import { inter } from "../../ui/fonts";

export default function StudentLogin() {
  const router = useRouter();
  const [email, setEmail] = useState(""), [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [submitLabel, busyLabel] = expiresAt
    ? ["Xác minh và đăng nhập", "Đang xác minh…"]
    : ["Nhận mã đăng nhập", "Đang yêu cầu mã…"];
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
  return (
    <div className={inter.className}>
      <LoginEntry
        heading="Tiếp tục"
        accent="học tập."
        description="Xem khóa học, lịch lớp và học liệu của bạn. Đăng nhập bằng mã xác minh gửi qua email."
        title="Đăng nhập học viên"
        footer="SpaceX Việt Nam · Cổng học viên"
      >
        <form className="entry-form" aria-busy={busy} onSubmit={e => void submit(e, expiresAt ? "verify" : "request")}>
          {expiresAt ? <>
            <p role="status">Kiểm tra hộp thư của bạn. Mã hết hạn lúc {new Date(expiresAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.</p>
            <label htmlFor="student-code">
              Mã xác minh
              <input id="student-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                value={code} onChange={e => setCode(e.target.value)} required disabled={busy} />
            </label>
          </> : <label htmlFor="student-email">
            Email đã xác minh
            <input id="student-email" name="email" type="email" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} />
          </label>}
          {error && <p role="alert" className="entry-error">{error}</p>}
          <button type="submit" className="entry-submit" disabled={busy}>
            {busy ? busyLabel : submitLabel}
            <span aria-hidden="true">↗</span>
          </button>
          {expiresAt && <button className="entry-back justify-self-start" type="button" disabled={busy}
            onClick={() => { setExpiresAt(""); setCode(""); setError(""); }}>Yêu cầu mã mới</button>}
        </form>
        <p className="entry-help"><Link href="/student/register">Đăng ký học</Link> · <Link href="/student/forgot-password">Trợ giúp đăng nhập</Link></p>
        <p className="entry-help"><Link href="/login">Đăng nhập nhân viên</Link></p>
      </LoginEntry>
    </div>
  );
}
