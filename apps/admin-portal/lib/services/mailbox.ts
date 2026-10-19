// apps/admin-portal/lib/services/mailbox.ts

export interface Message {
  id: number;
  sender: string;
  email: string;
  subject: string;
  content: string;
  date: string;
  unread: boolean;
}

const STORAGE_KEY = "admin_portal_mailbox_data";

// Khai báo mảng rỗng ban đầu để tránh lỗi không tìm thấy biến
const initialMessages: Message[] = [];

function getStoredMessages(): Message[] {
  if (typeof window === "undefined") return initialMessages;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialMessages));
    return initialMessages;
  }
  try {
    return JSON.parse(data);
  } catch {
    return initialMessages;
  }
}

function saveStoredMessages(messages: Message[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }
}

export const mailboxService = {
  // Lấy toàn bộ danh sách tin nhắn
  getAllMessages: async (): Promise<Message[]> => {
    return getStoredMessages();
  },

  // Đánh dấu tin nhắn đã đọc
  markAsRead: async (id: number): Promise<void> => {
    const messages = getStoredMessages();
    const index = messages.findIndex((m) => m.id === id);
    if (index !== -1) {
      messages[index].unread = false;
      saveStoredMessages(messages);
    }
  },

  // Xóa tin nhắn
  deleteMessage: async (id: number): Promise<void> => {
    let messages = getStoredMessages();
    messages = messages.filter((m) => m.id !== id);
    saveStoredMessages(messages);
  },
};
