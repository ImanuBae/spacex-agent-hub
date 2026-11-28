import { describe, expect, it } from "vitest";
import { getMenuByRole, type UserRole } from "./roles";

describe("L-01 role menus", () => {
  const expected: Record<UserRole, string[]> = {
    center_director: ["overview", "mailbox", "leads", "enrollments", "adjustments", "class-changes", "notifications", "courses", "schedule", "availability", "finance", "reconciliation", "organization", "operations", "audit"],
    branch_director: ["overview", "mailbox", "leads", "enrollments", "adjustments", "class-changes", "notifications", "courses", "schedule", "availability", "finance", "reconciliation"],
    admissions: ["mailbox", "leads", "enrollments", "adjustments", "notifications", "courses", "schedule"],
    accountant: ["finance", "reconciliation", "refunds", "adjustments"],
    teacher: ["schedule", "availability", "classes", "class-changes"],
    student: [],
    ai_agent: [],
  };
  it.each(Object.keys(expected) as UserRole[])("shows the agreed menu for %s", role => {
    expect(getMenuByRole(role).map(item => item.href)).toEqual(
      expected[role].map(page => `/dashboard/${page}`),
    );
  });
});
