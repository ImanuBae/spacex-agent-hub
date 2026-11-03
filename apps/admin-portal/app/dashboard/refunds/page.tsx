"use client";

import React from "react";
import RoadmapState from "../components/RoadmapState";

export default function RefundsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Quản lý Hoàn tiền</h1>
        <p className="text-sm text-gray-500">
          Danh sách các yêu cầu hoàn tiền và trạng thái xử lý.
        </p>
      </div>

      <RoadmapState
        description="Tiếp nhận và duyệt hoàn tiền đang nằm trong lộ trình phát triển. Phiên bản hiện tại chưa thực hiện hoàn tiền hoặc thay đổi trạng thái giao dịch."
        href="/dashboard/finance"
        label="Xem bản mẫu tài chính"
      />
    </div>
  );
}
