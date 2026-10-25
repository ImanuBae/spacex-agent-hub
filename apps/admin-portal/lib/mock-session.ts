// apps/admin-portal/lib/mock-session.ts
import { roleLabels, type UserRole } from "./roles";

export function isMockEnabled(): boolean {
  return process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_MOCK === "true";
}

const MOCK_ROLE_KEY = "admin_portal_mock_role";
const MOCK_ROLE_CHANGE_EVENT = "mock-role-change";

// Lấy role hiện tại từ localStorage
export function getMockRole(): UserRole {
  if (!isMockEnabled()) return "student";
  if (typeof window === "undefined") {
    return "center_director";
  }
  const savedRole = localStorage.getItem(MOCK_ROLE_KEY);
  return savedRole && Object.hasOwn(roleLabels, savedRole)
    ? savedRole as UserRole : "center_director";
}

// Lưu role mới vào localStorage
export function setMockRole(role: UserRole): void {
  if (isMockEnabled() && typeof window !== "undefined") {
    localStorage.setItem(MOCK_ROLE_KEY, role);
    window.dispatchEvent(new Event(MOCK_ROLE_CHANGE_EVENT));
  }
}

export function subscribeMockRole(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(MOCK_ROLE_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);

  return () => {
    window.removeEventListener(MOCK_ROLE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
