"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/request";
import type { Conversation } from "../../lib/services/conversations";
import { Messages } from "./Messages";
export default function ChatPage() {
  const [chat,setChat] = useState<Conversation | null>(null), [error,setError] = useState(""), [text,setText] = useState(""), [busy,setBusy] = useState(false);
  const pending = useRef<{ clientMessageId: string; text: string } | null>(null);
  async function refresh() { setChat(await request<Conversation>("/api/chat/history")); }
  useEffect(() => {
    let active = true;
    const poll = () => request<Conversation>("/api/chat/history").then(c => { if (active) { setChat(c); setError(""); } }).catch(e => { if (active) setError(e.message); });
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function start() { setBusy(true); try { await request("/api/chat/session", { method: "POST", body: JSON.stringify({ consent: true }) }); await refresh(); setError(""); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true);
    pending.current ??= { clientMessageId: crypto.randomUUID(), text: text.trim() };
    try { await request("/api/chat/messages", { method: "POST", body: JSON.stringify(pending.current) }); pending.current = null; setText(""); await refresh(); setError(""); }
    catch(e) { setError(`${(e as Error).message} Bấm gửi lại để thử lại cùng tin.`); } finally { setBusy(false); }
  }
  return <main data-ui className="min-h-screen bg-slate-50 p-3 text-slate-800 sm:p-8"><section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <header className="border-b border-slate-200 pb-4"><p className="text-sm text-slate-600">Space Agent Hub</p><h1 className="mt-1 text-2xl font-semibold">Tư vấn khóa học</h1><p className="mt-2 text-sm">Tra cứu khóa học và lịch lớp. Chưa đăng ký hoặc giữ chỗ qua chat.</p></header>
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    {!chat ? <div className="py-6"><p className="mb-4 text-sm">Bắt đầu để đồng ý lưu cuộc hội thoại trong phiên tư vấn. Không gửi giấy tờ, mật khẩu hoặc thông tin thanh toán.</p><button disabled={busy} onClick={() => void start()} className="rounded-lg bg-slate-900 px-4 py-3 text-white">Bắt đầu tư vấn</button></div> : <>
      <p role="status" className="mt-4 text-sm">{chat.mode === "AI" ? "Trợ lý AI đang hỗ trợ" : "Đang chờ hoặc được tư vấn viên hỗ trợ"}</p>
      {chat.errorCode && <p className="mt-2 text-sm text-amber-800">AI tạm không thể trả lời. Yêu cầu đã được chuyển đến tư vấn viên.</p>}
      <Messages messages={chat.messages}/>
      {!chat.messages.length && <p className="py-6 text-slate-600">Bạn muốn học gì? Hãy cho biết mục tiêu và lịch mong muốn.</p>}
      <form onSubmit={send} className="flex items-end gap-2"><label className="flex-1 text-sm">Tin nhắn<textarea required maxLength={2000} value={text} disabled={busy} onChange={e => { if (!pending.current) setText(e.target.value); }} className="mt-1 block min-h-20 w-full rounded-lg border border-slate-300 p-3"/></label><button disabled={busy || !text.trim()} className="rounded-lg bg-slate-900 px-4 py-3 text-white">{busy ? "Đang gửi…" : "Gửi"}</button></form>
      <button className="mt-4 text-sm underline" onClick={() => void request("/api/chat/revoke", { method: "POST", body: "{}" }).then(() => { setChat(null); pending.current = null; setText(""); }).catch(e => setError(e.message))}>Kết thúc phiên tư vấn</button>
    </>}
  </section></main>;
}
