import type { ChatMessage } from "../../lib/services/conversations";
export function Messages({ messages }: { messages: ChatMessage[] }) {
  return <ol aria-label="Lịch sử hội thoại" className="space-y-5 overflow-y-auto break-words py-5">
    {messages.map(m => <li key={m.id} className="border-b border-slate-100 pb-4">
      <p className="mb-1 text-sm font-semibold">{({ GUEST: "Khách", STAFF: "Tư vấn viên", AI: "Trợ lý AI", SYSTEM: "Hệ thống" } as Record<string,string>)[m.sender] ?? m.sender}
        <span className="ml-3 font-normal text-slate-500">{new Date(m.createdAt).toLocaleTimeString("vi-VN")} · {m.delivery === "CANCELLED" ? "Đã hủy" : m.delivery === "QUEUED" ? "Chờ nhận" : "Đã nhận"}</span></p>
      <p className="whitespace-pre-wrap">{m.text}</p>
      {m.sources.map((s,i) => <p key={i} className="mt-1 text-xs text-slate-600">Nguồn: {s.api} · đọc lúc {new Date(s.readAt).toLocaleString("vi-VN")}</p>)}
    </li>)}
  </ol>;
}
