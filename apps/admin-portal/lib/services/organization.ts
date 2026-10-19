// apps/admin-portal/lib/services/organization.ts

export interface Department {
  id: number;
  name: string;
  manager: string;
  memberCount: number;
  description: string;
}

const STORAGE_KEY = "admin_portal_organization_data";

function getStoredDepartments(): Department[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveStoredDepartments(departments: Department[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
  }
}

export const organizationService = {
  // Lấy danh sách phòng ban
  getAllDepartments: async (): Promise<Department[]> => {
    return getStoredDepartments();
  },

  // Thêm mới phòng ban
  createDepartment: async (data: Partial<Department>): Promise<Department> => {
    const departments = getStoredDepartments();
    const newId =
      departments.length > 0
        ? Math.max(...departments.map((d) => d.id)) + 1
        : 1;
    const newDept: Department = {
      id: newId,
      name: data.name || "",
      manager: data.manager || "",
      memberCount: Number(data.memberCount) || 0,
      description: data.description || "",
    };
    departments.push(newDept);
    saveStoredDepartments(departments);
    return newDept;
  },

  // Cập nhật thông tin phòng ban
  updateDepartment: async (
    id: number,
    data: Omit<Department, "id">,
  ): Promise<Department> => {
    const departments = getStoredDepartments();
    const departmentIndex = departments.findIndex(
      (department) => department.id === id,
    );
    if (departmentIndex === -1) {
      throw new Error("Không tìm thấy phòng ban cần cập nhật.");
    }

    const updatedDepartment = { id, ...data };
    departments[departmentIndex] = updatedDepartment;
    saveStoredDepartments(departments);
    return updatedDepartment;
  },

  // Xóa phòng ban
  deleteDepartment: async (id: number): Promise<{ success: boolean }> => {
    let departments = getStoredDepartments();
    departments = departments.filter((d) => d.id !== id);
    saveStoredDepartments(departments);
    return { success: true };
  },
};
