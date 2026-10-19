// apps/admin-portal/app/dashboard/mailbox/page.tsx
"use client";

import { useState, useEffect } from "react";
import { mailboxService, Message } from "../../../lib/services/mailbox";

export default function MailboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshMessages = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await mailboxService.getAllMessages();
      setMessages(data);
      setSelectedMessage(
        (current) =>
          data.find((message) => message.id === current?.id) ?? data[0] ?? null,
      );
    } catch (error) {
      console.error("Lỗi tải hộp thư:", error);
      setLoadError(
        error instanceof Error ? error.message : "Không thể tải hộp thư.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    mailboxService
      .getAllMessages()
      .then((data) => {
        if (isMounted) {
          setMessages(data);
          setSelectedMessage((current) => current ?? data[0] ?? null);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        console.error("Lỗi tải hộp thư:", error);
        if (isMounted) {
          setLoadError(
            error instanceof Error ? error.message : "Không thể tải hộp thư.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectMessage = async (msg: Message) => {
    setActionError(null);
    if (!msg.unread) {
      setSelectedMessage(msg);
      return;
    }

    try {
      await mailboxService.markAsRead(msg.id);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === msg.id ? { ...item, unread: false } : item,
        ),
      );
      setSelectedMessage({ ...msg, unread: false });
    } catch (error) {
      console.error(`Lỗi đánh dấu tin nhắn #${msg.id} đã đọc:`, error);
      setActionError(
        error instanceof Error
          ? error.message
          : "Không thể đánh dấu tin nhắn đã đọc.",
      );
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Bạn có chắc chắn muốn xóa tin nhắn này?")) {
      return;
    }

    setActionError(null);
    try {
      await mailboxService.deleteMessage(id);
      const remainingMessages = messages.filter((message) => message.id !== id);
      setMessages(remainingMessages);
      setSelectedMessage(remainingMessages[0] ?? null);
    } catch (error) {
      console.error(`Lỗi xóa tin nhắn #${id}:`, error);
      setActionError(
        error instanceof Error
          ? error.message
          : "Không thể xóa tin nhắn. Vui lòng thử lại.",
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Hộp thư liên hệ
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Quản lý tin nhắn, câu hỏi và yêu cầu hỗ trợ từ học viên.
          </p>
        </div>
      </section>

      {/* Giao diện 2 cột: Danh sách & Chi tiết */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cột trái: Danh sách tin nhắn */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden lg:col-span-1">
          <div className="p-4 border-b border-slate-200 font-semibold text-slate-800 flex items-center justify-between">
            <span>Tin nhắn đến</span>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full font-bold">
                {messages.filter((m) => m.unread).length} chưa đọc
              </span>
              <button
                type="button"
                onClick={refreshMessages}
                disabled={isLoading}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:cursor-wait disabled:opacity-50"
              >
                Làm mới
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {isLoading ? (
              <p className="p-6 text-center text-slate-400 italic text-sm">
                Đang tải hộp thư...
              </p>
            ) : loadError ? (
              <p role="alert" className="p-6 text-center text-red-600 text-sm">
                Không thể tải hộp thư: {loadError}
              </p>
            ) : messages.length === 0 ? (
              <p className="p-6 text-center text-slate-400 italic text-sm">
                Hộp thư trống.
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => handleSelectMessage(msg)}
                  className={`p-4 cursor-pointer transition hover:bg-slate-50 ${
                    selectedMessage?.id === msg.id
                      ? "bg-blue-50/55 border-l-4 border-blue-600"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm ${
                        msg.unread
                          ? "text-slate-900 font-bold"
                          : "text-slate-700 font-medium"
                      }`}
                    >
                      {msg.sender}
                    </span>
                    <span className="text-xs text-slate-400">{msg.date}</span>
                  </div>
                  <p
                    className={`text-xs truncate mb-1 ${
                      msg.unread
                        ? "font-semibold text-slate-800"
                        : "text-slate-600"
                    }`}
                  >
                    {msg.subject}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {msg.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Cột phải: Nội dung chi tiết tin nhắn */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 lg:col-span-2 flex flex-col justify-between">
          {actionError && (
            <p role="alert" className="mb-4 text-sm text-red-600">
              {actionError}
            </p>
          )}
          {selectedMessage &&
          messages.some((message) => message.id === selectedMessage.id) ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    {selectedMessage.subject}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Từ:{" "}
                    <span className="font-semibold text-slate-700">
                      {selectedMessage.sender}
                    </span>{" "}
                    ({selectedMessage.email})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(selectedMessage.id)}
                  className="px-3.5 py-2 bg-red-50 text-red-600 text-xs font-semibold rounded-xl hover:bg-red-100 transition cursor-pointer"
                >
                  Xóa tin nhắn
                </button>
              </div>

              <div className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-5 rounded-xl border border-slate-100 min-h-[220px]">
                {selectedMessage.content}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[300px] text-slate-400 italic text-sm">
              Chọn một tin nhắn từ danh sách bên trái để xem nội dung chi tiết.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
