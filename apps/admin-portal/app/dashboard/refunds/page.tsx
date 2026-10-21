"use client";

import React from "react";

export default function RefundsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Quản lý Hoàn tiền</h1>
        <p className="text-sm text-gray-500">
          Danh sách các yêu cầu hoàn tiền và trạng thái xử lý.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 min-h-[400px]">
        {/* Nội dung danh sách yêu cầu hoàn tiền sẽ kết nối API tại đây */}
      </div>
    </div>
  );
}
