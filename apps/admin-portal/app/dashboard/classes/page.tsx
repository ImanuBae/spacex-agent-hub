"use client";

import React from "react";

export default function TeacherClassesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Danh sách Lớp học</h1>
        <p className="text-sm text-gray-500">
          Các lớp học được phân công phụ trách giảng dạy.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 min-h-[400px]">
        {/* Nội dung danh sách lớp học sẽ kết nối API tại đây */}
      </div>
    </div>
  );
}
