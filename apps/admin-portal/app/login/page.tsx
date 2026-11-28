"use client";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../src/context/AuthContext";
import { getMenuByRole, type UserRole } from "../../lib/roles";
import Link from "next/link";
import LoginEntry from "../landing/LoginEntry";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const openDashboard = useCallback((role: UserRole) => {
    const menu = getMenuByRole(role);
    const review = new URLSearchParams(window.location.search).get("review");
    if (review && /^[\da-f-]{36}$/i.test(review) && menu.some(item => item.href === "/dashboard/reconciliation")) {
      window.location.replace(`/dashboard/reconciliation?review=${review}`);
    } else {
      router.replace(menu[0]?.href ?? "/dashboard");
    }
  }, [router]);
  useEffect(() => {
    if (user && getMenuByRole(user.role).length > 0) openDashboard(user.role);
  }, [user, openDashboard]);

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
      openDashboard(body.data.role);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không kết nối được hệ thống.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <LoginEntry
      heading="Tiếp tục"
      accent="công việc."
      description="Không gian điều phối tuyển sinh của SpaceX Việt Nam. Đúng vai trò, đúng chi nhánh của bạn."
      title="Đăng nhập Agent Hub"
      footer="SpaceX Việt Nam · Không gian làm việc dành cho nhân viên"
    >
      <Suspense><ReviewSessionNotice /></Suspense>
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
        <button disabled={busy || loading} type="submit" className="entry-submit">
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      <p className="entry-help">
        Liên hệ quản lý để được cấp hoặc khôi phục tài khoản.
      </p>
      <p className="entry-help"><Link href="/student/login">Đăng nhập học viên</Link></p>
    </LoginEntry>
  );
}

function ReviewSessionNotice() {
  return useSearchParams().has("review")
    ? <p className="entry-help">Đăng nhập lại bằng tài khoản vừa dùng để tiếp tục bản nháp đối soát trong tab này.</p>
    : null;
}
