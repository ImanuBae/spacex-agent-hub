import { z } from "zod";
import { Role } from "./roles.js";

export const LoginInput = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(256) }).strict();
export const AccountInput = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), name: z.string().trim().min(1).max(150), password: z.string().min(12).max(256), role: Role.exclude(["student", "ai_agent"]).default("admissions") }).strict();
export const AccessInput = z.object({ role: Role.exclude(["student", "ai_agent"]), branchIds: z.array(z.uuid()).max(6).refine(ids => new Set(ids).size === ids.length) }).strict();
export const BranchInput = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(150), kind: z.enum(["center", "branch"]), active: z.boolean().default(true) }).strict();
export const DepartmentInput = z.object({ branchId: z.uuid(), name: z.string().trim().min(1).max(150), description: z.string().max(1000).default(""), active: z.boolean().default(true) }).strict();
export const EmployeeInput = z.object({ accountId: z.uuid(), branchId: z.uuid(), departmentId: z.uuid().nullable().default(null), name: z.string().trim().min(1).max(150), title: z.string().max(150).default(""), teacherProfile: z.string().max(3000).nullable().default(null), active: z.boolean().default(true) }).strict();
