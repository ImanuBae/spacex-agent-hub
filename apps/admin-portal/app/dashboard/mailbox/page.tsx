"use client";
import { useEffect, useRef, useState } from "react";
import { conversations, type Conversation } from "../../../lib/services/conversations";
import { Messages } from "../../chat/Messages";
export default function MailboxPage() {
  const [items,setItems] = useState<Conversation[]>([]), [chat,setChat] = useState<Conversation | null>(null), [error,setError] = useState(""), [text,setText] = useState(""), [busy,setBusy] = useState(false);
  const pending = useRef<{ id: string; text: string; conversationId: string } | null>(null);
  useEffect(() => { let active = true;
    const poll = () => conversations.list().then(v => { if (active) setItems(v); }).catch(e => { if (active) setError(e.message); });
    void poll(); const t = setInterval(() => void poll(), 3000); return () => { active = false; clearInterval(t); };
  }, []);
  const selectedId = chat?.id;
  useEffect(() => { if (!selectedId) return; let active = true;
    const poll = () => conversations.get(selectedId).then(v => { if (active) setChat(v); }).catch(e => { if (active) setError(e.message); });
    const t = setInterval(() => void poll(), 3000); return () => { active = false; clearInterval(t); };
  }, [selectedId]);
  async function mode(value: "AI" | "HUMAN") { if (!chat) return; setBusy(true);
    try { setChat(await conversations.mode(chat,value)); setItems(await conversations.list()); setError(""); }
    catch(e) { setError(`${(e as Error).message} Hãy tải lại hội thoại trước khi thao tác tiếp.`); } finally { setBusy(false); }
  }
  async function send(e: React.FormEvent) { e.preventDefault(); if (!chat) return; setBusy(true);
    if (!pending.current || pending.current.conversationId !== chat.id) pending.current = { id: crypto.randomUUID(), text: text.trim(), conversationId: chat.id };
    try { await conversations.send(chat,pending.current.id,pending.current.text); pending.current = null; setText(""); setChat(await conversations.get(chat.id)); setError(""); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section data-ui className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 sm:p-6">
    <h1 className="text-2xl font-semibold">Hộp thư tư vấn</h1><p className="mt-2 text-sm text-slate-600">Tiếp quản để trả lời khách; trả lại AI khi đã xử lý xong.</p>
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    <div className="mt-5 grid gap-6 md:grid-cols-[minmax(220px,306px)_minmax(0,1fr)]">
      <aside className={`${chat ? "hidden md:block" : ""} border-r border-slate-100 pr-4`} aria-label="Hội thoại">
        <p className="mb-3 text-sm">{items.length} hội thoại trong phạm vi của bạn</p>
        {!items.length && <p className="text-sm text-slate-600">Chưa có hội thoại. Tin web chat mới sẽ xuất hiện tại đây.</p>}
        {items.map(c => <button key={c.id} onClick={() => void conversations.get(c.id).then(v => { setChat(v); setError(""); setText(""); }).catch(e => setError(e.message))} className={`block w-full rounded-lg px-3 py-4 text-left ${chat?.id === c.id ? "bg-slate-100" : ""}`}><span className="text-sm font-semibold">Khách · {c.id.slice(0,8)}</span><span className="mt-1 block text-sm text-slate-600">{c.mode === "AI" ? "AI hỗ trợ" : c.ownerId ? "Đã tiếp quản" : "Chờ tư vấn viên"}</span></button>)}
      </aside>
      <div className="min-w-0">{!chat ? <p className="py-6 text-slate-600">Chọn hội thoại để xem lịch sử và tiếp quản.</p> : <>
        <button onClick={() => setChat(null)} className="mb-3 text-sm underline md:hidden">Trở lại danh sách</button>
        <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-semibold">Khách · {chat.id.slice(0,8)}</h2><button disabled={busy} onClick={() => void mode("HUMAN")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Tiếp quản</button><button disabled={busy || chat.mode === "AI"} onClick={() => void mode("AI")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Trả lại AI</button></div>
        <p role="status" className="mt-3 text-sm">{chat.mode === "AI" ? "AI hỗ trợ" : chat.ownerId ? `Người xử lý: ${chat.ownerId.slice(0,8)}` : "Chờ tư vấn viên"} · phiên bản {chat.version}</p>
        {chat.errorCode && <p className="mt-2 text-sm text-amber-800">AI cần hỗ trợ: {chat.errorCode}</p>}
        <Messages messages={chat.messages}/>
        <form onSubmit={send} className="flex items-end gap-2"><label className="flex-1 text-sm">Trả lời khách<textarea required maxLength={2000} disabled={busy || chat.mode !== "HUMAN"} value={text} onChange={e => { if (!pending.current) setText(e.target.value); }} className="mt-1 block min-h-20 w-full rounded-lg border border-slate-300 p-3"/></label><button disabled={busy || chat.mode !== "HUMAN" || !text.trim()} className="rounded-lg bg-slate-900 px-4 py-3 text-white">Gửi</button></form>
      </>}</div>
    </div>
  </section>;
}
