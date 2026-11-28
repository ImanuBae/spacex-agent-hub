import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import CoursesView from "../khoa-hoc/CoursesView";
import { contactBranches } from "../lien-he/branches";
import { inter } from "../ui/fonts";
import ChatSandbox from "./ChatSandbox";
import "./chat.css";

export const metadata: Metadata = {
  title: "Tư vấn khóa học | SpaceX Agent Hub",
};

export default function ChatPage({ searchParams }: { searchParams: Promise<{ branch?: string | string[] }> }) {
  return (
    <>
      <div className="chat-backdrop" inert>
        <CoursesView backdrop />
      </div>
      <main className={`chat-stage ${inter.className}`}>
        <Suspense fallback={<p role="status">Đang mở tư vấn…</p>}>
          <Consultation searchParams={searchParams} />
        </Suspense>
        <Link href="/khoa-hoc" className="chat-close" aria-label="Đóng chat và xem khóa học">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </main>
    </>
  );
}

async function Consultation({ searchParams }: { searchParams: Promise<{ branch?: string | string[] }> }) {
  const { branch } = await searchParams;
  const selected = contactBranches.find(option => option.code === branch);
  return <ChatSandbox draft={selected ? `Chào SpaceX, mình muốn hỏi về khóa học và lịch lớp tại ${selected.name}.` : ""} />;
}
