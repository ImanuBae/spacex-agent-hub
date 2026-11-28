"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Brand from "../landing/Brand";
import HubIcon from "../dashboard/components/HubIcon";
import { inter } from "../ui/fonts";
import { ErrorMessage } from "../dashboard/components/OperationUI";
import type { StudentAccount, StudentNotice } from "../../lib/student-portal";
import { useStudentResource } from "./portal-data";
import "../ui/orbit.css";

const nav = [
  { title: "Học tập", links: [
    ["/student", "Tổng quan", "overview"],
    ["/student/khoa-hoc", "Khóa học của tôi", "courses"],
    ["/student/lich-hoc", "Lịch học", "schedule"],
    ["/student/tien-do", "Tiến độ học tập", "progress"],
    ["/student/bai-tap", "Bài tập", "audit"],
    ["/student/bai-thi", "Kiểm tra & bài thi", "exam"],
    ["/student/hoc-lieu", "Học liệu", "folder"],
    ["/student/chung-chi", "Chứng chỉ", "certificate"],
  ] },
  { title: "Tài khoản", links: [
    ["/student/don-hang", "Đơn hàng", "finance"],
    ["/student/thong-bao", "Thông báo", "bell"],
    ["/student/ho-tro", "Hỗ trợ", "help"],
    ["/student/cai-dat", "Cài đặt", "settings"],
  ] },
];
const publicSections = new Set(["login", "register", "forgot-password", "reset-password", "verify-email", "403", "404", "500", "maintenance", "offline", "session-expired"]);
const Context = createContext<{
  account: StudentAccount;
  notices: ReturnType<typeof useStudentResource<StudentNotice[]>>;
  dark: boolean;
  toggleTheme: () => void;
} | null>(null);

export function useStudent() {
  const value = useContext(Context);
  if (!value) throw new Error("Student session required");
  return value;
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    function update() { setOnline(navigator.onLine); }
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

export default function StudentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (publicSections.has(pathname.split("/")[2] ?? "")) return children;
  return <Workspace>{children}</Workspace>;
}

function Workspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [account, setAccount] = useState<StudentAccount>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [dark, setDark] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>();
  const online = useOnline();
  const notices = useStudentResource<StudentNotice[]>(account ? "notifications" : undefined, 30000);
  const unread = notices.data?.filter(notice => !notice.readAt).length ?? 0;

  useEffect(() => {
    const controller = new AbortController();
    const expired = () => router.replace("/student/session-expired");
    window.addEventListener("hub:unauthorized", expired);
    void (async () => {
      try {
        const response = await fetch("/api/session/me", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          router.replace("/student/login");
          return;
        }
        if (!response.ok) throw new Error("Chưa kết nối được dịch vụ đăng nhập.");
        const { data } = await response.json() as { data: StudentAccount };
        if (controller.signal.aborted) return;
        if (data.role !== "student" || !data.active) { router.replace("/student/403"); return; }
        try { setDark(localStorage.getItem("spacex-student-theme") === "dark"); } catch { /* Theme is optional. */ }
        setAccount(data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure);
      }
    })();
    return () => { controller.abort(); window.removeEventListener("hub:unauthorized", expired); };
  }, [router, attempt]);

  async function logout() {
    setLoggingOut(true); setLogoutError(undefined);
    try {
      const response = await fetch("/api/session/logout", { method: "POST" });
      if (!response.ok) throw new Error("Chưa đăng xuất được. Vui lòng thử lại.");
      setAccount(undefined);
      router.replace("/student/login");
    } catch (failure) { setLogoutError(failure); setLoggingOut(false); }
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem("spacex-student-theme", next ? "dark" : "light"); } catch { /* Keep the current tab usable. */ }
  }

  return <div className={`hub-theme student-portal ${inter.className}`} data-theme={dark ? "dark" : "light"} data-ui>
    <a className="sp-skip" href="#student-main">Đến nội dung chính</a>
    <aside className="sp-sidebar" data-open={menu} onKeyDown={event => {
      if (menu && event.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
    }}>
      <div className="sp-brand"><Brand href="/student" onClick={() => setMenu(false)} /><span>Cổng học viên</span></div>
      <div className="sp-header-actions">
        <Link className="sp-home-link portal-home-link" href="/" aria-label="Trang chủ" title="Trang chủ">
          <HubIcon name="home" size={17} /><span>Trang chủ</span>
        </Link>
        <button ref={menuButton} type="button" className="sp-menu-button sp-icon-button" aria-controls="student-navigation" aria-expanded={menu}
          aria-label={menu ? "Đóng menu học viên" : "Mở menu học viên"} onClick={() => setMenu(value => !value)}>
          <HubIcon name={menu ? "close" : "menu"} />
        </button>
      </div>
      <nav id="student-navigation" aria-label="Menu học viên">
        {nav.map(group => <div key={group.title} className="sp-nav-group">
          <span>{group.title}</span>
          {group.links.map(([href, label, icon]) => {
            const active = pathname === href || (href !== "/student" && pathname.startsWith(href + "/")) ||
              (href === "/student/don-hang" && pathname.startsWith("/student/thanh-toan/"));
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setMenu(false)}>
              <HubIcon name={icon} />{label}{icon === "bell" && unread > 0 && <small aria-label={unread + " chưa đọc"}>{unread}</small>}
            </Link>;
          })}
        </div>)}
        <Link className="sp-catalog-link" href="/khoa-hoc"><HubIcon name="search" /> Khám phá khóa học <span aria-hidden="true">↗</span></Link>
      </nav>
      {account && <div className="sp-sidebar-foot">
        <Link className="sp-identity" href="/student/ho-so" onClick={() => setMenu(false)}>
          <span className="sp-avatar" aria-hidden="true">{account.name.trim().split(/\s+/).slice(-2).map(part => part[0]).join("").toUpperCase()}</span>
          <span><strong>{account.name}</strong><small>Học viên</small></span>
        </Link>
        <button type="button" aria-label="Đăng xuất" title="Đăng xuất" className="sp-icon-button" disabled={loggingOut} onClick={() => void logout()}><HubIcon name="logout" /></button>
      </div>}
    </aside>
    <main id="student-main" className="sp-main" tabIndex={-1}>
      {!online && <p className="sp-offline" role="status">Bạn đang ngoại tuyến. <Link href="/student/offline">Xem hướng dẫn</Link></p>}
      <ErrorMessage error={logoutError} />
      {account ? <Context.Provider value={{ account, notices, dark, toggleTheme }}>{children}</Context.Provider>
        : error ? <div className="sp-empty"><h1>Chưa mở được cổng học viên</h1><ErrorMessage error={error} retry={() => { setError(undefined); setAttempt(value => value + 1); }} /></div>
          : <div className="sp-empty" role="status">Đang kiểm tra phiên học viên…</div>}
    </main>
  </div>;
}
