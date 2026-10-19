// apps/admin-portal/app/(dashboard)/schedule/page.tsx
"use client";

import { useState } from "react";

interface ScheduleItem {
  id: string;
  className: string;
  teacherName: string;
  room: string;
  timeSlot: string;
  dayOfWeek: string;
  status: string;
}

export default function SchedulePage() {
  const [schedules] = useState<ScheduleItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredSchedules = schedules.filter(
    (item) =>
      item.className.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.teacherName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.room.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-6">
      {/* Tiêu đề trang và các nút hành động */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Quản lý Lịch dạy & Lớp học
          </h1>
          <p className="text-sm text-slate-500">
            Theo dõi lịch trình giảng dạy, phân bổ phòng học và thời khóa biểu
            của giảng viên.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => alert("Mở modal thêm lịch dạy mới")}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition shadow-sm cursor-pointer"
          >
            + Xếp lịch mới
          </button>
        </div>
      </div>

      {/* Thẻ thống kê tổng quan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">
            Tổng số lớp trong tuần
          </span>
          <div className="text-2xl font-bold text-slate-900 mt-1">0</div>
          <span className="text-xs text-slate-500 font-medium mt-1 inline-block">
            Đang hoạt động
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">
            Giảng viên sẵn sàng
          </span>
          <div className="text-2xl font-bold text-green-600 mt-1">0</div>
          <span className="text-xs text-slate-500 mt-1 inline-block">
            Đã đăng ký giờ rảnh
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">
            Phòng học đang dùng
          </span>
          <div className="text-2xl font-bold text-amber-600 mt-1">0</div>
          <span className="text-xs text-slate-500 mt-1 inline-block">
            Theo thời khóa biểu
          </span>
        </div>
      </div>

      {/* Thanh tìm kiếm */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Tìm kiếm theo tên lớp học, giảng viên hoặc phòng học..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full sm:w-96 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="text-sm text-slate-500 hidden sm:block">
          Tổng số:{" "}
          <span className="font-semibold text-slate-700">
            {filteredSchedules.length}
          </span>{" "}
          lịch trình
        </div>
      </div>

      {/* Bảng danh sách lịch dạy */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Tên lớp học</th>
                <th className="py-3 px-4">Giảng viên</th>
                <th className="py-3 px-4">Phòng học</th>
                <th className="py-3 px-4">Khung giờ</th>
                <th className="py-3 px-4">Thứ trong tuần</th>
                <th className="py-3 px-4">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-10 text-center text-slate-400 italic"
                  >
                    Chưa có lịch trình giảng dạy nào trong hệ thống.
                  </td>
                </tr>
              ) : (
                filteredSchedules.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {item.className}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {item.teacherName}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{item.room}</td>
                    <td className="py-3 px-4 font-medium text-blue-600">
                      {item.timeSlot}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {item.dayOfWeek}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
