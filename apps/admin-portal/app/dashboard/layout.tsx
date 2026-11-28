import type { ReactNode } from "react";
import DashboardShell from "./DashboardShell";

// Dashboard content waits until the current session and role are verified.
export const instant = false;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
