"use client";

import React from "react";

export default function AvailabilityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Đăng ký Giờ rảnh</h1>
        <p className="text-sm text-gray-500">
          Quản lý thời gian rảnh cá nhân để trung tâm xếp lịch giảng dạy.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 min-h-[400px]">
        {/* Nội dung biểu đồ/lịch đăng ký giờ rảnh sẽ được cập nhật tại đây */}
      </div>
    </div>
  );
}
