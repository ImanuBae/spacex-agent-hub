"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, request } from "../../lib/request";
import type { Conversation } from "../../lib/services/conversations";
import { Messages } from "./Messages";

const emojis = ["👋", "😊", "👍", "✨"]; // taste-skill-ignore: selectable message content

export default function ChatSandbox({ active = true, onClose, draft = "" }: { active?: boolean; onClose?: () => void; draft?: string }) {
  const [chat, setChat] = useState<Conversation | null>(null);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [text, setText] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ clientMessageId: string; text: string } | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const lastMessageId = chat?.messages.at(-1)?.id;

  useEffect(() => {
    if (!active || busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const conversation = await request<Conversation>("/api/chat/history", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setChat(conversation);
        setHistoryError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          setChat(null);
          setPending(null);
          setHistoryError("");
        } else {
          setHistoryError((error as Error).message);
        }
      }
      timer = setTimeout(() => void poll(), 3000);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, busy]);

  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [active, lastMessageId]);

  async function start() {
    setError("");
    setBusy(true);
    try {
      await request("/api/chat/session", { method: "POST", body: JSON.stringify({ consent: true }) });
      setChat(await request<Conversation>("/api/chat/history"));
      requestAnimationFrame(() => input.current?.focus());
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chat || busy || !text.trim()) return;

    setError("");
    setBusy(true);
    const message = pending ?? { clientMessageId: crypto.randomUUID(), text: text.trim() };
    try {
      await request("/api/chat/messages", { method: "POST", body: JSON.stringify(message) });
      setPending(null);
      setText("");
    } catch (error) {
      setPending(message);
      setError(`${(error as Error).message} Bấm gửi lại để thử lại cùng tin.`);
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    setError("");
    setBusy(true);
    try {
      await request("/api/chat/revoke", { method: "POST", body: "{}" });
      setPending(null);
      setChat(null);
      setText("");
      requestAnimationFrame(() => startButton.current?.focus());
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-window" aria-labelledby="chat-title">
      <header className="chat-header">
        <span className="chat-brand" aria-hidden="true">▲</span>
        <div>
          {onClose ? <h2 id="chat-title">Tư vấn khóa học</h2> : <h1 id="chat-title">Tư vấn khóa học</h1>}
          <p>Hỏi SpaceX Agent Hub về học phí, nội dung khóa học và lịch lớp.</p>
        </div>
        {chat && (
          <details className="chat-menu">
            <summary className="chat-icon" aria-label="Tùy chọn hội thoại">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
              </svg>
            </summary>
            <div className="chat-popover">
              <button type="button" disabled={busy} onClick={() => void endSession()}>Kết thúc phiên tư vấn</button>
            </div>
          </details>
        )}
        {onClose && <button type="button" className="chat-icon chat-widget-dismiss" aria-label="Đóng tư vấn" onClick={onClose}>×</button>}
      </header>

      <div className="chat-thread" ref={thread}>
        {chat ? (
          <>
            <div className="chat-status" role="status">
              <p>{chat.mode === "AI" && chat.aiEnabled !== false ? "Trợ lý AI đang hỗ trợ" : "Đang chờ hoặc được tư vấn viên hỗ trợ"}</p>
              {chat.errorCode && (
                <p>
                  {chat.errorCode === "HANDOFF" ? "" : chat.errorCode === "DATA_POLICY_BLOCKED" || chat.errorCode === "MISSING_KEY"
                    ? "Trợ lý AI chưa được bật trong môi trường này. "
                    : "AI tạm không thể trả lời. "}Yêu cầu đã được chuyển đến tư vấn viên.
                </p>
              )}
            </div>
            {chat.messages.length ? (
              <div role="log" aria-label="Tin nhắn trong phiên">
                <Messages messages={chat.messages} />
              </div>
            ) : <p className="chat-welcome">Bạn muốn học gì? Hãy cho biết mục tiêu và lịch mong muốn.</p>}
          </>
        ) : (
          <div className="chat-welcome">
            <p>Bắt đầu để đồng ý lưu cuộc hội thoại trong phiên tư vấn. Vui lòng tránh gửi giấy tờ, mật khẩu hoặc thông tin thanh toán.</p>
            <button ref={startButton} type="button" disabled={busy} onClick={() => void start()}>
              {busy ? "Đang mở phiên…" : "Bắt đầu tư vấn"}
            </button>
          </div>
        )}
      </div>

      {(error || historyError) && <p role="alert" className="chat-error">{error || historyError}</p>}
      <form className="chat-composer" onSubmit={send}>
        <textarea
          ref={input}
          aria-label="Tin nhắn"
          placeholder="Nhập tin nhắn"
          rows={1}
          required
          maxLength={2000}
          value={text}
          disabled={!chat}
          readOnly={busy || !!pending}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {chat && (
          <details className="chat-emoji">
            <summary className="chat-icon" aria-label="Chọn biểu cảm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M8 14a4.5 4.5 0 0 0 8 0M9 9h.01M15 9h.01" />
              </svg>
            </summary>
            <div className="chat-popover">
              {emojis.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy || !!pending || text.length + emoji.length > 2000}
                  onClick={event => {
                    setText(current => current + emoji);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    input.current?.focus();
                  }}
                >{emoji}</button>
              ))}
            </div>
          </details>
        )}
        <button className="chat-icon chat-send" type="submit" aria-label="Gửi" disabled={!chat || busy || !text.trim()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />
          </svg>
        </button>
      </form>
    </section>
  );
}
