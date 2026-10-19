// apps/admin-portal/lib/services/audit.ts

export interface AuditLog {
  id: number;
  action: string; // Hành động (Ví dụ: "Thêm khóa học", "Xóa phòng ban")
  performedBy: string; // Người thực hiện
  timestamp: string; // Thời gian thực hiện
  details: string; // Chi tiết thao tác
}

const STORAGE_KEY = "admin_portal_audit_logs";

function getStoredLogs(): AuditLog[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveStoredLogs(logs: AuditLog[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }
}

export const auditService = {
  // Lấy toàn bộ nhật ký
  getAllLogs: async (): Promise<AuditLog[]> => {
    return getStoredLogs();
  },

  // Ghi nhận một hành động mới vào nhật ký
  logAction: async (
    action: string,
    performedBy: string,
    details: string,
  ): Promise<AuditLog> => {
    const logs = getStoredLogs();
    const newId = logs.length > 0 ? Math.max(...logs.map((l) => l.id)) + 1 : 1;
    const newLog: AuditLog = {
      id: newId,
      action,
      performedBy,
      timestamp: new Date().toLocaleString("vi-VN"),
      details,
    };
    logs.unshift(newLog); // Đưa log mới nhất lên đầu danh sách
    saveStoredLogs(logs);
    return newLog;
  },

  // Xóa toàn bộ lịch sử nhật ký (nếu cần)
  clearLogs: async (): Promise<void> => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  },
};
