import "./globals.css";
import type { Metadata } from "next";

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
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
