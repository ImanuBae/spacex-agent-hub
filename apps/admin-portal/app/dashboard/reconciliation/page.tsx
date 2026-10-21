"use client";

import React from "react";

export default function ReconciliationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          Đối soát tài chính
        </h1>
        <p className="text-sm text-gray-500">
          Quản lý và đối soát các giao dịch doanh thu của trung tâm.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 min-h-[400px]">
        {/* Nội dung danh sách/bảng đối soát sẽ kết nối API tại đây */}
      </div>
    </div>
  );
}
