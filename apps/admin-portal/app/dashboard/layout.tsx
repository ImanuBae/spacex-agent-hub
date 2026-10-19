// apps/admin-portal/app/dashboard/layout.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "./components/Sidebar";
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

  useEffect(() => {
    const updateUserName = () => setUserName(getAdminProfile().name);
    updateUserName();
    window.addEventListener(PROFILE_UPDATED_EVENT, updateUserName);
    return () =>
      window.removeEventListener(PROFILE_UPDATED_EVENT, updateUserName);
  }, []);

  const handleLogout = () => {
    router.push("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sử dụng component Sidebar chuyên biệt để hiển thị menu theo phân quyền */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b bg-white px-6 shadow-sm">
          <span className="text-lg font-semibold">Hệ thống Quản trị</span>

          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/profile"
              className="text-sm text-gray-600 transition hover:text-blue-600"
            >
              Xin chào, <strong className="text-slate-800">{userName}</strong>
            </Link>

            {/* Nút đăng xuất */}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 cursor-pointer"
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
