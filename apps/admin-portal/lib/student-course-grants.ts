type StudentAccount = { id: string; role: string; active: boolean };

export function grantedCourseCodes(account: StudentAccount, config: string): string[] {
  if (account.role !== "student" || !account.active) return [];
  const grants: unknown = JSON.parse(config);
  if (!grants || typeof grants !== "object" || !Object.hasOwn(grants, account.id)) return [];
  const codes: unknown = (grants as Record<string, unknown>)[account.id];
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [];
}
