// apps/admin-portal/lib/services/finance.ts

export interface Transaction {
  id: number;
  courseName: string;
  studentName: string;
  amount: string;
  date: string;
  status: "Thành công" | "Đang xử lý" | "Thất bại";
}

const STORAGE_KEY = "admin_portal_finance_data";

function getStoredTransactions(): Transaction[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    return [];
  }
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveStoredTransactions(transactions: Transaction[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }
}

export const financeService = {
  // Lấy toàn bộ danh sách giao dịch
  getAllTransactions: async (): Promise<Transaction[]> => {
    return getStoredTransactions();
  },

  // Lấy chi tiết một giao dịch theo ID
  getTransactionById: async (id: string): Promise<Transaction> => {
    const transactions = getStoredTransactions();
    const tx = transactions.find((t) => t.id.toString() === id);
    if (!tx) throw new Error("Không tìm thấy giao dịch");
    return tx;
  },

  // Tạo mới giao dịch
  createTransaction: async (
    data: Partial<Transaction>,
  ): Promise<Transaction> => {
    const transactions = getStoredTransactions();
    const newId =
      transactions.length > 0
        ? Math.max(...transactions.map((t) => t.id)) + 1
        : 101;
    const newTx: Transaction = {
      id: newId,
      courseName: data.courseName || "",
      studentName: data.studentName || "",
      amount: data.amount || "0 đ",
      date: data.date || new Date().toISOString().split("T")[0],
      status: data.status || "Đang xử lý",
    };
    transactions.unshift(newTx);
    saveStoredTransactions(transactions);
    return newTx;
  },

  // Cập nhật giao dịch
  updateTransaction: async (
    id: string,
    data: Partial<Transaction>,
  ): Promise<Transaction> => {
    const transactions = getStoredTransactions();
    const index = transactions.findIndex((t) => t.id.toString() === id);
    if (index === -1) throw new Error("Không tìm thấy giao dịch để cập nhật");

    transactions[index] = {
      ...transactions[index],
      ...data,
    };
    saveStoredTransactions(transactions);
    return transactions[index];
  },

  // Xóa giao dịch
  deleteTransaction: async (id: string): Promise<{ success: boolean }> => {
    let transactions = getStoredTransactions();
    transactions = transactions.filter((t) => t.id.toString() !== id);
    saveStoredTransactions(transactions);
    return { success: true };
  },
};
