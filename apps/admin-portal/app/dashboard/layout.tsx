// apps/admin-portal/app/dashboard/layout.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "./components/Sidebar";
import { isMockEnabled } from "../../lib/mock-session";
import MockUnavailable from "../mock-unavailable";
import {
  getAdminProfile,
  PROFILE_UPDATED_EVENT,
} from "../../lib/services/profile";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [userName, setUserName] = useState("Quản trị viên");

  // 1. Quản lý trạng thái đóng/mở Sidebar trên thiết bị di động (Mobile)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 2. Lấy thông tin profile người dùng và cập nhật khi có sự kiện PROFILE_UPDATED_EVENT
  useEffect(() => {
    const updateUserName = () => setUserName(getAdminProfile().name);
    updateUserName();
    window.addEventListener(PROFILE_UPDATED_EVENT, updateUserName);
    return () =>
      window.removeEventListener(PROFILE_UPDATED_EVENT, updateUserName);
  }, []);

  // 3. Xử lý logic khi người dùng bấm nút Đăng xuất
  const handleLogout = () => {
    localStorage.removeItem("admin_logged_in");
    router.push("/login");
  };

  if (!isMockEnabled()) return <MockUnavailable />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ==========================================
          PHẦN 1: THANH MENU BÊN TRÁI (SIDEBAR)
          ================================---------- */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {/* Khung chứa nội dung chính bên phải */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ==========================================
            PHẦN 2: THANH TIÊU ĐỀ TRÊN CÙNG (HEADER)
            ================================---------- */}
        <header className="flex h-16 items-center justify-between border-b border-slate-800 md:border-gray-200 bg-slate-900 md:bg-white px-4 md:px-6 shadow-sm shrink-0 text-white md:text-gray-900">
          <div className="flex items-center gap-3">
            {/* Nút 3 gạch mở sidebar trên mobile */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 rounded-lg text-gray-300 hover:bg-slate-800 md:text-gray-600 md:hover:bg-gray-100 md:hidden focus:outline-none cursor-pointer"
              aria-label="Toggle Menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
            {/* Tiêu đề hệ thống */}
            <span className="text-lg font-semibold text-white md:text-gray-900">
              Hệ thống Quản trị
            </span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/profile"
              className="text-sm text-gray-300 md:text-gray-600 transition hover:text-blue-400 md:hover:text-blue-600"
            >
              Xin chào,{" "}
              <strong className="text-white md:text-slate-800">
                {userName}
              </strong>
            </Link>

            {/* Nút đăng xuất */}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 cursor-pointer shadow-sm"
            >
              Đăng xuất
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
