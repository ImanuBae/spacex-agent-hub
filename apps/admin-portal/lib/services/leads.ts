// apps/admin-portal/lib/services/leads.ts

export interface Lead {
  id: number;
  fullName: string;
  phone: string;
  email: string;
  courseName: string;
  status: "Mới" | "Đang tư vấn" | "Đã đăng ký" | "Đã hủy";
  date: string;
}

const STORAGE_KEY = "admin_portal_leads_data";

function getStoredLeads(): Lead[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveStoredLeads(leads: Lead[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
  }
}

export const leadService = {
  // Lấy toàn bộ danh sách lead
  getAllLeads: async (): Promise<Lead[]> => {
    return getStoredLeads();
  },

  // Thêm mới lead
  createLead: async (data: Partial<Lead>): Promise<Lead> => {
    const leads = getStoredLeads();
    const newId =
      leads.length > 0 ? Math.max(...leads.map((l) => l.id)) + 1 : 1;
    const newLead: Lead = {
      id: newId,
      fullName: data.fullName || "",
      phone: data.phone || "",
      email: data.email || "",
      courseName: data.courseName || "",
      status: data.status || "Mới",
      date: data.date || new Date().toISOString().split("T")[0],
    };
    leads.unshift(newLead);
    saveStoredLeads(leads);
    return newLead;
  },

  // Cập nhật trạng thái lead
  updateLeadStatus: async (
    id: number,
    status: Lead["status"],
  ): Promise<Lead> => {
    const leads = getStoredLeads();
    const index = leads.findIndex((l) => l.id === id);
    if (index === -1) throw new Error("Không tìm thấy lead");
    leads[index].status = status;
    saveStoredLeads(leads);
    return leads[index];
  },

  // Xóa lead
  deleteLead: async (id: number): Promise<{ success: boolean }> => {
    let leads = getStoredLeads();
    leads = leads.filter((l) => l.id !== id);
    saveStoredLeads(leads);
    return { success: true };
  },
};
