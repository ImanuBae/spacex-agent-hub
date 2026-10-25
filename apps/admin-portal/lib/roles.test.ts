import { describe, expect, it } from "vitest";
import { getMenuByRole, type UserRole } from "./roles";

describe("L-01 role menus", () => {
  const expected: Record<UserRole, string[]> = {
    center_director: ["overview", "mailbox", "leads", "courses", "finance", "organization", "audit"],
    branch_director: ["overview", "mailbox", "leads", "courses", "finance"],
    admissions: ["mailbox", "leads", "courses", "schedule"],
    accountant: ["finance", "reconciliation", "refunds"],
    teacher: ["schedule", "availability", "classes"],
    student: [],
    ai_agent: [],
  };
  it.each(Object.keys(expected) as UserRole[])("shows the agreed menu for %s", role => {
    expect(getMenuByRole(role).map(item => item.href)).toEqual(
      expected[role].map(page => `/dashboard/${page}`),
    );
  });
});
