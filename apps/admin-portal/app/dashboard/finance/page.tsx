// apps/admin-portal/app/dashboard/finance/page.tsx
"use client";

import { useState, useEffect } from "react";
import { financeService, Transaction } from "../../../lib/services/finance";

export default function FinancePage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let isMounted = true;

    financeService
      .getAllTransactions()
      .then((data) => {
        if (isMounted) {
          setTransactions(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        console.error("Lỗi khi tải dữ liệu tài chính:", error);
        if (isMounted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Không thể tải danh sách giao dịch từ hệ thống.",
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

  const filteredTransactions = transactions.filter(
    (item) =>
      item.courseName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.studentName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getStatusStyle = (status: Transaction["status"]) => {
    switch (status) {
      case "Thành công":
        return "bg-green-100 text-green-700";
      case "Đang xử lý":
        return "bg-amber-100 text-amber-700";
      case "Thất bại":
        return "bg-red-100 text-red-700";
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Quản lý Tài chính & Doanh thu
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Theo dõi các khoản thanh toán học phí và lịch sử giao dịch trong hệ
            thống.
          </p>
        </div>
      </section>

      {/* Thẻ thống kê tổng quan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">Tổng giao dịch</p>
          <h3 className="text-3xl font-bold text-slate-800">
            {transactions.length}
          </h3>
          <p className="text-xs text-slate-500">Tổng số bản ghi từ hệ thống</p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">
            Giao dịch thành công
          </p>
          <h3 className="text-3xl font-bold text-slate-800">
            {transactions.filter((tx) => tx.status === "Thành công").length}
          </h3>
          <p className="text-xs text-green-600 font-medium">
            Đã hoàn tất thanh toán
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">Đang chờ xử lý</p>
          <h3 className="text-3xl font-bold text-slate-800">
            {transactions.filter((tx) => tx.status === "Đang xử lý").length}
          </h3>
          <p className="text-xs text-amber-600 font-medium">Cần xác nhận</p>
        </div>
      </div>

      {/* Bảng danh sách giao dịch */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            Lịch sử giao dịch gần đây
          </h2>
          <input
            type="text"
            placeholder="Tìm kiếm học viên, khóa học..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-4">Mã GD</th>
                <th className="px-5 py-4">Khóa học</th>
                <th className="px-5 py-4">Học viên</th>
                <th className="px-5 py-4">Số tiền</th>
                <th className="px-5 py-4">Ngày giao dịch</th>
                <th className="px-5 py-4">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Đang tải dữ liệu tài chính từ hệ thống...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td
                    colSpan={6}
                    role="alert"
                    className="px-5 py-16 text-center text-red-600"
                  >
                    Không thể tải dữ liệu tài chính: {loadError}
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    {searchTerm
                      ? "Không tìm thấy giao dịch phù hợp."
                      : "Chưa có giao dịch nào."}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-5 py-4 font-medium text-slate-500">
                      #{tx.id}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {tx.courseName}
                    </td>
                    <td className="px-5 py-4">{tx.studentName}</td>
                    <td className="px-5 py-4 font-semibold text-blue-600">
                      {tx.amount}
                    </td>
                    <td className="px-5 py-4 text-slate-500">{tx.date}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusStyle(tx.status)}`}
                      >
                        {tx.status}
                      </span>
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
