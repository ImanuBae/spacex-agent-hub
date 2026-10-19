// apps/admin-portal/src/config/menu.ts
import type { MenuGroup, Role } from "@/types/roles";

export const MENU_CONFIG: MenuGroup[] = [
  {
    groupTitle: "Tổng quan & Hộp thư",
    items: [
      {
        title: "Tổng quan trung tâm",
        href: "/dashboard/center-overview",
        roles: ["center_director"],
      },
      {
        title: "Tổng quan chi nhánh",
        href: "/dashboard/branch-overview",
        roles: ["branch_director"],
      },
      {
        title: "Hộp thư",
        href: "/dashboard/inbox",
        roles: ["center_director", "branch_director", "admissions"],
      },
    ],
  },
  {
    groupTitle: "Tuyển sinh & Đăng ký",
    items: [
      {
        title: "Lead & Đăng ký",
        href: "/dashboard/leads",
        roles: ["center_director", "branch_director", "admissions"],
      },
    ],
  },
  {
    groupTitle: "Đào tạo & Lịch dạy",
    items: [
      {
        title: "Catalog / Khóa học",
        href: "/dashboard/courses",
        roles: ["center_director", "admissions"],
      },
      {
        title: "Lịch & Lớp học",
        href: "/dashboard/schedules",
        roles: ["center_director", "branch_director", "admissions"],
      },
      {
        title: "Lịch dạy & Giờ rảnh",
        href: "/dashboard/teacher-schedule",
        roles: ["teacher"],
      },
      {
        title: "Danh sách lớp",
        href: "/dashboard/my-classes",
        roles: ["teacher"],
      },
    ],
  },
  {
    groupTitle: "Tài chính & Quản trị",
    items: [
      {
        title: "Tài chính toàn hệ thống",
        href: "/dashboard/finance-global",
        roles: ["center_director"],
      },
      {
        title: "Tài chính chi nhánh",
        href: "/dashboard/finance-branch",
        roles: ["branch_director"],
      },
      {
        title: "Thanh toán & Đối soát",
        href: "/dashboard/payments",
        roles: ["accountant"],
      },
      {
        title: "Hoàn tiền",
        href: "/dashboard/refunds",
        roles: ["accountant"],
      },
      {
        title: "Tổ chức & Chi nhánh",
        href: "/dashboard/organization",
        roles: ["center_director"],
      },
      {
        title: "Audit Log",
        href: "/dashboard/audit",
        roles: ["center_director"],
      },
    ],
  },
];

/**
 * Hàm lọc các mục Menu phù hợp với vai trò hiện tại
 */
export function getMenuByRole(currentRole: Role): MenuGroup[] {
  if (currentRole === "ai_agent" || currentRole === "student") {
    return [];
  }

  return MENU_CONFIG.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(currentRole)),
  })).filter((group) => group.items.length > 0);
}