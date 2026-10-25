// apps/admin-portal/lib/roles.ts

export type UserRole =
  | "center_director"
  | "branch_director"
  | "admissions"
  | "accountant"
  | "teacher"
  | "student"
  | "ai_agent";

export interface MenuItem {
  label: string;
  href: string;
  icon?: string;
}

// Định nghĩa danh sách menu theo phân quyền từ tài liệu
export function getMenuByRole(role: UserRole): MenuItem[] {
  switch (role) {
    case "center_director":
      return [
        { label: "Tổng quan", href: "/dashboard/overview" },
        { label: "Hộp thư", href: "/dashboard/mailbox" },
        { label: "Lead & đăng ký", href: "/dashboard/leads" },
        { label: "Khóa học & lịch", href: "/dashboard/courses" },
        { label: "Tài chính", href: "/dashboard/finance" },
        { label: "Tổ chức", href: "/dashboard/organization" },
        { label: "Audit", href: "/dashboard/audit" },
      ];
    case "branch_director":
      return [
        { label: "Tổng quan chi nhánh", href: "/dashboard/overview" },
        { label: "Hộp thư", href: "/dashboard/mailbox" },
        { label: "Lead & đăng ký", href: "/dashboard/leads" },
        { label: "Khóa học & lịch", href: "/dashboard/courses" },
        { label: "Tài chính chi nhánh", href: "/dashboard/finance" },
      ];
    case "admissions":
      return [
        { label: "Hộp thư", href: "/dashboard/mailbox" },
        { label: "Lead & đăng ký", href: "/dashboard/leads" },
        { label: "Xem khóa học", href: "/dashboard/courses" },
        { label: "Xem lịch", href: "/dashboard/schedule" },
      ];
    case "accountant":
      return [
        { label: "Thanh toán", href: "/dashboard/finance" },
        { label: "Đối soát", href: "/dashboard/reconciliation" },
        { label: "Hoàn tiền", href: "/dashboard/refunds" },
      ];
    case "teacher":
      return [
        { label: "Lịch dạy", href: "/dashboard/schedule" },
        { label: "Giờ rảnh", href: "/dashboard/availability" },
        { label: "Danh sách lớp", href: "/dashboard/classes" },
      ];
    case "student":
    case "ai_agent":
    default:
      return []; // Student Portal ở giai đoạn sau, ai_agent không dùng Admin Portal
  }
}

export const roleLabels: Record<UserRole, string> = {
  center_director: "Giám đốc trung tâm",
  branch_director: "Giám đốc chi nhánh",
  admissions: "Tuyển sinh",
  accountant: "Kế toán",
  teacher: "Giáo viên",
  student: "Học viên",
  ai_agent: "AI Agent",
};
