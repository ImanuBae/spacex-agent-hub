"use client";

import React from "react";
import RoadmapState from "../components/RoadmapState";

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

      <RoadmapState
        description="Đối soát giao dịch đang nằm trong lộ trình phát triển. Danh sách tài chính hiện tại là bản mẫu, chưa hỗ trợ xác nhận đối soát."
        href="/dashboard/finance"
        label="Xem bản mẫu tài chính"
      />
    </div>
  );
}
