// apps/admin-portal/app/(dashboard)/components/Sidebar.tsx
"use client";

import { useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
import {
  getMenuByRole,
  roleLabels,
  UserRole,
  MenuItem,
} from "../../../lib/roles";
import {
  getMockRole,
  setMockRole,
  subscribeMockRole,
} from "../../../lib/mock-session";
import Link from "next/link";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const role = useSyncExternalStore(
    subscribeMockRole,
    getMockRole,
    (): UserRole => "center_director",
  );
  const menuItems: MenuItem[] = getMenuByRole(role);

  const handleRoleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value as UserRole;
    setMockRole(newRole);
  };

  return (
    <>
      {/* 1. Lớp nền đen mờ trên Mobile khi mở Sidebar */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* 2. Khung Sidebar chính */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white flex flex-col h-full border-r border-slate-800 transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Tiêu đề ứng dụng & Nút đóng trên Mobile */}
        <div className="p-4 text-xl font-bold border-b border-slate-800 flex items-center justify-between">
          <span>SpaceX Agent Hub</span>
          {/* Nút X đóng menu chỉ hiện ở Mobile */}
          <button
            onClick={onClose}
            className="md:hidden text-slate-400 hover:text-white p-1"
          >
            ✕
          </button>
        </div>

        {/* Widget chọn Role */}
        <div className="p-3 bg-slate-800 m-3 rounded-md text-xs">
          <label className="block text-slate-400 mb-1 font-semibold">
            Chọn role:
          </label>
          <select
            value={role}
            onChange={handleRoleChange}
            className="w-full bg-slate-900 text-white border border-slate-700 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            {(Object.entries(roleLabels) as [UserRole, string][]).map(
              ([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>

        {/* Danh sách Menu */}
        <nav className="flex-1 p-3 space-y-1 text-sm overflow-y-auto">
          {menuItems.length === 0 ? (
            <div className="text-gray-400 text-center py-4 text-xs italic px-2">
              Vai trò này không có quyền truy cập Admin Portal.
            </div>
          ) : (
            menuItems.map((item: MenuItem, index: number) => (
              <Link
                key={index}
                href={item.href}
                onClick={onClose} // Tự đóng Sidebar sau khi click chọn trang trên Mobile
                className="flex items-center px-3 py-2.5 rounded hover:bg-slate-800 text-slate-200 transition"
              >
                <span>{item.label}</span>
              </Link>
            ))
          )}
        </nav>

        {/* Footer Sidebar */}
        <div className="p-3 text-[10px] text-slate-500 border-t border-slate-800 text-center">
          Chế độ mock dùng để kiểm tra phân quyền giao diện.
        </div>
      </aside>
    </>
  );
}
