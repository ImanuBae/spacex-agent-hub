// apps/admin-portal/app/dashboard/overview/page.tsx
"use client";

import { useState, useEffect } from "react";
import { courseService, Course } from "../../../lib/services/courses";
import { financeService, Transaction } from "../../../lib/services/finance";
import { mailboxService, Message } from "../../../lib/services/mailbox";
import { leadService, Lead } from "../../../lib/services/leads";

export default function OverviewPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [courseLoadError, setCourseLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchDashboardData() {
      const results = await Promise.allSettled([
        courseService.getAllCourses(),
        financeService.getAllTransactions(),
        mailboxService.getAllMessages(),
        leadService.getAllLeads(),
      ] as const);

      if (!isMounted) return;

      const [coursesResult, transactionsResult, messagesResult, leadsResult] =
        results;

      if (coursesResult.status === "fulfilled") {
        setCourses(coursesResult.value);
        setCourseLoadError(null);
      } else {
        setCourseLoadError(
          coursesResult.reason instanceof Error
            ? coursesResult.reason.message
            : "Không thể tải dữ liệu khóa học.",
        );
      }

      if (transactionsResult.status === "fulfilled") {
        setTransactions(transactionsResult.value);
      } else {
        console.error(
          "Lỗi khi tải giao dịch cho trang tổng quan:",
          transactionsResult.reason,
        );
      }

      if (messagesResult.status === "fulfilled") {
        setMessages(messagesResult.value);
      } else {
        console.error(
          "Lỗi khi tải tin nhắn cho trang tổng quan:",
          messagesResult.reason,
        );
      }

      if (leadsResult.status === "fulfilled") {
        setLeads(leadsResult.value);
      } else {
        console.error(
          "Lỗi khi tải leads cho trang tổng quan:",
          leadsResult.reason,
        );
      }

      setIsLoading(false);
    }

    fetchDashboardData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Tính toán số liệu thống kê
  const totalRevenue = transactions
    .filter((tx) => tx.status === "Thành công")
    .reduce((sum, tx) => {
      const numericVal = parseInt(tx.amount.replace(/\D/g, ""), 10) || 0;
      return sum + numericVal;
    }, 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(amount);
  };

  const unreadMessagesCount = messages.filter((m) => m.unread).length;
  const registeredLeadsCount = leads.filter(
    (l) => l.status === "Đã đăng ký",
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Tổng quan Hệ thống
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Chào mừng bạn trở lại! Dưới đây là báo cáo tổng quan về hoạt động
            của trung tâm.
          </p>
        </div>
      </section>

      {/* Các thẻ thống kê nhanh (KPI Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">Tổng doanh thu</p>
          <h3 className="text-3xl font-bold text-slate-800">
            {isLoading ? "..." : formatCurrency(totalRevenue)}
          </h3>
          <p className="text-xs text-green-600 font-medium">
            Từ các giao dịch thành công
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">Tổng số Khóa học</p>
          <h3 className="text-3xl font-bold text-slate-800">
            {isLoading ? "..." : courseLoadError ? "—" : courses.length}
          </h3>
          <p
            className={`text-xs font-medium ${courseLoadError ? "text-red-600" : "text-blue-600"}`}
            role={courseLoadError ? "status" : undefined}
          >
            {courseLoadError || "Khóa học đang vận hành"}
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">
            Học viên tiềm năng (Leads)
          </p>
          <h3 className="text-3xl font-bold text-slate-800">
            {isLoading ? "..." : leads.length}
          </h3>
          <p className="text-xs text-amber-600 font-medium">
            Đã chuyển đổi: {registeredLeadsCount} học viên
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-sm font-medium text-slate-500">Hộp thư chưa đọc</p>
          <h3 className="text-3xl font-bold text-slate-800">
            {isLoading ? "..." : unreadMessagesCount}
          </h3>
          <p className="text-xs text-purple-600 font-medium">
            Tin nhắn cần phản hồi
          </p>
        </div>
      </div>

      {/* Bảng hoạt động gần đây */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Giao dịch gần đây */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 font-semibold text-slate-800">
            Giao dịch tài chính gần đây
          </div>
          <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="p-6 text-center text-slate-400 italic text-sm">
                Chưa có giao dịch nào gần đây.
              </p>
            ) : (
              transactions.slice(0, 5).map((tx) => (
                <div
                  key={tx.id}
                  className="px-5 py-3.5 flex items-center justify-between text-sm"
                >
                  <div>
                    <p className="font-semibold text-slate-800">
                      {tx.courseName}
                    </p>
                    <p className="text-xs text-slate-500">
                      Học viên: {tx.studentName} - {tx.date}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-blue-600">
                      {tx.amount}
                    </span>
                    <p className="text-xs text-slate-400">{tx.status}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Học viên tiềm năng mới */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 font-semibold text-slate-800">
            Học viên đăng ký tư vấn gần đây
          </div>
          <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
            {leads.length === 0 ? (
              <p className="p-6 text-center text-slate-400 italic text-sm">
                Chưa có học viên tiềm năng nào.
              </p>
            ) : (
              leads.slice(0, 5).map((lead) => (
                <div
                  key={lead.id}
                  className="px-5 py-3.5 flex items-center justify-between text-sm"
                >
                  <div>
                    <p className="font-semibold text-slate-800">
                      {lead.fullName}
                    </p>
                    <p className="text-xs text-slate-500">
                      Quan tâm: {lead.courseName}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700">
                    {lead.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
