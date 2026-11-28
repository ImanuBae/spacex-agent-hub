import { Suspense, type ReactNode } from "react";
import StudentShell from "./StudentShell";
import "../ui/theme.css";
import "../dashboard/components/operations.css";
import "./student.css";
import "./portal.css";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status">Đang tải cổng học viên…</p>}><StudentShell>{children}</StudentShell></Suspense>;
}
