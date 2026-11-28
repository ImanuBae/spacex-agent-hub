import type { Schedule, StudentAccount } from "./student-portal";

export function grantedCourseCodes(account: Pick<StudentAccount, "id" | "role" | "active">, config: string): string[] {
  if (account.role !== "student" || !account.active) return [];
  const grants: unknown = JSON.parse(config);
  if (!grants || typeof grants !== "object" || !Object.hasOwn(grants, account.id)) return [];
  const codes: unknown = (grants as Record<string, unknown>)[account.id];
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [];
}

export function practiceSessions(config: string, accountId: string, courseCode: string): Schedule["sessions"] {
  const schedules: unknown = JSON.parse(config);
  if (!schedules || typeof schedules !== "object" || !Object.hasOwn(schedules, accountId)) return [];
  const account = (schedules as Record<string, unknown>)[accountId];
  if (!account || typeof account !== "object" || !Object.hasOwn(account, courseCode)) return [];
  const sessions = (account as Record<string, unknown>)[courseCode];
  if (!Array.isArray(sessions)) return [];
  return sessions.filter((row): row is Schedule["sessions"][number] => row
    && typeof row.startsAt === "string" && typeof row.endsAt === "string"
    && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.startsAt) && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.endsAt)
    && Date.parse(row.endsAt) > Date.parse(row.startsAt))
    .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
}
