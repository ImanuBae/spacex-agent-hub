"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./components/Sidebar";
import HubIcon from "./components/HubIcon";
import { AuthProvider, useAuth } from "../../src/context/AuthContext";
import { getMenuByRole } from "../../lib/roles";
import { inter } from "../ui/fonts";
import "./components/operations.css";
import "../ui/theme.css";
import "./components/shell.css";
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DashboardContent>{children}</DashboardContent>
    </AuthProvider>
  );
}
function DashboardContent({ children }: { children: ReactNode }) {
  const { user, loading, error, reload } = useAuth(),
    router = useRouter(),
    pathname = usePathname();
  const [open, setOpen] = useState(false),
    [logoutError, setLogoutError] = useState("");
  const closeMenu = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!loading && !user && !error) router.replace("/login");
  }, [user, loading, error, router]);
  async function logout() {
    try {
      const r = await fetch("/api/session/logout", { method: "POST" });
      if (!r.ok) throw new Error("Chưa đăng xuất được. Vui lòng thử lại.");
      await reload();
      router.replace("/login");
    } catch (e) {
      setLogoutError(e instanceof Error ? e.message : "Lỗi kết nối");
    }
  }
  if (loading)
    return (
      <div
        className={`hub-theme hub-session-state ${inter.className}`}
        role="status"
      >
        <span className="hub-brand-mark" aria-hidden="true">
          ▲
        </span>
        <p>Đang xác minh phiên…</p>
      </div>
    );
  if (error)
    return (
      <div
        className={`hub-theme hub-session-state ${inter.className}`}
        role="alert"
      >
        <p>{error}</p>
        <button onClick={() => void reload()}>Thử lại</button>
      </div>
    );
  if (!user) return null;
  const menu = getMenuByRole(user.role),
    allowed = menu.some(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );
  const title =
    menu.find((item) => pathname === item.href)?.label ?? "Không gian làm việc";
  const live = [
    "/dashboard/leads",
    "/dashboard/courses",
    "/dashboard/organization",
    "/dashboard/schedule",
    "/dashboard/classes",
    "/dashboard/availability",
  ].includes(pathname);
  return (
    <div className={`hub-theme hub-shell ${pathname === "/dashboard/availability" ? "hub-scheduling-shell" : pathname === "/dashboard/leads" ? "hub-crm-shell" : ""} ${inter.className}`}>
      <Sidebar isOpen={open} onClose={closeMenu} />
      <div className="hub-workbench">
        <header className="hub-topbar">
          <div className="hub-breadcrumb">
            <button
              type="button"
              className="hub-icon-button hub-menu-toggle"
              aria-label="Mở menu"
              aria-controls="hub-sidebar"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <HubIcon name="menu" />
            </button>
            <span>Không gian quản trị</span>
            <HubIcon name="chevron" size={13} />
            <strong>{title}</strong>
          </div>
          <button className="hub-logout" onClick={() => void logout()}>
            <HubIcon name="logout" size={16} />
            <span>Đăng xuất</span>
          </button>
        </header>
        <main className="hub-canvas">
          {logoutError && (
            <p className="hub-notice" role="alert">
              {logoutError}
            </p>
          )}
          {allowed ? (
            <>
              {!live && (
                <p className="hub-notice">
                  Chức năng đang được phát triển. Nội dung bên dưới là bản mẫu.
                </p>
              )}
              {children}
            </>
          ) : (
            <p role="alert">
              Bạn không có quyền truy cập trang này. Chọn chức năng được cấp
              trong menu.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
