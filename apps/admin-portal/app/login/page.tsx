"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../src/context/AuthContext";
import { getMenuByRole } from "../../lib/roles";
import Link from "next/link";
import Brand from "../landing/Brand";
import Planet from "../landing/Planet";
import "../landing/landing.css";
import "../landing/entry.css";

export default function LoginPage() {
  const router = useRouter();
  const { reload } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Email hoặc mật khẩu không đúng, hoặc tài khoản đang bị khóa."
            : (body.error?.message ?? "Đăng nhập thất bại."),
        );
      setPassword("");
      await reload();
      router.replace(getMenuByRole(body.data.role)[0]?.href ?? "/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không kết nối được hệ thống.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="entry hub-theme">
      <div className="ascend entry-planet" aria-hidden="true">
        <Planet />
      </div>
      <header className="entry-header">
        <Brand />
        <Link href="/" className="entry-back">
          <span aria-hidden="true">←</span>Trang chủ
        </Link>
      </header>
      <main className="entry-main">
        <div className="entry-intro">
          <h1>
            Tiếp tục
            <br />
            <em>công việc.</em>
          </h1>
          <p>
            Không gian điều phối tuyển sinh của SpaceX Việt Nam. Đúng vai trò,
            đúng chi nhánh của bạn.
          </p>
        </div>
        <section className="entry-form-panel" aria-labelledby="login-title">
          <h2 id="login-title">Đăng nhập Agent Hub</h2>
          <form onSubmit={submit} className="entry-form" aria-busy={busy}>
            <label htmlFor="login-email">
              Email nhân viên
              <input
                id="login-email"
                name="email"
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <div>
              <label htmlFor="login-password">Mật khẩu</label>
              <div className="entry-password">
                <input
                  id="login-password"
                  name="password"
                  required
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-controls="login-password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Ẩn" : "Hiện"}
                </button>
              </div>
            </div>
            {error && (
              <p role="alert" className="entry-error">
                {error}
              </p>
            )}
            <button disabled={busy} type="submit" className="entry-submit">
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="entry-help">
            Liên hệ quản lý để được cấp hoặc khôi phục tài khoản.
          </p>
        </section>
      </main>
      <footer className="entry-footer">
        SpaceX Việt Nam · Không gian làm việc dành cho nhân viên
      </footer>
    </div>
  );
}
