"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getMenuByRole, roleLabels } from "../../../lib/roles";
import { useAuth } from "../../../src/context/AuthContext";
import HubIcon from "./HubIcon";
import Brand from "../../landing/Brand";

const navigationSections = [
  { label: "Tuyển sinh", paths: ["overview", "mailbox", "leads", "enrollments"] },
  { label: "Đào tạo", paths: ["courses", "schedule", "classes", "availability", "class-changes", "adjustments", "notifications"] },
  { label: "Tài chính", paths: ["finance", "reconciliation", "refunds"] },
  { label: "Quản trị" },
];

export default function Sidebar({
  isOpen = false,
  onClose,
}: {
  isOpen?: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth(),
    pathname = usePathname(),
    ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = matchMedia("(min-width: 901px)");
    const onResize = () => {
      if (desktop.matches) onClose();
    };
    desktop.addEventListener("change", onResize);
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>("button,a") ?? [],
        ).filter((el) => el.offsetParent !== null),
        first = elements[0],
        last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      desktop.removeEventListener("change", onResize);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [isOpen, onClose]);
  if (!user) return null;
  const menu = getMenuByRole(user.role);
  const groups = navigationSections.map(({ label, paths }) => ({
    label,
    links: paths
      ? menu.filter(item => paths.includes(item.href.split("/").at(-1)!))
      : menu.filter(item => !navigationSections.some(section => section.paths?.includes(item.href.split("/").at(-1)!))),
  }));
  const initials = user.name
    .split(/\s+/)
    .slice(-2)
    .map((s) => s[0])
    .join("");
  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="hub-menu-backdrop"
          aria-label="Đóng menu điều hướng"
          onClick={onClose}
        />
      )}
      <aside
        id="hub-sidebar"
        ref={ref}
        className={`hub-sidebar ${isOpen ? "is-open" : ""}`}
        aria-label="Điều hướng chính"
      >
        <div className="hub-brand">
          <Brand href={menu[0]?.href} onClick={onClose} />
          <button
            className="hub-icon-button hub-menu-close"
            aria-label="Đóng menu"
            onClick={onClose}
          >
            <HubIcon name="close" />
          </button>
        </div>
        <nav aria-label="Các khu vực quản trị">
          {groups.map(({ label, links }) => {
            if (!links.length) return null;
            return <div className="hub-nav-group" key={label}>
              <p className="hub-nav-label">{label}</p>
              <ul>
                {links.map(item => <li key={item.href}>
                  <Link href={item.href} onClick={onClose}
                    aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}>
                    <HubIcon name={item.href.split("/").at(-1)!} />
                    <span>{item.label}</span>
                  </Link>
                </li>)}
              </ul>
            </div>;
          })}
        </nav>
        <div className="hub-account">
          <span className="hub-avatar">{initials}</span>
          <div>
            <strong title={user.name}>{user.name}</strong>
            <small>{roleLabels[user.role]}</small>
          </div>
        </div>
      </aside>
    </>
  );
}
