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

export default function Sidebar() {
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
    <aside className="w-64 bg-slate-900 text-white flex flex-col h-full border-r border-slate-800">
      {/* Tiêu đề ứng dụng */}
      <div className="p-4 text-xl font-bold border-b border-slate-800 flex items-center justify-between">
        <span>SpaceX Agent Hub</span>
      </div>

      {/* Widget giả lập Role cho môi trường Dev (FE-02) */}
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

      {/* Danh sách menu hiển thị linh hoạt theo vai trò */}
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
              className="flex items-center px-3 py-2.5 rounded hover:bg-slate-800 text-slate-200 transition"
            >
              <span>{item.label}</span>
            </Link>
          ))
        )}
      </nav>

      {/* Chú thích chế độ mock */}
      <div className="p-3 text-[10px] text-slate-500 border-t border-slate-800 text-center">
        Chế độ mock dùng để kiểm tra phân quyền giao diện.
      </div>
    </aside>
  );
}
