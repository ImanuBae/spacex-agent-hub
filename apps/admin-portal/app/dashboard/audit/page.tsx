// apps/admin-portal/app/dashboard/audit/page.tsx
"use client";

import { useState, useEffect } from "react";
import { auditService, AuditLog } from "../../../lib/services/audit";

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const data = await auditService.getAllLogs();
      setLogs(data);
      setErrorMessage("");
    } catch (error) {
      console.error("Lỗi khi tải nhật ký hệ thống:", error);
      setErrorMessage(
        error instanceof Error
          ? `Không thể tải nhật ký hệ thống: ${error.message}`
          : "Không thể tải nhật ký hệ thống.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLogs();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleClearLogs = async () => {
    if (isClearing) return;

    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử nhật ký không?")) {
      try {
        setErrorMessage("");
        setIsClearing(true);
        await auditService.clearLogs();
        await loadLogs();
      } catch (error) {
        console.error("Lỗi khi xóa nhật ký hệ thống:", error);
        setErrorMessage(
          error instanceof Error
            ? `Không thể xóa nhật ký hệ thống: ${error.message}`
            : "Không thể xóa nhật ký hệ thống.",
        );
      } finally {
        setIsClearing(false);
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang & Nút hành động */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Nhật ký Hệ thống
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Theo dõi lịch sử hoạt động, thao tác thay đổi dữ liệu của quản trị
            viên trên hệ thống.
          </p>
        </div>
        {errorMessage && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}
        {logs.length > 0 && (
          <button
            type="button"
            onClick={handleClearLogs}
            disabled={isClearing}
            className="inline-flex items-center justify-center rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-100 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isClearing ? "Đang xóa..." : "Xóa lịch sử"}
          </button>
        )}
      </section>

      {/* Bảng hiển thị danh sách Audit Log */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">
            Danh sách sự kiện ({logs.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-4">ID</th>
                <th className="px-5 py-4">Hành động</th>
                <th className="px-5 py-4">Người thực hiện</th>
                <th className="px-5 py-4">Thời gian</th>
                <th className="px-5 py-4">Chi tiết thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Đang tải nhật ký hệ thống...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Chưa có ghi nhận nhật ký hoạt động nào.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-5 py-4 font-medium text-slate-500">
                      #{log.id}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-700">
                      {log.performedBy}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {log.timestamp}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
