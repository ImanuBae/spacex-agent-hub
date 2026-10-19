// apps/admin-portal/src/components/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getMenuByRole } from "@/config/menu";
import type { Role } from "@/types/roles";

const ALL_ROLES: { label: string; value: Role }[] = [
  { label: "Center Director", value: "center_director" },
  { label: "Branch Director", value: "branch_director" },
  { label: "Admissions", value: "admissions" },
  { label: "Accountant", value: "accountant" },
  { label: "Teacher", value: "teacher" },
  { label: "Student (Không truy cập)", value: "student" },
  { label: "AI Agent (Không truy cập)", value: "ai_agent" },
];

export default function Sidebar() {
  const { role, setRole } = useAuth();
  const pathname = usePathname();
  const menuGroups = getMenuByRole(role);

  return (
    <aside className="flex h-screen w-64 flex-col bg-slate-900 text-white shadow-lg">
      {/* Header Sidebar */}
      <div className="border-b border-slate-800 p-4">
        <h1 className="text-xl font-bold text-blue-400">SpaceX Admin</h1>
        <p className="text-xs text-slate-400">Quản lý trung tâm & đào tạo</p>
      </div>

      {/* Mock Role Switcher */}
      <div className="border-b border-slate-800 bg-slate-800/50 p-3">
        <label className="block text-xs text-slate-400 mb-1 font-medium">
          🎭 Giả lập vai trò (Dev Only):
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full rounded bg-slate-700 p-1.5 text-xs text-white border border-slate-600 focus:outline-none"
        >
          {ALL_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* Danh sách Menu Lọc theo Role */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {menuGroups.length === 0 ? (
          <div className="text-center text-sm text-amber-400 mt-4">
            ⚠️ Vai trò này không có quyền truy cập Admin Portal.
          </div>
        ) : (
          menuGroups.map((group, idx) => (
            <div key={idx}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {group.groupTitle}
              </h3>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`block rounded-md px-3 py-2 text-sm transition ${
                          isActive
                            ? "bg-blue-600 text-white font-medium"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        {item.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-800 p-3 bg-amber-950/30 text-[11px] text-amber-300/80">
        📌 <strong>Lưu ý:</strong> Ẩn menu trên UI chỉ để hỗ trợ UX. Backend cần
        kiểm tra IAM bảo mật khi tích hợp API chính thức.
      </div>
    </aside>
  );
}
