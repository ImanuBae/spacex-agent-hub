// apps/admin-portal/app/dashboard/leads/page.tsx
"use client";

import { useState, useEffect } from "react";
import { leadService, Lead } from "../../../lib/services/leads";

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshLeads = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await leadService.getAllLeads();
      setLeads(data);
    } catch (error) {
      console.error("Lỗi tải danh sách lead:", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Không thể tải danh sách lead.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    leadService
      .getAllLeads()
      .then((data) => {
        if (isMounted) {
          setLeads(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        console.error("Lỗi tải danh sách lead:", error);
        if (isMounted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Không thể tải danh sách lead.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleStatusChange = async (id: number, newStatus: Lead["status"]) => {
    setActionError(null);
    try {
      const updatedLead = await leadService.updateLeadStatus(id, newStatus);
      setLeads((current) =>
        current.map((lead) => (lead.id === id ? updatedLead : lead)),
      );
    } catch (error) {
      console.error(`Lỗi cập nhật trạng thái lead #${id}:`, error);
      setActionError(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật trạng thái lead.",
      );
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Bạn có chắc muốn xóa học viên tiềm năng này?")) {
      return;
    }

    setActionError(null);
    try {
      await leadService.deleteLead(id);
      setLeads((current) => current.filter((lead) => lead.id !== id));
    } catch (error) {
      console.error(`Lỗi xóa lead #${id}:`, error);
      setActionError(
        error instanceof Error
          ? error.message
          : "Không thể xóa lead. Vui lòng thử lại.",
      );
    }
  };

  const filteredLeads = leads.filter(
    (item) =>
      item.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.courseName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getStatusStyle = (status: Lead["status"]) => {
    switch (status) {
      case "Mới":
        return "bg-blue-100 text-blue-700";
      case "Đang tư vấn":
        return "bg-amber-100 text-amber-700";
      case "Đã đăng ký":
        return "bg-green-100 text-green-700";
      case "Đã hủy":
        return "bg-red-100 text-red-700";
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Quản lý Lead & Đăng ký
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Theo dõi thông tin học viên tiềm năng và trạng thái đăng ký khóa
            học.
          </p>
        </div>
      </section>

      {/* Bảng danh sách lead */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            Danh sách học viên tiềm năng ({leads.length})
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              placeholder="Tìm kiếm theo tên, email, khóa học..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-80"
            />
            <button
              type="button"
              onClick={refreshLeads}
              disabled={isLoading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
            >
              Làm mới
            </button>
          </div>
        </div>

        {actionError && (
          <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            {actionError}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-4">ID</th>
                <th className="px-5 py-4">Học viên</th>
                <th className="px-5 py-4">Số điện thoại</th>
                <th className="px-5 py-4">Khóa học quan tâm</th>
                <th className="px-5 py-4">Ngày đăng ký</th>
                <th className="px-5 py-4">Trạng thái</th>
                <th className="px-5 py-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Đang tải danh sách lead...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td
                    colSpan={7}
                    role="alert"
                    className="px-5 py-16 text-center text-red-600"
                  >
                    Không thể tải danh sách lead: {loadError}
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Chưa có dữ liệu học viên tiềm năng.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-5 py-4 font-medium text-slate-500">
                      #{lead.id}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {lead.fullName}
                      <div className="text-xs font-normal text-slate-400">
                        {lead.email}
                      </div>
                    </td>
                    <td className="px-5 py-4">{lead.phone}</td>
                    <td className="px-5 py-4">{lead.courseName}</td>
                    <td className="px-5 py-4 text-slate-500">{lead.date}</td>
                    <td className="px-5 py-4">
                      <select
                        value={lead.status}
                        onChange={(e) =>
                          handleStatusChange(
                            lead.id,
                            e.target.value as Lead["status"],
                          )
                        }
                        className={`rounded-full px-3 py-1 text-xs font-semibold border-0 outline-none cursor-pointer ${getStatusStyle(lead.status)}`}
                      >
                        <option value="Mới">Mới</option>
                        <option value="Đang tư vấn">Đang tư vấn</option>
                        <option value="Đã đăng ký">Đã đăng ký</option>
                        <option value="Đã hủy">Đã hủy</option>
                      </select>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(lead.id)}
                        className="px-3 py-1 bg-red-50 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-100 transition cursor-pointer"
                      >
                        Xóa
                      </button>
                    </td>
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
