"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { inter } from "../ui/fonts";
import ChatSandbox from "./ChatSandbox";
import "./chat.css";

const openChat = "hub:open-chat";
const mobileQuery = "(max-width: 600px)";

export function ChatButton({ onClick, ...props }: ComponentProps<"button">) {
  return <button {...props} type="button" aria-haspopup="dialog" onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented) window.dispatchEvent(new CustomEvent(openChat, { detail: event.currentTarget }));
  }} />;
}

export default function ChatWidget() {
  const path = usePathname();
  const visible = path === "/" || /^\/(khoa-hoc|student)(\/|$)/.test(path);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const active = visible && open;

  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!visible) return;
    function show(event: Event) {
      trigger.current = (event as CustomEvent<HTMLElement>).detail;
      setLoaded(true);
      setOpen(true);
    }
    window.addEventListener(openChat, show);
    return () => window.removeEventListener(openChat, show);
  }, [visible]);

  useEffect(() => {
    const panel = dialog.current;
    if (!active || !panel) return;
    const mobile = window.matchMedia(mobileQuery);
    const viewport = window.visualViewport;
    function size() {
      if (!panel || !viewport) return;
      panel.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
      panel.style.setProperty("--chat-viewport-top", `${viewport.offsetTop}px`);
    }
    function display() {
      if (!panel) return;
      if (panel.open) panel.close();
      if (mobile.matches) panel.showModal();
      else panel.show();
      panel.querySelector<HTMLElement>(".chat-widget-dismiss")?.focus();
      size();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !mobile.matches) {
        event.preventDefault();
        close();
      }
    }
    display();
    mobile.addEventListener("change", display);
    viewport?.addEventListener("resize", size);
    viewport?.addEventListener("scroll", size);
    window.addEventListener("keydown", escape);
    return () => {
      panel.close();
      mobile.removeEventListener("change", display);
      viewport?.removeEventListener("resize", size);
      viewport?.removeEventListener("scroll", size);
      window.removeEventListener("keydown", escape);
    };
  }, [active]);

  return <>
    {visible && <ChatButton className={`chat-launcher ${inter.className}`} aria-controls="consultation-chat" aria-expanded={active}
      onClick={event => { if (active) { event.preventDefault(); close(); } }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.7-3.2A8.5 8.5 0 1 1 21 11.5Z" /><path d="M9 11.5h7" />
      </svg>
      Tư vấn
    </ChatButton>}
    <dialog ref={dialog} id="consultation-chat" aria-labelledby="chat-title" className={`chat-stage chat-widget ${inter.className}`}
      onCancel={event => { event.preventDefault(); close(); }}>
      {loaded && <ChatSandbox active={active} onClose={close} />}
    </dialog>
  </>;
}
