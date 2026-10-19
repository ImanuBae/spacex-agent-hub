// apps/admin-portal/app/login/page.tsx
"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [isLoginMode, setIsLoginMode] = useState(true); // true: Đăng nhập, false: Đăng ký
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!email || !password || (!isLoginMode && !fullName)) {
      setError("Vui lòng điền đầy đủ tất cả các trường thông tin.");
      return;
    }

    if (isLoginMode) {
      // Giả lập logic đăng nhập thành công
      if (email.includes("@") && password.length >= 6) {
        localStorage.setItem("admin_logged_in", "true");
        localStorage.setItem("admin_user_name", email.trim());
        localStorage.setItem("admin_user_email", email.trim());
        router.push("/dashboard/overview");
      } else {
        setError("Email không hợp lệ hoặc mật khẩu phải có ít nhất 6 ký tự.");
      }
    } else {
      // Giả lập logic đăng ký tài khoản thành công
      setSuccessMsg(
        "Đăng ký tài khoản thành công! Đang chuyển sang trang đăng nhập...",
      );
      setTimeout(() => {
        setIsLoginMode(true);
        setSuccessMsg("");
      }, 1500);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        {/* Tiêu đề thương hiệu */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            SpaceX Agent Hub
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {isLoginMode
              ? "Đăng nhập vào hệ thống quản trị"
              : "Đăng ký tài khoản quản trị viên mới"}
          </p>
        </div>

        {/* Thông báo lỗi hoặc thành công */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-600 border border-green-200">
            {successMsg}
          </div>
        )}

        {/* Form xác thực */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLoginMode && (
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Họ và tên
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
              Địa chỉ Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@spacex.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
              Mật khẩu
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 shadow-sm cursor-pointer"
          >
            {isLoginMode ? "Đăng nhập" : "Đăng ký tài khoản"}
          </button>
        </form>

        {/* Chuyển đổi giữa Đăng nhập và Đăng ký */}
        <div className="mt-6 text-center text-sm text-slate-600">
          {isLoginMode ? (
            <p>
              Chưa có tài khoản hệ thống?{" "}
              <button
                onClick={() => {
                  setIsLoginMode(false);
                  setError("");
                }}
                className="font-semibold text-blue-600 hover:underline"
              >
                Đăng ký ngay
              </button>
            </p>
          ) : (
            <p>
              Đã có tài khoản quản trị?{" "}
              <button
                onClick={() => {
                  setIsLoginMode(true);
                  setError("");
                }}
                className="font-semibold text-blue-600 hover:underline"
              >
                Đăng nhập
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
