"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getMenuByRole, roleLabels } from "../../../lib/roles";
import { useAuth } from "../../../src/context/AuthContext";
import HubIcon from "./HubIcon";
import Brand from "../../landing/Brand";
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
          <Brand />
          <button
            className="hub-icon-button hub-menu-close"
            aria-label="Đóng menu"
            onClick={onClose}
          >
            <HubIcon name="close" />
          </button>
        </div>
        <div className="hub-workspace">
          <span className="hub-workspace-dot" />
          <div>
            SpaceX Việt Nam<small>Quản trị trung tâm đào tạo</small>
          </div>
        </div>
        <p className="hub-nav-label">Không gian làm việc</p>
        <nav>
          {getMenuByRole(user.role).map((item) => {
            const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`),
              icon = item.href.split("/").at(-1)!;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
              >
                <HubIcon name={icon} />
                <span>{item.label}</span>
              </Link>
            );
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
