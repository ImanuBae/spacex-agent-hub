import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import ChatWidget from "./chat/ChatWidget";

export const metadata: Metadata = {
  title: "SpaceX Agent Hub",
  description: "Hệ thống quản trị và điều phối",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}<Suspense fallback={null}><ChatWidget /></Suspense></body>
    </html>
  );
}
